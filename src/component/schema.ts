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
  onProcessing: v.optional(v.string()),
})

/** hosted: Stripe Checkout or PayPal. offSession: a saved method charged with nobody present. onSession: the buyer pays on the app's page. Unset on rows from v0.1: hosted. */
export const checkoutKind = v.union(v.literal('hosted'), v.literal('offSession'), v.literal('onSession'), v.literal('onPage'))

export const savedMethodKind = v.union(v.literal('card'), v.literal('ach'))

/** How bad a refused charge was (core/declines.ts): hard ones aren't retried. */
export const declineKind = v.union(v.literal('hard'), v.literal('soft'), v.literal('insufficient_funds'))

/**
 * starting: waiting for its first payment, which also saves the method (startScheduleCheckout).
 * active: charged each period. paused: skipped until pausedUntil, then active again by itself.
 * past_due: a charge was refused and is being retried. lapsed: the retries ran out or the refusal was
 * hard; a new method (updateSchedule) or resumeSchedule starts it again. cancelled: for good.
 */
export const scheduleStatus = v.union(v.literal('starting'), v.literal('active'), v.literal('paused'), v.literal('past_due'), v.literal('lapsed'), v.literal('cancelled'))

/** Only monthly for now; kept a field so other intervals can come without a migration. */
export const scheduleInterval = v.literal('month')

/** The host's schedule callbacks as function handles, like a checkout's. */
export const scheduleCallbacks = v.object({
  onCharged: v.optional(v.string()),
  onFailed: v.optional(v.string()),
  onChanged: v.optional(v.string()),
})

/** A PayPal card's network reference from its first payment, sent with later merchant-initiated charges. */
export const networkRef = v.object({ id: v.string(), network: v.optional(v.string()), date: v.optional(v.string()) })

/**
 * The host's own notes on a refund, e.g. { relist: 'yes' } from a question its admin page asked: kept on
 * the refund, shown in the ledger and passed to on.refunded. Opaque to the library.
 */
export const hostData = v.record(v.string(), v.string())

export const refundOrigin = v.union(v.literal('requested'), v.literal('needed'), v.literal('external'))

/**
 * requested → approved → sending → sent, or failed (which may be sent again). manual: refunded outside
 * the app and recorded by hand. dismissed: decided not to refund.
 */
export const refundStatus = v.union(v.literal('requested'), v.literal('approved'), v.literal('sending'), v.literal('sent'), v.literal('failed'), v.literal('manual'), v.literal('dismissed'))

export const eventOutcome = v.union(v.literal('received'), v.literal('handled'), v.literal('ignored'), v.literal('foreign'))

export const issueKind = v.union(
  v.literal('missing_here'),
  v.literal('missing_there'),
  v.literal('amount_differs'),
  v.literal('status_differs'),
  v.literal('dispute'),
  v.literal('callback_failed'),
  v.literal('charge_unknown'),
)

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
    kind: v.optional(checkoutKind),
    /** offSession and onSession: the Stripe Customer charged, and the saved method an offSession charge uses. */
    stripeCustomerId: v.optional(v.string()),
    paymentMethodId: v.optional(v.string()),
    /** offSession: the app's idempotency key for the charge, so every retry of it replays one charge. */
    chargeKey: v.optional(v.string()),
    /** offSession: charge calls whose outcome was unknown (no answer, a 5xx), retried under the same key. */
    chargeAttempts: v.optional(v.number()),
    /** offSession: when the last of those was. */
    lastTriedAt: v.optional(v.number()),
    /** A schedule's charge (or its first payment): the schedule, and the period ('YYYY-MM') it pays. */
    scheduleId: v.optional(v.id('schedules')),
    schedulePeriod: v.optional(v.string()),
    /** failed: the processor's code for the refusal (insufficient_funds, lost_card, INSTRUMENT_DECLINED...) and how bad it is. */
    declineCode: v.optional(v.string()),
    declineKind: v.optional(declineKind),
    /** onSession: the checkout this one retries (a declined offSession charge). */
    retryOf: v.optional(v.id('checkouts')),
    /** Stripe's Checkout Session id, PayPal's order id, or (offSession, onSession, onPage) Stripe's PaymentIntent id. */
    processorCheckoutId: v.optional(v.string()),
    /** Stripe's PaymentIntent id, or PayPal's capture id: what refunds and disputes point at. */
    paymentRef: v.optional(v.string()),
    paidCents: v.optional(v.number()),
    refundedCents: v.number(),
    /** What the processor actually kept, when it says. */
    processorFeeCents: v.optional(v.number()),
    disputed: v.optional(v.boolean()),
    /**
     * PayPal declined the card or account the buyer chose at capture: from then on only the buyer
     * captures it (completeReturn), never the webhook or the sweep. lastError says it for people.
     */
    paypalDeclinedAt: v.optional(v.number()),
    /**
     * Left out of the sweep's and cleanup's scans, so rows that stay put can't fill the batch: an
     * off-session charge handed to a person (until they retry it), or an old failed checkout kept with its refund.
     */
    parkedAt: v.optional(v.number()),
    /** The buyer closed it (cancelCheckout): money that arrives anyway is owed back, not kept. */
    cancelledByBuyerAt: v.optional(v.number()),
    /**
     * PayPal: when a capture claimed it (claimCapture), before asking PayPal. The buyer can't cancel
     * while the claim is live; once stale, cancel asks PayPal for the order first.
     */
    captureClaimedAt: v.optional(v.number()),
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
    .index('by_status_parked_expiresAt', ['status', 'parkedAt', 'expiresAt'])
    .index('by_processorCheckoutId', ['processorCheckoutId'])
    .index('by_paymentRef', ['paymentRef'])
    .index('by_ref', ['ref.type', 'ref.id'])
    .index('by_createdAt', ['createdAt'])
    .index('by_status_createdAt', ['status', 'createdAt'])
    .index('by_retryOf', ['retryOf'])
    .index('by_chargeKey', ['chargeKey'])
    .index('by_scheduleId', ['scheduleId']),

  /**
   * Repeating charges of a saved method (monthly gifts): the library charges each due one with an
   * off-session checkout keyed `schedule-<id>-<period>`, so a period is never charged twice. Kept
   * forever, as the record of what a payer agreed to; small (one per agreement).
   */
  schedules: defineTable({
    app: v.string(),
    /** Whose saved method it charges (as given to setupPaymentMethod / savePaypalMethod). */
    owner: ref,
    /** What it is for in the app, e.g. { type: 'monthlyDonation', id }. */
    ref,
    purpose: v.string(),
    description: v.string(),
    payer,
    processor,
    method,
    /** The library's saved-method id (pm_… or paypal:…); unset while starting. */
    paymentMethodId: v.optional(v.string()),
    amountCents: v.number(),
    interval: scheduleInterval,
    /** Day of the month it is charged (1-28), at hourUTC. */
    anchorDay: v.number(),
    hourUTC: v.number(),
    status: scheduleStatus,
    /** When the worker next acts on it: the period's charge, a retry, or the end of a pause. */
    nextChargeAt: v.number(),
    /** The period ('YYYY-MM') the next charge pays, and the one it started with. */
    period: v.string(),
    firstPeriod: v.string(),
    /** Charges made for that period so far (each try has its own idempotency key). */
    periodAttempts: v.number(),
    /** The last period paid (or on its way, for a bank debit), so a resume or anchor change never charges it again. */
    lastPaidPeriod: v.optional(v.string()),
    pausedUntil: v.optional(v.number()),
    /** Days after a period's first refusal that it is tried again (default 3, 5, 7); then it lapses. */
    retryDays: v.array(v.number()),
    /** Refusals in the current period, and when the first was (retries count from it). */
    failures: v.number(),
    firstFailedAt: v.optional(v.number()),
    lastCheckoutId: v.optional(v.id('checkouts')),
    lastError: v.optional(v.string()),
    /** cancelled or lapsed: why, and who (cancelled through the API) or what (the processor). */
    endReason: v.optional(v.string()),
    endedBy: v.optional(v.string()),
    endedAt: v.optional(v.number()),
    /**
     * Cancelled because its first payment wasn't completed (its checkout expired or failed), not by
     * anyone: a first payment that arrives anyway, on a checkout the payer didn't cancel, starts it.
     */
    neverStarted: v.optional(v.boolean()),
    /**
     * PayPal took the first payment but answered vault status APPROVED, not VAULTED: the method is
     * saved later, and its token shows on the order (read again by the schedules worker) and comes in
     * VAULT.PAYMENT-TOKEN.CREATED. Until then (at most three days) the schedule waits for it instead
     * of failing for want of a method. orderId is the first
     * payment's order; paypalCustomerId the PayPal customer the token will belong to, when known;
     * networkRef the card's reference from that capture, for later recurring charges.
     */
    paypalVaultPending: v.optional(
      v.object({ orderId: v.string(), paypalCustomerId: v.optional(v.string()), networkRef: v.optional(networkRef), since: v.number(), lastCheckAt: v.optional(v.number()) }),
    ),
    callbacks: scheduleCallbacks,
    /** Passed to every charge's callbacks and the schedule's own. */
    context: v.optional(v.any()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_app_status_nextChargeAt', ['app', 'status', 'nextChargeAt'])
    .index('by_owner', ['app', 'owner.type', 'owner.id'])
    .index('by_ref', ['ref.type', 'ref.id'])
    .index('by_paymentMethodId', ['paymentMethodId'])
    .index('by_app_paypalVaultCustomer', ['app', 'paypalVaultPending.paypalCustomerId']),

  /** One Stripe Customer per payer of the app (owner: e.g. { type: 'user', id }), for saved payment methods. */
  customers: defineTable({
    app: v.string(),
    owner: ref,
    stripeCustomerId: v.string(),
    email: v.string(),
    createdAt: v.number(),
  })
    .index('by_owner', ['app', 'owner.type', 'owner.id'])
    .index('by_stripeCustomerId', ['stripeCustomerId']),

  /**
   * Saved methods the library has seen for a customer: what they are, and whether an off-session
   * charge of one was declined, so it isn't offered again. Stripe holds the method itself.
   */
  paymentMethods: defineTable({
    customerId: v.id('customers'),
    stripePaymentMethodId: v.string(),
    kind: savedMethodKind,
    label: v.string(),
    declinedAt: v.optional(v.number()),
    declineReason: v.optional(v.string()),
    /** The owner removed it (removeSavedMethod); it is detached at Stripe too, and never offered again. */
    removedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index('by_customer', ['customerId'])
    .index('by_stripePaymentMethodId', ['stripePaymentMethodId']),

  /** One PayPal vault customer per payer of the app, made by PayPal the first time they save a card or account. */
  paypalCustomers: defineTable({
    app: v.string(),
    owner: ref,
    paypalCustomerId: v.string(),
    createdAt: v.number(),
  })
    .index('by_owner', ['app', 'owner.type', 'owner.id'])
    .index('by_paypalCustomerId', ['paypalCustomerId']),

  /**
   * Cards and PayPal accounts saved in PayPal's vault. Unlike Stripe's, these rows are the list the
   * library offers: PayPal's own list of a customer's methods lags (a method saved seconds ago is
   * missing, a deleted one still shown; seen in the sandbox 2026-11-19). A removed method's row stays, marked.
   */
  paypalMethods: defineTable({
    customerId: v.id('paypalCustomers'),
    /** PayPal's payment token id: the vault_id a charge names. */
    paymentTokenId: v.string(),
    kind: v.union(v.literal('card'), v.literal('paypal')),
    label: v.string(),
    /** A PayPal account's agreement (UNSCHEDULED_POSTPAID, RECURRING_PREPAID...), sent back with recurring charges. */
    usagePattern: v.optional(v.string()),
    /** A card saved with a payment: its first payment's network reference, for later merchant-initiated charges. */
    networkRef: v.optional(networkRef),
    declinedAt: v.optional(v.number()),
    declineReason: v.optional(v.string()),
    /** The owner removed it (deleted from PayPal's vault); kept so a charge of it fails instead of erring, and it can't be saved again. */
    removedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index('by_customer', ['customerId'])
    .index('by_paymentTokenId', ['paymentTokenId']),

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
    hostData: v.optional(hostData),
  })
    .index('by_checkout', ['checkoutId'])
    .index('by_status', ['status', 'updatedAt'])
    .index('by_processorRefundId', ['processorRefundId']),

  /**
   * Disputes (chargebacks), one row each, so a payment with two is disputed until both end, and what a
   * lost one took back is off what is left to refund. Kept forever, with their payments.
   */
  disputes: defineTable({
    checkoutId: v.id('checkouts'),
    processor,
    disputeId: v.string(),
    status: v.union(v.literal('open'), v.literal('won'), v.literal('lost')),
    amountCents: v.optional(v.number()),
    /** How it ended, in the processor's words. */
    outcome: v.optional(v.string()),
    openedAt: v.number(),
    closedAt: v.optional(v.number()),
  })
    .index('by_disputeId', ['processor', 'disputeId'])
    .index('by_checkout', ['checkoutId']),

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

  /** Fixed-window counters for the public entries (starting checkouts, saving methods, retries, return pages). */
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
