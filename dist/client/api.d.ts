import { type GenericValidator } from 'convex/values';
import type { Payments } from './index.js';
export declare function worker<C extends GenericValidator>(p: Payments<C>): {
    sweep: import("convex/server").RegisteredAction<"internal", {}, Promise<null>>;
    reconcile: import("convex/server").RegisteredAction<"internal", {
        days?: number | undefined;
    }, Promise<null>>;
    cleanup: import("convex/server").RegisteredMutation<"internal", {}, Promise<{
        deleted: number;
        more: boolean;
    }>>;
    issuesDigest: import("convex/server").RegisteredMutation<"internal", {}, Promise<number>>;
    /** An off-session charge (chargeSaved queues it; it queues its own retries). */
    charge: import("convex/server").RegisteredAction<"internal", {
        manual?: boolean | undefined;
        checkoutId: string;
    }, Promise<null>>;
};
export interface AdminApiOptions {
    /** Sending a refund doesn't need a separate approval (an app with one admin role). Default false. */
    skipApproval?: boolean;
}
export declare function adminApi<C extends GenericValidator>(p: Payments<C>, o: AdminApiOptions): {
    /** Refunds waiting on someone (requested, approved, sending, failed), oldest first, each with its payment. */
    openRefunds: import("convex/server").RegisteredQuery<"public", {
        auth?: any;
    }, Promise<{
        checkout: {
            id: string;
            ref: {
                id: string;
                type: string;
            };
            purpose: string;
            kind: "hosted" | "offSession" | "onSession";
            description: string;
            processor: "stripe" | "paypal";
            method: "paypal" | "card" | "ach";
            payer: {
                email: string;
                name?: string;
            };
            status: "processing" | "paid" | "pending" | "failed" | "created" | "abandoned" | "refund_needed";
            paymentRef: string | null;
            amountCents: number;
            paidCents: number | null;
            refundedCents: number;
            createdAt: number;
        } | null;
        amountCents: number;
        approvedBy: string | null;
        attempts: number;
        checkoutId: string;
        createdAt: number;
        error: string | null;
        id: string;
        note: string | null;
        origin: "requested" | "needed" | "external";
        processorRefundId: string | null;
        reason: string;
        requestedBy: string | null;
        sentAt: number | null;
        status: "requested" | "approved" | "sending" | "sent" | "failed" | "manual" | "dismissed";
        updatedAt: number;
    }[]>>;
    /** Paid checkouts with something left to refund, newest first, a page at a time; with `ref`, one thing's. */
    refundable: import("convex/server").RegisteredQuery<"public", {
        ref?: {
            type: string;
            id: string;
        } | undefined;
        auth?: any;
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
            ref: {
                id: string;
                type: string;
            };
            purpose: string;
            kind: "hosted" | "offSession" | "onSession";
            description: string;
            processor: "stripe" | "paypal";
            method: "paypal" | "card" | "ach";
            payer: {
                email: string;
                name?: string;
            };
            status: "processing" | "paid" | "pending" | "failed" | "created" | "abandoned" | "refund_needed";
            paymentRef: string | null;
            amountCents: number;
            paidCents: number | null;
            refundedCents: number;
            createdAt: number;
        }[];
        continueCursor: string;
        isDone: boolean;
        pageStatus?: "SplitRecommended" | "SplitRequired" | null;
        splitCursor?: string | null;
    }>>;
    /** Issues (differences from the processors, disputes, failed callbacks, charges with an unknown outcome), open ones by default. */
    issues: import("convex/server").RegisteredQuery<"public", {
        open?: boolean | undefined;
        auth?: any;
        paginationOpts: {
            id?: number;
            endCursor?: string | null;
            maximumRowsRead?: number;
            maximumBytesRead?: number;
            numItems: number;
            cursor: string | null;
        };
    }, Promise<{
        continueCursor: string;
        isDone: boolean;
        page: Array<{
            checkoutId: string | null;
            detail: string;
            id: string;
            key: string;
            kind: "missing_here" | "missing_there" | "amount_differs" | "status_differs" | "dispute" | "callback_failed" | "charge_unknown";
            openedAt: number;
            paymentRef: string | null;
            processor: "stripe" | "paypal";
            reportedAt: number | null;
            resolvedAt: number | null;
        }>;
        pageStatus?: "SplitRecommended" | "SplitRequired" | null;
        splitCursor?: string | null;
    }>>;
    /** Open refunds plus open issues, for a badge. */
    openCount: import("convex/server").RegisteredQuery<"public", {
        auth?: any;
    }, Promise<number>>;
    /** One checkout with its refunds. */
    checkout: import("convex/server").RegisteredQuery<"public", {
        auth?: any;
        checkoutId: string;
    }, Promise<{
        checkout: {
            id: string;
            ref: {
                id: string;
                type: string;
            };
            purpose: string;
            kind: "hosted" | "offSession" | "onSession";
            description: string;
            processor: "stripe" | "paypal";
            method: "paypal" | "card" | "ach";
            payer: {
                email: string;
                name?: string;
            };
            status: "processing" | "paid" | "pending" | "failed" | "created" | "abandoned" | "refund_needed";
            paymentRef: string | null;
            amountCents: number;
            paidCents: number | null;
            refundedCents: number;
            createdAt: number;
        };
        lastError: string | null;
        refunds: {
            amountCents: number;
            approvedBy: string | null;
            attempts: number;
            checkoutId: string;
            createdAt: number;
            error: string | null;
            id: string;
            note: string | null;
            origin: "requested" | "needed" | "external";
            processorRefundId: string | null;
            reason: string;
            requestedBy: string | null;
            sentAt: number | null;
            status: "requested" | "approved" | "sending" | "sent" | "failed" | "manual" | "dismissed";
            updatedAt: number;
        }[];
    } | null>>;
    /** Asks for a refund, the whole remaining amount unless given. Returns the refund's id. */
    requestRefund: import("convex/server").RegisteredMutation<"public", {
        amountCents?: number | undefined;
        auth?: any;
        checkoutId: string;
        reason: string;
    }, Promise<string>>;
    approveRefund: import("convex/server").RegisteredMutation<"public", {
        auth?: any;
        refundId: string;
    }, Promise<null>>;
    /** Sends a refund through the processor that took the money (keyed by the refund, so a double click refunds once). */
    sendRefund: import("convex/server").RegisteredAction<"public", {
        auth?: any;
        refundId: string;
    }, Promise<{
        status: string;
        error: string | null;
    } | null>>;
    /** For a refund made outside the app, e.g. in the processor's own dashboard. */
    markRefundedManually: import("convex/server").RegisteredMutation<"public", {
        note?: string | undefined;
        auth?: any;
        refundId: string;
    }, Promise<null>>;
    /** Decided not to refund. */
    dismissRefund: import("convex/server").RegisteredMutation<"public", {
        note?: string | undefined;
        auth?: any;
        refundId: string;
    }, Promise<null>>;
    resolveIssue: import("convex/server").RegisteredMutation<"public", {
        auth?: any;
        issueId: string;
    }, Promise<null>>;
    /**
     * Tries an off-session charge with an unknown outcome once more. Safe if the first try went
     * through: the library looks for its PaymentIntent before charging again.
     */
    retryCharge: import("convex/server").RegisteredMutation<"public", {
        auth?: any;
        checkoutId: string;
    }, Promise<null>>;
    /**
     * Gives up on an off-session charge with an unknown outcome: it fails, and the app's on.failed
     * decides what next (e.g. ask the buyer to pay). Stripe is asked first: a charge it shows paid or
     * on its way is settled instead, and one still open there is canceled, so giving up can never
     * leave a charge behind that pays later.
     */
    giveUpCharge: import("convex/server").RegisteredAction<"public", {
        auth?: any;
        checkoutId: string;
    }, Promise<{
        status: string;
    }>>;
};
export declare function publicApi<C extends GenericValidator>(p: Payments<C>): {
    /**
     * The page the buyer comes back to: `token` is Stripe's session_id (or payment_intent) or PayPal's
     * token. Settles the checkout if the processor says it's paid and the webhook hasn't arrived;
     * safe to reload. Says only how it stands, nothing about the payer.
     */
    completeReturn: import("convex/server").RegisteredAction<"public", {
        token: string;
        processor: "stripe" | "paypal";
    }, Promise<{
        status: string;
        purpose: string;
        ref: {
            type: string;
            id: string;
        };
    } | null>>;
};
//# sourceMappingURL=api.d.ts.map