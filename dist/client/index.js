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
import { PAYPAL_LIVE_API, PAYPAL_SANDBOX_API, paypalToken, paypalTokenOf } from '../core/paypal.js';
import { METHOD_NOT_SAVED } from '../core/declines.js';
import { accountFingerprint, decryptToken, encryptToken } from '../core/tokenCrypt.js';
import { ProcessorError } from '../core/types.js';
import { adminApi, publicApi, worker } from './api.js';
import { mismatch } from './context.js';
import { paypalHistory } from './paypalHistory.js';
import { reconcile } from './reconcile.js';
import { chargeNow, removeSavedMethod, retryOnSession, retryWithPaypal, savedMethods, setupPaymentMethod, verifyMethodOwner } from './saved.js';
import { savePaypalMethod, setupPaypalMethod } from './paypalVault.js';
import { runSchedules, startSchedule, startScheduleCheckout, updateSchedule } from './schedules.js';
import { cleanPayer } from './util.js';
import { callbackArgs, paidReturns, } from './validators.js';
import { handlePaypalWebhook, handleStripeWebhook } from './webhooks.js';
import * as hosted from './hosted.js';
import * as refunds from './refunds.js';
import * as sweep from './sweep.js';
export * from './validators.js';
export { fromEnv, isLive, stripeProblems, paypalProblems } from './env.js';
export { PAYPAL_LIVE_API, PAYPAL_SANDBOX_API };
export { errorText, PAYPAL_DECLINED, refundKey } from './util.js';
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
    /**
     * @internal The rate-limit keys of one public call: the host's own `limitKey` when it gives one, else
     * the signed-in user, else `fallbackKey` (e.g. the payer's email); and everyone together.
     */
    async limits(ctx, entry, fallbackKey, scale = 1, limitKey) {
        const l = this.options.limits;
        if (l === false)
            return undefined;
        const identity = limitKey?.trim() || !ctx.auth ? null : await ctx.auth.getUserIdentity();
        const own = limitKey?.trim() || (identity ? null : fallbackKey?.trim());
        const who = own ? `key:${own.toLowerCase()}` : identity ? `user:${identity.subject}` : null;
        const perKey = (l?.perKey ?? 5) * scale;
        const windowMs = (l?.windowMinutes ?? 10) * 60_000;
        const global = { key: `${this.app}:${entry}:all`, max: (l?.globalPerMinute ?? 30) * scale, windowMs: 60_000, message: 'Too many payments are being started right now. Try again in a minute.' };
        return who ? [global, { key: `${this.app}:${entry}:${who}`, max: perKey, windowMs, message: 'Too many tries just now. Try again in a few minutes.' }] : [global];
    }
    /** @internal */
    async takeLimits(ctx, entry, fallbackKey, scale = 1, limitKey) {
        const limits = await this.limits(ctx, entry, fallbackKey, scale, limitKey);
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
    /** @internal See hosted.ts. */
    async begin(ctx, a, save) {
        return await hosted.begin(this, ctx, a, save);
    }
    /** @internal See hosted.ts. */
    async settleStripeSession(ctx, checkoutId, s) {
        return await hosted.settleStripeSession(this, ctx, checkoutId, s);
    }
    /** @internal See hosted.ts. */
    async settlePaypalOrder(ctx, checkoutId, order) {
        return await hosted.settlePaypalOrder(this, ctx, checkoutId, order);
    }
    /** @internal See hosted.ts. */
    async saveForSchedule(ctx, checkoutId, from) {
        return await hosted.saveForSchedule(this, ctx, checkoutId, from);
    }
    /** @internal See hosted.ts. */
    async capturePaypal(ctx, checkoutId, orderId, by) {
        return await hosted.capturePaypal(this, ctx, checkoutId, orderId, by);
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
        return await hosted.completeReturn(this, ctx, { processor, token });
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
        return await hosted.cancel(this, ctx, checkoutId, o);
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
    /** The owner's saved cards, bank accounts and PayPal accounts at both processors, newest first, each with whether a charge of it was declined. Rate-limited. */
    async savedMethods(ctx, a) {
        return await savedMethods(this, ctx, a);
    }
    /**
     * Checks that a payment method id (from the browser) is one saved for this owner, at Stripe or in
     * PayPal's vault, and returns it; anything else throws, so nobody can pay with a made-up or someone
     * else's method. Rate-limited.
     */
    async verifyMethodOwner(ctx, a) {
        return await verifyMethodOwner(this, ctx, a);
    }
    /**
     * The owner removes one of their saved methods (checked to be theirs): deleted from PayPal's vault
     * or detached from their Stripe Customer, and never offered or charged again. Whether it may go
     * (e.g. a bid still relies on it) is the app's to check first. Rate-limited.
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
     *
     * A method that isn't saved for the payer (another owner's, or an owner with nothing saved here)
     * isn't thrown: the checkout is recorded failed at once (declineCode METHOD_NOT_SAVED, declined
     * false, nothing charged) and failed runs in that transaction, so the payer can pay with
     * retryOnSession / retryWithPaypal. A bad amount, key or context still throws.
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
        if (existing) {
            if (existing.amountCents !== a.amountCents || existing.paymentMethodId !== a.paymentMethodId || existing.ref.type !== a.ref.type || existing.ref.id !== a.ref.id)
                throw new ConvexError('That idempotency key was already used for a different charge (another amount, payment method or thing paid for).');
            return existing.id;
        }
        const target = await this.savedTarget(ctx, a);
        // A schedule checks its method when it starts or changes; there a method not saved stays a refusal.
        if ('notSaved' in target && schedule)
            throw new ConvexError(target.notSaved);
        // Recorded as a failed charge rather than thrown, so the app's failed path runs and the payer can pay on its page (retryOnSession / retryWithPaypal).
        const failed = 'notSaved' in target ? { reason: target.notSaved, declineCode: METHOD_NOT_SAVED } : undefined;
        const now = Date.now();
        const site = this.url('/');
        const made = await ctx.runMutation(this.component.checkouts.createCharge, {
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
            failed,
            now,
        });
        // Made by a call racing this one: that call queued the charge.
        if (made.created && !failed)
            await ctx.scheduler.runAfter(0, this.wiring.worker.charge, { checkoutId: made.id });
        return made.id;
    }
    /** @internal Which processor charges a saved method: PayPal's must be the owner's, recorded here; Stripe's need the owner's Customer. */
    async chargeTarget(ctx, a) {
        const target = await this.savedTarget(ctx, a);
        if ('notSaved' in target)
            throw new ConvexError(target.notSaved);
        return target;
    }
    /** chargeTarget, saying why when the method isn't saved for the owner (with the processor it would have been). */
    async savedTarget(ctx, a) {
        const tokenId = paypalTokenOf(a.paymentMethodId);
        if (tokenId) {
            const found = await ctx.runQuery(this.component.customers.paypalMethod, { paymentTokenId: tokenId });
            if (!found || found.app !== this.app || found.owner.type !== a.owner.type || found.owner.id !== a.owner.id)
                return { processor: 'paypal', method: 'card', notSaved: 'That payment method isn’t saved for this payer.' };
            return { processor: 'paypal', method: found.method.kind };
        }
        const customer = await ctx.runQuery(this.component.customers.byOwner, { app: this.app, owner: a.owner });
        const stripeCustomerId = customer?.stripeCustomerId ?? a.stripeCustomerId;
        if (!stripeCustomerId)
            return { processor: 'stripe', method: 'card', notSaved: 'This payer has no saved payment method here.' };
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
        return await refunds.sendRefund(this, ctx, refundId, o);
    }
    /** @internal See refunds.ts. */
    async pushRefund(ctx, r) {
        return await refunds.pushRefund(this, ctx, r);
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
        return await sweep.sweep(this, ctx);
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
        // The worker is usually a module reference (internal.payments), on which every name exists, so
        // whether the app uses schedules is read from the callbacks it wrote out, not from w.schedules.
        const on = this.wiring.on;
        if (w.schedules && on.scheduleCharged && on.scheduleFailed && on.scheduleChanged)
            crons.hourly('payments schedules', { minuteUTC: 5 }, w.schedules, {});
    }
}
const defaultSiteUrl = () => {
    const url = typeof process === 'undefined' ? undefined : process.env.SITE_URL;
    if (!url)
        throw new Error('SITE_URL isn’t set on this deployment (or pass siteUrl to definePayments).');
    return url;
};
/** For the validators of the app's worker functions. */
export const workerArgs = { charge: { checkoutId: v.string(), manual: v.optional(v.boolean()) }, schedules: { scheduleId: v.optional(v.string()) } };
//# sourceMappingURL=index.js.map