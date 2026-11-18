// The page the buyer comes back to (shop.ts sends them to /items/:id/thanks). Stripe adds session_id
// to the address, PayPal adds token; the app reads it with its own router (plain URL here) and owns
// every word shown. Safe to reload: the library is asked again and answers the same.
import { type CheckoutReturnState, useCheckoutReturn } from '@earthdance/payments/react'
import { useState } from 'react'
import { api } from '../convex/_generated/api.js'

const MESSAGES: Record<Exclude<CheckoutReturnState, 'checking' | 'error'>, string> = {
  paid: 'Your payment went through. A confirmation email is on its way.',
  processing: 'Your bank transfer is on its way. It takes a few days; you’ll get an email when it arrives.',
  refund_needed: 'Sorry, this item was gone by the time your payment went through. You’ll be refunded in full.',
  failed: 'The payment didn’t go through. Nothing was charged.',
  cancelled: 'Nothing was paid. You can try again from the item’s page.',
}

export function CheckoutReturn() {
  const [{ processor, token }] = useState(() => {
    const params = new URLSearchParams(window.location.search)
    const sessionId = params.get('session_id')
    return sessionId ? { processor: 'stripe' as const, token: sessionId } : { processor: 'paypal' as const, token: params.get('token') }
  })
  const result = useCheckoutReturn(api.payments.completeReturn, { processor, token })

  if (result.state === 'checking') return <p>Confirming your payment…</p>
  if (result.state === 'error')
    return (
      <p>
        We couldn’t confirm this payment just now. If you paid, you’ll get an email shortly.
        {result.reason === 'request_failed' && <button onClick={result.retry}>Check again</button>}
      </p>
    )
  return (
    <p>
      {MESSAGES[result.state]} <a href={`/items/${result.ref.id}`}>Back to the item</a>
    </p>
  )
}
