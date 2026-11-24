import { ConvexError } from 'convex/values';
import { orderCapture, paymentTokenLabel, PAYPAL_DECLINE_ISSUES, paypal, paypalMethodId, paypalTokenOf, RECURRING_USAGE_PATTERN } from '../core/paypal.js';
import { METHOD_REMOVED } from '../core/declines.js';
import { ProcessorError, tagFor } from '../core/types.js';
import { declineOf } from './saved.js';
import { errorText } from './util.js';
const UNUSABLE = 'That payment method couldn’t be used. Please enter your details again.';
const NOT_VERIFIED = 'That card couldn’t be verified. Please check the details, or use another card.';
async function sha256Hex(text) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
/**
 * The owner as PayPal's merchant_customer_id: `<app>.<type>.<id>`, or the app and a hash of that when
 * it is too long or has characters PayPal refuses (1–64 of [0-9a-zA-Z-_.^*$@#]).
 */
export async function paypalOwnerTag(app, owner) {
    const plain = `${app}.${owner.type}.${owner.id}`;
    if (plain.length <= 64 && /^[0-9a-zA-Z\-_.^*$@#]+$/.test(plain))
        return plain;
    return `${app.replace(/[^0-9a-zA-Z\-_]/g, '').slice(0, 20)}.${(await sha256Hex(plain)).slice(0, 40)}`;
}
/** PayPal-Request-Id allows 108 characters; longer charge keys are hashed (the same key, the same id). */
export async function chargeRequestId(chargeKey) {
    return chargeKey.length <= 100 ? `charge-${chargeKey}` : `charge-${(await sha256Hex(chargeKey)).slice(0, 64)}`;
}
const viewOf = (m) => ({
    paymentMethodId: paypalMethodId(m.paymentTokenId),
    processor: 'paypal',
    kind: m.kind,
    label: m.label,
    declined: m.declined,
    createdAt: m.createdAt,
});
export async function setupPaypalMethod(p, ctx, a) {
    const keys = p.paypalKeys();
    await p.takeLimits(ctx, 'setup', a.payer.email);
    const customerId = (await ctx.runQuery(p.component.customers.paypalCustomer, { app: p.app, owner: a.owner })) ?? undefined;
    const site = p.url('/');
    try {
        const token = await p.withPaypal(ctx, async (call) => paypal.createSetupToken(call, {
            kind: a.kind,
            customerId,
            merchantCustomerId: await paypalOwnerTag(p.app, a.owner),
            description: a.description ?? `Payments to ${p.options.brandName ?? 'us'}, charged when you owe them`,
            returnUrl: site,
            cancelUrl: site,
            brandName: p.options.brandName,
            ...(a.recurring ? { usagePattern: RECURRING_USAGE_PATTERN } : {}),
        }, `setup-${crypto.randomUUID()}`));
        return { setupTokenId: token.id, clientId: keys.clientId };
    }
    catch (err) {
        console.error(`payments: PayPal setup token for ${a.owner.type}:${a.owner.id} failed: ${errorText(err)}`);
        throw new ConvexError('PayPal couldn’t start saving a payment method just now. Please try again in a moment.');
    }
}
/**
 * Saves the method a setup token was approved with, for `owner`. The setup token must carry this
 * owner's tag (it came from the browser, and anyone could send someone else's). A card whose $0
 * check failed is deleted from PayPal's vault again and refused.
 */
export async function savePaypalMethod(p, ctx, a) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(a.setupTokenId))
        throw new ConvexError(UNUSABLE);
    await p.takeLimits(ctx, 'save', a.payerEmail);
    const tag = await paypalOwnerTag(p.app, a.owner);
    const token = await p.withPaypal(ctx, async (call) => {
        let setup;
        try {
            setup = await paypal.getSetupToken(call, a.setupTokenId);
        }
        catch (err) {
            if (err instanceof ProcessorError && err.status >= 400 && err.status < 500)
                throw new ConvexError(UNUSABLE);
            throw err;
        }
        if (setup.customer?.merchant_customer_id !== tag)
            throw new ConvexError(UNUSABLE);
        // Still with the buyer (PayPal's page, or 3-D Secure). Anything else is PayPal's to accept or refuse below.
        if (setup.status === 'PAYER_ACTION_REQUIRED')
            throw new ConvexError('PayPal hasn’t approved that payment method yet. Please try again.');
        try {
            return await paypal.createPaymentToken(call, a.setupTokenId, `save-${a.setupTokenId}`);
        }
        catch (err) {
            // A card that failed its check is refused here (seen in the sandbox: 422 INVALID_PAYMENT_SOURCE).
            if (err instanceof ProcessorError && err.status === 422)
                throw new ConvexError(NOT_VERIFIED);
            throw err;
        }
    });
    const checked = token.payment_source?.card?.verification_status;
    if (token.payment_source?.card && checked !== 'VERIFIED')
        console.warn(`payments: PayPal saved card ${token.id} with verification ${checked ?? 'not reported'}`);
    if (checked === 'FAILED') {
        await p
            .withPaypal(ctx, (call) => paypal.deletePaymentToken(call, token.id))
            .catch((err) => console.warn(`payments: couldn’t delete unverified PayPal token ${token.id}: ${errorText(err)}`));
        throw new ConvexError(NOT_VERIFIED);
    }
    const what = paymentTokenLabel(token);
    const paypalCustomerId = token.customer?.id;
    if (!what || !paypalCustomerId)
        throw new Error(`PayPal saved ${token.id} without saying what it is or whose.`);
    const saved = await ctx.runMutation(p.component.customers.savePaypalMethod, {
        app: p.app,
        owner: a.owner,
        paypalCustomerId,
        paymentTokenId: token.id,
        kind: what.kind,
        label: what.label,
        // A PayPal account's agreement, said again with each recurring charge.
        usagePattern: what.kind === 'paypal' ? (a.recurring ? RECURRING_USAGE_PATTERN : 'UNSCHEDULED_POSTPAID') : undefined,
        now: Date.now(),
    });
    // The same setup token saved again after the method was removed: PayPal has deleted it.
    if (saved.removed)
        throw new ConvexError(UNUSABLE);
    return viewOf(saved);
}
/** The owner's PayPal methods, newest first, from the library's own record (PayPal's list lags). */
export async function paypalMethods(p, ctx, owner) {
    return (await ctx.runQuery(p.component.customers.paypalMethods, { app: p.app, owner })).map(viewOf);
}
/** A PayPal method id, checked to be this owner's; throws otherwise. */
export async function verifyPaypalOwner(p, ctx, owner, paymentMethodId) {
    const tokenId = paypalTokenOf(paymentMethodId);
    const found = tokenId ? await ctx.runQuery(p.component.customers.paypalMethod, { paymentTokenId: tokenId }) : null;
    if (!found || found.method.removed || found.app !== p.app || found.owner.type !== owner.type || found.owner.id !== owner.id)
        throw new ConvexError(UNUSABLE);
    return { ...viewOf(found.method), customerId: found.paypalCustomerId };
}
export async function removePaypalMethod(p, ctx, paymentMethodId) {
    const tokenId = paypalTokenOf(paymentMethodId);
    if (!tokenId)
        throw new ConvexError(UNUSABLE);
    await p.withPaypal(ctx, async (call) => {
        try {
            await paypal.deletePaymentToken(call, tokenId);
        }
        catch (err) {
            if (!(err instanceof ProcessorError && err.status === 404))
                throw err;
        }
    });
    await ctx.runMutation(p.component.customers.removePaypalMethod, { paymentTokenId: tokenId, now: Date.now() });
}
const declinedIssue = (err) => err instanceof ProcessorError && err.processor === 'paypal' && err.status === 422 && !!err.code && PAYPAL_DECLINE_ISSUES.has(err.code);
/**
 * Settles an off-session checkout from PayPal's order: a completed capture is paid, a pending one
 * processing (PAYMENT.CAPTURE.COMPLETED settles it later), a declined one failed (the method marked).
 * Returns false when the order has no capture to go by.
 */
async function settleCharge(p, ctx, c, order) {
    const capture = orderCapture(order);
    if (!capture)
        return false;
    if (capture.status === 'DECLINED' || capture.status === 'FAILED') {
        await ctx.runMutation(p.component.checkouts.settleFailed, {
            id: c.id,
            reason: `PayPal ${capture.status.toLowerCase()} the charge.`,
            declined: true,
            declineCode: capture.status,
            declineKind: 'soft',
            processorCheckoutId: order.id,
            now: Date.now(),
        });
        return true;
    }
    await p.settlePaypalOrder(ctx, c.id, order);
    return true;
}
/**
 * Charges an off-session checkout on a PayPal method (saved.ts's chargeNow hands it over). Every try
 * uses the same PayPal-Request-Id, so PayPal makes one order however many times it is asked; a try
 * with no answer is asked again after a minute, two..., then left to a person.
 */
export async function chargePaypalNow(p, ctx, c, note) {
    const tokenId = c.paymentMethodId ? paypalTokenOf(c.paymentMethodId) : null;
    if (!tokenId || !c.chargeKey)
        return await note('The charge is missing its PayPal payment method.', false);
    const saved = await ctx.runQuery(p.component.customers.paypalMethod, { paymentTokenId: tokenId });
    if (saved?.method.removed) {
        await ctx.runMutation(p.component.checkouts.settleFailed, {
            id: c.id,
            reason: 'The payer removed this payment method.',
            declined: true,
            declineCode: METHOD_REMOVED,
            declineKind: 'hard',
            now: Date.now(),
        });
        return;
    }
    let order;
    try {
        const requestId = await chargeRequestId(c.chargeKey);
        order = await p.withPaypal(ctx, (call) => paypal.chargeVaulted(call, {
            customId: tagFor(p.app, c.id),
            description: c.description,
            amountCents: c.amountCents,
            kind: c.method === 'paypal' ? 'paypal' : 'card',
            vaultId: tokenId,
            // A schedule's charge is a recurring one, said so with the agreement or the card's first payment.
            ...(c.scheduleId ? { recurring: { usagePattern: saved?.method.usagePattern ?? undefined, networkRef: saved?.method.networkRef ?? undefined } } : {}),
        }, requestId));
    }
    catch (err) {
        // The same charge paid before, under a request id PayPal has since forgotten: a person looks in PayPal.
        if (err instanceof ProcessorError && err.code === 'DUPLICATE_INVOICE_ID')
            return await note('PayPal already has a payment for this charge (duplicate invoice id); look it up in PayPal before doing anything.', false);
        if (declinedIssue(err)) {
            await ctx.runMutation(p.component.checkouts.settleFailed, { id: c.id, reason: err.message, declined: true, ...declineOf({ processor: 'paypal', code: err.code }), now: Date.now() });
            return;
        }
        const retry = err instanceof ProcessorError && err.retryable;
        console.warn(`payments: PayPal charge of ${c.id} (try ${c.chargeAttempts + 1}) ${retry ? 'will be retried' : 'needs a person'}: ${errorText(err)}`);
        return await note(errorText(err), retry);
    }
    if (await settleCharge(p, ctx, c, order))
        return;
    await note(`PayPal left the charge ${order.status}.`, false, order.id);
}
/**
 * A person gives up on a PayPal charge whose outcome was unknown. An order PayPal made for it is
 * looked at first: captured means paid (settled instead). Without an order id nothing more can be
 * asked here; a capture that turns up later is caught by the nightly comparison.
 */
export async function giveUpPaypalCharge(p, ctx, c, who) {
    if (c.processorCheckoutId) {
        const id = c.processorCheckoutId;
        const order = await p.withPaypal(ctx, (call) => paypal.getOrder(call, id));
        if (await settleCharge(p, ctx, c, order))
            return { status: (await ctx.runQuery(p.component.checkouts.get, { id: c.id }))?.status ?? c.status };
    }
    await ctx.runMutation(p.component.checkouts.settleFailed, { id: c.id, reason: `Given up by ${who}: ${c.lastError ?? 'the charge didn’t complete'}`, now: Date.now() });
    return { status: 'failed' };
}
//# sourceMappingURL=paypalVault.js.map