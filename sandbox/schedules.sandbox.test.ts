// Schedules through the whole library against Stripe's test mode and PayPal's sandbox: the library's
// own test app (src/testing/app.ts) with test keys put in, real fetch, and the clock moved by hand
// between months. Save a method, first charge, the hourly run's charge next month, a decline, its
// retry, a new method, cancel. Also the first payment that saves the method: Stripe's embedded
// Checkout session with setup_future_usage, and PayPal's Card Fields order saved with the purchase
// (the card confirmed here as Card Fields would). Run by `npm run test:sandbox`, test keys only.
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'
import { defined, testKeys } from '../src/testing/app.js'

const { api, internal, createTest } = defined
const env = import.meta.env as Record<string, string | undefined>
const stripeKey = env.SANDBOX_STRIPE_SECRET_KEY ?? ''
if (!/^(sk|rk)_test_/.test(stripeKey)) throw new Error('The sandbox suite only runs with a Stripe test key.')
const paypalOn = !!env.SANDBOX_PAYPAL_CLIENT_ID && !!env.SANDBOX_PAYPAL_CLIENT_SECRET
const run = Date.now().toString(36)
const customers: string[] = []
/** PayPal sandbox test cards it accepted on 2026-11-21 (Visa, Mastercard); one used many times in a day starts answering PAYER_CANNOT_PAY. */
const CARDS = ['4111111111111111', '5555555555554444']

/**
 * convex-test makes the same ids every run, and the processors replay an idempotency key's first
 * answer (Stripe for a day, PayPal for hours) and refuse a repeated invoice id: each run's keys and
 * invoice ids get the run's tag, as real deployments' distinct ids would make them distinct.
 */
const realFetch = globalThis.fetch
function taggedFetch(input: RequestInfo | URL, init?: RequestInit) {
  const headers = new Headers(init?.headers)
  for (const name of ['idempotency-key', 'paypal-request-id']) {
    const key = headers.get(name)
    if (key) headers.set(name, `${key}-${run}`)
  }
  let body = init?.body
  if (typeof body === 'string' && body.includes('"invoice_id"')) body = body.replace(/"invoice_id":"([^"]*)"/, (_m, id: string) => `"invoice_id":"${id}-${run}"`)
  return realFetch(input, { ...init, headers, body })
}

beforeAll(() => {
  vi.stubGlobal('fetch', taggedFetch)
  testKeys.stripe = stripeKey
  testKeys.paypalClientId = env.SANDBOX_PAYPAL_CLIENT_ID ?? 'fake-client'
  testKeys.paypalSecret = env.SANDBOX_PAYPAL_CLIENT_SECRET ?? 'fake-secret'
  // Only the clock is moved; timers stay real, so the library's queued charges run.
  vi.useFakeTimers({ toFake: ['Date'], now: Date.now() })
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterAll(async () => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  for (const c of customers) await fetch(`https://api.stripe.com/v1/customers/${c}`, { method: 'DELETE', headers: { Authorization: `Bearer ${stripeKey}` } })
})

const stripePost = async (path: string, body: string) =>
  (await (
    await fetch(`https://api.stripe.com${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${stripeKey}`, 'Stripe-Version': '2026-10-28.endive', 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    })
  ).json()) as { id: string }

function harness() {
  // Each test starts at the real time: an earlier test moved the clock months ahead.
  vi.setSystemTime(vi.getRealSystemTime())
  const t = createTest()
  const settle = () => t.finishAllScheduledFunctions(() => {})
  const calls = (name: string) => t.query(api.host.calls, {}).then((cs) => cs.filter((c) => c.name === name).map((c) => c.args))
  const schedule = async (id: string) => (await t.query(api.monthly.get, { scheduleId: id }))!
  const hourly = async (when: number) => {
    vi.setSystemTime(when)
    await t.action(internal.paymentsWorker.schedules, {})
    await settle()
  }
  return { t, settle, calls, schedule, hourly }
}

describe('Stripe', () => {
  test('saved card: first charge, next month’s charge, a decline and its retry, a new card, cancel', async () => {
    const { t, settle, calls, schedule, hourly } = harness()
    const donor = `sb${run}`
    const { stripeCustomerId } = await t.action(api.monthly.setup, { donor })
    customers.push(stripeCustomerId)
    const attach = async (pm: string) => (await stripePost(`/v1/payment_methods/${pm}/attach`, `customer=${stripeCustomerId}`)).id
    const good = await attach('pm_card_visa')
    await t.action(api.monthly.verify, { donor, paymentMethodId: good })

    const { scheduleId, checkoutId } = await t.mutation(api.monthly.start, { donor, paymentMethodId: good, amountCents: 1000 })
    await settle()
    expect(await t.query(api.shop.status, { id: checkoutId! })).toMatchObject({ status: 'paid', paymentRef: expect.stringMatching(/^pi_/) })
    let s = await schedule(scheduleId)
    expect(s).toMatchObject({ status: 'active', failures: 0 })

    await hourly(s.nextChargeAt! + 60_000)
    expect((await calls('scheduleCharged')).map((c) => c.first)).toEqual([true, false])

    const bad = await attach('pm_card_chargeCustomerFail')
    await t.action(api.monthly.verify, { donor, paymentMethodId: bad })
    await t.mutation(api.monthly.update, { scheduleId, paymentMethodId: bad })
    s = await schedule(scheduleId)
    await hourly(s.nextChargeAt! + 60_000)
    s = await schedule(scheduleId)
    expect(s).toMatchObject({ status: 'past_due', failures: 1 })
    expect(await calls('scheduleFailed')).toMatchObject([{ attempt: 1, final: false, declineCode: 'card_declined', declineKind: 'soft' }])

    await hourly(s.nextChargeAt! + 60_000)
    expect((await calls('scheduleFailed')).map((c) => c.attempt)).toEqual([1, 2])

    await t.mutation(api.monthly.update, { scheduleId, paymentMethodId: good })
    await hourly(Date.now() + 60_000)
    s = await schedule(scheduleId)
    expect(s).toMatchObject({ status: 'active', failures: 0 })
    expect(await calls('scheduleCharged')).toHaveLength(3)

    await t.mutation(api.monthly.cancel, { scheduleId, reason: 'Sandbox done' })
    await hourly(s.nextChargeAt! + 60_000)
    expect(await calls('scheduleCharged')).toHaveLength(3)
    expect(await schedule(scheduleId)).toMatchObject({ status: 'cancelled' })
  })

  test('a first payment that saves the method: Stripe takes the embedded session for a card and a bank account', async () => {
    const { t, schedule } = harness()
    for (const method of ['card', 'ach'] as const) {
      const donor = `sb${run}${method}`
      const started = await t.action(api.monthly.startCheckout, { donor, processor: 'stripe', method })
      if (!('embedded' in started) || started.embedded.processor !== 'stripe') throw new Error('expected an embedded Stripe checkout')
      expect(started.embedded.clientSecret).toMatch(/^cs_test_/)
      expect(await schedule(started.scheduleId)).toMatchObject({ status: 'starting' })
      customers.push((await t.action(api.monthly.setup, { donor })).stripeCustomerId)
      await t.action(api.payments.cancelCheckout, { checkoutId: started.checkoutId })
      expect(await schedule(started.scheduleId)).toMatchObject({ status: 'cancelled', endReason: 'The first payment wasn’t completed.' })
    }
  })
})

describe.runIf(paypalOn)('PayPal', () => {
  test('a card saved with its first payment, then charged as a recurring payment next month, refunded, cancelled', async () => {
    const { t, settle, calls, schedule, hourly } = harness()
    const started = await t.action(api.monthly.startCheckout, { donor: `sbpp${run}`, processor: 'paypal', method: 'card', amountCents: 1000 })
    if (!('embedded' in started) || started.embedded.processor !== 'paypal') throw new Error('expected an embedded PayPal checkout')
    // What PayPal's Card Fields do in the browser: put the card on the order.
    const tok = (await (
      await fetch('https://api-m.sandbox.paypal.com/v1/oauth2/token', {
        method: 'POST',
        headers: { Authorization: `Basic ${btoa(`${testKeys.paypalClientId}:${testKeys.paypalSecret}`)}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'grant_type=client_credentials',
      })
    ).json()) as { access_token: string }
    const pp = (method: string, path: string, body?: unknown) =>
      fetch(`https://api-m.sandbox.paypal.com${path}`, { method, headers: { Authorization: `Bearer ${tok.access_token}`, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) })
    const confirmed = await pp('POST', `/v2/checkout/orders/${started.embedded.orderId}/confirm-payment-source`, {
      // A fresh test card number each run: the sandbox refuses one card used too often (PAYER_CANNOT_PAY).
      payment_source: { card: { number: CARDS[Math.floor(Math.random() * CARDS.length)], expiry: '2030-12', name: `Sandbox Donor ${run}`, security_code: '123' } },
    })
    expect(confirmed.status).toBe(200)
    expect(await t.action(api.payments.completeReturn, { processor: 'paypal', token: started.embedded.orderId })).toMatchObject({ status: 'paid' })
    let s = await schedule(started.scheduleId)
    expect(s).toMatchObject({ status: 'active', processor: 'paypal', method: 'card', paymentMethodId: expect.stringMatching(/^paypal:/) })

    await hourly(s.nextChargeAt! + 60_000)
    const charged = await calls('scheduleCharged')
    expect(charged.map((c) => c.first)).toEqual([true, false])
    s = await schedule(started.scheduleId)
    expect(s).toMatchObject({ status: 'active', failures: 0 })

    for (const c of charged) {
      const refundId = await t.mutation(api.shop.requestRefund, { checkoutId: c.checkoutId as string, reason: 'Sandbox' })
      expect(await t.action(api.shop.sendRefund, { refundId, skipApproval: true })).toBe('sent')
    }
    await t.mutation(api.monthly.cancel, { scheduleId: started.scheduleId, reason: 'Sandbox done' })
    await settle()
    await pp('DELETE', `/v3/vault/payment-tokens/${s.paymentMethodId!.slice('paypal:'.length)}`)
  })
})
