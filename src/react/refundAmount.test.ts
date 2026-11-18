import { expect, test } from 'vitest'
import { parseRefundAmount, refundableCents } from './refundAmount.js'

test('blank refunds everything left', () => {
  expect(parseRefundAmount('', 2500)).toEqual({ ok: true, cents: 2500 })
  expect(parseRefundAmount('   ', 2500)).toEqual({ ok: true, cents: 2500 })
})

test('dollars with up to two decimals, with or without a dollar sign', () => {
  expect(parseRefundAmount('12', 2500)).toEqual({ ok: true, cents: 1200 })
  expect(parseRefundAmount('12.5', 2500)).toEqual({ ok: true, cents: 1250 })
  expect(parseRefundAmount('$0.29', 2500)).toEqual({ ok: true, cents: 29 })
  expect(parseRefundAmount('25.00', 2500)).toEqual({ ok: true, cents: 2500 })
})

test('refuses more than is left, nothing, and anything that is not plain dollars', () => {
  expect(parseRefundAmount('25.01', 2500)).toEqual({ ok: false, error: 'Only $25.00 is left to refund on this payment.' })
  expect(parseRefundAmount('0', 2500)).toMatchObject({ ok: false })
  expect(parseRefundAmount('0.00', 2500)).toMatchObject({ ok: false })
  for (const text of ['-5', '1.234', 'abc', '12,50', '1e3', '.5']) expect(parseRefundAmount(text, 2500)).toMatchObject({ ok: false })
  expect(parseRefundAmount('', 0)).toEqual({ ok: false, error: 'Nothing is left to refund on this payment.' })
})

test('what is left takes off refunds done and open ones (failed too, as they can be sent again), not other payments', () => {
  const checkout = { id: 'c1', paidCents: 10000, refundedCents: 1000 }
  const refunds = [
    { checkoutId: 'c1', status: 'requested' as const, amountCents: 2000 },
    { checkoutId: 'c1', status: 'sending' as const, amountCents: 500 },
    { checkoutId: 'c1', status: 'failed' as const, amountCents: 3000 },
    { checkoutId: 'c2', status: 'approved' as const, amountCents: 4000 },
  ]
  expect(refundableCents(checkout, refunds)).toBe(3500)
  expect(refundableCents({ id: 'c1', paidCents: null, refundedCents: 0 })).toBe(0)
  expect(refundableCents({ id: 'c1', paidCents: 1000, refundedCents: 500 }, [{ checkoutId: 'c1', status: 'approved', amountCents: 900 }])).toBe(0)
})
