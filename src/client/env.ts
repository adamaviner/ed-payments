// Reading the processors' keys from the deployment's environment, with the checks that keep test
// keys out of production and live keys out of everything else. PAYMENTS_MODE=live marks the
// production deployment; anything else (or unset) is test mode.
//
//   stripe: fromEnv.stripe(), paypal: fromEnv.paypal(), siteUrl: fromEnv.siteUrl('https://shop.example.org')
//
// Each returns a function the library calls when it needs the keys (so env vars set after the deploy
// are seen). `check` runs at start-up (registerRoutes) and refuses a deployment set up wrongly, by
// throwing while the module loads, which fails the push with the reason.
import { PAYPAL_LIVE_API, PAYPAL_SANDBOX_API, type PaypalKeys } from '../core/paypal.js'
import type { StripeKeys } from '../core/stripe.js'

type Env = Record<string, string | undefined>

/** A reader of one processor's keys, null when the processor isn't set up here. `check` throws when it is set up wrongly. */
export interface KeySource<K> {
  (): K | null
  check(): void
}

const env = (): Env => (typeof process === 'undefined' ? {} : process.env)

export const isLive = (e: Env = env()) => (e.PAYMENTS_MODE ?? '').trim().toLowerCase() === 'live'

/** Stripe's key prefixes: secret or restricted, live or test. */
const stripeMode = (key: string) => (/^(sk|rk)_live_/.test(key) ? 'live' : /^(sk|rk)_test_/.test(key) ? 'test' : null)

function stripeKeys(e: Env): StripeKeys | null {
  const secretKey = e.STRIPE_SECRET_KEY?.trim()
  return secretKey ? { secretKey, webhookSecret: e.STRIPE_WEBHOOK_SECRET?.trim() ?? '' } : null
}

/** A set-up problem. wrongMode: live keys outside live mode or the other way round, refused at every call, not only at start-up. */
export interface Problem {
  text: string
  wrongMode: boolean
}
const problem = (text: string, wrongMode = false): Problem => ({ text, wrongMode })

/** Problems with this deployment's Stripe set-up (none: fine, or not set up and not required). */
export function stripeProblems(e: Env = env()): Problem[] {
  const k = stripeKeys(e)
  const live = isLive(e)
  if (!k) return live && e.STRIPE_REQUIRED === 'true' ? [problem('STRIPE_SECRET_KEY isn’t set, and STRIPE_REQUIRED says this deployment takes Stripe payments.')] : []
  const mode = stripeMode(k.secretKey)
  const out: Problem[] = []
  if (!mode) out.push(problem('STRIPE_SECRET_KEY doesn’t look like a Stripe secret or restricted key (sk_… or rk_…).', true))
  else if (live && mode !== 'live') out.push(problem('PAYMENTS_MODE is live but STRIPE_SECRET_KEY is a test key.', true))
  else if (!live && mode === 'live') out.push(problem('STRIPE_SECRET_KEY is a live key on a deployment that isn’t PAYMENTS_MODE=live. Use a test key here.', true))
  if (!k.webhookSecret.startsWith('whsec_')) out.push(problem('STRIPE_WEBHOOK_SECRET isn’t set (whsec_…), so Stripe’s webhooks would be refused.'))
  return out
}

function paypalKeys(e: Env): PaypalKeys | null {
  const clientId = e.PAYPAL_CLIENT_ID?.trim()
  const clientSecret = e.PAYPAL_CLIENT_SECRET?.trim()
  if (!clientId || !clientSecret) return null
  const base = (e.PAYPAL_API_BASE ?? '').trim().replace(/\/+$/, '')
  return { clientId, clientSecret, webhookId: e.PAYPAL_WEBHOOK_ID?.trim() ?? '', apiBase: base || (isLive(e) ? PAYPAL_LIVE_API : PAYPAL_SANDBOX_API) }
}

export function paypalProblems(e: Env = env()): Problem[] {
  const k = paypalKeys(e)
  const live = isLive(e)
  if (!k) return live && e.PAYPAL_REQUIRED === 'true' ? [problem('PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET aren’t set, and PAYPAL_REQUIRED says this deployment takes PayPal payments.')] : []
  const out: Problem[] = []
  if (k.apiBase !== PAYPAL_LIVE_API && k.apiBase !== PAYPAL_SANDBOX_API) out.push(problem(`PAYPAL_API_BASE must be ${PAYPAL_LIVE_API} or ${PAYPAL_SANDBOX_API}.`, true))
  else if (live && k.apiBase !== PAYPAL_LIVE_API) out.push(problem(`PAYMENTS_MODE is live but PAYPAL_API_BASE is the sandbox; set it to ${PAYPAL_LIVE_API}.`, true))
  else if (!live && k.apiBase === PAYPAL_LIVE_API) out.push(problem('PAYPAL_API_BASE is PayPal’s live API on a deployment that isn’t PAYMENTS_MODE=live. Use the sandbox here.', true))
  if (!k.webhookId) out.push(problem('PAYPAL_WEBHOOK_ID isn’t set, so PayPal’s webhooks would be refused.'))
  return out
}

const sentences = (ps: Problem[]) => ps.map((p) => p.text).join(' ')

function source<K>(read: (e: Env) => K | null, problems: (e: Env) => Problem[], name: string): KeySource<K> {
  const get = () => {
    const e = env()
    // Keys in the wrong mode are never handed out, even when they were changed after start-up.
    const bad = problems(e).filter((p) => p.wrongMode)
    if (bad.length) throw new Error(`${name}: ${sentences(bad)}`)
    return read(e)
  }
  return Object.assign(get, {
    // In live mode every problem stops the deployment; elsewhere only keys in the wrong mode do, and
    // the rest (a dev deployment without a webhook secret) is only said.
    check() {
      const e = env()
      const all = problems(e)
      const fatal = isLive(e) ? all : all.filter((p) => p.wrongMode)
      if (fatal.length) throw new Error(`${name} isn’t set up right on this deployment: ${sentences(fatal)}`)
      if (all.length) console.warn(`payments: ${name}: ${sentences(all)}`)
    },
  })
}

export const fromEnv = {
  /** STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET; STRIPE_REQUIRED=true makes a missing key an error in live mode. */
  stripe: (): KeySource<StripeKeys> => source(stripeKeys, stripeProblems, 'Stripe'),
  /** PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_WEBHOOK_ID, PAYPAL_API_BASE (unset: live in live mode, else the sandbox); PAYPAL_REQUIRED=true as for Stripe. */
  paypal: (): KeySource<PaypalKeys> => source(paypalKeys, paypalProblems, 'PayPal'),
  /** SITE_URL, else the fallback. */
  siteUrl: (fallback?: string) => (): string => {
    const url = env().SITE_URL?.trim() || fallback
    if (!url) throw new Error('SITE_URL isn’t set on this deployment.')
    return url
  },
}
