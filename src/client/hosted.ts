// Hosted checkouts (Stripe Checkout and PayPal orders, on the processor's page or embedded in the
// app's): starting one, settling it from what the processor says (a webhook, the return page, the
// sweep), capturing an approved PayPal order, and the buyer closing one they won't pay. Payments
// (index.ts) is the facade; these take it as `p`.
import { ConvexError } from 'convex/values'
import { RECURRING_USAGE_PATTERN, approveUrl, captureFee, getOrderOrNull, moneyCents, orderCapture, orderVault, orderVaultWaiting, paypal, type PaypalOrder } from '../core/paypal.js'
import { paymentIntentId, savedMethodKind, savedMethodLabel, sessionState, stripe, stripeFee, type StripeSession } from '../core/stripe.js'
import { ProcessorError, isMethodFor, tagFor, type Processor, type Ref } from '../core/types.js'
import type { CheckoutStatus, EmbeddedPayment, Payments, RunActionCtx, StartArgs, StartedEmbedded, StartedRedirect } from './index.js'
import { completeIntentReturn } from './saved.js'
import { PAYPAL_DECLINED, cleanPayer, errorText, withParam } from './util.js'

const DEFAULT_EXPIRY_MS = 3 * 60 * 60_000

const FINAL: ReadonlySet<CheckoutStatus> = new Set(['paid', 'refund_needed', 'failed', 'abandoned'])

/**
 * @internal start, and for a schedule's first payment (startScheduleCheckout) the schedule it
 * starts and the payer's customer at the processor, so the method that pays is saved with it.
 */
export async function begin(
  p: Payments,
  ctx: RunActionCtx,
  a: StartArgs<unknown>,
  save?: { scheduleId: string; schedulePeriod: string; stripeCustomerId?: string; paypalCustomerId?: string },
): Promise<StartedRedirect | StartedEmbedded> {
  if (!isMethodFor(a.processor, a.method)) throw new ConvexError(`${a.processor === 'stripe' ? 'Stripe' : 'PayPal'} doesn’t take ${a.method} payments here.`)
  if (!Number.isInteger(a.amountCents) || a.amountCents < 1) throw new ConvexError('A checkout needs an amount of at least one cent.')
  p.checkContext(a.context)
  if (a.processor === 'stripe') p.stripeKeys()
  else p.paypalKeys()
  const now = Date.now()
  const expiresAt = a.expiresAt ?? now + DEFAULT_EXPIRY_MS
  const returnUrl = p.url(a.returnPath)
  const cancelUrl = p.url(a.cancelPath)
  const checkoutId = await ctx.runMutation(p.component.checkouts.create, {
    app: p.app,
    ref: a.ref,
    purpose: a.purpose,
    description: a.description,
    amountCents: a.amountCents,
    processor: a.processor,
    method: a.method,
    kind: 'hosted',
    payer: cleanPayer(a.payer),
    returnUrl,
    cancelUrl,
    expiresAt,
    context: a.context,
    callbacks: await p.handles(),
    limits: await p.limits(ctx, 'start', a.payer.email, 1, a.limitKey),
    ...(save ? { scheduleId: save.scheduleId, schedulePeriod: save.schedulePeriod, stripeCustomerId: save.stripeCustomerId } : {}),
    now,
  })
  try {
    const made = a.processor === 'stripe' ? await startStripe(p, checkoutId, a, returnUrl, cancelUrl, expiresAt, now, save) : await startPaypal(p, ctx, checkoutId, a, returnUrl, cancelUrl, save)
    await ctx.runMutation(p.component.checkouts.attach, { id: checkoutId, processorCheckoutId: made.id })
    return made.embedded ? { checkoutId, embedded: made.embedded } : { checkoutId, redirectUrl: made.url }
  } catch (err) {
    await ctx.runMutation(p.component.checkouts.failStart, { id: checkoutId, error: errorText(err), now: Date.now() })
    console.error(`payments: starting ${a.processor} checkout ${checkoutId} failed: ${errorText(err)}`)
    throw new ConvexError(`${a.processor === 'stripe' ? 'Stripe' : 'PayPal'} couldn’t start the payment just now. Please try again in a moment.`)
  }
}

async function startStripe(p: Payments, checkoutId: string, a: StartArgs<unknown>, returnUrl: string, cancelUrl: string, expiresAt: number, now: number, save?: { stripeCustomerId?: string }) {
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

async function startPaypal(p: Payments, ctx: RunActionCtx, checkoutId: string, a: StartArgs<unknown>, returnUrl: string, cancelUrl: string, save?: { paypalCustomerId?: string }) {
  const embedded = a.ui === 'embedded'
  const kind = a.method === 'card' ? ('card' as const) : ('paypal' as const)
  const order = await p.withPaypal(ctx, (call) =>
    paypal.createOrder(
      call,
      {
        customId: tagFor(p.app, checkoutId),
        description: a.description,
        amountCents: a.amountCents,
        returnUrl,
        cancelUrl,
        brandName: p.options.brandName,
        embedded,
        ...(save ? { save: { kind, customerId: save.paypalCustomerId, description: a.description } } : {}),
      },
      `checkout-${checkoutId}`,
    ),
  )
  if (embedded) {
    const payment = { processor: 'paypal', orderId: order.id, clientId: p.paypalKeys().clientId, returnUrl: withParam(returnUrl, 'token', order.id) } satisfies EmbeddedPayment
    // An order that saves its method names it, so only that kind of button can pay it.
    return { id: order.id, embedded: save ? { ...payment, only: kind } : payment }
  }
  const url = approveUrl(order)
  if (!url) throw new Error('PayPal returned no approval address.')
  return { id: order.id, url }
}

/** @internal Records a paid Stripe session, then (best effort) the fee Stripe kept. */
export async function settleStripeSession(p: Payments, ctx: RunActionCtx, checkoutId: string, s: StripeSession) {
  const state = sessionState(s)
  const pi = paymentIntentId(s)
  if (pi && (state === 'paid' || state === 'processing')) await saveForSchedule(p, ctx, checkoutId, { stripePaymentIntent: pi })
  if (state === 'processing') return await ctx.runMutation(p.component.checkouts.markProcessing, { id: checkoutId, paymentRef: pi ?? undefined, now: Date.now() })
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

/** @internal Settles from a PayPal order that has a capture (COMPLETED, PENDING or DECLINED). */
export async function settlePaypalOrder(p: Payments, ctx: RunActionCtx, checkoutId: string, order: PaypalOrder) {
  const capture = orderCapture(order)
  if (!capture) return null
  if (capture.status !== 'DECLINED' && capture.status !== 'FAILED') await saveForSchedule(p, ctx, checkoutId, { paypalOrder: order })
  if (capture.status === 'COMPLETED' || capture.status === 'PARTIALLY_REFUNDED' || capture.status === 'REFUNDED') {
    const paidCents = moneyCents(capture.amount)
    if (paidCents === null) throw new Error(`PayPal capture ${capture.id} has no USD amount.`)
    return await ctx.runMutation(p.component.checkouts.settlePaid, {
      id: checkoutId,
      paymentRef: capture.id,
      paidCents,
      processorFeeCents: captureFee(capture) ?? undefined,
      processorCheckoutId: order.id || undefined,
      now: Date.now(),
    })
  }
  if (capture.status === 'PENDING') return await ctx.runMutation(p.component.checkouts.markProcessing, { id: checkoutId, paymentRef: capture.id, now: Date.now() })
  // A saved method's charge declined later (a pending capture, then PAYMENT.CAPTURE.DECLINED) marks the method too.
  const c = await ctx.runQuery(p.component.checkouts.get, { id: checkoutId })
  return await ctx.runMutation(p.component.checkouts.settleFailed, {
    id: checkoutId,
    reason: `PayPal ${capture.status.toLowerCase()} the payment.`,
    declined: c?.kind === 'offSession' || undefined,
    now: Date.now(),
  })
}

/**
 * @internal Before a schedule's first payment is settled: the method it saved (Stripe's
 * setup_future_usage, PayPal's vault with purchase) becomes the schedule's, so settling starts it
 * with something to charge. A webhook's PayPal capture carries no payment_source, so the order is
 * read again. When PayPal says the save isn't finished (vault APPROVED, no token), the schedule is
 * marked as waiting for VAULT.PAYMENT-TOKEN.CREATED. Best effort: a schedule left without a method
 * fails its next charge, and the app's scheduleFailed asks the payer for another.
 */
export async function saveForSchedule(p: Payments, ctx: RunActionCtx, checkoutId: string, from: { stripePaymentIntent?: string; paypalOrder?: PaypalOrder }) {
  const c = await ctx.runQuery(p.component.checkouts.get, { id: checkoutId })
  if (!c?.scheduleId || c.kind !== 'hosted') return
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
        return
      }
      await ctx.runMutation(p.component.schedules.attachMethod, {
        id: s.id,
        paypal: {
          paypalCustomerId: saved.customerId,
          paymentTokenId: saved.paymentTokenId,
          kind: saved.kind,
          label: saved.label,
          usagePattern: saved.kind === 'paypal' ? RECURRING_USAGE_PATTERN : undefined,
          networkRef: saved.networkRef,
        },
        now: Date.now(),
      })
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
export async function capturePaypal(p: Payments, ctx: RunActionCtx, checkoutId: string, orderId: string, by: 'buyer' | 'background'): Promise<'declined' | undefined> {
  const c = await ctx.runQuery(p.component.checkouts.get, { id: checkoutId })
  if (c?.status !== 'pending' && c?.status !== 'created') return undefined
  if (by === 'background' && c.paypalDeclinedAt !== null) return 'declined'
  // Taken before PayPal is asked, so the buyer's cancel can't close it while the money is being
  // taken; another capture under way (or a closed checkout) means there is nothing to do here.
  if (!(await ctx.runMutation(p.component.checkouts.claimCapture, { id: checkoutId, now: Date.now() })).claimed) return undefined
  const requestId = by === 'buyer' ? `capture-${checkoutId}-${Date.now().toString(36)}` : `capture-${checkoutId}`
  const order = await p.withPaypal(ctx, async (call) => {
    try {
      return await paypal.captureOrder(call, orderId, requestId)
    } catch (err) {
      if (err instanceof ProcessorError && err.code === 'ORDER_ALREADY_CAPTURED') return await paypal.getOrder(call, orderId)
      if (err instanceof ProcessorError && err.code === 'ORDER_NOT_APPROVED') return null
      if (err instanceof ProcessorError && err.code === 'INSTRUMENT_DECLINED') return 'declined' as const
      throw err
    }
  })
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
 * For the page the buyer comes back to (`token`: Stripe's session_id or payment_intent, or PayPal's
 * token). Returns the outcome at once if the checkout is already settled; otherwise asks the
 * processor and settles (capturing an approved PayPal order), so the page doesn't wait for a
 * webhook. Null: not ours. publicApi().completeReturn wraps this with a rate limit. PayPal's
 * buttons call it when the buyer approves; `declined` then means PayPal refused what the buyer
 * chose and the buttons should let them choose again (the checkout is still pending).
 */
export async function completeReturn(
  p: Payments,
  ctx: RunActionCtx,
  { processor, token }: { processor: Processor; token: string },
): Promise<{ checkoutId: string; ref: Ref; purpose: string; status: CheckoutStatus; declined?: true } | null> {
  if (!token || token.length > 255) return null
  const found = await ctx.runQuery(p.component.checkouts.byProcessorId, { processorCheckoutId: token })
  if (!found || found.processor !== processor || found.app !== p.app) return null
  let declined = false
  if (!FINAL.has(found.status) || found.status === 'abandoned') {
    if (found.kind !== 'hosted' && found.processor === 'stripe') await completeIntentReturn(p, ctx, found)
    else if (processor === 'paypal') {
      const order = await p.withPaypal(ctx, (call) => paypal.getOrder(call, token))
      if (order.status === 'APPROVED') declined = (await capturePaypal(p, ctx, found.id, token, 'buyer')) === 'declined'
      else if (order.status === 'COMPLETED') await settlePaypalOrder(p, ctx, found.id, order)
    } else {
      await settleStripeSession(p, ctx, found.id, await stripe.retrieveSession(p.stripeKeys(), token, { fetch: p.fetch }))
    }
  }
  const now = await ctx.runQuery(p.component.checkouts.get, { id: found.id })
  return { checkoutId: found.id, ref: found.ref, purpose: found.purpose, status: now?.status ?? found.status, ...(declined ? { declined: true as const } : {}) }
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
export async function cancel(p: Payments, ctx: RunActionCtx, checkoutId: string, o: { limitKey?: string } = {}): Promise<{ status: CheckoutStatus } | null> {
  const c = await ctx.runQuery(p.component.checkouts.get, { id: checkoutId })
  if (!c || c.app !== p.app || c.kind !== 'hosted') return null
  if (c.status !== 'created' && c.status !== 'pending') return { status: c.status }
  if (c.processor === 'stripe' && c.processorCheckoutId) {
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
    ctx.runMutation(p.component.checkouts.cancel, { id: c.id, giveBack: own && { key: own.key, windowMs: own.windowMs }, checked: checked || undefined, now: Date.now() })
  let r = await close(false)
  if (r.outcome === 'check_processor' && c.processorCheckoutId) {
    // A capture claimed it and never finished: PayPal says whether the money was taken.
    const orderId = c.processorCheckoutId
    const order = await p.withPaypal(ctx, (call) => getOrderOrNull(call, orderId))
    if (order?.status === 'COMPLETED') {
      await settlePaypalOrder(p, ctx, c.id, order)
      return { status: (await ctx.runQuery(p.component.checkouts.get, { id: c.id }))?.status ?? c.status }
    }
    r = await close(true)
  }
  if (r.outcome === 'being_paid') throw new ConvexError('This payment is being paid right now, so it can’t be cancelled. Check again in a moment.')
  if (r.outcome === 'check_processor') r = await close(true)
  return { status: r.outcome === 'already_handled' ? r.status : 'abandoned' }
}
