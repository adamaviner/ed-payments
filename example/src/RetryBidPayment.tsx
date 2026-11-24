// The retry page: a bidder whose saved card was declined pays on the page. StripeRetryPayment shows
// the Payment Element for the amount at once and asks shop.retryBidPayment (payments.retryOnSession)
// for the PaymentIntent only when they press Pay; the outcome is recorded by the library's callbacks.
import { dollars } from '@earthdance/payments/core'
import { StripeRetryPayment } from '@earthdance/payments/react'
import { useAction } from 'convex/react'
import { useState } from 'react'
import { api } from '../convex/_generated/api.js'
import type { Id } from '../convex/_generated/dataModel.js'

const STRIPE_PUBLISHABLE_KEY = 'pk_test_example'

export function RetryBidPayment({ bidId, amountCents }: { bidId: Id<'bids'>; amountCents: number }) {
  const retry = useAction(api.shop.retryBidPayment)
  const [outcome, setOutcome] = useState<'succeeded' | 'processing' | null>(null)
  if (outcome) return <p>{outcome === 'succeeded' ? 'Paid, thank you.' : 'Your bank payment is on its way; it takes a few business days to clear.'}</p>
  return <StripeRetryPayment publishableKey={STRIPE_PUBLISHABLE_KEY} amountCents={amountCents} createPayment={() => retry({ bidId })} onPaid={setOutcome} submitLabel={`Pay ${dollars(amountCents)}`} />
}
