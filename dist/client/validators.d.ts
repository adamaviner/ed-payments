import { v, type Infer } from 'convex/values';
import type { FunctionReference } from 'convex/server';
/** onPaid: the money arrived. Record the sale; return null, or { refuse } to have it refunded instead (throwing does the same). */
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
    processor: import("convex/values").VUnion<"paypal" | "stripe", [import("convex/values").VLiteral<"stripe", "required">, import("convex/values").VLiteral<"paypal", "required">], "required", never>;
    method: import("convex/values").VUnion<"card" | "ach" | "paypal", [import("convex/values").VLiteral<"card", "required">, import("convex/values").VLiteral<"ach", "required">, import("convex/values").VLiteral<"paypal", "required">], "required", never>;
    payer: import("convex/values").VObject<{
        name?: string | undefined;
        email: string;
    }, {
        name: import("convex/values").VString<string | undefined, "optional">;
        email: import("convex/values").VString<string, "required">;
    }, "required", "name" | "email">;
    /** What the host passed to start as `context`, or null. */
    context: import("convex/values").VAny<any, "required", string>;
};
export declare const paidReturns: import("convex/values").VUnion<{
    refuse: string;
} | null, [import("convex/values").VNull<null, "required">, import("convex/values").VObject<{
    refuse: string;
}, {
    refuse: import("convex/values").VString<string, "required">;
}, "required", "refuse">], "required", "refuse">;
/** onFailed: the processor said no (a declined capture, a bounced bank debit). */
export declare const failedArgs: {
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
    processor: import("convex/values").VUnion<"paypal" | "stripe", [import("convex/values").VLiteral<"stripe", "required">, import("convex/values").VLiteral<"paypal", "required">], "required", never>;
    method: import("convex/values").VUnion<"card" | "ach" | "paypal", [import("convex/values").VLiteral<"card", "required">, import("convex/values").VLiteral<"ach", "required">, import("convex/values").VLiteral<"paypal", "required">], "required", never>;
    payer: import("convex/values").VObject<{
        name?: string | undefined;
        email: string;
    }, {
        name: import("convex/values").VString<string | undefined, "optional">;
        email: import("convex/values").VString<string, "required">;
    }, "required", "name" | "email">;
    /** What the host passed to start as `context`, or null. */
    context: import("convex/values").VAny<any, "required", string>;
};
/** onRefunded: a refund went back to the buyer (sent, done by hand, or made at the processor). */
export declare const refundedArgs: {
    refundId: import("convex/values").VString<string, "required">;
    amountCents: import("convex/values").VFloat64<number, "required">;
    refundedCents: import("convex/values").VFloat64<number, "required">;
    paidCents: import("convex/values").VFloat64<number, "required">;
    origin: import("convex/values").VUnion<"requested" | "needed" | "external", [import("convex/values").VLiteral<"requested", "required">, import("convex/values").VLiteral<"needed", "required">, import("convex/values").VLiteral<"external", "required">], "required", never>;
    checkoutId: import("convex/values").VString<string, "required">;
    ref: import("convex/values").VObject<{
        id: string;
        type: string;
    }, {
        type: import("convex/values").VString<string, "required">;
        id: import("convex/values").VString<string, "required">;
    }, "required", "id" | "type">;
    purpose: import("convex/values").VString<string, "required">;
    processor: import("convex/values").VUnion<"paypal" | "stripe", [import("convex/values").VLiteral<"stripe", "required">, import("convex/values").VLiteral<"paypal", "required">], "required", never>;
    method: import("convex/values").VUnion<"card" | "ach" | "paypal", [import("convex/values").VLiteral<"card", "required">, import("convex/values").VLiteral<"ach", "required">, import("convex/values").VLiteral<"paypal", "required">], "required", never>;
    payer: import("convex/values").VObject<{
        name?: string | undefined;
        email: string;
    }, {
        name: import("convex/values").VString<string | undefined, "optional">;
        email: import("convex/values").VString<string, "required">;
    }, "required", "name" | "email">;
    /** What the host passed to start as `context`, or null. */
    context: import("convex/values").VAny<any, "required", string>;
};
/** onRefundNeeded: money arrived for a sale the host refused; a refund for it is waiting. */
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
    processor: import("convex/values").VUnion<"paypal" | "stripe", [import("convex/values").VLiteral<"stripe", "required">, import("convex/values").VLiteral<"paypal", "required">], "required", never>;
    method: import("convex/values").VUnion<"card" | "ach" | "paypal", [import("convex/values").VLiteral<"card", "required">, import("convex/values").VLiteral<"ach", "required">, import("convex/values").VLiteral<"paypal", "required">], "required", never>;
    payer: import("convex/values").VObject<{
        name?: string | undefined;
        email: string;
    }, {
        name: import("convex/values").VString<string | undefined, "optional">;
        email: import("convex/values").VString<string, "required">;
    }, "required", "name" | "email">;
    /** What the host passed to start as `context`, or null. */
    context: import("convex/values").VAny<any, "required", string>;
};
/** onDispute: the buyer disputed the payment (opened), or the dispute ended (closed). */
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
    processor: import("convex/values").VUnion<"paypal" | "stripe", [import("convex/values").VLiteral<"stripe", "required">, import("convex/values").VLiteral<"paypal", "required">], "required", never>;
    method: import("convex/values").VUnion<"card" | "ach" | "paypal", [import("convex/values").VLiteral<"card", "required">, import("convex/values").VLiteral<"ach", "required">, import("convex/values").VLiteral<"paypal", "required">], "required", never>;
    payer: import("convex/values").VObject<{
        name?: string | undefined;
        email: string;
    }, {
        name: import("convex/values").VString<string | undefined, "optional">;
        email: import("convex/values").VString<string, "required">;
    }, "required", "name" | "email">;
    /** What the host passed to start as `context`, or null. */
    context: import("convex/values").VAny<any, "required", string>;
};
export type Paid = Infer<ReturnType<typeof v.object<typeof paidArgs>>>;
export type PaidResult = Infer<typeof paidReturns>;
export type Failed = Infer<ReturnType<typeof v.object<typeof failedArgs>>>;
export type Refunded = Infer<ReturnType<typeof v.object<typeof refundedArgs>>>;
export type RefundNeeded = Infer<ReturnType<typeof v.object<typeof refundNeededArgs>>>;
export type Dispute = Infer<ReturnType<typeof v.object<typeof disputeArgs>>>;
/** The host's callbacks, as internal mutations. */
export interface Callbacks {
    onPaid?: FunctionReference<'mutation', 'internal', Paid, PaidResult>;
    onFailed?: FunctionReference<'mutation', 'internal', Failed, unknown>;
    onRefunded?: FunctionReference<'mutation', 'internal', Refunded, unknown>;
    onRefundNeeded?: FunctionReference<'mutation', 'internal', RefundNeeded, unknown>;
    onDispute?: FunctionReference<'mutation', 'internal', Dispute, unknown>;
}
//# sourceMappingURL=validators.d.ts.map