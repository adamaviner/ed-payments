export declare const processor: import("convex/values").VUnion<"paypal" | "stripe", [import("convex/values").VLiteral<"stripe", "required">, import("convex/values").VLiteral<"paypal", "required">], "required", never>;
export declare const method: import("convex/values").VUnion<"card" | "ach" | "paypal", [import("convex/values").VLiteral<"card", "required">, import("convex/values").VLiteral<"ach", "required">, import("convex/values").VLiteral<"paypal", "required">], "required", never>;
/**
 * created: the row exists, the processor hasn't been asked yet. pending: the buyer was sent to the
 * processor. processing: paid by bank transfer, the money not arrived yet. paid: the host recorded
 * the sale. failed: the processor said no. abandoned: expired with nothing paid. refund_needed: the
 * money arrived but the host refused the sale (or the amount was wrong), so it is owed back.
 * "Partly refunded" and "refunded" are read from refundedCents, not statuses.
 */
export declare const checkoutStatus: import("convex/values").VUnion<"abandoned" | "created" | "pending" | "processing" | "paid" | "failed" | "refund_needed", [import("convex/values").VLiteral<"created", "required">, import("convex/values").VLiteral<"pending", "required">, import("convex/values").VLiteral<"processing", "required">, import("convex/values").VLiteral<"paid", "required">, import("convex/values").VLiteral<"failed", "required">, import("convex/values").VLiteral<"abandoned", "required">, import("convex/values").VLiteral<"refund_needed", "required">], "required", never>;
/** What a checkout is for in the app, e.g. { type: 'offering', id }. Ids are strings: the component can't name the app's tables. */
export declare const ref: import("convex/values").VObject<{
    id: string;
    type: string;
}, {
    type: import("convex/values").VString<string, "required">;
    id: import("convex/values").VString<string, "required">;
}, "required", "id" | "type">;
export declare const payer: import("convex/values").VObject<{
    name?: string | undefined;
    email: string;
}, {
    name: import("convex/values").VString<string | undefined, "optional">;
    email: import("convex/values").VString<string, "required">;
}, "required", "name" | "email">;
/** App functions as handles (createFunctionHandle), called inside the transaction that records the outcome. */
export declare const callbacks: import("convex/values").VObject<{
    onPaid?: string | undefined;
    onFailed?: string | undefined;
    onRefunded?: string | undefined;
    onRefundNeeded?: string | undefined;
    onDispute?: string | undefined;
}, {
    onPaid: import("convex/values").VString<string | undefined, "optional">;
    onFailed: import("convex/values").VString<string | undefined, "optional">;
    onRefunded: import("convex/values").VString<string | undefined, "optional">;
    onRefundNeeded: import("convex/values").VString<string | undefined, "optional">;
    onDispute: import("convex/values").VString<string | undefined, "optional">;
}, "required", "onPaid" | "onFailed" | "onRefunded" | "onRefundNeeded" | "onDispute">;
export declare const refundOrigin: import("convex/values").VUnion<"requested" | "needed" | "external", [import("convex/values").VLiteral<"requested", "required">, import("convex/values").VLiteral<"needed", "required">, import("convex/values").VLiteral<"external", "required">], "required", never>;
/**
 * requested → approved → sending → sent, or failed (which may be sent again). manual: refunded outside
 * the app and recorded by hand. dismissed: decided not to refund.
 */
export declare const refundStatus: import("convex/values").VUnion<"failed" | "requested" | "approved" | "sending" | "sent" | "manual" | "dismissed", [import("convex/values").VLiteral<"requested", "required">, import("convex/values").VLiteral<"approved", "required">, import("convex/values").VLiteral<"sending", "required">, import("convex/values").VLiteral<"sent", "required">, import("convex/values").VLiteral<"failed", "required">, import("convex/values").VLiteral<"manual", "required">, import("convex/values").VLiteral<"dismissed", "required">], "required", never>;
export declare const eventOutcome: import("convex/values").VUnion<"foreign" | "received" | "handled" | "ignored", [import("convex/values").VLiteral<"received", "required">, import("convex/values").VLiteral<"handled", "required">, import("convex/values").VLiteral<"ignored", "required">, import("convex/values").VLiteral<"foreign", "required">], "required", never>;
export declare const issueKind: import("convex/values").VUnion<"status_differs" | "amount_differs" | "missing_here" | "missing_there" | "dispute" | "callback_failed", [import("convex/values").VLiteral<"missing_here", "required">, import("convex/values").VLiteral<"missing_there", "required">, import("convex/values").VLiteral<"amount_differs", "required">, import("convex/values").VLiteral<"status_differs", "required">, import("convex/values").VLiteral<"dispute", "required">, import("convex/values").VLiteral<"callback_failed", "required">], "required", never>;
declare const _default: import("convex/server").SchemaDefinition<{
    checkouts: import("convex/server").TableDefinition<import("convex/values").VObject<{
        processorCheckoutId?: string | undefined;
        paymentRef?: string | undefined;
        context?: any;
        processorFeeCents?: number | undefined;
        paidCents?: number | undefined;
        disputed?: boolean | undefined;
        settledAt?: number | undefined;
        lastError?: string | undefined;
        ref: {
            id: string;
            type: string;
        };
        amountCents: number;
        app: string;
        callbacks: {
            onPaid?: string | undefined;
            onFailed?: string | undefined;
            onRefunded?: string | undefined;
            onRefundNeeded?: string | undefined;
            onDispute?: string | undefined;
        };
        cancelUrl: string;
        description: string;
        expiresAt: number;
        method: "card" | "ach" | "paypal";
        payer: {
            name?: string | undefined;
            email: string;
        };
        processor: "paypal" | "stripe";
        purpose: string;
        returnUrl: string;
        status: "abandoned" | "created" | "pending" | "processing" | "paid" | "failed" | "refund_needed";
        refundedCents: number;
        createdAt: number;
    }, {
        app: import("convex/values").VString<string, "required">;
        ref: import("convex/values").VObject<{
            id: string;
            type: string;
        }, {
            type: import("convex/values").VString<string, "required">;
            id: import("convex/values").VString<string, "required">;
        }, "required", "id" | "type">;
        /** A free word for the host, e.g. 'order' or 'donation'. */
        purpose: import("convex/values").VString<string, "required">;
        description: import("convex/values").VString<string, "required">;
        amountCents: import("convex/values").VFloat64<number, "required">;
        processor: import("convex/values").VUnion<"paypal" | "stripe", [import("convex/values").VLiteral<"stripe", "required">, import("convex/values").VLiteral<"paypal", "required">], "required", never>;
        method: import("convex/values").VUnion<"card" | "ach" | "paypal", [import("convex/values").VLiteral<"card", "required">, import("convex/values").VLiteral<"ach", "required">, import("convex/values").VLiteral<"paypal", "required">], "required", never>;
        payer: import("convex/values").VObject<{
            name?: string | undefined;
            email: string;
        }, {
            name: import("convex/values").VString<string | undefined, "optional">;
            email: import("convex/values").VString<string, "required">;
        }, "required", "name" | "email">;
        status: import("convex/values").VUnion<"abandoned" | "created" | "pending" | "processing" | "paid" | "failed" | "refund_needed", [import("convex/values").VLiteral<"created", "required">, import("convex/values").VLiteral<"pending", "required">, import("convex/values").VLiteral<"processing", "required">, import("convex/values").VLiteral<"paid", "required">, import("convex/values").VLiteral<"failed", "required">, import("convex/values").VLiteral<"abandoned", "required">, import("convex/values").VLiteral<"refund_needed", "required">], "required", never>;
        /** Stripe's Checkout Session id, or PayPal's order id. */
        processorCheckoutId: import("convex/values").VString<string | undefined, "optional">;
        /** Stripe's PaymentIntent id, or PayPal's capture id: what refunds and disputes point at. */
        paymentRef: import("convex/values").VString<string | undefined, "optional">;
        paidCents: import("convex/values").VFloat64<number | undefined, "optional">;
        refundedCents: import("convex/values").VFloat64<number, "required">;
        /** What the processor actually kept, when it says. */
        processorFeeCents: import("convex/values").VFloat64<number | undefined, "optional">;
        disputed: import("convex/values").VBoolean<boolean | undefined, "optional">;
        callbacks: import("convex/values").VObject<{
            onPaid?: string | undefined;
            onFailed?: string | undefined;
            onRefunded?: string | undefined;
            onRefundNeeded?: string | undefined;
            onDispute?: string | undefined;
        }, {
            onPaid: import("convex/values").VString<string | undefined, "optional">;
            onFailed: import("convex/values").VString<string | undefined, "optional">;
            onRefunded: import("convex/values").VString<string | undefined, "optional">;
            onRefundNeeded: import("convex/values").VString<string | undefined, "optional">;
            onDispute: import("convex/values").VString<string | undefined, "optional">;
        }, "required", "onPaid" | "onFailed" | "onRefunded" | "onRefundNeeded" | "onDispute">;
        /** Passed to every callback as it was given to start. */
        context: import("convex/values").VAny<any, "optional", string>;
        returnUrl: import("convex/values").VString<string, "required">;
        cancelUrl: import("convex/values").VString<string, "required">;
        expiresAt: import("convex/values").VFloat64<number, "required">;
        createdAt: import("convex/values").VFloat64<number, "required">;
        settledAt: import("convex/values").VFloat64<number | undefined, "optional">;
        lastError: import("convex/values").VString<string | undefined, "optional">;
    }, "required", "processorCheckoutId" | "paymentRef" | "ref" | "amountCents" | "app" | "callbacks" | "cancelUrl" | "context" | "description" | "expiresAt" | "method" | "payer" | "processor" | "purpose" | "returnUrl" | "processorFeeCents" | "paidCents" | "status" | "ref.id" | "ref.type" | `context.${string}` | "payer.name" | "payer.email" | "refundedCents" | "disputed" | "createdAt" | "settledAt" | "lastError" | "callbacks.onPaid" | "callbacks.onFailed" | "callbacks.onRefunded" | "callbacks.onRefundNeeded" | "callbacks.onDispute">, {
        by_status_expiresAt: ["status", "expiresAt", "_creationTime"];
        by_processorCheckoutId: ["processorCheckoutId", "_creationTime"];
        by_paymentRef: ["paymentRef", "_creationTime"];
        by_ref: ["ref.type", "ref.id", "_creationTime"];
        by_createdAt: ["createdAt", "_creationTime"];
    }, {}, {}>;
    /** The refund ledger: many per checkout. Kept forever, as a financial record. */
    refunds: import("convex/server").TableDefinition<import("convex/values").VObject<{
        error?: string | undefined;
        note?: string | undefined;
        processorRefundId?: string | undefined;
        requestedBy?: string | undefined;
        approvedBy?: string | undefined;
        sentAt?: number | undefined;
        attempts?: number | undefined;
        amountCents: number;
        reason: string;
        status: "failed" | "requested" | "approved" | "sending" | "sent" | "manual" | "dismissed";
        checkoutId: import("convex/values").GenericId<"checkouts">;
        origin: "requested" | "needed" | "external";
        createdAt: number;
        updatedAt: number;
    }, {
        checkoutId: import("convex/values").VId<import("convex/values").GenericId<"checkouts">, "required">;
        amountCents: import("convex/values").VFloat64<number, "required">;
        reason: import("convex/values").VString<string, "required">;
        origin: import("convex/values").VUnion<"requested" | "needed" | "external", [import("convex/values").VLiteral<"requested", "required">, import("convex/values").VLiteral<"needed", "required">, import("convex/values").VLiteral<"external", "required">], "required", never>;
        status: import("convex/values").VUnion<"failed" | "requested" | "approved" | "sending" | "sent" | "manual" | "dismissed", [import("convex/values").VLiteral<"requested", "required">, import("convex/values").VLiteral<"approved", "required">, import("convex/values").VLiteral<"sending", "required">, import("convex/values").VLiteral<"sent", "required">, import("convex/values").VLiteral<"failed", "required">, import("convex/values").VLiteral<"manual", "required">, import("convex/values").VLiteral<"dismissed", "required">], "required", never>;
        /** Who asked and who approved, as the host names them. */
        requestedBy: import("convex/values").VString<string | undefined, "optional">;
        approvedBy: import("convex/values").VString<string | undefined, "optional">;
        processorRefundId: import("convex/values").VString<string | undefined, "optional">;
        note: import("convex/values").VString<string | undefined, "optional">;
        error: import("convex/values").VString<string | undefined, "optional">;
        createdAt: import("convex/values").VFloat64<number, "required">;
        /** When it last changed status; sweep asks the processor about refunds left sending. */
        updatedAt: import("convex/values").VFloat64<number, "required">;
        sentAt: import("convex/values").VFloat64<number | undefined, "optional">;
        /**
         * Sends the processor refused outright. Each new attempt gets its own idempotency key, because the
         * processors replay a key's first answer; a send whose outcome is unknown keeps its key instead.
         */
        attempts: import("convex/values").VFloat64<number | undefined, "optional">;
    }, "required", "amountCents" | "error" | "reason" | "status" | "checkoutId" | "note" | "processorRefundId" | "origin" | "createdAt" | "requestedBy" | "approvedBy" | "updatedAt" | "sentAt" | "attempts">, {
        by_checkout: ["checkoutId", "_creationTime"];
        by_status: ["status", "updatedAt", "_creationTime"];
        by_processorRefundId: ["processorRefundId", "_creationTime"];
    }, {}, {}>;
    /** Webhook deliveries seen, so a repeat is answered at once. Kept 30 days. */
    events: import("convex/server").TableDefinition<import("convex/values").VObject<{
        processor: "paypal" | "stripe";
        outcome: "foreign" | "received" | "handled" | "ignored";
        eventId: string;
        type: string;
        receivedAt: number;
    }, {
        processor: import("convex/values").VUnion<"paypal" | "stripe", [import("convex/values").VLiteral<"stripe", "required">, import("convex/values").VLiteral<"paypal", "required">], "required", never>;
        eventId: import("convex/values").VString<string, "required">;
        type: import("convex/values").VString<string, "required">;
        receivedAt: import("convex/values").VFloat64<number, "required">;
        outcome: import("convex/values").VUnion<"foreign" | "received" | "handled" | "ignored", [import("convex/values").VLiteral<"received", "required">, import("convex/values").VLiteral<"handled", "required">, import("convex/values").VLiteral<"ignored", "required">, import("convex/values").VLiteral<"foreign", "required">], "required", never>;
    }, "required", "processor" | "outcome" | "eventId" | "type" | "receivedAt">, {
        by_processor_eventId: ["processor", "eventId", "_creationTime"];
    }, {}, {}>;
    /** Differences from the processors, disputes and failed callbacks, for a person to look at. One open per key and kind. */
    issues: import("convex/server").TableDefinition<import("convex/values").VObject<{
        paymentRef?: string | undefined;
        checkoutId?: import("convex/values").GenericId<"checkouts"> | undefined;
        resolvedAt?: number | undefined;
        reportedAt?: number | undefined;
        processor: "paypal" | "stripe";
        detail: string;
        kind: "status_differs" | "amount_differs" | "missing_here" | "missing_there" | "dispute" | "callback_failed";
        key: string;
        openedAt: number;
    }, {
        kind: import("convex/values").VUnion<"status_differs" | "amount_differs" | "missing_here" | "missing_there" | "dispute" | "callback_failed", [import("convex/values").VLiteral<"missing_here", "required">, import("convex/values").VLiteral<"missing_there", "required">, import("convex/values").VLiteral<"amount_differs", "required">, import("convex/values").VLiteral<"status_differs", "required">, import("convex/values").VLiteral<"dispute", "required">, import("convex/values").VLiteral<"callback_failed", "required">], "required", never>;
        /** The payment reference when known, else the processor's checkout id, else the checkout id. */
        key: import("convex/values").VString<string, "required">;
        checkoutId: import("convex/values").VId<import("convex/values").GenericId<"checkouts"> | undefined, "optional">;
        processor: import("convex/values").VUnion<"paypal" | "stripe", [import("convex/values").VLiteral<"stripe", "required">, import("convex/values").VLiteral<"paypal", "required">], "required", never>;
        paymentRef: import("convex/values").VString<string | undefined, "optional">;
        detail: import("convex/values").VString<string, "required">;
        openedAt: import("convex/values").VFloat64<number, "required">;
        resolvedAt: import("convex/values").VFloat64<number | undefined, "optional">;
        /** When a digest told someone about it. */
        reportedAt: import("convex/values").VFloat64<number | undefined, "optional">;
    }, "required", "paymentRef" | "processor" | "detail" | "kind" | "checkoutId" | "key" | "openedAt" | "resolvedAt" | "reportedAt">, {
        by_resolvedAt: ["resolvedAt", "openedAt", "_creationTime"];
        by_key_kind: ["key", "kind", "resolvedAt", "_creationTime"];
        by_reportedAt: ["reportedAt", "openedAt", "_creationTime"];
    }, {}, {}>;
    /** Fixed-window counters for starting checkouts. */
    limits: import("convex/server").TableDefinition<import("convex/values").VObject<{
        key: string;
        windowStart: number;
        count: number;
    }, {
        key: import("convex/values").VString<string, "required">;
        windowStart: import("convex/values").VFloat64<number, "required">;
        count: import("convex/values").VFloat64<number, "required">;
    }, "required", "key" | "windowStart" | "count">, {
        by_key: ["key", "_creationTime"];
        by_windowStart: ["windowStart", "_creationTime"];
    }, {}, {}>;
    /** At most one row. A missing field means the default in settings.ts. */
    settings: import("convex/server").TableDefinition<import("convex/values").VObject<{
        retentionDays?: number | undefined;
        paypalToken?: string | undefined;
        paypalTokenExpiresAt?: number | undefined;
        paypalTokenAccount?: string | undefined;
        searchRefusedAt?: number | undefined;
    }, {
        retentionDays: import("convex/values").VFloat64<number | undefined, "optional">;
        /** The PayPal access token, encrypted with the client secret, for the account in tokenAccount. */
        paypalToken: import("convex/values").VString<string | undefined, "optional">;
        paypalTokenExpiresAt: import("convex/values").VFloat64<number | undefined, "optional">;
        paypalTokenAccount: import("convex/values").VString<string | undefined, "optional">;
        /** Set once PayPal refused Transaction Search, so reconcile logs it once and stops asking for a day. */
        searchRefusedAt: import("convex/values").VFloat64<number | undefined, "optional">;
    }, "required", "retentionDays" | "paypalToken" | "paypalTokenExpiresAt" | "paypalTokenAccount" | "searchRefusedAt">, {}, {}, {}>;
}, true>;
export default _default;
//# sourceMappingURL=schema.d.ts.map