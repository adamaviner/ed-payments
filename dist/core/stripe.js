// Stripe over plain fetch: form-encoded requests with a pinned API version and idempotency keys,
// the few object shapes the library reads, and webhook signatures checked with Web Crypto. No SDK,
// so this runs in Convex's default runtime and in tests.
// Request shapes follow https://docs.stripe.com/api for API version 2026-10-28.endive (looked up
// 2026-11-16). That version removed `payment_method_types` from Checkout Sessions, so the method is
// chosen with `allowed_payment_method_types`, which only offers methods enabled in the Dashboard.
import { SAVED_METHOD_OPTIONS, SAVED_METHOD_TYPES } from './savedMethods.js';
import { ProcessorError } from './types.js';
export * from './savedMethods.js';
export const STRIPE_API_VERSION = '2026-10-28.endive';
export const STRIPE_API_BASE = 'https://api.stripe.com';
/** Stripe's form encoding: nested objects as a[b], arrays as a[0]; undefined is left out. */
export function formEncode(params) {
    const parts = [];
    const add = (name, value) => {
        if (value === undefined)
            return;
        if (Array.isArray(value))
            value.forEach((item, i) => add(`${name}[${i}]`, item));
        else if (value !== null && typeof value === 'object')
            for (const [k, v] of Object.entries(value))
                add(`${name}[${k}]`, v);
        else
            parts.push(`${encodeURIComponent(name)}=${encodeURIComponent(value === null ? '' : String(value))}`);
    };
    for (const [k, v] of Object.entries(params))
        add(k, v);
    return parts.join('&');
}
/** One Stripe API call; an error answer becomes a ProcessorError with Stripe's message and code. */
export async function stripeCall(keys, method, path, params, o) {
    const headers = { Authorization: `Bearer ${keys.secretKey}`, 'Stripe-Version': STRIPE_API_VERSION };
    let url = `${o.apiBase ?? STRIPE_API_BASE}${path}`;
    let body;
    const encoded = params ? formEncode(params) : '';
    if (method !== 'POST') {
        if (encoded)
            url += `?${encoded}`;
    }
    else {
        body = encoded;
        headers['Content-Type'] = 'application/x-www-form-urlencoded';
        if (o.idempotencyKey)
            headers['Idempotency-Key'] = o.idempotencyKey;
    }
    let res;
    try {
        res = await o.fetch(url, { method, headers, body });
    }
    catch (err) {
        throw new ProcessorError('stripe', 0, `Stripe couldn’t be reached: ${err instanceof Error ? err.message : String(err)}`);
    }
    const json = await res.json().catch(() => null);
    if (!res.ok) {
        const error = json?.error;
        const pi = error?.payment_intent;
        throw new ProcessorError('stripe', res.status, error?.message ?? `Stripe answered ${res.status}.`, error?.code, {
            type: error?.type,
            declineCode: error?.decline_code,
            adviceCode: error?.advice_code,
            paymentIntent: pi && typeof pi.id === 'string' ? { id: pi.id, status: String(pi.status) } : undefined,
        });
    }
    return json;
}
const idOf = (x) => (x === null || x === undefined ? null : typeof x === 'string' ? x : x.id);
/** The PaymentIntent id a session, charge, refund or dispute points at. */
export const paymentIntentId = (x) => idOf(x.payment_intent);
const MIN_EXPIRY_MS = 31 * 60_000;
const MAX_EXPIRY_MS = 24 * 60 * 60_000 - 60_000;
/** Unix seconds within Stripe's 30 minute to 24 hour window (a minute's margin each side). */
export function sessionExpiry(expiresAt, now) {
    return Math.floor(Math.min(Math.max(expiresAt, now + MIN_EXPIRY_MS), now + MAX_EXPIRY_MS) / 1000);
}
/** The Checkout Session for one checkout, tagged with the app (client_reference_id and metadata on the session and its PaymentIntent). */
export function sessionParams(i) {
    const metadata = { app: i.app, checkoutId: i.checkoutId };
    return {
        mode: 'payment',
        allowed_payment_method_types: [i.method === 'ach' ? 'us_bank_account' : 'card'],
        // Link would offer its own bank payment inside a card checkout, priced as the card the app chose
        // the processor and fee for. The app offers bank itself (method 'ach'), so a card session is card only.
        ...(i.method === 'ach' ? {} : { wallet_options: { link: { display: 'never' } } }),
        // Stripe takes one or the other: a Customer brings their own email.
        ...(i.customer ? { customer: i.customer } : { customer_email: i.email }),
        client_reference_id: i.checkoutId,
        metadata,
        payment_intent_data: { metadata, description: i.description.slice(0, 1000), ...(i.saveForLater ? { setup_future_usage: 'off_session' } : {}) },
        // Saved bank accounts are verified at once, as SetupIntents do (SAVED_METHOD_OPTIONS).
        ...(i.saveForLater && i.method === 'ach' ? { payment_method_options: { us_bank_account: { verification_method: 'instant', financial_connections: { permissions: ['payment_method'] } } } } : {}),
        line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: i.amountCents, product_data: { name: i.description.slice(0, 250) || 'Payment' } } }],
        expires_at: sessionExpiry(i.expiresAt, i.now),
        // Since 2026-10-28.endive the embedded value is `embedded_page` (`embedded` answers 400).
        ...(i.embedded ? { ui_mode: 'embedded_page', return_url: i.successUrl } : { success_url: i.successUrl, cancel_url: i.cancelUrl }),
    };
}
export function paymentIntentParams(i) {
    const metadata = { app: i.app, checkoutId: i.checkoutId };
    const common = { amount: i.amountCents, currency: 'usd', customer: i.customer, description: i.description.slice(0, 1000), metadata, allowed_payment_method_types: [...SAVED_METHOD_TYPES] };
    if (!i.offSession)
        return { ...common, payment_method_options: SAVED_METHOD_OPTIONS };
    return { ...common, payment_method: i.paymentMethod, off_session: true, confirm: true, error_on_requires_action: true };
}
/** card or ach for a Stripe payment method type; null for anything the library doesn't save. */
export const savedMethodKind = (type) => (type === 'card' ? 'card' : type === 'us_bank_account' ? 'ach' : null);
const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);
/** How a saved method reads to its owner, e.g. "Visa •••• 4242" or "Chase bank account •••• 6789". */
export function savedMethodLabel(pm) {
    if (pm.card)
        return `${capitalize(pm.card.brand)} •••• ${pm.card.last4}`;
    if (pm.us_bank_account)
        return `${pm.us_bank_account.bank_name ?? 'Bank'} account •••• ${pm.us_bank_account.last4 ?? '????'}`;
    return null;
}
export const customerOf = (x) => idOf(x.customer);
/**
 * Every item of a Stripe list, page by page (starting_after the last id), up to `maxPages`; past that
 * it throws, so a caller never takes a partial list for the whole.
 */
export async function allPages(page, maxPages = 20) {
    const out = [];
    let after;
    for (let i = 0; i < maxPages; i++) {
        const res = await page(after);
        out.push(...res.data);
        if (!res.has_more || !res.data.length)
            return out;
        after = res.data[res.data.length - 1].id;
    }
    throw new Error(`Stripe has more than ${maxPages} pages of these; look in Stripe.`);
}
export const stripe = {
    createSession: (keys, i, o) => stripeCall(keys, 'POST', '/v1/checkout/sessions', sessionParams(i), { idempotencyKey: `checkout-${i.checkoutId}`, ...o }),
    /** With the PaymentIntent's charge and balance transaction, for the fee Stripe kept. */
    retrieveSession: (keys, id, o) => stripeCall(keys, 'GET', `/v1/checkout/sessions/${encodeURIComponent(id)}`, { expand: ['payment_intent.latest_charge.balance_transaction'] }, o),
    expireSession: (keys, id, o) => stripeCall(keys, 'POST', `/v1/checkout/sessions/${encodeURIComponent(id)}/expire`, undefined, o),
    retrievePaymentIntent: (keys, id, o) => stripeCall(keys, 'GET', `/v1/payment_intents/${encodeURIComponent(id)}`, { expand: ['latest_charge.balance_transaction'] }, o),
    /** Keyed `refund-<refundId>` unless o.idempotencyKey says otherwise (a new attempt after Stripe refused one). */
    createRefund: (keys, r, o) => stripeCall(keys, 'POST', '/v1/refunds', { payment_intent: r.paymentIntent, amount: r.amountCents, metadata: { app: r.app, refundId: r.refundId } }, { idempotencyKey: `refund-${r.refundId}`, ...o }),
    retrieveRefund: (keys, id, o) => stripeCall(keys, 'GET', `/v1/refunds/${encodeURIComponent(id)}`, undefined, o),
    /** Created at or after `sinceSec`, newest first, 100 a page. */
    listSessions: (keys, sinceSec, startingAfter, o) => stripeCall(keys, 'GET', '/v1/checkout/sessions', { limit: 100, created: { gte: sinceSec }, starting_after: startingAfter }, o),
    /** Every refund of one PaymentIntent (up to 100). */
    /** Every refund of a PaymentIntent, all pages. */
    refundsOf: async (keys, paymentIntent, o) => ({
        data: await allPages((after) => stripeCall(keys, 'GET', '/v1/refunds', { payment_intent: paymentIntent, limit: 100, starting_after: after }, o)),
    }),
    listRefunds: (keys, sinceSec, startingAfter, o) => stripeCall(keys, 'GET', '/v1/refunds', { limit: 100, created: { gte: sinceSec }, starting_after: startingAfter }, o),
    /** A Customer for one payer of one app; the caller's idempotency key makes a repeat return the same one. */
    createCustomer: (keys, c, o) => stripeCall(keys, 'POST', '/v1/customers', { email: c.email, name: c.name, metadata: { app: c.app, owner: c.owner } }, o),
    /** A customer's saved payment methods, newest first. */
    customerMethods: (keys, customer, o) => stripeCall(keys, 'GET', `/v1/customers/${encodeURIComponent(customer)}/payment_methods`, { limit: 100 }, o),
    retrievePaymentMethod: (keys, id, o) => stripeCall(keys, 'GET', `/v1/payment_methods/${encodeURIComponent(id)}`, undefined, o),
    /** Saves a card or bank account for charging later with nobody present (usage off_session also collects a bank account's debit mandate). */
    createSetupIntent: (keys, s, o) => stripeCall(keys, 'POST', '/v1/setup_intents', {
        customer: s.customer,
        usage: 'off_session',
        allowed_payment_method_types: [...(s.types ?? SAVED_METHOD_TYPES)],
        payment_method_options: SAVED_METHOD_OPTIONS,
        metadata: { app: s.app, owner: s.owner },
    }, o),
    /** Takes a saved method off its Customer, so it can't be charged again (needs write access to PaymentMethods). */
    detachPaymentMethod: (keys, id, o) => stripeCall(keys, 'POST', `/v1/payment_methods/${encodeURIComponent(id)}/detach`, undefined, o),
    /** Keyed, like a session or a refund: a repeat after no answer must replay the same PaymentIntent. */
    createPaymentIntent: (keys, i, o) => stripeCall(keys, 'POST', '/v1/payment_intents', paymentIntentParams(i), o),
    /** Without the expansions, for its status and client secret. */
    paymentIntent: (keys, id, o) => stripeCall(keys, 'GET', `/v1/payment_intents/${encodeURIComponent(id)}`, undefined, o),
    /** With the payment method used, for whether it was a card or a bank account. */
    paymentIntentWithMethod: (keys, id, o) => stripeCall(keys, 'GET', `/v1/payment_intents/${encodeURIComponent(id)}`, { expand: ['payment_method', 'latest_charge.balance_transaction'] }, o),
    cancelPaymentIntent: (keys, id, o) => stripeCall(keys, 'POST', `/v1/payment_intents/${encodeURIComponent(id)}/cancel`, undefined, o),
    /** Created at or after `sinceSec`, newest first, 100 a page. */
    listPaymentIntents: (keys, sinceSec, startingAfter, o, customer) => stripeCall(keys, 'GET', '/v1/payment_intents', { limit: 100, created: { gte: sinceSec }, starting_after: startingAfter, customer }, o),
    listWebhookEndpoints: (keys, startingAfter, o) => stripeCall(keys, 'GET', '/v1/webhook_endpoints', { limit: 100, starting_after: startingAfter }, o),
    /** Pinned to the library's API version, so events arrive in the shape the library reads. The answer carries the signing secret, once. */
    createWebhookEndpoint: (keys, w, o) => stripeCall(keys, 'POST', '/v1/webhook_endpoints', { url: w.url, enabled_events: [...w.events], api_version: STRIPE_API_VERSION, description: w.description }, o),
    updateWebhookEndpoint: (keys, id, events, o) => stripeCall(keys, 'POST', `/v1/webhook_endpoints/${encodeURIComponent(id)}`, { enabled_events: [...events], disabled: false }, o),
    deleteWebhookEndpoint: (keys, id, o) => stripeCall(keys, 'DELETE', `/v1/webhook_endpoints/${encodeURIComponent(id)}`, undefined, o),
};
/**
 * Every Stripe event the library acts on; the webhook endpoint is registered with exactly these
 * (`npx ed-payments webhooks --stripe <url>`). Others reach the app's onUnhandledStripeEvent.
 */
export const STRIPE_EVENTS = [
    'checkout.session.completed',
    'checkout.session.async_payment_succeeded',
    'checkout.session.async_payment_failed',
    'checkout.session.expired',
    'payment_intent.succeeded',
    'payment_intent.processing',
    'payment_intent.payment_failed',
    'charge.refunded',
    'refund.created',
    'refund.updated',
    'refund.failed',
    'charge.dispute.created',
    'charge.dispute.closed',
    'payment_method.detached',
];
/** The fee Stripe kept, when the session or PaymentIntent was fetched with its balance transaction expanded. */
export function stripeFee(x) {
    const pi = x.object === 'checkout.session' ? x.payment_intent : x;
    if (!pi || typeof pi === 'string')
        return null;
    const charge = pi.latest_charge;
    if (!charge || typeof charge === 'string')
        return null;
    const bt = charge.balance_transaction;
    return bt && typeof bt !== 'string' ? bt.fee : null;
}
/** Where a Checkout Session stands, in the library's words. */
export function sessionState(s) {
    if (s.payment_status === 'paid' || s.payment_status === 'no_payment_required')
        return 'paid';
    if (s.status === 'complete')
        return 'processing';
    return s.status === 'expired' ? 'expired' : 'open';
}
/**
 * Where a PaymentIntent stands, in the library's words. open: waiting for a payment method (the buyer
 * on-session, or after a refused confirm). action: waiting for the buyer to authenticate, normal on
 * the app's page and never expected off-session. odd: requires_capture, which the library never asks
 * for, so a person should look.
 */
export function intentState(pi) {
    switch (pi.status) {
        case 'succeeded':
            return 'paid';
        case 'processing':
            return 'processing';
        case 'canceled':
            return 'canceled';
        case 'requires_payment_method':
        case 'requires_confirmation':
            return 'open';
        case 'requires_action':
            return 'action';
        default:
            return 'odd';
    }
}
// ── Webhooks ───────────────────────────────────────────────────────────────────────────────────
const encoder = new TextEncoder();
async function hmacHex(secret, message) {
    const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
    return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
/** Compares in time that doesn't depend on where the strings first differ. */
export function constantTimeEqual(a, b) {
    let diff = a.length ^ b.length;
    for (let i = 0; i < Math.max(a.length, b.length); i++)
        diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
    return diff === 0;
}
/**
 * Checks a Stripe-Signature header (`t=<unix seconds>,v1=<hex>,...`): HMAC-SHA256 of `<t>.<raw body>`
 * with the endpoint secret, any v1 matching, and t within the tolerance (5 minutes, as Stripe's
 * libraries). Unknown entries (v0, debug metadata) are ignored, as Stripe asks.
 */
export async function verifyStripeSignature(payload, header, secret, nowMs, toleranceSec = 300) {
    if (!header || !secret)
        return false;
    let t = null;
    const v1 = [];
    for (const part of header.split(',')) {
        const eq = part.indexOf('=');
        if (eq < 0)
            continue;
        const k = part.slice(0, eq).trim();
        const value = part.slice(eq + 1).trim();
        if (k === 't')
            t = /^\d+$/.test(value) ? Number(value) : null;
        else if (k === 'v1')
            v1.push(value);
    }
    if (t === null || !v1.length)
        return false;
    if (Math.abs(nowMs / 1000 - t) > toleranceSec)
        return false;
    const expected = await hmacHex(secret, `${t}.${payload}`);
    return v1.some((s) => constantTimeEqual(s, expected));
}
/** A Stripe-Signature header for a body, as Stripe would send it: for tests and fixtures. */
export async function signStripePayload(payload, secret, timestampSec) {
    return `t=${timestampSec},v1=${await hmacHex(secret, `${timestampSec}.${payload}`)}`;
}
export function parseStripeEvent(payload) {
    try {
        const e = JSON.parse(payload);
        return e && e.object === 'event' && typeof e.id === 'string' && typeof e.type === 'string' && e.data && typeof e.data.object === 'object' ? e : null;
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=stripe.js.map