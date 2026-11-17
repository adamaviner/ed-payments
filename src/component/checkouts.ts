// The checkout state machine. Every transition checks where the row is first and answers
// already_handled when it has moved on, so a repeated webhook, a reloaded return page and the sweep
// can all race without doing anything twice (Convex runs mutations one at a time per row).
import { ConvexError, v } from 'convex/values'
import { paginationOptsValidator, paginationResultValidator } from 'convex/server'
import type { Doc, Id } from './_generated/dataModel.js'
import { mutation, query, type MutationCtx } from './_generated/server.js'
import { callHost, callbackBase, checkoutView, notifyHost, openIssue, view } from './lib.js'
import { callbacks, checkoutStatus, method, payer, processor, ref } from './schema.js'

const already = v.object({ outcome: v.literal('already_handled'), status: checkoutStatus })
const dollarsOf = (cents: number) => `$${(cents / 100).toFixed(2)}`

async function load(ctx: MutationCtx, id: string): Promise<Doc<'checkouts'>> {
  const nid = ctx.db.normalizeId('checkouts', id)
  const c = nid ? await ctx.db.get(nid) : null
  if (!c) throw new ConvexError(`No checkout ${id}.`)
  return c
}

const limitArgs = v.object({
  /** Counted per key, e.g. the buyer's email. */
  key: v.optional(v.string()),
  perKey: v.number(),
  windowMs: v.number(),
  /** All checkouts of all buyers, per minute. */
  globalPerMinute: v.number(),
})

/** Adds one to a fixed-window counter; false when it is already at the limit. */
async function take(ctx: MutationCtx, key: string, max: number, windowMs: number, now: number): Promise<boolean> {
  const row = await ctx.db
    .query('limits')
    .withIndex('by_key', (q) => q.eq('key', key))
    .first()
  if (!row || now - row.windowStart >= windowMs) {
    if (row) await ctx.db.patch(row._id, { windowStart: now, count: 1 })
    else await ctx.db.insert('limits', { key, windowStart: now, count: 1 })
    return true
  }
  if (row.count >= max) return false
  await ctx.db.patch(row._id, { count: row.count + 1 })
  return true
}

/** Makes the row before the processor is asked, so its id can be the processor's reference. Refuses past the rate limits. */
export const create = mutation({
  args: {
    app: v.string(),
    ref,
    purpose: v.string(),
    description: v.string(),
    amountCents: v.number(),
    processor,
    method,
    payer,
    returnUrl: v.string(),
    cancelUrl: v.string(),
    expiresAt: v.number(),
    context: v.optional(v.any()),
    callbacks,
    limit: v.optional(limitArgs),
    now: v.number(),
  },
  returns: v.string(),
  handler: async (ctx, { limit, now, ...a }) => {
    if (!Number.isInteger(a.amountCents) || a.amountCents < 1) throw new ConvexError('A checkout needs an amount of at least one cent.')
    if (limit) {
      if (!(await take(ctx, 'global', limit.globalPerMinute, 60_000, now))) throw new ConvexError('Too many checkouts are being started right now. Try again in a minute.')
      if (limit.key && !(await take(ctx, `key:${limit.key.trim().toLowerCase()}`, limit.perKey, limit.windowMs, now))) {
        throw new ConvexError('Too many checkouts were started for you just now. Try again in a few minutes.')
      }
    }
    return await ctx.db.insert('checkouts', { ...a, status: 'created', refundedCents: 0, createdAt: now })
  },
})

/** The processor made its checkout: remember its id; the buyer is on their way. */
export const attach = mutation({
  args: { id: v.string(), processorCheckoutId: v.string() },
  returns: v.union(v.object({ outcome: v.literal('attached') }), already),
  handler: async (ctx, { id, processorCheckoutId }) => {
    const c = await load(ctx, id)
    if (c.status !== 'created') return { outcome: 'already_handled' as const, status: c.status }
    await ctx.db.patch(c._id, { status: 'pending', processorCheckoutId })
    return { outcome: 'attached' as const }
  },
})

/** The processor couldn't make its checkout; start throws to the buyer, and the row is closed. */
export const failStart = mutation({
  args: { id: v.string(), error: v.string(), now: v.number() },
  returns: v.null(),
  handler: async (ctx, { id, error, now }) => {
    const c = await load(ctx, id)
    if (c.status === 'created') await ctx.db.patch(c._id, { status: 'failed', lastError: error, settledAt: now })
    return null
  },
})

/** A bank payment was accepted and the money is on its way (days, for ACH). */
export const markProcessing = mutation({
  args: { id: v.string(), paymentRef: v.optional(v.string()) },
  returns: v.union(v.object({ outcome: v.literal('processing') }), already),
  handler: async (ctx, { id, paymentRef }) => {
    const c = await load(ctx, id)
    if (c.status !== 'created' && c.status !== 'pending') return { outcome: 'already_handled' as const, status: c.status }
    await ctx.db.patch(c._id, { status: 'processing', paymentRef: paymentRef ?? c.paymentRef })
    return { outcome: 'processing' as const }
  },
})

const SETTLEABLE: ReadonlySet<Doc<'checkouts'>['status']> = new Set(['created', 'pending', 'processing', 'abandoned', 'failed'])

/**
 * The money arrived. Records it and calls the host's onPaid in this same transaction, so "paid" and
 * the host's order are written together or not at all. If onPaid refuses ({ refuse }) or throws (its
 * writes roll back), or the amount isn't what was asked, the checkout is refund_needed, a refund for
 * the whole amount is recorded, and onRefundNeeded is told. A payment for a checkout that was already
 * abandoned or failed is still money taken, so it is settled the same way.
 */
export const settlePaid = mutation({
  args: { id: v.string(), paymentRef: v.string(), paidCents: v.number(), processorFeeCents: v.optional(v.number()), now: v.number() },
  returns: v.union(v.object({ outcome: v.literal('paid') }), v.object({ outcome: v.literal('refund_needed'), reason: v.string(), refundId: v.string() }), already),
  handler: async (ctx, { id, paymentRef, paidCents, processorFeeCents, now }) => {
    const c = await load(ctx, id)
    if (!SETTLEABLE.has(c.status)) return { outcome: 'already_handled' as const, status: c.status }
    await ctx.db.patch(c._id, { paymentRef, paidCents, processorFeeCents, settledAt: now, lastError: undefined })
    let refusal: string | null = paidCents === c.amountCents ? null : `The processor took ${dollarsOf(paidCents)}, not the ${dollarsOf(c.amountCents)} asked.`
    if (!refusal && c.callbacks.onPaid) {
      const paid = { ...callbackBase(c), amountCents: c.amountCents, paidCents, paymentRef }
      const res = await callHost<{ refuse?: string } | null>(ctx, c.callbacks.onPaid, paid)
      refusal = !res.ok ? res.error : res.value && typeof res.value.refuse === 'string' ? res.value.refuse || 'Refused by the app.' : null
    }
    if (refusal === null) {
      await ctx.db.patch(c._id, { status: 'paid' })
      return { outcome: 'paid' as const }
    }
    console.warn(`payments: ${c.processor} payment ${paymentRef} for checkout ${c._id} needs a refund: ${refusal}`)
    await ctx.db.patch(c._id, { status: 'refund_needed', lastError: refusal })
    const refundId = await ctx.db.insert('refunds', { checkoutId: c._id, amountCents: paidCents, reason: refusal, origin: 'needed', status: 'requested', createdAt: now, updatedAt: now })
    const updated = (await ctx.db.get(c._id)) ?? c
    await notifyHost(ctx, updated, 'onRefundNeeded', { amountCents: c.amountCents, paidCents, paymentRef, refundId, reason: refusal }, now)
    return { outcome: 'refund_needed' as const, reason: refusal, refundId }
  },
})

/** The processor says the payment failed (a declined capture, a bounced bank debit). Nothing to refund. */
export const settleFailed = mutation({
  args: { id: v.string(), reason: v.string(), now: v.number() },
  returns: v.union(v.object({ outcome: v.literal('failed') }), already),
  handler: async (ctx, { id, reason, now }) => {
    const c = await load(ctx, id)
    if (c.status !== 'created' && c.status !== 'pending' && c.status !== 'processing') return { outcome: 'already_handled' as const, status: c.status }
    await ctx.db.patch(c._id, { status: 'failed', lastError: reason, settledAt: now })
    await notifyHost(ctx, { ...c, status: 'failed' }, 'onFailed', { reason }, now)
    return { outcome: 'failed' as const }
  },
})

/** Expired with nothing at the processor. */
export const abandon = mutation({
  args: { id: v.string(), now: v.number() },
  returns: v.union(v.object({ outcome: v.literal('abandoned') }), already),
  handler: async (ctx, { id, now }) => {
    const c = await load(ctx, id)
    if (c.status !== 'created' && c.status !== 'pending') return { outcome: 'already_handled' as const, status: c.status }
    await ctx.db.patch(c._id, { status: 'abandoned', settledAt: now })
    return { outcome: 'abandoned' as const }
  },
})

/** What the processor kept, learned after the sale. */
export const recordFee = mutation({
  args: { id: v.string(), processorFeeCents: v.number() },
  returns: v.null(),
  handler: async (ctx, { id, processorFeeCents }) => {
    const c = await load(ctx, id)
    if (c.processorFeeCents !== processorFeeCents) await ctx.db.patch(c._id, { processorFeeCents })
    return null
  },
})

/** A problem the client met along the way that a person should see (e.g. a callback for an unknown checkout). */
export const noteIssue = mutation({
  args: { id: v.string(), kind: v.union(v.literal('status_differs'), v.literal('amount_differs')), detail: v.string(), now: v.number() },
  returns: v.null(),
  handler: async (ctx, { id, kind, detail, now }) => {
    const c = await load(ctx, id)
    await openIssue(ctx, { kind, key: c.paymentRef ?? c.processorCheckoutId ?? c._id, checkoutId: c._id, processor: c.processor, paymentRef: c.paymentRef, detail, now })
    return null
  },
})

const nullable = v.union(checkoutView, v.null())

export const get = query({
  args: { id: v.string() },
  returns: nullable,
  handler: async (ctx, { id }) => {
    const nid = ctx.db.normalizeId('checkouts', id)
    const c = nid ? await ctx.db.get(nid) : null
    return c ? view(c) : null
  },
})

export const byProcessorId = query({
  args: { processorCheckoutId: v.string() },
  returns: nullable,
  handler: async (ctx, { processorCheckoutId }) => {
    const c = await ctx.db
      .query('checkouts')
      .withIndex('by_processorCheckoutId', (q) => q.eq('processorCheckoutId', processorCheckoutId))
      .first()
    return c ? view(c) : null
  },
})

export const byPaymentRef = query({
  args: { paymentRef: v.string() },
  returns: nullable,
  handler: async (ctx, { paymentRef }) => {
    const c = await ctx.db
      .query('checkouts')
      .withIndex('by_paymentRef', (q) => q.eq('paymentRef', paymentRef))
      .first()
    return c ? view(c) : null
  },
})

/** The checkouts for one thing in the app, newest first (at most 50). */
export const byRef = query({
  args: { ref },
  returns: v.array(checkoutView),
  handler: async (ctx, { ref }) => {
    const rows = await ctx.db
      .query('checkouts')
      .withIndex('by_ref', (q) => q.eq('ref.type', ref.type).eq('ref.id', ref.id))
      .order('desc')
      .take(50)
    return rows.map(view)
  },
})

export const list = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(checkoutView),
  handler: async (ctx, { paginationOpts }) => {
    const page = await ctx.db.query('checkouts').withIndex('by_createdAt').order('desc').paginate(paginationOpts)
    return { ...page, page: page.page.map(view) }
  },
})

/** Checkouts created since a time, oldest first, for the nightly comparison. */
export const createdSince = query({
  args: { since: v.number(), after: v.optional(v.number()), limit: v.number() },
  returns: v.array(checkoutView),
  handler: async (ctx, { since, after, limit }) => {
    const rows = await ctx.db
      .query('checkouts')
      .withIndex('by_createdAt', (q) => (after === undefined ? q.gte('createdAt', since) : q.gt('createdAt', after)))
      .take(limit)
    return rows.map(view)
  },
})

/** Not-final checkouts for sweep: every created/pending/processing row, oldest expiry first. */
export const due = query({
  args: { limit: v.number() },
  returns: v.array(checkoutView),
  handler: async (ctx, { limit }) => {
    const out: Doc<'checkouts'>[] = []
    for (const status of ['created', 'pending', 'processing'] as const) {
      out.push(
        ...(await ctx.db
          .query('checkouts')
          .withIndex('by_status_expiresAt', (q) => q.eq('status', status))
          .take(limit)),
      )
    }
    return out.map(view)
  },
})

export type CheckoutId = Id<'checkouts'>
