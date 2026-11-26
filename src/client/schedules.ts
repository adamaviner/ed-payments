// Schedules: a saved method charged every month, by the library. The component keeps each schedule
// and decides what follows each charge (schedules.ts there); this side makes the charges, as
// off-session checkouts keyed `schedule-<id>-<period>`, from the app's hourly cron (worker().schedules)
// and from startSchedule when the first charge is due at once. startScheduleCheckout begins one for a
// new payer with a payment that also saves their method: Stripe's embedded Checkout or on-page
// PaymentIntent with setup_future_usage, or PayPal's buttons / Card Fields with vault-with-purchase.
import { createFunctionHandle } from 'convex/server'
import { ConvexError } from 'convex/values'
import { DEFAULT_CHARGE_HOUR_UTC, DEFAULT_RETRY_DAYS, anchorDayOf, isAnchorDay } from '../core/schedule.js'
import { isMethodFor, type Method, type Payer, type Processor, type Ref } from '../core/types.js'
import type { Payments, RunActionCtx, RunMutationCtx, RunQueryCtx, SchedulerCtx, StartUi, StartedEmbedded, StartedOnPage, StartedRedirect } from './index.js'
import { getOrderOrNull, orderVault } from '../core/paypal.js'
import { MAX_REPLACED_HOPS, STALE_PRESS, paypalSavedArgs, reuseOrClose, type Replaced } from './hosted.js'
import { ensureCustomer } from './saved.js'
import { cleanPayer, errorText } from './util.js'

export type ScheduleView = NonNullable<Awaited<ReturnType<Payments['getSchedule']>>>

export interface ScheduleBaseArgs<T> {
  /** Whose saved method it charges, as for setupPaymentMethod (e.g. { type: 'donor', id }). */
  owner: Ref
  /** What it is for in the app, e.g. { type: 'monthlyDonation', id }; every charge carries it too. */
  ref: Ref
  purpose: string
  /** What the payer sees at the processor for each charge. */
  description: string
  payer: Payer
  /** Each period's charge, priced on the server. */
  amountCents: number
  /** Passed to every charge's callbacks and the schedule's own; checked against the context validator. */
  context: T
  /** Day of the month charged (1-28). Default: the first charge's day, kept to 28. */
  anchorDay?: number
}

export interface StartScheduleArgs<T> extends ScheduleBaseArgs<T> {
  /** A method saved for `owner` (from savedMethods or verifyMethodOwner, never from the browser as it came). */
  paymentMethodId: string
  /** The Stripe Customer, when the library has none recorded for the owner (adopting one made before it). */
  stripeCustomerId?: string
  /** When the first charge is made (ms); default now, charged at once. Later ones follow on the anchor day. */
  firstChargeAt?: number
}

export interface StartScheduleCheckoutArgs<T> extends ScheduleBaseArgs<T> {
  /**
   * Who takes it: the app decides (for a new card, e.g. the cheaper of the two for the monthly
   * amount: cardProcessorFor / compareProcessingFees). Stripe takes card or ach, PayPal card or paypal.
   */
  processor: Processor
  method: Method
  /** As for start: where the payer comes back to (Stripe adds session_id, PayPal token), and where they turned back to. */
  returnPath: string
  cancelPath: string
  /** embedded (default): on the app's page (StripeEmbeddedCheckout, PaypalButtons or PaypalCardPayment); redirect: the processor's page. */
  ui?: StartUi
  /** As for start: with ui: 'onPage', the checkout the payer's last press started, reused while nothing that matters changed. */
  replaces?: string
  expiresAt?: number
  limitKey?: string
  stripeCustomerId?: string
}

/** Throws unless the app wired what schedules need: the three schedule callbacks and worker().schedules. */
function wired(p: Payments) {
  const on = p.wiring.on
  if (!on.scheduleCharged || !on.scheduleFailed || !on.scheduleChanged || !p.wiring.worker.schedules) {
    throw new Error('Schedules need on.scheduleCharged, on.scheduleFailed and on.scheduleChanged in withCallbacks, and worker().schedules exported (see the README).')
  }
  return { charged: on.scheduleCharged, failed: on.scheduleFailed, changed: on.scheduleChanged }
}

async function handles(p: Payments) {
  const w = wired(p)
  return { onCharged: await createFunctionHandle(w.charged), onFailed: await createFunctionHandle(w.failed), onChanged: await createFunctionHandle(w.changed) }
}

function checkBase<T>(p: Payments, a: ScheduleBaseArgs<T>) {
  if (!Number.isInteger(a.amountCents) || a.amountCents < 1) throw new ConvexError('A schedule needs an amount of at least one cent.')
  if (a.anchorDay !== undefined && !isAnchorDay(a.anchorDay)) throw new ConvexError('A schedule’s day of the month must be 1 to 28.')
  p.checkContext(a.context)
}

const clock = (p: Payments) => ({ hourUTC: p.options.schedules?.hourUTC ?? DEFAULT_CHARGE_HOUR_UTC, retryDays: [...(p.options.schedules?.retryDays ?? DEFAULT_RETRY_DAYS)] })

export async function startSchedule<T>(p: Payments, ctx: SchedulerCtx, a: StartScheduleArgs<T>): Promise<{ scheduleId: string; checkoutId: string | null }> {
  checkBase(p, a)
  const callbacks = await handles(p)
  const target = await p.chargeTarget(ctx, { owner: a.owner, paymentMethodId: a.paymentMethodId, stripeCustomerId: a.stripeCustomerId })
  const now = Date.now()
  const firstChargeAt = Math.max(a.firstChargeAt ?? now, now)
  const scheduleId = await ctx.runMutation(p.component.schedules.create, {
    app: p.app,
    owner: a.owner,
    ref: a.ref,
    purpose: a.purpose,
    description: a.description,
    payer: cleanPayer(a.payer),
    processor: target.processor,
    method: target.method,
    paymentMethodId: a.paymentMethodId,
    amountCents: a.amountCents,
    anchorDay: a.anchorDay ?? anchorDayOf(firstChargeAt),
    ...clock(p),
    firstChargeAt,
    callbacks,
    context: a.context,
    now,
  })
  const checkoutId = firstChargeAt <= now ? await chargeDue(p, ctx, scheduleId) : null
  return { scheduleId, checkoutId }
}

export async function startScheduleCheckout<T>(p: Payments, ctx: RunActionCtx, a: StartScheduleCheckoutArgs<T>): Promise<(StartedRedirect | StartedEmbedded | StartedOnPage) & { scheduleId: string }> {
  // A first payment another press already replaced is followed to the one that replaced it.
  for (let hop = 0; hop < MAX_REPLACED_HOPS; hop++) {
    const r = await startScheduleCheckoutOnce(p, ctx, a)
    if (!('replacedBy' in r)) return r
    a = { ...a, replaces: r.replacedBy }
  }
  throw new ConvexError(STALE_PRESS)
}

async function startScheduleCheckoutOnce<T>(
  p: Payments,
  ctx: RunActionCtx,
  a: StartScheduleCheckoutArgs<T>,
): Promise<((StartedRedirect | StartedEmbedded | StartedOnPage) & { scheduleId: string }) | Replaced> {
  if (!isMethodFor(a.processor, a.method)) throw new ConvexError(`${a.processor === 'stripe' ? 'Stripe' : 'PayPal'} doesn’t take ${a.method} payments here.`)
  checkBase(p, a)
  const ui = a.ui ?? 'embedded'
  if (a.replaces) {
    const reused = await reuseOrClose(p, ctx, a.replaces, { ...a, ui, schedule: { owner: a.owner, anchorDay: a.anchorDay } })
    if (reused?.scheduleId) return { checkoutId: reused.checkoutId, onPage: reused.onPage, reused: true, scheduleId: reused.scheduleId }
  }
  const callbacks = await handles(p)
  let stripeCustomerId: string | undefined
  let paypalCustomerId: string | undefined
  if (a.processor === 'stripe') {
    p.stripeKeys()
    const customer = await ensureCustomer(p, ctx, a.owner, a.payer, a.stripeCustomerId)
    if (!customer) throw new ConvexError('Couldn’t set up a payer here.')
    stripeCustomerId = customer.stripeCustomerId
  } else {
    p.paypalKeys()
    paypalCustomerId = (await ctx.runQuery(p.component.customers.paypalCustomer, { app: p.app, owner: a.owner })) ?? undefined
  }
  const now = Date.now()
  const scheduleId = await ctx.runMutation(p.component.schedules.create, {
    app: p.app,
    owner: a.owner,
    ref: a.ref,
    purpose: a.purpose,
    description: a.description,
    payer: cleanPayer(a.payer),
    processor: a.processor,
    method: a.method,
    amountCents: a.amountCents,
    anchorDay: a.anchorDay ?? anchorDayOf(now),
    ...clock(p),
    firstChargeAt: now,
    callbacks,
    context: a.context,
    now,
  })
  const schedule = await ctx.runQuery(p.component.schedules.get, { id: scheduleId })
  try {
    const started = await p.begin(
      ctx,
      {
        ref: a.ref,
        purpose: a.purpose,
        description: a.description,
        amountCents: a.amountCents,
        processor: a.processor,
        method: a.method,
        payer: a.payer,
        returnPath: a.returnPath,
        cancelPath: a.cancelPath,
        expiresAt: a.expiresAt,
        limitKey: a.limitKey,
        context: a.context,
        ui,
        replaces: a.replaces,
      },
      { scheduleId, schedulePeriod: schedule?.period ?? '', stripeCustomerId, paypalCustomerId },
    )
    if ('replacedBy' in started) {
      await discard(p, ctx, scheduleId)
      return started
    }
    return { ...started, scheduleId }
  } catch (err) {
    await discard(p, ctx, scheduleId)
    throw err
  }
}

/** A schedule made for a first payment that didn't start (no checkout was made for it) is removed. */
async function discard(p: Payments, ctx: RunActionCtx, scheduleId: string) {
  await ctx.runMutation(p.component.schedules.discard, { id: scheduleId }).catch((e: unknown) => console.warn(`payments: couldn’t discard schedule ${scheduleId}: ${errorText(e)}`))
}

/**
 * Charges a schedule if it is due (the component decides, keyed by period), returning the checkout id,
 * or null when there was nothing to charge.
 */
export async function chargeDue(p: Payments, ctx: SchedulerCtx, scheduleId: string): Promise<string | null> {
  const plan = await ctx.runMutation(p.component.schedules.claim, { id: scheduleId, app: p.app, now: Date.now() })
  if (plan.action === 'check_vault') {
    await checkPaypalVault(p, ctx, plan.orderId)
    return null
  }
  if (plan.action !== 'charge') return null
  return await p.chargeOffSession(
    ctx,
    {
      ref: plan.ref,
      purpose: plan.purpose,
      description: plan.description,
      amountCents: plan.amountCents,
      payer: plan.payer,
      owner: plan.owner,
      paymentMethodId: plan.paymentMethodId,
      idempotencyKey: plan.key,
      context: plan.context,
    },
    { scheduleId, schedulePeriod: plan.period },
  )
}

/**
 * A schedule waits for the PayPal token its first payment saved after the capture (vault APPROVED):
 * the order shows it once PayPal has finished, so it is read again rather than relying only on
 * VAULT.PAYMENT-TOKEN.CREATED, which may never reach the app and isn't documented to name the order.
 * A token found goes through the same mutation as that event, so the two arriving together save it
 * once. An order that can't be read, or isn't saved yet, leaves the schedule waiting: claim has
 * already set its next look, and fails it as METHOD_NOT_SAVED when the wait is over.
 */
async function checkPaypalVault(p: Payments, ctx: SchedulerCtx, orderId: string) {
  try {
    const order = await p.withPaypal(ctx, (call) => getOrderOrNull(call, orderId))
    const saved = order ? orderVault(order) : null
    if (!saved) return
    await ctx.runMutation(p.component.schedules.paypalTokenCreated, { app: p.app, orderId, paypal: paypalSavedArgs(saved), now: Date.now() })
  } catch (err) {
    console.warn(`payments: couldn’t read PayPal order ${orderId} for its saved method; trying again later: ${errorText(err)}`)
  }
}

/** The hourly run (worker().schedules): every due schedule of this app is charged, or one when given. */
export async function runSchedules(p: Payments, ctx: SchedulerCtx, o: { scheduleId?: string } = {}): Promise<{ charged: number; errors: number }> {
  const ids = o.scheduleId ? [o.scheduleId] : (await ctx.runQuery(p.component.schedules.due, { app: p.app, now: Date.now(), limit: 100 })).map((s) => s.id)
  const out = { charged: 0, errors: 0 }
  for (const id of ids) {
    try {
      if (await chargeDue(p, ctx, id)) out.charged++
    } catch (err) {
      out.errors++
      console.error(`payments: charging schedule ${id} failed: ${errorText(err)}`)
    }
  }
  return out
}

async function mine(p: Payments, ctx: RunQueryCtx, scheduleId: string) {
  const s = await ctx.runQuery(p.component.schedules.get, { id: scheduleId })
  if (!s || s.app !== p.app) throw new ConvexError('There is no such schedule.')
  return s
}

export async function updateSchedule(
  p: Payments,
  ctx: RunMutationCtx,
  a: { scheduleId: string; amountCents?: number; paymentMethodId?: string; stripeCustomerId?: string; anchorDay?: number; description?: string; by?: string },
): Promise<ScheduleView> {
  const s = await mine(p, ctx, a.scheduleId)
  const target = a.paymentMethodId ? await p.chargeTarget(ctx, { owner: s.owner, paymentMethodId: a.paymentMethodId, stripeCustomerId: a.stripeCustomerId }) : undefined
  return await ctx.runMutation(p.component.schedules.update, {
    id: s.id,
    app: p.app,
    amountCents: a.amountCents,
    paymentMethodId: a.paymentMethodId,
    processor: target?.processor,
    method: target?.method,
    anchorDay: a.anchorDay,
    description: a.description,
    by: a.by,
    now: Date.now(),
  })
}
