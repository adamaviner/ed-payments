import type { Payer } from '../core/types.js';
/** What a PayPal checkout's lastError says once PayPal declined what the buyer chose (paypalDeclinedAt marks it; capturePaypal). */
export declare const PAYPAL_DECLINED = "PayPal declined the card or account the buyer chose; waiting for them to choose another.";
/** The idempotency key of a refund's send: the same for every repeat of one attempt (component refunds.begin makes the same). */
export declare const refundKey: (refundId: string, attempts: number) => string;
/** A payer as recorded: the email and name trimmed, an empty name left out. */
export declare const cleanPayer: (p: Payer) => Payer;
/** `url` with one more query parameter. Not encoded: Stripe's {CHECKOUT_SESSION_ID} must reach Stripe as it is, and PayPal's ids are letters and digits. */
export declare const withParam: (url: string, name: string, value: string) => string;
/** Whether two stored values (a checkout's context, say) are the same, field by field; a field set to undefined counts as missing, as Convex stores it. */
export declare function sameValue(a: unknown, b: unknown): boolean;
/** A thrown error as a sentence. */
export declare const errorText: (err: unknown) => string;
export type RefundState = 'done' | 'pending' | 'failed';
/** Stripe's refund status in the ledger's words. */
export declare const stripeRefundState: (status: string | null) => RefundState;
/** PayPal's refund status in the ledger's words. */
export declare const paypalRefundState: (status: string) => RefundState;
//# sourceMappingURL=util.d.ts.map