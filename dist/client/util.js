import { ConvexError } from 'convex/values';
/** What a PayPal checkout's lastError says once PayPal declined what the buyer chose (paypalDeclinedAt marks it; capturePaypal). */
export const PAYPAL_DECLINED = 'PayPal declined the card or account the buyer chose; waiting for them to choose another.';
/** The idempotency key of a refund's send: the same for every repeat of one attempt (component refunds.begin makes the same). */
export const refundKey = (refundId, attempts) => (attempts ? `refund-${refundId}-${attempts}` : `refund-${refundId}`);
/** A payer as recorded: the email and name trimmed, an empty name left out. */
export const cleanPayer = (p) => ({ email: p.email.trim(), ...(p.name?.trim() ? { name: p.name.trim() } : {}) });
/** `url` with one more query parameter. Not encoded: Stripe's {CHECKOUT_SESSION_ID} must reach Stripe as it is, and PayPal's ids are letters and digits. */
export const withParam = (url, name, value) => `${url}${url.includes('?') ? '&' : '?'}${name}=${value}`;
/** A thrown error as a sentence. */
export const errorText = (err) => (err instanceof ConvexError ? String(err.data) : err instanceof Error ? err.message : String(err));
/** Stripe's refund status in the ledger's words. */
export const stripeRefundState = (status) => (status === 'succeeded' ? 'done' : status === 'failed' || status === 'canceled' ? 'failed' : 'pending');
/** PayPal's refund status in the ledger's words. */
export const paypalRefundState = (status) => (status === 'COMPLETED' ? 'done' : status === 'FAILED' || status === 'CANCELLED' ? 'failed' : 'pending');
//# sourceMappingURL=util.js.map