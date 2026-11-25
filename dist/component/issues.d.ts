export declare const issueView: import("convex/values").VObject<{
    kind: "dispute" | "status_differs" | "amount_differs" | "missing_here" | "missing_there" | "callback_failed" | "charge_unknown";
    id: string;
    checkoutId: string | null;
    paymentRef: string | null;
    processor: "stripe" | "paypal";
    detail: string;
    key: string;
    openedAt: number;
    resolvedAt: number | null;
    reportedAt: number | null;
}, {
    id: import("convex/values").VString<string, "required">;
    kind: import("convex/values").VUnion<"dispute" | "status_differs" | "amount_differs" | "missing_here" | "missing_there" | "callback_failed" | "charge_unknown", [import("convex/values").VLiteral<"missing_here", "required">, import("convex/values").VLiteral<"missing_there", "required">, import("convex/values").VLiteral<"amount_differs", "required">, import("convex/values").VLiteral<"status_differs", "required">, import("convex/values").VLiteral<"dispute", "required">, import("convex/values").VLiteral<"callback_failed", "required">, import("convex/values").VLiteral<"charge_unknown", "required">], "required", never>;
    key: import("convex/values").VString<string, "required">;
    checkoutId: import("convex/values").VUnion<string | null, [import("convex/values").VString<string, "required">, import("convex/values").VNull<null, "required">], "required", never>;
    processor: import("convex/values").VUnion<"stripe" | "paypal", [import("convex/values").VLiteral<"stripe", "required">, import("convex/values").VLiteral<"paypal", "required">], "required", never>;
    paymentRef: import("convex/values").VUnion<string | null, [import("convex/values").VString<string, "required">, import("convex/values").VNull<null, "required">], "required", never>;
    detail: import("convex/values").VString<string, "required">;
    openedAt: import("convex/values").VFloat64<number, "required">;
    resolvedAt: import("convex/values").VUnion<number | null, [import("convex/values").VFloat64<number, "required">, import("convex/values").VNull<null, "required">], "required", never>;
    reportedAt: import("convex/values").VUnion<number | null, [import("convex/values").VFloat64<number, "required">, import("convex/values").VNull<null, "required">], "required", never>;
}, "required", "kind" | "id" | "checkoutId" | "paymentRef" | "processor" | "detail" | "key" | "openedAt" | "resolvedAt" | "reportedAt">;
/**
 * Reconcile's verdict on one payment: opens the kinds found (updating their detail), resolves the
 * compared kinds that are no longer found. Returns how many were opened and resolved.
 */
export declare const sync: import("convex/server").RegisteredMutation<"public", {
    checkoutId?: string | undefined;
    paymentRef?: string | undefined;
    only?: ("status_differs" | "amount_differs" | "missing_here" | "missing_there")[] | undefined;
    now: number;
    processor: "stripe" | "paypal";
    found: {
        kind: "status_differs" | "amount_differs" | "missing_here" | "missing_there";
        detail: string;
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
    open: boolean;
    paginationOpts: {
        id?: number;
        endCursor?: string | null;
        maximumRowsRead?: number;
        maximumBytesRead?: number;
        numItems: number;
        cursor: string | null;
    };
}, Promise<{
    page: {
        id: import("convex/values").GenericId<"issues">;
        kind: "dispute" | "status_differs" | "amount_differs" | "missing_here" | "missing_there" | "callback_failed" | "charge_unknown";
        key: string;
        checkoutId: import("convex/values").GenericId<"checkouts"> | null;
        processor: "stripe" | "paypal";
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
    kind: "dispute" | "status_differs" | "amount_differs" | "missing_here" | "missing_there" | "callback_failed" | "charge_unknown";
    key: string;
    checkoutId: import("convex/values").GenericId<"checkouts"> | null;
    processor: "stripe" | "paypal";
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