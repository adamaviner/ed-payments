import { type PaypalActivity } from '../core/paypal.js';
import type { Payments, RunActionCtx } from './index.js';
export interface PaypalHistoryArgs {
    email: string;
    /** ms; clamped to the three years PayPal keeps. */
    start: number;
    /** ms; clamped to now. */
    end: number;
}
export type PaypalHistoryLine = PaypalActivity & {
    url: string;
};
export interface PaypalHistory {
    /** The range actually searched, after clamping. */
    start: number;
    end: number;
    /** Newest first. */
    transactions: PaypalHistoryLine[];
    /** How many of the account's transactions were looked through. */
    scanned: number;
}
/** [start, end) cut into PayPal-sized windows, oldest first. */
export declare function searchWindows(start: number, end: number): {
    start: number;
    end: number;
}[];
/** Every transaction in the range whose other party is `email` (payments in, refunds and payments out), newest first. */
export declare function paypalHistory(p: Payments, ctx: RunActionCtx, a: PaypalHistoryArgs): Promise<PaypalHistory>;
//# sourceMappingURL=paypalHistory.d.ts.map