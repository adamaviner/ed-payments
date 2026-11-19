// Paying for an item on the app's own page. The app starts the checkout (shop.buyHere) when the buyer
// presses Continue, then shows PayPal's buttons or Stripe's embedded Checkout for it. Either ends on
// /items/:id/thanks (CheckoutReturn.tsx), as a redirect would. If the processor's script doesn't
// load, the same purchase is started as a redirect (shop.buy).
import type { StartedEmbedded } from '@earthdance/payments'
import { PaypalButtons, StripeEmbeddedCheckout } from '@earthdance/payments/react'
import { useAction } from 'convex/react'
import { useState } from 'react'
import { api } from '../convex/_generated/api.js'

/** The app's Stripe publishable key, from its build (the same account as STRIPE_SECRET_KEY). */
const STRIPE_PUBLISHABLE_KEY = 'pk_test_example'

export function EmbeddedCheckout({ itemId, email, card }: { itemId: string; email: string; card: boolean }) {
  const buyHere = useAction(api.shop.buyHere)
  const buy = useAction(api.shop.buy)
  const [started, setStarted] = useState<StartedEmbedded | null>(null)
  const redirect = () => void buy({ itemId, email, card }).then(({ redirectUrl }) => window.location.assign(redirectUrl))

  if (!started) return <button onClick={() => void buyHere({ itemId, email, card }).then(setStarted)}>Continue</button>
  const { embedded } = started
  return embedded.processor === 'paypal' ? (
    <PaypalButtons payment={embedded} completeReturn={api.payments.completeReturn} onFallback={redirect} />
  ) : (
    <StripeEmbeddedCheckout payment={embedded} publishableKey={STRIPE_PUBLISHABLE_KEY} onFallback={redirect} />
  )
}
