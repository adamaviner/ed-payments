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
        /** paid: the money arrived. Record the sale; return null, or { refuse } to have it refunded instead (throwing does the same). */
        paid: { ...b, amountCents: v.number(), paidCents: v.number(), paymentRef: v.string() },
        /**
         * failed: the processor said no (a declined capture or card, a bounced bank debit), or a person gave
         * up on a charge. declined: the bank refused the method. wasProcessing: a bank payment that had been
         * accepted bounced.
         */
        failed: { ...b, reason: v.string(), declined: v.boolean(), wasProcessing: v.boolean() },
        /** refunded: a refund went back to the buyer (sent, done by hand, or made at the processor). */
        refunded: {
            ...b,
            refundId: v.string(),
            amountCents: v.number(),
            refundedCents: v.number(),
            paidCents: v.number(),
            origin: v.union(v.literal('requested'), v.literal('needed'), v.literal('external')),
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