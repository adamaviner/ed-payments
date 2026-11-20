export declare const PAYPAL_VAULT_NAMESPACE = "paypalVault";
/** PayPal's JS SDK for saving: Card Fields and the PayPal button, no Venmo or Pay Later. */
export declare function paypalVaultSdkUrl(clientId: string): string;
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
    className?: string;
}
/** PayPal's card fields (name, number, expiry, CVV) and one button that saves the card, then calls onSaved. */
export declare function PaypalCardFields({ clientId, createSetupToken, onSaved, submitLabel, disabled, note, className }: PaypalCardFieldsProps): import("react").JSX.Element;
export interface PaypalSaveButtonProps {
    clientId: string;
    /** Calls the app's action that runs payments.setupPaypalMethod with kind 'paypal' and returns setupTokenId. */
    createSetupToken: () => Promise<string>;
    /** The buyer agreed on PayPal's page: save it (payments.savePaypalMethod) and carry on. A throw is shown. */
    onSaved: (setupTokenId: string) => Promise<void>;
    disabled?: boolean;
    className?: string;
}
/** PayPal's button: the buyer logs in to PayPal and agrees to be charged later; then onSaved. */
export declare function PaypalSaveButton({ clientId, createSetupToken, onSaved, disabled, className }: PaypalSaveButtonProps): import("react").JSX.Element;
//# sourceMappingURL=vault.d.ts.map