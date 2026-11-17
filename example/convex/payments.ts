import { PAYPAL_LIVE_API, PAYPAL_SANDBOX_API, Payments } from '@earthdance/payments'
import { components } from './_generated/api.js'

// Annotated, so TypeScript doesn't go round in a circle through paymentsWorker.ts.
export const payments: Payments = new Payments(components.payments, {
  app: 'example',
  siteUrl: () => process.env.SITE_URL ?? 'http://localhost:5173',
  stripe: () => (process.env.STRIPE_SECRET_KEY ? { secretKey: process.env.STRIPE_SECRET_KEY, webhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? '' } : null),
  paypal: () =>
    process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET
      ? {
          clientId: process.env.PAYPAL_CLIENT_ID,
          clientSecret: process.env.PAYPAL_CLIENT_SECRET,
          webhookId: process.env.PAYPAL_WEBHOOK_ID ?? '',
          apiBase: process.env.PAYPAL_API_BASE === PAYPAL_LIVE_API ? PAYPAL_LIVE_API : PAYPAL_SANDBOX_API,
        }
      : null,
  // PayPal's own rates, once known (the default is Stripe's card rate):
  // fees: { paypal: { card: { basisPoints: 199, fixedCents: 49, capCents: null } } },
})
