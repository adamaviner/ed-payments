import { type SavedMethodType } from './savedMethods.js';
import { type Fetch, type Method } from './types.js';
export * from './savedMethods.js';
export declare const STRIPE_API_VERSION = "2026-10-28.endive";
export declare const STRIPE_API_BASE = "https://api.stripe.com";
export interface StripeKeys {
    secretKey: string;
    webhookSecret: string;
}
type FormValue = string | number | boolean | null | undefined | FormParams | FormValue[];
export interface FormParams {
    [key: string]: FormValue;
}
/** Stripe's form encoding: nested objects as a[b], arrays as a[0]; undefined is left out. */
export declare function formEncode(params: FormParams): string;
export interface StripeCallOptions {
    fetch: Fetch;
    idempotencyKey?: string;
    /** Defaults to Stripe's API; tests and proxies may change it. */
    apiBase?: string;
}
/** One Stripe API call; an error answer becomes a ProcessorError with Stripe's message and code. */
export declare function stripeCall<T>(keys: Pick<StripeKeys, 'secretKey'>, method: 'GET' | 'POST' | 'DELETE', path: string, params: FormParams | undefined, o: StripeCallOptions): Promise<T>;
export type Metadata = Record<string, string>;
export interface StripeBalanceTransaction {
    id: string;
    fee: number;
}
export interface StripeCharge {
    id: string;
    object: 'charge';
    amount: number;
    amount_refunded: number;
    refunded: boolean;
    payment_intent: string | null;
    balance_transaction: string | StripeBalanceTransaction | null;
    metadata: Metadata | null;
}
export type StripePaymentIntentStatus = 'requires_payment_method' | 'requires_confirmation' | 'requires_action' | 'processing' | 'requires_capture' | 'canceled' | 'succeeded';
export interface StripePaymentIntent {
    id: string;
    object: 'payment_intent';
    amount: number;
    amount_received: number;
    status: StripePaymentIntentStatus;
    metadata: Metadata | null;
    latest_charge: string | StripeCharge | null;
    /** For the browser's Payment Element only; never stored or logged. */
    client_secret?: string | null;
    customer?: string | {
        id: string;
    } | null;
    payment_method?: string | StripePaymentMethod | null;
    last_payment_error?: {
        message?: string;
        code?: string;
        decline_code?: string;
    } | null;
    created: number;
}
export interface StripeCustomer {
    id: string;
    object: 'customer';
    email: string | null;
    metadata: Metadata | null;
}
export interface StripePaymentMethod {
    id: string;
    object: 'payment_method';
    type: string;
    customer: string | {
        id: string;
    } | null;
    card?: {
        brand: string;
        last4: string;
        exp_month?: number;
        exp_year?: number;
    } | null;
    us_bank_account?: {
        bank_name: string | null;
        last4: string | null;
    } | null;
    created: number;
}
export interface StripeSetupIntent {
    id: string;
    object: 'setup_intent';
    status: string;
    /** For the browser's Payment Element only; never stored or logged. */
    client_secret: string | null;
    customer: string | {
        id: string;
    } | null;
    payment_method: string | null;
    usage: string;
    metadata: Metadata | null;
}
export interface StripeWebhookEndpoint {
    id: string;
    object: 'webhook_endpoint';
    url: string;
    enabled_events: string[];
    status: string;
    api_version: string | null;
    description: string | null;
    /** Only in the answer to creating it. */
    secret?: string;
}
export interface StripeSession {
    id: string;
    object: 'checkout.session';
    /** Stripe's page; null for an embedded session. */
    url: string | null;
    /** An embedded session's, for Stripe.js in the buyer's browser. */
    client_secret?: string | null;
    status: 'open' | 'complete' | 'expired' | null;
    payment_status: 'paid' | 'unpaid' | 'no_payment_required';
    payment_intent: string | StripePaymentIntent | null;
    amount_total: number | null;
    client_reference_id: string | null;
    metadata: Metadata | null;
    created: number;
    expires_at: number;
    livemode: boolean;
}
export interface StripeRefund {
    id: string;
    object: 'refund';
    amount: number;
    status: 'pending' | 'requires_action' | 'succeeded' | 'failed' | 'canceled' | null;
    payment_intent: string | null;
    charge: string | null;
    metadata: Metadata | null;
    failure_reason?: string | null;
    created: number;
}
export interface StripeDispute {
    id: string;
    object: 'dispute';
    amount: number;
    status: string;
    reason: string;
    charge: string;
    payment_intent: string | null;
}
export interface StripeList<T> {
    object: 'list';
    data: T[];
    has_more: boolean;
}
export interface StripeEvent {
    id: string;
    object: 'event';
    type: string;
    created: number;
    livemode: boolean;
    api_version: string | null;
    data: {
        object: {
            id: string;
            object: string;
        } & Record<string, unknown>;
    };
}
/** The PaymentIntent id a session, charge, refund or dispute points at. */
export declare const paymentIntentId: (x: {
    payment_intent: string | {
        id: string;
    } | null;
}) => string | null;
export interface SessionInput {
    app: string;
    checkoutId: string;
    description: string;
    amountCents: number;
    method: Extract<Method, 'card' | 'ach'>;
    email?: string;
    successUrl: string;
    cancelUrl: string;
    /** When the session stops taking payment, ms. Stripe allows 30 minutes to 24 hours; clamped inside that. */
    expiresAt: number;
    now: number;
    /**
     * Shown inside the app's page (Stripe.js createEmbeddedCheckoutPage) instead of on Stripe's own. Such a
     * session has no cancel page (the buyer is still on the app's) and sends the buyer to successUrl when paid.
     */
    embedded?: boolean;
}
/** Unix seconds within Stripe's 30 minute to 24 hour window (a minute's margin each side). */
export declare function sessionExpiry(expiresAt: number, now: number): number;
/** The Checkout Session for one checkout, tagged with the app (client_reference_id and metadata on the session and its PaymentIntent). */
export declare function sessionParams(i: SessionInput): FormParams;
type Keys = Pick<StripeKeys, 'secretKey'>;
export interface PaymentIntentInput {
    app: string;
    checkoutId: string;
    amountCents: number;
    /** The payer's Customer; an on-session retry of a charge made at PayPal has none. */
    customer?: string;
    description: string;
    /** offSession: confirm now with the saved method and nobody present; a card that needs the buyer to authenticate is refused (error_on_requires_action). onSession: the browser confirms it. */
    offSession: boolean;
    paymentMethod?: string;
}
export declare function paymentIntentParams(i: PaymentIntentInput): FormParams;
/** card or ach for a Stripe payment method type; null for anything the library doesn't save. */
export declare const savedMethodKind: (type: string) => "card" | "ach" | null;
/** How a saved method reads to its owner, e.g. "Visa •••• 4242" or "Chase bank account •••• 6789". */
export declare function savedMethodLabel(pm: StripePaymentMethod): string | null;
export declare const customerOf: (x: {
    customer?: string | {
        id: string;
    } | null;
}) => string | null;
export declare const stripe: {
    createSession: (keys: Keys, i: SessionInput, o: StripeCallOptions) => Promise<StripeSession>;
    /** With the PaymentIntent's charge and balance transaction, for the fee Stripe kept. */
    retrieveSession: (keys: Keys, id: string, o: StripeCallOptions) => Promise<StripeSession>;
    expireSession: (keys: Keys, id: string, o: StripeCallOptions) => Promise<StripeSession>;
    retrievePaymentIntent: (keys: Keys, id: string, o: StripeCallOptions) => Promise<StripePaymentIntent>;
    /** Keyed `refund-<refundId>` unless o.idempotencyKey says otherwise (a new attempt after Stripe refused one). */
    createRefund: (keys: Keys, r: {
        paymentIntent: string;
        amountCents: number;
        app: string;
        refundId: string;
    }, o: StripeCallOptions) => Promise<StripeRefund>;
    retrieveRefund: (keys: Keys, id: string, o: StripeCallOptions) => Promise<StripeRefund>;
    /** Created at or after `sinceSec`, newest first, 100 a page. */
    listSessions: (keys: Keys, sinceSec: number, startingAfter: string | undefined, o: StripeCallOptions) => Promise<StripeList<StripeSession>>;
    /** Every refund of one PaymentIntent (up to 100). */
    refundsOf: (keys: Keys, paymentIntent: string, o: StripeCallOptions) => Promise<StripeList<StripeRefund>>;
    listRefunds: (keys: Keys, sinceSec: number, startingAfter: string | undefined, o: StripeCallOptions) => Promise<StripeList<StripeRefund>>;
    /** A Customer for one payer of one app; the caller's idempotency key makes a repeat return the same one. */
    createCustomer: (keys: Keys, c: {
        app: string;
        owner: string;
        email: string;
        name?: string;
    }, o: StripeCallOptions) => Promise<StripeCustomer>;
    /** A customer's saved payment methods, newest first. */
    customerMethods: (keys: Keys, customer: string, o: StripeCallOptions) => Promise<StripeList<StripePaymentMethod>>;
    retrievePaymentMethod: (keys: Keys, id: string, o: StripeCallOptions) => Promise<StripePaymentMethod>;
    /** Saves a card or bank account for charging later with nobody present (usage off_session also collects a bank account's debit mandate). */
    createSetupIntent: (keys: Keys, s: {
        customer: string;
        app: string;
        owner: string;
        types?: readonly SavedMethodType[];
    }, o: StripeCallOptions) => Promise<StripeSetupIntent>;
    /** Takes a saved method off its Customer, so it can't be charged again (needs write access to PaymentMethods). */
    detachPaymentMethod: (keys: Keys, id: string, o: StripeCallOptions) => Promise<StripePaymentMethod>;
    createPaymentIntent: (keys: Keys, i: PaymentIntentInput, o: StripeCallOptions) => Promise<StripePaymentIntent>;
    /** Without the expansions, for its status and client secret. */
    paymentIntent: (keys: Keys, id: string, o: StripeCallOptions) => Promise<StripePaymentIntent>;
    /** With the payment method used, for whether it was a card or a bank account. */
    paymentIntentWithMethod: (keys: Keys, id: string, o: StripeCallOptions) => Promise<StripePaymentIntent>;
    cancelPaymentIntent: (keys: Keys, id: string, o: StripeCallOptions) => Promise<StripePaymentIntent>;
    /** Created at or after `sinceSec`, newest first, 100 a page. */
    listPaymentIntents: (keys: Keys, sinceSec: number, startingAfter: string | undefined, o: StripeCallOptions, customer?: string) => Promise<StripeList<StripePaymentIntent>>;
    listWebhookEndpoints: (keys: Keys, startingAfter: string | undefined, o: StripeCallOptions) => Promise<StripeList<StripeWebhookEndpoint>>;
    /** Pinned to the library's API version, so events arrive in the shape the library reads. The answer carries the signing secret, once. */
    createWebhookEndpoint: (keys: Keys, w: {
        url: string;
        events: readonly string[];
        description: string;
    }, o: StripeCallOptions) => Promise<StripeWebhookEndpoint>;
    updateWebhookEndpoint: (keys: Keys, id: string, events: readonly string[], o: StripeCallOptions) => Promise<StripeWebhookEndpoint>;
    deleteWebhookEndpoint: (keys: Keys, id: string, o: StripeCallOptions) => Promise<{
        id: string;
        deleted: boolean;
    }>;
};
/**
 * Every Stripe event the library acts on; the webhook endpoint is registered with exactly these
 * (`npx ed-payments webhooks --stripe <url>`). Others reach the app's onUnhandledStripeEvent.
 */
export declare const STRIPE_EVENTS: readonly ["checkout.session.completed", "checkout.session.async_payment_succeeded", "checkout.session.async_payment_failed", "checkout.session.expired", "payment_intent.succeeded", "payment_intent.processing", "payment_intent.payment_failed", "charge.refunded", "refund.created", "refund.updated", "refund.failed", "charge.dispute.created", "charge.dispute.closed"];
/** The fee Stripe kept, when the session or PaymentIntent was fetched with its balance transaction expanded. */
export declare function stripeFee(x: StripeSession | StripePaymentIntent): number | null;
/** Where a Checkout Session stands, in the library's words. */
export declare function sessionState(s: StripeSession): 'paid' | 'processing' | 'open' | 'expired';
/**
 * Where a PaymentIntent stands, in the library's words. open: waiting for a payment method (the buyer
 * on-session, or after a refused confirm). action: waiting for the buyer to authenticate, normal on
 * the app's page and never expected off-session. odd: requires_capture, which the library never asks
 * for, so a person should look.
 */
export declare function intentState(pi: Pick<StripePaymentIntent, 'status'>): 'paid' | 'processing' | 'open' | 'action' | 'canceled' | 'odd';
/** Compares in time that doesn't depend on where the strings first differ. */
export declare function constantTimeEqual(a: string, b: string): boolean;
/**
 * Checks a Stripe-Signature header (`t=<unix seconds>,v1=<hex>,...`): HMAC-SHA256 of `<t>.<raw body>`
 * with the endpoint secret, any v1 matching, and t within the tolerance (5 minutes, as Stripe's
 * libraries). Unknown entries (v0, debug metadata) are ignored, as Stripe asks.
 */
export declare function verifyStripeSignature(payload: string, header: string | null, secret: string, nowMs: number, toleranceSec?: number): Promise<boolean>;
/** A Stripe-Signature header for a body, as Stripe would send it: for tests and fixtures. */
export declare function signStripePayload(payload: string, secret: string, timestampSec: number): Promise<string>;
export declare function parseStripeEvent(payload: string): StripeEvent | null;
//# sourceMappingURL=stripe.d.ts.map