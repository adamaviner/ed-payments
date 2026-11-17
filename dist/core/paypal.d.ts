import { type Fetch } from './types.js';
export declare const PAYPAL_SANDBOX_API = "https://api-m.sandbox.paypal.com";
export declare const PAYPAL_LIVE_API = "https://api-m.paypal.com";
export interface PaypalKeys {
    clientId: string;
    clientSecret: string;
    webhookId: string;
    /** PAYPAL_SANDBOX_API or PAYPAL_LIVE_API. */
    apiBase: string;
}
export interface PaypalMoney {
    currency_code: string;
    value: string;
}
export interface PaypalLink {
    href: string;
    rel: string;
    method?: string;
}
export interface PaypalCapture {
    id: string;
    status: 'COMPLETED' | 'DECLINED' | 'PARTIALLY_REFUNDED' | 'PENDING' | 'REFUNDED' | 'FAILED';
    amount?: PaypalMoney;
    custom_id?: string;
    seller_receivable_breakdown?: {
        paypal_fee?: PaypalMoney;
        gross_amount?: PaypalMoney;
        net_amount?: PaypalMoney;
    };
    supplementary_data?: {
        related_ids?: {
            order_id?: string;
        };
    };
    links?: PaypalLink[];
}
export interface PaypalOrder {
    id: string;
    status: 'CREATED' | 'SAVED' | 'APPROVED' | 'VOIDED' | 'COMPLETED' | 'PAYER_ACTION_REQUIRED';
    links?: PaypalLink[];
    purchase_units?: {
        custom_id?: string;
        reference_id?: string;
        amount?: PaypalMoney;
        payments?: {
            captures?: PaypalCapture[];
        };
    }[];
}
export interface PaypalRefund {
    id: string;
    status: 'CANCELLED' | 'FAILED' | 'PENDING' | 'COMPLETED';
    amount?: PaypalMoney;
    custom_id?: string;
    links?: PaypalLink[];
}
export interface PaypalDispute {
    dispute_id: string;
    status?: string;
    reason?: string;
    dispute_amount?: PaypalMoney;
    disputed_transactions?: {
        seller_transaction_id?: string;
        custom?: string;
    }[];
    dispute_outcome?: {
        outcome_code?: string;
    };
}
export interface PaypalEvent {
    id: string;
    event_type: string;
    create_time?: string;
    resource_type?: string;
    resource: Record<string, unknown>;
}
export interface PaypalOptions {
    fetch: Fetch;
}
/** A client-credentials access token and when it stops working (ms). */
export declare function paypalToken(keys: Pick<PaypalKeys, 'clientId' | 'clientSecret' | 'apiBase'>, now: number, o: PaypalOptions): Promise<{
    token: string;
    expiresAt: number;
}>;
/** One PayPal API call with a token; an error answer becomes a ProcessorError carrying PayPal's first issue (e.g. ORDER_ALREADY_CAPTURED). */
export declare function paypalCall<T>(apiBase: string, token: string, method: 'GET' | 'POST', path: string, body: unknown, o: PaypalOptions & {
    requestId?: string;
    representation?: boolean;
    rawBody?: string;
}): Promise<T>;
export interface OrderInput {
    /** `<app>:<checkoutId>`, the tag every webhook and the reconciliation read back. */
    customId: string;
    description: string;
    amountCents: number;
    returnUrl: string;
    cancelUrl: string;
    brandName?: string;
}
export declare function orderBody(i: OrderInput): {
    intent: string;
    purchase_units: {
        custom_id: string;
        description: string;
        amount: {
            currency_code: string;
            value: string;
        };
    }[];
    payment_source: {
        paypal: {
            experience_context: {
                brand_name?: string | undefined;
                return_url: string;
                cancel_url: string;
                user_action: string;
                shipping_preference: string;
            };
        };
    };
};
/** Where to send the buyer: `payer-action` for orders with experience_context, `approve` for older ones. */
export declare function approveUrl(order: PaypalOrder): string | null;
type Call = {
    apiBase: string;
    token: string;
    fetch: Fetch;
};
export declare const paypal: {
    createOrder: (c: Call, i: OrderInput, requestId: string) => Promise<PaypalOrder>;
    getOrder: (c: Call, id: string) => Promise<PaypalOrder>;
    /** Throws ProcessorError with code ORDER_ALREADY_CAPTURED (422) when it was captured before. */
    captureOrder: (c: Call, id: string, requestId: string) => Promise<PaypalOrder>;
    getCapture: (c: Call, id: string) => Promise<PaypalCapture>;
    refundCapture: (c: Call, captureId: string, r: {
        amountCents: number;
        customId: string;
        note?: string;
    }, requestId: string) => Promise<PaypalRefund>;
    getRefund: (c: Call, id: string) => Promise<PaypalRefund>;
};
/** The capture of a captured order (the first unit's first capture). */
export declare function orderCapture(order: PaypalOrder): PaypalCapture | null;
export declare function orderCustomId(order: PaypalOrder): string | null;
/** The order a capture belongs to. */
export declare const captureOrderId: (c: PaypalCapture) => string | null;
/** The capture a refund belongs to. */
export declare const refundCaptureId: (r: PaypalRefund) => string | null;
export declare const moneyCents: (m: PaypalMoney | undefined) => number | null;
/** What PayPal kept on a capture, when it says. */
export declare const captureFee: (c: PaypalCapture) => number | null;
/** The transmission headers PayPal signs a webhook with. */
export declare const PAYPAL_SIGNATURE_HEADERS: readonly ["paypal-auth-algo", "paypal-cert-url", "paypal-transmission-id", "paypal-transmission-sig", "paypal-transmission-time"];
/**
 * Asks PayPal whether a webhook is genuine (POST /v1/notifications/verify-webhook-signature). The
 * raw body is spliced into the request as it came, not parsed and serialised again, so PayPal checks
 * the exact bytes it signed.
 */
export declare function verifyPaypalWebhook(keys: PaypalKeys, token: string, headers: Headers, rawBody: string, o: PaypalOptions): Promise<boolean>;
export declare function parsePaypalEvent(payload: string): PaypalEvent | null;
export interface FoundTransaction {
    /** The capture id (or refund id, for a refund). */
    transactionId: string;
    customField: string | null;
    amountCents: number;
    /** S success, P pending, V reversed, D denied. */
    status: string;
    eventCode: string;
}
/**
 * Transaction Search (GET /v1/reporting/transactions), one page. It needs the Transaction Search
 * permission on the REST app; without it PayPal answers 403 NOT_AUTHORIZED, which callers treat as
 * "not available here". Transactions show up there up to three hours late. Windows are at most 31 days.
 */
export declare function searchTransactions(c: Call, q: {
    start: number;
    end: number;
    page: number;
}): Promise<{
    transactions: FoundTransaction[];
    totalPages: number;
}>;
export {};
//# sourceMappingURL=paypal.d.ts.map