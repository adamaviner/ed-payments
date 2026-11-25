// Contract tests for the fakes: every route a fake processor answers, and every webhook body it makes,
// is checked against a saved real one (src/testing/fixtures, each saying where it came from), so the
// fakes can't drift into shapes the processors never send. A fake may leave fields out; it may not
// invent one, give a field another type, or answer null where the processor has a value. A new route
// or webhook in a fake gets a line here.
import { describe, expect, test } from 'vitest'
import { drift } from './drift.js'
import { fakePaypal } from './fakePaypal.js'
import { fakeStripe } from './fakeStripe.js'
import { fixture, paypalEventFixtures, paypalObjectFixtures, stripeEventFixtures, stripeObjectFixtures, type PaypalEventFixture, type StripeEventFixture } from './fixtures.js'

const json = async (res: Response) => (await res.json()) as unknown
const post = (body: Record<string, string>, headers: Record<string, string> = {}): RequestInit => ({ method: 'POST', body: new URLSearchParams(body).toString(), headers })
const S = 'https://api.stripe.com'
const B = 'https://api-m.sandbox.paypal.com'

/** A webhook request a fake made, checked against the fixture for its event. */
const stripeHook = (hook: RequestInit, name: StripeEventFixture, nullable?: string[]) => drift(JSON.parse(hook.body as string), fixture(stripeEventFixtures[name]), { nullable })
const paypalHook = (hook: RequestInit, name: PaypalEventFixture) => drift(JSON.parse(hook.body as string), fixture(paypalEventFixtures[name]))

/**
 * A webhook for an intent paid in the Payment Element: the event against its fixture, and the intent
 * against the on-session intent it is. The processing and payment_failed fixtures carry off-session
 * intents, whose bank options differ (no financial_connections).
 */
function onSessionHook(hook: RequestInit, name: StripeEventFixture) {
  const event = JSON.parse(hook.body as string) as { data: { object: unknown } }
  return [...drift({ ...event, data: { ...event.data, object: {} } }, fixture(stripeEventFixtures[name])), ...drift(event.data.object, fixture(stripeObjectFixtures.paymentIntentOnSession))]
}

/** A list's envelope (object, data, has_more, url) against a real list's, and each item against `item`. */
async function stripeList(res: Response, item: unknown) {
  const list = (await json(res)) as { data: unknown[] }
  return [...drift({ ...list, data: [] }, fixture(stripeObjectFixtures.paymentIntentList)), ...list.data.flatMap((x) => drift(x, item))]
}

/** Fields of a PaymentIntent that are null until it gets there (canceled, or confirmed), so a list of intents in several states has them null in some. */
const INTENT_STATE_FIELDS = ['.data[n].canceled_at', '.data[n].cancellation_reason', '.data[n].latest_charge', '.data[n].payment_method', '.data[n].last_payment_error', '.data[n].client_secret']
/**
 * payment_intent.succeeded.json is an intent ed-market made with automatic payment methods; the
 * library's are made with allowed_payment_method_types, which Stripe answers with these null (payment-intent-off-session.json).
 */
const AUTOMATIC_METHODS_FIELDS = ['.data.object.automatic_payment_methods', '.data.object.payment_method_configuration_details']

describe('fake Stripe answers in Stripe’s shapes', () => {
  test('sessions: made (card, bank, embedded), read, read expanded, listed, expired, and the refusals', async () => {
    const stripe = fakeStripe()
    const make = (extra: Record<string, string> = {}) =>
      stripe.fetch(
        `${S}/v1/checkout/sessions`,
        post({ 'line_items[0][price_data][unit_amount]': '2500', client_reference_id: 'c1', 'metadata[app]': 'a', 'allowed_payment_method_types[0]': 'card', ...extra }),
      )
    const session = (await json(await make())) as { id: string }
    expect(drift(session, fixture(stripeObjectFixtures.sessionOpen))).toEqual([])
    expect(drift(await json(await make({ 'allowed_payment_method_types[0]': 'us_bank_account' })), fixture(stripeObjectFixtures.sessionAchOpen))).toEqual([])
    // An embedded session has no page of its own: url null, as the sandbox suite sees.
    expect(drift(await json(await make({ ui_mode: 'embedded_page' })), fixture(stripeObjectFixtures.sessionOpen), { nullable: ['.url'] })).toEqual([])
    expect(drift(await json(await stripe.fetch(`${S}/v1/checkout/sessions/${session.id}`)), fixture(stripeObjectFixtures.sessionOpen))).toEqual([])
    await stripe.pay(session.id)
    const expanded = (await json(await stripe.fetch(`${S}/v1/checkout/sessions/${session.id}?expand[0]=payment_intent.latest_charge.balance_transaction`))) as { payment_intent: unknown }
    expect(drift(expanded, fixture(stripeObjectFixtures.sessionOpen))).toEqual([])
    expect(drift(expanded.payment_intent, fixture(stripeObjectFixtures.paymentIntent))).toEqual([])
    expect(drift(await json(await stripe.fetch(`${S}/v1/checkout/sessions?created[gte]=0`)), fixture(stripeObjectFixtures.sessionList))).toEqual([])
    const open = (await json(await make())) as { id: string }
    expect(drift(await json(await stripe.fetch(`${S}/v1/checkout/sessions/${open.id}/expire`, post({}))), fixture(stripeObjectFixtures.sessionExpired))).toEqual([])
    expect(drift(await json(await stripe.fetch(`${S}/v1/checkout/sessions/${open.id}/expire`, post({}))), fixture(stripeObjectFixtures.errorExpireNotOpen))).toEqual([])
    expect(drift(await json(await stripe.fetch(`${S}/v1/checkout/sessions/cs_nope`)), fixture(stripeObjectFixtures.errorResourceMissing))).toEqual([])
    const refusals: Record<string, string>[] = [{ ui_mode: 'embedded' }, { customer: 'cus_x', customer_email: 'a@example.org' }, { 'payment_intent_data[setup_future_usage]': 'off_session' }]
    for (const refused of refusals) {
      const res = await make(refused)
      expect(res.status).toBe(400)
      expect(drift(await json(res), fixture(stripeObjectFixtures.errorResourceMissing))).toEqual([])
    }
  })

  test('customers, saved methods, SetupIntents', async () => {
    const stripe = fakeStripe()
    const customer = (await json(await stripe.fetch(`${S}/v1/customers`, post({ email: 'a@example.org' })))) as { id: string }
    expect(drift(customer, fixture(stripeObjectFixtures.customer))).toEqual([])
    const card = stripe.saveMethod(customer.id, 'ok')
    stripe.saveMethod(customer.id, 'bank')
    const list = (await json(await stripe.fetch(`${S}/v1/customers/${customer.id}/payment_methods`))) as { data: unknown[] }
    expect(drift(list, fixture(stripeObjectFixtures.customerPaymentMethods))).toEqual([])
    expect(drift(list.data[0], fixture(stripeObjectFixtures.paymentMethodBank))).toEqual([])
    expect(drift(list.data[1], fixture(stripeObjectFixtures.paymentMethodCard))).toEqual([])
    expect(drift(await json(await stripe.fetch(`${S}/v1/customers/cus_nope/payment_methods`)), fixture(stripeObjectFixtures.errorResourceMissing))).toEqual([])
    expect(drift(await json(await stripe.fetch(`${S}/v1/payment_methods/${card}`)), fixture(stripeObjectFixtures.paymentMethodCard))).toEqual([])
    expect(drift(await json(await stripe.fetch(`${S}/v1/payment_methods/pm_nope`)), fixture(stripeObjectFixtures.errorResourceMissing))).toEqual([])
    expect(drift(await json(await stripe.fetch(`${S}/v1/setup_intents`, post({ customer: customer.id, usage: 'off_session' }))), fixture(stripeObjectFixtures.setupIntent))).toEqual([])
  })

  test('PaymentIntents: on-session, paid off-session, processing, declined, read, expanded, canceled, listed', async () => {
    const stripe = fakeStripe()
    const customer = (await json(await stripe.fetch(`${S}/v1/customers`, post({ email: 'a@example.org' })))) as { id: string }
    const charge = (pm: string) => stripe.fetch(`${S}/v1/payment_intents`, post({ amount: '2500', currency: 'usd', customer: customer.id, payment_method: pm, confirm: 'true', off_session: 'true' }))
    const on = (await json(await stripe.fetch(`${S}/v1/payment_intents`, post({ amount: '2500', currency: 'usd', customer: customer.id })))) as { id: string }
    expect(drift(on, fixture(stripeObjectFixtures.paymentIntentOnSession))).toEqual([])
    const paid = (await json(await charge(stripe.saveMethod(customer.id, 'ok')))) as { id: string }
    expect(drift(paid, fixture(stripeObjectFixtures.paymentIntentOffSession))).toEqual([])
    expect(drift(await json(await stripe.fetch(`${S}/v1/payment_intents/${paid.id}`)), fixture(stripeObjectFixtures.paymentIntentOffSession))).toEqual([])
    expect(drift(await json(await charge(stripe.saveMethod(customer.id, 'bank'))), fixture(stripeObjectFixtures.paymentIntentOffSessionBank))).toEqual([])
    for (const behaviour of ['decline', 'insufficient', 'lost'] as const) {
      const declined = await charge(stripe.saveMethod(customer.id, behaviour))
      expect(declined.status).toBe(402)
      expect(drift(await json(declined), fixture(stripeObjectFixtures.errorCardDeclined))).toEqual([])
    }
    expect(drift(await json(await charge(stripe.saveMethod(customer.id, 'auth'))), fixture(stripeObjectFixtures.errorAuthenticationRequired))).toEqual([])
    expect(drift(await json(await charge('pm_nope')), fixture(stripeObjectFixtures.errorResourceMissing))).toEqual([])
    const expanded = await json(await stripe.fetch(`${S}/v1/payment_intents/${paid.id}?expand[0]=payment_method&expand[1]=latest_charge.balance_transaction`))
    expect(drift(expanded, fixture(stripeObjectFixtures.paymentIntentExpanded))).toEqual([])
    expect(drift(await json(await stripe.fetch(`${S}/v1/payment_intents/${on.id}/cancel`, post({}))), fixture(stripeObjectFixtures.paymentIntentCanceled))).toEqual([])
    expect(drift(await json(await stripe.fetch(`${S}/v1/payment_intents/${paid.id}/cancel`, post({}))), fixture(stripeObjectFixtures.errorResourceMissing))).toEqual([])
    expect(drift(await json(await stripe.fetch(`${S}/v1/payment_intents?limit=3`)), fixture(stripeObjectFixtures.paymentIntentList), { nullable: INTENT_STATE_FIELDS })).toEqual([])
    expect(drift(await json(await stripe.fetch(`${S}/v1/payment_intents/pi_nope`)), fixture(stripeObjectFixtures.errorResourceMissing))).toEqual([])
  })

  test('a hosted session’s PaymentIntent, read on its own', async () => {
    const stripe = fakeStripe()
    const session = (await json(await stripe.fetch(`${S}/v1/checkout/sessions`, post({ 'line_items[0][price_data][unit_amount]': '2500', client_reference_id: 'c1', 'metadata[app]': 'a' })))) as {
      id: string
    }
    await stripe.pay(session.id)
    const pi = stripe.session(session.id).payment_intent as string
    expect(drift(await json(await stripe.fetch(`${S}/v1/payment_intents/${pi}`)), fixture(stripeObjectFixtures.paymentIntent))).toEqual([])
  })

  test('the old payment_method_types parameter is refused as Stripe refuses it', async () => {
    const stripe = fakeStripe()
    const res = await stripe.fetch(`${S}/v1/setup_intents`, post({ customer: 'cus_x', 'payment_method_types[0]': 'card' }))
    expect(res.status).toBe(400)
    expect(await json(res)).toEqual(fixture(stripeObjectFixtures.errorPaymentMethodTypes))
  })

  test('an idempotency key replays its first answer, and is refused with other parameters', async () => {
    const stripe = fakeStripe()
    const first = (await json(await stripe.fetch(`${S}/v1/customers`, post({ email: 'a@example.org' }, { 'Idempotency-Key': 'k1' })))) as { id: string }
    expect(((await json(await stripe.fetch(`${S}/v1/customers`, post({ email: 'a@example.org' }, { 'Idempotency-Key': 'k1' })))) as { id: string }).id).toBe(first.id)
    const other = await stripe.fetch(`${S}/v1/customers`, post({ email: 'b@example.org' }, { 'Idempotency-Key': 'k1' }))
    expect(other.status).toBe(400)
    expect(drift(await json(other), fixture(stripeObjectFixtures.errorIdempotencyKeyReused))).toEqual([])
    expect(stripe.customers()).toHaveLength(1)
  })

  test('refunds: made, too much, read, listed', async () => {
    const stripe = fakeStripe()
    const customer = (await json(await stripe.fetch(`${S}/v1/customers`, post({ email: 'a@example.org' })))) as { id: string }
    const pi = (await json(await stripe.fetch(`${S}/v1/payment_intents`, post({ amount: '2500', customer: customer.id, payment_method: stripe.saveMethod(customer.id, 'ok'), confirm: 'true' })))) as {
      id: string
    }
    const refund = (await json(await stripe.fetch(`${S}/v1/refunds`, post({ payment_intent: pi.id, amount: '500' })))) as { id: string }
    expect(drift(refund, fixture(stripeObjectFixtures.refund))).toEqual([])
    expect(drift(await json(await stripe.fetch(`${S}/v1/refunds`, post({ payment_intent: pi.id, amount: '5000' }))), fixture(stripeObjectFixtures.errorResourceMissing))).toEqual([])
    expect(drift(await json(await stripe.fetch(`${S}/v1/refunds`, post({ payment_intent: 'pi_nope' }))), fixture(stripeObjectFixtures.errorResourceMissing))).toEqual([])
    expect(drift(await json(await stripe.fetch(`${S}/v1/refunds/${refund.id}`)), fixture(stripeObjectFixtures.refund))).toEqual([])
    expect(drift(await json(await stripe.fetch(`${S}/v1/refunds/re_nope`)), fixture(stripeObjectFixtures.errorResourceMissing))).toEqual([])
    expect(await stripeList(await stripe.fetch(`${S}/v1/refunds?payment_intent=${pi.id}`), fixture(stripeObjectFixtures.refund))).toEqual([])
  })

  test('webhook endpoints: made, listed, updated, removed', async () => {
    const stripe = fakeStripe()
    const made = (await json(
      await stripe.fetch(`${S}/v1/webhook_endpoints`, post({ url: 'https://x.example.org', 'enabled_events[0]': 'charge.refunded', api_version: '2026-10-28.endive', description: 'Payments' })),
    )) as { id: string }
    expect(drift(made, fixture(stripeObjectFixtures.webhookEndpoint))).toEqual([])
    const { secret: _secret, ...listed } = fixture(stripeObjectFixtures.webhookEndpoint)
    expect(await stripeList(await stripe.fetch(`${S}/v1/webhook_endpoints`), listed)).toEqual([])
    expect(drift(await json(await stripe.fetch(`${S}/v1/webhook_endpoints/${made.id}`, post({ 'enabled_events[0]': 'refund.failed' }))), listed)).toEqual([])
    expect(drift(await json(await stripe.fetch(`${S}/v1/webhook_endpoints/${made.id}`, { method: 'DELETE' })), fixture(stripeObjectFixtures.webhookEndpointDeleted))).toEqual([])
    expect(drift(await json(await stripe.fetch(`${S}/v1/webhook_endpoints/we_nope`, { method: 'DELETE' })), fixture(stripeObjectFixtures.errorResourceMissing))).toEqual([])
  })

  test('every webhook it makes is shaped like the real event', async () => {
    const stripe = fakeStripe()
    const make = (extra: Record<string, string> = {}) =>
      stripe.fetch(`${S}/v1/checkout/sessions`, post({ 'line_items[0][price_data][unit_amount]': '2500', client_reference_id: 'c1', 'metadata[app]': 'a', 'metadata[checkoutId]': 'c1', ...extra }))
    const card = (await json(await make())) as { id: string }
    expect(stripeHook(await stripe.pay(card.id), 'checkout.session.completed')).toEqual([])
    const bank = (await json(await make({ 'allowed_payment_method_types[0]': 'us_bank_account' }))) as { id: string }
    expect(stripeHook(await stripe.pay(bank.id), 'checkout.session.completed-ach')).toEqual([])
    expect(stripeHook(await stripe.settleBank(bank.id, true), 'checkout.session.async_payment_succeeded')).toEqual([])
    const bounced = (await json(await make({ 'allowed_payment_method_types[0]': 'us_bank_account' }))) as { id: string }
    await stripe.pay(bounced.id)
    expect(stripeHook(await stripe.settleBank(bounced.id, false), 'checkout.session.async_payment_failed')).toEqual([])
    const late = (await json(await make())) as { id: string }
    expect(stripeHook(await stripe.expire(late.id), 'checkout.session.expired')).toEqual([])

    const customer = (await json(await stripe.fetch(`${S}/v1/customers`, post({ email: 'a@example.org' })))) as { id: string }
    const intent = async () =>
      ((await json(await stripe.fetch(`${S}/v1/payment_intents`, post({ amount: '2500', customer: customer.id, 'metadata[app]': 'a', 'metadata[checkoutId]': 'c2' })))) as { id: string }).id
    expect(stripeHook(await stripe.confirm(await intent(), 'ok'), 'payment_intent.succeeded', AUTOMATIC_METHODS_FIELDS)).toEqual([])
    expect(onSessionHook(await stripe.confirm(await intent(), 'decline'), 'payment_intent.payment_failed')).toEqual([])
    const ach = await intent()
    expect(onSessionHook(await stripe.confirm(ach, 'bank'), 'payment_intent.processing')).toEqual([])
    expect(onSessionHook(await stripe.settleBank(ach, false), 'payment_intent.payment_failed')).toEqual([])
    expect(onSessionHook(await stripe.intentEvent(ach), 'payment_intent.payment_failed')).toEqual([])
    expect(stripeHook(await stripe.detach(stripe.saveMethod(customer.id, 'ok')), 'payment_method.detached')).toEqual([])

    const pi = stripe.session(card.id).payment_intent as string
    const dashboard = await stripe.refundInDashboard(pi, 500)
    expect(stripeHook(dashboard.created, 'refund.created')).toEqual([])
    expect(stripeHook(dashboard.charge, 'charge.refunded')).toEqual([])
    expect(stripeHook(await stripe.refundBecomes(dashboard.refund.id, 'failed'), 'refund.failed')).toEqual([])
    expect(stripeHook(await stripe.refundBecomes(dashboard.refund.id, 'succeeded'), 'refund.updated')).toEqual([])
    expect(stripeHook(await stripe.dispute(pi, 'created'), 'charge.dispute.created')).toEqual([])
    expect(stripeHook(await stripe.dispute(pi, 'closed', 'lost'), 'charge.dispute.closed')).toEqual([])
  })
})

describe('fake PayPal answers in PayPal’s shapes', () => {
  const send = (pp: ReturnType<typeof fakePaypal>, path: string, body?: unknown, method = 'POST') => pp.fetch(`${B}${path}`, { method, body: body === undefined ? undefined : JSON.stringify(body) })
  const notFound = fixture(paypalObjectFixtures.errorResourceNotFound)

  test('tokens, webhook verification, webhooks', async () => {
    const pp = fakePaypal()
    expect(drift(await json(await pp.fetch(`${B}/v1/oauth2/token`, { method: 'POST', body: 'grant_type=client_credentials' })), fixture(paypalObjectFixtures.oauthToken))).toEqual([])
    expect(drift(await json(await send(pp, '/v1/notifications/verify-webhook-signature', { transmission_sig: 'x' })), fixture(paypalObjectFixtures.verifyFailure))).toEqual([])
    const hook = fixture(paypalObjectFixtures.webhooksList).webhooks[0]
    const made = (await json(await send(pp, '/v1/notifications/webhooks', { url: 'https://x.example.org/paypal/webhook', event_types: [{ name: 'PAYMENT.CAPTURE.COMPLETED' }] }))) as { id: string }
    expect(drift(made, hook)).toEqual([])
    expect(drift(await json(await send(pp, '/v1/notifications/webhooks', { url: 'https://x.example.org/paypal/webhook', event_types: [] })), notFound)).toEqual([])
    expect(drift(await json(await pp.fetch(`${B}/v1/notifications/webhooks`)), fixture(paypalObjectFixtures.webhooksList))).toEqual([])
    expect(drift(await json(await send(pp, `/v1/notifications/webhooks/${made.id}`, [{ op: 'replace', path: '/event_types', value: [{ name: 'CHECKOUT.ORDER.APPROVED' }] }], 'PATCH')), hook)).toEqual(
      [],
    )
    expect((await send(pp, `/v1/notifications/webhooks/${made.id}`, undefined, 'DELETE')).status).toBe(204)
    expect(drift(await json(await send(pp, '/v1/notifications/webhooks/NOPE', undefined, 'DELETE')), notFound)).toEqual([])
  })

  test('orders: made, read, captured, refused, and the capture and its refunds', async () => {
    const pp = fakePaypal()
    const order = (await json(await send(pp, '/v2/checkout/orders', { purchase_units: [{ custom_id: 'a:1', amount: { currency_code: 'USD', value: '25.00' } }] }))) as { id: string }
    expect(drift(order, fixture(paypalObjectFixtures.orderCreated))).toEqual([])
    expect(drift(await json(await send(pp, `/v2/checkout/orders/${order.id}/capture`)), fixture(paypalObjectFixtures.errorOrderNotApproved))).toEqual([])
    pp.approve(order.id)
    expect(drift(await json(await pp.fetch(`${B}/v2/checkout/orders/${order.id}`)), fixture(paypalObjectFixtures.orderApproved))).toEqual([])
    pp.declineNextCapture()
    expect(drift(await json(await send(pp, `/v2/checkout/orders/${order.id}/capture`)), notFound)).toEqual([])
    // No captured order could be saved from the sandbox (a capture needs a buyer to approve in a
    // browser), so the reference is the real order with a real capture in it: the order as the sandbox
    // showed it, and the capture as PayPal's PAYMENT.CAPTURE.COMPLETED webhook carries it.
    const real = fixture(paypalObjectFixtures.orderUnapproved)
    const capture = fixture(paypalEventFixtures['PAYMENT.CAPTURE.COMPLETED']).resource
    const captured = { ...real, purchase_units: [{ ...real.purchase_units[0], payments: { captures: [capture] } }] }
    const done = (await json(await send(pp, `/v2/checkout/orders/${order.id}/capture`))) as { purchase_units: { payments: { captures: { id: string }[] } }[] }
    expect(drift(done, captured)).toEqual([])
    expect(drift(await json(await send(pp, `/v2/checkout/orders/${order.id}/capture`)), fixture(paypalObjectFixtures.errorOrderAlreadyCaptured))).toEqual([])
    expect(drift(await json(await pp.fetch(`${B}/v2/checkout/orders/NOPE`)), notFound)).toEqual([])
    const captureId = done.purchase_units[0].payments.captures[0].id
    expect(drift(await json(await pp.fetch(`${B}/v2/payments/captures/${captureId}`)), capture)).toEqual([])
    expect(drift(await json(await pp.fetch(`${B}/v2/payments/captures/NOPE`)), notFound)).toEqual([])
    // The refunded webhook's resource is a refund; a refund made with a custom_id also shows it (PayPal's refund object documents custom_id).
    const refundShape = { ...fixture(paypalEventFixtures['PAYMENT.CAPTURE.REFUNDED']).resource, custom_id: 'a:r1' }
    const refund = (await json(await send(pp, `/v2/payments/captures/${captureId}/refund`, { amount: { currency_code: 'USD', value: '5.00' }, custom_id: 'a:r1' }))) as { id: string }
    expect(drift(refund, refundShape)).toEqual([])
    expect(drift(await json(await send(pp, `/v2/payments/captures/${captureId}/refund`, { amount: { currency_code: 'USD', value: '50.00' } })), notFound)).toEqual([])
    expect(drift(await json(await pp.fetch(`${B}/v2/payments/refunds/${refund.id}`)), refundShape)).toEqual([])
    expect(drift(await json(await pp.fetch(`${B}/v2/payments/refunds/NOPE`)), notFound)).toEqual([])
  })

  test('a request id replays its first answer with its first status', async () => {
    const pp = fakePaypal()
    const make = () => pp.fetch(`${B}/v3/vault/setup-tokens`, { method: 'POST', headers: { 'PayPal-Request-Id': 'r1' }, body: JSON.stringify({ payment_source: { card: {} } }) })
    const first = await make()
    const again = await make()
    expect(again.status).toBe(first.status)
    expect(await json(again)).toEqual(await json(first))
  })

  test('the vault: setup tokens, a saved card, charges on it, refusals', async () => {
    const pp = fakePaypal()
    const card = (await json(await send(pp, '/v3/vault/setup-tokens', { customer: { merchant_customer_id: 'a.user.1' }, payment_source: { card: {} } }))) as { id: string }
    expect(drift(card, fixture(paypalObjectFixtures.vaultSetupTokenCard))).toEqual([])
    expect(drift(await json(await send(pp, '/v3/vault/payment-tokens', { payment_source: { token: { id: card.id, type: 'SETUP_TOKEN' } } })), notFound)).toEqual([])
    pp.approveSetup(card.id)
    expect(drift(await json(await pp.fetch(`${B}/v3/vault/setup-tokens/${card.id}`)), fixture(paypalObjectFixtures.vaultSetupTokenCard))).toEqual([])
    expect(drift(await json(await pp.fetch(`${B}/v3/vault/setup-tokens/NOPE`)), notFound)).toEqual([])
    const saved = (await json(await send(pp, '/v3/vault/payment-tokens', { payment_source: { token: { id: card.id, type: 'SETUP_TOKEN' } } }))) as { id: string }
    expect(drift(saved, fixture(paypalObjectFixtures.vaultPaymentTokenCard))).toEqual([])
    expect(drift(await json(await send(pp, '/v3/vault/payment-tokens', { payment_source: { token: { id: 'NOPE', type: 'SETUP_TOKEN' } } })), notFound)).toEqual([])
    const charge = (vaultId: string, invoice?: string) =>
      send(pp, '/v2/checkout/orders', {
        purchase_units: [{ custom_id: 'a:1', invoice_id: invoice, amount: { currency_code: 'USD', value: '30.00' } }],
        payment_source: { card: { vault_id: vaultId } },
      })
    const order = (await json(await charge(saved.id, 'inv-1'))) as { id: string }
    expect(drift(order, fixture(paypalObjectFixtures.vaultOrderCaptured))).toEqual([])
    expect(drift(await json(await pp.fetch(`${B}/v2/checkout/orders/${order.id}`)), fixture(paypalObjectFixtures.vaultOrderCaptured))).toEqual([])
    expect(drift(await json(await charge(saved.id, 'inv-1')), notFound)).toEqual([])
    for (const behaviour of ['decline', 'error'] as const) {
      pp.setVaultBehaviour(saved.id, behaviour)
      expect(drift(await json(await charge(saved.id)), notFound)).toEqual([])
    }
    expect((await send(pp, `/v3/vault/payment-tokens/${saved.id}`, undefined, 'DELETE')).status).toBe(204)
    expect(drift(await json(await charge(saved.id)), notFound)).toEqual([])
    const account = await json(await send(pp, '/v3/vault/setup-tokens', { payment_source: { paypal: {} } }))
    expect(drift(account, fixture(paypalObjectFixtures.vaultSetupTokenPaypal))).toEqual([])
    const bad = (await json(await send(pp, '/v3/vault/setup-tokens', { payment_source: { card: {} } }))) as { id: string }
    pp.approveSetup(bad.id, { behaviour: 'unverified' })
    const refused = await send(pp, '/v3/vault/payment-tokens', { payment_source: { token: { id: bad.id, type: 'SETUP_TOKEN' } } })
    expect(refused.status).toBe(422)
    expect(drift(await json(refused), fixture(paypalObjectFixtures.errorInvalidPaymentSource))).toEqual([])
  })

  test('vault with purchase: a card order captured and saved, then charged as a recurring payment', async () => {
    const pp = fakePaypal()
    const order = (await json(
      await send(pp, '/v2/checkout/orders', {
        purchase_units: [{ custom_id: 'a:1', amount: { currency_code: 'USD', value: '25.00' } }],
        payment_source: { card: { attributes: { vault: { store_in_vault: 'ON_SUCCESS' } } } },
      }),
    )) as { id: string }
    expect(drift(order, fixture(paypalObjectFixtures.orderCreated))).toEqual([])
    pp.approve(order.id)
    const captured = (await json(await send(pp, `/v2/checkout/orders/${order.id}/capture`))) as { payment_source: { card: { attributes: { vault: { id: string } } } } }
    expect(drift(captured, fixture(paypalObjectFixtures.orderVaultCardCaptured))).toEqual([])
    const recurring = await json(
      await send(pp, '/v2/checkout/orders', {
        purchase_units: [{ custom_id: 'a:2', amount: { currency_code: 'USD', value: '25.00' } }],
        payment_source: { card: { vault_id: captured.payment_source.card.attributes.vault.id, stored_credential: { payment_initiator: 'MERCHANT', payment_type: 'RECURRING', usage: 'SUBSEQUENT' } } },
      }),
    )
    expect(drift(recurring, fixture(paypalObjectFixtures.vaultOrderRecurring))).toEqual([])
  })

  test('Transaction Search: rows, and the refusal when it isn’t enabled', async () => {
    const pp = fakePaypal()
    const range = `start_date=${new Date(Date.now() - 86_400_000).toISOString()}&end_date=${new Date(Date.now() + 86_400_000).toISOString()}`
    expect(drift(await json(await pp.fetch(`${B}/v1/reporting/transactions?${range}`)), fixture(paypalObjectFixtures.transactionSearchNotAuthorized))).toEqual([])
    pp.enableSearch()
    pp.capturedElsewhere('a', 'c1', 2500)
    pp.addActivity({ at: Date.now(), email: 'a@example.org', name: 'Ana', cents: -500, feeCents: 25, subject: 'Refund', items: ['Tea'] })
    const found = (await json(await pp.fetch(`${B}/v1/reporting/transactions?${range}`))) as { transaction_details: unknown[] }
    expect(found.transaction_details).toHaveLength(2)
    expect(drift(found, fixture(paypalObjectFixtures.transactionSearch))).toEqual([])
    expect(drift(await json(await pp.fetch(`${B}/v1/reporting/transactions?start_date=2026-01-01T00:00:00Z&end_date=2026-03-01T00:00:00Z`)), notFound)).toEqual([])
  })

  test('every webhook it makes is shaped like the real event', async () => {
    const pp = fakePaypal()
    const order = (await json(await send(pp, '/v2/checkout/orders', { purchase_units: [{ custom_id: 'a:1', amount: { currency_code: 'USD', value: '25.00' } }] }))) as { id: string }
    expect(paypalHook(pp.approve(order.id), 'CHECKOUT.ORDER.APPROVED')).toEqual([])
    const done = (await json(await send(pp, `/v2/checkout/orders/${order.id}/capture`))) as { purchase_units: { payments: { captures: { id: string }[] } }[] }
    for (const name of ['PAYMENT.CAPTURE.COMPLETED', 'PAYMENT.CAPTURE.PENDING', 'PAYMENT.CAPTURE.DECLINED'] as const) expect(paypalHook(pp.captureEvent(order.id, name), name)).toEqual([])
    const captureId = done.purchase_units[0].payments.captures[0].id
    for (const name of ['PAYMENT.CAPTURE.REFUNDED', 'PAYMENT.CAPTURE.REVERSED'] as const) expect(paypalHook(pp.refundInDashboard(captureId, 500, name).hook, name)).toEqual([])
    expect(paypalHook(pp.dispute(captureId, 'CREATED'), 'CUSTOMER.DISPUTE.CREATED')).toEqual([])
    expect(paypalHook(pp.dispute(captureId, 'RESOLVED'), 'CUSTOMER.DISPUTE.RESOLVED')).toEqual([])
    expect(paypalHook(pp.deleteToken('fakepaytoken1'), 'VAULT.PAYMENT-TOKEN.DELETED')).toEqual([])
  })
})

describe('the check itself', () => {
  test('finds an invented field, a changed type, null for a value, and a bad element anywhere in a list', () => {
    expect(drift({ id: 'x', invented: 1, amount: '25' }, { id: 'y', amount: 25 })).toEqual(['.invented: not in the processor’s object', '.amount: string where the processor sends number'])
    expect(drift({ charge: null }, { charge: { id: 'ch_1' } })).toEqual(['.charge: null where the processor sends object'])
    expect(drift({ charge: null }, { charge: { id: 'ch_1' } }, { nullable: ['.charge'] })).toEqual([])
    expect(drift({ data: [{ id: 'a' }, { id: 'b', extra: 1 }] }, { data: [{ id: 'z' }] })).toEqual(['.data[1].extra: not in the processor’s object'])
    expect(drift({ data: [{ card: {} }, { bank: {} }] }, { data: [{ bank: {} }, { card: {} }] })).toEqual([])
  })
})
