// A small host app for the library's own tests: an orders table its onPaid writes, a log of every
// callback, the Payments instance, and the functions and routes a host exports.
import { createFunctionHandle, defineSchema, defineTable, httpRouter } from 'convex/server'
import { v } from 'convex/values'
import { defineTestApp } from 'convex-test'
import { Payments, disputeArgs, failedArgs, paidArgs, paidReturns, refundNeededArgs, refundedArgs, type Paid } from '../client/index.js'
import { PAYPAL_SANDBOX_API } from '../core/paypal.js'
import paymentsTest from '../test.js'
import { FAKE_STRIPE_WEBHOOK_SECRET } from './fakeStripe.js'

export const app = defineTestApp({
  schema: defineSchema({
    orders: defineTable({ checkoutId: v.string(), paymentRef: v.string(), paidCents: v.number() }),
    /** Every callback the component made, in order, and Stripe events passed on to the host. */
    calls: defineTable({ name: v.string(), args: v.any() }),
  }),
  components: { payments: paymentsTest },
})

/** What the host's onPaid does, from the checkout's context: record the order, refuse, or throw after writing. */
export type PaidBehaviour = { refuse?: string; throwAfterWrite?: string }

export const payments: Payments = new Payments(app.components.payments, {
  app: 'test',
  siteUrl: () => 'https://app.example.org/',
  stripe: () => ({ secretKey: 'sk_test_fake', webhookSecret: FAKE_STRIPE_WEBHOOK_SECRET }),
  paypal: () => ({ clientId: 'fake-client', clientSecret: 'fake-secret', webhookId: 'WH-FAKE', apiBase: PAYPAL_SANDBOX_API }),
  fees: { paypal: { card: { basisPoints: 199, fixedCents: 49, capCents: null } } },
  limits: { perKey: 3, windowMinutes: 10, globalPerMinute: 5 },
  brandName: 'Test shop',
})

const http = httpRouter()
payments.registerRoutes(http, {
  onUnhandledStripeEvent: async (ctx, event) => {
    await ctx.runMutation(defined.internal.host.unhandled, { type: event.type, id: event.data.object.id })
  },
})

const startArgs = {
  processor: v.union(v.literal('stripe'), v.literal('paypal')),
  method: v.union(v.literal('card'), v.literal('ach'), v.literal('paypal')),
  amountCents: v.optional(v.number()),
  email: v.optional(v.string()),
  context: v.optional(v.any()),
  expiresAt: v.optional(v.number()),
}

export const defined = app.defineModules({
  http: { default: http },
  host: {
    paid: app.internalMutation({
      args: paidArgs,
      returns: paidReturns,
      handler: async (ctx, a: Paid) => {
        await ctx.db.insert('calls', { name: 'onPaid', args: a })
        const b = (a.context as { paid?: PaidBehaviour } | null)?.paid ?? {}
        if (b.refuse) return { refuse: b.refuse }
        await ctx.db.insert('orders', { checkoutId: a.checkoutId, paymentRef: a.paymentRef, paidCents: a.paidCents })
        if (b.throwAfterWrite) throw new Error(b.throwAfterWrite)
        return null
      },
    }),
    failed: app.internalMutation({ args: failedArgs, handler: async (ctx, a) => void (await ctx.db.insert('calls', { name: 'onFailed', args: a })) }),
    refunded: app.internalMutation({ args: refundedArgs, handler: async (ctx, a) => void (await ctx.db.insert('calls', { name: 'onRefunded', args: a })) }),
    refundNeeded: app.internalMutation({ args: refundNeededArgs, handler: async (ctx, a) => void (await ctx.db.insert('calls', { name: 'onRefundNeeded', args: a })) }),
    dispute: app.internalMutation({
      args: disputeArgs,
      handler: async (ctx, a) => {
        if ((a.context as { disputeThrows?: boolean } | null)?.disputeThrows) throw new Error('the dispute handler broke')
        await ctx.db.insert('calls', { name: 'onDispute', args: a })
      },
    }),
    unhandled: app.internalMutation({ args: { type: v.string(), id: v.string() }, handler: async (ctx, a) => void (await ctx.db.insert('calls', { name: 'unhandledStripe', args: a })) }),
    calls: app.query({ args: {}, handler: async (ctx) => (await ctx.db.query('calls').collect()).map((c) => ({ name: c.name, args: c.args as Record<string, unknown> })) }),
    orders: app.query({ args: {}, handler: async (ctx) => await ctx.db.query('orders').collect() }),
    /** Makes a checkout row with every callback, without asking a processor (the component's own tests). */
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
  shop: {
    /** What a host's checkout action does. */
    buy: app.action({
      args: startArgs,
      handler: async (ctx, a): Promise<{ checkoutId: string; redirectUrl: string }> =>
        await payments.start(ctx, {
          ref: { type: 'offering', id: 'o1' },
          purpose: 'order',
          description: 'A bowl',
          amountCents: a.amountCents ?? 2500,
          processor: a.processor,
          method: a.method,
          payer: { name: 'Ana', email: a.email ?? 'ana@example.org' },
          returnPath: '/checkout/o1/return',
          cancelPath: '/checkout/o1',
          expiresAt: a.expiresAt,
          limitKey: a.email ?? 'ana@example.org',
          context: a.context,
          onPaid: defined.internal.host.paid,
          onFailed: defined.internal.host.failed,
          onRefunded: defined.internal.host.refunded,
          onRefundNeeded: defined.internal.host.refundNeeded,
          onDispute: defined.internal.host.dispute,
        }),
    }),
    back: app.action({
      args: { processor: v.union(v.literal('stripe'), v.literal('paypal')), token: v.string() },
      handler: async (ctx, a): Promise<{ checkoutId: string; status: string } | null> => {
        const res = await payments.completeReturn(ctx, a)
        return res && { checkoutId: res.checkoutId, status: res.status }
      },
    }),
    status: app.query({ args: { id: v.string() }, handler: async (ctx, { id }) => await payments.status(ctx, id) }),
    requestRefund: app.mutation({
      args: { checkoutId: v.string(), amountCents: v.optional(v.number()), reason: v.string() },
      handler: async (ctx, a): Promise<string> => await payments.requestRefund(ctx, { ...a, by: 'admin' }),
    }),
    approveRefund: app.mutation({ args: { refundId: v.string() }, handler: async (ctx, { refundId }) => await payments.approveRefund(ctx, { refundId, by: 'boss' }) }),
    sendRefund: app.action({
      args: { refundId: v.string(), skipApproval: v.optional(v.boolean()) },
      handler: async (ctx, { refundId, skipApproval }): Promise<string | null> => (await payments.sendRefund(ctx, refundId, { skipApproval, by: 'admin' }))?.status ?? null,
    }),
    openRefunds: app.query({ args: {}, handler: async (ctx) => await payments.openRefunds(ctx) }),
    refundsFor: app.query({ args: { checkoutId: v.string() }, handler: async (ctx, { checkoutId }) => await payments.refundsFor(ctx, checkoutId) }),
    issues: app.query({ args: {}, handler: async (ctx) => await payments.unreportedIssues(ctx) }),
  },
  paymentsWorker: payments.worker(),
})
