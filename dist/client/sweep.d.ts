import type { Scheduler } from 'convex/server';
import type { Payments, RunActionCtx } from './index.js';
/**
 * Every 10 minutes (registerCrons). PayPal checkouts pending over 5 minutes: captured if the buyer
 * approved (they may have closed the tab: fix a), abandoned once expired. Expired Stripe sessions
 * and on-session payments: settled if paid, else ended at Stripe and abandoned. Off-session charges
 * whose outcome never came back: asked again. Refunds left sending over 10 minutes: asked about
 * (or sent again, safely, under the same key).
 */
export declare function sweep(p: Payments, ctx: RunActionCtx & {
    scheduler: Scheduler;
}): Promise<{
    checked: number;
    settled: number;
    abandoned: number;
    refunds: number;
    errors: number;
}>;
//# sourceMappingURL=sweep.d.ts.map