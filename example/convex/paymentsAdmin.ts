// The admin page's functions (refunds, issues, charges with an unknown outcome), each behind the app's
// isAdmin; the React page from @earthdance/payments/react calls them as api.paymentsAdmin.
import { payments } from './payments.js'

export const {
  openRefunds,
  refundable,
  issues,
  openCount,
  checkout,
  requestRefund,
  approveRefund,
  sendRefund,
  markRefundedManually,
  dismissRefund,
  resolveIssue,
  retryCharge,
  giveUpCharge,
  paypalHistory,
} = payments.adminApi({ skipApproval: true })
