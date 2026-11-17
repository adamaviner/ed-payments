import { type Fetch, type Method } from './types.js';
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
export declare function stripeCall<T>(keys: Pick<StripeKeys, 'secretKey'>, method: 'GET' | 'POST', path: string, params: FormParams | undefined, o: StripeCallOptions): Promise<T>;
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
export interface StripePaymentIntent {
    id: string;
    object: 'payment_intent';
    amount: number;
    amount_received: number;
    status: string;
    metadata: Metadata | null;
    latest_charge: string | StripeCharge | null;
}
export interface StripeSession {
    id: string;
    object: 'checkout.session';
    url: string | null;
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
}
/** Unix seconds within Stripe's 30 minute to 24 hour window (a minute's margin each side). */
export declare function sessionExpiry(expiresAt: number, now: number): number;
/** The Checkout Session for one checkout, tagged with the app (client_reference_id and metadata on the session and its PaymentIntent). */
export declare function sessionParams(i: SessionInput): FormParams;
type Keys = Pick<StripeKeys, 'secretKey'>;
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
};
/** The fee Stripe kept, when the session or PaymentIntent was fetched with its balance transaction expanded. */
export declare function stripeFee(x: StripeSession | StripePaymentIntent): number | null;
/** Where a Checkout Session stands, in the library's words. */
export declare function sessionState(s: StripeSession): 'paid' | 'processing' | 'open' | 'expired';
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
export {};
//# sourceMappingURL=stripe.d.ts.map