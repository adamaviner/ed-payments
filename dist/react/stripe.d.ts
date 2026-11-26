import { SAVED_METHOD_OPTIONS, type SavedMethodType } from '../core/savedMethods.js';
import type { SavedMethodKind } from '../core/types.js';
import type { OnPagePayment } from '../client/index.js';
/**
 * Stripe's Appearance API (https://docs.stripe.com/elements/appearance-api): a theme ('stripe',
 * 'night', 'flat'), variables and rules. Stripe's frames can't see the page's CSS or its theme, so
 * colors are literal; pass the dark ones when the page is dark.
 */
export interface StripeAppearance {
    theme?: 'stripe' | 'night' | 'flat';
    variables?: Record<string, string>;
    rules?: Record<string, Record<string, string>>;
    labels?: 'above' | 'floating';
}
/** The Elements options for a deferred intent (https://docs.stripe.com/payments/accept-a-payment-deferred). */
export interface StripeElementsOptions {
    mode: 'setup' | 'payment';
    currency: 'usd';
    amount?: number;
    setupFutureUsage?: 'off_session';
    allowedPaymentMethodTypes: SavedMethodType[];
    paymentMethodOptions: Partial<typeof SAVED_METHOD_OPTIONS>;
    appearance?: StripeAppearance;
}
/**
 * For saving a method of these kinds (all of them when empty), the same as the SetupIntent
 * payments.setupPaymentMethod makes for them: usage off_session, bank accounts verified at once.
 */
export declare function saveMethodElementsOptions(methods: readonly SavedMethodKind[], appearance?: StripeAppearance): StripeElementsOptions;
/** For paying amountCents on the page, the same as the PaymentIntent payments.retryOnSession makes: a card or a bank account. */
export declare function retryPaymentElementsOptions(amountCents: number, appearance?: StripeAppearance): StripeElementsOptions;
/**
 * For a new payment of amountCents made at the press (payments.start or startScheduleCheckout with ui 'onPage'): the
 * same as the PaymentIntent the library makes for it, a card or a bank account, saved for later on a schedule's first payment.
 */
export declare function onPagePaymentElementsOptions(amountCents: number, o?: {
    saveForLater?: boolean;
    methods?: readonly SavedMethodKind[];
}, appearance?: StripeAppearance): StripeElementsOptions;
export interface StripeSaveMethodProps {
    /** The app's Stripe publishable key (pk_test_… / pk_live_…), the same account as its secret key. */
    publishableKey: string;
    /**
     * What the payer may save, as passed to payments.setupPaymentMethod: ['card', 'ach'] (the default),
     * or ['ach'] when cards go to PayPal. Must be what the SetupIntent is made for.
     */
    methods?: readonly SavedMethodKind[];
    /**
     * Calls the app's action that runs payments.setupPaymentMethod (with the same `methods`) and returns
     * its clientSecret. Called only when the payer presses the button and the fields are complete.
     */
    createSetupIntent: () => Promise<string>;
    /**
     * Stripe saved the method: call the app's action that uses it (e.g. placing the bid, which checks
     * the method with payments.verifyMethodOwner). A throw is shown under the form; pressing the button
     * again calls onSaved again with the same method, unless the payer changed the fields.
     */
    onSaved: (paymentMethodId: string) => Promise<void>;
    /** The button's words, e.g. "Place bid". */
    submitLabel: string;
    disabled?: boolean;
    /** Said under the form, e.g. "You're only charged if you win." */
    note?: string;
    /** Stripe's Appearance API; a new one restyles the form in place (e.g. the page switching to dark). */
    appearance?: StripeAppearance;
    /**
     * Where Stripe sends the payer back should a method need a redirect (default: this page), with
     * ?setup_intent_client_secret= added. That page shows the outcome with useStripeSetupReturn.
     */
    returnUrl?: string;
    className?: string;
}
/** Stripe's Payment Element (card or bank account) and one button that saves the method, then calls onSaved. */
export declare function StripeSaveMethod({ publishableKey, methods, createSetupIntent, onSaved, submitLabel, disabled, note, appearance, returnUrl, className }: StripeSaveMethodProps): import("react").JSX.Element;
/** How a payment ended: paid, or a bank payment on its way (it takes a few business days to clear). */
export type RetryPaymentOutcome = 'succeeded' | 'processing';
export interface StripeRetryPaymentProps {
    /** The app's Stripe publishable key, the same account as its secret key. */
    publishableKey: string;
    /** What the payment is for: the declined charge's amount, which payments.retryOnSession charges. */
    amountCents: number;
    /**
     * Calls the app's action that runs payments.retryOnSession and returns its clientSecret (the same
     * PaymentIntent again while it waits). Called only when the buyer presses the button and the fields are complete.
     */
    createPayment: () => Promise<string>;
    /** Stripe took the payment ('succeeded') or a bank payment is on its way ('processing'); the library's callbacks record it. */
    onPaid: (outcome: RetryPaymentOutcome) => void;
    /** The button's words, e.g. "Pay $120.00". */
    submitLabel: string;
    disabled?: boolean;
    note?: string;
    /** Stripe's Appearance API; a new one restyles the form in place. */
    appearance?: StripeAppearance;
    /**
     * Where Stripe sends the buyer back should a method need a redirect (default: this page), with
     * ?payment_intent= added. That page shows the outcome with checkoutReturnToken and useCheckoutReturn,
     * not this form, which doesn't read the address.
     */
    returnUrl?: string;
    className?: string;
}
/** Stripe's Payment Element and one button that pays a declined charge on the page (payments.retryOnSession). */
export declare function StripeRetryPayment({ publishableKey, amountCents, createPayment, onPaid, submitLabel, disabled, note, appearance, returnUrl, className }: StripeRetryPaymentProps): import("react").JSX.Element;
/** Who is paying, as the app's own form already asked. */
export interface Payer {
    name: string;
    email: string;
}
export interface StripeOnPagePaymentProps {
    /** The app's Stripe publishable key, the same account as its secret key. */
    publishableKey: string;
    /** What the payment will be, as the app's server will price it; a new amount is shown in place, keeping what the payer typed. */
    amountCents: number;
    /**
     * What the payer may pay with, as start passes it (['card'] or ['ach'] when the app's own tabs choose; both by
     * default). Must be what the PaymentIntent is made for.
     */
    methods?: readonly SavedMethodKind[];
    /**
     * A schedule's first payment (payments.startScheduleCheckout): the method is saved for the next ones, and Stripe says
     * so under the fields. Must match what start makes; changing it updates the form in place, keeping what the payer typed.
     */
    saveForLater?: boolean;
    /**
     * The payer's name and email from the app's own form: Stripe's fields don't ask for them again, and they go on the
     * payment method when it is confirmed. Without it Stripe asks for what a method needs (a bank account's name and email).
     */
    payer?: Payer;
    /**
     * Calls the app's action that prices the payment and runs payments.start (or startScheduleCheckout) with ui 'onPage',
     * returning its onPage. Called only when the payer presses the button and Stripe finds the fields complete; after a
     * decline the next press calls it again, and the app passes the checkoutId its last call returned as `replaces`.
     */
    start: () => Promise<OnPagePayment>;
    /** The button's words, e.g. "Give $25". */
    submitLabel: string;
    /**
     * Goes to the return page (onPage.returnUrl with ?payment_intent= added, as Stripe adds it after a redirect) once Stripe
     * took the payment or a bank payment is on its way. Default: a full page load. The page shows the outcome with
     * checkoutReturnToken and useCheckoutReturn.
     */
    navigate?: (url: string) => void;
    disabled?: boolean;
    note?: string;
    /** Stripe's Appearance API (usePageTheme's stripe); a new one restyles the form in place. */
    appearance?: StripeAppearance;
    className?: string;
}
/** Said when the app's start made the payment for the other processor's fields (the app's choice changed under the form). */
export declare const WRONG_PROCESSOR = "This payment can\u2019t be paid here. Reload the page and try again.";
/**
 * Stripe's Payment Element for a new payment on the app's own page, with one button. Nothing is made at Stripe until
 * the press: then the fields are checked, the app's start makes the PaymentIntent, and Stripe confirms it here (a
 * card's security check on the page). A decline is said under the fields, and the next press starts again.
 */
export declare function StripeOnPagePayment({ publishableKey, amountCents, methods, saveForLater, payer, start, submitLabel, navigate, disabled, note, appearance, className }: StripeOnPagePaymentProps): import("react").JSX.Element;
/**
 * How a save that needed a redirect ended. none: the address isn't a return from one. saved: Stripe
 * saved the method (savedMethods lists it from now on). processing: Stripe is still confirming it (some
 * bank accounts). failed: it wasn't saved. unknown: Stripe couldn't say, so the method may be saved:
 * don't invite the payer to save another before checking.
 */
export type StripeSetupReturn = {
    state: 'none';
} | {
    state: 'checking';
} | {
    state: 'saved';
    paymentMethodId: string;
} | {
    state: 'processing';
} | {
    state: 'failed';
} | {
    state: 'unknown';
};
/**
 * For the page Stripe sends a payer back to when saving a method with StripeSaveMethod needed a
 * redirect (rare: cards and instantly verified bank accounts finish on the page). Asks Stripe how the
 * SetupIntent in the address ended. Whatever the app's onSaved was going to do with the method (place a
 * bid, say) didn't happen, since the page that would have done it is gone: say so, and let the payer
 * finish with the saved method, which the app's own savedMethods call now offers.
 *
 * Pass `search` from the app's router (e.g. Next's useSearchParams().toString()); it is followed as it
 * changes. Without it the address is read from window.location (none on the server, so a server
 * render and the first client render agree), again on back and forward.
 */
export declare function useStripeSetupReturn(publishableKey: string, search?: string): StripeSetupReturn;
//# sourceMappingURL=stripe.d.ts.map