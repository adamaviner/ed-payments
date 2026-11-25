// Repeating charges (monthly gifts). The component keeps the schedule and decides, in the same
// transaction that records each charge's outcome, what happens next: the next period, a retry a few
// days on, or lapsing. The client's worker asks claim() which charges are due and makes them as
// ordinary off-session checkouts tagged with the schedule, so refunds, disputes, the sweep and the
// nightly comparison treat them like any other payment.
import { ConvexError, v, type Infer } from 'convex/values'
import type { FunctionHandle } from 'convex/server'
import type { Doc, Id } from './_generated/dataModel.js'
import { mutation, query, type MutationCtx, type QueryCtx } from './_generated/server.js'
import { method, networkRef, payer, processor, ref, scheduleCallbacks, scheduleStatus } from './schema.js'
import { errorText, openIssue } from './lib.js'
import { METHOD_REMOVED, type DeclineKind } from '../core/declines.js'
import { chargeTimeOf, firstChargeFrom, isAnchorDay, periodOf, retryTime, shiftPeriod } from '../core/schedule.js'

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
/** Charges are never scheduled further ahead than this (a start date, a pause). */
const MAX_AHEAD_MS = 2 * 366 * DAY

export const scheduleView = v.object({
  id: v.string(),
  app: v.string(),
  owner: ref,
  ref,
  purpose: v.string(),
  description: v.string(),
  payer,
  processor,
  method,
  paymentMethodId: v.union(v.string(), v.null()),
  amountCents: v.number(),
  interval: v.literal('month'),
  anchorDay: v.number(),
  hourUTC: v.number(),
  status: scheduleStatus,
  /** When the next charge (or retry, or the end of a pause) is due; null once lapsed or cancelled, or while starting. */
  nextChargeAt: v.union(v.number(), v.null()),
  period: v.string(),
  lastPaidPeriod: v.union(v.string(), v.null()),
  pausedUntil: v.union(v.number(), v.null()),
  failures: v.number(),
  lastCheckoutId: v.union(v.string(), v.null()),
  lastError: v.union(v.string(), v.null()),
  endReason: v.union(v.string(), v.null()),
  endedBy: v.union(v.string(), v.null()),
  endedAt: v.union(v.number(), v.null()),
  context: v.any(),
  createdAt: v.number(),
  updatedAt: v.number(),
})
export type ScheduleView = Infer<typeof scheduleView>

const LIVE: ReadonlySet<Doc<'schedules'>['status']> = new Set(['active', 'paused', 'past_due'])
const nextOf = (s: Doc<'schedules'>) => (LIVE.has(s.status) ? s.nextChargeAt : null)

export function viewSchedule(s: Doc<'schedules'>): ScheduleView {
  return {
    id: s._id,
    app: s.app,
    owner: s.owner,
    ref: s.ref,
    purpose: s.purpose,
    description: s.description,
    payer: s.payer,
    processor: s.processor,
    method: s.method,
    paymentMethodId: s.paymentMethodId ?? null,
    amountCents: s.amountCents,
    interval: s.interval,
    anchorDay: s.anchorDay,
    hourUTC: s.hourUTC,
    status: s.status,
    nextChargeAt: nextOf(s),
    period: s.period,
    lastPaidPeriod: s.lastPaidPeriod ?? null,
    pausedUntil: s.pausedUntil ?? null,
    failures: s.failures,
    lastCheckoutId: s.lastCheckoutId ?? null,
    lastError: s.lastError ?? null,
    endReason: s.endReason ?? null,
    endedBy: s.endedBy ?? null,
    endedAt: s.endedAt ?? null,
    context: s.context ?? null,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  }
}

async function load(ctx: QueryCtx, id: string): Promise<Doc<'schedules'>> {
  const nid = ctx.db.normalizeId('schedules', id)
  const s = nid ? await ctx.db.get(nid) : null
  if (!s) throw new ConvexError(`No schedule ${id}.`)
  return s
}

/** The fields every schedule callback gets. */
function scheduleBase(s: Doc<'schedules'>) {
  return {
    scheduleId: s._id as string,
    ref: s.ref,
    purpose: s.purpose,
    owner: s.owner,
    payer: s.payer,
    processor: s.processor,
    method: s.method,
    paymentMethodId: s.paymentMethodId ?? null,
    amountCents: s.amountCents,
    status: s.status,
    nextChargeAt: nextOf(s),
    context: s.context ?? null,
  }
}

/** Calls one of the host's schedule callbacks with the schedule as it now stands; a throw (its writes rolled back) becomes a callback_failed issue. */
async function tellHost(ctx: MutationCtx, id: Id<'schedules'>, name: 'onCharged' | 'onFailed' | 'onChanged', args: Record<string, unknown>, now: number, checkoutId?: Id<'checkouts'>) {
  const s = await ctx.db.get(id)
  const handle = s?.callbacks[name]
  if (!s || !handle) return
  try {
    await ctx.runMutation(handle as FunctionHandle<'mutation', Record<string, unknown>, unknown>, { ...scheduleBase(s), ...args })
  } catch (err) {
    await openIssue(ctx, { kind: 'callback_failed', key: `schedule:${s._id}:${name}`, checkoutId, processor: s.processor, detail: `schedule ${name} failed: ${errorText(err)}`, now })
  }
}

export type ScheduleChange = 'started' | 'not_started' | 'amount' | 'method' | 'anchor' | 'paused' | 'resumed' | 'cancelled'

async function changed(ctx: MutationCtx, before: Doc<'schedules'>, changes: ScheduleChange[], o: { reason?: string; by?: string; now: number }) {
  await tellHost(ctx, before._id, 'onChanged', { changes, previousStatus: before.status, previousAmountCents: before.amountCents, reason: o.reason ?? null, by: o.by ?? null }, o.now)
}

/** The next period that hasn't been paid, at or after `period`. */
const unpaidFrom = (s: Pick<Doc<'schedules'>, 'lastPaidPeriod'>, period: string) => (s.lastPaidPeriod && period <= s.lastPaidPeriod ? shiftPeriod(s.lastPaidPeriod, 1) : period)

/** Where a schedule starts again (a resume, a new method after it lapsed): the first charge time from `at` whose period is unpaid. */
function restartAt(s: Doc<'schedules'>, at: number) {
  const clock = { anchorDay: s.anchorDay, hourUTC: s.hourUTC }
  const first = firstChargeFrom(at, clock)
  const period = unpaidFrom(s, periodOf(first))
  return { period, nextChargeAt: period === periodOf(first) ? first : chargeTimeOf(period, clock) }
}

// ── Making and reading ─────────────────────────────────────────────────────────────────────────

export const create = mutation({
  args: {
    app: v.string(),
    owner: ref,
    ref,
    purpose: v.string(),
    description: v.string(),
    payer,
    processor,
    method,
    paymentMethodId: v.optional(v.string()),
    amountCents: v.number(),
    anchorDay: v.number(),
    hourUTC: v.number(),
    retryDays: v.array(v.number()),
    firstChargeAt: v.number(),
    callbacks: scheduleCallbacks,
    context: v.optional(v.any()),
    now: v.number(),
  },
  returns: v.string(),
  handler: async (ctx, { now, firstChargeAt, ...a }) => {
    if (!Number.isInteger(a.amountCents) || a.amountCents < 1) throw new ConvexError('A schedule needs an amount of at least one cent.')
    if (!isAnchorDay(a.anchorDay)) throw new ConvexError('A schedule’s day of the month must be 1 to 28.')
    if (!Number.isInteger(a.hourUTC) || a.hourUTC < 0 || a.hourUTC > 23) throw new ConvexError('A schedule’s hour must be 0 to 23 (UTC).')
    if (firstChargeAt > now + MAX_AHEAD_MS) throw new ConvexError('A schedule can’t start more than two years ahead.')
    if (a.retryDays.some((d) => !(d > 0)) || a.retryDays.some((d, i) => i > 0 && d <= a.retryDays[i - 1])) throw new ConvexError('Retry days must be positive and increasing.')
    const at = Math.max(firstChargeAt, now)
    return await ctx.db.insert('schedules', {
      ...a,
      interval: 'month',
      status: a.paymentMethodId ? 'active' : 'starting',
      nextChargeAt: at,
      period: periodOf(at),
      firstPeriod: periodOf(at),
      periodAttempts: 0,
      failures: 0,
      createdAt: now,
      updatedAt: now,
    })
  },
})

/** A starting schedule whose first checkout couldn't even be made (the app's call threw): gone, as if never asked for. */
export const discard = mutation({
  args: { id: v.string() },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const s = await load(ctx, id)
    if (s.status === 'starting' && !s.lastCheckoutId) await ctx.db.delete(s._id)
    return null
  },
})

export const get = query({
  args: { id: v.string() },
  returns: v.union(scheduleView, v.null()),
  handler: async (ctx, { id }) => {
    const nid = ctx.db.normalizeId('schedules', id)
    const s = nid ? await ctx.db.get(nid) : null
    return s ? viewSchedule(s) : null
  },
})

/** An owner's schedules in one app, newest first (at most 50), ended ones included. */
export const forOwner = query({
  args: { app: v.string(), owner: ref },
  returns: v.array(scheduleView),
  handler: async (ctx, { app, owner }) => {
    const rows = await ctx.db
      .query('schedules')
      .withIndex('by_owner', (q) => q.eq('app', app).eq('owner.type', owner.type).eq('owner.id', owner.id))
      .order('desc')
      .take(50)
    return rows.map(viewSchedule)
  },
})

export const forRef = query({
  args: { ref },
  returns: v.array(scheduleView),
  handler: async (ctx, { ref }) => {
    const rows = await ctx.db
      .query('schedules')
      .withIndex('by_ref', (q) => q.eq('ref.type', ref.type).eq('ref.id', ref.id))
      .order('desc')
      .take(50)
    return rows.map(viewSchedule)
  },
})

/** One app's schedules the worker should act on now: due charges and retries, and pauses that have ended. */
export const due = query({
  args: { app: v.string(), now: v.number(), limit: v.number() },
  returns: v.array(v.object({ id: v.string(), app: v.string() })),
  handler: async (ctx, { app, now, limit }) => {
    const out: { id: string; app: string }[] = []
    for (const status of ['active', 'past_due', 'paused'] as const) {
      const rows = await ctx.db
        .query('schedules')
        .withIndex('by_app_status_nextChargeAt', (q) => q.eq('app', app).eq('status', status).lte('nextChargeAt', now))
        .take(limit)
      out.push(...rows.map((s) => ({ id: s._id as string, app: s.app })))
    }
    return out
  },
})

/** Schedules still relying on a saved method (not cancelled), so it isn't removed from under them. */
export const usingMethod = query({
  args: { paymentMethodId: v.string() },
  returns: v.number(),
  handler: async (ctx, { paymentMethodId }) => {
    const rows = await ctx.db
      .query('schedules')
      .withIndex('by_paymentMethodId', (q) => q.eq('paymentMethodId', paymentMethodId))
      .take(100)
    return rows.filter((s) => s.status !== 'cancelled').length
  },
})

// ── Charging ───────────────────────────────────────────────────────────────────────────────────

const chargePlan = v.object({
  action: v.literal('charge'),
  key: v.string(),
  period: v.string(),
  amountCents: v.number(),
  paymentMethodId: v.string(),
  owner: ref,
  ref,
  purpose: v.string(),
  description: v.string(),
  payer,
  context: v.any(),
})

/**
 * Whether a saved method can still be charged: not known to be removed. One the library has no row
 * for, at either processor, is charged, and the processor's answer decides; calling it gone would
 * lapse the schedule as a hard decline on a guess.
 */
async function methodUsable(ctx: QueryCtx, paymentMethodId: string | undefined): Promise<boolean> {
  if (!paymentMethodId) return false
  if (paymentMethodId.startsWith('paypal:')) {
    const pp = await ctx.db
      .query('paypalMethods')
      .withIndex('by_paymentTokenId', (q) => q.eq('paymentTokenId', paymentMethodId.slice('paypal:'.length)))
      .first()
    return !pp || pp.removedAt === undefined
  }
  const pm = await ctx.db
    .query('paymentMethods')
    .withIndex('by_stripePaymentMethodId', (q) => q.eq('stripePaymentMethodId', paymentMethodId))
    .first()
  return !pm || pm.removedAt === undefined
}

/**
 * The worker asks whether a schedule's charge is due, and gets what to charge, keyed by schedule and
 * period (and attempt, for retries: a refused try charged nothing). A pause that has ended resumes
 * it; a charge still open (no answer yet) holds it back an hour; a method that is gone fails the
 * period as a hard decline, without a charge.
 */
export const claim = mutation({
  args: { id: v.string(), app: v.string(), now: v.number() },
  returns: v.union(chargePlan, v.object({ action: v.literal('wait'), reason: v.string() })),
  handler: async (ctx, { id, app, now }) => {
    let s = await load(ctx, id)
    const wait = (reason: string) => ({ action: 'wait' as const, reason })
    if (s.app !== app) return wait('Not this app’s schedule.')
    if (!LIVE.has(s.status)) return wait(`The schedule is ${s.status}.`)
    if (s.nextChargeAt > now) return wait('Not due yet.')
    if (s.status === 'paused') {
      const before = s
      await ctx.db.patch(s._id, { status: 'active', pausedUntil: undefined, updatedAt: now })
      await changed(ctx, before, ['resumed'], { reason: 'The pause ended.', now })
      s = await load(ctx, id)
      if (s.status !== 'active') return wait(`The schedule is ${s.status}.`)
    }
    const period = unpaidFrom(s, s.period)
    if (period !== s.period) {
      const nextChargeAt = chargeTimeOf(period, s)
      await ctx.db.patch(s._id, { period, periodAttempts: 0, failures: 0, firstFailedAt: undefined, nextChargeAt, updatedAt: now })
      if (nextChargeAt > now) return wait('That period is already paid.')
      s = await load(ctx, id)
    }
    const last = s.lastCheckoutId ? await ctx.db.get(s.lastCheckoutId) : null
    if (last && (last.status === 'created' || last.status === 'pending')) {
      await ctx.db.patch(s._id, { nextChargeAt: now + HOUR, updatedAt: now })
      return wait('The last charge hasn’t finished.')
    }
    if (!(await methodUsable(ctx, s.paymentMethodId))) {
      await failPeriod(ctx, s, { period: s.period, reason: 'The saved payment method is gone.', declineCode: METHOD_REMOVED, kind: 'hard', now })
      return wait('The saved payment method is gone.')
    }
    // Each try of a period has its own key; one already used (its checkout settled) is skipped, so a
    // retry never replays a refused try. checkouts.create counts the try.
    let attempt = s.periodAttempts
    const keyOf = (n: number) => (n === 0 ? `schedule-${s._id}-${s.period}` : `schedule-${s._id}-${s.period}-${n + 1}`)
    for (let i = 0; i < 50; i++) {
      const used = await ctx.db
        .query('checkouts')
        .withIndex('by_chargeKey', (q) => q.eq('chargeKey', `${app}:${keyOf(attempt)}`))
        .first()
      if (!used || used.status === 'created' || used.status === 'pending') break
      attempt++
    }
    if (attempt !== s.periodAttempts) await ctx.db.patch(s._id, { periodAttempts: attempt })
    return {
      action: 'charge' as const,
      key: keyOf(attempt),
      period: s.period,
      amountCents: s.amountCents,
      paymentMethodId: s.paymentMethodId ?? '',
      owner: s.owner,
      ref: s.ref,
      purpose: s.purpose,
      description: s.description,
      payer: s.payer,
      context: s.context ?? null,
    }
  },
})

/** A checkout was made for a schedule (checkouts.create): it is the period's latest try. */
export async function noteScheduleCheckout(ctx: MutationCtx, scheduleId: Id<'schedules'>, checkoutId: Id<'checkouts'>, period: string, offSession: boolean, now: number) {
  const s = await ctx.db.get(scheduleId)
  if (!s) return
  if (!offSession) {
    await ctx.db.patch(s._id, { lastCheckoutId: checkoutId, updatedAt: now })
    return
  }
  if (s.period !== period) return
  // Looked at again in a day if no outcome ever comes back; an outcome sets the real next time.
  await ctx.db.patch(s._id, { lastCheckoutId: checkoutId, periodAttempts: s.periodAttempts + 1, nextChargeAt: now + DAY, updatedAt: now })
}

/**
 * One refusal of the schedule's current period: retried later, or (retries used up, or a hard decline)
 * lapsed. A paused schedule (a charge on its way when the payer paused) stays paused until its own
 * time, when the period is charged again; only the error is kept, and the host told.
 */
async function failPeriod(ctx: MutationCtx, s: Doc<'schedules'>, f: { period: string; reason: string; declineCode?: string; kind: DeclineKind; now: number; checkoutId?: Id<'checkouts'> }) {
  if (s.status === 'paused') {
    await ctx.db.patch(s._id, { period: f.period, lastError: f.reason, updatedAt: f.now })
    const reported = {
      checkoutId: f.checkoutId ?? null,
      period: f.period,
      attempt: s.failures + 1,
      final: false,
      reason: f.reason,
      declineCode: f.declineCode ?? null,
      declineKind: f.kind,
      nextRetryAt: null,
    }
    return await tellHost(ctx, s._id, 'onFailed', reported, f.now, f.checkoutId)
  }
  const failures = (s.period === f.period ? s.failures : 0) + 1
  const firstFailedAt = failures === 1 ? f.now : (s.firstFailedAt ?? f.now)
  const retry = retryTime({ firstFailedAt, failures, kind: f.kind, retryDays: s.retryDays, hourUTC: s.hourUTC })
  await ctx.db.patch(s._id, {
    period: f.period,
    failures,
    firstFailedAt,
    lastError: f.reason,
    updatedAt: f.now,
    ...(retry === null ? { status: 'lapsed' as const, endReason: f.reason, endedBy: undefined, endedAt: f.now } : { status: 'past_due' as const, nextChargeAt: retry }),
  })
  await tellHost(
    ctx,
    s._id,
    'onFailed',
    { checkoutId: f.checkoutId ?? null, period: f.period, attempt: failures, final: retry === null, reason: f.reason, declineCode: f.declineCode ?? null, declineKind: f.kind, nextRetryAt: retry },
    f.now,
    f.checkoutId,
  )
}

/** A period was paid or is on its way (a bank debit): the schedule moves to the next period. */
async function advance(ctx: MutationCtx, s: Doc<'schedules'>, period: string, now: number) {
  const lastPaidPeriod = s.lastPaidPeriod && s.lastPaidPeriod > period ? s.lastPaidPeriod : period
  if (s.period > period) {
    if (lastPaidPeriod !== s.lastPaidPeriod) await ctx.db.patch(s._id, { lastPaidPeriod, updatedAt: now })
    return
  }
  const next = shiftPeriod(period, 1)
  await ctx.db.patch(s._id, {
    lastPaidPeriod,
    period: next,
    periodAttempts: 0,
    failures: 0,
    firstFailedAt: undefined,
    lastError: undefined,
    // A paused or ended schedule keeps its own next time (or none).
    ...(s.status === 'active' || s.status === 'past_due' || s.status === 'starting' ? { status: 'active' as const, nextChargeAt: chargeTimeOf(next, s) } : {}),
    updatedAt: now,
  })
}

type CheckoutDoc = Doc<'checkouts'>

/**
 * A schedule that never started because its first checkout expired or failed, whose first payment
 * arrived anyway on a checkout the payer didn't cancel: it starts after all.
 */
const revivable = (s: Doc<'schedules'>, c: Pick<CheckoutDoc, 'schedulePeriod' | 'cancelledByBuyerAt'>) =>
  s.status === 'cancelled' && s.neverStarted === true && c.cancelledByBuyerAt === undefined && c.schedulePeriod === s.firstPeriod

/** A schedule's first payment arrived (or is on its way): it starts. */
async function start(ctx: MutationCtx, s: Doc<'schedules'>, c: CheckoutDoc, now: number) {
  if (s.status === 'cancelled') await ctx.db.patch(s._id, { endReason: undefined, endedAt: undefined, endedBy: undefined, neverStarted: undefined })
  await advance(ctx, { ...s, status: 'starting' }, c.schedulePeriod ?? s.period, now)
  await changed(ctx, s, ['started'], { now })
}

export async function scheduleProcessing(ctx: MutationCtx, c: CheckoutDoc, now: number) {
  const s = c.scheduleId ? await ctx.db.get(c.scheduleId) : null
  if (!s || !c.schedulePeriod) return
  if (s.status === 'starting' || revivable(s, c)) return await start(ctx, s, c, now)
  if (s.status !== 'cancelled') await advance(ctx, s, c.schedulePeriod, now)
}

export async function schedulePaid(ctx: MutationCtx, c: CheckoutDoc, paid: { paidCents: number; paymentRef: string }, now: number) {
  const s = c.scheduleId ? await ctx.db.get(c.scheduleId) : null
  if (!s || !c.schedulePeriod) return
  const first = c.schedulePeriod === s.firstPeriod
  if (s.status === 'starting' || revivable(s, c)) await start(ctx, s, c, now)
  else if (s.status !== 'cancelled') await advance(ctx, s, c.schedulePeriod, now)
  await tellHost(ctx, s._id, 'onCharged', { checkoutId: c._id, period: c.schedulePeriod, paidCents: paid.paidCents, paymentRef: paid.paymentRef, first }, now, c._id)
}

/**
 * A schedule's charge was refused, bounced or given up. The current period is retried or lapses. A
 * bank debit that bounces after the schedule moved on takes it back to that period, unless the next
 * period was already tried; then the host is only told.
 */
export async function scheduleFailed(ctx: MutationCtx, c: CheckoutDoc, f: { reason: string; declineCode?: string; kind?: DeclineKind; wasProcessing: boolean }, now: number) {
  const s = c.scheduleId ? await ctx.db.get(c.scheduleId) : null
  const period = c.schedulePeriod
  if (!s || !period || s.status === 'cancelled') return
  if (s.status === 'starting') return await notStarted(ctx, s, 'The first payment failed.', now)
  const kind = f.kind ?? 'soft'
  if (s.period === period) return await failPeriod(ctx, s, { period, reason: f.reason, declineCode: f.declineCode, kind, now, checkoutId: c._id })
  if (f.wasProcessing && s.period === shiftPeriod(period, 1) && s.periodAttempts === 0) {
    const lastPaidPeriod = s.lastPaidPeriod === period ? undefined : s.lastPaidPeriod
    const back = { ...s, period, failures: 0, lastPaidPeriod }
    await ctx.db.patch(s._id, { period, failures: 0, firstFailedAt: undefined, lastPaidPeriod, status: s.status === 'lapsed' ? 'active' : s.status })
    return await failPeriod(ctx, back, { period, reason: f.reason, declineCode: f.declineCode, kind, now, checkoutId: c._id })
  }
  await tellHost(
    ctx,
    s._id,
    'onFailed',
    { checkoutId: c._id, period, attempt: 1, final: false, reason: f.reason, declineCode: f.declineCode ?? null, declineKind: kind, nextRetryAt: null },
    now,
    c._id,
  )
}

/** A starting schedule's first checkout was abandoned or failed: the schedule never starts. */
export async function scheduleAbandoned(ctx: MutationCtx, c: CheckoutDoc, now: number) {
  const s = c.scheduleId ? await ctx.db.get(c.scheduleId) : null
  if (s?.status === 'starting') await notStarted(ctx, s, 'The first payment wasn’t completed.', now)
}

async function notStarted(ctx: MutationCtx, s: Doc<'schedules'>, reason: string, now: number) {
  await ctx.db.patch(s._id, { status: 'cancelled', endReason: reason, endedAt: now, updatedAt: now, neverStarted: true })
  await changed(ctx, s, ['not_started'], { reason, now })
}

/**
 * The method a starting schedule's first payment saved (Stripe's setup_future_usage, PayPal's vault
 * with purchase), recorded as the owner's saved method and the schedule's. Repeats change nothing.
 */
export const attachMethod = mutation({
  args: {
    id: v.string(),
    stripe: v.optional(v.object({ stripeCustomerId: v.string(), stripePaymentMethodId: v.string(), kind: v.union(v.literal('card'), v.literal('ach')), label: v.string() })),
    paypal: v.optional(
      v.object({
        paypalCustomerId: v.string(),
        paymentTokenId: v.string(),
        kind: v.union(v.literal('card'), v.literal('paypal')),
        label: v.string(),
        usagePattern: v.optional(v.string()),
        networkRef: v.optional(networkRef),
      }),
    ),
    now: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, { id, stripe, paypal, now }) => {
    const s = await load(ctx, id)
    if (s.paymentMethodId) return null
    // Only a schedule its first payment can still start: waiting for it, or never started and revived by it.
    const first = s.lastCheckoutId ? await ctx.db.get(s.lastCheckoutId) : null
    if (s.status !== 'starting' && !(first && revivable(s, first))) return null
    if (stripe) {
      const customer = await ctx.db
        .query('customers')
        .withIndex('by_stripeCustomerId', (q) => q.eq('stripeCustomerId', stripe.stripeCustomerId))
        .first()
      if (!customer || customer.app !== s.app || customer.owner.type !== s.owner.type || customer.owner.id !== s.owner.id) throw new ConvexError('That Stripe customer isn’t this schedule’s owner’s.')
      const row = await ctx.db
        .query('paymentMethods')
        .withIndex('by_stripePaymentMethodId', (q) => q.eq('stripePaymentMethodId', stripe.stripePaymentMethodId))
        .first()
      if (!row) await ctx.db.insert('paymentMethods', { customerId: customer._id, stripePaymentMethodId: stripe.stripePaymentMethodId, kind: stripe.kind, label: stripe.label, createdAt: now })
      await ctx.db.patch(s._id, { paymentMethodId: stripe.stripePaymentMethodId, method: stripe.kind, updatedAt: now })
    } else if (paypal) {
      const owned = await ctx.db
        .query('paypalCustomers')
        .withIndex('by_owner', (q) => q.eq('app', s.app).eq('owner.type', s.owner.type).eq('owner.id', s.owner.id))
        .first()
      const customerId = owned?._id ?? (await ctx.db.insert('paypalCustomers', { app: s.app, owner: s.owner, paypalCustomerId: paypal.paypalCustomerId, createdAt: now }))
      const row = await ctx.db
        .query('paypalMethods')
        .withIndex('by_paymentTokenId', (q) => q.eq('paymentTokenId', paypal.paymentTokenId))
        .first()
      if (!row) {
        await ctx.db.insert('paypalMethods', {
          customerId,
          paymentTokenId: paypal.paymentTokenId,
          kind: paypal.kind,
          label: paypal.label,
          usagePattern: paypal.usagePattern,
          networkRef: paypal.networkRef,
          createdAt: now,
        })
      }
      await ctx.db.patch(s._id, { paymentMethodId: `paypal:${paypal.paymentTokenId}`, method: paypal.kind, updatedAt: now })
    }
    return null
  },
})

// ── Changes from the app ───────────────────────────────────────────────────────────────────────

const changeArgs = { id: v.string(), app: v.string(), by: v.optional(v.string()), now: v.number() }

async function owned(ctx: QueryCtx, id: string, app: string) {
  const s = await load(ctx, id)
  if (s.app !== app) throw new ConvexError(`No schedule ${id}.`)
  return s
}

/**
 * New amount (from the next charge), saved method (checked by the client to be the owner's), day of
 * the month or description. A new method on a schedule being retried charges the refused period
 * again at once; on a lapsed one it starts again from the next charge date.
 */
export const update = mutation({
  args: {
    ...changeArgs,
    amountCents: v.optional(v.number()),
    paymentMethodId: v.optional(v.string()),
    processor: v.optional(processor),
    method: v.optional(method),
    anchorDay: v.optional(v.number()),
    description: v.optional(v.string()),
  },
  returns: scheduleView,
  handler: async (ctx, { id, app, by, now, ...a }) => {
    const s = await owned(ctx, id, app)
    if (s.status === 'cancelled') throw new ConvexError('This schedule was cancelled.')
    if (s.status === 'starting') throw new ConvexError('This schedule hasn’t started yet.')
    const patch: Partial<Doc<'schedules'>> = { updatedAt: now }
    const changes: ScheduleChange[] = []
    if (a.amountCents !== undefined && a.amountCents !== s.amountCents) {
      if (!Number.isInteger(a.amountCents) || a.amountCents < 1) throw new ConvexError('A schedule needs an amount of at least one cent.')
      patch.amountCents = a.amountCents
      changes.push('amount')
    }
    if (a.description !== undefined) patch.description = a.description
    if (a.anchorDay !== undefined && a.anchorDay !== s.anchorDay) {
      if (!isAnchorDay(a.anchorDay)) throw new ConvexError('A schedule’s day of the month must be 1 to 28.')
      patch.anchorDay = a.anchorDay
      // The unpaid period keeps its place; only its day moves (charged now if that day has passed).
      if (s.status === 'active') patch.nextChargeAt = Math.max(now, chargeTimeOf(s.period, { anchorDay: a.anchorDay, hourUTC: s.hourUTC }))
      changes.push('anchor')
    }
    if (a.paymentMethodId !== undefined && a.paymentMethodId !== s.paymentMethodId) {
      patch.paymentMethodId = a.paymentMethodId
      if (a.processor) patch.processor = a.processor
      if (a.method) patch.method = a.method
      changes.push('method')
      if (s.status === 'past_due') Object.assign(patch, { status: 'active', nextChargeAt: now, failures: 0, firstFailedAt: undefined })
      if (s.status === 'lapsed') Object.assign(patch, { status: 'active', failures: 0, firstFailedAt: undefined, endReason: undefined, endedAt: undefined, periodAttempts: 0, ...restartAt(s, now) })
    }
    await ctx.db.patch(s._id, patch)
    if (changes.length) await changed(ctx, s, changes, { by, now })
    return viewSchedule(await load(ctx, id))
  },
})

/** Skips charges until `until`, then the first charge date from then on charges again, by itself. */
export const pause = mutation({
  args: { ...changeArgs, until: v.number() },
  returns: scheduleView,
  handler: async (ctx, { id, app, by, now, until }) => {
    const s = await owned(ctx, id, app)
    if (!LIVE.has(s.status)) throw new ConvexError(`A ${s.status} schedule can’t be paused.`)
    if (until <= now) throw new ConvexError('A pause has to end in the future.')
    if (until > now + MAX_AHEAD_MS) throw new ConvexError('A pause can’t be longer than two years.')
    await ctx.db.patch(s._id, { status: 'paused', pausedUntil: until, failures: 0, firstFailedAt: undefined, periodAttempts: 0, ...restartAt(s, until), updatedAt: now })
    await changed(ctx, s, ['paused'], { by, now })
    return viewSchedule(await load(ctx, id))
  },
})

/** A paused or lapsed schedule charges again: from `at` (default now), at the first charge date of an unpaid period. */
export const resume = mutation({
  args: { ...changeArgs, at: v.optional(v.number()) },
  returns: scheduleView,
  handler: async (ctx, { id, app, by, now, at }) => {
    const s = await owned(ctx, id, app)
    if (s.status !== 'paused' && s.status !== 'lapsed') throw new ConvexError(`A ${s.status} schedule can’t be resumed.`)
    if (at !== undefined && at > now + MAX_AHEAD_MS) throw new ConvexError('A schedule can’t start more than two years ahead.')
    await ctx.db.patch(s._id, {
      status: 'active',
      pausedUntil: undefined,
      failures: 0,
      firstFailedAt: undefined,
      periodAttempts: 0,
      endReason: undefined,
      endedAt: undefined,
      endedBy: undefined,
      ...restartAt(s, Math.max(at ?? now, now)),
      updatedAt: now,
    })
    await changed(ctx, s, ['resumed'], { by, now })
    return viewSchedule(await load(ctx, id))
  },
})

/** Ends a schedule for good. A charge already on its way still settles (and is reported). */
export const cancel = mutation({
  args: { ...changeArgs, reason: v.string() },
  returns: scheduleView,
  handler: async (ctx, { id, app, by, now, reason }) => {
    const s = await owned(ctx, id, app)
    if (s.status === 'cancelled') return viewSchedule(s)
    await ctx.db.patch(s._id, { status: 'cancelled', endReason: reason, endedBy: by, endedAt: now, updatedAt: now })
    await changed(ctx, s, ['cancelled'], { reason, by, now })
    return viewSchedule(await load(ctx, id))
  },
})

/**
 * A saved method was removed at the processor (a PayPal account holder cancelled the agreement, the
 * card was detached at Stripe): every schedule using it is cancelled, saying so, and the method is
 * marked removed so nothing offers or charges it again.
 */
export const methodRemoved = mutation({
  args: { paymentMethodId: v.string(), reason: v.string(), now: v.number() },
  returns: v.number(),
  handler: async (ctx, { paymentMethodId, reason, now }) => {
    if (paymentMethodId.startsWith('paypal:')) {
      const pp = await ctx.db
        .query('paypalMethods')
        .withIndex('by_paymentTokenId', (q) => q.eq('paymentTokenId', paymentMethodId.slice('paypal:'.length)))
        .first()
      if (pp && pp.removedAt === undefined) await ctx.db.patch(pp._id, { removedAt: now })
    } else {
      const pm = await ctx.db
        .query('paymentMethods')
        .withIndex('by_stripePaymentMethodId', (q) => q.eq('stripePaymentMethodId', paymentMethodId))
        .first()
      if (pm && pm.removedAt === undefined) await ctx.db.patch(pm._id, { removedAt: now })
    }
    const rows = await ctx.db
      .query('schedules')
      .withIndex('by_paymentMethodId', (q) => q.eq('paymentMethodId', paymentMethodId))
      .take(100)
    let n = 0
    for (const s of rows) {
      if (s.status === 'cancelled') continue
      await ctx.db.patch(s._id, { status: 'cancelled', endReason: reason, endedBy: 'processor', endedAt: now, updatedAt: now })
      await changed(ctx, s, ['cancelled'], { reason, by: 'processor', now })
      n++
    }
    return n
  },
})
