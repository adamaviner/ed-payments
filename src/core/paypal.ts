// PayPal over plain fetch: OAuth client-credentials tokens, Orders v2, Payments v2 refunds, the
// webhook-signature check (an API call; PayPal has no local HMAC), and Transaction Search. Shapes
// follow PayPal's published OpenAPI specs (Orders 2.36, Payments v2, Webhooks v1, Transaction
// Search v1), looked up 2026-11-16.
//
// Two things those specs say that the old ed-market code didn't do: an order made with
// `payment_source.paypal.experience_context` (which replaces the deprecated `application_context`)
// answers PAYER_ACTION_REQUIRED with a `payer-action` link, not `approve`; and `PayPal-Request-Id`
// makes create, capture and refund safe to repeat.
import { centsToDecimal, decimalToCents } from './money.js'
import { ProcessorError, type Fetch } from './types.js'

export const PAYPAL_SANDBOX_API = 'https://api-m.sandbox.paypal.com'
export const PAYPAL_LIVE_API = 'https://api-m.paypal.com'

export interface PaypalKeys {
  clientId: string
  clientSecret: string
  webhookId: string
  /** PAYPAL_SANDBOX_API or PAYPAL_LIVE_API. */
  apiBase: string
}

export interface PaypalMoney {
  currency_code: string
  value: string
}

export interface PaypalLink {
  href: string
  rel: string
  method?: string
}

export interface PaypalCapture {
  id: string
  status: 'COMPLETED' | 'DECLINED' | 'PARTIALLY_REFUNDED' | 'PENDING' | 'REFUNDED' | 'FAILED'
  amount?: PaypalMoney
  custom_id?: string
  seller_receivable_breakdown?: { paypal_fee?: PaypalMoney; gross_amount?: PaypalMoney; net_amount?: PaypalMoney }
  supplementary_data?: { related_ids?: { order_id?: string } }
  links?: PaypalLink[]
}

export interface PaypalOrder {
  id: string
  status: 'CREATED' | 'SAVED' | 'APPROVED' | 'VOIDED' | 'COMPLETED' | 'PAYER_ACTION_REQUIRED'
  links?: PaypalLink[]
  purchase_units?: { custom_id?: string; reference_id?: string; amount?: PaypalMoney; payments?: { captures?: PaypalCapture[] } }[]
}

export interface PaypalRefund {
  id: string
  status: 'CANCELLED' | 'FAILED' | 'PENDING' | 'COMPLETED'
  amount?: PaypalMoney
  custom_id?: string
  links?: PaypalLink[]
}

export interface PaypalDispute {
  dispute_id: string
  status?: string
  reason?: string
  dispute_amount?: PaypalMoney
  disputed_transactions?: { seller_transaction_id?: string; custom?: string }[]
  dispute_outcome?: { outcome_code?: string }
}

export interface PaypalEvent {
  id: string
  event_type: string
  create_time?: string
  resource_type?: string
  resource: Record<string, unknown>
}

export interface PaypalOptions {
  fetch: Fetch
}

/** A client-credentials access token and when it stops working (ms). */
export async function paypalToken(keys: Pick<PaypalKeys, 'clientId' | 'clientSecret' | 'apiBase'>, now: number, o: PaypalOptions): Promise<{ token: string; expiresAt: number }> {
  let res: Response
  try {
    res = await o.fetch(`${keys.apiBase}/v1/oauth2/token`, {
      method: 'POST',
      headers: { Authorization: `Basic ${btoa(`${keys.clientId}:${keys.clientSecret}`)}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
    })
  } catch (err) {
    throw new ProcessorError('paypal', 0, `PayPal couldn’t be reached: ${err instanceof Error ? err.message : String(err)}`)
  }
  const json = (await res.json().catch(() => null)) as { access_token?: string; expires_in?: number; error_description?: string } | null
  if (!res.ok || !json?.access_token) throw new ProcessorError('paypal', res.status, `PayPal refused the sign-in: ${json?.error_description ?? res.status}`)
  return { token: json.access_token, expiresAt: now + (json.expires_in ?? 300) * 1000 }
}

/** One PayPal API call with a token; an error answer becomes a ProcessorError carrying PayPal's first issue (e.g. ORDER_ALREADY_CAPTURED). */
export async function paypalCall<T>(
  apiBase: string,
  token: string,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body: unknown,
  o: PaypalOptions & { requestId?: string; representation?: boolean; rawBody?: string },
): Promise<T> {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  if (o.requestId) headers['PayPal-Request-Id'] = o.requestId
  if (o.representation) headers.Prefer = 'return=representation'
  let res: Response
  try {
    res = await o.fetch(`${apiBase}${path}`, { method, headers, body: o.rawBody ?? (body === undefined ? undefined : JSON.stringify(body)) })
  } catch (err) {
    throw new ProcessorError('paypal', 0, `PayPal couldn’t be reached: ${err instanceof Error ? err.message : String(err)}`)
  }
  const text = await res.text()
  let json: unknown = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = null
  }
  if (!res.ok) {
    const e = json as { name?: string; message?: string; details?: { issue?: string; description?: string }[] } | null
    const issue = e?.details?.[0]?.issue ?? e?.name
    throw new ProcessorError('paypal', res.status, `PayPal: ${e?.details?.[0]?.description ?? e?.message ?? `answered ${res.status}`}`, issue)
  }
  return json as T
}

export interface OrderInput {
  /** `<app>:<checkoutId>`, the tag every webhook and the reconciliation read back. */
  customId: string
  description: string
  amountCents: number
  returnUrl: string
  cancelUrl: string
  brandName?: string
  /**
   * For PayPal's buttons on the app's own page (JS SDK) instead of a redirect. The order then names no
   * payment_source: the button the buyer presses decides it (PayPal or a card), and a payment_source of
   * paypal would turn the card button away. What experience_context carried goes in application_context,
   * which the buttons still read: no shipping address asked, "Pay Now", the brand name.
   */
  embedded?: boolean
}

export function orderBody(i: OrderInput) {
  const unit = { custom_id: i.customId, description: i.description.slice(0, 127) || 'Payment', amount: { currency_code: 'USD', value: centsToDecimal(i.amountCents) } }
  if (i.embedded) {
    return {
      intent: 'CAPTURE',
      purchase_units: [unit],
      application_context: { shipping_preference: 'NO_SHIPPING', user_action: 'PAY_NOW', ...(i.brandName ? { brand_name: i.brandName.slice(0, 127) } : {}) },
    }
  }
  return {
    intent: 'CAPTURE',
    purchase_units: [unit],
    payment_source: {
      paypal: {
        experience_context: {
          return_url: i.returnUrl,
          cancel_url: i.cancelUrl,
          user_action: 'PAY_NOW',
          shipping_preference: 'NO_SHIPPING',
          ...(i.brandName ? { brand_name: i.brandName.slice(0, 127) } : {}),
        },
      },
    },
  }
}

/** Where to send the buyer: `payer-action` for orders with experience_context, `approve` for older ones. */
export function approveUrl(order: PaypalOrder): string | null {
  return order.links?.find((l) => l.rel === 'payer-action')?.href ?? order.links?.find((l) => l.rel === 'approve')?.href ?? null
}

/** A saved method in PayPal's vault (Payment Method Tokens v3); the parts the library reads. */
export interface PaypalPaymentToken {
  id: string
  customer?: { id?: string; merchant_customer_id?: string }
  payment_source?: {
    card?: { brand?: string; last_digits?: string; expiry?: string; /** VERIFIED or FAILED (the $0 check at saving). */ verification_status?: string }
    paypal?: { email_address?: string; payer_id?: string }
  }
}

export interface PaypalSetupToken {
  id: string
  /** CREATED, PAYER_ACTION_REQUIRED (the buyer approves on PayPal, or 3-D Secure), APPROVED, VAULTED, TOKENIZED. */
  status: string
  customer?: { id?: string; merchant_customer_id?: string }
  payment_source?: PaypalPaymentToken['payment_source']
  links?: PaypalLink[]
}

export interface SetupTokenInput {
  kind: 'card' | 'paypal'
  /** The owner's PayPal customer, once they have one, so every method they save is under it. */
  customerId?: string
  /**
   * The app's own tag for the owner (`<app>.<type>.<id>`), stored by PayPal on the setup token and every
   * saved method. Saving checks it, so a setup token from someone else's browser can't be saved as yours.
   */
  merchantCustomerId: string
  /** For a PayPal account: what the buyer agrees to, shown on PayPal's page. */
  description: string
  returnUrl: string
  cancelUrl: string
  brandName?: string
}

/**
 * A card is checked when it is saved: PayPal runs a $0 authorization (or a small one where the bank
 * has no $0 check) and 3-D Secure only where the bank requires it. A PayPal account is saved for
 * unscheduled charges after the fact (UNSCHEDULED_POSTPAID: we charge when a bid wins), the buyer
 * agreeing on PayPal's page; several saved accounts per customer are allowed (the default is one).
 */
export function setupTokenBody(i: SetupTokenInput) {
  const experience = { return_url: i.returnUrl, cancel_url: i.cancelUrl, ...(i.brandName ? { brand_name: i.brandName.slice(0, 127) } : {}) }
  const customer = { ...(i.customerId ? { id: i.customerId } : {}), merchant_customer_id: i.merchantCustomerId.slice(0, 64) }
  if (i.kind === 'card') return { customer, payment_source: { card: { verification_method: 'SCA_WHEN_REQUIRED', experience_context: experience } } }
  return {
    customer,
    payment_source: {
      paypal: {
        description: i.description.slice(0, 128) || 'Payments',
        usage_pattern: 'UNSCHEDULED_POSTPAID',
        usage_type: 'MERCHANT',
        customer_type: 'CONSUMER',
        permit_multiple_payment_tokens: true,
        experience_context: { ...experience, shipping_preference: 'NO_SHIPPING' },
      },
    },
  }
}

export interface VaultChargeInput {
  customId: string
  description: string
  amountCents: number
  kind: 'card' | 'paypal'
  /** The saved method's payment token id. */
  vaultId: string
}

/**
 * An order on a saved method, captured at once. A card is marked a merchant-initiated, unscheduled
 * charge of a stored card (the card networks require it; PayPal fills in the earlier transaction).
 */
export function vaultChargeBody(i: VaultChargeInput) {
  // invoice_id too: PayPal refuses a second payment with the same one (DUPLICATE_INVOICE_ID, seen in the
  // sandbox), so a retry after PayPal has forgotten the request id can't charge twice.
  const unit = {
    custom_id: i.customId,
    invoice_id: i.customId.slice(0, 127),
    description: i.description.slice(0, 127) || 'Payment',
    amount: { currency_code: 'USD', value: centsToDecimal(i.amountCents) },
  }
  const payment_source =
    i.kind === 'card' ? { card: { vault_id: i.vaultId, stored_credential: { payment_initiator: 'MERCHANT', payment_type: 'UNSCHEDULED', usage: 'SUBSEQUENT' } } } : { paypal: { vault_id: i.vaultId } }
  return { intent: 'CAPTURE', purchase_units: [unit], payment_source }
}

/**
 * PayPal's issues that mean the card or account said no to a charge; asking again won't change it.
 * From the Orders v2 error reference (UNPROCESSABLE_ENTITY), looked up 2026-11-19.
 */
export const PAYPAL_DECLINE_ISSUES: ReadonlySet<string> = new Set([
  'INSTRUMENT_DECLINED',
  'TRANSACTION_REFUSED',
  'PAYMENT_DENIED',
  'CARD_EXPIRED',
  'PAYER_CANNOT_PAY',
  'PAYER_ACCOUNT_RESTRICTED',
  'PAYER_ACCOUNT_LOCKED_OR_CLOSED',
  'PAYER_ACTION_REQUIRED',
  'TRANSACTION_LIMIT_EXCEEDED',
  'MAX_NUMBER_OF_PAYMENT_ATTEMPTS_EXCEEDED',
  'INVALID_PREVIOUS_TRANSACTION_REFERENCE',
  'MISSING_PREVIOUS_REFERENCE',
  'INVALID_PAYMENT_SOURCE',
])

/** "Visa •••• 4242" for a saved card, "PayPal (jo@example.com)" for an account; null when PayPal said too little. */
export function paymentTokenLabel(t: Pick<PaypalPaymentToken, 'payment_source'>): { kind: 'card' | 'paypal'; label: string } | null {
  const card = t.payment_source?.card
  if (card?.last_digits) {
    const brand = (card.brand ?? 'Card').toLowerCase().replace(/_/g, ' ')
    const name = brand === 'amex' ? 'American Express' : brand === 'mastercard' ? 'Mastercard' : brand.replace(/\b\w/g, (ch) => ch.toUpperCase())
    return { kind: 'card', label: `${name} •••• ${card.last_digits}` }
  }
  const pp = t.payment_source?.paypal
  if (pp) return { kind: 'paypal', label: pp.email_address ? `PayPal (${pp.email_address})` : 'PayPal account' }
  return null
}

type Call = { apiBase: string; token: string; fetch: Fetch }
const opts = (c: Call) => ({ fetch: c.fetch })

export const paypal = {
  createOrder: (c: Call, i: OrderInput, requestId: string) => paypalCall<PaypalOrder>(c.apiBase, c.token, 'POST', '/v2/checkout/orders', orderBody(i), { ...opts(c), requestId, representation: true }),
  getOrder: (c: Call, id: string) => paypalCall<PaypalOrder>(c.apiBase, c.token, 'GET', `/v2/checkout/orders/${encodeURIComponent(id)}`, undefined, opts(c)),
  /** Throws ProcessorError with code ORDER_ALREADY_CAPTURED (422) when it was captured before. */
  captureOrder: (c: Call, id: string, requestId: string) =>
    paypalCall<PaypalOrder>(c.apiBase, c.token, 'POST', `/v2/checkout/orders/${encodeURIComponent(id)}/capture`, undefined, { ...opts(c), requestId, representation: true }),
  getCapture: (c: Call, id: string) => paypalCall<PaypalCapture>(c.apiBase, c.token, 'GET', `/v2/payments/captures/${encodeURIComponent(id)}`, undefined, opts(c)),
  refundCapture: (c: Call, captureId: string, r: { amountCents: number; customId: string; note?: string }, requestId: string) =>
    paypalCall<PaypalRefund>(
      c.apiBase,
      c.token,
      'POST',
      `/v2/payments/captures/${encodeURIComponent(captureId)}/refund`,
      { amount: { currency_code: 'USD', value: centsToDecimal(r.amountCents) }, custom_id: r.customId.slice(0, 127), ...(r.note ? { note_to_payer: r.note.slice(0, 255) } : {}) },
      { ...opts(c), requestId, representation: true },
    ),
  getRefund: (c: Call, id: string) => paypalCall<PaypalRefund>(c.apiBase, c.token, 'GET', `/v2/payments/refunds/${encodeURIComponent(id)}`, undefined, opts(c)),

  // Payment Method Tokens v3 (https://developer.paypal.com/docs/api/payment-tokens/v3/): saving a card
  // or PayPal account without a payment, to charge later with nobody present.
  createSetupToken: (c: Call, i: SetupTokenInput, requestId: string) =>
    paypalCall<PaypalSetupToken>(c.apiBase, c.token, 'POST', '/v3/vault/setup-tokens', setupTokenBody(i), { ...opts(c), requestId }),
  getSetupToken: (c: Call, id: string) => paypalCall<PaypalSetupToken>(c.apiBase, c.token, 'GET', `/v3/vault/setup-tokens/${encodeURIComponent(id)}`, undefined, opts(c)),
  /** Turns an approved setup token into a saved method (its id is the vault_id later charges use). */
  createPaymentToken: (c: Call, setupTokenId: string, requestId: string) =>
    paypalCall<PaypalPaymentToken>(c.apiBase, c.token, 'POST', '/v3/vault/payment-tokens', { payment_source: { token: { id: setupTokenId, type: 'SETUP_TOKEN' } } }, { ...opts(c), requestId }),
  /** 204 even for a token already deleted (checked in the sandbox, 2026-11-19). */
  deletePaymentToken: (c: Call, id: string) => paypalCall<null>(c.apiBase, c.token, 'DELETE', `/v3/vault/payment-tokens/${encodeURIComponent(id)}`, undefined, opts(c)),
  /** Charges a saved card or PayPal account; PayPal captures at once and answers with the captured order. */
  chargeVaulted: (c: Call, i: VaultChargeInput, requestId: string) =>
    paypalCall<PaypalOrder>(c.apiBase, c.token, 'POST', '/v2/checkout/orders', vaultChargeBody(i), { ...opts(c), requestId, representation: true }),

  // Webhooks Management v1 (https://developer.paypal.com/docs/api/webhooks/v1/). An app may have ten webhooks.
  listWebhooks: (c: Call) => paypalCall<{ webhooks?: PaypalWebhook[] }>(c.apiBase, c.token, 'GET', '/v1/notifications/webhooks', undefined, opts(c)),
  createWebhook: (c: Call, url: string, events: readonly string[]) =>
    paypalCall<PaypalWebhook>(c.apiBase, c.token, 'POST', '/v1/notifications/webhooks', { url, event_types: events.map((name) => ({ name })) }, opts(c)),
  /** Only `replace` of /url and /event_types is allowed; the same list again answers 400 WEBHOOK_PATCH_REQUEST_NO_CHANGE. */
  setWebhookEvents: (c: Call, id: string, events: readonly string[]) =>
    paypalCall<PaypalWebhook>(
      c.apiBase,
      c.token,
      'PATCH',
      `/v1/notifications/webhooks/${encodeURIComponent(id)}`,
      [{ op: 'replace', path: '/event_types', value: events.map((name) => ({ name })) }],
      opts(c),
    ),
  deleteWebhook: (c: Call, id: string) => paypalCall<null>(c.apiBase, c.token, 'DELETE', `/v1/notifications/webhooks/${encodeURIComponent(id)}`, undefined, opts(c)),
}

export interface PaypalWebhook {
  id: string
  url: string
  event_types: { name: string }[]
}

/**
 * Every PayPal event the library acts on; the webhook is registered with exactly these. DECLINED is
 * the v2 capture failure and DENIED the v1 one; both are taken.
 */
export const PAYPAL_EVENTS = [
  'CHECKOUT.ORDER.APPROVED',
  'PAYMENT.CAPTURE.COMPLETED',
  'PAYMENT.CAPTURE.PENDING',
  'PAYMENT.CAPTURE.DECLINED',
  'PAYMENT.CAPTURE.DENIED',
  'PAYMENT.CAPTURE.REFUNDED',
  'PAYMENT.CAPTURE.REVERSED',
  'CUSTOMER.DISPUTE.CREATED',
  'CUSTOMER.DISPUTE.RESOLVED',
] as const

/** The capture of a captured order (the first unit's first capture). */
export function orderCapture(order: PaypalOrder): PaypalCapture | null {
  return order.purchase_units?.[0]?.payments?.captures?.[0] ?? null
}

export function orderCustomId(order: PaypalOrder): string | null {
  return order.purchase_units?.[0]?.custom_id ?? null
}

const idFromUpLink = (links: PaypalLink[] | undefined, segment: string) => {
  const href = links?.find((l) => l.rel === 'up')?.href
  const m = href ? new RegExp(`/${segment}/([^/?#]+)`).exec(href) : null
  return m ? decodeURIComponent(m[1]) : null
}

/** The order a capture belongs to. */
export const captureOrderId = (c: PaypalCapture) => c.supplementary_data?.related_ids?.order_id ?? idFromUpLink(c.links, 'orders')
/** The capture a refund belongs to. */
export const refundCaptureId = (r: PaypalRefund) => idFromUpLink(r.links, 'captures')

export const moneyCents = (m: PaypalMoney | undefined) => (m && m.currency_code === 'USD' ? decimalToCents(m.value) : null)

/** What PayPal kept on a capture, when it says. */
export const captureFee = (c: PaypalCapture) => moneyCents(c.seller_receivable_breakdown?.paypal_fee)

/** The transmission headers PayPal signs a webhook with. */
export const PAYPAL_SIGNATURE_HEADERS = ['paypal-auth-algo', 'paypal-cert-url', 'paypal-transmission-id', 'paypal-transmission-sig', 'paypal-transmission-time'] as const

/**
 * Asks PayPal whether a webhook is genuine (POST /v1/notifications/verify-webhook-signature). The
 * raw body is spliced into the request as it came, not parsed and serialised again, so PayPal checks
 * the exact bytes it signed.
 */
export async function verifyPaypalWebhook(keys: PaypalKeys, token: string, headers: Headers, rawBody: string, o: PaypalOptions): Promise<boolean> {
  const h = Object.fromEntries(PAYPAL_SIGNATURE_HEADERS.map((name) => [name, headers.get(name)]))
  if (Object.values(h).some((x) => !x) || !keys.webhookId) return false
  const head = JSON.stringify({
    auth_algo: h['paypal-auth-algo'],
    cert_url: h['paypal-cert-url'],
    transmission_id: h['paypal-transmission-id'],
    transmission_sig: h['paypal-transmission-sig'],
    transmission_time: h['paypal-transmission-time'],
    webhook_id: keys.webhookId,
  })
  const res = await paypalCall<{ verification_status?: string }>(keys.apiBase, token, 'POST', '/v1/notifications/verify-webhook-signature', undefined, {
    ...o,
    rawBody: `${head.slice(0, -1)},"webhook_event":${rawBody}}`,
  })
  return res.verification_status === 'SUCCESS'
}

export function parsePaypalEvent(payload: string): PaypalEvent | null {
  try {
    const e = JSON.parse(payload) as PaypalEvent
    return e && typeof e.id === 'string' && typeof e.event_type === 'string' && e.resource && typeof e.resource === 'object' ? e : null
  } catch {
    return null
  }
}

export interface FoundTransaction {
  /** The capture id (or refund id, for a refund). */
  transactionId: string
  customField: string | null
  amountCents: number
  /** S success, P pending, V reversed, D denied. */
  status: string
  eventCode: string
}

/**
 * Transaction Search (GET /v1/reporting/transactions), one page. It needs the Transaction Search
 * permission on the REST app; without it PayPal answers 403 NOT_AUTHORIZED, which callers treat as
 * "not available here". Transactions show up there up to three hours late. Windows are at most 31 days.
 */
export async function searchTransactions(c: Call, q: { start: number; end: number; page: number }): Promise<{ transactions: FoundTransaction[]; totalPages: number }> {
  const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d+Z$/, 'Z')
  const query = `start_date=${iso(q.start)}&end_date=${iso(q.end)}&fields=transaction_info&page_size=500&page=${q.page}`
  const res = await paypalCall<{
    transaction_details?: {
      transaction_info?: { transaction_id?: string; custom_field?: string; transaction_amount?: PaypalMoney; transaction_status?: string; transaction_event_code?: string }
    }[]
    total_pages?: number
  }>(c.apiBase, c.token, 'GET', `/v1/reporting/transactions?${query}`, undefined, opts(c))
  const transactions = (res.transaction_details ?? []).flatMap((d) => {
    const t = d.transaction_info
    const value = t?.transaction_amount?.value
    if (!t?.transaction_id || !value || t.transaction_amount?.currency_code !== 'USD') return []
    const negative = value.trim().startsWith('-')
    const cents = decimalToCents(value.replace('-', ''))
    if (cents === null) return []
    return [
      { transactionId: t.transaction_id, customField: t.custom_field ?? null, amountCents: negative ? -cents : cents, status: t.transaction_status ?? '', eventCode: t.transaction_event_code ?? '' },
    ]
  })
  return { transactions, totalPages: res.total_pages ?? 1 }
}

/** One line of the PayPal account's history, with the other party (PayPal calls them the payer, whichever way the money went). */
export interface PaypalActivity {
  transactionId: string
  /** When it was made (ms). */
  at: number
  eventCode: string
  /** The event code in words ("Website payment", "Refund"). */
  type: string
  /** in: money to the account; out: money from it (refunds, payments sent). */
  direction: 'in' | 'out'
  /** Signed, as PayPal reports it: negative is money out. */
  amountCents: number
  /** PayPal's fee, signed (negative is a fee taken); null when none. */
  feeCents: number | null
  currency: string
  /** S success, P pending, V reversed, D denied. */
  status: string
  name: string | null
  /** Lower-cased. */
  email: string | null
  subject: string | null
  note: string | null
  /** Item names from the cart, in order. */
  items: string[]
  invoiceId: string | null
  customField: string | null
  /** The transaction this one refers to (a refund's payment). */
  referenceId: string | null
}

const EVENT_TYPES: Record<string, string> = {
  T0000: 'Payment',
  T0001: 'Mass payment',
  T0002: 'Subscription payment',
  T0003: 'Pre-approved payment',
  T0005: 'Card payment',
  T0006: 'Checkout payment',
  T0007: 'Website payment',
  T0011: 'Mobile payment',
  T0012: 'Virtual terminal payment',
  T0013: 'Donation',
  T1106: 'Payment reversal',
  T1107: 'Refund',
  T1110: 'Hold for dispute',
  T1111: 'Dispute hold released',
  T1201: 'Chargeback',
}

const EVENT_GROUPS: Record<string, string> = {
  T00: 'Payment',
  T01: 'Fee',
  T03: 'Bank deposit',
  T04: 'Bank withdrawal',
  T11: 'Reversal',
  T12: 'Adjustment',
  T15: 'Hold',
  T21: 'Reserve',
  T22: 'Transfer',
}

/** A Transaction Search event code in words: the code itself when PayPal's list has nothing plainer. */
export const paypalEventType = (code: string) => EVENT_TYPES[code] ?? EVENT_GROUPS[code.slice(0, 3)] ?? code

/** "-12.34" → -1234; null when it isn't money. */
const signedCents = (value: string | undefined) => {
  const v = value?.trim()
  const cents = decimalToCents(v?.replace(/^-/, ''))
  return cents === null || v === undefined ? null : v.startsWith('-') ? -cents : cents
}

/** PayPal's "2026-11-01T12:00:00+0000" → ms. */
const paypalTime = (s: string | undefined) => (s ? Date.parse(s.replace(/([+-]\d\d)(\d\d)$/, '$1:$2')) : NaN)

interface PaypalTransactionDetail {
  transaction_info?: {
    transaction_id?: string
    transaction_event_code?: string
    transaction_initiation_date?: string
    transaction_amount?: PaypalMoney
    fee_amount?: PaypalMoney
    transaction_status?: string
    transaction_subject?: string
    transaction_note?: string
    invoice_id?: string
    custom_field?: string
    paypal_reference_id?: string
  }
  payer_info?: { email_address?: string; payer_name?: { alternate_full_name?: string; given_name?: string; surname?: string } }
  cart_info?: { item_details?: { item_name?: string }[] }
}

const payerName = (n: NonNullable<PaypalTransactionDetail['payer_info']>['payer_name']) => n?.alternate_full_name?.trim() || [n?.given_name, n?.surname].filter(Boolean).join(' ').trim() || null

function toActivity(d: PaypalTransactionDetail): PaypalActivity[] {
  const t = d.transaction_info
  const amountCents = signedCents(t?.transaction_amount?.value)
  const at = paypalTime(t?.transaction_initiation_date)
  if (!t?.transaction_id || amountCents === null || Number.isNaN(at)) return []
  const code = t.transaction_event_code ?? ''
  return [
    {
      transactionId: t.transaction_id,
      at,
      eventCode: code,
      type: paypalEventType(code),
      direction: amountCents < 0 ? 'out' : 'in',
      amountCents,
      feeCents: signedCents(t.fee_amount?.value),
      currency: t.transaction_amount?.currency_code ?? 'USD',
      status: t.transaction_status ?? '',
      name: payerName(d.payer_info?.payer_name),
      email: d.payer_info?.email_address?.trim().toLowerCase() || null,
      subject: t.transaction_subject || null,
      note: t.transaction_note || null,
      items: (d.cart_info?.item_details ?? []).flatMap((i) => (i.item_name ? [i.item_name] : [])),
      invoiceId: t.invoice_id || null,
      customField: t.custom_field || null,
      referenceId: t.paypal_reference_id || null,
    },
  ]
}

/**
 * Transaction Search with the other party and cart, one page: the whole account's history, not only
 * this library's payments. Same limits as searchTransactions (the permission, 31-day windows, three
 * hours late), and PayPal keeps three years. It can't filter by email: callers filter what comes back.
 */
export async function searchActivity(c: Call, q: { start: number; end: number; page: number }): Promise<{ activity: PaypalActivity[]; totalPages: number }> {
  const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d+Z$/, 'Z')
  const query = `start_date=${iso(q.start)}&end_date=${iso(q.end)}&fields=transaction_info,payer_info,cart_info&page_size=500&page=${q.page}`
  const res = await paypalCall<{ transaction_details?: PaypalTransactionDetail[]; total_pages?: number }>(c.apiBase, c.token, 'GET', `/v1/reporting/transactions?${query}`, undefined, opts(c))
  return { activity: (res.transaction_details ?? []).flatMap(toActivity), totalPages: res.total_pages ?? 1 }
}

/** The transaction on PayPal's own site, for an admin to open. */
export const paypalActivityUrl = (apiBase: string, transactionId: string) =>
  `${apiBase.includes('sandbox') ? 'https://www.sandbox.paypal.com' : 'https://www.paypal.com'}/activity/payment/${encodeURIComponent(transactionId)}`

/**
 * The id the library gives a method saved in PayPal's vault, `paypal:<payment token id>`, so one
 * `paymentMethodId` names either processor's methods (Stripe's start `pm_`).
 */
export const paypalMethodId = (paymentTokenId: string) => `paypal:${paymentTokenId}`

/** The payment token id in a library method id, or null when it isn't a PayPal one. */
export function paypalTokenOf(paymentMethodId: string): string | null {
  const m = /^paypal:([A-Za-z0-9_-]{1,64})$/.exec(paymentMethodId)
  return m ? m[1] : null
}
