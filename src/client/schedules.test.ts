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

  test('the view names its method as savedMethods does', async () => {
    const { t, schedule, saved, start } = setup()
    const pm = await saved()
    const { scheduleId } = await start(pm)
    const [method] = await t.action(api.monthly.methods, { donor: 'd1' })
    expect(await schedule(scheduleId)).toMatchObject({ paymentMethodId: pm, methodLabel: method.label })
  })

  test('changeScheduleMethod: a new Stripe card, checked as the owner’s, saved and switched to in one call, with a new amount', async () => {
    const { t, schedule, calls, saved, start } = setup()
    const { scheduleId } = await start(await saved())
    const { stripeCustomerId } = await t.action(api.monthly.setup, { donor: 'd1' })
    const fresh = stripe.saveMethod(stripeCustomerId)
    const view = await t.action(api.monthly.changeMethod, { scheduleId, paymentMethodId: fresh, amountCents: 3100 })
    expect(view).toMatchObject({ paymentMethodId: fresh, amountCents: 3100, methodLabel: expect.any(String) })
    expect(await schedule(scheduleId)).toMatchObject({ paymentMethodId: fresh, amountCents: 3100 })
    expect((await calls('scheduleChanged')).at(-1)).toMatchObject({ changes: expect.arrayContaining(['amount', 'method']) })
    const { stripeCustomerId: someoneElse } = await t.action(api.monthly.setup, { donor: 'd2' })
    await expect(t.action(api.monthly.changeMethod, { scheduleId, paymentMethodId: stripe.saveMethod(someoneElse) })).rejects.toThrow(/couldn’t be used/)
    expect(await schedule(scheduleId)).toMatchObject({ paymentMethodId: fresh })
  })

  test('changeScheduleMethod: a PayPal setup token is saved to the owner’s vault and the schedule switched to it', async () => {
    const { t, schedule, saved, start } = setup()
    const { scheduleId } = await start(await saved())
    const { setupTokenId } = await t.action(api.monthly.paypalSetup, { donor: 'd1', kind: 'card' })
    pp.approveSetup(setupTokenId, { card: { last4: '0004' } })
    const view = await t.action(api.monthly.changeMethod, { scheduleId, paypalSetupTokenId: setupTokenId })
    expect(view).toMatchObject({ processor: 'paypal', method: 'card', paymentMethodId: expect.stringMatching(/^paypal:/), methodLabel: expect.stringContaining('0004') })
    expect(await schedule(scheduleId)).toMatchObject({ processor: 'paypal', paymentMethodId: view.paymentMethodId })
    await expect(t.action(api.monthly.changeMethod, { scheduleId })).rejects.toThrow(/one new method/)
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

  test('Stripe on-page: a PaymentIntent for the Customer saved for later, made at the press; the schedule starts when it is paid', async () => {
    const { t, calls, schedule, status, runAt, charges } = setup()
    const started = await t.action(api.monthly.startCheckout, { donor: 'd1', processor: 'stripe', method: 'card', ui: 'onPage' })
    if (!('onPage' in started) || started.onPage.processor !== 'stripe') throw new Error('expected an on-page Stripe payment')
    expect(started).toMatchObject({ reused: false, onPage: { clientSecret: expect.stringMatching(/_secret_/), returnUrl: 'https://app.example.org/donate/thanks' } })
    expect(await schedule(started.scheduleId)).toMatchObject({ status: 'starting', paymentMethodId: null })
    expect(stripe.calls.some((c) => c.path === '/v1/checkout/sessions')).toBe(false)
    const params = charges()[0].params
    expect(params.get('customer')).toMatch(/^cus_/)
    expect(params.get('setup_future_usage')).toBe('off_session')
    expect(params.get('allowed_payment_method_types[0]')).toBe('card')
    const pi = (await status(started.checkoutId)).processorCheckoutId!
    await t.fetch('/stripe/webhook', await stripe.confirm(pi))
    const s = await schedule(started.scheduleId)
    expect(s).toMatchObject({ status: 'active', period: '2030-02', lastPaidPeriod: '2030-01', method: 'card', paymentMethodId: expect.stringMatching(/^pm_/) })
    expect(await calls('scheduleChanged')).toMatchObject([{ changes: ['started'], previousStatus: 'starting', status: 'active' }])
    expect(await calls('scheduleCharged')).toMatchObject([{ first: true, period: '2030-01', checkoutId: started.checkoutId }])
    expect((await t.action(api.monthly.verify, { donor: 'd1', paymentMethodId: s.paymentMethodId! })).kind).toBe('card')
    await runAt('2030-02-01T15:05:00Z')
    expect(
      charges()
        .slice(1)
        .map((c) => c.params.get('payment_method')),
    ).toEqual([s.paymentMethodId])
    expect(await schedule(started.scheduleId)).toMatchObject({ lastPaidPeriod: '2030-02' })
  })

  test('Stripe on-page, paid through the return page (3-D Secure, a bank login): the method is saved before it settles', async () => {
    const { t, schedule, status } = setup()
    const started = await t.action(api.monthly.startCheckout, { donor: 'd1', processor: 'stripe', method: 'ach', ui: 'onPage' })
    const pi = (await status(started.checkoutId)).processorCheckoutId!
    await stripe.confirm(pi, 'bank')
    expect(await t.action(api.payments.completeReturn, { processor: 'stripe', token: pi })).toMatchObject({ status: 'processing' })
    expect(await schedule(started.scheduleId)).toMatchObject({ status: 'active', method: 'ach', paymentMethodId: expect.stringMatching(/^pm_/) })
  })

  test('on-page: a press with the same amount reuses the checkout and its schedule; a changed amount ends both and starts afresh', async () => {
    const { t, calls, schedule, status, charges } = setup()
    const first = await t.action(api.monthly.startCheckout, { donor: 'd1', processor: 'stripe', method: 'card', ui: 'onPage' })
    const pi = (await status(first.checkoutId)).processorCheckoutId!
    await t.fetch('/stripe/webhook', await stripe.confirm(pi, 'decline'))
    const again = await t.action(api.monthly.startCheckout, { donor: 'd1', processor: 'stripe', method: 'card', ui: 'onPage', replaces: first.checkoutId })
    expect(again).toEqual({ ...first, reused: true })
    expect(charges()).toHaveLength(1)
    expect(await t.query(api.monthly.list, { donor: 'd1' })).toHaveLength(1)
    const changed = await t.action(api.monthly.startCheckout, { donor: 'd1', processor: 'stripe', method: 'card', amountCents: 5000, ui: 'onPage', replaces: first.checkoutId })
    expect(changed).toMatchObject({ reused: false })
    expect(changed.scheduleId).not.toBe(first.scheduleId)
    expect((await status(first.checkoutId)).status).toBe('abandoned')
    expect(await schedule(first.scheduleId)).toMatchObject({ status: 'cancelled' })
    expect(await calls('scheduleChanged')).toEqual([])
    expect(await schedule(changed.scheduleId)).toMatchObject({ status: 'starting', amountCents: 5000 })
    await t.fetch('/stripe/webhook', await stripe.confirm((await status(changed.checkoutId)).processorCheckoutId!))
    expect(await schedule(changed.scheduleId)).toMatchObject({ status: 'active', amountCents: 5000 })
  })

  test('on-page: a second press naming a first payment already replaced gets the replacing checkout and schedule back, and keeps no extra schedule', async () => {
    const { t, status } = setup()
    const first = await t.action(api.monthly.startCheckout, { donor: 'd1', processor: 'stripe', method: 'card', ui: 'onPage' })
    const one = await t.action(api.monthly.startCheckout, { donor: 'd1', processor: 'stripe', method: 'card', amountCents: 5000, ui: 'onPage', replaces: first.checkoutId })
    const two = await t.action(api.monthly.startCheckout, { donor: 'd1', processor: 'stripe', method: 'card', amountCents: 5000, ui: 'onPage', replaces: first.checkoutId })
    expect(one).toMatchObject({ reused: false })
    expect(two).toEqual({ ...one, reused: true })
    expect((await status(first.checkoutId)).status).toBe('abandoned')
    expect((await t.query(api.monthly.list, { donor: 'd1' })).map((s) => s.status).sort()).toEqual(['cancelled', 'starting'])
  })

  test('on-page: a changed anchor day or context is not reused; the starting schedule ends and a fresh one starts', async () => {
    const { t, schedule, status } = setup()
    const first = await t.action(api.monthly.startCheckout, { donor: 'd1', processor: 'stripe', method: 'card', ui: 'onPage', anchorDay: 5 })
    const moved = await t.action(api.monthly.startCheckout, { donor: 'd1', processor: 'stripe', method: 'card', ui: 'onPage', anchorDay: 6, replaces: first.checkoutId })
    expect(moved).toMatchObject({ reused: false })
    expect((await status(first.checkoutId)).status).toBe('abandoned')
    expect(await schedule(first.scheduleId)).toMatchObject({ status: 'cancelled' })
    const noted = await t.action(api.monthly.startCheckout, { donor: 'd1', processor: 'stripe', method: 'card', ui: 'onPage', anchorDay: 6, note: 'n', replaces: moved.checkoutId })
    expect(noted).toMatchObject({ reused: false })
    expect((await status(moved.checkoutId)).status).toBe('abandoned')
  })

  test('on-page: a schedule’s payment is not reused for a one-off, nor a one-off’s for a schedule', async () => {
    const { t, status } = setup()
    const monthly = await t.action(api.monthly.startCheckout, { donor: 'd1', processor: 'stripe', method: 'card', ui: 'onPage' })
    const oneOff = await t.action(api.shop.buyOnPage, {
      processor: 'stripe',
      method: 'card',
      refType: 'monthly',
      refId: 'm-d1',
      purpose: 'donation',
      description: 'Monthly gift',
      email: 'd1@example.org',
      context: { monthlyId: 'm-d1' },
      replaces: monthly.checkoutId,
    })
    expect(oneOff.reused).toBe(false)
    expect((await status(monthly.checkoutId)).status).toBe('abandoned')
    const monthlyAgain = await t.action(api.monthly.startCheckout, { donor: 'd1', processor: 'stripe', method: 'card', ui: 'onPage', replaces: oneOff.checkoutId })
    expect(monthlyAgain).toMatchObject({ reused: false })
    expect((await status(oneOff.checkoutId)).status).toBe('abandoned')
  })

  test('PayPal card on-page: the same vault-with-purchase order as embedded, only Card Fields may pay it', async () => {
    const { t, schedule } = setup()
    const started = await t.action(api.monthly.startCheckout, { donor: 'd1', processor: 'paypal', method: 'card', ui: 'onPage' })
    if (!('onPage' in started) || started.onPage.processor !== 'paypal') throw new Error('expected an on-page PayPal payment')
    expect(started.onPage.only).toBe('card')
    const body = pp.calls.find((c) => c.path === '/v2/checkout/orders')!.body as { payment_source: { card: { attributes: Record<string, unknown> } } }
    expect(body.payment_source.card.attributes).toMatchObject({ vault: { store_in_vault: 'ON_SUCCESS' } })
    pp.approve(started.onPage.orderId)
    expect(await t.action(api.payments.completeReturn, { processor: 'paypal', token: started.onPage.orderId })).toMatchObject({ status: 'paid' })
    expect(await schedule(started.scheduleId)).toMatchObject({ status: 'active', processor: 'paypal', method: 'card', paymentMethodId: expect.stringMatching(/^paypal:/) })
  })

  test('the processor is the app’s choice, and only one that takes the method', async () => {
    const { t } = setup()
    await expect(t.action(api.monthly.startCheckout, { donor: 'd1', processor: 'paypal', method: 'ach' })).rejects.toThrow(/PayPal doesn’t take ach/)
    expect(await t.query(api.bids.cardProcessor, { amountCents: 2500 })).toMatchObject({ processor: expect.stringMatching(/stripe|paypal/) })
  })
})

describe('startOnPage: one ref for the whole attempt, one-off or monthly', () => {
  type Press = { processor?: 'stripe' | 'paypal'; method?: 'card' | 'ach' | 'paypal'; amountCents?: number; monthly?: boolean; replaces?: string }
  const press = (t: ReturnType<typeof setup>['t'], a: Press = {}) => t.action(api.give.onPage, { processor: 'stripe', method: 'card', ...a })

  test('switching one-off and monthly is another press with replaces: the last press’s payment and schedule close, and the same press again reuses', async () => {
    const { t, calls, schedule, status } = setup()
    const oneOff = await press(t)
    expect(oneOff).toMatchObject({ reused: false })
    expect(oneOff).not.toHaveProperty('scheduleId')
    const monthly = await press(t, { monthly: true, replaces: oneOff.checkoutId })
    expect(monthly).toMatchObject({ reused: false, scheduleId: expect.any(String) })
    expect((await status(oneOff.checkoutId)).status).toBe('abandoned')
    expect(await schedule(monthly.scheduleId!)).toMatchObject({ status: 'starting', owner: { type: 'donor', id: 'd1' }, ref: { type: 'gift', id: 'g1' } })
    expect(await press(t, { monthly: true, replaces: monthly.checkoutId })).toEqual({ ...monthly, reused: true })
    const back = await press(t, { replaces: oneOff.checkoutId })
    expect(back).toMatchObject({ reused: false })
    expect((await status(monthly.checkoutId)).status).toBe('abandoned')
    expect(await schedule(monthly.scheduleId!)).toMatchObject({ status: 'cancelled' })
    await t.fetch('/stripe/webhook', await stripe.confirm((await status(back.checkoutId)).processorCheckoutId!))
    expect(await calls('onPaid')).toHaveLength(1)
    expect(await calls('scheduleChanged')).toEqual([])
  })

  test('a late payment on a checkout a press replaced is owed back: one onPaid for the attempt', async () => {
    const { t, calls, status } = setup()
    const first = await press(t)
    const second = await press(t, { amountCents: 3000, replaces: first.checkoutId })
    await t.fetch('/stripe/webhook', await stripe.confirm((await status(second.checkoutId)).processorCheckoutId!))
    await t.fetch('/stripe/webhook', await stripe.confirm((await status(first.checkoutId)).processorCheckoutId!))
    expect(await status(second.checkoutId)).toMatchObject({ status: 'paid' })
    expect(await status(first.checkoutId)).toMatchObject({ status: 'refund_needed' })
    expect(await calls('onPaid')).toHaveLength(1)
    expect(await calls('onRefundNeeded')).toMatchObject([{ checkoutId: first.checkoutId, reason: 'This was already paid by another payment.' }])
  })

  test('the first payment to settle is the one paid, even on a replaced checkout; the open one is closed (canceled at Stripe) and a payment on it is owed back', async () => {
    const { t, calls, schedule, status } = setup()
    const monthly = await press(t, { monthly: true })
    const oneOff = await press(t, { replaces: monthly.checkoutId })
    const openPi = (await status(oneOff.checkoutId)).processorCheckoutId!
    await t.fetch('/stripe/webhook', await stripe.confirm((await status(monthly.checkoutId)).processorCheckoutId!))
    expect(await status(monthly.checkoutId)).toMatchObject({ status: 'paid' })
    expect(await schedule(monthly.scheduleId!)).toMatchObject({ status: 'active' })
    expect(await calls('scheduleChanged')).toMatchObject([{ scheduleId: monthly.scheduleId, changes: ['started'] }])
    expect(await status(oneOff.checkoutId)).toMatchObject({ status: 'abandoned' })
    expect(stripe.calls.some((x) => x.path === `/v1/payment_intents/${openPi}/cancel`)).toBe(true)
    await t.fetch('/stripe/webhook', await stripe.confirm(openPi))
    expect(await status(oneOff.checkoutId)).toMatchObject({ status: 'refund_needed' })
    expect(await calls('onPaid')).toHaveLength(1)
  })

  test('once a payment in the chain came first, the next press naming the closed checkout is told it is paid, not given a new payment', async () => {
    const { t, status } = setup()
    const first = await press(t)
    const second = await press(t, { amountCents: 3000, replaces: first.checkoutId })
    await t.fetch('/stripe/webhook', await stripe.confirm((await status(first.checkoutId)).processorCheckoutId!))
    expect(await status(second.checkoutId)).toMatchObject({ status: 'abandoned' })
    await expect(press(t, { amountCents: 3000, replaces: second.checkoutId })).rejects.toThrow('This is already paid.')
    await expect(press(t, { monthly: true, replaces: second.checkoutId })).rejects.toThrow('This is already paid.')
  })

  test('two bank payments on their way: the first stays the one paid, and the one that came second is owed back', async () => {
    const { t, calls, status } = setup()
    const a = await press(t, { method: 'ach' })
    const b = await press(t, { method: 'ach', amountCents: 3000, replaces: a.checkoutId })
    const piA = (await status(a.checkoutId)).processorCheckoutId!
    const piB = (await status(b.checkoutId)).processorCheckoutId!
    await t.fetch('/stripe/webhook', await stripe.confirm(piA, 'bank'))
    await t.fetch('/stripe/webhook', await stripe.confirm(piB, 'bank'))
    await t.fetch('/stripe/webhook', await stripe.settleBank(piA, true))
    expect(await status(a.checkoutId)).toMatchObject({ status: 'paid' })
    await t.fetch('/stripe/webhook', await stripe.settleBank(piB, true))
    expect(await status(b.checkoutId)).toMatchObject({ status: 'refund_needed' })
    expect(await calls('onPaid')).toMatchObject([{ checkoutId: a.checkoutId }])
    expect(await calls('onProcessing')).toMatchObject([{ checkoutId: a.checkoutId }])
  })

  test('a payment the buyer cancelled (Edit) before pressing again is owed back when it arrives, and its schedule stays ended', async () => {
    const { t, calls, schedule, status } = setup()
    const first = await press(t, { monthly: true })
    await t.action(api.payments.cancelCheckout, { checkoutId: first.checkoutId })
    const again = await press(t, { monthly: true, amountCents: 3000, replaces: first.checkoutId })
    expect(again.reused).toBe(false)
    await t.fetch('/stripe/webhook', await stripe.confirm((await status(first.checkoutId)).processorCheckoutId!))
    expect(await status(first.checkoutId)).toMatchObject({ status: 'refund_needed', lastError: 'The buyer cancelled this payment before it arrived.' })
    expect(await schedule(first.scheduleId!)).toMatchObject({ status: 'cancelled' })
    expect(await calls('onPaid')).toEqual([])
  })

  test('a bank payment on its way counts as the first: a later card payment in the chain is owed back', async () => {
    const { t, calls, status } = setup()
    const bank = await press(t, { method: 'ach' })
    const card = await press(t, { replaces: bank.checkoutId })
    await t.fetch('/stripe/webhook', await stripe.confirm((await status(bank.checkoutId)).processorCheckoutId!, 'bank'))
    expect(await status(bank.checkoutId)).toMatchObject({ status: 'processing' })
    expect(await status(card.checkoutId)).toMatchObject({ status: 'abandoned' })
    await t.fetch('/stripe/webhook', await stripe.confirm((await status(card.checkoutId)).processorCheckoutId!))
    expect(await status(card.checkoutId)).toMatchObject({ status: 'refund_needed' })
    expect(await calls('onProcessing')).toHaveLength(1)
    expect(await calls('onPaid')).toHaveLength(0)
  })
})

describe('PayPal saves the method after the first payment (vault APPROVED)', () => {
  const startSavedLater = async (t: ReturnType<typeof setup>['t'], method: 'card' | 'paypal' = 'paypal') => {
    pp.savesWithPurchaseLater()
    const started = await t.action(api.monthly.startCheckout, { donor: 'd1', processor: 'paypal', method })
    if (!('embedded' in started) || started.embedded.processor !== 'paypal') throw new Error('expected an embedded PayPal checkout')
    await t.fetch('/paypal/webhook', pp.approve(started.embedded.orderId))
    return { scheduleId: started.scheduleId, orderId: started.embedded.orderId }
  }
  const hook = async (t: ReturnType<typeof setup>['t'], init: RequestInit) => await (await t.fetch('/paypal/webhook', init)).text()

  test('the schedule starts and waits; VAULT.PAYMENT-TOKEN.CREATED brings the account, and next month charges it', async () => {
    const { t, calls, schedule, runAt } = setup()
    const { scheduleId, orderId } = await startSavedLater(t)
    expect(await schedule(scheduleId)).toMatchObject({ status: 'active', paymentMethodId: null, lastPaidPeriod: '2030-01' })
    expect(await calls('scheduleCharged')).toMatchObject([{ first: true, period: '2030-01' }])
    expect(await hook(t, pp.deliverVault(orderId))).toBe('handled')
    const s = await schedule(scheduleId)
    expect(s).toMatchObject({ status: 'active', method: 'paypal', paymentMethodId: expect.stringMatching(/^paypal:/), nextChargeAt: at('2030-02-01T15:00:00Z') })
    await runAt('2030-02-01T15:05:00Z')
    expect(pp.vaultCharges).toHaveLength(1)
    expect((pp.vaultCharges[0].body as { payment_source: unknown }).payment_source).toEqual({
      paypal: { vault_id: s.paymentMethodId!.slice('paypal:'.length), stored_credential: { payment_initiator: 'MERCHANT', usage: 'SUBSEQUENT', usage_pattern: 'RECURRING_PREPAID' } },
    })
    expect(await schedule(scheduleId)).toMatchObject({ lastPaidPeriod: '2030-02' })
    expect(await calls('scheduleFailed')).toEqual([])
  })

  test('a card saved later keeps the first payment’s network reference; the same event again, or another for the same token, changes nothing', async () => {
    const { t, schedule, runAt } = setup()
    const { scheduleId, orderId } = await startSavedLater(t, 'card')
    const delivered = pp.deliverVault(orderId, { eventId: 'WH-SAME' })
    expect(await hook(t, delivered)).toBe('handled')
    const s = await schedule(scheduleId)
    expect(await hook(t, pp.deliverVault(orderId, { eventId: 'WH-SAME' }))).toBe('Already handled')
    expect(await hook(t, pp.deliverVault(orderId))).toBe('handled')
    expect(await schedule(scheduleId)).toMatchObject({ paymentMethodId: s.paymentMethodId, method: 'card' })
    await runAt('2030-02-01T15:05:00Z')
    expect(pp.vaultCharges).toHaveLength(1)
    expect((pp.vaultCharges[0].body as { payment_source: { card: { stored_credential: unknown } } }).payment_source.card.stored_credential).toMatchObject({
      previous_network_transaction_reference: { id: expect.stringMatching(/^FAKENTR/), network: 'VISA' },
    })
  })

  test('the token never comes: three days on the payer is asked for another method, and nothing is charged', async () => {
    const { t, calls, schedule, runAt } = setup()
    const { scheduleId, orderId } = await startSavedLater(t)
    await runAt('2030-01-03T12:05:00Z')
    await runAt('2030-01-04T11:05:00Z')
    expect(await calls('scheduleFailed')).toEqual([])
    await runAt('2030-01-04T12:05:00Z')
    expect(await calls('scheduleFailed')).toMatchObject([{ checkoutId: null, attempt: 1, final: true, declineCode: 'METHOD_NOT_SAVED', reason: 'PayPal didn’t finish saving the payment method.' }])
    expect(await schedule(scheduleId)).toMatchObject({ status: 'lapsed', paymentMethodId: null })
    await runAt('2030-02-01T15:05:00Z')
    expect(pp.vaultCharges).toHaveLength(0)
    // A token that arrives after all is kept as the donor's, for the app to offer; it doesn't revive the schedule by itself.
    expect(await hook(t, pp.deliverVault(orderId))).toBe('handled')
    expect(await schedule(scheduleId)).toMatchObject({ status: 'lapsed', paymentMethodId: null })
    const token = pp.vault().at(-1)!.id
    expect(await t.mutation(api.monthly.update, { scheduleId, paymentMethodId: `paypal:${token}` })).toMatchObject({ status: 'active' })
  })

  test('a brand-new payer’s token is found by reading the order again, with no webhook naming it; next month charges it', async () => {
    const { t, calls, schedule, runAt } = setup()
    const { scheduleId, orderId } = await startSavedLater(t)
    await runAt('2030-01-01T13:05:00Z')
    expect(await schedule(scheduleId)).toMatchObject({ paymentMethodId: null })
    // The event names no order, and a payer saving for the first time has no PayPal customer the library knows.
    expect(await hook(t, pp.deliverVault(orderId, { withOrderId: false }))).toBe('foreign')
    expect(await schedule(scheduleId)).toMatchObject({ paymentMethodId: null })
    await runAt('2030-01-01T14:05:00Z')
    const token = pp.vault().at(-1)!.id
    expect(await schedule(scheduleId)).toMatchObject({ status: 'active', method: 'paypal', paymentMethodId: `paypal:${token}`, nextChargeAt: at('2030-02-01T15:00:00Z') })
    expect(pp.calls.filter((c) => c.method === 'GET' && c.path === `/v2/checkout/orders/${orderId}`).length).toBeGreaterThanOrEqual(2)
    await runAt('2030-02-01T15:05:00Z')
    expect(pp.vaultCharges).toHaveLength(1)
    expect(await schedule(scheduleId)).toMatchObject({ lastPaidPeriod: '2030-02' })
    expect(await calls('scheduleFailed')).toEqual([])
  })

  test('the order is read again minutes after the payment, so a save PayPal finishes quickly is attached before the hourly run', async () => {
    const { t, schedule, settle } = setup()
    const { scheduleId, orderId } = await startSavedLater(t, 'card')
    pp.finishSave(orderId)
    await settle()
    expect(await schedule(scheduleId)).toMatchObject({ method: 'card', paymentMethodId: `paypal:${pp.vault().at(-1)!.id}` })
  })

  test('the order read and the webhook both bring the token: it is saved once', async () => {
    const { t, schedule, runAt } = setup()
    const { scheduleId, orderId } = await startSavedLater(t)
    pp.finishSave(orderId)
    await runAt('2030-01-01T13:05:00Z')
    const { paymentMethodId } = await schedule(scheduleId)
    expect(paymentMethodId).toMatch(/^paypal:/)
    expect(await hook(t, pp.deliverVault(orderId))).toBe('handled')
    expect(await schedule(scheduleId)).toMatchObject({ paymentMethodId })
    expect((await t.action(api.monthly.methods, { donor: 'd1' })).map((m) => m.paymentMethodId)).toEqual([paymentMethodId])
  })

  test('the order can’t be read: the schedule keeps waiting, then fails as METHOD_NOT_SAVED with nothing charged', async () => {
    const { t, calls, schedule, runAt } = setup()
    const { scheduleId, orderId } = await startSavedLater(t)
    pp.finishSave(orderId)
    const reads = () => pp.calls.filter((c) => c.method === 'GET' && c.path === `/v2/checkout/orders/${orderId}`).length
    const before = reads()
    pp.refuse(({ method, path }) =>
      method === 'GET' && path === `/v2/checkout/orders/${orderId}` ? new Response(JSON.stringify({ name: 'INTERNAL_SERVER_ERROR', message: 'Down' }), { status: 500 }) : undefined,
    )
    for (const when of ['2030-01-01T13:05:00Z', '2030-01-02T13:05:00Z', '2030-01-04T11:05:00Z']) await runAt(when)
    expect(reads() - before).toBeGreaterThanOrEqual(3)
    expect(await calls('scheduleFailed')).toEqual([])
    expect(await schedule(scheduleId)).toMatchObject({ status: 'active', paymentMethodId: null })
    await runAt('2030-01-04T12:05:00Z')
    expect(await calls('scheduleFailed')).toMatchObject([{ checkoutId: null, final: true, declineCode: 'METHOD_NOT_SAVED', declineKind: 'hard' }])
    expect(await schedule(scheduleId)).toMatchObject({ status: 'lapsed', paymentMethodId: null })
    expect(pp.vaultCharges).toHaveLength(0)
  })

  test('paused while waiting: when the pause ends after the wait, the order is read once more before the payer is asked', async () => {
    const { t, calls, schedule, runAt } = setup()
    const { scheduleId, orderId } = await startSavedLater(t)
    await t.mutation(api.monthly.pause, { scheduleId, until: at('2030-01-20T00:00:00Z') })
    pp.finishSave(orderId)
    await runAt('2030-02-01T15:05:00Z')
    expect(await calls('scheduleFailed')).toEqual([])
    expect(await schedule(scheduleId)).toMatchObject({ status: 'active', paymentMethodId: `paypal:${pp.vault().at(-1)!.id}` })
    await runAt('2030-02-01T16:05:00Z')
    expect(pp.vaultCharges).toHaveLength(1)
  })

  test('paused while waiting, and still not saved after the last read: the payer is asked, nothing is charged', async () => {
    const { t, calls, schedule, runAt } = setup()
    const { scheduleId, orderId } = await startSavedLater(t)
    await t.mutation(api.monthly.pause, { scheduleId, until: at('2030-01-20T00:00:00Z') })
    const reads = () => pp.calls.filter((c) => c.method === 'GET' && c.path === `/v2/checkout/orders/${orderId}`).length
    const before = reads()
    await runAt('2030-02-01T15:05:00Z')
    expect(reads()).toBeGreaterThan(before)
    expect(await calls('scheduleFailed')).toEqual([])
    await runAt('2030-02-01T16:05:00Z')
    expect(await calls('scheduleFailed')).toMatchObject([{ checkoutId: null, final: true, declineCode: 'METHOD_NOT_SAVED' }])
    expect(await schedule(scheduleId)).toMatchObject({ status: 'lapsed', paymentMethodId: null })
    expect(pp.vaultCharges).toHaveLength(0)
  })

  test('a token for an order and customer this app doesn’t know is foreign', async () => {
    const { t } = setup()
    expect(await hook(t, pp.event('VAULT.PAYMENT-TOKEN.CREATED', { id: 'stranger', customer: { id: 'NOBODY' }, metadata: { order_id: 'NOT-OURS' } }))).toBe('foreign')
  })

  test('without an order id it is matched by PayPal customer, and never guessed between two schedules', async () => {
    const { t, schedule } = setup()
    // A first schedule saved at once gives the donor a PayPal customer, which later orders carry.
    const first = await t.action(api.monthly.startCheckout, { donor: 'd1', processor: 'paypal', method: 'paypal' })
    if (!('embedded' in first) || first.embedded.processor !== 'paypal') throw new Error('expected an embedded PayPal checkout')
    await t.fetch('/paypal/webhook', pp.approve(first.embedded.orderId))
    const a = await startSavedLater(t)
    const b = await startSavedLater(t)
    expect(await hook(t, pp.deliverVault(a.orderId, { withOrderId: false }))).toBe('ignored')
    expect(await schedule(a.scheduleId)).toMatchObject({ paymentMethodId: null })
    expect(await schedule(b.scheduleId)).toMatchObject({ paymentMethodId: null })
    expect(await hook(t, pp.deliverVault(a.orderId))).toBe('handled')
    expect(await hook(t, pp.deliverVault(b.orderId, { withOrderId: false }))).toBe('handled')
    const [sa, sb] = [await schedule(a.scheduleId), await schedule(b.scheduleId)]
    expect(sa.paymentMethodId).toMatch(/^paypal:/)
    expect(sb.paymentMethodId).toMatch(/^paypal:/)
    expect(sa.paymentMethodId).not.toBe(sb.paymentMethodId)
  })
})

describe('one payment per period', () => {
  test('an on-session retry of a refused period pays that period, and the schedule moves on', async () => {
    const { t, calls, schedule, status, saved, runAt, start, charges } = setup()
    const pm = await saved()
    const { scheduleId } = await start(pm)
    stripe.setBehaviour(pm, 'decline')
    await runAt('2030-02-01T15:05:00Z')
    const refused = (await calls('scheduleFailed'))[0].checkoutId as string
    const retry = await t.action(api.bids.retry, { checkoutId: refused })
    expect(await status(retry.checkoutId)).toMatchObject({ kind: 'onSession', scheduleId, schedulePeriod: '2030-02' })
    await t.fetch('/stripe/webhook', await stripe.confirm((await status(retry.checkoutId)).processorCheckoutId!, 'ok'))
    expect(await status(retry.checkoutId)).toMatchObject({ status: 'paid' })
    expect(await schedule(scheduleId)).toMatchObject({ status: 'active', period: '2030-03', lastPaidPeriod: '2030-02' })
    expect((await calls('scheduleCharged')).map((c) => c.period)).toEqual(['2030-01', '2030-02'])
    await runAt('2030-02-04T15:05:00Z')
    expect(charges().filter((c) => c.params.get('off_session') === 'true')).toHaveLength(2)
  })

  test('an on-session retry paid after the period’s own retry paid it is owed back, and isn’t reported as a refusal', async () => {
    const { t, settle, calls, schedule, status, saved, runAt, start } = setup()
    const pm = await saved()
    const { scheduleId } = await start(pm)
    stripe.setBehaviour(pm, 'decline')
    await runAt('2030-02-01T15:05:00Z')
    const refused = (await calls('scheduleFailed'))[0].checkoutId as string
    stripe.setBehaviour(pm, 'ok')
    vi.setSystemTime(at('2030-02-04T15:05:00Z'))
    await t.action(internal.paymentsWorker.schedules, {})
    const retry = await t.action(api.bids.retry, { checkoutId: refused })
    await settle()
    expect(await schedule(scheduleId)).toMatchObject({ period: '2030-03', lastPaidPeriod: '2030-02' })
    await t.fetch('/stripe/webhook', await stripe.confirm((await status(retry.checkoutId)).processorCheckoutId!, 'ok'))
    expect(await status(retry.checkoutId)).toMatchObject({ status: 'refund_needed' })
    expect(await calls('onRefundNeeded')).toMatchObject([{ checkoutId: retry.checkoutId, reason: 'This was already paid by another payment.' }])
    expect((await calls('scheduleCharged')).map((c) => c.period)).toEqual(['2030-01', '2030-02'])
    expect(await calls('scheduleFailed')).toHaveLength(1)
  })

  test('a retry asked for once the period is paid is refused', async () => {
    const { t, calls, saved, runAt, start } = setup()
    const pm = await saved()
    await start(pm)
    stripe.setBehaviour(pm, 'decline')
    await runAt('2030-02-01T15:05:00Z')
    const refused = (await calls('scheduleFailed'))[0].checkoutId as string
    stripe.setBehaviour(pm, 'ok')
    await runAt('2030-02-04T15:05:00Z')
    await expect(t.action(api.bids.retry, { checkoutId: refused })).rejects.toThrow(/already paid/)
  })

  test('a refused charge that turns out paid after its period was paid by a retry is owed back', async () => {
    const { t, calls, schedule, status, saved, runAt, start } = setup()
    const pm = await saved()
    const { scheduleId } = await start(pm)
    stripe.setBehaviour(pm, 'decline')
    await runAt('2030-02-01T15:05:00Z')
    const refused = (await calls('scheduleFailed'))[0].checkoutId as string
    stripe.setBehaviour(pm, 'ok')
    await runAt('2030-02-04T15:05:00Z')
    const late = stripe.paymentIntents().find((x) => x.metadata?.checkoutId === refused)!
    await t.fetch('/stripe/webhook', await stripe.settleBank(late.id, true))
    expect(await status(refused)).toMatchObject({ status: 'refund_needed' })
    expect(await schedule(scheduleId)).toMatchObject({ status: 'active', period: '2030-03', lastPaidPeriod: '2030-02' })
    expect((await calls('scheduleCharged')).map((c) => c.period)).toEqual(['2030-01', '2030-02'])
  })

  async function paypalSchedule(s: ReturnType<typeof setup>) {
    await s.t.mutation(api.host.addAdmin, { token: 'boss', name: 'Bo' })
    const started = await s.t.action(api.monthly.startCheckout, { donor: 'd1', processor: 'paypal', method: 'card' })
    if (!('embedded' in started) || started.embedded.processor !== 'paypal') throw new Error('expected an embedded PayPal checkout')
    pp.approve(started.embedded.orderId)
    await s.t.action(api.payments.completeReturn, { processor: 'paypal', token: started.embedded.orderId })
    pp.refuse((c) => (c.method === 'POST' && c.path === '/v2/checkout/orders' ? Response.json({ name: 'INTERNAL_SERVER_ERROR' }, { status: 503 }) : undefined))
    await s.runAt('2030-02-01T15:05:00Z')
    pp.refuse()
    const checkoutId = (await s.schedule(started.scheduleId)).lastCheckoutId!
    expect(await s.status(checkoutId)).toMatchObject({ status: 'pending', chargeAttempts: 5, processorCheckoutId: null })
    return { scheduleId: started.scheduleId, checkoutId }
  }

  test('PayPal, no order id: giving up finds a capture tagged for the charge in Transaction Search and settles it', async () => {
    const s = setup()
    const { scheduleId, checkoutId } = await paypalSchedule(s)
    pp.capturedElsewhere('test', checkoutId, 2500)
    pp.enableSearch()
    expect(await s.t.action(api.payments.giveUpCharge, { auth: 'boss', checkoutId })).toEqual({ status: 'paid' })
    expect(await s.schedule(scheduleId)).toMatchObject({ status: 'active', period: '2030-03', lastPaidPeriod: '2030-02' })
    await s.runAt('2030-02-04T15:05:00Z')
    expect(pp.vaultCharges).toHaveLength(0)
  })

  test('PayPal, no order id and nothing found: refused until three hours after the last try, then given up', async () => {
    const s = setup()
    const { scheduleId, checkoutId } = await paypalSchedule(s)
    pp.enableSearch()
    await expect(s.t.action(api.payments.giveUpCharge, { auth: 'boss', checkoutId })).rejects.toThrow(/PayPal can take up to three hours.*after \d\d:\d\d/)
    expect(await s.status(checkoutId)).toMatchObject({ status: 'pending' })
    vi.setSystemTime((await s.status(checkoutId)).lastTriedAt! + 3 * 60 * 60_000 + 60_000)
    expect(await s.t.action(api.payments.giveUpCharge, { auth: 'boss', checkoutId })).toEqual({ status: 'failed' })
    expect(await s.schedule(scheduleId)).toMatchObject({ status: 'past_due', period: '2030-02' })
  })
})

describe('a first payment after its checkout closed', () => {
  test('cancelled by the payer and paid anyway: owed back, and the schedule stays not started', async () => {
    const { t, calls, schedule, status } = setup()
    const started = await t.action(api.monthly.startCheckout, { donor: 'd1', processor: 'stripe', method: 'card' })
    await t.action(api.payments.cancelCheckout, { checkoutId: started.checkoutId })
    await t.fetch('/stripe/webhook', await stripe.pay((await status(started.checkoutId)).processorCheckoutId!))
    expect(await status(started.checkoutId)).toMatchObject({ status: 'refund_needed' })
    expect(await schedule(started.scheduleId)).toMatchObject({ status: 'cancelled', paymentMethodId: null })
    expect(await calls('scheduleCharged')).toEqual([])
  })

  test('expired (not cancelled) and paid anyway: the schedule starts after all', async () => {
    const { t, calls, schedule, status } = setup()
    const started = await t.action(api.monthly.startCheckout, { donor: 'd1', processor: 'stripe', method: 'card' })
    const session = (await status(started.checkoutId)).processorCheckoutId!
    await t.fetch('/stripe/webhook', await stripe.expire(session))
    expect(await schedule(started.scheduleId)).toMatchObject({ status: 'cancelled' })
    await t.fetch('/stripe/webhook', await stripe.pay(session))
    expect(await status(started.checkoutId)).toMatchObject({ status: 'paid' })
    expect(await schedule(started.scheduleId)).toMatchObject({ status: 'active', period: '2030-02', lastPaidPeriod: '2030-01', endReason: null, paymentMethodId: expect.stringMatching(/^pm_/) })
    expect((await calls('scheduleChanged')).map((c) => c.changes)).toEqual([['not_started'], ['started']])
    expect(await calls('scheduleCharged')).toMatchObject([{ first: true, period: '2030-01' }])
  })
})

describe('a pause and a charge already on its way', () => {
  test('a bank debit that bounces during a short pause keeps the pause: no retry during it, the host told', async () => {
    const { t, calls, schedule, saved, start, runAt } = setup()
    const bank = await saved('d1', 'bank')
    const { scheduleId, checkoutId } = await start(bank)
    await t.mutation(api.monthly.pause, { scheduleId, until: at('2030-01-25T00:00:00Z') })
    expect(await schedule(scheduleId)).toMatchObject({ status: 'paused', period: '2030-02', nextChargeAt: at('2030-02-01T15:00:00Z') })
    vi.setSystemTime(at('2030-01-05T12:00:00Z'))
    const pi = (await t.query(api.shop.status, { id: checkoutId! }))!.paymentRef!
    await t.fetch('/stripe/webhook', await stripe.settleBank(pi, false, 'insufficient_funds'))
    expect(await schedule(scheduleId)).toMatchObject({ status: 'paused', pausedUntil: at('2030-01-25T00:00:00Z'), nextChargeAt: at('2030-02-01T15:00:00Z') })
    expect(await calls('scheduleFailed')).toMatchObject([{ period: '2030-01', final: false, nextRetryAt: null, status: 'paused' }])
    stripe.setBehaviour(bank, 'ok')
    await runAt('2030-01-08T15:05:00Z')
    expect(stripe.calls.filter((c) => c.method === 'POST' && c.path === '/v1/payment_intents')).toHaveLength(1)
  })
})
