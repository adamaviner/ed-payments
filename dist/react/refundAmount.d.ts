import type { OpenRefund } from './types.js';
/** What can still be refunded on a payment: paid, less refunded, less open refunds. Never below zero. */
export declare function refundableCents(checkout: {
    id: string;
    paidCents?: number | null;
    refundedCents: number;
}, openRefunds?: readonly Pick<OpenRefund, 'checkoutId' | 'status' | 'amountCents'>[]): number;
export type RefundAmount = {
    ok: true;
    cents: number;
} | {
    ok: false;
    error: string;
};
/**
 * The amount box's text as cents: blank means everything left; otherwise dollars with at most two
 * decimals ("12", "12.5", "$12.50"), more than zero and no more than what is left.
 */
export declare function parseRefundAmount(text: string, leftCents: number): RefundAmount;
//# sourceMappingURL=refundAmount.d.ts.map