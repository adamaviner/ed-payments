// Stripe wire calls that page: every page is read, not only the first.
import { expect, test } from 'vitest'
import { stripe } from './stripe.js'

test('refundsOf reads every page of a payment’s refunds', async () => {
  const asked: URL[] = []
  const pages = [
    { object: 'list', data: [{ id: 're_1' }, { id: 're_2' }], has_more: true, url: '/v1/refunds' },
    { object: 'list', data: [{ id: 're_3' }], has_more: false, url: '/v1/refunds' },
  ]
  const fetch = async (input: string) => {
    asked.push(new URL(input))
    return Response.json(pages[asked.length - 1])
  }
  const all = await stripe.refundsOf({ secretKey: 'sk_test_x' }, 'pi_1', { fetch })
  expect(all.data.map((r) => r.id)).toEqual(['re_1', 're_2', 're_3'])
  expect(asked[1].searchParams.get('starting_after')).toBe('re_2')
  expect(asked[1].searchParams.get('payment_intent')).toBe('pi_1')
})
