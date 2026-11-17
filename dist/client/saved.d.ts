import type { Scheduler } from 'convex/server';
import { type StripePaymentIntent } from '../core/stripe.js';
import { type Payer, type Ref } from '../core/types.js';
import type { Checkout, Payments, RunActionCtx } from './index.js';
export interface SavedMethod {
    paymentMethodId: string;
    kind: 'card' | 'ach';
    /** e.g. "Visa •••• 4242", "Chase bank account •••• 6789". */
    label: string;
    /** An off-session charge of it was declined; don't offer it again. */
    declined: boolean;
}
/** Tries of an off-session charge whose outcome is unknown before a person is asked; a minute more between each. */
export declare const MAX_CHARGE_ATTEMPTS = 5;
export declare function setupPaymentMethod(p: Payments, ctx: RunActionCtx, a: {
    owner: Ref;
    payer: Payer;
    stripeCustomerId?: string;
}): Promise<{
    clientSecret: string;
    stripeCustomerId: string;
}>;
export declare function savedMethods(p: Payments, ctx: RunActionCtx, a: {
    owner: Ref;
    stripeCustomerId?: string;
}): Promise<SavedMethod[]>;
export declare function verifyMethodOwner(p: Payments, ctx: RunActionCtx, a: {
    owner: Ref;
    paymentMethodId: string;
    stripeCustomerId?: string;
}): Promise<{
    stripeCustomerId: string;
    paymentMethodId: string;
    kind: "card" | "ach";
    /** e.g. "Visa •••• 4242", "Chase bank account •••• 6789". */
    label: string;
    /** An off-session charge of it was declined; don't offer it again. */
    declined: boolean;
}>;
/**
 * Records what a PaymentIntent says, when it says something final enough: paid (the amount is checked
 * against the checkout by the component), or processing. Returns false when it is still open,
 * waiting for the buyer, canceled or odd, for the caller to decide.
 */
export declare function settleIntent(p: Payments, ctx: RunActionCtx, c: Checkout, given: StripePaymentIntent): Promise<boolean>;
/**
 * This checkout's PaymentIntent, found among the customer's own since it started (after a try whose
 * answer never came back). Null only when Stripe has certainly none; when the list is too long to
 * be sure, it throws, so nobody charges again on a guess.
 */
export declare function findIntent(p: Payments, c: Checkout): Promise<StripePaymentIntent | null>;
/**
 * Charges an off-session checkout. A decline fails it (onFailed, the method marked declined). A
 * transient error (no answer, 429, 5xx) is tried again a minute later, then two... up to
 * MAX_CHARGE_ATTEMPTS, after which (or at once, for anything else odd) a charge_unknown issue asks a
 * person. Before trying again, the customer's PaymentIntents are searched for this checkout, since an
 * unanswered try may have charged: Stripe replays a key's first answer (even a 500), so a later try
 * uses a new key only after that search found nothing.
 */
export declare function chargeNow(p: Payments, ctx: RunActionCtx & {
    scheduler: Scheduler;
}, checkoutId: string, manual: boolean): Promise<void>;
/** What the sweep does with an off- or on-session checkout. Returns whether it looked at it. */
export declare function sweepIntent(p: Payments, ctx: RunActionCtx & {
    scheduler: Scheduler;
}, c: Checkout, expired: boolean, now: number): Promise<boolean>;
/** The return page for an on-session payment (Stripe adds ?payment_intent= after a redirect, e.g. a bank login or 3-D Secure). */
export declare function completeIntentReturn(p: Payments, ctx: RunActionCtx, c: Checkout): Promise<void>;
export declare function retryOnSession(p: Payments, ctx: RunActionCtx, a: {
    checkoutId: string;
    expiresAt?: number;
}): Promise<{
    checkoutId: string;
    clientSecret: string;
}>;
/**
 * A payment_intent.* webhook for an off- or on-session checkout. succeeded and processing settle (from
 * a fresh read of the PaymentIntent). payment_failed: an accepted bank payment that bounced, or an
 * off-session charge declined, fails the checkout; on the app's page the buyer may simply try again,
 * so there it is only noted.
 */
export declare function onIntentEvent(p: Payments, ctx: RunActionCtx, type: string, pi: StripePaymentIntent): Promise<'handled' | 'ignored' | 'foreign'>;
//# sourceMappingURL=saved.d.ts.map