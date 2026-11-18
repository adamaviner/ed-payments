import { httpRouter } from 'convex/server'
import { payments } from './payments.js'

const http = httpRouter()
// /stripe/webhook and /paypal/webhook, each only when its keys are set. An app with Stripe objects
// of its own passes onUnhandledStripeEvent here.
payments.registerRoutes(http)
export default http
