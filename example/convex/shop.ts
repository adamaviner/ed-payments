// A small shop: an item bought through Stripe Checkout or PayPal, and a bid charged later with a saved
// card. The app prices on the server, keeps its own records (orders, bids) and is told what happened
// through the callbacks below, each run inside the transaction that records the payment.
import { paidReturns, type PaidResult, type StartedEmbedded } from '@earthdance/payments'
import { ConvexError, v } from 'convex/values'
import { internal } from './_generated/api.js'
import { action, internalMutation, internalQuery, mutation, query, type MutationCtx } from './_generated/server.js'
import { payments } from './payments.js'

const PRICE_CENTS = 2500

/** Buying an item: priced here, never taken from the browser. */
export const buy = action({
  args: { itemId: v.string(), email: v.string(), card: v.boolean() },
  handler: async (ctx, { itemId, email, card }): Promise<{ redirectUrl: string }> => {
    const { redirectUrl } = await payments.start(ctx, {
      ref: { type: 'item', id: itemId },
      purpose: 'order',
      description: `Item ${itemId}`,
      amountCents: PRICE_CENTS,
      processor: card ? 'paypal' : 'stripe',
      method: card ? 'card' : 'ach',
      payer: { email },
      returnPath: `/items/${itemId}/thanks`,
      cancelPath: `/items/${itemId}`,
      context: { itemId },
    })
    return { redirectUrl }
  },
})

/**
 * The same purchase paid on the app's own page (src/EmbeddedCheckout.tsx): PayPal's buttons for a card,
 * Stripe's embedded Checkout for a bank account. The browser gets what it needs to show them.
 */
export const buyHere = action({
  args: { itemId: v.string(), email: v.string(), card: v.boolean() },
  handler: async (ctx, { itemId, email, card }): Promise<StartedEmbedded> =>
    await payments.start(ctx, {
      ref: { type: 'item', id: itemId },
      purpose: 'order',
      description: `Item ${itemId}`,
      amountCents: PRICE_CENTS,
      processor: card ? 'paypal' : 'stripe',
      method: card ? 'card' : 'ach',
      payer: { email },
      returnPath: `/items/${itemId}/thanks`,
      cancelPath: `/items/${itemId}`,
      context: { itemId },
      ui: 'embedded',
    }),
})

// ── Bids: a card saved now, charged when the auction ends ─────────────────────────────────────

async function signedIn(ctx: { auth: { getUserIdentity(): Promise<{ subject: string; email?: string } | null> } }) {
  const me = await ctx.auth.getUserIdentity()
  if (!me) throw new ConvexError('Sign in to bid.')
  return me
}

/** The bid form: the bidder's saved card (one not declined before), or null for the form to save one. */
export const bidPaymentMethod = action({
  args: {},
  handler: async (ctx): Promise<{ paymentMethodId: string; label: string } | null> => {
    const me = await signedIn(ctx)
    const saved = (await payments.savedMethods(ctx, { owner: { type: 'user', id: me.subject } })).find((m) => !m.declined)
    return saved ? { paymentMethodId: saved.paymentMethodId, label: saved.label } : null
  },
})

/**
 * StripeSaveMethod's createSetupIntent: a SetupIntent for the methods the form shows, made only when
 * the bidder presses the button (setupPaymentMethod is rate-limited; opening the form makes nothing).
 */
export const stripeSetupIntent = action({
  args: { methods: v.array(v.union(v.literal('card'), v.literal('ach'))) },
  handler: async (ctx, { methods }): Promise<string> => {
    const me = await signedIn(ctx)
    return (await payments.setupPaymentMethod(ctx, { owner: { type: 'user', id: me.subject }, payer: { email: me.email ?? '' }, methods })).clientSecret
  },
})

/**
 * Saving a card in PayPal's vault instead, when PayPal is cheaper for this bid (cardProcessorFor):
 * a setup token for PaypalCardFields (kind 'card') or PaypalSaveButton (kind 'paypal').
 */
export const paypalSetupToken = action({
  args: { kind: v.union(v.literal('card'), v.literal('paypal')) },
  handler: async (ctx, { kind }): Promise<{ setupTokenId: string; clientId: string }> => {
    const me = await signedIn(ctx)
    return await payments.setupPaypalMethod(ctx, { owner: { type: 'user', id: me.subject }, payer: { email: me.email ?? '' }, kind, description: 'Bids you win at the example auction' })
  },
})

/** The bid form's choice for a bid of this amount: where a new card goes. */
export const cardProcessor = query({
  args: { amountCents: v.number() },
  handler: async (_ctx, { amountCents }) => payments.cardProcessorFor(amountCents),
})

/** PayPal approved the setup token: save it, then place the bid with it. */
export const placeBidWithPaypal = action({
  args: { itemId: v.string(), amountCents: v.number(), setupTokenId: v.string() },
  handler: async (ctx, a): Promise<null> => {
    const me = await signedIn(ctx)
    const method = await payments.savePaypalMethod(ctx, { owner: { type: 'user', id: me.subject }, setupTokenId: a.setupTokenId, payerEmail: me.email })
    await ctx.runMutation(internal.shop.recordBid, { userId: me.subject, itemId: a.itemId, amountCents: a.amountCents, paymentMethodId: method.paymentMethodId })
    return null
  },
})

/** The bidder removes a saved card or account (the app first checks no open bid relies on it). */
export const removeMethod = action({
  args: { paymentMethodId: v.string() },
  handler: async (ctx, { paymentMethodId }): Promise<null> => {
    const me = await signedIn(ctx)
    await payments.removeSavedMethod(ctx, { owner: { type: 'user', id: me.subject }, paymentMethodId })
    return null
  },
})

/** Places a bid with a method checked to be the bidder's own. */
export const placeBid = action({
  args: { itemId: v.string(), amountCents: v.number(), paymentMethodId: v.string() },
  handler: async (ctx, a): Promise<null> => {
    const me = await signedIn(ctx)
    const method = await payments.verifyMethodOwner(ctx, { owner: { type: 'user', id: me.subject }, paymentMethodId: a.paymentMethodId })
    await ctx.runMutation(internal.shop.recordBid, { userId: me.subject, itemId: a.itemId, amountCents: a.amountCents, paymentMethodId: method.paymentMethodId })
    return null
  },
})

export const recordBid = internalMutation({
  args: { userId: v.string(), itemId: v.string(), amountCents: v.number(), paymentMethodId: v.string() },
  handler: async (ctx, a) => {
    if (!Number.isInteger(a.amountCents) || a.amountCents < 100) throw new ConvexError('Bid at least a dollar.')
    await ctx.db.insert('bids', { ...a, status: 'placed' })
  },
})

/** When the auction ends: charge the winning bid with nobody present (the library queues and retries it). */
export const chargeWinner = internalMutation({
  args: { bidId: v.id('bids') },
  handler: async (ctx, { bidId }) => {
    const bid = await ctx.db.get(bidId)
    if (bid?.status !== 'placed') return
    const checkoutId = await payments.chargeSaved(ctx, {
      ref: { type: 'bid', id: bidId },
      purpose: 'bid',
      description: `Winning bid on item ${bid.itemId}`,
      amountCents: bid.amountCents,
      payer: { email: `${bid.userId}@example.org` },
      owner: { type: 'user', id: bid.userId },
      paymentMethodId: bid.paymentMethodId,
      idempotencyKey: `bid-${bidId}`,
      context: { bidId },
    })
    await ctx.db.patch(bidId, { status: 'charging', checkoutId })
  },
})

/**
 * The retry page's StripeRetryPayment createPayment: the bidder pays themselves after the saved card
 * was declined. Called when they press Pay (the same PaymentIntent comes back while it waits).
 */
export const retryBidPayment = action({
  args: { bidId: v.id('bids') },
  handler: async (ctx, { bidId }): Promise<string> => {
    const me = await signedIn(ctx)
    const checkoutId = await ctx.runQuery(internal.shop.retryableCheckout, { bidId, userId: me.subject })
    return (await payments.retryOnSession(ctx, { checkoutId })).clientSecret
  },
})

/** The retry page's PayPal button: the same payment with PayPal's buttons (PaypalButtons). */
export const retryBidWithPaypal = action({
  args: { bidId: v.id('bids') },
  handler: async (ctx, { bidId }): Promise<StartedEmbedded> => {
    const me = await signedIn(ctx)
    const checkoutId = await ctx.runQuery(internal.shop.retryableCheckout, { bidId, userId: me.subject })
    return await payments.retryWithPaypal(ctx, { checkoutId, returnPath: `/bids/${bidId}/paid` })
  },
})

export const retryableCheckout = internalQuery({
  args: { bidId: v.id('bids'), userId: v.string() },
  handler: async (ctx, { bidId, userId }): Promise<string> => {
    const bid = await ctx.db.get(bidId)
    if (!bid || bid.userId !== userId || bid.status !== 'payment_failed' || !bid.checkoutId) throw new ConvexError('This bid isn’t waiting for your payment.')
    return bid.checkoutId
  },
})

// ── Callbacks ─────────────────────────────────────────────────────────────────────────────────

const bidOf = async (ctx: MutationCtx, context: (typeof payments.args.paid.context)['type']) => ('bidId' in context ? await ctx.db.get(context.bidId) : null)

/** The money arrived: record the sale, or refuse it (the library then owes it back as a refund). */
export const onPaid = internalMutation({
  args: payments.args.paid,
  returns: paidReturns,
  handler: async (ctx, a): Promise<PaidResult> => {
    const bid = await bidOf(ctx, a.context)
    if (bid) {
      if (bid.status === 'paid') return { refuse: 'This bid was already paid.' }
      await ctx.db.patch(bid._id, { status: 'paid' })
      return null
    }
    if (!('itemId' in a.context)) return { refuse: 'Not a sale this shop knows.' }
    const itemId = a.context.itemId
    const sold = await ctx.db
      .query('orders')
      .withIndex('by_itemId', (q) => q.eq('itemId', itemId))
      .first()
    if (sold) return { refuse: 'That item sold while you were paying.' }
    await ctx.db.insert('orders', { checkoutId: a.checkoutId, itemId, paymentRef: a.paymentRef, amountCents: a.paidCents, buyerEmail: a.payer.email, status: 'paid' })
    return null
  },
})

/** Declined, bounced or given up: a bid's bidder is asked to pay themselves. */
export const onFailed = internalMutation({
  args: payments.args.failed,
  handler: async (ctx, a) => {
    const bid = await bidOf(ctx, a.context)
    if (bid && bid.status !== 'paid') await ctx.db.patch(bid._id, { status: 'payment_failed' })
  },
})

/** A bank payment is on its way (days). */
export const onProcessing = internalMutation({
  args: payments.args.processing,
  handler: async (ctx, a) => {
    const bid = await bidOf(ctx, a.context)
    if (bid) await ctx.db.patch(bid._id, { status: 'processing' })
  },
})

export const onRefunded = internalMutation({
  args: payments.args.refunded,
  handler: async (ctx, a) => {
    const order = await ctx.db
      .query('orders')
      .withIndex('by_checkoutId', (q) => q.eq('checkoutId', a.checkoutId))
      .first()
    if (order && a.refundedCents >= a.paidCents) await ctx.db.patch(order._id, { status: 'refunded' })
  },
})

/** A real app emails a person here; the refund is waiting on the admin page. */
export const onRefundNeeded = internalMutation({ args: payments.args.refundNeeded, handler: async (_ctx, a) => console.warn(`Refund needed for ${a.checkoutId}: ${a.reason}`) })
export const onDispute = internalMutation({ args: payments.args.dispute, handler: async (_ctx, a) => console.warn(`Dispute ${a.status} on ${a.checkoutId}`) })
export const onIssues = internalMutation({ args: payments.args.issues, handler: async (_ctx, a) => console.warn(`${a.issues.length} new payment issues`) })

/** Who may use the admin page: signed in, and in the admins table. */
export const isAdmin = internalQuery({
  args: { auth: v.optional(v.any()) },
  handler: async (ctx): Promise<{ name: string } | null> => {
    const me = await ctx.auth.getUserIdentity()
    if (!me) return null
    const row = await ctx.db
      .query('admins')
      .withIndex('by_tokenIdentifier', (q) => q.eq('tokenIdentifier', me.tokenIdentifier))
      .first()
    return row ? { name: row.name } : null
  },
})

/** For trying the example: make yourself an admin (a real app has its own way). */
export const becomeAdmin = mutation({
  args: { name: v.string() },
  handler: async (ctx, { name }) => {
    const me = await ctx.auth.getUserIdentity()
    if (!me || process.env.EXAMPLE_ALLOW_SELF_ADMIN !== 'true') throw new ConvexError('Not allowed.')
    await ctx.db.insert('admins', { tokenIdentifier: me.tokenIdentifier, name })
  },
})
