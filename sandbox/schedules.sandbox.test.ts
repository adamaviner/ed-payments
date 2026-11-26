// Schedules through the whole library against Stripe's test mode and PayPal's sandbox: the library's
// own test app (src/testing/app.ts) with test keys put in, real fetch, and the clock moved by hand
// between months. Save a method, first charge, the hourly run's charge next month, a decline, its
// retry, a new method, cancel. Also the first payment that saves the method: Stripe's embedded
// Checkout session with setup_future_usage, the on-page PaymentIntent saving it (confirmed here as
// Stripe.js would), and PayPal's Card Fields order saved with the purchase (the card confirmed here as
// Card Fields would), embedded and on-page. Run by `npm run test:sandbox`, test keys only.
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { api, cardSource, customers, endSandbox, harness, paypalAs, paypalOn, run, stripeKey, stripePost, useSandbox } from './harness.js'

if (!/^(sk|rk)_test_/.test(stripeKey)) throw new Error('The sandbox suite only runs with a Stripe test key.')

beforeAll(useSandbox)
afterAll(endSandbox)

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

describe('Stripe on the app’s page', () => {
  test('a first payment made at the press saves the card, and the hourly run charges it next month with nobody present', async () => {
    const { t, calls, schedule, hourly } = harness()
    const donor = `sbop${run}`
    const started = await t.action(api.monthly.startCheckout, { donor, processor: 'stripe', method: 'card', ui: 'onPage', amountCents: 1000 })
    if (!('onPage' in started) || started.onPage.processor !== 'stripe') throw new Error('expected an on-page Stripe payment')
    customers.push((await t.action(api.monthly.setup, { donor })).stripeCustomerId)
    expect(await schedule(started.scheduleId)).toMatchObject({ status: 'starting' })
    const pi = started.onPage.clientSecret.slice(0, started.onPage.clientSecret.indexOf('_secret_'))
    // What Stripe.js does at the press with what the payer typed.
    expect(await stripePost<{ status: string; setup_future_usage: string }>(`/v1/payment_intents/${pi}/confirm`, 'payment_method=pm_card_visa')).toMatchObject({
      status: 'succeeded',
      setup_future_usage: 'off_session',
    })
    expect(await t.action(api.payments.completeReturn, { processor: 'stripe', token: pi })).toMatchObject({ status: 'paid' })
    let s = await schedule(started.scheduleId)
    expect(s).toMatchObject({ status: 'active', processor: 'stripe', method: 'card', paymentMethodId: expect.stringMatching(/^pm_/) })

    await hourly(s.nextChargeAt! + 60_000)
    expect((await calls('scheduleCharged')).map((c) => c.first)).toEqual([true, false])
    s = await schedule(started.scheduleId)
    expect(s).toMatchObject({ status: 'active', failures: 0 })
    await t.mutation(api.monthly.cancel, { scheduleId: started.scheduleId, reason: 'Sandbox done' })
  })
})

describe('startOnPage: one ref for the whole attempt', () => {
  test('a one-off, then monthly under the same ref (replaces): the one-off is canceled at Stripe and can’t be paid; the first payment starts the schedule, and the app hears no not-started', async () => {
    const { t, calls, schedule } = harness()
    const donor = `sbsw${run}`
    const gift = `g${run}`
    const oneOff = await t.action(api.give.onPage, { processor: 'stripe', method: 'card', amountCents: 1500, gift, donor, email: `${donor}@example.org` })
    if (oneOff.onPage.processor !== 'stripe') throw new Error('expected an on-page Stripe payment')
    const monthly = await t.action(api.give.onPage, { processor: 'stripe', method: 'card', amountCents: 1500, gift, donor, email: `${donor}@example.org`, monthly: true, replaces: oneOff.checkoutId })
    if (monthly.onPage.processor !== 'stripe' || !monthly.scheduleId) throw new Error('expected an on-page Stripe first payment')
    customers.push((await t.action(api.monthly.setup, { donor })).stripeCustomerId)
    expect(await t.query(api.shop.status, { id: oneOff.checkoutId })).toMatchObject({ status: 'abandoned' })
    const intentOf = (secret: string) => secret.slice(0, secret.indexOf('_secret_'))
    const stale = await stripePost<{ status?: string; error?: { code?: string } }>(`/v1/payment_intents/${intentOf(oneOff.onPage.clientSecret)}/confirm`, 'payment_method=pm_card_visa')
    expect(stale.status).not.toBe('succeeded')
    expect(await stripePost<{ status: string }>(`/v1/payment_intents/${intentOf(monthly.onPage.clientSecret)}/confirm`, 'payment_method=pm_card_visa')).toMatchObject({ status: 'succeeded' })
    expect(await t.action(api.payments.completeReturn, { processor: 'stripe', token: intentOf(monthly.onPage.clientSecret) })).toMatchObject({ status: 'paid' })
    expect(await schedule(monthly.scheduleId)).toMatchObject({ status: 'active', methodLabel: expect.stringContaining('4242') })
    expect(await calls('scheduleChanged')).toMatchObject([{ changes: ['started'] }])
    await t.mutation(api.monthly.cancel, { scheduleId: monthly.scheduleId, reason: 'Sandbox done' })
  })
})

describe.runIf(paypalOn)('PayPal', () => {
  test('a card saved with its first payment, then charged as a recurring payment next month, refunded, cancelled', async () => {
    const { t, settle, calls, schedule, hourly } = harness()
    const started = await t.action(api.monthly.startCheckout, { donor: `sbpp${run}`, processor: 'paypal', method: 'card', amountCents: 1000 })
    if (!('embedded' in started) || started.embedded.processor !== 'paypal') throw new Error('expected an embedded PayPal checkout')
    // What PayPal's Card Fields do in the browser: put the card on the order.
    const pp = await paypalAs()
    const confirmed = await pp('POST', `/v2/checkout/orders/${started.embedded.orderId}/confirm-payment-source`, cardSource(`Sandbox Donor ${run}`))
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

  test('a card saved with a first payment made at the press (on-page Card Fields)', async () => {
    const { t, schedule, settle } = harness()
    const started = await t.action(api.monthly.startCheckout, { donor: `sbppop${run}`, processor: 'paypal', method: 'card', ui: 'onPage', amountCents: 1000 })
    if (!('onPage' in started) || started.onPage.processor !== 'paypal') throw new Error('expected an on-page PayPal payment')
    const pp = await paypalAs()
    expect((await pp('POST', `/v2/checkout/orders/${started.onPage.orderId}/confirm-payment-source`, cardSource(`Sandbox Donor ${run}`))).status).toBe(200)
    expect(await t.action(api.payments.completeReturn, { processor: 'paypal', token: started.onPage.orderId })).toMatchObject({ status: 'paid' })
    const s = await schedule(started.scheduleId)
    expect(s).toMatchObject({ status: 'active', processor: 'paypal', method: 'card', paymentMethodId: expect.stringMatching(/^paypal:/) })
    await t.mutation(api.monthly.cancel, { scheduleId: started.scheduleId, reason: 'Sandbox done' })
    await settle()
    await pp('DELETE', `/v3/vault/payment-tokens/${s.paymentMethodId!.slice('paypal:'.length)}`)
  })
})
