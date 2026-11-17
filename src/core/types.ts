// Types shared by the core, the component and the client. Amounts are always integer cents (USD).

export type Processor = 'stripe' | 'paypal'

/** How the buyer pays. Stripe takes card or ach (US bank account); PayPal takes card or paypal (the wallet). */
export type Method = 'card' | 'ach' | 'paypal'

export const PROCESSORS: readonly Processor[] = ['stripe', 'paypal']
export const METHODS: Record<Processor, readonly Method[]> = { stripe: ['card', 'ach'], paypal: ['card', 'paypal'] }

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

  constructor(processor: Processor, status: number, message: string, code?: string) {
    super(message)
    this.name = 'ProcessorError'
    this.processor = processor
    this.status = status
    this.code = code
  }

  /** Worth trying again later: the processor was down, slow or rate-limiting. */
  get retryable(): boolean {
    return this.status === 0 || this.status === 429 || this.status >= 500
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
