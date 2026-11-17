export declare const byOwner: import("convex/server").RegisteredQuery<"public", {
    app: string;
    owner: {
        type: string;
        id: string;
    };
}, Promise<{
    id: import("convex/values").GenericId<"customers">;
    stripeCustomerId: string;
    email: string;
} | null>>;
/** Records the payer's Stripe Customer; a second call for the same payer keeps the first. Returns the one kept. */
export declare const save: import("convex/server").RegisteredMutation<"public", {
    app: string;
    email: string;
    owner: {
        type: string;
        id: string;
    };
    now: number;
    stripeCustomerId: string;
}, Promise<{
    id: import("convex/values").GenericId<"customers">;
    stripeCustomerId: string;
    email: string;
}>>;
/** Records the methods Stripe listed for a customer (new ones added, labels kept current) and returns them with their declined flags, in the order given. */
export declare const saveMethods: import("convex/server").RegisteredMutation<"public", {
    now: number;
    stripeCustomerId: string;
    methods: {
        kind: "card" | "ach";
        stripePaymentMethodId: string;
        label: string;
    }[];
}, Promise<{
    stripePaymentMethodId: string;
    kind: "card" | "ach";
    label: string;
    declined: boolean;
    declineReason: string | null;
}[]>>;
/** One saved method as the library knows it, or null. */
export declare const method: import("convex/server").RegisteredQuery<"public", {
    stripePaymentMethodId: string;
}, Promise<{
    stripePaymentMethodId: string;
    kind: "card" | "ach";
    label: string;
    declined: boolean;
    declineReason: string | null;
} | null>>;
//# sourceMappingURL=customers.d.ts.map