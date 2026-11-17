// A minimal shop: one action starts a checkout, onPaid records the order in the same transaction
// (or refuses an item that sold meanwhile), the return page settles, admins refund.
import { paidArgs, paidReturns, refundedArgs, type PaidResult } from '@earthdance/payments'
import { v } from 'convex/values'
import { internal } from './_generated/api.js'
import { action, internalMutation, mutation, query } from './_generated/server.js'
import { payments } from './payments.js'

export const buy = action({
  args: { itemId: v.string(), email: v.string(), card: v.boolean() },
  handler: async (ctx, { itemId, email, card }): Promise<{ redirectUrl: string }> => {
    const { redirectUrl } = await payments.start(ctx, {
      ref: { type: 'item', id: itemId },
      purpose: 'order',
      description: `Item ${itemId}`,
      amountCents: 2500,
      processor: card ? 'paypal' : 'stripe',
      method: card ? 'card' : 'ach',
      payer: { email },
      returnPath: `/items/${itemId}/thanks`,
      cancelPath: `/items/${itemId}`,
      limitKey: email,
      context: { itemId },
      onPaid: internal.shop.onPaid,
      onRefunded: internal.shop.onRefunded,
    })
    return { redirectUrl }
  },
})

export const onPaid = internalMutation({
  args: paidArgs,
  returns: paidReturns,
  handler: async (ctx, a): Promise<PaidResult> => {
    const { itemId } = a.context as { itemId: string }
    const sold = await ctx.db
      .query('orders')
      .withIndex('by_itemId', (q) => q.eq('itemId', itemId))
      .first()
    if (sold) return { refuse: 'That item sold while you were paying.' }
    await ctx.db.insert('orders', { checkoutId: a.checkoutId, itemId, paymentRef: a.paymentRef, amountCents: a.paidCents, buyerEmail: a.payer.email, status: 'paid' })
    return null
  },
})

export const onRefunded = internalMutation({
  args: refundedArgs,
  handler: async (ctx, a) => {
    const order = await ctx.db
      .query('orders')
      .withIndex('by_checkoutId', (q) => q.eq('checkoutId', a.checkoutId))
      .first()
    if (order && a.refundedCents >= a.paidCents) await ctx.db.patch(order._id, { status: 'refunded' })
  },
})

/** The page PayPal (token) or Stripe (session_id) sends the buyer back to. */
export const back = action({
  args: { processor: v.union(v.literal('stripe'), v.literal('paypal')), token: v.string() },
  handler: async (ctx, a): Promise<string | null> => (await payments.completeReturn(ctx, a))?.status ?? null,
})

// A real app checks its own login before these. This example lets nobody in.
const nobody = () => {
  throw new Error('Not allowed')
}

export const openRefunds = query({
  args: {},
  handler: async (ctx) => {
    nobody()
    return await payments.openRefunds(ctx)
  },
})

export const refund = mutation({
  args: { checkoutId: v.string(), amountCents: v.optional(v.number()) },
  handler: async (ctx, a): Promise<string> => {
    nobody()
    return await payments.requestRefund(ctx, { ...a, reason: 'Asked by the buyer', by: 'admin' })
  },
})

export const sendRefund = action({
  args: { refundId: v.string() },
  handler: async (ctx, { refundId }): Promise<string | null> => {
    nobody()
    return (await payments.sendRefund(ctx, refundId, { skipApproval: true, by: 'admin' }))?.status ?? null
  },
})
