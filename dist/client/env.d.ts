import { type PaypalKeys } from '../core/paypal.js';
import type { StripeKeys } from '../core/stripe.js';
type Env = Record<string, string | undefined>;
/** A reader of one processor's keys, null when the processor isn't set up here. `check` throws when it is set up wrongly. */
export interface KeySource<K> {
    (): K | null;
    check(): void;
}
export declare const isLive: (e?: Env) => boolean;
/** A set-up problem. wrongMode: live keys outside live mode or the other way round, refused at every call, not only at start-up. */
export interface Problem {
    text: string;
    wrongMode: boolean;
}
/** Problems with this deployment's Stripe set-up (none: fine, or not set up and not required). */
export declare function stripeProblems(e?: Env): Problem[];
export declare function paypalProblems(e?: Env): Problem[];
export declare const fromEnv: {
    /** STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET; STRIPE_REQUIRED=true makes a missing key an error in live mode. */
    stripe: () => KeySource<StripeKeys>;
    /** PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_WEBHOOK_ID, PAYPAL_API_BASE (unset: live in live mode, else the sandbox); PAYPAL_REQUIRED=true as for Stripe. */
    paypal: () => KeySource<PaypalKeys>;
    /** SITE_URL, else the fallback. */
    siteUrl: (fallback?: string) => () => string;
};
export {};
//# sourceMappingURL=env.d.ts.map