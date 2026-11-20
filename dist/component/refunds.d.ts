/** Asks for a refund of a paid checkout; the whole remaining amount unless given. `hostData` is kept on it and passed to on.refunded. */
export declare const request: import("convex/server").RegisteredMutation<"public", {
    amountCents?: number | undefined;
    by?: string | undefined;
    hostData?: Record<string, string> | undefined;
    checkoutId: string;
    now: number;
    reason: string;
}, Promise<import("convex/values").GenericId<"refunds">>>;
export declare const approve: import("convex/server").RegisteredMutation<"public", {
    by?: string | undefined;
    refundId: string;
    now: number;
}, Promise<null>>;
/**
 * Claims a refund for sending: approved (or requested, when the host skips approval) or failed
 * before. Checks the amount against what is left. Returns what the processor call needs.
 */
export declare const begin: import("convex/server").RegisteredMutation<"public", {
    by?: string | undefined;
    refundId: string;
    now: number;
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
    processor: "stripe" | "paypal";
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
    refundId: string;
    now: number;
    done: boolean;
    ok: boolean;
}, Promise<null>>;
/** Refunded outside the app (in a processor's dashboard, by cheque): counted, with a note. */
export declare const markManual: import("convex/server").RegisteredMutation<"public", {
    by?: string | undefined;
    note?: string | undefined;
    refundId: string;
    now: number;
}, Promise<null>>;
export declare const dismiss: import("convex/server").RegisteredMutation<"public", {
    by?: string | undefined;
    note?: string | undefined;
    refundId: string;
    now: number;
}, Promise<null>>;
/**
 * A refund seen at the processor (webhook, sweep or the nightly comparison). Matches, in order: the
 * row with this processor refund id; the row the library tagged it with (`refundId`, from Stripe
 * metadata or PayPal custom_id); a manual row of the same amount not yet linked. Otherwise a new
 * external row. Returns foreign when no checkout has this payment reference.
 */
export declare const recordExternal: import("convex/server").RegisteredMutation<"public", {
    refundId?: string | undefined;
    reason?: string | undefined;
    now: number;
    paymentRef: string;
    amountCents: number;
    processor: "stripe" | "paypal";
    processorRefundId: string;
    state: "pending" | "failed" | "done";
}, Promise<"updated" | "unchanged" | "foreign" | "recorded">>;
/** Refunds waiting on someone or something, oldest first. */
export declare const listOpen: import("convex/server").RegisteredQuery<"public", {
    limit?: number | undefined;
}, Promise<{
    id: string;
    checkoutId: string;
    status: "failed" | "requested" | "approved" | "sending" | "sent" | "manual" | "dismissed";
    amountCents: number;
    error: string | null;
    reason: string;
    note: string | null;
    processorRefundId: string | null;
    hostData: Record<string, string> | null;
    createdAt: number;
    origin: "requested" | "needed" | "external";
    approvedBy: string | null;
    attempts: number;
    requestedBy: string | null;
    sentAt: number | null;
    updatedAt: number;
}[]>>;
/** Refunds left sending since before a time, for sweep to ask the processor about. */
export declare const stuck: import("convex/server").RegisteredQuery<"public", {
    limit: number;
    before: number;
}, Promise<{
    id: string;
    checkoutId: string;
    status: "failed" | "requested" | "approved" | "sending" | "sent" | "manual" | "dismissed";
    amountCents: number;
    error: string | null;
    reason: string;
    note: string | null;
    processorRefundId: string | null;
    hostData: Record<string, string> | null;
    createdAt: number;
    origin: "requested" | "needed" | "external";
    approvedBy: string | null;
    attempts: number;
    requestedBy: string | null;
    sentAt: number | null;
    updatedAt: number;
}[]>>;
export declare const forCheckout: import("convex/server").RegisteredQuery<"public", {
    checkoutId: string;
}, Promise<{
    id: string;
    checkoutId: string;
    status: "failed" | "requested" | "approved" | "sending" | "sent" | "manual" | "dismissed";
    amountCents: number;
    error: string | null;
    reason: string;
    note: string | null;
    processorRefundId: string | null;
    hostData: Record<string, string> | null;
    createdAt: number;
    origin: "requested" | "needed" | "external";
    approvedBy: string | null;
    attempts: number;
    requestedBy: string | null;
    sentAt: number | null;
    updatedAt: number;
}[]>>;
export declare const get: import("convex/server").RegisteredQuery<"public", {
    refundId: string;
}, Promise<{
    id: string;
    checkoutId: string;
    status: "failed" | "requested" | "approved" | "sending" | "sent" | "manual" | "dismissed";
    amountCents: number;
    error: string | null;
    reason: string;
    note: string | null;
    processorRefundId: string | null;
    hostData: Record<string, string> | null;
    createdAt: number;
    origin: "requested" | "needed" | "external";
    approvedBy: string | null;
    attempts: number;
    requestedBy: string | null;
    sentAt: number | null;
    updatedAt: number;
} | null>>;
/** Refunds recorded since a time, for the nightly comparison. */
export declare const createdSince: import("convex/server").RegisteredQuery<"public", {
    limit: number;
    since: number;
}, Promise<{
    id: string;
    checkoutId: string;
    status: "failed" | "requested" | "approved" | "sending" | "sent" | "manual" | "dismissed";
    amountCents: number;
    error: string | null;
    reason: string;
    note: string | null;
    processorRefundId: string | null;
    hostData: Record<string, string> | null;
    createdAt: number;
    origin: "requested" | "needed" | "external";
    approvedBy: string | null;
    attempts: number;
    requestedBy: string | null;
    sentAt: number | null;
    updatedAt: number;
}[]>>;
//# sourceMappingURL=refunds.d.ts.map