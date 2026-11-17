// PayPal over plain fetch: OAuth client-credentials tokens, Orders v2, Payments v2 refunds, the
// webhook-signature check (an API call; PayPal has no local HMAC), and Transaction Search. Shapes
// follow PayPal's published OpenAPI specs (Orders 2.36, Payments v2, Webhooks v1, Transaction
// Search v1), looked up 2026-11-16.
//
// Two things those specs say that the old ed-market code didn't do: an order made with
// `payment_source.paypal.experience_context` (which replaces the deprecated `application_context`)
// answers PAYER_ACTION_REQUIRED with a `payer-action` link, not `approve`; and `PayPal-Request-Id`
// makes create, capture and refund safe to repeat.
import { centsToDecimal, decimalToCents } from './money.js';
import { ProcessorError } from './types.js';
export const PAYPAL_SANDBOX_API = 'https://api-m.sandbox.paypal.com';
export const PAYPAL_LIVE_API = 'https://api-m.paypal.com';
/** A client-credentials access token and when it stops working (ms). */
export async function paypalToken(keys, now, o) {
    let res;
    try {
        res = await o.fetch(`${keys.apiBase}/v1/oauth2/token`, {
            method: 'POST',
            headers: { Authorization: `Basic ${btoa(`${keys.clientId}:${keys.clientSecret}`)}`, 'Content-Type': 'application/x-www-form-urlencoded' },
            body: 'grant_type=client_credentials',
        });
    }
    catch (err) {
        throw new ProcessorError('paypal', 0, `PayPal couldn’t be reached: ${err instanceof Error ? err.message : String(err)}`);
    }
    const json = (await res.json().catch(() => null));
    if (!res.ok || !json?.access_token)
        throw new ProcessorError('paypal', res.status, `PayPal refused the sign-in: ${json?.error_description ?? res.status}`);
    return { token: json.access_token, expiresAt: now + (json.expires_in ?? 300) * 1000 };
}
/** One PayPal API call with a token; an error answer becomes a ProcessorError carrying PayPal's first issue (e.g. ORDER_ALREADY_CAPTURED). */
export async function paypalCall(apiBase, token, method, path, body, o) {
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    if (o.requestId)
        headers['PayPal-Request-Id'] = o.requestId;
    if (o.representation)
        headers.Prefer = 'return=representation';
    let res;
    try {
        res = await o.fetch(`${apiBase}${path}`, { method, headers, body: o.rawBody ?? (body === undefined ? undefined : JSON.stringify(body)) });
    }
    catch (err) {
        throw new ProcessorError('paypal', 0, `PayPal couldn’t be reached: ${err instanceof Error ? err.message : String(err)}`);
    }
    const text = await res.text();
    let json = null;
    try {
        json = text ? JSON.parse(text) : null;
    }
    catch {
        json = null;
    }
    if (!res.ok) {
        const e = json;
        const issue = e?.details?.[0]?.issue ?? e?.name;
        throw new ProcessorError('paypal', res.status, `PayPal: ${e?.details?.[0]?.description ?? e?.message ?? `answered ${res.status}`}`, issue);
    }
    return json;
}
export function orderBody(i) {
    return {
        intent: 'CAPTURE',
        purchase_units: [{ custom_id: i.customId, description: i.description.slice(0, 127) || 'Payment', amount: { currency_code: 'USD', value: centsToDecimal(i.amountCents) } }],
        payment_source: {
            paypal: {
                experience_context: {
                    return_url: i.returnUrl,
                    cancel_url: i.cancelUrl,
                    user_action: 'PAY_NOW',
                    shipping_preference: 'NO_SHIPPING',
                    ...(i.brandName ? { brand_name: i.brandName.slice(0, 127) } : {}),
                },
            },
        },
    };
}
/** Where to send the buyer: `payer-action` for orders with experience_context, `approve` for older ones. */
export function approveUrl(order) {
    return order.links?.find((l) => l.rel === 'payer-action')?.href ?? order.links?.find((l) => l.rel === 'approve')?.href ?? null;
}
const opts = (c) => ({ fetch: c.fetch });
export const paypal = {
    createOrder: (c, i, requestId) => paypalCall(c.apiBase, c.token, 'POST', '/v2/checkout/orders', orderBody(i), { ...opts(c), requestId, representation: true }),
    getOrder: (c, id) => paypalCall(c.apiBase, c.token, 'GET', `/v2/checkout/orders/${encodeURIComponent(id)}`, undefined, opts(c)),
    /** Throws ProcessorError with code ORDER_ALREADY_CAPTURED (422) when it was captured before. */
    captureOrder: (c, id, requestId) => paypalCall(c.apiBase, c.token, 'POST', `/v2/checkout/orders/${encodeURIComponent(id)}/capture`, undefined, { ...opts(c), requestId, representation: true }),
    getCapture: (c, id) => paypalCall(c.apiBase, c.token, 'GET', `/v2/payments/captures/${encodeURIComponent(id)}`, undefined, opts(c)),
    refundCapture: (c, captureId, r, requestId) => paypalCall(c.apiBase, c.token, 'POST', `/v2/payments/captures/${encodeURIComponent(captureId)}/refund`, { amount: { currency_code: 'USD', value: centsToDecimal(r.amountCents) }, custom_id: r.customId.slice(0, 127), ...(r.note ? { note_to_payer: r.note.slice(0, 255) } : {}) }, { ...opts(c), requestId, representation: true }),
    getRefund: (c, id) => paypalCall(c.apiBase, c.token, 'GET', `/v2/payments/refunds/${encodeURIComponent(id)}`, undefined, opts(c)),
};
/** The capture of a captured order (the first unit's first capture). */
export function orderCapture(order) {
    return order.purchase_units?.[0]?.payments?.captures?.[0] ?? null;
}
export function orderCustomId(order) {
    return order.purchase_units?.[0]?.custom_id ?? null;
}
const idFromUpLink = (links, segment) => {
    const href = links?.find((l) => l.rel === 'up')?.href;
    const m = href ? new RegExp(`/${segment}/([^/?#]+)`).exec(href) : null;
    return m ? decodeURIComponent(m[1]) : null;
};
/** The order a capture belongs to. */
export const captureOrderId = (c) => c.supplementary_data?.related_ids?.order_id ?? idFromUpLink(c.links, 'orders');
/** The capture a refund belongs to. */
export const refundCaptureId = (r) => idFromUpLink(r.links, 'captures');
export const moneyCents = (m) => (m && m.currency_code === 'USD' ? decimalToCents(m.value) : null);
/** What PayPal kept on a capture, when it says. */
export const captureFee = (c) => moneyCents(c.seller_receivable_breakdown?.paypal_fee);
/** The transmission headers PayPal signs a webhook with. */
export const PAYPAL_SIGNATURE_HEADERS = ['paypal-auth-algo', 'paypal-cert-url', 'paypal-transmission-id', 'paypal-transmission-sig', 'paypal-transmission-time'];
/**
 * Asks PayPal whether a webhook is genuine (POST /v1/notifications/verify-webhook-signature). The
 * raw body is spliced into the request as it came, not parsed and serialised again, so PayPal checks
 * the exact bytes it signed.
 */
export async function verifyPaypalWebhook(keys, token, headers, rawBody, o) {
    const h = Object.fromEntries(PAYPAL_SIGNATURE_HEADERS.map((name) => [name, headers.get(name)]));
    if (Object.values(h).some((x) => !x) || !keys.webhookId)
        return false;
    const head = JSON.stringify({
        auth_algo: h['paypal-auth-algo'],
        cert_url: h['paypal-cert-url'],
        transmission_id: h['paypal-transmission-id'],
        transmission_sig: h['paypal-transmission-sig'],
        transmission_time: h['paypal-transmission-time'],
        webhook_id: keys.webhookId,
    });
    const res = await paypalCall(keys.apiBase, token, 'POST', '/v1/notifications/verify-webhook-signature', undefined, {
        ...o,
        rawBody: `${head.slice(0, -1)},"webhook_event":${rawBody}}`,
    });
    return res.verification_status === 'SUCCESS';
}
export function parsePaypalEvent(payload) {
    try {
        const e = JSON.parse(payload);
        return e && typeof e.id === 'string' && typeof e.event_type === 'string' && e.resource && typeof e.resource === 'object' ? e : null;
    }
    catch {
        return null;
    }
}
/**
 * Transaction Search (GET /v1/reporting/transactions), one page. It needs the Transaction Search
 * permission on the REST app; without it PayPal answers 403 NOT_AUTHORIZED, which callers treat as
 * "not available here". Transactions show up there up to three hours late. Windows are at most 31 days.
 */
export async function searchTransactions(c, q) {
    const iso = (ms) => new Date(ms).toISOString().replace(/\.\d+Z$/, 'Z');
    const query = `start_date=${iso(q.start)}&end_date=${iso(q.end)}&fields=transaction_info&page_size=500&page=${q.page}`;
    const res = await paypalCall(c.apiBase, c.token, 'GET', `/v1/reporting/transactions?${query}`, undefined, opts(c));
    const transactions = (res.transaction_details ?? []).flatMap((d) => {
        const t = d.transaction_info;
        const value = t?.transaction_amount?.value;
        if (!t?.transaction_id || !value || t.transaction_amount?.currency_code !== 'USD')
            return [];
        const negative = value.trim().startsWith('-');
        const cents = decimalToCents(value.replace('-', ''));
        if (cents === null)
            return [];
        return [
            { transactionId: t.transaction_id, customField: t.custom_field ?? null, amountCents: negative ? -cents : cents, status: t.transaction_status ?? '', eventCode: t.transaction_event_code ?? '' },
        ];
    });
    return { transactions, totalPages: res.total_pages ?? 1 };
}
//# sourceMappingURL=paypal.js.map