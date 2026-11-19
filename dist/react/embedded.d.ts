import type { EmbeddedPayment } from '../client/index.js';
import type { CompleteReturnRef } from './types.js';
type PaypalPayment = Extract<EmbeddedPayment, {
    processor: 'paypal';
}>;
type StripePayment = Extract<EmbeddedPayment, {
    processor: 'stripe';
}>;
/** Stripe.js for the API version the library calls (2026-10-28.endive); Stripe versions its script by name. */
export declare const STRIPE_JS = "https://js.stripe.com/endive/stripe.js";
/**
 * How long a script or Stripe's embedded Checkout may take before it is given up as failed, so one
 * that never answers can't hold up the next (a reload isn't needed to try again).
 */
export declare const GIVE_UP_MS = 30000;
/** PayPal's JS SDK for one REST app: buttons only, card and PayPal, no Venmo or Pay Later. */
export declare function paypalSdkUrl(clientId: string): string;
/** @internal For tests: forget every script loaded so far, and the embedded Checkout. */
export declare function forgetScripts(): void;
/**
 * Loads a script once per address (every mount shares it); resolves once it has run. A failed load,
 * or one with no answer after GIVE_UP_MS, is forgotten, so a later mount tries again.
 */
export declare function loadScript(src: string): Promise<void>;
export interface PaypalButtonsProps {
    payment: PaypalPayment;
    /** The app's `completeReturn` (from payments.publicApi()): captures the payment when the buyer approves. */
    completeReturn: CompleteReturnRef;
    /** Starts the same payment as a redirect and sends the buyer there; offered if PayPal's script doesn't load. */
    onFallback?: () => void;
    /** Goes to the return page once paid. Default: a full page load (the app's return page asks again). */
    navigate?: (url: string) => void;
    className?: string;
}
/**
 * PayPal's buttons for an embedded PayPal checkout: the PayPal button and "Debit or Credit Card"
 * (which opens PayPal's card form in the page). On approval the payment is captured at once; if
 * PayPal declines the card, the buyer is told and the buttons let them choose again. Then the buyer
 * goes to the return page with PayPal's token, which shows the outcome as after a redirect.
 */
export declare function PaypalButtons({ payment, completeReturn, onFallback, navigate, className }: PaypalButtonsProps): import("react").JSX.Element;
export interface StripeEmbeddedCheckoutProps {
    payment: StripePayment;
    /** The app's Stripe publishable key (pk_test_… / pk_live_…), the same account as its secret key. */
    publishableKey: string;
    /** Starts the same payment as a redirect and sends the buyer there; offered if Stripe.js doesn't load. */
    onFallback?: () => void;
    className?: string;
}
/**
 * Stripe's embedded Checkout for an embedded Stripe checkout (a card or a bank account, whichever the
 * checkout was started for). Stripe sends the buyer to the return page when they have paid.
 */
export declare function StripeEmbeddedCheckout({ payment, publishableKey, onFallback, className }: StripeEmbeddedCheckoutProps): import("react").JSX.Element;
export {};
//# sourceMappingURL=embedded.d.ts.map