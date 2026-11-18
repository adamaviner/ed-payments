/** A thrown error as a sentence. */
export declare const errorText: (err: unknown) => string;
export type RefundState = 'done' | 'pending' | 'failed';
/** Stripe's refund status in the ledger's words. */
export declare const stripeRefundState: (status: string | null) => RefundState;
/** PayPal's refund status in the ledger's words. */
export declare const paypalRefundState: (status: string) => RefundState;
//# sourceMappingURL=util.d.ts.map