// Saved payment methods: one Stripe Customer per payer of an app, and what the library knows about
// each saved card or bank account (its label, and whether an off-session charge of it was declined).
// Stripe holds the methods themselves; the client lists them there and records them here.
import { v } from 'convex/values'
import type { Doc } from './_generated/dataModel.js'
import { mutation, query, type QueryCtx } from './_generated/server.js'
import { ref, savedMethodKind } from './schema.js'

const customerView = v.object({ id: v.string(), stripeCustomerId: v.string(), email: v.string() })

const methodView = v.object({
  stripePaymentMethodId: v.string(),
  kind: savedMethodKind,
  label: v.string(),
  declined: v.boolean(),
  declineReason: v.union(v.string(), v.null()),
})

const methodViewOf = (m: Doc<'paymentMethods'>) => ({
  stripePaymentMethodId: m.stripePaymentMethodId,
  kind: m.kind,
  label: m.label,
  declined: m.declinedAt !== undefined,
  declineReason: m.declineReason ?? null,
})

async function find(ctx: QueryCtx, app: string, owner: { type: string; id: string }) {
  return await ctx.db
    .query('customers')
    .withIndex('by_owner', (q) => q.eq('app', app).eq('owner.type', owner.type).eq('owner.id', owner.id))
    .first()
}

export const byOwner = query({
  args: { app: v.string(), owner: ref },
  returns: v.union(customerView, v.null()),
  handler: async (ctx, { app, owner }) => {
    const c = await find(ctx, app, owner)
    return c ? { id: c._id, stripeCustomerId: c.stripeCustomerId, email: c.email } : null
  },
})

/** Records the payer's Stripe Customer; a second call for the same payer keeps the first. Returns the one kept. */
export const save = mutation({
  args: { app: v.string(), owner: ref, stripeCustomerId: v.string(), email: v.string(), now: v.number() },
  returns: customerView,
  handler: async (ctx, a) => {
    const existing = await find(ctx, a.app, a.owner)
    if (existing) return { id: existing._id, stripeCustomerId: existing.stripeCustomerId, email: existing.email }
    const id = await ctx.db.insert('customers', { app: a.app, owner: a.owner, stripeCustomerId: a.stripeCustomerId, email: a.email, createdAt: a.now })
    return { id, stripeCustomerId: a.stripeCustomerId, email: a.email }
  },
})

/** Records the methods Stripe listed for a customer (new ones added, labels kept current) and returns them with their declined flags, in the order given. */
export const saveMethods = mutation({
  args: { stripeCustomerId: v.string(), methods: v.array(v.object({ stripePaymentMethodId: v.string(), kind: savedMethodKind, label: v.string() })), now: v.number() },
  returns: v.array(methodView),
  handler: async (ctx, { stripeCustomerId, methods, now }) => {
    const customer = await ctx.db
      .query('customers')
      .withIndex('by_stripeCustomerId', (q) => q.eq('stripeCustomerId', stripeCustomerId))
      .first()
    if (!customer) return methods.map((m) => ({ ...m, declined: false, declineReason: null }))
    const out = []
    for (const m of methods) {
      const row = await ctx.db
        .query('paymentMethods')
        .withIndex('by_stripePaymentMethodId', (q) => q.eq('stripePaymentMethodId', m.stripePaymentMethodId))
        .first()
      if (!row) {
        const id = await ctx.db.insert('paymentMethods', { customerId: customer._id, ...m, createdAt: now })
        const made = await ctx.db.get(id)
        if (made) out.push(methodViewOf(made))
        continue
      }
      if (row.label !== m.label) await ctx.db.patch(row._id, { label: m.label })
      out.push(methodViewOf({ ...row, label: m.label }))
    }
    return out
  },
})

/** One saved method as the library knows it, or null. */
export const method = query({
  args: { stripePaymentMethodId: v.string() },
  returns: v.union(methodView, v.null()),
  handler: async (ctx, { stripePaymentMethodId }) => {
    const row = await ctx.db
      .query('paymentMethods')
      .withIndex('by_stripePaymentMethodId', (q) => q.eq('stripePaymentMethodId', stripePaymentMethodId))
      .first()
    return row ? methodViewOf(row) : null
  },
})
