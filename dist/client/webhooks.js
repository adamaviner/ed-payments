import { RECURRING_USAGE_PATTERN, captureOrderId, moneyCents, orderCustomId, parsePaypalEvent, paymentTokenLabel, paypalMethodId, paypalTokenOf, refundCaptureId, verifyPaypalWebhook, } from '../core/paypal.js';
import { STRIPE_EVENTS, parseStripeEvent, paymentIntentId, stripe, verifyStripeSignature } from '../core/stripe.js';
import { parseTag } from '../core/types.js';
import { onIntentEvent } from './saved.js';
import { errorText, paypalRefundState, stripeRefundState } from './util.js';
/** How far a PayPal delivery's transmission time may be from now. */
const PAYPAL_WEBHOOK_TOLERANCE_MS = 10 * 60_000;
const text = (status, body) => new Response(body, { status });
async function once(p, ctx, processor, id, type, act) {
    if ((await ctx.runMutation(p.component.events.begin, { processor, eventId: id, type, now: Date.now() })) === 'seen')
        return text(200, 'Already handled');
    try {
        const outcome = await act();
        await ctx.runMutation(p.component.events.finish, { processor, eventId: id, outcome });
        return text(200, outcome);
    }
    catch (err) {
        console.error(`payments: ${processor} event ${id} (${type}) failed, the processor will retry: ${errorText(err)}`);
        return text(500, 'Failed; will be retried');
    }
}
// ── Stripe ───────────────────────────────────────────────────────────────────────────────────────
export async function handleStripeWebhook(p, ctx, request, onUnhandled) {
    const keys = p.options.stripe?.();
    if (!keys?.secretKey || !keys.webhookSecret)
        return text(503, 'Stripe isn’t set up on this deployment');
    const body = await request.text();
    if (!(await verifyStripeSignature(body, request.headers.get('stripe-signature'), keys.webhookSecret, Date.now())))
        return text(400, 'Bad signature');
    const event = parseStripeEvent(body);
    if (!event)
        return text(400, 'Not a Stripe event');
    return await once(p, ctx, 'stripe', event.id, event.type, async () => {
        const outcome = await actOnStripe(p, ctx, event);
        // An event of a kind the library handles, for one of this app's objects, is the library's alone.
        const ours = outcome === 'handled' || (outcome === 'ignored' && KNOWN.has(event.type));
        if (!ours && onUnhandled)
            await onUnhandled(ctx, event);
        return outcome;
    });
}
const KNOWN = new Set(STRIPE_EVENTS);
async function actOnStripe(p, ctx, event) {
    const object = event.data.object;
    if (event.type.startsWith('checkout.session.'))
        return await onSession(p, ctx, event.type, object);
    switch (event.type) {
        case 'payment_intent.succeeded':
        case 'payment_intent.processing':
        case 'payment_intent.payment_failed':
            return await onIntentEvent(p, ctx, event.type, object);
        case 'charge.refunded':
            return await onChargeRefunded(p, ctx, object);
        case 'refund.created':
        case 'refund.updated':
        case 'refund.failed':
            return await onStripeRefund(p, ctx, object);
        case 'charge.dispute.created':
        case 'charge.dispute.closed':
            return await onStripeDispute(p, ctx, event.type, object);
        case 'payment_method.detached':
            return await onMethodGone(p, ctx, object.id, 'The card or bank account was removed at Stripe.');
        default:
            return 'ignored';
    }
}
async function onSession(p, ctx, type, s) {
    // Not tagged with this app (a payment link, another app on the same account): not ours.
    if (s.metadata?.app !== p.app || !s.client_reference_id)
        return 'foreign';
    const c = (await ctx.runQuery(p.component.checkouts.byProcessorId, { processorCheckoutId: s.id })) ?? (await ctx.runQuery(p.component.checkouts.get, { id: s.client_reference_id }));
    if (!c || c.app !== p.app || c.processor !== 'stripe') {
        console.warn(`payments: Stripe session ${s.id} is tagged ${p.app} but no checkout has it`);
        return 'foreign';
    }
    switch (type) {
        case 'checkout.session.completed':
        case 'checkout.session.async_payment_succeeded':
            await p.settleStripeSession(ctx, c.id, s);
            return 'handled';
        case 'checkout.session.async_payment_failed':
            await ctx.runMutation(p.component.checkouts.settleFailed, { id: c.id, reason: 'The bank payment failed.', now: Date.now() });
            return 'handled';
        case 'checkout.session.expired':
            await ctx.runMutation(p.component.checkouts.abandon, { id: c.id, now: Date.now() });
            return 'handled';
        default:
            return 'ignored';
    }
}
/**
 * A charge was refunded (in full or in part, here or in the dashboard). Since 2022 Stripe doesn't
 * list the refunds in this event, so they are fetched and each recorded; the ledger matches its own.
 */
async function onChargeRefunded(p, ctx, charge) {
    const pi = charge.payment_intent;
    const c = pi ? await ctx.runQuery(p.component.checkouts.byPaymentRef, { paymentRef: pi }) : null;
    if (!pi || !c || c.app !== p.app)
        return 'foreign';
    const refunds = await stripe.refundsOf(p.stripeKeys(), pi, { fetch: p.fetch });
    for (const r of refunds.data)
        await recordStripeRefund(p, ctx, pi, r);
    return 'handled';
}
async function onStripeRefund(p, ctx, r) {
    const pi = r.payment_intent;
    if (!pi)
        return 'foreign';
    return (await recordStripeRefund(p, ctx, pi, r)) === 'foreign' ? 'foreign' : 'handled';
}
function recordStripeRefund(p, ctx, pi, r) {
    return ctx.runMutation(p.component.refunds.recordExternal, {
        processor: 'stripe',
        paymentRef: pi,
        processorRefundId: r.id,
        amountCents: r.amount,
        state: stripeRefundState(r.status),
        refundId: r.metadata?.app === p.app ? r.metadata.refundId : undefined,
        now: Date.now(),
    });
}
async function onStripeDispute(p, ctx, type, d) {
    const pi = paymentIntentId(d);
    if (!pi)
        return 'foreign';
    const res = await ctx.runMutation(p.component.disputes.record, {
        processor: 'stripe',
        paymentRef: pi,
        disputeId: d.id,
        status: type === 'charge.dispute.created' ? 'opened' : 'closed',
        outcome: type === 'charge.dispute.closed' ? d.status : undefined,
        lost: type === 'charge.dispute.closed' && d.status === 'lost',
        reason: d.reason,
        amountCents: d.amount,
        now: Date.now(),
    });
    return res === 'foreign' ? 'foreign' : 'handled';
}
/**
 * A saved method was removed at the processor (detached at Stripe; at PayPal, the payer cancelled the
 * agreement or the token was deleted): marked removed, and the schedules using it cancelled. A
 * method this library never saved isn't its business.
 */
async function onMethodGone(p, ctx, paymentMethodId, reason) {
    const tokenId = paypalTokenOf(paymentMethodId);
    const known = tokenId
        ? (await ctx.runQuery(p.component.customers.paypalMethod, { paymentTokenId: tokenId }))?.app === p.app
        : !!(await ctx.runQuery(p.component.customers.method, { stripePaymentMethodId: paymentMethodId }));
    if (!known)
        return 'foreign';
    await ctx.runMutation(p.component.schedules.methodRemoved, { paymentMethodId, reason, now: Date.now() });
    return 'handled';
}
// ── PayPal ───────────────────────────────────────────────────────────────────────────────────────
export async function handlePaypalWebhook(p, ctx, request) {
    const keys = p.options.paypal?.();
    if (!keys?.clientId || !keys.clientSecret || !keys.webhookId)
        return text(503, 'PayPal isn’t set up on this deployment');
    const body = await request.text();
    const event = parsePaypalEvent(body);
    if (!event)
        return text(400, 'Not a PayPal event');
    // Checked here, before PayPal is asked: a replayed or made-up delivery costs nothing. PayPal sends
    // each retry afresh, with its own time.
    const sentAt = Date.parse(request.headers.get('paypal-transmission-time') ?? '');
    if (!Number.isFinite(sentAt) || Math.abs(Date.now() - sentAt) > PAYPAL_WEBHOOK_TOLERANCE_MS)
        return text(400, 'Stale or missing transmission time');
    let verified;
    try {
        verified = await p.withPaypal(ctx, (call) => verifyPaypalWebhook(keys, call.token, request.headers, body, { fetch: p.fetch }));
    }
    catch (err) {
        // PayPal couldn't be asked: not the sender's fault, so let it retry.
        console.error(`payments: couldn’t verify PayPal event ${event.id}: ${errorText(err)}`);
        return text(500, 'Couldn’t verify; will be retried');
    }
    if (!verified)
        return text(400, 'Bad signature');
    return await once(p, ctx, 'paypal', event.id, event.event_type, async () => await actOnPaypal(p, ctx, event));
}
/** The checkout a PayPal object belongs to: by this app's tag first, else by the order id. */
async function paypalCheckout(p, ctx, customId, orderId) {
    const tag = parseTag(customId);
    if (customId && tag?.app !== p.app)
        return null;
    const c = (tag ? await ctx.runQuery(p.component.checkouts.get, { id: tag.id }) : null) ?? (orderId ? await ctx.runQuery(p.component.checkouts.byProcessorId, { processorCheckoutId: orderId }) : null);
    return c && c.app === p.app && c.processor === 'paypal' ? c : null;
}
async function actOnPaypal(p, ctx, event) {
    switch (event.event_type) {
        case 'CHECKOUT.ORDER.APPROVED': {
            // The buyer approved; capture now rather than wait for them to come back (fix a).
            const order = event.resource;
            const c = await paypalCheckout(p, ctx, orderCustomId(order), order.id);
            if (!c)
                return 'foreign';
            // capturePaypal leaves a checkout that was given up alone; the buyer is simply never charged.
            // After a decline only the buyer captures (the buttons call completeReturn), so this leaves
            // it alone and answers 200: PayPal sending the event again wouldn't change anything.
            await p.capturePaypal(ctx, c.id, order.id, 'background');
            return 'handled';
        }
        case 'PAYMENT.CAPTURE.COMPLETED':
        case 'PAYMENT.CAPTURE.PENDING':
        case 'PAYMENT.CAPTURE.DECLINED':
        case 'PAYMENT.CAPTURE.DENIED': {
            const capture = event.resource;
            const c = await paypalCheckout(p, ctx, capture.custom_id, captureOrderId(capture));
            if (!c)
                return 'foreign';
            const status = event.event_type === 'PAYMENT.CAPTURE.COMPLETED' ? 'COMPLETED' : event.event_type === 'PAYMENT.CAPTURE.PENDING' ? 'PENDING' : 'DECLINED';
            await p.settlePaypalOrder(ctx, c.id, { id: captureOrderId(capture) ?? c.processorCheckoutId ?? '', status: 'COMPLETED', purchase_units: [{ payments: { captures: [{ ...capture, status }] } }] });
            return 'handled';
        }
        case 'PAYMENT.CAPTURE.REFUNDED':
        case 'PAYMENT.CAPTURE.REVERSED': {
            const r = event.resource;
            const captureId = refundCaptureId(r);
            const amount = moneyCents(r.amount);
            if (!captureId || amount === null)
                return 'foreign';
            const tag = parseTag(r.custom_id);
            const res = await ctx.runMutation(p.component.refunds.recordExternal, {
                processor: 'paypal',
                paymentRef: captureId,
                processorRefundId: r.id,
                amountCents: amount,
                state: paypalRefundState(r.status),
                refundId: tag?.app === p.app ? tag.id : undefined,
                reason: event.event_type === 'PAYMENT.CAPTURE.REVERSED' ? 'Reversed by PayPal' : undefined,
                now: Date.now(),
            });
            return res === 'foreign' ? 'foreign' : 'handled';
        }
        case 'VAULT.PAYMENT-TOKEN.DELETED': {
            const id = typeof event.resource.id === 'string' ? event.resource.id : null;
            return id ? await onMethodGone(p, ctx, paypalMethodId(id), 'The payer removed this payment method at PayPal.') : 'foreign';
        }
        case 'VAULT.PAYMENT-TOKEN.CREATED':
            return await onPaypalTokenCreated(p, ctx, event.resource);
        case 'CUSTOMER.DISPUTE.CREATED':
        case 'CUSTOMER.DISPUTE.RESOLVED': {
            const d = event.resource;
            const captureId = d.disputed_transactions?.[0]?.seller_transaction_id;
            if (!captureId)
                return 'foreign';
            const res = await ctx.runMutation(p.component.disputes.record, {
                processor: 'paypal',
                paymentRef: captureId,
                disputeId: d.dispute_id,
                status: event.event_type === 'CUSTOMER.DISPUTE.CREATED' ? 'opened' : 'closed',
                outcome: d.dispute_outcome?.outcome_code,
                lost: d.dispute_outcome?.outcome_code === 'RESOLVED_BUYER_FAVOUR',
                reason: d.reason,
                amountCents: moneyCents(d.dispute_amount) ?? undefined,
                now: Date.now(),
            });
            return res === 'foreign' ? 'foreign' : 'handled';
        }
        default:
            return 'ignored';
    }
}
/**
 * A PayPal method saved after the payment that asked for it (the capture said vault APPROVED): the
 * schedule waiting for it takes it (schedules.paypalTokenCreated says how it is found). PayPal sends
 * this event for every token, so one this app saved another way (a setup token, a VAULTED capture)
 * is simply handled. With no order named and several schedules of the same PayPal customer waiting,
 * none is guessed: the schedules worker reads each one's order again and finds its own token there.
 */
async function onPaypalTokenCreated(p, ctx, t) {
    const what = paymentTokenLabel(t);
    const customerId = t.customer?.id;
    if (typeof t.id !== 'string' || !customerId || !what)
        return 'foreign';
    const ntr = t.payment_source?.card?.network_transaction_reference;
    const res = await ctx.runMutation(p.component.schedules.paypalTokenCreated, {
        app: p.app,
        orderId: t.metadata?.order_id,
        paypal: {
            paypalCustomerId: customerId,
            paymentTokenId: t.id,
            kind: what.kind,
            label: what.label,
            usagePattern: what.kind === 'paypal' ? RECURRING_USAGE_PATTERN : undefined,
            networkRef: ntr?.id ? { id: ntr.id, ...(ntr.network ? { network: ntr.network } : {}) } : undefined,
        },
        now: Date.now(),
    });
    if (res === 'ambiguous') {
        console.warn(`payments: PayPal token ${t.id} names no order, and more than one schedule of its customer waits for one; none was given it`);
        return 'ignored';
    }
    return res === 'foreign' ? 'foreign' : 'handled';
}
//# sourceMappingURL=webhooks.js.map