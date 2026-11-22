// Schedules against the fake processors: starting from a saved method or with a first payment that
// saves it (Stripe card and bank, PayPal card and account), the hourly run charging each period once,
// refusals retried then lapsing, hard declines lapsing at once, insufficient funds waiting for a
// payday, changes (amount, method, day, pause, resume, cancel), and a method removed at the processor.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { defined } from '../testing/app.js'
import { fakePaypal, type FakePaypal } from '../testing/fakePaypal.js'
import { fakeStripe, type FakeMethodBehaviour, type FakeStripe } from '../testing/fakeStripe.js'

const { api, internal, createTest } = defined
let stripe: FakeStripe
let pp: FakePaypal
const DAY = 24 * 60 * 60 * 1000
const at = (iso: string) => new Date(iso).getTime()

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
  const settle = () => t.finishAllScheduledFunctions(() => vi.runAllTimers())
  const calls = (name: string) => t.query(api.host.calls, {}).then((cs) => cs.filter((c) => c.name === name).map((c) => c.args))
  const schedule = async (id: string) => (await t.query(api.monthly.get, { scheduleId: id }))!
  const status = async (id: string) => (await t.query(api.shop.status, { id }))!
  /** A donor with a saved Stripe method behaving as given. */
  const saved = async (donor = 'd1', behaviour: FakeMethodBehaviour = 'ok') => {
    const { stripeCustomerId } = await t.action(api.monthly.setup, { donor })
    const pm = stripe.saveMethod(stripeCustomerId, behaviour)
    await t.action(api.monthly.verify, { donor, paymentMethodId: pm })
    return pm
  }
  /** The hourly run at a time, and the charges it queued. */
  const runAt = async (iso: string | number) => {
    vi.setSystemTime(typeof iso === 'number' ? iso : new Date(iso))
    await t.action(internal.paymentsWorker.schedules, {})
    await settle()
  }
  const start = async (pm: string, o: { amountCents?: number; firstChargeAt?: number; anchorDay?: number } = {}) => {
    const r = await t.mutation(api.monthly.start, { donor: 'd1', paymentMethodId: pm, ...o })
    await settle()
    return r
  }
  const charges = () => stripe.calls.filter((c) => c.method === 'POST' && c.path === '/v1/payment_intents')
  return { t, settle, calls, schedule, status, saved, runAt, start, charges }
}

describe('a schedule on a saved method', () => {
  test('the first charge now, then one each month on the anchor day, each period once', async () => {
    const { t, calls, schedule, status, saved, runAt, start, charges } = setup()
    const pm = await saved()
    const { scheduleId, checkoutId } = await start(pm)
    expect(await status(checkoutId!)).toMatchObject({ status: 'paid', kind: 'offSession', scheduleId, schedulePeriod: '2030-01', chargeKey: `test:schedule-${scheduleId}-2030-01` })
    expect(charges()[0].params.get('off_session')).toBe('true')
    expect(await schedule(scheduleId)).toMatchObject({ status: 'active', anchorDay: 1, period: '2030-02', lastPaidPeriod: '2030-01', nextChargeAt: at('2030-02-01T15:00:00Z') })
    expect(await calls('scheduleCharged')).toMatchObject([{ scheduleId, checkoutId, period: '2030-01', paidCents: 2500, first: true, status: 'active', context: { monthlyId: 'm-d1' } }])
    // The paid callback runs for the checkout as for any charge.
    expect(await calls('onPaid')).toMatchObject([{ checkoutId, purpose: 'donation', ref: { type: 'monthly', id: 'm-d1' } }])

    await runAt('2030-01-31T12:00:00Z')
    expect(charges()).toHaveLength(1)
    await runAt('2030-02-01T15:05:00Z')
    await runAt('2030-02-01T16:05:00Z')
    expect(charges()).toHaveLength(2)
    expect(await schedule(scheduleId)).toMatchObject({ period: '2030-03', lastPaidPeriod: '2030-02', nextChargeAt: at('2030-03-01T15:00:00Z') })
    expect((await calls('scheduleCharged')).map((c) => [c.period, c.first])).toEqual([
      ['2030-01', true],
      ['2030-02', false],
    ])
    expect(await t.query(api.monthly.list, { donor: 'd1' })).toHaveLength(1)
  })

  test('a first charge at a later date waits for it; the anchor day is kept to 28', async () => {
    const { schedule, saved, runAt, start, charges } = setup()
    const pm = await saved()
    const { scheduleId, checkoutId } = await start(pm, { firstChargeAt: at('2030-01-31T15:00:00Z') })
    expect(checkoutId).toBeNull()
    expect(await schedule(scheduleId)).toMatchObject({ status: 'active', anchorDay: 28, period: '2030-01', nextChargeAt: at('2030-01-31T15:00:00Z') })
    await runAt('2030-01-31T15:05:00Z')
    expect(charges()).toHaveLength(1)
    expect(await schedule(scheduleId)).toMatchObject({ period: '2030-02', nextChargeAt: at('2030-02-28T15:00:00Z') })
  })

  test('refusals are retried 3, 5 and 7 days after the first, each with its own key, then the schedule lapses', async () => {
    const { calls, schedule, status, saved, runAt, start, charges } = setup()
    const pm = await saved()
    const { scheduleId } = await start(pm)
    stripe.setBehaviour(pm, 'decline')
    await runAt('2030-02-01T15:05:00Z')
    const failedAt = at('2030-02-01T15:05:00Z')
    expect(await schedule(scheduleId)).toMatchObject({ status: 'past_due', period: '2030-02', failures: 1, nextChargeAt: failedAt + 3 * DAY })
    const first = (await calls('scheduleFailed'))[0]
    expect(first).toMatchObject({ attempt: 1, final: false, declineKind: 'soft', declineCode: 'card_declined', nextRetryAt: failedAt + 3 * DAY, status: 'past_due' })
    expect(await status(first.checkoutId as string)).toMatchObject({ status: 'failed', declineCode: 'card_declined', declineKind: 'soft' })
    await runAt(failedAt + 2 * DAY)
    expect(charges()).toHaveLength(2)
    await runAt(failedAt + 3 * DAY)
    await runAt(failedAt + 5 * DAY)
    await runAt(failedAt + 7 * DAY)
    const keys = charges().map((c) => c.params.get('metadata[checkoutId]'))
    expect(new Set(keys).size).toBe(5)
    expect((await calls('scheduleFailed')).map((c) => [c.attempt, c.final, c.nextRetryAt])).toEqual([
      [1, false, failedAt + 3 * DAY],
      [2, false, failedAt + 5 * DAY],
      [3, false, failedAt + 7 * DAY],
      [4, true, null],
    ])
    expect(await schedule(scheduleId)).toMatchObject({ status: 'lapsed', nextChargeAt: null, endReason: expect.any(String) })
    await runAt(failedAt + 40 * DAY)
    expect(charges()).toHaveLength(5)
  })

  test('a hard decline lapses the schedule at once', async () => {
    const { calls, schedule, saved, runAt, start } = setup()
    const lost = await saved('d1', 'ok')
    const { scheduleId } = await start(lost)
    stripe.setBehaviour(lost, 'lost')
    await runAt('2030-02-01T15:05:00Z')
    expect(await schedule(scheduleId)).toMatchObject({ status: 'lapsed' })
    expect(await calls('scheduleFailed')).toMatchObject([{ attempt: 1, final: true, declineKind: 'hard', declineCode: 'lost_card', nextRetryAt: null }])
  })

  test('insufficient funds waits for the 1st or 15th when one comes soon after the regular retry', async () => {
    const { calls, saved, start } = setup()
    vi.setSystemTime(new Date('2030-03-10T12:00:00Z'))
    const poor = await saved('d1', 'insufficient')
    await start(poor)
    // Refused on the 10th: three days on is the 13th, so the retry waits for the 15th at the charge hour.
    expect(await calls('scheduleFailed')).toMatchObject([{ declineKind: 'insufficient_funds', declineCode: 'insufficient_funds', nextRetryAt: at('2030-03-15T15:00:00Z') }])
  })

  test('a new method on a schedule being retried charges the refused period at once', async () => {
    const { t, calls, schedule, saved, runAt, start } = setup()
    const pm = await saved()
    const { scheduleId } = await start(pm)
    stripe.setBehaviour(pm, 'decline')
    await runAt('2030-02-01T15:05:00Z')
    const { stripeCustomerId } = await t.action(api.monthly.setup, { donor: 'd1' })
    const fresh = stripe.saveMethod(stripeCustomerId, 'ok')
    await t.action(api.monthly.verify, { donor: 'd1', paymentMethodId: fresh })
    await t.mutation(api.monthly.update, { scheduleId, paymentMethodId: fresh })
    expect(await calls('scheduleChanged')).toMatchObject([{ changes: ['method'], previousStatus: 'past_due', by: 'donor', paymentMethodId: fresh }])
    await runAt('2030-02-02T09:05:00Z')
    expect(await schedule(scheduleId)).toMatchObject({ status: 'active', period: '2030-03', lastPaidPeriod: '2030-02', failures: 0, paymentMethodId: fresh })
    expect((await calls('scheduleCharged')).map((c) => c.period)).toEqual(['2030-01', '2030-02'])
  })

  test('amount and day changes take effect from the next charge', async () => {
    const { t, calls, schedule, saved, runAt, start, charges } = setup()
    const pm = await saved()
    const { scheduleId } = await start(pm)
    await t.mutation(api.monthly.update, { scheduleId, amountCents: 4000, anchorDay: 10 })
    expect(await calls('scheduleChanged')).toMatchObject([{ changes: ['amount', 'anchor'], previousAmountCents: 2500, amountCents: 4000 }])
    expect(await schedule(scheduleId)).toMatchObject({ anchorDay: 10, nextChargeAt: at('2030-02-10T15:00:00Z') })
    await runAt('2030-02-10T15:05:00Z')
    expect(charges()[1].params.get('amount')).toBe('4000')
    await expect(t.mutation(api.monthly.update, { scheduleId, amountCents: 0 })).rejects.toThrow(/at least one cent/)
    await expect(t.mutation(api.monthly.update, { scheduleId, anchorDay: 31 })).rejects.toThrow(/1 to 28/)
  })

  test('a pause skips charges until its end, then the schedule resumes by itself', async () => {
    const { t, calls, schedule, saved, runAt, start, charges } = setup()
    const pm = await saved()
    const { scheduleId } = await start(pm)
    await t.mutation(api.monthly.pause, { scheduleId, until: at('2030-04-15T00:00:00Z') })
    expect(await schedule(scheduleId)).toMatchObject({ status: 'paused', pausedUntil: at('2030-04-15T00:00:00Z'), period: '2030-05', nextChargeAt: at('2030-05-01T15:00:00Z') })
    await runAt('2030-02-01T15:05:00Z')
    await runAt('2030-04-01T15:05:00Z')
    expect(charges()).toHaveLength(1)
    await runAt('2030-05-01T15:05:00Z')
    expect(charges()).toHaveLength(2)
    expect(await schedule(scheduleId)).toMatchObject({ status: 'active', period: '2030-06', pausedUntil: null })
    expect((await calls('scheduleChanged')).map((c) => [c.changes, c.by])).toEqual([
      [['paused'], 'donor'],
      [['resumed'], null],
    ])
    await expect(t.mutation(api.monthly.pause, { scheduleId, until: Date.now() - 1 })).rejects.toThrow(/future/)
  })

  test('resumed early, a paused schedule charges at its next date, never a period already paid', async () => {
    const { t, schedule, saved, runAt, start, charges } = setup()
    const pm = await saved()
    const { scheduleId } = await start(pm)
    await t.mutation(api.monthly.pause, { scheduleId, until: at('2030-06-01T00:00:00Z') })
    vi.setSystemTime(new Date('2030-01-20T12:00:00Z'))
    await t.mutation(api.monthly.resume, { scheduleId })
    expect(await schedule(scheduleId)).toMatchObject({ status: 'active', period: '2030-02', nextChargeAt: at('2030-02-01T15:00:00Z') })
    await runAt('2030-02-01T15:05:00Z')
    expect(charges()).toHaveLength(2)
    await expect(t.mutation(api.monthly.resume, { scheduleId })).rejects.toThrow(/can’t be resumed/)
  })

  test('cancelled: no more charges, the app told who and why', async () => {
    const { t, calls, schedule, saved, runAt, start, charges } = setup()
    const pm = await saved()
    const { scheduleId } = await start(pm)
    await t.mutation(api.monthly.cancel, { scheduleId, reason: 'Moving away' })
    expect(await schedule(scheduleId)).toMatchObject({ status: 'cancelled', endReason: 'Moving away', endedBy: 'donor', nextChargeAt: null })
    expect(await calls('scheduleChanged')).toMatchObject([{ changes: ['cancelled'], reason: 'Moving away', by: 'donor', status: 'cancelled', previousStatus: 'active' }])
    await runAt('2030-02-01T15:05:00Z')
    expect(charges()).toHaveLength(1)
    await expect(t.mutation(api.monthly.update, { scheduleId, amountCents: 100 })).rejects.toThrow(/cancelled/)
  })

  test('a method in use can’t be removed; one detached at Stripe cancels its schedules', async () => {
    const { t, calls, schedule, saved, start } = setup()
    const pm = await saved()
    const { scheduleId } = await start(pm)
    await expect(t.action(api.monthly.remove, { donor: 'd1', paymentMethodId: pm })).rejects.toThrow(/still uses this payment method/)
    const res = await t.fetch('/stripe/webhook', await stripe.detach(pm))
    expect(await res.text()).toBe('handled')
    expect(await schedule(scheduleId)).toMatchObject({ status: 'cancelled', endedBy: 'processor', endReason: 'The card or bank account was removed at Stripe.' })
    expect(await calls('scheduleChanged')).toMatchObject([{ changes: ['cancelled'], by: 'processor' }])
    // A method this library never saved isn't its business.
    const other = await t.fetch('/stripe/webhook', await stripe.detach(stripe.strayMethod()))
    expect(await other.text()).toBe('foreign')
  })

  test('a bank debit that bounces after the schedule moved on takes it back to that period', async () => {
    const { t, calls, schedule, saved, runAt, start } = setup()
    const bank = await saved('d1', 'bank')
    const { scheduleId, checkoutId } = await start(bank)
    // On its way: the schedule moves on, but nothing is reported paid yet.
    expect(await schedule(scheduleId)).toMatchObject({ status: 'active', period: '2030-02', lastPaidPeriod: '2030-01' })
    expect(await calls('scheduleCharged')).toEqual([])
    const pi = (await t.query(api.shop.status, { id: checkoutId! }))!.paymentRef!
    await t.fetch('/stripe/webhook', await stripe.settleBank(pi, false, 'insufficient_funds'))
    expect(await schedule(scheduleId)).toMatchObject({ status: 'past_due', period: '2030-01', failures: 1, lastPaidPeriod: null })
    expect(await calls('scheduleFailed')).toMatchObject([{ period: '2030-01', declineCode: 'insufficient_funds', declineKind: 'insufficient_funds', final: false }])
    stripe.setBehaviour(bank, 'ok')
    await runAt((await schedule(scheduleId)).nextChargeAt! + 60_000)
    expect(await schedule(scheduleId)).toMatchObject({ status: 'active', period: '2030-02', lastPaidPeriod: '2030-01' })
  })
})

describe('a schedule started with a payment that saves the method', () => {
  test('Stripe card: embedded Checkout saves it for the Customer, the schedule starts when paid', async () => {
    const { t, calls, schedule, status, runAt, charges } = setup()
    const started = await t.action(api.monthly.startCheckout, { donor: 'd1', processor: 'stripe', method: 'card' })
    if (!('embedded' in started)) throw new Error('expected an embedded checkout')
    expect(started.embedded).toMatchObject({ processor: 'stripe', clientSecret: expect.stringMatching(/_secret_/) })
    expect(await schedule(started.scheduleId)).toMatchObject({ status: 'starting', paymentMethodId: null, nextChargeAt: null })
    const params = stripe.calls.find((c) => c.path === '/v1/checkout/sessions')!.params
    expect(params.get('customer')).toMatch(/^cus_/)
    expect(params.has('customer_email')).toBe(false)
    expect(params.get('payment_intent_data[setup_future_usage]')).toBe('off_session')
    expect(params.get('ui_mode')).toBe('embedded_page')
    const session = (await status(started.checkoutId)).processorCheckoutId!
    await t.fetch('/stripe/webhook', await stripe.pay(session))
    const s = await schedule(started.scheduleId)
    expect(s).toMatchObject({ status: 'active', period: '2030-02', lastPaidPeriod: '2030-01', method: 'card', paymentMethodId: expect.stringMatching(/^pm_/) })
    expect(await calls('scheduleChanged')).toMatchObject([{ changes: ['started'], previousStatus: 'starting', status: 'active' }])
    expect(await calls('scheduleCharged')).toMatchObject([{ first: true, period: '2030-01', checkoutId: started.checkoutId }])
    // The saved card is the donor's, listed and charged next month.
    expect((await t.action(api.monthly.verify, { donor: 'd1', paymentMethodId: s.paymentMethodId! })).kind).toBe('card')
    await runAt('2030-02-01T15:05:00Z')
    expect(charges().map((c) => c.params.get('payment_method'))).toEqual([s.paymentMethodId])
    expect(await schedule(started.scheduleId)).toMatchObject({ lastPaidPeriod: '2030-02' })
  })

  test('Stripe bank account: verified at once, the schedule starts while the debit is on its way', async () => {
    const { t, calls, schedule, status } = setup()
    const started = await t.action(api.monthly.startCheckout, { donor: 'd1', processor: 'stripe', method: 'ach' })
    const params = stripe.calls.find((c) => c.path === '/v1/checkout/sessions')!.params
    expect(params.get('payment_method_options[us_bank_account][verification_method]')).toBe('instant')
    const session = (await status(started.checkoutId)).processorCheckoutId!
    await t.fetch('/stripe/webhook', await stripe.pay(session))
    expect(await schedule(started.scheduleId)).toMatchObject({ status: 'active', method: 'ach', period: '2030-02' })
    expect(await calls('scheduleCharged')).toEqual([])
    await t.fetch('/stripe/webhook', await stripe.settleBank(session, true))
    expect(await calls('scheduleCharged')).toMatchObject([{ first: true, period: '2030-01' }])
  })

  test('PayPal card: Card Fields order saved with the purchase, later charges recurring with its network reference', async () => {
    const { t, calls, schedule, runAt } = setup()
    const started = await t.action(api.monthly.startCheckout, { donor: 'd1', processor: 'paypal', method: 'card' })
    if (!('embedded' in started) || started.embedded.processor !== 'paypal') throw new Error('expected an embedded PayPal checkout')
    expect(started.embedded.only).toBe('card')
    const body = pp.calls.find((c) => c.path === '/v2/checkout/orders')!.body as { payment_source: { card: Record<string, unknown> } }
    expect(body.payment_source.card).toEqual({
      attributes: { vault: { store_in_vault: 'ON_SUCCESS' }, verification: { method: 'SCA_WHEN_REQUIRED' } },
      stored_credential: { payment_initiator: 'CUSTOMER', payment_type: 'RECURRING', usage: 'FIRST' },
      experience_context: { return_url: 'https://app.example.org/donate/thanks', cancel_url: 'https://app.example.org/donate', brand_name: 'Test shop' },
    })
    pp.approve(started.embedded.orderId)
    expect(await t.action(api.payments.completeReturn, { processor: 'paypal', token: started.embedded.orderId })).toMatchObject({ status: 'paid' })
    const s = await schedule(started.scheduleId)
    expect(s).toMatchObject({ status: 'active', processor: 'paypal', method: 'card', paymentMethodId: expect.stringMatching(/^paypal:/) })
    expect(await calls('scheduleCharged')).toMatchObject([{ first: true }])
    await runAt('2030-02-01T15:05:00Z')
    expect(pp.vaultCharges).toHaveLength(1)
    expect((pp.vaultCharges[0].body as { payment_source: unknown }).payment_source).toEqual({
      card: {
        vault_id: s.paymentMethodId!.slice('paypal:'.length),
        stored_credential: {
          payment_initiator: 'MERCHANT',
          payment_type: 'RECURRING',
          usage: 'SUBSEQUENT',
          previous_network_transaction_reference: { id: expect.stringMatching(/^FAKENTR/), network: 'VISA' },
        },
      },
    })
    expect(await schedule(started.scheduleId)).toMatchObject({ lastPaidPeriod: '2030-02' })
  })

  test('PayPal account: agrees to recurring charges, saved when the webhook captures, charged with its agreement', async () => {
    const { t, schedule, runAt } = setup()
    const started = await t.action(api.monthly.startCheckout, { donor: 'd1', processor: 'paypal', method: 'paypal' })
    if (!('embedded' in started) || started.embedded.processor !== 'paypal') throw new Error('expected an embedded PayPal checkout')
    expect(started.embedded.only).toBe('paypal')
    const body = pp.calls.find((c) => c.path === '/v2/checkout/orders')!.body as { payment_source: { paypal: { attributes: { vault: Record<string, unknown> } } } }
    expect(body.payment_source.paypal.attributes.vault).toMatchObject({ store_in_vault: 'ON_SUCCESS', usage_type: 'MERCHANT', usage_pattern: 'RECURRING_PREPAID' })
    await t.fetch('/paypal/webhook', pp.approve(started.embedded.orderId))
    const s = await schedule(started.scheduleId)
    expect(s).toMatchObject({ status: 'active', method: 'paypal', paymentMethodId: expect.stringMatching(/^paypal:/) })
    await runAt('2030-02-01T15:05:00Z')
    expect((pp.vaultCharges[0].body as { payment_source: unknown }).payment_source).toEqual({
      paypal: { vault_id: s.paymentMethodId!.slice('paypal:'.length), stored_credential: { payment_initiator: 'MERCHANT', usage: 'SUBSEQUENT', usage_pattern: 'RECURRING_PREPAID' } },
    })
  })

  test('removed at PayPal: VAULT.PAYMENT-TOKEN.DELETED cancels the schedule', async () => {
    const { t, schedule } = setup()
    const started = await t.action(api.monthly.startCheckout, { donor: 'd1', processor: 'paypal', method: 'paypal' })
    if (!('embedded' in started) || started.embedded.processor !== 'paypal') throw new Error('expected an embedded PayPal checkout')
    await t.fetch('/paypal/webhook', pp.approve(started.embedded.orderId))
    const s = await schedule(started.scheduleId)
    const res = await t.fetch('/paypal/webhook', pp.deleteToken(s.paymentMethodId!.slice('paypal:'.length)))
    expect(await res.text()).toBe('handled')
    expect(await schedule(started.scheduleId)).toMatchObject({ status: 'cancelled', endedBy: 'processor' })
  })

  test('a first payment the payer turns back from: the schedule never starts', async () => {
    const { t, calls, schedule } = setup()
    const started = await t.action(api.monthly.startCheckout, { donor: 'd1', processor: 'stripe', method: 'card' })
    await t.action(api.payments.cancelCheckout, { checkoutId: started.checkoutId })
    expect(await schedule(started.scheduleId)).toMatchObject({ status: 'cancelled', endReason: 'The first payment wasn’t completed.' })
    expect(await calls('scheduleChanged')).toMatchObject([{ changes: ['not_started'], previousStatus: 'starting' }])
  })

  test('the processor is the app’s choice, and only one that takes the method', async () => {
    const { t } = setup()
    await expect(t.action(api.monthly.startCheckout, { donor: 'd1', processor: 'paypal', method: 'ach' })).rejects.toThrow(/PayPal doesn’t take ach/)
    expect(await t.query(api.bids.cardProcessor, { amountCents: 2500 })).toMatchObject({ processor: expect.stringMatching(/stripe|paypal/) })
  })
})
