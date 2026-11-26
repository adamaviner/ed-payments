import { type Method, type Payer, type Processor, type Ref } from '../core/types.js';
import type { Payments, RunActionCtx, RunMutationCtx, SchedulerCtx, StartUi, StartedEmbedded, StartedOnPage, StartedRedirect } from './index.js';
export type ScheduleView = NonNullable<Awaited<ReturnType<Payments['getSchedule']>>>;
export interface ScheduleBaseArgs<T> {
    /** Whose saved method it charges, as for setupPaymentMethod (e.g. { type: 'donor', id }). */
    owner: Ref;
    /** What it is for in the app, e.g. { type: 'monthlyDonation', id }; every charge carries it too. */
    ref: Ref;
    purpose: string;
    /** What the payer sees at the processor for each charge. */
    description: string;
    payer: Payer;
    /** Each period's charge, priced on the server. */
    amountCents: number;
    /** Passed to every charge's callbacks and the schedule's own; checked against the context validator. */
    context: T;
    /** Day of the month charged (1-28). Default: the first charge's day, kept to 28. */
    anchorDay?: number;
}
export interface StartScheduleArgs<T> extends ScheduleBaseArgs<T> {
    /** A method saved for `owner` (from savedMethods or verifyMethodOwner, never from the browser as it came). */
    paymentMethodId: string;
    /** The Stripe Customer, when the library has none recorded for the owner (adopting one made before it). */
    stripeCustomerId?: string;
    /** When the first charge is made (ms); default now, charged at once. Later ones follow on the anchor day. */
    firstChargeAt?: number;
}
export interface StartScheduleCheckoutArgs<T> extends ScheduleBaseArgs<T> {
    /**
     * Who takes it: the app decides (for a new card, e.g. the cheaper of the two for the monthly
     * amount: cardProcessorFor / compareProcessingFees). Stripe takes card or ach, PayPal card or paypal.
     */
    processor: Processor;
    method: Method;
    /** As for start: where the payer comes back to (Stripe adds session_id, PayPal token), and where they turned back to. */
    returnPath: string;
    cancelPath: string;
    /** embedded (default): on the app's page (StripeEmbeddedCheckout, PaypalButtons or PaypalCardPayment); redirect: the processor's page. */
    ui?: StartUi;
    /** As for start: with ui: 'onPage', the checkout the payer's last press started, reused while nothing that matters changed. */
    replaces?: string;
    expiresAt?: number;
    limitKey?: string;
    stripeCustomerId?: string;
}
export declare function startSchedule<T>(p: Payments, ctx: SchedulerCtx, a: StartScheduleArgs<T>): Promise<{
    scheduleId: string;
    checkoutId: string | null;
}>;
export declare function startScheduleCheckout<T>(p: Payments, ctx: RunActionCtx, a: StartScheduleCheckoutArgs<T>): Promise<(StartedRedirect | StartedEmbedded | StartedOnPage) & {
    scheduleId: string;
}>;
/**
 * Charges a schedule if it is due (the component decides, keyed by period), returning the checkout id,
 * or null when there was nothing to charge.
 */
export declare function chargeDue(p: Payments, ctx: SchedulerCtx, scheduleId: string): Promise<string | null>;
/** The hourly run (worker().schedules): every due schedule of this app is charged, or one when given. */
export declare function runSchedules(p: Payments, ctx: SchedulerCtx, o?: {
    scheduleId?: string;
}): Promise<{
    charged: number;
    errors: number;
}>;
export declare function updateSchedule(p: Payments, ctx: RunMutationCtx, a: {
    scheduleId: string;
    amountCents?: number;
    paymentMethodId?: string;
    stripeCustomerId?: string;
    anchorDay?: number;
    description?: string;
    by?: string;
}): Promise<ScheduleView>;
//# sourceMappingURL=schedules.d.ts.map