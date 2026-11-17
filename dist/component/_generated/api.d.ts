/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */
import type * as checkouts from "../checkouts.js";
import type * as disputes from "../disputes.js";
import type * as events from "../events.js";
import type * as issues from "../issues.js";
import type * as lib from "../lib.js";
import type * as maintenance from "../maintenance.js";
import type * as refunds from "../refunds.js";
import type * as settings from "../settings.js";
import type { ApiFromModules, FilterApi, FunctionReference } from "convex/server";
declare const fullApi: ApiFromModules<{
    checkouts: typeof checkouts;
    disputes: typeof disputes;
    events: typeof events;
    issues: typeof issues;
    lib: typeof lib;
    maintenance: typeof maintenance;
    refunds: typeof refunds;
    settings: typeof settings;
}>;
/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<typeof fullApi, FunctionReference<any, "public">>;
/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<typeof fullApi, FunctionReference<any, "internal">>;
export declare const components: {};
export {};
//# sourceMappingURL=api.d.ts.map