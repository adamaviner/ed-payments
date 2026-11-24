// What an app's convex/ code imports. The app makes one instance, in convex/payments.ts:
//
//   export const payments = definePayments(components.payments, { app: 'market', context, stripe: fromEnv.stripe(), paypal: fromEnv.paypal() })
//     .withCallbacks({ on: { paid: internal.orders.onPaid, ... }, authorize: { admin: internal.auth.isAdmin }, worker: internal.payments })
//   export const { sweep, reconcile, cleanup, issuesDigest, charge } = payments.worker()
//   export const admin = payments.adminApi()
//   export const { completeReturn } = payments.publicApi()
//
// Two calls, not one, because of TypeScript: the function references in withCallbacks name the
// app's own modules, including this one, so a single generic call would have to infer its type from
// itself (TS7022). The first call fixes the types from the context validator; the second takes the
// references and has nothing left to infer.
//
// The component only stores rows. Everything that needs the network or the app's secrets runs here,
// inside the app's own actions and HTTP actions.
import { createFunctionHandle, httpActionGeneric, } from 'convex/server';
import { ConvexError, v } from 'convex/values';
import { cheaperCardProcessor, DEFAULT_FEE_RATES, feeRates, feeSchedule } from '../core/fees.js';
import { PAYPAL_LIVE_API, PAYPAL_SANDBOX_API, RECURRING_USAGE_PATTERN, approveUrl, captureFee, moneyCents, orderCapture, orderVault, paypal, paypalToken, paypalTokenOf, } from '../core/paypal.js';
import { savedMethodKind, savedMethodLabel, sessionState, stripe, stripeFee, paymentIntentId } from '../core/stripe.js';
import { accountFingerprint, decryptToken, encryptToken } from '../core/tokenCrypt.js';
import { ProcessorError, isMethodFor, tagFor } from '../core/types.js';
import { adminApi, publicApi, worker } from './api.js';
import { mismatch } from './context.js';
import { paypalHistory } from './paypalHistory.js';
import { reconcile } from './reconcile.js';
import { chargeNow, completeIntentReturn, removeSavedMethod, retryOnSession, retryWithPaypal, savedMethods, setupPaymentMethod, sweepIntent, verifyMethodOwner, } from './saved.js';
import { savePaypalMethod, setupPaypalMethod } from './paypalVault.js';
import { runSchedules, startSchedule, startScheduleCheckout, updateSchedule } from './schedules.js';
import { errorText, paypalRefundState, stripeRefundState } from './util.js';
import { callbackArgs, paidReturns, } from './validators.js';
import { handlePaypalWebhook, handleStripeWebhook } from './webhooks.js';
export * from './validators.js';
export { fromEnv, isLive, stripeProblems, paypalProblems } from './env.js';
export { PAYPAL_LIVE_API, PAYPAL_SANDBOX_API };
export { errorText } from './util.js';
const DEFAULT_EXPIRY_MS = 3 * 60 * 60_000;
/** A PayPal checkout still pending after this long is looked at by sweep (the buyer may have approved and closed the tab). */
const PAYPAL_LOOK_AFTER_MS = 5 * 60_000;
/** A refund still sending after this long is checked with the processor. */
const REFUND_STUCK_MS = 10 * 60_000;
const FINAL = new Set(['paid', 'refund_needed', 'failed', 'abandoned']);
/** A PayPal checkout's lastError once PayPal declined what the buyer chose: only the buyer captures it after that (capturePaypal). */
export const PAYPAL_DECLINED = 'PayPal declined the card or account the buyer chose; waiting for them to choose another.';
/**
 * Step one: the app's tag, keys and context type. Returns { withCallbacks } for step two.
 */
export function definePayments(component, options) {
    if (!/^[a-z0-9_-]+$/i.test(options.app))
        throw new Error('The payments app tag must be letters, digits, - or _.');
    return { withCallbacks: (wiring) => new Payments(component, options, wiring) };
}
/** The app's payments; C is its context validator (definePayments). */
export class Payments {
    component;
    options;
    wiring;
    fees;
    /** The callbacks' argument validators with this app's context: `internalMutation({ args: payments.args.paid, returns: paidReturns, ... })`. */
    args;
    paidReturns = paidReturns;
    /** @internal Use definePayments. */
    constructor(component, options, wiring) {
        this.component = component;
        this.options = options;
        this.wiring = wiring;
        this.fees = options.fees ? feeRates(options.fees) : DEFAULT_FEE_RATES;
        this.args = callbackArgs(options.context);
    }
    get app() {
        return this.options.app;
    }
    /** The fee schedule for one processor and method, from this app's rates. */
    feeSchedule(processor, method) {
        return feeSchedule(this.fees, processor, method);
    }
    /**
     * Where a card for a charge of this amount should be saved or paid: the processor with the lower fee
     * at this app's rates (Stripe on a tie), with both fees. Only a processor the deployment has keys
     * for is chosen.
     */
    cardProcessorFor(amountCents) {
        const choice = cheaperCardProcessor(amountCents, this.fees);
        const has = { stripe: !!this.options.stripe?.()?.secretKey, paypal: !!this.options.paypal?.()?.clientId };
        if (!has[choice.processor] && has[choice.processor === 'stripe' ? 'paypal' : 'stripe'])
            return { ...choice, processor: choice.processor === 'stripe' ? 'paypal' : 'stripe' };
        return choice;
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
    /** @internal Throws (a ConvexError naming where) when the context doesn't fit the app's validator. */
    checkContext(context) {
        const wrong = mismatch(this.options.context, context);
        if (wrong)
            throw new ConvexError(`The payment’s context doesn’t fit this app’s context validator: ${wrong}.`);
    }
    /** @internal The rate-limit keys of one public call: the signed-in user (else the given key), and everyone together. */
    async limits(ctx, entry, fallbackKey, scale = 1) {
        const l = this.options.limits;
        if (l === false)
            return undefined;
        const identity = ctx.auth ? await ctx.auth.getUserIdentity() : null;
        const who = identity ? `user:${identity.subject}` : fallbackKey ? `key:${fallbackKey.trim().toLowerCase()}` : null;
        const perKey = (l?.perKey ?? 5) * scale;
        const windowMs = (l?.windowMinutes ?? 10) * 60_000;
        const global = { key: `${this.app}:${entry}:all`, max: (l?.globalPerMinute ?? 30) * scale, windowMs: 60_000, message: 'Too many payments are being started right now. Try again in a minute.' };
        return who ? [global, { key: `${this.app}:${entry}:${who}`, max: perKey, windowMs, message: 'Too many tries just now. Try again in a few minutes.' }] : [global];
    }
    /** @internal */
    async takeLimits(ctx, entry, fallbackKey, scale = 1) {
        const limits = await this.limits(ctx, entry, fallbackKey, scale);
        if (limits)
            await ctx.runMutation(this.component.limits.take, { limits, now: Date.now() });
    }
    /** @internal The callbacks as function handles, stored on each checkout so the component can call them. */
    async handles() {
        const on = this.wiring.on;
        return {
            onPaid: await createFunctionHandle(on.paid),
            onFailed: await createFunctionHandle(on.failed),
            onRefunded: await createFunctionHandle(on.refunded),
            onRefundNeeded: await createFunctionHandle(on.refundNeeded),
            onDispute: await createFunctionHandle(on.dispute),
            onProcessing: await createFunctionHandle(on.processing),
        };
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
    /** @internal */
    url(path) {
        const site = (this.options.siteUrl ?? defaultSiteUrl)();
        return `${site.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
    }
    async start(ctx, a) {
        return await this.begin(ctx, a);
    }
    /**
     * @internal start, and for a schedule's first payment (startScheduleCheckout) the schedule it
     * starts and the payer's customer at the processor, so the method that pays is saved with it.
     */
    async begin(ctx, a, save) {
        if (!isMethodFor(a.processor, a.method))
            throw new ConvexError(`${a.processor === 'stripe' ? 'Stripe' : 'PayPal'} doesn’t take ${a.method} payments here.`);
        if (!Number.isInteger(a.amountCents) || a.amountCents < 1)
            throw new ConvexError('A checkout needs an amount of at least one cent.');
        this.checkContext(a.context);
        if (a.processor === 'stripe')
            this.stripeKeys();
        else
            this.paypalKeys();
        const now = Date.now();
        const expiresAt = a.expiresAt ?? now + DEFAULT_EXPIRY_MS;
        const returnUrl = this.url(a.returnPath);
        const cancelUrl = this.url(a.cancelPath);
        const checkoutId = await ctx.runMutation(this.component.checkouts.create, {
            app: this.app,
            ref: a.ref,
            purpose: a.purpose,
            description: a.description,
            amountCents: a.amountCents,
            processor: a.processor,
            method: a.method,
            kind: 'hosted',
            payer: cleanPayer(a.payer),
            returnUrl,
            cancelUrl,
            expiresAt,
            context: a.context,
            callbacks: await this.handles(),
            limits: await this.limits(ctx, 'start', a.limitKey ?? a.payer.email),
            ...(save ? { scheduleId: save.scheduleId, schedulePeriod: save.schedulePeriod, stripeCustomerId: save.stripeCustomerId } : {}),
            now,
        });
        try {
            const made = a.processor === 'stripe' ? await this.startStripe(checkoutId, a, returnUrl, cancelUrl, expiresAt, now, save) : await this.startPaypal(ctx, checkoutId, a, returnUrl, cancelUrl, save);
            await ctx.runMutation(this.component.checkouts.attach, { id: checkoutId, processorCheckoutId: made.id });
            return made.embedded ? { checkoutId, embedded: made.embedded } : { checkoutId, redirectUrl: made.url };
        }
        catch (err) {
            await ctx.runMutation(this.component.checkouts.failStart, { id: checkoutId, error: errorText(err), now: Date.now() });
            console.error(`payments: starting ${a.processor} checkout ${checkoutId} failed: ${errorText(err)}`);
            throw new ConvexError(`${a.processor === 'stripe' ? 'Stripe' : 'PayPal'} couldn’t start the payment just now. Please try again in a moment.`);
        }
    }
    async startStripe(checkoutId, a, returnUrl, cancelUrl, expiresAt, now, save) {
        const successUrl = withParam(returnUrl, 'session_id', '{CHECKOUT_SESSION_ID}');
        const embedded = a.ui === 'embedded';
        const s = await stripe.createSession(this.stripeKeys(), {
            app: this.app,
            checkoutId,
            description: a.description,
            amountCents: a.amountCents,
            method: a.method === 'ach' ? 'ach' : 'card',
            email: a.payer.email,
            successUrl,
            cancelUrl,
            expiresAt,
            now,
            embedded,
            ...(save?.stripeCustomerId ? { customer: save.stripeCustomerId, saveForLater: true } : {}),
        }, { fetch: this.fetch });
        if (embedded) {
            if (!s.client_secret)
                throw new Error('Stripe returned no client secret for the embedded checkout.');
            return { id: s.id, embedded: { processor: 'stripe', clientSecret: s.client_secret } };
        }
        if (!s.url)
            throw new Error('Stripe returned no checkout address.');
        return { id: s.id, url: s.url };
    }
    async startPaypal(ctx, checkoutId, a, returnUrl, cancelUrl, save) {
        const embedded = a.ui === 'embedded';
        const kind = a.method === 'card' ? 'card' : 'paypal';
        const order = await this.withPaypal(ctx, (call) => paypal.createOrder(call, {
            customId: tagFor(this.app, checkoutId),
            description: a.description,
            amountCents: a.amountCents,
            returnUrl,
            cancelUrl,
            brandName: this.options.brandName,
            embedded,
            ...(save ? { save: { kind, customerId: save.paypalCustomerId, description: a.description } } : {}),
        }, `checkout-${checkoutId}`));
        if (embedded) {
            const payment = { processor: 'paypal', orderId: order.id, clientId: this.paypalKeys().clientId, returnUrl: withParam(returnUrl, 'token', order.id) };
            // An order that saves its method names it, so only that kind of button can pay it.
            return { id: order.id, embedded: save ? { ...payment, only: kind } : payment };
        }
        const url = approveUrl(order);
        if (!url)
            throw new Error('PayPal returned no approval address.');
        return { id: order.id, url };
    }
    /** @internal Records a paid Stripe session, then (best effort) the fee Stripe kept. */
    async settleStripeSession(ctx, checkoutId, s) {
        const state = sessionState(s);
        const pi = paymentIntentId(s);
        if (pi && (state === 'paid' || state === 'processing'))
            await this.saveForSchedule(ctx, checkoutId, { stripePaymentIntent: pi });
        if (state === 'processing')
            return await ctx.runMutation(this.component.checkouts.markProcessing, { id: checkoutId, paymentRef: pi ?? undefined, now: Date.now() });
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
        if (capture.status !== 'DECLINED' && capture.status !== 'FAILED')
            await this.saveForSchedule(ctx, checkoutId, { paypalOrder: order });
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
            return await ctx.runMutation(this.component.checkouts.markProcessing, { id: checkoutId, paymentRef: capture.id, now: Date.now() });
        // A saved method's charge declined later (a pending capture, then PAYMENT.CAPTURE.DECLINED) marks the method too.
        const c = await ctx.runQuery(this.component.checkouts.get, { id: checkoutId });
        return await ctx.runMutation(this.component.checkouts.settleFailed, {
            id: checkoutId,
            reason: `PayPal ${capture.status.toLowerCase()} the payment.`,
            declined: c?.kind === 'offSession' || undefined,
            now: Date.now(),
        });
    }
    /**
     * @internal Before a schedule's first payment is settled: the method it saved (Stripe's
     * setup_future_usage, PayPal's vault with purchase) becomes the schedule's, so settling starts it
     * with something to charge. A webhook's PayPal capture carries no payment_source, so the order is
     * read again. Best effort: a schedule left without a method fails its next charge, and the app's
     * scheduleFailed asks the payer for another.
     */
    async saveForSchedule(ctx, checkoutId, from) {
        const c = await ctx.runQuery(this.component.checkouts.get, { id: checkoutId });
        if (!c?.scheduleId || c.kind !== 'hosted')
            return;
        const s = await ctx.runQuery(this.component.schedules.get, { id: c.scheduleId });
        if (!s || s.status !== 'starting' || s.paymentMethodId)
            return;
        try {
            if (c.processor === 'stripe' && from.stripePaymentIntent) {
                const pi = await stripe.paymentIntentWithMethod(this.stripeKeys(), from.stripePaymentIntent, { fetch: this.fetch });
                const pm = typeof pi.payment_method === 'object' ? pi.payment_method : null;
                const kind = pm ? savedMethodKind(pm.type) : null;
                const label = pm ? savedMethodLabel(pm) : null;
                if (!pm || !kind || !label || !c.stripeCustomerId)
                    throw new Error(`Stripe's PaymentIntent ${pi.id} has no saved card or bank account.`);
                await ctx.runMutation(this.component.schedules.attachMethod, {
                    id: s.id,
                    stripe: { stripeCustomerId: c.stripeCustomerId, stripePaymentMethodId: pm.id, kind, label },
                    now: Date.now(),
                });
            }
            else if (c.processor === 'paypal' && from.paypalOrder) {
                const orderId = from.paypalOrder.id || c.processorCheckoutId;
                const order = from.paypalOrder.payment_source || !orderId ? from.paypalOrder : await this.withPaypal(ctx, (call) => paypal.getOrder(call, orderId));
                const saved = orderVault(order);
                if (!saved)
                    throw new Error(`PayPal's order ${order.id} saved nothing in the vault (yet).`);
                await ctx.runMutation(this.component.schedules.attachMethod, {
                    id: s.id,
                    paypal: {
                        paypalCustomerId: saved.customerId,
                        paymentTokenId: saved.paymentTokenId,
                        kind: saved.kind,
                        label: saved.label,
                        usagePattern: saved.kind === 'paypal' ? RECURRING_USAGE_PATTERN : undefined,
                        networkRef: saved.networkRef,
                    },
                    now: Date.now(),
                });
            }
        }
        catch (err) {
            console.warn(`payments: schedule ${s.id} starts without a saved method: ${errorText(err)}`);
        }
    }
    /**
     * @internal Captures an approved PayPal order and settles it. A second capture (a reloaded
     * return page, the webhook and the sweep racing) gets ORDER_ALREADY_CAPTURED from PayPal: the
     * order is then fetched and settled from what it says, instead of failing (fix b). A checkout
     * that is no longer waiting (abandoned, failed, settled) is never captured: with PayPal no money
     * moves until the capture, so taking it now would only mean refunding it.
     *
     * 'declined': PayPal refused the card or account the buyer chose (INSTRUMENT_DECLINED). The order
     * stays open, so on the app's page PayPal's buttons let the buyer choose another way to pay and
     * approve again; the decline is noted on the checkout. From then on only the buyer captures it
     * (`by: 'buyer'`: completeReturn, which the buttons and the return page call): the webhook and the
     * sweep leave it alone, and the sweep abandons it when it expires. Otherwise a card that went
     * through later (funds arrived, a fraud check cleared) would be charged after the buyer gave up or
     * paid another way. The buyer's captures each have their own request id (PayPal answers a repeated
     * id with its first answer, which would repeat the decline); the background's keep one per
     * checkout. An order can't be captured twice whatever the id.
     */
    async capturePaypal(ctx, checkoutId, orderId, by) {
        const c = await ctx.runQuery(this.component.checkouts.get, { id: checkoutId });
        if (c?.status !== 'pending' && c?.status !== 'created')
            return undefined;
        if (by === 'background' && c.lastError === PAYPAL_DECLINED)
            return 'declined';
        const requestId = by === 'buyer' ? `capture-${checkoutId}-${Date.now().toString(36)}` : `capture-${checkoutId}`;
        const order = await this.withPaypal(ctx, async (call) => {
            try {
                return await paypal.captureOrder(call, orderId, requestId);
            }
            catch (err) {
                if (err instanceof ProcessorError && err.code === 'ORDER_ALREADY_CAPTURED')
                    return await paypal.getOrder(call, orderId);
                if (err instanceof ProcessorError && err.code === 'ORDER_NOT_APPROVED')
                    return null;
                if (err instanceof ProcessorError && err.code === 'INSTRUMENT_DECLINED')
                    return 'declined';
                throw err;
            }
        });
        if (order === 'declined') {
            await ctx.runMutation(this.component.checkouts.noteError, { id: checkoutId, error: PAYPAL_DECLINED });
            return order;
        }
        if (order)
            await this.settlePaypalOrder(ctx, checkoutId, order);
        return undefined;
    }
    /**
     * For the page the buyer comes back to (`token`: Stripe's session_id or payment_intent, or PayPal's
     * token). Returns the outcome at once if the checkout is already settled; otherwise asks the
     * processor and settles (capturing an approved PayPal order), so the page doesn't wait for a
     * webhook. Null: not ours. publicApi().completeReturn wraps this with a rate limit. PayPal's
     * buttons call it when the buyer approves; `declined` then means PayPal refused what the buyer
     * chose and the buttons should let them choose again (the checkout is still pending).
     */
    async completeReturn(ctx, { processor, token }) {
        if (!token || token.length > 255)
            return null;
        const found = await ctx.runQuery(this.component.checkouts.byProcessorId, { processorCheckoutId: token });
        if (!found || found.processor !== processor || found.app !== this.app)
            return null;
        let declined = false;
        if (!FINAL.has(found.status) || found.status === 'abandoned') {
            if (found.kind !== 'hosted' && found.processor === 'stripe')
                await completeIntentReturn(this, ctx, found);
            else if (processor === 'paypal') {
                const order = await this.withPaypal(ctx, (call) => paypal.getOrder(call, token));
                if (order.status === 'APPROVED')
                    declined = (await this.capturePaypal(ctx, found.id, token, 'buyer')) === 'declined';
                else if (order.status === 'COMPLETED')
                    await this.settlePaypalOrder(ctx, found.id, order);
            }
            else {
                await this.settleStripeSession(ctx, found.id, await stripe.retrieveSession(this.stripeKeys(), token, { fetch: this.fetch }));
            }
        }
        const now = await ctx.runQuery(this.component.checkouts.get, { id: found.id });
        return { checkoutId: found.id, ref: found.ref, purpose: found.purpose, status: now?.status ?? found.status, ...(declined ? { declined: true } : {}) };
    }
    /**
     * Closes a checkout the buyer started and won't pay, e.g. they pressed Edit on the app's page: the
     * Stripe session is expired at Stripe, a PayPal order is left to lapse (none of its money moves
     * until the library captures, which it won't for an abandoned checkout), and the checkout is
     * abandoned now instead of when it expires. The start it counted against the buyer's own rate limit
     * is given back (pass the `limitKey` start was given, if any). If it was paid meanwhile, it is
     * settled as paid instead. Returns how it stands; null: not this app's checkout.
     *
     * Only for a checkout id the buyer was given by start (the id is the buyer's secret; anyone holding
     * it can close the unpaid checkout, nothing more). publicApi().cancelCheckout wraps this.
     */
    async cancel(ctx, checkoutId, o = {}) {
        const c = await ctx.runQuery(this.component.checkouts.get, { id: checkoutId });
        if (!c || c.app !== this.app || c.kind !== 'hosted')
            return null;
        if (c.status !== 'created' && c.status !== 'pending')
            return { status: c.status };
        if (c.processor === 'stripe' && c.processorCheckoutId) {
            const keys = this.stripeKeys();
            try {
                await stripe.expireSession(keys, c.processorCheckoutId, { fetch: this.fetch });
            }
            catch (err) {
                // Not open any more: paid (or on its way) in the meantime, or already expired.
                if (!(err instanceof ProcessorError && err.status === 400))
                    throw err;
                const s = await stripe.retrieveSession(keys, c.processorCheckoutId, { fetch: this.fetch });
                const state = sessionState(s);
                if (state === 'paid' || state === 'processing') {
                    await this.settleStripeSession(ctx, c.id, s);
                    return { status: (await ctx.runQuery(this.component.checkouts.get, { id: c.id }))?.status ?? c.status };
                }
            }
        }
        const limits = await this.limits(ctx, 'start', o.limitKey ?? c.payer.email);
        const own = limits?.find((l) => !l.key.endsWith(':all'));
        const r = await ctx.runMutation(this.component.checkouts.cancel, { id: c.id, giveBack: own && { key: own.key, windowMs: own.windowMs }, now: Date.now() });
        return { status: r.outcome === 'abandoned' ? 'abandoned' : r.status };
    }
    // ── Saved payment methods ─────────────────────────────────────────────────────────────────────
    /**
     * Starts saving a card or bank account for `owner` (e.g. { type: 'user', id }): makes their Stripe
     * Customer if needed and a SetupIntent for charging later with nobody present (bank accounts
     * verified at once). Returns its client secret for Stripe's Payment Element. Rate-limited, so call
     * it when the payer submits the form (`<StripeSaveMethod createSetupIntent>`), never when it opens.
     */
    async setupPaymentMethod(ctx, a) {
        return await setupPaymentMethod(this, ctx, a);
    }
    /**
     * Starts saving a card or PayPal account in PayPal's vault for `owner`: a setup token for PayPal's
     * Card Fields (`PaypalCardFields`) or its PayPal button (`PaypalSaveButton`) in the browser, with the
     * REST app's client id. A card is checked when saved ($0 authorization; 3-D Secure only if the bank
     * asks). `description` is what a PayPal account holder agrees to. Rate-limited.
     */
    async setupPaypalMethod(ctx, a) {
        return await setupPaypalMethod(this, ctx, a);
    }
    /**
     * Saves what the buyer approved a setup token with (the browser component's onSaved gives its id),
     * refusing a token made for someone else or a card whose check failed. Returns the saved method,
     * charged later with chargeSaved like a Stripe one. Rate-limited.
     */
    async savePaypalMethod(ctx, a) {
        return await savePaypalMethod(this, ctx, a);
    }
    /** The owner's saved cards, bank accounts and PayPal accounts at both processors, newest first, each with whether a charge of it was declined. */
    async savedMethods(ctx, a) {
        return await savedMethods(this, ctx, a);
    }
    /**
     * Checks that a payment method id (from the browser) is one saved for this owner, at Stripe or in
     * PayPal's vault, and returns it; anything else throws, so nobody can pay with a made-up or someone
     * else's method.
     */
    async verifyMethodOwner(ctx, a) {
        return await verifyMethodOwner(this, ctx, a);
    }
    /**
     * The owner removes one of their saved methods (checked to be theirs): deleted from PayPal's vault
     * or detached from their Stripe Customer, and never offered or charged again. Whether it may go
     * (e.g. a bid still relies on it) is the app's to check first.
     */
    async removeSavedMethod(ctx, a) {
        await removeSavedMethod(this, ctx, a);
    }
    /**
     * Charges a saved method with nobody present, from a mutation or action: records the checkout and
     * queues the charge (payments.worker().charge). A card that needs the buyer to authenticate is
     * refused rather than left waiting. Outcomes come back through the callbacks: paid; processing then
     * paid or failed for a bank account; failed (declined: true) when the bank says no. A charge whose
     * outcome is unknown is tried again a few times under the same key, then left for a person as a
     * charge_unknown issue. Same idempotencyKey, same checkout. Returns the checkout id.
     */
    async chargeSaved(ctx, a) {
        return await this.chargeOffSession(ctx, a);
    }
    /** @internal chargeSaved, and a schedule's charge (tagged with the schedule and the period it pays). */
    async chargeOffSession(ctx, a, schedule) {
        if (!Number.isInteger(a.amountCents) || a.amountCents < 1)
            throw new ConvexError('A charge needs an amount of at least one cent.');
        if (!a.idempotencyKey || a.idempotencyKey.length > 200)
            throw new ConvexError('A charge needs an idempotency key of at most 200 characters.');
        this.checkContext(a.context);
        const existing = await ctx.runQuery(this.component.checkouts.byChargeKey, { chargeKey: `${this.app}:${a.idempotencyKey}` });
        if (existing)
            return existing.id;
        const target = await this.chargeTarget(ctx, a);
        const now = Date.now();
        const site = this.url('/');
        const checkoutId = await ctx.runMutation(this.component.checkouts.create, {
            app: this.app,
            ref: a.ref,
            purpose: a.purpose,
            description: a.description,
            amountCents: a.amountCents,
            processor: target.processor,
            method: target.method,
            kind: 'offSession',
            payer: cleanPayer(a.payer),
            returnUrl: site,
            cancelUrl: site,
            // Never given up by time: an off-session charge ends paid, failed or by a person's decision.
            expiresAt: now + 3650 * 24 * 60 * 60_000,
            context: a.context,
            callbacks: await this.handles(),
            stripeCustomerId: target.stripeCustomerId,
            paymentMethodId: a.paymentMethodId,
            chargeKey: `${this.app}:${a.idempotencyKey}`,
            ...(schedule ?? {}),
            now,
        });
        await ctx.scheduler.runAfter(0, this.wiring.worker.charge, { checkoutId });
        return checkoutId;
    }
    /** @internal Which processor charges a saved method: PayPal's must be the owner's, recorded here; Stripe's need the owner's Customer. */
    async chargeTarget(ctx, a) {
        const tokenId = paypalTokenOf(a.paymentMethodId);
        if (tokenId) {
            const found = await ctx.runQuery(this.component.customers.paypalMethod, { paymentTokenId: tokenId });
            if (!found || found.app !== this.app || found.owner.type !== a.owner.type || found.owner.id !== a.owner.id)
                throw new ConvexError('That payment method isn’t saved for this payer.');
            return { processor: 'paypal', method: found.method.kind };
        }
        const customer = await ctx.runQuery(this.component.customers.byOwner, { app: this.app, owner: a.owner });
        const stripeCustomerId = customer?.stripeCustomerId ?? a.stripeCustomerId;
        if (!stripeCustomerId)
            throw new ConvexError('This payer has no saved payment method here.');
        const method = await ctx.runQuery(this.component.customers.method, { stripePaymentMethodId: a.paymentMethodId });
        return { processor: 'stripe', method: method?.kind ?? 'card', stripeCustomerId };
    }
    /** @internal Makes (or retries) an off-session charge; payments.worker().charge runs this. */
    async charge(ctx, checkoutId, manual = false) {
        await chargeNow(this, ctx, checkoutId, manual);
    }
    /**
     * For the buyer to pay on the app's page after an off-session charge failed: a PaymentIntent
     * (card or bank account, theirs to choose in the Payment Element) for the same amount, its outcome
     * coming back through the same callbacks with kind 'onSession'. One that is still waiting is
     * reused, so two tabs can't each take a payment; one already on its way is refused. Rate-limited, so
     * call it when the buyer presses Pay (`<StripeRetryPayment createPayment>`), not when the page opens.
     */
    async retryOnSession(ctx, a) {
        return await retryOnSession(this, ctx, a);
    }
    /**
     * The same, paid with PayPal's buttons on the app's page (`PaypalButtons` with the `embedded` it
     * returns): a PayPal account or a card. Only one retry is open at a time, so asking for PayPal
     * closes an unpaid Stripe one and the other way round. `returnPath` is where the buttons send the
     * buyer once paid (with PayPal's token, for completeReturn). Rate-limited.
     */
    async retryWithPaypal(ctx, a) {
        return await retryWithPaypal(this, ctx, a);
    }
    // ── Schedules ─────────────────────────────────────────────────────────────────────────────────
    /**
     * Charges a saved method every month: the first charge now (or at firstChargeAt), then on the
     * anchor day, each an off-session checkout keyed `schedule-<id>-<period>` with the usual callbacks
     * plus scheduleCharged / scheduleFailed. Refusals are retried (retryDays, default 3, 5 and 7 days
     * after the first), then the schedule lapses; hard declines lapse it at once. From a mutation or
     * action. Returns the schedule id and the first charge's checkout id when it was made now.
     */
    async startSchedule(ctx, a) {
        return await startSchedule(this, ctx, a);
    }
    /**
     * A schedule for a new payer, its first payment saving the method: Stripe's embedded Checkout
     * (card or bank account, saved with setup_future_usage; Checkout tells the payer, and shows a
     * bank account's mandate) or PayPal (a PayPal account agreeing to recurring charges with
     * PaypalButtons, or a card in PaypalCardPayment, saved with vault-with-purchase). The app picks the
     * processor (e.g. the cheaper for the monthly amount). The schedule starts when that payment is
     * paid (or on its way, for a bank account); if it never is, scheduleChanged says not_started.
     * Rate-limited like start.
     */
    async startScheduleCheckout(ctx, a) {
        return await startScheduleCheckout(this, ctx, a);
    }
    /**
     * Changes a schedule: the amount (from the next charge), the saved method (one of the owner's,
     * checked as for chargeSaved), the day of the month, the description. A new method on a schedule
     * being retried charges the refused period at once; on a lapsed one it starts again.
     */
    async updateSchedule(ctx, a) {
        return await updateSchedule(this, ctx, a);
    }
    /** Skips charges until `until` (ms); the first charge date after that charges again, by itself. */
    async pauseSchedule(ctx, a) {
        return await ctx.runMutation(this.component.schedules.pause, { id: a.scheduleId, app: this.app, until: a.until, by: a.by, now: Date.now() });
    }
    /** A paused or lapsed schedule charges again, from `at` (default now) on its next charge date. */
    async resumeSchedule(ctx, a) {
        return await ctx.runMutation(this.component.schedules.resume, { id: a.scheduleId, app: this.app, at: a.at, by: a.by, now: Date.now() });
    }
    /** Ends a schedule for good (a charge already on its way still settles). */
    async cancelSchedule(ctx, a) {
        return await ctx.runMutation(this.component.schedules.cancel, { id: a.scheduleId, app: this.app, reason: a.reason, by: a.by, now: Date.now() });
    }
    /** An owner's schedules, newest first, ended ones included. */
    async schedulesFor(ctx, owner) {
        return await ctx.runQuery(this.component.schedules.forOwner, { app: this.app, owner });
    }
    /** The schedules for one thing in the app, newest first. */
    async schedulesForRef(ctx, ref) {
        return (await ctx.runQuery(this.component.schedules.forRef, { ref })).filter((s) => s.app === this.app);
    }
    /** One schedule, or null (also for another app's). */
    async getSchedule(ctx, scheduleId) {
        const s = await ctx.runQuery(this.component.schedules.get, { id: scheduleId });
        return s && s.app === this.app ? s : null;
    }
    /** @internal The hourly run; payments.worker().schedules runs this. */
    async runSchedules(ctx, o = {}) {
        return await runSchedules(this, ctx, o);
    }
    // ── Queries ───────────────────────────────────────────────────────────────────────────────────
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
    /** Paid checkouts with something left to refund, newest first, paginated (an index read, not a scan). */
    async refundable(ctx, o) {
        return await ctx.runQuery(this.component.checkouts.refundable, o);
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
     * Adds the webhook routes to the app's router, each only when its processor's keys exist. Runs the
     * keys' start-up checks first (fromEnv): a live deployment set up wrongly fails to load. Events the
     * library doesn't know, or for objects that aren't this app's, go to onUnhandledStripeEvent.
     */
    registerRoutes(http, o = {}) {
        this.options.stripe?.check?.();
        this.options.paypal?.check?.();
        if (this.options.stripe?.()) {
            http.route({ path: o.stripePath ?? '/stripe/webhook', method: 'POST', handler: httpActionGeneric(async (ctx, req) => await this.handleStripeWebhook(ctx, req, o.onUnhandledStripeEvent)) });
        }
        if (this.options.paypal?.()) {
            http.route({ path: o.paypalPath ?? '/paypal/webhook', method: 'POST', handler: httpActionGeneric(async (ctx, req) => await this.handlePaypalWebhook(ctx, req)) });
        }
    }
    // ── Refunds ───────────────────────────────────────────────────────────────────────────────────
    /**
     * Asks for a refund (the whole remaining amount unless given). Who may is the app's check; `by` is
     * recorded. `hostData` (at most 10 strings of at most 200 characters, e.g. { relist: 'yes' }; keys
     * non-empty printable ASCII not starting with `$`) is kept on the refund and passed to on.refunded
     * when it is done. Returns the refund id.
     */
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
     * Every 10 minutes (registerCrons). PayPal checkouts pending over 5 minutes: captured if the buyer
     * approved (they may have closed the tab: fix a), abandoned once expired. Expired Stripe sessions
     * and on-session payments: settled if paid, else ended at Stripe and abandoned. Off-session charges
     * whose outcome never came back: asked again. Refunds left sending over 10 minutes: asked about
     * (or sent again, safely, under the same key).
     */
    async sweep(ctx) {
        const now = Date.now();
        const out = { checked: 0, settled: 0, abandoned: 0, refunds: 0, errors: 0 };
        for (const c of await ctx.runQuery(this.component.checkouts.due, { limit: 200 })) {
            if (c.app !== this.app || c.status === 'processing')
                continue;
            const expired = c.expiresAt <= now;
            const look = c.kind === 'offSession' ? true : expired || (c.processor === 'paypal' && c.status === 'pending' && c.createdAt <= now - PAYPAL_LOOK_AFTER_MS);
            if (!look)
                continue;
            try {
                const before = c.status;
                // A PayPal retry on the app's page is a PayPal order like a hosted one; off-session charges and Stripe's own go through sweepIntent.
                const asOrder = c.kind === 'hosted' || (c.kind === 'onSession' && c.processor === 'paypal');
                const acted = asOrder ? (await this.sweepOne(ctx, c, expired), true) : await sweepIntent(this, ctx, c, expired, now);
                if (!acted)
                    continue;
                out.checked++;
                const after = (await ctx.runQuery(this.component.checkouts.get, { id: c.id }))?.status;
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
            if (order?.status === 'APPROVED') {
                let outcome;
                try {
                    outcome = await this.capturePaypal(ctx, c.id, id, 'background');
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
                const now = await this.withPaypal(ctx, (call) => paypal.getOrder(call, id));
                return now.status === 'COMPLETED' ? await this.settlePaypalOrder(ctx, c.id, now) : await abandon();
            }
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
     * Nightly (registerCrons): compares the last `days` of checkouts, saved-method charges and refunds
     * with each processor and opens an issue for each difference (resolving ones that went away).
     * Refunds found at the processor that the ledger lacks are recorded. PayPal's Transaction Search,
     * for captures tagged with this app that the component never heard of, is skipped (logged once a
     * day) when PayPal refuses it.
     */
    async reconcile(ctx, o = {}) {
        return await reconcile(this, ctx, o.days ?? 3);
    }
    /**
     * The PayPal account's history for one email, newest first: every transaction in the range whose
     * other party is that address (payments in, refunds and payments out), not only this library's.
     * Needs Transaction Search on the REST app; PayPal keeps three years, and is up to three hours late.
     */
    async paypalHistory(ctx, a) {
        return await paypalHistory(this, ctx, a);
    }
    /** Nightly: deletes what isn't kept (see the component's maintenance.ts), a batch at a time; call again while `more`. */
    async cleanup(ctx) {
        return await ctx.runMutation(this.component.maintenance.cleanup, { now: Date.now() });
    }
    /** Nightly: hands the issues nobody was told about yet to the app's on.issues, then marks them told. Returns how many. */
    async issuesDigest(ctx) {
        const unreported = await ctx.runQuery(this.component.issues.unreported, {});
        // One that already went away (a late webhook) isn't news; it is marked told with the rest.
        const issues = unreported.filter((i) => i.resolvedAt === null);
        if (issues.length) {
            await ctx.runMutation(this.wiring.on.issues, {
                issues: issues.map((i) => ({ id: i.id, kind: i.kind, detail: i.detail, checkoutId: i.checkoutId, processor: i.processor, openedAt: i.openedAt })),
            });
        }
        if (unreported.length)
            await ctx.runMutation(this.component.issues.markReported, { ids: unreported.map((i) => i.id), now: Date.now() });
        return issues.length;
    }
    // ── Issues ────────────────────────────────────────────────────────────────────────────────────
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
    // ── What the app exports ──────────────────────────────────────────────────────────────────────
    /** The internal functions for the crons and scheduled charges: `export const { sweep, reconcile, cleanup, issuesDigest, charge } = payments.worker()`. */
    worker() {
        return worker(this);
    }
    /**
     * Public queries, mutations and actions for an admin page (refunds, issues, charges with an unknown
     * outcome), each behind authorize.admin: `export const admin = payments.adminApi()`.
     */
    adminApi(o = {}) {
        return adminApi(this, o);
    }
    /** The buyer-facing functions, rate-limited: `export const { completeReturn } = payments.publicApi()`. */
    publicApi() {
        return publicApi(this);
    }
    /**
     * The library's crons, on the app's cron table: sweep every 10 minutes; reconcile, the issues digest
     * and cleanup nightly (UTC hours; reconcile first, the digest half an hour after).
     */
    registerCrons(crons, o = {}) {
        const w = this.wiring.worker;
        const h = o.reconcileHourUTC ?? 8;
        crons.interval('payments sweep', { minutes: 10 }, w.sweep, {});
        crons.daily('payments reconcile', { hourUTC: h, minuteUTC: 0 }, w.reconcile, {});
        crons.daily('payments issues digest', { hourUTC: h, minuteUTC: 30 }, w.issuesDigest, {});
        crons.daily('payments cleanup', { hourUTC: o.cleanupHourUTC ?? (h + 1) % 24, minuteUTC: 0 }, w.cleanup, {});
        if (w.schedules)
            crons.hourly('payments schedules', { minuteUTC: 5 }, w.schedules, {});
    }
}
const defaultSiteUrl = () => {
    const url = typeof process === 'undefined' ? undefined : process.env.SITE_URL;
    if (!url)
        throw new Error('SITE_URL isn’t set on this deployment (or pass siteUrl to definePayments).');
    return url;
};
const cleanPayer = (p) => ({ email: p.email.trim(), ...(p.name?.trim() ? { name: p.name.trim() } : {}) });
/** `url` with one more query parameter. Not encoded: Stripe's {CHECKOUT_SESSION_ID} must reach Stripe as it is, and PayPal's ids are letters and digits. */
const withParam = (url, name, value) => `${url}${url.includes('?') ? '&' : '?'}${name}=${value}`;
/** The idempotency key of a refund's send: the same for every repeat of one attempt (component refunds.begin makes the same). */
export const refundKey = (refundId, attempts) => (attempts ? `refund-${refundId}-${attempts}` : `refund-${refundId}`);
/** For the validators of the app's worker functions. */
export const workerArgs = { charge: { checkoutId: v.string(), manual: v.optional(v.boolean()) }, schedules: { scheduleId: v.optional(v.string()) } };
//# sourceMappingURL=index.js.map