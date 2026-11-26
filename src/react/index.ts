// @earthdance/payments/react: the payment on the app's own page (PayPal's buttons and Card Fields,
// Stripe's embedded Checkout and Payment Element), saving a card, bank account or PayPal account to
// charge later, the buyer's return page hook and the Admin → Payments page.
//
// Styled with Tailwind classes on the shadcn theme tokens the apps already define (bg-muted,
// text-destructive, ...). Apps add `@source "../node_modules/@earthdance/payments/dist";` to their CSS
// so Tailwind generates them; it skips node_modules otherwise. Nothing here knows the app's login
// (`auth` is passed through to its authorize.admin query), router or bundler.
export { PaymentsAdminPage, type PaymentsAdminPageProps, type RefundQuestion } from './PaymentsAdminPage.js'
export { checkoutReturnToken, useCheckoutReturn, type CheckoutReturn, type CheckoutReturnState } from './useCheckoutReturn.js'
export { PaypalButtons, StripeEmbeddedCheckout, type Load, type PaypalButtonsProps, type StripeEmbeddedCheckoutProps } from './embedded.js'
export {
  OnPagePayment,
  PAYPAL_DECLINED_NOTE,
  type NewOnPagePaymentProps,
  type OnPagePaymentClassNames,
  type OnPagePaymentProps,
  type OnPagePaymentTab,
  type OnPageStartArgs,
  type RetryOnPagePaymentProps,
  type RetryStarted,
} from './onPagePayment.js'
export {
  PaypalCardFields,
  PaypalCardPayment,
  PaypalOnPagePayment,
  PaypalSaveButton,
  type PaypalCardFieldsProps,
  type PaypalCardPaymentProps,
  type PaypalOnPagePaymentProps,
  type PaypalFieldStyle,
  type PaypalSaveButtonProps,
} from './vault.js'
export {
  StripeOnPagePayment,
  StripeRetryPayment,
  StripeSaveMethod,
  useStripeSetupReturn,
  onPagePaymentElementsOptions,
  retryPaymentElementsOptions,
  saveMethodElementsOptions,
  type Payer,
  type RetryPaymentOutcome,
  type StripeAppearance,
  type StripeElementsOptions,
  type StripeOnPagePaymentProps,
  type StripeRetryPaymentProps,
  type StripeSaveMethodProps,
  type StripeSetupReturn,
} from './stripe.js'
export { usePageTheme, type PageColors, type PageTheme } from './theme.js'
export { parseRefundAmount, refundableCents, type RefundAmount } from './refundAmount.js'
export { errorMessage } from './errors.js'
export type { CheckoutSummary, CompleteReturnRef, OpenRefund, PaymentIssue, PaymentRef, PaymentsAdminApi, PaymentsAuth, PaymentsPublicApi, PaypalHistoryLine, PaypalHistoryRef } from './types.js'
