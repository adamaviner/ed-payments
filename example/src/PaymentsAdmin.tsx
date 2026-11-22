// How an app shows Admin → Payments (typechecked against the example's generated api, so a change to
// the admin api that breaks apps breaks here first). This app signs in with Convex auth, so it passes
// no `auth`; ed-schedule would pass `auth={{ token }}`. skipApproval matches paymentsAdmin.ts.
import { type CheckoutSummary, type PaymentRef, PaymentsAdminPage, type RefundQuestion } from '@earthdance/payments/react'
import { useQuery } from 'convex/react'
import { api } from '../convex/_generated/api.js'

/** What a payment was for, linked; the page shows the payment's description when this gives null. */
const itemLink = (ref: PaymentRef) => (ref.type === 'item' ? <a href={`/items/${ref.id}`}>The item</a> : null)

/**
 * Asked before a refund of everything left on an item's payment; the answer is kept on the refund as
 * hostData.restock and reaches the app's on.refunded, to act on.
 */
const restockQuestion = (checkout: CheckoutSummary, amountCents: number, leftCents: number): RefundQuestion | null =>
  checkout.ref.type === 'item' && amountCents === leftCents
    ? {
        key: 'restock',
        label: `Put “${checkout.description}” back on sale?`,
        options: [
          { value: 'yes', label: 'Yes, put it back on sale' },
          { value: 'no', label: 'No' },
        ],
      }
    : null

/**
 * When the app's authorize.stepUp asks for a second step before a refund is approved or sent: the app
 * runs its check (a passkey, say), then the page tries once more. This example has none.
 */
const confirmAgain = (action: 'approve' | 'send') => Promise.resolve(window.confirm(`Confirm you want to ${action} this refund.`))

export function PaymentsAdmin() {
  return <PaymentsAdminPage api={api.paymentsAdmin} skipApproval refLink={itemLink} refundQuestion={restockQuestion} onStepUp={confirmAgain} />
}

/** The sidebar's badge: refunds to do plus open issues. */
export function PaymentsBadge() {
  const count = useQuery(api.paymentsAdmin.openCount, {})
  return count ? <span className="rounded-full bg-destructive/10 px-1.5 text-xs text-destructive">{count}</span> : null
}
