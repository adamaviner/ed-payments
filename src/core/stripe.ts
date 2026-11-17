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
export async function stripeCall<T>(keys: Pick<StripeKeys, 'secretKey'>, method: 'GET' | 'POST', path: string, params: FormParams | undefined, o: StripeCallOptions): Promise<T> {
  const headers: Record<string, string> = { Authorization: `Bearer ${keys.secretKey}`, 'Stripe-Version': STRIPE_API_VERSION }
  let url = `${o.apiBase ?? STRIPE_API_BASE}${path}`
  let body: string | undefined
  const encoded = params ? formEncode(params) : ''
  if (method === 'GET') {
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
    const error = (json as { error?: { message?: string; code?: string } } | null)?.error
    throw new ProcessorError('stripe', res.status, error?.message ?? `Stripe answered ${res.status}.`, error?.code)
  }
  return json as T
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

export interface StripePaymentIntent {
  id: string
  object: 'payment_intent'
  amount: number
  amount_received: number
  status: string
  metadata: Metadata | null
  latest_charge: string | StripeCharge | null
}

export interface StripeSession {
  id: string
  object: 'checkout.session'
  url: string | null
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
    success_url: i.successUrl,
    cancel_url: i.cancelUrl,
  }
}

type Keys = Pick<StripeKeys, 'secretKey'>

export const stripe = {
  createSession: (keys: Keys, i: SessionInput, o: StripeCallOptions) =>
    stripeCall<StripeSession>(keys, 'POST', '/v1/checkout/sessions', sessionParams(i), { idempotencyKey: `checkout-${i.checkoutId}`, ...o }),
  /** With the PaymentIntent's charge and balance transaction, for the fee Stripe kept. */
  retrieveSession: (keys: Keys, id: string, o: StripeCallOptions) =>
    stripeCall<StripeSession>(keys, 'GET', `/v1/checkout/sessions/${encodeURIComponent(id)}`, { expand: ['payment_intent.latest_charge.balance_transaction'] }, o),
  expireSession: (keys: Keys, id: string, o: StripeCallOptions) => stripeCall<StripeSession>(keys, 'POST', `/v1/checkout/sessions/${encodeURIComponent(id)}/expire`, undefined, o),
  retrievePaymentIntent: (keys: Keys, id: string, o: StripeCallOptions) =>
    stripeCall<StripePaymentIntent>(keys, 'GET', `/v1/payment_intents/${encodeURIComponent(id)}`, { expand: ['latest_charge.balance_transaction'] }, o),
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
  listRefunds: (keys: Keys, sinceSec: number, startingAfter: string | undefined, o: StripeCallOptions) =>
    stripeCall<StripeList<StripeRefund>>(keys, 'GET', '/v1/refunds', { limit: 100, created: { gte: sinceSec }, starting_after: startingAfter }, o),
}

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
