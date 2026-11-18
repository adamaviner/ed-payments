import { ConvexError } from 'convex/values';
/** A thrown error as a sentence. */
export const errorText = (err) => (err instanceof ConvexError ? String(err.data) : err instanceof Error ? err.message : String(err));
/** Stripe's refund status in the ledger's words. */
export const stripeRefundState = (status) => (status === 'succeeded' ? 'done' : status === 'failed' || status === 'canceled' ? 'failed' : 'pending');
/** PayPal's refund status in the ledger's words. */
export const paypalRefundState = (status) => (status === 'COMPLETED' ? 'done' : status === 'FAILED' || status === 'CANCELLED' ? 'failed' : 'pending');
//# sourceMappingURL=util.js.map