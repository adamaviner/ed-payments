// The generated functions (adminApi, publicApi, worker, registerCrons) and the hardening around every
// public entry: refused without the app's say-so, refused past their rate limits, refused with tampered
// amounts, and no secret ever stored or said.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { app, crons, defined, payments } from '../testing/app.js'
import { fakePaypal, type FakePaypal } from '../testing/fakePaypal.js'
import { fakeStripe, type FakeStripe } from '../testing/fakeStripe.js'

const { api, internal, createTest } = defined
let stripe: FakeStripe
let pp: FakePaypal
const said: string[] = []

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2030-01-01T12:00:00Z'))
  pp = fakePaypal()
  stripe = fakeStripe({ fallback: pp.fetch })
  vi.stubGlobal('fetch', stripe.fetch)
  said.length = 0
  for (const level of ['log', 'info', 'warn', 'error'] as const) vi.spyOn(console, level).mockImplementation((...a: unknown[]) => void said.push(a.map(String).join(' ')))
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

const page = { numItems: 10, cursor: null }

describe('adminApi', () => {
  // One row per generated function: called without auth, and with a token the app doesn't know.
  const cases: [string, (t: ReturnType<typeof createTest>, auth: string | undefined) => Promise<unknown>][] = [
    ['openRefunds', (t, auth) => t.query(api.payments.openRefunds, { auth })],
    ['refundable', (t, auth) => t.query(api.payments.refundable, { auth, paginationOpts: page })],
    ['issues', (t, auth) => t.query(api.payments.issues, { auth, paginationOpts: page })],
    ['openCount', (t, auth) => t.query(api.payments.openCount, { auth })],
    ['checkout', (t, auth) => t.query(api.payments.checkout, { auth, checkoutId: 'x' })],
    ['requestRefund', (t, auth) => t.mutation(api.payments.requestRefund, { auth, checkoutId: 'x', reason: 'x' })],
    ['approveRefund', (t, auth) => t.mutation(api.payments.approveRefund, { auth, refundId: 'x' })],
    ['sendRefund', (t, auth) => t.action(api.payments.sendRefund, { auth, refundId: 'x' })],
    ['markRefundedManually', (t, auth) => t.mutation(api.payments.markRefundedManually, { auth, refundId: 'x' })],
    ['dismissRefund', (t, auth) => t.mutation(api.payments.dismissRefund, { auth, refundId: 'x' })],
    ['resolveIssue', (t, auth) => t.mutation(api.payments.resolveIssue, { auth, issueId: 'x' })],
    ['retryCharge', (t, auth) => t.mutation(api.payments.retryCharge, { auth, checkoutId: 'x' })],
    ['giveUpCharge', (t, auth) => t.action(api.payments.giveUpCharge, { auth, checkoutId: 'x' })],
  ]

  test('every generated admin function is listed here', () => {
    const generated = Object.keys(payments.adminApi())
    expect(generated.sort()).toEqual(cases.map(([name]) => name).sort())
  })

  test.each(cases)('%s is refused without the app’s say-so', async (_name, call) => {
    const t = createTest()
    await t.mutation(api.host.addAdmin, { token: 'boss', name: 'Bo' })
    await expect(call(t, undefined)).rejects.toThrow(/Only an admin/)
    await expect(call(t, 'guess')).rejects.toThrow(/Only an admin/)
  })

  test('an app on Convex auth: the signed-in caller’s identity reaches its authorize query', async () => {
    const t = createTest()
    await t.mutation(api.host.addAdmin, { token: 'user:ida', name: 'Ida' })
    expect(await t.withIdentity({ subject: 'ida' }).query(api.payments.openCount, {})).toBe(0)
    expect(
      await t
        .withIdentity({ subject: 'ida' })
        .action(api.payments.sendRefund, { refundId: 'x' })
        .catch((e: Error) => e.message),
    ).toMatch(/No refund x/)
    await expect(t.withIdentity({ subject: 'someone' }).query(api.payments.openCount, {})).rejects.toThrow(/Only an admin/)
  })

  test('an admin refunds part of a paid checkout through the page’s functions; the ledger records who', async () => {
    const t = createTest()
    await t.mutation(api.host.addAdmin, { token: 'boss', name: 'Bo' })
    const { checkoutId } = await t.action(api.shop.buy, { processor: 'stripe', method: 'card' })
    const sessionId = (await t.query(api.shop.status, { id: checkoutId }))!.processorCheckoutId!
    await t.fetch('/stripe/webhook', await stripe.pay(sessionId))
    const listed = await t.query(api.payments.refundable, { auth: 'boss', paginationOpts: page })
    expect(listed.page).toMatchObject([{ id: checkoutId, paidCents: 2500, refundedCents: 0, description: 'A bowl' }])
    const refundId = await t.mutation(api.payments.requestRefund, { auth: 'boss', checkoutId, amountCents: 1000, reason: 'Chipped' })
    expect(await t.query(api.payments.openCount, { auth: 'boss' })).toBe(1)
    expect(await t.query(api.payments.openRefunds, { auth: 'boss' })).toMatchObject([{ id: refundId, requestedBy: 'Bo', checkout: { id: checkoutId, paymentRef: expect.stringMatching(/^pi_/) } }])
    expect(await t.action(api.payments.sendRefund, { auth: 'boss', refundId })).toEqual({ status: 'sent', error: null })
    expect(await t.query(api.payments.checkout, { auth: 'boss', checkoutId })).toMatchObject({ checkout: { refundedCents: 1000 }, refunds: [{ approvedBy: 'Bo', status: 'sent' }] })
    await expect(t.mutation(api.payments.requestRefund, { auth: 'boss', checkoutId, amountCents: 2000, reason: 'Too much' })).rejects.toThrow(/Only \$15\.00 is left/)
    await expect(t.mutation(api.payments.requestRefund, { auth: 'boss', checkoutId, amountCents: -5, reason: 'Negative' })).rejects.toThrow(/at least one cent/)
  })
})

describe('publicApi', () => {
  test('completeReturn is rate-limited per token (or signed-in user) and in all', async () => {
    const t = createTest()
    for (let i = 0; i < 12; i++) expect(await t.action(api.payments.completeReturn, { processor: 'stripe', token: 'cs_nothing' })).toBeNull()
    await expect(t.action(api.payments.completeReturn, { processor: 'stripe', token: 'cs_nothing' })).rejects.toThrow(/Too many/)
    const user = t.withIdentity({ subject: 'user-1' })
    for (let i = 0; i < 8; i++) await user.action(api.payments.completeReturn, { processor: 'stripe', token: `cs_${i}` })
    // 20 a minute for everyone together (the test app's 5, times four for the return page).
    await expect(user.action(api.payments.completeReturn, { processor: 'stripe', token: 'cs_more' })).rejects.toThrow(/right now/)
  })

  test('completeReturn says how it stands and nothing about the payer', async () => {
    const t = createTest()
    const { checkoutId } = await t.action(api.shop.buy, { processor: 'stripe', method: 'card' })
    const sessionId = (await t.query(api.shop.status, { id: checkoutId }))!.processorCheckoutId!
    await stripe.pay(sessionId)
    expect(await t.action(api.payments.completeReturn, { processor: 'stripe', token: sessionId })).toEqual({ status: 'paid', purpose: 'order', ref: { type: 'offering', id: 'o1' } })
  })
})

describe('hardening', () => {
  test('start refuses amounts that aren’t whole positive cents, and is limited per payer and in all', async () => {
    const t = createTest()
    for (const amountCents of [0, -100, 12.5, Number.NaN]) {
      await expect(t.action(api.shop.buy, { processor: 'stripe', method: 'card', amountCents })).rejects.toThrow(/at least one cent/)
    }
    for (let i = 0; i < 3; i++) await t.action(api.shop.buy, { processor: 'stripe', method: 'card', email: 'eve@example.org' })
    await expect(t.action(api.shop.buy, { processor: 'stripe', method: 'card', email: 'EVE@example.org ' })).rejects.toThrow(/Too many tries/)
    const user = t.withIdentity({ subject: 'eve' })
    await user.action(api.shop.buy, { processor: 'stripe', method: 'card', email: 'eve@example.org' })
    await user.action(api.shop.buy, { processor: 'stripe', method: 'card', email: 'eve@example.org' })
    await expect(user.action(api.shop.buy, { processor: 'stripe', method: 'card', email: 'other@example.org' })).rejects.toThrow(/right now/)
  })

  test('saving a method and retrying are rate-limited too', async () => {
    const t = createTest()
    for (let i = 0; i < 3; i++) await t.action(api.bids.setup, { user: 'u1', email: 'ana@example.org' })
    await expect(t.action(api.bids.setup, { user: 'u1', email: 'ana@example.org' })).rejects.toThrow(/Too many tries/)
  })

  test('a charge of a saved method refuses amounts that aren’t whole positive cents', async () => {
    const t = createTest()
    await expect(t.mutation(api.bids.charge, { user: 'u1', bidId: 'b1', paymentMethodId: 'pm_x', amountCents: 0 })).rejects.toThrow(/at least one cent/)
    await expect(t.mutation(api.bids.charge, { user: 'u1', bidId: 'b1', paymentMethodId: 'pm_x', amountCents: 9.99 })).rejects.toThrow(/at least one cent/)
  })

  test('no secret is stored in a row, said in a log or put in an error', async () => {
    const t = createTest()
    // Every path that touches a key: both processors' checkouts and webhooks, the PayPal token cache,
    // a saved method, a declined charge, an on-session retry with its client secret, a refund, the upkeep.
    const s = await t.action(api.shop.buy, { processor: 'stripe', method: 'card' })
    await t.fetch('/stripe/webhook', await stripe.pay((await t.query(api.shop.status, { id: s.checkoutId }))!.processorCheckoutId!))
    const p = await t.action(api.shop.buy, { processor: 'paypal', method: 'card' })
    await t.fetch('/paypal/webhook', pp.approve((await t.query(api.shop.status, { id: p.checkoutId }))!.processorCheckoutId!))
    const { stripeCustomerId } = await t.action(api.bids.setup, { user: 'u1', email: 'ana@example.org' })
    const pm = stripe.saveMethod(stripeCustomerId, 'decline')
    await t.action(api.bids.verify, { user: 'u1', paymentMethodId: pm })
    const charged = await t.mutation(api.bids.charge, { user: 'u1', bidId: 'b1', paymentMethodId: pm })
    await t.finishAllScheduledFunctions(() => vi.runAllTimers())
    const retry = await t.action(api.bids.retry, { checkoutId: charged })
    expect(retry.clientSecret).toMatch(/_secret_/)
    const refundId = await t.mutation(api.shop.requestRefund, { checkoutId: s.checkoutId, reason: 'x' })
    await t.action(api.shop.sendRefund, { refundId, skipApproval: true })
    stripe.refuse(() => Response.json({ error: { message: 'down' } }, { status: 500 }))
    await t.action(internal.paymentsWorker.sweep, {})
    await t.action(internal.paymentsWorker.reconcile, {})
    await expect(t.action(api.shop.buy, { processor: 'stripe', method: 'card', email: 'z@example.org' })).rejects.toThrow()

    const c = app.components.payments
    const rows = await t.run(async (ctx) => ({
      checkouts: await ctx.runQuery(c.checkouts.list, { paginationOpts: { numItems: 100, cursor: null } }),
      refunds: await ctx.runQuery(c.refunds.createdSince, { since: 0, limit: 100 }),
      issues: await ctx.runQuery(c.issues.list, { open: false, paginationOpts: { numItems: 100, cursor: null } }),
      token: await ctx.runQuery(c.settings.paypalToken, {}),
      customer: await ctx.runQuery(c.customers.byOwner, { app: 'test', owner: { type: 'user', id: 'u1' } }),
    }))
    expect(rows.token).not.toBeNull()
    const stored = JSON.stringify(rows)
    const secrets = ['sk_test_fake', 'whsec_fake', 'fake-secret', 'A21-fake', '_secret_', retry.clientSecret]
    for (const secret of secrets) {
      expect(stored).not.toContain(secret)
      expect(said.join('\n')).not.toContain(secret)
    }
  })
})

describe('worker and crons', () => {
  test('registerCrons puts the sweep, the comparison, the digest and the cleanup on the app’s crons', () => {
    const jobs = Object.entries(crons.crons).map(([name, job]) => [name, job.schedule.type])
    expect(jobs).toEqual([
      ['payments sweep', 'interval'],
      ['payments reconcile', 'daily'],
      ['payments issues digest', 'daily'],
      ['payments cleanup', 'daily'],
    ])
  })

  test('the issues digest hands new issues to the app once', async () => {
    const t = createTest()
    const { checkoutId } = await t.action(api.shop.buy, { processor: 'stripe', method: 'card' })
    const sessionId = (await t.query(api.shop.status, { id: checkoutId }))!.processorCheckoutId!
    await t.fetch('/stripe/webhook', await stripe.pay(sessionId))
    const pi = (await t.query(api.shop.status, { id: checkoutId }))!.paymentRef!
    await t.fetch('/stripe/webhook', await stripe.dispute(pi, 'created'))
    expect(await t.mutation(internal.paymentsWorker.issuesDigest, {})).toBe(1)
    expect(await t.mutation(internal.paymentsWorker.issuesDigest, {})).toBe(0)
    const sent = (await t.query(api.host.calls, {})).filter((x) => x.name === 'onIssues')
    expect(sent).toHaveLength(1)
    expect(sent[0].args).toMatchObject({ issues: [{ kind: 'dispute', checkoutId, processor: 'stripe' }] })
  })
})
