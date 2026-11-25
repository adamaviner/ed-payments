// The refund engine's network half: sending a refund the ledger claimed (component refunds.begin) to
// the processor that took the money, and asking about one left sending. The ledger itself is the
// component's refunds.ts.
import { ConvexError } from 'convex/values';
import { paypal } from '../core/paypal.js';
import { stripe } from '../core/stripe.js';
import { ProcessorError, tagFor } from '../core/types.js';
import { errorText, paypalRefundState, refundKey, stripeRefundState } from './util.js';
/**
 * Sends a refund through the processor, keyed by the refund id (see pushRefund), so it is never made
 * twice. Needs approval first unless skipApproval. Returns the refund as it stands after.
 */
export async function sendRefund(p, ctx, refundId, o = {}) {
    const go = await ctx.runMutation(p.component.refunds.begin, { refundId, skipApproval: o.skipApproval ?? false, by: o.by, now: Date.now() });
    if (go.state === 'send')
        await pushRefund(p, ctx, go);
    return await ctx.runQuery(p.component.refunds.get, { refundId });
}
/**
 * @internal The processor call for a refund already marked sending, and its outcome recorded.
 * The key is the refund's (a new one per attempt the processor refused), so sending again after a
 * timeout or crash returns the same refund instead of making a second. When the outcome is unknown
 * (no answer, a 5xx) the refund stays sending and sweep sends it again under the same key.
 */
export async function pushRefund(p, ctx, r) {
    const finish = (x) => ctx.runMutation(p.component.refunds.finish, { refundId: r.refundId, ...x, now: Date.now() });
    // Only the processor call is guarded: a failure recording its answer must not be taken for a refusal
    // (which would send it again under a new key); it throws, and the refund stays sending for the sweep.
    let made;
    try {
        if (r.processor === 'stripe') {
            if (!r.paymentRef.startsWith('pi_'))
                throw new ConvexError('This Stripe payment has no PaymentIntent to refund; refund it in the Stripe dashboard.');
            const s = await stripe.createRefund(p.stripeKeys(), { paymentIntent: r.paymentRef, amountCents: r.amountCents, app: p.app, refundId: r.refundId }, { fetch: p.fetch, idempotencyKey: r.key });
            made = { id: s.id, state: stripeRefundState(s.status), error: `Stripe: the refund ${s.status}${s.failure_reason ? ` (${s.failure_reason})` : ''}.` };
        }
        else {
            const pp = await p.withPaypal(ctx, (call) => paypal.refundCapture(call, r.paymentRef, { amountCents: r.amountCents, customId: tagFor(p.app, r.refundId) }, r.key));
            made = { id: pp.id, state: paypalRefundState(pp.status), error: `PayPal: the refund ${pp.status.toLowerCase()}.` };
        }
    }
    catch (err) {
        const unknown = !(err instanceof ConvexError) && !(err instanceof ProcessorError && !err.retryable);
        await finish({ ok: false, done: false, unknown, error: errorText(err) });
        return;
    }
    if (made.state === 'failed')
        await finish({ ok: false, done: false, processorRefundId: made.id, error: made.error });
    else
        await finish({ ok: true, done: made.state === 'done', processorRefundId: made.id });
}
export async function recheckRefund(p, ctx, r) {
    const c = await ctx.runQuery(p.component.checkouts.get, { id: r.checkoutId });
    if (!c?.paymentRef)
        return;
    if (!r.processorRefundId) {
        // No answer, or a crash, between claiming and recording: send again under the same key.
        return await pushRefund(p, ctx, { refundId: r.id, key: refundKey(r.id, r.attempts), processor: c.processor, paymentRef: c.paymentRef, amountCents: r.amountCents });
    }
    const refundId = r.processorRefundId;
    const state = c.processor === 'stripe'
        ? stripeRefundState((await stripe.retrieveRefund(p.stripeKeys(), refundId, { fetch: p.fetch })).status)
        : paypalRefundState((await p.withPaypal(ctx, (call) => paypal.getRefund(call, refundId))).status);
    await ctx.runMutation(p.component.refunds.recordExternal, {
        processor: c.processor,
        paymentRef: c.paymentRef,
        processorRefundId: r.processorRefundId,
        amountCents: r.amountCents,
        state,
        refundId: r.id,
        now: Date.now(),
    });
}
//# sourceMappingURL=refunds.js.map