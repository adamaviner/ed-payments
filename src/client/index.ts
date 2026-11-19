// What an app's convex/ code imports. The app makes one instance, in convex/payments.ts:
//
//   export const payments = definePayments(components.payments, { app: 'market', context, stripe: fromEnv.stripe(), paypal: fromEnv.paypal() })
//     .withCallbacks({ on: { paid: internal.orders.onPaid, ... }, authorize: { admin: internal.auth.isAdmin }, worker: internal.payments })
//   export const { sweep, reconcile, cleanup, issuesDigest, charge } = payments.worker()
//   export const admin = payments.adminApi()
//   export const { completeReturn } = payments.publicApi()
//
// Two calls, not one, because of TypeScript: the function references in withCallbacks name the
// app's own modules, including this one, so a single generic call would have to infer its type from
// itself (TS7022). The first call fixes the types from the context validator; the second takes the
// references and has nothing left to infer.
//
// The component only stores rows. Everything that needs the network or the app's secrets runs here,
// inside the app's own actions and HTTP actions.
import {
  createFunctionHandle,
  httpActionGeneric,
  type Crons,
  type FunctionReference,
  type FunctionArgs,
  type FunctionReturnType,
  type HttpRouter,
  type PaginationOptions,
  type Scheduler,
} from 'convex/server'
import { ConvexError, v, type GenericValidator, type Infer } from 'convex/values'
import type { ComponentApi } from '../component/_generated/component.js'
import { DEFAULT_FEE_RATES, feeRates, feeSchedule, type FeeRates, type FeeRatesInput, type FeeSchedule } from '../core/fees.js'
import { PAYPAL_LIVE_API, PAYPAL_SANDBOX_API, approveUrl, captureFee, moneyCents, orderCapture, paypal, paypalToken, type PaypalKeys, type PaypalOrder } from '../core/paypal.js'
import { sessionState, stripe, stripeFee, paymentIntentId, type StripeKeys, type StripeSession } from '../core/stripe.js'
import { accountFingerprint, decryptToken, encryptToken } from '../core/tokenCrypt.js'
import { ProcessorError, isMethodFor, tagFor, type Fetch, type Method, type Payer, type Processor, type Ref } from '../core/types.js'
import { adminApi, publicApi, worker, type AdminApiOptions } from './api.js'
import { mismatch } from './context.js'
import { reconcile, type ReconcileResult } from './reconcile.js'
import { chargeNow, completeIntentReturn, retryOnSession, savedMethods, setupPaymentMethod, sweepIntent, verifyMethodOwner, type SavedMethod } from './saved.js'
import { errorText, paypalRefundState, stripeRefundState } from './util.js'
import { callbackArgs, paidReturns, type Dispute, type Failed, type IssuesDigest, type Paid, type PaidResult, type Processing, type RefundNeeded, type Refunded } from './validators.js'
import { handlePaypalWebhook, handleStripeWebhook, type UnhandledStripeEvent } from './webhooks.js'

export type { ComponentApi, ReconcileResult, UnhandledStripeEvent, SavedMethod, AdminApiOptions }
export * from './validators.js'
export { fromEnv, isLive, stripeProblems, paypalProblems, type KeySource, type Problem } from './env.js'
export { PAYPAL_LIVE_API, PAYPAL_SANDBOX_API }
export { errorText } from './util.js'

// The smallest ctx each method needs, typed so query, mutation, action and HTTP action ctxs all fit.
type RunQuery = <Q extends FunctionReference<'query', 'public' | 'internal'>>(query: Q, args: FunctionArgs<Q>) => Promise<FunctionReturnType<Q>>
type RunMutation = <M extends FunctionReference<'mutation', 'public' | 'internal'>>(mutation: M, args: FunctionArgs<M>) => Promise<FunctionReturnType<M>>
export type RunQueryCtx = { runQuery: RunQuery }
export type RunMutationCtx = { runQuery: RunQuery; runMutation: RunMutation }
/** Actions and HTTP actions: the ones that may call the processors. */
export type RunActionCtx = RunMutationCtx & { auth?: AuthLike; scheduler?: Scheduler }
/** Mutations and actions that schedule (chargeSaved queues the charge). */
export type SchedulerCtx = RunMutationCtx & { scheduler: Scheduler; auth?: AuthLike }
export type AuthLike = { getUserIdentity(): Promise<{ subject: string } | null> }

export interface LimitOptions {
  /** Per signed-in user (else per payer email), per window. Default 5. */
  perKey?: number
  windowMinutes?: number
  /** Everyone together, per minute. Default 30. */
  globalPerMinute?: number
}

export interface PaymentsOptions<C extends GenericValidator> {
  /** Tags every checkout (Stripe metadata.app, PayPal custom_id `<app>:<id>`) so apps can share a processor account. */
  app: string
  /** What every checkout carries for the app's callbacks; checked when the checkout starts. */
  context: C
  /** The app's public site, for the return and cancel pages. Default: SITE_URL. */
  siteUrl?: () => string
  /** fromEnv.stripe(), or a function returning the keys (null: Stripe isn't set up). */
  stripe?: (() => StripeKeys | null) & { check?: () => void }
  /** fromEnv.paypal(), or a function returning the keys (null: PayPal isn't set up). */
  paypal?: (() => PaypalKeys | null) & { check?: () => void }
  /** Fee rates per processor and method; the defaults are Stripe's published US rates for all of them. */
  fees?: FeeRatesInput
  /** Limits on every public entry (starting, saving a method, retrying, the return page). false: none (tests only). */
  limits?: false | LimitOptions
  /** Shown on PayPal's page. */
  brandName?: string
  /** For tests: the fetch the processor calls go through (default: the global fetch, looked up at each call). */
  fetch?: Fetch
}

type Internal<Args extends Record<string, unknown>, R = unknown> = FunctionReference<'mutation', 'internal', Args, R>

/** The app's internal mutations the library calls, each inside the transaction that records the change. All required. */
export interface PaymentCallbacks<T> {
  paid: Internal<Paid<T>, PaidResult>
  failed: Internal<Failed<T>>
  refunded: Internal<Refunded<T>>
  refundNeeded: Internal<RefundNeeded<T>>
  dispute: Internal<Dispute<T>>
  processing: Internal<Processing<T>>
  /** The nightly digest of new issues (send it to a person). */
  issues: Internal<IssuesDigest>
}

/** Who is asking, as the app's check sees it; recorded on refunds. */
export interface Who {
  name: string
}

/** The functions payments.worker() makes, as the app exports them (e.g. internal.payments). */
export interface WorkerRefs {
  sweep: FunctionReference<'action', 'internal', Record<string, never>, null>
  reconcile: FunctionReference<'action', 'internal', { days?: number }, null>
  cleanup: FunctionReference<'mutation', 'internal', Record<string, never>, { deleted: number; more: boolean }>
  issuesDigest: FunctionReference<'mutation', 'internal', Record<string, never>, number>
  charge: FunctionReference<'action', 'internal', { checkoutId: string; manual?: boolean }, null>
}

export interface PaymentsWiring<T> {
  on: PaymentCallbacks<T>
  /**
   * The app's own permission checks, as internal queries returning { name } or null (refused).
   * `auth` is whatever the caller passed to the generated function (ed-schedule: its session token);
   * apps that use Convex auth ignore it, as the caller's identity carries through.
   */
  authorize: { admin: FunctionReference<'query', 'internal', { auth?: unknown }, Who | null> }
  /** Where the app exported payments.worker(), for scheduled charges and registerCrons. */
  worker: WorkerRefs
}

export interface StartArgs<T> {
  ref: Ref
  /** A free word for the host, e.g. 'order'. */
  purpose: string
  /** What the buyer sees at the processor. */
  description: string
  /** Priced on the server, never taken from the browser. */
  amountCents: number
  processor: Processor
  method: Method
  payer: Payer
  /** Path on siteUrl the buyer comes back to after paying. Stripe adds session_id, PayPal adds token. */
  returnPath: string
  cancelPath: string
  /** When an unpaid checkout is given up (ms). Default three hours. Stripe allows 30 minutes to 24 hours. */
  expiresAt?: number
  /** Counted against the per-key limit instead of the signed-in user or the payer's email. */
  limitKey?: string
  /** Passed to every callback; checked against the context validator. */
  context: T
  /**
   * redirect (default): send the buyer to the processor's page. embedded: show it on the app's own page,
   * with `PaypalButtons` or `StripeEmbeddedCheckout` from `@earthdance/payments/react`. Either way the
   * buyer ends on returnPath and the webhooks settle the payment.
   */
  ui?: StartUi
}

export type StartUi = 'redirect' | 'embedded'

/** What the browser needs to show an embedded checkout. */
export type EmbeddedPayment =
  /** For Stripe.js's createEmbeddedCheckoutPage, with the app's publishable key. Stripe sends the buyer to returnPath when paid. */
  | { processor: 'stripe'; clientSecret: string }
  /**
   * For PayPal's buttons: the order the buttons pay, the REST app's client id (public; it also says
   * sandbox or live), and where to go once paid (returnPath with PayPal's token, as a redirect would).
   */
  | { processor: 'paypal'; orderId: string; clientId: string; returnUrl: string }

export interface StartedRedirect {
  checkoutId: string
  redirectUrl: string
}

export interface StartedEmbedded {
  checkoutId: string
  embedded: EmbeddedPayment
}

export interface ChargeArgs<T> {
  ref: Ref
  purpose: string
  description: string
  amountCents: number
  payer: Payer
  /** Whose saved method it is (the owner given to setupPaymentMethod). */
  owner: Ref
  paymentMethodId: string
  /**
   * The app's key for this charge, e.g. `bid-<id>-<selectedAt>`: calling chargeSaved again with the
   * same key returns the same checkout, and Stripe replays the same charge.
   */
  idempotencyKey: string
  context: T
  /** The Stripe Customer, when the library has none recorded for the owner (adopting one made before it). */
  stripeCustomerId?: string
}

export type CheckoutView = FunctionReturnType<ComponentApi['checkouts']['get']>
export type Checkout = NonNullable<CheckoutView>
export type CheckoutStatus = Checkout['status']
export type RefundView = FunctionReturnType<ComponentApi['refunds']['forCheckout']>[number]
export type IssueView = FunctionReturnType<ComponentApi['issues']['list']>['page'][number]

const DEFAULT_EXPIRY_MS = 3 * 60 * 60_000
/** A PayPal checkout still pending after this long is looked at by sweep (the buyer may have approved and closed the tab). */
const PAYPAL_LOOK_AFTER_MS = 5 * 60_000
/** A refund still sending after this long is checked with the processor. */
const REFUND_STUCK_MS = 10 * 60_000

const FINAL: ReadonlySet<CheckoutStatus> = new Set(['paid', 'refund_needed', 'failed', 'abandoned'])

/** A PayPal checkout's lastError once PayPal declined what the buyer chose: only the buyer captures it after that (capturePaypal). */
export const PAYPAL_DECLINED = 'PayPal declined the card or account the buyer chose; waiting for them to choose another.'

/**
 * Step one: the app's tag, keys and context type. Returns { withCallbacks } for step two.
 */
export function definePayments<C extends GenericValidator>(component: ComponentApi, options: PaymentsOptions<C>): { withCallbacks(wiring: PaymentsWiring<Infer<C>>): Payments<C> } {
  if (!/^[a-z0-9_-]+$/i.test(options.app)) throw new Error('The payments app tag must be letters, digits, - or _.')
  return { withCallbacks: (wiring) => new Payments<C>(component, options, wiring) }
}

/** The app's payments; C is its context validator (definePayments). */
export class Payments<C extends GenericValidator = GenericValidator> {
  readonly fees: FeeRates
  /** The callbacks' argument validators with this app's context: `internalMutation({ args: payments.args.paid, returns: paidReturns, ... })`. */
  readonly args: ReturnType<typeof callbackArgs<C>>
  readonly paidReturns = paidReturns

  /** @internal Use definePayments. */
  constructor(
    public readonly component: ComponentApi,
    public readonly options: PaymentsOptions<C>,
    public readonly wiring: PaymentsWiring<Infer<C>>,
  ) {
    this.fees = options.fees ? feeRates(options.fees) : DEFAULT_FEE_RATES
    this.args = callbackArgs(options.context)
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

  /** @internal Throws (a ConvexError naming where) when the context doesn't fit the app's validator. */
  checkContext(context: unknown) {
    const wrong = mismatch(this.options.context, context)
    if (wrong) throw new ConvexError(`The payment’s context doesn’t fit this app’s context validator: ${wrong}.`)
  }

  /** @internal The rate-limit keys of one public call: the signed-in user (else the given key), and everyone together. */
  async limits(ctx: { auth?: AuthLike }, entry: string, fallbackKey: string | undefined, scale = 1) {
    const l = this.options.limits
    if (l === false) return undefined
    const identity = ctx.auth ? await ctx.auth.getUserIdentity() : null
    const who = identity ? `user:${identity.subject}` : fallbackKey ? `key:${fallbackKey.trim().toLowerCase()}` : null
    const perKey = (l?.perKey ?? 5) * scale
    const windowMs = (l?.windowMinutes ?? 10) * 60_000
    const global = { key: `${this.app}:${entry}:all`, max: (l?.globalPerMinute ?? 30) * scale, windowMs: 60_000, message: 'Too many payments are being started right now. Try again in a minute.' }
    return who ? [global, { key: `${this.app}:${entry}:${who}`, max: perKey, windowMs, message: 'Too many tries just now. Try again in a few minutes.' }] : [global]
  }

  /** @internal */
  async takeLimits(ctx: RunMutationCtx & { auth?: AuthLike }, entry: string, fallbackKey: string | undefined, scale = 1) {
    const limits = await this.limits(ctx, entry, fallbackKey, scale)
    if (limits) await ctx.runMutation(this.component.limits.take, { limits, now: Date.now() })
  }

  /** @internal The callbacks as function handles, stored on each checkout so the component can call them. */
  async handles() {
    const on = this.wiring.on
    return {
      onPaid: await createFunctionHandle(on.paid),
      onFailed: await createFunctionHandle(on.failed),
      onRefunded: await createFunctionHandle(on.refunded),
      onRefundNeeded: await createFunctionHandle(on.refundNeeded),
      onDispute: await createFunctionHandle(on.dispute),
      onProcessing: await createFunctionHandle(on.processing),
    }
  }

  /** @internal A PayPal call context: the cached token while it has five minutes left (unless `fresh`), else a new one, cached (encrypted). */
  async paypalCall(ctx: RunActionCtx, fresh = false) {
    const keys = this.paypalKeys()
    const account = await accountFingerprint(keys.apiBase, keys.clientId)
    const now = Date.now()
    const cached = fresh ? null : await ctx.runQuery(this.component.settings.paypalToken, {})
    let token = cached && cached.account === account && cached.expiresAt > now + 5 * 60_000 ? await decryptToken(keys.clientSecret, cached.sealed) : null
    if (!token) {
      const got = await paypalToken(keys, now, { fetch: this.fetch })
      token = got.token
      await ctx.runMutation(this.component.settings.savePaypalToken, { sealed: await encryptToken(keys.clientSecret, got.token), expiresAt: got.expiresAt, account })
    }
    return { apiBase: keys.apiBase, token, fetch: this.fetch, keys }
  }

  /**
   * @internal Runs PayPal calls with the cached token; if PayPal answers 401 (the token was revoked
   * or the app's secret changed) it gets a new token and tries once more.
   */
  async withPaypal<R>(ctx: RunActionCtx, fn: (call: Awaited<ReturnType<Payments['paypalCall']>>) => Promise<R>): Promise<R> {
    try {
      return await fn(await this.paypalCall(ctx))
    } catch (err) {
      if (!(err instanceof ProcessorError && err.processor === 'paypal' && err.status === 401)) throw err
      return await fn(await this.paypalCall(ctx, true))
    }
  }

  /** @internal */
  url(path: string): string {
    const site = (this.options.siteUrl ?? defaultSiteUrl)()
    return `${site.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
  }

  // ── Hosted checkouts ─────────────────────────────────────────────────────────────────────────

  /**
   * Starts a checkout from an action: makes the row, asks the processor for its checkout (keyed by
   * the row's id, so a retry gets the same one), and returns where to send the buyer, or with
   * `ui: 'embedded'` what the app's page needs to show it. Rate-limited per signed-in user (else per
   * payer email, or limitKey) and overall.
   */
  async start(ctx: RunActionCtx, a: StartArgs<Infer<C>> & { ui: 'embedded' }): Promise<StartedEmbedded>
  async start(ctx: RunActionCtx, a: StartArgs<Infer<C>> & { ui?: 'redirect' }): Promise<StartedRedirect>
  async start(ctx: RunActionCtx, a: StartArgs<Infer<C>>): Promise<StartedRedirect | StartedEmbedded>
  async start(ctx: RunActionCtx, a: StartArgs<Infer<C>>): Promise<StartedRedirect | StartedEmbedded> {
    if (!isMethodFor(a.processor, a.method)) throw new ConvexError(`${a.processor === 'stripe' ? 'Stripe' : 'PayPal'} doesn’t take ${a.method} payments here.`)
    if (!Number.isInteger(a.amountCents) || a.amountCents < 1) throw new ConvexError('A checkout needs an amount of at least one cent.')
    this.checkContext(a.context)
    if (a.processor === 'stripe') this.stripeKeys()
    else this.paypalKeys()
    const now = Date.now()
    const expiresAt = a.expiresAt ?? now + DEFAULT_EXPIRY_MS
    const returnUrl = this.url(a.returnPath)
    const cancelUrl = this.url(a.cancelPath)
    const checkoutId = await ctx.runMutation(this.component.checkouts.create, {
      app: this.app,
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
      callbacks: await this.handles(),
      limits: await this.limits(ctx, 'start', a.limitKey ?? a.payer.email),
      now,
    })
    try {
      const made = a.processor === 'stripe' ? await this.startStripe(checkoutId, a, returnUrl, cancelUrl, expiresAt, now) : await this.startPaypal(ctx, checkoutId, a, returnUrl, cancelUrl)
      await ctx.runMutation(this.component.checkouts.attach, { id: checkoutId, processorCheckoutId: made.id })
      return made.embedded ? { checkoutId, embedded: made.embedded } : { checkoutId, redirectUrl: made.url }
    } catch (err) {
      await ctx.runMutation(this.component.checkouts.failStart, { id: checkoutId, error: errorText(err), now: Date.now() })
      console.error(`payments: starting ${a.processor} checkout ${checkoutId} failed: ${errorText(err)}`)
      throw new ConvexError(`${a.processor === 'stripe' ? 'Stripe' : 'PayPal'} couldn’t start the payment just now. Please try again in a moment.`)
    }
  }

  private async startStripe(checkoutId: string, a: StartArgs<Infer<C>>, returnUrl: string, cancelUrl: string, expiresAt: number, now: number) {
    const successUrl = withParam(returnUrl, 'session_id', '{CHECKOUT_SESSION_ID}')
    const embedded = a.ui === 'embedded'
    const s = await stripe.createSession(
      this.stripeKeys(),
      {
        app: this.app,
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
      },
      { fetch: this.fetch },
    )
    if (embedded) {
      if (!s.client_secret) throw new Error('Stripe returned no client secret for the embedded checkout.')
      return { id: s.id, embedded: { processor: 'stripe', clientSecret: s.client_secret } satisfies EmbeddedPayment }
    }
    if (!s.url) throw new Error('Stripe returned no checkout address.')
    return { id: s.id, url: s.url }
  }

  private async startPaypal(ctx: RunActionCtx, checkoutId: string, a: StartArgs<Infer<C>>, returnUrl: string, cancelUrl: string) {
    const embedded = a.ui === 'embedded'
    const order = await this.withPaypal(ctx, (call) =>
      paypal.createOrder(
        call,
        { customId: tagFor(this.app, checkoutId), description: a.description, amountCents: a.amountCents, returnUrl, cancelUrl, brandName: this.options.brandName, embedded },
        `checkout-${checkoutId}`,
      ),
    )
    if (embedded) {
      return { id: order.id, embedded: { processor: 'paypal', orderId: order.id, clientId: this.paypalKeys().clientId, returnUrl: withParam(returnUrl, 'token', order.id) } satisfies EmbeddedPayment }
    }
    const url = approveUrl(order)
    if (!url) throw new Error('PayPal returned no approval address.')
    return { id: order.id, url }
  }

  /** @internal Records a paid Stripe session, then (best effort) the fee Stripe kept. */
  async settleStripeSession(ctx: RunActionCtx, checkoutId: string, s: StripeSession) {
    const state = sessionState(s)
    const pi = paymentIntentId(s)
    if (state === 'processing') return await ctx.runMutation(this.component.checkouts.markProcessing, { id: checkoutId, paymentRef: pi ?? undefined, now: Date.now() })
    if (state !== 'paid') return null
    // Without an amount there is nothing safe to record; throwing makes the webhook answer 500 and Stripe retry.
    if (s.amount_total === null) throw new Error(`Stripe session ${s.id} is paid but has no amount.`)
    const fee = stripeFee(s)
    const res = await ctx.runMutation(this.component.checkouts.settlePaid, {
      id: checkoutId,
      paymentRef: pi ?? s.id,
      paidCents: s.amount_total,
      processorFeeCents: fee ?? undefined,
      processorCheckoutId: s.id,
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
      const paidCents = moneyCents(capture.amount)
      if (paidCents === null) throw new Error(`PayPal capture ${capture.id} has no USD amount.`)
      return await ctx.runMutation(this.component.checkouts.settlePaid, {
        id: checkoutId,
        paymentRef: capture.id,
        paidCents,
        processorFeeCents: captureFee(capture) ?? undefined,
        processorCheckoutId: order.id || undefined,
        now: Date.now(),
      })
    }
    if (capture.status === 'PENDING') return await ctx.runMutation(this.component.checkouts.markProcessing, { id: checkoutId, paymentRef: capture.id, now: Date.now() })
    return await ctx.runMutation(this.component.checkouts.settleFailed, { id: checkoutId, reason: `PayPal ${capture.status.toLowerCase()} the payment.`, now: Date.now() })
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
  async capturePaypal(ctx: RunActionCtx, checkoutId: string, orderId: string, by: 'buyer' | 'background'): Promise<'declined' | undefined> {
    const c = await ctx.runQuery(this.component.checkouts.get, { id: checkoutId })
    if (c?.status !== 'pending' && c?.status !== 'created') return undefined
    if (by === 'background' && c.lastError === PAYPAL_DECLINED) return 'declined'
    const requestId = by === 'buyer' ? `capture-${checkoutId}-${Date.now().toString(36)}` : `capture-${checkoutId}`
    const order = await this.withPaypal(ctx, async (call) => {
      try {
        return await paypal.captureOrder(call, orderId, requestId)
      } catch (err) {
        if (err instanceof ProcessorError && err.code === 'ORDER_ALREADY_CAPTURED') return await paypal.getOrder(call, orderId)
        if (err instanceof ProcessorError && err.code === 'ORDER_NOT_APPROVED') return null
        if (err instanceof ProcessorError && err.code === 'INSTRUMENT_DECLINED') return 'declined' as const
        throw err
      }
    })
    if (order === 'declined') {
      await ctx.runMutation(this.component.checkouts.noteError, { id: checkoutId, error: PAYPAL_DECLINED })
      return order
    }
    if (order) await this.settlePaypalOrder(ctx, checkoutId, order)
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
  async completeReturn(
    ctx: RunActionCtx,
    { processor, token }: { processor: Processor; token: string },
  ): Promise<{ checkoutId: string; ref: Ref; purpose: string; status: CheckoutStatus; declined?: true } | null> {
    if (!token || token.length > 255) return null
    const found = await ctx.runQuery(this.component.checkouts.byProcessorId, { processorCheckoutId: token })
    if (!found || found.processor !== processor || found.app !== this.app) return null
    let declined = false
    if (!FINAL.has(found.status) || found.status === 'abandoned') {
      if (found.kind !== 'hosted') await completeIntentReturn(this, ctx, found)
      else if (processor === 'paypal') {
        const order = await this.withPaypal(ctx, (call) => paypal.getOrder(call, token))
        if (order.status === 'APPROVED') declined = (await this.capturePaypal(ctx, found.id, token, 'buyer')) === 'declined'
        else if (order.status === 'COMPLETED') await this.settlePaypalOrder(ctx, found.id, order)
      } else {
        await this.settleStripeSession(ctx, found.id, await stripe.retrieveSession(this.stripeKeys(), token, { fetch: this.fetch }))
      }
    }
    const now = await ctx.runQuery(this.component.checkouts.get, { id: found.id })
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
   * it can close the unpaid checkout, nothing more). publicApi().cancelCheckout wraps this.
   */
  async cancel(ctx: RunActionCtx, checkoutId: string, o: { limitKey?: string } = {}): Promise<{ status: CheckoutStatus } | null> {
    const c = await ctx.runQuery(this.component.checkouts.get, { id: checkoutId })
    if (!c || c.app !== this.app || c.kind !== 'hosted') return null
    if (c.status !== 'created' && c.status !== 'pending') return { status: c.status }
    if (c.processor === 'stripe' && c.processorCheckoutId) {
      const keys = this.stripeKeys()
      try {
        await stripe.expireSession(keys, c.processorCheckoutId, { fetch: this.fetch })
      } catch (err) {
        // Not open any more: paid (or on its way) in the meantime, or already expired.
        if (!(err instanceof ProcessorError && err.status === 400)) throw err
        const s = await stripe.retrieveSession(keys, c.processorCheckoutId, { fetch: this.fetch })
        const state = sessionState(s)
        if (state === 'paid' || state === 'processing') {
          await this.settleStripeSession(ctx, c.id, s)
          return { status: (await ctx.runQuery(this.component.checkouts.get, { id: c.id }))?.status ?? c.status }
        }
      }
    }
    const limits = await this.limits(ctx, 'start', o.limitKey ?? c.payer.email)
    const own = limits?.find((l) => !l.key.endsWith(':all'))
    const r = await ctx.runMutation(this.component.checkouts.cancel, { id: c.id, giveBack: own && { key: own.key, windowMs: own.windowMs }, now: Date.now() })
    return { status: r.outcome === 'abandoned' ? 'abandoned' : r.status }
  }

  // ── Saved payment methods ─────────────────────────────────────────────────────────────────────

  /**
   * Starts saving a card or bank account for `owner` (e.g. { type: 'user', id }): makes their Stripe
   * Customer if needed and a SetupIntent for charging later with nobody present (bank accounts
   * verified at once). Returns its client secret for Stripe's Payment Element. Rate-limited.
   */
  async setupPaymentMethod(ctx: RunActionCtx, a: { owner: Ref; payer: Payer; stripeCustomerId?: string }): Promise<{ clientSecret: string; stripeCustomerId: string }> {
    return await setupPaymentMethod(this, ctx, a)
  }

  /** The owner's saved cards and bank accounts, newest first, each with whether a charge of it was declined. */
  async savedMethods(ctx: RunActionCtx, a: { owner: Ref; stripeCustomerId?: string }): Promise<SavedMethod[]> {
    return await savedMethods(this, ctx, a)
  }

  /**
   * Checks that a payment method id (from the browser) is a card or bank account saved to this owner's
   * Customer, and returns it; anything else throws, so nobody can pay with a made-up or someone else's method.
   */
  async verifyMethodOwner(ctx: RunActionCtx, a: { owner: Ref; paymentMethodId: string; stripeCustomerId?: string }): Promise<SavedMethod & { stripeCustomerId: string }> {
    return await verifyMethodOwner(this, ctx, a)
  }

  /**
   * Charges a saved method with nobody present, from a mutation or action: records the checkout and
   * queues the charge (payments.worker().charge). A card that needs the buyer to authenticate is
   * refused rather than left waiting. Outcomes come back through the callbacks: paid; processing then
   * paid or failed for a bank account; failed (declined: true) when the bank says no. A charge whose
   * outcome is unknown is tried again a few times under the same key, then left for a person as a
   * charge_unknown issue. Same idempotencyKey, same checkout. Returns the checkout id.
   */
  async chargeSaved(ctx: SchedulerCtx, a: ChargeArgs<Infer<C>>): Promise<string> {
    if (!Number.isInteger(a.amountCents) || a.amountCents < 1) throw new ConvexError('A charge needs an amount of at least one cent.')
    if (!a.idempotencyKey || a.idempotencyKey.length > 200) throw new ConvexError('A charge needs an idempotency key of at most 200 characters.')
    this.checkContext(a.context)
    const existing = await ctx.runQuery(this.component.checkouts.byChargeKey, { chargeKey: `${this.app}:${a.idempotencyKey}` })
    if (existing) return existing.id
    const customer = await ctx.runQuery(this.component.customers.byOwner, { app: this.app, owner: a.owner })
    const stripeCustomerId = customer?.stripeCustomerId ?? a.stripeCustomerId
    if (!stripeCustomerId) throw new ConvexError('This payer has no saved payment method here.')
    const method = await ctx.runQuery(this.component.customers.method, { stripePaymentMethodId: a.paymentMethodId })
    const now = Date.now()
    const site = this.url('/')
    const checkoutId = await ctx.runMutation(this.component.checkouts.create, {
      app: this.app,
      ref: a.ref,
      purpose: a.purpose,
      description: a.description,
      amountCents: a.amountCents,
      processor: 'stripe',
      method: method?.kind ?? 'card',
      kind: 'offSession',
      payer: cleanPayer(a.payer),
      returnUrl: site,
      cancelUrl: site,
      // Never given up by time: an off-session charge ends paid, failed or by a person's decision.
      expiresAt: now + 3650 * 24 * 60 * 60_000,
      context: a.context,
      callbacks: await this.handles(),
      stripeCustomerId,
      paymentMethodId: a.paymentMethodId,
      chargeKey: `${this.app}:${a.idempotencyKey}`,
      now,
    })
    await ctx.scheduler.runAfter(0, this.wiring.worker.charge, { checkoutId })
    return checkoutId
  }

  /** @internal Makes (or retries) an off-session charge; payments.worker().charge runs this. */
  async charge(ctx: RunActionCtx & { scheduler: Scheduler }, checkoutId: string, manual = false): Promise<void> {
    await chargeNow(this, ctx, checkoutId, manual)
  }

  /**
   * For the buyer to pay on the app's page after an off-session charge failed: a PaymentIntent
   * (card or bank account, theirs to choose in the Payment Element) for the same amount, its outcome
   * coming back through the same callbacks with kind 'onSession'. One that is still waiting is
   * reused, so two tabs can't each take a payment; one already on its way is refused. Rate-limited.
   */
  async retryOnSession(ctx: RunActionCtx, a: { checkoutId: string; expiresAt?: number }): Promise<{ checkoutId: string; clientSecret: string }> {
    return await retryOnSession(this, ctx, a)
  }

  // ── Queries ───────────────────────────────────────────────────────────────────────────────────

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

  /** Paid checkouts with something left to refund, newest first, paginated (an index read, not a scan). */
  async refundable(ctx: RunQueryCtx, o: { ref?: Ref; paginationOpts: PaginationOptions }) {
    return await ctx.runQuery(this.component.checkouts.refundable, o)
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
   * Adds the webhook routes to the app's router, each only when its processor's keys exist. Runs the
   * keys' start-up checks first (fromEnv): a live deployment set up wrongly fails to load. Events the
   * library doesn't know, or for objects that aren't this app's, go to onUnhandledStripeEvent.
   */
  registerRoutes(http: HttpRouter, o: { stripePath?: string; paypalPath?: string; onUnhandledStripeEvent?: UnhandledStripeEvent } = {}) {
    this.options.stripe?.check?.()
    this.options.paypal?.check?.()
    if (this.options.stripe?.()) {
      http.route({ path: o.stripePath ?? '/stripe/webhook', method: 'POST', handler: httpActionGeneric(async (ctx, req) => await this.handleStripeWebhook(ctx, req, o.onUnhandledStripeEvent)) })
    }
    if (this.options.paypal?.()) {
      http.route({ path: o.paypalPath ?? '/paypal/webhook', method: 'POST', handler: httpActionGeneric(async (ctx, req) => await this.handlePaypalWebhook(ctx, req)) })
    }
  }

  // ── Refunds ───────────────────────────────────────────────────────────────────────────────────

  /**
   * Asks for a refund (the whole remaining amount unless given). Who may is the app's check; `by` is
   * recorded. `hostData` (at most 10 strings of at most 200 characters, e.g. { relist: 'yes' }; keys
   * non-empty printable ASCII not starting with `$`) is kept on the refund and passed to on.refunded
   * when it is done. Returns the refund id.
   */
  async requestRefund(ctx: RunMutationCtx, a: { checkoutId: string; amountCents?: number; reason: string; by?: string; hostData?: Record<string, string> }): Promise<string> {
    return await ctx.runMutation(this.component.refunds.request, { ...a, now: Date.now() })
  }

  async approveRefund(ctx: RunMutationCtx, a: { refundId: string; by?: string }): Promise<void> {
    await ctx.runMutation(this.component.refunds.approve, { ...a, now: Date.now() })
  }

  /**
   * Sends a refund through the processor, keyed by the refund id (see pushRefund), so it is never made
   * twice. Needs approval first unless skipApproval. Returns the refund as it stands after.
   */
  async sendRefund(ctx: RunActionCtx, refundId: string, o: { skipApproval?: boolean; by?: string } = {}): Promise<RefundView | null> {
    const go = await ctx.runMutation(this.component.refunds.begin, { refundId, skipApproval: o.skipApproval ?? false, by: o.by, now: Date.now() })
    if (go.state === 'send') await this.pushRefund(ctx, go)
    return await ctx.runQuery(this.component.refunds.get, { refundId })
  }

  /**
   * @internal The processor call for a refund already marked sending, and its outcome recorded.
   * The key is the refund's (a new one per attempt the processor refused), so sending again after a
   * timeout or crash returns the same refund instead of making a second. When the outcome is unknown
   * (no answer, a 5xx) the refund stays sending and sweep sends it again under the same key.
   */
  async pushRefund(ctx: RunActionCtx, r: { refundId: string; key: string; processor: Processor; paymentRef: string; amountCents: number }) {
    const finish = (x: { ok: boolean; done: boolean; unknown?: boolean; processorRefundId?: string; error?: string }) =>
      ctx.runMutation(this.component.refunds.finish, { refundId: r.refundId, ...x, now: Date.now() })
    try {
      if (r.processor === 'stripe') {
        if (!r.paymentRef.startsWith('pi_')) throw new ConvexError('This Stripe payment has no PaymentIntent to refund; refund it in the Stripe dashboard.')
        const made = await stripe.createRefund(
          this.stripeKeys(),
          { paymentIntent: r.paymentRef, amountCents: r.amountCents, app: this.app, refundId: r.refundId },
          { fetch: this.fetch, idempotencyKey: r.key },
        )
        if (made.status === 'failed' || made.status === 'canceled')
          await finish({ ok: false, done: false, processorRefundId: made.id, error: `Stripe: the refund ${made.status}${made.failure_reason ? ` (${made.failure_reason})` : ''}.` })
        else await finish({ ok: true, done: made.status === 'succeeded', processorRefundId: made.id })
      } else {
        const made = await this.withPaypal(ctx, (call) => paypal.refundCapture(call, r.paymentRef, { amountCents: r.amountCents, customId: tagFor(this.app, r.refundId) }, r.key))
        if (made.status === 'FAILED' || made.status === 'CANCELLED') await finish({ ok: false, done: false, processorRefundId: made.id, error: `PayPal: the refund ${made.status.toLowerCase()}.` })
        else await finish({ ok: true, done: made.status === 'COMPLETED', processorRefundId: made.id })
      }
    } catch (err) {
      const unknown = !(err instanceof ConvexError) && !(err instanceof ProcessorError && !err.retryable)
      await finish({ ok: false, done: false, unknown, error: errorText(err) })
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
   * Every 10 minutes (registerCrons). PayPal checkouts pending over 5 minutes: captured if the buyer
   * approved (they may have closed the tab: fix a), abandoned once expired. Expired Stripe sessions
   * and on-session payments: settled if paid, else ended at Stripe and abandoned. Off-session charges
   * whose outcome never came back: asked again. Refunds left sending over 10 minutes: asked about
   * (or sent again, safely, under the same key).
   */
  async sweep(ctx: RunActionCtx & { scheduler: Scheduler }): Promise<{ checked: number; settled: number; abandoned: number; refunds: number; errors: number }> {
    const now = Date.now()
    const out = { checked: 0, settled: 0, abandoned: 0, refunds: 0, errors: 0 }
    for (const c of await ctx.runQuery(this.component.checkouts.due, { limit: 200 })) {
      if (c.app !== this.app || c.status === 'processing') continue
      const expired = c.expiresAt <= now
      const look = c.kind === 'offSession' ? true : expired || (c.processor === 'paypal' && c.status === 'pending' && c.createdAt <= now - PAYPAL_LOOK_AFTER_MS)
      if (!look) continue
      try {
        const before = c.status
        const acted = c.kind === 'hosted' ? (await this.sweepOne(ctx, c, expired), true) : await sweepIntent(this, ctx, c, expired, now)
        if (!acted) continue
        out.checked++
        const after = (await ctx.runQuery(this.component.checkouts.get, { id: c.id }))?.status
        if (after && after !== before) {
          if (after === 'abandoned') out.abandoned++
          else out.settled++
        }
      } catch (err) {
        out.checked++
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

  private async sweepOne(ctx: RunActionCtx, c: Checkout, expired: boolean) {
    const abandon = () => ctx.runMutation(this.component.checkouts.abandon, { id: c.id, now: Date.now() })
    if (!c.processorCheckoutId) return expired ? await abandon() : null
    if (c.processor === 'paypal') {
      const id = c.processorCheckoutId
      const order = await this.withPaypal(ctx, async (call) => {
        try {
          return await paypal.getOrder(call, id)
        } catch (err) {
          // PayPal forgets orders nobody approved after a while.
          if (err instanceof ProcessorError && err.status === 404) return null
          throw err
        }
      })
      if (order?.status === 'APPROVED') {
        let outcome: 'declined' | 'failed' | undefined
        try {
          outcome = await this.capturePaypal(ctx, c.id, id, 'background')
        } catch (err) {
          // Before its time, the next sweep tries again; past it, look once more and give up rather than retry for ever.
          if (!expired) throw err
          console.warn(`payments: capturing expired PayPal order ${id} failed: ${errorText(err)}`)
          outcome = 'failed'
        }
        if (!expired || !outcome) return null
        // Declined (the buyer left without choosing another way to pay) or not capturable, and past its time.
        const now = await this.withPaypal(ctx, (call) => paypal.getOrder(call, id))
        return now.status === 'COMPLETED' ? await this.settlePaypalOrder(ctx, c.id, now) : await abandon()
      }
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
      // No answer, or a crash, between claiming and recording: send again under the same key.
      return await this.pushRefund(ctx, { refundId: r.id, key: refundKey(r.id, r.attempts), processor: c.processor, paymentRef: c.paymentRef, amountCents: r.amountCents })
    }
    const refundId = r.processorRefundId
    const state =
      c.processor === 'stripe'
        ? stripeRefundState((await stripe.retrieveRefund(this.stripeKeys(), refundId, { fetch: this.fetch })).status)
        : paypalRefundState((await this.withPaypal(ctx, (call) => paypal.getRefund(call, refundId))).status)
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
   * Nightly (registerCrons): compares the last `days` of checkouts, saved-method charges and refunds
   * with each processor and opens an issue for each difference (resolving ones that went away).
   * Refunds found at the processor that the ledger lacks are recorded. PayPal's Transaction Search,
   * for captures tagged with this app that the component never heard of, is skipped (logged once a
   * day) when PayPal refuses it.
   */
  async reconcile(ctx: RunActionCtx, o: { days?: number } = {}): Promise<ReconcileResult> {
    return await reconcile(this, ctx, o.days ?? 3)
  }

  /** Nightly: deletes what isn't kept (see the component's maintenance.ts), a batch at a time; call again while `more`. */
  async cleanup(ctx: RunMutationCtx): Promise<{ deleted: number; more: boolean }> {
    return await ctx.runMutation(this.component.maintenance.cleanup, { now: Date.now() })
  }

  /** Nightly: hands the issues nobody was told about yet to the app's on.issues, then marks them told. Returns how many. */
  async issuesDigest(ctx: RunMutationCtx): Promise<number> {
    const unreported = await ctx.runQuery(this.component.issues.unreported, {})
    // One that already went away (a late webhook) isn't news; it is marked told with the rest.
    const issues = unreported.filter((i) => i.resolvedAt === null)
    if (issues.length) {
      await ctx.runMutation(this.wiring.on.issues, {
        issues: issues.map((i) => ({ id: i.id, kind: i.kind, detail: i.detail, checkoutId: i.checkoutId, processor: i.processor, openedAt: i.openedAt })),
      })
    }
    if (unreported.length) await ctx.runMutation(this.component.issues.markReported, { ids: unreported.map((i) => i.id), now: Date.now() })
    return issues.length
  }

  // ── Issues ────────────────────────────────────────────────────────────────────────────────────

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

  // ── What the app exports ──────────────────────────────────────────────────────────────────────

  /** The internal functions for the crons and scheduled charges: `export const { sweep, reconcile, cleanup, issuesDigest, charge } = payments.worker()`. */
  worker() {
    return worker(this)
  }

  /**
   * Public queries, mutations and actions for an admin page (refunds, issues, charges with an unknown
   * outcome), each behind authorize.admin: `export const admin = payments.adminApi()`.
   */
  adminApi(o: AdminApiOptions = {}) {
    return adminApi(this, o)
  }

  /** The buyer-facing functions, rate-limited: `export const { completeReturn } = payments.publicApi()`. */
  publicApi() {
    return publicApi(this)
  }

  /**
   * The library's crons, on the app's cron table: sweep every 10 minutes; reconcile, the issues digest
   * and cleanup nightly (UTC hours; reconcile first, the digest half an hour after).
   */
  registerCrons(crons: Crons, o: { reconcileHourUTC?: number; cleanupHourUTC?: number } = {}) {
    const w = this.wiring.worker
    const h = o.reconcileHourUTC ?? 8
    crons.interval('payments sweep', { minutes: 10 }, w.sweep, {})
    crons.daily('payments reconcile', { hourUTC: h, minuteUTC: 0 }, w.reconcile, {})
    crons.daily('payments issues digest', { hourUTC: h, minuteUTC: 30 }, w.issuesDigest, {})
    crons.daily('payments cleanup', { hourUTC: o.cleanupHourUTC ?? (h + 1) % 24, minuteUTC: 0 }, w.cleanup, {})
  }
}

const defaultSiteUrl = () => {
  const url = typeof process === 'undefined' ? undefined : process.env.SITE_URL
  if (!url) throw new Error('SITE_URL isn’t set on this deployment (or pass siteUrl to definePayments).')
  return url
}

const cleanPayer = (p: Payer): Payer => ({ email: p.email.trim(), ...(p.name?.trim() ? { name: p.name.trim() } : {}) })

/** `url` with one more query parameter. Not encoded: Stripe's {CHECKOUT_SESSION_ID} must reach Stripe as it is, and PayPal's ids are letters and digits. */
const withParam = (url: string, name: string, value: string) => `${url}${url.includes('?') ? '&' : '?'}${name}=${value}`

/** The idempotency key of a refund's send: the same for every repeat of one attempt (component refunds.begin makes the same). */
export const refundKey = (refundId: string, attempts: number) => (attempts ? `refund-${refundId}-${attempts}` : `refund-${refundId}`)

/** For the validators of the app's worker functions. */
export const workerArgs = { charge: { checkoutId: v.string(), manual: v.optional(v.boolean()) } }
