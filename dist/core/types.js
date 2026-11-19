// Types shared by the core, the component and the client. Amounts are always integer cents (USD).
export const PROCESSORS = ['stripe', 'paypal'];
export const METHODS = { stripe: ['card', 'ach'], paypal: ['card', 'paypal'] };
/** A processor answered with an error, or could not be reached (status 0). */
export class ProcessorError extends Error {
    processor;
    status;
    /** Stripe's error code or PayPal's issue (e.g. ORDER_ALREADY_CAPTURED), when given. */
    code;
    /** Stripe's error type (card_error, invalid_request_error, api_error, idempotency_error...). */
    type;
    /** Stripe's decline code on a card error (insufficient_funds...). */
    declineCode;
    /** The PaymentIntent Stripe attached to a failed confirm, so its id and status are known even when the charge was refused. */
    paymentIntent;
    constructor(processor, status, message, code, extra = {}) {
        super(message);
        this.name = 'ProcessorError';
        this.processor = processor;
        this.status = status;
        this.code = code;
        this.type = extra.type;
        this.declineCode = extra.declineCode;
        this.paymentIntent = extra.paymentIntent;
    }
    /** Worth trying again later: the processor was down, slow or rate-limiting. */
    get retryable() {
        return this.status === 0 || this.status === 429 || this.status >= 500;
    }
    /**
     * The bank or card said no to a charge: a card error (402), or a card that needs the buyer present
     * to authenticate, which an off-session charge can't do. Asking again won't change the answer.
     */
    get declined() {
        return this.processor === 'stripe' && (this.type === 'card_error' || this.code === 'authentication_required');
    }
}
/**
 * The tag that marks a processor object as one app's checkout: `<app>:<id>`. It goes into PayPal's
 * custom_id and Stripe's metadata, so apps can share one processor account without taking each
 * other's webhooks.
 */
export function tagFor(app, id) {
    return `${app}:${id}`;
}
export function parseTag(tag) {
    if (!tag)
        return null;
    const at = tag.indexOf(':');
    if (at <= 0 || at === tag.length - 1)
        return null;
    return { app: tag.slice(0, at), id: tag.slice(at + 1) };
}
export function isMethodFor(processor, method) {
    return METHODS[processor].includes(method);
}
//# sourceMappingURL=types.js.map