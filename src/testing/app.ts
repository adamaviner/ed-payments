// A small host app for the library's own tests: an orders table its paid callback writes, a log of
// every callback, the payments instance, and the functions and routes a host exports.
import { createFunctionHandle, cronJobs, defineSchema, defineTable, httpRouter } from 'convex/server'
import { v } from 'convex/values'
import { defineTestApp } from 'convex-test'
import { definePayments, paidReturns, type PaymentsWiring, type StartedEmbedded } from '../client/index.js'
import { PAYPAL_SANDBOX_API } from '../core/paypal.js'
import paymentsTest from '../test.js'
import { FAKE_STRIPE_WEBHOOK_SECRET } from './fakeStripe.js'

export const app = defineTestApp({
  schema: defineSchema({
    orders: defineTable({ checkoutId: v.string(), paymentRef: v.string(), paidCents: v.number() }),
    /** Every callback the component made, in order, and Stripe events passed on to the host. */
    calls: defineTable({ name: v.string(), args: v.any() }),
    admins: defineTable({ token: v.string(), name: v.string() }),
  }),
  components: { payments: paymentsTest },
})

/** What the host's paid callback does: record the order, refuse, or throw after writing. */
export const paidBehaviour = v.object({ refuse: v.optional(v.string()), throwAfterWrite: v.optional(v.string()) })

/** The test app's context: everything optional, so a test passes only what it is about. */
export const context = v.object({
  buyer: v.optional(v.string()),
  paid: v.optional(paidBehaviour),
  disputeThrows: v.optional(v.boolean()),
  bidId: v.optional(v.string()),
})

type Ctx = (typeof context)['type']

// The test app's modules only exist after defineModules, so the references are read when used.
const wiring: PaymentsWiring<Ctx> = {
  get on() {
    const h = defined.internal.host
    return { paid: h.paid, failed: h.failed, refunded: h.refunded, refundNeeded: h.refundNeeded, dispute: h.dispute, processing: h.processing, issues: h.issues }
  },
  get authorize() {
    return { admin: defined.internal.host.isAdmin }
  },
  get worker() {
    return defined.internal.paymentsWorker
  },
}

export const payments = definePayments(app.components.payments, {
  app: 'test',
  context,
  siteUrl: () => 'https://app.example.org/',
  stripe: () => ({ secretKey: 'sk_test_fake', webhookSecret: FAKE_STRIPE_WEBHOOK_SECRET }),
  paypal: () => ({ clientId: 'fake-client', clientSecret: 'fake-secret', webhookId: 'WH-FAKE', apiBase: PAYPAL_SANDBOX_API }),
  fees: { paypal: { card: { basisPoints: 199, fixedCents: 49, capCents: null } } },
  limits: { perKey: 3, windowMinutes: 10, globalPerMinute: 5 },
  brandName: 'Test shop',
}).withCallbacks(wiring)

const http = httpRouter()
payments.registerRoutes(http, {
  onUnhandledStripeEvent: async (ctx, event) => {
    await ctx.runMutation(defined.internal.host.unhandled, { type: event.type, id: event.data.object.id })
  },
})

/** Records a callback the component made. */
const record = async (ctx: { db: { insert: (table: 'calls', doc: { name: string; args: unknown }) => Promise<unknown> } }, name: string, args: unknown) =>
  void (await ctx.db.insert('calls', { name, args }))

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
      args: payments.args.paid,
      returns: paidReturns,
      handler: async (ctx, a) => {
        await ctx.db.insert('calls', { name: 'onPaid', args: a })
        const b = a.context?.paid ?? {}
        if (b.refuse) return { refuse: b.refuse }
        await ctx.db.insert('orders', { checkoutId: a.checkoutId, paymentRef: a.paymentRef, paidCents: a.paidCents })
        if (b.throwAfterWrite) throw new Error(b.throwAfterWrite)
        return null
      },
    }),
    failed: app.internalMutation({ args: payments.args.failed, handler: async (ctx, a) => await record(ctx, 'onFailed', a) }),
    refunded: app.internalMutation({ args: payments.args.refunded, handler: async (ctx, a) => await record(ctx, 'onRefunded', a) }),
    refundNeeded: app.internalMutation({ args: payments.args.refundNeeded, handler: async (ctx, a) => await record(ctx, 'onRefundNeeded', a) }),
    processing: app.internalMutation({ args: payments.args.processing, handler: async (ctx, a) => await record(ctx, 'onProcessing', a) }),
    issues: app.internalMutation({ args: payments.args.issues, handler: async (ctx, a) => await record(ctx, 'onIssues', a) }),
    dispute: app.internalMutation({
      args: payments.args.dispute,
      handler: async (ctx, a) => {
        if (a.context?.disputeThrows) throw new Error('the dispute handler broke')
        await ctx.db.insert('calls', { name: 'onDispute', args: a })
      },
    }),
    /** The app's own check: an admin is whoever holds a token in the admins table. */
    isAdmin: app.internalQuery({
      args: { auth: v.optional(v.any()) },
      handler: async (ctx, { auth }) => {
        // An app on Convex auth: the caller's identity carries into this query.
        const me = await ctx.auth.getUserIdentity()
        const token = typeof auth === 'string' ? auth : me ? `user:${me.subject}` : null
        const row = token ? (await ctx.db.query('admins').collect()).find((x) => x.token === token) : undefined
        return row ? { name: row.name } : null
      },
    }),
    unhandled: app.internalMutation({ args: { type: v.string(), id: v.string() }, handler: async (ctx, a) => void (await ctx.db.insert('calls', { name: 'unhandledStripe', args: a })) }),
    calls: app.query({ args: {}, handler: async (ctx) => (await ctx.db.query('calls').collect()).map((c) => ({ name: c.name, args: c.args as Record<string, unknown> })) }),
    orders: app.query({ args: {}, handler: async (ctx) => await ctx.db.query('orders').collect() }),
    addAdmin: app.mutation({ args: { token: v.string(), name: v.string() }, handler: async (ctx, a) => void (await ctx.db.insert('admins', a)) }),
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
          context: a.context ?? {},
          callbacks: await payments.handles(),
          limits: [
            { key: 'global', max: 5, windowMs: 60_000, message: 'Too many checkouts are being started right now. Try again in a minute.' },
            ...(a.limitKey ? [{ key: `key:${a.limitKey.trim().toLowerCase()}`, max: 3, windowMs: 10 * 60_000, message: 'Too many checkouts were started for you just now.' }] : []),
          ],
          now: a.now,
        }),
    }),
    handle: app.mutation({ args: {}, handler: async (): Promise<string> => await createFunctionHandle(defined.internal.host.paid) }),
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
          context: a.context ?? {},
        }),
    }),
    /** The same, shown on the host's own page (PaypalButtons / StripeEmbeddedCheckout). */
    buyEmbedded: app.action({
      args: startArgs,
      handler: async (ctx, a): Promise<StartedEmbedded> =>
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
          context: a.context ?? {},
          ui: 'embedded',
        }),
    }),
    back: app.action({
      args: { processor: v.union(v.literal('stripe'), v.literal('paypal')), token: v.string() },
      handler: async (ctx, a): Promise<{ checkoutId: string; status: string; declined?: true } | null> => {
        const res = await payments.completeReturn(ctx, a)
        return res && { checkoutId: res.checkoutId, status: res.status, ...(res.declined ? { declined: res.declined } : {}) }
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
    issues: app.query({ args: {}, handler: async (ctx) => await ctx.runQuery(app.components.payments.issues.unreported, {}) }),
  },
  /** Saved methods, the way ed-market's bids use them. */
  bids: {
    setup: app.action({
      args: { user: v.string(), email: v.string() },
      handler: async (ctx, a): Promise<{ clientSecret: string; stripeCustomerId: string }> =>
        await payments.setupPaymentMethod(ctx, { owner: { type: 'user', id: a.user }, payer: { email: a.email } }),
    }),
    methods: app.action({
      args: { user: v.string(), stripeCustomerId: v.optional(v.string()) },
      handler: async (ctx, a) => await payments.savedMethods(ctx, { owner: { type: 'user', id: a.user }, stripeCustomerId: a.stripeCustomerId }),
    }),
    verify: app.action({
      args: { user: v.string(), paymentMethodId: v.string() },
      handler: async (ctx, a) => await payments.verifyMethodOwner(ctx, { owner: { type: 'user', id: a.user }, paymentMethodId: a.paymentMethodId }),
    }),
    charge: app.mutation({
      args: { user: v.string(), bidId: v.string(), paymentMethodId: v.string(), amountCents: v.optional(v.number()), key: v.optional(v.string()) },
      handler: async (ctx, a): Promise<string> =>
        await payments.chargeSaved(ctx, {
          ref: { type: 'bid', id: a.bidId },
          purpose: 'bid',
          description: 'Winning bid',
          amountCents: a.amountCents ?? 5000,
          payer: { email: 'ana@example.org' },
          owner: { type: 'user', id: a.user },
          paymentMethodId: a.paymentMethodId,
          idempotencyKey: a.key ?? `bid-${a.bidId}`,
          context: { bidId: a.bidId },
        }),
    }),
    retry: app.action({
      args: { checkoutId: v.string() },
      handler: async (ctx, a): Promise<{ checkoutId: string; clientSecret: string }> => await payments.retryOnSession(ctx, a),
    }),
    retryPaypal: app.action({
      args: { checkoutId: v.string() },
      handler: async (ctx, a) => await payments.retryWithPaypal(ctx, { checkoutId: a.checkoutId, returnPath: '/bids/paid' }),
    }),
    paypalSetup: app.action({
      args: { user: v.string(), kind: v.union(v.literal('card'), v.literal('paypal')) },
      handler: async (ctx, a): Promise<{ setupTokenId: string; clientId: string }> =>
        await payments.setupPaypalMethod(ctx, { owner: { type: 'user', id: a.user }, payer: { email: `${a.user}@example.org` }, kind: a.kind }),
    }),
    paypalSave: app.action({
      args: { user: v.string(), setupTokenId: v.string() },
      handler: async (ctx, a) => await payments.savePaypalMethod(ctx, { owner: { type: 'user', id: a.user }, setupTokenId: a.setupTokenId }),
    }),
    remove: app.action({
      args: { user: v.string(), paymentMethodId: v.string() },
      handler: async (ctx, a): Promise<null> => {
        await payments.removeSavedMethod(ctx, { owner: { type: 'user', id: a.user }, paymentMethodId: a.paymentMethodId })
        return null
      },
    }),
    cardProcessor: app.query({ args: { amountCents: v.number() }, handler: async (_ctx, a) => payments.cardProcessorFor(a.amountCents) }),
  },
  payments: { ...payments.adminApi({ skipApproval: true }), ...payments.publicApi() },
  paymentsWorker: payments.worker(),
})

/** The library's crons, as an app registers them (checked in the tests; convex-test doesn't run crons). */
export const crons = cronJobs()
payments.registerCrons(crons)
