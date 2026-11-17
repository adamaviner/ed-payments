// What an app's convex/ code imports. The app makes one instance (convex/payments.ts):
//
//   export const payments: Payments = new Payments(components.payments, { app: 'market', siteUrl, stripe, paypal })
//
// The component only stores rows. Everything that needs the network or the app's secrets runs here,
// inside the app's own actions and HTTP actions: starting a checkout, the webhooks, the return page,
// sending refunds, the sweep and the nightly comparison.
import { createFunctionHandle, httpActionGeneric, internalActionGeneric, internalMutationGeneric } from 'convex/server';
import { ConvexError, v } from 'convex/values';
import { DEFAULT_FEE_RATES, feeRates, feeSchedule } from '../core/fees.js';
import { PAYPAL_LIVE_API, PAYPAL_SANDBOX_API, approveUrl, captureFee, moneyCents, orderCapture, paypal, paypalToken } from '../core/paypal.js';
import { sessionState, stripe, stripeFee, paymentIntentId } from '../core/stripe.js';
import { accountFingerprint, decryptToken, encryptToken } from '../core/tokenCrypt.js';
import { ProcessorError, isMethodFor, tagFor } from '../core/types.js';
import { reconcile } from './reconcile.js';
import { errorText, paypalRefundState, stripeRefundState } from './util.js';
import { handlePaypalWebhook, handleStripeWebhook } from './webhooks.js';
export * from './validators.js';
export { PAYPAL_LIVE_API, PAYPAL_SANDBOX_API };
export { errorText } from './util.js';
const DEFAULT_EXPIRY_MS = 3 * 60 * 60_000;
/** A PayPal checkout still pending after this long is looked at by sweep (the buyer may have approved and closed the tab). */
const PAYPAL_LOOK_AFTER_MS = 5 * 60_000;
/** A refund still sending after this long is checked with the processor. */
const REFUND_STUCK_MS = 10 * 60_000;
const FINAL = new Set(['paid', 'refund_needed', 'failed', 'abandoned']);
export class Payments {
    component;
    options;
    fees;
    constructor(component, options) {
        this.component = component;
        this.options = options;
        if (!/^[a-z0-9_-]+$/i.test(options.app))
            throw new Error('The payments app tag must be letters, digits, - or _.');
        this.fees = options.fees ? feeRates(options.fees) : DEFAULT_FEE_RATES;
    }
    get app() {
        return this.options.app;
    }
    /** The fee schedule for one processor and method, from this app's rates. */
    feeSchedule(processor, method) {
        return feeSchedule(this.fees, processor, method);
    }
    /** @internal */
    fetch = (input, init) => (this.options.fetch ?? fetch)(input, init);
    /** @internal */
    stripeKeys() {
        const k = this.options.stripe?.();
        if (!k?.secretKey)
            throw new ConvexError('Stripe isn’t set up on this deployment.');
        return k;
    }
    /** @internal */
    paypalKeys() {
        const k = this.options.paypal?.();
        if (!k?.clientId || !k.clientSecret)
            throw new ConvexError('PayPal isn’t set up on this deployment.');
        return k;
    }
    /** @internal A PayPal call context: the cached token while it has five minutes left (unless `fresh`), else a new one, cached (encrypted). */
    async paypalCall(ctx, fresh = false) {
        const keys = this.paypalKeys();
        const account = await accountFingerprint(keys.apiBase, keys.clientId);
        const now = Date.now();
        const cached = fresh ? null : await ctx.runQuery(this.component.settings.paypalToken, {});
        let token = cached && cached.account === account && cached.expiresAt > now + 5 * 60_000 ? await decryptToken(keys.clientSecret, cached.sealed) : null;
        if (!token) {
            const got = await paypalToken(keys, now, { fetch: this.fetch });
            token = got.token;
            await ctx.runMutation(this.component.settings.savePaypalToken, { sealed: await encryptToken(keys.clientSecret, got.token), expiresAt: got.expiresAt, account });
        }
        return { apiBase: keys.apiBase, token, fetch: this.fetch, keys };
    }
    /**
     * @internal Runs PayPal calls with the cached token; if PayPal answers 401 (the token was revoked
     * or the app's secret changed) it gets a new token and tries once more.
     */
    async withPaypal(ctx, fn) {
        try {
            return await fn(await this.paypalCall(ctx));
        }
        catch (err) {
            if (!(err instanceof ProcessorError && err.processor === 'paypal' && err.status === 401))
                throw err;
            return await fn(await this.paypalCall(ctx, true));
        }
    }
    url(path) {
        return `${this.options.siteUrl().replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
    }
    limit(key) {
        const l = this.options.limits;
        if (l === false)
            return undefined;
        return { key, perKey: l?.perKey ?? 5, windowMs: (l?.windowMinutes ?? 10) * 60_000, globalPerMinute: l?.globalPerMinute ?? 30 };
    }
    // ── Checkouts ─────────────────────────────────────────────────────────────────────────────────
    /**
     * Starts a checkout from an action: makes the row, asks the processor for its checkout (keyed by
     * the row's id, so a retry gets the same one), and returns where to send the buyer.
     */
    async start(ctx, a) {
        if (!isMethodFor(a.processor, a.method))
            throw new ConvexError(`${a.processor === 'stripe' ? 'Stripe' : 'PayPal'} doesn’t take ${a.method} payments here.`);
        if (!Number.isInteger(a.amountCents) || a.amountCents < 1)
            throw new ConvexError('A checkout needs an amount of at least one cent.');
        if (a.processor === 'stripe')
            this.stripeKeys();
        else
            this.paypalKeys();
        const now = Date.now();
        const expiresAt = a.expiresAt ?? now + DEFAULT_EXPIRY_MS;
        const returnUrl = this.url(a.returnPath);
        const cancelUrl = this.url(a.cancelPath);
        const handle = async (fn) => (fn ? await createFunctionHandle(fn) : undefined);
        const checkoutId = await ctx.runMutation(this.component.checkouts.create, {
            app: this.app,
            ref: a.ref,
            purpose: a.purpose,
            description: a.description,
            amountCents: a.amountCents,
            processor: a.processor,
            method: a.method,
            payer: { email: a.payer.email.trim(), ...(a.payer.name?.trim() ? { name: a.payer.name.trim() } : {}) },
            returnUrl,
            cancelUrl,
            expiresAt,
            context: a.context,
            callbacks: {
                onPaid: await handle(a.onPaid),
                onFailed: await handle(a.onFailed),
                onRefunded: await handle(a.onRefunded),
                onRefundNeeded: await handle(a.onRefundNeeded),
                onDispute: await handle(a.onDispute),
            },
            limit: this.limit(a.limitKey),
            now,
        });
        try {
            const made = a.processor === 'stripe' ? await this.startStripe(checkoutId, a, returnUrl, cancelUrl, expiresAt, now) : await this.startPaypal(ctx, checkoutId, a, returnUrl, cancelUrl);
            await ctx.runMutation(this.component.checkouts.attach, { id: checkoutId, processorCheckoutId: made.id });
            return { checkoutId, redirectUrl: made.url };
        }
        catch (err) {
            await ctx.runMutation(this.component.checkouts.failStart, { id: checkoutId, error: errorText(err), now: Date.now() });
            console.error(`payments: starting ${a.processor} checkout ${checkoutId} failed: ${errorText(err)}`);
            throw new ConvexError(`${a.processor === 'stripe' ? 'Stripe' : 'PayPal'} couldn’t start the payment just now. Please try again in a moment.`);
        }
    }
    async startStripe(checkoutId, a, returnUrl, cancelUrl, expiresAt, now) {
        const successUrl = `${returnUrl}${returnUrl.includes('?') ? '&' : '?'}session_id={CHECKOUT_SESSION_ID}`;
        const s = await stripe.createSession(this.stripeKeys(), { app: this.app, checkoutId, description: a.description, amountCents: a.amountCents, method: a.method, email: a.payer.email, successUrl, cancelUrl, expiresAt, now }, { fetch: this.fetch });
        if (!s.url)
            throw new Error('Stripe returned no checkout address.');
        return { id: s.id, url: s.url };
    }
    async startPaypal(ctx, checkoutId, a, returnUrl, cancelUrl) {
        const order = await this.withPaypal(ctx, (call) => paypal.createOrder(call, { customId: tagFor(this.app, checkoutId), description: a.description, amountCents: a.amountCents, returnUrl, cancelUrl, brandName: this.options.brandName }, `checkout-${checkoutId}`));
        const url = approveUrl(order);
        if (!url)
            throw new Error('PayPal returned no approval address.');
        return { id: order.id, url };
    }
    /** @internal Records a paid Stripe session, then (best effort) the fee Stripe kept. */
    async settleStripeSession(ctx, checkoutId, s) {
        const state = sessionState(s);
        const pi = paymentIntentId(s);
        if (state === 'processing')
            return await ctx.runMutation(this.component.checkouts.markProcessing, { id: checkoutId, paymentRef: pi ?? undefined });
        if (state !== 'paid')
            return null;
        // Without an amount there is nothing safe to record; throwing makes the webhook answer 500 and Stripe retry.
        if (s.amount_total === null)
            throw new Error(`Stripe session ${s.id} is paid but has no amount.`);
        const fee = stripeFee(s);
        const res = await ctx.runMutation(this.component.checkouts.settlePaid, {
            id: checkoutId,
            paymentRef: pi ?? s.id,
            paidCents: s.amount_total,
            processorFeeCents: fee ?? undefined,
            processorCheckoutId: s.id,
            now: Date.now(),
        });
        if (fee === null && pi && res.outcome !== 'already_handled') {
            try {
                const full = await stripe.retrievePaymentIntent(this.stripeKeys(), pi, { fetch: this.fetch });
                const kept = stripeFee(full);
                if (kept !== null)
                    await ctx.runMutation(this.component.checkouts.recordFee, { id: checkoutId, processorFeeCents: kept });
            }
            catch (err) {
                console.warn(`payments: couldn’t read Stripe’s fee for ${pi}: ${errorText(err)}`);
            }
        }
        return res;
    }
    /** @internal Settles from a PayPal order that has a capture (COMPLETED, PENDING or DECLINED). */
    async settlePaypalOrder(ctx, checkoutId, order) {
        const capture = orderCapture(order);
        if (!capture)
            return null;
        if (capture.status === 'COMPLETED' || capture.status === 'PARTIALLY_REFUNDED' || capture.status === 'REFUNDED') {
            const paidCents = moneyCents(capture.amount);
            if (paidCents === null)
                throw new Error(`PayPal capture ${capture.id} has no USD amount.`);
            return await ctx.runMutation(this.component.checkouts.settlePaid, {
                id: checkoutId,
                paymentRef: capture.id,
                paidCents,
                processorFeeCents: captureFee(capture) ?? undefined,
                processorCheckoutId: order.id || undefined,
                now: Date.now(),
            });
        }
        if (capture.status === 'PENDING')
            return await ctx.runMutation(this.component.checkouts.markProcessing, { id: checkoutId, paymentRef: capture.id });
        return await ctx.runMutation(this.component.checkouts.settleFailed, { id: checkoutId, reason: `PayPal ${capture.status.toLowerCase()} the payment.`, now: Date.now() });
    }
    /**
     * @internal Captures an approved PayPal order and settles it. A second capture (a reloaded
     * return page, the webhook and the sweep racing) gets ORDER_ALREADY_CAPTURED from PayPal: the
     * order is then fetched and settled from what it says, instead of failing (fix b). A checkout
     * that is no longer waiting (abandoned, failed, settled) is never captured: with PayPal no money
     * moves until the capture, so taking it now would only mean refunding it.
     */
    async capturePaypal(ctx, checkoutId, orderId) {
        const c = await ctx.runQuery(this.component.checkouts.get, { id: checkoutId });
        if (c?.status !== 'pending' && c?.status !== 'created')
            return;
        const order = await this.withPaypal(ctx, async (call) => {
            try {
                return await paypal.captureOrder(call, orderId, `capture-${checkoutId}`);
            }
            catch (err) {
                if (err instanceof ProcessorError && err.code === 'ORDER_ALREADY_CAPTURED')
                    return await paypal.getOrder(call, orderId);
                if (err instanceof ProcessorError && err.code === 'ORDER_NOT_APPROVED')
                    return null;
                throw err;
            }
        });
        if (order)
            await this.settlePaypalOrder(ctx, checkoutId, order);
    }
    /**
     * For the page the buyer comes back to (`token`: Stripe's session_id or PayPal's token). Returns
     * the outcome at once if the checkout is already settled; otherwise asks the processor and settles
     * (capturing an approved PayPal order), so the page doesn't wait for a webhook. Null: not ours.
     */
    async completeReturn(ctx, { processor, token }) {
        if (!token)
            return null;
        const found = await ctx.runQuery(this.component.checkouts.byProcessorId, { processorCheckoutId: token });
        if (!found || found.processor !== processor || found.app !== this.app)
            return null;
        if (!FINAL.has(found.status) || found.status === 'abandoned') {
            if (processor === 'paypal') {
                const order = await this.withPaypal(ctx, (call) => paypal.getOrder(call, token));
                if (order.status === 'APPROVED')
                    await this.capturePaypal(ctx, found.id, token);
                else if (order.status === 'COMPLETED')
                    await this.settlePaypalOrder(ctx, found.id, order);
            }
            else {
                await this.settleStripeSession(ctx, found.id, await stripe.retrieveSession(this.stripeKeys(), token, { fetch: this.fetch }));
            }
        }
        const now = await ctx.runQuery(this.component.checkouts.get, { id: found.id });
        return { checkoutId: found.id, ref: found.ref, status: now?.status ?? found.status };
    }
    /** One checkout, for the app's queries (e.g. a thank-you page). */
    async status(ctx, checkoutId) {
        return await ctx.runQuery(this.component.checkouts.get, { id: checkoutId });
    }
    async get(ctx, checkoutId) {
        return await this.status(ctx, checkoutId);
    }
    /** The checkouts for one thing in the app, newest first. */
    async forRef(ctx, ref) {
        return await ctx.runQuery(this.component.checkouts.byRef, { ref });
    }
    async byPaymentRef(ctx, paymentRef) {
        return await ctx.runQuery(this.component.checkouts.byPaymentRef, { paymentRef });
    }
    /** All checkouts, newest first, paginated. */
    async list(ctx, paginationOpts) {
        return await ctx.runQuery(this.component.checkouts.list, { paginationOpts });
    }
    // ── Webhooks ──────────────────────────────────────────────────────────────────────────────────
    /** Stripe's webhook: verify, de-duplicate, act. 400 for a bad signature, 500 for a real failure (Stripe retries), 200 otherwise. */
    async handleStripeWebhook(ctx, request, onUnhandled) {
        return await handleStripeWebhook(this, ctx, request, onUnhandled);
    }
    async handlePaypalWebhook(ctx, request) {
        return await handlePaypalWebhook(this, ctx, request);
    }
    /**
     * Adds the webhook routes to the app's router. Events the library doesn't handle, or for objects
     * that aren't this app's checkouts, go to onUnhandledStripeEvent when given (ed-market: bid payments).
     */
    registerRoutes(http, o = {}) {
        if (this.options.stripe) {
            http.route({ path: o.stripePath ?? '/stripe/webhook', method: 'POST', handler: httpActionGeneric(async (ctx, req) => await this.handleStripeWebhook(ctx, req, o.onUnhandledStripeEvent)) });
        }
        if (this.options.paypal) {
            http.route({ path: o.paypalPath ?? '/paypal/webhook', method: 'POST', handler: httpActionGeneric(async (ctx, req) => await this.handlePaypalWebhook(ctx, req)) });
        }
    }
    // ── Refunds ───────────────────────────────────────────────────────────────────────────────────
    /** Asks for a refund (the whole remaining amount unless given). Who may is the app's check; `by` is recorded. Returns the refund id. */
    async requestRefund(ctx, a) {
        return await ctx.runMutation(this.component.refunds.request, { ...a, now: Date.now() });
    }
    async approveRefund(ctx, a) {
        await ctx.runMutation(this.component.refunds.approve, { ...a, now: Date.now() });
    }
    /**
     * Sends a refund through the processor, keyed by the refund id (see pushRefund), so it is never made
     * twice. Needs approval first unless skipApproval. Returns the refund as it stands after.
     */
    async sendRefund(ctx, refundId, o = {}) {
        const go = await ctx.runMutation(this.component.refunds.begin, { refundId, skipApproval: o.skipApproval ?? false, by: o.by, now: Date.now() });
        if (go.state === 'send')
            await this.pushRefund(ctx, go);
        return await ctx.runQuery(this.component.refunds.get, { refundId });
    }
    /**
     * @internal The processor call for a refund already marked sending, and its outcome recorded.
     * The key is the refund's (a new one per attempt the processor refused), so sending again after a
     * timeout or crash returns the same refund instead of making a second. When the outcome is unknown
     * (no answer, a 5xx) the refund stays sending and sweep sends it again under the same key.
     */
    async pushRefund(ctx, r) {
        const finish = (x) => ctx.runMutation(this.component.refunds.finish, { refundId: r.refundId, ...x, now: Date.now() });
        try {
            if (r.processor === 'stripe') {
                if (!r.paymentRef.startsWith('pi_'))
                    throw new ConvexError('This Stripe payment has no PaymentIntent to refund; refund it in the Stripe dashboard.');
                const made = await stripe.createRefund(this.stripeKeys(), { paymentIntent: r.paymentRef, amountCents: r.amountCents, app: this.app, refundId: r.refundId }, { fetch: this.fetch, idempotencyKey: r.key });
                if (made.status === 'failed' || made.status === 'canceled')
                    await finish({ ok: false, done: false, processorRefundId: made.id, error: `Stripe: the refund ${made.status}${made.failure_reason ? ` (${made.failure_reason})` : ''}.` });
                else
                    await finish({ ok: true, done: made.status === 'succeeded', processorRefundId: made.id });
            }
            else {
                const made = await this.withPaypal(ctx, (call) => paypal.refundCapture(call, r.paymentRef, { amountCents: r.amountCents, customId: tagFor(this.app, r.refundId) }, r.key));
                if (made.status === 'FAILED' || made.status === 'CANCELLED')
                    await finish({ ok: false, done: false, processorRefundId: made.id, error: `PayPal: the refund ${made.status.toLowerCase()}.` });
                else
                    await finish({ ok: true, done: made.status === 'COMPLETED', processorRefundId: made.id });
            }
        }
        catch (err) {
            const unknown = !(err instanceof ConvexError) && !(err instanceof ProcessorError && !err.retryable);
            await finish({ ok: false, done: false, unknown, error: errorText(err) });
        }
    }
    /** Records a refund made outside the app (a dashboard, a cheque) as done. */
    async markRefundedManually(ctx, a) {
        await ctx.runMutation(this.component.refunds.markManual, { ...a, now: Date.now() });
    }
    async dismissRefund(ctx, a) {
        await ctx.runMutation(this.component.refunds.dismiss, { ...a, now: Date.now() });
    }
    /** Refunds waiting on someone: requested, approved, sending, failed. */
    async openRefunds(ctx) {
        return await ctx.runQuery(this.component.refunds.listOpen, {});
    }
    async refundsFor(ctx, checkoutId) {
        return await ctx.runQuery(this.component.refunds.forCheckout, { checkoutId });
    }
    async refund(ctx, refundId) {
        return await ctx.runQuery(this.component.refunds.get, { refundId });
    }
    // ── Upkeep ────────────────────────────────────────────────────────────────────────────────────
    /**
     * For a cron every 10 minutes. PayPal checkouts pending over 5 minutes: captured if the buyer
     * approved (they may have closed the tab: fix a), abandoned once expired. Expired Stripe sessions:
     * settled if paid, else expired at Stripe and abandoned. Refunds left sending over 10 minutes:
     * asked about (or sent again, safely, under the same key).
     */
    async sweep(ctx) {
        const now = Date.now();
        const out = { checked: 0, settled: 0, abandoned: 0, refunds: 0, errors: 0 };
        for (const c of await ctx.runQuery(this.component.checkouts.due, { limit: 200 })) {
            if (c.app !== this.app || c.status === 'processing')
                continue;
            const expired = c.expiresAt <= now;
            if (!expired && !(c.processor === 'paypal' && c.status === 'pending' && c.createdAt <= now - PAYPAL_LOOK_AFTER_MS))
                continue;
            out.checked++;
            try {
                const before = c.status;
                await this.sweepOne(ctx, c, expired);
                const after = (await ctx.runQuery(this.component.checkouts.get, { id: c.id }))?.status;
                if (after && after !== before) {
                    if (after === 'abandoned')
                        out.abandoned++;
                    else
                        out.settled++;
                }
            }
            catch (err) {
                out.errors++;
                console.error(`payments: sweep of checkout ${c.id} failed: ${errorText(err)}`);
            }
        }
        for (const r of await ctx.runQuery(this.component.refunds.stuck, { before: now - REFUND_STUCK_MS, limit: 50 })) {
            try {
                await this.recheckRefund(ctx, r);
                out.refunds++;
            }
            catch (err) {
                out.errors++;
                console.error(`payments: checking refund ${r.id} failed: ${errorText(err)}`);
            }
        }
        return out;
    }
    async sweepOne(ctx, c, expired) {
        const abandon = () => ctx.runMutation(this.component.checkouts.abandon, { id: c.id, now: Date.now() });
        if (!c.processorCheckoutId)
            return expired ? await abandon() : null;
        if (c.processor === 'paypal') {
            const id = c.processorCheckoutId;
            const order = await this.withPaypal(ctx, async (call) => {
                try {
                    return await paypal.getOrder(call, id);
                }
                catch (err) {
                    // PayPal forgets orders nobody approved after a while.
                    if (err instanceof ProcessorError && err.status === 404)
                        return null;
                    throw err;
                }
            });
            if (order?.status === 'APPROVED')
                return await this.capturePaypal(ctx, c.id, c.processorCheckoutId);
            if (order?.status === 'COMPLETED')
                return await this.settlePaypalOrder(ctx, c.id, order);
            return expired || order?.status === 'VOIDED' ? await abandon() : null;
        }
        const keys = this.stripeKeys();
        const s = await stripe.retrieveSession(keys, c.processorCheckoutId, { fetch: this.fetch });
        const state = sessionState(s);
        if (state === 'paid' || state === 'processing')
            return await this.settleStripeSession(ctx, c.id, s);
        if (state === 'open') {
            try {
                await stripe.expireSession(keys, s.id, { fetch: this.fetch });
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
    async recheckRefund(ctx, r) {
        const c = await ctx.runQuery(this.component.checkouts.get, { id: r.checkoutId });
        if (!c?.paymentRef)
            return;
        if (!r.processorRefundId) {
            // No answer, or a crash, between claiming and recording: send again under the same key.
            return await this.pushRefund(ctx, { refundId: r.id, key: refundKey(r.id, r.attempts), processor: c.processor, paymentRef: c.paymentRef, amountCents: r.amountCents });
        }
        const refundId = r.processorRefundId;
        const state = c.processor === 'stripe'
            ? stripeRefundState((await stripe.retrieveRefund(this.stripeKeys(), refundId, { fetch: this.fetch })).status)
            : paypalRefundState((await this.withPaypal(ctx, (call) => paypal.getRefund(call, refundId))).status);
        await ctx.runMutation(this.component.refunds.recordExternal, {
            processor: c.processor,
            paymentRef: c.paymentRef,
            processorRefundId: r.processorRefundId,
            amountCents: r.amountCents,
            state,
            refundId: r.id,
            now: Date.now(),
        });
    }
    /**
     * For a nightly cron: compares the last `days` of checkouts and refunds with each processor and
     * opens an issue for each difference (resolving ones that went away). Refunds found at the
     * processor that the ledger lacks are recorded. PayPal's Transaction Search, for captures tagged
     * with this app that the component never heard of, is skipped (logged once a day) when PayPal
     * refuses it.
     */
    async reconcile(ctx, o = {}) {
        return await reconcile(this, ctx, o.days ?? 3);
    }
    /** For the app's nightly cleanup: deletes what isn't kept (see the component's maintenance.ts), a batch at a time; call again while `more`. */
    async cleanup(ctx) {
        return await ctx.runMutation(this.component.maintenance.cleanup, { now: Date.now() });
    }
    // ── Issues ────────────────────────────────────────────────────────────────────────────────────
    /** Issues nobody was told about yet, for the app's digest email; mark them after sending. */
    async unreportedIssues(ctx) {
        return await ctx.runQuery(this.component.issues.unreported, {});
    }
    async markReported(ctx, ids) {
        await ctx.runMutation(this.component.issues.markReported, { ids, now: Date.now() });
    }
    async issues(ctx, o) {
        return await ctx.runQuery(this.component.issues.list, o);
    }
    async openIssueCount(ctx) {
        return await ctx.runQuery(this.component.issues.openCount, {});
    }
    async resolveIssue(ctx, id) {
        await ctx.runMutation(this.component.issues.resolve, { id, now: Date.now() });
    }
    async settings(ctx) {
        return await ctx.runQuery(this.component.settings.get, {});
    }
    async updateSettings(ctx, s) {
        await ctx.runMutation(this.component.settings.update, s);
    }
    /**
     * The internal functions an app's crons call: `export const { sweep, reconcile, cleanup } = payments.worker()`
     * in convex/paymentsWorker.ts, then crons.interval('payments sweep', { minutes: 10 }, internal.paymentsWorker.sweep).
     */
    worker() {
        return {
            sweep: internalActionGeneric({
                args: {},
                returns: v.null(),
                handler: async (ctx) => {
                    await this.sweep(ctx);
                    return null;
                },
            }),
            reconcile: internalActionGeneric({
                args: { days: v.optional(v.number()) },
                returns: v.null(),
                handler: async (ctx, { days }) => {
                    await this.reconcile(ctx, { days });
                    return null;
                },
            }),
            cleanup: internalMutationGeneric({ args: {}, returns: v.object({ deleted: v.number(), more: v.boolean() }), handler: async (ctx) => await this.cleanup(ctx) }),
        };
    }
}
/** The idempotency key of a refund's send: the same for every repeat of one attempt (component refunds.begin makes the same). */
export const refundKey = (refundId, attempts) => (attempts ? `refund-${refundId}-${attempts}` : `refund-${refundId}`);
//# sourceMappingURL=index.js.map