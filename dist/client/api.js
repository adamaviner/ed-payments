// The functions the library makes for the app to export, so the app writes no wrappers:
//   worker():    internal functions for the crons and scheduled charges
//   adminApi():  public functions for an admin page, each behind the app's authorize.admin query
//   publicApi(): the buyer-facing return page, rate-limited
import { actionGeneric, internalActionGeneric, internalMutationGeneric, mutationGeneric, paginationOptsValidator, queryGeneric } from 'convex/server';
import { ConvexError, v } from 'convex/values';
import { stripe } from '../core/stripe.js';
import { giveUpPaypalCharge } from './paypalVault.js';
import { findIntent, settleIntent } from './saved.js';
const processor = v.union(v.literal('stripe'), v.literal('paypal'));
const ref = v.object({ type: v.string(), id: v.string() });
/** Passed to the app's authorize query as it came (ed-schedule: a session token). Apps on Convex auth leave it out. */
const auth = v.optional(v.any());
export function worker(p) {
    return {
        sweep: internalActionGeneric({
            args: {},
            returns: v.null(),
            handler: async (ctx) => {
                await p.sweep(ctx);
                return null;
            },
        }),
        reconcile: internalActionGeneric({
            args: { days: v.optional(v.number()) },
            returns: v.null(),
            handler: async (ctx, { days }) => {
                await p.reconcile(ctx, { days });
                return null;
            },
        }),
        cleanup: internalMutationGeneric({ args: {}, returns: v.object({ deleted: v.number(), more: v.boolean() }), handler: async (ctx) => await p.cleanup(ctx) }),
        issuesDigest: internalMutationGeneric({ args: {}, returns: v.number(), handler: async (ctx) => await p.issuesDigest(ctx) }),
        /** An off-session charge (chargeSaved queues it; it queues its own retries). */
        charge: internalActionGeneric({
            args: { checkoutId: v.string(), manual: v.optional(v.boolean()) },
            returns: v.null(),
            handler: async (ctx, { checkoutId, manual }) => {
                await p.charge(ctx, checkoutId, manual ?? false);
                return null;
            },
        }),
    };
}
/** The admin as the app's authorize.admin query names them; throws when it says no. */
async function admin(p, ctx, a) {
    const who = await ctx.runQuery(p.wiring.authorize.admin, a === undefined ? {} : { auth: a });
    if (!who)
        throw new ConvexError('Only an admin may do this.');
    return who;
}
export function adminApi(p, o) {
    const c = p.component;
    const summary = (x) => ({
        id: x.id,
        ref: x.ref,
        purpose: x.purpose,
        kind: x.kind,
        description: x.description,
        processor: x.processor,
        method: x.method,
        payer: x.payer,
        status: x.status,
        paymentRef: x.paymentRef,
        amountCents: x.amountCents,
        paidCents: x.paidCents,
        refundedCents: x.refundedCents,
        createdAt: x.createdAt,
    });
    return {
        /** Refunds waiting on someone (requested, approved, sending, failed), oldest first, each with its payment. */
        openRefunds: queryGeneric({
            args: { auth },
            handler: async (ctx, a) => {
                await admin(p, ctx, a.auth);
                const refunds = await ctx.runQuery(c.refunds.listOpen, {});
                return await Promise.all(refunds.map(async (r) => {
                    const checkout = await ctx.runQuery(c.checkouts.get, { id: r.checkoutId });
                    return { ...r, checkout: checkout ? summary(checkout) : null };
                }));
            },
        }),
        /** Paid checkouts with something left to refund, newest first, a page at a time; with `ref`, one thing's. */
        refundable: queryGeneric({
            args: { auth, ref: v.optional(ref), paginationOpts: paginationOptsValidator },
            handler: async (ctx, a) => {
                await admin(p, ctx, a.auth);
                const page = await ctx.runQuery(c.checkouts.refundable, { ref: a.ref, paginationOpts: a.paginationOpts });
                return { ...page, page: page.page.map(summary) };
            },
        }),
        /** Issues (differences from the processors, disputes, failed callbacks, charges with an unknown outcome), open ones by default. */
        issues: queryGeneric({
            args: { auth, open: v.optional(v.boolean()), paginationOpts: paginationOptsValidator },
            handler: async (ctx, a) => {
                await admin(p, ctx, a.auth);
                return await ctx.runQuery(c.issues.list, { open: a.open ?? true, paginationOpts: a.paginationOpts });
            },
        }),
        /** Open refunds plus open issues, for a badge. */
        openCount: queryGeneric({
            args: { auth },
            handler: async (ctx, a) => {
                await admin(p, ctx, a.auth);
                return (await ctx.runQuery(c.refunds.listOpen, {})).length + (await ctx.runQuery(c.issues.openCount, {}));
            },
        }),
        /** One checkout with its refunds. */
        checkout: queryGeneric({
            args: { auth, checkoutId: v.string() },
            handler: async (ctx, a) => {
                await admin(p, ctx, a.auth);
                const x = await ctx.runQuery(c.checkouts.get, { id: a.checkoutId });
                return x && x.app === p.app ? { checkout: summary(x), lastError: x.lastError, refunds: await ctx.runQuery(c.refunds.forCheckout, { checkoutId: x.id }) } : null;
            },
        }),
        /** Asks for a refund, the whole remaining amount unless given; `hostData` goes to on.refunded. Returns the refund's id. */
        requestRefund: mutationGeneric({
            args: { auth, checkoutId: v.string(), amountCents: v.optional(v.number()), reason: v.string(), hostData: v.optional(v.record(v.string(), v.string())) },
            handler: async (ctx, { auth: token, ...a }) => {
                const who = await admin(p, ctx, token);
                return await p.requestRefund(ctx, { ...a, by: who.name });
            },
        }),
        approveRefund: mutationGeneric({
            args: { auth, refundId: v.string() },
            handler: async (ctx, a) => {
                const who = await admin(p, ctx, a.auth);
                await p.approveRefund(ctx, { refundId: a.refundId, by: who.name });
                return null;
            },
        }),
        /** Sends a refund through the processor that took the money (keyed by the refund, so a double click refunds once). */
        sendRefund: actionGeneric({
            args: { auth, refundId: v.string() },
            handler: async (ctx, a) => {
                const who = await admin(p, ctx, a.auth);
                const r = await p.sendRefund(ctx, a.refundId, { skipApproval: o.skipApproval ?? false, by: who.name });
                return r && { status: r.status, error: r.error };
            },
        }),
        /** For a refund made outside the app, e.g. in the processor's own dashboard. */
        markRefundedManually: mutationGeneric({
            args: { auth, refundId: v.string(), note: v.optional(v.string()) },
            handler: async (ctx, a) => {
                const who = await admin(p, ctx, a.auth);
                await p.markRefundedManually(ctx, { refundId: a.refundId, note: a.note, by: who.name });
                return null;
            },
        }),
        /** Decided not to refund. */
        dismissRefund: mutationGeneric({
            args: { auth, refundId: v.string(), note: v.optional(v.string()) },
            handler: async (ctx, a) => {
                const who = await admin(p, ctx, a.auth);
                await p.dismissRefund(ctx, { refundId: a.refundId, note: a.note, by: who.name });
                return null;
            },
        }),
        resolveIssue: mutationGeneric({
            args: { auth, issueId: v.string() },
            handler: async (ctx, a) => {
                await admin(p, ctx, a.auth);
                await p.resolveIssue(ctx, a.issueId);
                return null;
            },
        }),
        /**
         * Tries an off-session charge with an unknown outcome once more. Safe if the first try went
         * through: the library looks for its PaymentIntent before charging again.
         */
        retryCharge: mutationGeneric({
            args: { auth, checkoutId: v.string() },
            handler: async (ctx, a) => {
                await admin(p, ctx, a.auth);
                await ctx.runMutation(c.checkouts.reopenCharge, { id: a.checkoutId, now: Date.now() });
                await ctx.scheduler.runAfter(0, p.wiring.worker.charge, { checkoutId: a.checkoutId, manual: true });
                return null;
            },
        }),
        /**
         * Gives up on an off-session charge with an unknown outcome: it fails, and the app's on.failed
         * decides what next (e.g. ask the buyer to pay). Stripe is asked first: a charge it shows paid or
         * on its way is settled instead, and one still open there is canceled, so giving up can never
         * leave a charge behind that pays later.
         */
        giveUpCharge: actionGeneric({
            args: { auth, checkoutId: v.string() },
            handler: async (ctx, a) => {
                const who = await admin(p, ctx, a.auth);
                const x = await ctx.runQuery(c.checkouts.get, { id: a.checkoutId });
                if (!x || x.app !== p.app || x.kind !== 'offSession')
                    throw new ConvexError('There is no such charge.');
                if (x.status !== 'created' && x.status !== 'pending')
                    throw new ConvexError(x.status === 'processing' ? 'A bank payment for this is on its way; wait for it.' : `This charge is already ${x.status}.`);
                if (x.processor === 'paypal')
                    return await giveUpPaypalCharge(p, ctx, x, who.name);
                const pi = await findIntent(p, x);
                if (pi && (await settleIntent(p, ctx, x, pi)))
                    return { status: (await ctx.runQuery(c.checkouts.get, { id: x.id }))?.status ?? x.status };
                if (pi && pi.status !== 'canceled')
                    await stripe.cancelPaymentIntent(p.stripeKeys(), pi.id, { fetch: p.fetch });
                await ctx.runMutation(c.checkouts.settleFailed, { id: x.id, reason: `Given up by ${who.name}: ${x.lastError ?? 'the charge didn’t complete'}`, processorCheckoutId: pi?.id, now: Date.now() });
                return { status: 'failed' };
            },
        }),
    };
}
export function publicApi(p) {
    return {
        /**
         * The page the buyer comes back to: `token` is Stripe's session_id (or payment_intent) or PayPal's
         * token. Settles the checkout if the processor says it's paid and the webhook hasn't arrived;
         * safe to reload. Says only how it stands, nothing about the payer. PayPal's buttons on the app's
         * page call it when the buyer approves; `declined: true` means PayPal refused what they chose.
         */
        completeReturn: actionGeneric({
            args: { processor, token: v.string() },
            handler: async (ctx, a) => {
                await p.takeLimits(ctx, 'return', `token:${a.token.slice(0, 80)}`, 4);
                const r = await p.completeReturn(ctx, a);
                return r && { status: r.status, purpose: r.purpose, ref: r.ref, ...(r.declined ? { declined: r.declined } : {}) };
            },
        }),
        /**
         * The buyer won't pay the checkout they started on the app's page (they pressed Edit): closed
         * now, and their start given back to their rate limit (Payments.cancel). `checkoutId` is what
         * start returned to them. Returns how it stands; null: not this app's.
         */
        cancelCheckout: actionGeneric({
            args: { checkoutId: v.string() },
            handler: async (ctx, { checkoutId }) => {
                if (!checkoutId || checkoutId.length > 64)
                    return null;
                await p.takeLimits(ctx, 'cancel', `checkout:${checkoutId}`, 4);
                return await p.cancel(ctx, checkoutId);
            },
        }),
    };
}
//# sourceMappingURL=api.js.map