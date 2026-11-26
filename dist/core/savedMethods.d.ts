import type { SavedMethodKind } from './types.js';
/**
 * What a saved method may be: a card or a US bank account. Since 2026-09-30.endive PaymentIntents and
 * SetupIntents take `allowed_payment_method_types` (`payment_method_types` answers 400
 * payment_method_types_no_longer_supported); Stripe drops a listed type the account hasn't switched on.
 */
export declare const SAVED_METHOD_TYPES: readonly ["card", "us_bank_account"];
export type SavedMethodType = (typeof SAVED_METHOD_TYPES)[number];
/** Stripe's payment method type for a kind. */
export declare const stripeMethodType: (kind: SavedMethodKind) => SavedMethodType;
/**
 * Bank accounts are verified at once through Financial Connections only: micro-deposits take a day
 * or two, which would leave the payer unable to use the account when it matters.
 */
export declare const SAVED_METHOD_OPTIONS: {
    us_bank_account: {
        verification_method: 'instant';
        financial_connections: {
            permissions: 'payment_method'[];
        };
    };
};
//# sourceMappingURL=savedMethods.d.ts.map