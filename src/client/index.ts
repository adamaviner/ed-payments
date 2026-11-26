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
import { cheaperCardProcessor, DEFAULT_FEE_RATES, feeRates, feeSchedule, type CardProcessorChoice, type FeeRates, type FeeRatesInput, type FeeSchedule } from '../core/fees.js'
import { PAYPAL_LIVE_API, PAYPAL_SANDBOX_API, paypalToken, paypalTokenOf, type PaypalKeys, type PaypalOrder } from '../core/paypal.js'
import type { StripeKeys, StripeSession } from '../core/stripe.js'
import { METHOD_NOT_SAVED } from '../core/declines.js'
import { accountFingerprint, decryptToken, encryptToken } from '../core/tokenCrypt.js'
import { ProcessorError, type Fetch, type Method, type Payer, type Processor, type Ref, type SavedMethodKind } from '../core/types.js'
import { adminApi, publicApi, worker, type AdminApiOptions } from './api.js'
import { mismatch } from './context.js'
import { paypalHistory, type PaypalHistory, type PaypalHistoryArgs, type PaypalHistoryLine } from './paypalHistory.js'
import { reconcile, type ReconcileResult } from './reconcile.js'
import { chargeNow, removeSavedMethod, retryOnSession, retryWithPaypal, savedMethods, setupPaymentMethod, verifyMethodOwner, type SavedMethod, type VerifiedMethod } from './saved.js'
import { savePaypalMethod, setupPaypalMethod } from './paypalVault.js'
import { runSchedules, startSchedule, startScheduleCheckout, updateSchedule, type ScheduleView, type StartScheduleArgs, type StartScheduleCheckoutArgs } from './schedules.js'
import { cleanPayer } from './util.js'
import {
  callbackArgs,
  paidReturns,
  type Dispute,
  type Failed,
  type IssuesDigest,
  type Paid,
  type PaidResult,
  type Processing,
  type RefundNeeded,
  type Refunded,
  type ScheduleChanged,
  type ScheduleCharged,
  type ScheduleFailed,
} from './validators.js'
import { handlePaypalWebhook, handleStripeWebhook, type UnhandledStripeEvent } from './webhooks.js'
import * as hosted from './hosted.js'
import * as refunds from './refunds.js'
import * as sweep from './sweep.js'

export type {
  ComponentApi,
  PaypalHistory,
  PaypalHistoryArgs,
  PaypalHistoryLine,
  ReconcileResult,
  UnhandledStripeEvent,
  SavedMethod,
  VerifiedMethod,
  AdminApiOptions,
  ScheduleView,
  StartScheduleArgs,
  StartScheduleCheckoutArgs,
}
export * from './validators.js'
export { fromEnv, isLive, stripeProblems, paypalProblems, type KeySource, type Problem } from './env.js'
export { PAYPAL_LIVE_API, PAYPAL_SANDBOX_API }
export { errorText, PAYPAL_DECLINED, refundKey } from './util.js'

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
  /** Per key (the host's limitKey, else the signed-in user, else the payer's email or the owner), per window. Default 5. */
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
  /**
   * Schedules (monthly charges): the hour (UTC) charges are made, default 15 (10 or 11 in the morning
   * in New York), and the days after a period's first refusal it is tried again, default [3, 5, 7];
   * after the last, the schedule lapses. Hard declines aren't retried.
   */
  schedules?: { hourUTC?: number; retryDays?: number[] }
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
  /** Only for schedules (all three, then): a period's charge was paid. */
  scheduleCharged?: Internal<ScheduleCharged<T>>
  /** A schedule's charge was refused: retried later, or (final) the schedule lapsed. */
  scheduleFailed?: Internal<ScheduleFailed<T>>
  /** A schedule started, never started, or was changed (amount, method, day, pause, resume, cancel), by the app or the processor. */
  scheduleChanged?: Internal<ScheduleChanged<T>>
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
  /** Only for schedules: the hourly run (registerCrons adds it when the schedule callbacks are wired). */
  schedules?: FunctionReference<'action', 'internal', { scheduleId?: string }, null>
}

export interface PaymentsWiring<T> {
  on: PaymentCallbacks<T>
  /**
   * The app's own permission checks, as internal queries returning { name } or null (refused).
   * `auth` is whatever the caller passed to the generated function (ed-schedule: its session token);
   * apps that use Convex auth ignore it, as the caller's identity carries through.
   */
  authorize: {
    /** May approve, send and record refunds, resolve issues, retry charges: { name } or null. */
    admin: FunctionReference<'query', 'internal', { auth?: unknown }, Who | null>
    /**
     * May see the payments and ask for a refund, nothing more (e.g. staff, beside admins who approve
     * and send). Without it only admins may ask.
     */
    request?: FunctionReference<'query', 'internal', { auth?: unknown }, Who | null>
    /**
     * Asked right before a refund is approved or sent: null to go ahead, or a sentence saying why not
     * (e.g. "Confirm with your passkey first."), which refuses it with code 'step_up' so the page can
     * ask for the check and try again. For a fresh passkey check, or any second step.
     */
    stepUp?: FunctionReference<'query', 'internal', { auth?: unknown; action: 'approve' | 'send'; refundId: string }, string | null>
  }
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
   * with `PaypalButtons` or `StripeEmbeddedCheckout` from `@earthdance/payments/react`. onPage: a new
   * payment made when the payer presses pay on the app's own form (a Stripe PaymentIntent for the
   * method chosen, confirmed by the Payment Element in deferred-intent mode; or a PayPal order like
   * embedded's, for Card Fields or the PayPal button). Either way the buyer ends on returnPath (Stripe
   * adds payment_intent after a redirect such as 3-D Secure) and the webhooks settle the payment.
   */
  ui?: StartUi
  /**
   * With ui: 'onPage', the checkout id the payer's last press started. While that checkout is an unpaid on-page one for
   * the same ref and purpose, amount, processor, method, payer, description, context, return page and schedule (or none),
   * with ten minutes or more left, it is returned again and no start is counted. Otherwise one for the same ref and
   * purpose is cancelled (its start given back) and a new one started; one for another thing is left alone. A paid or
   * processing one for the same ref and purpose is refused ("This is already paid."). Each press with it counts against
   * a separate 'replace' limit. Two presses naming the same checkout make one new checkout: the later one gets it back.
   */
  replaces?: string
}

export type StartUi = 'redirect' | 'embedded' | 'onPage'

/**
 * What the browser needs to confirm an on-page payment at the payer's press. Stripe: the PaymentIntent's client
 * secret for the Payment Element in deferred-intent mode (saved for later on a schedule's first payment). PayPal:
 * the order Card Fields (or the PayPal button) pays, as for embedded.
 */
export type OnPagePayment = { processor: 'stripe'; clientSecret: string; returnUrl: string } | { processor: 'paypal'; orderId: string; clientId: string; returnUrl: string; only?: 'card' | 'paypal' }

export interface StartedOnPage {
  checkoutId: string
  onPage: OnPagePayment
  /** True when the checkout given in replaces was returned again. */
  reused: boolean
}

/** What the browser needs to show an embedded checkout. */
export type EmbeddedPayment =
  /** For Stripe.js's createEmbeddedCheckoutPage, with the app's publishable key. Stripe sends the buyer to returnPath when paid. */
  | { processor: 'stripe'; clientSecret: string }
  /**
   * For PayPal's buttons: the order the buttons pay, the REST app's client id (public; it also says
   * sandbox or live), and where to go once paid (returnPath with PayPal's token, as a redirect would).
   */
  | {
      processor: 'paypal'
      orderId: string
      clientId: string
      returnUrl: string
      /**
       * An order that saves its method for a schedule can only be paid one way: 'paypal' with
       * PaypalButtons (the PayPal button alone), 'card' with PaypalCardPayment (PayPal's Card Fields).
       */
      only?: 'card' | 'paypal'
    }

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

/** Where an off-session charge of a saved method goes. */
type ChargeTarget = { processor: Processor; method: Method; stripeCustomerId?: string }

export type CheckoutView = FunctionReturnType<ComponentApi['checkouts']['get']>
export type Checkout = NonNullable<CheckoutView>
export type CheckoutStatus = Checkout['status']
export type RefundView = FunctionReturnType<ComponentApi['refunds']['forCheckout']>[number]
export type IssueView = FunctionReturnType<ComponentApi['issues']['list']>['page'][number]

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

  /**
   * Where a card for a charge of this amount should be saved or paid: the processor with the lower fee
   * at this app's rates (Stripe on a tie), with both fees. Only a processor the deployment has keys
   * for is chosen.
   */
  cardProcessorFor(amountCents: number): CardProcessorChoice {
    const choice = cheaperCardProcessor(amountCents, this.fees)
    const has = { stripe: !!this.options.stripe?.()?.secretKey, paypal: !!this.options.paypal?.()?.clientId }
    if (!has[choice.processor] && has[choice.processor === 'stripe' ? 'paypal' : 'stripe']) return { ...choice, processor: choice.processor === 'stripe' ? 'paypal' : 'stripe' }
    return choice
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

  /**
   * @internal The rate-limit keys of one public call: the host's own `limitKey` when it gives one, else
   * the signed-in user, else `fallbackKey` (e.g. the payer's email); and everyone together.
   */
  async limits(ctx: { auth?: AuthLike }, entry: string, fallbackKey: string | undefined, scale = 1, limitKey?: string) {
    const l = this.options.limits
    if (l === false) return undefined
    const identity = limitKey?.trim() || !ctx.auth ? null : await ctx.auth.getUserIdentity()
    const own = limitKey?.trim() || (identity ? null : fallbackKey?.trim())
    const who = own ? `key:${own.toLowerCase()}` : identity ? `user:${identity.subject}` : null
    const perKey = (l?.perKey ?? 5) * scale
    const windowMs = (l?.windowMinutes ?? 10) * 60_000
    const global = { key: `${this.app}:${entry}:all`, max: (l?.globalPerMinute ?? 30) * scale, windowMs: 60_000, message: 'Too many payments are being started right now. Try again in a minute.' }
    return who ? [global, { key: `${this.app}:${entry}:${who}`, max: perKey, windowMs, message: 'Too many tries just now. Try again in a few minutes.' }] : [global]
  }

  /** @internal */
  async takeLimits(ctx: RunMutationCtx & { auth?: AuthLike }, entry: string, fallbackKey: string | undefined, scale = 1, limitKey?: string) {
    const limits = await this.limits(ctx, entry, fallbackKey, scale, limitKey)
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
   * `ui: 'embedded'` what the app's page needs to show it, or with `ui: 'onPage'` what the app's
   * form needs to confirm it (see replaces). Rate-limited per signed-in user (else per payer email,
   * or limitKey) and overall; a reused checkout counts nothing.
   */
  async start(ctx: RunActionCtx, a: StartArgs<Infer<C>> & { ui: 'onPage' }): Promise<StartedOnPage>
  async start(ctx: RunActionCtx, a: StartArgs<Infer<C>> & { ui: 'embedded' }): Promise<StartedEmbedded>
  async start(ctx: RunActionCtx, a: StartArgs<Infer<C>> & { ui?: 'redirect' }): Promise<StartedRedirect>
  async start(ctx: RunActionCtx, a: StartArgs<Infer<C>>): Promise<StartedRedirect | StartedEmbedded | StartedOnPage>
  async start(ctx: RunActionCtx, a: StartArgs<Infer<C>>): Promise<StartedRedirect | StartedEmbedded | StartedOnPage> {
    return await hosted.start(this, ctx, a)
  }

  /** @internal See hosted.ts. */
  async begin(
    ctx: RunActionCtx,
    a: StartArgs<Infer<C>>,
    save?: { scheduleId: string; schedulePeriod: string; stripeCustomerId?: string; paypalCustomerId?: string },
  ): Promise<StartedRedirect | StartedEmbedded | StartedOnPage | hosted.Replaced> {
    return await hosted.begin(this, ctx, a, save)
  }

  /** @internal See hosted.ts. */
  async settleStripeSession(ctx: RunActionCtx, checkoutId: string, s: StripeSession) {
    return await hosted.settleStripeSession(this, ctx, checkoutId, s)
  }

  /** @internal See hosted.ts. */
  async settlePaypalOrder(ctx: RunActionCtx, checkoutId: string, order: PaypalOrder) {
    return await hosted.settlePaypalOrder(this, ctx, checkoutId, order)
  }

  /** @internal See hosted.ts. */
  async saveForSchedule(ctx: RunActionCtx, checkoutId: string, from: { stripePaymentIntent?: string; paypalOrder?: PaypalOrder }) {
    return await hosted.saveForSchedule(this, ctx, checkoutId, from)
  }

  /** @internal See hosted.ts. */
  async capturePaypal(ctx: RunActionCtx, checkoutId: string, orderId: string, by: 'buyer' | 'background'): Promise<'declined' | 'reordered' | undefined> {
    return await hosted.capturePaypal(this, ctx, checkoutId, orderId, by)
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
  async completeReturn(
    ctx: RunActionCtx,
    { processor, token }: { processor: Processor; token: string },
  ): Promise<{ checkoutId: string; ref: Ref; purpose: string; status: CheckoutStatus; declined?: true; reordered?: true } | null> {
    return await hosted.completeReturn(this, ctx, { processor, token })
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
    return await hosted.cancel(this, ctx, checkoutId, o)
  }

  // ── Saved payment methods ─────────────────────────────────────────────────────────────────────

  /**
   * Starts saving a card or bank account for `owner` (e.g. { type: 'user', id }): makes their Stripe
   * Customer if needed and a SetupIntent for charging later with nobody present (bank accounts
   * verified at once). Returns its client secret for Stripe's Payment Element. Rate-limited, so call
   * it when the payer submits the form (`<StripeSaveMethod createSetupIntent>`), never when it opens.
   */
  async setupPaymentMethod(
    ctx: RunActionCtx,
    a: { owner: Ref; payer: Payer; stripeCustomerId?: string; methods?: readonly SavedMethodKind[]; limitKey?: string },
  ): Promise<{ clientSecret: string; stripeCustomerId: string }> {
    return await setupPaymentMethod(this, ctx, a)
  }

  /**
   * Starts saving a card or PayPal account in PayPal's vault for `owner`: a setup token for PayPal's
   * Card Fields (`PaypalCardFields`) or its PayPal button (`PaypalSaveButton`) in the browser, with the
   * REST app's client id. A card is checked when saved ($0 authorization; 3-D Secure only if the bank
   * asks). `description` is what a PayPal account holder agrees to. Rate-limited.
   */
  async setupPaypalMethod(
    ctx: RunActionCtx,
    a: { owner: Ref; payer: Payer; kind: 'card' | 'paypal'; description?: string; /** For a schedule: a PayPal account agrees to recurring charges. */ recurring?: boolean; limitKey?: string },
  ): Promise<{ setupTokenId: string; clientId: string }> {
    return await setupPaypalMethod(this, ctx, a)
  }

  /**
   * Saves what the buyer approved a setup token with (the browser component's onSaved gives its id),
   * refusing a token made for someone else or a card whose check failed. Returns the saved method,
   * charged later with chargeSaved like a Stripe one. Rate-limited.
   */
  async savePaypalMethod(
    ctx: RunActionCtx,
    a: { owner: Ref; setupTokenId: string; payerEmail?: string; /** As given to setupPaypalMethod. */ recurring?: boolean; limitKey?: string },
  ): Promise<SavedMethod> {
    return await savePaypalMethod(this, ctx, a)
  }

  /** The owner's saved cards, bank accounts and PayPal accounts at both processors, newest first, each with whether a charge of it was declined. Rate-limited. */
  async savedMethods(ctx: RunActionCtx, a: { owner: Ref; stripeCustomerId?: string; limitKey?: string }): Promise<SavedMethod[]> {
    return await savedMethods(this, ctx, a)
  }

  /**
   * Checks that a payment method id (from the browser) is one saved for this owner, at Stripe or in
   * PayPal's vault, and returns it; anything else throws, so nobody can pay with a made-up or someone
   * else's method. Rate-limited.
   */
  async verifyMethodOwner(ctx: RunActionCtx, a: { owner: Ref; paymentMethodId: string; stripeCustomerId?: string; limitKey?: string }): Promise<VerifiedMethod> {
    return await verifyMethodOwner(this, ctx, a)
  }

  /**
   * The owner removes one of their saved methods (checked to be theirs): deleted from PayPal's vault
   * or detached from their Stripe Customer, and never offered or charged again. Whether it may go
   * (e.g. a bid still relies on it) is the app's to check first. Rate-limited.
   */
  async removeSavedMethod(ctx: RunActionCtx, a: { owner: Ref; paymentMethodId: string; stripeCustomerId?: string; limitKey?: string }): Promise<void> {
    await removeSavedMethod(this, ctx, a)
  }

  /**
   * Charges a saved method with nobody present, from a mutation or action: records the checkout and
   * queues the charge (payments.worker().charge). A card that needs the buyer to authenticate is
   * refused rather than left waiting. Outcomes come back through the callbacks: paid; processing then
   * paid or failed for a bank account; failed (declined: true) when the bank says no. A charge whose
   * outcome is unknown is tried again a few times under the same key, then left for a person as a
   * charge_unknown issue. Same idempotencyKey, same checkout. Returns the checkout id.
   *
   * A method that isn't saved for the payer (another owner's, or an owner with nothing saved here)
   * isn't thrown: the checkout is recorded failed at once (declineCode METHOD_NOT_SAVED, declined
   * false, nothing charged) and failed runs in that transaction, so the payer can pay with
   * retryOnSession / retryWithPaypal. A bad amount, key or context still throws.
   */
  async chargeSaved(ctx: SchedulerCtx, a: ChargeArgs<Infer<C>>): Promise<string> {
    return await this.chargeOffSession(ctx, a)
  }

  /** @internal chargeSaved, and a schedule's charge (tagged with the schedule and the period it pays). */
  async chargeOffSession(ctx: SchedulerCtx, a: ChargeArgs<Infer<C>>, schedule?: { scheduleId: string; schedulePeriod: string }): Promise<string> {
    if (!Number.isInteger(a.amountCents) || a.amountCents < 1) throw new ConvexError('A charge needs an amount of at least one cent.')
    if (!a.idempotencyKey || a.idempotencyKey.length > 200) throw new ConvexError('A charge needs an idempotency key of at most 200 characters.')
    this.checkContext(a.context)
    const existing = await ctx.runQuery(this.component.checkouts.byChargeKey, { chargeKey: `${this.app}:${a.idempotencyKey}` })
    if (existing) {
      if (existing.amountCents !== a.amountCents || existing.paymentMethodId !== a.paymentMethodId || existing.ref.type !== a.ref.type || existing.ref.id !== a.ref.id)
        throw new ConvexError('That idempotency key was already used for a different charge (another amount, payment method or thing paid for).')
      return existing.id
    }
    const target = await this.savedTarget(ctx, a)
    // A schedule checks its method when it starts or changes; there a method not saved stays a refusal.
    if ('notSaved' in target && schedule) throw new ConvexError(target.notSaved)
    // Recorded as a failed charge rather than thrown, so the app's failed path runs and the payer can pay on its page (retryOnSession / retryWithPaypal).
    const failed = 'notSaved' in target ? { reason: target.notSaved, declineCode: METHOD_NOT_SAVED } : undefined
    const now = Date.now()
    const site = this.url('/')
    const made = await ctx.runMutation(this.component.checkouts.createCharge, {
      app: this.app,
      ref: a.ref,
      purpose: a.purpose,
      description: a.description,
      amountCents: a.amountCents,
      processor: target.processor,
      method: target.method,
      kind: 'offSession',
      payer: cleanPayer(a.payer),
      returnUrl: site,
      cancelUrl: site,
      // Never given up by time: an off-session charge ends paid, failed or by a person's decision.
      expiresAt: now + 3650 * 24 * 60 * 60_000,
      context: a.context,
      callbacks: await this.handles(),
      stripeCustomerId: target.stripeCustomerId,
      paymentMethodId: a.paymentMethodId,
      chargeKey: `${this.app}:${a.idempotencyKey}`,
      ...(schedule ?? {}),
      failed,
      now,
    })
    // Made by a call racing this one: that call queued the charge.
    if (made.created && !failed) await ctx.scheduler.runAfter(0, this.wiring.worker.charge, { checkoutId: made.id })
    return made.id
  }

  /** @internal Which processor charges a saved method: PayPal's must be the owner's, recorded here; Stripe's need the owner's Customer. */
  async chargeTarget(ctx: RunQueryCtx, a: { owner: Ref; paymentMethodId: string; stripeCustomerId?: string }): Promise<ChargeTarget> {
    const target = await this.savedTarget(ctx, a)
    if ('notSaved' in target) throw new ConvexError(target.notSaved)
    return target
  }

  /** chargeTarget, saying why when the method isn't saved for the owner (with the processor it would have been). */
  private async savedTarget(ctx: RunQueryCtx, a: { owner: Ref; paymentMethodId: string; stripeCustomerId?: string }): Promise<ChargeTarget | (ChargeTarget & { notSaved: string })> {
    const tokenId = paypalTokenOf(a.paymentMethodId)
    if (tokenId) {
      const found = await ctx.runQuery(this.component.customers.paypalMethod, { paymentTokenId: tokenId })
      if (!found || found.app !== this.app || found.owner.type !== a.owner.type || found.owner.id !== a.owner.id)
        return { processor: 'paypal', method: 'card', notSaved: 'That payment method isn’t saved for this payer.' }
      return { processor: 'paypal', method: found.method.kind }
    }
    const customer = await ctx.runQuery(this.component.customers.byOwner, { app: this.app, owner: a.owner })
    const stripeCustomerId = customer?.stripeCustomerId ?? a.stripeCustomerId
    if (!stripeCustomerId) return { processor: 'stripe', method: 'card', notSaved: 'This payer has no saved payment method here.' }
    const method = await ctx.runQuery(this.component.customers.method, { stripePaymentMethodId: a.paymentMethodId })
    return { processor: 'stripe', method: method?.kind ?? 'card', stripeCustomerId }
  }

  /** @internal Makes (or retries) an off-session charge; payments.worker().charge runs this. */
  async charge(ctx: RunActionCtx & { scheduler: Scheduler }, checkoutId: string, manual = false): Promise<void> {
    await chargeNow(this, ctx, checkoutId, manual)
  }

  /**
   * For the buyer to pay on the app's page after an off-session charge failed: a PaymentIntent
   * (card or bank account, theirs to choose in the Payment Element) for the same amount, its outcome
   * coming back through the same callbacks with kind 'onSession'. One that is still waiting is
   * reused, so two tabs can't each take a payment; one already on its way is refused. Rate-limited, so
   * call it when the buyer presses Pay (`<StripeRetryPayment createPayment>`), not when the page opens.
   */
  async retryOnSession(ctx: RunActionCtx, a: { checkoutId: string; expiresAt?: number; limitKey?: string }): Promise<{ checkoutId: string; clientSecret: string }> {
    return await retryOnSession(this, ctx, a)
  }

  /**
   * The same, paid with PayPal's buttons on the app's page (`PaypalButtons` with the `embedded` it
   * returns): a PayPal account or a card. Only one retry is open at a time, so asking for PayPal
   * closes an unpaid Stripe one and the other way round. `returnPath` is where the buttons send the
   * buyer once paid (with PayPal's token, for completeReturn). Rate-limited.
   */
  async retryWithPaypal(
    ctx: RunActionCtx,
    a: { checkoutId: string; returnPath: string; expiresAt?: number; limitKey?: string },
  ): Promise<{ checkoutId: string; embedded: Extract<EmbeddedPayment, { processor: 'paypal' }> }> {
    return await retryWithPaypal(this, ctx, a)
  }

  // ── Schedules ─────────────────────────────────────────────────────────────────────────────────

  /**
   * Charges a saved method every month: the first charge now (or at firstChargeAt), then on the
   * anchor day, each an off-session checkout keyed `schedule-<id>-<period>` with the usual callbacks
   * plus scheduleCharged / scheduleFailed. Refusals are retried (retryDays, default 3, 5 and 7 days
   * after the first), then the schedule lapses; hard declines lapse it at once. From a mutation or
   * action. Returns the schedule id and the first charge's checkout id when it was made now.
   */
  async startSchedule(ctx: SchedulerCtx, a: StartScheduleArgs<Infer<C>>): Promise<{ scheduleId: string; checkoutId: string | null }> {
    return await startSchedule(this, ctx, a)
  }

  /**
   * A schedule for a new payer, its first payment saving the method: Stripe's embedded Checkout
   * (card or bank account, saved with setup_future_usage; Checkout tells the payer, and shows a
   * bank account's mandate), or with ui: 'onPage' a PaymentIntent for the Customer saved the same
   * way (the Payment Element shows the wording; replaces reuses the last press's checkout and schedule) or PayPal (a PayPal account agreeing to recurring charges with
   * PaypalButtons, or a card in PaypalCardPayment, saved with vault-with-purchase). The app picks the
   * processor (e.g. the cheaper for the monthly amount). The schedule starts when that payment is
   * paid (or on its way, for a bank account); if it never is, scheduleChanged says not_started.
   * Rate-limited like start.
   */
  async startScheduleCheckout(ctx: RunActionCtx, a: StartScheduleCheckoutArgs<Infer<C>> & { ui: 'onPage' }): Promise<StartedOnPage & { scheduleId: string }>
  async startScheduleCheckout(ctx: RunActionCtx, a: StartScheduleCheckoutArgs<Infer<C>> & { ui?: 'embedded' | 'redirect' }): Promise<(StartedRedirect | StartedEmbedded) & { scheduleId: string }>
  async startScheduleCheckout(ctx: RunActionCtx, a: StartScheduleCheckoutArgs<Infer<C>>): Promise<(StartedRedirect | StartedEmbedded | StartedOnPage) & { scheduleId: string }>
  async startScheduleCheckout(ctx: RunActionCtx, a: StartScheduleCheckoutArgs<Infer<C>>): Promise<(StartedRedirect | StartedEmbedded | StartedOnPage) & { scheduleId: string }> {
    return await startScheduleCheckout(this, ctx, a)
  }

  /**
   * Changes a schedule: the amount (from the next charge), the saved method (one of the owner's,
   * checked as for chargeSaved), the day of the month, the description. A new method on a schedule
   * being retried charges the refused period at once; on a lapsed one it starts again.
   */
  async updateSchedule(
    ctx: RunMutationCtx,
    a: { scheduleId: string; amountCents?: number; paymentMethodId?: string; stripeCustomerId?: string; anchorDay?: number; description?: string; by?: string },
  ): Promise<ScheduleView> {
    return await updateSchedule(this, ctx, a)
  }

  /** Skips charges until `until` (ms); the first charge date after that charges again, by itself. */
  async pauseSchedule(ctx: RunMutationCtx, a: { scheduleId: string; until: number; by?: string }): Promise<ScheduleView> {
    return await ctx.runMutation(this.component.schedules.pause, { id: a.scheduleId, app: this.app, until: a.until, by: a.by, now: Date.now() })
  }

  /** A paused or lapsed schedule charges again, from `at` (default now) on its next charge date. */
  async resumeSchedule(ctx: RunMutationCtx, a: { scheduleId: string; at?: number; by?: string }): Promise<ScheduleView> {
    return await ctx.runMutation(this.component.schedules.resume, { id: a.scheduleId, app: this.app, at: a.at, by: a.by, now: Date.now() })
  }

  /** Ends a schedule for good (a charge already on its way still settles). */
  async cancelSchedule(ctx: RunMutationCtx, a: { scheduleId: string; reason: string; by?: string }): Promise<ScheduleView> {
    return await ctx.runMutation(this.component.schedules.cancel, { id: a.scheduleId, app: this.app, reason: a.reason, by: a.by, now: Date.now() })
  }

  /** An owner's schedules, newest first, ended ones included. */
  async schedulesFor(ctx: RunQueryCtx, owner: Ref): Promise<ScheduleView[]> {
    return await ctx.runQuery(this.component.schedules.forOwner, { app: this.app, owner })
  }

  /** The schedules for one thing in the app, newest first. */
  async schedulesForRef(ctx: RunQueryCtx, ref: Ref): Promise<ScheduleView[]> {
    return (await ctx.runQuery(this.component.schedules.forRef, { ref })).filter((s) => s.app === this.app)
  }

  /** One schedule, or null (also for another app's). */
  async getSchedule(ctx: RunQueryCtx, scheduleId: string) {
    const s = await ctx.runQuery(this.component.schedules.get, { id: scheduleId })
    return s && s.app === this.app ? s : null
  }

  /** @internal The hourly run; payments.worker().schedules runs this. */
  async runSchedules(ctx: SchedulerCtx, o: { scheduleId?: string } = {}) {
    return await runSchedules(this, ctx, o)
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
    return await refunds.sendRefund(this, ctx, refundId, o)
  }

  /** @internal See refunds.ts. */
  async pushRefund(ctx: RunActionCtx, r: { refundId: string; key: string; processor: Processor; paymentRef: string; amountCents: number }) {
    return await refunds.pushRefund(this, ctx, r)
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
    return await sweep.sweep(this, ctx)
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

  /**
   * The PayPal account's history for one email, newest first: every transaction in the range whose
   * other party is that address (payments in, refunds and payments out), not only this library's.
   * Needs Transaction Search on the REST app; PayPal keeps three years, and is up to three hours late.
   */
  async paypalHistory(ctx: RunActionCtx, a: PaypalHistoryArgs): Promise<PaypalHistory> {
    return await paypalHistory(this, ctx, a)
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
    // The worker is usually a module reference (internal.payments), on which every name exists, so
    // whether the app uses schedules is read from the callbacks it wrote out, not from w.schedules.
    const on = this.wiring.on
    if (w.schedules && on.scheduleCharged && on.scheduleFailed && on.scheduleChanged) crons.hourly('payments schedules', { minuteUTC: 5 }, w.schedules, {})
  }
}

const defaultSiteUrl = () => {
  const url = typeof process === 'undefined' ? undefined : process.env.SITE_URL
  if (!url) throw new Error('SITE_URL isn’t set on this deployment (or pass siteUrl to definePayments).')
  return url
}

/** For the validators of the app's worker functions. */
export const workerArgs = { charge: { checkoutId: v.string(), manual: v.optional(v.boolean()) }, schedules: { scheduleId: v.optional(v.string()) } }
