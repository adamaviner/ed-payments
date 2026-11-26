import { orderVault, type PaypalOrder } from '../core/paypal.js';
import { type StripeSession } from '../core/stripe.js';
import { type Method, type Payer, type Processor, type Ref } from '../core/types.js';
import type { CheckoutStatus, OnPagePayment, Payments, RunActionCtx, StartArgs, StartedEmbedded, StartedOnPage, StartedRedirect } from './index.js';
/** @internal Another press already replaced the checkout named in replaces: the one that did, to decide from again. */
export interface Replaced {
    replacedBy: string;
}
/** How many checkouts a press follows through replacedBy (a press naming an old checkout after several changes) before giving up. */
export declare const MAX_REPLACED_HOPS = 4;
/** @internal What a press says when it can't catch up with the presses after it. */
export declare const STALE_PRESS = "This payment was changed in another tab or press. Please reload the page and try again.";
/** @internal start for a one-off: a checkout another press already replaced is followed to the one that replaced it. */
export declare function start(p: Payments, ctx: RunActionCtx, a: StartArgs<unknown>): Promise<StartedRedirect | StartedEmbedded | StartedOnPage>;
/**
 * @internal start, and for a schedule's first payment (startScheduleCheckout) the schedule it
 * starts and the payer's customer at the processor, so the method that pays is saved with it.
 */
export declare function begin(p: Payments, ctx: RunActionCtx, a: StartArgs<unknown>, save?: {
    scheduleId: string;
    schedulePeriod: string;
    stripeCustomerId?: string;
    paypalCustomerId?: string;
}): Promise<StartedRedirect | StartedEmbedded | StartedOnPage | Replaced>;
/** @internal Records a paid Stripe session, then (best effort) the fee Stripe kept. */
export declare function settleStripeSession(p: Payments, ctx: RunActionCtx, checkoutId: string, s: StripeSession): Promise<{
    outcome: "processing";
} | {
    outcome: "already_handled";
    status: "created" | "pending" | "processing" | "paid" | "failed" | "abandoned" | "refund_needed";
} | {
    outcome: "paid";
} | {
    outcome: "refund_needed";
    reason: string;
    refundId: string;
} | null>;
/** @internal Settles from a PayPal order that has a capture (COMPLETED, PENDING or DECLINED). */
export declare function settlePaypalOrder(p: Payments, ctx: RunActionCtx, checkoutId: string, order: PaypalOrder): Promise<{
    outcome: "processing";
} | {
    outcome: "already_handled";
    status: "created" | "pending" | "processing" | "paid" | "failed" | "abandoned" | "refund_needed";
} | {
    outcome: "failed";
} | {
    outcome: "paid";
} | {
    outcome: "refund_needed";
    reason: string;
    refundId: string;
} | null>;
/** @internal A method an order saved (orderVault), as the component's schedule mutations take it. */
export declare function paypalSavedArgs(saved: NonNullable<ReturnType<typeof orderVault>>): {
    paypalCustomerId: string;
    paymentTokenId: string;
    kind: "paypal" | "card";
    label: string;
    usagePattern: string | undefined;
    networkRef: {
        id: string;
        network?: string;
        date?: string;
    } | undefined;
};
/**
 * @internal Before a schedule's first payment is settled: the method it saved (Stripe's
 * setup_future_usage, PayPal's vault with purchase) becomes the schedule's, so settling starts it
 * with something to charge. A webhook's PayPal capture carries no payment_source, so the order is
 * read again. When PayPal says the save isn't finished (vault APPROVED, no token), the schedule is
 * marked as waiting for the token: VAULT.PAYMENT-TOKEN.CREATED, or the order read again by the
 * schedules worker (checkPaypalVault). Best effort: a schedule left without a method
 * fails its next charge, and the app's scheduleFailed asks the payer for another.
 */
export declare function saveForSchedule(p: Payments, ctx: RunActionCtx, checkoutId: string, from: {
    stripePaymentIntent?: string;
    paypalOrder?: PaypalOrder;
}): Promise<void>;
/**
 * @internal Captures an approved PayPal order and settles it. A second capture (a reloaded
 * return page, the webhook and the sweep racing) gets ORDER_ALREADY_CAPTURED from PayPal: the
 * order is then fetched and settled from what it says, instead of failing (fix b). A checkout
 * that is no longer waiting (abandoned, failed, settled) is never captured: with PayPal no money
 * moves until the capture, so taking it now would only mean refunding it.
 *
 * 'declined': PayPal refused the card or account the buyer chose (INSTRUMENT_DECLINED). The order
 * stays open, so on the app's page PayPal's buttons let the buyer choose another way to pay and
 * approve again; the decline is noted on the checkout. From then on only the buyer captures it
 * (`by: 'buyer'`: completeReturn, which the buttons and the return page call): the webhook and the
 * sweep leave it alone, and the sweep abandons it when it expires. Otherwise a card that went
 * through later (funds arrived, a fraud check cleared) would be charged after the buyer gave up or
 * paid another way. The buyer's captures each have their own request id (PayPal answers a repeated
 * id with its first answer, which would repeat the decline); the background's keep one per
 * checkout. An order can't be captured twice whatever the id.
 */
export declare function capturePaypal(p: Payments, ctx: RunActionCtx, checkoutId: string, orderId: string, by: 'buyer' | 'background'): Promise<'declined' | 'reordered' | undefined>;
/**
 * For the page the buyer comes back to (`token`: Stripe's session_id or payment_intent, or PayPal's
 * token). Returns the outcome at once if the checkout is already settled; otherwise asks the
 * processor and settles (capturing an approved PayPal order), so the page doesn't wait for a
 * webhook. Null: not ours. publicApi().completeReturn wraps this with a rate limit. PayPal's
 * buttons call it when the buyer approves; `declined` then means PayPal refused what the buyer
 * chose and the buttons should let them choose again (the checkout is still pending). `reordered`
 * (on-page only): PayPal won't take that order again, so the checkout has a new one; start again with
 * replaces to get it.
 */
export declare function completeReturn(p: Payments, ctx: RunActionCtx, { processor, token }: {
    processor: Processor;
    token: string;
}): Promise<{
    checkoutId: string;
    ref: Ref;
    purpose: string;
    status: CheckoutStatus;
    declined?: true;
    reordered?: true;
} | null>;
/**
 * Closes a checkout the buyer started and won't pay, e.g. they pressed Edit on the app's page: the
 * Stripe session is expired at Stripe, a PayPal order is left to lapse (none of its money moves
 * until the library captures, which it won't for an abandoned checkout), and the checkout is
 * abandoned now instead of when it expires. The start it counted against the buyer's own rate limit
 * is given back (pass the `limitKey` start was given, if any). If it was paid meanwhile, it is
 * settled as paid instead. Returns how it stands; null: not this app's checkout.
 *
 * Only for a checkout id the buyer was given by start (the id is the buyer's secret; anyone holding
 * it can close the unpaid checkout, nothing more). publicApi().cancelCheckout wraps p.
 */
export declare function cancel(p: Payments, ctx: RunActionCtx, checkoutId: string, o?: {
    limitKey?: string;
}): Promise<{
    status: CheckoutStatus;
} | null>;
/**
 * @internal The payer pressed again (start or startScheduleCheckout with replaces). Counted against
 * the replace limit first, so the processors aren't asked for nothing. The last press's checkout is
 * reused while it is this app's on-page checkout for the same thing, still open and in time, with the
 * same amount, processor, method, payer, description, context and return page, and the same schedule
 * (a starting schedule of the same owner, anchor day and context) or none: its client secret or order
 * goes back and no start is counted. A PayPal order PayPal has closed is replaced by a new one under
 * the same checkout. Anything else open for the same thing is closed (cancel: its start given back, a
 * starting schedule ended as never started) and null returned, for a fresh start; one for another
 * thing is left alone. A payment for the same thing that is paid or on its way is refused.
 */
export declare function reuseOrClose(p: Payments, ctx: RunActionCtx, replaces: string, want: {
    ref: Ref;
    purpose: string;
    description: string;
    amountCents: number;
    processor: Processor;
    method: Method;
    payer: Payer;
    context: unknown;
    returnPath: string;
    ui?: StartArgs<unknown>['ui'];
    limitKey?: string;
    schedule: {
        owner: Ref;
        anchorDay?: number;
    } | null;
}): Promise<{
    checkoutId: string;
    onPage: OnPagePayment;
    scheduleId: string | null;
} | null>;
//# sourceMappingURL=hosted.d.ts.map