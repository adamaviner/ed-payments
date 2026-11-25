import type { Payments, RunActionCtx } from './index.js';
export interface ReconcileResult {
    /** Payments compared. */
    checked: number;
    opened: number;
    resolved: number;
    /** Refunds found at a processor that the ledger was missing, now recorded. */
    refundsRecorded: number;
    /** Whether PayPal's Transaction Search ran (false when PayPal refuses it or PayPal isn't set up). */
    searched: boolean;
    errors: number;
}
export declare function reconcile(p: Payments, ctx: RunActionCtx, days: number): Promise<ReconcileResult>;
//# sourceMappingURL=reconcile.d.ts.map