// A fake Stripe for tests: a fetch function that keeps sessions, customers, saved payment methods,
// SetupIntents, PaymentIntents, refunds and webhook endpoints the way Stripe does (objects shaped from
// the real test-mode fixtures; contract.test.ts checks they stay that shape), plus helpers that make
// the signed webhook a test posts to the app's route.
//   const stripe = fakeStripe()
//   vi.stubGlobal('fetch', stripe.fetch)          // or registerPayments(t), which does this
//   const hook = await stripe.pay(sessionId)      // marks it paid; returns the signed webhook
//   await t.fetch('/stripe/webhook', hook)
import {
  signStripePayload,
  type StripeCustomer,
  type StripeEvent,
  type StripePaymentIntent,
  type StripePaymentMethod,
  type StripeRefund,
  type StripeSession,
  type StripeSetupIntent,
  type StripeWebhookEndpoint,
} from '../core/stripe.js'
import { fixture, stripeEvent, stripeObjectFixtures } from './fixtures.js'

export const FAKE_STRIPE_WEBHOOK_SECRET = 'whsec_fake_test_secret'

interface Session {
  s: StripeSession
  method: string
  /** The fee Stripe would keep once paid. */
  fee: number
  /** The Customer it was made for, and whether it saves what pays it (setup_future_usage). */
  customer: string | null
  saves: boolean
}

/**
 * How a saved method behaves when charged with nobody present, like Stripe's test methods:
 * ok (pm_card_visa), decline (pm_card_chargeCustomerFail), auth (pm_card_authenticationRequired),
 * bank (pm_usBankAccount_success: processing, then paid when settleBank says), and two declines that
 * test mode can't attach: insufficient (decline_code insufficient_funds) and lost (lost_card,
 * advice do_not_try_again), shaped like the real decline.
 */
export type FakeMethodBehaviour = 'ok' | 'decline' | 'auth' | 'bank' | 'insufficient' | 'lost'

export interface FakeStripeOptions {
  webhookSecret?: string
  /** Answers every other URL; without it, other URLs throw. */
  fallback?: (input: string, init?: RequestInit) => Promise<Response>
}

type Call = { method: string; path: string; params: URLSearchParams }

const ok = (body: unknown) => Response.json(body)
const fail = (status: number, body: unknown) => Response.json(body, { status })
const missing = (what: string, id: string) => fail(404, { error: { type: 'invalid_request_error', code: 'resource_missing', message: `No such ${what}: '${id}'` } })
const nowSec = () => Math.floor(Date.now() / 1000)
const cardFee = (amount: number) => Math.ceil(amount * 0.029) + 30
const bankFee = (amount: number) => Math.min(Math.ceil(amount * 0.008), 500)

export function fakeStripe({ webhookSecret = FAKE_STRIPE_WEBHOOK_SECRET, fallback }: FakeStripeOptions = {}) {
  const sessions = new Map<string, Session>()
  const refunds = new Map<string, StripeRefund>()
  /** PaymentIntent id → amount paid, for refunds. */
  const intents = new Map<string, { amount: number; fee: number; metadata: Record<string, string> }>()
  const customers = new Map<string, StripeCustomer>()
  const methods = new Map<string, { pm: StripePaymentMethod; behaviour: FakeMethodBehaviour }>()
  const setupIntents = new Map<string, StripeSetupIntent>()
  /** PaymentIntents made directly (saved-method charges and on-session payments). */
  const paymentIntents = new Map<string, StripePaymentIntent>()
  const endpoints = new Map<string, StripeWebhookEndpoint>()
  const idempotent = new Map<string, { request: string; status: number; body: unknown }>()
  const calls: Call[] = []
  let n = 0
  /** Set to answer a call with this instead (e.g. Stripe being down). */
  let refuse: ((call: Call) => Response | undefined) | undefined
  /** How the next refunds come back: succeeded at once, or pending. */
  let refundStatus: StripeRefund['status'] = 'succeeded'

  const refundedOf = (pi: string) => [...refunds.values()].filter((r) => r.payment_intent === pi && r.status !== 'failed' && r.status !== 'canceled').reduce((sum, r) => sum + r.amount, 0)

  function expanded(x: Session): StripeSession {
    const pi = typeof x.s.payment_intent === 'string' ? x.s.payment_intent : null
    if (!pi) return structuredClone(x.s)
    const base = fixture(stripeObjectFixtures.paymentIntent) as unknown as Record<string, unknown> & { latest_charge: Record<string, unknown> }
    const intent = {
      ...base,
      id: pi,
      amount: x.s.amount_total,
      amount_received: x.s.amount_total,
      metadata: x.s.metadata,
      latest_charge: { ...base.latest_charge, payment_intent: pi, balance_transaction: { id: `txn_${pi}`, fee: x.fee } },
    }
    return { ...structuredClone(x.s), payment_intent: intent as unknown as StripeSession['payment_intent'] }
  }

  /** A direct PaymentIntent as Stripe answers it, expanded (payment method, charge and fee) when asked. */
  function intentView(pi: StripePaymentIntent, expand: boolean): StripePaymentIntent {
    const out = structuredClone(pi)
    if (!expand) return out
    const pmId = typeof pi.payment_method === 'string' ? pi.payment_method : null
    const m = pmId ? methods.get(pmId) : undefined
    const base = fixture(stripeObjectFixtures.paymentIntentExpanded) as unknown as { latest_charge: Record<string, unknown> }
    const paid = pi.status === 'succeeded'
    const fee = m?.behaviour === 'bank' ? bankFee(pi.amount) : cardFee(pi.amount)
    return {
      ...out,
      payment_method: m ? structuredClone(m.pm) : null,
      latest_charge: paid
        ? ({ ...base.latest_charge, id: `ch_${pi.id}`, payment_intent: pi.id, balance_transaction: { id: `txn_${pi.id}`, fee } } as unknown as StripePaymentIntent['latest_charge'])
        : null,
    }
  }

  function list<T extends { created: number }>(items: T[], params: URLSearchParams) {
    const gte = Number(params.get('created[gte]') ?? 0)
    return { object: 'list', data: items.filter((i) => i.created >= gte).reverse(), has_more: false, url: '' }
  }

  function makeMethod(customer: string | null, behaviour: FakeMethodBehaviour): StripePaymentMethod {
    const bank = behaviour === 'bank'
    const base = fixture(bank ? stripeObjectFixtures.paymentMethodBank : stripeObjectFixtures.paymentMethodCard) as unknown as StripePaymentMethod
    const pm: StripePaymentMethod = { ...base, id: `pm_fake${++n}`, customer, created: nowSec() + n }
    methods.set(pm.id, { pm, behaviour })
    return pm
  }

  function newIntent(params: URLSearchParams): StripePaymentIntent {
    // Shaped from the real answer for the same request: confirmed off-session, or left for the browser.
    const base = fixture(params.get('confirm') === 'true' ? stripeObjectFixtures.paymentIntentOffSession : stripeObjectFixtures.paymentIntentOnSession) as unknown as StripePaymentIntent
    const id = `pi_fake${++n}`
    return {
      ...base,
      id,
      amount: Number(params.get('amount')),
      amount_received: 0,
      status: 'requires_payment_method',
      customer: params.get('customer'),
      payment_method: params.get('payment_method'),
      metadata: { app: params.get('metadata[app]') ?? '', checkoutId: params.get('metadata[checkoutId]') ?? '' },
      client_secret: `${id}_secret_fake${n}`,
      latest_charge: null,
      last_payment_error: null,
      created: nowSec(),
    }
  }

  /** Confirms a PaymentIntent with a method, as Stripe would: paid, processing (bank) or refused (402). */
  function confirmWith(pi: StripePaymentIntent, pmId: string): { status: number; body: unknown } {
    const m = methods.get(pmId)
    if (!m) return { status: 400, body: { error: { type: 'invalid_request_error', code: 'resource_missing', message: `No such PaymentMethod: '${pmId}'` } } }
    pi.payment_method = pmId
    if (m.behaviour === 'decline' || m.behaviour === 'auth' || m.behaviour === 'insufficient' || m.behaviour === 'lost') {
      const err = fixture(m.behaviour === 'auth' ? stripeObjectFixtures.errorAuthenticationRequired : stripeObjectFixtures.errorCardDeclined) as unknown as { error: Record<string, unknown> }
      if (m.behaviour === 'insufficient') Object.assign(err.error, { decline_code: 'insufficient_funds', message: 'Your card has insufficient funds.' })
      if (m.behaviour === 'lost') Object.assign(err.error, { decline_code: 'lost_card', advice_code: 'do_not_try_again', message: 'Your card has been declined.' })
      pi.status = 'requires_payment_method'
      // The declined charge stays the intent's latest, as in Stripe's decline (error-card-declined.json).
      pi.latest_charge = `ch_${pi.id}`
      pi.last_payment_error = {
        message: String(err.error.message),
        code: String(err.error.code),
        ...(typeof err.error.decline_code === 'string' ? { decline_code: err.error.decline_code } : {}),
        ...(typeof err.error.advice_code === 'string' ? { advice_code: err.error.advice_code } : {}),
      }
      return { status: 402, body: { error: { ...err.error, payment_intent: structuredClone(pi), payment_method: structuredClone(m.pm) } } }
    }
    if (m.behaviour === 'bank') {
      // A bank debit has its charge from the start, as Stripe answered (payment-intent-off-session-bank.json).
      pi.status = 'processing'
      pi.latest_charge = `ch_${pi.id}`
    } else paid(pi)
    return { status: 200, body: structuredClone(pi) }
  }

  function paid(pi: StripePaymentIntent) {
    pi.status = 'succeeded'
    pi.amount_received = pi.amount
    pi.latest_charge = `ch_${pi.id}`
    const m = typeof pi.payment_method === 'string' ? methods.get(pi.payment_method) : undefined
    intents.set(pi.id, { amount: pi.amount, fee: m?.behaviour === 'bank' ? bankFee(pi.amount) : cardFee(pi.amount), metadata: pi.metadata ?? {} })
  }

  const refusedTypes = () => fail(400, fixture(stripeObjectFixtures.errorPaymentMethodTypes))

  const fetch = async (input: string, init?: RequestInit): Promise<Response> => {
    const url = new URL(input)
    if (url.origin !== 'https://api.stripe.com') {
      if (fallback) return fallback(input, init)
      throw new Error(`fakeStripe: unexpected fetch ${input}`)
    }
    const method = init?.method ?? 'GET'
    const params = method === 'POST' ? new URLSearchParams(typeof init?.body === 'string' ? init.body : '') : url.searchParams
    const call = { method, path: url.pathname, params }
    calls.push(call)
    const refused = refuse?.(call)
    if (refused) return refused
    const key = new Headers(init?.headers).get('idempotency-key')
    // Stripe replays a key's first answer, errors included, but only for the same request: the same key
    // with other parameters is refused (400 idempotency_error), so a key reused by mistake shows here.
    const request = `${method} ${url.pathname} ${[...params.entries()]
      .map(([k, x]) => `${k}=${x}`)
      .sort()
      .join('&')}`
    const seen = key ? idempotent.get(key) : undefined
    if (seen && seen.request !== request) {
      const refusal = fixture(stripeObjectFixtures.errorIdempotencyKeyReused)
      refusal.error.message = `Keys for idempotent requests can only be used with the same parameters they were first used with. Try using a key other than '${key}' if you meant to execute a different request.`
      return fail(400, refusal)
    }
    if (seen) return Response.json(seen.body, { status: seen.status })
    const answer = (status: number, body: unknown) => {
      if (key) idempotent.set(key, { request, status, body })
      return Response.json(body, { status })
    }
    const remember = (body: unknown) => answer(200, body)
    const path = url.pathname.split('/').filter(Boolean)
    const expand = params.getAll('expand[0]').length > 0

    if (method === 'POST' && url.pathname === '/v1/checkout/sessions') {
      if (params.has('payment_method_types[0]')) return refusedTypes()
      if (params.get('ui_mode') === 'embedded')
        return Response.json({ error: { type: 'invalid_request_error', message: 'The ui_mode value `embedded` is no longer supported. Use `embedded_page` instead.' } }, { status: 400 })
      const id = `cs_test_fake${++n}`
      const m = params.get('allowed_payment_method_types[0]') ?? 'card'
      // Each from the real session for its method: a bank account's has no card options.
      const base = fixture(m === 'us_bank_account' ? stripeObjectFixtures.sessionAchOpen : stripeObjectFixtures.sessionOpen) as unknown as StripeSession
      // An embedded session (as in test mode on 2026-10-28.endive) has no page of its own, only a client secret for Stripe.js.
      const embedded = params.get('ui_mode') === 'embedded_page'
      const s: StripeSession = {
        ...base,
        id,
        url: embedded ? null : `https://checkout.stripe.com/c/pay/${id}`,
        client_secret: embedded ? `${id}_secret_fake` : null,
        status: 'open',
        payment_status: 'unpaid',
        payment_intent: null,
        amount_total: Number(params.get('line_items[0][price_data][unit_amount]')),
        client_reference_id: params.get('client_reference_id'),
        metadata: { app: params.get('metadata[app]') ?? '', checkoutId: params.get('metadata[checkoutId]') ?? '' },
        created: nowSec(),
        expires_at: Number(params.get('expires_at')),
      }
      const amount = s.amount_total ?? 0
      const customer = params.get('customer')
      if (customer && params.has('customer_email')) return fail(400, { error: { type: 'invalid_request_error', message: 'You may only specify one of these parameters: customer, customer_email.' } })
      const saves = params.get('payment_intent_data[setup_future_usage]') === 'off_session'
      if (saves && !customer) return fail(400, { error: { type: 'invalid_request_error', message: 'setup_future_usage needs a customer here.' } })
      sessions.set(id, { s, method: m, fee: m === 'us_bank_account' ? bankFee(amount) : cardFee(amount), customer, saves })
      return remember(s)
    }
    if (path[1] === 'checkout' && path[2] === 'sessions' && path[3]) {
      const x = sessions.get(path[3])
      if (!x) return missing('checkout.session', path[3])
      if (method === 'GET') return ok(expand ? expanded(x) : x.s)
      if (path[4] === 'expire') {
        if (x.s.status !== 'open') return fail(400, fixture(stripeObjectFixtures.errorExpireNotOpen))
        x.s.status = 'expired'
        return ok(x.s)
      }
    }
    if (method === 'GET' && url.pathname === '/v1/checkout/sessions')
      return ok(
        list(
          [...sessions.values()].map((x) => x.s),
          params,
        ),
      )

    // Customers and saved methods
    if (method === 'POST' && url.pathname === '/v1/customers') {
      const base = fixture(stripeObjectFixtures.customer) as unknown as StripeCustomer
      const c: StripeCustomer = { ...base, id: `cus_fake${++n}`, email: params.get('email'), metadata: { app: params.get('metadata[app]') ?? '', owner: params.get('metadata[owner]') ?? '' } }
      customers.set(c.id, c)
      return remember(c)
    }
    if (method === 'GET' && path[1] === 'customers' && path[3] === 'payment_methods') {
      if (!customers.has(path[2])) return missing('customer', path[2])
      const data = [...methods.values()]
        .filter((m) => m.pm.customer === path[2])
        .map((m) => m.pm)
        .sort((a, b) => b.created - a.created)
      return ok({ object: 'list', data, has_more: false, url: url.pathname })
    }
    if (method === 'GET' && path[1] === 'payment_methods' && path[2]) {
      const m = methods.get(path[2])
      return m ? ok(m.pm) : missing('PaymentMethod', path[2])
    }
    if (method === 'POST' && url.pathname === '/v1/setup_intents') {
      if (params.has('payment_method_types[0]')) return refusedTypes()
      const base = fixture(stripeObjectFixtures.setupIntent) as unknown as StripeSetupIntent
      const id = `seti_fake${++n}`
      const si: StripeSetupIntent = { ...base, id, customer: params.get('customer'), client_secret: `${id}_secret_fake${n}`, payment_method: null, status: 'requires_payment_method' }
      setupIntents.set(id, si)
      return remember(si)
    }

    // PaymentIntents made directly
    if (method === 'POST' && url.pathname === '/v1/payment_intents') {
      if (params.has('payment_method_types[0]')) return refusedTypes()
      const pi = newIntent(params)
      paymentIntents.set(pi.id, pi)
      if (params.get('confirm') !== 'true') return remember(pi)
      const pm = params.get('payment_method') ?? ''
      const res = confirmWith(pi, pm)
      return answer(res.status, res.body)
    }
    if (path[1] === 'payment_intents' && path[2]) {
      const pi = paymentIntents.get(path[2])
      if (pi && method === 'GET') return ok(intentView(pi, expand))
      if (pi && method === 'POST' && path[3] === 'cancel') {
        if (pi.status === 'succeeded' || pi.status === 'processing') {
          return fail(400, { error: { type: 'invalid_request_error', code: 'payment_intent_unexpected_state', message: `This PaymentIntent's status is ${pi.status}.` } })
        }
        pi.status = 'canceled'
        Object.assign(pi, { canceled_at: nowSec() })
        return ok(pi)
      }
      const x = [...sessions.values()].find((y) => y.s.payment_intent === path[2])
      return x ? ok(expanded(x).payment_intent) : missing('payment_intent', path[2])
    }
    if (method === 'GET' && url.pathname === '/v1/payment_intents') {
      const customer = params.get('customer')
      return ok(
        list(
          [...paymentIntents.values()].filter((pi) => !customer || pi.customer === customer),
          params,
        ),
      )
    }

    // Refunds
    if (method === 'POST' && url.pathname === '/v1/refunds') {
      const pi = params.get('payment_intent') ?? ''
      const paidFor = intents.get(pi)
      if (!paidFor) return missing('payment_intent', pi)
      const amount = Number(params.get('amount') ?? paidFor.amount - refundedOf(pi))
      if (amount > paidFor.amount - refundedOf(pi)) {
        return fail(400, {
          error: { type: 'invalid_request_error', code: 'charge_already_refunded', message: `Refund amount ($${(amount / 100).toFixed(2)}) is greater than unrefunded amount on charge` },
        })
      }
      const r = makeRefund(pi, amount, { app: params.get('metadata[app]') ?? '', refundId: params.get('metadata[refundId]') ?? '' }, refundStatus)
      return remember(r)
    }
    if (method === 'GET' && path[1] === 'refunds' && path[2]) return refunds.has(path[2]) ? ok(refunds.get(path[2])) : missing('refund', path[2])
    if (method === 'GET' && url.pathname === '/v1/refunds') {
      const pi = params.get('payment_intent')
      const all = [...refunds.values()].filter((r) => !pi || r.payment_intent === pi)
      return ok(list(all, params))
    }

    // Webhook endpoints
    if (url.pathname === '/v1/webhook_endpoints') {
      // Stripe shows an endpoint's secret only in the answer that made it.
      if (method === 'GET') return ok({ object: 'list', data: [...endpoints.values()].map(({ secret: _secret, ...shown }) => shown), has_more: false, url: url.pathname })
      const base = fixture(stripeObjectFixtures.webhookEndpoint) as unknown as StripeWebhookEndpoint
      const w: StripeWebhookEndpoint = {
        ...base,
        id: `we_fake${++n}`,
        url: params.get('url') ?? '',
        enabled_events: [...params.entries()].filter(([k]) => k.startsWith('enabled_events')).map(([, x]) => x),
        api_version: params.get('api_version'),
        description: params.get('description'),
        secret: `whsec_fake${n}`,
      }
      endpoints.set(w.id, w)
      return ok(w)
    }
    if (path[1] === 'webhook_endpoints' && path[2]) {
      const w = endpoints.get(path[2])
      if (!w) return missing('webhook_endpoint', path[2])
      if (method === 'DELETE') {
        endpoints.delete(w.id)
        return ok({ id: w.id, object: 'webhook_endpoint', deleted: true })
      }
      const events = [...params.entries()].filter(([k]) => k.startsWith('enabled_events')).map(([, x]) => x)
      if (events.length) w.enabled_events = events
      const { secret: _secret, ...shown } = w
      return ok(shown)
    }
    return fail(404, { error: { type: 'invalid_request_error', message: `fakeStripe doesn’t know ${method} ${url.pathname}` } })
  }

  function makeRefund(pi: string, amount: number, metadata: Record<string, string>, status: StripeRefund['status']): StripeRefund {
    const r: StripeRefund = {
      ...(fixture(stripeObjectFixtures.refund) as unknown as StripeRefund),
      id: `re_fake${++n}`,
      amount,
      payment_intent: pi,
      charge: `ch_${pi}`,
      metadata,
      status,
      created: nowSec(),
    }
    refunds.set(r.id, r)
    return r
  }

  /** The request a test posts to the app's webhook route, signed like Stripe's. */
  async function webhook(event: StripeEvent, o: { secret?: string; at?: number } = {}): Promise<RequestInit> {
    const body = JSON.stringify(event)
    const signature = await signStripePayload(body, o.secret ?? webhookSecret, Math.floor((o.at ?? Date.now()) / 1000))
    return { method: 'POST', body, headers: { 'stripe-signature': signature, 'content-type': 'application/json' } }
  }

  function session(id: string): Session {
    const x = sessions.get(id)
    if (!x) throw new Error(`fakeStripe: no session ${id}`)
    return x
  }

  function intent(id: string): StripePaymentIntent {
    const pi = paymentIntents.get(id)
    if (!pi) throw new Error(`fakeStripe: no PaymentIntent ${id}`)
    return pi
  }

  /** The webhook for where a PaymentIntent now stands. */
  const intentEvent = (pi: StripePaymentIntent, eventId?: string) =>
    webhook(
      stripeEvent(
        pi.status === 'succeeded' ? 'payment_intent.succeeded' : pi.status === 'processing' ? 'payment_intent.processing' : 'payment_intent.payment_failed',
        structuredClone(pi) as unknown as Record<string, unknown>,
        eventId,
      ),
    )

  return {
    fetch,
    calls,
    sessions: () => [...sessions.values()].map((x) => x.s),
    refunds: () => [...refunds.values()],
    customers: () => [...customers.values()],
    paymentIntents: () => [...paymentIntents.values()],
    setupIntents: () => [...setupIntents.values()],
    webhookEndpoints: () => [...endpoints.values()],
    webhook,
    session: (id: string) => session(id).s,
    intent: (id: string) => structuredClone(intent(id)),
    /** Makes Stripe answer calls with this instead, until called again with nothing. */
    refuse(fn?: typeof refuse) {
      refuse = fn
    },
    /** Stripe loses a session (for the comparison's "missing there"). */
    forget(id: string) {
      sessions.delete(id)
    },
    /** A session made at Stripe outside the app's knowledge, tagged for `app` and paid. */
    paidElsewhere(app: string, amount: number) {
      const id = `cs_test_fake${++n}`
      const pi = `pi_fake${++n}`
      const base = fixture(stripeObjectFixtures.sessionOpen) as unknown as StripeSession
      const s: StripeSession = {
        ...base,
        id,
        status: 'complete',
        payment_status: 'paid',
        payment_intent: pi,
        amount_total: amount,
        client_reference_id: 'lost-row',
        metadata: { app },
        created: nowSec(),
      }
      sessions.set(id, { s, method: 'card', fee: 0, customer: null, saves: false })
      intents.set(pi, { amount, fee: 0, metadata: { app } })
      return s
    },
    /** A charge paid at Stripe, tagged for `app`, that no checkout knows (for the comparison's "missing here"). */
    intentElsewhere(app: string, amount: number): StripePaymentIntent {
      const pi = newIntent(new URLSearchParams({ amount: String(amount), customer: 'cus_elsewhere', 'metadata[app]': app, 'metadata[checkoutId]': 'lost-row' }))
      paid(pi)
      paymentIntents.set(pi.id, pi)
      return structuredClone(pi)
    },
    /** Stripe loses a PaymentIntent (for the comparison's "missing there"). */
    forgetIntent(id: string) {
      paymentIntents.delete(id)
    },
    /** How refunds made after this come back. */
    refundsCome(status: StripeRefund['status']) {
      refundStatus = status
    },
    /**
     * The buyer pays. A card is paid at once (checkout.session.completed, paid); a bank account is
     * accepted now and paid days later (completed unpaid, then async_payment_succeeded). Returns the webhook.
     */
    async pay(id: string, o: { eventId?: string; /** How the method a saving session keeps behaves when charged later. */ behaviour?: FakeMethodBehaviour } = {}) {
      const x = session(id)
      const ach = x.method === 'us_bank_account'
      x.s.status = 'complete'
      // A finished session knows the buyer's name, as checkout.session.completed carries it.
      const shown = x.s as StripeSession & { customer_details?: Record<string, unknown> | null }
      if (shown.customer_details) shown.customer_details = { ...shown.customer_details, name: 'Test Buyer', tax_ids: [] }
      x.s.payment_status = ach ? 'unpaid' : 'paid'
      if (x.saves && x.customer) {
        // What setup_future_usage leaves behind: the method on the Customer, and a PaymentIntent paid with it.
        const pm = makeMethod(x.customer, ach ? 'bank' : 'ok')
        const pi = newIntent(
          new URLSearchParams({ amount: String(x.s.amount_total ?? 0), customer: x.customer, 'metadata[app]': x.s.metadata?.app ?? '', 'metadata[checkoutId]': x.s.metadata?.checkoutId ?? '' }),
        )
        pi.payment_method = pm.id
        if (ach) pi.status = 'processing'
        else paid(pi)
        paymentIntents.set(pi.id, pi)
        const m = methods.get(pm.id)
        if (m && o.behaviour) m.behaviour = o.behaviour
        x.s.payment_intent = pi.id
      } else {
        const pi = `pi_fake${++n}`
        x.s.payment_intent = pi
        intents.set(pi, { amount: x.s.amount_total ?? 0, fee: x.fee, metadata: x.s.metadata ?? {} })
      }
      return await webhook(stripeEvent(ach ? 'checkout.session.completed-ach' : 'checkout.session.completed', { ...x.s }, o.eventId))
    },
    /** The bank payment arrived (or bounced): a hosted session's, or a PaymentIntent's (returns its webhook). */
    async settleBank(id: string, succeeded: boolean, code = 'payment_method_provider_decline') {
      const pi = paymentIntents.get(id)
      if (pi) {
        if (succeeded) paid(pi)
        else {
          pi.status = 'requires_payment_method'
          // A bounced debit carries its reason in code (insufficient_funds, account_closed...), decline_code generic (seen in test mode).
          pi.last_payment_error = { message: 'The customer’s bank account could not be debited.', code, decline_code: 'generic_decline' }
        }
        return await intentEvent(pi)
      }
      const x = session(id)
      x.s.payment_status = succeeded ? 'paid' : 'unpaid'
      const saved = typeof x.s.payment_intent === 'string' ? paymentIntents.get(x.s.payment_intent) : undefined
      if (saved && succeeded) paid(saved)
      return await webhook(stripeEvent(succeeded ? 'checkout.session.async_payment_succeeded' : 'checkout.session.async_payment_failed', { ...x.s }))
    },
    /** The session ran out at Stripe. */
    async expire(id: string) {
      const x = session(id)
      x.s.status = 'expired'
      return await webhook(stripeEvent('checkout.session.expired', { ...x.s }))
    },
    /**
     * A card or bank account saved to a customer (what the Payment Element and a SetupIntent leave
     * behind), behaving as `behaviour` when charged. Returns its id.
     */
    saveMethod(customer: string, behaviour: FakeMethodBehaviour = 'ok'): string {
      if (!customers.has(customer)) throw new Error(`fakeStripe: no customer ${customer}`)
      return makeMethod(customer, behaviour).id
    },
    /** The payer (or someone in the dashboard) detaches a saved method at Stripe: the payment_method.detached webhook. */
    async detach(pmId: string) {
      const m = methods.get(pmId)
      if (!m) throw new Error(`fakeStripe: no PaymentMethod ${pmId}`)
      m.pm.customer = null
      return await webhook(stripeEvent('payment_method.detached', structuredClone(m.pm) as unknown as Record<string, unknown>))
    },
    /** Makes a saved method behave differently when charged from now on. */
    setBehaviour(pmId: string, behaviour: FakeMethodBehaviour) {
      const m = methods.get(pmId)
      if (!m) throw new Error(`fakeStripe: no PaymentMethod ${pmId}`)
      m.behaviour = behaviour
    },
    /** A method saved to nobody (or to someone else), for refusals. */
    strayMethod(behaviour: FakeMethodBehaviour = 'ok', customer: string | null = null): string {
      return makeMethod(customer, behaviour).id
    },
    /**
     * The buyer confirms an on-session PaymentIntent in the Payment Element with a method like
     * `behaviour`. Returns the webhook for the outcome (succeeded, processing or payment_failed).
     */
    async confirm(id: string, behaviour: FakeMethodBehaviour = 'ok', o: { eventId?: string } = {}) {
      const pi = intent(id)
      const pm = makeMethod(typeof pi.customer === 'string' ? pi.customer : null, behaviour)
      confirmWith(pi, pm.id)
      return await intentEvent(pi, o.eventId)
    },
    /** The webhook for where a PaymentIntent stands now (e.g. a redelivery). */
    intentEvent: (id: string, eventId?: string) => intentEvent(intent(id), eventId),
    /** Someone refunds in the Stripe dashboard: the refund.created and charge.refunded webhooks. */
    async refundInDashboard(pi: string, amount: number) {
      const r = makeRefund(pi, amount, {}, 'succeeded')
      return {
        refund: r,
        created: await webhook(stripeEvent('refund.created', { ...r })),
        charge: await webhook(stripeEvent('charge.refunded', { payment_intent: pi, amount_refunded: refundedOf(pi) })),
      }
    },
    /** A refund that was sent later fails (or a pending one completes). */
    async refundBecomes(refundId: string, status: StripeRefund['status']) {
      const r = refunds.get(refundId)
      if (!r) throw new Error(`fakeStripe: no refund ${refundId}`)
      r.status = status
      return await webhook(stripeEvent(status === 'failed' ? 'refund.failed' : 'refund.updated', { ...r }))
    },
    async dispute(pi: string, status: 'created' | 'closed', outcome = 'won') {
      const amount = intents.get(pi)?.amount ?? 0
      return await webhook(
        stripeEvent(status === 'created' ? 'charge.dispute.created' : 'charge.dispute.closed', {
          id: `dp_${pi}`,
          payment_intent: pi,
          amount,
          status: status === 'created' ? 'needs_response' : outcome,
        }),
      )
    },
    /** Any event, signed. */
    event: (name: Parameters<typeof stripeEvent>[0], object: Record<string, unknown> = {}, eventId?: string) => webhook(stripeEvent(name, object, eventId)),
  }
}

export type FakeStripe = ReturnType<typeof fakeStripe>
