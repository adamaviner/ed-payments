// What a saved method may be. One source for the server (SetupIntents, on-session PaymentIntents)
// and the browser (the Payment Element in deferred-intent mode, see src/react/stripe.tsx): Stripe
// refuses to confirm an intent whose method types or options differ from the form's.
/**
 * What a saved method may be: a card or a US bank account. Since 2026-09-30.endive PaymentIntents and
 * SetupIntents take `allowed_payment_method_types` (`payment_method_types` answers 400
 * payment_method_types_no_longer_supported); Stripe drops a listed type the account hasn't switched on.
 */
export const SAVED_METHOD_TYPES = ['card', 'us_bank_account'];
/** Stripe's payment method type for a kind. */
export const stripeMethodType = (kind) => (kind === 'ach' ? 'us_bank_account' : 'card');
/**
 * Bank accounts are verified at once through Financial Connections only: micro-deposits take a day
 * or two, which would leave the payer unable to use the account when it matters.
 */
export const SAVED_METHOD_OPTIONS = {
    us_bank_account: { verification_method: 'instant', financial_connections: { permissions: ['payment_method'] } },
};
//# sourceMappingURL=savedMethods.js.map