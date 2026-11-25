import { getOrderOrNull, paypal } from '../core/paypal.js';
import { sessionState, stripe } from '../core/stripe.js';
import { ProcessorError } from '../core/types.js';
import { recheckRefund } from './refunds.js';
import { sweepIntent } from './saved.js';
import { errorText } from './util.js';
/** A PayPal checkout still pending after this long is looked at by sweep (the buyer may have approved and closed the tab). */
const PAYPAL_LOOK_AFTER_MS = 5 * 60_000;
/** A refund still sending after this long is checked with the processor. */
const REFUND_STUCK_MS = 10 * 60_000;
/**
 * Every 10 minutes (registerCrons). PayPal checkouts pending over 5 minutes: captured if the buyer
 * approved (they may have closed the tab: fix a), abandoned once expired. Expired Stripe sessions
 * and on-session payments: settled if paid, else ended at Stripe and abandoned. Off-session charges
 * whose outcome never came back: asked again. Refunds left sending over 10 minutes: asked about
 * (or sent again, safely, under the same key).
 */
export async function sweep(p, ctx) {
    const now = Date.now();
    const out = { checked: 0, settled: 0, abandoned: 0, refunds: 0, errors: 0 };
    for (const c of await ctx.runQuery(p.component.checkouts.due, { limit: 200 })) {
        if (c.app !== p.app || c.status === 'processing')
            continue;
        const expired = c.expiresAt <= now;
        const look = c.kind === 'offSession' ? true : expired || (c.processor === 'paypal' && c.status === 'pending' && c.createdAt <= now - PAYPAL_LOOK_AFTER_MS);
        if (!look)
            continue;
        try {
            const before = c.status;
            // A PayPal retry on the app's page is a PayPal order like a hosted one; off-session charges and Stripe's own go through sweepIntent.
            const asOrder = c.kind === 'hosted' || (c.kind === 'onSession' && c.processor === 'paypal');
            const acted = asOrder ? (await sweepOne(p, ctx, c, expired), true) : await sweepIntent(p, ctx, c, expired, now);
            if (!acted)
                continue;
            out.checked++;
            const after = (await ctx.runQuery(p.component.checkouts.get, { id: c.id }))?.status;
            if (after && after !== before) {
                if (after === 'abandoned')
                    out.abandoned++;
                else
                    out.settled++;
            }
        }
        catch (err) {
            out.checked++;
            out.errors++;
            console.error(`payments: sweep of checkout ${c.id} failed: ${errorText(err)}`);
        }
    }
    for (const r of await ctx.runQuery(p.component.refunds.stuck, { before: now - REFUND_STUCK_MS, limit: 50 })) {
        try {
            await recheckRefund(p, ctx, r);
            out.refunds++;
        }
        catch (err) {
            out.errors++;
            console.error(`payments: checking refund ${r.id} failed: ${errorText(err)}`);
        }
    }
    return out;
}
async function sweepOne(p, ctx, c, expired) {
    const abandon = () => ctx.runMutation(p.component.checkouts.abandon, { id: c.id, now: Date.now() });
    if (!c.processorCheckoutId)
        return expired ? await abandon() : null;
    if (c.processor === 'paypal') {
        const id = c.processorCheckoutId;
        const order = await p.withPaypal(ctx, (call) => getOrderOrNull(call, id));
        if (order?.status === 'APPROVED') {
            let outcome;
            try {
                outcome = await p.capturePaypal(ctx, c.id, id, 'background');
            }
            catch (err) {
                // Before its time, the next sweep tries again; past it, look once more and give up rather than retry for ever.
                if (!expired)
                    throw err;
                console.warn(`payments: capturing expired PayPal order ${id} failed: ${errorText(err)}`);
                outcome = 'failed';
            }
            if (!expired || !outcome)
                return null;
            // Declined (the buyer left without choosing another way to pay) or not capturable, and past its time.
            const now = await p.withPaypal(ctx, (call) => paypal.getOrder(call, id));
            return now.status === 'COMPLETED' ? await p.settlePaypalOrder(ctx, c.id, now) : await abandon();
        }
        if (order?.status === 'COMPLETED')
            return await p.settlePaypalOrder(ctx, c.id, order);
        return expired || order?.status === 'VOIDED' ? await abandon() : null;
    }
    const keys = p.stripeKeys();
    const s = await stripe.retrieveSession(keys, c.processorCheckoutId, { fetch: p.fetch });
    const state = sessionState(s);
    if (state === 'paid' || state === 'processing')
        return await p.settleStripeSession(ctx, c.id, s);
    if (state === 'open') {
        try {
            await stripe.expireSession(keys, s.id, { fetch: p.fetch });
        }
        catch (err) {
            // Paid in the moment between the two calls: the next sweep (or the webhook) settles it.
            if (err instanceof ProcessorError && err.status === 400)
                return null;
            throw err;
        }
    }
    return await abandon();
}
//# sourceMappingURL=sweep.js.map