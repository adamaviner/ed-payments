// Cards and PayPal accounts saved in PayPal's vault, against the fake PayPal: saving (and what is
// refused), listing beside Stripe's, removing, charging with nobody present (paid, declined, a
// declined capture, no answer, pending), the buyer retrying with PayPal's buttons or Stripe's form,
// a person giving up, and which processor a card goes to.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { defined } from '../testing/app.js'
import { fakePaypal, type FakePaypal, type VaultBehaviour } from '../testing/fakePaypal.js'
import { fakeStripe, type FakeStripe } from '../testing/fakeStripe.js'

const { api, createTest } = defined
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
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

function setup() {
  const t = createTest()
  const status = async (id: string) => (await t.query(api.shop.status, { id }))!
  const calls = (name?: string) => t.query(api.host.calls, {}).then((cs) => cs.filter((c) => !name || c.name === name))
  const settle = () => t.finishAllScheduledFunctions(() => vi.runAllTimers())
  /** Saves a card (or PayPal account) for `user` through a setup token, as the browser components do. */
  const save = async (o: { user?: string; kind?: 'card' | 'paypal'; behaviour?: VaultBehaviour; last4?: string } = {}) => {
    const user = o.user ?? 'u1'
    const { setupTokenId } = await t.action(api.bids.paypalSetup, { user, kind: o.kind ?? 'card' })
    pp.approveSetup(setupTokenId, { behaviour: o.behaviour, card: { last4: o.last4 } })
    return await t.action(api.bids.paypalSave, { user, setupTokenId })
  }
  const charge = async (pm: string, o: { bidId?: string; amountCents?: number } = {}) => {
    const id = await t.mutation(api.bids.charge, { user: 'u1', bidId: o.bidId ?? 'b1', paymentMethodId: pm, amountCents: o.amountCents })
    await settle()
    return id
  }
  return { t, status, calls, settle, save, charge }
}

describe('saving a card or PayPal account in PayPal’s vault', () => {
  test('a card: checked when saved, tagged with its owner, listed beside Stripe’s newest first; the owner’s later saves reuse their PayPal customer', async () => {
    const { t, save } = setup()
    const { setupTokenId, clientId } = await t.action(api.bids.paypalSetup, { user: 'u1', kind: 'card' })
    expect(clientId).toBe('fake-client')
    const body = pp.calls.find((c) => c.path === '/v3/vault/setup-tokens')!.body
    expect(body).toEqual({
      customer: { merchant_customer_id: 'test.user.u1' },
      payment_source: {
        card: { verification_method: 'SCA_WHEN_REQUIRED', experience_context: { return_url: 'https://app.example.org/', cancel_url: 'https://app.example.org/', brand_name: 'Test shop' } },
      },
    })
    pp.approveSetup(setupTokenId, { card: { brand: 'VISA', last4: '0004' } })
    const card = await t.action(api.bids.paypalSave, { user: 'u1', setupTokenId })
    expect(card).toEqual({ paymentMethodId: expect.stringMatching(/^paypal:fakepaytoken/), processor: 'paypal', kind: 'card', label: 'Visa •••• 0004', declined: false, createdAt: Date.now() })

    // Saving the same setup token again (a double click) is the same method.
    expect(await t.action(api.bids.paypalSave, { user: 'u1', setupTokenId })).toEqual(card)

    vi.advanceTimersByTime(60_000)
    const { stripeCustomerId } = await t.action(api.bids.setup, { user: 'u1', email: 'u1@example.org' })
    const stripeCard = stripe.saveMethod(stripeCustomerId, 'ok')
    vi.advanceTimersByTime(60_000)
    const account = await save({ kind: 'paypal' })
    expect(account).toMatchObject({ kind: 'paypal', label: 'PayPal (buyer@example.org)', processor: 'paypal' })
    const second = pp.calls.filter((c) => c.path === '/v3/vault/setup-tokens')[1].body as { customer: { id?: string }; payment_source: { paypal?: unknown } }
    expect(second.customer.id).toMatch(/^FAKECUST/)
    expect(second.payment_source.paypal).toMatchObject({ usage_type: 'MERCHANT', usage_pattern: 'UNSCHEDULED_POSTPAID', permit_multiple_payment_tokens: true })

    const listed = await t.action(api.bids.methods, { user: 'u1' })
    expect(listed.map((m) => m.paymentMethodId)).toEqual([account.paymentMethodId, stripeCard, card.paymentMethodId])
    expect(await t.action(api.bids.verify, { user: 'u1', paymentMethodId: card.paymentMethodId })).toMatchObject({ processor: 'paypal', customerId: expect.stringMatching(/^FAKECUST/) })
  })

  test('refused: someone else’s setup token, one not approved yet, a card whose check failed, a made-up or another owner’s method', async () => {
    const { t, save } = setup()
    const bens = await t.action(api.bids.paypalSetup, { user: 'u2', kind: 'card' })
    pp.approveSetup(bens.setupTokenId)
    await expect(t.action(api.bids.paypalSave, { user: 'u1', setupTokenId: bens.setupTokenId })).rejects.toThrow(/couldn’t be used/)
    const waiting = await t.action(api.bids.paypalSetup, { user: 'u1', kind: 'card' })
    await expect(t.action(api.bids.paypalSave, { user: 'u1', setupTokenId: waiting.setupTokenId })).rejects.toThrow(/hasn’t approved/)
    await expect(save({ behaviour: 'unverified' })).rejects.toThrow(/couldn’t be verified/)
    await expect(t.action(api.bids.paypalSave, { user: 'u1', setupTokenId: 'bad id!' })).rejects.toThrow(/couldn’t be used/)
    expect(await t.action(api.bids.methods, { user: 'u1' })).toEqual([])

    const bensCard = await save({ user: 'u2' })
    await expect(t.action(api.bids.verify, { user: 'u1', paymentMethodId: bensCard.paymentMethodId })).rejects.toThrow(/couldn’t be used/)
    await expect(t.action(api.bids.verify, { user: 'u1', paymentMethodId: 'paypal:madeup' })).rejects.toThrow(/couldn’t be used/)
    await expect(t.mutation(api.bids.charge, { user: 'u1', bidId: 'b1', paymentMethodId: bensCard.paymentMethodId })).rejects.toThrow(/isn’t saved for this payer/)
  })

  test('removing: a PayPal method is deleted from the vault, a Stripe one detached; neither is listed or accepted again', async () => {
    const { t, save } = setup()
    const card = await save()
    const { stripeCustomerId } = await t.action(api.bids.setup, { user: 'u1', email: 'u1@example.org' })
    const stripeCard = stripe.saveMethod(stripeCustomerId, 'ok')
    await expect(t.action(api.bids.remove, { user: 'u2', paymentMethodId: card.paymentMethodId })).rejects.toThrow(/couldn’t be used/)

    await t.action(api.bids.remove, { user: 'u1', paymentMethodId: card.paymentMethodId })
    expect(pp.vault()[0].deleted).toBe(true)
    await t.action(api.bids.remove, { user: 'u1', paymentMethodId: stripeCard })
    expect(stripe.calls.some((c) => c.path === `/v1/payment_methods/${stripeCard}/detach`)).toBe(true)

    expect(await t.action(api.bids.methods, { user: 'u1' })).toEqual([])
    await expect(t.action(api.bids.verify, { user: 'u1', paymentMethodId: card.paymentMethodId })).rejects.toThrow(/couldn’t be used/)
    await expect(t.action(api.bids.verify, { user: 'u1', paymentMethodId: stripeCard })).rejects.toThrow(/couldn’t be used/)
  })
})

describe('charging a PayPal method with nobody present', () => {
  test('paid at once: a merchant-initiated order on the saved card, tagged, with PayPal’s fee; the same key is the same charge', async () => {
    const { t, status, calls, save, charge } = setup()
    const card = await save()
    const id = await charge(card.paymentMethodId)
    expect(await status(id)).toMatchObject({ status: 'paid', kind: 'offSession', processor: 'paypal', method: 'card', paidCents: 5000, processorFeeCents: 179 })
    expect(pp.vaultCharges[0].body).toMatchObject({
      intent: 'CAPTURE',
      purchase_units: [{ custom_id: `test:${id}`, amount: { value: '50.00' } }],
      payment_source: { card: { vault_id: card.paymentMethodId.slice('paypal:'.length), stored_credential: { payment_initiator: 'MERCHANT', payment_type: 'UNSCHEDULED', usage: 'SUBSEQUENT' } } },
    })
    expect((await calls('onPaid'))[0].args).toMatchObject({ kind: 'offSession', purpose: 'bid', context: { bidId: 'b1' }, paidCents: 5000 })
    expect(await t.mutation(api.bids.charge, { user: 'u1', bidId: 'b1', paymentMethodId: card.paymentMethodId })).toBe(id)
    expect(pp.vaultCharges).toHaveLength(1)
  })

  test('a PayPal account is charged by its vault id alone', async () => {
    const { status, save, charge } = setup()
    const account = await save({ kind: 'paypal' })
    const id = await charge(account.paymentMethodId)
    expect(await status(id)).toMatchObject({ status: 'paid', method: 'paypal' })
    expect((pp.vaultCharges[0].body as { payment_source: unknown }).payment_source).toEqual({ paypal: { vault_id: account.paymentMethodId.slice('paypal:'.length) } })
  })

  test.each(['decline', 'captureDeclined'] as const)('%s: failed with declined, and the method is marked so it isn’t offered again', async (behaviour) => {
    const { t, status, calls, save, charge } = setup()
    const card = await save()
    pp.setVaultBehaviour(card.paymentMethodId.slice('paypal:'.length), behaviour)
    const id = await charge(card.paymentMethodId)
    expect(await status(id)).toMatchObject({ status: 'failed' })
    expect((await calls('onFailed'))[0].args).toMatchObject({ declined: true, kind: 'offSession' })
    expect(await t.action(api.bids.methods, { user: 'u1' })).toMatchObject([{ paymentMethodId: card.paymentMethodId, declined: true }])
  })

  test('no answer: tried again a minute later under the same PayPal-Request-Id, then paid', async () => {
    const { status, save, charge } = setup()
    const card = await save()
    pp.setVaultBehaviour(card.paymentMethodId.slice('paypal:'.length), 'error')
    const id = await charge(card.paymentMethodId)
    expect(await status(id)).toMatchObject({ status: 'paid', chargeAttempts: 1 })
  })

  test('a pending capture is processing until PayPal’s capture webhook says completed', async () => {
    const { t, status, save, charge } = setup()
    const card = await save()
    pp.setVaultBehaviour(card.paymentMethodId.slice('paypal:'.length), 'pending')
    const id = await charge(card.paymentMethodId)
    expect(await status(id)).toMatchObject({ status: 'processing' })
    const orderId = pp.orders().find((o) => o.purchase_units?.[0]?.custom_id === `test:${id}`)!.id
    pp.capturesCome('COMPLETED')
    const order = pp.order(orderId)
    const capture = order.purchase_units![0].payments!.captures![0]
    const res = await t.fetch('/paypal/webhook', pp.event('PAYMENT.CAPTURE.COMPLETED', { ...capture, status: 'COMPLETED' }))
    expect(res.status).toBe(200)
    expect(await status(id)).toMatchObject({ status: 'paid' })
  })

  test('PayPal down for every try: a person is asked, and giving up fails it', async () => {
    const { t, status, save, charge } = setup()
    await t.mutation(api.host.addAdmin, { token: 'boss', name: 'Bo' })
    const card = await save()
    pp.refuse((c) => (c.method === 'POST' && c.path === '/v2/checkout/orders' ? Response.json({ name: 'INTERNAL_SERVER_ERROR' }, { status: 503 }) : undefined))
    const id = await charge(card.paymentMethodId)
    expect(await status(id)).toMatchObject({ status: 'pending', chargeAttempts: 5 })
    expect(await t.query(api.shop.issues, {})).toMatchObject([{ kind: 'charge_unknown', processor: 'paypal' }])
    pp.refuse()
    expect(await t.action(api.payments.giveUpCharge, { auth: 'boss', checkoutId: id })).toEqual({ status: 'failed' })
    expect(pp.vaultCharges).toHaveLength(0)
  })
})

describe('the buyer pays after a declined PayPal charge', () => {
  test('with PayPal’s buttons, or Stripe’s form instead; only one is open at a time, and paying settles the retry', async () => {
    const { t, status, save, charge } = setup()
    const card = await save()
    pp.setVaultBehaviour(card.paymentMethodId.slice('paypal:'.length), 'decline')
    const declined = await charge(card.paymentMethodId)

    const first = await t.action(api.bids.retryPaypal, { checkoutId: declined })
    expect(first.embedded).toMatchObject({ processor: 'paypal', clientId: 'fake-client', returnUrl: `https://app.example.org/bids/paid?token=${first.embedded.orderId}` })
    expect(await t.action(api.bids.retryPaypal, { checkoutId: declined })).toEqual(first)

    // Switching to Stripe's form closes the PayPal one, and back again closes Stripe's.
    const viaStripe = await t.action(api.bids.retry, { checkoutId: declined })
    expect(await status(first.checkoutId)).toMatchObject({ status: 'abandoned' })
    const again = await t.action(api.bids.retryPaypal, { checkoutId: declined })
    expect(await status(viaStripe.checkoutId)).toMatchObject({ status: 'abandoned' })
    expect(stripe.calls.some((c) => c.path.endsWith('/cancel'))).toBe(true)

    pp.approve(again.embedded.orderId)
    expect(await t.action(api.payments.completeReturn, { processor: 'paypal', token: again.embedded.orderId })).toMatchObject({ status: 'paid' })
    expect(await status(again.checkoutId)).toMatchObject({ status: 'paid', kind: 'onSession', processor: 'paypal' })
    await expect(t.action(api.bids.retryPaypal, { checkoutId: declined })).rejects.toThrow(/already paid/)
  })
})

test('a card goes to whichever processor costs less at the app’s rates', async () => {
  const { t } = setup()
  // 2.9% + 30¢ (Stripe) against 1.99% + 49¢ (the test app's PayPal rate): the same near $21.
  expect(await t.query(api.bids.cardProcessor, { amountCents: 1000 })).toEqual({ processor: 'stripe', feeCents: { stripe: 59, paypal: 69 } })
  expect(await t.query(api.bids.cardProcessor, { amountCents: 10_000 })).toEqual({ processor: 'paypal', feeCents: { stripe: 320, paypal: 248 } })
})
