// A buyer disputed a payment with their bank or PayPal. Each dispute is a row (open, won or lost), a
// `dispute` issue while it is open, `disputed` on the checkout while any is open, and the host's
// onDispute. Refunds wait while one is open (refunds.ts), and a lost one's amount is off what is left.
import { v } from 'convex/values'
import { mutation } from './_generated/server.js'
import { notifyHost, openIssue, resolveIssue } from './lib.js'
import { processor } from './schema.js'

export const record = mutation({
  args: {
    processor,
    paymentRef: v.string(),
    disputeId: v.string(),
    status: v.union(v.literal('opened'), v.literal('closed')),
    /** How it ended, in the processor's words (won, lost, RESOLVED_SELLER_FAVOUR...). */
    outcome: v.optional(v.string()),
    /** Closed in the buyer's favour: the money went back to them. */
    lost: v.optional(v.boolean()),
    reason: v.optional(v.string()),
    amountCents: v.optional(v.number()),
    now: v.number(),
  },
  returns: v.union(v.literal('foreign'), v.literal('recorded')),
  handler: async (ctx, a) => {
    const c = await ctx.db
      .query('checkouts')
      .withIndex('by_paymentRef', (q) => q.eq('paymentRef', a.paymentRef))
      .first()
    if (!c || c.processor !== a.processor) return 'foreign'
    const row = await ctx.db
      .query('disputes')
      .withIndex('by_disputeId', (q) => q.eq('processor', a.processor).eq('disputeId', a.disputeId))
      .first()
    const status = a.status === 'opened' ? ('open' as const) : a.lost ? ('lost' as const) : ('won' as const)
    // A late "opened" for a dispute already closed (webhooks out of order) changes nothing.
    if (!row) {
      await ctx.db.insert('disputes', {
        checkoutId: c._id,
        processor: a.processor,
        disputeId: a.disputeId,
        status,
        amountCents: a.amountCents,
        outcome: a.outcome,
        openedAt: a.now,
        ...(status === 'open' ? {} : { closedAt: a.now }),
      })
    } else if (status !== 'open') {
      await ctx.db.patch(row._id, { status, outcome: a.outcome ?? row.outcome, amountCents: a.amountCents ?? row.amountCents, closedAt: a.now })
    }
    const all = await ctx.db
      .query('disputes')
      .withIndex('by_checkout', (q) => q.eq('checkoutId', c._id))
      .collect()
    const disputed = all.some((d) => d.status === 'open')
    await ctx.db.patch(c._id, { disputed })
    const amount = a.amountCents === undefined ? '' : ` for $${(a.amountCents / 100).toFixed(2)}`
    if (a.status === 'opened') {
      await openIssue(ctx, {
        kind: 'dispute',
        key: a.disputeId,
        checkoutId: c._id,
        processor: c.processor,
        paymentRef: a.paymentRef,
        detail: `The buyer disputed ${c.description}${amount}${a.reason ? ` (${a.reason})` : ''}.`,
        now: a.now,
      })
    } else {
      await resolveIssue(ctx, a.disputeId, 'dispute', a.now)
    }
    await notifyHost(
      ctx,
      { ...c, disputed },
      'onDispute',
      { paymentRef: a.paymentRef, disputeId: a.disputeId, status: a.status, outcome: a.outcome ?? null, reason: a.reason ?? null, amountCents: a.amountCents ?? null },
      a.now,
    )
    return 'recorded'
  },
})
