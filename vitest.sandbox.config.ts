// `npm run test:sandbox`: the real calls to Stripe test mode and the PayPal sandbox (sandbox/*.sandbox.test.ts).
// Keys come from the environment or the file in ED_PAYMENTS_SANDBOX_ENV (e.g. an app's .env.local):
// STRIPE_SECRET_KEY (a test key), PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET (sandbox). Without them
// there is nothing to run, so the suite runs no files and says so, rather than skipping tests.
import { readFileSync } from 'node:fs'
import { defineConfig } from 'vitest/config'

const file = process.env.ED_PAYMENTS_SANDBOX_ENV
const fromFile: Record<string, string> = file
  ? Object.fromEntries(
      readFileSync(file, 'utf8')
        .split('\n')
        .map((l) => /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(l))
        .filter((m): m is RegExpExecArray => m !== null)
        .map((m) => [m[1], m[2].replace(/^(['"])(.*)\1$/, '$2')]),
    )
  : {}
const env = { ...fromFile, ...process.env }
const stripe = /^(sk|rk)_test_/.test(env.STRIPE_SECRET_KEY ?? '')
const paypal = !!env.PAYPAL_CLIENT_ID && !!env.PAYPAL_CLIENT_SECRET && (env.PAYPAL_API_BASE ?? '').indexOf('api-m.paypal.com') < 0

// The schedules suite runs the library's test app (convex-test), so it needs Stripe; its PayPal part runs when PayPal's keys are there too.
const include = [...(stripe ? ['sandbox/stripe.sandbox.test.ts', 'sandbox/schedules.sandbox.test.ts'] : []), ...(paypal ? ['sandbox/paypal.sandbox.test.ts'] : [])]
if (!include.length) console.info('test:sandbox: no Stripe test key or PayPal sandbox keys (set ED_PAYMENTS_SANDBOX_ENV=<env file>); nothing to run.')

export default defineConfig({
  test: {
    include,
    passWithNoTests: true,
    // convex-test, for the schedules suite.
    environment: 'edge-runtime',
    server: { deps: { inline: ['convex-test'] } },
    testTimeout: 60_000,
    env: {
      SANDBOX_STRIPE_SECRET_KEY: stripe ? (env.STRIPE_SECRET_KEY ?? '') : '',
      SANDBOX_PAYPAL_CLIENT_ID: paypal ? (env.PAYPAL_CLIENT_ID ?? '') : '',
      SANDBOX_PAYPAL_CLIENT_SECRET: paypal ? (env.PAYPAL_CLIENT_SECRET ?? '') : '',
      SANDBOX_PAYPAL_WEBHOOK_ID: paypal ? (env.PAYPAL_WEBHOOK_ID ?? '') : '',
    },
  },
})
