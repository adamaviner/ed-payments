// The retry page: a bidder whose saved card was declined pays on the page. StripeRetryPayment shows
// the Payment Element for the amount at once and asks shop.retryBidPayment (payments.retryOnSession)
// for the PaymentIntent only when they press Pay; the outcome is recorded by the library's callbacks.
// Back from a redirect (?payment_intent=), the page shows the return instead of the form: retryBidPayment
// refuses a bid already paid, which is what a payer just back from paying would otherwise see.
import { dollars } from '@earthdance/payments/core'
import { checkoutReturnToken, StripeRetryPayment, useCheckoutReturn } from '@earthdance/payments/react'
import { useAction } from 'convex/react'
import { useState } from 'react'
import { api } from '../convex/_generated/api.js'
import type { Id } from '../convex/_generated/dataModel.js'

const STRIPE_PUBLISHABLE_KEY = 'pk_test_example'

export function RetryBidPayment({ bidId, amountCents }: { bidId: Id<'bids'>; amountCents: number }) {
  const [back] = useState(() => checkoutReturnToken(window.location.search))
  return back ? <RetryReturn back={back} /> : <RetryForm bidId={bidId} amountCents={amountCents} />
}

/** This page without what Stripe or PayPal added to its address, keeping the app's own parameters. */
function formAgainUrl() {
  const url = new URL(window.location.href)
  for (const added of ['payment_intent', 'payment_intent_client_secret', 'redirect_status', 'token', 'PayerID']) url.searchParams.delete(added)
  return url.pathname + url.search
}

// Whichever processor it came back from: PayPal's buttons may return here too (?token=).
function RetryReturn({ back }: { back: { processor: 'stripe' | 'paypal'; token: string } }) {
  const result = useCheckoutReturn(api.payments.completeReturn, back)
  if (result.state === 'checking') return <p>Confirming your payment…</p>
  if (result.state === 'paid') return <p>Paid, thank you.</p>
  if (result.state === 'processing') return <p>Your bank payment is on its way; it takes a few business days to clear.</p>
  return (
    <p>
      The payment didn’t go through. <a href={formAgainUrl()}>Try again</a>
    </p>
  )
}

function RetryForm({ bidId, amountCents }: { bidId: Id<'bids'>; amountCents: number }) {
  const retry = useAction(api.shop.retryBidPayment)
  const [outcome, setOutcome] = useState<'succeeded' | 'processing' | null>(null)
  if (outcome) return <p>{outcome === 'succeeded' ? 'Paid, thank you.' : 'Your bank payment is on its way; it takes a few business days to clear.'}</p>
  return <StripeRetryPayment publishableKey={STRIPE_PUBLISHABLE_KEY} amountCents={amountCents} createPayment={() => retry({ bidId })} onPaid={setOutcome} submitLabel={`Pay ${dollars(amountCents)}`} />
}
