import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

export const processor = v.union(v.literal('stripe'), v.literal('paypal'))
export const method = v.union(v.literal('card'), v.literal('ach'), v.literal('paypal'))

/**
 * created: the row exists, the processor hasn't been asked yet. pending: the buyer was sent to the
 * processor. processing: paid by bank transfer, the money not arrived yet. paid: the host recorded
 * the sale. failed: the processor said no. abandoned: expired with nothing paid. refund_needed: the
 * money arrived but the host refused the sale (or the amount was wrong), so it is owed back.
 * "Partly refunded" and "refunded" are read from refundedCents, not statuses.
 */
export const checkoutStatus = v.union(v.literal('created'), v.literal('pending'), v.literal('processing'), v.literal('paid'), v.literal('failed'), v.literal('abandoned'), v.literal('refund_needed'))

/** What a checkout is for in the app, e.g. { type: 'offering', id }. Ids are strings: the component can't name the app's tables. */
export const ref = v.object({ type: v.string(), id: v.string() })

export const payer = v.object({ name: v.optional(v.string()), email: v.string() })

/** App functions as handles (createFunctionHandle), called inside the transaction that records the outcome. */
export const callbacks = v.object({
  onPaid: v.optional(v.string()),
  onFailed: v.optional(v.string()),
  onRefunded: v.optional(v.string()),
  onRefundNeeded: v.optional(v.string()),
  onDispute: v.optional(v.string()),
})

export const refundOrigin = v.union(v.literal('requested'), v.literal('needed'), v.literal('external'))

/**
 * requested → approved → sending → sent, or failed (which may be sent again). manual: refunded outside
 * the app and recorded by hand. dismissed: decided not to refund.
 */
export const refundStatus = v.union(v.literal('requested'), v.literal('approved'), v.literal('sending'), v.literal('sent'), v.literal('failed'), v.literal('manual'), v.literal('dismissed'))

export const eventOutcome = v.union(v.literal('received'), v.literal('handled'), v.literal('ignored'), v.literal('foreign'))

export const issueKind = v.union(v.literal('missing_here'), v.literal('missing_there'), v.literal('amount_differs'), v.literal('status_differs'), v.literal('dispute'), v.literal('callback_failed'))

export default defineSchema({
  checkouts: defineTable({
    app: v.string(),
    ref,
    /** A free word for the host, e.g. 'order' or 'donation'. */
    purpose: v.string(),
    description: v.string(),
    amountCents: v.number(),
    processor,
    method,
    payer,
    status: checkoutStatus,
    /** Stripe's Checkout Session id, or PayPal's order id. */
    processorCheckoutId: v.optional(v.string()),
    /** Stripe's PaymentIntent id, or PayPal's capture id: what refunds and disputes point at. */
    paymentRef: v.optional(v.string()),
    paidCents: v.optional(v.number()),
    refundedCents: v.number(),
    /** What the processor actually kept, when it says. */
    processorFeeCents: v.optional(v.number()),
    disputed: v.optional(v.boolean()),
    callbacks,
    /** Passed to every callback as it was given to start. */
    context: v.optional(v.any()),
    returnUrl: v.string(),
    cancelUrl: v.string(),
    expiresAt: v.number(),
    createdAt: v.number(),
    settledAt: v.optional(v.number()),
    lastError: v.optional(v.string()),
  })
    .index('by_status_expiresAt', ['status', 'expiresAt'])
    .index('by_processorCheckoutId', ['processorCheckoutId'])
    .index('by_paymentRef', ['paymentRef'])
    .index('by_ref', ['ref.type', 'ref.id'])
    .index('by_createdAt', ['createdAt']),

  /** The refund ledger: many per checkout. Kept forever, as a financial record. */
  refunds: defineTable({
    checkoutId: v.id('checkouts'),
    amountCents: v.number(),
    reason: v.string(),
    origin: refundOrigin,
    status: refundStatus,
    /** Who asked and who approved, as the host names them. */
    requestedBy: v.optional(v.string()),
    approvedBy: v.optional(v.string()),
    processorRefundId: v.optional(v.string()),
    note: v.optional(v.string()),
    error: v.optional(v.string()),
    createdAt: v.number(),
    /** When it last changed status; sweep asks the processor about refunds left sending. */
    updatedAt: v.number(),
    sentAt: v.optional(v.number()),
    /**
     * Sends the processor refused outright. Each new attempt gets its own idempotency key, because the
     * processors replay a key's first answer; a send whose outcome is unknown keeps its key instead.
     */
    attempts: v.optional(v.number()),
  })
    .index('by_checkout', ['checkoutId'])
    .index('by_status', ['status', 'updatedAt'])
    .index('by_processorRefundId', ['processorRefundId']),

  /** Webhook deliveries seen, so a repeat is answered at once. Kept 30 days. */
  events: defineTable({
    processor,
    eventId: v.string(),
    type: v.string(),
    receivedAt: v.number(),
    outcome: eventOutcome,
  }).index('by_processor_eventId', ['processor', 'eventId']),

  /** Differences from the processors, disputes and failed callbacks, for a person to look at. One open per key and kind. */
  issues: defineTable({
    kind: issueKind,
    /** The payment reference when known, else the processor's checkout id, else the checkout id. */
    key: v.string(),
    checkoutId: v.optional(v.id('checkouts')),
    processor,
    paymentRef: v.optional(v.string()),
    detail: v.string(),
    openedAt: v.number(),
    resolvedAt: v.optional(v.number()),
    /** When a digest told someone about it. */
    reportedAt: v.optional(v.number()),
  })
    .index('by_resolvedAt', ['resolvedAt', 'openedAt'])
    .index('by_key_kind', ['key', 'kind', 'resolvedAt'])
    .index('by_reportedAt', ['reportedAt', 'openedAt']),

  /** Fixed-window counters for starting checkouts. */
  limits: defineTable({
    key: v.string(),
    windowStart: v.number(),
    count: v.number(),
  })
    .index('by_key', ['key'])
    .index('by_windowStart', ['windowStart']),

  /** At most one row. A missing field means the default in settings.ts. */
  settings: defineTable({
    retentionDays: v.optional(v.number()),
    /** The PayPal access token, encrypted with the client secret, for the account in tokenAccount. */
    paypalToken: v.optional(v.string()),
    paypalTokenExpiresAt: v.optional(v.number()),
    paypalTokenAccount: v.optional(v.string()),
    /** Set once PayPal refused Transaction Search, so reconcile logs it once and stops asking for a day. */
    searchRefusedAt: v.optional(v.number()),
  }),
})
