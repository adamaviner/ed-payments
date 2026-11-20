// An admin's search of the PayPal account's history by email, through adminApi's paypalHistory.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { defined } from '../testing/app.js'
import { fakePaypal, type FakePaypal } from '../testing/fakePaypal.js'
import { searchWindows } from './paypalHistory.js'

const { api, createTest } = defined
const DAY = 24 * 60 * 60 * 1000
const NOW = Date.parse('2030-06-01T12:00:00Z')
let pp: FakePaypal

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  pp = fakePaypal({ search: true })
  vi.stubGlobal('fetch', pp.fetch)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

async function admin() {
  const t = createTest()
  await t.mutation(api.host.addAdmin, { token: 'boss', name: 'Bo' })
  const search = (email: string, start: number, end = NOW) => t.action(api.payments.paypalHistory, { auth: 'boss', email, start, end })
  return { t, search }
}

const searches = () => pp.calls.filter((c) => c.path === '/v1/reporting/transactions')

describe('searchWindows', () => {
  test('cuts a range into windows PayPal accepts, end to end', () => {
    const w = searchWindows(0, 100 * DAY)
    expect(w).toHaveLength(4)
    expect(w[0].start).toBe(0)
    expect(w.at(-1)?.end).toBe(100 * DAY)
    expect(w.every((x, i) => x.end - x.start <= 31 * DAY && (i === 0 || x.start === w[i - 1].end))).toBe(true)
    expect(searchWindows(5, 5)).toEqual([])
  })
})

describe('paypalHistory', () => {
  test('finds money from and to the email across the range, newest first, with what was bought', async () => {
    const { search } = await admin()
    const paid = pp.addActivity({ at: NOW - 100 * DAY, email: 'Ann@Example.org', name: 'Ann Lee', cents: 5000, feeCents: -149, eventCode: 'T0007', items: ['Workshop pass'] })
    const refund = pp.addActivity({ at: NOW - 10 * DAY, email: 'ann@example.org', name: 'Ann Lee', cents: -2000, eventCode: 'T1107', subject: 'Partial refund' })
    pp.addActivity({ at: NOW - 20 * DAY, email: 'bo@example.org', cents: 900 })
    pp.addActivity({ at: NOW - 400 * DAY, email: 'ann@example.org', cents: 100 })
    const found = await search(' ANN@example.org ', NOW - 182 * DAY)
    expect(found.transactions).toMatchObject([
      { transactionId: refund, direction: 'out', amountCents: -2000, type: 'Refund', subject: 'Partial refund', email: 'ann@example.org' },
      { transactionId: paid, direction: 'in', amountCents: 5000, feeCents: -149, type: 'Website payment', name: 'Ann Lee', items: ['Workshop pass'], at: NOW - 100 * DAY },
    ])
    expect(found.transactions[0].url).toBe(`https://www.sandbox.paypal.com/activity/payment/${refund}`)
    expect(found.scanned).toBe(3)
    expect(searches()).toHaveLength(6)
  })

  test('a range older than PayPal keeps is clamped to three years, and one in the future to now', async () => {
    const { search } = await admin()
    const found = await search('ann@example.org', NOW - 10 * 365 * DAY, NOW + 30 * DAY)
    expect(found.end).toBe(NOW)
    expect(NOW - found.start).toBeLessThan(3 * 365 * DAY)
    expect(searches()).toHaveLength(Math.ceil((found.end - found.start) / (31 * DAY - 1000)))
  })

  test('pages through a busy window', async () => {
    const { search } = await admin()
    for (let i = 0; i < 501; i++) pp.addActivity({ at: NOW - DAY - i * 1000, email: i === 500 ? 'last@example.org' : 'many@example.org', cents: 100 })
    expect((await search('last@example.org', NOW - 5 * DAY)).transactions).toHaveLength(1)
    expect(searches()).toHaveLength(2)
  })

  test('says why when the range or the email won’t do, or PayPal refuses the search', async () => {
    const { t, search } = await admin()
    await expect(search('not an email', NOW - DAY)).rejects.toThrow(/Enter an email/)
    await expect(search('a@b.org', NOW, NOW - DAY)).rejects.toThrow(/ends after it starts/)
    pp.enableSearch(false)
    await expect(search('a@b.org', NOW - DAY)).rejects.toThrow(/Transaction search/)
    await expect(t.action(api.payments.paypalHistory, { auth: 'guess', email: 'a@b.org', start: 0, end: NOW })).rejects.toThrow(/Only an admin/)
  })
})
