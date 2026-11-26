// @earthdance/payments/react: the payment on the app's own page (PayPal's buttons and Card Fields,
// Stripe's embedded Checkout and Payment Element), saving a card, bank account or PayPal account to
// charge later, the buyer's return page hook and the Admin → Payments page.
//
// Styled with Tailwind classes on the shadcn theme tokens the apps already define (bg-muted,
// text-destructive, ...). Apps add `@source "../node_modules/@earthdance/payments/dist";` to their CSS
// so Tailwind generates them; it skips node_modules otherwise. Nothing here knows the app's login
// (`auth` is passed through to its authorize.admin query), router or bundler.
export { PaymentsAdminPage } from './PaymentsAdminPage.js';
export { checkoutReturnToken, useCheckoutReturn } from './useCheckoutReturn.js';
export { PaypalButtons, StripeEmbeddedCheckout } from './embedded.js';
export { PaypalCardFields, PaypalCardPayment, PaypalOnPagePayment, PaypalSaveButton, } from './vault.js';
export { StripeOnPagePayment, StripeRetryPayment, StripeSaveMethod, useStripeSetupReturn, onPagePaymentElementsOptions, retryPaymentElementsOptions, saveMethodElementsOptions, } from './stripe.js';
export { usePageTheme } from './theme.js';
export { parseRefundAmount, refundableCents } from './refundAmount.js';
export { errorMessage } from './errors.js';
//# sourceMappingURL=index.js.map