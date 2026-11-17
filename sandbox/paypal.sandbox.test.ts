// Real calls to the PayPal sandbox with the library's own wire code: a token, an order made and read
// (and the same one back for the same request id), a capture before approval refused, the signature
// check answering FAILURE for a made-up signature, Transaction Search, and the webhook CLI (its
// sandbox webhook removed again). Run by `npm run test:sandbox`, only with sandbox keys.
import { describe, expect, test } from 'vitest'
import { paypalWebhook } from '../src/cli/webhooks.js'
import { PAYPAL_EVENTS, PAYPAL_SANDBOX_API, ProcessorError, approveUrl, paypal, paypalToken, searchTransactions, verifyPaypalWebhook } from '../src/core/index.js'

const keys = { clientId: process.env.SANDBOX_PAYPAL_CLIENT_ID ?? '', clientSecret: process.env.SANDBOX_PAYPAL_CLIENT_SECRET ?? '', apiBase: PAYPAL_SANDBOX_API }
if (!keys.clientId || !keys.clientSecret) throw new Error('The sandbox suite needs PayPal sandbox keys.')
const o = { fetch: (input: string, init?: RequestInit) => fetch(input, init) }
const run = Date.now().toString(36)

async function call() {
  const { token } = await paypalToken(keys, Date.now(), o)
  return { apiBase: keys.apiBase, token, fetch: o.fetch }
}

describe('orders', () => {
  test('made, made again under the same request id (the same order), read, and not captured before approval', async () => {
    const c = await call()
    const input = { customId: `sandbox:${run}`, description: 'Sandbox', amountCents: 2500, returnUrl: 'https://example.org/ok', cancelUrl: 'https://example.org/no' }
    const order = await paypal.createOrder(c, input, `sb-${run}`)
    expect(order.status).toBe('PAYER_ACTION_REQUIRED')
    expect(approveUrl(order)).toMatch(/^https:\/\/www\.sandbox\.paypal\.com\//)
    expect((await paypal.createOrder(c, input, `sb-${run}`)).id).toBe(order.id)
    expect((await paypal.getOrder(c, order.id)).purchase_units?.[0]?.custom_id).toBe(`sandbox:${run}`)
    await expect(paypal.captureOrder(c, order.id, `sb-cap-${run}`)).rejects.toMatchObject({ status: 422, code: 'ORDER_NOT_APPROVED' })
  })
})

test('the signature check asks PayPal and gets FAILURE for a made-up signature', async () => {
  const c = await call()
  const headers = new Headers({
    'paypal-auth-algo': 'SHA256withRSA',
    'paypal-cert-url': 'https://api.sandbox.paypal.com/v1/notifications/certs/CERT-360caa42-fca2a594-a5cafa77',
    'paypal-transmission-id': `sb-${run}`,
    'paypal-transmission-sig': 'bm90IGEgc2lnbmF0dXJl',
    'paypal-transmission-time': new Date().toISOString(),
  })
  const body = JSON.stringify({ id: `WH-${run}`, event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: {} })
  expect(await verifyPaypalWebhook({ ...keys, webhookId: process.env.SANDBOX_PAYPAL_WEBHOOK_ID || 'WH-SANDBOX-MADEUP' }, c.token, headers, body, o)).toBe(false)
})

test('Transaction Search answers, or refuses with 403 when the app lacks it', async () => {
  const c = await call()
  try {
    const res = await searchTransactions(c, { start: Date.now() - 24 * 60 * 60_000, end: Date.now() - 60_000, page: 1 })
    expect(res.totalPages).toBeGreaterThanOrEqual(0)
  } catch (err) {
    if (!(err instanceof ProcessorError) || err.status !== 403) throw err
    console.info('test:sandbox: Transaction Search isn’t enabled on this PayPal app (403); the comparison skips that direction.')
  }
})

test('the webhook CLI creates the sandbox webhook with the library’s events, leaves it, and removes it', async () => {
  const url = `https://example.org/ed-payments-sandbox-${run}/paypal/webhook`
  const made = await paypalWebhook(keys, { url, fetch: o.fetch })
  try {
    expect(made.action).toBe('created')
    const c = await call()
    const w = ((await paypal.listWebhooks(c)).webhooks ?? []).find((x) => x.url === url)
    expect(w?.event_types.map((e) => e.name).sort()).toEqual([...PAYPAL_EVENTS].sort())
    expect((await paypalWebhook(keys, { url, fetch: o.fetch })).action).toBe('unchanged')
  } finally {
    expect((await paypalWebhook(keys, { url, fetch: o.fetch, remove: true })).action).toBe('removed')
  }
})
