// How bad a refused charge is, for deciding whether trying again later can work. Stripe's lists are
// from https://docs.stripe.com/declines/codes and the Smart Retries page (looked up 2026-11-21); a
// bank debit that bounces carries its reason in `code` (account_closed, insufficient_funds...) with
// decline_code generic_decline (seen in test mode). PayPal's 422 issues are from the Orders v2 error
// reference. Anything not listed is soft: worth another try in a few days.
import type { Processor } from './types.js'

/**
 * hard: trying the same method again won't work (lost, stolen, expired, closed, revoked); the payer
 * has to give another. insufficient_funds: may work once money arrives. soft: anything else.
 */
export type DeclineKind = 'hard' | 'soft' | 'insufficient_funds'

const STRIPE_HARD: ReadonlySet<string> = new Set([
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
])

const PAYPAL_HARD: ReadonlySet<string> = new Set([
  'CARD_EXPIRED',
  'PAYER_ACCOUNT_LOCKED_OR_CLOSED',
  'PAYER_ACCOUNT_RESTRICTED',
  'INVALID_PAYMENT_SOURCE',
  'PAYER_ACTION_REQUIRED',
  'METHOD_REMOVED',
  'METHOD_NOT_SAVED',
])

/** What a processor said about a refused charge: Stripe's code, decline_code and advice_code, or PayPal's issue. */
export interface DeclineInfo {
  processor: Processor
  code?: string | null
  declineCode?: string | null
  adviceCode?: string | null
}

export function declineKind(d: DeclineInfo): DeclineKind {
  if (d.processor === 'paypal') return d.code && PAYPAL_HARD.has(d.code) ? 'hard' : 'soft'
  if (d.adviceCode === 'do_not_try_again' || d.adviceCode === 'confirm_card_data') return 'hard'
  const codes = [d.declineCode, d.code].filter((x): x is string => !!x)
  if (codes.some((c) => STRIPE_HARD.has(c))) return 'hard'
  if (codes.includes('insufficient_funds')) return 'insufficient_funds'
  return 'soft'
}

/** The most telling code of a refusal, for the record: Stripe's decline_code unless it is the generic one, else its code; PayPal's issue. */
export function declineCodeOf(d: DeclineInfo): string | undefined {
  if (d.declineCode && d.declineCode !== 'generic_decline') return d.declineCode
  return d.code ?? d.declineCode ?? undefined
}

/** The code the library records when a schedule's saved method is gone (removed by the payer or at the processor). */
export const METHOD_REMOVED = 'METHOD_REMOVED'

/**
 * The code the library records when the method to charge isn't saved: a schedule's first payment was
 * taken but PayPal never finished saving the method it paid with (vault APPROVED, no token within
 * three days), or chargeSaved was given a method that isn't saved for the payer (another owner's, or
 * an owner with no saved method here). Nothing was charged and nothing was refused: the app asks for
 * a payment method, not about a failed payment.
 */
export const METHOD_NOT_SAVED = 'METHOD_NOT_SAVED'
