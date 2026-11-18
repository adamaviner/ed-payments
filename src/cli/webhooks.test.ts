// The webhook-registration CLI against the fake processors: created with exactly the library's
// events, left alone when right, updated when not, removed on request; live accounts need --live.
import { describe, expect, test } from 'vitest'
import { PAYPAL_EVENTS, PAYPAL_LIVE_API, PAYPAL_SANDBOX_API } from '../core/paypal.js'
import { STRIPE_API_VERSION, STRIPE_EVENTS } from '../core/stripe.js'
import { fakePaypal } from '../testing/fakePaypal.js'
import { fakeStripe } from '../testing/fakeStripe.js'
import { paypalWebhook, stripeWebhook } from './webhooks.js'

const URL_ = 'https://happy-otter-123.convex.site/stripe/webhook'

describe('Stripe', () => {
  test('creates the endpoint with the library’s events and pinned API version, then leaves it, updates it, removes it', async () => {
    const stripe = fakeStripe()
    const run = { url: URL_, fetch: stripe.fetch }
    const made = await stripeWebhook('sk_test_x', run)
    expect(made).toMatchObject({ action: 'created', id: expect.stringMatching(/^we_/) })
    expect(made.notes[0]).toMatch(/Set STRIPE_WEBHOOK_SECRET .* to whsec_/)
    const [w] = stripe.webhookEndpoints()
    expect(w).toMatchObject({ url: URL_, api_version: STRIPE_API_VERSION })
    expect([...w.enabled_events].sort()).toEqual([...STRIPE_EVENTS].sort())
    expect(await stripeWebhook('sk_test_x', run)).toMatchObject({ action: 'unchanged', id: w.id })
    expect(await stripeWebhook('sk_test_x', { ...run, extraEvents: ['customer.created'], dryRun: true })).toMatchObject({ action: 'would update' })
    expect(await stripeWebhook('sk_test_x', { ...run, extraEvents: ['customer.created'] })).toMatchObject({ action: 'updated' })
    expect(stripe.webhookEndpoints()[0].enabled_events).toContain('customer.created')
    expect(await stripeWebhook('sk_test_x', { ...run, remove: true })).toMatchObject({ action: 'removed', id: w.id })
    expect(stripe.webhookEndpoints()).toEqual([])
    expect(await stripeWebhook('sk_test_x', { ...run, remove: true })).toMatchObject({ action: 'absent' })
  })

  test('a live key needs --live', async () => {
    await expect(stripeWebhook('sk_live_x', { url: URL_, fetch: fakeStripe().fetch })).rejects.toThrow(/--live/)
  })
})

describe('PayPal', () => {
  const keys = { clientId: 'id', clientSecret: 'secret', apiBase: PAYPAL_SANDBOX_API }

  test('creates the webhook with the library’s events, says the id to set, updates and removes it', async () => {
    const pp = fakePaypal()
    const run = { url: URL_.replace('stripe', 'paypal'), fetch: pp.fetch }
    const made = await paypalWebhook(keys, run)
    expect(made).toMatchObject({ action: 'created', notes: [expect.stringMatching(/PAYPAL_WEBHOOK_ID .* must be FAKEWH/)] })
    expect(
      pp
        .webhooks()[0]
        .event_types.map((e) => e.name)
        .sort(),
    ).toEqual([...PAYPAL_EVENTS].sort())
    expect(await paypalWebhook(keys, run)).toMatchObject({ action: 'unchanged' })
    expect(await paypalWebhook(keys, { ...run, extraEvents: ['CUSTOMER.DISPUTE.UPDATED'] })).toMatchObject({ action: 'updated' })
    expect(pp.webhooks()[0].event_types.map((e) => e.name)).toContain('CUSTOMER.DISPUTE.UPDATED')
    expect(await paypalWebhook(keys, { ...run, remove: true })).toMatchObject({ action: 'removed' })
    expect(pp.webhooks()).toEqual([])
  })

  test('the live API needs --live', async () => {
    await expect(paypalWebhook({ ...keys, apiBase: PAYPAL_LIVE_API }, { url: URL_, fetch: fakePaypal({ apiBase: PAYPAL_LIVE_API }).fetch })).rejects.toThrow(/--live/)
  })
})
