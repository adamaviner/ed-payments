// The run-time check of an app's context against its validator, for the kinds a stored value can't show on its face.
import { v } from 'convex/values'
import { expect, test } from 'vitest'
import { mismatch } from './context.js'

test('an id must look like a Convex id, not any string, so a wrong one is refused before any money moves', () => {
  const validator = v.object({ order: v.id('orders') })
  expect(mismatch(validator, { order: '' })).toBe('context.order should be a document id')
  expect(mismatch(validator, { order: 'order 12!' })).toBe('context.order should be a document id')
  expect(mismatch(validator, { order: 'jh7dbvbtz2y6n8z9n4ntdyyq7h6y6rhy' })).toBeNull()
})

test('an id made by convex-test, which names its table in mixed case, is an id', () => {
  expect(mismatch(v.object({ gift: v.id('monthlyDonations') }), { gift: '0000000000000000001monthlyDonations' })).toBeNull()
})
