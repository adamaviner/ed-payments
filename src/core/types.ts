// Types shared by the core, the component and the client. Amounts are always integer cents (USD).

export type Processor = 'stripe' | 'paypal'

/** How the buyer pays. Stripe takes card or ach (US bank account); PayPal takes card or paypal (the wallet). */
export type Method = 'card' | 'ach' | 'paypal'

export const PROCESSORS: readonly Processor[] = ['stripe', 'paypal']
export const METHODS: Record<Processor, readonly Method[]> = { stripe: ['card', 'ach'], paypal: ['card', 'paypal'] }

/**
 * How a checkout is paid. hosted: the buyer goes to Stripe Checkout or PayPal. offSession: a saved card
 * or bank account is charged with nobody present (e.g. a winning bid when the auction closes).
 * onSession: the buyer pays on the app's own page with Stripe's Payment Element (e.g. retrying a
 * declined off-session charge). onPage: a new payment made at the buyer's press on the app's own form
 * (start with ui: 'onPage'): a Stripe PaymentIntent, or a PayPal order like an embedded one.
 */
export type CheckoutKind = 'hosted' | 'offSession' | 'onSession' | 'onPage'

/** What a saved payment method is: a card, or a US bank account (ACH). */
export type SavedMethodKind = 'card' | 'ach'

/** What a checkout is for in the host app, e.g. { type: 'offering', id }. */
export interface Ref {
  type: string
  id: string
}

export interface Payer {
  name?: string
  email: string
}

/** The fetch the processor code calls; tests pass a fake. */
export type Fetch = (input: string, init?: RequestInit) => Promise<Response>

/** A processor answered with an error, or could not be reached (status 0). */
export class ProcessorError extends Error {
  readonly processor: Processor
  readonly status: number
  /** Stripe's error code or PayPal's issue (e.g. ORDER_ALREADY_CAPTURED), when given. */
  readonly code: string | undefined
  /** Stripe's error type (card_error, invalid_request_error, api_error, idempotency_error...). */
  readonly type: string | undefined
  /** Stripe's decline code on a card error (insufficient_funds...). */
  readonly declineCode: string | undefined
  /** The PaymentIntent Stripe attached to a failed confirm, so its id and status are known even when the charge was refused. */
  readonly paymentIntent: { id: string; status: string } | undefined
  /** Stripe's advice on a card error (do_not_try_again, try_again_later, confirm_card_data). */
  readonly adviceCode: string | undefined

  constructor(
    processor: Processor,
    status: number,
    message: string,
    code?: string,
    extra: { type?: string; declineCode?: string; adviceCode?: string; paymentIntent?: { id: string; status: string } } = {},
  ) {
    super(message)
    this.name = 'ProcessorError'
    this.processor = processor
    this.status = status
    this.code = code
    this.type = extra.type
    this.declineCode = extra.declineCode
    this.paymentIntent = extra.paymentIntent
    this.adviceCode = extra.adviceCode
  }

  /**
   * Worth trying again later: the processor was down, slow or rate-limiting, or (Stripe's 409) still
   * working on another request with the same idempotency key.
   */
  get retryable(): boolean {
    return this.status === 0 || this.status === 429 || this.status >= 500 || (this.processor === 'stripe' && this.status === 409)
  }

  /**
   * The bank or card said no to a charge: a card error (402), or a card that needs the buyer present
   * to authenticate, which an off-session charge can't do. Asking again won't change the answer.
   */
  get declined(): boolean {
    return this.processor === 'stripe' && (this.type === 'card_error' || this.code === 'authentication_required')
  }
}

/**
 * The tag that marks a processor object as one app's checkout: `<app>:<id>`. It goes into PayPal's
 * custom_id and Stripe's metadata, so apps can share one processor account without taking each
 * other's webhooks.
 */
export function tagFor(app: string, id: string): string {
  return `${app}:${id}`
}

export function parseTag(tag: string | null | undefined): { app: string; id: string } | null {
  if (!tag) return null
  const at = tag.indexOf(':')
  if (at <= 0 || at === tag.length - 1) return null
  return { app: tag.slice(0, at), id: tag.slice(at + 1) }
}

export function isMethodFor(processor: Processor, method: Method): boolean {
  return METHODS[processor].includes(method)
}
