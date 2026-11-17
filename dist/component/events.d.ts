export declare const begin: import("convex/server").RegisteredMutation<"public", {
    now: number;
    processor: "paypal" | "stripe";
    eventId: string;
    type: string;
}, Promise<"new" | "seen">>;
export declare const finish: import("convex/server").RegisteredMutation<"public", {
    processor: "paypal" | "stripe";
    outcome: "foreign" | "received" | "handled" | "ignored";
    eventId: string;
}, Promise<null>>;
//# sourceMappingURL=events.d.ts.map