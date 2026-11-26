// The one-step membership form: the payment fields sit in the form and nothing is started until the member presses
// the button. Stripe's Payment Element (a card or a bank account), or PayPal's card fields when a card is cheaper at
// PayPal for the amount. Each press asks membership.startOnPage, passing the checkout the last press started, so a
// press after a decline pays the same checkout. The fields take the page's own colours (usePageTheme).
import type { OnPagePayment } from '@earthdance/payments'
import { PaypalOnPagePayment, StripeOnPagePayment, usePageTheme, type PageColors } from '@earthdance/payments/react'
import { useAction, useQuery } from 'convex/react'
import { useRef, useState } from 'react'
import { api } from '../convex/_generated/api.js'

const STRIPE_PUBLISHABLE_KEY = 'pk_test_example'
const PAYPAL_CLIENT_ID = 'example-paypal-client-id'
const MONTHLY_CENTS = 1500
const COLORS: PageColors = { background: '--background', text: '--foreground', mutedText: '--muted-foreground', primary: '--primary', danger: '--destructive', border: '--input', radius: '--radius' }

export function JoinOnPage({ name, email }: { name: string; email: string }) {
  const theme = usePageTheme(COLORS)
  const [how, setHow] = useState<'card' | 'bank'>('card')
  const choice = useQuery(api.shop.cardProcessor, { amountCents: MONTHLY_CENTS })
  const startOnPage = useAction(api.membership.startOnPage)
  const last = useRef<string | undefined>(undefined)
  const start = async (): Promise<OnPagePayment> => {
    const started = await startOnPage({ name, email, how, replaces: last.current })
    last.current = started.checkoutId
    return started.onPage
  }
  if (!choice) return null
  const note = 'Charged every month until you cancel.'
  return (
    <div>
      <button onClick={() => setHow(how === 'card' ? 'bank' : 'card')}>{how === 'card' ? 'Pay by bank instead' : 'Pay by card instead'}</button>
      {how === 'card' && choice.processor === 'paypal' ? (
        theme && <PaypalOnPagePayment clientId={PAYPAL_CLIENT_ID} start={start} completeReturn={api.payments.completeReturn} submitLabel="Pay $15 and join" note={note} style={theme.paypal} />
      ) : (
        <StripeOnPagePayment
          publishableKey={STRIPE_PUBLISHABLE_KEY}
          amountCents={MONTHLY_CENTS}
          methods={[how === 'bank' ? 'ach' : 'card']}
          saveForLater
          payer={{ name, email }}
          start={start}
          submitLabel="Pay $15 and join"
          note={note}
          appearance={theme?.stripe}
        />
      )}
    </div>
  )
}
