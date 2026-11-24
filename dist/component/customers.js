// Saved payment methods: one Stripe Customer per payer of an app, and what the library knows about
// each saved card or bank account (its label, and whether an off-session charge of it was declined).
// Stripe holds the methods themselves; the client lists them there and records them here.
import { ConvexError, v } from 'convex/values';
import { mutation, query } from './_generated/server.js';
import { networkRef, ref, savedMethodKind } from './schema.js';
const customerView = v.object({ id: v.string(), stripeCustomerId: v.string(), email: v.string() });
const methodView = v.object({
    stripePaymentMethodId: v.string(),
    kind: savedMethodKind,
    label: v.string(),
    declined: v.boolean(),
    declineReason: v.union(v.string(), v.null()),
    removed: v.boolean(),
});
const methodViewOf = (m) => ({
    stripePaymentMethodId: m.stripePaymentMethodId,
    kind: m.kind,
    label: m.label,
    declined: m.declinedAt !== undefined,
    declineReason: m.declineReason ?? null,
    removed: m.removedAt !== undefined,
});
async function find(ctx, app, owner) {
    return await ctx.db
        .query('customers')
        .withIndex('by_owner', (q) => q.eq('app', app).eq('owner.type', owner.type).eq('owner.id', owner.id))
        .first();
}
export const byOwner = query({
    args: { app: v.string(), owner: ref },
    returns: v.union(customerView, v.null()),
    handler: async (ctx, { app, owner }) => {
        const c = await find(ctx, app, owner);
        return c ? { id: c._id, stripeCustomerId: c.stripeCustomerId, email: c.email } : null;
    },
});
/** Records the payer's Stripe Customer; a second call for the same payer keeps the first. Returns the one kept. */
export const save = mutation({
    args: { app: v.string(), owner: ref, stripeCustomerId: v.string(), email: v.string(), now: v.number() },
    returns: customerView,
    handler: async (ctx, a) => {
        const existing = await find(ctx, a.app, a.owner);
        if (existing)
            return { id: existing._id, stripeCustomerId: existing.stripeCustomerId, email: existing.email };
        const id = await ctx.db.insert('customers', { app: a.app, owner: a.owner, stripeCustomerId: a.stripeCustomerId, email: a.email, createdAt: a.now });
        return { id, stripeCustomerId: a.stripeCustomerId, email: a.email };
    },
});
/** Records the methods Stripe listed for a customer (new ones added, labels kept current) and returns them with their declined flags, in the order given. */
export const saveMethods = mutation({
    args: { stripeCustomerId: v.string(), methods: v.array(v.object({ stripePaymentMethodId: v.string(), kind: savedMethodKind, label: v.string() })), now: v.number() },
    returns: v.array(methodView),
    handler: async (ctx, { stripeCustomerId, methods, now }) => {
        const customer = await ctx.db
            .query('customers')
            .withIndex('by_stripeCustomerId', (q) => q.eq('stripeCustomerId', stripeCustomerId))
            .first();
        if (!customer)
            return methods.map((m) => ({ ...m, declined: false, declineReason: null, removed: false }));
        const out = [];
        for (const m of methods) {
            const row = await ctx.db
                .query('paymentMethods')
                .withIndex('by_stripePaymentMethodId', (q) => q.eq('stripePaymentMethodId', m.stripePaymentMethodId))
                .first();
            if (!row) {
                const id = await ctx.db.insert('paymentMethods', { customerId: customer._id, ...m, createdAt: now });
                const made = await ctx.db.get(id);
                if (made)
                    out.push(methodViewOf(made));
                continue;
            }
            if (row.label !== m.label)
                await ctx.db.patch(row._id, { label: m.label });
            out.push(methodViewOf({ ...row, label: m.label }));
        }
        return out;
    },
});
/** One saved method as the library knows it, or null. */
export const method = query({
    args: { stripePaymentMethodId: v.string() },
    returns: v.union(methodView, v.null()),
    handler: async (ctx, { stripePaymentMethodId }) => {
        const row = await ctx.db
            .query('paymentMethods')
            .withIndex('by_stripePaymentMethodId', (q) => q.eq('stripePaymentMethodId', stripePaymentMethodId))
            .first();
        return row ? methodViewOf(row) : null;
    },
});
/** The owner removed a Stripe method: it is never offered or charged again. */
export const removeMethod = mutation({
    args: { stripePaymentMethodId: v.string(), now: v.number() },
    returns: v.null(),
    handler: async (ctx, { stripePaymentMethodId, now }) => {
        const row = await ctx.db
            .query('paymentMethods')
            .withIndex('by_stripePaymentMethodId', (q) => q.eq('stripePaymentMethodId', stripePaymentMethodId))
            .first();
        if (row && row.removedAt === undefined)
            await ctx.db.patch(row._id, { removedAt: now });
        return null;
    },
});
// ── PayPal's vault ──────────────────────────────────────────────────────────────────────────────
const paypalMethodView = v.object({
    paymentTokenId: v.string(),
    kind: v.union(v.literal('card'), v.literal('paypal')),
    label: v.string(),
    declined: v.boolean(),
    declineReason: v.union(v.string(), v.null()),
    removed: v.boolean(),
    createdAt: v.number(),
    usagePattern: v.union(v.string(), v.null()),
    networkRef: v.union(networkRef, v.null()),
});
const paypalMethodViewOf = (m) => ({
    paymentTokenId: m.paymentTokenId,
    kind: m.kind,
    label: m.label,
    declined: m.declinedAt !== undefined,
    declineReason: m.declineReason ?? null,
    removed: m.removedAt !== undefined,
    createdAt: m.createdAt,
    usagePattern: m.usagePattern ?? null,
    networkRef: m.networkRef ?? null,
});
async function findPaypal(ctx, app, owner) {
    return await ctx.db
        .query('paypalCustomers')
        .withIndex('by_owner', (q) => q.eq('app', app).eq('owner.type', owner.type).eq('owner.id', owner.id))
        .first();
}
/** The owner's PayPal customer id, or null before their first save. */
export const paypalCustomer = query({
    args: { app: v.string(), owner: ref },
    returns: v.union(v.string(), v.null()),
    handler: async (ctx, { app, owner }) => (await findPaypal(ctx, app, owner))?.paypalCustomerId ?? null,
});
/** The owner's saved PayPal methods, newest first, without removed ones. */
export const paypalMethods = query({
    args: { app: v.string(), owner: ref },
    returns: v.array(paypalMethodView),
    handler: async (ctx, { app, owner }) => {
        const c = await findPaypal(ctx, app, owner);
        if (!c)
            return [];
        const rows = await ctx.db
            .query('paypalMethods')
            .withIndex('by_customer', (q) => q.eq('customerId', c._id))
            .order('desc')
            .take(50);
        return rows.filter((m) => m.removedAt === undefined).map(paypalMethodViewOf);
    },
});
/** One saved PayPal method with whose it is, or null. */
export const paypalMethod = query({
    args: { paymentTokenId: v.string() },
    returns: v.union(v.object({ method: paypalMethodView, app: v.string(), owner: ref, paypalCustomerId: v.string() }), v.null()),
    handler: async (ctx, { paymentTokenId }) => {
        const row = await ctx.db
            .query('paypalMethods')
            .withIndex('by_paymentTokenId', (q) => q.eq('paymentTokenId', paymentTokenId))
            .first();
        const c = row ? await ctx.db.get(row.customerId) : null;
        return row && c ? { method: paypalMethodViewOf(row), app: c.app, owner: c.owner, paypalCustomerId: c.paypalCustomerId } : null;
    },
});
/** Records a method just saved in PayPal's vault (and the owner's PayPal customer, the first time). Saving the same one again keeps the first row. */
export const savePaypalMethod = mutation({
    args: {
        app: v.string(),
        owner: ref,
        paypalCustomerId: v.string(),
        paymentTokenId: v.string(),
        kind: v.union(v.literal('card'), v.literal('paypal')),
        label: v.string(),
        usagePattern: v.optional(v.string()),
        now: v.number(),
    },
    returns: paypalMethodView,
    handler: async (ctx, a) => {
        const customerId = (await findPaypal(ctx, a.app, a.owner))?._id ?? (await ctx.db.insert('paypalCustomers', { app: a.app, owner: a.owner, paypalCustomerId: a.paypalCustomerId, createdAt: a.now }));
        const existing = await ctx.db
            .query('paypalMethods')
            .withIndex('by_paymentTokenId', (q) => q.eq('paymentTokenId', a.paymentTokenId))
            .first();
        if (existing)
            return paypalMethodViewOf(existing);
        const id = await ctx.db.insert('paypalMethods', { customerId, paymentTokenId: a.paymentTokenId, kind: a.kind, label: a.label, usagePattern: a.usagePattern, createdAt: a.now });
        const made = await ctx.db.get(id);
        if (!made)
            throw new ConvexError('The saved method vanished.');
        return paypalMethodViewOf(made);
    },
});
/** The owner removed a PayPal method (deleted from PayPal's vault first): marked, never offered again. */
export const removePaypalMethod = mutation({
    args: { paymentTokenId: v.string(), now: v.number() },
    returns: v.null(),
    handler: async (ctx, { paymentTokenId, now }) => {
        const row = await ctx.db
            .query('paypalMethods')
            .withIndex('by_paymentTokenId', (q) => q.eq('paymentTokenId', paymentTokenId))
            .first();
        if (row && row.removedAt === undefined)
            await ctx.db.patch(row._id, { removedAt: now });
        return null;
    },
});
//# sourceMappingURL=customers.js.map