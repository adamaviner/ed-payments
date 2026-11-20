// The processors' wire code against real payloads (src/testing/fixtures) and a recording fetch.
import { describe, expect, test } from 'vitest'
import { fixture, paypalEvent, paypalObjectFixtures, stripeEvent, stripeObjectFixtures } from '../testing/fixtures.js'
import {
  ProcessorError,
  STRIPE_API_VERSION,
  approveUrl,
  captureFee,
  captureOrderId,
  centsToDecimal,
  constantTimeEqual,
  decimalToCents,
  dollars,
  formEncode,
  orderBody,
  orderCapture,
  orderCustomId,
  parsePaypalEvent,
  parseStripeEvent,
  parseTag,
  paypal,
  paypalToken,
  refundCaptureId,
  searchActivity,
  searchTransactions,
  paypalEventType,
  sessionExpiry,
  sessionParams,
  sessionState,
  signStripePayload,
  stripe,
  stripeFee,
  tagFor,
  verifyPaypalWebhook,
  verifyStripeSignature,
  type PaypalCapture,
  type PaypalOrder,
  type PaypalRefund,
  type StripePaymentIntent,
  type StripeSession,
} from './index.js'

interface Call {
  url: string
  method: string
  headers: Headers
  body: string
}

/** A fetch that records each call and answers with what `answer` returns. */
function recorder(answer: (c: Call) => Response) {
  const calls: Call[] = []
  const fetch = async (input: string, init?: RequestInit) => {
    const c = { url: input, method: init?.method ?? 'GET', headers: new Headers(init?.headers), body: typeof init?.body === 'string' ? init.body : '' }
    calls.push(c)
    return answer(c)
  }
  return { calls, fetch }
}

const MIN = 60_000

describe('money and tags', () => {
  test('cents and PayPal decimals convert without floats', () => {
    expect(centsToDecimal(2500)).toBe('25.00')
    expect(centsToDecimal(29)).toBe('0.29')
    expect(centsToDecimal(100_005)).toBe('1000.05')
    expect(decimalToCents('0.29')).toBe(29)
    expect(decimalToCents('25.5')).toBe(2550)
    expect(decimalToCents('25')).toBe(2500)
    expect(decimalToCents('2.345')).toBeNull()
    expect(decimalToCents('-1.00')).toBeNull()
    expect(decimalToCents(undefined)).toBeNull()
    expect(dollars(1234)).toBe('$12.34')
    expect(() => centsToDecimal(1.5)).toThrow()
  })

  test('a tag is <app>:<id>; anything else isn’t one', () => {
    expect(tagFor('market', 'k1')).toBe('market:k1')
    expect(parseTag('market:k1:x')).toEqual({ app: 'market', id: 'k1:x' })
    expect(parseTag('k1')).toBeNull()
    expect(parseTag(':k1')).toBeNull()
    expect(parseTag(null)).toBeNull()
  })
})

describe('Stripe requests', () => {
  test('form encoding nests objects and arrays the way Stripe reads them', () => {
    expect(formEncode({ a: 1, b: { c: 'x y', d: [true, null] }, e: undefined })).toBe('a=1&b%5Bc%5D=x%20y&b%5Bd%5D%5B0%5D=true&b%5Bd%5D%5B1%5D=')
  })

  test('a session is tagged, priced in cents, and expires within Stripe’s 30 minute to 24 hour window', () => {
    const now = Date.UTC(2030, 0, 1)
    const p = sessionParams({
      app: 'market',
      checkoutId: 'k1',
      description: 'A bowl',
      amountCents: 2500,
      method: 'ach',
      email: 'b@example.org',
      successUrl: 's',
      cancelUrl: 'c',
      expiresAt: now + 5 * MIN,
      now,
    })
    expect(p).toMatchObject({
      mode: 'payment',
      allowed_payment_method_types: ['us_bank_account'],
      client_reference_id: 'k1',
      metadata: { app: 'market', checkoutId: 'k1' },
      payment_intent_data: { metadata: { app: 'market', checkoutId: 'k1' } },
      line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: 2500, product_data: { name: 'A bowl' } } }],
      expires_at: (now + 31 * MIN) / 1000,
    })
    expect(sessionExpiry(now + 48 * 60 * MIN, now)).toBe((now + 24 * 60 * MIN - MIN) / 1000)
    expect(sessionExpiry(now + 2 * 60 * MIN, now)).toBe((now + 2 * 60 * MIN) / 1000)
    expect(p).toMatchObject({ success_url: 's', cancel_url: 'c' })
    expect(p).not.toHaveProperty('ui_mode')
  })

  test('an embedded session is embedded_page with a return_url, and has no success or cancel page', () => {
    const now = Date.UTC(2030, 0, 1)
    const p = sessionParams({
      app: 'market',
      checkoutId: 'k1',
      description: 'A bowl',
      amountCents: 2500,
      method: 'card',
      successUrl: 's',
      cancelUrl: 'c',
      expiresAt: now + 60 * MIN,
      now,
      embedded: true,
    })
    expect(p).toMatchObject({ ui_mode: 'embedded_page', return_url: 's', client_reference_id: 'k1', allowed_payment_method_types: ['card'] })
    expect(p).not.toHaveProperty('success_url')
    expect(p).not.toHaveProperty('cancel_url')
  })

  test('calls carry the pinned version, the key and an idempotency key; errors keep Stripe’s message and code', async () => {
    const ok = recorder(() => Response.json(fixture(stripeObjectFixtures.sessionOpen)))
    const now = Date.now()
    const s = await stripe.createSession(
      { secretKey: 'sk_test_x' },
      { app: 'a', checkoutId: 'k1', description: 'd', amountCents: 100, method: 'card', successUrl: 's', cancelUrl: 'c', expiresAt: now, now },
      { fetch: ok.fetch },
    )
    expect(s.url).toMatch(/^https:\/\/checkout\.stripe\.com\//)
    const [c] = ok.calls
    expect(c.url).toBe('https://api.stripe.com/v1/checkout/sessions')
    expect(c.headers.get('stripe-version')).toBe(STRIPE_API_VERSION)
    expect(c.headers.get('authorization')).toBe('Bearer sk_test_x')
    expect(c.headers.get('idempotency-key')).toBe('checkout-k1')
    expect(c.body).toContain('allowed_payment_method_types%5B0%5D=card')

    const missing = recorder(() => Response.json(fixture(stripeObjectFixtures.errorResourceMissing), { status: 404 }))
    const err = await stripe.retrieveSession({ secretKey: 'k' }, 'cs_x', { fetch: missing.fetch }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ProcessorError)
    expect(err).toMatchObject({ processor: 'stripe', status: 404, code: 'resource_missing', retryable: false })
    expect(missing.calls[0].url).toBe('https://api.stripe.com/v1/checkout/sessions/cs_x?expand%5B0%5D=payment_intent.latest_charge.balance_transaction')
  })

  test('a network failure is a retryable ProcessorError', async () => {
    const err = await stripe
      .retrieveRefund({ secretKey: 'k' }, 're_1', {
        fetch: async () => {
          throw new TypeError('fetch failed')
        },
      })
      .catch((e: unknown) => e)
    expect(err).toMatchObject({ status: 0, retryable: true })
  })

  test('refunds are tagged and keyed by the refund id', async () => {
    const r = recorder(() => Response.json(fixture(stripeObjectFixtures.refund)))
    await stripe.createRefund({ secretKey: 'k' }, { paymentIntent: 'pi_1', amountCents: 500, app: 'market', refundId: 'r1' }, { fetch: r.fetch })
    expect(r.calls[0].headers.get('idempotency-key')).toBe('refund-r1')
    expect(new URLSearchParams(r.calls[0].body).get('metadata[refundId]')).toBe('r1')
    expect(new URLSearchParams(r.calls[0].body).get('amount')).toBe('500')
  })
})

describe('Stripe objects', () => {
  test('session states from real sessions', () => {
    expect(sessionState(fixture(stripeObjectFixtures.sessionOpen) as unknown as StripeSession)).toBe('open')
    expect(sessionState(fixture(stripeObjectFixtures.sessionExpired) as unknown as StripeSession)).toBe('expired')
    expect(sessionState(stripeEvent('checkout.session.completed').data.object as unknown as StripeSession)).toBe('paid')
    expect(sessionState(stripeEvent('checkout.session.completed-ach').data.object as unknown as StripeSession)).toBe('processing')
  })

  test('the fee comes from an expanded balance transaction, when there is one', () => {
    const pi = fixture(stripeObjectFixtures.paymentIntent) as unknown as StripePaymentIntent
    expect(stripeFee(pi)).toBeNull()
    const charge = pi.latest_charge
    if (!charge || typeof charge === 'string') throw new Error('fixture should have its charge expanded')
    expect(stripeFee({ ...pi, latest_charge: { ...charge, balance_transaction: { id: 'txn_1', fee: 103 } } })).toBe(103)
  })

  test('events parse; anything else doesn’t', () => {
    const e = stripeEvent('refund.created')
    expect(parseStripeEvent(JSON.stringify(e))?.type).toBe('refund.created')
    expect(parseStripeEvent('{"object":"list"}')).toBeNull()
    expect(parseStripeEvent('not json')).toBeNull()
  })
})

describe('Stripe signatures', () => {
  const secret = 'whsec_test_secret'
  const body = JSON.stringify(stripeEvent('checkout.session.completed'))
  const now = Date.UTC(2030, 0, 1)
  const t = now / 1000

  test('a correct signature passes, with other entries around it', async () => {
    const header = await signStripePayload(body, secret, t)
    expect(await verifyStripeSignature(body, header, secret, now)).toBe(true)
    expect(await verifyStripeSignature(body, `${header},v0=abc,secret=whsec_***,destination=we_1`, secret, now)).toBe(true)
    expect(await verifyStripeSignature(body, `t=${t},v1=deadbeef,${header.split(',')[1]}`, secret, now)).toBe(true)
  })

  test('a wrong secret, a changed body, a stale or missing timestamp all fail', async () => {
    const header = await signStripePayload(body, secret, t)
    expect(await verifyStripeSignature(body, header, 'whsec_other', now)).toBe(false)
    expect(await verifyStripeSignature(`${body} `, header, secret, now)).toBe(false)
    expect(await verifyStripeSignature(body, header, secret, now + 301_000)).toBe(false)
    expect(await verifyStripeSignature(body, header.replace(/^t=\d+,/, ''), secret, now)).toBe(false)
    expect(await verifyStripeSignature(body, null, secret, now)).toBe(false)
    expect(await verifyStripeSignature(body, header, '', now)).toBe(false)
  })

  test('constant-time comparison', () => {
    expect(constantTimeEqual('abc', 'abc')).toBe(true)
    expect(constantTimeEqual('abc', 'abd')).toBe(false)
    expect(constantTimeEqual('abc', 'abcd')).toBe(false)
  })
})

describe('PayPal', () => {
  const call = (fetch: (input: string, init?: RequestInit) => Promise<Response>) => ({ apiBase: 'https://api-m.sandbox.paypal.com', token: 'tok', fetch })

  test('an order uses experience_context (not application_context), cents as a decimal, and the tag as custom_id', () => {
    const body = orderBody({ customId: 'market:k1', description: 'x'.repeat(200), amountCents: 2529, returnUrl: 'https://r', cancelUrl: 'https://c' })
    expect(body.purchase_units[0]).toEqual({ custom_id: 'market:k1', description: 'x'.repeat(127), amount: { currency_code: 'USD', value: '25.29' } })
    expect(body.payment_source?.paypal.experience_context).toMatchObject({ return_url: 'https://r', cancel_url: 'https://c', user_action: 'PAY_NOW', shipping_preference: 'NO_SHIPPING' })
    expect(JSON.stringify(body)).not.toContain('application_context')
  })

  test('an order for the buttons names no payment_source (the button pressed decides) and keeps no shipping and Pay Now', () => {
    const body = orderBody({ customId: 'market:k1', description: 'd', amountCents: 2529, returnUrl: 'https://r', cancelUrl: 'https://c', brandName: 'Earthdance', embedded: true })
    expect(body).not.toHaveProperty('payment_source')
    expect(body.purchase_units[0]).toMatchObject({ custom_id: 'market:k1', amount: { currency_code: 'USD', value: '25.29' } })
    expect(body).toMatchObject({ intent: 'CAPTURE', application_context: { shipping_preference: 'NO_SHIPPING', user_action: 'PAY_NOW', brand_name: 'Earthdance' } })
  })

  test('the buyer goes to the payer-action link of a real sandbox order', async () => {
    const r = recorder(() => Response.json(fixture(paypalObjectFixtures.orderCreated)))
    const order = await paypal.createOrder(call(r.fetch), { customId: 'fixture:fixtureorder1', description: 'd', amountCents: 2500, returnUrl: 'r', cancelUrl: 'c' }, 'checkout-k1')
    expect(order.status).toBe('PAYER_ACTION_REQUIRED')
    expect(approveUrl(order)).toMatch(/^https:\/\/www\.sandbox\.paypal\.com\/checkoutnow\?token=/)
    expect(orderCustomId(order)).toBe('fixture:fixtureorder1')
    expect(r.calls[0].headers.get('paypal-request-id')).toBe('checkout-k1')
    expect(r.calls[0].headers.get('prefer')).toBe('return=representation')
  })

  test('capture errors carry PayPal’s issue: not approved (real) and already captured', async () => {
    for (const [f, issue] of [
      [paypalObjectFixtures.errorOrderNotApproved, 'ORDER_NOT_APPROVED'],
      [paypalObjectFixtures.errorOrderAlreadyCaptured, 'ORDER_ALREADY_CAPTURED'],
    ] as const) {
      const r = recorder(() => Response.json(fixture(f), { status: 422 }))
      const err = await paypal.captureOrder(call(r.fetch), 'O1', 'capture-k1').catch((e: unknown) => e)
      expect(err).toMatchObject({ processor: 'paypal', status: 422, code: issue })
    }
  })

  test('a captured order gives its capture, amount, fee and order id', () => {
    const order = fixture(paypalObjectFixtures.orderCaptured) as unknown as PaypalOrder
    const capture = orderCapture(order)
    expect(capture).toMatchObject({ id: '3C679366HH908993F', status: 'COMPLETED', custom_id: 'fixture:fixtureorder1' })
    expect(captureFee(capture as PaypalCapture)).toBe(300)
    const completed = paypalEvent('PAYMENT.CAPTURE.COMPLETED').resource as unknown as PaypalCapture
    expect(captureOrderId(completed)).toBe('28U14622MW998902M')
    expect(captureFee(completed)).toBe(84)
    expect(refundCaptureId(paypalEvent('PAYMENT.CAPTURE.REFUNDED').resource as unknown as PaypalRefund)).toBe('27C890397M291943E')
  })

  test('tokens: client credentials in, expiry out; a refusal is an error', async () => {
    const r = recorder(() => Response.json({ access_token: 'A', expires_in: 32_399 }))
    expect(await paypalToken({ clientId: 'id', clientSecret: 'secret', apiBase: 'https://api-m.sandbox.paypal.com' }, 1000, { fetch: r.fetch })).toEqual({ token: 'A', expiresAt: 1000 + 32_399_000 })
    expect(r.calls[0].headers.get('authorization')).toBe(`Basic ${btoa('id:secret')}`)
    const no = recorder(() => Response.json({ error: 'invalid_client', error_description: 'Client Authentication failed' }, { status: 401 }))
    await expect(paypalToken({ clientId: 'id', clientSecret: 'x', apiBase: 'b' }, 0, { fetch: no.fetch })).rejects.toThrow(/Client Authentication failed/)
  })

  test('webhook verification sends the raw body untouched and reads PayPal’s answer', async () => {
    const raw = '{"id":"WH-1",  "event_type":"PAYMENT.CAPTURE.COMPLETED","resource":{"amount":{"value":"10.00"}}}'
    const headers = new Headers({
      'paypal-auth-algo': 'SHA256withRSA',
      'paypal-cert-url': 'https://api.sandbox.paypal.com/v1/notifications/certs/CERT-1',
      'paypal-transmission-id': 't1',
      'paypal-transmission-sig': 'sig',
      'paypal-transmission-time': '2030-01-01T00:00:00Z',
    })
    const keys = { clientId: 'i', clientSecret: 's', webhookId: 'WH-ID', apiBase: 'https://api-m.sandbox.paypal.com' }
    const ok = recorder(() => Response.json({ verification_status: 'SUCCESS' }))
    expect(await verifyPaypalWebhook(keys, 'tok', headers, raw, { fetch: ok.fetch })).toBe(true)
    expect(ok.calls[0].body.endsWith(`"webhook_event":${raw}}`)).toBe(true)
    expect(JSON.parse(ok.calls[0].body)).toMatchObject({ webhook_id: 'WH-ID', transmission_id: 't1', webhook_event: { id: 'WH-1' } })
    const no = recorder(() => Response.json(fixture(paypalObjectFixtures.verifyFailure)))
    expect(await verifyPaypalWebhook(keys, 'tok', headers, raw, { fetch: no.fetch })).toBe(false)
    headers.delete('paypal-transmission-sig')
    expect(await verifyPaypalWebhook(keys, 'tok', headers, raw, { fetch: ok.fetch })).toBe(false)
  })

  test('events parse; anything else doesn’t', () => {
    expect(parsePaypalEvent(JSON.stringify(paypalEvent('CHECKOUT.ORDER.APPROVED')))?.event_type).toBe('CHECKOUT.ORDER.APPROVED')
    expect(parsePaypalEvent('{"id":"x"}')).toBeNull()
  })

  test('Transaction Search: rows read as cents (refunds negative); not enabled is a 403 NOT_AUTHORIZED (real sandbox answer)', async () => {
    const r = recorder(() =>
      Response.json({
        transaction_details: [
          {
            transaction_info: {
              transaction_id: 'CAP1',
              custom_field: 'market:k1',
              transaction_amount: { currency_code: 'USD', value: '25.00' },
              transaction_status: 'S',
              transaction_event_code: 'T0006',
            },
          },
          { transaction_info: { transaction_id: 'REF1', transaction_amount: { currency_code: 'USD', value: '-10.00' }, transaction_status: 'S', transaction_event_code: 'T1107' } },
          { transaction_info: { transaction_id: 'EUR1', transaction_amount: { currency_code: 'EUR', value: '1.00' } } },
        ],
        total_pages: 1,
      }),
    )
    const found = await searchTransactions(call(r.fetch), { start: Date.UTC(2030, 0, 1), end: Date.UTC(2030, 0, 4), page: 1 })
    expect(found.transactions).toEqual([
      { transactionId: 'CAP1', customField: 'market:k1', amountCents: 2500, status: 'S', eventCode: 'T0006' },
      { transactionId: 'REF1', customField: null, amountCents: -1000, status: 'S', eventCode: 'T1107' },
    ])
    expect(r.calls[0].url).toContain('start_date=2030-01-01T00:00:00Z&end_date=2030-01-04T00:00:00Z')
    const denied = recorder(() => Response.json(fixture(paypalObjectFixtures.transactionSearchNotAuthorized), { status: 403 }))
    await expect(searchTransactions(call(denied.fetch), { start: 0, end: 1, page: 1 })).rejects.toMatchObject({ status: 403, code: 'NOT_AUTHORIZED' })
  })

  test('searchActivity: the other party, cart and fee, as the live API answers (dates with +0000)', async () => {
    const r = recorder(() =>
      Response.json({
        transaction_details: [
          {
            transaction_info: {
              transaction_id: 'TX1',
              transaction_event_code: 'T0006',
              transaction_initiation_date: '2030-01-02T15:04:05+0000',
              transaction_amount: { currency_code: 'USD', value: '50.00' },
              fee_amount: { currency_code: 'USD', value: '-1.49' },
              transaction_status: 'S',
              invoice_id: 'INV-1',
              custom_field: 'market:k1',
            },
            payer_info: { email_address: 'Ann@Example.org', payer_name: { given_name: 'Ann', surname: 'Lee' } },
            cart_info: { item_details: [{ item_name: 'Workshop pass' }, {}] },
          },
          {
            transaction_info: {
              transaction_id: 'TX2',
              transaction_event_code: 'T0005',
              transaction_initiation_date: '2030-01-03T00:00:00+0000',
              transaction_amount: { currency_code: 'USD', value: '20.00' },
              transaction_status: 'S',
            },
            payer_info: { payer_name: { alternate_full_name: 'Guest Card' } },
          },
          { transaction_info: { transaction_id: 'NODATE', transaction_amount: { currency_code: 'USD', value: '1.00' } } },
        ],
        total_pages: 3,
      }),
    )
    const found = await searchActivity(call(r.fetch), { start: Date.UTC(2030, 0, 1), end: Date.UTC(2030, 0, 4), page: 2 })
    expect(found.totalPages).toBe(3)
    expect(found.activity).toEqual([
      {
        transactionId: 'TX1',
        at: Date.UTC(2030, 0, 2, 15, 4, 5),
        eventCode: 'T0006',
        type: 'Checkout payment',
        direction: 'in',
        amountCents: 5000,
        feeCents: -149,
        currency: 'USD',
        status: 'S',
        name: 'Ann Lee',
        email: 'ann@example.org',
        subject: null,
        note: null,
        items: ['Workshop pass'],
        invoiceId: 'INV-1',
        customField: 'market:k1',
        referenceId: null,
      },
      expect.objectContaining({ transactionId: 'TX2', type: 'Card payment', name: 'Guest Card', email: null, feeCents: null, items: [] }),
    ])
    expect(r.calls[0].url).toContain('fields=transaction_info,payer_info,cart_info&page_size=500&page=2')
    expect([paypalEventType('T1107'), paypalEventType('T0399'), paypalEventType('T9999')]).toEqual(['Refund', 'Bank deposit', 'T9999'])
  })
})
