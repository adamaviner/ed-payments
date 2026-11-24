// @earthdance/payments/react: the payment on the app's own page (PayPal's buttons, Stripe's embedded
// Checkout), saving a card or PayPal account in PayPal's vault (Card Fields, PayPal's button), the buyer's return page hook and the Admin → Payments page.
//
// Styled with Tailwind classes on the shadcn theme tokens the apps already define (bg-muted,
// text-destructive, ...). Apps add `@source "../node_modules/@earthdance/payments/dist";` to their CSS
// so Tailwind generates them; it skips node_modules otherwise. Nothing here knows the app's login
// (`auth` is passed through to its authorize.admin query), router or bundler.
export { PaymentsAdminPage, type PaymentsAdminPageProps, type RefundQuestion } from './PaymentsAdminPage.js'
export { checkoutReturnToken, useCheckoutReturn, type CheckoutReturn, type CheckoutReturnState } from './useCheckoutReturn.js'
export { PaypalButtons, StripeEmbeddedCheckout, type PaypalButtonsProps, type StripeEmbeddedCheckoutProps } from './embedded.js'
export {
  PaypalCardFields,
  PaypalCardPayment,
  PaypalSaveButton,
  paypalCardPaySdkUrl,
  paypalVaultSdkUrl,
  type PaypalCardFieldsProps,
  type PaypalCardPaymentProps,
  type PaypalFieldStyle,
  type PaypalSaveButtonProps,
} from './vault.js'
export {
  StripeRetryPayment,
  StripeSaveMethod,
  useStripeSetupReturn,
  retryPaymentElementsOptions,
  saveMethodElementsOptions,
  type RetryPaymentOutcome,
  type StripeAppearance,
  type StripeElementsOptions,
  type StripeRetryPaymentProps,
  type StripeSaveMethodProps,
  type StripeSetupReturn,
} from './stripe.js'
export { parseRefundAmount, refundableCents, type RefundAmount } from './refundAmount.js'
export { errorMessage } from './errors.js'
export type { CheckoutSummary, CompleteReturnRef, OpenRefund, PaymentIssue, PaymentRef, PaymentsAdminApi, PaymentsAuth, PaymentsPublicApi, PaypalHistoryLine, PaypalHistoryRef } from './types.js'
