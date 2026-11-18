// The app's one payments instance, and everything the library makes for it to export. This file is
// the whole of the wiring: keys from the environment (checked), the context every checkout carries,
// the callbacks (in shop.ts), who is an admin, and the generated functions.
import { definePayments, fromEnv } from '@earthdance/payments'
import { v } from 'convex/values'
import { components, internal } from './_generated/api.js'

/** What onPaid and the other callbacks need from a checkout: which item, or which bid. */
export const paymentContext = v.union(v.object({ itemId: v.string() }), v.object({ bidId: v.id('bids') }))

export const payments = definePayments(components.payments, {
  app: 'example',
  context: paymentContext,
  stripe: fromEnv.stripe(),
  paypal: fromEnv.paypal(),
  siteUrl: fromEnv.siteUrl('http://localhost:5173'),
  // PayPal's own rates, once known (the default is Stripe's card rate):
  // fees: { paypal: { card: { basisPoints: 199, fixedCents: 49, capCents: null } } },
}).withCallbacks({
  on: {
    paid: internal.shop.onPaid,
    failed: internal.shop.onFailed,
    refunded: internal.shop.onRefunded,
    refundNeeded: internal.shop.onRefundNeeded,
    dispute: internal.shop.onDispute,
    processing: internal.shop.onProcessing,
    issues: internal.shop.onIssues,
  },
  authorize: { admin: internal.shop.isAdmin },
  worker: internal.payments,
})

// Convex registers only top-level exports, so the generated functions are listed by name. The admin
// page's are in paymentsAdmin.ts.
export const { sweep, reconcile, cleanup, issuesDigest, charge } = payments.worker()
export const { completeReturn } = payments.publicApi()
