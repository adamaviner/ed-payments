// Real calls to Stripe test mode with the library's own wire code: what was checked by hand for v0.1,
// and the saved-method calls v0.2 added. Run by `npm run test:sandbox` (vitest.sandbox.config.ts),
// only with a test key. Everything made here is test-mode data; the customer is deleted at the end,
// and a webhook endpoint made to check the CLI is removed again.
import { afterAll, describe, expect, test } from 'vitest'
import { stripeWebhook } from '../src/cli/webhooks.js'
import { ProcessorError, intentState, sessionState, stripe, stripeCall, type StripeCustomer } from '../src/core/index.js'

const secretKey = process.env.SANDBOX_STRIPE_SECRET_KEY ?? ''
if (!/^(sk|rk)_test_/.test(secretKey)) throw new Error('The sandbox suite only runs with a Stripe test key.')
const keys = { secretKey }
const o = { fetch: (input: string, init?: RequestInit) => fetch(input, init) }
const run = Date.now().toString(36)
const now = Date.now()

let customer: StripeCustomer | null = null
afterAll(async () => {
  if (customer) await fetch(`https://api.stripe.com/v1/customers/${customer.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${secretKey}` } })
})

/** A ProcessorError's fields, or the error itself when it isn't one. */
async function failure(p: Promise<unknown>) {
  try {
    await p
  } catch (err) {
    if (err instanceof ProcessorError) return { status: err.status, code: err.code, type: err.type, declined: err.declined, paymentIntent: err.paymentIntent }
    throw err
  }
  throw new Error('expected Stripe to refuse')
}

describe('Checkout Sessions', () => {
  test('card and bank sessions are made, read and expired', async () => {
    for (const method of ['card', 'ach'] as const) {
      const s = await stripe.createSession(
        keys,
        {
          app: 'sandbox',
          checkoutId: `sb-${run}-${method}`,
          description: 'Sandbox',
          amountCents: 2500,
          method,
          successUrl: 'https://example.org/ok',
          cancelUrl: 'https://example.org/no',
          expiresAt: now + 3600_000,
          now,
        },
        o,
      )
      expect(sessionState(s)).toBe('open')
      expect((await stripe.retrieveSession(keys, s.id, o)).metadata).toMatchObject({ app: 'sandbox' })
      expect(sessionState(await stripe.expireSession(keys, s.id, o))).toBe('expired')
    }
  })
})

describe('saved methods and PaymentIntents', () => {
  test('a customer, a SetupIntent for off-session use, and the old parameter refused', async () => {
    customer = await stripe.createCustomer(keys, { app: 'sandbox', owner: `user:${run}`, email: 'sandbox@example.org' }, { ...o, idempotencyKey: `sb-cust-${run}` })
    const again = await stripe.createCustomer(keys, { app: 'sandbox', owner: `user:${run}`, email: 'sandbox@example.org' }, { ...o, idempotencyKey: `sb-cust-${run}` })
    expect(again.id).toBe(customer.id)
    const si = await stripe.createSetupIntent(keys, { customer: customer.id, app: 'sandbox', owner: `user:${run}` }, o)
    expect(si).toMatchObject({ status: 'requires_payment_method', usage: 'off_session' })
    expect(si.client_secret).toBeTruthy()
    const old = await failure(stripeCall(keys, 'POST', '/v1/setup_intents', { customer: customer.id, payment_method_types: ['card'] }, o))
    expect(old.status).toBe(400)
  })

  test('off-session charges: paid (and replayed for the same key), declined, needing authentication, a bank account processing', async () => {
    if (!customer) throw new Error('needs the customer from the test above')
    const c = customer.id
    const attach = async (pm: string) => {
      const res = await fetch(`https://api.stripe.com/v1/payment_methods/${pm}/attach`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${secretKey}`, 'Stripe-Version': '2026-10-28.endive', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `customer=${c}`,
      })
      return ((await res.json()) as { id: string }).id
    }
    const charge = (pm: string, id: string) =>
      stripe.createPaymentIntent(
        keys,
        { app: 'sandbox', checkoutId: id, amountCents: 2500, customer: c, description: 'Sandbox', offSession: true, paymentMethod: pm },
        { ...o, idempotencyKey: `sb-${run}-${id}` },
      )
    const card = await attach('pm_card_visa')
    const paid = await charge(card, 'ok')
    expect(intentState(paid)).toBe('paid')
    expect((await charge(card, 'ok')).id).toBe(paid.id)
    const listed = await stripe.customerMethods(keys, c, o)
    expect(listed.data.map((m) => m.id)).toContain(card)
    expect((await stripe.retrievePaymentMethod(keys, card, o)).customer).toBe(c)
    const full = await stripe.paymentIntentWithMethod(keys, paid.id, o)
    expect(typeof full.payment_method === 'object' && full.payment_method?.type).toBe('card')

    expect(await failure(charge(await attach('pm_card_chargeCustomerFail'), 'decline'))).toMatchObject({
      status: 402,
      type: 'card_error',
      code: 'card_declined',
      declined: true,
      paymentIntent: { status: 'requires_payment_method' },
    })
    expect(await failure(charge(await attach('pm_card_authenticationRequired'), 'auth'))).toMatchObject({ status: 402, code: 'authentication_required', declined: true })
    expect(intentState(await charge(await attach('pm_usBankAccount_success'), 'bank'))).toBe('processing')

    const on = await stripe.createPaymentIntent(
      keys,
      { app: 'sandbox', checkoutId: 'on', amountCents: 2500, customer: c, description: 'Sandbox retry', offSession: false },
      { ...o, idempotencyKey: `sb-${run}-on` },
    )
    expect(on.status).toBe('requires_payment_method')
    expect(on.client_secret).toBeTruthy()
    expect((await stripe.cancelPaymentIntent(keys, on.id, o)).status).toBe('canceled')
    expect((await stripe.listPaymentIntents(keys, Math.floor(now / 1000) - 60, undefined, o)).data.some((p) => p.id === paid.id)).toBe(true)
  })

  test('a refund needs the key’s Refunds permission: made, or refused saying so', async () => {
    const list = await stripe.listPaymentIntents(keys, Math.floor(now / 1000) - 60, undefined, o)
    const paid = list.data.find((p) => p.status === 'succeeded' && p.metadata?.app === 'sandbox')
    if (!paid) throw new Error('needs the paid charge from the test above')
    try {
      const r = await stripe.createRefund(keys, { paymentIntent: paid.id, amountCents: 500, app: 'sandbox', refundId: `sb-${run}` }, o)
      expect(['succeeded', 'pending']).toContain(r.status)
    } catch (err) {
      if (!(err instanceof ProcessorError) || err.status !== 403) throw err
      expect(err.code).toBe('more_permissions_required')
      console.info('test:sandbox: this key has no Refunds permission, so the refund was refused (expected for ed-market’s current test key).')
    }
  })
})

describe('the webhook CLI', () => {
  test('creates, leaves and removes an endpoint, or is refused for want of the Webhook Endpoints permission', async () => {
    const url = `https://example.org/ed-payments-sandbox-${run}/stripe/webhook`
    try {
      expect((await stripeWebhook(secretKey, { url, fetch: o.fetch })).action).toBe('created')
      expect((await stripeWebhook(secretKey, { url, fetch: o.fetch })).action).toBe('unchanged')
      expect((await stripeWebhook(secretKey, { url, fetch: o.fetch, remove: true })).action).toBe('removed')
    } catch (err) {
      if (!(err instanceof ProcessorError) || err.status !== 403) throw err
      console.info('test:sandbox: this key has no Webhook Endpoints permission, so the CLI was refused (it would need it to register the webhook).')
    }
  })
})
