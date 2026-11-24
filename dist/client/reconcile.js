// The nightly comparison with the processors. Each payment is looked at from both sides; every
// difference opens an issue (one per payment and kind) and a difference that has gone away resolves
// it. Refunds found at Stripe that the ledger lacks are recorded on the way (a missed webhook heals).
import { orderCapture, moneyCents, paypal, searchTransactions } from '../core/paypal.js';
import { intentState, paymentIntentId, sessionState, stripe } from '../core/stripe.js';
import { ProcessorError, parseTag } from '../core/types.js';
import { errorText, stripeRefundState } from './util.js';
const DAY = 24 * 60 * 60_000;
const MAX_PAGES = 20;
const dollars = (cents) => `$${((cents ?? 0) / 100).toFixed(2)}`;
/**
 * What the ledger says went back through the processor: refunds with a processor id that are done.
 * Refunds recorded by hand without one (a cheque, cash) aren't at the processor, so they don't count
 * when comparing with it.
 */
async function processorRefunded(p, ctx, c) {
    const rows = await ctx.runQuery(p.component.refunds.forCheckout, { checkoutId: c.id });
    return rows.filter((r) => r.processorRefundId && (r.status === 'sent' || r.status === 'manual')).reduce((sum, r) => sum + r.amountCents, 0);
}
const isPaidHere = (c) => c.status === 'paid' || c.status === 'refund_needed';
export async function reconcile(p, ctx, days) {
    const now = Date.now();
    const since = now - Math.min(Math.max(days, 1), 31) * DAY;
    const out = { checked: 0, opened: 0, resolved: 0, refundsRecorded: 0, searched: false, errors: 0 };
    const ours = await checkoutsSince(p, ctx, since);
    const sync = async (processor, key, c, found, only) => {
        const r = await ctx.runMutation(p.component.issues.sync, { key, processor, checkoutId: c?.id, paymentRef: c?.paymentRef ?? undefined, found, only, now: Date.now() });
        out.opened += r.opened;
        out.resolved += r.resolved;
    };
    const guard = async (what, fn) => {
        try {
            await fn();
        }
        catch (err) {
            out.errors++;
            console.error(`payments: reconcile ${what} failed: ${errorText(err)}`);
        }
    };
    if (p.options.stripe?.())
        await guard('Stripe', () => stripeSide(p, ctx, since, ours, out, sync));
    if (p.options.paypal?.())
        await guard('PayPal', () => paypalSide(p, ctx, since, now, ours, out, sync, guard));
    return out;
}
async function checkoutsSince(p, ctx, since) {
    const all = [];
    let after;
    for (let i = 0; i < 50; i++) {
        const page = await ctx.runQuery(p.component.checkouts.createdSince, { since, after, limit: 200 });
        all.push(...page);
        if (page.length < 200)
            break;
        after = page[page.length - 1].createdAt;
    }
    return all.filter((c) => c.app === p.app);
}
async function stripeSide(p, ctx, since, ours, out, sync) {
    const keys = p.stripeKeys();
    const o = { fetch: p.fetch };
    const sinceSec = Math.floor(since / 1000);
    const sessions = [];
    let after;
    for (let i = 0; i < MAX_PAGES; i++) {
        const page = await stripe.listSessions(keys, sinceSec, after, o);
        sessions.push(...page.data.filter((s) => s.metadata?.app === p.app));
        if (!page.has_more || !page.data.length)
            break;
        after = page.data[page.data.length - 1].id;
    }
    const seen = new Set();
    for (const s of sessions) {
        out.checked++;
        const c = ours.find((x) => x.processorCheckoutId === s.id) ?? (s.client_reference_id ? await ctx.runQuery(p.component.checkouts.get, { id: s.client_reference_id }) : null);
        if (c)
            seen.add(c.id);
        const state = sessionState(s);
        const pi = paymentIntentId(s);
        const found = [];
        if (!c) {
            if (state === 'paid' || state === 'processing')
                found.push({ kind: 'missing_here', detail: `Stripe has a ${state} payment of ${dollars(s.amount_total)} (session ${s.id}) that isn’t recorded here.` });
        }
        else if (state === 'paid' && !isPaidHere(c)) {
            found.push({ kind: 'status_differs', detail: `Stripe says ${c.description} was paid; here it is ${c.status}.` });
        }
        else if (isPaidHere(c) && state !== 'paid') {
            found.push({ kind: 'status_differs', detail: `${c.description} is ${c.status} here, but Stripe’s session is ${state}.` });
        }
        else if (isPaidHere(c) && c.paidCents !== s.amount_total) {
            found.push({ kind: 'amount_differs', detail: `${c.description}: Stripe took ${dollars(s.amount_total)}, here ${dollars(c.paidCents)}.` });
        }
        await sync('stripe', c?.paymentRef ?? pi ?? s.id, c, found);
    }
    await stripeIntents(p, ctx, sinceSec, out, sync, seen);
    for (const c of ours) {
        if (c.processor !== 'stripe' || seen.has(c.id) || !(isPaidHere(c) || c.status === 'processing'))
            continue;
        out.checked++;
        const what = c.kind === 'hosted' ? 'session' : 'PaymentIntent';
        await sync('stripe', c.paymentRef ?? c.processorCheckoutId ?? c.id, c, [{ kind: 'missing_there', detail: `${c.description} is ${c.status} here, but Stripe has no such ${what} for this app.` }]);
    }
    await stripeRefunds(p, ctx, sinceSec, out, sync);
}
/**
 * Saved-method charges and on-session payments: PaymentIntents tagged for this app that aren't a
 * hosted checkout's (those are compared through their sessions).
 */
async function stripeIntents(p, ctx, sinceSec, out, sync, seen) {
    const keys = p.stripeKeys();
    const intents = [];
    let after;
    for (let i = 0; i < MAX_PAGES; i++) {
        const page = await stripe.listPaymentIntents(keys, sinceSec, after, { fetch: p.fetch });
        intents.push(...page.data.filter((pi) => pi.metadata?.app === p.app && pi.metadata.checkoutId));
        if (!page.has_more || !page.data.length)
            break;
        after = page.data[page.data.length - 1].id;
    }
    for (const pi of intents) {
        const c = await ctx.runQuery(p.component.checkouts.get, { id: pi.metadata?.checkoutId ?? '' });
        if (c?.kind === 'hosted')
            continue;
        const state = intentState(pi);
        // A refused or abandoned try that left nothing paid: nothing to compare.
        if (!c && state !== 'paid' && state !== 'processing')
            continue;
        out.checked++;
        if (c)
            seen.add(c.id);
        const found = [];
        if (!c)
            found.push({ kind: 'missing_here', detail: `Stripe has a ${state} payment of ${dollars(pi.amount)} (PaymentIntent ${pi.id}) that isn’t recorded here.` });
        else if (state === 'paid' && !isPaidHere(c))
            found.push({ kind: 'status_differs', detail: `Stripe says ${c.description} was paid; here it is ${c.status}.` });
        else if (isPaidHere(c) && state !== 'paid')
            found.push({ kind: 'status_differs', detail: `${c.description} is ${c.status} here, but Stripe’s PaymentIntent is ${pi.status}.` });
        else if (isPaidHere(c) && c.paidCents !== pi.amount_received)
            found.push({ kind: 'amount_differs', detail: `${c.description}: Stripe took ${dollars(pi.amount_received)}, here ${dollars(c.paidCents)}.` });
        await sync('stripe', c?.paymentRef ?? pi.id, c, found);
    }
}
/** Records refunds the ledger missed, then compares each touched payment's refunded total with Stripe's. */
async function stripeRefunds(p, ctx, sinceSec, out, sync) {
    const keys = p.stripeKeys();
    const o = { fetch: p.fetch };
    const refunds = [];
    let after;
    for (let i = 0; i < MAX_PAGES; i++) {
        const page = await stripe.listRefunds(keys, sinceSec, after, o);
        refunds.push(...page.data);
        if (!page.has_more || !page.data.length)
            break;
        after = page.data[page.data.length - 1].id;
    }
    const touched = new Set();
    for (const r of refunds) {
        if (!r.payment_intent)
            continue;
        const res = await ctx.runMutation(p.component.refunds.recordExternal, {
            processor: 'stripe',
            paymentRef: r.payment_intent,
            processorRefundId: r.id,
            amountCents: r.amount,
            state: stripeRefundState(r.status),
            refundId: r.metadata?.app === p.app ? r.metadata.refundId : undefined,
            now: Date.now(),
        });
        if (res === 'foreign')
            continue;
        if (res === 'recorded')
            out.refundsRecorded++;
        touched.add(r.payment_intent);
    }
    for (const pi of touched) {
        const c = await ctx.runQuery(p.component.checkouts.byPaymentRef, { paymentRef: pi });
        if (!c)
            continue;
        const all = await stripe.refundsOf(keys, pi, o);
        const there = all.data.filter((r) => r.status === 'succeeded').reduce((sum, r) => sum + r.amount, 0);
        const here = await processorRefunded(p, ctx, c);
        const found = there === here ? [] : [{ kind: 'amount_differs', detail: `${c.description}: Stripe has refunded ${dollars(there)}, here ${dollars(here)}.` }];
        await sync('stripe', `refunds:${pi}`, c, found);
    }
}
async function paypalSide(p, ctx, since, now, ours, out, sync, guard) {
    for (const c of ours) {
        if (c.processor !== 'paypal' || !c.processorCheckoutId)
            continue;
        // An abandoned or still pending checkout nobody approved is normal; sweep looks after pending ones.
        if (c.status === 'abandoned' || c.status === 'pending' || c.status === 'created')
            continue;
        out.checked++;
        await guard(`PayPal order ${c.processorCheckoutId}`, async () => {
            const order = await p.withPaypal(ctx, async (call) => {
                try {
                    return await paypal.getOrder(call, c.processorCheckoutId ?? '');
                }
                catch (err) {
                    if (err instanceof ProcessorError && err.status === 404)
                        return null;
                    throw err;
                }
            });
            await sync('paypal', c.paymentRef ?? c.processorCheckoutId ?? c.id, c, paypalFindings(c, order, await processorRefunded(p, ctx, c)));
        });
    }
    await guard('PayPal Transaction Search', () => paypalSearch(p, ctx, since, now, out, sync));
}
function paypalFindings(c, order, refunded) {
    if (!order)
        return isPaidHere(c) ? [{ kind: 'missing_there', detail: `${c.description} is ${c.status} here, but PayPal has no order ${c.processorCheckoutId}.` }] : [];
    const capture = orderCapture(order);
    const paidThere = !!capture && ['COMPLETED', 'PARTIALLY_REFUNDED', 'REFUNDED'].includes(capture.status);
    if (paidThere && !isPaidHere(c))
        return [{ kind: 'status_differs', detail: `PayPal says ${c.description} was paid; here it is ${c.status}.` }];
    if (!paidThere && isPaidHere(c))
        return [{ kind: 'status_differs', detail: `${c.description} is ${c.status} here, but PayPal’s order is ${order.status}.` }];
    if (!capture || !paidThere)
        return [];
    const amount = moneyCents(capture.amount);
    if (amount !== c.paidCents)
        return [{ kind: 'amount_differs', detail: `${c.description}: PayPal took ${dollars(amount)}, here ${dollars(c.paidCents)}.` }];
    if (capture.status === 'REFUNDED' && refunded < (c.paidCents ?? 0))
        return [{ kind: 'status_differs', detail: `PayPal has refunded ${c.description} in full; here ${dollars(refunded)}.` }];
    if (capture.status === 'PARTIALLY_REFUNDED' && refunded === 0)
        return [{ kind: 'status_differs', detail: `PayPal has refunded part of ${c.description}; nothing is refunded here.` }];
    if (capture.status === 'COMPLETED' && refunded > 0)
        return [{ kind: 'status_differs', detail: `${c.description} has ${dollars(refunded)} refunded here, but PayPal shows no refund.` }];
    return [];
}
/**
 * Captures tagged with this app that the component never heard of. Needs Transaction Search on the
 * PayPal REST app; when PayPal refuses (403), this is logged once a day and skipped.
 */
async function paypalSearch(p, ctx, since, now, out, sync) {
    const refusedAt = await ctx.runQuery(p.component.settings.searchRefusedAt, {});
    if (refusedAt !== null && now - refusedAt < DAY)
        return;
    try {
        for (let page = 1; page <= MAX_PAGES; page++) {
            const res = await p.withPaypal(ctx, (call) => searchTransactions(call, { start: since, end: now - 60_000, page }));
            for (const t of res.transactions) {
                const tag = parseTag(t.customField);
                if (tag?.app !== p.app || t.amountCents <= 0)
                    continue;
                out.checked++;
                const c = await ctx.runQuery(p.component.checkouts.byPaymentRef, { paymentRef: t.transactionId });
                const found = c
                    ? []
                    : [{ kind: 'missing_here', detail: `PayPal has a payment of ${dollars(t.amountCents)} (capture ${t.transactionId}) tagged for this app that isn’t recorded here.` }];
                // Only "missing here" is this check's to decide; the order comparison above owns the rest for this payment.
                await sync('paypal', t.transactionId, c, found, ['missing_here']);
            }
            if (page >= res.totalPages)
                break;
        }
        out.searched = true;
        if (refusedAt !== null)
            await ctx.runMutation(p.component.settings.setSearchRefused, { at: null });
    }
    catch (err) {
        // 403 is PayPal refusing the permission. A 401 is a bad token, which withPaypal already retried, so it is a real failure.
        if (err instanceof ProcessorError && err.status === 403) {
            console.info('payments: PayPal Transaction Search isn’t enabled for this REST app, so payments PayPal has but this app lacks can’t be looked for. Enable it in the PayPal developer dashboard.');
            await ctx.runMutation(p.component.settings.setSearchRefused, { at: now });
            return;
        }
        throw err;
    }
}
//# sourceMappingURL=reconcile.js.map