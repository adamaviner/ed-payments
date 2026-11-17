// A small host app for the library's own tests: an orders table the host's onPaid writes, a log of
// every callback, and the functions a host exports.
import { createFunctionHandle, defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'
import { defineTestApp } from 'convex-test'
import paymentsTest from '../test.js'

export const app = defineTestApp({
  schema: defineSchema({
    orders: defineTable({ checkoutId: v.string(), paymentRef: v.string(), paidCents: v.number() }),
    /** Every callback the component made, in order. */
    calls: defineTable({ name: v.string(), args: v.any() }),
  }),
  components: { payments: paymentsTest },
})

/** What the host's onPaid does, from the checkout's context: record the order, refuse, or throw after writing. */
export type PaidBehaviour = { refuse?: string; throwAfterWrite?: string }

export const defined = app.defineModules({
  host: {
    /** onPaid with the library's argument shape. */
    paid: app.internalMutation({
      args: v.any(),
      handler: async (ctx, a: { checkoutId: string; paymentRef: string; paidCents: number; context: { paid?: PaidBehaviour } | null }): Promise<{ refuse: string } | null> => {
        await ctx.db.insert('calls', { name: 'onPaid', args: a })
        const b = a.context?.paid ?? {}
        if (b.refuse) return { refuse: b.refuse }
        await ctx.db.insert('orders', { checkoutId: a.checkoutId, paymentRef: a.paymentRef, paidCents: a.paidCents })
        if (b.throwAfterWrite) throw new Error(b.throwAfterWrite)
        return null
      },
    }),
    failed: app.internalMutation({ args: v.any(), handler: async (ctx, a) => void (await ctx.db.insert('calls', { name: 'onFailed', args: a })) }),
    refunded: app.internalMutation({ args: v.any(), handler: async (ctx, a) => void (await ctx.db.insert('calls', { name: 'onRefunded', args: a })) }),
    refundNeeded: app.internalMutation({ args: v.any(), handler: async (ctx, a) => void (await ctx.db.insert('calls', { name: 'onRefundNeeded', args: a })) }),
    dispute: app.internalMutation({
      args: v.any(),
      handler: async (ctx, a: { context: { disputeThrows?: boolean } | null }) => {
        if (a.context?.disputeThrows) throw new Error('the dispute handler broke')
        await ctx.db.insert('calls', { name: 'onDispute', args: a })
      },
    }),
    calls: app.query({ args: {}, handler: async (ctx) => (await ctx.db.query('calls').collect()).map((c) => ({ name: c.name, args: c.args as Record<string, unknown> })) }),
    orders: app.query({ args: {}, handler: async (ctx) => await ctx.db.query('orders').collect() }),
    /** Makes a checkout row the way the client's start does, with every callback. */
    create: app.mutation({
      args: {
        amountCents: v.optional(v.number()),
        processor: v.optional(v.union(v.literal('stripe'), v.literal('paypal'))),
        context: v.optional(v.any()),
        limitKey: v.optional(v.string()),
        now: v.number(),
      },
      handler: async (ctx, a): Promise<string> =>
        await ctx.runMutation(app.components.payments.checkouts.create, {
          app: 'test',
          ref: { type: 'offering', id: 'o1' },
          purpose: 'order',
          description: 'A bowl',
          amountCents: a.amountCents ?? 2500,
          processor: a.processor ?? 'stripe',
          method: 'card',
          payer: { name: 'Ana', email: 'ana@example.org' },
          returnUrl: 'https://app.example.org/back',
          cancelUrl: 'https://app.example.org/cancel',
          expiresAt: a.now + 60 * 60_000,
          context: a.context,
          callbacks: {
            onPaid: await createFunctionHandle(defined.internal.host.paid),
            onFailed: await createFunctionHandle(defined.internal.host.failed),
            onRefunded: await createFunctionHandle(defined.internal.host.refunded),
            onRefundNeeded: await createFunctionHandle(defined.internal.host.refundNeeded),
            onDispute: await createFunctionHandle(defined.internal.host.dispute),
          },
          limit: { key: a.limitKey, perKey: 3, windowMs: 10 * 60_000, globalPerMinute: 5 },
          now: a.now,
        }),
    }),
  },
})
