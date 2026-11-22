import type { Scheduler } from 'convex/server';
import { type StripePaymentIntent } from '../core/stripe.js';
import { type Payer, type Processor, type Ref } from '../core/types.js';
import { type DeclineInfo } from '../core/declines.js';
import { type Checkout, type Payments, type RunActionCtx } from './index.js';
export interface SavedMethod {
    /** Stripe's `pm_…`, or `paypal:<payment token id>` for a method in PayPal's vault. */
    paymentMethodId: string;
    processor: Processor;
    /** card or ach (Stripe), card or paypal (an account in PayPal's vault). */
    kind: 'card' | 'ach' | 'paypal';
    /** e.g. "Visa •••• 4242", "Chase bank account •••• 6789", "PayPal (jo@example.com)". */
    label: string;
    /** An off-session charge of it was declined; don't offer it again. */
    declined: boolean;
    /** When it was saved (ms). */
    createdAt: number;
}
/** Tries of an off-session charge whose outcome is unknown before a person is asked; a minute more between each. */
export declare const MAX_CHARGE_ATTEMPTS = 5;
/** The owner's Stripe Customer, made (or adopted, when the app already had one) the first time. */
export declare function ensureCustomer(p: Payments, ctx: RunActionCtx, owner: Ref, payer: Payer | null, adopt: string | undefined): Promise<{
    email: string;
    id: string;
    stripeCustomerId: string;
} | null>;
export declare function setupPaymentMethod(p: Payments, ctx: RunActionCtx, a: {
    owner: Ref;
    payer: Payer;
    stripeCustomerId?: string;
    methods?: readonly ('card' | 'ach')[];
}): Promise<{
    clientSecret: string;
    stripeCustomerId: string;
}>;
/** Both processors' saved methods of the owner, newest first, leaving out removed ones. A processor the app hasn't set up is skipped. */
export declare function savedMethods(p: Payments, ctx: RunActionCtx, a: {
    owner: Ref;
    stripeCustomerId?: string;
}): Promise<SavedMethod[]>;
export type VerifiedMethod = SavedMethod & {
    /** The processor's customer the method is saved to. */
    customerId: string;
    /** Stripe methods only: the same as customerId. */
    stripeCustomerId?: string;
};
export declare function verifyMethodOwner(p: Payments, ctx: RunActionCtx, a: {
    owner: Ref;
    paymentMethodId: string;
    stripeCustomerId?: string;
}): Promise<VerifiedMethod>;
/**
 * The owner removes a saved method: deleted from PayPal's vault, or detached from the Stripe Customer
 * (a key without write access to PaymentMethods can't; the method is then only hidden, and logged).
 * Either way the library never offers or charges it again. Whether it may go (a bid still relying on
 * it, say) is the app's to decide first.
 */
export declare function removeSavedMethod(p: Payments, ctx: RunActionCtx, a: {
    owner: Ref;
    paymentMethodId: string;
    stripeCustomerId?: string;
}): Promise<void>;
/**
 * Records what a PaymentIntent says, when it says something final enough: paid (the amount is checked
 * against the checkout by the component), or processing. Returns false when it is still open,
 * waiting for the buyer, canceled or odd, for the caller to decide.
 */
export declare function settleIntent(p: Payments, ctx: RunActionCtx, c: Checkout, given: StripePaymentIntent): Promise<boolean>;
/** The code and kind of a refusal, for the checkout and a schedule's retries. */
export declare const declineOf: (d: DeclineInfo) => {
    declineCode: string | undefined;
    declineKind: import("../core/declines.js").DeclineKind;
};
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
/** The same as retryOnSession, paid with PayPal's buttons (a PayPal account or a card) on the app's page. */
export declare function retryWithPaypal(p: Payments, ctx: RunActionCtx, a: {
    checkoutId: string;
    returnPath: string;
    expiresAt?: number;
}): Promise<{
    checkoutId: string;
    embedded: {
        processor: 'paypal';
        orderId: string;
        clientId: string;
        returnUrl: string;
    };
}>;
/**
 * A payment_intent.* webhook for an off- or on-session checkout. succeeded and processing settle (from
 * a fresh read of the PaymentIntent). payment_failed: an accepted bank payment that bounced, or an
 * off-session charge declined, fails the checkout; on the app's page the buyer may simply try again,
 * so there it is only noted.
 */
export declare function onIntentEvent(p: Payments, ctx: RunActionCtx, type: string, pi: StripePaymentIntent): Promise<'handled' | 'ignored' | 'foreign'>;
//# sourceMappingURL=saved.d.ts.map