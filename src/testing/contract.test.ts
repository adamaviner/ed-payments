// Contract tests for the fakes: every object a fake processor answers with is checked against a saved
// real one (src/testing/fixtures, each saying where it came from), so the fakes can't drift into
// shapes the processors never send. A fake may leave fields out; it may not invent one, or give a
// field another type.
import { describe, expect, test } from 'vitest'
import { fakePaypal } from './fakePaypal.js'
import { fakeStripe } from './fakeStripe.js'
import { fixture, paypalEventFixtures, paypalObjectFixtures, stripeObjectFixtures } from './fixtures.js'

type Json = null | boolean | number | string | Json[] | { [k: string]: Json }

/** Where `fake` differs in shape from `real`: fields `real` lacks, and fields of another type. */
function drift(fake: unknown, real: unknown, path = ''): string[] {
  if (fake === null || real === null || fake === undefined || real === undefined) return []
  if (Array.isArray(fake) || Array.isArray(real)) {
    if (!Array.isArray(fake) || !Array.isArray(real)) return [`${path}: ${Array.isArray(fake) ? 'a list' : typeof fake} where the processor sends ${Array.isArray(real) ? 'a list' : typeof real}`]
    return fake.length && real.length ? drift(fake[0], real[0], `${path}[0]`) : []
  }
  if (typeof fake !== typeof real) {
    // An expandable field: an id string in one answer, the object in another.
    if ((typeof fake === 'string' && typeof real === 'object') || (typeof fake === 'object' && typeof real === 'string')) return []
    return [`${path}: ${typeof fake} where the processor sends ${typeof real}`]
  }
  if (typeof fake !== 'object') return []
  const f = fake as Record<string, Json>
  const r = real as Record<string, Json>
  // Metadata is the app's own key-value bag, not the processor's shape.
  return Object.keys(f).flatMap((k) => (k === 'metadata' ? [] : k in r ? drift(f[k], r[k], `${path}.${k}`) : [`${path}.${k}: not in the processor’s object`]))
}

const json = async (res: Response) => (await res.json()) as unknown
const post = (body: Record<string, string>): RequestInit => ({ method: 'POST', body: new URLSearchParams(body).toString() })
const S = 'https://api.stripe.com'

describe('fake Stripe answers in Stripe’s shapes', () => {
  test('sessions, customers, saved methods, SetupIntents', async () => {
    const stripe = fakeStripe()
    const session = await json(
      await stripe.fetch(`${S}/v1/checkout/sessions`, post({ 'line_items[0][price_data][unit_amount]': '2500', 'metadata[app]': 'a', 'allowed_payment_method_types[0]': 'card' })),
    )
    expect(drift(session, fixture(stripeObjectFixtures.sessionOpen))).toEqual([])
    const customer = (await json(await stripe.fetch(`${S}/v1/customers`, post({ email: 'a@example.org' })))) as { id: string }
    expect(drift(customer, fixture(stripeObjectFixtures.customer))).toEqual([])
    const card = stripe.saveMethod(customer.id, 'ok')
    stripe.saveMethod(customer.id, 'bank')
    const list = (await json(await stripe.fetch(`${S}/v1/customers/${customer.id}/payment_methods`))) as { data: unknown[] }
    expect(drift(list, fixture(stripeObjectFixtures.customerPaymentMethods))).toEqual([])
    expect(drift(list.data[0], fixture(stripeObjectFixtures.paymentMethodBank))).toEqual([])
    expect(drift(await json(await stripe.fetch(`${S}/v1/payment_methods/${card}`)), fixture(stripeObjectFixtures.paymentMethodCard))).toEqual([])
    expect(drift(await json(await stripe.fetch(`${S}/v1/setup_intents`, post({ customer: customer.id, usage: 'off_session' }))), fixture(stripeObjectFixtures.setupIntent))).toEqual([])
  })

  test('PaymentIntents: on-session, paid off-session, processing, declined, expanded, canceled, listed', async () => {
    const stripe = fakeStripe()
    const customer = (await json(await stripe.fetch(`${S}/v1/customers`, post({ email: 'a@example.org' })))) as { id: string }
    const charge = (pm: string) => stripe.fetch(`${S}/v1/payment_intents`, post({ amount: '2500', currency: 'usd', customer: customer.id, payment_method: pm, confirm: 'true', off_session: 'true' }))
    const on = (await json(await stripe.fetch(`${S}/v1/payment_intents`, post({ amount: '2500', currency: 'usd', customer: customer.id })))) as { id: string }
    expect(drift(on, fixture(stripeObjectFixtures.paymentIntentOnSession))).toEqual([])
    const paid = (await json(await charge(stripe.saveMethod(customer.id, 'ok')))) as { id: string }
    expect(drift(paid, fixture(stripeObjectFixtures.paymentIntentOffSession))).toEqual([])
    expect(drift(await json(await charge(stripe.saveMethod(customer.id, 'bank'))), fixture(stripeObjectFixtures.paymentIntentOffSessionBank))).toEqual([])
    const declined = await charge(stripe.saveMethod(customer.id, 'decline'))
    expect(declined.status).toBe(402)
    expect(drift(await json(declined), fixture(stripeObjectFixtures.errorCardDeclined))).toEqual([])
    const auth = await charge(stripe.saveMethod(customer.id, 'auth'))
    expect(drift(await json(auth), fixture(stripeObjectFixtures.errorAuthenticationRequired))).toEqual([])
    const expanded = await json(await stripe.fetch(`${S}/v1/payment_intents/${paid.id}?expand[0]=payment_method&expand[1]=latest_charge.balance_transaction`))
    expect(drift(expanded, fixture(stripeObjectFixtures.paymentIntentExpanded))).toEqual([])
    expect(drift(await json(await stripe.fetch(`${S}/v1/payment_intents/${on.id}/cancel`, post({}))), fixture(stripeObjectFixtures.paymentIntentCanceled))).toEqual([])
    expect(drift(await json(await stripe.fetch(`${S}/v1/payment_intents?limit=3`)), fixture(stripeObjectFixtures.paymentIntentList))).toEqual([])
  })

  test('the old payment_method_types parameter is refused as Stripe refuses it', async () => {
    const stripe = fakeStripe()
    const res = await stripe.fetch(`${S}/v1/setup_intents`, post({ customer: 'cus_x', 'payment_method_types[0]': 'card' }))
    expect(res.status).toBe(400)
    expect(await json(res)).toEqual(fixture(stripeObjectFixtures.errorPaymentMethodTypes))
  })

  test('refunds and webhook endpoints', async () => {
    const stripe = fakeStripe()
    const customer = (await json(await stripe.fetch(`${S}/v1/customers`, post({ email: 'a@example.org' })))) as { id: string }
    const pi = (await json(await stripe.fetch(`${S}/v1/payment_intents`, post({ amount: '2500', customer: customer.id, payment_method: stripe.saveMethod(customer.id, 'ok'), confirm: 'true' })))) as {
      id: string
    }
    expect(drift(await json(await stripe.fetch(`${S}/v1/refunds`, post({ payment_intent: pi.id, amount: '500' }))), fixture(stripeObjectFixtures.refund))).toEqual([])
    expect(
      drift(await json(await stripe.fetch(`${S}/v1/webhook_endpoints`, post({ url: 'https://x.example.org', 'enabled_events[0]': 'charge.refunded' }))), fixture(stripeObjectFixtures.webhookEndpoint)),
    ).toEqual([])
  })
})

describe('fake PayPal answers in PayPal’s shapes', () => {
  test('orders made and captured', async () => {
    const pp = fakePaypal()
    const B = 'https://api-m.sandbox.paypal.com'
    const order = (await json(
      await pp.fetch(`${B}/v2/checkout/orders`, {
        method: 'POST',
        body: JSON.stringify({ purchase_units: [{ custom_id: 'a:1', amount: { currency_code: 'USD', value: '25.00' } }] }),
      }),
    )) as { id: string }
    expect(drift(order, fixture(paypalObjectFixtures.orderCreated))).toEqual([])
    pp.approve(order.id)
    expect(drift(await json(await pp.fetch(`${B}/v2/checkout/orders/${order.id}`)), fixture(paypalObjectFixtures.orderApproved))).toEqual([])
    // No captured order could be saved from the sandbox (a capture needs a buyer to approve in a
    // browser), so the reference is the real order with a real capture in it: the order as the sandbox
    // showed it, and the capture as PayPal's PAYMENT.CAPTURE.COMPLETED webhook carries it.
    const real = fixture(paypalObjectFixtures.orderUnapproved)
    const capture = fixture(paypalEventFixtures['PAYMENT.CAPTURE.COMPLETED']).resource
    const captured = { ...real, purchase_units: [{ ...real.purchase_units[0], payments: { captures: [capture] } }] }
    expect(drift(await json(await pp.fetch(`${B}/v2/checkout/orders/${order.id}/capture`, { method: 'POST' })), captured)).toEqual([])
  })
})

describe('the check itself', () => {
  test('finds an invented field and a changed type', () => {
    expect(drift({ id: 'x', invented: 1, amount: '25' }, { id: 'y', amount: 25 })).toEqual(['.invented: not in the processor’s object', '.amount: string where the processor sends number'])
  })
})
