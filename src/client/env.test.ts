// fromEnv: keys in the wrong mode are refused at start-up and at every call; live mode makes every
// set-up problem fatal; elsewhere the rest is only said.
import { afterEach, describe, expect, test, vi } from 'vitest'
import { PAYPAL_LIVE_API, PAYPAL_SANDBOX_API } from '../core/paypal.js'
import { fromEnv, paypalProblems, stripeProblems } from './env.js'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

const set = (vars: Record<string, string>) => {
  for (const [k, x] of Object.entries(vars)) vi.stubEnv(k, x)
}
const texts = (ps: { text: string }[]) => ps.map((p) => p.text).join(' ')

describe('Stripe', () => {
  test('test mode: a test key is fine; a live key is refused, at start-up and when used', () => {
    set({ PAYMENTS_MODE: '', STRIPE_SECRET_KEY: 'rk_test_abc', STRIPE_WEBHOOK_SECRET: 'whsec_abc' })
    const s = fromEnv.stripe()
    expect(() => s.check()).not.toThrow()
    expect(s()).toEqual({ secretKey: 'rk_test_abc', webhookSecret: 'whsec_abc' })
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_live_abc')
    expect(() => s.check()).toThrow(/live key on a deployment that isn’t PAYMENTS_MODE=live/)
    expect(() => s()).toThrow(/live key/)
  })

  test('live mode: a test key or a missing webhook secret stops the deployment; the error never shows the key', () => {
    set({ PAYMENTS_MODE: 'live', STRIPE_SECRET_KEY: 'sk_test_secretvalue', STRIPE_WEBHOOK_SECRET: '' })
    const err = (() => {
      try {
        fromEnv.stripe().check()
        return ''
      } catch (e) {
        return e instanceof Error ? e.message : String(e)
      }
    })()
    expect(err).toMatch(/test key/)
    expect(err).toMatch(/STRIPE_WEBHOOK_SECRET isn’t set/)
    expect(err).not.toContain('secretvalue')
  })

  test('not set up: nothing to check, unless STRIPE_REQUIRED says it must be (live)', () => {
    set({ PAYMENTS_MODE: 'live', STRIPE_SECRET_KEY: '' })
    expect(fromEnv.stripe()()).toBeNull()
    expect(stripeProblems()).toEqual([])
    vi.stubEnv('STRIPE_REQUIRED', 'true')
    expect(texts(stripeProblems())).toMatch(/STRIPE_REQUIRED/)
  })

  test('test mode without a webhook secret is said, not fatal', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    set({ PAYMENTS_MODE: 'test', STRIPE_SECRET_KEY: 'sk_test_abc', STRIPE_WEBHOOK_SECRET: '' })
    expect(() => fromEnv.stripe().check()).not.toThrow()
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/STRIPE_WEBHOOK_SECRET/))
  })
})

describe('PayPal', () => {
  test('unset PAYPAL_API_BASE is the sandbox in test mode and live in live mode', () => {
    set({ PAYMENTS_MODE: '', PAYPAL_CLIENT_ID: 'id', PAYPAL_CLIENT_SECRET: 'secret', PAYPAL_WEBHOOK_ID: 'WH', PAYPAL_API_BASE: '' })
    expect(fromEnv.paypal()()?.apiBase).toBe(PAYPAL_SANDBOX_API)
    vi.stubEnv('PAYMENTS_MODE', 'live')
    expect(fromEnv.paypal()()?.apiBase).toBe(PAYPAL_LIVE_API)
  })

  test('the live API outside live mode, the sandbox in live mode, or an unknown address are refused, never sent the credentials', () => {
    set({ PAYMENTS_MODE: 'test', PAYPAL_CLIENT_ID: 'id', PAYPAL_CLIENT_SECRET: 'secret', PAYPAL_WEBHOOK_ID: 'WH', PAYPAL_API_BASE: PAYPAL_LIVE_API })
    expect(() => fromEnv.paypal()()).toThrow(/live API on a deployment that isn’t/)
    vi.stubEnv('PAYMENTS_MODE', 'live')
    vi.stubEnv('PAYPAL_API_BASE', PAYPAL_SANDBOX_API)
    expect(() => fromEnv.paypal().check()).toThrow(/is the sandbox/)
    vi.stubEnv('PAYPAL_API_BASE', 'https://api-m.example.org')
    expect(() => fromEnv.paypal()()).toThrow(/must be/)
    expect(texts(paypalProblems())).not.toContain('secret')
  })

  test('live mode needs the webhook id', () => {
    set({ PAYMENTS_MODE: 'live', PAYPAL_CLIENT_ID: 'id', PAYPAL_CLIENT_SECRET: 'secret', PAYPAL_WEBHOOK_ID: '', PAYPAL_API_BASE: PAYPAL_LIVE_API })
    expect(() => fromEnv.paypal().check()).toThrow(/PAYPAL_WEBHOOK_ID/)
  })
})

test('siteUrl reads SITE_URL, else the fallback, else says what is missing', () => {
  vi.stubEnv('SITE_URL', '')
  expect(fromEnv.siteUrl('https://shop.example.org')()).toBe('https://shop.example.org')
  expect(() => fromEnv.siteUrl()()).toThrow(/SITE_URL/)
  vi.stubEnv('SITE_URL', 'https://live.example.org')
  expect(fromEnv.siteUrl('https://shop.example.org')()).toBe('https://live.example.org')
})
