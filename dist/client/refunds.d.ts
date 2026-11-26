import { type Processor } from '../core/types.js';
import type { Payments, RefundView, RunActionCtx } from './index.js';
/**
 * Sends a refund through the processor, keyed by the refund id (see pushRefund), so it is never made
 * twice. Needs approval first unless skipApproval. Returns the refund as it stands after.
 */
export declare function sendRefund(p: Payments, ctx: RunActionCtx, refundId: string, o?: {
    skipApproval?: boolean;
    by?: string;
}): Promise<RefundView | null>;
/**
 * @internal The processor call for a refund already marked sending, and its outcome recorded.
 * The key is the refund's (a new one per attempt the processor refused), so sending again after a
 * timeout or crash returns the same refund instead of making a second. When the outcome is unknown
 * (no answer, a 5xx) the refund stays sending and sweep sends it again under the same key.
 */
export declare function pushRefund(p: Payments, ctx: RunActionCtx, r: {
    refundId: string;
    key: string;
    processor: Processor;
    paymentRef: string;
    amountCents: number;
}): Promise<void>;
export declare function recheckRefund(p: Payments, ctx: RunActionCtx, r: RefundView): Promise<void>;
//# sourceMappingURL=refunds.d.ts.map