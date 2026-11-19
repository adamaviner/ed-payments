// Stripe over plain fetch: form-encoded requests with a pinned API version and idempotency keys,
// the few object shapes the library reads, and webhook signatures checked with Web Crypto. No SDK,
// so this runs in Convex's default runtime and in tests.
// Request shapes follow https://docs.stripe.com/api for API version 2026-10-28.endive (looked up
// 2026-11-16). That version removed `payment_method_types` from Checkout Sessions, so the method is
// chosen with `allowed_payment_method_types`, which only offers methods enabled in the Dashboard.
import { ProcessorError, type Fetch, type Method } from './types.js'

export const STRIPE_API_VERSION = '2026-10-28.endive'
export const STRIPE_API_BASE = 'https://api.stripe.com'

export interface StripeKeys {
  secretKey: string
  webhookSecret: string
}

type FormValue = string | number | boolean | null | undefined | FormParams | FormValue[]
export interface FormParams {
  [key: string]: FormValue
}

/** Stripe's form encoding: nested objects as a[b], arrays as a[0]; undefined is left out. */
export function formEncode(params: FormParams): string {
  const parts: string[] = []
  const add = (name: string, value: FormValue) => {
    if (value === undefined) return
    if (Array.isArray(value)) value.forEach((item, i) => add(`${name}[${i}]`, item))
    else if (value !== null && typeof value === 'object') for (const [k, v] of Object.entries(value)) add(`${name}[${k}]`, v)
    else parts.push(`${encodeURIComponent(name)}=${encodeURIComponent(value === null ? '' : String(value))}`)
  }
  for (const [k, v] of Object.entries(params)) add(k, v)
  return parts.join('&')
}

export interface StripeCallOptions {
  fetch: Fetch
  idempotencyKey?: string
  /** Defaults to Stripe's API; tests and proxies may change it. */
  apiBase?: string
}

/** One Stripe API call; an error answer becomes a ProcessorError with Stripe's message and code. */
export async function stripeCall<T>(keys: Pick<StripeKeys, 'secretKey'>, method: 'GET' | 'POST' | 'DELETE', path: string, params: FormParams | undefined, o: StripeCallOptions): Promise<T> {
  const headers: Record<string, string> = { Authorization: `Bearer ${keys.secretKey}`, 'Stripe-Version': STRIPE_API_VERSION }
  let url = `${o.apiBase ?? STRIPE_API_BASE}${path}`
  let body: string | undefined
  const encoded = params ? formEncode(params) : ''
  if (method !== 'POST') {
    if (encoded) url += `?${encoded}`
  } else {
    body = encoded
    headers['Content-Type'] = 'application/x-www-form-urlencoded'
    if (o.idempotencyKey) headers['Idempotency-Key'] = o.idempotencyKey
  }
  let res: Response
  try {
    res = await o.fetch(url, { method, headers, body })
  } catch (err) {
    throw new ProcessorError('stripe', 0, `Stripe couldn’t be reached: ${err instanceof Error ? err.message : String(err)}`)
  }
  const json: unknown = await res.json().catch(() => null)
  if (!res.ok) {
    const error = (json as { error?: StripeErrorBody } | null)?.error
    const pi = error?.payment_intent
    throw new ProcessorError('stripe', res.status, error?.message ?? `Stripe answered ${res.status}.`, error?.code, {
      type: error?.type,
      declineCode: error?.decline_code,
      paymentIntent: pi && typeof pi.id === 'string' ? { id: pi.id, status: String(pi.status) } : undefined,
    })
  }
  return json as T
}

/** Stripe's error object (https://docs.stripe.com/api/errors): a refused confirm carries the PaymentIntent it refused. */
interface StripeErrorBody {
  type?: string
  code?: string
  decline_code?: string
  message?: string
  payment_intent?: { id?: string; status?: string }
}

// ── The objects the library reads (only those fields) ─────────────────────────────────────────

export type Metadata = Record<string, string>

export interface StripeBalanceTransaction {
  id: string
  fee: number
}

export interface StripeCharge {
  id: string
  object: 'charge'
  amount: number
  amount_refunded: number
  refunded: boolean
  payment_intent: string | null
  balance_transaction: string | StripeBalanceTransaction | null
  metadata: Metadata | null
}

export type StripePaymentIntentStatus = 'requires_payment_method' | 'requires_confirmation' | 'requires_action' | 'processing' | 'requires_capture' | 'canceled' | 'succeeded'

export interface StripePaymentIntent {
  id: string
  object: 'payment_intent'
  amount: number
  amount_received: number
  status: StripePaymentIntentStatus
  metadata: Metadata | null
  latest_charge: string | StripeCharge | null
  /** For the browser's Payment Element only; never stored or logged. */
  client_secret?: string | null
  customer?: string | { id: string } | null
  payment_method?: string | StripePaymentMethod | null
  last_payment_error?: { message?: string; code?: string; decline_code?: string } | null
  created: number
}

export interface StripeCustomer {
  id: string
  object: 'customer'
  email: string | null
  metadata: Metadata | null
}

export interface StripePaymentMethod {
  id: string
  object: 'payment_method'
  type: string
  customer: string | { id: string } | null
  card?: { brand: string; last4: string; exp_month?: number; exp_year?: number } | null
  us_bank_account?: { bank_name: string | null; last4: string | null } | null
  created: number
}

export interface StripeSetupIntent {
  id: string
  object: 'setup_intent'
  status: string
  /** For the browser's Payment Element only; never stored or logged. */
  client_secret: string | null
  customer: string | { id: string } | null
  payment_method: string | null
  usage: string
  metadata: Metadata | null
}

export interface StripeWebhookEndpoint {
  id: string
  object: 'webhook_endpoint'
  url: string
  enabled_events: string[]
  status: string
  api_version: string | null
  description: string | null
  /** Only in the answer to creating it. */
  secret?: string
}

export interface StripeSession {
  id: string
  object: 'checkout.session'
  /** Stripe's page; null for an embedded session. */
  url: string | null
  /** An embedded session's, for Stripe.js in the buyer's browser. */
  client_secret?: string | null
  status: 'open' | 'complete' | 'expired' | null
  payment_status: 'paid' | 'unpaid' | 'no_payment_required'
  payment_intent: string | StripePaymentIntent | null
  amount_total: number | null
  client_reference_id: string | null
  metadata: Metadata | null
  created: number
  expires_at: number
  livemode: boolean
}

export interface StripeRefund {
  id: string
  object: 'refund'
  amount: number
  status: 'pending' | 'requires_action' | 'succeeded' | 'failed' | 'canceled' | null
  payment_intent: string | null
  charge: string | null
  metadata: Metadata | null
  failure_reason?: string | null
  created: number
}

export interface StripeDispute {
  id: string
  object: 'dispute'
  amount: number
  status: string
  reason: string
  charge: string
  payment_intent: string | null
}

export interface StripeList<T> {
  object: 'list'
  data: T[]
  has_more: boolean
}

export interface StripeEvent {
  id: string
  object: 'event'
  type: string
  created: number
  livemode: boolean
  api_version: string | null
  data: { object: { id: string; object: string } & Record<string, unknown> }
}

const idOf = (x: string | { id: string } | null | undefined) => (x === null || x === undefined ? null : typeof x === 'string' ? x : x.id)

/** The PaymentIntent id a session, charge, refund or dispute points at. */
export const paymentIntentId = (x: { payment_intent: string | { id: string } | null }) => idOf(x.payment_intent)

// ── Requests ───────────────────────────────────────────────────────────────────────────────────

export interface SessionInput {
  app: string
  checkoutId: string
  description: string
  amountCents: number
  method: Extract<Method, 'card' | 'ach'>
  email?: string
  successUrl: string
  cancelUrl: string
  /** When the session stops taking payment, ms. Stripe allows 30 minutes to 24 hours; clamped inside that. */
  expiresAt: number
  now: number
  /**
   * Shown inside the app's page (Stripe.js createEmbeddedCheckoutPage) instead of on Stripe's own. Such a
   * session has no cancel page (the buyer is still on the app's) and sends the buyer to successUrl when paid.
   */
  embedded?: boolean
}

const MIN_EXPIRY_MS = 31 * 60_000
const MAX_EXPIRY_MS = 24 * 60 * 60_000 - 60_000

/** Unix seconds within Stripe's 30 minute to 24 hour window (a minute's margin each side). */
export function sessionExpiry(expiresAt: number, now: number): number {
  return Math.floor(Math.min(Math.max(expiresAt, now + MIN_EXPIRY_MS), now + MAX_EXPIRY_MS) / 1000)
}

/** The Checkout Session for one checkout, tagged with the app (client_reference_id and metadata on the session and its PaymentIntent). */
export function sessionParams(i: SessionInput): FormParams {
  const metadata = { app: i.app, checkoutId: i.checkoutId }
  return {
    mode: 'payment',
    allowed_payment_method_types: [i.method === 'ach' ? 'us_bank_account' : 'card'],
    customer_email: i.email,
    client_reference_id: i.checkoutId,
    metadata,
    payment_intent_data: { metadata, description: i.description.slice(0, 1000) },
    line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: i.amountCents, product_data: { name: i.description.slice(0, 250) || 'Payment' } } }],
    expires_at: sessionExpiry(i.expiresAt, i.now),
    // Since 2026-10-28.endive the embedded value is `embedded_page` (`embedded` answers 400).
    ...(i.embedded ? { ui_mode: 'embedded_page', return_url: i.successUrl } : { success_url: i.successUrl, cancel_url: i.cancelUrl }),
  }
}

type Keys = Pick<StripeKeys, 'secretKey'>

/**
 * What a saved method may be: a card or a US bank account. Since 2026-09-30.endive PaymentIntents and
 * SetupIntents take `allowed_payment_method_types` (`payment_method_types` answers 400
 * payment_method_types_no_longer_supported); Stripe drops a listed type the account hasn't switched on.
 */
export const SAVED_METHOD_TYPES = ['card', 'us_bank_account'] as const

/**
 * Bank accounts are verified at once through Financial Connections only: micro-deposits take a day
 * or two, which would leave the payer unable to use the account when it matters.
 */
export const SAVED_METHOD_OPTIONS: FormParams = { us_bank_account: { verification_method: 'instant', financial_connections: { permissions: ['payment_method'] } } }

export interface PaymentIntentInput {
  app: string
  checkoutId: string
  amountCents: number
  customer: string
  description: string
  /** offSession: confirm now with the saved method and nobody present; a card that needs the buyer to authenticate is refused (error_on_requires_action). onSession: the browser confirms it. */
  offSession: boolean
  paymentMethod?: string
}

export function paymentIntentParams(i: PaymentIntentInput): FormParams {
  const metadata = { app: i.app, checkoutId: i.checkoutId }
  const common = { amount: i.amountCents, currency: 'usd', customer: i.customer, description: i.description.slice(0, 1000), metadata, allowed_payment_method_types: [...SAVED_METHOD_TYPES] }
  if (!i.offSession) return { ...common, payment_method_options: SAVED_METHOD_OPTIONS }
  return { ...common, payment_method: i.paymentMethod, off_session: true, confirm: true, error_on_requires_action: true }
}

/** card or ach for a Stripe payment method type; null for anything the library doesn't save. */
export const savedMethodKind = (type: string): 'card' | 'ach' | null => (type === 'card' ? 'card' : type === 'us_bank_account' ? 'ach' : null)

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** How a saved method reads to its owner, e.g. "Visa •••• 4242" or "Chase bank account •••• 6789". */
export function savedMethodLabel(pm: StripePaymentMethod): string | null {
  if (pm.card) return `${capitalize(pm.card.brand)} •••• ${pm.card.last4}`
  if (pm.us_bank_account) return `${pm.us_bank_account.bank_name ?? 'Bank'} account •••• ${pm.us_bank_account.last4 ?? '????'}`
  return null
}

export const customerOf = (x: { customer?: string | { id: string } | null }) => idOf(x.customer)

export const stripe = {
  createSession: (keys: Keys, i: SessionInput, o: StripeCallOptions) =>
    stripeCall<StripeSession>(keys, 'POST', '/v1/checkout/sessions', sessionParams(i), { idempotencyKey: `checkout-${i.checkoutId}`, ...o }),
  /** With the PaymentIntent's charge and balance transaction, for the fee Stripe kept. */
  retrieveSession: (keys: Keys, id: string, o: StripeCallOptions) =>
    stripeCall<StripeSession>(keys, 'GET', `/v1/checkout/sessions/${encodeURIComponent(id)}`, { expand: ['payment_intent.latest_charge.balance_transaction'] }, o),
  expireSession: (keys: Keys, id: string, o: StripeCallOptions) => stripeCall<StripeSession>(keys, 'POST', `/v1/checkout/sessions/${encodeURIComponent(id)}/expire`, undefined, o),
  retrievePaymentIntent: (keys: Keys, id: string, o: StripeCallOptions) =>
    stripeCall<StripePaymentIntent>(keys, 'GET', `/v1/payment_intents/${encodeURIComponent(id)}`, { expand: ['latest_charge.balance_transaction'] }, o),
  /** Keyed `refund-<refundId>` unless o.idempotencyKey says otherwise (a new attempt after Stripe refused one). */
  createRefund: (keys: Keys, r: { paymentIntent: string; amountCents: number; app: string; refundId: string }, o: StripeCallOptions) =>
    stripeCall<StripeRefund>(
      keys,
      'POST',
      '/v1/refunds',
      { payment_intent: r.paymentIntent, amount: r.amountCents, metadata: { app: r.app, refundId: r.refundId } },
      { idempotencyKey: `refund-${r.refundId}`, ...o },
    ),
  retrieveRefund: (keys: Keys, id: string, o: StripeCallOptions) => stripeCall<StripeRefund>(keys, 'GET', `/v1/refunds/${encodeURIComponent(id)}`, undefined, o),
  /** Created at or after `sinceSec`, newest first, 100 a page. */
  listSessions: (keys: Keys, sinceSec: number, startingAfter: string | undefined, o: StripeCallOptions) =>
    stripeCall<StripeList<StripeSession>>(keys, 'GET', '/v1/checkout/sessions', { limit: 100, created: { gte: sinceSec }, starting_after: startingAfter }, o),
  /** Every refund of one PaymentIntent (up to 100). */
  refundsOf: (keys: Keys, paymentIntent: string, o: StripeCallOptions) => stripeCall<StripeList<StripeRefund>>(keys, 'GET', '/v1/refunds', { payment_intent: paymentIntent, limit: 100 }, o),
  listRefunds: (keys: Keys, sinceSec: number, startingAfter: string | undefined, o: StripeCallOptions) =>
    stripeCall<StripeList<StripeRefund>>(keys, 'GET', '/v1/refunds', { limit: 100, created: { gte: sinceSec }, starting_after: startingAfter }, o),

  /** A Customer for one payer of one app; the caller's idempotency key makes a repeat return the same one. */
  createCustomer: (keys: Keys, c: { app: string; owner: string; email: string; name?: string }, o: StripeCallOptions) =>
    stripeCall<StripeCustomer>(keys, 'POST', '/v1/customers', { email: c.email, name: c.name, metadata: { app: c.app, owner: c.owner } }, o),
  /** A customer's saved payment methods, newest first. */
  customerMethods: (keys: Keys, customer: string, o: StripeCallOptions) =>
    stripeCall<StripeList<StripePaymentMethod>>(keys, 'GET', `/v1/customers/${encodeURIComponent(customer)}/payment_methods`, { limit: 100 }, o),
  retrievePaymentMethod: (keys: Keys, id: string, o: StripeCallOptions) => stripeCall<StripePaymentMethod>(keys, 'GET', `/v1/payment_methods/${encodeURIComponent(id)}`, undefined, o),
  /** Saves a card or bank account for charging later with nobody present (usage off_session also collects a bank account's debit mandate). */
  createSetupIntent: (keys: Keys, s: { customer: string; app: string; owner: string }, o: StripeCallOptions) =>
    stripeCall<StripeSetupIntent>(
      keys,
      'POST',
      '/v1/setup_intents',
      { customer: s.customer, usage: 'off_session', allowed_payment_method_types: [...SAVED_METHOD_TYPES], payment_method_options: SAVED_METHOD_OPTIONS, metadata: { app: s.app, owner: s.owner } },
      o,
    ),
  createPaymentIntent: (keys: Keys, i: PaymentIntentInput, o: StripeCallOptions) => stripeCall<StripePaymentIntent>(keys, 'POST', '/v1/payment_intents', paymentIntentParams(i), o),
  /** Without the expansions, for its status and client secret. */
  paymentIntent: (keys: Keys, id: string, o: StripeCallOptions) => stripeCall<StripePaymentIntent>(keys, 'GET', `/v1/payment_intents/${encodeURIComponent(id)}`, undefined, o),
  /** With the payment method used, for whether it was a card or a bank account. */
  paymentIntentWithMethod: (keys: Keys, id: string, o: StripeCallOptions) =>
    stripeCall<StripePaymentIntent>(keys, 'GET', `/v1/payment_intents/${encodeURIComponent(id)}`, { expand: ['payment_method', 'latest_charge.balance_transaction'] }, o),
  cancelPaymentIntent: (keys: Keys, id: string, o: StripeCallOptions) => stripeCall<StripePaymentIntent>(keys, 'POST', `/v1/payment_intents/${encodeURIComponent(id)}/cancel`, undefined, o),
  /** Created at or after `sinceSec`, newest first, 100 a page. */
  listPaymentIntents: (keys: Keys, sinceSec: number, startingAfter: string | undefined, o: StripeCallOptions, customer?: string) =>
    stripeCall<StripeList<StripePaymentIntent>>(keys, 'GET', '/v1/payment_intents', { limit: 100, created: { gte: sinceSec }, starting_after: startingAfter, customer }, o),

  listWebhookEndpoints: (keys: Keys, startingAfter: string | undefined, o: StripeCallOptions) =>
    stripeCall<StripeList<StripeWebhookEndpoint>>(keys, 'GET', '/v1/webhook_endpoints', { limit: 100, starting_after: startingAfter }, o),
  /** Pinned to the library's API version, so events arrive in the shape the library reads. The answer carries the signing secret, once. */
  createWebhookEndpoint: (keys: Keys, w: { url: string; events: readonly string[]; description: string }, o: StripeCallOptions) =>
    stripeCall<StripeWebhookEndpoint>(keys, 'POST', '/v1/webhook_endpoints', { url: w.url, enabled_events: [...w.events], api_version: STRIPE_API_VERSION, description: w.description }, o),
  updateWebhookEndpoint: (keys: Keys, id: string, events: readonly string[], o: StripeCallOptions) =>
    stripeCall<StripeWebhookEndpoint>(keys, 'POST', `/v1/webhook_endpoints/${encodeURIComponent(id)}`, { enabled_events: [...events], disabled: false }, o),
  deleteWebhookEndpoint: (keys: Keys, id: string, o: StripeCallOptions) =>
    stripeCall<{ id: string; deleted: boolean }>(keys, 'DELETE', `/v1/webhook_endpoints/${encodeURIComponent(id)}`, undefined, o),
}

/**
 * Every Stripe event the library acts on; the webhook endpoint is registered with exactly these
 * (`npx ed-payments webhooks --stripe <url>`). Others reach the app's onUnhandledStripeEvent.
 */
export const STRIPE_EVENTS = [
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed',
  'checkout.session.expired',
  'payment_intent.succeeded',
  'payment_intent.processing',
  'payment_intent.payment_failed',
  'charge.refunded',
  'refund.created',
  'refund.updated',
  'refund.failed',
  'charge.dispute.created',
  'charge.dispute.closed',
] as const

/** The fee Stripe kept, when the session or PaymentIntent was fetched with its balance transaction expanded. */
export function stripeFee(x: StripeSession | StripePaymentIntent): number | null {
  const pi = x.object === 'checkout.session' ? x.payment_intent : x
  if (!pi || typeof pi === 'string') return null
  const charge = pi.latest_charge
  if (!charge || typeof charge === 'string') return null
  const bt = charge.balance_transaction
  return bt && typeof bt !== 'string' ? bt.fee : null
}

/** Where a Checkout Session stands, in the library's words. */
export function sessionState(s: StripeSession): 'paid' | 'processing' | 'open' | 'expired' {
  if (s.payment_status === 'paid' || s.payment_status === 'no_payment_required') return 'paid'
  if (s.status === 'complete') return 'processing'
  return s.status === 'expired' ? 'expired' : 'open'
}

/**
 * Where a PaymentIntent stands, in the library's words. open: waiting for a payment method (the buyer
 * on-session, or after a refused confirm). action: waiting for the buyer to authenticate, normal on
 * the app's page and never expected off-session. odd: requires_capture, which the library never asks
 * for, so a person should look.
 */
export function intentState(pi: Pick<StripePaymentIntent, 'status'>): 'paid' | 'processing' | 'open' | 'action' | 'canceled' | 'odd' {
  switch (pi.status) {
    case 'succeeded':
      return 'paid'
    case 'processing':
      return 'processing'
    case 'canceled':
      return 'canceled'
    case 'requires_payment_method':
    case 'requires_confirmation':
      return 'open'
    case 'requires_action':
      return 'action'
    default:
      return 'odd'
  }
}

// ── Webhooks ───────────────────────────────────────────────────────────────────────────────────

const encoder = new TextEncoder()

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(message))
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Compares in time that doesn't depend on where the strings first differ. */
export function constantTimeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0)
  return diff === 0
}

/**
 * Checks a Stripe-Signature header (`t=<unix seconds>,v1=<hex>,...`): HMAC-SHA256 of `<t>.<raw body>`
 * with the endpoint secret, any v1 matching, and t within the tolerance (5 minutes, as Stripe's
 * libraries). Unknown entries (v0, debug metadata) are ignored, as Stripe asks.
 */
export async function verifyStripeSignature(payload: string, header: string | null, secret: string, nowMs: number, toleranceSec = 300): Promise<boolean> {
  if (!header || !secret) return false
  let t: number | null = null
  const v1: string[] = []
  for (const part of header.split(',')) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    const k = part.slice(0, eq).trim()
    const value = part.slice(eq + 1).trim()
    if (k === 't') t = /^\d+$/.test(value) ? Number(value) : null
    else if (k === 'v1') v1.push(value)
  }
  if (t === null || !v1.length) return false
  if (Math.abs(nowMs / 1000 - t) > toleranceSec) return false
  const expected = await hmacHex(secret, `${t}.${payload}`)
  return v1.some((s) => constantTimeEqual(s, expected))
}

/** A Stripe-Signature header for a body, as Stripe would send it: for tests and fixtures. */
export async function signStripePayload(payload: string, secret: string, timestampSec: number): Promise<string> {
  return `t=${timestampSec},v1=${await hmacHex(secret, `${timestampSec}.${payload}`)}`
}

export function parseStripeEvent(payload: string): StripeEvent | null {
  try {
    const e = JSON.parse(payload) as StripeEvent
    return e && e.object === 'event' && typeof e.id === 'string' && typeof e.type === 'string' && e.data && typeof e.data.object === 'object' ? e : null
  } catch {
    return null
  }
}
