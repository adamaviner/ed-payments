// @earthdance/payments/react: the buyer's return page hook and the Admin → Payments page.
//
// Styled with Tailwind classes on the shadcn theme tokens the apps already define (bg-muted,
// text-destructive, ...). Apps add `@source "../node_modules/@earthdance/payments/dist";` to their CSS
// so Tailwind generates them; it skips node_modules otherwise. Nothing here knows the app's login
// (`auth` is passed through to its authorize.admin query), router or bundler.
export { PaymentsAdminPage, type PaymentsAdminPageProps, type RefundQuestion } from './PaymentsAdminPage.js'
export { useCheckoutReturn, type CheckoutReturn, type CheckoutReturnState } from './useCheckoutReturn.js'
export { parseRefundAmount, refundableCents, type RefundAmount } from './refundAmount.js'
export { errorMessage } from './errors.js'
export type { CheckoutSummary, CompleteReturnRef, OpenRefund, PaymentIssue, PaymentRef, PaymentsAdminApi, PaymentsAuth, PaymentsPublicApi } from './types.js'
