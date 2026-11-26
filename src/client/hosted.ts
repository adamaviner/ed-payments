// Hosted checkouts (Stripe Checkout and PayPal orders, on the processor's page or embedded in the
// app's): starting one, settling it from what the processor says (a webhook, the return page, the
// sweep), capturing an approved PayPal order, and the buyer closing one they won't pay. Payments
// (index.ts) is the facade; these take it as `p`.
import { ConvexError } from 'convex/values'
import {
  RECURRING_USAGE_PATTERN,
  orderMethod,
  approveUrl,
  captureFee,
  getOrderOrNull,
  moneyCents,
  orderCapture,
  orderCustomId,
  orderVault,
  orderVaultWaiting,
  paypal,
  type PaypalOrder,
} from '../core/paypal.js'
import { stripeMethodType } from '../core/savedMethods.js'
import { paymentIntentId, savedMethodKind, savedMethodLabel, sessionState, stripe, stripeFee, type StripeSession } from '../core/stripe.js'
import { ProcessorError, isMethodFor, parseTag, tagFor, type Method, type Payer, type Processor, type Ref } from '../core/types.js'
import type { Checkout, CheckoutStatus, EmbeddedPayment, OnPagePayment, Payments, RunActionCtx, StartArgs, StartedEmbedded, StartedOnPage, StartedRedirect } from './index.js'
import { REUSABLE_INTENT, closeAtProcessor, completeIntentReturn, settleIntent } from './saved.js'
import { anchorDayOf } from '../core/schedule.js'
import { PAYPAL_DECLINED, cleanPayer, errorText, sameValue, withParam } from './util.js'

const DEFAULT_EXPIRY_MS = 3 * 60 * 60_000

const FINAL: ReadonlySet<CheckoutStatus> = new Set(['paid', 'refund_needed', 'failed', 'abandoned'])

/** @internal Another press already replaced the checkout named in replaces: the one that did, to decide from again. */
export interface Replaced {
  replacedBy: string
}

/** How many checkouts a press follows through replacedBy (a press naming an old checkout after several changes) before giving up. */
export const MAX_REPLACED_HOPS = 4

/** @internal What a press says when it can't catch up with the presses after it. */
export const STALE_PRESS = 'This payment was changed in another tab or press. Please reload the page and try again.'

/** @internal start for a one-off: a checkout another press already replaced is followed to the one that replaced it. */
export async function start(p: Payments, ctx: RunActionCtx, a: StartArgs<unknown>): Promise<StartedRedirect | StartedEmbedded | StartedOnPage> {
  for (let hop = 0; hop < MAX_REPLACED_HOPS; hop++) {
    const r = await begin(p, ctx, a)
    if (!('replacedBy' in r)) return r
    a = { ...a, replaces: r.replacedBy }
  }
  throw new ConvexError(STALE_PRESS)
}

/**
 * @internal start, and for a schedule's first payment (startScheduleCheckout) the schedule it
 * starts and the payer's customer at the processor, so the method that pays is saved with it.
 */
export async function begin(
  p: Payments,
  ctx: RunActionCtx,
  a: StartArgs<unknown>,
  save?: { scheduleId: string; schedulePeriod: string; stripeCustomerId?: string; paypalCustomerId?: string },
): Promise<StartedRedirect | StartedEmbedded | StartedOnPage | Replaced> {
  if (!isMethodFor(a.processor, a.method)) throw new ConvexError(`${a.processor === 'stripe' ? 'Stripe' : 'PayPal'} doesn’t take ${a.method} payments here.`)
  if (!Number.isInteger(a.amountCents) || a.amountCents < 1) throw new ConvexError('A checkout needs an amount of at least one cent.')
  p.checkContext(a.context)
  if (a.processor === 'stripe') p.stripeKeys()
  else p.paypalKeys()
  // A schedule's first payment decides reuse before its schedule is made (startScheduleCheckout).
  if (a.replaces && !save) {
    const replaces = await ctx.runQuery(p.component.checkouts.latest, { id: a.replaces })
    a = { ...a, replaces }
    const reused = await reuseOrClose(p, ctx, replaces, { ...a, schedule: null })
    if (reused) return { checkoutId: reused.checkoutId, onPage: reused.onPage, reused: true }
  }
  const now = Date.now()
  const expiresAt = a.expiresAt ?? now + DEFAULT_EXPIRY_MS
  const returnUrl = p.url(a.returnPath)
  const cancelUrl = p.url(a.cancelPath)
  const row = {
    app: p.app,
    ref: a.ref,
    purpose: a.purpose,
    description: a.description,
    amountCents: a.amountCents,
    processor: a.processor,
    method: a.method,
    kind: a.ui === 'onPage' ? ('onPage' as const) : ('hosted' as const),
    payer: cleanPayer(a.payer),
    returnUrl,
    cancelUrl,
    expiresAt,
    context: a.context,
    callbacks: await p.handles(),
    limits: await p.limits(ctx, 'start', a.payer.email, 1, a.limitKey),
    ...(save ? { scheduleId: save.scheduleId, schedulePeriod: save.schedulePeriod, stripeCustomerId: save.stripeCustomerId } : {}),
    now,
  }
  const made = a.replaces
    ? await ctx.runMutation(p.component.checkouts.createReplacing, { ...row, replaces: a.replaces })
    : { id: await ctx.runMutation(p.component.checkouts.create, row), created: true }
  if (!made.created) return { replacedBy: made.id }
  const checkoutId = made.id
  try {
    const made = a.processor === 'stripe' ? await startStripe(p, checkoutId, a, returnUrl, cancelUrl, expiresAt, now, save) : await startPaypal(p, ctx, checkoutId, a, returnUrl, cancelUrl, save)
    await attachStarted(p, ctx, checkoutId, made.id)
    if (made.onPage) return { checkoutId, onPage: made.onPage, reused: false }
    return made.embedded ? { checkoutId, embedded: made.embedded } : { checkoutId, redirectUrl: made.url }
  } catch (err) {
    await ctx.runMutation(p.component.checkouts.failStart, { id: checkoutId, error: errorText(err), now: Date.now() })
    console.error(`payments: starting ${a.processor} checkout ${checkoutId} failed: ${errorText(err)}`)
    throw new ConvexError(`${a.processor === 'stripe' ? 'Stripe' : 'PayPal'} couldn’t start the payment just now. Please try again in a moment.`)
  }
}

async function startStripe(p: Payments, checkoutId: string, a: StartArgs<unknown>, returnUrl: string, cancelUrl: string, expiresAt: number, now: number, save?: { stripeCustomerId?: string }) {
  if (a.ui === 'onPage') {
    // Only the method the payer chose, so the checkout's method is what pays and a press on another tab starts afresh.
    const pi = await stripe.createPaymentIntent(
      p.stripeKeys(),
      {
        app: p.app,
        checkoutId,
        amountCents: a.amountCents,
        customer: save?.stripeCustomerId,
        description: a.description,
        offSession: false,
        types: [stripeMethodType(a.method === 'ach' ? 'ach' : 'card')],
        saveForLater: !!save?.stripeCustomerId,
      },
      { fetch: p.fetch, idempotencyKey: `checkout-${checkoutId}` },
    )
    if (!pi.client_secret) throw new Error('Stripe returned no client secret for the on-page payment.')
    return { id: pi.id, onPage: { processor: 'stripe', clientSecret: pi.client_secret, returnUrl } satisfies OnPagePayment }
  }
  const successUrl = withParam(returnUrl, 'session_id', '{CHECKOUT_SESSION_ID}')
  const embedded = a.ui === 'embedded'
  const s = await stripe.createSession(
    p.stripeKeys(),
    {
      app: p.app,
      checkoutId,
      description: a.description,
      amountCents: a.amountCents,
      method: a.method === 'ach' ? 'ach' : 'card',
      email: a.payer.email,
      successUrl,
      cancelUrl,
      expiresAt,
      now,
      embedded,
      ...(save?.stripeCustomerId ? { customer: save.stripeCustomerId, saveForLater: true } : {}),
    },
    { fetch: p.fetch },
  )
  if (embedded) {
    if (!s.client_secret) throw new Error('Stripe returned no client secret for the embedded checkout.')
    return { id: s.id, embedded: { processor: 'stripe', clientSecret: s.client_secret } satisfies EmbeddedPayment }
  }
  if (!s.url) throw new Error('Stripe returned no checkout address.')
  return { id: s.id, url: s.url }
}

/** The PayPal order for a checkout: on the app's page (embedded, onPage) or PayPal's, saving its method for a schedule. */
async function createPaypalOrder(
  p: Payments,
  ctx: RunActionCtx,
  o: { checkoutId: string; description: string; amountCents: number; method: Method; returnUrl: string; cancelUrl: string; onAppPage: boolean; requestId: string },
  save?: { paypalCustomerId?: string },
) {
  return await p.withPaypal(ctx, (call) =>
    paypal.createOrder(
      call,
      {
        customId: tagFor(p.app, o.checkoutId),
        description: o.description,
        amountCents: o.amountCents,
        returnUrl: o.returnUrl,
        cancelUrl: o.cancelUrl,
        brandName: p.options.brandName,
        embedded: o.onAppPage,
        ...(save ? { save: { kind: paypalKind(o.method), customerId: save.paypalCustomerId, description: o.description } } : {}),
      },
      o.requestId,
    ),
  )
}

const paypalKind = (method: Method) => (method === 'card' ? ('card' as const) : ('paypal' as const))

/** What PayPal's buttons or Card Fields need for an order. An order that saves its method names it, so only that kind of button can pay it. */
function paypalPayment(p: Payments, orderId: string, returnUrl: string, saves: { method: Method } | null) {
  const payment = { processor: 'paypal', orderId, clientId: p.paypalKeys().clientId, returnUrl: withParam(returnUrl, 'token', orderId) } satisfies EmbeddedPayment
  return saves ? { ...payment, only: paypalKind(saves.method) } : payment
}

async function startPaypal(p: Payments, ctx: RunActionCtx, checkoutId: string, a: StartArgs<unknown>, returnUrl: string, cancelUrl: string, save?: { paypalCustomerId?: string }) {
  const onAppPage = a.ui === 'embedded' || a.ui === 'onPage'
  const order = await createPaypalOrder(
    p,
    ctx,
    { checkoutId, description: a.description, amountCents: a.amountCents, method: a.method, returnUrl, cancelUrl, onAppPage, requestId: `checkout-${checkoutId}` },
    save,
  )
  const saves = save ? { method: a.method } : null
  if (a.ui === 'onPage') return { id: order.id, onPage: paypalPayment(p, order.id, returnUrl, saves) satisfies OnPagePayment }
  if (onAppPage) return { id: order.id, embedded: paypalPayment(p, order.id, returnUrl, saves) satisfies EmbeddedPayment }
  const url = approveUrl(order)
  if (!url) throw new Error('PayPal returned no approval address.')
  return { id: order.id, url }
}

/** A settlement passed on after what it closed in its chain is closed at the processor too. */
async function closedAtProcessor<R extends object>(p: Payments, ctx: RunActionCtx, res: R): Promise<R> {
  await closeAtProcessor(p, ctx, res)
  return res
}

/** @internal Records a paid Stripe session, then (best effort) the fee Stripe kept. */
export async function settleStripeSession(p: Payments, ctx: RunActionCtx, checkoutId: string, s: StripeSession) {
  const state = sessionState(s)
  const pi = paymentIntentId(s)
  if (pi && (state === 'paid' || state === 'processing')) await saveForSchedule(p, ctx, checkoutId, { stripePaymentIntent: pi })
  if (state === 'processing') return await closedAtProcessor(p, ctx, await ctx.runMutation(p.component.checkouts.markProcessing, { id: checkoutId, paymentRef: pi ?? undefined, now: Date.now() }))
  if (state !== 'paid') return null
  // Without an amount there is nothing safe to record; throwing makes the webhook answer 500 and Stripe retry.
  if (s.amount_total === null) throw new Error(`Stripe session ${s.id} is paid but has no amount.`)
  const fee = stripeFee(s)
  const res = await ctx.runMutation(p.component.checkouts.settlePaid, {
    id: checkoutId,
    paymentRef: pi ?? s.id,
    paidCents: s.amount_total,
    processorFeeCents: fee ?? undefined,
    processorCheckoutId: s.id,
    now: Date.now(),
  })
  await closeAtProcessor(p, ctx, res)
  if (fee === null && pi && res.outcome !== 'already_handled') {
    try {
      const full = await stripe.retrievePaymentIntent(p.stripeKeys(), pi, { fetch: p.fetch })
      const kept = stripeFee(full)
      if (kept !== null) await ctx.runMutation(p.component.checkouts.recordFee, { id: checkoutId, processorFeeCents: kept })
    } catch (err) {
      console.warn(`payments: couldn’t read Stripe’s fee for ${pi}: ${errorText(err)}`)
    }
  }
  return res
}

/**
 * How a PayPal order was paid, so the checkout records and reports the button the buyer pressed (PayPal's own, or a
 * card) rather than the method it was started for (a saved method's charge keeps its method). A webhook's capture carries no payment_source: the order is read
 * again then, unless the checkout is already settled. Unknown (undefined) keeps the checkout's method.
 */
async function paidWith(p: Payments, ctx: RunActionCtx, checkoutId: string, order: PaypalOrder): Promise<Method | undefined> {
  const c = await ctx.runQuery(p.component.checkouts.get, { id: checkoutId })
  // A saved method's charge is paid by that method, whatever the order shows.
  if (!c || c.kind === 'offSession') return undefined
  const said = orderMethod(order)
  if (said) return said
  const orderId = order.id || c.processorCheckoutId
  if (!orderId || (c.status !== 'created' && c.status !== 'pending' && c.status !== 'abandoned' && c.status !== 'failed')) return undefined
  const read = await p
    .withPaypal(ctx, (call) => getOrderOrNull(call, orderId))
    .catch((err: unknown) => {
      console.warn(`payments: couldn’t read PayPal order ${orderId} for how it was paid: ${errorText(err)}`)
      return null
    })
  return (read && orderMethod(read)) ?? undefined
}

/** @internal Settles from a PayPal order that has a capture (COMPLETED, PENDING or DECLINED). */
export async function settlePaypalOrder(p: Payments, ctx: RunActionCtx, checkoutId: string, order: PaypalOrder) {
  const capture = orderCapture(order)
  if (!capture) return null
  if (capture.status !== 'DECLINED' && capture.status !== 'FAILED') await saveForSchedule(p, ctx, checkoutId, { paypalOrder: order })
  if (capture.status === 'COMPLETED' || capture.status === 'PARTIALLY_REFUNDED' || capture.status === 'REFUNDED') {
    const method = await paidWith(p, ctx, checkoutId, order)
    const paidCents = moneyCents(capture.amount)
    if (paidCents === null) throw new Error(`PayPal capture ${capture.id} has no USD amount.`)
    return await closedAtProcessor(
      p,
      ctx,
      await ctx.runMutation(p.component.checkouts.settlePaid, {
        id: checkoutId,
        paymentRef: capture.id,
        paidCents,
        processorFeeCents: captureFee(capture) ?? undefined,
        processorCheckoutId: order.id || undefined,
        method,
        now: Date.now(),
      }),
    )
  }
  if (capture.status === 'PENDING') {
    const method = await paidWith(p, ctx, checkoutId, order)
    return await closedAtProcessor(p, ctx, await ctx.runMutation(p.component.checkouts.markProcessing, { id: checkoutId, paymentRef: capture.id, method, now: Date.now() }))
  }
  // A saved method's charge declined later (a pending capture, then PAYMENT.CAPTURE.DECLINED) marks the method too.
  const c = await ctx.runQuery(p.component.checkouts.get, { id: checkoutId })
  // On the app's page, in time, a declined capture of the checkout's own order goes on under a new order
  // (a webhook after a capture that never answered); one of an order it has moved on from changes nothing.
  if (c?.kind === 'onPage' && (c.status === 'pending' || c.status === 'created')) {
    if (order.id && c.processorCheckoutId && order.id !== c.processorCheckoutId) return null
    if (c.expiresAt > Date.now()) {
      await orderSpent(p, ctx, c)
      return null
    }
  }
  return await ctx.runMutation(p.component.checkouts.settleFailed, {
    id: checkoutId,
    reason: `PayPal ${capture.status.toLowerCase()} the payment.`,
    declined: c?.kind === 'offSession' || undefined,
    now: Date.now(),
  })
}

/** How soon after a first payment whose PayPal save isn't finished its order is read again. */
const FIRST_VAULT_CHECK_MS = 5 * 60_000

/** @internal A method an order saved (orderVault), as the component's schedule mutations take it. */
export function paypalSavedArgs(saved: NonNullable<ReturnType<typeof orderVault>>) {
  return {
    paypalCustomerId: saved.customerId,
    paymentTokenId: saved.paymentTokenId,
    kind: saved.kind,
    label: saved.label,
    usagePattern: saved.kind === 'paypal' ? RECURRING_USAGE_PATTERN : undefined,
    networkRef: saved.networkRef,
  }
}

/**
 * @internal Before a schedule's first payment is settled: the method it saved (Stripe's
 * setup_future_usage, PayPal's vault with purchase) becomes the schedule's, so settling starts it
 * with something to charge. A webhook's PayPal capture carries no payment_source, so the order is
 * read again. When PayPal says the save isn't finished (vault APPROVED, no token), the schedule is
 * marked as waiting for the token: VAULT.PAYMENT-TOKEN.CREATED, or the order read again by the
 * schedules worker (checkPaypalVault). Best effort: a schedule left without a method
 * fails its next charge, and the app's scheduleFailed asks the payer for another.
 */
export async function saveForSchedule(p: Payments, ctx: RunActionCtx, checkoutId: string, from: { stripePaymentIntent?: string; paypalOrder?: PaypalOrder }) {
  const c = await ctx.runQuery(p.component.checkouts.get, { id: checkoutId })
  if (!c?.scheduleId || (c.kind !== 'hosted' && c.kind !== 'onPage')) return
  const s = await ctx.runQuery(p.component.schedules.get, { id: c.scheduleId })
  // A cancelled one may be a schedule that never started, which this payment starts after all (the component decides).
  if (!s || (s.status !== 'starting' && s.status !== 'cancelled') || s.paymentMethodId) return
  try {
    if (c.processor === 'stripe' && from.stripePaymentIntent) {
      const pi = await stripe.paymentIntentWithMethod(p.stripeKeys(), from.stripePaymentIntent, { fetch: p.fetch })
      const pm = typeof pi.payment_method === 'object' ? pi.payment_method : null
      const kind = pm ? savedMethodKind(pm.type) : null
      const label = pm ? savedMethodLabel(pm) : null
      if (!pm || !kind || !label || !c.stripeCustomerId) throw new Error(`Stripe's PaymentIntent ${pi.id} has no saved card or bank account.`)
      await ctx.runMutation(p.component.schedules.attachMethod, {
        id: s.id,
        stripe: { stripeCustomerId: c.stripeCustomerId, stripePaymentMethodId: pm.id, kind, label },
        now: Date.now(),
      })
    } else if (c.processor === 'paypal' && from.paypalOrder) {
      const orderId = from.paypalOrder.id || c.processorCheckoutId
      const order = from.paypalOrder.payment_source || !orderId ? from.paypalOrder : await p.withPaypal(ctx, (call) => paypal.getOrder(call, orderId))
      const saved = orderVault(order)
      if (!saved) {
        const waiting = orderVaultWaiting(order)
        await ctx.runMutation(p.component.schedules.awaitPaypalVault, {
          id: s.id,
          orderId: order.id || orderId || '',
          paypalCustomerId: waiting.customerId,
          networkRef: waiting.networkRef,
          now: Date.now(),
        })
        // PayPal usually finishes saving within minutes: the order is read again then, rather than
        // at the next hourly run (claim's check_vault; the hourly run keeps checking after that).
        if (ctx.scheduler && p.wiring.worker.schedules) await ctx.scheduler.runAfter(FIRST_VAULT_CHECK_MS, p.wiring.worker.schedules, { scheduleId: s.id })
        return
      }
      await ctx.runMutation(p.component.schedules.attachMethod, { id: s.id, paypal: paypalSavedArgs(saved), now: Date.now() })
    }
  } catch (err) {
    console.warn(`payments: schedule ${s.id} starts without a saved method: ${errorText(err)}`)
  }
}

/**
 * @internal Captures an approved PayPal order and settles it. A second capture (a reloaded
 * return page, the webhook and the sweep racing) gets ORDER_ALREADY_CAPTURED from PayPal: the
 * order is then fetched and settled from what it says, instead of failing (fix b). A checkout
 * that is no longer waiting (abandoned, failed, settled) is never captured: with PayPal no money
 * moves until the capture, so taking it now would only mean refunding it.
 *
 * 'declined': PayPal refused the card or account the buyer chose (INSTRUMENT_DECLINED). The order
 * stays open, so on the app's page PayPal's buttons let the buyer choose another way to pay and
 * approve again; the decline is noted on the checkout. From then on only the buyer captures it
 * (`by: 'buyer'`: completeReturn, which the buttons and the return page call): the webhook and the
 * sweep leave it alone, and the sweep abandons it when it expires. Otherwise a card that went
 * through later (funds arrived, a fraud check cleared) would be charged after the buyer gave up or
 * paid another way. The buyer's captures each have their own request id (PayPal answers a repeated
 * id with its first answer, which would repeat the decline); the background's keep one per
 * checkout. An order can't be captured twice whatever the id.
 */
export async function capturePaypal(p: Payments, ctx: RunActionCtx, checkoutId: string, orderId: string, by: 'buyer' | 'background'): Promise<'declined' | 'reordered' | undefined> {
  const c = await ctx.runQuery(p.component.checkouts.get, { id: checkoutId })
  if (c?.status !== 'pending' && c?.status !== 'created') return undefined
  // An order an on-page checkout replaced (reorder) is never captured: only the checkout's own order pays it.
  if (c.processorCheckoutId && c.processorCheckoutId !== orderId) return undefined
  if (by === 'background' && c.paypalDeclinedAt !== null) return 'declined'
  // Taken before PayPal is asked, so the buyer's cancel can't close it while the money is being
  // taken; another capture under way (or a closed checkout) means there is nothing to do here.
  // The claim also checks the order is still the checkout's, as a re-order may have replaced it since the read above.
  if (!(await ctx.runMutation(p.component.checkouts.claimCapture, { id: checkoutId, orderId, now: Date.now() })).claimed) return undefined
  // Per order, as a re-ordered checkout's new order must not get the old one's answer replayed.
  const requestId = by === 'buyer' ? `capture-${orderId}-${Date.now().toString(36)}` : `capture-${orderId}`
  // A new order only for an on-page checkout still in time; an expired one is left for the sweep to close.
  const spent = c.kind === 'onPage' && c.expiresAt > Date.now() ? ('spent' as const) : ('declined' as const)
  const captured = await p.withPaypal(ctx, async (call) => {
    try {
      return await paypal.captureOrder(call, orderId, requestId)
    } catch (err) {
      if (err instanceof ProcessorError && err.code === 'ORDER_ALREADY_CAPTURED') return await paypal.getOrder(call, orderId)
      if (err instanceof ProcessorError && err.code === 'ORDER_NOT_APPROVED') return null
      if (err instanceof ProcessorError && err.code === 'INSTRUMENT_DECLINED') return 'declined' as const
      // Completed or voided: completed means paid after all; voided can't be paid again.
      if (err instanceof ProcessorError && err.code === 'ORDER_COMPLETED_OR_VOIDED') {
        const now = await paypal.getOrder(call, orderId)
        if (now.status === 'COMPLETED') return now
      } else if (!(err instanceof ProcessorError && err.code && ORDER_SPENT.has(err.code))) throw err
      return spent
    }
  })
  // A card declined by Card Fields' capture comes back 201 with the order COMPLETED and its capture
  // DECLINED, and PayPal then takes no other card on that order (order-card-capture-declined.json); a
  // capture refused as already made, with nothing paid, is the same order. On the app's page the
  // payment goes on under a new order, as for a spent one.
  const order = c.kind === 'onPage' && captured && typeof captured === 'object' && !orderPaid(captured) ? spent : captured
  if (order === 'spent') return await orderSpent(p, ctx, c)
  // No money moved: the claim goes. A capture that threw keeps it, as its outcome is unknown; once
  // stale, cancel asks PayPal before closing the checkout.
  if (order === 'declined' || !order) await ctx.runMutation(p.component.checkouts.releaseCapture, { id: checkoutId })
  if (order === 'declined') {
    await ctx.runMutation(p.component.checkouts.noteError, { id: checkoutId, error: PAYPAL_DECLINED, paypalDeclinedAt: Date.now() })
    return order
  }
  if (order) await settlePaypalOrder(p, ctx, checkoutId, order)
  return undefined
}

/**
 * An on-page checkout's PayPal order took no money and won't take another card (spent, or a declined
 * capture): no money moved, so the claim goes, and the payer's next press pays a new order under the
 * same checkout (no start counted).
 */
async function orderSpent(p: Payments, ctx: RunActionCtx, c: Checkout): Promise<'reordered' | 'declined'> {
  await ctx.runMutation(p.component.checkouts.releaseCapture, { id: c.id })
  const fresh = await reorder(p, ctx, c).catch((err: unknown) => {
    console.error(`payments: a new PayPal order for checkout ${c.id} failed: ${errorText(err)}`)
    return null
  })
  await ctx.runMutation(p.component.checkouts.noteError, { id: c.id, error: PAYPAL_DECLINED })
  return fresh ? 'reordered' : 'declined'
}

/**
 * For the page the buyer comes back to (`token`: Stripe's session_id or payment_intent, or PayPal's
 * token). Returns the outcome at once if the checkout is already settled; otherwise asks the
 * processor and settles (capturing an approved PayPal order), so the page doesn't wait for a
 * webhook. Null: not ours. publicApi().completeReturn wraps this with a rate limit. PayPal's
 * buttons call it when the buyer approves; `declined` then means PayPal refused what the buyer
 * chose and the buttons should let them choose again (the checkout is still pending). `reordered`
 * (on-page only): PayPal won't take that order again, so the checkout has a new one; start again with
 * replaces to get it.
 */
export async function completeReturn(
  p: Payments,
  ctx: RunActionCtx,
  { processor, token }: { processor: Processor; token: string },
): Promise<{ checkoutId: string; ref: Ref; purpose: string; status: CheckoutStatus; declined?: true; reordered?: true } | null> {
  if (!token || token.length > 255) return null
  const found = await ctx.runQuery(p.component.checkouts.byProcessorId, { processorCheckoutId: token })
  if (!found && processor === 'paypal') return await reorderedReturn(p, ctx, token)
  if (!found || found.processor !== processor || found.app !== p.app) return null
  let outcome: 'declined' | 'reordered' | undefined
  if (!FINAL.has(found.status) || found.status === 'abandoned') {
    if (found.kind !== 'hosted' && found.processor === 'stripe') await completeIntentReturn(p, ctx, found)
    else if (processor === 'paypal') {
      const order = await p.withPaypal(ctx, (call) => paypal.getOrder(call, token))
      if (order.status === 'APPROVED') outcome = await capturePaypal(p, ctx, found.id, token, 'buyer')
      else if (order.status === 'COMPLETED') await settlePaypalOrder(p, ctx, found.id, order)
    } else {
      await settleStripeSession(p, ctx, found.id, await stripe.retrieveSession(p.stripeKeys(), token, { fetch: p.fetch }))
    }
  }
  const now = await ctx.runQuery(p.component.checkouts.get, { id: found.id })
  return {
    checkoutId: found.id,
    ref: found.ref,
    purpose: found.purpose,
    status: now?.status ?? found.status,
    ...(outcome === 'declined' ? { declined: true as const } : outcome === 'reordered' ? { declined: true as const, reordered: true as const } : {}),
  }
}

/**
 * A PayPal order no checkout has any more: when it is one an open on-page checkout of this app moved
 * on from (re-ordered by the webhook or the sweep before the buyer came back), the buyer hears
 * declined + reordered, so the next press gets the new order.
 */
async function reorderedReturn(p: Payments, ctx: RunActionCtx, token: string) {
  const order = await p.withPaypal(ctx, (call) => getOrderOrNull(call, token))
  const tag = parseTag(order ? orderCustomId(order) : null)
  if (!tag || tag.app !== p.app) return null
  const c = await ctx.runQuery(p.component.checkouts.get, { id: tag.id })
  if (!c || c.app !== p.app || c.kind !== 'onPage' || c.processor !== 'paypal' || c.processorCheckoutId === token || (c.status !== 'pending' && c.status !== 'created')) return null
  return { checkoutId: c.id, ref: c.ref, purpose: c.purpose, status: c.status, declined: true as const, reordered: true as const }
}

/**
 * Closes a checkout the buyer started and won't pay, e.g. they pressed Edit on the app's page: the
 * Stripe session is expired at Stripe, a PayPal order is left to lapse (none of its money moves
 * until the library captures, which it won't for an abandoned checkout), and the checkout is
 * abandoned now instead of when it expires. The start it counted against the buyer's own rate limit
 * is given back (pass the `limitKey` start was given, if any). If it was paid meanwhile, it is
 * settled as paid instead. Returns how it stands; null: not this app's checkout.
 *
 * Only for a checkout id the buyer was given by start (the id is the buyer's secret; anyone holding
 * it can close the unpaid checkout, nothing more). publicApi().cancelCheckout wraps p.
 */
export async function cancel(p: Payments, ctx: RunActionCtx, checkoutId: string, o: { limitKey?: string; replaced?: boolean } = {}): Promise<{ status: CheckoutStatus } | null> {
  const c = await ctx.runQuery(p.component.checkouts.get, { id: checkoutId })
  if (!c || c.app !== p.app || (c.kind !== 'hosted' && c.kind !== 'onPage')) return null
  if (c.status !== 'created' && c.status !== 'pending') return { status: c.status }
  if (c.kind === 'onPage' && c.processor === 'stripe' && c.processorCheckoutId) {
    const keys = p.stripeKeys()
    try {
      await stripe.cancelPaymentIntent(keys, c.processorCheckoutId, { fetch: p.fetch })
    } catch (err) {
      // Not cancelable any more: paid (or on its way) in the meantime, or already canceled.
      if (!(err instanceof ProcessorError && err.status === 400)) throw err
      if (await settleIntent(p, ctx, c, await stripe.paymentIntent(keys, c.processorCheckoutId, { fetch: p.fetch })))
        return { status: (await ctx.runQuery(p.component.checkouts.get, { id: c.id }))?.status ?? c.status }
    }
  } else if (c.processor === 'stripe' && c.processorCheckoutId) {
    const keys = p.stripeKeys()
    try {
      await stripe.expireSession(keys, c.processorCheckoutId, { fetch: p.fetch })
    } catch (err) {
      // Not open any more: paid (or on its way) in the meantime, or already expired.
      if (!(err instanceof ProcessorError && err.status === 400)) throw err
      const s = await stripe.retrieveSession(keys, c.processorCheckoutId, { fetch: p.fetch })
      const state = sessionState(s)
      if (state === 'paid' || state === 'processing') {
        await settleStripeSession(p, ctx, c.id, s)
        return { status: (await ctx.runQuery(p.component.checkouts.get, { id: c.id }))?.status ?? c.status }
      }
    }
  }
  const limits = await p.limits(ctx, 'start', c.payer.email, 1, o.limitKey)
  const own = limits?.find((l) => !l.key.endsWith(':all'))
  const close = (checked: boolean) =>
    ctx.runMutation(p.component.checkouts.cancel, {
      id: c.id,
      giveBack: own && { key: own.key, windowMs: own.windowMs },
      checked: checked || undefined,
      replaced: o.replaced || undefined,
      now: Date.now(),
    })
  let r = await close(false)
  if (r.outcome === 'check_processor' && c.processorCheckoutId) {
    // A capture claimed it and never finished: PayPal says whether the money was taken.
    const orderId = c.processorCheckoutId
    const order = await p.withPaypal(ctx, (call) => getOrderOrNull(call, orderId))
    if (order && orderPaid(order)) {
      await settlePaypalOrder(p, ctx, c.id, order)
      return { status: (await ctx.runQuery(p.component.checkouts.get, { id: c.id }))?.status ?? c.status }
    }
    r = await close(true)
  }
  if (r.outcome === 'being_paid') throw new ConvexError('This payment is being paid right now, so it can’t be cancelled. Check again in a moment.')
  if (r.outcome === 'check_processor') r = await close(true)
  return { status: r.outcome === 'already_handled' ? r.status : 'abandoned' }
}

const PAID_OR_PENDING: ReadonlySet<string> = new Set(['COMPLETED', 'PENDING', 'PARTIALLY_REFUNDED', 'REFUNDED'])

/** Whether an order's capture took money (or is taking it); a declined or failed capture, or none, did not. */
const orderPaid = (order: PaypalOrder) => PAID_OR_PENDING.has(orderCapture(order)?.status ?? '')

/** PayPal's issues when an order can't be paid again (too many tries on it, or it ran out); a new order can be. */
const ORDER_SPENT: ReadonlySet<string> = new Set(['MAX_NUMBER_OF_PAYMENT_ATTEMPTS_EXCEEDED', 'ORDER_EXPIRED'])

/** A new PayPal order for an on-page checkout, under the same checkout: no new start is counted. Returns its id, or null when the checkout has moved on. */
async function reorder(p: Payments, ctx: RunActionCtx, c: Checkout): Promise<string | null> {
  const paypalCustomerId = await schedulePaypalCustomer(p, ctx, c)
  const order = await createPaypalOrder(
    p,
    ctx,
    {
      checkoutId: c.id,
      description: c.description,
      amountCents: c.amountCents,
      method: c.method,
      returnUrl: c.returnUrl,
      cancelUrl: c.cancelUrl,
      onAppPage: true,
      requestId: `checkout-${c.id}-${Date.now().toString(36)}`,
    },
    c.scheduleId ? { paypalCustomerId } : undefined,
  )
  const r = await ctx.runMutation(p.component.checkouts.reorder, { id: c.id, processorCheckoutId: order.id, now: Date.now() })
  return r.outcome === 'reordered' ? order.id : null
}

const paidSentence = (status: CheckoutStatus) =>
  status === 'paid' || status === 'refund_needed' ? 'This is already paid.' : status === 'processing' ? 'A payment for this is already on its way.' : null

/**
 * @internal The payer pressed again (start or startScheduleCheckout with replaces). Counted against
 * the replace limit first, so the processors aren't asked for nothing. The last press's checkout is
 * reused while it is this app's on-page checkout for the same thing, still open and in time, with the
 * same amount, processor, method, payer, description, context and return page, and the same schedule
 * (a starting schedule of the same owner, anchor day and context) or none: its client secret or order
 * goes back and no start is counted. A PayPal order PayPal has closed is replaced by a new one under
 * the same checkout. Anything else open for the same thing is closed (cancel: its start given back, a
 * starting schedule ended as never started) and null returned, for a fresh start; one for another
 * thing is left alone. A payment for the same thing that is paid or on its way is refused.
 */
export async function reuseOrClose(
  p: Payments,
  ctx: RunActionCtx,
  replaces: string,
  want: {
    ref: Ref
    purpose: string
    description: string
    amountCents: number
    processor: Processor
    method: Method
    payer: Payer
    context: unknown
    returnPath: string
    ui?: StartArgs<unknown>['ui']
    limitKey?: string
    schedule: { owner: Ref; anchorDay?: number } | null
  },
): Promise<{ checkoutId: string; onPage: OnPagePayment; scheduleId: string | null } | null> {
  if (replaces.length > 255) return null
  const c = await ctx.runQuery(p.component.checkouts.get, { id: replaces })
  if (!c || c.app !== p.app || (c.kind !== 'hosted' && c.kind !== 'onPage')) return null
  if (c.ref.type !== want.ref.type || c.ref.id !== want.ref.id || c.purpose !== want.purpose) return null
  // Keyed by the checkout replaced (unless the app gives a key or the payer is signed in), so presses naming another payer's email can't use up theirs.
  await p.takeLimits(ctx, 'replace', `checkout:${c.id}`, 2, want.limitKey)
  try {
    return await reuseOrCloseChecked(p, ctx, c, want)
  } catch (err) {
    if (err instanceof ConvexError) throw err
    console.error(`payments: replacing checkout ${replaces} failed: ${errorText(err)}`)
    throw new ConvexError(`${want.processor === 'stripe' ? 'Stripe' : 'PayPal'} couldn’t start the payment just now. Please try again in a moment.`)
  }
}

async function reuseOrCloseChecked(p: Payments, ctx: RunActionCtx, c: Checkout, want: Parameters<typeof reuseOrClose>[3]) {
  const refuse = (status: CheckoutStatus) => {
    const sentence = paidSentence(status)
    if (sentence) throw new ConvexError(sentence)
  }
  refuse(c.status)
  // Another payment of the attempt came first (closing this one): the next press is told so, not given a payment to be owed back.
  const chain = await ctx.runQuery(p.component.checkouts.chainPaid, { id: c.id })
  if (chain) refuse(chain)
  if (c.status !== 'created' && c.status !== 'pending') return null
  const schedule = c.scheduleId ? await ctx.runQuery(p.component.schedules.get, { id: c.scheduleId }) : null
  const sameSchedule = want.schedule
    ? schedule?.status === 'starting' &&
      schedule.owner.type === want.schedule.owner.type &&
      schedule.owner.id === want.schedule.owner.id &&
      schedule.anchorDay === (want.schedule.anchorDay ?? anchorDayOf(Date.now())) &&
      sameValue(schedule.context, want.context ?? null)
    : !c.scheduleId
  const payer = cleanPayer(want.payer)
  const same =
    sameSchedule &&
    want.ui === 'onPage' &&
    c.kind === 'onPage' &&
    c.processor === want.processor &&
    c.method === want.method &&
    c.amountCents === want.amountCents &&
    c.description === want.description &&
    c.payer.email === payer.email &&
    c.payer.name === payer.name &&
    c.returnUrl === p.url(want.returnPath) &&
    sameValue(c.context, want.context ?? null) &&
    c.expiresAt > Date.now() + REUSE_MARGIN_MS
  if (same) {
    const onPage = await reopen(p, ctx, c)
    if (onPage) return { checkoutId: c.id, onPage, scheduleId: c.scheduleId }
    const now = await ctx.runQuery(p.component.checkouts.get, { id: c.id })
    if (now) refuse(now.status)
  }
  // Another press is still starting it: closing it now would hand that press a closed checkout.
  if (c.status === 'created' && !c.processorCheckoutId && c.createdAt > Date.now() - STARTING_MS) throw new ConvexError(STILL_STARTING)
  const closed = await cancel(p, ctx, c.id, { limitKey: want.limitKey, replaced: true })
  if (closed) refuse(closed.status)
  return null
}

const STILL_STARTING = 'This payment is still starting. Please try again in a moment.'

/** How long a checkout with nothing at the processor yet counts as being started by another press, rather than left behind by one that died. */
const STARTING_MS = 60_000

/** A reused checkout must have this long left, so the payer isn't handed one the sweep is about to close. */
const REUSE_MARGIN_MS = 10 * 60_000

/**
 * An on-page checkout another press made and is still starting (two presses at once): its
 * PaymentIntent or order is asked for again under the same idempotency key, so the processor answers
 * with the same one (or refuses while the first request is under way, and the payer presses again).
 */
/** Records the processor's object on a checkout; throws when the checkout was closed meanwhile (another press replaced it), so no one is handed a payment for a closed checkout. */
async function attachStarted(p: Payments, ctx: RunActionCtx, checkoutId: string, processorCheckoutId: string) {
  const r = await ctx.runMutation(p.component.checkouts.attach, { id: checkoutId, processorCheckoutId })
  if (r.outcome === 'already_handled' && (r.status === 'abandoned' || r.status === 'failed')) throw new Error(`Checkout ${checkoutId} was closed while it started.`)
}

async function resume(p: Payments, ctx: RunActionCtx, c: Checkout): Promise<OnPagePayment> {
  const a = { ...c, payer: c.payer, returnPath: '', cancelPath: '', ui: 'onPage' as const }
  const made = await (
    c.processor === 'stripe'
      ? startStripe(p, c.id, a, c.returnUrl, c.cancelUrl, c.expiresAt, Date.now(), { stripeCustomerId: c.stripeCustomerId ?? undefined })
      : schedulePaypalCustomer(p, ctx, c).then((paypalCustomerId) => startPaypal(p, ctx, c.id, a, c.returnUrl, c.cancelUrl, c.scheduleId ? { paypalCustomerId } : undefined))
  ).catch((err: unknown) => {
    // Stripe refuses a key whose first request is still under way (409).
    if (err instanceof ProcessorError && err.status === 409) throw new ConvexError(STILL_STARTING)
    throw err
  })
  if (!made.onPage) throw new Error(`Checkout ${c.id} started without an on-page payment.`)
  await attachStarted(p, ctx, c.id, made.id)
  return made.onPage
}

/** The PayPal customer a schedule's owner has, so a schedule's order saves its method under it. */
async function schedulePaypalCustomer(p: Payments, ctx: RunActionCtx, c: Checkout) {
  const owner = c.scheduleId ? (await ctx.runQuery(p.component.schedules.get, { id: c.scheduleId }))?.owner : undefined
  return owner ? ((await ctx.runQuery(p.component.customers.paypalCustomer, { app: p.app, owner })) ?? undefined) : undefined
}

/** What the browser needs to pay an open on-page checkout again, or null when it can't be (canceled at Stripe; settled here if it was paid meanwhile). */
async function reopen(p: Payments, ctx: RunActionCtx, c: Checkout): Promise<OnPagePayment | null> {
  const id = c.processorCheckoutId
  if (!id) return c.status === 'created' && c.kind === 'onPage' ? await resume(p, ctx, c) : null
  if (c.processor === 'stripe') {
    const pi = await stripe.paymentIntent(p.stripeKeys(), id, { fetch: p.fetch })
    if (await settleIntent(p, ctx, c, pi)) return null
    return REUSABLE_INTENT.has(pi.status) && pi.client_secret ? { processor: 'stripe', clientSecret: pi.client_secret, returnUrl: c.returnUrl } : null
  }
  const order = await p.withPaypal(ctx, (call) => getOrderOrNull(call, id))
  if (order && orderPaid(order)) {
    await settlePaypalOrder(p, ctx, c.id, order)
    return null
  }
  const saves = c.scheduleId ? { method: c.method } : null
  // An order with a declined capture takes no other card, though PayPal reads it back as CREATED.
  if (order && order.status !== 'VOIDED' && order.status !== 'COMPLETED' && !orderCapture(order)) return paypalPayment(p, id, c.returnUrl, saves)
  const fresh = await reorder(p, ctx, c)
  return fresh ? paypalPayment(p, fresh, c.returnUrl, saves) : null
}
