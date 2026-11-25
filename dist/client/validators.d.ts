import { type GenericValidator, type Infer, type ObjectType } from 'convex/values';
export declare const issueArg: import("convex/values").VObject<{
    kind: string;
    id: string;
    checkoutId: string | null;
    processor: "stripe" | "paypal";
    detail: string;
    openedAt: number;
}, {
    id: import("convex/values").VString<string, "required">;
    kind: import("convex/values").VString<string, "required">;
    detail: import("convex/values").VString<string, "required">;
    checkoutId: import("convex/values").VUnion<string | null, [import("convex/values").VString<string, "required">, import("convex/values").VNull<null, "required">], "required", never>;
    processor: import("convex/values").VUnion<"stripe" | "paypal", [import("convex/values").VLiteral<"stripe", "required">, import("convex/values").VLiteral<"paypal", "required">], "required", never>;
    openedAt: import("convex/values").VFloat64<number, "required">;
}, "required", "kind" | "id" | "checkoutId" | "processor" | "detail" | "openedAt">;
/** The arguments of each callback, for an app whose context is `context`. */
export declare function callbackArgs<C extends GenericValidator>(context: C): {
    /** paid: the money arrived. Record the sale; return null, or { refuse } to have it refunded instead (throwing does the same). */
    paid: {
        amountCents: import("convex/values").VFloat64<number, "required">;
        paidCents: import("convex/values").VFloat64<number, "required">;
        paymentRef: import("convex/values").VString<string, "required">;
        checkoutId: import("convex/values").VString<string, "required">;
        ref: import("convex/values").VObject<{
            id: string;
            type: string;
        }, {
            type: import("convex/values").VString<string, "required">;
            id: import("convex/values").VString<string, "required">;
        }, "required", "id" | "type">;
        purpose: import("convex/values").VString<string, "required">;
        kind: import("convex/values").VUnion<"hosted" | "offSession" | "onSession", [import("convex/values").VLiteral<"hosted", "required">, import("convex/values").VLiteral<"offSession", "required">, import("convex/values").VLiteral<"onSession", "required">], "required", never>;
        processor: import("convex/values").VUnion<"stripe" | "paypal", [import("convex/values").VLiteral<"stripe", "required">, import("convex/values").VLiteral<"paypal", "required">], "required", never>;
        method: import("convex/values").VUnion<"paypal" | "card" | "ach", [import("convex/values").VLiteral<"card", "required">, import("convex/values").VLiteral<"ach", "required">, import("convex/values").VLiteral<"paypal", "required">], "required", never>;
        payer: import("convex/values").VObject<{
            name?: string | undefined;
            email: string;
        }, {
            name: import("convex/values").VString<string | undefined, "optional">;
            email: import("convex/values").VString<string, "required">;
        }, "required", "name" | "email">;
        /** What the host passed to start or chargeSaved as `context`. */
        context: C;
    };
    /**
     * failed: the processor said no (a declined capture or card, a bounced bank debit), or a person gave
     * up on a charge. declined: the bank refused the method. wasProcessing: a bank payment that had been
     * accepted bounced.
     */
    failed: {
        reason: import("convex/values").VString<string, "required">;
        declined: import("convex/values").VBoolean<boolean, "required">;
        wasProcessing: import("convex/values").VBoolean<boolean, "required">;
        /** The processor's code for the refusal (insufficient_funds, lost_card, INSTRUMENT_DECLINED...), when it gave one; METHOD_NOT_SAVED when chargeSaved's method isn't saved for the payer (nothing charged). */
        declineCode: import("convex/values").VUnion<string | null | undefined, [import("convex/values").VString<string, "required">, import("convex/values").VNull<null, "required">], "optional", never>;
        checkoutId: import("convex/values").VString<string, "required">;
        ref: import("convex/values").VObject<{
            id: string;
            type: string;
        }, {
            type: import("convex/values").VString<string, "required">;
            id: import("convex/values").VString<string, "required">;
        }, "required", "id" | "type">;
        purpose: import("convex/values").VString<string, "required">;
        kind: import("convex/values").VUnion<"hosted" | "offSession" | "onSession", [import("convex/values").VLiteral<"hosted", "required">, import("convex/values").VLiteral<"offSession", "required">, import("convex/values").VLiteral<"onSession", "required">], "required", never>;
        processor: import("convex/values").VUnion<"stripe" | "paypal", [import("convex/values").VLiteral<"stripe", "required">, import("convex/values").VLiteral<"paypal", "required">], "required", never>;
        method: import("convex/values").VUnion<"paypal" | "card" | "ach", [import("convex/values").VLiteral<"card", "required">, import("convex/values").VLiteral<"ach", "required">, import("convex/values").VLiteral<"paypal", "required">], "required", never>;
        payer: import("convex/values").VObject<{
            name?: string | undefined;
            email: string;
        }, {
            name: import("convex/values").VString<string | undefined, "optional">;
            email: import("convex/values").VString<string, "required">;
        }, "required", "name" | "email">;
        /** What the host passed to start or chargeSaved as `context`. */
        context: C;
    };
    /**
     * refunded: a refund went back to the buyer (sent, done by hand, or made at the processor). May come
     * twice for one refundId (a refund the processor failed after sending, then sent again): act on it
     * idempotently.
     */
    refunded: {
        refundId: import("convex/values").VString<string, "required">;
        amountCents: import("convex/values").VFloat64<number, "required">;
        refundedCents: import("convex/values").VFloat64<number, "required">;
        paidCents: import("convex/values").VFloat64<number, "required">;
        origin: import("convex/values").VUnion<"requested" | "needed" | "external", [import("convex/values").VLiteral<"requested", "required">, import("convex/values").VLiteral<"needed", "required">, import("convex/values").VLiteral<"external", "required">], "required", never>;
        /** What the app passed to requestRefund as hostData (e.g. its admin's answer to a question); unset for others. */
        hostData: import("convex/values").VRecord<Record<string, string> | undefined, import("convex/values").VString<string, "required">, import("convex/values").VString<string, "required">, "optional", string>;
        /**
         * true: the processor failed this refund after reporting it done, so the money didn't go back after
         * all; take it off again (refundedCents is already without it). It may then be sent again.
         */
        reversed: import("convex/values").VBoolean<boolean | undefined, "optional">;
        checkoutId: import("convex/values").VString<string, "required">;
        ref: import("convex/values").VObject<{
            id: string;
            type: string;
        }, {
            type: import("convex/values").VString<string, "required">;
            id: import("convex/values").VString<string, "required">;
        }, "required", "id" | "type">;
        purpose: import("convex/values").VString<string, "required">;
        kind: import("convex/values").VUnion<"hosted" | "offSession" | "onSession", [import("convex/values").VLiteral<"hosted", "required">, import("convex/values").VLiteral<"offSession", "required">, import("convex/values").VLiteral<"onSession", "required">], "required", never>;
        processor: import("convex/values").VUnion<"stripe" | "paypal", [import("convex/values").VLiteral<"stripe", "required">, import("convex/values").VLiteral<"paypal", "required">], "required", never>;
        method: import("convex/values").VUnion<"paypal" | "card" | "ach", [import("convex/values").VLiteral<"card", "required">, import("convex/values").VLiteral<"ach", "required">, import("convex/values").VLiteral<"paypal", "required">], "required", never>;
        payer: import("convex/values").VObject<{
            name?: string | undefined;
            email: string;
        }, {
            name: import("convex/values").VString<string | undefined, "optional">;
            email: import("convex/values").VString<string, "required">;
        }, "required", "name" | "email">;
        /** What the host passed to start or chargeSaved as `context`. */
        context: C;
    };
    /** refundNeeded: money arrived for a sale the host refused; a refund for it is waiting. */
    refundNeeded: {
        amountCents: import("convex/values").VFloat64<number, "required">;
        paidCents: import("convex/values").VFloat64<number, "required">;
        paymentRef: import("convex/values").VString<string, "required">;
        refundId: import("convex/values").VString<string, "required">;
        reason: import("convex/values").VString<string, "required">;
        checkoutId: import("convex/values").VString<string, "required">;
        ref: import("convex/values").VObject<{
            id: string;
            type: string;
        }, {
            type: import("convex/values").VString<string, "required">;
            id: import("convex/values").VString<string, "required">;
        }, "required", "id" | "type">;
        purpose: import("convex/values").VString<string, "required">;
        kind: import("convex/values").VUnion<"hosted" | "offSession" | "onSession", [import("convex/values").VLiteral<"hosted", "required">, import("convex/values").VLiteral<"offSession", "required">, import("convex/values").VLiteral<"onSession", "required">], "required", never>;
        processor: import("convex/values").VUnion<"stripe" | "paypal", [import("convex/values").VLiteral<"stripe", "required">, import("convex/values").VLiteral<"paypal", "required">], "required", never>;
        method: import("convex/values").VUnion<"paypal" | "card" | "ach", [import("convex/values").VLiteral<"card", "required">, import("convex/values").VLiteral<"ach", "required">, import("convex/values").VLiteral<"paypal", "required">], "required", never>;
        payer: import("convex/values").VObject<{
            name?: string | undefined;
            email: string;
        }, {
            name: import("convex/values").VString<string | undefined, "optional">;
            email: import("convex/values").VString<string, "required">;
        }, "required", "name" | "email">;
        /** What the host passed to start or chargeSaved as `context`. */
        context: C;
    };
    /** dispute: the buyer disputed the payment (opened), or the dispute ended (closed). */
    dispute: {
        paymentRef: import("convex/values").VString<string, "required">;
        disputeId: import("convex/values").VString<string, "required">;
        status: import("convex/values").VUnion<"opened" | "closed", [import("convex/values").VLiteral<"opened", "required">, import("convex/values").VLiteral<"closed", "required">], "required", never>;
        outcome: import("convex/values").VUnion<string | null, [import("convex/values").VString<string, "required">, import("convex/values").VNull<null, "required">], "required", never>;
        reason: import("convex/values").VUnion<string | null, [import("convex/values").VString<string, "required">, import("convex/values").VNull<null, "required">], "required", never>;
        amountCents: import("convex/values").VUnion<number | null, [import("convex/values").VFloat64<number, "required">, import("convex/values").VNull<null, "required">], "required", never>;
        checkoutId: import("convex/values").VString<string, "required">;
        ref: import("convex/values").VObject<{
            id: string;
            type: string;
        }, {
            type: import("convex/values").VString<string, "required">;
            id: import("convex/values").VString<string, "required">;
        }, "required", "id" | "type">;
        purpose: import("convex/values").VString<string, "required">;
        kind: import("convex/values").VUnion<"hosted" | "offSession" | "onSession", [import("convex/values").VLiteral<"hosted", "required">, import("convex/values").VLiteral<"offSession", "required">, import("convex/values").VLiteral<"onSession", "required">], "required", never>;
        processor: import("convex/values").VUnion<"stripe" | "paypal", [import("convex/values").VLiteral<"stripe", "required">, import("convex/values").VLiteral<"paypal", "required">], "required", never>;
        method: import("convex/values").VUnion<"paypal" | "card" | "ach", [import("convex/values").VLiteral<"card", "required">, import("convex/values").VLiteral<"ach", "required">, import("convex/values").VLiteral<"paypal", "required">], "required", never>;
        payer: import("convex/values").VObject<{
            name?: string | undefined;
            email: string;
        }, {
            name: import("convex/values").VString<string | undefined, "optional">;
            email: import("convex/values").VString<string, "required">;
        }, "required", "name" | "email">;
        /** What the host passed to start or chargeSaved as `context`. */
        context: C;
    };
    /** processing: a bank payment was accepted and the money is on its way (days); paid or failed follows. */
    processing: {
        paymentRef: import("convex/values").VUnion<string | null, [import("convex/values").VString<string, "required">, import("convex/values").VNull<null, "required">], "required", never>;
        checkoutId: import("convex/values").VString<string, "required">;
        ref: import("convex/values").VObject<{
            id: string;
            type: string;
        }, {
            type: import("convex/values").VString<string, "required">;
            id: import("convex/values").VString<string, "required">;
        }, "required", "id" | "type">;
        purpose: import("convex/values").VString<string, "required">;
        kind: import("convex/values").VUnion<"hosted" | "offSession" | "onSession", [import("convex/values").VLiteral<"hosted", "required">, import("convex/values").VLiteral<"offSession", "required">, import("convex/values").VLiteral<"onSession", "required">], "required", never>;
        processor: import("convex/values").VUnion<"stripe" | "paypal", [import("convex/values").VLiteral<"stripe", "required">, import("convex/values").VLiteral<"paypal", "required">], "required", never>;
        method: import("convex/values").VUnion<"paypal" | "card" | "ach", [import("convex/values").VLiteral<"card", "required">, import("convex/values").VLiteral<"ach", "required">, import("convex/values").VLiteral<"paypal", "required">], "required", never>;
        payer: import("convex/values").VObject<{
            name?: string | undefined;
            email: string;
        }, {
            name: import("convex/values").VString<string | undefined, "optional">;
            email: import("convex/values").VString<string, "required">;
        }, "required", "name" | "email">;
        /** What the host passed to start or chargeSaved as `context`. */
        context: C;
    };
    /** issues: the nightly digest of new issues (differences from the processors, disputes, charges with an unknown outcome). */
    issues: {
        issues: import("convex/values").VArray<{
            kind: string;
            id: string;
            checkoutId: string | null;
            processor: "stripe" | "paypal";
            detail: string;
            openedAt: number;
        }[], import("convex/values").VObject<{
            kind: string;
            id: string;
            checkoutId: string | null;
            processor: "stripe" | "paypal";
            detail: string;
            openedAt: number;
        }, {
            id: import("convex/values").VString<string, "required">;
            kind: import("convex/values").VString<string, "required">;
            detail: import("convex/values").VString<string, "required">;
            checkoutId: import("convex/values").VUnion<string | null, [import("convex/values").VString<string, "required">, import("convex/values").VNull<null, "required">], "required", never>;
            processor: import("convex/values").VUnion<"stripe" | "paypal", [import("convex/values").VLiteral<"stripe", "required">, import("convex/values").VLiteral<"paypal", "required">], "required", never>;
            openedAt: import("convex/values").VFloat64<number, "required">;
        }, "required", "kind" | "id" | "checkoutId" | "processor" | "detail" | "openedAt">, "required">;
    };
    /** scheduleCharged: one period's charge was paid (paid is called for its checkout too). first: the payment that started the schedule. */
    scheduleCharged: {
        checkoutId: import("convex/values").VString<string, "required">;
        period: import("convex/values").VString<string, "required">;
        paidCents: import("convex/values").VFloat64<number, "required">;
        paymentRef: import("convex/values").VString<string, "required">;
        first: import("convex/values").VBoolean<boolean, "required">;
        scheduleId: import("convex/values").VString<string, "required">;
        ref: import("convex/values").VObject<{
            id: string;
            type: string;
        }, {
            type: import("convex/values").VString<string, "required">;
            id: import("convex/values").VString<string, "required">;
        }, "required", "id" | "type">;
        purpose: import("convex/values").VString<string, "required">;
        owner: import("convex/values").VObject<{
            id: string;
            type: string;
        }, {
            type: import("convex/values").VString<string, "required">;
            id: import("convex/values").VString<string, "required">;
        }, "required", "id" | "type">;
        payer: import("convex/values").VObject<{
            name?: string | undefined;
            email: string;
        }, {
            name: import("convex/values").VString<string | undefined, "optional">;
            email: import("convex/values").VString<string, "required">;
        }, "required", "name" | "email">;
        processor: import("convex/values").VUnion<"stripe" | "paypal", [import("convex/values").VLiteral<"stripe", "required">, import("convex/values").VLiteral<"paypal", "required">], "required", never>;
        method: import("convex/values").VUnion<"paypal" | "card" | "ach", [import("convex/values").VLiteral<"card", "required">, import("convex/values").VLiteral<"ach", "required">, import("convex/values").VLiteral<"paypal", "required">], "required", never>;
        paymentMethodId: import("convex/values").VUnion<string | null, [import("convex/values").VString<string, "required">, import("convex/values").VNull<null, "required">], "required", never>;
        /** The schedule's amount now (a charge's own amount is on its checkout). */
        amountCents: import("convex/values").VFloat64<number, "required">;
        /** Where the schedule stands after this. */
        status: import("convex/values").VUnion<"starting" | "active" | "paused" | "past_due" | "lapsed" | "cancelled", [import("convex/values").VLiteral<"starting", "required">, import("convex/values").VLiteral<"active", "required">, import("convex/values").VLiteral<"paused", "required">, import("convex/values").VLiteral<"past_due", "required">, import("convex/values").VLiteral<"lapsed", "required">, import("convex/values").VLiteral<"cancelled", "required">], "required", never>;
        /** The next charge (or retry); null once lapsed or cancelled. */
        nextChargeAt: import("convex/values").VUnion<number | null, [import("convex/values").VFloat64<number, "required">, import("convex/values").VNull<null, "required">], "required", never>;
        context: C;
    };
    /**
     * scheduleFailed: a charge was refused (or nothing was charged, checkoutId null: the saved method is
     * gone, declineCode METHOD_REMOVED, or PayPal never finished saving the first payment's method,
     * METHOD_NOT_SAVED). attempt: refusals in this period so far. final: no more retries, the schedule
     * lapsed (hard declines are final at once). nextRetryAt: when it is tried again.
     */
    scheduleFailed: {
        checkoutId: import("convex/values").VUnion<string | null, [import("convex/values").VString<string, "required">, import("convex/values").VNull<null, "required">], "required", never>;
        period: import("convex/values").VString<string, "required">;
        attempt: import("convex/values").VFloat64<number, "required">;
        final: import("convex/values").VBoolean<boolean, "required">;
        reason: import("convex/values").VString<string, "required">;
        declineCode: import("convex/values").VUnion<string | null, [import("convex/values").VString<string, "required">, import("convex/values").VNull<null, "required">], "required", never>;
        declineKind: import("convex/values").VUnion<"hard" | "soft" | "insufficient_funds", [import("convex/values").VLiteral<"hard", "required">, import("convex/values").VLiteral<"soft", "required">, import("convex/values").VLiteral<"insufficient_funds", "required">], "required", never>;
        nextRetryAt: import("convex/values").VUnion<number | null, [import("convex/values").VFloat64<number, "required">, import("convex/values").VNull<null, "required">], "required", never>;
        scheduleId: import("convex/values").VString<string, "required">;
        ref: import("convex/values").VObject<{
            id: string;
            type: string;
        }, {
            type: import("convex/values").VString<string, "required">;
            id: import("convex/values").VString<string, "required">;
        }, "required", "id" | "type">;
        purpose: import("convex/values").VString<string, "required">;
        owner: import("convex/values").VObject<{
            id: string;
            type: string;
        }, {
            type: import("convex/values").VString<string, "required">;
            id: import("convex/values").VString<string, "required">;
        }, "required", "id" | "type">;
        payer: import("convex/values").VObject<{
            name?: string | undefined;
            email: string;
        }, {
            name: import("convex/values").VString<string | undefined, "optional">;
            email: import("convex/values").VString<string, "required">;
        }, "required", "name" | "email">;
        processor: import("convex/values").VUnion<"stripe" | "paypal", [import("convex/values").VLiteral<"stripe", "required">, import("convex/values").VLiteral<"paypal", "required">], "required", never>;
        method: import("convex/values").VUnion<"paypal" | "card" | "ach", [import("convex/values").VLiteral<"card", "required">, import("convex/values").VLiteral<"ach", "required">, import("convex/values").VLiteral<"paypal", "required">], "required", never>;
        paymentMethodId: import("convex/values").VUnion<string | null, [import("convex/values").VString<string, "required">, import("convex/values").VNull<null, "required">], "required", never>;
        /** The schedule's amount now (a charge's own amount is on its checkout). */
        amountCents: import("convex/values").VFloat64<number, "required">;
        /** Where the schedule stands after this. */
        status: import("convex/values").VUnion<"starting" | "active" | "paused" | "past_due" | "lapsed" | "cancelled", [import("convex/values").VLiteral<"starting", "required">, import("convex/values").VLiteral<"active", "required">, import("convex/values").VLiteral<"paused", "required">, import("convex/values").VLiteral<"past_due", "required">, import("convex/values").VLiteral<"lapsed", "required">, import("convex/values").VLiteral<"cancelled", "required">], "required", never>;
        /** The next charge (or retry); null once lapsed or cancelled. */
        nextChargeAt: import("convex/values").VUnion<number | null, [import("convex/values").VFloat64<number, "required">, import("convex/values").VNull<null, "required">], "required", never>;
        context: C;
    };
    /**
     * scheduleChanged: started (its first payment came), not_started (that payment never came), or the
     * app or the processor changed it. by: who the app named; 'processor' when the payer removed the
     * method at PayPal or Stripe.
     */
    scheduleChanged: {
        changes: import("convex/values").VArray<("amount" | "method" | "anchor" | "paused" | "cancelled" | "started" | "not_started" | "resumed")[], import("convex/values").VUnion<"amount" | "method" | "anchor" | "paused" | "cancelled" | "started" | "not_started" | "resumed", [import("convex/values").VLiteral<"started", "required">, import("convex/values").VLiteral<"not_started", "required">, import("convex/values").VLiteral<"amount", "required">, import("convex/values").VLiteral<"method", "required">, import("convex/values").VLiteral<"anchor", "required">, import("convex/values").VLiteral<"paused", "required">, import("convex/values").VLiteral<"resumed", "required">, import("convex/values").VLiteral<"cancelled", "required">], "required", never>, "required">;
        previousStatus: import("convex/values").VUnion<"starting" | "active" | "paused" | "past_due" | "lapsed" | "cancelled", [import("convex/values").VLiteral<"starting", "required">, import("convex/values").VLiteral<"active", "required">, import("convex/values").VLiteral<"paused", "required">, import("convex/values").VLiteral<"past_due", "required">, import("convex/values").VLiteral<"lapsed", "required">, import("convex/values").VLiteral<"cancelled", "required">], "required", never>;
        previousAmountCents: import("convex/values").VFloat64<number, "required">;
        reason: import("convex/values").VUnion<string | null, [import("convex/values").VString<string, "required">, import("convex/values").VNull<null, "required">], "required", never>;
        by: import("convex/values").VUnion<string | null, [import("convex/values").VString<string, "required">, import("convex/values").VNull<null, "required">], "required", never>;
        scheduleId: import("convex/values").VString<string, "required">;
        ref: import("convex/values").VObject<{
            id: string;
            type: string;
        }, {
            type: import("convex/values").VString<string, "required">;
            id: import("convex/values").VString<string, "required">;
        }, "required", "id" | "type">;
        purpose: import("convex/values").VString<string, "required">;
        owner: import("convex/values").VObject<{
            id: string;
            type: string;
        }, {
            type: import("convex/values").VString<string, "required">;
            id: import("convex/values").VString<string, "required">;
        }, "required", "id" | "type">;
        payer: import("convex/values").VObject<{
            name?: string | undefined;
            email: string;
        }, {
            name: import("convex/values").VString<string | undefined, "optional">;
            email: import("convex/values").VString<string, "required">;
        }, "required", "name" | "email">;
        processor: import("convex/values").VUnion<"stripe" | "paypal", [import("convex/values").VLiteral<"stripe", "required">, import("convex/values").VLiteral<"paypal", "required">], "required", never>;
        method: import("convex/values").VUnion<"paypal" | "card" | "ach", [import("convex/values").VLiteral<"card", "required">, import("convex/values").VLiteral<"ach", "required">, import("convex/values").VLiteral<"paypal", "required">], "required", never>;
        paymentMethodId: import("convex/values").VUnion<string | null, [import("convex/values").VString<string, "required">, import("convex/values").VNull<null, "required">], "required", never>;
        /** The schedule's amount now (a charge's own amount is on its checkout). */
        amountCents: import("convex/values").VFloat64<number, "required">;
        /** Where the schedule stands after this. */
        status: import("convex/values").VUnion<"starting" | "active" | "paused" | "past_due" | "lapsed" | "cancelled", [import("convex/values").VLiteral<"starting", "required">, import("convex/values").VLiteral<"active", "required">, import("convex/values").VLiteral<"paused", "required">, import("convex/values").VLiteral<"past_due", "required">, import("convex/values").VLiteral<"lapsed", "required">, import("convex/values").VLiteral<"cancelled", "required">], "required", never>;
        /** The next charge (or retry); null once lapsed or cancelled. */
        nextChargeAt: import("convex/values").VUnion<number | null, [import("convex/values").VFloat64<number, "required">, import("convex/values").VNull<null, "required">], "required", never>;
        context: C;
    };
};
/** The arguments of the schedule callbacks, for an app whose context is `context`. */
export declare function scheduleCallbackArgs<C extends GenericValidator>(context: C): {
    /** scheduleCharged: one period's charge was paid (paid is called for its checkout too). first: the payment that started the schedule. */
    scheduleCharged: {
        checkoutId: import("convex/values").VString<string, "required">;
        period: import("convex/values").VString<string, "required">;
        paidCents: import("convex/values").VFloat64<number, "required">;
        paymentRef: import("convex/values").VString<string, "required">;
        first: import("convex/values").VBoolean<boolean, "required">;
        scheduleId: import("convex/values").VString<string, "required">;
        ref: import("convex/values").VObject<{
            id: string;
            type: string;
        }, {
            type: import("convex/values").VString<string, "required">;
            id: import("convex/values").VString<string, "required">;
        }, "required", "id" | "type">;
        purpose: import("convex/values").VString<string, "required">;
        owner: import("convex/values").VObject<{
            id: string;
            type: string;
        }, {
            type: import("convex/values").VString<string, "required">;
            id: import("convex/values").VString<string, "required">;
        }, "required", "id" | "type">;
        payer: import("convex/values").VObject<{
            name?: string | undefined;
            email: string;
        }, {
            name: import("convex/values").VString<string | undefined, "optional">;
            email: import("convex/values").VString<string, "required">;
        }, "required", "name" | "email">;
        processor: import("convex/values").VUnion<"stripe" | "paypal", [import("convex/values").VLiteral<"stripe", "required">, import("convex/values").VLiteral<"paypal", "required">], "required", never>;
        method: import("convex/values").VUnion<"paypal" | "card" | "ach", [import("convex/values").VLiteral<"card", "required">, import("convex/values").VLiteral<"ach", "required">, import("convex/values").VLiteral<"paypal", "required">], "required", never>;
        paymentMethodId: import("convex/values").VUnion<string | null, [import("convex/values").VString<string, "required">, import("convex/values").VNull<null, "required">], "required", never>;
        /** The schedule's amount now (a charge's own amount is on its checkout). */
        amountCents: import("convex/values").VFloat64<number, "required">;
        /** Where the schedule stands after this. */
        status: import("convex/values").VUnion<"starting" | "active" | "paused" | "past_due" | "lapsed" | "cancelled", [import("convex/values").VLiteral<"starting", "required">, import("convex/values").VLiteral<"active", "required">, import("convex/values").VLiteral<"paused", "required">, import("convex/values").VLiteral<"past_due", "required">, import("convex/values").VLiteral<"lapsed", "required">, import("convex/values").VLiteral<"cancelled", "required">], "required", never>;
        /** The next charge (or retry); null once lapsed or cancelled. */
        nextChargeAt: import("convex/values").VUnion<number | null, [import("convex/values").VFloat64<number, "required">, import("convex/values").VNull<null, "required">], "required", never>;
        context: C;
    };
    /**
     * scheduleFailed: a charge was refused (or nothing was charged, checkoutId null: the saved method is
     * gone, declineCode METHOD_REMOVED, or PayPal never finished saving the first payment's method,
     * METHOD_NOT_SAVED). attempt: refusals in this period so far. final: no more retries, the schedule
     * lapsed (hard declines are final at once). nextRetryAt: when it is tried again.
     */
    scheduleFailed: {
        checkoutId: import("convex/values").VUnion<string | null, [import("convex/values").VString<string, "required">, import("convex/values").VNull<null, "required">], "required", never>;
        period: import("convex/values").VString<string, "required">;
        attempt: import("convex/values").VFloat64<number, "required">;
        final: import("convex/values").VBoolean<boolean, "required">;
        reason: import("convex/values").VString<string, "required">;
        declineCode: import("convex/values").VUnion<string | null, [import("convex/values").VString<string, "required">, import("convex/values").VNull<null, "required">], "required", never>;
        declineKind: import("convex/values").VUnion<"hard" | "soft" | "insufficient_funds", [import("convex/values").VLiteral<"hard", "required">, import("convex/values").VLiteral<"soft", "required">, import("convex/values").VLiteral<"insufficient_funds", "required">], "required", never>;
        nextRetryAt: import("convex/values").VUnion<number | null, [import("convex/values").VFloat64<number, "required">, import("convex/values").VNull<null, "required">], "required", never>;
        scheduleId: import("convex/values").VString<string, "required">;
        ref: import("convex/values").VObject<{
            id: string;
            type: string;
        }, {
            type: import("convex/values").VString<string, "required">;
            id: import("convex/values").VString<string, "required">;
        }, "required", "id" | "type">;
        purpose: import("convex/values").VString<string, "required">;
        owner: import("convex/values").VObject<{
            id: string;
            type: string;
        }, {
            type: import("convex/values").VString<string, "required">;
            id: import("convex/values").VString<string, "required">;
        }, "required", "id" | "type">;
        payer: import("convex/values").VObject<{
            name?: string | undefined;
            email: string;
        }, {
            name: import("convex/values").VString<string | undefined, "optional">;
            email: import("convex/values").VString<string, "required">;
        }, "required", "name" | "email">;
        processor: import("convex/values").VUnion<"stripe" | "paypal", [import("convex/values").VLiteral<"stripe", "required">, import("convex/values").VLiteral<"paypal", "required">], "required", never>;
        method: import("convex/values").VUnion<"paypal" | "card" | "ach", [import("convex/values").VLiteral<"card", "required">, import("convex/values").VLiteral<"ach", "required">, import("convex/values").VLiteral<"paypal", "required">], "required", never>;
        paymentMethodId: import("convex/values").VUnion<string | null, [import("convex/values").VString<string, "required">, import("convex/values").VNull<null, "required">], "required", never>;
        /** The schedule's amount now (a charge's own amount is on its checkout). */
        amountCents: import("convex/values").VFloat64<number, "required">;
        /** Where the schedule stands after this. */
        status: import("convex/values").VUnion<"starting" | "active" | "paused" | "past_due" | "lapsed" | "cancelled", [import("convex/values").VLiteral<"starting", "required">, import("convex/values").VLiteral<"active", "required">, import("convex/values").VLiteral<"paused", "required">, import("convex/values").VLiteral<"past_due", "required">, import("convex/values").VLiteral<"lapsed", "required">, import("convex/values").VLiteral<"cancelled", "required">], "required", never>;
        /** The next charge (or retry); null once lapsed or cancelled. */
        nextChargeAt: import("convex/values").VUnion<number | null, [import("convex/values").VFloat64<number, "required">, import("convex/values").VNull<null, "required">], "required", never>;
        context: C;
    };
    /**
     * scheduleChanged: started (its first payment came), not_started (that payment never came), or the
     * app or the processor changed it. by: who the app named; 'processor' when the payer removed the
     * method at PayPal or Stripe.
     */
    scheduleChanged: {
        changes: import("convex/values").VArray<("amount" | "method" | "anchor" | "paused" | "cancelled" | "started" | "not_started" | "resumed")[], import("convex/values").VUnion<"amount" | "method" | "anchor" | "paused" | "cancelled" | "started" | "not_started" | "resumed", [import("convex/values").VLiteral<"started", "required">, import("convex/values").VLiteral<"not_started", "required">, import("convex/values").VLiteral<"amount", "required">, import("convex/values").VLiteral<"method", "required">, import("convex/values").VLiteral<"anchor", "required">, import("convex/values").VLiteral<"paused", "required">, import("convex/values").VLiteral<"resumed", "required">, import("convex/values").VLiteral<"cancelled", "required">], "required", never>, "required">;
        previousStatus: import("convex/values").VUnion<"starting" | "active" | "paused" | "past_due" | "lapsed" | "cancelled", [import("convex/values").VLiteral<"starting", "required">, import("convex/values").VLiteral<"active", "required">, import("convex/values").VLiteral<"paused", "required">, import("convex/values").VLiteral<"past_due", "required">, import("convex/values").VLiteral<"lapsed", "required">, import("convex/values").VLiteral<"cancelled", "required">], "required", never>;
        previousAmountCents: import("convex/values").VFloat64<number, "required">;
        reason: import("convex/values").VUnion<string | null, [import("convex/values").VString<string, "required">, import("convex/values").VNull<null, "required">], "required", never>;
        by: import("convex/values").VUnion<string | null, [import("convex/values").VString<string, "required">, import("convex/values").VNull<null, "required">], "required", never>;
        scheduleId: import("convex/values").VString<string, "required">;
        ref: import("convex/values").VObject<{
            id: string;
            type: string;
        }, {
            type: import("convex/values").VString<string, "required">;
            id: import("convex/values").VString<string, "required">;
        }, "required", "id" | "type">;
        purpose: import("convex/values").VString<string, "required">;
        owner: import("convex/values").VObject<{
            id: string;
            type: string;
        }, {
            type: import("convex/values").VString<string, "required">;
            id: import("convex/values").VString<string, "required">;
        }, "required", "id" | "type">;
        payer: import("convex/values").VObject<{
            name?: string | undefined;
            email: string;
        }, {
            name: import("convex/values").VString<string | undefined, "optional">;
            email: import("convex/values").VString<string, "required">;
        }, "required", "name" | "email">;
        processor: import("convex/values").VUnion<"stripe" | "paypal", [import("convex/values").VLiteral<"stripe", "required">, import("convex/values").VLiteral<"paypal", "required">], "required", never>;
        method: import("convex/values").VUnion<"paypal" | "card" | "ach", [import("convex/values").VLiteral<"card", "required">, import("convex/values").VLiteral<"ach", "required">, import("convex/values").VLiteral<"paypal", "required">], "required", never>;
        paymentMethodId: import("convex/values").VUnion<string | null, [import("convex/values").VString<string, "required">, import("convex/values").VNull<null, "required">], "required", never>;
        /** The schedule's amount now (a charge's own amount is on its checkout). */
        amountCents: import("convex/values").VFloat64<number, "required">;
        /** Where the schedule stands after this. */
        status: import("convex/values").VUnion<"starting" | "active" | "paused" | "past_due" | "lapsed" | "cancelled", [import("convex/values").VLiteral<"starting", "required">, import("convex/values").VLiteral<"active", "required">, import("convex/values").VLiteral<"paused", "required">, import("convex/values").VLiteral<"past_due", "required">, import("convex/values").VLiteral<"lapsed", "required">, import("convex/values").VLiteral<"cancelled", "required">], "required", never>;
        /** The next charge (or retry); null once lapsed or cancelled. */
        nextChargeAt: import("convex/values").VUnion<number | null, [import("convex/values").VFloat64<number, "required">, import("convex/values").VNull<null, "required">], "required", never>;
        context: C;
    };
};
export declare const paidArgs: {
    amountCents: import("convex/values").VFloat64<number, "required">;
    paidCents: import("convex/values").VFloat64<number, "required">;
    paymentRef: import("convex/values").VString<string, "required">;
    checkoutId: import("convex/values").VString<string, "required">;
    ref: import("convex/values").VObject<{
        id: string;
        type: string;
    }, {
        type: import("convex/values").VString<string, "required">;
        id: import("convex/values").VString<string, "required">;
    }, "required", "id" | "type">;
    purpose: import("convex/values").VString<string, "required">;
    kind: import("convex/values").VUnion<"hosted" | "offSession" | "onSession", [import("convex/values").VLiteral<"hosted", "required">, import("convex/values").VLiteral<"offSession", "required">, import("convex/values").VLiteral<"onSession", "required">], "required", never>;
    processor: import("convex/values").VUnion<"stripe" | "paypal", [import("convex/values").VLiteral<"stripe", "required">, import("convex/values").VLiteral<"paypal", "required">], "required", never>;
    method: import("convex/values").VUnion<"paypal" | "card" | "ach", [import("convex/values").VLiteral<"card", "required">, import("convex/values").VLiteral<"ach", "required">, import("convex/values").VLiteral<"paypal", "required">], "required", never>;
    payer: import("convex/values").VObject<{
        name?: string | undefined;
        email: string;
    }, {
        name: import("convex/values").VString<string | undefined, "optional">;
        email: import("convex/values").VString<string, "required">;
    }, "required", "name" | "email">;
    /** What the host passed to start or chargeSaved as `context`. */
    context: import("convex/values").VAny<any, "required", string>;
};
export declare const failedArgs: {
    reason: import("convex/values").VString<string, "required">;
    declined: import("convex/values").VBoolean<boolean, "required">;
    wasProcessing: import("convex/values").VBoolean<boolean, "required">;
    /** The processor's code for the refusal (insufficient_funds, lost_card, INSTRUMENT_DECLINED...), when it gave one; METHOD_NOT_SAVED when chargeSaved's method isn't saved for the payer (nothing charged). */
    declineCode: import("convex/values").VUnion<string | null | undefined, [import("convex/values").VString<string, "required">, import("convex/values").VNull<null, "required">], "optional", never>;
    checkoutId: import("convex/values").VString<string, "required">;
    ref: import("convex/values").VObject<{
        id: string;
        type: string;
    }, {
        type: import("convex/values").VString<string, "required">;
        id: import("convex/values").VString<string, "required">;
    }, "required", "id" | "type">;
    purpose: import("convex/values").VString<string, "required">;
    kind: import("convex/values").VUnion<"hosted" | "offSession" | "onSession", [import("convex/values").VLiteral<"hosted", "required">, import("convex/values").VLiteral<"offSession", "required">, import("convex/values").VLiteral<"onSession", "required">], "required", never>;
    processor: import("convex/values").VUnion<"stripe" | "paypal", [import("convex/values").VLiteral<"stripe", "required">, import("convex/values").VLiteral<"paypal", "required">], "required", never>;
    method: import("convex/values").VUnion<"paypal" | "card" | "ach", [import("convex/values").VLiteral<"card", "required">, import("convex/values").VLiteral<"ach", "required">, import("convex/values").VLiteral<"paypal", "required">], "required", never>;
    payer: import("convex/values").VObject<{
        name?: string | undefined;
        email: string;
    }, {
        name: import("convex/values").VString<string | undefined, "optional">;
        email: import("convex/values").VString<string, "required">;
    }, "required", "name" | "email">;
    /** What the host passed to start or chargeSaved as `context`. */
    context: import("convex/values").VAny<any, "required", string>;
};
export declare const refundedArgs: {
    refundId: import("convex/values").VString<string, "required">;
    amountCents: import("convex/values").VFloat64<number, "required">;
    refundedCents: import("convex/values").VFloat64<number, "required">;
    paidCents: import("convex/values").VFloat64<number, "required">;
    origin: import("convex/values").VUnion<"requested" | "needed" | "external", [import("convex/values").VLiteral<"requested", "required">, import("convex/values").VLiteral<"needed", "required">, import("convex/values").VLiteral<"external", "required">], "required", never>;
    /** What the app passed to requestRefund as hostData (e.g. its admin's answer to a question); unset for others. */
    hostData: import("convex/values").VRecord<Record<string, string> | undefined, import("convex/values").VString<string, "required">, import("convex/values").VString<string, "required">, "optional", string>;
    /**
     * true: the processor failed this refund after reporting it done, so the money didn't go back after
     * all; take it off again (refundedCents is already without it). It may then be sent again.
     */
    reversed: import("convex/values").VBoolean<boolean | undefined, "optional">;
    checkoutId: import("convex/values").VString<string, "required">;
    ref: import("convex/values").VObject<{
        id: string;
        type: string;
    }, {
        type: import("convex/values").VString<string, "required">;
        id: import("convex/values").VString<string, "required">;
    }, "required", "id" | "type">;
    purpose: import("convex/values").VString<string, "required">;
    kind: import("convex/values").VUnion<"hosted" | "offSession" | "onSession", [import("convex/values").VLiteral<"hosted", "required">, import("convex/values").VLiteral<"offSession", "required">, import("convex/values").VLiteral<"onSession", "required">], "required", never>;
    processor: import("convex/values").VUnion<"stripe" | "paypal", [import("convex/values").VLiteral<"stripe", "required">, import("convex/values").VLiteral<"paypal", "required">], "required", never>;
    method: import("convex/values").VUnion<"paypal" | "card" | "ach", [import("convex/values").VLiteral<"card", "required">, import("convex/values").VLiteral<"ach", "required">, import("convex/values").VLiteral<"paypal", "required">], "required", never>;
    payer: import("convex/values").VObject<{
        name?: string | undefined;
        email: string;
    }, {
        name: import("convex/values").VString<string | undefined, "optional">;
        email: import("convex/values").VString<string, "required">;
    }, "required", "name" | "email">;
    /** What the host passed to start or chargeSaved as `context`. */
    context: import("convex/values").VAny<any, "required", string>;
};
export declare const refundNeededArgs: {
    amountCents: import("convex/values").VFloat64<number, "required">;
    paidCents: import("convex/values").VFloat64<number, "required">;
    paymentRef: import("convex/values").VString<string, "required">;
    refundId: import("convex/values").VString<string, "required">;
    reason: import("convex/values").VString<string, "required">;
    checkoutId: import("convex/values").VString<string, "required">;
    ref: import("convex/values").VObject<{
        id: string;
        type: string;
    }, {
        type: import("convex/values").VString<string, "required">;
        id: import("convex/values").VString<string, "required">;
    }, "required", "id" | "type">;
    purpose: import("convex/values").VString<string, "required">;
    kind: import("convex/values").VUnion<"hosted" | "offSession" | "onSession", [import("convex/values").VLiteral<"hosted", "required">, import("convex/values").VLiteral<"offSession", "required">, import("convex/values").VLiteral<"onSession", "required">], "required", never>;
    processor: import("convex/values").VUnion<"stripe" | "paypal", [import("convex/values").VLiteral<"stripe", "required">, import("convex/values").VLiteral<"paypal", "required">], "required", never>;
    method: import("convex/values").VUnion<"paypal" | "card" | "ach", [import("convex/values").VLiteral<"card", "required">, import("convex/values").VLiteral<"ach", "required">, import("convex/values").VLiteral<"paypal", "required">], "required", never>;
    payer: import("convex/values").VObject<{
        name?: string | undefined;
        email: string;
    }, {
        name: import("convex/values").VString<string | undefined, "optional">;
        email: import("convex/values").VString<string, "required">;
    }, "required", "name" | "email">;
    /** What the host passed to start or chargeSaved as `context`. */
    context: import("convex/values").VAny<any, "required", string>;
};
export declare const disputeArgs: {
    paymentRef: import("convex/values").VString<string, "required">;
    disputeId: import("convex/values").VString<string, "required">;
    status: import("convex/values").VUnion<"opened" | "closed", [import("convex/values").VLiteral<"opened", "required">, import("convex/values").VLiteral<"closed", "required">], "required", never>;
    outcome: import("convex/values").VUnion<string | null, [import("convex/values").VString<string, "required">, import("convex/values").VNull<null, "required">], "required", never>;
    reason: import("convex/values").VUnion<string | null, [import("convex/values").VString<string, "required">, import("convex/values").VNull<null, "required">], "required", never>;
    amountCents: import("convex/values").VUnion<number | null, [import("convex/values").VFloat64<number, "required">, import("convex/values").VNull<null, "required">], "required", never>;
    checkoutId: import("convex/values").VString<string, "required">;
    ref: import("convex/values").VObject<{
        id: string;
        type: string;
    }, {
        type: import("convex/values").VString<string, "required">;
        id: import("convex/values").VString<string, "required">;
    }, "required", "id" | "type">;
    purpose: import("convex/values").VString<string, "required">;
    kind: import("convex/values").VUnion<"hosted" | "offSession" | "onSession", [import("convex/values").VLiteral<"hosted", "required">, import("convex/values").VLiteral<"offSession", "required">, import("convex/values").VLiteral<"onSession", "required">], "required", never>;
    processor: import("convex/values").VUnion<"stripe" | "paypal", [import("convex/values").VLiteral<"stripe", "required">, import("convex/values").VLiteral<"paypal", "required">], "required", never>;
    method: import("convex/values").VUnion<"paypal" | "card" | "ach", [import("convex/values").VLiteral<"card", "required">, import("convex/values").VLiteral<"ach", "required">, import("convex/values").VLiteral<"paypal", "required">], "required", never>;
    payer: import("convex/values").VObject<{
        name?: string | undefined;
        email: string;
    }, {
        name: import("convex/values").VString<string | undefined, "optional">;
        email: import("convex/values").VString<string, "required">;
    }, "required", "name" | "email">;
    /** What the host passed to start or chargeSaved as `context`. */
    context: import("convex/values").VAny<any, "required", string>;
};
export declare const processingArgs: {
    paymentRef: import("convex/values").VUnion<string | null, [import("convex/values").VString<string, "required">, import("convex/values").VNull<null, "required">], "required", never>;
    checkoutId: import("convex/values").VString<string, "required">;
    ref: import("convex/values").VObject<{
        id: string;
        type: string;
    }, {
        type: import("convex/values").VString<string, "required">;
        id: import("convex/values").VString<string, "required">;
    }, "required", "id" | "type">;
    purpose: import("convex/values").VString<string, "required">;
    kind: import("convex/values").VUnion<"hosted" | "offSession" | "onSession", [import("convex/values").VLiteral<"hosted", "required">, import("convex/values").VLiteral<"offSession", "required">, import("convex/values").VLiteral<"onSession", "required">], "required", never>;
    processor: import("convex/values").VUnion<"stripe" | "paypal", [import("convex/values").VLiteral<"stripe", "required">, import("convex/values").VLiteral<"paypal", "required">], "required", never>;
    method: import("convex/values").VUnion<"paypal" | "card" | "ach", [import("convex/values").VLiteral<"card", "required">, import("convex/values").VLiteral<"ach", "required">, import("convex/values").VLiteral<"paypal", "required">], "required", never>;
    payer: import("convex/values").VObject<{
        name?: string | undefined;
        email: string;
    }, {
        name: import("convex/values").VString<string | undefined, "optional">;
        email: import("convex/values").VString<string, "required">;
    }, "required", "name" | "email">;
    /** What the host passed to start or chargeSaved as `context`. */
    context: import("convex/values").VAny<any, "required", string>;
};
export declare const issuesArgs: {
    issues: import("convex/values").VArray<{
        kind: string;
        id: string;
        checkoutId: string | null;
        processor: "stripe" | "paypal";
        detail: string;
        openedAt: number;
    }[], import("convex/values").VObject<{
        kind: string;
        id: string;
        checkoutId: string | null;
        processor: "stripe" | "paypal";
        detail: string;
        openedAt: number;
    }, {
        id: import("convex/values").VString<string, "required">;
        kind: import("convex/values").VString<string, "required">;
        detail: import("convex/values").VString<string, "required">;
        checkoutId: import("convex/values").VUnion<string | null, [import("convex/values").VString<string, "required">, import("convex/values").VNull<null, "required">], "required", never>;
        processor: import("convex/values").VUnion<"stripe" | "paypal", [import("convex/values").VLiteral<"stripe", "required">, import("convex/values").VLiteral<"paypal", "required">], "required", never>;
        openedAt: import("convex/values").VFloat64<number, "required">;
    }, "required", "kind" | "id" | "checkoutId" | "processor" | "detail" | "openedAt">, "required">;
};
export declare const paidReturns: import("convex/values").VUnion<{
    refuse: string;
} | null, [import("convex/values").VNull<null, "required">, import("convex/values").VObject<{
    refuse: string;
}, {
    refuse: import("convex/values").VString<string, "required">;
}, "required", "refuse">], "required", "refuse">;
type AllArgs = ReturnType<typeof callbackArgs<GenericValidator>>;
type Args<T, K extends keyof AllArgs> = Omit<ObjectType<AllArgs[K]>, 'context'> & {
    context: T;
};
export type Paid<T = unknown> = Args<T, 'paid'>;
export type PaidResult = Infer<typeof paidReturns>;
export type Failed<T = unknown> = Args<T, 'failed'>;
export type Refunded<T = unknown> = Args<T, 'refunded'>;
export type RefundNeeded<T = unknown> = Args<T, 'refundNeeded'>;
export type Dispute<T = unknown> = Args<T, 'dispute'>;
export type Processing<T = unknown> = Args<T, 'processing'>;
export type IssuesDigest = ObjectType<typeof issuesArgs>;
export type ScheduleCharged<T = unknown> = Args<T, 'scheduleCharged'>;
export type ScheduleFailed<T = unknown> = Args<T, 'scheduleFailed'>;
export type ScheduleChanged<T = unknown> = Args<T, 'scheduleChanged'>;
export type IssueSummary = Infer<typeof issueArg>;
export {};
//# sourceMappingURL=validators.d.ts.map