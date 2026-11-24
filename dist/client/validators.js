// What the host's callbacks receive. `payments.args.paid` (and the others) are these with the app's own
// context validator in place of `context`; use them as the `args` of the internal mutations given to
// withCallbacks, so a change here fails the host's typecheck.
import { v } from 'convex/values';
const processor = v.union(v.literal('stripe'), v.literal('paypal'));
const method = v.union(v.literal('card'), v.literal('ach'), v.literal('paypal'));
const kind = v.union(v.literal('hosted'), v.literal('offSession'), v.literal('onSession'));
function base(context) {
    return {
        checkoutId: v.string(),
        ref: v.object({ type: v.string(), id: v.string() }),
        purpose: v.string(),
        kind,
        processor,
        method,
        payer: v.object({ name: v.optional(v.string()), email: v.string() }),
        /** What the host passed to start or chargeSaved as `context`. */
        context,
    };
}
export const issueArg = v.object({
    id: v.string(),
    kind: v.string(),
    detail: v.string(),
    checkoutId: v.union(v.string(), v.null()),
    processor,
    openedAt: v.number(),
});
/** The arguments of each callback, for an app whose context is `context`. */
export function callbackArgs(context) {
    const b = base(context);
    return {
        ...scheduleCallbackArgs(context),
        /** paid: the money arrived. Record the sale; return null, or { refuse } to have it refunded instead (throwing does the same). */
        paid: { ...b, amountCents: v.number(), paidCents: v.number(), paymentRef: v.string() },
        /**
         * failed: the processor said no (a declined capture or card, a bounced bank debit), or a person gave
         * up on a charge. declined: the bank refused the method. wasProcessing: a bank payment that had been
         * accepted bounced.
         */
        failed: {
            ...b,
            reason: v.string(),
            declined: v.boolean(),
            wasProcessing: v.boolean(),
            /** The processor's code for the refusal (insufficient_funds, lost_card, INSTRUMENT_DECLINED...), when it gave one. */
            declineCode: v.optional(v.union(v.string(), v.null())),
        },
        /**
         * refunded: a refund went back to the buyer (sent, done by hand, or made at the processor). May come
         * twice for one refundId (a refund the processor failed after sending, then sent again): act on it
         * idempotently.
         */
        refunded: {
            ...b,
            refundId: v.string(),
            amountCents: v.number(),
            refundedCents: v.number(),
            paidCents: v.number(),
            origin: v.union(v.literal('requested'), v.literal('needed'), v.literal('external')),
            /** What the app passed to requestRefund as hostData (e.g. its admin's answer to a question); unset for others. */
            hostData: v.optional(v.record(v.string(), v.string())),
        },
        /** refundNeeded: money arrived for a sale the host refused; a refund for it is waiting. */
        refundNeeded: { ...b, amountCents: v.number(), paidCents: v.number(), paymentRef: v.string(), refundId: v.string(), reason: v.string() },
        /** dispute: the buyer disputed the payment (opened), or the dispute ended (closed). */
        dispute: {
            ...b,
            paymentRef: v.string(),
            disputeId: v.string(),
            status: v.union(v.literal('opened'), v.literal('closed')),
            outcome: v.union(v.string(), v.null()),
            reason: v.union(v.string(), v.null()),
            amountCents: v.union(v.number(), v.null()),
        },
        /** processing: a bank payment was accepted and the money is on its way (days); paid or failed follows. */
        processing: { ...b, paymentRef: v.union(v.string(), v.null()) },
        /** issues: the nightly digest of new issues (differences from the processors, disputes, charges with an unknown outcome). */
        issues: { issues: v.array(issueArg) },
    };
}
const scheduleStatus = v.union(v.literal('starting'), v.literal('active'), v.literal('paused'), v.literal('past_due'), v.literal('lapsed'), v.literal('cancelled'));
const scheduleChange = v.union(v.literal('started'), v.literal('not_started'), v.literal('amount'), v.literal('method'), v.literal('anchor'), v.literal('paused'), v.literal('resumed'), v.literal('cancelled'));
function scheduleBase(context) {
    return {
        scheduleId: v.string(),
        ref: v.object({ type: v.string(), id: v.string() }),
        purpose: v.string(),
        owner: v.object({ type: v.string(), id: v.string() }),
        payer: v.object({ name: v.optional(v.string()), email: v.string() }),
        processor,
        method,
        paymentMethodId: v.union(v.string(), v.null()),
        /** The schedule's amount now (a charge's own amount is on its checkout). */
        amountCents: v.number(),
        /** Where the schedule stands after this. */
        status: scheduleStatus,
        /** The next charge (or retry); null once lapsed or cancelled. */
        nextChargeAt: v.union(v.number(), v.null()),
        context,
    };
}
/** The arguments of the schedule callbacks, for an app whose context is `context`. */
export function scheduleCallbackArgs(context) {
    const b = scheduleBase(context);
    return {
        /** scheduleCharged: one period's charge was paid (paid is called for its checkout too). first: the payment that started the schedule. */
        scheduleCharged: { ...b, checkoutId: v.string(), period: v.string(), paidCents: v.number(), paymentRef: v.string(), first: v.boolean() },
        /**
         * scheduleFailed: a charge was refused (or the saved method is gone: checkoutId null, declineCode
         * METHOD_REMOVED). attempt: refusals in this period so far. final: no more retries, the schedule
         * lapsed (hard declines are final at once). nextRetryAt: when it is tried again.
         */
        scheduleFailed: {
            ...b,
            checkoutId: v.union(v.string(), v.null()),
            period: v.string(),
            attempt: v.number(),
            final: v.boolean(),
            reason: v.string(),
            declineCode: v.union(v.string(), v.null()),
            declineKind: v.union(v.literal('hard'), v.literal('soft'), v.literal('insufficient_funds')),
            nextRetryAt: v.union(v.number(), v.null()),
        },
        /**
         * scheduleChanged: started (its first payment came), not_started (that payment never came), or the
         * app or the processor changed it. by: who the app named; 'processor' when the payer removed the
         * method at PayPal or Stripe.
         */
        scheduleChanged: {
            ...b,
            changes: v.array(scheduleChange),
            previousStatus: scheduleStatus,
            previousAmountCents: v.number(),
            reason: v.union(v.string(), v.null()),
            by: v.union(v.string(), v.null()),
        },
    };
}
/** With any context, for code that doesn't care about it. */
const anyArgs = callbackArgs(v.any());
export const paidArgs = anyArgs.paid;
export const failedArgs = anyArgs.failed;
export const refundedArgs = anyArgs.refunded;
export const refundNeededArgs = anyArgs.refundNeeded;
export const disputeArgs = anyArgs.dispute;
export const processingArgs = anyArgs.processing;
export const issuesArgs = anyArgs.issues;
export const paidReturns = v.union(v.null(), v.object({ refuse: v.string() }));
//# sourceMappingURL=validators.js.map