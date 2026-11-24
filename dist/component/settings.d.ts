import { type QueryCtx } from './_generated/server.js';
/** About three months for abandoned and failed checkouts. Paid ones and refunds are kept forever. */
export declare const DEFAULT_RETENTION_DAYS = 90;
export declare function readSettings(ctx: QueryCtx): Promise<{
    row: {
        _id: import("convex/values").GenericId<"settings">;
        _creationTime: number;
        retentionDays?: number | undefined;
        paypalToken?: string | undefined;
        paypalTokenExpiresAt?: number | undefined;
        paypalTokenAccount?: string | undefined;
        searchRefusedAt?: number | undefined;
    } | null;
    retentionDays: number;
}>;
export declare const get: import("convex/server").RegisteredQuery<"public", {}, Promise<{
    retentionDays: number;
}>>;
export declare const update: import("convex/server").RegisteredMutation<"public", {
    retentionDays: number;
}, Promise<null>>;
export declare const paypalToken: import("convex/server").RegisteredQuery<"public", {}, Promise<{
    sealed: string;
    expiresAt: number;
    account: string;
} | null>>;
export declare const savePaypalToken: import("convex/server").RegisteredMutation<"public", {
    expiresAt: number;
    account: string;
    sealed: string;
}, Promise<null>>;
/** When PayPal last refused Transaction Search (null: never, or it worked since). */
export declare const searchRefusedAt: import("convex/server").RegisteredQuery<"public", {}, Promise<number | null>>;
export declare const setSearchRefused: import("convex/server").RegisteredMutation<"public", {
    at: number | null;
}, Promise<null>>;
//# sourceMappingURL=settings.d.ts.map