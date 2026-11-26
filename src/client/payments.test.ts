// The client against fake processors: starting checkouts, both webhook routes, the return page,
// refunds, sweep and the nightly comparison, through the host app in src/testing/app.ts.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { app, defined } from '../testing/app.js'
import { fakePaypal, type FakePaypal } from '../testing/fakePaypal.js'
import { fakeStripe, type FakeStripe } from '../testing/fakeStripe.js'
import { stripeEvent } from '../testing/fixtures.js'
import { checkoutReturnToken } from '../react/useCheckoutReturn.js'
import { withParam } from './util.js'

const { api, internal, createTest } = defined
const MIN = 60_000

let stripe: FakeStripe
let pp: FakePaypal

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2030-01-01T12:00:00Z'))
  pp = fakePaypal()
  stripe = fakeStripe({ fallback: pp.fetch })
  vi.stubGlobal('fetch', stripe.fetch)
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'info').mockImplementation(() => {})
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

function setup() {
  const t = createTest()
  const pay = app.components.payments
  const status = async (id: string) => (await t.query(api.shop.status, { id }))!
  const calls = (name?: string) => t.query(api.host.calls, {}).then((cs) => cs.filter((c) => !name || c.name === name))
  const post = async (path: string, init: RequestInit) => {
    const res = await t.fetch(path, init)
    return { status: res.status, text: await res.text() }
  }
  const buy = (a: { processor: 'stripe' | 'paypal'; method: 'card' | 'ach' | 'paypal'; amountCents?: number; email?: string; context?: unknown; expiresAt?: number }) => t.action(api.shop.buy, a)
  const issues = () => t.query(api.shop.issues, {})
  const later = (ms: number) => vi.setSystemTime(Date.now() + ms)
  const stripeCheckout = async (o: { method?: 'card' | 'ach'; amountCents?: number; context?: unknown } = {}) => {
    const { checkoutId } = await buy({ processor: 'stripe', method: o.method ?? 'card', amountCents: o.amountCents, context: o.context })
    const c = await status(checkoutId)
    return { checkoutId, sessionId: c.processorCheckoutId! }
  }
  const paypalCheckout = async (o: { amountCents?: number; context?: unknown } = {}) => {
    const { checkoutId } = await buy({ processor: 'paypal', method: 'card', amountCents: o.amountCents, context: o.context })
    return { checkoutId, orderId: (await status(checkoutId)).processorCheckoutId! }
  }
  return { t, pay, status, calls, post, buy, issues, later, stripeCheckout, paypalCheckout }
}

describe('Stripe checkouts', () => {
  test('start makes a tagged Checkout Session and sends the buyer there', async () => {
    const { buy, status } = setup()
    const { checkoutId, redirectUrl } = await buy({ processor: 'stripe', method: 'card' })
    const c = await status(checkoutId)
    expect(c).toMatchObject({
      status: 'pending',
      app: 'test',
      processor: 'stripe',
      amountCents: 2500,
      returnUrl: 'https://app.example.org/checkout/o1/return',
      cancelUrl: 'https://app.example.org/checkout/o1',
    })
    expect(redirectUrl).toBe(`https://checkout.stripe.com/c/pay/${c.processorCheckoutId}`)
    const call = stripe.calls.find((x) => x.path === '/v1/checkout/sessions')!
    expect(Object.fromEntries(call.params)).toMatchObject({
      'allowed_payment_method_types[0]': 'card',
      client_reference_id: checkoutId,
      'metadata[app]': 'test',
      'payment_intent_data[metadata][checkoutId]': checkoutId,
      success_url: 'https://app.example.org/checkout/o1/return?session_id={CHECKOUT_SESSION_ID}',
      customer_email: 'ana@example.org',
    })
    expect(Number(call.params.get('expires_at'))).toBe(Date.now() / 1000 + 3 * 60 * 60)
  })

  test('the paid webhook records the sale through onPaid, with Stripe’s fee; a duplicate delivery is answered at once', async () => {
    const { t, post, status, calls, stripeCheckout } = setup()
    const { checkoutId, sessionId } = await stripeCheckout()
    const hook = await stripe.pay(sessionId, { eventId: 'evt_dup' })
    expect(await post('/stripe/webhook', hook)).toEqual({ status: 200, text: 'handled' })
    expect(await status(checkoutId)).toMatchObject({ status: 'paid', paidCents: 2500, processorFeeCents: 103, paymentRef: expect.stringMatching(/^pi_/) })
    expect(await post('/stripe/webhook', hook)).toEqual({ status: 200, text: 'Already handled' })
    expect(await calls('onPaid')).toHaveLength(1)
    expect(await t.query(api.host.orders, {})).toHaveLength(1)
  })

  test('a bad or stale signature is refused with 400', async () => {
    const { post, stripeCheckout, status } = setup()
    const { checkoutId, sessionId } = await stripeCheckout()
    const hook = await stripe.pay(sessionId)
    expect((await post('/stripe/webhook', { ...hook, headers: { 'stripe-signature': 't=1,v1=00' } })).status).toBe(400)
    const stale = await stripe.webhook(JSON.parse(hook.body as string), { at: Date.now() - 10 * MIN })
    expect((await post('/stripe/webhook', stale)).status).toBe(400)
    expect((await status(checkoutId)).status).toBe('pending')
  })

  test('fix c: a session not tagged for this app, or one it doesn’t know, is answered 200 and passed on, never retried', async () => {
    const { post, calls } = setup()
    expect(await post('/stripe/webhook', await stripe.event('checkout.session.completed-foreign'))).toEqual({ status: 200, text: 'foreign' })
    const unknown = await stripe.event('checkout.session.completed', { metadata: { app: 'test', checkoutId: 'gone' }, client_reference_id: 'gone' })
    expect(await post('/stripe/webhook', unknown)).toEqual({ status: 200, text: 'foreign' })
    expect((await calls('unhandledStripe')).map((c) => c.args.type)).toEqual(['checkout.session.completed', 'checkout.session.completed'])
  })

  test('events for objects that aren’t this app’s (an untagged PaymentIntent), or of kinds the library doesn’t know, go to the host’s handler', async () => {
    const { post, calls } = setup()
    expect(await post('/stripe/webhook', await stripe.event('payment_intent.succeeded', { metadata: { bidId: 'b1' } }))).toEqual({ status: 200, text: 'foreign' })
    const other = stripeEvent('payment_intent.succeeded', { metadata: { app: 'test' } })
    other.type = 'customer.created'
    expect(await post('/stripe/webhook', await stripe.webhook(other))).toEqual({ status: 200, text: 'ignored' })
    expect((await calls('unhandledStripe')).map((c) => c.args.type)).toEqual(['payment_intent.succeeded', 'customer.created'])
  })

  test('bank transfer: accepted (processing), then paid; or bounced (failed, onFailed)', async () => {
    const { post, status, calls, stripeCheckout } = setup()
    const a = await stripeCheckout({ method: 'ach' })
    await post('/stripe/webhook', await stripe.pay(a.sessionId))
    expect((await status(a.checkoutId)).status).toBe('processing')
    await post('/stripe/webhook', await stripe.settleBank(a.sessionId, true))
    expect((await status(a.checkoutId)).status).toBe('paid')
    const b = await stripeCheckout({ method: 'ach' })
    await post('/stripe/webhook', await stripe.pay(b.sessionId))
    await post('/stripe/webhook', await stripe.settleBank(b.sessionId, false))
    expect(await status(b.checkoutId)).toMatchObject({ status: 'failed', lastError: 'The bank payment failed.' })
    expect((await calls('onFailed'))[0].args).toMatchObject({ checkoutId: b.checkoutId })
  })

  test('an expired session abandons the checkout', async () => {
    const { post, status, stripeCheckout } = setup()
    const { checkoutId, sessionId } = await stripeCheckout()
    await post('/stripe/webhook', await stripe.expire(sessionId))
    expect((await status(checkoutId)).status).toBe('abandoned')
  })

  test('the return page settles a paid session before the webhook comes, and again harmlessly', async () => {
    const { t, status, stripeCheckout, post, calls } = setup()
    const { checkoutId, sessionId } = await stripeCheckout()
    const hook = await stripe.pay(sessionId)
    expect(await t.action(api.shop.back, { processor: 'stripe', token: sessionId })).toEqual({ checkoutId, status: 'paid' })
    expect(await t.action(api.shop.back, { processor: 'stripe', token: sessionId })).toEqual({ checkoutId, status: 'paid' })
    expect(await post('/stripe/webhook', hook)).toEqual({ status: 200, text: 'handled' })
    expect(await calls('onPaid')).toHaveLength(1)
    expect((await status(checkoutId)).status).toBe('paid')
    expect(await t.action(api.shop.back, { processor: 'stripe', token: 'cs_unknown' })).toBeNull()
  })

  test('a thrown error after the signature check answers 500, and the retry is acted on', async () => {
    const { post, status, stripeCheckout, t } = setup()
    const { checkoutId, sessionId } = await stripeCheckout()
    await post('/stripe/webhook', await stripe.pay(sessionId))
    const pi = (await status(checkoutId)).paymentRef!
    const { charge } = await stripe.refundInDashboard(pi, 500)
    stripe.refuse((c) => (c.path === '/v1/refunds' ? Response.json({ error: { message: 'down' } }, { status: 500 }) : undefined))
    expect((await post('/stripe/webhook', charge)).status).toBe(500)
    stripe.refuse()
    expect(await post('/stripe/webhook', charge)).toEqual({ status: 200, text: 'handled' })
    expect((await status(checkoutId)).refundedCents).toBe(500)
    expect(await t.query(api.shop.refundsFor, { checkoutId })).toMatchObject([{ origin: 'external', amountCents: 500, status: 'sent' }])
  })

  test('a processor failure at start closes the row and tells the buyer plainly', async () => {
    const { buy, t } = setup()
    stripe.refuse(() => Response.json({ error: { message: 'Invalid API key' } }, { status: 401 }))
    await expect(buy({ processor: 'stripe', method: 'card' })).rejects.toThrow(/Stripe couldn’t start the payment/)
    const rows = await t.run(async (ctx) => await ctx.runQuery(app.components.payments.checkouts.list, { paginationOpts: { numItems: 10, cursor: null } }))
    expect(rows.page).toMatchObject([{ status: 'failed', lastError: 'Invalid API key' }])
  })

  test('refused combinations and the rate limit', async () => {
    const { buy } = setup()
    await expect(buy({ processor: 'stripe', method: 'paypal' })).rejects.toThrow(/doesn’t take paypal/)
    await expect(buy({ processor: 'paypal', method: 'ach' })).rejects.toThrow(/doesn’t take ach/)
    for (let i = 0; i < 3; i++) await buy({ processor: 'stripe', method: 'card', email: 'eve@example.org' })
    await expect(buy({ processor: 'stripe', method: 'card', email: 'eve@example.org' })).rejects.toThrow(/Too many tries/)
  })
})

describe('Stripe refunds and disputes', () => {
  test('partial refunds up to the remaining amount; the refund webhook doesn’t count it twice; approval unless skipped', async () => {
    const { t, post, status, calls, stripeCheckout } = setup()
    const { checkoutId, sessionId } = await stripeCheckout()
    await post('/stripe/webhook', await stripe.pay(sessionId))
    const r1 = await t.mutation(api.shop.requestRefund, { checkoutId, amountCents: 1000, reason: 'Chipped' })
    await expect(t.action(api.shop.sendRefund, { refundId: r1 })).rejects.toThrow(/needs approving/)
    await t.mutation(api.shop.approveRefund, { refundId: r1 })
    expect(await t.action(api.shop.sendRefund, { refundId: r1 })).toBe('sent')
    const sent = stripe.refunds()[0]
    expect(sent).toMatchObject({ amount: 1000, metadata: { app: 'test', refundId: r1 } })
    expect(stripe.calls.find((c) => c.method === 'POST' && c.path === '/v1/refunds')).toBeTruthy()
    expect(await post('/stripe/webhook', await stripe.event('refund.created', { ...sent }))).toEqual({ status: 200, text: 'handled' })
    expect((await status(checkoutId)).refundedCents).toBe(1000)
    await expect(t.mutation(api.shop.requestRefund, { checkoutId, amountCents: 1501, reason: 'x' })).rejects.toThrow(/Only \$15.00 is left/)
    const r2 = await t.mutation(api.shop.requestRefund, { checkoutId, reason: 'The rest' })
    expect(await t.action(api.shop.sendRefund, { refundId: r2, skipApproval: true })).toBe('sent')
    expect(await t.action(api.shop.sendRefund, { refundId: r2, skipApproval: true })).toBe('sent')
    expect(stripe.refunds()).toHaveLength(2)
    expect((await status(checkoutId)).refundedCents).toBe(2500)
    expect((await calls('onRefunded')).map((c) => c.args.refundedCents)).toEqual([1000, 2500])
  })

  test('a refund made in the dashboard arrives by webhook and is recorded once, whichever event comes', async () => {
    const { t, post, status, stripeCheckout } = setup()
    const { checkoutId, sessionId } = await stripeCheckout()
    await post('/stripe/webhook', await stripe.pay(sessionId))
    const { created, charge } = await stripe.refundInDashboard((await status(checkoutId)).paymentRef!, 700)
    await post('/stripe/webhook', charge)
    await post('/stripe/webhook', created)
    expect((await status(checkoutId)).refundedCents).toBe(700)
    expect(await t.query(api.shop.refundsFor, { checkoutId })).toMatchObject([{ origin: 'external', amountCents: 700 }])
  })

  test('a refund that comes back pending is finished by sweep', async () => {
    const { t, post, status, later, stripeCheckout } = setup()
    const { checkoutId, sessionId } = await stripeCheckout()
    await post('/stripe/webhook', await stripe.pay(sessionId))
    stripe.refundsCome('pending')
    const r = await t.mutation(api.shop.requestRefund, { checkoutId, reason: 'x' })
    expect(await t.action(api.shop.sendRefund, { refundId: r, skipApproval: true })).toBe('sending')
    stripe.refunds()[0].status = 'succeeded'
    later(11 * MIN)
    await t.action(internal.paymentsWorker.sweep, {})
    expect((await status(checkoutId)).refundedCents).toBe(2500)
  })

  test('a refund Stripe refused is sent again as a new attempt with a new key, and only that one counts', async () => {
    const { t, post, status, stripeCheckout } = setup()
    const { checkoutId, sessionId } = await stripeCheckout()
    await post('/stripe/webhook', await stripe.pay(sessionId))
    stripe.refundsCome('failed')
    const r = await t.mutation(api.shop.requestRefund, { checkoutId, reason: 'x' })
    expect(await t.action(api.shop.sendRefund, { refundId: r, skipApproval: true })).toBe('failed')
    stripe.refundsCome('succeeded')
    expect(await t.action(api.shop.sendRefund, { refundId: r, skipApproval: true })).toBe('sent')
    expect(stripe.refunds().map((x) => x.status)).toEqual(['failed', 'succeeded'])
    const keys = stripe.calls.filter((c) => c.method === 'POST' && c.path === '/v1/refunds').length
    expect(keys).toBe(2)
    expect((await status(checkoutId)).refundedCents).toBe(2500)
  })

  test('a refund whose send got no answer stays sending; sweep sends it again under the same key, so it is made once', async () => {
    const { t, post, status, later, stripeCheckout } = setup()
    const { checkoutId, sessionId } = await stripeCheckout()
    await post('/stripe/webhook', await stripe.pay(sessionId))
    const r = await t.mutation(api.shop.requestRefund, { checkoutId, reason: 'x' })
    // Stripe makes the refund, but the answer is lost on the way back.
    stripe.refuse((c) => (c.method === 'POST' && c.path === '/v1/refunds' ? Response.json({ error: { message: 'Gateway timeout' } }, { status: 504 }) : undefined))
    expect(await t.action(api.shop.sendRefund, { refundId: r, skipApproval: true })).toBe('sending')
    stripe.refuse()
    later(11 * MIN)
    await t.action(internal.paymentsWorker.sweep, {})
    expect((await t.query(api.shop.refundsFor, { checkoutId }))[0]).toMatchObject({ status: 'sent' })
    expect(stripe.refunds()).toHaveLength(1)
    expect((await status(checkoutId)).refundedCents).toBe(2500)
  })

  test('a dispute is recorded, the host told, and closed', async () => {
    const { post, status, issues, calls, stripeCheckout } = setup()
    const { checkoutId, sessionId } = await stripeCheckout()
    await post('/stripe/webhook', await stripe.pay(sessionId))
    const pi = (await status(checkoutId)).paymentRef!
    await post('/stripe/webhook', await stripe.dispute(pi, 'created'))
    expect((await status(checkoutId)).disputed).toBe(true)
    expect((await issues()).map((i) => i.kind)).toEqual(['dispute'])
    await post('/stripe/webhook', await stripe.dispute(pi, 'closed', 'won'))
    expect((await calls('onDispute')).map((c) => [c.args.status, c.args.outcome])).toEqual([
      ['opened', null],
      ['closed', 'won'],
    ])
  })
})

describe('PayPal checkouts', () => {
  test('start makes an order with experience_context, tagged <app>:<id>, and sends the buyer to the payer-action link', async () => {
    const { buy, status } = setup()
    const { checkoutId, redirectUrl } = await buy({ processor: 'paypal', method: 'card', amountCents: 2529 })
    const c = await status(checkoutId)
    expect(redirectUrl).toBe(`https://www.sandbox.paypal.com/checkoutnow?token=${c.processorCheckoutId}`)
    const created = pp.calls.find((x) => x.path === '/v2/checkout/orders')!.body as Record<string, unknown>
    expect(created).toMatchObject({
      intent: 'CAPTURE',
      purchase_units: [{ custom_id: `test:${checkoutId}`, amount: { currency_code: 'USD', value: '25.29' } }],
      payment_source: { paypal: { experience_context: { return_url: 'https://app.example.org/checkout/o1/return', cancel_url: 'https://app.example.org/checkout/o1', brand_name: 'Test shop' } } },
    })
  })

  test('fix a: the buyer approves and closes the tab; the approval webhook captures and records the sale', async () => {
    const { post, status, calls, paypalCheckout } = setup()
    const { checkoutId, orderId } = await paypalCheckout()
    expect(await post('/paypal/webhook', pp.approve(orderId))).toEqual({ status: 200, text: 'handled' })
    expect(await status(checkoutId)).toMatchObject({ status: 'paid', paidCents: 2500, processorFeeCents: 103, paymentRef: expect.stringMatching(/^FAKECAP/) })
    expect(await calls('onPaid')).toHaveLength(1)
    expect(await post('/paypal/webhook', pp.captureEvent(orderId))).toEqual({ status: 200, text: 'handled' })
    expect(await calls('onPaid')).toHaveLength(1)
  })

  test('fix a, second half: no webhook at all; sweep captures an approved order after five minutes', async () => {
    const { t, status, later, paypalCheckout } = setup()
    const { checkoutId, orderId } = await paypalCheckout()
    pp.approve(orderId)
    await t.action(internal.paymentsWorker.sweep, {})
    expect((await status(checkoutId)).status).toBe('pending')
    later(6 * MIN)
    await t.action(internal.paymentsWorker.sweep, {})
    expect((await status(checkoutId)).status).toBe('paid')
  })

  test('fix b: reloading the return page, or a capture that already happened, settles instead of failing', async () => {
    const { t, post, status, calls, paypalCheckout } = setup()
    const a = await paypalCheckout()
    pp.approve(a.orderId)
    expect(await t.action(api.shop.back, { processor: 'paypal', token: a.orderId })).toEqual({ checkoutId: a.checkoutId, status: 'paid' })
    expect(await t.action(api.shop.back, { processor: 'paypal', token: a.orderId })).toEqual({ checkoutId: a.checkoutId, status: 'paid' })
    // Captured at PayPal (by an earlier attempt that died before recording it); the late approval webhook gets ORDER_ALREADY_CAPTURED.
    const b = await paypalCheckout()
    const stale = pp.approve(b.orderId)
    await pp.fetch(`https://api-m.sandbox.paypal.com/v2/checkout/orders/${b.orderId}/capture`, { method: 'POST' })
    expect(await post('/paypal/webhook', stale)).toEqual({ status: 200, text: 'handled' })
    expect((await status(b.checkoutId)).status).toBe('paid')
    expect(await calls('onPaid')).toHaveLength(2)
  })

  test('fix c: a capture tagged for another app, or with no tag for an order nobody knows, is answered 200', async () => {
    const { post } = setup()
    expect(await post('/paypal/webhook', pp.event('PAYMENT.CAPTURE.COMPLETED-foreign'))).toEqual({ status: 200, text: 'foreign' })
    expect(await post('/paypal/webhook', pp.event('PAYMENT.CAPTURE.COMPLETED', { custom_id: undefined }))).toEqual({ status: 200, text: 'foreign' })
    expect(await post('/paypal/webhook', pp.event('CUSTOMER.DISPUTE.CREATED'))).toEqual({ status: 200, text: 'foreign' })
  })

  test('a forged webhook is refused; a duplicate is answered at once', async () => {
    const { post, paypalCheckout } = setup()
    const { orderId } = await paypalCheckout()
    expect((await post('/paypal/webhook', pp.event('CHECKOUT.ORDER.APPROVED', {}, 'WH-X', { valid: false }))).status).toBe(400)
    const hook = pp.approve(orderId, { eventId: 'WH-ONCE' })
    expect((await post('/paypal/webhook', hook)).text).toBe('handled')
    expect((await post('/paypal/webhook', hook)).text).toBe('Already handled')
  })

  test('an order approved after its checkout was given up is not captured', async () => {
    const { post, status, later, t, paypalCheckout, calls } = setup()
    const { checkoutId, orderId } = await paypalCheckout()
    later(3 * 60 * MIN + MIN)
    await t.action(internal.paymentsWorker.sweep, {})
    expect((await status(checkoutId)).status).toBe('abandoned')
    expect(await post('/paypal/webhook', pp.approve(orderId))).toEqual({ status: 200, text: 'handled' })
    expect(await t.action(api.shop.back, { processor: 'paypal', token: orderId })).toEqual({ checkoutId, status: 'abandoned' })
    expect(pp.order(orderId).status).toBe('APPROVED')
    expect(await calls('onPaid')).toEqual([])
  })

  test('a PayPal token that stopped working is replaced once and the call retried', async () => {
    const { buy, t } = setup()
    await buy({ processor: 'paypal', method: 'card' })
    let refused = false
    pp.refuse((c) => {
      if (refused || c.path !== '/v2/checkout/orders') return undefined
      refused = true
      return Response.json({ error: 'invalid_token' }, { status: 401 })
    })
    await buy({ processor: 'paypal', method: 'card', email: 'ben@example.org' })
    expect(pp.tokens).toBe(2)
    expect(await t.query(api.shop.openRefunds, {})).toEqual([])
  })

  test('a declined capture fails the checkout and tells the host', async () => {
    const { post, status, calls, paypalCheckout } = setup()
    pp.capturesCome('DECLINED')
    const { checkoutId, orderId } = await paypalCheckout()
    await post('/paypal/webhook', pp.approve(orderId))
    expect((await status(checkoutId)).status).toBe('failed')
    expect(await calls('onFailed')).toHaveLength(1)
  })

  test('onPaid refusing (sold out mid-checkout): refund_needed, refund waiting, buyer told on the return page', async () => {
    const { t, post, status, calls, paypalCheckout } = setup()
    const { checkoutId, orderId } = await paypalCheckout({ context: { paid: { refuse: 'Sold out' } } })
    await post('/paypal/webhook', pp.approve(orderId))
    expect(await t.action(api.shop.back, { processor: 'paypal', token: orderId })).toEqual({ checkoutId, status: 'refund_needed' })
    expect(await t.query(api.shop.openRefunds, {})).toMatchObject([{ checkoutId, origin: 'needed', amountCents: 2500 }])
    expect((await calls('onRefundNeeded'))[0].args).toMatchObject({ reason: 'Sold out' })
    const [refund] = await t.query(api.shop.openRefunds, {})
    expect(await t.action(api.shop.sendRefund, { refundId: refund.id, skipApproval: true })).toBe('sent')
    expect(pp.refunds()[0]).toMatchObject({ custom_id: `test:${refund.id}`, amount: { value: '25.00' } })
    expect((await status(checkoutId)).refundedCents).toBe(2500)
  })

  test('refunds: partial through the app, one in the dashboard; each counted once', async () => {
    const { t, post, status, paypalCheckout } = setup()
    const { checkoutId, orderId } = await paypalCheckout()
    await post('/paypal/webhook', pp.approve(orderId))
    const r = await t.mutation(api.shop.requestRefund, { checkoutId, amountCents: 1000, reason: 'x' })
    await t.action(api.shop.sendRefund, { refundId: r, skipApproval: true })
    const mine = pp.refunds()[0]
    const { captureId: _c, ...resource } = mine
    await post('/paypal/webhook', pp.event('PAYMENT.CAPTURE.REFUNDED', { ...resource }))
    expect((await status(checkoutId)).refundedCents).toBe(1000)
    const { hook } = pp.refundInDashboard((await status(checkoutId)).paymentRef!, 500)
    await post('/paypal/webhook', hook)
    await post('/paypal/webhook', hook)
    expect((await status(checkoutId)).refundedCents).toBe(1500)
    expect((await t.query(api.shop.refundsFor, { checkoutId })).map((x) => x.origin).sort()).toEqual(['external', 'requested'])
  })

  test('a dispute through PayPal', async () => {
    const { post, status, issues, paypalCheckout } = setup()
    const { checkoutId, orderId } = await paypalCheckout()
    await post('/paypal/webhook', pp.approve(orderId))
    const capture = (await status(checkoutId)).paymentRef!
    expect((await post('/paypal/webhook', pp.dispute(capture, 'CREATED'))).text).toBe('handled')
    expect((await status(checkoutId)).disputed).toBe(true)
    expect((await issues()).find((i) => i.kind === 'dispute')?.detail).toMatch(/^The buyer disputed A bowl for \$10.00 \(MERCHANDISE_OR_SERVICE_NOT_RECEIVED\)\.$/)
  })

  test('the PayPal token is fetched once, cached encrypted, and reused', async () => {
    const { t, paypalCheckout } = setup()
    await paypalCheckout()
    await paypalCheckout()
    expect(pp.tokens).toBe(1)
    const saved = await t.run(async (ctx) => await ctx.runQuery(app.components.payments.settings.paypalToken, {}))
    expect(saved?.sealed).not.toContain('A21-fake')
  })
})

describe('embedded checkouts (shown on the app’s own page)', () => {
  test('Stripe: an embedded_page session with a return_url; the browser gets its client secret, and it settles like any other', async () => {
    const { t, post, status, calls } = setup()
    const started = await t.action(api.shop.buyEmbedded, { processor: 'stripe', method: 'card' })
    const c = await status(started.checkoutId)
    expect(started.embedded).toEqual({ processor: 'stripe', clientSecret: `${c.processorCheckoutId}_secret_fake` })
    expect(started).not.toHaveProperty('redirectUrl')
    const params = Object.fromEntries(stripe.calls.find((x) => x.path === '/v1/checkout/sessions')!.params)
    expect(params).toMatchObject({ ui_mode: 'embedded_page', return_url: 'https://app.example.org/checkout/o1/return?session_id={CHECKOUT_SESSION_ID}', client_reference_id: started.checkoutId })
    expect(params).not.toHaveProperty('success_url')
    expect(params).not.toHaveProperty('cancel_url')
    const hook = await stripe.pay(c.processorCheckoutId!)
    expect(await t.action(api.shop.back, { processor: 'stripe', token: c.processorCheckoutId! })).toEqual({ checkoutId: started.checkoutId, status: 'paid' })
    expect(await post('/stripe/webhook', hook)).toEqual({ status: 200, text: 'handled' })
    expect(await calls('onPaid')).toHaveLength(1)
  })

  test('PayPal: an order with no payment_source; the buttons get its id, the client id and where to go once paid', async () => {
    const { t, status } = setup()
    const started = await t.action(api.shop.buyEmbedded, { processor: 'paypal', method: 'card' })
    const created = pp.calls.find((x) => x.path === '/v2/checkout/orders')!.body as Record<string, unknown>
    expect(created).not.toHaveProperty('payment_source')
    expect(created).toMatchObject({ purchase_units: [{ custom_id: `test:${started.checkoutId}` }], application_context: { shipping_preference: 'NO_SHIPPING', brand_name: 'Test shop' } })
    const orderId = (await status(started.checkoutId)).processorCheckoutId!
    expect(started.embedded).toEqual({ processor: 'paypal', orderId, clientId: expect.any(String), returnUrl: `https://app.example.org/checkout/o1/return?token=${orderId}` })
  })

  test('PayPal: the buttons’ approval captures through completeReturn; a declined card leaves it open for another try, the webhook answering 200', async () => {
    const { t, post, status, calls } = setup()
    const started = await t.action(api.shop.buyEmbedded, { processor: 'paypal', method: 'card' })
    if (started.embedded.processor !== 'paypal') throw new Error('expected PayPal')
    const { orderId } = started.embedded
    const approved = pp.approve(orderId)
    pp.declineNextCapture()
    expect(await t.action(api.shop.back, { processor: 'paypal', token: orderId })).toEqual({ checkoutId: started.checkoutId, status: 'pending', declined: true })
    expect(await post('/paypal/webhook', approved)).toEqual({ status: 200, text: 'handled' })
    expect((await status(started.checkoutId)).status).toBe('pending')
    expect(await calls('onFailed')).toHaveLength(0)
    // The buyer chooses another card on the buttons and approves again.
    pp.approve(orderId)
    expect(await t.action(api.shop.back, { processor: 'paypal', token: orderId })).toEqual({ checkoutId: started.checkoutId, status: 'paid' })
    expect(await calls('onPaid')).toHaveLength(1)
  })

  test('cancel (Edit): the Stripe session is expired at Stripe, the checkout abandoned, and the buyer’s start given back once', async () => {
    const { t, status } = setup()
    const start = () => t.action(api.shop.buyEmbedded, { processor: 'stripe', method: 'card', email: 'eve@example.org' })
    const first = await start()
    await start()
    await start()
    await expect(start()).rejects.toThrow(/Too many tries/)

    expect(await t.action(api.payments.cancelCheckout, { checkoutId: first.checkoutId })).toEqual({ status: 'abandoned' })
    const c = await status(first.checkoutId)
    expect(c.status).toBe('abandoned')
    expect(stripe.calls.some((x) => x.path === `/v1/checkout/sessions/${c.processorCheckoutId}/expire`)).toBe(true)
    // Closing it again changes nothing and gives nothing more back.
    expect(await t.action(api.payments.cancelCheckout, { checkoutId: first.checkoutId })).toEqual({ status: 'abandoned' })
    await start()
    await expect(start()).rejects.toThrow(/Too many tries/)
  })

  test('cancel (Edit): a PayPal order is abandoned, and approving it afterwards captures nothing', async () => {
    const { t, status, calls } = setup()
    const started = await t.action(api.shop.buyEmbedded, { processor: 'paypal', method: 'card' })
    if (started.embedded.processor !== 'paypal') throw new Error('expected PayPal')
    expect(await t.action(api.payments.cancelCheckout, { checkoutId: started.checkoutId })).toEqual({ status: 'abandoned' })
    pp.approve(started.embedded.orderId)
    await t.action(api.shop.back, { processor: 'paypal', token: started.embedded.orderId })
    expect(pp.calls.filter((x) => x.path.endsWith('/capture'))).toHaveLength(0)
    expect((await status(started.checkoutId)).status).toBe('abandoned')
    expect(await calls('onPaid')).toHaveLength(0)
  })

  test('cancel: a Stripe checkout paid in the meantime is settled as paid, not abandoned; an id that isn’t a checkout is not ours', async () => {
    const { t, calls } = setup()
    const started = await t.action(api.shop.buyEmbedded, { processor: 'stripe', method: 'card' })
    const c = (await t.query(api.shop.status, { id: started.checkoutId }))!
    await stripe.pay(c.processorCheckoutId!)
    expect(await t.action(api.payments.cancelCheckout, { checkoutId: started.checkoutId })).toEqual({ status: 'paid' })
    expect(await calls('onPaid')).toHaveLength(1)
    expect(await t.action(api.payments.cancelCheckout, { checkoutId: 'nope' })).toBeNull()
  })

  test('PayPal: an approved order declined and left past its time is abandoned by sweep', async () => {
    const { t, status, later } = setup()
    const started = await t.action(api.shop.buyEmbedded, { processor: 'paypal', method: 'card', expiresAt: Date.now() + 30 * MIN })
    if (started.embedded.processor !== 'paypal') throw new Error('expected PayPal')
    pp.approve(started.embedded.orderId)
    later(10 * MIN)
    pp.declineNextCapture()
    await t.action(internal.paymentsWorker.sweep, {})
    expect((await status(started.checkoutId)).status).toBe('pending')
    later(30 * MIN)
    await t.action(internal.paymentsWorker.sweep, {})
    expect((await status(started.checkoutId)).status).toBe('abandoned')
  })

  test('PayPal: after a decline nothing but the buyer captures, so a card that would go through later is never charged behind their back', async () => {
    const { t, post, status, calls, later } = setup()
    const started = await t.action(api.shop.buyEmbedded, { processor: 'paypal', method: 'card', expiresAt: Date.now() + 60 * MIN })
    if (started.embedded.processor !== 'paypal') throw new Error('expected PayPal')
    const { orderId } = started.embedded
    const approved = pp.approve(orderId)
    pp.declineNextCapture()
    expect(await t.action(api.shop.back, { processor: 'paypal', token: orderId })).toMatchObject({ declined: true })
    // The buyer gives up (Edit, another way to pay). The card would now go through, but neither the webhook nor the sweep captures it.
    const captures = () => pp.calls.filter((x) => x.path.endsWith('/capture')).length
    const before = captures()
    expect(await post('/paypal/webhook', approved)).toEqual({ status: 200, text: 'handled' })
    later(10 * MIN)
    await t.action(internal.paymentsWorker.sweep, {})
    expect(captures()).toBe(before)
    expect((await status(started.checkoutId)).status).toBe('pending')
    later(60 * MIN)
    await t.action(internal.paymentsWorker.sweep, {})
    expect((await status(started.checkoutId)).status).toBe('abandoned')
    expect(captures()).toBe(before)
    expect(await calls('onPaid')).toHaveLength(0)
  })

  test('sweep: an expired approved order whose capture keeps failing (not a decline) is abandoned, not retried for ever', async () => {
    const { t, status, later, paypalCheckout } = setup()
    const { checkoutId, orderId } = await paypalCheckout()
    pp.approve(orderId)
    pp.refuse((call) =>
      call.path.endsWith('/capture') ? Response.json({ name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'MAX_NUMBER_OF_PAYMENT_ATTEMPTS_EXCEEDED' }] }, { status: 422 }) : undefined,
    )
    later(10 * MIN)
    await t.action(internal.paymentsWorker.sweep, {})
    expect((await status(checkoutId)).status).toBe('pending')
    later(3 * 60 * MIN)
    await t.action(internal.paymentsWorker.sweep, {})
    expect((await status(checkoutId)).status).toBe('abandoned')
  })
})

describe('on-page payments (made at the payer’s press on the app’s own form)', () => {
  const onPage = (
    t: ReturnType<typeof setup>['t'],
    a: { processor: 'stripe' | 'paypal'; method: 'card' | 'ach' | 'paypal'; amountCents?: number; replaces?: string; refId?: string; email?: string; expiresAt?: number },
  ) => t.action(api.shop.buyOnPage, a)
  const intentsMade = () => stripe.calls.filter((x) => x.method === 'POST' && x.path === '/v1/payment_intents')

  test('Stripe: a PaymentIntent for the chosen method, no session; the browser gets its client secret, and its webhook settles it', async () => {
    const { t, post, status, calls } = setup()
    const started = await onPage(t, { processor: 'stripe', method: 'card' })
    const c = await status(started.checkoutId)
    expect(c).toMatchObject({ status: 'pending', kind: 'onPage', processor: 'stripe', method: 'card', amountCents: 2500 })
    expect(started).toEqual({
      checkoutId: started.checkoutId,
      onPage: { processor: 'stripe', clientSecret: expect.stringMatching(new RegExp(`^${c.processorCheckoutId}_secret_`)), returnUrl: 'https://app.example.org/checkout/o1/return' },
      reused: false,
    })
    expect(stripe.calls.some((x) => x.path === '/v1/checkout/sessions')).toBe(false)
    const params = Object.fromEntries(intentsMade()[0].params)
    expect(params).toMatchObject({ amount: '2500', currency: 'usd', 'metadata[app]': 'test', 'metadata[checkoutId]': started.checkoutId, 'allowed_payment_method_types[0]': 'card' })
    expect(params).not.toHaveProperty('allowed_payment_method_types[1]')
    expect(params).not.toHaveProperty('customer')
    expect(params).not.toHaveProperty('setup_future_usage')
    expect(params).not.toHaveProperty('confirm')
    const hook = await stripe.confirm(c.processorCheckoutId!)
    expect(await t.action(api.shop.back, { processor: 'stripe', token: c.processorCheckoutId! })).toEqual({ checkoutId: started.checkoutId, status: 'paid' })
    expect(await post('/stripe/webhook', hook)).toEqual({ status: 200, text: 'handled' })
    expect(await calls('onPaid')).toHaveLength(1)
    expect(await status(started.checkoutId)).toMatchObject({ status: 'paid', paidCents: 2500, paymentRef: c.processorCheckoutId })
  })

  test('Stripe: the return page the Payment Element sends the payer to (?payment_intent=, after 3-D Secure) finds the on-page checkout and settles it before the webhook', async () => {
    const { t, status, calls } = setup()
    const started = await onPage(t, { processor: 'stripe', method: 'card' })
    if (started.onPage.processor !== 'stripe') throw new Error('expected Stripe')
    const pi = (await status(started.checkoutId)).processorCheckoutId!
    await stripe.confirm(pi, 'auth')
    const back = (redirectStatus: string) => {
      const url = new URL(withParam(withParam(withParam(started.onPage.returnUrl, 'payment_intent', pi), 'payment_intent_client_secret', `${pi}_secret_x`), 'redirect_status', redirectStatus))
      const token = checkoutReturnToken(url.search)
      if (!token) throw new Error('no return token')
      return t.action(api.shop.back, token)
    }
    expect(await back('failed')).toEqual({ checkoutId: started.checkoutId, status: 'pending' })
    await stripe.confirm(pi, 'ok')
    expect(await back('succeeded')).toEqual({ checkoutId: started.checkoutId, status: 'paid' })
    expect(await calls('onPaid')).toHaveLength(1)
  })

  test('Stripe bank account: only us_bank_account, verified at once; processing, then paid', async () => {
    const { t, post, status, calls } = setup()
    const started = await onPage(t, { processor: 'stripe', method: 'ach' })
    const params = Object.fromEntries(intentsMade()[0].params)
    expect(params).toMatchObject({ 'allowed_payment_method_types[0]': 'us_bank_account', 'payment_method_options[us_bank_account][verification_method]': 'instant' })
    const pi = (await status(started.checkoutId)).processorCheckoutId!
    expect(await post('/stripe/webhook', await stripe.confirm(pi, 'bank'))).toEqual({ status: 200, text: 'handled' })
    expect((await status(started.checkoutId)).status).toBe('processing')
    await post('/stripe/webhook', await stripe.settleBank(pi, true))
    expect((await status(started.checkoutId)).status).toBe('paid')
    expect(await calls('onPaid')).toHaveLength(1)
  })

  test('Stripe: a declined card leaves it open; the next press with the same amount and method gets the same PaymentIntent and counts no start', async () => {
    const { t, post, status, calls } = setup()
    const first = await onPage(t, { processor: 'stripe', method: 'card', email: 'eve@example.org' })
    const pi = (await status(first.checkoutId)).processorCheckoutId!
    expect(await post('/stripe/webhook', await stripe.confirm(pi, 'decline'))).toEqual({ status: 200, text: 'handled' })
    expect((await status(first.checkoutId)).status).toBe('pending')
    expect(await calls('onFailed')).toHaveLength(0)
    for (let i = 0; i < 4; i++) expect(await onPage(t, { processor: 'stripe', method: 'card', email: 'eve@example.org', replaces: first.checkoutId })).toEqual({ ...first, reused: true })
    expect(intentsMade()).toHaveLength(1)
    await post('/stripe/webhook', await stripe.confirm(pi, 'ok'))
    expect((await status(first.checkoutId)).status).toBe('paid')
    expect(await calls('onPaid')).toHaveLength(1)
    // The payer's own starts were never used up by the presses.
    await onPage(t, { processor: 'stripe', method: 'card', email: 'eve@example.org' })
    await onPage(t, { processor: 'stripe', method: 'card', email: 'eve@example.org' })
  })

  test('Stripe: a changed amount or method closes the last press’s payment (canceled at Stripe, its start given back) and starts afresh', async () => {
    const { t, status, calls } = setup()
    const first = await onPage(t, { processor: 'stripe', method: 'card', email: 'eve@example.org' })
    const firstPi = (await status(first.checkoutId)).processorCheckoutId!
    const second = await onPage(t, { processor: 'stripe', method: 'card', amountCents: 3000, email: 'eve@example.org', replaces: first.checkoutId })
    expect(second.reused).toBe(false)
    expect(second.checkoutId).not.toBe(first.checkoutId)
    expect(await status(first.checkoutId)).toMatchObject({ status: 'abandoned' })
    expect(stripe.calls.some((x) => x.path === `/v1/payment_intents/${firstPi}/cancel`)).toBe(true)
    expect(await status(second.checkoutId)).toMatchObject({ status: 'pending', amountCents: 3000 })
    const third = await onPage(t, { processor: 'stripe', method: 'ach', amountCents: 3000, email: 'eve@example.org', replaces: second.checkoutId })
    expect(third.reused).toBe(false)
    expect((await status(second.checkoutId)).status).toBe('abandoned')
    // Each closed press gave its start back: the payer still has their tries.
    await onPage(t, { processor: 'stripe', method: 'card', email: 'eve@example.org' })
    await onPage(t, { processor: 'stripe', method: 'card', email: 'eve@example.org' })
    expect(await calls('onPaid')).toHaveLength(0)
  })

  test('replaces: a paid or processing payment is never replaced; one for another thing is closed, not reused', async () => {
    const { t, status } = setup()
    const paid = await onPage(t, { processor: 'stripe', method: 'card', email: 'a@example.org' })
    await stripe.confirm((await status(paid.checkoutId)).processorCheckoutId!)
    await expect(onPage(t, { processor: 'stripe', method: 'card', email: 'a@example.org', replaces: paid.checkoutId })).rejects.toThrow('This is already paid.')
    await expect(onPage(t, { processor: 'stripe', method: 'card', email: 'a@example.org', amountCents: 999, replaces: paid.checkoutId })).rejects.toThrow('This is already paid.')
    expect((await status(paid.checkoutId)).status).toBe('paid')

    const bank = await onPage(t, { processor: 'stripe', method: 'ach', refId: 'o2', email: 'b@example.org' })
    await stripe.confirm((await status(bank.checkoutId)).processorCheckoutId!, 'bank')
    await expect(onPage(t, { processor: 'stripe', method: 'ach', refId: 'o2', email: 'b@example.org', replaces: bank.checkoutId })).rejects.toThrow('A payment for this is already on its way.')

    const other = await onPage(t, { processor: 'stripe', method: 'card', refId: 'o3', email: 'c@example.org' })
    const next = await onPage(t, { processor: 'stripe', method: 'card', refId: 'o4', email: 'c@example.org', replaces: other.checkoutId })
    expect(next.reused).toBe(false)
    expect((await status(other.checkoutId)).status).toBe('abandoned')
    expect(await onPage(t, { processor: 'stripe', method: 'card', refId: 'o5', email: 'd@example.org', replaces: 'not-a-checkout' })).toMatchObject({ reused: false })
  })

  test('cancel and sweep: an on-page PaymentIntent is canceled at Stripe and the checkout abandoned; one paid meanwhile settles as paid', async () => {
    const { t, status, calls, later } = setup()
    const left = await onPage(t, { processor: 'stripe', method: 'card', expiresAt: Date.now() + 30 * MIN })
    const leftPi = (await status(left.checkoutId)).processorCheckoutId!
    const closed = await onPage(t, { processor: 'stripe', method: 'card', refId: 'o2' })
    const closedPi = (await status(closed.checkoutId)).processorCheckoutId!
    expect(await t.action(api.payments.cancelCheckout, { checkoutId: closed.checkoutId })).toEqual({ status: 'abandoned' })
    expect(stripe.calls.some((x) => x.path === `/v1/payment_intents/${closedPi}/cancel`)).toBe(true)
    const paidMeanwhile = await onPage(t, { processor: 'stripe', method: 'card', refId: 'o3' })
    await stripe.confirm((await status(paidMeanwhile.checkoutId)).processorCheckoutId!)
    expect(await t.action(api.payments.cancelCheckout, { checkoutId: paidMeanwhile.checkoutId })).toEqual({ status: 'paid' })
    expect(await calls('onPaid')).toHaveLength(1)
    later(31 * MIN)
    await t.action(internal.paymentsWorker.sweep, {})
    expect((await status(left.checkoutId)).status).toBe('abandoned')
    expect(stripe.calls.some((x) => x.path === `/v1/payment_intents/${leftPi}/cancel`)).toBe(true)
  })

  test('PayPal: the same order as embedded, made at the press; the next press reuses it, and a decline is tried again on it', async () => {
    const { t, status, calls } = setup()
    const first = await onPage(t, { processor: 'paypal', method: 'card', email: 'eve@example.org' })
    const c = await status(first.checkoutId)
    expect(c).toMatchObject({ kind: 'onPage', processor: 'paypal', status: 'pending' })
    const orderId = c.processorCheckoutId!
    expect(first).toEqual({
      checkoutId: first.checkoutId,
      onPage: { processor: 'paypal', orderId, clientId: expect.any(String), returnUrl: `https://app.example.org/checkout/o1/return?token=${orderId}` },
      reused: false,
    })
    pp.approve(orderId)
    pp.declineNextCapture()
    expect(await t.action(api.shop.back, { processor: 'paypal', token: orderId })).toEqual({ checkoutId: first.checkoutId, status: 'pending', declined: true })
    for (let i = 0; i < 4; i++) expect(await onPage(t, { processor: 'paypal', method: 'card', email: 'eve@example.org', replaces: first.checkoutId })).toEqual({ ...first, reused: true })
    expect(pp.calls.filter((x) => x.path === '/v2/checkout/orders')).toHaveLength(1)
    pp.approve(orderId)
    expect(await t.action(api.shop.back, { processor: 'paypal', token: orderId })).toEqual({ checkoutId: first.checkoutId, status: 'paid' })
    expect(await calls('onPaid')).toHaveLength(1)
  })

  test('PayPal: when PayPal won’t take the same order again, a new order under the same checkout, no new start counted; the old order is never captured', async () => {
    const { t, post, status, calls } = setup()
    const first = await onPage(t, { processor: 'paypal', method: 'card', email: 'eve@example.org' })
    if (first.onPage.processor !== 'paypal') throw new Error('expected PayPal')
    const oldOrder = first.onPage.orderId
    const oldApproval = pp.approve(oldOrder)
    pp.refuse((call) =>
      call.path.endsWith('/capture') ? Response.json({ name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'MAX_NUMBER_OF_PAYMENT_ATTEMPTS_EXCEEDED' }] }, { status: 422 }) : undefined,
    )
    expect(await t.action(api.shop.back, { processor: 'paypal', token: oldOrder })).toEqual({ checkoutId: first.checkoutId, status: 'pending', declined: true })
    pp.refuse()
    const again = await onPage(t, { processor: 'paypal', method: 'card', email: 'eve@example.org', replaces: first.checkoutId })
    if (again.onPage.processor !== 'paypal') throw new Error('expected PayPal')
    expect(again).toMatchObject({ checkoutId: first.checkoutId, reused: true })
    const newOrder = again.onPage.orderId
    expect(newOrder).not.toBe(oldOrder)
    expect(again.onPage.returnUrl).toBe(`https://app.example.org/checkout/o1/return?token=${newOrder}`)
    expect((await status(first.checkoutId)).processorCheckoutId).toBe(newOrder)
    // The old order's approval, delivered late, captures nothing.
    expect(await post('/paypal/webhook', oldApproval)).toEqual({ status: 200, text: 'handled' })
    expect(pp.calls.filter((x) => x.path === `/v2/checkout/orders/${oldOrder}/capture`)).toHaveLength(1)
    pp.approve(newOrder)
    expect(await t.action(api.shop.back, { processor: 'paypal', token: newOrder })).toEqual({ checkoutId: first.checkoutId, status: 'paid' })
    expect(await calls('onPaid')).toHaveLength(1)
    // No start was counted for the new order: the payer still has two more.
    await onPage(t, { processor: 'paypal', method: 'card', email: 'eve@example.org' })
    await onPage(t, { processor: 'paypal', method: 'card', email: 'eve@example.org' })
  })

  test('PayPal: a changed amount closes the last order’s checkout and makes a new one', async () => {
    const { t, status } = setup()
    const first = await onPage(t, { processor: 'paypal', method: 'card' })
    const next = await onPage(t, { processor: 'paypal', method: 'card', amountCents: 4000, replaces: first.checkoutId })
    expect(next.reused).toBe(false)
    expect((await status(first.checkoutId)).status).toBe('abandoned')
    expect(await status(next.checkoutId)).toMatchObject({ status: 'pending', amountCents: 4000 })
  })
})

describe('sweep', () => {
  test('an expired open Stripe session is expired at Stripe and abandoned; an expired unapproved PayPal order is abandoned', async () => {
    const { t, status, later, stripeCheckout, paypalCheckout } = setup()
    const s = await stripeCheckout()
    const p = await paypalCheckout()
    later(3 * 60 * MIN + MIN)
    await t.action(internal.paymentsWorker.sweep, {})
    expect(stripe.session(s.sessionId).status).toBe('expired')
    expect((await status(s.checkoutId)).status).toBe('abandoned')
    expect((await status(p.checkoutId)).status).toBe('abandoned')
  })

  test('an expired Stripe session that was paid after all is settled, not abandoned', async () => {
    const { t, status, later, stripeCheckout } = setup()
    const { checkoutId, sessionId } = await stripeCheckout()
    await stripe.pay(sessionId)
    later(3 * 60 * MIN + MIN)
    await t.action(internal.paymentsWorker.sweep, {})
    expect((await status(checkoutId)).status).toBe('paid')
  })
})

describe('reconcile', () => {
  test('Stripe: clean when both sides agree; a lost webhook shows as status_differs until it arrives', async () => {
    const { t, post, issues, stripeCheckout } = setup()
    const a = await stripeCheckout()
    await post('/stripe/webhook', await stripe.pay(a.sessionId))
    const b = await stripeCheckout()
    const lost = await stripe.pay(b.sessionId)
    await t.action(internal.paymentsWorker.reconcile, {})
    expect((await issues()).map((i) => i.kind)).toEqual(['status_differs'])
    await post('/stripe/webhook', lost)
    await t.action(internal.paymentsWorker.reconcile, {})
    expect(await t.run(async (ctx) => await ctx.runQuery(app.components.payments.issues.openCount, {}))).toBe(0)
  })

  test('Stripe: missing here, missing there, and a refund the ledger missed is recorded', async () => {
    const { t, post, status, stripeCheckout } = setup()
    const a = await stripeCheckout()
    await post('/stripe/webhook', await stripe.pay(a.sessionId))
    await stripe.refundInDashboard((await status(a.checkoutId)).paymentRef!, 300)
    const b = await stripeCheckout()
    await post('/stripe/webhook', await stripe.pay(b.sessionId))
    stripe.forget(b.sessionId)
    stripe.paidElsewhere('test', 4000)
    stripe.paidElsewhere('other', 4000)
    expect(await t.action(internal.paymentsWorker.reconcile, {})).toBeNull()
    const open = await t.run(async (ctx) => await ctx.runQuery(app.components.payments.issues.list, { open: true, paginationOpts: { numItems: 20, cursor: null } }))
    expect(open.page.map((i) => i.kind).sort()).toEqual(['missing_here', 'missing_there'])
    expect((await status(a.checkoutId)).refundedCents).toBe(300)
  })

  test('PayPal: Transaction Search refused is skipped and asked again only a day later; once enabled, an unknown capture is missing_here', async () => {
    const { t, later, paypalCheckout, post } = setup()
    const a = await paypalCheckout()
    await post('/paypal/webhook', pp.approve(a.orderId))
    const reconcile = () => t.action(internal.paymentsWorker.reconcile, {})
    const searches = () => pp.calls.filter((c) => c.path === '/v1/reporting/transactions').length
    await reconcile()
    expect(searches()).toBe(1)
    expect(console.info).toHaveBeenCalledTimes(1)
    await reconcile()
    expect(searches()).toBe(1)
    pp.enableSearch()
    pp.capturedElsewhere('test', 'lost', 1200)
    pp.capturedElsewhere('other', 'x', 1200)
    later(25 * 60 * MIN)
    await reconcile()
    expect(searches()).toBe(2)
    const kinds = (await t.query(api.shop.issues, {})).map((i) => i.kind)
    expect(kinds).toEqual(['missing_here'])
  })

  test('PayPal with Transaction Search on: the order comparison’s issue stays open (the search only decides missing_here)', async () => {
    const { t, paypalCheckout } = setup()
    pp.enableSearch()
    const a = await paypalCheckout()
    pp.approve(a.orderId)
    await pp.fetch(`https://api-m.sandbox.paypal.com/v2/checkout/orders/${a.orderId}/capture`, { method: 'POST' })
    const capture = pp.order(a.orderId).purchase_units?.[0]?.payments?.captures?.[0]?.id ?? ''
    await t.run(async (ctx) => await ctx.runMutation(app.components.payments.checkouts.settlePaid, { id: a.checkoutId, paymentRef: capture, paidCents: 2400, now: Date.now() }))
    await t.action(internal.paymentsWorker.reconcile, {})
    await t.action(internal.paymentsWorker.reconcile, {})
    const open = await t.run(async (ctx) => await ctx.runQuery(app.components.payments.issues.list, { open: true, paginationOpts: { numItems: 20, cursor: null } }))
    expect(open.page.map((i) => i.kind)).toEqual(['amount_differs'])
  })

  test('PayPal: an order paid at PayPal but not here is status_differs', async () => {
    const { t, paypalCheckout } = setup()
    const a = await paypalCheckout()
    pp.approve(a.orderId)
    await pp.fetch(`https://api-m.sandbox.paypal.com/v2/checkout/orders/${a.orderId}/capture`, { method: 'POST' })
    await t.run(async (ctx) => await ctx.runMutation(app.components.payments.checkouts.settleFailed, { id: a.checkoutId, reason: 'test', now: Date.now() }))
    await t.action(internal.paymentsWorker.reconcile, {})
    expect((await t.query(api.shop.issues, {})).map((i) => i.detail)).toEqual(['PayPal says A bowl was paid; here it is failed.'])
  })
})

describe('a PayPal capture and the buyer’s cancel', () => {
  test('cancel while a capture is going through is refused, saying it is being paid', async () => {
    const { t } = setup()
    const started = await t.action(api.shop.buyEmbedded, { processor: 'paypal', method: 'card' })
    await t.run(async (ctx) => await ctx.runMutation(app.components.payments.checkouts.claimCapture, { id: started.checkoutId, now: Date.now() }))
    await expect(t.action(api.payments.cancelCheckout, { checkoutId: started.checkoutId })).rejects.toThrow(/being paid right now/)
  })

  test('a stale claim: cancel asks PayPal first, and an order captured there is settled, not abandoned', async () => {
    const { t, status, calls } = setup()
    const started = await t.action(api.shop.buyEmbedded, { processor: 'paypal', method: 'card' })
    if (started.embedded.processor !== 'paypal') throw new Error('expected PayPal')
    pp.approve(started.embedded.orderId)
    await pp.fetch(`https://api-m.sandbox.paypal.com/v2/checkout/orders/${started.embedded.orderId}/capture`, { method: 'POST' })
    await t.run(async (ctx) => await ctx.runMutation(app.components.payments.checkouts.claimCapture, { id: started.checkoutId, now: Date.now() - 10 * MIN }))
    expect(await t.action(api.payments.cancelCheckout, { checkoutId: started.checkoutId })).toEqual({ status: 'paid' })
    expect((await status(started.checkoutId)).status).toBe('paid')
    expect(await calls('onPaid')).toHaveLength(1)
  })
})

test('declined at capture: only the buyer captures it after that, even once its last error is overwritten', async () => {
  const { t, status, later } = setup()
  const started = await t.action(api.shop.buyEmbedded, { processor: 'paypal', method: 'card' })
  if (started.embedded.processor !== 'paypal') throw new Error('expected PayPal')
  pp.approve(started.embedded.orderId)
  pp.declineNextCapture()
  expect(await t.action(api.shop.back, { processor: 'paypal', token: started.embedded.orderId })).toMatchObject({ declined: true })
  await t.run(async (ctx) => await ctx.runMutation(app.components.payments.checkouts.noteError, { id: started.checkoutId, error: 'Something else went wrong.' }))
  later(10 * MIN)
  await t.action(internal.paymentsWorker.sweep, {})
  expect(pp.calls.filter((x) => x.path.endsWith('/capture'))).toHaveLength(1)
  expect((await status(started.checkoutId)).status).toBe('pending')
})

test('reconcile, PayPal: a refund the ledger missed (its webhook lost) is recorded from the order', async () => {
  const { t, post, status, paypalCheckout } = setup()
  const a = await paypalCheckout()
  await post('/paypal/webhook', pp.approve(a.orderId))
  pp.refundInDashboard((await status(a.checkoutId)).paymentRef!, 700)
  await t.action(internal.paymentsWorker.reconcile, {})
  expect((await status(a.checkoutId)).refundedCents).toBe(700)
  expect(await t.query(api.shop.issues, {})).toEqual([])
})
