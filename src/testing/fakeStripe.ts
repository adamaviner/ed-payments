// A fake Stripe for tests: a fetch function that keeps sessions, PaymentIntents and refunds the way
// Stripe does (objects shaped from the real test-mode fixtures), plus helpers that make the signed
// webhook a test posts to the app's route.
//   const stripe = fakeStripe()
//   vi.stubGlobal('fetch', stripe.fetch)          // or new Payments(..., { fetch: stripe.fetch })
//   const hook = await stripe.pay(sessionId)      // marks it paid; returns the signed webhook
//   await t.fetch('/stripe/webhook', hook)
import { signStripePayload, type StripeEvent, type StripeRefund, type StripeSession } from '../core/stripe.js'
import { fixture, stripeEvent, stripeObjectFixtures } from './fixtures.js'

export const FAKE_STRIPE_WEBHOOK_SECRET = 'whsec_fake_test_secret'

interface Session {
  s: StripeSession
  method: string
  /** The fee Stripe would keep once paid. */
  fee: number
}

export interface FakeStripeOptions {
  webhookSecret?: string
  /** Answers every other URL; without it, other URLs throw. */
  fallback?: (input: string, init?: RequestInit) => Promise<Response>
}

const ok = (body: unknown) => Response.json(body)
const fail = (status: number, body: unknown) => Response.json(body, { status })
const missing = (what: string, id: string) => fail(404, { error: { type: 'invalid_request_error', code: 'resource_missing', message: `No such ${what}: '${id}'` } })

export function fakeStripe({ webhookSecret = FAKE_STRIPE_WEBHOOK_SECRET, fallback }: FakeStripeOptions = {}) {
  const sessions = new Map<string, Session>()
  const refunds = new Map<string, StripeRefund>()
  /** PaymentIntent id → amount paid. */
  const intents = new Map<string, { amount: number; fee: number; metadata: Record<string, string> }>()
  const idempotent = new Map<string, unknown>()
  const calls: { method: string; path: string; params: URLSearchParams }[] = []
  let n = 0
  /** Set to answer a call with this instead (e.g. Stripe being down). */
  let refuse: ((call: { method: string; path: string; params: URLSearchParams }) => Response | undefined) | undefined
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

  function list<T extends { created: number }>(items: T[], params: URLSearchParams) {
    const gte = Number(params.get('created[gte]') ?? 0)
    return { object: 'list', data: items.filter((i) => i.created >= gte).reverse(), has_more: false }
  }

  const fetch = async (input: string, init?: RequestInit): Promise<Response> => {
    const url = new URL(input)
    if (url.origin !== 'https://api.stripe.com') {
      if (fallback) return fallback(input, init)
      throw new Error(`fakeStripe: unexpected fetch ${input}`)
    }
    const method = init?.method ?? 'GET'
    const params = method === 'GET' ? url.searchParams : new URLSearchParams(typeof init?.body === 'string' ? init.body : '')
    const call = { method, path: url.pathname, params }
    calls.push(call)
    const refused = refuse?.(call)
    if (refused) return refused
    const key = new Headers(init?.headers).get('idempotency-key')
    if (key && idempotent.has(key)) return ok(idempotent.get(key))
    const remember = (body: unknown) => {
      if (key) idempotent.set(key, body)
      return ok(body)
    }
    const path = url.pathname.split('/').filter(Boolean)

    if (method === 'POST' && url.pathname === '/v1/checkout/sessions') {
      const id = `cs_test_fake${++n}`
      const base = fixture(stripeObjectFixtures.sessionOpen) as unknown as StripeSession
      const s: StripeSession = {
        ...base,
        id,
        url: `https://checkout.stripe.com/c/pay/${id}`,
        status: 'open',
        payment_status: 'unpaid',
        payment_intent: null,
        amount_total: Number(params.get('line_items[0][price_data][unit_amount]')),
        client_reference_id: params.get('client_reference_id'),
        metadata: { app: params.get('metadata[app]') ?? '', checkoutId: params.get('metadata[checkoutId]') ?? '' },
        created: Math.floor(Date.now() / 1000),
        expires_at: Number(params.get('expires_at')),
      }
      const amount = s.amount_total ?? 0
      const method = params.get('allowed_payment_method_types[0]') ?? 'card'
      sessions.set(id, { s, method, fee: method === 'us_bank_account' ? Math.min(Math.ceil(amount * 0.008), 500) : Math.ceil(amount * 0.029) + 30 })
      return remember(s)
    }
    if (path[1] === 'checkout' && path[2] === 'sessions' && path[3]) {
      const x = sessions.get(path[3])
      if (!x) return missing('checkout.session', path[3])
      if (method === 'GET') return ok(params.getAll('expand[0]').length ? expanded(x) : x.s)
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
    if (path[1] === 'payment_intents' && path[2]) {
      const x = [...sessions.values()].find((y) => y.s.payment_intent === path[2])
      return x ? ok(expanded(x).payment_intent) : missing('payment_intent', path[2])
    }
    if (method === 'POST' && url.pathname === '/v1/refunds') {
      const pi = params.get('payment_intent') ?? ''
      const paid = intents.get(pi)
      if (!paid) return missing('payment_intent', pi)
      const amount = Number(params.get('amount') ?? paid.amount - refundedOf(pi))
      if (amount > paid.amount - refundedOf(pi)) {
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
      created: Math.floor(Date.now() / 1000),
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

  return {
    fetch,
    calls,
    sessions: () => [...sessions.values()].map((x) => x.s),
    refunds: () => [...refunds.values()],
    webhook,
    session: (id: string) => session(id).s,
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
        created: Math.floor(Date.now() / 1000),
      }
      sessions.set(id, { s, method: 'card', fee: 0 })
      intents.set(pi, { amount, fee: 0, metadata: { app } })
      return s
    },
    /** How refunds made after this come back. */
    refundsCome(status: StripeRefund['status']) {
      refundStatus = status
    },
    /**
     * The buyer pays. A card is paid at once (checkout.session.completed, paid); a bank account is
     * accepted now and paid days later (completed unpaid, then async_payment_succeeded). Returns the webhook.
     */
    async pay(id: string, o: { eventId?: string } = {}) {
      const x = session(id)
      const pi = `pi_fake${++n}`
      x.s.status = 'complete'
      x.s.payment_intent = pi
      const ach = x.method === 'us_bank_account'
      x.s.payment_status = ach ? 'unpaid' : 'paid'
      intents.set(pi, { amount: x.s.amount_total ?? 0, fee: x.fee, metadata: x.s.metadata ?? {} })
      return await webhook(stripeEvent(ach ? 'checkout.session.completed-ach' : 'checkout.session.completed', { ...x.s }, o.eventId))
    },
    /** The bank payment arrived (or bounced). */
    async settleBank(id: string, succeeded: boolean) {
      const x = session(id)
      x.s.payment_status = succeeded ? 'paid' : 'unpaid'
      return await webhook(stripeEvent(succeeded ? 'checkout.session.async_payment_succeeded' : 'checkout.session.async_payment_failed', { ...x.s }))
    },
    /** The session ran out at Stripe. */
    async expire(id: string) {
      const x = session(id)
      x.s.status = 'expired'
      return await webhook(stripeEvent('checkout.session.expired', { ...x.s }))
    },
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
