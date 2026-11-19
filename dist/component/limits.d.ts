import { type Infer } from 'convex/values';
import { type MutationCtx } from './_generated/server.js';
export declare const limitsArg: import("convex/values").VArray<{
    max: number;
    key: string;
    windowMs: number;
    message: string;
}[], import("convex/values").VObject<{
    max: number;
    key: string;
    windowMs: number;
    message: string;
}, {
    key: import("convex/values").VString<string, "required">;
    max: import("convex/values").VFloat64<number, "required">;
    windowMs: import("convex/values").VFloat64<number, "required">;
    /** Said to the caller when this key is full. */
    message: import("convex/values").VString<string, "required">;
}, "required", "max" | "key" | "windowMs" | "message">, "required">;
export type Limits = Infer<typeof limitsArg>;
/** Counts one against every key, or throws the first full key's message without counting any. */
export declare function takeAll(ctx: MutationCtx, limits: Limits, now: number): Promise<void>;
/** Hands back one counted against `key` in its current window (a start the buyer closed again). */
export declare function giveBackOne(ctx: MutationCtx, key: string, now: number, windowMs: number): Promise<void>;
export declare const take: import("convex/server").RegisteredMutation<"public", {
    now: number;
    limits: {
        max: number;
        key: string;
        windowMs: number;
        message: string;
    }[];
}, Promise<null>>;
//# sourceMappingURL=limits.d.ts.map