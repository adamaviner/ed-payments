export declare const byOwner: import("convex/server").RegisteredQuery<"public", {
    app: string;
    owner: {
        id: string;
        type: string;
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
        id: string;
        type: string;
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
        label: string;
        stripePaymentMethodId: string;
    }[];
}, Promise<{
    stripePaymentMethodId: string;
    kind: "card" | "ach";
    label: string;
    declined: boolean;
    declineReason: string | null;
    removed: boolean;
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
    removed: boolean;
} | null>>;
/** The owner removed a Stripe method: it is never offered or charged again. */
export declare const removeMethod: import("convex/server").RegisteredMutation<"public", {
    now: number;
    stripePaymentMethodId: string;
}, Promise<null>>;
/** The owner's PayPal customer id, or null before their first save. */
export declare const paypalCustomer: import("convex/server").RegisteredQuery<"public", {
    app: string;
    owner: {
        id: string;
        type: string;
    };
}, Promise<string | null>>;
/** The owner's saved PayPal methods, newest first, without removed ones. */
export declare const paypalMethods: import("convex/server").RegisteredQuery<"public", {
    app: string;
    owner: {
        id: string;
        type: string;
    };
}, Promise<{
    paymentTokenId: string;
    kind: "paypal" | "card";
    label: string;
    declined: boolean;
    declineReason: string | null;
    removed: boolean;
    createdAt: number;
    usagePattern: string | null;
    networkRef: {
        network?: string | undefined;
        date?: string | undefined;
        id: string;
    } | null;
}[]>>;
/** One saved PayPal method with whose it is, or null. */
export declare const paypalMethod: import("convex/server").RegisteredQuery<"public", {
    paymentTokenId: string;
}, Promise<{
    method: {
        paymentTokenId: string;
        kind: "paypal" | "card";
        label: string;
        declined: boolean;
        declineReason: string | null;
        removed: boolean;
        createdAt: number;
        usagePattern: string | null;
        networkRef: {
            network?: string | undefined;
            date?: string | undefined;
            id: string;
        } | null;
    };
    app: string;
    owner: {
        id: string;
        type: string;
    };
    paypalCustomerId: string;
} | null>>;
/** Records a method just saved in PayPal's vault (and the owner's PayPal customer, the first time). Saving the same one again keeps the first row. */
export declare const savePaypalMethod: import("convex/server").RegisteredMutation<"public", {
    usagePattern?: string | undefined;
    kind: "paypal" | "card";
    label: string;
    paymentTokenId: string;
    app: string;
    owner: {
        id: string;
        type: string;
    };
    now: number;
    paypalCustomerId: string;
}, Promise<{
    paymentTokenId: string;
    kind: "paypal" | "card";
    label: string;
    declined: boolean;
    declineReason: string | null;
    removed: boolean;
    createdAt: number;
    usagePattern: string | null;
    networkRef: {
        network?: string | undefined;
        date?: string | undefined;
        id: string;
    } | null;
}>>;
/** The owner removed a PayPal method (deleted from PayPal's vault first): marked, never offered again. */
export declare const removePaypalMethod: import("convex/server").RegisteredMutation<"public", {
    paymentTokenId: string;
    now: number;
}, Promise<null>>;
//# sourceMappingURL=customers.d.ts.map