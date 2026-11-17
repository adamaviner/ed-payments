// Registers (or updates, or removes) an app's webhook at Stripe or PayPal with exactly the events the
// library handles, so nobody copies event lists by hand. Run by `npx ed-payments webhooks`; written as
// functions taking fetch so the tests run it against the fake processors.
import { PAYPAL_EVENTS, PAYPAL_LIVE_API, paypal, paypalToken, type PaypalKeys } from '../core/paypal.js'
import { STRIPE_API_VERSION, STRIPE_EVENTS, stripe, type StripeWebhookEndpoint } from '../core/stripe.js'
import type { Fetch } from '../core/types.js'

export interface WebhookResult {
  action: 'created' | 'updated' | 'unchanged' | 'removed' | 'absent' | 'would create' | 'would update'
  id: string | null
  /** Said to the person running it: what to set where, or what to check. */
  notes: string[]
}

const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && [...a].sort().every((x, i) => x === [...b].sort()[i])

export interface Run {
  url: string
  fetch: Fetch
  /** Events the app needs beyond the library's own. */
  extraEvents?: readonly string[]
  remove?: boolean
  dryRun?: boolean
  /** Required to touch a live account. */
  live?: boolean
}

export async function stripeWebhook(secretKey: string, r: Run): Promise<WebhookResult> {
  const isLiveKey = /^(sk|rk)_live_/.test(secretKey)
  if (isLiveKey && !r.live) throw new Error('That is a live Stripe key. Pass --live to change the live account’s webhooks.')
  const keys = { secretKey }
  const o = { fetch: r.fetch }
  const events = [...new Set([...STRIPE_EVENTS, ...(r.extraEvents ?? [])])]
  const all: StripeWebhookEndpoint[] = []
  let after: string | undefined
  for (let i = 0; i < 20; i++) {
    const page = await stripe.listWebhookEndpoints(keys, after, o)
    all.push(...page.data)
    if (!page.has_more || !page.data.length) break
    after = page.data[page.data.length - 1].id
  }
  const found = all.find((w) => w.url === r.url)
  if (r.remove) {
    if (!found) return { action: 'absent', id: null, notes: [] }
    if (r.dryRun) return { action: 'unchanged', id: found.id, notes: ['Would remove it.'] }
    await stripe.deleteWebhookEndpoint(keys, found.id, o)
    return { action: 'removed', id: found.id, notes: [] }
  }
  if (found) {
    const notes = found.api_version && found.api_version !== STRIPE_API_VERSION ? [`It sends events in API version ${found.api_version}; the library reads ${STRIPE_API_VERSION}. Stripe can’t change that: remove it and run this again (then set the new STRIPE_WEBHOOK_SECRET).`] : []
    if (same(found.enabled_events, events) && found.status !== 'disabled') return { action: 'unchanged', id: found.id, notes }
    if (r.dryRun) return { action: 'would update', id: found.id, notes }
    await stripe.updateWebhookEndpoint(keys, found.id, events, o)
    return { action: 'updated', id: found.id, notes }
  }
  if (r.dryRun) return { action: 'would create', id: null, notes: [] }
  const made = await stripe.createWebhookEndpoint(keys, { url: r.url, events, description: 'Earthdance payments library (@earthdance/payments)' }, o)
  return {
    action: 'created',
    id: made.id,
    notes: [made.secret ? `Set STRIPE_WEBHOOK_SECRET on the deployment to ${made.secret} (Stripe shows it only now).` : 'Copy the signing secret from the Dashboard into STRIPE_WEBHOOK_SECRET.'],
  }
}

export async function paypalWebhook(keys: Pick<PaypalKeys, 'clientId' | 'clientSecret' | 'apiBase'>, r: Run): Promise<WebhookResult> {
  if (keys.apiBase === PAYPAL_LIVE_API && !r.live) throw new Error('That is PayPal’s live API. Pass --live to change the live app’s webhooks.')
  const { token } = await paypalToken(keys, Date.now(), { fetch: r.fetch })
  const call = { apiBase: keys.apiBase, token, fetch: r.fetch }
  const events = [...new Set([...PAYPAL_EVENTS, ...(r.extraEvents ?? [])])]
  const found = ((await paypal.listWebhooks(call)).webhooks ?? []).find((w) => w.url === r.url)
  if (r.remove) {
    if (!found) return { action: 'absent', id: null, notes: [] }
    if (r.dryRun) return { action: 'unchanged', id: found.id, notes: ['Would remove it.'] }
    await paypal.deleteWebhook(call, found.id)
    return { action: 'removed', id: found.id, notes: [] }
  }
  const idNote = (id: string) => `PAYPAL_WEBHOOK_ID on the deployment must be ${id}.`
  if (found) {
    if (
      same(
        found.event_types.map((e) => e.name),
        events,
      )
    )
      return { action: 'unchanged', id: found.id, notes: [idNote(found.id)] }
    if (r.dryRun) return { action: 'would update', id: found.id, notes: [] }
    await paypal.setWebhookEvents(call, found.id, events)
    return { action: 'updated', id: found.id, notes: [idNote(found.id)] }
  }
  if (r.dryRun) return { action: 'would create', id: null, notes: [] }
  const made = await paypal.createWebhook(call, r.url, events)
  return { action: 'created', id: made.id, notes: [idNote(made.id)] }
}
