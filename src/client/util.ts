import { ConvexError } from 'convex/values'
import type { Payer } from '../core/types.js'

/** What a PayPal checkout's lastError says once PayPal declined what the buyer chose (paypalDeclinedAt marks it; capturePaypal). */
export const PAYPAL_DECLINED = 'PayPal declined the card or account the buyer chose; waiting for them to choose another.'

/** The idempotency key of a refund's send: the same for every repeat of one attempt (component refunds.begin makes the same). */
export const refundKey = (refundId: string, attempts: number) => (attempts ? `refund-${refundId}-${attempts}` : `refund-${refundId}`)

/** A payer as recorded: the email and name trimmed, an empty name left out. */
export const cleanPayer = (p: Payer): Payer => ({ email: p.email.trim(), ...(p.name?.trim() ? { name: p.name.trim() } : {}) })

/** `url` with one more query parameter. Not encoded: Stripe's {CHECKOUT_SESSION_ID} must reach Stripe as it is, and PayPal's ids are letters and digits. */
export const withParam = (url: string, name: string, value: string) => `${url}${url.includes('?') ? '&' : '?'}${name}=${value}`

/** Whether two stored values (a checkout's context, say) are the same, field by field; a field set to undefined counts as missing, as Convex stores it. */
export function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null || Array.isArray(a) !== Array.isArray(b)) return false
  const x = a as Record<string, unknown>
  const y = b as Record<string, unknown>
  const keys = (o: Record<string, unknown>) => Object.keys(o).filter((k) => o[k] !== undefined)
  const xk = keys(x)
  return xk.length === keys(y).length && xk.every((k) => Object.hasOwn(y, k) && sameValue(x[k], y[k]))
}

/** A thrown error as a sentence. */
export const errorText = (err: unknown) => (err instanceof ConvexError ? String(err.data) : err instanceof Error ? err.message : String(err))

export type RefundState = 'done' | 'pending' | 'failed'

/** Stripe's refund status in the ledger's words. */
export const stripeRefundState = (status: string | null): RefundState => (status === 'succeeded' ? 'done' : status === 'failed' || status === 'canceled' ? 'failed' : 'pending')

/** PayPal's refund status in the ledger's words. */
export const paypalRefundState = (status: string): RefundState => (status === 'COMPLETED' ? 'done' : status === 'FAILED' || status === 'CANCELLED' ? 'failed' : 'pending')
