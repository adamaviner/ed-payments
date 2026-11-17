export type Processor = 'stripe' | 'paypal';
/** How the buyer pays. Stripe takes card or ach (US bank account); PayPal takes card or paypal (the wallet). */
export type Method = 'card' | 'ach' | 'paypal';
export declare const PROCESSORS: readonly Processor[];
export declare const METHODS: Record<Processor, readonly Method[]>;
/** What a checkout is for in the host app, e.g. { type: 'offering', id }. */
export interface Ref {
    type: string;
    id: string;
}
export interface Payer {
    name?: string;
    email: string;
}
/** The fetch the processor code calls; tests pass a fake. */
export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;
/** A processor answered with an error, or could not be reached (status 0). */
export declare class ProcessorError extends Error {
    readonly processor: Processor;
    readonly status: number;
    /** Stripe's error code or PayPal's issue (e.g. ORDER_ALREADY_CAPTURED), when given. */
    readonly code: string | undefined;
    constructor(processor: Processor, status: number, message: string, code?: string);
    /** Worth trying again later: the processor was down, slow or rate-limiting. */
    get retryable(): boolean;
}
/**
 * The tag that marks a processor object as one app's checkout: `<app>:<id>`. It goes into PayPal's
 * custom_id and Stripe's metadata, so apps can share one processor account without taking each
 * other's webhooks.
 */
export declare function tagFor(app: string, id: string): string;
export declare function parseTag(tag: string | null | undefined): {
    app: string;
    id: string;
} | null;
export declare function isMethodFor(processor: Processor, method: Method): boolean;
//# sourceMappingURL=types.d.ts.map