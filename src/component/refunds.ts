// The refund ledger. A refund is requested (by a person, or because a sale was refused), approved,
// sent through the processor (begin, then finish), or recorded as done by hand, or dismissed.
// Refunds seen at the processor that match no row (made in a dashboard) are recorded as external.
// Rows are never deleted: they are the financial record.
import { ConvexError, v } from 'convex/values'
import type { Doc, Id } from './_generated/dataModel.js'
import { mutation, query, type MutationCtx } from './_generated/server.js'
import { COMMITTED_REFUND, notifyHost, openIssue, refundViewOf, refundView, refundsOf } from './lib.js'
import { processor } from './schema.js'

const dollarsOf = (cents: number) => `$${(cents / 100).toFixed(2)}`

async function loadRefund(ctx: MutationCtx, id: string): Promise<Doc<'refunds'>> {
  const nid = ctx.db.normalizeId('refunds', id)
  const r = nid ? await ctx.db.get(nid) : null
  if (!r) throw new ConvexError(`No refund ${id}.`)
  return r
}

async function loadCheckout(ctx: MutationCtx, id: Id<'checkouts'> | string): Promise<Doc<'checkouts'>> {
  const nid = ctx.db.normalizeId('checkouts', id)
  const c = nid ? await ctx.db.get(nid) : null
  if (!c) throw new ConvexError(`No checkout ${id}.`)
  return c
}

/** What is left to refund once refunds done and in progress are taken off, leaving out `except`. */
async function remaining(ctx: MutationCtx, c: Doc<'checkouts'>, except?: Id<'refunds'>): Promise<number> {
  const inFlight = (await refundsOf(ctx, c._id)).filter((r) => r._id !== except && COMMITTED_REFUND.has(r.status)).reduce((sum, r) => sum + r.amountCents, 0)
  return (c.paidCents ?? 0) - c.refundedCents - inFlight
}

/** Counts a refund as done: adds it to the checkout's refundedCents and tells the host. */
async function counted(ctx: MutationCtx, r: Doc<'refunds'>, now: number) {
  const c = await loadCheckout(ctx, r.checkoutId)
  const refundedCents = c.refundedCents + r.amountCents
  await ctx.db.patch(c._id, { refundedCents })
  await notifyHost(ctx, { ...c, refundedCents }, 'onRefunded', { refundId: r._id, amountCents: r.amountCents, refundedCents, paidCents: c.paidCents ?? 0, origin: r.origin }, now)
}

/** Asks for a refund of a paid checkout; the whole remaining amount unless given. */
export const request = mutation({
  args: { checkoutId: v.string(), amountCents: v.optional(v.number()), reason: v.string(), by: v.optional(v.string()), now: v.number() },
  returns: v.string(),
  handler: async (ctx, { checkoutId, amountCents, reason, by, now }) => {
    const c = await loadCheckout(ctx, checkoutId)
    if (c.status !== 'paid' && c.status !== 'refund_needed') throw new ConvexError('Only a paid checkout can be refunded.')
    const left = await remaining(ctx, c)
    const amount = amountCents ?? left
    if (!Number.isInteger(amount) || amount < 1) throw new ConvexError(left < 1 ? 'Nothing is left to refund on this payment.' : 'A refund needs an amount of at least one cent.')
    if (amount > left) throw new ConvexError(`Only ${dollarsOf(left)} is left to refund on this payment.`)
    return await ctx.db.insert('refunds', {
      checkoutId: c._id,
      amountCents: amount,
      reason: reason.trim() || 'Refund',
      origin: 'requested',
      status: 'requested',
      requestedBy: by,
      createdAt: now,
      updatedAt: now,
    })
  },
})

export const approve = mutation({
  args: { refundId: v.string(), by: v.optional(v.string()), now: v.number() },
  returns: v.null(),
  handler: async (ctx, { refundId, by, now }) => {
    const r = await loadRefund(ctx, refundId)
    if (r.status !== 'requested') throw new ConvexError(`This refund is ${r.status}, not waiting for approval.`)
    await ctx.db.patch(r._id, { status: 'approved', approvedBy: by, updatedAt: now })
    return null
  },
})

const sendable = v.object({
  state: v.literal('send'),
  refundId: v.string(),
  checkoutId: v.string(),
  app: v.string(),
  processor,
  paymentRef: v.string(),
  amountCents: v.number(),
})

/**
 * Claims a refund for sending: approved (or requested, when the host skips approval) or failed
 * before. Checks the amount against what is left. Returns what the processor call needs.
 */
export const begin = mutation({
  args: { refundId: v.string(), skipApproval: v.boolean(), by: v.optional(v.string()), now: v.number() },
  returns: v.union(sendable, v.object({ state: v.literal('already'), status: v.string() })),
  handler: async (ctx, { refundId, skipApproval, by, now }) => {
    const r = await loadRefund(ctx, refundId)
    const ready = r.status === 'approved' || r.status === 'failed' || (skipApproval && r.status === 'requested')
    if (!ready) {
      if (r.status === 'requested') throw new ConvexError('This refund needs approving before it is sent.')
      return { state: 'already' as const, status: r.status }
    }
    const c = await loadCheckout(ctx, r.checkoutId)
    if (!c.paymentRef) throw new ConvexError('This payment has no processor reference to refund.')
    const left = await remaining(ctx, c, r._id)
    if (r.amountCents > left) throw new ConvexError(`Only ${dollarsOf(left)} is left to refund on this payment.`)
    await ctx.db.patch(r._id, { status: 'sending', error: undefined, updatedAt: now, approvedBy: r.approvedBy ?? (r.status === 'requested' ? by : undefined) })
    return { state: 'send' as const, refundId: r._id, checkoutId: c._id, app: c.app, processor: c.processor, paymentRef: c.paymentRef, amountCents: r.amountCents }
  },
})

/**
 * After the processor call. ok + done: sent, counted, the host told. ok but the processor says it is
 * still pending: stays sending with its id (sweep or a webhook finishes it). Not ok: failed, may be sent again.
 */
export const finish = mutation({
  args: { refundId: v.string(), ok: v.boolean(), done: v.boolean(), processorRefundId: v.optional(v.string()), error: v.optional(v.string()), now: v.number() },
  returns: v.null(),
  handler: async (ctx, { refundId, ok, done, processorRefundId, error, now }) => {
    const r = await loadRefund(ctx, refundId)
    if (r.status !== 'sending') return null
    if (!ok) {
      await ctx.db.patch(r._id, { status: 'failed', error: error ?? 'The processor refused the refund.', processorRefundId: processorRefundId ?? r.processorRefundId, updatedAt: now })
      return null
    }
    if (!done) {
      await ctx.db.patch(r._id, { processorRefundId: processorRefundId ?? r.processorRefundId, updatedAt: now })
      return null
    }
    await ctx.db.patch(r._id, { status: 'sent', processorRefundId: processorRefundId ?? r.processorRefundId, sentAt: now, updatedAt: now })
    await counted(ctx, r, now)
    return null
  },
})

/** Refunded outside the app (in a processor's dashboard, by cheque): counted, with a note. */
export const markManual = mutation({
  args: { refundId: v.string(), by: v.optional(v.string()), note: v.optional(v.string()), now: v.number() },
  returns: v.null(),
  handler: async (ctx, { refundId, by, note, now }) => {
    const r = await loadRefund(ctx, refundId)
    if (r.status !== 'requested' && r.status !== 'approved' && r.status !== 'failed') throw new ConvexError(`This refund is already ${r.status}.`)
    await ctx.db.patch(r._id, { status: 'manual', approvedBy: r.approvedBy ?? by, note: note?.trim() || undefined, sentAt: now, updatedAt: now })
    await counted(ctx, r, now)
    return null
  },
})

export const dismiss = mutation({
  args: { refundId: v.string(), by: v.optional(v.string()), note: v.optional(v.string()), now: v.number() },
  returns: v.null(),
  handler: async (ctx, { refundId, by, note, now }) => {
    const r = await loadRefund(ctx, refundId)
    if (r.status !== 'requested' && r.status !== 'approved' && r.status !== 'failed') throw new ConvexError(`This refund is already ${r.status}.`)
    await ctx.db.patch(r._id, { status: 'dismissed', approvedBy: r.approvedBy ?? by, note: note?.trim() || undefined, updatedAt: now })
    return null
  },
})

/**
 * A refund seen at the processor (webhook, sweep or the nightly comparison). Matches, in order: the
 * row with this processor refund id; the row the library tagged it with (`refundId`, from Stripe
 * metadata or PayPal custom_id); a manual row of the same amount not yet linked. Otherwise a new
 * external row. Returns foreign when no checkout has this payment reference.
 */
export const recordExternal = mutation({
  args: {
    processor,
    paymentRef: v.string(),
    processorRefundId: v.string(),
    amountCents: v.number(),
    state: v.union(v.literal('done'), v.literal('pending'), v.literal('failed')),
    refundId: v.optional(v.string()),
    reason: v.optional(v.string()),
    now: v.number(),
  },
  returns: v.union(v.literal('foreign'), v.literal('recorded'), v.literal('updated'), v.literal('unchanged')),
  handler: async (ctx, a) => {
    const c = await ctx.db
      .query('checkouts')
      .withIndex('by_paymentRef', (q) => q.eq('paymentRef', a.paymentRef))
      .first()
    if (!c || c.processor !== a.processor) return 'foreign'
    const rows = await refundsOf(ctx, c._id)
    const tagged = a.refundId ? ctx.db.normalizeId('refunds', a.refundId) : null
    const match =
      rows.find((r) => r.processorRefundId === a.processorRefundId) ??
      rows.find((r) => r._id === tagged) ??
      rows.find((r) => r.status === 'manual' && !r.processorRefundId && r.amountCents === a.amountCents)
    if (!match) {
      if (a.state === 'failed') return 'unchanged'
      const done = a.state === 'done'
      const id = await ctx.db.insert('refunds', {
        checkoutId: c._id,
        amountCents: a.amountCents,
        reason: a.reason ?? 'Refunded at the processor',
        origin: 'external',
        status: done ? 'sent' : 'sending',
        processorRefundId: a.processorRefundId,
        createdAt: a.now,
        updatedAt: a.now,
        sentAt: done ? a.now : undefined,
      })
      const row = await ctx.db.get(id)
      if (done && row) await counted(ctx, row, a.now)
      return 'recorded'
    }
    if (match.status === 'manual') {
      if (match.processorRefundId) return 'unchanged'
      await ctx.db.patch(match._id, { processorRefundId: a.processorRefundId })
      return 'updated'
    }
    if (match.status === 'sent' && a.state === 'failed') {
      // Stripe can fail a refund after reporting it succeeded (a closed card): undo the count and say so.
      await ctx.db.patch(match._id, { status: 'failed', error: 'The processor reports this refund failed after sending it.', updatedAt: a.now })
      await ctx.db.patch(c._id, { refundedCents: Math.max(0, c.refundedCents - match.amountCents) })
      await openIssue(ctx, {
        kind: 'status_differs',
        key: a.processorRefundId,
        checkoutId: c._id,
        processor: c.processor,
        paymentRef: a.paymentRef,
        detail: `Refund ${a.processorRefundId} of ${dollarsOf(match.amountCents)} failed after it was sent.`,
        now: a.now,
      })
      return 'updated'
    }
    if (match.status === 'sent' || match.status === 'dismissed') return 'unchanged'
    if (a.state === 'pending') {
      if (match.processorRefundId === a.processorRefundId) return 'unchanged'
      await ctx.db.patch(match._id, { processorRefundId: a.processorRefundId, updatedAt: a.now })
      return 'updated'
    }
    if (a.state === 'failed') {
      await ctx.db.patch(match._id, { status: 'failed', processorRefundId: a.processorRefundId, error: 'The processor reports the refund failed.', updatedAt: a.now })
      return 'updated'
    }
    // Done: whatever state it was in (sending, requested, approved, failed), the money went back.
    await ctx.db.patch(match._id, { status: 'sent', processorRefundId: a.processorRefundId, sentAt: a.now, updatedAt: a.now, error: undefined })
    await counted(ctx, match, a.now)
    return 'updated'
  },
})

const OPEN = ['requested', 'approved', 'sending', 'failed'] as const

/** Refunds waiting on someone or something, oldest first. */
export const listOpen = query({
  args: { limit: v.optional(v.number()) },
  returns: v.array(refundView),
  handler: async (ctx, { limit = 200 }) => {
    const out: Doc<'refunds'>[] = []
    for (const status of OPEN) {
      out.push(
        ...(await ctx.db
          .query('refunds')
          .withIndex('by_status', (q) => q.eq('status', status))
          .take(limit)),
      )
    }
    return out.sort((a, b) => a.createdAt - b.createdAt).map(refundViewOf)
  },
})

/** Refunds left sending since before a time, for sweep to ask the processor about. */
export const stuck = query({
  args: { before: v.number(), limit: v.number() },
  returns: v.array(refundView),
  handler: async (ctx, { before, limit }) => {
    const rows = await ctx.db
      .query('refunds')
      .withIndex('by_status', (q) => q.eq('status', 'sending').lt('updatedAt', before))
      .take(limit)
    return rows.map(refundViewOf)
  },
})

export const forCheckout = query({
  args: { checkoutId: v.string() },
  returns: v.array(refundView),
  handler: async (ctx, { checkoutId }) => {
    const nid = ctx.db.normalizeId('checkouts', checkoutId)
    if (!nid) return []
    const rows = await ctx.db
      .query('refunds')
      .withIndex('by_checkout', (q) => q.eq('checkoutId', nid))
      .collect()
    return rows.map(refundViewOf)
  },
})

export const get = query({
  args: { refundId: v.string() },
  returns: v.union(refundView, v.null()),
  handler: async (ctx, { refundId }) => {
    const nid = ctx.db.normalizeId('refunds', refundId)
    const r = nid ? await ctx.db.get(nid) : null
    return r ? refundViewOf(r) : null
  },
})

/** Refunds recorded since a time, for the nightly comparison. */
export const createdSince = query({
  args: { since: v.number(), limit: v.number() },
  returns: v.array(refundView),
  handler: async (ctx, { since, limit }) => {
    const rows = await ctx.db
      .query('refunds')
      .withIndex('by_creation_time', (q) => q.gte('_creationTime', since))
      .take(limit)
    return rows.map(refundViewOf)
  },
})
