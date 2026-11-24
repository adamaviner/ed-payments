const STRIPE_HARD = new Set([
    'authentication_required',
    'card_not_supported',
    'currency_not_supported',
    'do_not_try_again',
    'expired_card',
    'fraudulent',
    'highest_risk_level',
    'incorrect_number',
    'invalid_account',
    'invalid_number',
    'lost_card',
    'merchant_blacklist',
    'new_account_information_available',
    'pickup_card',
    'restricted_card',
    'revocation_of_all_authorizations',
    'revocation_of_authorization',
    'security_violation',
    'stolen_card',
    'stop_payment_order',
    'transaction_not_allowed',
    // Bank debits (us_bank_account) that bounced for good.
    'account_closed',
    'account_frozen',
    'bank_account_restricted',
    'bank_account_unusable',
    'debit_not_authorized',
    'invalid_account_number',
    'no_account',
]);
const PAYPAL_HARD = new Set(['CARD_EXPIRED', 'PAYER_ACCOUNT_LOCKED_OR_CLOSED', 'PAYER_ACCOUNT_RESTRICTED', 'INVALID_PAYMENT_SOURCE', 'PAYER_ACTION_REQUIRED', 'METHOD_REMOVED']);
export function declineKind(d) {
    if (d.processor === 'paypal')
        return d.code && PAYPAL_HARD.has(d.code) ? 'hard' : 'soft';
    if (d.adviceCode === 'do_not_try_again' || d.adviceCode === 'confirm_card_data')
        return 'hard';
    const codes = [d.declineCode, d.code].filter((x) => !!x);
    if (codes.some((c) => STRIPE_HARD.has(c)))
        return 'hard';
    if (codes.includes('insufficient_funds'))
        return 'insufficient_funds';
    return 'soft';
}
/** The most telling code of a refusal, for the record: Stripe's decline_code unless it is the generic one, else its code; PayPal's issue. */
export function declineCodeOf(d) {
    if (d.declineCode && d.declineCode !== 'generic_decline')
        return d.declineCode;
    return d.code ?? d.declineCode ?? undefined;
}
/** The code the library records when a schedule's saved method is gone (removed by the payer, or never saved). */
export const METHOD_REMOVED = 'METHOD_REMOVED';
//# sourceMappingURL=declines.js.map