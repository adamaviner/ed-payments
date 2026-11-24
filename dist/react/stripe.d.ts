import { SAVED_METHOD_OPTIONS, type SavedMethodType } from '../core/savedMethods.js';
import type { SavedMethodKind } from '../core/types.js';
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
    /** Where Stripe sends the payer back should a method need a redirect. Default: this page. */
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
     * Where Stripe sends the buyer back should a method need a redirect. Default: this page, where the
     * component (mounted again) reads Stripe's payment_intent_client_secret and reports the outcome.
     */
    returnUrl?: string;
    className?: string;
}
/** Stripe's Payment Element and one button that pays a declined charge on the page (payments.retryOnSession). */
export declare function StripeRetryPayment({ publishableKey, amountCents, createPayment, onPaid, submitLabel, disabled, note, appearance, returnUrl, className }: StripeRetryPaymentProps): import("react").JSX.Element;
//# sourceMappingURL=stripe.d.ts.map