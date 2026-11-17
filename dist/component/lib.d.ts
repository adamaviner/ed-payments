import { type Infer } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel.js';
import type { MutationCtx } from './_generated/server.js';
import { issueKind } from './schema.js';
export declare const checkoutView: import("convex/values").VObject<{
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
}, {
    id: import("convex/values").VString<string, "required">;
    app: import("convex/values").VString<string, "required">;
    ref: import("convex/values").VObject<{
        id: string;
        type: string;
    }, {
        type: import("convex/values").VString<string, "required">;
        id: import("convex/values").VString<string, "required">;
    }, "required", "id" | "type">;
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
    processorCheckoutId: import("convex/values").VUnion<string | null, [import("convex/values").VString<string, "required">, import("convex/values").VNull<null, "required">], "required", never>;
    paymentRef: import("convex/values").VUnion<string | null, [import("convex/values").VString<string, "required">, import("convex/values").VNull<null, "required">], "required", never>;
    paidCents: import("convex/values").VUnion<number | null, [import("convex/values").VFloat64<number, "required">, import("convex/values").VNull<null, "required">], "required", never>;
    refundedCents: import("convex/values").VFloat64<number, "required">;
    processorFeeCents: import("convex/values").VUnion<number | null, [import("convex/values").VFloat64<number, "required">, import("convex/values").VNull<null, "required">], "required", never>;
    disputed: import("convex/values").VBoolean<boolean, "required">;
    context: import("convex/values").VAny<any, "required", string>;
    returnUrl: import("convex/values").VString<string, "required">;
    cancelUrl: import("convex/values").VString<string, "required">;
    expiresAt: import("convex/values").VFloat64<number, "required">;
    createdAt: import("convex/values").VFloat64<number, "required">;
    settledAt: import("convex/values").VUnion<number | null, [import("convex/values").VFloat64<number, "required">, import("convex/values").VNull<null, "required">], "required", never>;
    lastError: import("convex/values").VUnion<string | null, [import("convex/values").VString<string, "required">, import("convex/values").VNull<null, "required">], "required", never>;
}, "required", "id" | "processorCheckoutId" | "paymentRef" | "ref" | "amountCents" | "app" | "cancelUrl" | "context" | "description" | "expiresAt" | "method" | "payer" | "processor" | "purpose" | "returnUrl" | "processorFeeCents" | "paidCents" | "status" | "ref.id" | "ref.type" | `context.${string}` | "payer.name" | "payer.email" | "refundedCents" | "disputed" | "createdAt" | "settledAt" | "lastError">;
export type CheckoutView = Infer<typeof checkoutView>;
export declare function view(c: Doc<'checkouts'>): CheckoutView;
export declare const refundView: import("convex/values").VObject<{
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
}, {
    id: import("convex/values").VString<string, "required">;
    checkoutId: import("convex/values").VString<string, "required">;
    amountCents: import("convex/values").VFloat64<number, "required">;
    reason: import("convex/values").VString<string, "required">;
    origin: import("convex/values").VUnion<"requested" | "needed" | "external", [import("convex/values").VLiteral<"requested", "required">, import("convex/values").VLiteral<"needed", "required">, import("convex/values").VLiteral<"external", "required">], "required", never>;
    status: import("convex/values").VUnion<"failed" | "requested" | "approved" | "sending" | "sent" | "manual" | "dismissed", [import("convex/values").VLiteral<"requested", "required">, import("convex/values").VLiteral<"approved", "required">, import("convex/values").VLiteral<"sending", "required">, import("convex/values").VLiteral<"sent", "required">, import("convex/values").VLiteral<"failed", "required">, import("convex/values").VLiteral<"manual", "required">, import("convex/values").VLiteral<"dismissed", "required">], "required", never>;
    requestedBy: import("convex/values").VUnion<string | null, [import("convex/values").VString<string, "required">, import("convex/values").VNull<null, "required">], "required", never>;
    approvedBy: import("convex/values").VUnion<string | null, [import("convex/values").VString<string, "required">, import("convex/values").VNull<null, "required">], "required", never>;
    processorRefundId: import("convex/values").VUnion<string | null, [import("convex/values").VString<string, "required">, import("convex/values").VNull<null, "required">], "required", never>;
    note: import("convex/values").VUnion<string | null, [import("convex/values").VString<string, "required">, import("convex/values").VNull<null, "required">], "required", never>;
    error: import("convex/values").VUnion<string | null, [import("convex/values").VString<string, "required">, import("convex/values").VNull<null, "required">], "required", never>;
    createdAt: import("convex/values").VFloat64<number, "required">;
    updatedAt: import("convex/values").VFloat64<number, "required">;
    sentAt: import("convex/values").VUnion<number | null, [import("convex/values").VFloat64<number, "required">, import("convex/values").VNull<null, "required">], "required", never>;
    /** Sends the processor refused; the idempotency key of the next send depends on it. */
    attempts: import("convex/values").VFloat64<number, "required">;
}, "required", "id" | "amountCents" | "error" | "reason" | "status" | "checkoutId" | "note" | "processorRefundId" | "origin" | "createdAt" | "requestedBy" | "approvedBy" | "updatedAt" | "sentAt" | "attempts">;
export type RefundView = Infer<typeof refundView>;
export declare function refundViewOf(r: Doc<'refunds'>): RefundView;
/**
 * A thrown error as one sentence. Errors from the host's functions arrive as
 * "Uncaught Error: <message>\n    at handler (...)"; the stack and prefix are dropped.
 */
export declare function errorText(err: unknown): string;
export type HostCall<R> = {
    ok: true;
    value: R;
} | {
    ok: false;
    error: string;
};
/**
 * Calls one of the host's callbacks in this transaction. If it throws, only its own writes roll back
 * (checked at stage 0 in convex-test and on a local backend) and the error comes back.
 */
export declare function callHost<R>(ctx: MutationCtx, handle: string, args: Record<string, unknown>): Promise<HostCall<R>>;
/** The fields every callback gets about its checkout. */
export declare function callbackBase(c: Doc<'checkouts'>): {
    checkoutId: string;
    ref: {
        id: string;
        type: string;
    };
    purpose: string;
    processor: "paypal" | "stripe";
    method: "card" | "ach" | "paypal";
    payer: {
        name?: string | undefined;
        email: string;
    };
    context: any;
};
export type IssueKind = Infer<typeof issueKind>;
/** Opens an issue, or updates the detail of the one already open for this key and kind. Returns whether it is new. */
export declare function openIssue(ctx: MutationCtx, i: {
    kind: IssueKind;
    key: string;
    checkoutId?: Id<'checkouts'>;
    processor: Doc<'checkouts'>['processor'];
    paymentRef?: string;
    detail: string;
    now: number;
}): Promise<boolean>;
export declare function resolveIssue(ctx: MutationCtx, key: string, kind: IssueKind, now: number): Promise<boolean>;
/** Calls a callback that can't refuse anything (failed, refunded, refund needed, dispute); a throw becomes a callback_failed issue. */
export declare function notifyHost(ctx: MutationCtx, c: Doc<'checkouts'>, name: 'onFailed' | 'onRefunded' | 'onRefundNeeded' | 'onDispute', args: Record<string, unknown>, now: number): Promise<void>;
/** Refunds in progress or done, which the remaining amount is reduced by. */
export declare const COMMITTED_REFUND: ReadonlySet<Doc<'refunds'>['status']>;
export declare function refundsOf(ctx: MutationCtx, checkoutId: Id<'checkouts'>): Promise<{
    _id: import("convex/values").GenericId<"refunds">;
    _creationTime: number;
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
}[]>;
//# sourceMappingURL=lib.d.ts.map