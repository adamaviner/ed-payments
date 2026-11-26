// The one-step membership form: OnPagePayment gives the tabs (card, bank account, PayPal), the card fields of the
// processor the quote gives for the amount, PayPal's own button, and the fallback to the processor's page. Nothing is
// started until the member presses; each press asks membership.startOnPage, and the component passes the checkout the
// last press started as replaces, so a press after a decline pays the same attempt. The fields take the page's colours.
import { dollars } from '@earthdance/payments/core'
import { OnPagePayment, usePageTheme, type PageColors } from '@earthdance/payments/react'
import { useAction } from 'convex/react'
import { api } from '../convex/_generated/api.js'

const STRIPE_PUBLISHABLE_KEY = 'pk_test_example'
const PAYPAL_CLIENT_ID = 'example-paypal-client-id'
const MONTHLY_CENTS = 1500
/** The same rates as convex/payments.ts gives definePayments, so the page shows the card fields the server will start. */
const FEES = {}
const COLORS: PageColors = { background: '--background', text: '--foreground', mutedText: '--muted-foreground', primary: '--primary', danger: '--destructive', border: '--input', radius: '--radius' }

export function JoinOnPage({ name, email }: { name: string; email: string }) {
  const theme = usePageTheme(COLORS)
  const startOnPage = useAction(api.membership.startOnPage)
  const startRedirect = useAction(api.membership.start)
  const label = `Pay ${dollars(MONTHLY_CENTS)} and join`
  const note = 'Charged every month until you cancel.'
  return (
    <OnPagePayment
      stripePublishableKey={STRIPE_PUBLISHABLE_KEY}
      paypalClientId={PAYPAL_CLIENT_ID}
      completeReturn={api.payments.completeReturn}
      tabs={[
        { method: 'card', label: 'Card', submitLabel: label, note },
        { method: 'ach', label: 'Bank account', submitLabel: label, note, hint: 'Lower fees' },
        { method: 'paypal', label: 'PayPal', submitLabel: label, note },
      ]}
      amountCents={MONTHLY_CENTS}
      fees={FEES}
      saveForLater
      payer={{ name, email }}
      start={(a) => startOnPage({ name, email, ...a })}
      startRedirect={async (a) => {
        const started = await startRedirect({ email, how: a.method === 'ach' ? 'bank' : a.method })
        if (!('redirectUrl' in started)) throw new Error('The payment couldn’t be started.')
        return started
      }}
      appearance={theme?.stripe}
      paypalStyle={theme?.paypal}
      classNames={{ tabList: 'bg-secondary' }}
    />
  )
}
