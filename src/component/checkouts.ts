// The checkout state machine. Every transition checks where the row is first and answers
// already_handled when it has moved on, so a repeated webhook, a reloaded return page and the sweep
// can all race without doing anything twice (Convex runs mutations one at a time per row).
import { ConvexError, v, type ObjectType } from 'convex/values'
import { paginationOptsValidator, paginationResultValidator } from 'convex/server'
import type { Doc, Id } from './_generated/dataModel.js'
import { mutation, query, type MutationCtx, type QueryCtx } from './_generated/server.js'
import { callHost, callbackBase, checkoutView, findSavedMethod, loadCheckout, notifyHost, openIssue, resolveIssue, view } from './lib.js'
import { dollars } from '../core/money.js'
import { callbacks, checkoutKind, checkoutStatus, declineKind, method, payer, processor, ref } from './schema.js'
import { giveBackOne, limitsArg, takeAll } from './limits.js'
import { noteScheduleCheckout, scheduleAbandoned, scheduleFailed, schedulePaid, scheduleProcessing } from './schedules.js'

const already = v.object({ outcome: v.literal('already_handled'), status: checkoutStatus })

const createArgs = {
  app: v.string(),
  ref,
  purpose: v.string(),
  description: v.string(),
  amountCents: v.number(),
  processor,
  method,
  payer,
  returnUrl: v.string(),
  cancelUrl: v.string(),
  expiresAt: v.number(),
  context: v.optional(v.any()),
  callbacks,
  kind: v.optional(checkoutKind),
  stripeCustomerId: v.optional(v.string()),
  paymentMethodId: v.optional(v.string()),
  chargeKey: v.optional(v.string()),
  retryOf: v.optional(v.string()),
  /** A schedule's charge or first payment, and the period it pays. */
  scheduleId: v.optional(v.string()),
  schedulePeriod: v.optional(v.string()),
  limits: v.optional(limitsArg),
  now: v.number(),
}

/**
 * Makes the row before the processor is asked, so its id can be the processor's reference. Refuses
 * past the rate limits. A charge key already used is the same charge: its checkout is returned (not
 * made), and a different charge under it is refused, as Stripe refuses a key reused with other parameters.
 */
async function insertCheckout(ctx: MutationCtx, { limits, now, retryOf, scheduleId, ...a }: ObjectType<typeof createArgs>): Promise<{ id: Id<'checkouts'>; created: boolean }> {
  if (!Number.isInteger(a.amountCents) || a.amountCents < 1) throw new ConvexError('A checkout needs an amount of at least one cent.')
  // The same charge key is the same charge: two calls at once make one row.
  if (a.chargeKey) {
    const same = await ctx.db
      .query('checkouts')
      .withIndex('by_chargeKey', (q) => q.eq('chargeKey', a.chargeKey))
      .first()
    if (same) {
      const differs = same.amountCents !== a.amountCents || same.paymentMethodId !== a.paymentMethodId || same.ref.type !== a.ref.type || same.ref.id !== a.ref.id
      if (differs) throw new ConvexError('That idempotency key was already used for a different charge (another amount, payment method or thing paid for).')
      return { id: same._id, created: false }
    }
  }
  if (limits) await takeAll(ctx, limits, now)
  const original = retryOf ? ctx.db.normalizeId('checkouts', retryOf) : null
  if (retryOf && !original) throw new ConvexError(`No checkout ${retryOf}.`)
  // One open retry at a time, decided in this transaction, so two tabs can't each start one.
  if (original) {
    const open = await ctx.db
      .query('checkouts')
      .withIndex('by_retryOf', (q) => q.eq('retryOf', original))
      .filter((q) => q.or(q.eq(q.field('status'), 'created'), q.eq(q.field('status'), 'pending'), q.eq(q.field('status'), 'processing')))
      .first()
    if (open) throw new ConvexError('A payment for this is already open. Reload the page to continue it.')
  }
  // A retry pays what its charge was for: a schedule's charge carries its schedule and period on,
  // so paying the retry pays the period and a second payment for it is owed back.
  const from = original && !scheduleId ? await ctx.db.get(original) : null
  if (from?.scheduleId && from.schedulePeriod) {
    scheduleId = from.scheduleId
    a.schedulePeriod = from.schedulePeriod
  }
  const schedule = scheduleId ? ctx.db.normalizeId('schedules', scheduleId) : null
  if (scheduleId && (!schedule || !a.schedulePeriod)) throw new ConvexError(`No schedule ${scheduleId}.`)
  const id = await ctx.db.insert('checkouts', {
    ...a,
    ...(original ? { retryOf: original } : {}),
    ...(schedule ? { scheduleId: schedule } : {}),
    status: 'created',
    refundedCents: 0,
    createdAt: now,
  })
  if (schedule && a.schedulePeriod) await noteScheduleCheckout(ctx, schedule, id, a.schedulePeriod, a.kind === 'offSession', now)
  return { id, created: true }
}

export const create = mutation({
  args: createArgs,
  returns: v.string(),
  handler: async (ctx, a) => (await insertCheckout(ctx, a)).id,
})

/**
 * create, saying whether this call made the checkout, so a repeat of a charge doesn't queue it again.
 * With `failed` (chargeSaved found the method isn't saved for the payer) the charge is recorded as
 * failed in the same transaction, onFailed included, so the payer can be asked to pay on the app's
 * page (a retry needs a failed charge). A repeat finds it already failed and calls nothing again.
 */
export const createCharge = mutation({
  args: { ...createArgs, failed: v.optional(v.object({ reason: v.string(), declineCode: v.string() })) },
  returns: v.object({ id: v.string(), created: v.boolean() }),
  handler: async (ctx, { failed, ...a }) => {
    const made = await insertCheckout(ctx, a)
    if (made.created && failed) await failCheckout(ctx, await loadCheckout(ctx, made.id), { ...failed, declineKind: 'hard', now: a.now })
    return made
  },
})

/** The processor made its checkout: remember its id; the buyer is on their way. */
export const attach = mutation({
  args: { id: v.string(), processorCheckoutId: v.string() },
  returns: v.union(v.object({ outcome: v.literal('attached') }), already),
  handler: async (ctx, { id, processorCheckoutId }) => {
    const c = await loadCheckout(ctx, id)
    if (c.status !== 'created') return { outcome: 'already_handled' as const, status: c.status }
    await ctx.db.patch(c._id, { status: 'pending', processorCheckoutId })
    return { outcome: 'attached' as const }
  },
})

/**
 * An on-page PayPal checkout whose order PayPal won't take again (too many tries, expired): the
 * payment goes on under a new order. The old order is never captured (capturePaypal takes only the
 * checkout's own), and its decline was the old order's, so the new one may be captured by the
 * webhook or the sweep once the buyer approves it. Refused while a capture holds the checkout.
 */
export const reorder = mutation({
  args: { id: v.string(), processorCheckoutId: v.string() },
  returns: v.union(v.object({ outcome: v.literal('reordered') }), already),
  handler: async (ctx, { id, processorCheckoutId }) => {
    const c = await loadCheckout(ctx, id)
    if (c.status !== 'pending' || c.kind !== 'onPage' || c.processor !== 'paypal' || c.captureClaimedAt !== undefined) return { outcome: 'already_handled' as const, status: c.status }
    await ctx.db.patch(c._id, { processorCheckoutId, paypalDeclinedAt: undefined })
    return { outcome: 'reordered' as const }
  },
})

/** The processor couldn't make its checkout; start throws to the buyer, and the row is closed. */
export const failStart = mutation({
  args: { id: v.string(), error: v.string(), now: v.number() },
  returns: v.null(),
  handler: async (ctx, { id, error, now }) => {
    const c = await loadCheckout(ctx, id)
    if (c.status !== 'created') return null
    await ctx.db.patch(c._id, { status: 'failed', lastError: error, settledAt: now })
    await scheduleAbandoned(ctx, c, now)
    return null
  },
})

/** A bank payment was accepted and the money is on its way (days, for ACH). The host's onProcessing is told (e.g. to pause a deadline). */
export const markProcessing = mutation({
  args: { id: v.string(), paymentRef: v.optional(v.string()), method: v.optional(method), now: v.optional(v.number()) },
  returns: v.union(v.object({ outcome: v.literal('processing') }), already),
  handler: async (ctx, { id, paymentRef, method, now }) => {
    const c = await loadCheckout(ctx, id)
    // Like settlePaid, money on its way to a checkout that expired or failed is still money taken.
    if (!SETTLEABLE.has(c.status) || c.status === 'processing') return { outcome: 'already_handled' as const, status: c.status }
    const patch = { status: 'processing' as const, paymentRef: paymentRef ?? c.paymentRef, method: method ?? c.method, lastError: undefined }
    await ctx.db.patch(c._id, patch)
    await resolveIssue(ctx, c._id, 'charge_unknown', now ?? Date.now())
    // The buyer cancelled it: the money will be owed back when it arrives (settlePaid), so the sale isn't going ahead.
    if (c.cancelledByBuyerAt !== undefined) return { outcome: 'processing' as const }
    await scheduleProcessing(ctx, { ...c, ...patch }, now ?? Date.now())
    await notifyHost(ctx, { ...c, ...patch }, 'onProcessing', { paymentRef: patch.paymentRef ?? null }, now ?? Date.now())
    return { outcome: 'processing' as const }
  },
})

const SETTLEABLE: ReadonlySet<Doc<'checkouts'>['status']> = new Set(['created', 'pending', 'processing', 'abandoned', 'failed'])

/**
 * The money arrived. Records it and calls the host's onPaid in this same transaction, so "paid" and
 * the host's order are written together or not at all. If onPaid refuses ({ refuse }) or throws (its
 * writes roll back), or the amount isn't what was asked, the checkout is refund_needed, a refund for
 * the whole amount is recorded, and onRefundNeeded is told. A payment for a checkout that was already
 * abandoned or failed is still money taken, so it is settled the same way.
 */
export const settlePaid = mutation({
  args: {
    id: v.string(),
    paymentRef: v.string(),
    paidCents: v.number(),
    processorFeeCents: v.optional(v.number()),
    /** Recorded when attach never ran (start died after the processor made its checkout). */
    processorCheckoutId: v.optional(v.string()),
    /** How it was actually paid, when that can differ from what was asked (an on-session retry may use another method). */
    method: v.optional(method),
    now: v.number(),
  },
  returns: v.union(v.object({ outcome: v.literal('paid') }), v.object({ outcome: v.literal('refund_needed'), reason: v.string(), refundId: v.string() }), already),
  handler: async (ctx, { id, paymentRef, paidCents, processorFeeCents, processorCheckoutId, method, now }) => {
    const loaded = await loadCheckout(ctx, id)
    if (!SETTLEABLE.has(loaded.status)) return { outcome: 'already_handled' as const, status: loaded.status }
    const c = { ...loaded, method: method ?? loaded.method }
    await ctx.db.patch(c._id, {
      paymentRef,
      paidCents,
      processorFeeCents: processorFeeCents ?? c.processorFeeCents,
      settledAt: now,
      lastError: undefined,
      method: c.method,
      processorCheckoutId: c.processorCheckoutId ?? processorCheckoutId,
    })
    await resolveIssue(ctx, c._id, 'charge_unknown', now)
    // The buyer cancelled before the money arrived: they were told it wasn't taken, so it goes back.
    const cancelled = c.cancelledByBuyerAt !== undefined
    let refusal: string | null = cancelled
      ? 'The buyer cancelled this payment before it arrived.'
      : paidCents === c.amountCents
        ? null
        : `The processor took ${dollars(paidCents)}, not the ${dollars(c.amountCents)} asked.`
    // A charge and its on-session retries (and a schedule's period) pay for one thing: the second to arrive is owed back.
    const duplicate = !refusal && (await paidElsewhere(ctx, c))
    if (duplicate) refusal = 'This was already paid by another payment.'
    if (!refusal && c.callbacks.onPaid) {
      const paid = { ...callbackBase(c), amountCents: c.amountCents, paidCents, paymentRef }
      const res = await callHost<{ refuse?: string } | null>(ctx, c.callbacks.onPaid, paid)
      refusal = !res.ok ? res.error : res.value && typeof res.value.refuse === 'string' ? res.value.refuse || 'Refused by the app.' : null
    }
    if (refusal === null) {
      await ctx.db.patch(c._id, { status: 'paid' })
      await schedulePaid(ctx, { ...c, status: 'paid' }, { paidCents, paymentRef }, now)
      return { outcome: 'paid' as const }
    }
    console.warn(`payments: ${c.processor} payment ${paymentRef} for checkout ${c._id} needs a refund: ${refusal}`)
    await ctx.db.patch(c._id, { status: 'refund_needed', lastError: refusal })
    const refundId = await ctx.db.insert('refunds', { checkoutId: c._id, amountCents: paidCents, reason: refusal, origin: 'needed', status: 'requested', createdAt: now, updatedAt: now })
    const updated = (await ctx.db.get(c._id)) ?? c
    await notifyHost(ctx, updated, 'onRefundNeeded', { amountCents: c.amountCents, paidCents, paymentRef, refundId, reason: refusal }, now)
    // Money the app turned away doesn't pay the period, and charging again would only be turned away
    // too. A duplicate isn't a refusal of the period (another payment paid it), nor is a payment the buyer cancelled.
    if (!duplicate && !cancelled) await scheduleFailed(ctx, updated, { reason: refusal, kind: 'hard', wasProcessing: loaded.status === 'processing' }, now)
    return { outcome: 'refund_needed' as const, reason: refusal, refundId }
  },
})

/**
 * The processor says the payment failed (a declined capture or card, a bounced bank debit), or a
 * person gave up on a charge whose outcome was unknown. Nothing to refund. `declined` marks the
 * saved method the charge used, so it isn't offered again.
 */
export const settleFailed = mutation({
  args: {
    id: v.string(),
    reason: v.string(),
    declined: v.optional(v.boolean()),
    /** The processor's code for the refusal and how bad it is (core/declines.ts), when known. */
    declineCode: v.optional(v.string()),
    declineKind: v.optional(declineKind),
    processorCheckoutId: v.optional(v.string()),
    now: v.number(),
  },
  returns: v.union(v.object({ outcome: v.literal('failed') }), already),
  handler: async (ctx, { id, ...f }) => {
    const c = await loadCheckout(ctx, id)
    if (c.status !== 'created' && c.status !== 'pending' && c.status !== 'processing') return { outcome: 'already_handled' as const, status: c.status }
    await failCheckout(ctx, c, f)
    return { outcome: 'failed' as const }
  },
})

type Failure = { reason: string; declined?: boolean; declineCode?: string; declineKind?: Doc<'checkouts'>['declineKind']; processorCheckoutId?: string; now: number }

/** settleFailed's work on a checkout still open: the row, the method marked, the host's onFailed and the schedule, in the caller's transaction. */
async function failCheckout(ctx: MutationCtx, c: Doc<'checkouts'>, { reason, declined, declineCode, declineKind, processorCheckoutId, now }: Failure) {
  const wasProcessing = c.status === 'processing'
  const patch = { status: 'failed' as const, lastError: reason, settledAt: now, processorCheckoutId: c.processorCheckoutId ?? processorCheckoutId, declineCode, declineKind, parkedAt: undefined }
  await ctx.db.patch(c._id, patch)
  if (declined && c.paymentMethodId) await markDeclined(ctx, c.paymentMethodId, reason, now)
  await resolveIssue(ctx, c._id, 'charge_unknown', now)
  await notifyHost(ctx, { ...c, ...patch }, 'onFailed', { reason, declined: declined ?? false, wasProcessing, declineCode: declineCode ?? null }, now)
  await scheduleFailed(ctx, { ...c, ...patch }, { reason, declineCode, kind: declineKind, wasProcessing }, now)
}

/**
 * An off-session charge whose outcome isn't known (no answer, Stripe down, an odd status). The row
 * stays waiting; the attempt is counted, and with `giveUp` an issue asks a person to decide.
 */
export const noteChargeAttempt = mutation({
  args: { id: v.string(), error: v.string(), processorCheckoutId: v.optional(v.string()), giveUp: v.boolean(), max: v.number(), now: v.number() },
  returns: v.number(),
  handler: async (ctx, { id, error, processorCheckoutId, giveUp, max, now }) => {
    const c = await loadCheckout(ctx, id)
    // Settled meanwhile (the webhook won the race): nothing is unknown any more.
    if (c.status !== 'created' && c.status !== 'pending') return c.chargeAttempts ?? 0
    // Handed to a person: counted as the last try, so the sweep leaves it to them.
    const attempts = giveUp ? Math.max((c.chargeAttempts ?? 0) + 1, max) : (c.chargeAttempts ?? 0) + 1
    const ref = c.processorCheckoutId ?? processorCheckoutId
    await ctx.db.patch(c._id, {
      chargeAttempts: attempts,
      lastTriedAt: now,
      lastError: error,
      processorCheckoutId: ref,
      status: c.status === 'created' ? 'pending' : c.status,
      ...(giveUp ? { parkedAt: now } : {}),
    })
    if (giveUp) {
      await openIssue(ctx, {
        kind: 'charge_unknown',
        key: c._id,
        checkoutId: c._id,
        processor: c.processor,
        paymentRef: ref,
        detail: `The charge of ${dollars(c.amountCents)} for ${c.description} may or may not have gone through (${error}). Retry it (${c.processor === 'paypal' ? 'PayPal refuses a second payment for the same charge' : 'Stripe replays it rather than charging twice'}) or give up on it.`,
        now,
      })
    }
    return attempts
  },
})

/**
 * A person asked for an off-session charge to be tried again: its issue closes and the client tries
 * once more. The count is kept, since it picks the next idempotency key.
 */
export const reopenCharge = mutation({
  args: { id: v.string(), now: v.number() },
  returns: v.null(),
  handler: async (ctx, { id, now }) => {
    const c = await loadCheckout(ctx, id)
    if (c.kind !== 'offSession') throw new ConvexError('Only a saved-method charge can be retried.')
    if (c.status !== 'created' && c.status !== 'pending') throw new ConvexError(`This charge is ${c.status}; there is nothing to retry.`)
    if (c.parkedAt !== undefined) await ctx.db.patch(c._id, { parkedAt: undefined })
    await resolveIssue(ctx, c._id, 'charge_unknown', now)
    return null
  },
})

/**
 * An on-session payment the bank refused: the buyer may try again on the same page, so the checkout
 * stays open. `paypalDeclinedAt`: PayPal declined what the buyer chose at capture, so only the buyer
 * captures it from now on (kept whatever later writes lastError).
 */
export const noteError = mutation({
  args: { id: v.string(), error: v.string(), paypalDeclinedAt: v.optional(v.number()) },
  returns: v.null(),
  handler: async (ctx, { id, error, paypalDeclinedAt }) => {
    const c = await loadCheckout(ctx, id)
    if (c.status === 'pending' || c.status === 'created') await ctx.db.patch(c._id, { lastError: error, ...(paypalDeclinedAt === undefined ? {} : { paypalDeclinedAt }) })
    return null
  },
})

/** Expired with nothing at the processor. */
export const abandon = mutation({
  args: { id: v.string(), now: v.number() },
  returns: v.union(v.object({ outcome: v.literal('abandoned') }), already),
  handler: async (ctx, { id, now }) => {
    const c = await loadCheckout(ctx, id)
    if (c.status !== 'created' && c.status !== 'pending') return { outcome: 'already_handled' as const, status: c.status }
    await ctx.db.patch(c._id, { status: 'abandoned', settledAt: now })
    await scheduleAbandoned(ctx, c, now)
    return { outcome: 'abandoned' as const }
  },
})

/** How long a PayPal capture's claim keeps the buyer from cancelling; after that it is stale (the capture died). */
export const CAPTURE_CLAIM_MS = 5 * 60_000

/**
 * The buyer closed a checkout they started (Edit on the app's page): abandoned now rather than when it
 * expires, and the start it took from their own rate limit (`giveBack`, the per-payer key) handed
 * back, so editing and continuing again isn't refused as too many tries. Only a waiting checkout is
 * closed, and only once, so cancelling can't refill the limit; the overall limit keeps its count.
 * Money that arrives anyway is owed back (settlePaid). being_paid: a PayPal capture is under way, so
 * it isn't closed. check_processor: a capture claimed it and never finished; ask PayPal whether it
 * was taken, then call again with `checked`.
 */
export const cancel = mutation({
  args: { id: v.string(), giveBack: v.optional(v.object({ key: v.string(), windowMs: v.number() })), checked: v.optional(v.boolean()), now: v.number() },
  returns: v.union(v.object({ outcome: v.literal('abandoned') }), v.object({ outcome: v.literal('being_paid') }), v.object({ outcome: v.literal('check_processor') }), already),
  handler: async (ctx, { id, giveBack, checked, now }) => {
    const c = await loadCheckout(ctx, id)
    if (c.status !== 'created' && c.status !== 'pending') return { outcome: 'already_handled' as const, status: c.status }
    if (c.captureClaimedAt !== undefined && now - c.captureClaimedAt < CAPTURE_CLAIM_MS) return { outcome: 'being_paid' as const }
    if (c.captureClaimedAt !== undefined && !checked) return { outcome: 'check_processor' as const }
    await ctx.db.patch(c._id, { status: 'abandoned', settledAt: now, cancelledByBuyerAt: now })
    if (giveBack && c.createdAt > now - giveBack.windowMs) await giveBackOne(ctx, giveBack.key, now, giveBack.windowMs)
    await scheduleAbandoned(ctx, c, now)
    return { outcome: 'abandoned' as const }
  },
})

/**
 * A PayPal capture takes the checkout before asking PayPal, so the buyer's cancel can't close it
 * while the money is being taken. Refused when it isn't waiting, or another capture's claim is live.
 */
export const claimCapture = mutation({
  args: { id: v.string(), now: v.number() },
  returns: v.union(v.object({ claimed: v.literal(true) }), v.object({ claimed: v.literal(false), status: checkoutStatus })),
  handler: async (ctx, { id, now }) => {
    const c = await loadCheckout(ctx, id)
    const live = c.captureClaimedAt !== undefined && now - c.captureClaimedAt < CAPTURE_CLAIM_MS
    if ((c.status !== 'created' && c.status !== 'pending') || live) return { claimed: false as const, status: c.status }
    await ctx.db.patch(c._id, { captureClaimedAt: now })
    return { claimed: true as const }
  },
})

/** The capture ended without taking money (declined, not approved): the buyer may cancel again. */
export const releaseCapture = mutation({
  args: { id: v.string() },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const c = await loadCheckout(ctx, id)
    if (c.captureClaimedAt !== undefined) await ctx.db.patch(c._id, { captureClaimedAt: undefined })
    return null
  },
})

/** What the processor kept, learned after the sale. */
export const recordFee = mutation({
  args: { id: v.string(), processorFeeCents: v.number() },
  returns: v.null(),
  handler: async (ctx, { id, processorFeeCents }) => {
    const c = await loadCheckout(ctx, id)
    if (c.processorFeeCents !== processorFeeCents) await ctx.db.patch(c._id, { processorFeeCents })
    return null
  },
})

/** A problem the client met along the way that a person should see (e.g. a callback for an unknown checkout). */
export const noteIssue = mutation({
  args: { id: v.string(), kind: v.union(v.literal('status_differs'), v.literal('amount_differs')), detail: v.string(), now: v.number() },
  returns: v.null(),
  handler: async (ctx, { id, kind, detail, now }) => {
    const c = await loadCheckout(ctx, id)
    await openIssue(ctx, { kind, key: c.paymentRef ?? c.processorCheckoutId ?? c._id, checkoutId: c._id, processor: c.processor, paymentRef: c.paymentRef, detail, now })
    return null
  },
})

/**
 * Whether the thing this checkout pays for was already paid: by the charge it retries, by another
 * retry of it, or (a schedule's) by any other payment for the same schedule and period.
 */
async function paidElsewhere(ctx: MutationCtx, c: Doc<'checkouts'>): Promise<boolean> {
  const rootId = c.retryOf ?? c._id
  const isPaid = (x: Doc<'checkouts'> | null) => !!x && x._id !== c._id && (x.status === 'paid' || x.status === 'processing')
  if (c.retryOf && isPaid(await ctx.db.get(c.retryOf))) return true
  const siblings = await ctx.db
    .query('checkouts')
    .withIndex('by_retryOf', (q) => q.eq('retryOf', rootId))
    .take(50)
  if (siblings.some(isPaid)) return true
  return !!c.scheduleId && !!c.schedulePeriod && (await periodPaid(ctx, c.scheduleId, c.schedulePeriod, c._id))
}

/** Whether a payment other than `except` paid (or is paying, by bank) a schedule's period. */
async function periodPaid(ctx: QueryCtx, scheduleId: Id<'schedules'>, period: string, except?: Id<'checkouts'>): Promise<boolean> {
  const samePeriod = await ctx.db
    .query('checkouts')
    .withIndex('by_scheduleId', (q) => q.eq('scheduleId', scheduleId))
    .filter((q) => q.eq(q.field('schedulePeriod'), period))
    .take(100)
  return samePeriod.some((x) => x._id !== except && (x.status === 'paid' || x.status === 'processing'))
}

async function markDeclined(ctx: MutationCtx, paymentMethodId: string, reason: string, now: number) {
  const row = await findSavedMethod(ctx, paymentMethodId)
  if (row && row.declinedAt === undefined) await ctx.db.patch(row._id, { declinedAt: now, declineReason: reason })
}

const nullable = v.union(checkoutView, v.null())

export const get = query({
  args: { id: v.string() },
  returns: nullable,
  handler: async (ctx, { id }) => {
    const nid = ctx.db.normalizeId('checkouts', id)
    const c = nid ? await ctx.db.get(nid) : null
    return c ? view(c) : null
  },
})

export const byProcessorId = query({
  args: { processorCheckoutId: v.string() },
  returns: nullable,
  handler: async (ctx, { processorCheckoutId }) => {
    const c = await ctx.db
      .query('checkouts')
      .withIndex('by_processorCheckoutId', (q) => q.eq('processorCheckoutId', processorCheckoutId))
      .first()
    return c ? view(c) : null
  },
})

export const byPaymentRef = query({
  args: { paymentRef: v.string() },
  returns: nullable,
  handler: async (ctx, { paymentRef }) => {
    const c = await ctx.db
      .query('checkouts')
      .withIndex('by_paymentRef', (q) => q.eq('paymentRef', paymentRef))
      .first()
    return c ? view(c) : null
  },
})

/** The checkouts for one thing in the app, newest first (at most 50). */
export const byRef = query({
  args: { ref },
  returns: v.array(checkoutView),
  handler: async (ctx, { ref }) => {
    const rows = await ctx.db
      .query('checkouts')
      .withIndex('by_ref', (q) => q.eq('ref.type', ref.type).eq('ref.id', ref.id))
      .order('desc')
      .take(50)
    return rows.map(view)
  },
})

export const list = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(checkoutView),
  handler: async (ctx, { paginationOpts }) => {
    const page = await ctx.db.query('checkouts').withIndex('by_createdAt').order('desc').paginate(paginationOpts)
    return { ...page, page: page.page.map(view) }
  },
})

/**
 * Paid checkouts with something left to refund, newest first, a page at a time (for a refund screen).
 * With `ref`, only that thing's. Fully refunded rows are left out of each page, so a page may be short.
 */
export const refundable = query({
  args: { ref: v.optional(ref), paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(checkoutView),
  handler: async (ctx, { ref, paginationOpts }) => {
    const page = ref
      ? await ctx.db
          .query('checkouts')
          .withIndex('by_ref', (q) => q.eq('ref.type', ref.type).eq('ref.id', ref.id))
          .order('desc')
          .paginate(paginationOpts)
      : await ctx.db
          .query('checkouts')
          .withIndex('by_status_createdAt', (q) => q.eq('status', 'paid'))
          .order('desc')
          .paginate(paginationOpts)
    return { ...page, page: page.page.filter((c) => c.status === 'paid' && (c.paidCents ?? 0) > c.refundedCents).map(view) }
  },
})

/** The off-session charge made under an app's idempotency key, if any. */
export const byChargeKey = query({
  args: { chargeKey: v.string() },
  returns: nullable,
  handler: async (ctx, { chargeKey }) => {
    const c = await ctx.db
      .query('checkouts')
      .withIndex('by_chargeKey', (q) => q.eq('chargeKey', chargeKey))
      .first()
    return c ? view(c) : null
  },
})

/** Whether a schedule's period is paid (or on its way), so a retry for it is refused. */
export const schedulePeriodPaid = query({
  args: { scheduleId: v.string(), period: v.string() },
  returns: v.boolean(),
  handler: async (ctx, { scheduleId, period }) => {
    const nid = ctx.db.normalizeId('schedules', scheduleId)
    return !!nid && (await periodPaid(ctx, nid, period))
  },
})

/** The on-session retries of a checkout, newest first. */
export const retriesOf = query({
  args: { id: v.string() },
  returns: v.array(checkoutView),
  handler: async (ctx, { id }) => {
    const nid = ctx.db.normalizeId('checkouts', id)
    if (!nid) return []
    const rows = await ctx.db
      .query('checkouts')
      .withIndex('by_retryOf', (q) => q.eq('retryOf', nid))
      .order('desc')
      .take(20)
    return rows.map(view)
  },
})

/** Checkouts created since a time, oldest first, a page at a time, for the nightly comparison. */
export const createdSince = query({
  args: { since: v.number(), paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(checkoutView),
  handler: async (ctx, { since, paginationOpts }) => {
    const page = await ctx.db
      .query('checkouts')
      .withIndex('by_createdAt', (q) => q.gte('createdAt', since))
      .paginate(paginationOpts)
    return { ...page, page: page.page.map(view) }
  },
})

/** Not-final checkouts for sweep: every created/pending/processing row not handed to a person, oldest expiry first. */
export const due = query({
  args: { limit: v.number() },
  returns: v.array(checkoutView),
  handler: async (ctx, { limit }) => {
    const out: Doc<'checkouts'>[] = []
    for (const status of ['created', 'pending', 'processing'] as const) {
      out.push(
        ...(await ctx.db
          .query('checkouts')
          .withIndex('by_status_parked_expiresAt', (q) => q.eq('status', status).eq('parkedAt', undefined))
          .take(limit)),
      )
    }
    return out.map(view)
  },
})

export type CheckoutId = Id<'checkouts'>
