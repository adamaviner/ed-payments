import type { Id } from './_generated/dataModel.js';
/** Makes the row before the processor is asked, so its id can be the processor's reference. Refuses past the rate limits. */
export declare const create: import("convex/server").RegisteredMutation<"public", {
    context?: any;
    limit?: {
        key?: string | undefined;
        perKey: number;
        windowMs: number;
        globalPerMinute: number;
    } | undefined;
    now: number;
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
}, Promise<import("convex/values").GenericId<"checkouts">>>;
/** The processor made its checkout: remember its id; the buyer is on their way. */
export declare const attach: import("convex/server").RegisteredMutation<"public", {
    id: string;
    processorCheckoutId: string;
}, Promise<{
    outcome: "already_handled";
    status: "abandoned" | "pending" | "processing" | "paid" | "failed" | "refund_needed";
} | {
    outcome: "attached";
    status?: undefined;
}>>;
/** The processor couldn't make its checkout; start throws to the buyer, and the row is closed. */
export declare const failStart: import("convex/server").RegisteredMutation<"public", {
    id: string;
    now: number;
    error: string;
}, Promise<null>>;
/** A bank payment was accepted and the money is on its way (days, for ACH). */
export declare const markProcessing: import("convex/server").RegisteredMutation<"public", {
    paymentRef?: string | undefined;
    id: string;
}, Promise<{
    outcome: "already_handled";
    status: "abandoned" | "processing" | "paid" | "failed" | "refund_needed";
} | {
    outcome: "processing";
    status?: undefined;
}>>;
/**
 * The money arrived. Records it and calls the host's onPaid in this same transaction, so "paid" and
 * the host's order are written together or not at all. If onPaid refuses ({ refuse }) or throws (its
 * writes roll back), or the amount isn't what was asked, the checkout is refund_needed, a refund for
 * the whole amount is recorded, and onRefundNeeded is told. A payment for a checkout that was already
 * abandoned or failed is still money taken, so it is settled the same way.
 */
export declare const settlePaid: import("convex/server").RegisteredMutation<"public", {
    processorCheckoutId?: string | undefined;
    processorFeeCents?: number | undefined;
    id: string;
    now: number;
    paymentRef: string;
    paidCents: number;
}, Promise<{
    outcome: "already_handled";
    status: "abandoned" | "created" | "pending" | "processing" | "paid" | "failed" | "refund_needed";
    reason?: undefined;
    refundId?: undefined;
} | {
    outcome: "paid";
    status?: undefined;
    reason?: undefined;
    refundId?: undefined;
} | {
    outcome: "refund_needed";
    reason: string;
    refundId: import("convex/values").GenericId<"refunds">;
    status?: undefined;
}>>;
/** The processor says the payment failed (a declined capture, a bounced bank debit). Nothing to refund. */
export declare const settleFailed: import("convex/server").RegisteredMutation<"public", {
    id: string;
    now: number;
    reason: string;
}, Promise<{
    outcome: "already_handled";
    status: "abandoned" | "paid" | "failed" | "refund_needed";
} | {
    outcome: "failed";
    status?: undefined;
}>>;
/** Expired with nothing at the processor. */
export declare const abandon: import("convex/server").RegisteredMutation<"public", {
    id: string;
    now: number;
}, Promise<{
    outcome: "already_handled";
    status: "abandoned" | "processing" | "paid" | "failed" | "refund_needed";
} | {
    outcome: "abandoned";
    status?: undefined;
}>>;
/** What the processor kept, learned after the sale. */
export declare const recordFee: import("convex/server").RegisteredMutation<"public", {
    id: string;
    processorFeeCents: number;
}, Promise<null>>;
/** A problem the client met along the way that a person should see (e.g. a callback for an unknown checkout). */
export declare const noteIssue: import("convex/server").RegisteredMutation<"public", {
    id: string;
    now: number;
    detail: string;
    kind: "status_differs" | "amount_differs";
}, Promise<null>>;
export declare const get: import("convex/server").RegisteredQuery<"public", {
    id: string;
}, Promise<{
    id: string;
    processorCheckoutId: string | null;
    paymentRef: string | null;
    ref: {
        id: string;
        type: string;
    };
    amountCents: number;
    app: string;
    cancelUrl: string;
    context: any;
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
    processorFeeCents: number | null;
    paidCents: number | null;
    status: "abandoned" | "created" | "pending" | "processing" | "paid" | "failed" | "refund_needed";
    refundedCents: number;
    disputed: boolean;
    createdAt: number;
    settledAt: number | null;
    lastError: string | null;
} | null>>;
export declare const byProcessorId: import("convex/server").RegisteredQuery<"public", {
    processorCheckoutId: string;
}, Promise<{
    id: string;
    processorCheckoutId: string | null;
    paymentRef: string | null;
    ref: {
        id: string;
        type: string;
    };
    amountCents: number;
    app: string;
    cancelUrl: string;
    context: any;
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
    processorFeeCents: number | null;
    paidCents: number | null;
    status: "abandoned" | "created" | "pending" | "processing" | "paid" | "failed" | "refund_needed";
    refundedCents: number;
    disputed: boolean;
    createdAt: number;
    settledAt: number | null;
    lastError: string | null;
} | null>>;
export declare const byPaymentRef: import("convex/server").RegisteredQuery<"public", {
    paymentRef: string;
}, Promise<{
    id: string;
    processorCheckoutId: string | null;
    paymentRef: string | null;
    ref: {
        id: string;
        type: string;
    };
    amountCents: number;
    app: string;
    cancelUrl: string;
    context: any;
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
    processorFeeCents: number | null;
    paidCents: number | null;
    status: "abandoned" | "created" | "pending" | "processing" | "paid" | "failed" | "refund_needed";
    refundedCents: number;
    disputed: boolean;
    createdAt: number;
    settledAt: number | null;
    lastError: string | null;
} | null>>;
/** The checkouts for one thing in the app, newest first (at most 50). */
export declare const byRef: import("convex/server").RegisteredQuery<"public", {
    ref: {
        id: string;
        type: string;
    };
}, Promise<{
    id: string;
    processorCheckoutId: string | null;
    paymentRef: string | null;
    ref: {
        id: string;
        type: string;
    };
    amountCents: number;
    app: string;
    cancelUrl: string;
    context: any;
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
    processorFeeCents: number | null;
    paidCents: number | null;
    status: "abandoned" | "created" | "pending" | "processing" | "paid" | "failed" | "refund_needed";
    refundedCents: number;
    disputed: boolean;
    createdAt: number;
    settledAt: number | null;
    lastError: string | null;
}[]>>;
export declare const list: import("convex/server").RegisteredQuery<"public", {
    paginationOpts: {
        id?: number;
        endCursor?: string | null;
        maximumRowsRead?: number;
        maximumBytesRead?: number;
        numItems: number;
        cursor: string | null;
    };
}, Promise<{
    page: {
        id: string;
        processorCheckoutId: string | null;
        paymentRef: string | null;
        ref: {
            id: string;
            type: string;
        };
        amountCents: number;
        app: string;
        cancelUrl: string;
        context: any;
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
        processorFeeCents: number | null;
        paidCents: number | null;
        status: "abandoned" | "created" | "pending" | "processing" | "paid" | "failed" | "refund_needed";
        refundedCents: number;
        disputed: boolean;
        createdAt: number;
        settledAt: number | null;
        lastError: string | null;
    }[];
    isDone: boolean;
    continueCursor: import("convex/server").Cursor;
    splitCursor?: import("convex/server").Cursor | null;
    pageStatus?: "SplitRecommended" | "SplitRequired" | null;
}>>;
/** Checkouts created since a time, oldest first, for the nightly comparison. */
export declare const createdSince: import("convex/server").RegisteredQuery<"public", {
    after?: number | undefined;
    limit: number;
    since: number;
}, Promise<{
    id: string;
    processorCheckoutId: string | null;
    paymentRef: string | null;
    ref: {
        id: string;
        type: string;
    };
    amountCents: number;
    app: string;
    cancelUrl: string;
    context: any;
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
    processorFeeCents: number | null;
    paidCents: number | null;
    status: "abandoned" | "created" | "pending" | "processing" | "paid" | "failed" | "refund_needed";
    refundedCents: number;
    disputed: boolean;
    createdAt: number;
    settledAt: number | null;
    lastError: string | null;
}[]>>;
/** Not-final checkouts for sweep: every created/pending/processing row, oldest expiry first. */
export declare const due: import("convex/server").RegisteredQuery<"public", {
    limit: number;
}, Promise<{
    id: string;
    processorCheckoutId: string | null;
    paymentRef: string | null;
    ref: {
        id: string;
        type: string;
    };
    amountCents: number;
    app: string;
    cancelUrl: string;
    context: any;
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
    processorFeeCents: number | null;
    paidCents: number | null;
    status: "abandoned" | "created" | "pending" | "processing" | "paid" | "failed" | "refund_needed";
    refundedCents: number;
    disputed: boolean;
    createdAt: number;
    settledAt: number | null;
    lastError: string | null;
}[]>>;
export type CheckoutId = Id<'checkouts'>;
//# sourceMappingURL=checkouts.d.ts.map