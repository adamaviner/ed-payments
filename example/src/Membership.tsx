// Joining a monthly membership on the app's own page (membership.start): the first payment also saves
// how the member pays. A bank account or Stripe card: Stripe's embedded Checkout, which says the
// method is saved (and shows a bank account's mandate). PayPal: its own button alone. A card that went
// to PayPal: PayPal's Card Fields.
import type { StartedEmbedded } from '@earthdance/payments'
import { PaypalButtons, PaypalCardPayment, StripeEmbeddedCheckout } from '@earthdance/payments/react'
import { useAction } from 'convex/react'
import { useState } from 'react'
import { api } from '../convex/_generated/api.js'

const STRIPE_PUBLISHABLE_KEY = 'pk_test_example'

export function Membership({ email, how }: { email: string; how: 'card' | 'bank' | 'paypal' }) {
  const start = useAction(api.membership.start)
  const [started, setStarted] = useState<StartedEmbedded | null>(null)
  if (!started) return <button onClick={() => void start({ email, how }).then((s) => 'embedded' in s && setStarted({ checkoutId: s.checkoutId, embedded: s.embedded }))}>Join for $15 a month</button>
  const { embedded } = started
  if (embedded.processor === 'stripe') return <StripeEmbeddedCheckout payment={embedded} publishableKey={STRIPE_PUBLISHABLE_KEY} />
  return embedded.only === 'card' ? (
    <PaypalCardPayment payment={embedded} completeReturn={api.payments.completeReturn} submitLabel="Pay $15 and join" note="Charged every month until you cancel." />
  ) : (
    <PaypalButtons payment={embedded} completeReturn={api.payments.completeReturn} />
  )
}
