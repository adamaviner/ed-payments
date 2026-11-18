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

  /** A bid charged with a saved card when the auction ends; the app keeps the bid's own states. */
  bids: defineTable({
    userId: v.string(),
    itemId: v.string(),
    amountCents: v.number(),
    paymentMethodId: v.string(),
    status: v.union(v.literal('placed'), v.literal('charging'), v.literal('processing'), v.literal('paid'), v.literal('payment_failed')),
    /** The library's checkout for the charge, for the retry page. */
    checkoutId: v.optional(v.string()),
  }),

  /** Who may use the admin page (a real app uses its own login). */
  admins: defineTable({ tokenIdentifier: v.string(), name: v.string() }).index('by_tokenIdentifier', ['tokenIdentifier']),
})
