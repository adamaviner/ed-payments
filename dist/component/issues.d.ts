export declare const issueView: import("convex/values").VObject<{
    id: string;
    paymentRef: string | null;
    processor: "paypal" | "stripe";
    detail: string;
    kind: "status_differs" | "amount_differs" | "missing_here" | "missing_there" | "dispute" | "callback_failed";
    checkoutId: string | null;
    key: string;
    openedAt: number;
    resolvedAt: number | null;
    reportedAt: number | null;
}, {
    id: import("convex/values").VString<string, "required">;
    kind: import("convex/values").VUnion<"status_differs" | "amount_differs" | "missing_here" | "missing_there" | "dispute" | "callback_failed", [import("convex/values").VLiteral<"missing_here", "required">, import("convex/values").VLiteral<"missing_there", "required">, import("convex/values").VLiteral<"amount_differs", "required">, import("convex/values").VLiteral<"status_differs", "required">, import("convex/values").VLiteral<"dispute", "required">, import("convex/values").VLiteral<"callback_failed", "required">], "required", never>;
    key: import("convex/values").VString<string, "required">;
    checkoutId: import("convex/values").VUnion<string | null, [import("convex/values").VString<string, "required">, import("convex/values").VNull<null, "required">], "required", never>;
    processor: import("convex/values").VUnion<"paypal" | "stripe", [import("convex/values").VLiteral<"stripe", "required">, import("convex/values").VLiteral<"paypal", "required">], "required", never>;
    paymentRef: import("convex/values").VUnion<string | null, [import("convex/values").VString<string, "required">, import("convex/values").VNull<null, "required">], "required", never>;
    detail: import("convex/values").VString<string, "required">;
    openedAt: import("convex/values").VFloat64<number, "required">;
    resolvedAt: import("convex/values").VUnion<number | null, [import("convex/values").VFloat64<number, "required">, import("convex/values").VNull<null, "required">], "required", never>;
    reportedAt: import("convex/values").VUnion<number | null, [import("convex/values").VFloat64<number, "required">, import("convex/values").VNull<null, "required">], "required", never>;
}, "required", "id" | "paymentRef" | "processor" | "detail" | "kind" | "checkoutId" | "key" | "openedAt" | "resolvedAt" | "reportedAt">;
/**
 * Reconcile's verdict on one payment: opens the kinds found (updating their detail), resolves the
 * compared kinds that are no longer found. Returns how many were opened and resolved.
 */
export declare const sync: import("convex/server").RegisteredMutation<"public", {
    paymentRef?: string | undefined;
    checkoutId?: string | undefined;
    only?: ("status_differs" | "amount_differs" | "missing_here" | "missing_there")[] | undefined;
    now: number;
    processor: "paypal" | "stripe";
    found: {
        detail: string;
        kind: "status_differs" | "amount_differs" | "missing_here" | "missing_there";
    }[];
    key: string;
}, Promise<{
    opened: number;
    resolved: number;
}>>;
/** Marks an issue resolved by hand. */
export declare const resolve: import("convex/server").RegisteredMutation<"public", {
    id: string;
    now: number;
}, Promise<null>>;
/** Open issues (resolvedAt unset) first by age, or all, paginated. */
export declare const list: import("convex/server").RegisteredQuery<"public", {
    paginationOpts: {
        id?: number;
        endCursor?: string | null;
        maximumRowsRead?: number;
        maximumBytesRead?: number;
        numItems: number;
        cursor: string | null;
    };
    open: boolean;
}, Promise<{
    page: {
        id: import("convex/values").GenericId<"issues">;
        kind: "status_differs" | "amount_differs" | "missing_here" | "missing_there" | "dispute" | "callback_failed";
        key: string;
        checkoutId: import("convex/values").GenericId<"checkouts"> | null;
        processor: "paypal" | "stripe";
        paymentRef: string | null;
        detail: string;
        openedAt: number;
        resolvedAt: number | null;
        reportedAt: number | null;
    }[];
    isDone: boolean;
    continueCursor: import("convex/server").Cursor;
    splitCursor?: import("convex/server").Cursor | null;
    pageStatus?: "SplitRecommended" | "SplitRequired" | null;
}>>;
/** How many are open (up to `cap`), for a badge. */
export declare const openCount: import("convex/server").RegisteredQuery<"public", {
    cap?: number | undefined;
}, Promise<number>>;
/** Issues nobody was told about yet, oldest first, for the host's digest email. */
export declare const unreported: import("convex/server").RegisteredQuery<"public", {
    limit?: number | undefined;
}, Promise<{
    id: import("convex/values").GenericId<"issues">;
    kind: "status_differs" | "amount_differs" | "missing_here" | "missing_there" | "dispute" | "callback_failed";
    key: string;
    checkoutId: import("convex/values").GenericId<"checkouts"> | null;
    processor: "paypal" | "stripe";
    paymentRef: string | null;
    detail: string;
    openedAt: number;
    resolvedAt: number | null;
    reportedAt: number | null;
}[]>>;
export declare const markReported: import("convex/server").RegisteredMutation<"public", {
    now: number;
    ids: string[];
}, Promise<null>>;
//# sourceMappingURL=issues.d.ts.map