// Saved payment methods and PaymentIntents: saving a card or bank account (SetupIntent), charging it
// with nobody present (offSession), the buyer paying on the app's page after that failed
// (onSession), and settling either from Stripe's answer, a webhook, the sweep or the return page.
// Every PaymentIntent carries metadata { app, checkoutId }, like the hosted checkouts, so the
// webhooks, refunds, disputes and the nightly comparison treat them the same way.
import type { Scheduler } from 'convex/server'
import { ConvexError } from 'convex/values'
import { customerOf, intentState, savedMethodKind, savedMethodLabel, stripe, stripeFee, stripeMethodType, type StripePaymentIntent, type StripePaymentMethod } from '../core/stripe.js'
import { getOrderOrNull, paypal, paypalTokenOf } from '../core/paypal.js'
import { ProcessorError, tagFor, type Payer, type Processor, type Ref, type SavedMethodKind } from '../core/types.js'
import { declineCodeOf, declineKind, type DeclineInfo } from '../core/declines.js'
import { estimateProcessingFee } from '../core/fees.js'
import type { Checkout, Payments, RunActionCtx } from './index.js'
import { chargePaypalNow, paypalMethods, removePaypalMethod, verifyPaypalOwner } from './paypalVault.js'
import { errorText, withParam } from './util.js'

export interface SavedMethod {
  /** Stripe's `pm_…`, or `paypal:<payment token id>` for a method in PayPal's vault. */
  paymentMethodId: string
  processor: Processor
  /** card or ach (Stripe), card or paypal (an account in PayPal's vault). */
  kind: 'card' | 'ach' | 'paypal'
  /** e.g. "Visa •••• 4242", "Chase bank account •••• 6789", "PayPal (jo@example.com)". */
  label: string
  /** An off-session charge of it was declined; don't offer it again. */
  declined: boolean
  /** With savedMethods' forAmountCents: what charging it that amount costs at the app's rates. */
  feeCents?: number
  /** When it was saved (ms). */
  createdAt: number
}

/** Tries of an off-session charge whose outcome is unknown before a person is asked; a minute more between each. */
export const MAX_CHARGE_ATTEMPTS = 5
const RETRY_STEP_MS = 60_000
/** An off-session charge still waiting this long after its last try is tried again by the sweep. */
const CHARGE_STALE_MS = 10 * 60_000
/** On-session payments are given up a day after they start, unless the app says otherwise. */
const ON_SESSION_EXPIRY_MS = 24 * 60 * 60_000

const UNUSABLE = 'That payment method couldn’t be used. Please enter your details again.'
const ownerTag = (owner: Ref) => `${owner.type}:${owner.id}`

/** The owner's Stripe Customer, made (or adopted, when the app already had one) the first time. */
export async function ensureCustomer(p: Payments, ctx: RunActionCtx, owner: Ref, payer: Payer | null, adopt: string | undefined) {
  const found = await ctx.runQuery(p.component.customers.byOwner, { app: p.app, owner })
  if (found) return found
  const now = Date.now()
  if (adopt) return await ctx.runMutation(p.component.customers.save, { app: p.app, owner, stripeCustomerId: adopt, email: payer?.email ?? '', now })
  if (!payer) return null
  // Keyed by the owner, so two first saves at once make one Customer.
  const made = await stripe.createCustomer(
    p.stripeKeys(),
    { app: p.app, owner: ownerTag(owner), email: payer.email.trim(), name: payer.name?.trim() || undefined },
    { fetch: p.fetch, idempotencyKey: `customer-${p.app}-${ownerTag(owner)}` },
  )
  return await ctx.runMutation(p.component.customers.save, { app: p.app, owner, stripeCustomerId: made.id, email: payer.email.trim(), now })
}

export async function setupPaymentMethod(p: Payments, ctx: RunActionCtx, a: { owner: Ref; payer: Payer; stripeCustomerId?: string; methods?: readonly SavedMethodKind[]; limitKey?: string }) {
  await p.takeLimits(ctx, 'setup', a.payer.email, 1, a.limitKey)
  const customer = await ensureCustomer(p, ctx, a.owner, a.payer, a.stripeCustomerId)
  if (!customer) throw new ConvexError('Couldn’t set up a payer here.')
  // Only a bank account, when the app takes cards through PayPal: the Payment Element then shows no card tab.
  const types = a.methods?.length ? a.methods.map(stripeMethodType) : undefined
  const si = await stripe.createSetupIntent(p.stripeKeys(), { customer: customer.stripeCustomerId, app: p.app, owner: ownerTag(a.owner), types }, { fetch: p.fetch })
  if (!si.client_secret) throw new ConvexError('Stripe didn’t return what the card form needs. Please try again.')
  return { clientSecret: si.client_secret, stripeCustomerId: customer.stripeCustomerId }
}

/** Records Stripe's methods in the component and returns them with their declined and removed flags. */
async function recordMethods(p: Payments, ctx: RunActionCtx, stripeCustomerId: string, pms: StripePaymentMethod[]): Promise<(SavedMethod & { removed: boolean })[]> {
  const created = new Map(pms.map((pm) => [pm.id, pm.created * 1000]))
  const methods = pms.flatMap((pm) => {
    const kind = savedMethodKind(pm.type)
    const label = savedMethodLabel(pm)
    return kind && label ? [{ stripePaymentMethodId: pm.id, kind, label }] : []
  })
  const saved = await ctx.runMutation(p.component.customers.saveMethods, { stripeCustomerId, methods, now: Date.now() })
  return saved.map((m) => ({
    paymentMethodId: m.stripePaymentMethodId,
    processor: 'stripe' as const,
    kind: m.kind,
    label: m.label,
    declined: m.declined,
    removed: m.removed,
    createdAt: created.get(m.stripePaymentMethodId) ?? 0,
  }))
}

/** Both processors' saved methods of the owner, newest first, leaving out removed ones. A processor the app hasn't set up is skipped. */
export async function savedMethods(p: Payments, ctx: RunActionCtx, a: { owner: Ref; stripeCustomerId?: string; limitKey?: string; forAmountCents?: number }): Promise<SavedMethod[]> {
  const amount = a.forAmountCents
  if (amount !== undefined && (!Number.isInteger(amount) || amount < 0)) throw new ConvexError('An amount is whole cents, zero or more.')
  // Each list asks Stripe; a page shows it on load, so it may be asked more often than a payment is started.
  await p.takeLimits(ctx, 'methods', ownerTag(a.owner), 4, a.limitKey)
  const out: SavedMethod[] = []
  if (p.options.stripe?.()) {
    const customer = await ensureCustomer(p, ctx, a.owner, null, a.stripeCustomerId)
    if (customer) {
      const list = await stripe.customerMethods(p.stripeKeys(), customer.stripeCustomerId, { fetch: p.fetch })
      for (const { removed, ...m } of await recordMethods(p, ctx, customer.stripeCustomerId, list.data)) if (!removed) out.push(m)
    }
  }
  if (p.options.paypal?.()) out.push(...(await paypalMethods(p, ctx, a.owner)))
  const newest = out.sort((x, y) => y.createdAt - x.createdAt)
  if (amount === undefined) return newest
  // Sorted by fee in a stable sort, so of methods costing the same the newest stays first.
  return newest
    .filter((m) => !m.declined)
    .map((m) => ({ ...m, feeCents: estimateProcessingFee(amount, p.feeSchedule(m.processor, m.kind)) }))
    .sort((x, y) => x.feeCents - y.feeCents)
}

export type VerifiedMethod = SavedMethod & {
  /** The processor's customer the method is saved to. */
  customerId: string
  /** Stripe methods only: the same as customerId. */
  stripeCustomerId?: string
}

export async function verifyMethodOwner(p: Payments, ctx: RunActionCtx, a: { owner: Ref; paymentMethodId: string; stripeCustomerId?: string; limitKey?: string }): Promise<VerifiedMethod> {
  await p.takeLimits(ctx, 'verify', ownerTag(a.owner), 4, a.limitKey)
  return await verifyOwner(p, ctx, a)
}

/** verifyMethodOwner without the rate limit, for the library's own calls. */
export async function verifyOwner(p: Payments, ctx: RunActionCtx, a: { owner: Ref; paymentMethodId: string; stripeCustomerId?: string }): Promise<VerifiedMethod> {
  if (paypalTokenOf(a.paymentMethodId)) return await verifyPaypalOwner(p, ctx, a.owner, a.paymentMethodId)
  const customer = await ensureCustomer(p, ctx, a.owner, null, a.stripeCustomerId)
  if (!customer || !/^pm_[A-Za-z0-9_]+$/.test(a.paymentMethodId)) throw new ConvexError(UNUSABLE)
  let pm: StripePaymentMethod
  try {
    pm = await stripe.retrievePaymentMethod(p.stripeKeys(), a.paymentMethodId, { fetch: p.fetch })
  } catch (err) {
    if (err instanceof ProcessorError && err.status >= 400 && err.status < 500) throw new ConvexError(UNUSABLE)
    throw err
  }
  if (customerOf(pm) !== customer.stripeCustomerId) throw new ConvexError(UNUSABLE)
  const [found] = await recordMethods(p, ctx, customer.stripeCustomerId, [pm])
  if (!found || found.removed) throw new ConvexError(UNUSABLE)
  const { removed: _removed, ...m } = found
  return { ...m, customerId: customer.stripeCustomerId, stripeCustomerId: customer.stripeCustomerId }
}

/**
 * The owner removes a saved method: deleted from PayPal's vault, or detached from the Stripe Customer
 * (a key without write access to PaymentMethods can't; the method is then only hidden, and logged).
 * Either way the library never offers or charges it again. Whether it may go (a bid still relying on
 * it, say) is the app's to decide first.
 */
export async function removeSavedMethod(p: Payments, ctx: RunActionCtx, a: { owner: Ref; paymentMethodId: string; stripeCustomerId?: string; limitKey?: string }): Promise<void> {
  await p.takeLimits(ctx, 'remove', ownerTag(a.owner), 1, a.limitKey)
  const m = await verifyOwner(p, ctx, a)
  if ((await ctx.runQuery(p.component.schedules.usingMethod, { paymentMethodId: m.paymentMethodId })) > 0)
    throw new ConvexError('A repeating payment still uses this payment method. Change its method or cancel it first.')
  if (m.processor === 'paypal') return await removePaypalMethod(p, ctx, m.paymentMethodId)
  try {
    await stripe.detachPaymentMethod(p.stripeKeys(), m.paymentMethodId, { fetch: p.fetch })
  } catch (err) {
    console.warn(`payments: couldn’t detach ${m.paymentMethodId} at Stripe (hidden here instead): ${errorText(err)}`)
  }
  await ctx.runMutation(p.component.customers.removeMethod, { stripePaymentMethodId: m.paymentMethodId, now: Date.now() })
}

/** The PaymentIntent with its payment method and fee, for settling; falls back to what was given when Stripe can't be asked. */
async function full(p: Payments, pi: StripePaymentIntent): Promise<StripePaymentIntent> {
  if (typeof pi.payment_method === 'object' && pi.payment_method && typeof pi.latest_charge === 'object') return pi
  try {
    return await stripe.paymentIntentWithMethod(p.stripeKeys(), pi.id, { fetch: p.fetch })
  } catch (err) {
    console.warn(`payments: couldn’t read ${pi.id} in full: ${errorText(err)}`)
    return pi
  }
}

/**
 * Records what a PaymentIntent says, when it says something final enough: paid (the amount is checked
 * against the checkout by the component), or processing. Returns false when it is still open,
 * waiting for the buyer, canceled or odd, for the caller to decide.
 */
export async function settleIntent(p: Payments, ctx: RunActionCtx, c: Checkout, given: StripePaymentIntent): Promise<boolean> {
  const state = intentState(given)
  if (state !== 'paid' && state !== 'processing') return false
  const pi = await full(p, given)
  // A schedule's first payment made on the page: the method it saved becomes the schedule's before settling starts it.
  if (c.kind === 'onPage' && c.scheduleId) await p.saveForSchedule(ctx, c.id, { stripePaymentIntent: pi.id })
  const pm = typeof pi.payment_method === 'object' && pi.payment_method ? pi.payment_method : null
  const method = (pm && savedMethodKind(pm.type)) ?? undefined
  if (intentState(pi) === 'processing' || state === 'processing') {
    await closeAtProcessor(p, ctx, await ctx.runMutation(p.component.checkouts.markProcessing, { id: c.id, paymentRef: pi.id, method, now: Date.now() }))
    if (intentState(pi) !== 'paid') return true
  }
  const res = await ctx.runMutation(p.component.checkouts.settlePaid, {
    id: c.id,
    paymentRef: pi.id,
    paidCents: pi.amount_received,
    processorFeeCents: stripeFee(pi) ?? undefined,
    processorCheckoutId: pi.id,
    method,
    now: Date.now(),
  })
  await closeAtProcessor(p, ctx, res)
  return true
}

/**
 * The checkouts settling a chain's first payment closed in the ledger (closeChain) are closed at Stripe too, so the
 * buyer's other tab can't pay them: a PaymentIntent canceled, a session expired. PayPal orders need nothing, as a closed
 * checkout's order is never captured. Best effort: a payment that comes anyway is owed back.
 */
export async function closeAtProcessor(p: Payments, ctx: RunActionCtx, settled: object) {
  for (const id of 'closed' in settled && Array.isArray(settled.closed) ? settled.closed : []) {
    if (typeof id !== 'string') continue
    const c = await ctx.runQuery(p.component.checkouts.get, { id })
    if (c?.processor !== 'stripe' || !c.processorCheckoutId) continue
    try {
      if (c.kind === 'onPage') await stripe.cancelPaymentIntent(p.stripeKeys(), c.processorCheckoutId, { fetch: p.fetch })
      else await stripe.expireSession(p.stripeKeys(), c.processorCheckoutId, { fetch: p.fetch })
    } catch (err) {
      console.warn(`payments: couldn’t close ${c.processorCheckoutId} at Stripe after another payment in its chain came first: ${errorText(err)}`)
    }
  }
}

const declineText = (err: ProcessorError) => (err.code === 'authentication_required' ? 'The card needs the buyer to confirm the payment, which can’t happen without them.' : err.message)

/** The code and kind of a refusal, for the checkout and a schedule's retries. */
export const declineOf = (d: DeclineInfo) => ({ declineCode: declineCodeOf(d), declineKind: declineKind(d) })
const stripeDecline = (e: { code?: string | null; decline_code?: string | null; advice_code?: string | null } | null | undefined) =>
  declineOf({ processor: 'stripe', code: e?.code, declineCode: e?.decline_code, adviceCode: e?.advice_code })

/**
 * This checkout's PaymentIntent, found among the customer's own since it started (after a try whose
 * answer never came back). Null only when Stripe has certainly none; when the list is too long to
 * be sure, it throws, so nobody charges again on a guess.
 */
export async function findIntent(p: Payments, c: Checkout): Promise<StripePaymentIntent | null> {
  if (c.processorCheckoutId) return await stripe.paymentIntent(p.stripeKeys(), c.processorCheckoutId, { fetch: p.fetch })
  const since = Math.floor(c.createdAt / 1000) - 60
  let after: string | undefined
  for (let page = 0; page < 10; page++) {
    const list = await stripe.listPaymentIntents(p.stripeKeys(), since, after, { fetch: p.fetch }, c.stripeCustomerId ?? undefined)
    const hit = list.data.find((pi) => pi.metadata?.app === p.app && pi.metadata.checkoutId === c.id)
    if (hit) return hit
    if (!list.has_more || !list.data.length) return null
    after = list.data[list.data.length - 1].id
  }
  throw new Error('Too many of this customer’s payments to be sure whether this charge was made; look in Stripe.')
}

/**
 * Charges an off-session checkout. A decline fails it (onFailed, the method marked declined). A
 * transient error (no answer, 429, 5xx) is tried again a minute later, then two... up to
 * MAX_CHARGE_ATTEMPTS, after which (or at once, for anything else odd) a charge_unknown issue asks a
 * person. Before trying again, the customer's PaymentIntents are searched for this checkout, since an
 * unanswered try may have charged: Stripe replays a key's first answer (even a 500), so a later try
 * uses a new key only after that search found nothing.
 */
export async function chargeNow(p: Payments, ctx: RunActionCtx & { scheduler: Scheduler }, checkoutId: string, manual: boolean): Promise<void> {
  const c = await ctx.runQuery(p.component.checkouts.get, { id: checkoutId })
  if (!c || c.app !== p.app || c.kind !== 'offSession' || (c.status !== 'created' && c.status !== 'pending')) return
  const attempts = c.chargeAttempts
  if (!manual && attempts >= MAX_CHARGE_ATTEMPTS) return
  const note = async (error: string, retry: boolean, piId?: string) => {
    const n = await ctx.runMutation(p.component.checkouts.noteChargeAttempt, {
      id: c.id,
      error,
      processorCheckoutId: piId,
      giveUp: !retry || attempts + 1 >= MAX_CHARGE_ATTEMPTS,
      max: MAX_CHARGE_ATTEMPTS,
      now: Date.now(),
    })
    if (retry && n < MAX_CHARGE_ATTEMPTS) await ctx.scheduler.runAfter(RETRY_STEP_MS * n, p.wiring.worker.charge, { checkoutId: c.id })
  }
  const failed = (reason: string, piId: string | undefined, d: ReturnType<typeof declineOf>) =>
    ctx.runMutation(p.component.checkouts.settleFailed, { id: c.id, reason, declined: true, processorCheckoutId: piId, ...d, now: Date.now() })
  if (c.processor === 'paypal') return await chargePaypalNow(p, ctx, c, note)
  if (!c.stripeCustomerId || !c.paymentMethodId || !c.chargeKey) return await note('The charge is missing its customer or payment method.', false)

  let pi: StripePaymentIntent
  try {
    const earlier = attempts > 0 ? await findIntent(p, c) : null
    if (earlier) {
      if (await settleIntent(p, ctx, c, earlier)) return
      if (earlier.status === 'requires_payment_method')
        return void (await failed(earlier.last_payment_error?.message ?? 'The bank declined the charge.', earlier.id, stripeDecline(earlier.last_payment_error)))
      return await note(`Stripe has the charge as ${earlier.status}.`, false, earlier.id)
    }
    const key = attempts === 0 ? c.chargeKey : `${c.chargeKey}:try-${attempts + 1}`
    pi = await stripe.createPaymentIntent(
      p.stripeKeys(),
      { app: p.app, checkoutId: c.id, amountCents: c.amountCents, customer: c.stripeCustomerId, description: c.description, offSession: true, paymentMethod: c.paymentMethodId },
      { fetch: p.fetch, idempotencyKey: key },
    )
  } catch (err) {
    if (err instanceof ProcessorError && err.declined)
      return void (await failed(declineText(err), err.paymentIntent?.id, declineOf({ processor: 'stripe', code: err.code, declineCode: err.declineCode, adviceCode: err.adviceCode })))
    const retry = err instanceof ProcessorError && err.retryable
    console.warn(`payments: charge of ${c.id} (try ${attempts + 1}) ${retry ? 'will be retried' : 'needs a person'}: ${errorText(err)}`)
    return await note(errorText(err), retry, err instanceof ProcessorError ? err.paymentIntent?.id : undefined)
  }
  if (await settleIntent(p, ctx, c, pi)) return
  await note(`Stripe left the charge ${pi.status}.`, false, pi.id)
}

/** What the sweep does with an off- or on-session checkout. Returns whether it looked at it. */
export async function sweepIntent(p: Payments, ctx: RunActionCtx & { scheduler: Scheduler }, c: Checkout, expired: boolean, now: number): Promise<boolean> {
  if (c.kind === 'offSession') {
    // A charge whose scheduled try died with its action: tried again once it has gone quiet.
    const quietSince = c.lastTriedAt ?? c.createdAt
    if (c.chargeAttempts >= MAX_CHARGE_ATTEMPTS || quietSince > now - CHARGE_STALE_MS) return false
    await chargeNow(p, ctx, c.id, false)
    return true
  }
  if (!expired) return false
  const abandon = () => ctx.runMutation(p.component.checkouts.abandon, { id: c.id, now: Date.now() })
  if (!c.processorCheckoutId) {
    await abandon()
    return true
  }
  const keys = p.stripeKeys()
  const pi = await stripe.paymentIntent(keys, c.processorCheckoutId, { fetch: p.fetch })
  if (await settleIntent(p, ctx, c, pi)) return true
  if (pi.status !== 'canceled') {
    try {
      await stripe.cancelPaymentIntent(keys, pi.id, { fetch: p.fetch })
    } catch (err) {
      // Paid or started processing in the moment between: the webhook or the next sweep settles it.
      if (err instanceof ProcessorError && err.status === 400) return true
      throw err
    }
  }
  await abandon()
  return true
}

/** The return page for an on-session payment (Stripe adds ?payment_intent= after a redirect, e.g. a bank login or 3-D Secure). */
export async function completeIntentReturn(p: Payments, ctx: RunActionCtx, c: Checkout) {
  if (!c.processorCheckoutId) return
  await settleIntent(p, ctx, c, await stripe.paymentIntent(p.stripeKeys(), c.processorCheckoutId, { fetch: p.fetch }))
}

/** A PaymentIntent the buyer can still pay on the page: none tried yet, declined, or waiting for them (3-D Secure). */
export const REUSABLE_INTENT: ReadonlySet<string> = new Set(['requires_payment_method', 'requires_confirmation', 'requires_action'])

type Reused = { checkoutId: string; clientSecret: string } | { checkoutId: string; orderId: string }

/**
 * The checkout a retry pays for, after checking it may be retried, with any retry still open looked
 * at: settled if it was paid meanwhile (then refused), handed back if it is the processor wanted and
 * can still be paid, else closed (a Stripe PaymentIntent canceled first, so it can't pay later; a
 * PayPal order is never captured once its checkout is abandoned).
 */
async function retryable(p: Payments, ctx: RunActionCtx, checkoutId: string, want: Processor): Promise<{ original: Checkout; reuse: Reused | null }> {
  const given = await ctx.runQuery(p.component.checkouts.get, { id: checkoutId })
  // A hosted or on-page checkout is paid again by starting again (an on-page one with replaces), not retried.
  if (!given || given.app !== p.app || given.kind === 'hosted' || given.kind === 'onPage') throw new ConvexError('There is no payment to retry here.')
  const original = given.kind === 'onSession' && given.retryOf ? ((await ctx.runQuery(p.component.checkouts.get, { id: given.retryOf })) ?? given) : given
  if (original.status === 'paid' || original.status === 'refund_needed') throw new ConvexError('This is already paid.')
  if (original.status === 'processing') throw new ConvexError('A payment for this is already on its way.')
  if (original.status !== 'failed' && original.status !== 'abandoned') throw new ConvexError('The first charge for this is still being worked out. Try again later.')
  if (original.scheduleId && original.schedulePeriod && (await ctx.runQuery(p.component.checkouts.schedulePeriodPaid, { scheduleId: original.scheduleId, period: original.schedulePeriod })))
    throw new ConvexError('This is already paid.')
  for (const r of await ctx.runQuery(p.component.checkouts.retriesOf, { id: original.id })) {
    if (r.status === 'paid' || r.status === 'refund_needed') throw new ConvexError('This is already paid.')
    if (r.status === 'processing') throw new ConvexError('This payment is already being processed.')
    if ((r.status !== 'pending' && r.status !== 'created') || !r.processorCheckoutId) continue
    const abandon = () => ctx.runMutation(p.component.checkouts.abandon, { id: r.id, now: Date.now() })
    if (r.processor === 'paypal') {
      const orderId = r.processorCheckoutId
      const order = await p.withPaypal(ctx, (call) => getOrderOrNull(call, orderId))
      if (order?.status === 'COMPLETED') {
        await p.settlePaypalOrder(ctx, r.id, order)
        throw new ConvexError('This payment is already being processed.')
      }
      // Approved but declined at capture: only the buyer captures it after that (capturePaypal), so it can be closed.
      const declinedThere = r.paypalDeclinedAt !== null
      if (order?.status === 'APPROVED' && want !== 'paypal' && !declinedThere) throw new ConvexError('A PayPal payment for this was just approved. Reload the page in a moment.')
      if (want === 'paypal' && order && order.status !== 'VOIDED' && r.expiresAt > Date.now()) return { original, reuse: { checkoutId: r.id, orderId } }
      await abandon()
      continue
    }
    const keys = p.stripeKeys()
    const pi = await stripe.paymentIntent(keys, r.processorCheckoutId, { fetch: p.fetch })
    if (await settleIntent(p, ctx, r, pi)) throw new ConvexError('This payment is already being processed.')
    if (want === 'stripe' && REUSABLE_INTENT.has(pi.status) && pi.client_secret) return { original, reuse: { checkoutId: r.id, clientSecret: pi.client_secret } }
    if (pi.status !== 'canceled') {
      try {
        await stripe.cancelPaymentIntent(keys, pi.id, { fetch: p.fetch })
      } catch (err) {
        // Paid or on its way in the moment between: the webhook settles it.
        if (err instanceof ProcessorError && err.status === 400) throw new ConvexError('This payment is already being processed.')
        throw err
      }
    }
    await abandon()
  }
  return { original, reuse: null }
}

async function createRetry(p: Payments, ctx: RunActionCtx, original: Checkout, processor: Processor, expiresAt: number | undefined, limitKey: string | undefined) {
  const now = Date.now()
  return await ctx.runMutation(p.component.checkouts.create, {
    app: p.app,
    ref: original.ref,
    purpose: original.purpose,
    description: original.description,
    amountCents: original.amountCents,
    processor,
    // PayPal's buttons decide card or account when the buyer chooses; the first is a placeholder.
    method: processor === 'paypal' ? 'paypal' : original.method === 'ach' ? 'ach' : 'card',
    kind: 'onSession',
    payer: original.payer,
    returnUrl: original.returnUrl,
    cancelUrl: original.cancelUrl,
    expiresAt: expiresAt ?? now + ON_SESSION_EXPIRY_MS,
    context: original.context,
    callbacks: await p.handles(),
    stripeCustomerId: processor === 'stripe' ? (original.stripeCustomerId ?? undefined) : undefined,
    retryOf: original.id,
    limits: await p.limits(ctx, 'retry', original.payer.email, 1, limitKey),
    now,
  })
}

export async function retryOnSession(p: Payments, ctx: RunActionCtx, a: { checkoutId: string; expiresAt?: number; limitKey?: string }): Promise<{ checkoutId: string; clientSecret: string }> {
  const { original, reuse } = await retryable(p, ctx, a.checkoutId, 'stripe')
  if (reuse && 'clientSecret' in reuse) return reuse
  const keys = p.stripeKeys()
  const id = await createRetry(p, ctx, original, 'stripe', a.expiresAt, a.limitKey)
  try {
    // A charge first made at PayPal has no Stripe Customer; the payment then simply has none.
    const pi = await stripe.createPaymentIntent(
      keys,
      { app: p.app, checkoutId: id, amountCents: original.amountCents, customer: original.stripeCustomerId ?? undefined, description: original.description, offSession: false },
      { fetch: p.fetch, idempotencyKey: `checkout-${id}` },
    )
    await ctx.runMutation(p.component.checkouts.attach, { id, processorCheckoutId: pi.id })
    if (!pi.client_secret) throw new Error('Stripe returned no client secret.')
    return { checkoutId: id, clientSecret: pi.client_secret }
  } catch (err) {
    await ctx.runMutation(p.component.checkouts.failStart, { id, error: errorText(err), now: Date.now() })
    console.error(`payments: starting the on-session payment ${id} failed: ${errorText(err)}`)
    throw new ConvexError('Stripe couldn’t start the payment just now. Please try again in a moment.')
  }
}

/** The same as retryOnSession, paid with PayPal's buttons (a PayPal account or a card) on the app's page. */
export async function retryWithPaypal(
  p: Payments,
  ctx: RunActionCtx,
  a: { checkoutId: string; returnPath: string; expiresAt?: number; limitKey?: string },
): Promise<{ checkoutId: string; embedded: { processor: 'paypal'; orderId: string; clientId: string; returnUrl: string } }> {
  const { clientId } = p.paypalKeys()
  const returnUrl = p.url(a.returnPath)
  const withToken = (orderId: string) => withParam(returnUrl, 'token', orderId)
  const { original, reuse } = await retryable(p, ctx, a.checkoutId, 'paypal')
  if (reuse && 'orderId' in reuse) return { checkoutId: reuse.checkoutId, embedded: { processor: 'paypal', orderId: reuse.orderId, clientId, returnUrl: withToken(reuse.orderId) } }
  const id = await createRetry(p, ctx, original, 'paypal', a.expiresAt, a.limitKey)
  try {
    const order = await p.withPaypal(ctx, (call) =>
      paypal.createOrder(
        call,
        { customId: tagFor(p.app, id), description: original.description, amountCents: original.amountCents, returnUrl, cancelUrl: returnUrl, brandName: p.options.brandName, embedded: true },
        `checkout-${id}`,
      ),
    )
    await ctx.runMutation(p.component.checkouts.attach, { id, processorCheckoutId: order.id })
    return { checkoutId: id, embedded: { processor: 'paypal', orderId: order.id, clientId, returnUrl: withToken(order.id) } }
  } catch (err) {
    await ctx.runMutation(p.component.checkouts.failStart, { id, error: errorText(err), now: Date.now() })
    console.error(`payments: starting the PayPal payment ${id} failed: ${errorText(err)}`)
    throw new ConvexError('PayPal couldn’t start the payment just now. Please try again in a moment.')
  }
}

/**
 * A payment_intent.* webhook for an off- or on-session checkout. succeeded and processing settle (from
 * a fresh read of the PaymentIntent). payment_failed: an accepted bank payment that bounced, or an
 * off-session charge declined, fails the checkout; on the app's page the buyer may simply try again,
 * so there it is only noted.
 */
export async function onIntentEvent(p: Payments, ctx: RunActionCtx, type: string, pi: StripePaymentIntent): Promise<'handled' | 'ignored' | 'foreign'> {
  const checkoutId = pi.metadata?.app === p.app ? pi.metadata.checkoutId : undefined
  if (!checkoutId) return 'foreign'
  const c = await ctx.runQuery(p.component.checkouts.get, { id: checkoutId })
  if (!c || c.app !== p.app) {
    console.warn(`payments: PaymentIntent ${pi.id} is tagged ${p.app} but no checkout has it`)
    return 'foreign'
  }
  // A hosted checkout's PaymentIntent carries the tag too; its session's events settle it.
  if (c.kind === 'hosted') return 'ignored'
  if (c.processorCheckoutId && c.processorCheckoutId !== pi.id) {
    console.warn(`payments: PaymentIntent ${pi.id} isn’t checkout ${c.id}’s (${c.processorCheckoutId})`)
    return 'ignored'
  }
  if (type === 'payment_intent.succeeded' || type === 'payment_intent.processing') {
    const fresh = await stripe.paymentIntentWithMethod(p.stripeKeys(), pi.id, { fetch: p.fetch })
    await settleIntent(p, ctx, c, fresh)
    return 'handled'
  }
  const reason = pi.last_payment_error?.message ?? (c.status === 'processing' ? 'The bank payment failed.' : 'The payment was declined.')
  if (c.status === 'processing' || c.kind === 'offSession') {
    await ctx.runMutation(p.component.checkouts.settleFailed, { id: c.id, reason, declined: true, processorCheckoutId: pi.id, ...stripeDecline(pi.last_payment_error), now: Date.now() })
  } else {
    await ctx.runMutation(p.component.checkouts.noteError, { id: c.id, error: reason })
  }
  return 'handled'
}
