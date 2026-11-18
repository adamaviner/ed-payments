// The checkout state machine. Every transition checks where the row is first and answers
// already_handled when it has moved on, so a repeated webhook, a reloaded return page and the sweep
// can all race without doing anything twice (Convex runs mutations one at a time per row).
import { ConvexError, v } from 'convex/values'
import { paginationOptsValidator, paginationResultValidator } from 'convex/server'
import type { Doc, Id } from './_generated/dataModel.js'
import { mutation, query, type MutationCtx } from './_generated/server.js'
import { callHost, callbackBase, checkoutView, notifyHost, openIssue, resolveIssue, view } from './lib.js'
import { callbacks, checkoutKind, checkoutStatus, method, payer, processor, ref } from './schema.js'
import { limitsArg, takeAll } from './limits.js'

const already = v.object({ outcome: v.literal('already_handled'), status: checkoutStatus })
const dollarsOf = (cents: number) => `$${(cents / 100).toFixed(2)}`

async function load(ctx: MutationCtx, id: string): Promise<Doc<'checkouts'>> {
  const nid = ctx.db.normalizeId('checkouts', id)
  const c = nid ? await ctx.db.get(nid) : null
  if (!c) throw new ConvexError(`No checkout ${id}.`)
  return c
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
    kind: v.optional(checkoutKind),
    stripeCustomerId: v.optional(v.string()),
    paymentMethodId: v.optional(v.string()),
    chargeKey: v.optional(v.string()),
    retryOf: v.optional(v.string()),
    limits: v.optional(limitsArg),
    now: v.number(),
  },
  returns: v.string(),
  handler: async (ctx, { limits, now, retryOf, ...a }) => {
    if (!Number.isInteger(a.amountCents) || a.amountCents < 1) throw new ConvexError('A checkout needs an amount of at least one cent.')
    // The same charge key is the same charge: two calls at once make one row.
    if (a.chargeKey) {
      const same = await ctx.db
        .query('checkouts')
        .withIndex('by_chargeKey', (q) => q.eq('chargeKey', a.chargeKey))
        .first()
      if (same) return same._id
    }
    if (limits) await takeAll(ctx, limits, now)
    const original = retryOf ? ctx.db.normalizeId('checkouts', retryOf) : null
    if (retryOf && !original) throw new ConvexError(`No checkout ${retryOf}.`)
    // One open retry at a time, decided in this transaction, so two tabs can't each start one.
    if (original) {
      const open = await ctx.db
        .query('checkouts')
        .withIndex('by_retryOf', (q) => q.eq('retryOf', original))
        .filter((q) => q.or(q.eq(q.field('status'), 'created'), q.eq(q.field('status'), 'pending'), q.eq(q.field('status'), 'processing')))
        .first()
      if (open) throw new ConvexError('A payment for this is already open. Reload the page to continue it.')
    }
    return await ctx.db.insert('checkouts', { ...a, ...(original ? { retryOf: original } : {}), status: 'created', refundedCents: 0, createdAt: now })
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

/** A bank payment was accepted and the money is on its way (days, for ACH). The host's onProcessing is told (e.g. to pause a deadline). */
export const markProcessing = mutation({
  args: { id: v.string(), paymentRef: v.optional(v.string()), method: v.optional(method), now: v.optional(v.number()) },
  returns: v.union(v.object({ outcome: v.literal('processing') }), already),
  handler: async (ctx, { id, paymentRef, method, now }) => {
    const c = await load(ctx, id)
    if (c.status !== 'created' && c.status !== 'pending') return { outcome: 'already_handled' as const, status: c.status }
    const patch = { status: 'processing' as const, paymentRef: paymentRef ?? c.paymentRef, method: method ?? c.method, lastError: undefined }
    await ctx.db.patch(c._id, patch)
    await resolveIssue(ctx, c._id, 'charge_unknown', now ?? Date.now())
    await notifyHost(ctx, { ...c, ...patch }, 'onProcessing', { paymentRef: patch.paymentRef ?? null }, now ?? Date.now())
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
  args: {
    id: v.string(),
    paymentRef: v.string(),
    paidCents: v.number(),
    processorFeeCents: v.optional(v.number()),
    /** Recorded when attach never ran (start died after the processor made its checkout). */
    processorCheckoutId: v.optional(v.string()),
    /** How it was actually paid, when that can differ from what was asked (an on-session retry may use another method). */
    method: v.optional(method),
    now: v.number(),
  },
  returns: v.union(v.object({ outcome: v.literal('paid') }), v.object({ outcome: v.literal('refund_needed'), reason: v.string(), refundId: v.string() }), already),
  handler: async (ctx, { id, paymentRef, paidCents, processorFeeCents, processorCheckoutId, method, now }) => {
    const loaded = await load(ctx, id)
    if (!SETTLEABLE.has(loaded.status)) return { outcome: 'already_handled' as const, status: loaded.status }
    const c = { ...loaded, method: method ?? loaded.method }
    await ctx.db.patch(c._id, { paymentRef, paidCents, processorFeeCents, settledAt: now, lastError: undefined, method: c.method, processorCheckoutId: c.processorCheckoutId ?? processorCheckoutId })
    await resolveIssue(ctx, c._id, 'charge_unknown', now)
    let refusal: string | null = paidCents === c.amountCents ? null : `The processor took ${dollarsOf(paidCents)}, not the ${dollarsOf(c.amountCents)} asked.`
    // A charge and its on-session retries pay for one thing: the second to arrive is owed back.
    if (!refusal && (await paidElsewhere(ctx, c))) refusal = 'This was already paid by another payment.'
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

/**
 * The processor says the payment failed (a declined capture or card, a bounced bank debit), or a
 * person gave up on a charge whose outcome was unknown. Nothing to refund. `declined` marks the
 * saved method the charge used, so it isn't offered again.
 */
export const settleFailed = mutation({
  args: { id: v.string(), reason: v.string(), declined: v.optional(v.boolean()), processorCheckoutId: v.optional(v.string()), now: v.number() },
  returns: v.union(v.object({ outcome: v.literal('failed') }), already),
  handler: async (ctx, { id, reason, declined, processorCheckoutId, now }) => {
    const c = await load(ctx, id)
    if (c.status !== 'created' && c.status !== 'pending' && c.status !== 'processing') return { outcome: 'already_handled' as const, status: c.status }
    const wasProcessing = c.status === 'processing'
    await ctx.db.patch(c._id, { status: 'failed', lastError: reason, settledAt: now, processorCheckoutId: c.processorCheckoutId ?? processorCheckoutId })
    if (declined && c.paymentMethodId) await markDeclined(ctx, c.paymentMethodId, reason, now)
    await resolveIssue(ctx, c._id, 'charge_unknown', now)
    await notifyHost(ctx, { ...c, status: 'failed' }, 'onFailed', { reason, declined: declined ?? false, wasProcessing }, now)
    return { outcome: 'failed' as const }
  },
})

/**
 * An off-session charge whose outcome isn't known (no answer, Stripe down, an odd status). The row
 * stays waiting; the attempt is counted, and with `giveUp` an issue asks a person to decide.
 */
export const noteChargeAttempt = mutation({
  args: { id: v.string(), error: v.string(), processorCheckoutId: v.optional(v.string()), giveUp: v.boolean(), max: v.number(), now: v.number() },
  returns: v.number(),
  handler: async (ctx, { id, error, processorCheckoutId, giveUp, max, now }) => {
    const c = await load(ctx, id)
    // Settled meanwhile (the webhook won the race): nothing is unknown any more.
    if (c.status !== 'created' && c.status !== 'pending') return c.chargeAttempts ?? 0
    // Handed to a person: counted as the last try, so the sweep leaves it to them.
    const attempts = giveUp ? Math.max((c.chargeAttempts ?? 0) + 1, max) : (c.chargeAttempts ?? 0) + 1
    const ref = c.processorCheckoutId ?? processorCheckoutId
    await ctx.db.patch(c._id, { chargeAttempts: attempts, lastTriedAt: now, lastError: error, processorCheckoutId: ref, status: c.status === 'created' ? 'pending' : c.status })
    if (giveUp) {
      await openIssue(ctx, {
        kind: 'charge_unknown',
        key: c._id,
        checkoutId: c._id,
        processor: c.processor,
        paymentRef: ref,
        detail: `The charge of ${dollarsOf(c.amountCents)} for ${c.description} may or may not have gone through (${error}). Retry it (Stripe replays it rather than charging twice) or give up on it.`,
        now,
      })
    }
    return attempts
  },
})

/**
 * A person asked for an off-session charge to be tried again: its issue closes and the client tries
 * once more. The count is kept, since it picks the next idempotency key.
 */
export const reopenCharge = mutation({
  args: { id: v.string(), now: v.number() },
  returns: v.null(),
  handler: async (ctx, { id, now }) => {
    const c = await load(ctx, id)
    if (c.kind !== 'offSession') throw new ConvexError('Only a saved-method charge can be retried.')
    if (c.status !== 'created' && c.status !== 'pending') throw new ConvexError(`This charge is ${c.status}; there is nothing to retry.`)
    await resolveIssue(ctx, c._id, 'charge_unknown', now)
    return null
  },
})

/** An on-session payment the bank refused: the buyer may try again on the same page, so the checkout stays open. */
export const noteError = mutation({
  args: { id: v.string(), error: v.string() },
  returns: v.null(),
  handler: async (ctx, { id, error }) => {
    const c = await load(ctx, id)
    if (c.status === 'pending' || c.status === 'created') await ctx.db.patch(c._id, { lastError: error })
    return null
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

/** Whether the thing this checkout pays for was already paid: by the charge it retries, or by another retry of it. */
async function paidElsewhere(ctx: MutationCtx, c: Doc<'checkouts'>): Promise<boolean> {
  const rootId = c.retryOf ?? c._id
  const isPaid = (x: Doc<'checkouts'> | null) => !!x && x._id !== c._id && (x.status === 'paid' || x.status === 'processing')
  if (c.retryOf && isPaid(await ctx.db.get(c.retryOf))) return true
  const siblings = await ctx.db
    .query('checkouts')
    .withIndex('by_retryOf', (q) => q.eq('retryOf', rootId))
    .take(50)
  return siblings.some(isPaid)
}

async function markDeclined(ctx: MutationCtx, stripePaymentMethodId: string, reason: string, now: number) {
  const row = await ctx.db
    .query('paymentMethods')
    .withIndex('by_stripePaymentMethodId', (q) => q.eq('stripePaymentMethodId', stripePaymentMethodId))
    .first()
  if (row && row.declinedAt === undefined) await ctx.db.patch(row._id, { declinedAt: now, declineReason: reason })
}

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

/**
 * Paid checkouts with something left to refund, newest first, a page at a time (for a refund screen).
 * With `ref`, only that thing's. Fully refunded rows are left out of each page, so a page may be short.
 */
export const refundable = query({
  args: { ref: v.optional(ref), paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(checkoutView),
  handler: async (ctx, { ref, paginationOpts }) => {
    const page = ref
      ? await ctx.db
          .query('checkouts')
          .withIndex('by_ref', (q) => q.eq('ref.type', ref.type).eq('ref.id', ref.id))
          .order('desc')
          .paginate(paginationOpts)
      : await ctx.db
          .query('checkouts')
          .withIndex('by_status_createdAt', (q) => q.eq('status', 'paid'))
          .order('desc')
          .paginate(paginationOpts)
    return { ...page, page: page.page.filter((c) => c.status === 'paid' && (c.paidCents ?? 0) > c.refundedCents).map(view) }
  },
})

/** The off-session charge made under an app's idempotency key, if any. */
export const byChargeKey = query({
  args: { chargeKey: v.string() },
  returns: nullable,
  handler: async (ctx, { chargeKey }) => {
    const c = await ctx.db
      .query('checkouts')
      .withIndex('by_chargeKey', (q) => q.eq('chargeKey', chargeKey))
      .first()
    return c ? view(c) : null
  },
})

/** The on-session retries of a checkout, newest first. */
export const retriesOf = query({
  args: { id: v.string() },
  returns: v.array(checkoutView),
  handler: async (ctx, { id }) => {
    const nid = ctx.db.normalizeId('checkouts', id)
    if (!nid) return []
    const rows = await ctx.db
      .query('checkouts')
      .withIndex('by_retryOf', (q) => q.eq('retryOf', nid))
      .order('desc')
      .take(20)
    return rows.map(view)
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
