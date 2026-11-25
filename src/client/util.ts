import { ConvexError } from 'convex/values'
import type { Payer } from '../core/types.js'

/** A payer as recorded: the email and name trimmed, an empty name left out. */
export const cleanPayer = (p: Payer): Payer => ({ email: p.email.trim(), ...(p.name?.trim() ? { name: p.name.trim() } : {}) })

/** `url` with one more query parameter. Not encoded: Stripe's {CHECKOUT_SESSION_ID} must reach Stripe as it is, and PayPal's ids are letters and digits. */
export const withParam = (url: string, name: string, value: string) => `${url}${url.includes('?') ? '&' : '?'}${name}=${value}`

/** A thrown error as a sentence. */
export const errorText = (err: unknown) => (err instanceof ConvexError ? String(err.data) : err instanceof Error ? err.message : String(err))

export type RefundState = 'done' | 'pending' | 'failed'

/** Stripe's refund status in the ledger's words. */
export const stripeRefundState = (status: string | null): RefundState => (status === 'succeeded' ? 'done' : status === 'failed' || status === 'canceled' ? 'failed' : 'pending')

/** PayPal's refund status in the ledger's words. */
export const paypalRefundState = (status: string): RefundState => (status === 'COMPLETED' ? 'done' : status === 'FAILED' || status === 'CANCELLED' ? 'failed' : 'pending')
