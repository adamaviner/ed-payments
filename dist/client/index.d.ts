import { type FunctionReference, type HttpRouter, type PaginationOptions } from 'convex/server';
import type { FunctionArgs, FunctionReturnType } from 'convex/server';
import type { ComponentApi } from '../component/_generated/component.js';
import { type FeeRates, type FeeRatesInput, type FeeSchedule } from '../core/fees.js';
import { PAYPAL_LIVE_API, PAYPAL_SANDBOX_API, type PaypalKeys, type PaypalOrder } from '../core/paypal.js';
import { type StripeKeys, type StripeSession } from '../core/stripe.js';
import { type Fetch, type Method, type Payer, type Processor, type Ref } from '../core/types.js';
import { type ReconcileResult } from './reconcile.js';
import { type UnhandledStripeEvent } from './webhooks.js';
import type { Callbacks } from './validators.js';
export type { ComponentApi };
export * from './validators.js';
export type { ReconcileResult, UnhandledStripeEvent };
export { PAYPAL_LIVE_API, PAYPAL_SANDBOX_API };
export { errorText } from './util.js';
type RunQuery = <Q extends FunctionReference<'query', 'public' | 'internal'>>(query: Q, args: FunctionArgs<Q>) => Promise<FunctionReturnType<Q>>;
type RunMutation = <M extends FunctionReference<'mutation', 'public' | 'internal'>>(mutation: M, args: FunctionArgs<M>) => Promise<FunctionReturnType<M>>;
export type RunQueryCtx = {
    runQuery: RunQuery;
};
export type RunMutationCtx = {
    runQuery: RunQuery;
    runMutation: RunMutation;
};
/** Actions and HTTP actions: the ones that may call the processors. */
export type RunActionCtx = RunMutationCtx;
export interface PaymentsOptions {
    /** Tags every checkout (Stripe metadata.app, PayPal custom_id `<app>:<id>`) so apps can share a processor account. */
    app: string;
    /** The app's public site, for the return and cancel pages (e.g. process.env.SITE_URL). */
    siteUrl: () => string;
    /** Stripe's secret key and webhook signing secret, read when called; null when Stripe isn't set up. */
    stripe?: () => StripeKeys | null;
    /** PayPal's REST app and webhook id; null when PayPal isn't set up. apiBase is PAYPAL_SANDBOX_API or PAYPAL_LIVE_API. */
    paypal?: () => PaypalKeys | null;
    /** Fee rates per processor and method; the defaults are Stripe's published US rates for all of them. */
    fees?: FeeRatesInput;
    /** Limits on starting checkouts. false: none. */
    limits?: false | {
        perKey?: number;
        windowMinutes?: number;
        globalPerMinute?: number;
    };
    /** Shown on PayPal's page. */
    brandName?: string;
    /** For tests: the fetch the processor calls go through (default: the global fetch, looked up at each call). */
    fetch?: Fetch;
}
export interface StartArgs extends Callbacks {
    ref: Ref;
    /** A free word for the host, e.g. 'order'. */
    purpose: string;
    /** What the buyer sees at the processor. */
    description: string;
    amountCents: number;
    processor: Processor;
    method: Method;
    payer: Payer;
    /** Path on siteUrl the buyer comes back to after paying. Stripe adds session_id, PayPal adds token. */
    returnPath: string;
    cancelPath: string;
    /** When an unpaid checkout is given up (ms). Default three hours. Stripe allows 30 minutes to 24 hours. */
    expiresAt?: number;
    /** Counted against the per-key limit, e.g. the buyer's email. */
    limitKey?: string;
    /** Passed to every callback. */
    context?: unknown;
}
export type CheckoutView = FunctionReturnType<ComponentApi['checkouts']['get']>;
export type CheckoutStatus = NonNullable<CheckoutView>['status'];
export type RefundView = FunctionReturnType<ComponentApi['refunds']['forCheckout']>[number];
export declare class Payments {
    readonly component: ComponentApi;
    readonly options: PaymentsOptions;
    readonly fees: FeeRates;
    constructor(component: ComponentApi, options: PaymentsOptions);
    get app(): string;
    /** The fee schedule for one processor and method, from this app's rates. */
    feeSchedule(processor: Processor, method: Method): FeeSchedule;
    /** @internal */
    fetch: Fetch;
    /** @internal */
    stripeKeys(): StripeKeys;
    /** @internal */
    paypalKeys(): PaypalKeys;
    /** @internal A PayPal call context: the cached token while it has five minutes left (unless `fresh`), else a new one, cached (encrypted). */
    paypalCall(ctx: RunActionCtx, fresh?: boolean): Promise<{
        apiBase: string;
        token: string;
        fetch: Fetch;
        keys: PaypalKeys;
    }>;
    /**
     * @internal Runs PayPal calls with the cached token; if PayPal answers 401 (the token was revoked
     * or the app's secret changed) it gets a new token and tries once more.
     */
    withPaypal<T>(ctx: RunActionCtx, fn: (call: Awaited<ReturnType<Payments['paypalCall']>>) => Promise<T>): Promise<T>;
    private url;
    private limit;
    /**
     * Starts a checkout from an action: makes the row, asks the processor for its checkout (keyed by
     * the row's id, so a retry gets the same one), and returns where to send the buyer.
     */
    start(ctx: RunActionCtx, a: StartArgs): Promise<{
        checkoutId: string;
        redirectUrl: string;
    }>;
    private startStripe;
    private startPaypal;
    /** @internal Records a paid Stripe session, then (best effort) the fee Stripe kept. */
    settleStripeSession(ctx: RunActionCtx, checkoutId: string, s: StripeSession): Promise<{
        outcome: "processing";
    } | {
        outcome: "already_handled";
        status: "created" | "pending" | "processing" | "paid" | "failed" | "abandoned" | "refund_needed";
    } | {
        outcome: "paid";
    } | {
        outcome: "refund_needed";
        reason: string;
        refundId: string;
    } | null>;
    /** @internal Settles from a PayPal order that has a capture (COMPLETED, PENDING or DECLINED). */
    settlePaypalOrder(ctx: RunActionCtx, checkoutId: string, order: PaypalOrder): Promise<{
        outcome: "processing";
    } | {
        outcome: "already_handled";
        status: "created" | "pending" | "processing" | "paid" | "failed" | "abandoned" | "refund_needed";
    } | {
        outcome: "failed";
    } | {
        outcome: "paid";
    } | {
        outcome: "refund_needed";
        reason: string;
        refundId: string;
    } | null>;
    /**
     * @internal Captures an approved PayPal order and settles it. A second capture (a reloaded
     * return page, the webhook and the sweep racing) gets ORDER_ALREADY_CAPTURED from PayPal: the
     * order is then fetched and settled from what it says, instead of failing (fix b). A checkout
     * that is no longer waiting (abandoned, failed, settled) is never captured: with PayPal no money
     * moves until the capture, so taking it now would only mean refunding it.
     */
    capturePaypal(ctx: RunActionCtx, checkoutId: string, orderId: string): Promise<void>;
    /**
     * For the page the buyer comes back to (`token`: Stripe's session_id or PayPal's token). Returns
     * the outcome at once if the checkout is already settled; otherwise asks the processor and settles
     * (capturing an approved PayPal order), so the page doesn't wait for a webhook. Null: not ours.
     */
    completeReturn(ctx: RunActionCtx, { processor, token }: {
        processor: Processor;
        token: string;
    }): Promise<{
        checkoutId: string;
        ref: Ref;
        status: CheckoutStatus;
    } | null>;
    /** One checkout, for the app's queries (e.g. a thank-you page). */
    status(ctx: RunQueryCtx, checkoutId: string): Promise<CheckoutView>;
    get(ctx: RunQueryCtx, checkoutId: string): Promise<CheckoutView>;
    /** The checkouts for one thing in the app, newest first. */
    forRef(ctx: RunQueryCtx, ref: Ref): Promise<{
        amountCents: number;
        app: string;
        cancelUrl: string;
        context: any;
        createdAt: number;
        description: string;
        disputed: boolean;
        expiresAt: number;
        id: string;
        lastError: string | null;
        method: "card" | "ach" | "paypal";
        paidCents: number | null;
        payer: {
            email: string;
            name?: string;
        };
        paymentRef: string | null;
        processor: "stripe" | "paypal";
        processorCheckoutId: string | null;
        processorFeeCents: number | null;
        purpose: string;
        ref: {
            id: string;
            type: string;
        };
        refundedCents: number;
        returnUrl: string;
        settledAt: number | null;
        status: "created" | "pending" | "processing" | "paid" | "failed" | "abandoned" | "refund_needed";
    }[]>;
    byPaymentRef(ctx: RunQueryCtx, paymentRef: string): Promise<CheckoutView>;
    /** All checkouts, newest first, paginated. */
    list(ctx: RunQueryCtx, paginationOpts: PaginationOptions): Promise<{
        continueCursor: string;
        isDone: boolean;
        page: Array<{
            amountCents: number;
            app: string;
            cancelUrl: string;
            context: any;
            createdAt: number;
            description: string;
            disputed: boolean;
            expiresAt: number;
            id: string;
            lastError: string | null;
            method: "card" | "ach" | "paypal";
            paidCents: number | null;
            payer: {
                email: string;
                name?: string;
            };
            paymentRef: string | null;
            processor: "stripe" | "paypal";
            processorCheckoutId: string | null;
            processorFeeCents: number | null;
            purpose: string;
            ref: {
                id: string;
                type: string;
            };
            refundedCents: number;
            returnUrl: string;
            settledAt: number | null;
            status: "created" | "pending" | "processing" | "paid" | "failed" | "abandoned" | "refund_needed";
        }>;
        pageStatus?: "SplitRecommended" | "SplitRequired" | null;
        splitCursor?: string | null;
    }>;
    /** Stripe's webhook: verify, de-duplicate, act. 400 for a bad signature, 500 for a real failure (Stripe retries), 200 otherwise. */
    handleStripeWebhook(ctx: RunActionCtx, request: Request, onUnhandled?: UnhandledStripeEvent): Promise<Response>;
    handlePaypalWebhook(ctx: RunActionCtx, request: Request): Promise<Response>;
    /**
     * Adds the webhook routes to the app's router. Events the library doesn't handle, or for objects
     * that aren't this app's checkouts, go to onUnhandledStripeEvent when given (ed-market: bid payments).
     */
    registerRoutes(http: HttpRouter, o?: {
        stripePath?: string;
        paypalPath?: string;
        onUnhandledStripeEvent?: UnhandledStripeEvent;
    }): void;
    /** Asks for a refund (the whole remaining amount unless given). Who may is the app's check; `by` is recorded. Returns the refund id. */
    requestRefund(ctx: RunMutationCtx, a: {
        checkoutId: string;
        amountCents?: number;
        reason: string;
        by?: string;
    }): Promise<string>;
    approveRefund(ctx: RunMutationCtx, a: {
        refundId: string;
        by?: string;
    }): Promise<void>;
    /**
     * Sends a refund through the processor, keyed by the refund id (see pushRefund), so it is never made
     * twice. Needs approval first unless skipApproval. Returns the refund as it stands after.
     */
    sendRefund(ctx: RunActionCtx, refundId: string, o?: {
        skipApproval?: boolean;
        by?: string;
    }): Promise<RefundView | null>;
    /**
     * @internal The processor call for a refund already marked sending, and its outcome recorded.
     * The key is the refund's (a new one per attempt the processor refused), so sending again after a
     * timeout or crash returns the same refund instead of making a second. When the outcome is unknown
     * (no answer, a 5xx) the refund stays sending and sweep sends it again under the same key.
     */
    pushRefund(ctx: RunActionCtx, r: {
        refundId: string;
        key: string;
        processor: Processor;
        paymentRef: string;
        amountCents: number;
    }): Promise<void>;
    /** Records a refund made outside the app (a dashboard, a cheque) as done. */
    markRefundedManually(ctx: RunMutationCtx, a: {
        refundId: string;
        by?: string;
        note?: string;
    }): Promise<void>;
    dismissRefund(ctx: RunMutationCtx, a: {
        refundId: string;
        by?: string;
        note?: string;
    }): Promise<void>;
    /** Refunds waiting on someone: requested, approved, sending, failed. */
    openRefunds(ctx: RunQueryCtx): Promise<{
        amountCents: number;
        approvedBy: string | null;
        attempts: number;
        checkoutId: string;
        createdAt: number;
        error: string | null;
        id: string;
        note: string | null;
        origin: "requested" | "needed" | "external";
        processorRefundId: string | null;
        reason: string;
        requestedBy: string | null;
        sentAt: number | null;
        status: "requested" | "approved" | "sending" | "sent" | "failed" | "manual" | "dismissed";
        updatedAt: number;
    }[]>;
    refundsFor(ctx: RunQueryCtx, checkoutId: string): Promise<{
        amountCents: number;
        approvedBy: string | null;
        attempts: number;
        checkoutId: string;
        createdAt: number;
        error: string | null;
        id: string;
        note: string | null;
        origin: "requested" | "needed" | "external";
        processorRefundId: string | null;
        reason: string;
        requestedBy: string | null;
        sentAt: number | null;
        status: "requested" | "approved" | "sending" | "sent" | "failed" | "manual" | "dismissed";
        updatedAt: number;
    }[]>;
    refund(ctx: RunQueryCtx, refundId: string): Promise<{
        amountCents: number;
        approvedBy: string | null;
        attempts: number;
        checkoutId: string;
        createdAt: number;
        error: string | null;
        id: string;
        note: string | null;
        origin: "requested" | "needed" | "external";
        processorRefundId: string | null;
        reason: string;
        requestedBy: string | null;
        sentAt: number | null;
        status: "requested" | "approved" | "sending" | "sent" | "failed" | "manual" | "dismissed";
        updatedAt: number;
    } | null>;
    /**
     * For a cron every 10 minutes. PayPal checkouts pending over 5 minutes: captured if the buyer
     * approved (they may have closed the tab: fix a), abandoned once expired. Expired Stripe sessions:
     * settled if paid, else expired at Stripe and abandoned. Refunds left sending over 10 minutes:
     * asked about (or sent again, safely, under the same key).
     */
    sweep(ctx: RunActionCtx): Promise<{
        checked: number;
        settled: number;
        abandoned: number;
        refunds: number;
        errors: number;
    }>;
    private sweepOne;
    private recheckRefund;
    /**
     * For a nightly cron: compares the last `days` of checkouts and refunds with each processor and
     * opens an issue for each difference (resolving ones that went away). Refunds found at the
     * processor that the ledger lacks are recorded. PayPal's Transaction Search, for captures tagged
     * with this app that the component never heard of, is skipped (logged once a day) when PayPal
     * refuses it.
     */
    reconcile(ctx: RunActionCtx, o?: {
        days?: number;
    }): Promise<ReconcileResult>;
    /** For the app's nightly cleanup: deletes what isn't kept (see the component's maintenance.ts), a batch at a time; call again while `more`. */
    cleanup(ctx: RunMutationCtx): Promise<{
        deleted: number;
        more: boolean;
    }>;
    /** Issues nobody was told about yet, for the app's digest email; mark them after sending. */
    unreportedIssues(ctx: RunQueryCtx): Promise<{
        checkoutId: string | null;
        detail: string;
        id: string;
        key: string;
        kind: "missing_here" | "missing_there" | "amount_differs" | "status_differs" | "dispute" | "callback_failed";
        openedAt: number;
        paymentRef: string | null;
        processor: "stripe" | "paypal";
        reportedAt: number | null;
        resolvedAt: number | null;
    }[]>;
    markReported(ctx: RunMutationCtx, ids: string[]): Promise<void>;
    issues(ctx: RunQueryCtx, o: {
        open: boolean;
        paginationOpts: PaginationOptions;
    }): Promise<{
        continueCursor: string;
        isDone: boolean;
        page: Array<{
            checkoutId: string | null;
            detail: string;
            id: string;
            key: string;
            kind: "missing_here" | "missing_there" | "amount_differs" | "status_differs" | "dispute" | "callback_failed";
            openedAt: number;
            paymentRef: string | null;
            processor: "stripe" | "paypal";
            reportedAt: number | null;
            resolvedAt: number | null;
        }>;
        pageStatus?: "SplitRecommended" | "SplitRequired" | null;
        splitCursor?: string | null;
    }>;
    openIssueCount(ctx: RunQueryCtx): Promise<number>;
    resolveIssue(ctx: RunMutationCtx, id: string): Promise<void>;
    settings(ctx: RunQueryCtx): Promise<{
        retentionDays: number;
    }>;
    updateSettings(ctx: RunMutationCtx, s: {
        retentionDays: number;
    }): Promise<void>;
    /**
     * The internal functions an app's crons call: `export const { sweep, reconcile, cleanup } = payments.worker()`
     * in convex/paymentsWorker.ts, then crons.interval('payments sweep', { minutes: 10 }, internal.paymentsWorker.sweep).
     */
    worker(): {
        sweep: import("convex/server").RegisteredAction<"internal", {}, Promise<null>>;
        reconcile: import("convex/server").RegisteredAction<"internal", {
            days?: number | undefined;
        }, Promise<null>>;
        cleanup: import("convex/server").RegisteredMutation<"internal", {}, Promise<{
            deleted: number;
            more: boolean;
        }>>;
    };
}
/** The idempotency key of a refund's send: the same for every repeat of one attempt (component refunds.begin makes the same). */
export declare const refundKey: (refundId: string, attempts: number) => string;
//# sourceMappingURL=index.d.ts.map