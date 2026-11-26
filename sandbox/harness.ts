// The library's own test app (src/testing/app.ts) against Stripe's test mode and PayPal's sandbox, for
// the sandbox suites that run the whole library: test keys put in, real fetch, and the clock moved by
// hand between months. Test keys only.
import { vi } from 'vitest'
import { defined, testKeys } from '../src/testing/app.js'

export const { api, internal, createTest } = defined
const env = import.meta.env as Record<string, string | undefined>
export const stripeKey = env.SANDBOX_STRIPE_SECRET_KEY ?? ''
export const paypalOn = !!env.SANDBOX_PAYPAL_CLIENT_ID && !!env.SANDBOX_PAYPAL_CLIENT_SECRET
export const run = Date.now().toString(36)
/** PayPal sandbox test cards it accepted on 2026-11-21 (Visa, Mastercard); one used many times in a day starts answering PAYER_CANNOT_PAY. */
export const CARDS = ['4111111111111111', '5555555555554444']

/**
 * convex-test makes the same ids every run, and the processors replay an idempotency key's first
 * answer (Stripe for a day, PayPal for hours) and refuse a repeated invoice id: each run's keys and
 * invoice ids get the run's tag, as real deployments' distinct ids would make them distinct. Each test
 * app (harness) makes the same ids again, so the tag also counts them.
 */
let tag = run
let apps = 0
const realFetch = globalThis.fetch
function taggedFetch(input: RequestInfo | URL, init?: RequestInit) {
  const headers = new Headers(init?.headers)
  for (const name of ['idempotency-key', 'paypal-request-id']) {
    const key = headers.get(name)
    if (key) headers.set(name, `${key}-${tag}`)
  }
  let body = init?.body
  if (typeof body === 'string' && body.includes('"invoice_id"')) body = body.replace(/"invoice_id":"([^"]*)"/, (_m, id: string) => `"invoice_id":"${id}-${tag}"`)
  return realFetch(input, { ...init, headers, body })
}

/** Customers made by a run, deleted at its end. */
export const customers: string[] = []

/** For beforeAll: the test app on the test keys, with only the clock faked (timers stay real, so the library's queued work runs). */
export function useSandbox() {
  vi.stubGlobal('fetch', taggedFetch)
  testKeys.stripe = stripeKey
  testKeys.paypalClientId = env.SANDBOX_PAYPAL_CLIENT_ID ?? 'fake-client'
  testKeys.paypalSecret = env.SANDBOX_PAYPAL_CLIENT_SECRET ?? 'fake-secret'
  vi.useFakeTimers({ toFake: ['Date'], now: Date.now() })
  vi.spyOn(console, 'warn').mockImplementation(() => {})
}

/** For afterAll. */
export async function endSandbox() {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  for (const c of customers) await fetch(`https://api.stripe.com/v1/customers/${c}`, { method: 'DELETE', headers: { Authorization: `Bearer ${stripeKey}` } })
}

/** A Stripe call with the test key, as the browser's Stripe.js or the Dashboard would make it; Stripe's answer, error or not. */
export const stripePost = async <T = { id: string }>(path: string, body: string) =>
  (await (
    await fetch(`https://api.stripe.com${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${stripeKey}`, 'Stripe-Version': '2026-10-28.endive', 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    })
  ).json()) as T

/** A PayPal sandbox call with the test app's keys, as PayPal's Card Fields make them in the browser. */
export async function paypalAs() {
  const tok = (await (
    await fetch('https://api-m.sandbox.paypal.com/v1/oauth2/token', {
      method: 'POST',
      headers: { Authorization: `Basic ${btoa(`${testKeys.paypalClientId}:${testKeys.paypalSecret}`)}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
    })
  ).json()) as { access_token: string }
  return (method: string, path: string, body?: unknown) =>
    fetch(`https://api-m.sandbox.paypal.com${path}`, {
      method,
      headers: { Authorization: `Bearer ${tok.access_token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
}

/** What Card Fields send for a card: one of the sandbox's test cards, under `name` (CCREJECT-REFUSED makes its capture DECLINED). */
export const cardSource = (name: string) => ({ payment_source: { card: { number: CARDS[Math.floor(Math.random() * CARDS.length)], expiry: '2030-12', name, security_code: '123' } } })

export function harness() {
  // Each test starts at the real time: an earlier test moved the clock months ahead.
  vi.setSystemTime(vi.getRealSystemTime())
  tag = `${run}-${++apps}`
  const t = createTest()
  const settle = () => t.finishAllScheduledFunctions(() => {})
  const calls = (name: string) => t.query(api.host.calls, {}).then((cs) => cs.filter((c) => c.name === name).map((c) => c.args))
  const schedule = async (id: string) => (await t.query(api.monthly.get, { scheduleId: id }))!
  const hourly = async (when: number) => {
    vi.setSystemTime(when)
    await t.action(internal.paymentsWorker.schedules, {})
    await settle()
  }
  return { t, settle, calls, schedule, hourly }
}
