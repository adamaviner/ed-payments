// Saving a payment method on the bid form, charged only if the bid wins. The card goes to whichever
// processor is cheaper for this bid (shop.cardProcessor): PayPal's Card Fields, or Stripe's Payment
// Element (StripeSaveMethod, a card or a bank account). When cards go to PayPal, Stripe still takes
// bank accounts. A PayPal button is offered as well, for bidders who'd rather use their PayPal account.
// Neither form makes anything at the processors until the bidder presses the button. Back from a
// Stripe redirect (?setup_intent_client_secret=), the method is saved but the bid wasn't placed: say so.
import type { SavedMethodKind } from '@earthdance/payments/core'
import { PaypalCardFields, PaypalSaveButton, StripeSaveMethod, useStripeSetupReturn, type StripeAppearance } from '@earthdance/payments/react'
import { useAction, useQuery } from 'convex/react'
import { api } from '../convex/_generated/api.js'

/** The app's Stripe publishable key, from its build (the same account as STRIPE_SECRET_KEY). */
const STRIPE_PUBLISHABLE_KEY = 'pk_test_example'
/** Stripe's frames can't see the page's CSS: the dark page's colors, literally. */
const DARK: StripeAppearance = { theme: 'night', variables: { colorBackground: '#171717', colorText: '#fafafa' } }

export function SaveForBids({ itemId, amountCents, dark, onPlaced }: { itemId: string; amountCents: number; dark: boolean; onPlaced: () => void }) {
  const back = useStripeSetupReturn(STRIPE_PUBLISHABLE_KEY)
  const choice = useQuery(api.shop.cardProcessor, { amountCents })
  const setup = useAction(api.shop.paypalSetupToken)
  const stripeSetupIntent = useAction(api.shop.stripeSetupIntent)
  const place = useAction(api.shop.placeBid)
  const placeWithPaypal = useAction(api.shop.placeBidWithPaypal)
  const savePaypal = async (setupTokenId: string) => {
    await placeWithPaypal({ itemId, amountCents, setupTokenId })
    onPlaced()
  }
  // The client id is the same for every setup token; the first one says it.
  const clientId = 'example-paypal-client-id'
  if (back.state === 'checking') return <p>Checking your payment method…</p>
  if (back.state === 'saved') return <p>Your payment method is saved. Review your bid again to place it with it.</p>
  if (!choice) return null
  const methods: SavedMethodKind[] = choice.processor === 'paypal' ? ['ach'] : ['card', 'ach']
  return (
    <div>
      {choice.processor === 'paypal' && (
        <PaypalCardFields
          clientId={clientId}
          createSetupToken={async () => (await setup({ kind: 'card' })).setupTokenId}
          onSaved={savePaypal}
          submitLabel="Place bid"
          note="You’re only charged if you win."
        />
      )}
      <StripeSaveMethod
        publishableKey={STRIPE_PUBLISHABLE_KEY}
        methods={methods}
        createSetupIntent={() => stripeSetupIntent({ methods })}
        onSaved={async (paymentMethodId) => {
          await place({ itemId, amountCents, paymentMethodId })
          onPlaced()
        }}
        submitLabel="Place bid"
        note="You’re only charged if you win."
        appearance={dark ? DARK : { theme: 'stripe' }}
      />
      <PaypalSaveButton clientId={clientId} createSetupToken={async () => (await setup({ kind: 'paypal' })).setupTokenId} onSaved={savePaypal} />
    </div>
  )
}
