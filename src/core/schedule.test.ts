import { describe, expect, test } from 'vitest'
import { declineCodeOf, declineKind } from './declines.js'
import { anchorDayOf, chargeTimeOf, firstChargeFrom, periodOf, retryTime, shiftPeriod } from './schedule.js'

const at = (iso: string) => new Date(iso).getTime()
const DAY = 24 * 60 * 60 * 1000
const clock = { anchorDay: 15, hourUTC: 15 }

describe('the calendar', () => {
  test('periods, their charge times, and the next one from a time', () => {
    expect(periodOf(at('2030-12-31T23:59:00Z'))).toBe('2030-12')
    expect(shiftPeriod('2030-12', 1)).toBe('2031-01')
    expect(shiftPeriod('2030-01', -1)).toBe('2029-12')
    expect(chargeTimeOf('2030-02', clock)).toBe(at('2030-02-15T15:00:00Z'))
    expect(firstChargeFrom(at('2030-02-15T14:00:00Z'), clock)).toBe(at('2030-02-15T15:00:00Z'))
    expect(firstChargeFrom(at('2030-02-15T16:00:00Z'), clock)).toBe(at('2030-03-15T15:00:00Z'))
    expect(anchorDayOf(at('2030-01-31T10:00:00Z'))).toBe(28)
    expect(anchorDayOf(at('2030-01-05T10:00:00Z'))).toBe(5)
  })

  test('retries 3, 5 and 7 days after the first refusal, then none; none at all for a hard decline', () => {
    const first = at('2030-03-01T15:00:00Z')
    const r = (failures: number, kind: 'soft' | 'hard' | 'insufficient_funds' = 'soft') => retryTime({ firstFailedAt: first, failures, kind, retryDays: [3, 5, 7], hourUTC: 15 })
    expect([1, 2, 3, 4].map((n) => r(n))).toEqual([first + 3 * DAY, first + 5 * DAY, first + 7 * DAY, null])
    expect(r(1, 'hard')).toBeNull()
  })

  test('insufficient funds moves a retry to the 1st or 15th when one comes within four days', () => {
    const r = (iso: string) => retryTime({ firstFailedAt: at(iso), failures: 1, kind: 'insufficient_funds', retryDays: [3, 5, 7], hourUTC: 15 })
    expect(r('2030-03-10T15:00:00Z')).toBe(at('2030-03-15T15:00:00Z'))
    expect(r('2030-03-27T15:00:00Z')).toBe(at('2030-04-01T15:00:00Z'))
    // No payday close enough: the regular day.
    expect(r('2030-03-02T15:00:00Z')).toBe(at('2030-03-05T15:00:00Z'))
  })
})

describe('declines', () => {
  test('Stripe: hard by decline code, a bank debit’s code, or the advice; insufficient funds; the rest soft', () => {
    expect(declineKind({ processor: 'stripe', code: 'card_declined', declineCode: 'lost_card' })).toBe('hard')
    expect(declineKind({ processor: 'stripe', code: 'account_closed', declineCode: 'generic_decline' })).toBe('hard')
    expect(declineKind({ processor: 'stripe', code: 'card_declined', declineCode: 'generic_decline', adviceCode: 'do_not_try_again' })).toBe('hard')
    expect(declineKind({ processor: 'stripe', code: 'authentication_required' })).toBe('hard')
    expect(declineKind({ processor: 'stripe', code: 'insufficient_funds', declineCode: 'generic_decline' })).toBe('insufficient_funds')
    expect(declineKind({ processor: 'stripe', code: 'card_declined', declineCode: 'insufficient_funds' })).toBe('insufficient_funds')
    expect(declineKind({ processor: 'stripe', code: 'card_declined', declineCode: 'generic_decline', adviceCode: 'try_again_later' })).toBe('soft')
    expect(declineCodeOf({ processor: 'stripe', code: 'card_declined', declineCode: 'generic_decline' })).toBe('card_declined')
    expect(declineCodeOf({ processor: 'stripe', code: 'card_declined', declineCode: 'lost_card' })).toBe('lost_card')
  })

  test('PayPal: expired, closed or unusable methods are hard; a bank’s no is soft', () => {
    expect(declineKind({ processor: 'paypal', code: 'CARD_EXPIRED' })).toBe('hard')
    expect(declineKind({ processor: 'paypal', code: 'PAYER_ACCOUNT_LOCKED_OR_CLOSED' })).toBe('hard')
    expect(declineKind({ processor: 'paypal', code: 'INSTRUMENT_DECLINED' })).toBe('soft')
  })
})
