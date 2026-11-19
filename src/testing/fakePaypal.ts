// A fake PayPal for tests: tokens, orders (created, approved by the buyer, captured), refunds,
// webhook verification and Transaction Search, shaped from the sandbox fixtures. Helpers make the
// webhook a test posts to the app's route; the fake's verify endpoint accepts the signature they set.
//   const pp = fakePaypal()
//   const hook = pp.approve(orderId)              // the buyer approved: CHECKOUT.ORDER.APPROVED
//   await t.fetch('/paypal/webhook', hook)
import { centsToDecimal, decimalToCents } from '../core/money.js'
import type { PaypalCapture, PaypalEvent, PaypalOrder, PaypalRefund } from '../core/paypal.js'
import { fixture, paypalEvent, paypalObjectFixtures } from './fixtures.js'

const VALID_SIGNATURE = 'fake-valid-signature'

/**
 * How a method saved in the fake vault behaves. ok: verified, charges go through. unverified: its $0
 * check fails (saving answers 422 INVALID_PAYMENT_SOURCE, as the sandbox does). decline: a charge is
 * refused (422 INSTRUMENT_DECLINED). captureDeclined: the order is made but its capture DECLINED.
 * pending: the capture comes back PENDING. error: the next charge gets no answer (500), later ones work.
 */
export type VaultBehaviour = 'ok' | 'unverified' | 'decline' | 'captureDeclined' | 'pending' | 'error'

interface SetupToken {
  id: string
  status: 'CREATED' | 'PAYER_ACTION_REQUIRED' | 'APPROVED'
  kind: 'card' | 'paypal'
  customerId: string
  merchantCustomerId: string
  behaviour: VaultBehaviour
  source?: { card?: { brand: string; last_digits: string; expiry: string }; paypal?: { email_address: string } }
}

interface Order {
  id: string
  status: PaypalOrder['status']
  amountCents: number
  customId: string
  capture?: PaypalCapture
  createdAt: number
}

export interface FakePaypalOptions {
  apiBase?: string
  /** Whether Transaction Search is enabled on the app (it isn't on the real sandbox app: 403). */
  search?: boolean
  fallback?: (input: string, init?: RequestInit) => Promise<Response>
}

const ok = (body: unknown, status = 200) => Response.json(body, { status })
const issue = (status: number, name: string, issueName: string, description: string) => Response.json({ name, details: [{ issue: issueName, description }], message: description }, { status })

export function fakePaypal({ apiBase = 'https://api-m.sandbox.paypal.com', search = false, fallback }: FakePaypalOptions = {}) {
  const orders = new Map<string, Order>()
  const refunds = new Map<string, PaypalRefund & { captureId: string }>()
  const replies = new Map<string, unknown>()
  const webhooks = new Map<string, { id: string; url: string; event_types: { name: string }[] }>()
  const calls: { method: string; path: string; body: unknown }[] = []
  let n = 0
  let tokens = 0
  let captureOutcome: PaypalCapture['status'] = 'COMPLETED'
  let declineNext = false
  let refuse: ((call: { method: string; path: string }) => Response | undefined) | undefined
  let searchEnabled = search
  const setupTokens = new Map<string, SetupToken>()
  const vaultCharges: { vaultId: string; body: unknown }[] = []
  const vault = new Map<string, { id: string; customerId: string; merchantCustomerId: string; kind: 'card' | 'paypal'; behaviour: VaultBehaviour; source: SetupToken['source']; deleted?: boolean }>()

  const refundedOf = (captureId: string) =>
    [...refunds.values()].filter((r) => r.captureId === captureId && r.status !== 'FAILED' && r.status !== 'CANCELLED').reduce((s, r) => s + (decimalToCents(r.amount?.value) ?? 0), 0)

  /** The order as PayPal shows it; `created` is the answer to creating it, which (as in the sandbox) has no create_time yet. */
  function orderJson(o: Order, created = false): PaypalOrder {
    const base = fixture(created ? paypalObjectFixtures.orderCreated : paypalObjectFixtures.orderUnapproved) as unknown as PaypalOrder & { purchase_units: Record<string, unknown>[] }
    const unit = {
      ...base.purchase_units[0],
      custom_id: o.customId,
      amount: { currency_code: 'USD', value: centsToDecimal(o.amountCents) },
      ...(o.capture ? { payments: { captures: [o.capture] } } : {}),
    }
    const links =
      o.status === 'PAYER_ACTION_REQUIRED'
        ? [
            { href: `${apiBase}/v2/checkout/orders/${o.id}`, rel: 'self', method: 'GET' },
            { href: `https://www.sandbox.paypal.com/checkoutnow?token=${o.id}`, rel: 'payer-action', method: 'GET' },
          ]
        : [{ href: `${apiBase}/v2/checkout/orders/${o.id}`, rel: 'self', method: 'GET' }]
    return { ...base, id: o.id, status: o.status, purchase_units: [unit], links }
  }

  const fetch = async (input: string, init?: RequestInit): Promise<Response> => {
    const url = new URL(input)
    if (url.origin !== new URL(apiBase).origin) {
      if (fallback) return fallback(input, init)
      throw new Error(`fakePaypal: unexpected fetch ${input}`)
    }
    const method = init?.method ?? 'GET'
    const raw = typeof init?.body === 'string' ? init.body : ''
    const body: unknown = raw && (raw.startsWith('{') || raw.startsWith('[')) ? JSON.parse(raw) : raw
    calls.push({ method, path: url.pathname, body })
    const refused = refuse?.({ method, path: url.pathname })
    if (refused) return refused
    const requestId = new Headers(init?.headers).get('paypal-request-id')
    if (requestId && replies.has(requestId)) return ok(replies.get(requestId))
    const remember = (reply: unknown, status = 201) => {
      if (requestId) replies.set(requestId, reply)
      return ok(reply, status)
    }
    const path = url.pathname.split('/').filter(Boolean)

    if (url.pathname === '/v1/oauth2/token') return ok({ access_token: `A21-fake-${++tokens}`, token_type: 'Bearer', expires_in: 32_399 })
    if (url.pathname === '/v1/notifications/verify-webhook-signature') {
      const sig = (body as { transmission_sig?: string }).transmission_sig
      return ok({ verification_status: sig === VALID_SIGNATURE ? 'SUCCESS' : 'FAILURE' })
    }
    if (url.pathname === '/v1/notifications/webhooks') {
      if (method === 'GET') return ok({ webhooks: [...webhooks.values()] })
      const w = body as { url: string; event_types: { name: string }[] }
      if ([...webhooks.values()].some((x) => x.url === w.url)) return issue(400, 'WEBHOOK_URL_ALREADY_EXISTS', 'WEBHOOK_URL_ALREADY_EXISTS', 'Webhook URL already exists.')
      const made = { id: `FAKEWH${++n}`, url: w.url, event_types: w.event_types.map((e) => ({ name: e.name })) }
      webhooks.set(made.id, made)
      return ok(made, 201)
    }
    if (path[0] === 'v1' && path[1] === 'notifications' && path[2] === 'webhooks' && path[3]) {
      const w = webhooks.get(path[3])
      if (!w) return issue(404, 'INVALID_RESOURCE_ID', 'INVALID_RESOURCE_ID', 'Webhook not found.')
      if (method === 'DELETE') {
        webhooks.delete(w.id)
        return new Response(null, { status: 204 })
      }
      const patch = body as { op: string; path: string; value: { name: string }[] }[]
      const events = patch.find((x) => x.path === '/event_types')?.value
      if (events) w.event_types = events.map((e) => ({ name: e.name }))
      return ok(w)
    }
    if (method === 'POST' && url.pathname === '/v3/vault/setup-tokens') {
      const b = body as { customer?: { id?: string; merchant_customer_id?: string }; payment_source: { card?: unknown; paypal?: unknown } }
      const kind = b.payment_source.paypal ? 'paypal' : 'card'
      const t: SetupToken = {
        id: `FAKESETUP${++n}`,
        status: kind === 'paypal' ? 'PAYER_ACTION_REQUIRED' : 'CREATED',
        kind,
        customerId: b.customer?.id ?? `FAKECUST${++n}`,
        merchantCustomerId: b.customer?.merchant_customer_id ?? '',
        behaviour: 'ok',
      }
      setupTokens.set(t.id, t)
      return remember(setupJson(t), 201)
    }
    if (path[0] === 'v3' && path[2] === 'setup-tokens' && path[3] && method === 'GET') {
      const t = setupTokens.get(path[3])
      return t ? ok(setupJson(t)) : issue(404, 'RESOURCE_NOT_FOUND', 'INVALID_RESOURCE_ID', 'Specified resource ID does not exist.')
    }
    if (method === 'POST' && url.pathname === '/v3/vault/payment-tokens') {
      const id = (body as { payment_source: { token: { id: string } } }).payment_source.token.id
      const t = setupTokens.get(id)
      if (!t) return issue(404, 'RESOURCE_NOT_FOUND', 'INVALID_RESOURCE_ID', 'Specified resource ID does not exist.')
      if (t.status !== 'APPROVED') return issue(422, 'UNPROCESSABLE_ENTITY', 'SETUP_TOKEN_NOT_APPROVED', 'The setup token isn’t approved.')
      if (t.behaviour === 'unverified') return issue(422, 'UNPROCESSABLE_ENTITY', 'INVALID_PAYMENT_SOURCE', 'The provided payment source is not valid.')
      const token = { id: `fakepaytoken${++n}`, customerId: t.customerId, merchantCustomerId: t.merchantCustomerId, kind: t.kind, behaviour: t.behaviour, source: t.source }
      vault.set(token.id, token)
      return remember(tokenJson(token), 201)
    }
    if (path[0] === 'v3' && path[2] === 'payment-tokens' && path[3] && method === 'DELETE') {
      const v = vault.get(path[3])
      if (v) v.deleted = true
      return new Response(null, { status: 204 })
    }
    if (method === 'POST' && url.pathname === '/v2/checkout/orders' && (body as { payment_source?: { card?: { vault_id?: string }; paypal?: { vault_id?: string } } }).payment_source) {
      const b = body as { purchase_units: { custom_id: string; amount: { value: string } }[]; payment_source: { card?: { vault_id?: string }; paypal?: { vault_id?: string } } }
      const vaultId = b.payment_source.card?.vault_id ?? b.payment_source.paypal?.vault_id
      if (vaultId) {
        const v = vault.get(vaultId)
        if (!v || v.deleted) return issue(422, 'UNPROCESSABLE_ENTITY', 'INVALID_PAYMENT_SOURCE', 'The provided payment source is not valid.')
        if (v.behaviour === 'error') {
          v.behaviour = 'ok'
          return issue(500, 'INTERNAL_SERVER_ERROR', 'INTERNAL_SERVICE_ERROR', 'An internal service error has occurred.')
        }
        if (v.behaviour === 'decline')
          return issue(422, 'UNPROCESSABLE_ENTITY', 'INSTRUMENT_DECLINED', 'The instrument presented was either declined by the processor or bank, or it can’t be used for this payment.')
        const cents = decimalToCents(b.purchase_units[0].amount.value) ?? 0
        const o: Order = { id: `FAKEORDER${++n}`, status: 'COMPLETED', amountCents: cents, customId: b.purchase_units[0].custom_id, createdAt: Date.now() }
        const status = v.behaviour === 'captureDeclined' ? 'DECLINED' : v.behaviour === 'pending' ? 'PENDING' : 'COMPLETED'
        o.capture = {
          id: `FAKECAP${++n}`,
          status,
          amount: { currency_code: 'USD', value: centsToDecimal(cents) },
          custom_id: o.customId,
          // What the sandbox kept on a saved card: 2.59% + 49¢.
          seller_receivable_breakdown: { paypal_fee: { currency_code: 'USD', value: centsToDecimal(Math.round(cents * 0.0259) + 49) } },
          supplementary_data: { related_ids: { order_id: o.id } },
        }
        orders.set(o.id, o)
        vaultCharges.push({ vaultId, body })
        return remember(orderJson(o), 201)
      }
    }
    if (method === 'POST' && url.pathname === '/v2/checkout/orders') {
      const b = body as { purchase_units: { custom_id: string; amount: { value: string } }[] }
      const o: Order = {
        id: `FAKEORDER${++n}`,
        status: 'PAYER_ACTION_REQUIRED',
        amountCents: decimalToCents(b.purchase_units[0].amount.value) ?? 0,
        customId: b.purchase_units[0].custom_id,
        createdAt: Date.now(),
      }
      orders.set(o.id, o)
      return remember(orderJson(o, true), 200)
    }
    if (path[1] === 'checkout' && path[2] === 'orders' && path[3]) {
      const o = orders.get(path[3])
      if (!o) return issue(404, 'RESOURCE_NOT_FOUND', 'INVALID_RESOURCE_ID', 'Specified resource ID does not exist.')
      if (method === 'GET') return ok(orderJson(o))
      if (path[4] === 'capture') {
        if (o.status === 'COMPLETED') return Response.json(fixture(paypalObjectFixtures.errorOrderAlreadyCaptured), { status: 422 })
        if (o.status !== 'APPROVED') return Response.json(fixture(paypalObjectFixtures.errorOrderNotApproved), { status: 422 })
        if (declineNext) {
          declineNext = false
          return issue(422, 'UNPROCESSABLE_ENTITY', 'INSTRUMENT_DECLINED', 'The instrument presented was either declined by the processor or bank, or it can’t be used for this payment.')
        }
        const fee = Math.ceil(o.amountCents * 0.029) + 30
        o.capture = {
          id: `FAKECAP${++n}`,
          status: captureOutcome,
          amount: { currency_code: 'USD', value: centsToDecimal(o.amountCents) },
          custom_id: o.customId,
          seller_receivable_breakdown: { paypal_fee: { currency_code: 'USD', value: centsToDecimal(fee) } },
          supplementary_data: { related_ids: { order_id: o.id } },
        }
        o.status = 'COMPLETED'
        return remember(orderJson(o))
      }
    }
    if (path[1] === 'payments' && path[2] === 'captures' && path[3]) {
      const o = [...orders.values()].find((x) => x.capture?.id === path[3])
      if (!o?.capture) return issue(404, 'RESOURCE_NOT_FOUND', 'INVALID_RESOURCE_ID', 'Specified resource ID does not exist.')
      if (method === 'GET') return ok(o.capture)
      const b = body as { amount?: { value: string }; custom_id?: string }
      const cents = b.amount ? (decimalToCents(b.amount.value) ?? 0) : o.amountCents - refundedOf(o.capture.id)
      if (cents > o.amountCents - refundedOf(o.capture.id))
        return issue(422, 'UNPROCESSABLE_ENTITY', 'REFUND_AMOUNT_EXCEEDED', 'The refund amount must be less than or equal to the capture amount that has not yet been refunded.')
      return remember(makeRefund(o.capture.id, cents, b.custom_id))
    }
    if (path[1] === 'payments' && path[2] === 'refunds' && path[3]) {
      const r = refunds.get(path[3])
      return r ? ok(r) : issue(404, 'RESOURCE_NOT_FOUND', 'INVALID_RESOURCE_ID', 'Specified resource ID does not exist.')
    }
    if (url.pathname === '/v1/reporting/transactions') {
      if (!searchEnabled) return Response.json(fixture(paypalObjectFixtures.transactionSearchNotAuthorized), { status: 403 })
      const details = [...orders.values()]
        .filter((o) => o.capture)
        .map((o) => ({
          transaction_info: {
            transaction_id: o.capture?.id,
            custom_field: o.customId,
            transaction_amount: { currency_code: 'USD', value: centsToDecimal(o.amountCents) },
            transaction_status: 'S',
            transaction_event_code: 'T0006',
          },
        }))
      return ok({ transaction_details: details, total_pages: 1, page: 1 })
    }
    return issue(404, 'NOT_FOUND', 'NOT_FOUND', `fakePaypal doesn’t know ${method} ${url.pathname}`)
  }

  function setupJson(t: SetupToken) {
    return {
      id: t.id,
      status: t.status,
      customer: { id: t.customerId, merchant_customer_id: t.merchantCustomerId },
      payment_source: t.source ?? { [t.kind]: {} },
      links: t.status === 'PAYER_ACTION_REQUIRED' ? [{ href: `https://www.sandbox.paypal.com/agreements/approve?approval_session_id=${t.id}`, rel: 'approve', method: 'GET' }] : [],
    }
  }

  function tokenJson(v: { id: string; customerId: string; merchantCustomerId: string; source: SetupToken['source'] }) {
    const card = v.source?.card
    return {
      id: v.id,
      customer: { id: v.customerId, merchant_customer_id: v.merchantCustomerId },
      payment_source: card
        ? { card: { ...card, verification_status: 'VERIFIED', verification: { amount: { currency_code: 'USD', value: '0.00' }, processor_response: { response_code: '0000' } } } }
        : v.source,
    }
  }

  function makeRefund(captureId: string, cents: number, customId: string | undefined, status: PaypalRefund['status'] = 'COMPLETED') {
    const r = {
      id: `FAKEREFUND${++n}`,
      status,
      amount: { currency_code: 'USD', value: centsToDecimal(cents) },
      custom_id: customId,
      links: [{ href: `${apiBase}/v2/payments/captures/${captureId}`, rel: 'up', method: 'GET' }],
      captureId,
    }
    refunds.set(r.id, r)
    const o = [...orders.values()].find((x) => x.capture?.id === captureId)
    if (o?.capture) o.capture.status = refundedOf(captureId) >= o.amountCents ? 'REFUNDED' : 'PARTIALLY_REFUNDED'
    return r
  }

  function order(id: string): Order {
    const o = orders.get(id)
    if (!o) throw new Error(`fakePaypal: no order ${id}`)
    return o
  }

  /** The request a test posts to the app's webhook route, with headers the fake's verify endpoint accepts (or not). */
  function webhook(event: PaypalEvent, o: { valid?: boolean } = {}): RequestInit {
    return {
      method: 'POST',
      body: JSON.stringify(event),
      headers: {
        'content-type': 'application/json',
        'paypal-auth-algo': 'SHA256withRSA',
        'paypal-cert-url': 'https://api.sandbox.paypal.com/v1/notifications/certs/CERT-fake',
        'paypal-transmission-id': `t-${event.id}`,
        'paypal-transmission-sig': o.valid === false ? 'forged' : VALID_SIGNATURE,
        'paypal-transmission-time': new Date().toISOString(),
      },
    }
  }

  return {
    fetch,
    webhooks: () => [...webhooks.values()],
    calls,
    webhook,
    order: (id: string) => orderJson(order(id)),
    orders: () => [...orders.values()].map((o) => orderJson(o)),
    refunds: () => [...refunds.values()],
    get tokens() {
      return tokens
    },
    refuse(fn?: typeof refuse) {
      refuse = fn
    },
    /** Captures made after this come back with this status (DECLINED, PENDING). */
    capturesCome(status: PaypalCapture['status']) {
      captureOutcome = status
    },
    /**
     * The next capture is refused with INSTRUMENT_DECLINED (422), as PayPal answers when the card or
     * account the buyer chose on the buttons is turned down; the order stays APPROVED for another try.
     */
    declineNextCapture() {
      declineNext = true
    },
    /**
     * The buyer finishes PayPal's Card Fields (or approves on PayPal's page) for a setup token: it is
     * APPROVED with the card or account given, and the method saved from it behaves as `behaviour`.
     */
    approveSetup(id: string, o: { card?: { brand?: string; last4?: string }; paypalEmail?: string; behaviour?: VaultBehaviour } = {}) {
      const t = setupTokens.get(id)
      if (!t) throw new Error(`fakePaypal: no setup token ${id}`)
      t.status = 'APPROVED'
      t.behaviour = o.behaviour ?? 'ok'
      t.source =
        t.kind === 'paypal'
          ? { paypal: { email_address: o.paypalEmail ?? 'buyer@example.org' } }
          : { card: { brand: o.card?.brand ?? 'VISA', last_digits: o.card?.last4 ?? '1111', expiry: '2030-12' } }
    },
    /** Methods in the vault (deleted ones marked). */
    vault: () => [...vault.values()],
    /** Orders made on saved methods, with what was asked. */
    vaultCharges,
    /** Makes a saved method behave differently from now on. */
    setVaultBehaviour(tokenId: string, behaviour: VaultBehaviour) {
      const v = vault.get(tokenId)
      if (!v) throw new Error(`fakePaypal: no payment token ${tokenId}`)
      v.behaviour = behaviour
    },
    enableSearch(on = true) {
      searchEnabled = on
    },
    /** The buyer approves on PayPal's page; returns the CHECKOUT.ORDER.APPROVED webhook. */
    approve(id: string, o: { eventId?: string } = {}) {
      const x = order(id)
      x.status = 'APPROVED'
      return webhook(paypalEvent('CHECKOUT.ORDER.APPROVED', { ...orderJson(x) }, o.eventId))
    },
    /** PAYMENT.CAPTURE.COMPLETED (or another capture event) for a captured order. */
    captureEvent(id: string, name: 'PAYMENT.CAPTURE.COMPLETED' | 'PAYMENT.CAPTURE.PENDING' | 'PAYMENT.CAPTURE.DECLINED' = 'PAYMENT.CAPTURE.COMPLETED') {
      const x = order(id)
      if (!x.capture) throw new Error(`fakePaypal: order ${id} isn’t captured`)
      return webhook(paypalEvent(name, { ...x.capture, links: [{ href: `${apiBase}/v2/checkout/orders/${id}`, rel: 'up', method: 'GET' }] }))
    },
    /** A payment captured outside this app's knowledge (e.g. its row was lost), tagged for `app`. */
    capturedElsewhere(app: string, checkoutId: string, cents: number) {
      const o: Order = { id: `FAKEORDER${++n}`, status: 'COMPLETED', amountCents: cents, customId: `${app}:${checkoutId}`, createdAt: Date.now() }
      o.capture = { id: `FAKECAP${++n}`, status: 'COMPLETED', amount: { currency_code: 'USD', value: centsToDecimal(cents) }, custom_id: o.customId }
      orders.set(o.id, o)
      return o.capture.id
    },
    /** Someone refunds in PayPal's dashboard (or PayPal reverses the payment). */
    refundInDashboard(captureId: string, cents: number, name: 'PAYMENT.CAPTURE.REFUNDED' | 'PAYMENT.CAPTURE.REVERSED' = 'PAYMENT.CAPTURE.REFUNDED') {
      const r = makeRefund(captureId, cents, undefined)
      const { captureId: _c, ...resource } = r
      return { refund: r, hook: webhook(paypalEvent(name, { ...resource })) }
    },
    dispute(captureId: string, status: 'CREATED' | 'RESOLVED', cents = 1000) {
      return webhook(
        paypalEvent(status === 'CREATED' ? 'CUSTOMER.DISPUTE.CREATED' : 'CUSTOMER.DISPUTE.RESOLVED', {
          dispute_id: `PP-D-${captureId}`,
          disputed_transactions: [{ seller_transaction_id: captureId }],
          dispute_amount: { currency_code: 'USD', value: centsToDecimal(cents) },
          status: status === 'CREATED' ? 'OPEN' : 'RESOLVED',
        }),
      )
    },
    event: (name: Parameters<typeof paypalEvent>[0], resource: Record<string, unknown> = {}, eventId?: string, o?: { valid?: boolean }) => webhook(paypalEvent(name, resource, eventId), o),
  }
}

export type FakePaypal = ReturnType<typeof fakePaypal>
