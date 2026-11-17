// Saved payment methods and PaymentIntents against the fake Stripe: saving, verifying, charging with
// nobody present (paid, declined, a transient error, an unknown outcome, a bank payment), the buyer
// retrying on the app's page, and the refunds, disputes, sweep and comparison that now cover them.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { defined } from '../testing/app.js'
import { fakePaypal } from '../testing/fakePaypal.js'
import { fakeStripe, type FakeStripe } from '../testing/fakeStripe.js'

const { api, internal, createTest } = defined
let stripe: FakeStripe

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2030-01-01T12:00:00Z'))
  stripe = fakeStripe({ fallback: fakePaypal().fetch })
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
  const post = async (init: RequestInit) => {
    const res = await t.fetch('/stripe/webhook', init)
    return { status: res.status, text: await res.text() }
  }
  const settle = () => t.finishAllScheduledFunctions(() => vi.runAllTimers())
  /** A user with a saved method behaving as given; returns the method id. */
  const saved = async (user = 'u1', behaviour: Parameters<FakeStripe['saveMethod']>[1] = 'ok') => {
    const { stripeCustomerId } = await t.action(api.bids.setup, { user, email: `${user}@example.org` })
    const pm = stripe.saveMethod(stripeCustomerId, behaviour)
    await t.action(api.bids.verify, { user, paymentMethodId: pm })
    return pm
  }
  /** Charges a bid and runs the queued charge. */
  const charge = async (pm: string, o: { bidId?: string; amountCents?: number; key?: string } = {}) => {
    const id = await t.mutation(api.bids.charge, { user: 'u1', bidId: o.bidId ?? 'b1', paymentMethodId: pm, amountCents: o.amountCents, key: o.key })
    await settle()
    return id
  }
  const issues = () => t.query(api.shop.issues, {})
  return { t, status, calls, post, settle, saved, charge, issues }
}

const intentCalls = () => stripe.calls.filter((c) => c.method === 'POST' && c.path === '/v1/payment_intents')

describe('saving a payment method', () => {
  test('one Customer per owner, a SetupIntent for off-session use with instant bank verification', async () => {
    const { t } = setup()
    const a = await t.action(api.bids.setup, { user: 'u1', email: 'ana@example.org' })
    const b = await t.action(api.bids.setup, { user: 'u1', email: 'ana@example.org' })
    expect(a.stripeCustomerId).toBe(b.stripeCustomerId)
    expect(stripe.customers()).toHaveLength(1)
    expect(a.clientSecret).toMatch(/^seti_.*_secret_/)
    const si = stripe.calls.find((c) => c.path === '/v1/setup_intents')!.params
    expect(si.get('usage')).toBe('off_session')
    expect(si.getAll('allowed_payment_method_types[0]').concat(si.getAll('allowed_payment_method_types[1]'))).toEqual(['card', 'us_bank_account'])
    expect(si.has('payment_method_types[0]')).toBe(false)
    expect(si.get('payment_method_options[us_bank_account][verification_method]')).toBe('instant')
    expect(si.get('payment_method_options[us_bank_account][financial_connections][permissions][0]')).toBe('payment_method')
  })

  test('saved methods are listed with labels, newest first; a stranger’s, a made-up or another owner’s method is refused', async () => {
    const { t } = setup()
    const { stripeCustomerId } = await t.action(api.bids.setup, { user: 'u1', email: 'ana@example.org' })
    const card = stripe.saveMethod(stripeCustomerId, 'ok')
    const bank = stripe.saveMethod(stripeCustomerId, 'bank')
    expect(await t.action(api.bids.methods, { user: 'u1' })).toEqual([
      { paymentMethodId: bank, kind: 'ach', label: 'STRIPE TEST BANK account •••• 6789', declined: false },
      { paymentMethodId: card, kind: 'card', label: 'Visa •••• 4242', declined: false },
    ])
    expect(await t.action(api.bids.verify, { user: 'u1', paymentMethodId: card })).toMatchObject({ paymentMethodId: card, kind: 'card', stripeCustomerId })
    const other = await t.action(api.bids.setup, { user: 'u2', email: 'ben@example.org' })
    const bens = stripe.saveMethod(other.stripeCustomerId, 'ok')
    await expect(t.action(api.bids.verify, { user: 'u1', paymentMethodId: bens })).rejects.toThrow(/couldn’t be used/)
    await expect(t.action(api.bids.verify, { user: 'u1', paymentMethodId: stripe.strayMethod() })).rejects.toThrow(/couldn’t be used/)
    await expect(t.action(api.bids.verify, { user: 'u1', paymentMethodId: 'pm_madeup' })).rejects.toThrow(/couldn’t be used/)
    await expect(t.action(api.bids.verify, { user: 'u1', paymentMethodId: 'not a method' })).rejects.toThrow(/couldn’t be used/)
    expect(await t.action(api.bids.methods, { user: 'nobody' })).toEqual([])
  })
})

describe('charging a saved method with nobody present', () => {
  test('paid: the host’s paid callback runs with kind offSession; the same key is the same charge', async () => {
    const { t, status, calls, saved, charge } = setup()
    const pm = await saved()
    const id = await charge(pm)
    expect(await status(id)).toMatchObject({ status: 'paid', kind: 'offSession', method: 'card', paidCents: 5000, purpose: 'bid', processorFeeCents: 175 })
    const pi = intentCalls()[0].params
    expect(pi.get('off_session')).toBe('true')
    expect(pi.get('confirm')).toBe('true')
    expect(pi.get('error_on_requires_action')).toBe('true')
    expect(pi.get('metadata[app]')).toBe('test')
    expect(pi.get('metadata[checkoutId]')).toBe(id)
    expect((await calls('onPaid'))[0].args).toMatchObject({ kind: 'offSession', purpose: 'bid', context: { bidId: 'b1' }, paidCents: 5000 })
    expect(await t.mutation(api.bids.charge, { user: 'u1', bidId: 'b1', paymentMethodId: pm })).toBe(id)
    expect(intentCalls()).toHaveLength(1)
  })

  test('the payment_intent.succeeded webhook for it is handled once, not paid twice', async () => {
    const { post, calls, saved, charge, status } = setup()
    const id = await charge(await saved())
    const pi = (await status(id)).paymentRef!
    expect(await post(await stripe.intentEvent(pi))).toEqual({ status: 200, text: 'handled' })
    expect(await calls('onPaid')).toHaveLength(1)
  })

  test('a saved-card decline fails it (failed callback, declined), marks the method, and it isn’t offered again', async () => {
    const { t, status, calls, saved, charge } = setup()
    const pm = await saved('u1', 'decline')
    const id = await charge(pm)
    expect(await status(id)).toMatchObject({ status: 'failed', lastError: 'Your card was declined.' })
    expect((await status(id)).processorCheckoutId).toMatch(/^pi_/)
    expect((await calls('onFailed'))[0].args).toMatchObject({ kind: 'offSession', declined: true, wasProcessing: false, context: { bidId: 'b1' } })
    expect(await t.action(api.bids.methods, { user: 'u1' })).toMatchObject([{ paymentMethodId: pm, declined: true }])
  })

  test('a card that needs the buyer to authenticate is a decline off-session', async () => {
    const { status, saved, charge } = setup()
    const id = await charge(await saved('u1', 'auth'))
    expect(await status(id)).toMatchObject({ status: 'failed', lastError: expect.stringMatching(/confirm the payment/) })
  })

  test('a transient error is retried on a schedule, looking for the first try’s charge before trying again under a new key', async () => {
    const { status, saved, charge, issues } = setup()
    const pm = await saved()
    let down = 2
    stripe.refuse((c) =>
      c.method === 'POST' && c.path === '/v1/payment_intents' && down-- > 0 ? Response.json({ error: { type: 'api_error', message: 'Stripe is down' } }, { status: 503 }) : undefined,
    )
    const id = await charge(pm)
    expect(await status(id)).toMatchObject({ status: 'paid', chargeAttempts: 2 })
    const lookups = stripe.calls.filter((c) => c.method === 'GET' && c.path === '/v1/payment_intents')
    expect(lookups).toHaveLength(2)
    expect(stripe.paymentIntents().filter((p) => p.status === 'succeeded')).toHaveLength(1)
    expect(await issues()).toEqual([])
  })

  test('an unknown outcome opens a charge_unknown issue; an admin retries it (paid) or gives up (failed)', async () => {
    const { t, status, saved, charge, issues, calls, settle } = setup()
    await t.mutation(api.host.addAdmin, { token: 'boss', name: 'Bo' })
    const pm = await saved()
    stripe.refuse((c) => (c.method === 'POST' && c.path === '/v1/payment_intents' ? Response.json({ error: { type: 'invalid_request_error', message: 'Something odd' } }, { status: 400 }) : undefined))
    const a = await charge(pm, { bidId: 'b1' })
    const b = await charge(pm, { bidId: 'b2' })
    expect((await status(a)).status).toBe('pending')
    expect((await issues()).map((i) => [i.kind, i.checkoutId])).toEqual([
      ['charge_unknown', a],
      ['charge_unknown', b],
    ])
    stripe.refuse()
    await t.mutation(api.payments.retryCharge, { auth: 'boss', checkoutId: a })
    await settle()
    expect((await status(a)).status).toBe('paid')
    await t.mutation(api.payments.giveUpCharge, { auth: 'boss', checkoutId: b })
    expect(await status(b)).toMatchObject({ status: 'failed', lastError: expect.stringMatching(/^Given up by Bo/) })
    expect((await calls('onFailed'))[0].args).toMatchObject({ checkoutId: b, declined: false })
    const open = await t.query(api.payments.issues, { auth: 'boss', paginationOpts: { numItems: 10, cursor: null } })
    expect(open.page).toEqual([])
  })

  test('a bank account: processing (the processing callback), then paid; or it bounces (failed, wasProcessing)', async () => {
    const { status, calls, saved, charge, post } = setup()
    const pm = await saved('u1', 'bank')
    const a = await charge(pm, { bidId: 'b1' })
    expect(await status(a)).toMatchObject({ status: 'processing', method: 'ach' })
    expect((await calls('onProcessing'))[0].args).toMatchObject({ checkoutId: a, kind: 'offSession', paymentRef: expect.stringMatching(/^pi_/) })
    const pi = (await status(a)).paymentRef!
    expect(await post(await stripe.settleBank(pi, true))).toEqual({ status: 200, text: 'handled' })
    expect(await status(a)).toMatchObject({ status: 'paid', method: 'ach', processorFeeCents: 40 })
    const b = await charge(pm, { bidId: 'b2' })
    await post(await stripe.settleBank((await status(b)).paymentRef!, false))
    expect(await status(b)).toMatchObject({ status: 'failed' })
    expect((await calls('onFailed')).at(-1)?.args).toMatchObject({ checkoutId: b, declined: true, wasProcessing: true })
  })

  test('a context that doesn’t fit the app’s validator is refused before the processor is asked', async () => {
    const { t } = setup()
    await expect(t.action(api.shop.buy, { processor: 'stripe', method: 'card', context: { buyer: 7 } })).rejects.toThrow(/context\.buyer should be a string/)
    await expect(t.action(api.shop.buy, { processor: 'stripe', method: 'card', context: { stranger: true } })).rejects.toThrow(/context\.stranger isn't expected/)
    expect(stripe.sessions()).toEqual([])
  })
})

describe('the buyer pays on the app’s page after a decline', () => {
  async function declined() {
    const s = setup()
    const pm = await s.saved('u1', 'decline')
    const id = await s.charge(pm)
    return { ...s, id }
  }

  test('a PaymentIntent for the same amount, reused while it waits; a decline there leaves it open; paid settles it (kind onSession)', async () => {
    const { t, id, status, calls, post } = await declined()
    const first = await t.action(api.bids.retry, { checkoutId: id })
    expect(first.clientSecret).toMatch(/_secret_/)
    expect(await t.action(api.bids.retry, { checkoutId: id })).toEqual(first)
    const retry = await status(first.checkoutId)
    expect(retry).toMatchObject({ kind: 'onSession', status: 'pending', retryOf: id, amountCents: 5000 })
    const pi = retry.processorCheckoutId!
    const params = intentCalls().at(-1)!.params
    expect(params.has('confirm')).toBe(false)
    expect(params.get('payment_method_options[us_bank_account][verification_method]')).toBe('instant')
    expect(await post(await stripe.confirm(pi, 'decline'))).toEqual({ status: 200, text: 'handled' })
    expect(await status(first.checkoutId)).toMatchObject({ status: 'pending', lastError: 'Your card was declined.' })
    await post(await stripe.confirm(pi, 'ok'))
    expect((await status(first.checkoutId)).status).toBe('paid')
    expect((await calls('onPaid')).map((c) => c.args.kind)).toEqual(['onSession'])
    await expect(t.action(api.bids.retry, { checkoutId: id })).rejects.toThrow(/already paid/)
  })

  test('a bank payment on its way refuses another; the return page settles it before the webhook', async () => {
    const { t, id, status } = await declined()
    const r = await t.action(api.bids.retry, { checkoutId: id })
    const pi = (await status(r.checkoutId)).processorCheckoutId!
    await stripe.confirm(pi, 'bank')
    expect(await t.action(api.payments.completeReturn, { processor: 'stripe', token: pi })).toMatchObject({ status: 'processing', purpose: 'bid' })
    await expect(t.action(api.bids.retry, { checkoutId: id })).rejects.toThrow(/already/)
  })

  test('the sweep gives up an expired one at Stripe (canceled) and abandons it; a new retry makes a new one', async () => {
    const { t, id, status } = await declined()
    const r = await t.action(api.bids.retry, { checkoutId: id })
    vi.setSystemTime(Date.now() + 25 * 60 * 60_000)
    await t.action(internal.paymentsWorker.sweep, {})
    expect((await status(r.checkoutId)).status).toBe('abandoned')
    expect(stripe.intent((await status(r.checkoutId)).processorCheckoutId!).status).toBe('canceled')
    const again = await t.action(api.bids.retry, { checkoutId: id })
    expect(again.checkoutId).not.toBe(r.checkoutId)
  })

  test('only a failed charge can be retried', async () => {
    const { t, status, saved, charge } = setup()
    const id = await charge(await saved())
    expect((await status(id)).status).toBe('paid')
    await expect(t.action(api.bids.retry, { checkoutId: id })).rejects.toThrow(/already paid/)
    await expect(t.action(api.bids.retry, { checkoutId: 'nonsense' })).rejects.toThrow(/no payment to retry/)
  })
})

describe('refunds, disputes, sweep and the comparison cover saved-method charges', () => {
  test('a refund through the ledger, a dashboard refund and a dispute on a bid charge are recorded', async () => {
    const { t, status, saved, charge, post, calls, issues } = setup()
    const id = await charge(await saved())
    const pi = (await status(id)).paymentRef!
    const refundId = await t.mutation(api.shop.requestRefund, { checkoutId: id, amountCents: 1000, reason: 'Partly' })
    expect(await t.action(api.shop.sendRefund, { refundId, skipApproval: true })).toBe('sent')
    const dash = await stripe.refundInDashboard(pi, 500)
    expect(await post(dash.created)).toEqual({ status: 200, text: 'handled' })
    expect(await status(id)).toMatchObject({ refundedCents: 1500 })
    expect((await t.query(api.shop.refundsFor, { checkoutId: id })).map((r) => [r.origin, r.amountCents, r.status])).toEqual([
      ['requested', 1000, 'sent'],
      ['external', 500, 'sent'],
    ])
    expect(await post(await stripe.dispute(pi, 'created'))).toEqual({ status: 200, text: 'handled' })
    expect(await status(id)).toMatchObject({ disputed: true })
    expect((await calls('onDispute'))[0].args).toMatchObject({ kind: 'offSession', status: 'opened' })
    expect((await issues()).map((i) => i.kind)).toContain('dispute')
  })

  test('the sweep picks up a charge whose queued try never ran', async () => {
    const { t, status, saved } = setup()
    const pm = await saved()
    const id = await t.mutation(api.bids.charge, { user: 'u1', bidId: 'b9', paymentMethodId: pm })
    // The scheduled try is dropped (as if its action died), and the sweep runs a quarter of an hour later.
    vi.setSystemTime(Date.now() + 15 * 60_000)
    await t.action(internal.paymentsWorker.sweep, {})
    expect((await status(id)).status).toBe('paid')
  })

  test('the comparison checks PaymentIntents: one paid at Stripe but not here, and one paid here that Stripe lacks', async () => {
    const { t, saved, charge, issues } = setup()
    const id = await charge(await saved())
    await t.action(internal.paymentsWorker.reconcile, {})
    expect(await issues()).toEqual([])
    const lost = stripe.intentElsewhere('test', 700)
    stripe.intentElsewhere('another-app', 900)
    await t.action(internal.paymentsWorker.reconcile, {})
    expect((await issues()).map((i) => [i.kind, i.paymentRef ?? i.key])).toEqual([['missing_here', lost.id]])
    stripe.forgetIntent((await t.query(api.shop.status, { id }))!.paymentRef!)
    await t.action(internal.paymentsWorker.reconcile, {})
    expect((await issues()).map((i) => [i.kind, i.checkoutId])).toEqual([
      ['missing_here', null],
      ['missing_there', id],
    ])
  })
})
