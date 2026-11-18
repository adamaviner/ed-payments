import { ConvexError } from 'convex/values'

/** A thrown error as a sentence. */
export const errorText = (err: unknown) => (err instanceof ConvexError ? String(err.data) : err instanceof Error ? err.message : String(err))

export type RefundState = 'done' | 'pending' | 'failed'

/** Stripe's refund status in the ledger's words. */
export const stripeRefundState = (status: string | null): RefundState => (status === 'succeeded' ? 'done' : status === 'failed' || status === 'canceled' ? 'failed' : 'pending')

/** PayPal's refund status in the ledger's words. */
export const paypalRefundState = (status: string): RefundState => (status === 'COMPLETED' ? 'done' : status === 'FAILED' || status === 'CANCELLED' ? 'failed' : 'pending')
