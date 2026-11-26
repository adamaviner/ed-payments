export declare const processor: import("convex/values").VUnion<"stripe" | "paypal", [import("convex/values").VLiteral<"stripe", "required">, import("convex/values").VLiteral<"paypal", "required">], "required", never>;
export declare const method: import("convex/values").VUnion<"paypal" | "card" | "ach", [import("convex/values").VLiteral<"card", "required">, import("convex/values").VLiteral<"ach", "required">, import("convex/values").VLiteral<"paypal", "required">], "required", never>;
/**
 * created: the row exists, the processor hasn't been asked yet. pending: the buyer was sent to the
 * processor. processing: paid by bank transfer, the money not arrived yet. paid: the host recorded
 * the sale. failed: the processor said no. abandoned: expired with nothing paid. refund_needed: the
 * money arrived but the host refused the sale (or the amount was wrong), so it is owed back.
 * "Partly refunded" and "refunded" are read from refundedCents, not statuses.
 */
export declare const checkoutStatus: import("convex/values").VUnion<"processing" | "paid" | "pending" | "failed" | "created" | "abandoned" | "refund_needed", [import("convex/values").VLiteral<"created", "required">, import("convex/values").VLiteral<"pending", "required">, import("convex/values").VLiteral<"processing", "required">, import("convex/values").VLiteral<"paid", "required">, import("convex/values").VLiteral<"failed", "required">, import("convex/values").VLiteral<"abandoned", "required">, import("convex/values").VLiteral<"refund_needed", "required">], "required", never>;
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
    onProcessing?: string | undefined;
}, {
    onPaid: import("convex/values").VString<string | undefined, "optional">;
    onFailed: import("convex/values").VString<string | undefined, "optional">;
    onRefunded: import("convex/values").VString<string | undefined, "optional">;
    onRefundNeeded: import("convex/values").VString<string | undefined, "optional">;
    onDispute: import("convex/values").VString<string | undefined, "optional">;
    onProcessing: import("convex/values").VString<string | undefined, "optional">;
}, "required", "onPaid" | "onFailed" | "onRefunded" | "onRefundNeeded" | "onDispute" | "onProcessing">;
/** hosted: Stripe Checkout or PayPal. offSession: a saved method charged with nobody present. onSession: the buyer pays on the app's page. onPage: a new payment made at the buyer's press on the app's own form. Unset on rows from v0.1: hosted. */
export declare const checkoutKind: import("convex/values").VUnion<"hosted" | "offSession" | "onSession" | "onPage", [import("convex/values").VLiteral<"hosted", "required">, import("convex/values").VLiteral<"offSession", "required">, import("convex/values").VLiteral<"onSession", "required">, import("convex/values").VLiteral<"onPage", "required">], "required", never>;
export declare const savedMethodKind: import("convex/values").VUnion<"card" | "ach", [import("convex/values").VLiteral<"card", "required">, import("convex/values").VLiteral<"ach", "required">], "required", never>;
/** How bad a refused charge was (core/declines.ts): hard ones aren't retried. */
export declare const declineKind: import("convex/values").VUnion<"hard" | "soft" | "insufficient_funds", [import("convex/values").VLiteral<"hard", "required">, import("convex/values").VLiteral<"soft", "required">, import("convex/values").VLiteral<"insufficient_funds", "required">], "required", never>;
/**
 * starting: waiting for its first payment, which also saves the method (startScheduleCheckout).
 * active: charged each period. paused: skipped until pausedUntil, then active again by itself.
 * past_due: a charge was refused and is being retried. lapsed: the retries ran out or the refusal was
 * hard; a new method (updateSchedule) or resumeSchedule starts it again. cancelled: for good.
 */
export declare const scheduleStatus: import("convex/values").VUnion<"starting" | "active" | "paused" | "past_due" | "lapsed" | "cancelled", [import("convex/values").VLiteral<"starting", "required">, import("convex/values").VLiteral<"active", "required">, import("convex/values").VLiteral<"paused", "required">, import("convex/values").VLiteral<"past_due", "required">, import("convex/values").VLiteral<"lapsed", "required">, import("convex/values").VLiteral<"cancelled", "required">], "required", never>;
/** Only monthly for now; kept a field so other intervals can come without a migration. */
export declare const scheduleInterval: import("convex/values").VLiteral<"month", "required">;
/** The host's schedule callbacks as function handles, like a checkout's. */
export declare const scheduleCallbacks: import("convex/values").VObject<{
    onFailed?: string | undefined;
    onCharged?: string | undefined;
    onChanged?: string | undefined;
}, {
    onCharged: import("convex/values").VString<string | undefined, "optional">;
    onFailed: import("convex/values").VString<string | undefined, "optional">;
    onChanged: import("convex/values").VString<string | undefined, "optional">;
}, "required", "onFailed" | "onCharged" | "onChanged">;
/** A PayPal card's network reference from its first payment, sent with later merchant-initiated charges. */
export declare const networkRef: import("convex/values").VObject<{
    network?: string | undefined;
    date?: string | undefined;
    id: string;
}, {
    id: import("convex/values").VString<string, "required">;
    network: import("convex/values").VString<string | undefined, "optional">;
    date: import("convex/values").VString<string | undefined, "optional">;
}, "required", "id" | "network" | "date">;
/**
 * The host's own notes on a refund, e.g. { relist: 'yes' } from a question its admin page asked: kept on
 * the refund, shown in the ledger and passed to on.refunded. Opaque to the library.
 */
export declare const hostData: import("convex/values").VRecord<Record<string, string>, import("convex/values").VString<string, "required">, import("convex/values").VString<string, "required">, "required", string>;
export declare const refundOrigin: import("convex/values").VUnion<"requested" | "needed" | "external", [import("convex/values").VLiteral<"requested", "required">, import("convex/values").VLiteral<"needed", "required">, import("convex/values").VLiteral<"external", "required">], "required", never>;
/**
 * requested → approved → sending → sent, or failed (which may be sent again). manual: refunded outside
 * the app and recorded by hand. dismissed: decided not to refund.
 */
export declare const refundStatus: import("convex/values").VUnion<"failed" | "requested" | "approved" | "sending" | "sent" | "manual" | "dismissed", [import("convex/values").VLiteral<"requested", "required">, import("convex/values").VLiteral<"approved", "required">, import("convex/values").VLiteral<"sending", "required">, import("convex/values").VLiteral<"sent", "required">, import("convex/values").VLiteral<"failed", "required">, import("convex/values").VLiteral<"manual", "required">, import("convex/values").VLiteral<"dismissed", "required">], "required", never>;
export declare const eventOutcome: import("convex/values").VUnion<"foreign" | "received" | "handled" | "ignored", [import("convex/values").VLiteral<"received", "required">, import("convex/values").VLiteral<"handled", "required">, import("convex/values").VLiteral<"ignored", "required">, import("convex/values").VLiteral<"foreign", "required">], "required", never>;
export declare const issueKind: import("convex/values").VUnion<"dispute" | "status_differs" | "amount_differs" | "missing_here" | "missing_there" | "callback_failed" | "charge_unknown", [import("convex/values").VLiteral<"missing_here", "required">, import("convex/values").VLiteral<"missing_there", "required">, import("convex/values").VLiteral<"amount_differs", "required">, import("convex/values").VLiteral<"status_differs", "required">, import("convex/values").VLiteral<"dispute", "required">, import("convex/values").VLiteral<"callback_failed", "required">, import("convex/values").VLiteral<"charge_unknown", "required">], "required", never>;
declare const _default: import("convex/server").SchemaDefinition<{
    checkouts: import("convex/server").TableDefinition<import("convex/values").VObject<{
        kind?: "hosted" | "offSession" | "onSession" | "onPage" | undefined;
        declineCode?: string | undefined;
        processorCheckoutId?: string | undefined;
        chargeKey?: string | undefined;
        paymentRef?: string | undefined;
        context?: any;
        paymentMethodId?: string | undefined;
        retryOf?: import("convex/values").GenericId<"checkouts"> | undefined;
        scheduleId?: import("convex/values").GenericId<"schedules"> | undefined;
        schedulePeriod?: string | undefined;
        stripeCustomerId?: string | undefined;
        paypalDeclinedAt?: number | undefined;
        processorFeeCents?: number | undefined;
        declineKind?: "hard" | "soft" | "insufficient_funds" | undefined;
        paidCents?: number | undefined;
        lastError?: string | undefined;
        chargeAttempts?: number | undefined;
        replacedBy?: import("convex/values").GenericId<"checkouts"> | undefined;
        lastTriedAt?: number | undefined;
        disputed?: boolean | undefined;
        parkedAt?: number | undefined;
        cancelledByBuyerAt?: number | undefined;
        captureClaimedAt?: number | undefined;
        settledAt?: number | undefined;
        method: "paypal" | "card" | "ach";
        expiresAt: number;
        status: "processing" | "paid" | "pending" | "failed" | "created" | "abandoned" | "refund_needed";
        description: string;
        app: string;
        ref: {
            id: string;
            type: string;
        };
        amountCents: number;
        callbacks: {
            onPaid?: string | undefined;
            onFailed?: string | undefined;
            onRefunded?: string | undefined;
            onRefundNeeded?: string | undefined;
            onDispute?: string | undefined;
            onProcessing?: string | undefined;
        };
        cancelUrl: string;
        payer: {
            name?: string | undefined;
            email: string;
        };
        processor: "stripe" | "paypal";
        purpose: string;
        returnUrl: string;
        createdAt: number;
        refundedCents: number;
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
        processor: import("convex/values").VUnion<"stripe" | "paypal", [import("convex/values").VLiteral<"stripe", "required">, import("convex/values").VLiteral<"paypal", "required">], "required", never>;
        method: import("convex/values").VUnion<"paypal" | "card" | "ach", [import("convex/values").VLiteral<"card", "required">, import("convex/values").VLiteral<"ach", "required">, import("convex/values").VLiteral<"paypal", "required">], "required", never>;
        payer: import("convex/values").VObject<{
            name?: string | undefined;
            email: string;
        }, {
            name: import("convex/values").VString<string | undefined, "optional">;
            email: import("convex/values").VString<string, "required">;
        }, "required", "name" | "email">;
        status: import("convex/values").VUnion<"processing" | "paid" | "pending" | "failed" | "created" | "abandoned" | "refund_needed", [import("convex/values").VLiteral<"created", "required">, import("convex/values").VLiteral<"pending", "required">, import("convex/values").VLiteral<"processing", "required">, import("convex/values").VLiteral<"paid", "required">, import("convex/values").VLiteral<"failed", "required">, import("convex/values").VLiteral<"abandoned", "required">, import("convex/values").VLiteral<"refund_needed", "required">], "required", never>;
        kind: import("convex/values").VUnion<"hosted" | "offSession" | "onSession" | "onPage" | undefined, [import("convex/values").VLiteral<"hosted", "required">, import("convex/values").VLiteral<"offSession", "required">, import("convex/values").VLiteral<"onSession", "required">, import("convex/values").VLiteral<"onPage", "required">], "optional", never>;
        /** offSession and onSession: the Stripe Customer charged, and the saved method an offSession charge uses. */
        stripeCustomerId: import("convex/values").VString<string | undefined, "optional">;
        paymentMethodId: import("convex/values").VString<string | undefined, "optional">;
        /** offSession: the app's idempotency key for the charge, so every retry of it replays one charge. */
        chargeKey: import("convex/values").VString<string | undefined, "optional">;
        /** offSession: charge calls whose outcome was unknown (no answer, a 5xx), retried under the same key. */
        chargeAttempts: import("convex/values").VFloat64<number | undefined, "optional">;
        /** offSession: when the last of those was. */
        lastTriedAt: import("convex/values").VFloat64<number | undefined, "optional">;
        /** A schedule's charge (or its first payment): the schedule, and the period ('YYYY-MM') it pays. */
        scheduleId: import("convex/values").VId<import("convex/values").GenericId<"schedules"> | undefined, "optional">;
        schedulePeriod: import("convex/values").VString<string | undefined, "optional">;
        /** failed: the processor's code for the refusal (insufficient_funds, lost_card, INSTRUMENT_DECLINED...) and how bad it is. */
        declineCode: import("convex/values").VString<string | undefined, "optional">;
        declineKind: import("convex/values").VUnion<"hard" | "soft" | "insufficient_funds" | undefined, [import("convex/values").VLiteral<"hard", "required">, import("convex/values").VLiteral<"soft", "required">, import("convex/values").VLiteral<"insufficient_funds", "required">], "optional", never>;
        /** onSession: the checkout this one retries (a declined offSession charge). */
        retryOf: import("convex/values").VId<import("convex/values").GenericId<"checkouts"> | undefined, "optional">;
        /** Stripe's Checkout Session id, PayPal's order id, or (offSession, onSession, onPage) Stripe's PaymentIntent id. */
        processorCheckoutId: import("convex/values").VString<string | undefined, "optional">;
        /** Stripe's PaymentIntent id, or PayPal's capture id: what refunds and disputes point at. */
        paymentRef: import("convex/values").VString<string | undefined, "optional">;
        paidCents: import("convex/values").VFloat64<number | undefined, "optional">;
        refundedCents: import("convex/values").VFloat64<number, "required">;
        /** What the processor actually kept, when it says. */
        processorFeeCents: import("convex/values").VFloat64<number | undefined, "optional">;
        disputed: import("convex/values").VBoolean<boolean | undefined, "optional">;
        /**
         * PayPal declined the card or account the buyer chose at capture: from then on only the buyer
         * captures it (completeReturn), never the webhook or the sweep. lastError says it for people.
         */
        paypalDeclinedAt: import("convex/values").VFloat64<number | undefined, "optional">;
        /**
         * Left out of the sweep's and cleanup's scans, so rows that stay put can't fill the batch: an
         * off-session charge handed to a person (until they retry it), or an old failed checkout kept with its refund.
         */
        parkedAt: import("convex/values").VFloat64<number | undefined, "optional">;
        /** The buyer closed it (cancelCheckout): money that arrives anyway is owed back, not kept. */
        cancelledByBuyerAt: import("convex/values").VFloat64<number | undefined, "optional">;
        /**
         * PayPal: when a capture claimed it (claimCapture), before asking PayPal. The buyer can't cancel
         * while the claim is live; once stale, cancel asks PayPal for the order first.
         */
        captureClaimedAt: import("convex/values").VFloat64<number | undefined, "optional">;
        /**
         * On-page: the checkout a later press started in this one's place (start with replaces), set in the
         * same transaction that made it, so a second press naming this one finds that checkout instead of making another.
         */
        replacedBy: import("convex/values").VId<import("convex/values").GenericId<"checkouts"> | undefined, "optional">;
        callbacks: import("convex/values").VObject<{
            onPaid?: string | undefined;
            onFailed?: string | undefined;
            onRefunded?: string | undefined;
            onRefundNeeded?: string | undefined;
            onDispute?: string | undefined;
            onProcessing?: string | undefined;
        }, {
            onPaid: import("convex/values").VString<string | undefined, "optional">;
            onFailed: import("convex/values").VString<string | undefined, "optional">;
            onRefunded: import("convex/values").VString<string | undefined, "optional">;
            onRefundNeeded: import("convex/values").VString<string | undefined, "optional">;
            onDispute: import("convex/values").VString<string | undefined, "optional">;
            onProcessing: import("convex/values").VString<string | undefined, "optional">;
        }, "required", "onPaid" | "onFailed" | "onRefunded" | "onRefundNeeded" | "onDispute" | "onProcessing">;
        /** Passed to every callback as it was given to start. */
        context: import("convex/values").VAny<any, "optional", string>;
        returnUrl: import("convex/values").VString<string, "required">;
        cancelUrl: import("convex/values").VString<string, "required">;
        expiresAt: import("convex/values").VFloat64<number, "required">;
        createdAt: import("convex/values").VFloat64<number, "required">;
        settledAt: import("convex/values").VFloat64<number | undefined, "optional">;
        lastError: import("convex/values").VString<string | undefined, "optional">;
    }, "required", "method" | "expiresAt" | "kind" | "status" | "declineCode" | "description" | "app" | "processorCheckoutId" | "chargeKey" | "paymentRef" | "ref" | "amountCents" | "callbacks" | "cancelUrl" | "context" | "payer" | "paymentMethodId" | "processor" | "purpose" | "retryOf" | "returnUrl" | "scheduleId" | "schedulePeriod" | "stripeCustomerId" | "paypalDeclinedAt" | "processorFeeCents" | "declineKind" | "paidCents" | "createdAt" | "refundedCents" | "lastError" | "chargeAttempts" | "replacedBy" | "lastTriedAt" | "disputed" | "parkedAt" | "cancelledByBuyerAt" | "captureClaimedAt" | "settledAt" | "ref.id" | "ref.type" | "callbacks.onPaid" | "callbacks.onFailed" | "callbacks.onRefunded" | "callbacks.onRefundNeeded" | "callbacks.onDispute" | "callbacks.onProcessing" | `context.${string}` | "payer.name" | "payer.email">, {
        by_status_parked_expiresAt: ["status", "parkedAt", "expiresAt", "_creationTime"];
        by_processorCheckoutId: ["processorCheckoutId", "_creationTime"];
        by_paymentRef: ["paymentRef", "_creationTime"];
        by_ref: ["ref.type", "ref.id", "_creationTime"];
        by_createdAt: ["createdAt", "_creationTime"];
        by_status_createdAt: ["status", "createdAt", "_creationTime"];
        by_retryOf: ["retryOf", "_creationTime"];
        by_chargeKey: ["chargeKey", "_creationTime"];
        by_scheduleId: ["scheduleId", "_creationTime"];
    }, {}, {}>;
    /**
     * Repeating charges of a saved method (monthly gifts): the library charges each due one with an
     * off-session checkout keyed `schedule-<id>-<period>`, so a period is never charged twice. Kept
     * forever, as the record of what a payer agreed to; small (one per agreement).
     */
    schedules: import("convex/server").TableDefinition<import("convex/values").VObject<{
        context?: any;
        paymentMethodId?: string | undefined;
        lastError?: string | undefined;
        lastPaidPeriod?: string | undefined;
        pausedUntil?: number | undefined;
        firstFailedAt?: number | undefined;
        lastCheckoutId?: import("convex/values").GenericId<"checkouts"> | undefined;
        endReason?: string | undefined;
        endedBy?: string | undefined;
        endedAt?: number | undefined;
        neverStarted?: boolean | undefined;
        paypalVaultPending?: {
            networkRef?: {
                network?: string | undefined;
                date?: string | undefined;
                id: string;
            } | undefined;
            paypalCustomerId?: string | undefined;
            lastCheckAt?: number | undefined;
            orderId: string;
            since: number;
        } | undefined;
        method: "paypal" | "card" | "ach";
        status: "starting" | "active" | "paused" | "past_due" | "lapsed" | "cancelled";
        description: string;
        app: string;
        owner: {
            id: string;
            type: string;
        };
        ref: {
            id: string;
            type: string;
        };
        amountCents: number;
        callbacks: {
            onFailed?: string | undefined;
            onCharged?: string | undefined;
            onChanged?: string | undefined;
        };
        payer: {
            name?: string | undefined;
            email: string;
        };
        processor: "stripe" | "paypal";
        purpose: string;
        period: string;
        anchorDay: number;
        hourUTC: number;
        retryDays: number[];
        createdAt: number;
        nextChargeAt: number;
        updatedAt: number;
        interval: "month";
        firstPeriod: string;
        periodAttempts: number;
        failures: number;
    }, {
        app: import("convex/values").VString<string, "required">;
        /** Whose saved method it charges (as given to setupPaymentMethod / savePaypalMethod). */
        owner: import("convex/values").VObject<{
            id: string;
            type: string;
        }, {
            type: import("convex/values").VString<string, "required">;
            id: import("convex/values").VString<string, "required">;
        }, "required", "id" | "type">;
        /** What it is for in the app, e.g. { type: 'monthlyDonation', id }. */
        ref: import("convex/values").VObject<{
            id: string;
            type: string;
        }, {
            type: import("convex/values").VString<string, "required">;
            id: import("convex/values").VString<string, "required">;
        }, "required", "id" | "type">;
        purpose: import("convex/values").VString<string, "required">;
        description: import("convex/values").VString<string, "required">;
        payer: import("convex/values").VObject<{
            name?: string | undefined;
            email: string;
        }, {
            name: import("convex/values").VString<string | undefined, "optional">;
            email: import("convex/values").VString<string, "required">;
        }, "required", "name" | "email">;
        processor: import("convex/values").VUnion<"stripe" | "paypal", [import("convex/values").VLiteral<"stripe", "required">, import("convex/values").VLiteral<"paypal", "required">], "required", never>;
        method: import("convex/values").VUnion<"paypal" | "card" | "ach", [import("convex/values").VLiteral<"card", "required">, import("convex/values").VLiteral<"ach", "required">, import("convex/values").VLiteral<"paypal", "required">], "required", never>;
        /** The library's saved-method id (pm_… or paypal:…); unset while starting. */
        paymentMethodId: import("convex/values").VString<string | undefined, "optional">;
        amountCents: import("convex/values").VFloat64<number, "required">;
        interval: import("convex/values").VLiteral<"month", "required">;
        /** Day of the month it is charged (1-28), at hourUTC. */
        anchorDay: import("convex/values").VFloat64<number, "required">;
        hourUTC: import("convex/values").VFloat64<number, "required">;
        status: import("convex/values").VUnion<"starting" | "active" | "paused" | "past_due" | "lapsed" | "cancelled", [import("convex/values").VLiteral<"starting", "required">, import("convex/values").VLiteral<"active", "required">, import("convex/values").VLiteral<"paused", "required">, import("convex/values").VLiteral<"past_due", "required">, import("convex/values").VLiteral<"lapsed", "required">, import("convex/values").VLiteral<"cancelled", "required">], "required", never>;
        /** When the worker next acts on it: the period's charge, a retry, or the end of a pause. */
        nextChargeAt: import("convex/values").VFloat64<number, "required">;
        /** The period ('YYYY-MM') the next charge pays, and the one it started with. */
        period: import("convex/values").VString<string, "required">;
        firstPeriod: import("convex/values").VString<string, "required">;
        /** Charges made for that period so far (each try has its own idempotency key). */
        periodAttempts: import("convex/values").VFloat64<number, "required">;
        /** The last period paid (or on its way, for a bank debit), so a resume or anchor change never charges it again. */
        lastPaidPeriod: import("convex/values").VString<string | undefined, "optional">;
        pausedUntil: import("convex/values").VFloat64<number | undefined, "optional">;
        /** Days after a period's first refusal that it is tried again (default 3, 5, 7); then it lapses. */
        retryDays: import("convex/values").VArray<number[], import("convex/values").VFloat64<number, "required">, "required">;
        /** Refusals in the current period, and when the first was (retries count from it). */
        failures: import("convex/values").VFloat64<number, "required">;
        firstFailedAt: import("convex/values").VFloat64<number | undefined, "optional">;
        lastCheckoutId: import("convex/values").VId<import("convex/values").GenericId<"checkouts"> | undefined, "optional">;
        lastError: import("convex/values").VString<string | undefined, "optional">;
        /** cancelled or lapsed: why, and who (cancelled through the API) or what (the processor). */
        endReason: import("convex/values").VString<string | undefined, "optional">;
        endedBy: import("convex/values").VString<string | undefined, "optional">;
        endedAt: import("convex/values").VFloat64<number | undefined, "optional">;
        /**
         * Cancelled because its first payment wasn't completed (its checkout expired or failed), not by
         * anyone: a first payment that arrives anyway, on a checkout the payer didn't cancel, starts it.
         */
        neverStarted: import("convex/values").VBoolean<boolean | undefined, "optional">;
        /**
         * PayPal took the first payment but answered vault status APPROVED, not VAULTED: the method is
         * saved later, and its token shows on the order (read again by the schedules worker) and comes in
         * VAULT.PAYMENT-TOKEN.CREATED. Until then (at most three days) the schedule waits for it instead
         * of failing for want of a method. orderId is the first
         * payment's order; paypalCustomerId the PayPal customer the token will belong to, when known;
         * networkRef the card's reference from that capture, for later recurring charges.
         */
        paypalVaultPending: import("convex/values").VObject<{
            networkRef?: {
                network?: string | undefined;
                date?: string | undefined;
                id: string;
            } | undefined;
            paypalCustomerId?: string | undefined;
            lastCheckAt?: number | undefined;
            orderId: string;
            since: number;
        } | undefined, {
            orderId: import("convex/values").VString<string, "required">;
            paypalCustomerId: import("convex/values").VString<string | undefined, "optional">;
            networkRef: import("convex/values").VObject<{
                network?: string | undefined;
                date?: string | undefined;
                id: string;
            } | undefined, {
                id: import("convex/values").VString<string, "required">;
                network: import("convex/values").VString<string | undefined, "optional">;
                date: import("convex/values").VString<string | undefined, "optional">;
            }, "optional", "id" | "network" | "date">;
            since: import("convex/values").VFloat64<number, "required">;
            lastCheckAt: import("convex/values").VFloat64<number | undefined, "optional">;
        }, "optional", "networkRef" | "orderId" | "since" | "paypalCustomerId" | "lastCheckAt" | "networkRef.id" | "networkRef.network" | "networkRef.date">;
        callbacks: import("convex/values").VObject<{
            onFailed?: string | undefined;
            onCharged?: string | undefined;
            onChanged?: string | undefined;
        }, {
            onCharged: import("convex/values").VString<string | undefined, "optional">;
            onFailed: import("convex/values").VString<string | undefined, "optional">;
            onChanged: import("convex/values").VString<string | undefined, "optional">;
        }, "required", "onFailed" | "onCharged" | "onChanged">;
        /** Passed to every charge's callbacks and the schedule's own. */
        context: import("convex/values").VAny<any, "optional", string>;
        createdAt: import("convex/values").VFloat64<number, "required">;
        updatedAt: import("convex/values").VFloat64<number, "required">;
    }, "required", "method" | "status" | "description" | "app" | "owner" | "ref" | "amountCents" | "callbacks" | "context" | "payer" | "paymentMethodId" | "processor" | "purpose" | "period" | "anchorDay" | "hourUTC" | "retryDays" | "createdAt" | "nextChargeAt" | "lastError" | "updatedAt" | "ref.id" | "ref.type" | "callbacks.onFailed" | `context.${string}` | "payer.name" | "payer.email" | "interval" | "firstPeriod" | "periodAttempts" | "lastPaidPeriod" | "pausedUntil" | "failures" | "firstFailedAt" | "lastCheckoutId" | "endReason" | "endedBy" | "endedAt" | "neverStarted" | "paypalVaultPending" | "owner.id" | "owner.type" | "callbacks.onCharged" | "callbacks.onChanged" | "paypalVaultPending.networkRef" | "paypalVaultPending.orderId" | "paypalVaultPending.since" | "paypalVaultPending.paypalCustomerId" | "paypalVaultPending.lastCheckAt" | "paypalVaultPending.networkRef.id" | "paypalVaultPending.networkRef.network" | "paypalVaultPending.networkRef.date">, {
        by_app_status_nextChargeAt: ["app", "status", "nextChargeAt", "_creationTime"];
        by_owner: ["app", "owner.type", "owner.id", "_creationTime"];
        by_ref: ["ref.type", "ref.id", "_creationTime"];
        by_paymentMethodId: ["paymentMethodId", "_creationTime"];
        by_app_paypalVaultCustomer: ["app", "paypalVaultPending.paypalCustomerId", "_creationTime"];
    }, {}, {}>;
    /** One Stripe Customer per payer of the app (owner: e.g. { type: 'user', id }), for saved payment methods. */
    customers: import("convex/server").TableDefinition<import("convex/values").VObject<{
        app: string;
        email: string;
        owner: {
            id: string;
            type: string;
        };
        stripeCustomerId: string;
        createdAt: number;
    }, {
        app: import("convex/values").VString<string, "required">;
        owner: import("convex/values").VObject<{
            id: string;
            type: string;
        }, {
            type: import("convex/values").VString<string, "required">;
            id: import("convex/values").VString<string, "required">;
        }, "required", "id" | "type">;
        stripeCustomerId: import("convex/values").VString<string, "required">;
        email: import("convex/values").VString<string, "required">;
        createdAt: import("convex/values").VFloat64<number, "required">;
    }, "required", "app" | "email" | "owner" | "stripeCustomerId" | "createdAt" | "owner.id" | "owner.type">, {
        by_owner: ["app", "owner.type", "owner.id", "_creationTime"];
        by_stripeCustomerId: ["stripeCustomerId", "_creationTime"];
    }, {}, {}>;
    /**
     * Saved methods the library has seen for a customer: what they are, and whether an off-session
     * charge of one was declined, so it isn't offered again. Stripe holds the method itself.
     */
    paymentMethods: import("convex/server").TableDefinition<import("convex/values").VObject<{
        declinedAt?: number | undefined;
        declineReason?: string | undefined;
        removedAt?: number | undefined;
        customerId: import("convex/values").GenericId<"customers">;
        kind: "card" | "ach";
        label: string;
        stripePaymentMethodId: string;
        createdAt: number;
    }, {
        customerId: import("convex/values").VId<import("convex/values").GenericId<"customers">, "required">;
        stripePaymentMethodId: import("convex/values").VString<string, "required">;
        kind: import("convex/values").VUnion<"card" | "ach", [import("convex/values").VLiteral<"card", "required">, import("convex/values").VLiteral<"ach", "required">], "required", never>;
        label: import("convex/values").VString<string, "required">;
        declinedAt: import("convex/values").VFloat64<number | undefined, "optional">;
        declineReason: import("convex/values").VString<string | undefined, "optional">;
        /** The owner removed it (removeSavedMethod); it is detached at Stripe too, and never offered again. */
        removedAt: import("convex/values").VFloat64<number | undefined, "optional">;
        createdAt: import("convex/values").VFloat64<number, "required">;
    }, "required", "customerId" | "kind" | "label" | "stripePaymentMethodId" | "createdAt" | "declinedAt" | "declineReason" | "removedAt">, {
        by_customer: ["customerId", "_creationTime"];
        by_stripePaymentMethodId: ["stripePaymentMethodId", "_creationTime"];
    }, {}, {}>;
    /** One PayPal vault customer per payer of the app, made by PayPal the first time they save a card or account. */
    paypalCustomers: import("convex/server").TableDefinition<import("convex/values").VObject<{
        app: string;
        owner: {
            id: string;
            type: string;
        };
        paypalCustomerId: string;
        createdAt: number;
    }, {
        app: import("convex/values").VString<string, "required">;
        owner: import("convex/values").VObject<{
            id: string;
            type: string;
        }, {
            type: import("convex/values").VString<string, "required">;
            id: import("convex/values").VString<string, "required">;
        }, "required", "id" | "type">;
        paypalCustomerId: import("convex/values").VString<string, "required">;
        createdAt: import("convex/values").VFloat64<number, "required">;
    }, "required", "app" | "owner" | "paypalCustomerId" | "createdAt" | "owner.id" | "owner.type">, {
        by_owner: ["app", "owner.type", "owner.id", "_creationTime"];
        by_paypalCustomerId: ["paypalCustomerId", "_creationTime"];
    }, {}, {}>;
    /**
     * Cards and PayPal accounts saved in PayPal's vault. Unlike Stripe's, these rows are the list the
     * library offers: PayPal's own list of a customer's methods lags (a method saved seconds ago is
     * missing, a deleted one still shown; seen in the sandbox 2026-11-19). A removed method's row stays, marked.
     */
    paypalMethods: import("convex/server").TableDefinition<import("convex/values").VObject<{
        networkRef?: {
            network?: string | undefined;
            date?: string | undefined;
            id: string;
        } | undefined;
        usagePattern?: string | undefined;
        declinedAt?: number | undefined;
        declineReason?: string | undefined;
        removedAt?: number | undefined;
        customerId: import("convex/values").GenericId<"paypalCustomers">;
        kind: "paypal" | "card";
        label: string;
        paymentTokenId: string;
        createdAt: number;
    }, {
        customerId: import("convex/values").VId<import("convex/values").GenericId<"paypalCustomers">, "required">;
        /** PayPal's payment token id: the vault_id a charge names. */
        paymentTokenId: import("convex/values").VString<string, "required">;
        kind: import("convex/values").VUnion<"paypal" | "card", [import("convex/values").VLiteral<"card", "required">, import("convex/values").VLiteral<"paypal", "required">], "required", never>;
        label: import("convex/values").VString<string, "required">;
        /** A PayPal account's agreement (UNSCHEDULED_POSTPAID, RECURRING_PREPAID...), sent back with recurring charges. */
        usagePattern: import("convex/values").VString<string | undefined, "optional">;
        /** A card saved with a payment: its first payment's network reference, for later merchant-initiated charges. */
        networkRef: import("convex/values").VObject<{
            network?: string | undefined;
            date?: string | undefined;
            id: string;
        } | undefined, {
            id: import("convex/values").VString<string, "required">;
            network: import("convex/values").VString<string | undefined, "optional">;
            date: import("convex/values").VString<string | undefined, "optional">;
        }, "optional", "id" | "network" | "date">;
        declinedAt: import("convex/values").VFloat64<number | undefined, "optional">;
        declineReason: import("convex/values").VString<string | undefined, "optional">;
        /** The owner removed it (deleted from PayPal's vault); kept so a charge of it fails instead of erring, and it can't be saved again. */
        removedAt: import("convex/values").VFloat64<number | undefined, "optional">;
        createdAt: import("convex/values").VFloat64<number, "required">;
    }, "required", "customerId" | "kind" | "networkRef" | "usagePattern" | "label" | "paymentTokenId" | "createdAt" | "networkRef.id" | "networkRef.network" | "networkRef.date" | "declinedAt" | "declineReason" | "removedAt">, {
        by_customer: ["customerId", "_creationTime"];
        by_paymentTokenId: ["paymentTokenId", "_creationTime"];
    }, {}, {}>;
    /** The refund ledger: many per checkout. Kept forever, as a financial record. */
    refunds: import("convex/server").TableDefinition<import("convex/values").VObject<{
        error?: string | undefined;
        note?: string | undefined;
        processorRefundId?: string | undefined;
        hostData?: Record<string, string> | undefined;
        approvedBy?: string | undefined;
        attempts?: number | undefined;
        requestedBy?: string | undefined;
        sentAt?: number | undefined;
        status: "failed" | "requested" | "approved" | "sending" | "sent" | "manual" | "dismissed";
        checkoutId: import("convex/values").GenericId<"checkouts">;
        amountCents: number;
        reason: string;
        createdAt: number;
        origin: "requested" | "needed" | "external";
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
        hostData: import("convex/values").VRecord<Record<string, string> | undefined, import("convex/values").VString<string, "required">, import("convex/values").VString<string, "required">, "optional", string>;
    }, "required", "status" | "checkoutId" | "amountCents" | "error" | "reason" | "note" | "processorRefundId" | "hostData" | "createdAt" | "origin" | "approvedBy" | "attempts" | "requestedBy" | "sentAt" | "updatedAt" | `hostData.${string}`>, {
        by_checkout: ["checkoutId", "_creationTime"];
        by_status: ["status", "updatedAt", "_creationTime"];
        by_processorRefundId: ["processorRefundId", "_creationTime"];
    }, {}, {}>;
    /**
     * Disputes (chargebacks), one row each, so a payment with two is disputed until both end, and what a
     * lost one took back is off what is left to refund. Kept forever, with their payments.
     */
    disputes: import("convex/server").TableDefinition<import("convex/values").VObject<{
        amountCents?: number | undefined;
        outcome?: string | undefined;
        closedAt?: number | undefined;
        status: "open" | "lost" | "won";
        checkoutId: import("convex/values").GenericId<"checkouts">;
        processor: "stripe" | "paypal";
        disputeId: string;
        openedAt: number;
    }, {
        checkoutId: import("convex/values").VId<import("convex/values").GenericId<"checkouts">, "required">;
        processor: import("convex/values").VUnion<"stripe" | "paypal", [import("convex/values").VLiteral<"stripe", "required">, import("convex/values").VLiteral<"paypal", "required">], "required", never>;
        disputeId: import("convex/values").VString<string, "required">;
        status: import("convex/values").VUnion<"open" | "lost" | "won", [import("convex/values").VLiteral<"open", "required">, import("convex/values").VLiteral<"won", "required">, import("convex/values").VLiteral<"lost", "required">], "required", never>;
        amountCents: import("convex/values").VFloat64<number | undefined, "optional">;
        /** How it ended, in the processor's words. */
        outcome: import("convex/values").VString<string | undefined, "optional">;
        openedAt: import("convex/values").VFloat64<number, "required">;
        closedAt: import("convex/values").VFloat64<number | undefined, "optional">;
    }, "required", "status" | "checkoutId" | "amountCents" | "processor" | "disputeId" | "outcome" | "openedAt" | "closedAt">, {
        by_disputeId: ["processor", "disputeId", "_creationTime"];
        by_checkout: ["checkoutId", "_creationTime"];
    }, {}, {}>;
    /** Webhook deliveries seen, so a repeat is answered at once. Kept 30 days. */
    events: import("convex/server").TableDefinition<import("convex/values").VObject<{
        type: string;
        processor: "stripe" | "paypal";
        outcome: "foreign" | "received" | "handled" | "ignored";
        eventId: string;
        receivedAt: number;
    }, {
        processor: import("convex/values").VUnion<"stripe" | "paypal", [import("convex/values").VLiteral<"stripe", "required">, import("convex/values").VLiteral<"paypal", "required">], "required", never>;
        eventId: import("convex/values").VString<string, "required">;
        type: import("convex/values").VString<string, "required">;
        receivedAt: import("convex/values").VFloat64<number, "required">;
        outcome: import("convex/values").VUnion<"foreign" | "received" | "handled" | "ignored", [import("convex/values").VLiteral<"received", "required">, import("convex/values").VLiteral<"handled", "required">, import("convex/values").VLiteral<"ignored", "required">, import("convex/values").VLiteral<"foreign", "required">], "required", never>;
    }, "required", "type" | "processor" | "outcome" | "eventId" | "receivedAt">, {
        by_processor_eventId: ["processor", "eventId", "_creationTime"];
    }, {}, {}>;
    /** Differences from the processors, disputes and failed callbacks, for a person to look at. One open per key and kind. */
    issues: import("convex/server").TableDefinition<import("convex/values").VObject<{
        checkoutId?: import("convex/values").GenericId<"checkouts"> | undefined;
        paymentRef?: string | undefined;
        resolvedAt?: number | undefined;
        reportedAt?: number | undefined;
        kind: "dispute" | "status_differs" | "amount_differs" | "missing_here" | "missing_there" | "callback_failed" | "charge_unknown";
        processor: "stripe" | "paypal";
        detail: string;
        key: string;
        openedAt: number;
    }, {
        kind: import("convex/values").VUnion<"dispute" | "status_differs" | "amount_differs" | "missing_here" | "missing_there" | "callback_failed" | "charge_unknown", [import("convex/values").VLiteral<"missing_here", "required">, import("convex/values").VLiteral<"missing_there", "required">, import("convex/values").VLiteral<"amount_differs", "required">, import("convex/values").VLiteral<"status_differs", "required">, import("convex/values").VLiteral<"dispute", "required">, import("convex/values").VLiteral<"callback_failed", "required">, import("convex/values").VLiteral<"charge_unknown", "required">], "required", never>;
        /** The payment reference when known, else the processor's checkout id, else the checkout id. */
        key: import("convex/values").VString<string, "required">;
        checkoutId: import("convex/values").VId<import("convex/values").GenericId<"checkouts"> | undefined, "optional">;
        processor: import("convex/values").VUnion<"stripe" | "paypal", [import("convex/values").VLiteral<"stripe", "required">, import("convex/values").VLiteral<"paypal", "required">], "required", never>;
        paymentRef: import("convex/values").VString<string | undefined, "optional">;
        detail: import("convex/values").VString<string, "required">;
        openedAt: import("convex/values").VFloat64<number, "required">;
        resolvedAt: import("convex/values").VFloat64<number | undefined, "optional">;
        /** When a digest told someone about it. */
        reportedAt: import("convex/values").VFloat64<number | undefined, "optional">;
    }, "required", "kind" | "checkoutId" | "paymentRef" | "processor" | "detail" | "key" | "openedAt" | "resolvedAt" | "reportedAt">, {
        by_resolvedAt: ["resolvedAt", "openedAt", "_creationTime"];
        by_key_kind: ["key", "kind", "resolvedAt", "_creationTime"];
        by_reportedAt: ["reportedAt", "openedAt", "_creationTime"];
    }, {}, {}>;
    /** Fixed-window counters for the public entries (starting checkouts, saving methods, retries, return pages). */
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