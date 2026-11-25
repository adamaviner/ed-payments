export declare const record: import("convex/server").RegisteredMutation<"public", {
    amountCents?: number | undefined;
    reason?: string | undefined;
    lost?: boolean | undefined;
    outcome?: string | undefined;
    status: "opened" | "closed";
    now: number;
    paymentRef: string;
    processor: "stripe" | "paypal";
    disputeId: string;
}, Promise<"foreign" | "recorded">>;
//# sourceMappingURL=disputes.d.ts.map