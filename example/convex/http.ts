import { httpRouter } from 'convex/server'
import { payments } from './payments.js'

const http = httpRouter()
// /stripe/webhook and /paypal/webhook. An app with other Stripe objects (ed-market's bid
// PaymentIntents) passes onUnhandledStripeEvent here.
payments.registerRoutes(http)
export default http
