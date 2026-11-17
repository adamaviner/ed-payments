import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

export default defineSchema({
  /** The app's own record of a sale, written by onPaid in the same transaction as the payment. */
  orders: defineTable({
    checkoutId: v.string(),
    itemId: v.string(),
    paymentRef: v.string(),
    amountCents: v.number(),
    buyerEmail: v.string(),
    status: v.union(v.literal('paid'), v.literal('refunded')),
  })
    .index('by_checkoutId', ['checkoutId'])
    .index('by_itemId', ['itemId']),
})
