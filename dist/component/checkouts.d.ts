import type { Id } from './_generated/dataModel.js';
/** Makes the row before the processor is asked, so its id can be the processor's reference. Refuses past the rate limits. */
export declare const create: import("convex/server").RegisteredMutation<"public", {
    chargeKey?: string | undefined;
    context?: any;
    kind?: "hosted" | "offSession" | "onSession" | undefined;
    limits?: {
        max: number;
        key: string;
        windowMs: number;
        message: string;
    }[] | undefined;
    paymentMethodId?: string | undefined;
    retryOf?: string | undefined;
    stripeCustomerId?: string | undefined;
    method: "paypal" | "card" | "ach";
    expiresAt: number;
    description: string;
    app: string;
    now: number;
    ref: {
        type: string;
        id: string;
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
}, Promise<import("convex/values").GenericId<"checkouts">>>;
/** The processor made its checkout: remember its id; the buyer is on their way. */
export declare const attach: import("convex/server").RegisteredMutation<"public", {
    id: string;
    processorCheckoutId: string;
}, Promise<{
    outcome: "already_handled";
    status: "processing" | "paid" | "pending" | "failed" | "abandoned" | "refund_needed";
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
/** A bank payment was accepted and the money is on its way (days, for ACH). The host's onProcessing is told (e.g. to pause a deadline). */
export declare const markProcessing: import("convex/server").RegisteredMutation<"public", {
    method?: "paypal" | "card" | "ach" | undefined;
    now?: number | undefined;
    paymentRef?: string | undefined;
    id: string;
}, Promise<{
    outcome: "already_handled";
    status: "processing" | "paid" | "failed" | "abandoned" | "refund_needed";
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
    method?: "paypal" | "card" | "ach" | undefined;
    processorCheckoutId?: string | undefined;
    processorFeeCents?: number | undefined;
    id: string;
    now: number;
    paymentRef: string;
    paidCents: number;
}, Promise<{
    outcome: "already_handled";
    status: "processing" | "paid" | "pending" | "failed" | "created" | "abandoned" | "refund_needed";
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
/**
 * The processor says the payment failed (a declined capture or card, a bounced bank debit), or a
 * person gave up on a charge whose outcome was unknown. Nothing to refund. `declined` marks the
 * saved method the charge used, so it isn't offered again.
 */
export declare const settleFailed: import("convex/server").RegisteredMutation<"public", {
    processorCheckoutId?: string | undefined;
    declined?: boolean | undefined;
    id: string;
    now: number;
    reason: string;
}, Promise<{
    outcome: "already_handled";
    status: "paid" | "failed" | "abandoned" | "refund_needed";
} | {
    outcome: "failed";
    status?: undefined;
}>>;
/**
 * An off-session charge whose outcome isn't known (no answer, Stripe down, an odd status). The row
 * stays waiting; the attempt is counted, and with `giveUp` an issue asks a person to decide.
 */
export declare const noteChargeAttempt: import("convex/server").RegisteredMutation<"public", {
    processorCheckoutId?: string | undefined;
    id: string;
    now: number;
    error: string;
    giveUp: boolean;
    max: number;
}, Promise<number>>;
/**
 * A person asked for an off-session charge to be tried again: its issue closes and the client tries
 * once more. The count is kept, since it picks the next idempotency key.
 */
export declare const reopenCharge: import("convex/server").RegisteredMutation<"public", {
    id: string;
    now: number;
}, Promise<null>>;
/** An on-session payment the bank refused: the buyer may try again on the same page, so the checkout stays open. */
export declare const noteError: import("convex/server").RegisteredMutation<"public", {
    id: string;
    error: string;
}, Promise<null>>;
/** Expired with nothing at the processor. */
export declare const abandon: import("convex/server").RegisteredMutation<"public", {
    id: string;
    now: number;
}, Promise<{
    outcome: "already_handled";
    status: "processing" | "paid" | "failed" | "abandoned" | "refund_needed";
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
    kind: "status_differs" | "amount_differs";
    detail: string;
}, Promise<null>>;
export declare const get: import("convex/server").RegisteredQuery<"public", {
    id: string;
}, Promise<{
    method: "paypal" | "card" | "ach";
    expiresAt: number;
    id: string;
    description: string;
    app: string;
    status: "processing" | "paid" | "pending" | "failed" | "created" | "abandoned" | "refund_needed";
    processorCheckoutId: string | null;
    chargeKey: string | null;
    paymentRef: string | null;
    ref: {
        type: string;
        id: string;
    };
    amountCents: number;
    cancelUrl: string;
    context: any;
    kind: "hosted" | "offSession" | "onSession";
    payer: {
        name?: string | undefined;
        email: string;
    };
    paymentMethodId: string | null;
    processor: "stripe" | "paypal";
    purpose: string;
    retryOf: string | null;
    returnUrl: string;
    stripeCustomerId: string | null;
    processorFeeCents: number | null;
    paidCents: number | null;
    chargeAttempts: number;
    refundedCents: number;
    lastError: string | null;
    createdAt: number;
    lastTriedAt: number | null;
    disputed: boolean;
    settledAt: number | null;
} | null>>;
export declare const byProcessorId: import("convex/server").RegisteredQuery<"public", {
    processorCheckoutId: string;
}, Promise<{
    method: "paypal" | "card" | "ach";
    expiresAt: number;
    id: string;
    description: string;
    app: string;
    status: "processing" | "paid" | "pending" | "failed" | "created" | "abandoned" | "refund_needed";
    processorCheckoutId: string | null;
    chargeKey: string | null;
    paymentRef: string | null;
    ref: {
        type: string;
        id: string;
    };
    amountCents: number;
    cancelUrl: string;
    context: any;
    kind: "hosted" | "offSession" | "onSession";
    payer: {
        name?: string | undefined;
        email: string;
    };
    paymentMethodId: string | null;
    processor: "stripe" | "paypal";
    purpose: string;
    retryOf: string | null;
    returnUrl: string;
    stripeCustomerId: string | null;
    processorFeeCents: number | null;
    paidCents: number | null;
    chargeAttempts: number;
    refundedCents: number;
    lastError: string | null;
    createdAt: number;
    lastTriedAt: number | null;
    disputed: boolean;
    settledAt: number | null;
} | null>>;
export declare const byPaymentRef: import("convex/server").RegisteredQuery<"public", {
    paymentRef: string;
}, Promise<{
    method: "paypal" | "card" | "ach";
    expiresAt: number;
    id: string;
    description: string;
    app: string;
    status: "processing" | "paid" | "pending" | "failed" | "created" | "abandoned" | "refund_needed";
    processorCheckoutId: string | null;
    chargeKey: string | null;
    paymentRef: string | null;
    ref: {
        type: string;
        id: string;
    };
    amountCents: number;
    cancelUrl: string;
    context: any;
    kind: "hosted" | "offSession" | "onSession";
    payer: {
        name?: string | undefined;
        email: string;
    };
    paymentMethodId: string | null;
    processor: "stripe" | "paypal";
    purpose: string;
    retryOf: string | null;
    returnUrl: string;
    stripeCustomerId: string | null;
    processorFeeCents: number | null;
    paidCents: number | null;
    chargeAttempts: number;
    refundedCents: number;
    lastError: string | null;
    createdAt: number;
    lastTriedAt: number | null;
    disputed: boolean;
    settledAt: number | null;
} | null>>;
/** The checkouts for one thing in the app, newest first (at most 50). */
export declare const byRef: import("convex/server").RegisteredQuery<"public", {
    ref: {
        type: string;
        id: string;
    };
}, Promise<{
    method: "paypal" | "card" | "ach";
    expiresAt: number;
    id: string;
    description: string;
    app: string;
    status: "processing" | "paid" | "pending" | "failed" | "created" | "abandoned" | "refund_needed";
    processorCheckoutId: string | null;
    chargeKey: string | null;
    paymentRef: string | null;
    ref: {
        type: string;
        id: string;
    };
    amountCents: number;
    cancelUrl: string;
    context: any;
    kind: "hosted" | "offSession" | "onSession";
    payer: {
        name?: string | undefined;
        email: string;
    };
    paymentMethodId: string | null;
    processor: "stripe" | "paypal";
    purpose: string;
    retryOf: string | null;
    returnUrl: string;
    stripeCustomerId: string | null;
    processorFeeCents: number | null;
    paidCents: number | null;
    chargeAttempts: number;
    refundedCents: number;
    lastError: string | null;
    createdAt: number;
    lastTriedAt: number | null;
    disputed: boolean;
    settledAt: number | null;
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
        method: "paypal" | "card" | "ach";
        expiresAt: number;
        id: string;
        description: string;
        app: string;
        status: "processing" | "paid" | "pending" | "failed" | "created" | "abandoned" | "refund_needed";
        processorCheckoutId: string | null;
        chargeKey: string | null;
        paymentRef: string | null;
        ref: {
            type: string;
            id: string;
        };
        amountCents: number;
        cancelUrl: string;
        context: any;
        kind: "hosted" | "offSession" | "onSession";
        payer: {
            name?: string | undefined;
            email: string;
        };
        paymentMethodId: string | null;
        processor: "stripe" | "paypal";
        purpose: string;
        retryOf: string | null;
        returnUrl: string;
        stripeCustomerId: string | null;
        processorFeeCents: number | null;
        paidCents: number | null;
        chargeAttempts: number;
        refundedCents: number;
        lastError: string | null;
        createdAt: number;
        lastTriedAt: number | null;
        disputed: boolean;
        settledAt: number | null;
    }[];
    isDone: boolean;
    continueCursor: import("convex/server").Cursor;
    splitCursor?: import("convex/server").Cursor | null;
    pageStatus?: "SplitRecommended" | "SplitRequired" | null;
}>>;
/**
 * Paid checkouts with something left to refund, newest first, a page at a time (for a refund screen).
 * With `ref`, only that thing's. Fully refunded rows are left out of each page, so a page may be short.
 */
export declare const refundable: import("convex/server").RegisteredQuery<"public", {
    ref?: {
        type: string;
        id: string;
    } | undefined;
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
        method: "paypal" | "card" | "ach";
        expiresAt: number;
        id: string;
        description: string;
        app: string;
        status: "processing" | "paid" | "pending" | "failed" | "created" | "abandoned" | "refund_needed";
        processorCheckoutId: string | null;
        chargeKey: string | null;
        paymentRef: string | null;
        ref: {
            type: string;
            id: string;
        };
        amountCents: number;
        cancelUrl: string;
        context: any;
        kind: "hosted" | "offSession" | "onSession";
        payer: {
            name?: string | undefined;
            email: string;
        };
        paymentMethodId: string | null;
        processor: "stripe" | "paypal";
        purpose: string;
        retryOf: string | null;
        returnUrl: string;
        stripeCustomerId: string | null;
        processorFeeCents: number | null;
        paidCents: number | null;
        chargeAttempts: number;
        refundedCents: number;
        lastError: string | null;
        createdAt: number;
        lastTriedAt: number | null;
        disputed: boolean;
        settledAt: number | null;
    }[];
    isDone: boolean;
    continueCursor: import("convex/server").Cursor;
    splitCursor?: import("convex/server").Cursor | null;
    pageStatus?: "SplitRecommended" | "SplitRequired" | null;
}>>;
/** The off-session charge made under an app's idempotency key, if any. */
export declare const byChargeKey: import("convex/server").RegisteredQuery<"public", {
    chargeKey: string;
}, Promise<{
    method: "paypal" | "card" | "ach";
    expiresAt: number;
    id: string;
    description: string;
    app: string;
    status: "processing" | "paid" | "pending" | "failed" | "created" | "abandoned" | "refund_needed";
    processorCheckoutId: string | null;
    chargeKey: string | null;
    paymentRef: string | null;
    ref: {
        type: string;
        id: string;
    };
    amountCents: number;
    cancelUrl: string;
    context: any;
    kind: "hosted" | "offSession" | "onSession";
    payer: {
        name?: string | undefined;
        email: string;
    };
    paymentMethodId: string | null;
    processor: "stripe" | "paypal";
    purpose: string;
    retryOf: string | null;
    returnUrl: string;
    stripeCustomerId: string | null;
    processorFeeCents: number | null;
    paidCents: number | null;
    chargeAttempts: number;
    refundedCents: number;
    lastError: string | null;
    createdAt: number;
    lastTriedAt: number | null;
    disputed: boolean;
    settledAt: number | null;
} | null>>;
/** The on-session retries of a checkout, newest first. */
export declare const retriesOf: import("convex/server").RegisteredQuery<"public", {
    id: string;
}, Promise<{
    method: "paypal" | "card" | "ach";
    expiresAt: number;
    id: string;
    description: string;
    app: string;
    status: "processing" | "paid" | "pending" | "failed" | "created" | "abandoned" | "refund_needed";
    processorCheckoutId: string | null;
    chargeKey: string | null;
    paymentRef: string | null;
    ref: {
        type: string;
        id: string;
    };
    amountCents: number;
    cancelUrl: string;
    context: any;
    kind: "hosted" | "offSession" | "onSession";
    payer: {
        name?: string | undefined;
        email: string;
    };
    paymentMethodId: string | null;
    processor: "stripe" | "paypal";
    purpose: string;
    retryOf: string | null;
    returnUrl: string;
    stripeCustomerId: string | null;
    processorFeeCents: number | null;
    paidCents: number | null;
    chargeAttempts: number;
    refundedCents: number;
    lastError: string | null;
    createdAt: number;
    lastTriedAt: number | null;
    disputed: boolean;
    settledAt: number | null;
}[]>>;
/** Checkouts created since a time, oldest first, for the nightly comparison. */
export declare const createdSince: import("convex/server").RegisteredQuery<"public", {
    after?: number | undefined;
    limit: number;
    since: number;
}, Promise<{
    method: "paypal" | "card" | "ach";
    expiresAt: number;
    id: string;
    description: string;
    app: string;
    status: "processing" | "paid" | "pending" | "failed" | "created" | "abandoned" | "refund_needed";
    processorCheckoutId: string | null;
    chargeKey: string | null;
    paymentRef: string | null;
    ref: {
        type: string;
        id: string;
    };
    amountCents: number;
    cancelUrl: string;
    context: any;
    kind: "hosted" | "offSession" | "onSession";
    payer: {
        name?: string | undefined;
        email: string;
    };
    paymentMethodId: string | null;
    processor: "stripe" | "paypal";
    purpose: string;
    retryOf: string | null;
    returnUrl: string;
    stripeCustomerId: string | null;
    processorFeeCents: number | null;
    paidCents: number | null;
    chargeAttempts: number;
    refundedCents: number;
    lastError: string | null;
    createdAt: number;
    lastTriedAt: number | null;
    disputed: boolean;
    settledAt: number | null;
}[]>>;
/** Not-final checkouts for sweep: every created/pending/processing row, oldest expiry first. */
export declare const due: import("convex/server").RegisteredQuery<"public", {
    limit: number;
}, Promise<{
    method: "paypal" | "card" | "ach";
    expiresAt: number;
    id: string;
    description: string;
    app: string;
    status: "processing" | "paid" | "pending" | "failed" | "created" | "abandoned" | "refund_needed";
    processorCheckoutId: string | null;
    chargeKey: string | null;
    paymentRef: string | null;
    ref: {
        type: string;
        id: string;
    };
    amountCents: number;
    cancelUrl: string;
    context: any;
    kind: "hosted" | "offSession" | "onSession";
    payer: {
        name?: string | undefined;
        email: string;
    };
    paymentMethodId: string | null;
    processor: "stripe" | "paypal";
    purpose: string;
    retryOf: string | null;
    returnUrl: string;
    stripeCustomerId: string | null;
    processorFeeCents: number | null;
    paidCents: number | null;
    chargeAttempts: number;
    refundedCents: number;
    lastError: string | null;
    createdAt: number;
    lastTriedAt: number | null;
    disputed: boolean;
    settledAt: number | null;
}[]>>;
export type CheckoutId = Id<'checkouts'>;
//# sourceMappingURL=checkouts.d.ts.map