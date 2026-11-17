// A buyer disputed a payment with their bank or PayPal. Recorded as a `dispute` issue (open while the
// dispute is), `disputed` on the checkout, and the host's onDispute.
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
    const amount = a.amountCents === undefined ? '' : ` for $${(a.amountCents / 100).toFixed(2)}`
    if (a.status === 'opened') {
      await ctx.db.patch(c._id, { disputed: true })
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
      { ...c, disputed: true },
      'onDispute',
      { paymentRef: a.paymentRef, disputeId: a.disputeId, status: a.status, outcome: a.outcome ?? null, reason: a.reason ?? null, amountCents: a.amountCents ?? null },
      a.now,
    )
    return 'recorded'
  },
})
