export declare const record: import("convex/server").RegisteredMutation<"public", {
    amountCents?: number | undefined;
    reason?: string | undefined;
    outcome?: string | undefined;
    now: number;
    paymentRef: string;
    processor: "paypal" | "stripe";
    disputeId: string;
    status: "opened" | "closed";
}, Promise<"foreign" | "recorded">>;
//# sourceMappingURL=disputes.d.ts.map