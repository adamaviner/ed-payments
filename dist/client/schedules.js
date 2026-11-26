// Schedules: a saved method charged every month, by the library. The component keeps each schedule
// and decides what follows each charge (schedules.ts there); this side makes the charges, as
// off-session checkouts keyed `schedule-<id>-<period>`, from the app's hourly cron (worker().schedules)
// and from startSchedule when the first charge is due at once. startScheduleCheckout begins one for a
// new payer with a payment that also saves their method: Stripe's embedded Checkout or on-page
// PaymentIntent with setup_future_usage, or PayPal's buttons / Card Fields with vault-with-purchase.
import { createFunctionHandle } from 'convex/server';
import { ConvexError } from 'convex/values';
import { DEFAULT_CHARGE_HOUR_UTC, DEFAULT_RETRY_DAYS, anchorDayOf, isAnchorDay } from '../core/schedule.js';
import { isMethodFor } from '../core/types.js';
import { getOrderOrNull, orderVault } from '../core/paypal.js';
import { MAX_REPLACED_HOPS, STALE_PRESS, paypalSavedArgs, reuseOrClose } from './hosted.js';
import { ensureCustomer } from './saved.js';
import { cleanPayer, errorText } from './util.js';
/** Throws unless the app wired what schedules need: the three schedule callbacks and worker().schedules. */
function wired(p) {
    const on = p.wiring.on;
    if (!on.scheduleCharged || !on.scheduleFailed || !on.scheduleChanged || !p.wiring.worker.schedules) {
        throw new Error('Schedules need on.scheduleCharged, on.scheduleFailed and on.scheduleChanged in withCallbacks, and worker().schedules exported (see the README).');
    }
    return { charged: on.scheduleCharged, failed: on.scheduleFailed, changed: on.scheduleChanged };
}
async function handles(p) {
    const w = wired(p);
    return { onCharged: await createFunctionHandle(w.charged), onFailed: await createFunctionHandle(w.failed), onChanged: await createFunctionHandle(w.changed) };
}
function checkBase(p, a) {
    if (!Number.isInteger(a.amountCents) || a.amountCents < 1)
        throw new ConvexError('A schedule needs an amount of at least one cent.');
    if (a.anchorDay !== undefined && !isAnchorDay(a.anchorDay))
        throw new ConvexError('A schedule’s day of the month must be 1 to 28.');
    p.checkContext(a.context);
}
const clock = (p) => ({ hourUTC: p.options.schedules?.hourUTC ?? DEFAULT_CHARGE_HOUR_UTC, retryDays: [...(p.options.schedules?.retryDays ?? DEFAULT_RETRY_DAYS)] });
export async function startSchedule(p, ctx, a) {
    checkBase(p, a);
    const callbacks = await handles(p);
    const target = await p.chargeTarget(ctx, { owner: a.owner, paymentMethodId: a.paymentMethodId, stripeCustomerId: a.stripeCustomerId });
    const now = Date.now();
    const firstChargeAt = Math.max(a.firstChargeAt ?? now, now);
    const scheduleId = await ctx.runMutation(p.component.schedules.create, {
        app: p.app,
        owner: a.owner,
        ref: a.ref,
        purpose: a.purpose,
        description: a.description,
        payer: cleanPayer(a.payer),
        processor: target.processor,
        method: target.method,
        paymentMethodId: a.paymentMethodId,
        amountCents: a.amountCents,
        anchorDay: a.anchorDay ?? anchorDayOf(firstChargeAt),
        ...clock(p),
        firstChargeAt,
        callbacks,
        context: a.context,
        now,
    });
    const checkoutId = firstChargeAt <= now ? await chargeDue(p, ctx, scheduleId) : null;
    return { scheduleId, checkoutId };
}
export async function startScheduleCheckout(p, ctx, a) {
    // A first payment another press already replaced is followed to the one that replaced it.
    for (let hop = 0; hop < MAX_REPLACED_HOPS; hop++) {
        const r = await startScheduleCheckoutOnce(p, ctx, a);
        if (!('replacedBy' in r))
            return r;
        a = { ...a, replaces: r.replacedBy };
    }
    throw new ConvexError(STALE_PRESS);
}
async function startScheduleCheckoutOnce(p, ctx, a) {
    if (!isMethodFor(a.processor, a.method))
        throw new ConvexError(`${a.processor === 'stripe' ? 'Stripe' : 'PayPal'} doesn’t take ${a.method} payments here.`);
    checkBase(p, a);
    const ui = a.ui ?? 'embedded';
    if (a.replaces) {
        const replaces = await ctx.runQuery(p.component.checkouts.latest, { id: a.replaces });
        a = { ...a, replaces };
        const reused = await reuseOrClose(p, ctx, replaces, { ...a, ui, schedule: { owner: a.owner, anchorDay: a.anchorDay } });
        if (reused?.scheduleId)
            return { checkoutId: reused.checkoutId, onPage: reused.onPage, reused: true, scheduleId: reused.scheduleId };
    }
    const callbacks = await handles(p);
    let stripeCustomerId;
    let paypalCustomerId;
    if (a.processor === 'stripe') {
        p.stripeKeys();
        const customer = await ensureCustomer(p, ctx, a.owner, a.payer, a.stripeCustomerId);
        if (!customer)
            throw new ConvexError('Couldn’t set up a payer here.');
        stripeCustomerId = customer.stripeCustomerId;
    }
    else {
        p.paypalKeys();
        paypalCustomerId = (await ctx.runQuery(p.component.customers.paypalCustomer, { app: p.app, owner: a.owner })) ?? undefined;
    }
    const now = Date.now();
    const scheduleId = await ctx.runMutation(p.component.schedules.create, {
        app: p.app,
        owner: a.owner,
        ref: a.ref,
        purpose: a.purpose,
        description: a.description,
        payer: cleanPayer(a.payer),
        processor: a.processor,
        method: a.method,
        amountCents: a.amountCents,
        anchorDay: a.anchorDay ?? anchorDayOf(now),
        ...clock(p),
        firstChargeAt: now,
        callbacks,
        context: a.context,
        now,
    });
    const schedule = await ctx.runQuery(p.component.schedules.get, { id: scheduleId });
    try {
        const started = await p.begin(ctx, {
            ref: a.ref,
            purpose: a.purpose,
            description: a.description,
            amountCents: a.amountCents,
            processor: a.processor,
            method: a.method,
            payer: a.payer,
            returnPath: a.returnPath,
            cancelPath: a.cancelPath,
            expiresAt: a.expiresAt,
            limitKey: a.limitKey,
            context: a.context,
            ui,
            replaces: a.replaces,
        }, { scheduleId, schedulePeriod: schedule?.period ?? '', stripeCustomerId, paypalCustomerId });
        if ('replacedBy' in started) {
            await discard(p, ctx, scheduleId);
            return started;
        }
        return { ...started, scheduleId };
    }
    catch (err) {
        await discard(p, ctx, scheduleId);
        throw err;
    }
}
/** A schedule made for a first payment that didn't start (no checkout was made for it) is removed. */
async function discard(p, ctx, scheduleId) {
    await ctx.runMutation(p.component.schedules.discard, { id: scheduleId }).catch((e) => console.warn(`payments: couldn’t discard schedule ${scheduleId}: ${errorText(e)}`));
}
/**
 * Charges a schedule if it is due (the component decides, keyed by period), returning the checkout id,
 * or null when there was nothing to charge.
 */
export async function chargeDue(p, ctx, scheduleId) {
    const plan = await ctx.runMutation(p.component.schedules.claim, { id: scheduleId, app: p.app, now: Date.now() });
    if (plan.action === 'check_vault') {
        await checkPaypalVault(p, ctx, plan.orderId);
        return null;
    }
    if (plan.action !== 'charge')
        return null;
    return await p.chargeOffSession(ctx, {
        ref: plan.ref,
        purpose: plan.purpose,
        description: plan.description,
        amountCents: plan.amountCents,
        payer: plan.payer,
        owner: plan.owner,
        paymentMethodId: plan.paymentMethodId,
        idempotencyKey: plan.key,
        context: plan.context,
    }, { scheduleId, schedulePeriod: plan.period });
}
/**
 * A schedule waits for the PayPal token its first payment saved after the capture (vault APPROVED):
 * the order shows it once PayPal has finished, so it is read again rather than relying only on
 * VAULT.PAYMENT-TOKEN.CREATED, which may never reach the app and isn't documented to name the order.
 * A token found goes through the same mutation as that event, so the two arriving together save it
 * once. An order that can't be read, or isn't saved yet, leaves the schedule waiting: claim has
 * already set its next look, and fails it as METHOD_NOT_SAVED when the wait is over.
 */
async function checkPaypalVault(p, ctx, orderId) {
    try {
        const order = await p.withPaypal(ctx, (call) => getOrderOrNull(call, orderId));
        const saved = order ? orderVault(order) : null;
        if (!saved)
            return;
        await ctx.runMutation(p.component.schedules.paypalTokenCreated, { app: p.app, orderId, paypal: paypalSavedArgs(saved), now: Date.now() });
    }
    catch (err) {
        console.warn(`payments: couldn’t read PayPal order ${orderId} for its saved method; trying again later: ${errorText(err)}`);
    }
}
/** The hourly run (worker().schedules): every due schedule of this app is charged, or one when given. */
export async function runSchedules(p, ctx, o = {}) {
    const ids = o.scheduleId ? [o.scheduleId] : (await ctx.runQuery(p.component.schedules.due, { app: p.app, now: Date.now(), limit: 100 })).map((s) => s.id);
    const out = { charged: 0, errors: 0 };
    for (const id of ids) {
        try {
            if (await chargeDue(p, ctx, id))
                out.charged++;
        }
        catch (err) {
            out.errors++;
            console.error(`payments: charging schedule ${id} failed: ${errorText(err)}`);
        }
    }
    return out;
}
async function mine(p, ctx, scheduleId) {
    const s = await ctx.runQuery(p.component.schedules.get, { id: scheduleId });
    if (!s || s.app !== p.app)
        throw new ConvexError('There is no such schedule.');
    return s;
}
export async function updateSchedule(p, ctx, a) {
    const s = await mine(p, ctx, a.scheduleId);
    const target = a.paymentMethodId ? await p.chargeTarget(ctx, { owner: s.owner, paymentMethodId: a.paymentMethodId, stripeCustomerId: a.stripeCustomerId }) : undefined;
    return await ctx.runMutation(p.component.schedules.update, {
        id: s.id,
        app: p.app,
        amountCents: a.amountCents,
        paymentMethodId: a.paymentMethodId,
        processor: target?.processor,
        method: target?.method,
        anchorDay: a.anchorDay,
        description: a.description,
        by: a.by,
        now: Date.now(),
    });
}
//# sourceMappingURL=schedules.js.map