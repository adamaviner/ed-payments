/** Asks for a refund of a paid checkout; the whole remaining amount unless given. */
export declare const request: import("convex/server").RegisteredMutation<"public", {
    amountCents?: number | undefined;
    by?: string | undefined;
    now: number;
    reason: string;
    checkoutId: string;
}, Promise<import("convex/values").GenericId<"refunds">>>;
export declare const approve: import("convex/server").RegisteredMutation<"public", {
    by?: string | undefined;
    now: number;
    refundId: string;
}, Promise<null>>;
/**
 * Claims a refund for sending: approved (or requested, when the host skips approval) or failed
 * before. Checks the amount against what is left. Returns what the processor call needs.
 */
export declare const begin: import("convex/server").RegisteredMutation<"public", {
    by?: string | undefined;
    now: number;
    refundId: string;
    skipApproval: boolean;
}, Promise<{
    state: "already";
    status: "failed" | "approved" | "sending" | "sent" | "manual" | "dismissed";
    refundId?: undefined;
    key?: undefined;
    checkoutId?: undefined;
    app?: undefined;
    processor?: undefined;
    paymentRef?: undefined;
    amountCents?: undefined;
} | {
    state: "send";
    refundId: import("convex/values").GenericId<"refunds">;
    key: string;
    checkoutId: import("convex/values").GenericId<"checkouts">;
    app: string;
    processor: "paypal" | "stripe";
    paymentRef: string;
    amountCents: number;
    status?: undefined;
}>>;
/**
 * After the processor call. ok + done: sent, counted, the host told. ok but the processor says it is
 * still pending: stays sending with its id (sweep or a webhook finishes it). Unknown (the call timed
 * out or the processor was down): stays sending, so sweep sends again under the same key. Not ok:
 * the processor refused; failed, and may be sent again as a new attempt.
 */
export declare const finish: import("convex/server").RegisteredMutation<"public", {
    error?: string | undefined;
    processorRefundId?: string | undefined;
    unknown?: boolean | undefined;
    now: number;
    refundId: string;
    done: boolean;
    ok: boolean;
}, Promise<null>>;
/** Refunded outside the app (in a processor's dashboard, by cheque): counted, with a note. */
export declare const markManual: import("convex/server").RegisteredMutation<"public", {
    by?: string | undefined;
    note?: string | undefined;
    now: number;
    refundId: string;
}, Promise<null>>;
export declare const dismiss: import("convex/server").RegisteredMutation<"public", {
    by?: string | undefined;
    note?: string | undefined;
    now: number;
    refundId: string;
}, Promise<null>>;
/**
 * A refund seen at the processor (webhook, sweep or the nightly comparison). Matches, in order: the
 * row with this processor refund id; the row the library tagged it with (`refundId`, from Stripe
 * metadata or PayPal custom_id); a manual row of the same amount not yet linked. Otherwise a new
 * external row. Returns foreign when no checkout has this payment reference.
 */
export declare const recordExternal: import("convex/server").RegisteredMutation<"public", {
    reason?: string | undefined;
    refundId?: string | undefined;
    now: number;
    paymentRef: string;
    amountCents: number;
    processor: "paypal" | "stripe";
    processorRefundId: string;
    state: "pending" | "failed" | "done";
}, Promise<"foreign" | "recorded" | "updated" | "unchanged">>;
/** Refunds waiting on someone or something, oldest first. */
export declare const listOpen: import("convex/server").RegisteredQuery<"public", {
    limit?: number | undefined;
}, Promise<{
    id: string;
    amountCents: number;
    error: string | null;
    reason: string;
    status: "failed" | "requested" | "approved" | "sending" | "sent" | "manual" | "dismissed";
    checkoutId: string;
    note: string | null;
    processorRefundId: string | null;
    origin: "requested" | "needed" | "external";
    createdAt: number;
    requestedBy: string | null;
    approvedBy: string | null;
    updatedAt: number;
    sentAt: number | null;
    attempts: number;
}[]>>;
/** Refunds left sending since before a time, for sweep to ask the processor about. */
export declare const stuck: import("convex/server").RegisteredQuery<"public", {
    limit: number;
    before: number;
}, Promise<{
    id: string;
    amountCents: number;
    error: string | null;
    reason: string;
    status: "failed" | "requested" | "approved" | "sending" | "sent" | "manual" | "dismissed";
    checkoutId: string;
    note: string | null;
    processorRefundId: string | null;
    origin: "requested" | "needed" | "external";
    createdAt: number;
    requestedBy: string | null;
    approvedBy: string | null;
    updatedAt: number;
    sentAt: number | null;
    attempts: number;
}[]>>;
export declare const forCheckout: import("convex/server").RegisteredQuery<"public", {
    checkoutId: string;
}, Promise<{
    id: string;
    amountCents: number;
    error: string | null;
    reason: string;
    status: "failed" | "requested" | "approved" | "sending" | "sent" | "manual" | "dismissed";
    checkoutId: string;
    note: string | null;
    processorRefundId: string | null;
    origin: "requested" | "needed" | "external";
    createdAt: number;
    requestedBy: string | null;
    approvedBy: string | null;
    updatedAt: number;
    sentAt: number | null;
    attempts: number;
}[]>>;
export declare const get: import("convex/server").RegisteredQuery<"public", {
    refundId: string;
}, Promise<{
    id: string;
    amountCents: number;
    error: string | null;
    reason: string;
    status: "failed" | "requested" | "approved" | "sending" | "sent" | "manual" | "dismissed";
    checkoutId: string;
    note: string | null;
    processorRefundId: string | null;
    origin: "requested" | "needed" | "external";
    createdAt: number;
    requestedBy: string | null;
    approvedBy: string | null;
    updatedAt: number;
    sentAt: number | null;
    attempts: number;
} | null>>;
/** Refunds recorded since a time, for the nightly comparison. */
export declare const createdSince: import("convex/server").RegisteredQuery<"public", {
    limit: number;
    since: number;
}, Promise<{
    id: string;
    amountCents: number;
    error: string | null;
    reason: string;
    status: "failed" | "requested" | "approved" | "sending" | "sent" | "manual" | "dismissed";
    checkoutId: string;
    note: string | null;
    processorRefundId: string | null;
    origin: "requested" | "needed" | "external";
    createdAt: number;
    requestedBy: string | null;
    approvedBy: string | null;
    updatedAt: number;
    sentAt: number | null;
    attempts: number;
}[]>>;
//# sourceMappingURL=refunds.d.ts.map