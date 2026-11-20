export declare const begin: import("convex/server").RegisteredMutation<"public", {
    type: string;
    now: number;
    processor: "stripe" | "paypal";
    eventId: string;
}, Promise<"new" | "seen">>;
export declare const finish: import("convex/server").RegisteredMutation<"public", {
    processor: "stripe" | "paypal";
    outcome: "foreign" | "received" | "handled" | "ignored";
    eventId: string;
}, Promise<null>>;
//# sourceMappingURL=events.d.ts.map