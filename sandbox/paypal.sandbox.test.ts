// Real calls to the PayPal sandbox with the library's own wire code: a token, an order made and read
// (and the same one back for the same request id), a capture before approval refused, the signature
// check answering FAILURE for a made-up signature, Transaction Search, and the webhook CLI (its
// sandbox webhook removed again). Run by `npm run test:sandbox`, only with sandbox keys.
import { describe, expect, test } from 'vitest'
import { paypalWebhook } from '../src/cli/webhooks.js'
import {
  PAYPAL_EVENTS,
  PAYPAL_SANDBOX_API,
  ProcessorError,
  approveUrl,
  captureFee,
  orderCapture,
  paymentTokenLabel,
  paypal,
  paypalCall,
  paypalToken,
  searchTransactions,
  verifyPaypalWebhook,
  type PaypalSetupToken,
} from '../src/core/index.js'
import { keyDiff } from '../src/testing/drift.js'
import { fixture, paypalObjectFixtures } from '../src/testing/fixtures.js'

const keys = { clientId: process.env.SANDBOX_PAYPAL_CLIENT_ID ?? '', clientSecret: process.env.SANDBOX_PAYPAL_CLIENT_SECRET ?? '', apiBase: PAYPAL_SANDBOX_API }
if (!keys.clientId || !keys.clientSecret) throw new Error('The sandbox suite needs PayPal sandbox keys.')
const o = { fetch: (input: string, init?: RequestInit) => fetch(input, init) }
const run = Date.now().toString(36)
/** What PayPal knows about a card's BIN depends on the card (the fixtures' is another test card). */
const BIN_FIELDS = ['.payment_source.card.bin_details', '.payment_source.card.available_networks']

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
    const read = await paypal.getOrder(c, order.id)
    expect(read.purchase_units?.[0]?.custom_id).toBe(`sandbox:${run}`)
    // The fixture's order was made with a brand name and an invoice id; this one has neither.
    expect(keyDiff(read, fixture(paypalObjectFixtures.orderUnapproved), { ignore: ['.purchase_units[n].payee.display_data', '.purchase_units[n].invoice_id'] })).toEqual([])
    await expect(paypal.captureOrder(c, order.id, `sb-cap-${run}`)).rejects.toMatchObject({ status: 422, code: 'ORDER_NOT_APPROVED' })
  })

  test('an order for the buttons (no payment_source) is made and waits for the buyer', async () => {
    const c = await call()
    const input = {
      customId: `sandbox:${run}-b`,
      description: 'Sandbox',
      amountCents: 2500,
      returnUrl: 'https://example.org/ok',
      cancelUrl: 'https://example.org/no',
      brandName: 'Sandbox',
      embedded: true,
    }
    const order = await paypal.createOrder(c, input, `sb-${run}-b`)
    expect(order.status).toBe('CREATED')
    expect((await paypal.getOrder(c, order.id)).purchase_units?.[0]?.custom_id).toBe(`sandbox:${run}-b`)
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
    const raw = (await (
      await fetch(`${c.apiBase}/v1/reporting/transactions?start_date=${new Date(Date.now() - 30 * 86_400_000).toISOString()}&end_date=${new Date().toISOString()}&fields=all&page_size=2`, {
        headers: { Authorization: `Bearer ${c.token}` },
      })
    ).json()) as unknown
    expect(keyDiff({ ...(raw as object), transaction_details: [] }, { ...fixture(paypalObjectFixtures.transactionSearch), transaction_details: [] })).toEqual([])
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
    const list = await paypal.listWebhooks(c)
    expect(keyDiff({ ...list, webhooks: [] }, { ...fixture(paypalObjectFixtures.webhooksList), webhooks: [] })).toEqual([])
    const w = (list.webhooks ?? []).find((x) => x.url === url)
    expect(w?.event_types.map((e) => e.name).sort()).toEqual([...PAYPAL_EVENTS].sort())
    expect(keyDiff(w, fixture(paypalObjectFixtures.webhooksList).webhooks[0])).toEqual([])
    expect((await paypalWebhook(keys, { url, fetch: o.fetch })).action).toBe('unchanged')
  } finally {
    expect((await paypalWebhook(keys, { url, fetch: o.fetch, remove: true })).action).toBe('removed')
  }
})

describe('the vault', () => {
  test('setup tokens as the library asks for them: a card waits for its details, a PayPal account for the buyer to approve', async () => {
    const c = await call()
    const base = { merchantCustomerId: `sandbox.user.${run}`, description: 'Sandbox bids', returnUrl: 'https://example.org/ok', cancelUrl: 'https://example.org/no' }
    const card = await paypal.createSetupToken(c, { ...base, kind: 'card' }, `sb-setup-card-${run}`)
    expect(card.customer?.merchant_customer_id).toBe(`sandbox.user.${run}`)
    expect(card.status).not.toBe('APPROVED')
    const account = await paypal.createSetupToken(c, { ...base, kind: 'paypal', customerId: card.customer?.id }, `sb-setup-pp-${run}`)
    expect(account.status).toBe('PAYER_ACTION_REQUIRED')
    expect(account.customer?.id).toBe(card.customer?.id)
  })

  test('a card saved (its details sent here as Card Fields would), checked, charged with nobody present, and deleted', async () => {
    const c = await call()
    // Card Fields put the card on the setup token in the browser; the test sends it straight away.
    // (4111…: the sandbox started refusing 4005…, used many times on 2026-11-21, with PAYER_CANNOT_PAY.)
    // Without experience_context PayPal neither checks the card nor approves the token (CREATED).
    const setup = await paypalCall<PaypalSetupToken>(
      c.apiBase,
      c.token,
      'POST',
      '/v3/vault/setup-tokens',
      {
        customer: { merchant_customer_id: `sandbox.user.${run}` },
        payment_source: {
          card: {
            number: '4111111111111111',
            expiry: '2030-12',
            name: 'Sandbox Bidder',
            security_code: '123',
            verification_method: 'SCA_WHEN_REQUIRED',
            experience_context: { return_url: 'https://example.org/ok', cancel_url: 'https://example.org/no' },
          },
        },
      },
      { ...o, requestId: `sb-setup-${run}` },
    )
    expect(setup.status).toBe('APPROVED')
    const saved = await paypal.createPaymentToken(c, setup.id, `sb-save-${run}`)
    expect(saved.payment_source?.card?.verification_status).toBe('VERIFIED')
    expect(keyDiff(saved, fixture(paypalObjectFixtures.vaultPaymentTokenCard), { ignore: BIN_FIELDS })).toEqual([])
    expect(paymentTokenLabel(saved)).toEqual({ kind: 'card', label: 'Visa •••• 1111' })
    const input = { customId: `sandbox:${run}-v`, description: 'Sandbox bid', amountCents: 3000, kind: 'card' as const, vaultId: saved.id }
    const order = await paypal.chargeVaulted(c, input, `sb-charge-${run}`)
    expect(order.status).toBe('COMPLETED')
    expect(keyDiff(order, fixture(paypalObjectFixtures.vaultOrderCaptured), { ignore: BIN_FIELDS })).toEqual([])
    const capture = orderCapture(order)!
    expect(capture.status).toBe('COMPLETED')
    expect(captureFee(capture)).toBeGreaterThan(0)
    expect((await paypal.chargeVaulted(c, input, `sb-charge-${run}`)).id).toBe(order.id)
    await paypal.refundCapture(c, capture.id, { amountCents: 3000, customId: `sandbox:${run}-v` }, `sb-refund-${run}`)
    await paypal.deletePaymentToken(c, saved.id)
    await paypal.deletePaymentToken(c, saved.id)
  })

  test('a card whose check fails is refused when saved', async () => {
    const c = await call()
    const refused = paypalCall(
      c.apiBase,
      c.token,
      'POST',
      '/v3/vault/setup-tokens',
      {
        payment_source: {
          card: {
            number: '4005519200000004',
            expiry: '2030-12',
            name: 'CCREJECT-REFUSED',
            security_code: '123',
            verification_method: 'SCA_WHEN_REQUIRED',
            experience_context: { return_url: 'https://example.org/ok', cancel_url: 'https://example.org/no' },
          },
        },
      },
      { ...o, requestId: `sb-setup-bad-${run}` },
    )
    await expect(refused).rejects.toMatchObject({ status: 422, code: 'INVALID_PAYMENT_SOURCE' })
  })
})
