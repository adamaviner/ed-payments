// Saving a payment method on the bid form, charged only if the bid wins. The card goes to whichever
// processor is cheaper for this bid (shop.cardProcessor): PayPal's Card Fields, or Stripe's Payment
// Element (not shown here; see the README). A PayPal button is offered as well, for bidders who'd
// rather use their PayPal account.
import { PaypalCardFields, PaypalSaveButton } from '@earthdance/payments/react'
import { useAction, useQuery } from 'convex/react'
import { api } from '../convex/_generated/api.js'

export function SaveForBids({ itemId, amountCents, onPlaced }: { itemId: string; amountCents: number; onPlaced: () => void }) {
  const choice = useQuery(api.shop.cardProcessor, { amountCents })
  const setup = useAction(api.shop.paypalSetupToken)
  const place = useAction(api.shop.placeBidWithPaypal)
  const save = async (setupTokenId: string) => {
    await place({ itemId, amountCents, setupTokenId })
    onPlaced()
  }
  // The client id is the same for every setup token; the first one says it.
  const clientId = 'example-paypal-client-id'
  if (!choice) return null
  return (
    <div>
      {choice.processor === 'paypal' && (
        <PaypalCardFields
          clientId={clientId}
          createSetupToken={async () => (await setup({ kind: 'card' })).setupTokenId}
          onSaved={save}
          submitLabel="Place bid"
          note="You’re only charged if you win."
        />
      )}
      <PaypalSaveButton clientId={clientId} createSetupToken={async () => (await setup({ kind: 'paypal' })).setupTokenId} onSaved={save} />
    </div>
  )
}
