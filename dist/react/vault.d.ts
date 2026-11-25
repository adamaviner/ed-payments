import type { EmbeddedPayment } from '../client/index.js';
import type { CompleteReturnRef } from './types.js';
export declare const PAYPAL_VAULT_NAMESPACE = "paypalVault";
/** PayPal's JS SDK for saving: Card Fields and the PayPal button, no Venmo or Pay Later. */
export declare function paypalVaultSdkUrl(clientId: string): string;
/**
 * Styling inside PayPal's frames: a selector ('input', '.invalid', ':focus', …) to CSS properties, in
 * PayPal's Card Fields style format. The frames can't see the page's CSS or its theme, so colors are literal.
 */
export type PaypalFieldStyle = Record<string, Record<string, string>>;
export interface PaypalCardFieldsProps {
    /** The REST app's client id (payments.setupPaypalMethod returns it; public, and it says sandbox or live). */
    clientId: string;
    /** Calls the app's action that runs payments.setupPaypalMethod with kind 'card' and returns setupTokenId. */
    createSetupToken: () => Promise<string>;
    /**
     * The card was checked and PayPal approved the setup token: call the app's action that runs
     * payments.savePaypalMethod (and whatever the save was for, e.g. placing the bid). A throw is shown
     * under the fields, and the buyer can try again.
     */
    onSaved: (setupTokenId: string) => Promise<void>;
    /** The button's words, e.g. "Place bid". */
    submitLabel: string;
    disabled?: boolean;
    /** Said under the fields, e.g. "You're only charged if you win." */
    note?: string;
    /**
     * Colors and fonts inside PayPal's frames, merged over the defaults; pass the dark theme's colors when
     * the page is dark (e.g. `{ input: { color: '#fafafa', background: 'transparent' } }`). Changing it renders
     * the fields again, so what the buyer typed is cleared.
     */
    style?: PaypalFieldStyle;
    className?: string;
}
/** PayPal's card fields (name, number, expiry, CVV) and one button that saves the card, then calls onSaved. */
export declare function PaypalCardFields({ clientId, createSetupToken, onSaved, submitLabel, disabled, note, style, className }: PaypalCardFieldsProps): import("react").JSX.Element;
export interface PaypalSaveButtonProps {
    clientId: string;
    /** Calls the app's action that runs payments.setupPaypalMethod with kind 'paypal' and returns setupTokenId. A throw is shown. */
    createSetupToken: () => Promise<string>;
    /** The buyer agreed on PayPal's page: save it (payments.savePaypalMethod) and carry on. A throw is shown. */
    onSaved: (setupTokenId: string) => Promise<void>;
    disabled?: boolean;
    className?: string;
}
/** PayPal's button: the buyer logs in to PayPal and agrees to be charged later; then onSaved. */
export declare function PaypalSaveButton({ clientId, createSetupToken, onSaved, disabled, className }: PaypalSaveButtonProps): import("react").JSX.Element;
export declare const PAYPAL_CARD_PAY_NAMESPACE = "paypalCardPay";
/** PayPal's JS SDK for paying with Card Fields (an order captured at once), under its own namespace beside the buttons' and the vault's. */
export declare function paypalCardPaySdkUrl(clientId: string): string;
export interface PaypalCardPaymentProps {
    /** An embedded PayPal checkout with `only: 'card'` (payments.startScheduleCheckout with processor paypal, method card). */
    payment: Extract<EmbeddedPayment, {
        processor: 'paypal';
    }>;
    /** The app's `completeReturn` (from payments.publicApi()): captures the payment, which saves the card for the schedule. */
    completeReturn: CompleteReturnRef;
    /** The button's words, e.g. "Give $25 monthly". */
    submitLabel: string;
    /** Goes to the return page once paid, or once it is unknown whether it was. Default: a full page load. */
    navigate?: (url: string) => void;
    /** Said under the fields, e.g. "Charged on the 21st of every month until you cancel." */
    note?: string;
    disabled?: boolean;
    /** Colors and fonts inside PayPal's frames, merged over the defaults, as for PaypalCardFields. */
    style?: PaypalFieldStyle;
    className?: string;
}
/**
 * PayPal's card fields paying an order that also saves the card (vault with purchase), for a
 * schedule's first payment: the card stays in PayPal's frames, PayPal checks it (3-D Secure only when
 * the bank asks), the payment is captured, and the buyer goes to the return page. A declined card is
 * said under the fields, and the buyer can try another. Once the capture has started, anything but a
 * decline (paid, an error, no answer) goes to the return page, which asks the server how it stands:
 * a capture whose answer was lost may well have taken the money, and a payer told it failed would pay again.
 */
export declare function PaypalCardPayment({ payment, completeReturn, submitLabel, navigate, note, disabled, style, className }: PaypalCardPaymentProps): import("react").JSX.Element;
//# sourceMappingURL=vault.d.ts.map