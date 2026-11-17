// What an app's convex/ code imports. The app makes one instance (convex/payments.ts):
//
//   export const payments: Payments = new Payments(components.payments, { app: 'market', siteUrl, stripe, paypal })
//
// The component only stores rows. Everything that needs the network or the app's secrets runs here,
// inside the app's own actions and HTTP actions: starting a checkout, the webhooks, the return page,
// sending refunds, the sweep and the nightly comparison.
import { createFunctionHandle, httpActionGeneric, internalActionGeneric, internalMutationGeneric, type FunctionReference, type HttpRouter, type PaginationOptions } from 'convex/server'
import { ConvexError, v } from 'convex/values'
import type { FunctionArgs, FunctionReturnType } from 'convex/server'
import type { ComponentApi } from '../component/_generated/component.js'
import { DEFAULT_FEE_RATES, feeRates, feeSchedule, type FeeRates, type FeeRatesInput, type FeeSchedule } from '../core/fees.js'
import { PAYPAL_LIVE_API, PAYPAL_SANDBOX_API, approveUrl, captureFee, moneyCents, orderCapture, paypal, paypalToken, type PaypalKeys, type PaypalOrder } from '../core/paypal.js'
import { sessionState, stripe, stripeFee, paymentIntentId, type StripeKeys, type StripeSession } from '../core/stripe.js'
import { accountFingerprint, decryptToken, encryptToken } from '../core/tokenCrypt.js'
import { ProcessorError, isMethodFor, tagFor, type Fetch, type Method, type Payer, type Processor, type Ref } from '../core/types.js'
import { reconcile, type ReconcileResult } from './reconcile.js'
import { errorText, paypalRefundState, stripeRefundState } from './util.js'
import { handlePaypalWebhook, handleStripeWebhook, type UnhandledStripeEvent } from './webhooks.js'
import type { Callbacks } from './validators.js'

export type { ComponentApi }
export * from './validators.js'
export type { ReconcileResult, UnhandledStripeEvent }
export { PAYPAL_LIVE_API, PAYPAL_SANDBOX_API }
export { errorText } from './util.js'

// The smallest ctx each method needs, typed so query, mutation, action and HTTP action ctxs all fit.
type RunQuery = <Q extends FunctionReference<'query', 'public' | 'internal'>>(query: Q, args: FunctionArgs<Q>) => Promise<FunctionReturnType<Q>>
type RunMutation = <M extends FunctionReference<'mutation', 'public' | 'internal'>>(mutation: M, args: FunctionArgs<M>) => Promise<FunctionReturnType<M>>
export type RunQueryCtx = { runQuery: RunQuery }
export type RunMutationCtx = { runQuery: RunQuery; runMutation: RunMutation }
/** Actions and HTTP actions: the ones that may call the processors. */
export type RunActionCtx = RunMutationCtx

export interface PaymentsOptions {
  /** Tags every checkout (Stripe metadata.app, PayPal custom_id `<app>:<id>`) so apps can share a processor account. */
  app: string
  /** The app's public site, for the return and cancel pages (e.g. process.env.SITE_URL). */
  siteUrl: () => string
  /** Stripe's secret key and webhook signing secret, read when called; null when Stripe isn't set up. */
  stripe?: () => StripeKeys | null
  /** PayPal's REST app and webhook id; null when PayPal isn't set up. apiBase is PAYPAL_SANDBOX_API or PAYPAL_LIVE_API. */
  paypal?: () => PaypalKeys | null
  /** Fee rates per processor and method; the defaults are Stripe's published US rates for all of them. */
  fees?: FeeRatesInput
  /** Limits on starting checkouts. false: none. */
  limits?: false | { perKey?: number; windowMinutes?: number; globalPerMinute?: number }
  /** Shown on PayPal's page. */
  brandName?: string
  /** For tests: the fetch the processor calls go through (default: the global fetch, looked up at each call). */
  fetch?: Fetch
}

export interface StartArgs extends Callbacks {
  ref: Ref
  /** A free word for the host, e.g. 'order'. */
  purpose: string
  /** What the buyer sees at the processor. */
  description: string
  amountCents: number
  processor: Processor
  method: Method
  payer: Payer
  /** Path on siteUrl the buyer comes back to after paying. Stripe adds session_id, PayPal adds token. */
  returnPath: string
  cancelPath: string
  /** When an unpaid checkout is given up (ms). Default three hours. Stripe allows 30 minutes to 24 hours. */
  expiresAt?: number
  /** Counted against the per-key limit, e.g. the buyer's email. */
  limitKey?: string
  /** Passed to every callback. */
  context?: unknown
}

export type CheckoutView = FunctionReturnType<ComponentApi['checkouts']['get']>
export type CheckoutStatus = NonNullable<CheckoutView>['status']
export type RefundView = FunctionReturnType<ComponentApi['refunds']['forCheckout']>[number]

const DEFAULT_EXPIRY_MS = 3 * 60 * 60_000
/** A PayPal checkout still pending after this long is looked at by sweep (the buyer may have approved and closed the tab). */
const PAYPAL_LOOK_AFTER_MS = 5 * 60_000
/** A refund still sending after this long is checked with the processor. */
const REFUND_STUCK_MS = 10 * 60_000

const FINAL: ReadonlySet<CheckoutStatus> = new Set(['paid', 'refund_needed', 'failed', 'abandoned'])

export class Payments {
  readonly fees: FeeRates

  constructor(
    public readonly component: ComponentApi,
    public readonly options: PaymentsOptions,
  ) {
    if (!/^[a-z0-9_-]+$/i.test(options.app)) throw new Error('The payments app tag must be letters, digits, - or _.')
    this.fees = options.fees ? feeRates(options.fees) : DEFAULT_FEE_RATES
  }

  get app(): string {
    return this.options.app
  }

  /** The fee schedule for one processor and method, from this app's rates. */
  feeSchedule(processor: Processor, method: Method): FeeSchedule {
    return feeSchedule(this.fees, processor, method)
  }

  /** @internal */
  fetch: Fetch = (input, init) => (this.options.fetch ?? fetch)(input, init)

  /** @internal */
  stripeKeys(): StripeKeys {
    const k = this.options.stripe?.()
    if (!k?.secretKey) throw new ConvexError('Stripe isn’t set up on this deployment.')
    return k
  }

  /** @internal */
  paypalKeys(): PaypalKeys {
    const k = this.options.paypal?.()
    if (!k?.clientId || !k.clientSecret) throw new ConvexError('PayPal isn’t set up on this deployment.')
    return k
  }

  /** @internal A PayPal call context: the cached token while it has five minutes left, else a fresh one, cached (encrypted). */
  async paypalCall(ctx: RunActionCtx) {
    const keys = this.paypalKeys()
    const account = await accountFingerprint(keys.apiBase, keys.clientId)
    const now = Date.now()
    const cached = await ctx.runQuery(this.component.settings.paypalToken, {})
    let token = cached && cached.account === account && cached.expiresAt > now + 5 * 60_000 ? await decryptToken(keys.clientSecret, cached.sealed) : null
    if (!token) {
      const got = await paypalToken(keys, now, { fetch: this.fetch })
      token = got.token
      await ctx.runMutation(this.component.settings.savePaypalToken, { sealed: await encryptToken(keys.clientSecret, got.token), expiresAt: got.expiresAt, account })
    }
    return { apiBase: keys.apiBase, token, fetch: this.fetch, keys }
  }

  private url(path: string): string {
    return `${this.options.siteUrl().replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
  }

  private limit(key: string | undefined) {
    const l = this.options.limits
    if (l === false) return undefined
    return { key, perKey: l?.perKey ?? 5, windowMs: (l?.windowMinutes ?? 10) * 60_000, globalPerMinute: l?.globalPerMinute ?? 30 }
  }

  // ── Checkouts ─────────────────────────────────────────────────────────────────────────────────

  /**
   * Starts a checkout from an action: makes the row, asks the processor for its checkout (keyed by
   * the row's id, so a retry gets the same one), and returns where to send the buyer.
   */
  async start(ctx: RunActionCtx, a: StartArgs): Promise<{ checkoutId: string; redirectUrl: string }> {
    if (!isMethodFor(a.processor, a.method)) throw new ConvexError(`${a.processor === 'stripe' ? 'Stripe' : 'PayPal'} doesn’t take ${a.method} payments here.`)
    if (!Number.isInteger(a.amountCents) || a.amountCents < 1) throw new ConvexError('A checkout needs an amount of at least one cent.')
    if (a.processor === 'stripe') this.stripeKeys()
    else this.paypalKeys()
    const now = Date.now()
    const expiresAt = a.expiresAt ?? now + DEFAULT_EXPIRY_MS
    const returnUrl = this.url(a.returnPath)
    const cancelUrl = this.url(a.cancelPath)
    const handle = async (fn: FunctionReference<'mutation', 'internal'> | undefined) => (fn ? await createFunctionHandle(fn) : undefined)
    const checkoutId = await ctx.runMutation(this.component.checkouts.create, {
      app: this.app,
      ref: a.ref,
      purpose: a.purpose,
      description: a.description,
      amountCents: a.amountCents,
      processor: a.processor,
      method: a.method,
      payer: { email: a.payer.email.trim(), ...(a.payer.name?.trim() ? { name: a.payer.name.trim() } : {}) },
      returnUrl,
      cancelUrl,
      expiresAt,
      context: a.context,
      callbacks: {
        onPaid: await handle(a.onPaid),
        onFailed: await handle(a.onFailed),
        onRefunded: await handle(a.onRefunded),
        onRefundNeeded: await handle(a.onRefundNeeded),
        onDispute: await handle(a.onDispute),
      },
      limit: this.limit(a.limitKey),
      now,
    })
    try {
      const made = a.processor === 'stripe' ? await this.startStripe(checkoutId, a, returnUrl, cancelUrl, expiresAt, now) : await this.startPaypal(ctx, checkoutId, a, returnUrl, cancelUrl)
      await ctx.runMutation(this.component.checkouts.attach, { id: checkoutId, processorCheckoutId: made.id })
      return { checkoutId, redirectUrl: made.url }
    } catch (err) {
      await ctx.runMutation(this.component.checkouts.failStart, { id: checkoutId, error: errorText(err), now: Date.now() })
      console.error(`payments: starting ${a.processor} checkout ${checkoutId} failed: ${errorText(err)}`)
      throw new ConvexError(`${a.processor === 'stripe' ? 'Stripe' : 'PayPal'} couldn’t start the payment just now. Please try again in a moment.`)
    }
  }

  private async startStripe(checkoutId: string, a: StartArgs, returnUrl: string, cancelUrl: string, expiresAt: number, now: number) {
    const successUrl = `${returnUrl}${returnUrl.includes('?') ? '&' : '?'}session_id={CHECKOUT_SESSION_ID}`
    const s = await stripe.createSession(
      this.stripeKeys(),
      { app: this.app, checkoutId, description: a.description, amountCents: a.amountCents, method: a.method as 'card' | 'ach', email: a.payer.email, successUrl, cancelUrl, expiresAt, now },
      { fetch: this.fetch },
    )
    if (!s.url) throw new Error('Stripe returned no checkout address.')
    return { id: s.id, url: s.url }
  }

  private async startPaypal(ctx: RunActionCtx, checkoutId: string, a: StartArgs, returnUrl: string, cancelUrl: string) {
    const call = await this.paypalCall(ctx)
    const order = await paypal.createOrder(
      call,
      { customId: tagFor(this.app, checkoutId), description: a.description, amountCents: a.amountCents, returnUrl, cancelUrl, brandName: this.options.brandName },
      `checkout-${checkoutId}`,
    )
    const url = approveUrl(order)
    if (!url) throw new Error('PayPal returned no approval address.')
    return { id: order.id, url }
  }

  /** @internal Records a paid Stripe session, then (best effort) the fee Stripe kept. */
  async settleStripeSession(ctx: RunActionCtx, checkoutId: string, s: StripeSession) {
    const state = sessionState(s)
    const pi = paymentIntentId(s)
    if (state === 'processing') return await ctx.runMutation(this.component.checkouts.markProcessing, { id: checkoutId, paymentRef: pi ?? undefined })
    if (state !== 'paid') return null
    const fee = stripeFee(s)
    const res = await ctx.runMutation(this.component.checkouts.settlePaid, {
      id: checkoutId,
      paymentRef: pi ?? s.id,
      paidCents: s.amount_total ?? 0,
      processorFeeCents: fee ?? undefined,
      now: Date.now(),
    })
    if (fee === null && pi && res.outcome !== 'already_handled') {
      try {
        const full = await stripe.retrievePaymentIntent(this.stripeKeys(), pi, { fetch: this.fetch })
        const kept = stripeFee(full)
        if (kept !== null) await ctx.runMutation(this.component.checkouts.recordFee, { id: checkoutId, processorFeeCents: kept })
      } catch (err) {
        console.warn(`payments: couldn’t read Stripe’s fee for ${pi}: ${errorText(err)}`)
      }
    }
    return res
  }

  /** @internal Settles from a PayPal order that has a capture (COMPLETED, PENDING or DECLINED). */
  async settlePaypalOrder(ctx: RunActionCtx, checkoutId: string, order: PaypalOrder) {
    const capture = orderCapture(order)
    if (!capture) return null
    if (capture.status === 'COMPLETED' || capture.status === 'PARTIALLY_REFUNDED' || capture.status === 'REFUNDED') {
      return await ctx.runMutation(this.component.checkouts.settlePaid, {
        id: checkoutId,
        paymentRef: capture.id,
        paidCents: moneyCents(capture.amount) ?? 0,
        processorFeeCents: captureFee(capture) ?? undefined,
        now: Date.now(),
      })
    }
    if (capture.status === 'PENDING') return await ctx.runMutation(this.component.checkouts.markProcessing, { id: checkoutId, paymentRef: capture.id })
    return await ctx.runMutation(this.component.checkouts.settleFailed, { id: checkoutId, reason: `PayPal ${capture.status.toLowerCase()} the payment.`, now: Date.now() })
  }

  /**
   * @internal Captures an approved PayPal order and settles it. A second capture (a reloaded
   * return page, the webhook and the sweep racing) gets ORDER_ALREADY_CAPTURED from PayPal: the
   * order is then fetched and settled from what it says, instead of failing (fix b).
   */
  async capturePaypal(ctx: RunActionCtx, checkoutId: string, orderId: string): Promise<void> {
    const call = await this.paypalCall(ctx)
    let order: PaypalOrder
    try {
      order = await paypal.captureOrder(call, orderId, `capture-${checkoutId}`)
    } catch (err) {
      if (err instanceof ProcessorError && err.code === 'ORDER_ALREADY_CAPTURED') order = await paypal.getOrder(call, orderId)
      else if (err instanceof ProcessorError && err.code === 'ORDER_NOT_APPROVED') return
      else throw err
    }
    await this.settlePaypalOrder(ctx, checkoutId, order)
  }

  /**
   * For the page the buyer comes back to (`token`: Stripe's session_id or PayPal's token). Returns
   * the outcome at once if the checkout is already settled; otherwise asks the processor and settles
   * (capturing an approved PayPal order), so the page doesn't wait for a webhook. Null: not ours.
   */
  async completeReturn(ctx: RunActionCtx, { processor, token }: { processor: Processor; token: string }): Promise<{ checkoutId: string; ref: Ref; status: CheckoutStatus } | null> {
    if (!token) return null
    const found = await ctx.runQuery(this.component.checkouts.byProcessorId, { processorCheckoutId: token })
    if (!found || found.processor !== processor || found.app !== this.app) return null
    if (!FINAL.has(found.status) || found.status === 'abandoned') {
      if (processor === 'paypal') {
        const call = await this.paypalCall(ctx)
        const order = await paypal.getOrder(call, token)
        if (order.status === 'APPROVED') await this.capturePaypal(ctx, found.id, token)
        else if (order.status === 'COMPLETED') await this.settlePaypalOrder(ctx, found.id, order)
      } else {
        await this.settleStripeSession(ctx, found.id, await stripe.retrieveSession(this.stripeKeys(), token, { fetch: this.fetch }))
      }
    }
    const now = await ctx.runQuery(this.component.checkouts.get, { id: found.id })
    return { checkoutId: found.id, ref: found.ref, status: now?.status ?? found.status }
  }

  /** One checkout, for the app's queries (e.g. a thank-you page). */
  async status(ctx: RunQueryCtx, checkoutId: string): Promise<CheckoutView> {
    return await ctx.runQuery(this.component.checkouts.get, { id: checkoutId })
  }

  async get(ctx: RunQueryCtx, checkoutId: string): Promise<CheckoutView> {
    return await this.status(ctx, checkoutId)
  }

  /** The checkouts for one thing in the app, newest first. */
  async forRef(ctx: RunQueryCtx, ref: Ref) {
    return await ctx.runQuery(this.component.checkouts.byRef, { ref })
  }

  async byPaymentRef(ctx: RunQueryCtx, paymentRef: string): Promise<CheckoutView> {
    return await ctx.runQuery(this.component.checkouts.byPaymentRef, { paymentRef })
  }

  /** All checkouts, newest first, paginated. */
  async list(ctx: RunQueryCtx, paginationOpts: PaginationOptions) {
    return await ctx.runQuery(this.component.checkouts.list, { paginationOpts })
  }

  // ── Webhooks ──────────────────────────────────────────────────────────────────────────────────

  /** Stripe's webhook: verify, de-duplicate, act. 400 for a bad signature, 500 for a real failure (Stripe retries), 200 otherwise. */
  async handleStripeWebhook(ctx: RunActionCtx, request: Request, onUnhandled?: UnhandledStripeEvent): Promise<Response> {
    return await handleStripeWebhook(this, ctx, request, onUnhandled)
  }

  async handlePaypalWebhook(ctx: RunActionCtx, request: Request): Promise<Response> {
    return await handlePaypalWebhook(this, ctx, request)
  }

  /**
   * Adds the webhook routes to the app's router. Events the library doesn't handle, or for objects
   * that aren't this app's checkouts, go to onUnhandledStripeEvent when given (ed-market: bid payments).
   */
  registerRoutes(http: HttpRouter, o: { stripePath?: string; paypalPath?: string; onUnhandledStripeEvent?: UnhandledStripeEvent } = {}) {
    if (this.options.stripe) {
      http.route({ path: o.stripePath ?? '/stripe/webhook', method: 'POST', handler: httpActionGeneric(async (ctx, req) => await this.handleStripeWebhook(ctx, req, o.onUnhandledStripeEvent)) })
    }
    if (this.options.paypal) {
      http.route({ path: o.paypalPath ?? '/paypal/webhook', method: 'POST', handler: httpActionGeneric(async (ctx, req) => await this.handlePaypalWebhook(ctx, req)) })
    }
  }

  // ── Refunds ───────────────────────────────────────────────────────────────────────────────────

  /** Asks for a refund (the whole remaining amount unless given). Who may is the app's check; `by` is recorded. Returns the refund id. */
  async requestRefund(ctx: RunMutationCtx, a: { checkoutId: string; amountCents?: number; reason: string; by?: string }): Promise<string> {
    return await ctx.runMutation(this.component.refunds.request, { ...a, now: Date.now() })
  }

  async approveRefund(ctx: RunMutationCtx, a: { refundId: string; by?: string }): Promise<void> {
    await ctx.runMutation(this.component.refunds.approve, { ...a, now: Date.now() })
  }

  /**
   * Sends a refund through the processor (keyed by the refund id, so sending again after a failure
   * or a crash never refunds twice). Needs approval first unless skipApproval.
   */
  async sendRefund(ctx: RunActionCtx, refundId: string, o: { skipApproval?: boolean; by?: string } = {}): Promise<RefundView | null> {
    const go = await ctx.runMutation(this.component.refunds.begin, { refundId, skipApproval: o.skipApproval ?? false, by: o.by, now: Date.now() })
    if (go.state === 'send') await this.pushRefund(ctx, go)
    return await ctx.runQuery(this.component.refunds.get, { refundId })
  }

  /** @internal The processor call for a refund already marked sending, and its outcome recorded. */
  async pushRefund(ctx: RunActionCtx, r: { refundId: string; processor: Processor; paymentRef: string; amountCents: number }) {
    const finish = (x: { ok: boolean; done: boolean; processorRefundId?: string; error?: string }) => ctx.runMutation(this.component.refunds.finish, { refundId: r.refundId, ...x, now: Date.now() })
    try {
      if (r.processor === 'stripe') {
        if (!r.paymentRef.startsWith('pi_')) throw new ConvexError('This Stripe payment has no PaymentIntent to refund; refund it in the Stripe dashboard.')
        const made = await stripe.createRefund(this.stripeKeys(), { paymentIntent: r.paymentRef, amountCents: r.amountCents, app: this.app, refundId: r.refundId }, { fetch: this.fetch })
        if (made.status === 'failed' || made.status === 'canceled')
          await finish({ ok: false, done: false, processorRefundId: made.id, error: `Stripe: the refund ${made.status}${made.failure_reason ? ` (${made.failure_reason})` : ''}.` })
        else await finish({ ok: true, done: made.status === 'succeeded', processorRefundId: made.id })
      } else {
        const call = await this.paypalCall(ctx)
        const made = await paypal.refundCapture(call, r.paymentRef, { amountCents: r.amountCents, customId: tagFor(this.app, r.refundId) }, `refund-${r.refundId}`)
        if (made.status === 'FAILED' || made.status === 'CANCELLED') await finish({ ok: false, done: false, processorRefundId: made.id, error: `PayPal: the refund ${made.status.toLowerCase()}.` })
        else await finish({ ok: true, done: made.status === 'COMPLETED', processorRefundId: made.id })
      }
    } catch (err) {
      await finish({ ok: false, done: false, error: errorText(err) })
    }
  }

  /** Records a refund made outside the app (a dashboard, a cheque) as done. */
  async markRefundedManually(ctx: RunMutationCtx, a: { refundId: string; by?: string; note?: string }): Promise<void> {
    await ctx.runMutation(this.component.refunds.markManual, { ...a, now: Date.now() })
  }

  async dismissRefund(ctx: RunMutationCtx, a: { refundId: string; by?: string; note?: string }): Promise<void> {
    await ctx.runMutation(this.component.refunds.dismiss, { ...a, now: Date.now() })
  }

  /** Refunds waiting on someone: requested, approved, sending, failed. */
  async openRefunds(ctx: RunQueryCtx) {
    return await ctx.runQuery(this.component.refunds.listOpen, {})
  }

  async refundsFor(ctx: RunQueryCtx, checkoutId: string) {
    return await ctx.runQuery(this.component.refunds.forCheckout, { checkoutId })
  }

  async refund(ctx: RunQueryCtx, refundId: string) {
    return await ctx.runQuery(this.component.refunds.get, { refundId })
  }

  // ── Upkeep ────────────────────────────────────────────────────────────────────────────────────

  /**
   * For a cron every 10 minutes. PayPal checkouts pending over 5 minutes: captured if the buyer
   * approved (they may have closed the tab: fix a), abandoned once expired. Expired Stripe sessions:
   * settled if paid, else expired at Stripe and abandoned. Refunds left sending over 10 minutes:
   * asked about (or sent again, safely, under the same key).
   */
  async sweep(ctx: RunActionCtx): Promise<{ checked: number; settled: number; abandoned: number; refunds: number; errors: number }> {
    const now = Date.now()
    const out = { checked: 0, settled: 0, abandoned: 0, refunds: 0, errors: 0 }
    for (const c of await ctx.runQuery(this.component.checkouts.due, { limit: 200 })) {
      if (c.app !== this.app || c.status === 'processing') continue
      const expired = c.expiresAt <= now
      if (!expired && !(c.processor === 'paypal' && c.status === 'pending' && c.createdAt <= now - PAYPAL_LOOK_AFTER_MS)) continue
      out.checked++
      try {
        const before = c.status
        await this.sweepOne(ctx, c, expired)
        const after = (await ctx.runQuery(this.component.checkouts.get, { id: c.id }))?.status
        if (after && after !== before) {
          if (after === 'abandoned') out.abandoned++
          else out.settled++
        }
      } catch (err) {
        out.errors++
        console.error(`payments: sweep of checkout ${c.id} failed: ${errorText(err)}`)
      }
    }
    for (const r of await ctx.runQuery(this.component.refunds.stuck, { before: now - REFUND_STUCK_MS, limit: 50 })) {
      try {
        await this.recheckRefund(ctx, r)
        out.refunds++
      } catch (err) {
        out.errors++
        console.error(`payments: checking refund ${r.id} failed: ${errorText(err)}`)
      }
    }
    return out
  }

  private async sweepOne(ctx: RunActionCtx, c: NonNullable<CheckoutView>, expired: boolean) {
    const abandon = () => ctx.runMutation(this.component.checkouts.abandon, { id: c.id, now: Date.now() })
    if (!c.processorCheckoutId) return expired ? await abandon() : null
    if (c.processor === 'paypal') {
      const call = await this.paypalCall(ctx)
      let order: PaypalOrder | null
      try {
        order = await paypal.getOrder(call, c.processorCheckoutId)
      } catch (err) {
        // PayPal forgets orders nobody approved after a while.
        if (err instanceof ProcessorError && err.status === 404) order = null
        else throw err
      }
      if (order?.status === 'APPROVED') return await this.capturePaypal(ctx, c.id, c.processorCheckoutId)
      if (order?.status === 'COMPLETED') return await this.settlePaypalOrder(ctx, c.id, order)
      return expired || order?.status === 'VOIDED' ? await abandon() : null
    }
    const keys = this.stripeKeys()
    const s = await stripe.retrieveSession(keys, c.processorCheckoutId, { fetch: this.fetch })
    const state = sessionState(s)
    if (state === 'paid' || state === 'processing') return await this.settleStripeSession(ctx, c.id, s)
    if (state === 'open') {
      try {
        await stripe.expireSession(keys, s.id, { fetch: this.fetch })
      } catch (err) {
        // Paid in the moment between the two calls: the next sweep (or the webhook) settles it.
        if (err instanceof ProcessorError && err.status === 400) return null
        throw err
      }
    }
    return await abandon()
  }

  private async recheckRefund(ctx: RunActionCtx, r: RefundView) {
    const c = await ctx.runQuery(this.component.checkouts.get, { id: r.checkoutId })
    if (!c?.paymentRef) return
    if (!r.processorRefundId) {
      // Crashed between claiming and recording: send again under the same idempotency key.
      return await this.pushRefund(ctx, { refundId: r.id, processor: c.processor, paymentRef: c.paymentRef, amountCents: r.amountCents })
    }
    const state =
      c.processor === 'stripe'
        ? stripeRefundState((await stripe.retrieveRefund(this.stripeKeys(), r.processorRefundId, { fetch: this.fetch })).status)
        : paypalRefundState((await paypal.getRefund(await this.paypalCall(ctx), r.processorRefundId)).status)
    await ctx.runMutation(this.component.refunds.recordExternal, {
      processor: c.processor,
      paymentRef: c.paymentRef,
      processorRefundId: r.processorRefundId,
      amountCents: r.amountCents,
      state,
      refundId: r.id,
      now: Date.now(),
    })
  }

  /**
   * For a nightly cron: compares the last `days` of checkouts and refunds with each processor and
   * opens an issue for each difference (resolving ones that went away). Refunds found at the
   * processor that the ledger lacks are recorded. PayPal's Transaction Search, for captures tagged
   * with this app that the component never heard of, is skipped (logged once a day) when PayPal
   * refuses it.
   */
  async reconcile(ctx: RunActionCtx, o: { days?: number } = {}): Promise<ReconcileResult> {
    return await reconcile(this, ctx, o.days ?? 3)
  }

  /** For the app's nightly cleanup: deletes what isn't kept (see the component's maintenance.ts), a batch at a time; call again while `more`. */
  async cleanup(ctx: RunMutationCtx): Promise<{ deleted: number; more: boolean }> {
    return await ctx.runMutation(this.component.maintenance.cleanup, { now: Date.now() })
  }

  // ── Issues ────────────────────────────────────────────────────────────────────────────────────

  /** Issues nobody was told about yet, for the app's digest email; mark them after sending. */
  async unreportedIssues(ctx: RunQueryCtx) {
    return await ctx.runQuery(this.component.issues.unreported, {})
  }

  async markReported(ctx: RunMutationCtx, ids: string[]): Promise<void> {
    await ctx.runMutation(this.component.issues.markReported, { ids, now: Date.now() })
  }

  async issues(ctx: RunQueryCtx, o: { open: boolean; paginationOpts: PaginationOptions }) {
    return await ctx.runQuery(this.component.issues.list, o)
  }

  async openIssueCount(ctx: RunQueryCtx): Promise<number> {
    return await ctx.runQuery(this.component.issues.openCount, {})
  }

  async resolveIssue(ctx: RunMutationCtx, id: string): Promise<void> {
    await ctx.runMutation(this.component.issues.resolve, { id, now: Date.now() })
  }

  async settings(ctx: RunQueryCtx) {
    return await ctx.runQuery(this.component.settings.get, {})
  }

  async updateSettings(ctx: RunMutationCtx, s: { retentionDays: number }): Promise<void> {
    await ctx.runMutation(this.component.settings.update, s)
  }

  /**
   * The internal functions an app's crons call: `export const { sweep, reconcile, cleanup } = payments.worker()`
   * in convex/paymentsWorker.ts, then crons.interval('payments sweep', { minutes: 10 }, internal.paymentsWorker.sweep).
   */
  worker() {
    return {
      sweep: internalActionGeneric({
        args: {},
        returns: v.null(),
        handler: async (ctx): Promise<null> => {
          await this.sweep(ctx)
          return null
        },
      }),
      reconcile: internalActionGeneric({
        args: { days: v.optional(v.number()) },
        returns: v.null(),
        handler: async (ctx, { days }): Promise<null> => {
          await this.reconcile(ctx, { days })
          return null
        },
      }),
      cleanup: internalMutationGeneric({ args: {}, returns: v.object({ deleted: v.number(), more: v.boolean() }), handler: async (ctx) => await this.cleanup(ctx) }),
    }
  }
}
