import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';
export const processor = v.union(v.literal('stripe'), v.literal('paypal'));
export const method = v.union(v.literal('card'), v.literal('ach'), v.literal('paypal'));
/**
 * created: the row exists, the processor hasn't been asked yet. pending: the buyer was sent to the
 * processor. processing: paid by bank transfer, the money not arrived yet. paid: the host recorded
 * the sale. failed: the processor said no. abandoned: expired with nothing paid. refund_needed: the
 * money arrived but the host refused the sale (or the amount was wrong), so it is owed back.
 * "Partly refunded" and "refunded" are read from refundedCents, not statuses.
 */
export const checkoutStatus = v.union(v.literal('created'), v.literal('pending'), v.literal('processing'), v.literal('paid'), v.literal('failed'), v.literal('abandoned'), v.literal('refund_needed'));
/** What a checkout is for in the app, e.g. { type: 'offering', id }. Ids are strings: the component can't name the app's tables. */
export const ref = v.object({ type: v.string(), id: v.string() });
export const payer = v.object({ name: v.optional(v.string()), email: v.string() });
/** App functions as handles (createFunctionHandle), called inside the transaction that records the outcome. */
export const callbacks = v.object({
    onPaid: v.optional(v.string()),
    onFailed: v.optional(v.string()),
    onRefunded: v.optional(v.string()),
    onRefundNeeded: v.optional(v.string()),
    onDispute: v.optional(v.string()),
    onProcessing: v.optional(v.string()),
});
/** hosted: Stripe Checkout or PayPal. offSession: a saved method charged with nobody present. onSession: the buyer pays on the app's page. Unset on rows from v0.1: hosted. */
export const checkoutKind = v.union(v.literal('hosted'), v.literal('offSession'), v.literal('onSession'));
export const savedMethodKind = v.union(v.literal('card'), v.literal('ach'));
/**
 * The host's own notes on a refund, e.g. { relist: 'yes' } from a question its admin page asked: kept on
 * the refund, shown in the ledger and passed to on.refunded. Opaque to the library.
 */
export const hostData = v.record(v.string(), v.string());
export const refundOrigin = v.union(v.literal('requested'), v.literal('needed'), v.literal('external'));
/**
 * requested → approved → sending → sent, or failed (which may be sent again). manual: refunded outside
 * the app and recorded by hand. dismissed: decided not to refund.
 */
export const refundStatus = v.union(v.literal('requested'), v.literal('approved'), v.literal('sending'), v.literal('sent'), v.literal('failed'), v.literal('manual'), v.literal('dismissed'));
export const eventOutcome = v.union(v.literal('received'), v.literal('handled'), v.literal('ignored'), v.literal('foreign'));
export const issueKind = v.union(v.literal('missing_here'), v.literal('missing_there'), v.literal('amount_differs'), v.literal('status_differs'), v.literal('dispute'), v.literal('callback_failed'), v.literal('charge_unknown'));
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
        /** onSession: the checkout this one retries (a declined offSession charge). */
        retryOf: v.optional(v.id('checkouts')),
        /** Stripe's Checkout Session id, PayPal's order id, or (offSession, onSession) Stripe's PaymentIntent id. */
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
        .index('by_createdAt', ['createdAt'])
        .index('by_status_createdAt', ['status', 'createdAt'])
        .index('by_retryOf', ['retryOf'])
        .index('by_chargeKey', ['chargeKey']),
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
});
//# sourceMappingURL=schema.js.map