export declare const EVENT_DAYS = 30;
export declare const RESOLVED_ISSUE_DAYS = 180;
export declare const cleanup: import("convex/server").RegisteredMutation<"public", {
    batch?: number | undefined;
    now: number;
}, Promise<{
    deleted: number;
    more: boolean;
}>>;
//# sourceMappingURL=maintenance.d.ts.map