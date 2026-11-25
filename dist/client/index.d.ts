import { type Crons, type FunctionReference, type FunctionArgs, type FunctionReturnType, type HttpRouter, type PaginationOptions, type Scheduler } from 'convex/server';
import { type GenericValidator, type Infer } from 'convex/values';
import type { ComponentApi } from '../component/_generated/component.js';
import { type CardProcessorChoice, type FeeRates, type FeeRatesInput, type FeeSchedule } from '../core/fees.js';
import { PAYPAL_LIVE_API, PAYPAL_SANDBOX_API, type PaypalKeys, type PaypalOrder } from '../core/paypal.js';
import type { StripeKeys, StripeSession } from '../core/stripe.js';
import { type Fetch, type Method, type Payer, type Processor, type Ref, type SavedMethodKind } from '../core/types.js';
import { type AdminApiOptions } from './api.js';
import { type PaypalHistory, type PaypalHistoryArgs, type PaypalHistoryLine } from './paypalHistory.js';
import { type ReconcileResult } from './reconcile.js';
import { type SavedMethod, type VerifiedMethod } from './saved.js';
import { type ScheduleView, type StartScheduleArgs, type StartScheduleCheckoutArgs } from './schedules.js';
import { callbackArgs, type Dispute, type Failed, type IssuesDigest, type Paid, type PaidResult, type Processing, type RefundNeeded, type Refunded, type ScheduleChanged, type ScheduleCharged, type ScheduleFailed } from './validators.js';
import { type UnhandledStripeEvent } from './webhooks.js';
export type { ComponentApi, PaypalHistory, PaypalHistoryArgs, PaypalHistoryLine, ReconcileResult, UnhandledStripeEvent, SavedMethod, VerifiedMethod, AdminApiOptions, ScheduleView, StartScheduleArgs, StartScheduleCheckoutArgs, };
export * from './validators.js';
export { fromEnv, isLive, stripeProblems, paypalProblems, type KeySource, type Problem } from './env.js';
export { PAYPAL_LIVE_API, PAYPAL_SANDBOX_API };
export { errorText, PAYPAL_DECLINED, refundKey } from './util.js';
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
export type RunActionCtx = RunMutationCtx & {
    auth?: AuthLike;
    scheduler?: Scheduler;
};
/** Mutations and actions that schedule (chargeSaved queues the charge). */
export type SchedulerCtx = RunMutationCtx & {
    scheduler: Scheduler;
    auth?: AuthLike;
};
export type AuthLike = {
    getUserIdentity(): Promise<{
        subject: string;
    } | null>;
};
export interface LimitOptions {
    /** Per key (the host's limitKey, else the signed-in user, else the payer's email or the owner), per window. Default 5. */
    perKey?: number;
    windowMinutes?: number;
    /** Everyone together, per minute. Default 30. */
    globalPerMinute?: number;
}
export interface PaymentsOptions<C extends GenericValidator> {
    /** Tags every checkout (Stripe metadata.app, PayPal custom_id `<app>:<id>`) so apps can share a processor account. */
    app: string;
    /** What every checkout carries for the app's callbacks; checked when the checkout starts. */
    context: C;
    /** The app's public site, for the return and cancel pages. Default: SITE_URL. */
    siteUrl?: () => string;
    /** fromEnv.stripe(), or a function returning the keys (null: Stripe isn't set up). */
    stripe?: (() => StripeKeys | null) & {
        check?: () => void;
    };
    /** fromEnv.paypal(), or a function returning the keys (null: PayPal isn't set up). */
    paypal?: (() => PaypalKeys | null) & {
        check?: () => void;
    };
    /** Fee rates per processor and method; the defaults are Stripe's published US rates for all of them. */
    fees?: FeeRatesInput;
    /** Limits on every public entry (starting, saving a method, retrying, the return page). false: none (tests only). */
    limits?: false | LimitOptions;
    /** Shown on PayPal's page. */
    brandName?: string;
    /** For tests: the fetch the processor calls go through (default: the global fetch, looked up at each call). */
    fetch?: Fetch;
    /**
     * Schedules (monthly charges): the hour (UTC) charges are made, default 15 (10 or 11 in the morning
     * in New York), and the days after a period's first refusal it is tried again, default [3, 5, 7];
     * after the last, the schedule lapses. Hard declines aren't retried.
     */
    schedules?: {
        hourUTC?: number;
        retryDays?: number[];
    };
}
type Internal<Args extends Record<string, unknown>, R = unknown> = FunctionReference<'mutation', 'internal', Args, R>;
/** The app's internal mutations the library calls, each inside the transaction that records the change. All required. */
export interface PaymentCallbacks<T> {
    paid: Internal<Paid<T>, PaidResult>;
    failed: Internal<Failed<T>>;
    refunded: Internal<Refunded<T>>;
    refundNeeded: Internal<RefundNeeded<T>>;
    dispute: Internal<Dispute<T>>;
    processing: Internal<Processing<T>>;
    /** The nightly digest of new issues (send it to a person). */
    issues: Internal<IssuesDigest>;
    /** Only for schedules (all three, then): a period's charge was paid. */
    scheduleCharged?: Internal<ScheduleCharged<T>>;
    /** A schedule's charge was refused: retried later, or (final) the schedule lapsed. */
    scheduleFailed?: Internal<ScheduleFailed<T>>;
    /** A schedule started, never started, or was changed (amount, method, day, pause, resume, cancel), by the app or the processor. */
    scheduleChanged?: Internal<ScheduleChanged<T>>;
}
/** Who is asking, as the app's check sees it; recorded on refunds. */
export interface Who {
    name: string;
}
/** The functions payments.worker() makes, as the app exports them (e.g. internal.payments). */
export interface WorkerRefs {
    sweep: FunctionReference<'action', 'internal', Record<string, never>, null>;
    reconcile: FunctionReference<'action', 'internal', {
        days?: number;
    }, null>;
    cleanup: FunctionReference<'mutation', 'internal', Record<string, never>, {
        deleted: number;
        more: boolean;
    }>;
    issuesDigest: FunctionReference<'mutation', 'internal', Record<string, never>, number>;
    charge: FunctionReference<'action', 'internal', {
        checkoutId: string;
        manual?: boolean;
    }, null>;
    /** Only for schedules: the hourly run (registerCrons adds it when the schedule callbacks are wired). */
    schedules?: FunctionReference<'action', 'internal', {
        scheduleId?: string;
    }, null>;
}
export interface PaymentsWiring<T> {
    on: PaymentCallbacks<T>;
    /**
     * The app's own permission checks, as internal queries returning { name } or null (refused).
     * `auth` is whatever the caller passed to the generated function (ed-schedule: its session token);
     * apps that use Convex auth ignore it, as the caller's identity carries through.
     */
    authorize: {
        /** May approve, send and record refunds, resolve issues, retry charges: { name } or null. */
        admin: FunctionReference<'query', 'internal', {
            auth?: unknown;
        }, Who | null>;
        /**
         * May see the payments and ask for a refund, nothing more (e.g. staff, beside admins who approve
         * and send). Without it only admins may ask.
         */
        request?: FunctionReference<'query', 'internal', {
            auth?: unknown;
        }, Who | null>;
        /**
         * Asked right before a refund is approved or sent: null to go ahead, or a sentence saying why not
         * (e.g. "Confirm with your passkey first."), which refuses it with code 'step_up' so the page can
         * ask for the check and try again. For a fresh passkey check, or any second step.
         */
        stepUp?: FunctionReference<'query', 'internal', {
            auth?: unknown;
            action: 'approve' | 'send';
            refundId: string;
        }, string | null>;
    };
    /** Where the app exported payments.worker(), for scheduled charges and registerCrons. */
    worker: WorkerRefs;
}
export interface StartArgs<T> {
    ref: Ref;
    /** A free word for the host, e.g. 'order'. */
    purpose: string;
    /** What the buyer sees at the processor. */
    description: string;
    /** Priced on the server, never taken from the browser. */
    amountCents: number;
    processor: Processor;
    method: Method;
    payer: Payer;
    /** Path on siteUrl the buyer comes back to after paying. Stripe adds session_id, PayPal adds token. */
    returnPath: string;
    cancelPath: string;
    /** When an unpaid checkout is given up (ms). Default three hours. Stripe allows 30 minutes to 24 hours. */
    expiresAt?: number;
    /** Counted against the per-key limit instead of the signed-in user or the payer's email. */
    limitKey?: string;
    /** Passed to every callback; checked against the context validator. */
    context: T;
    /**
     * redirect (default): send the buyer to the processor's page. embedded: show it on the app's own page,
     * with `PaypalButtons` or `StripeEmbeddedCheckout` from `@earthdance/payments/react`. Either way the
     * buyer ends on returnPath and the webhooks settle the payment.
     */
    ui?: StartUi;
}
export type StartUi = 'redirect' | 'embedded';
/** What the browser needs to show an embedded checkout. */
export type EmbeddedPayment = 
/** For Stripe.js's createEmbeddedCheckoutPage, with the app's publishable key. Stripe sends the buyer to returnPath when paid. */
{
    processor: 'stripe';
    clientSecret: string;
}
/**
 * For PayPal's buttons: the order the buttons pay, the REST app's client id (public; it also says
 * sandbox or live), and where to go once paid (returnPath with PayPal's token, as a redirect would).
 */
 | {
    processor: 'paypal';
    orderId: string;
    clientId: string;
    returnUrl: string;
    /**
     * An order that saves its method for a schedule can only be paid one way: 'paypal' with
     * PaypalButtons (the PayPal button alone), 'card' with PaypalCardPayment (PayPal's Card Fields).
     */
    only?: 'card' | 'paypal';
};
export interface StartedRedirect {
    checkoutId: string;
    redirectUrl: string;
}
export interface StartedEmbedded {
    checkoutId: string;
    embedded: EmbeddedPayment;
}
export interface ChargeArgs<T> {
    ref: Ref;
    purpose: string;
    description: string;
    amountCents: number;
    payer: Payer;
    /** Whose saved method it is (the owner given to setupPaymentMethod). */
    owner: Ref;
    paymentMethodId: string;
    /**
     * The app's key for this charge, e.g. `bid-<id>-<selectedAt>`: calling chargeSaved again with the
     * same key returns the same checkout, and Stripe replays the same charge.
     */
    idempotencyKey: string;
    context: T;
    /** The Stripe Customer, when the library has none recorded for the owner (adopting one made before it). */
    stripeCustomerId?: string;
}
export type CheckoutView = FunctionReturnType<ComponentApi['checkouts']['get']>;
export type Checkout = NonNullable<CheckoutView>;
export type CheckoutStatus = Checkout['status'];
export type RefundView = FunctionReturnType<ComponentApi['refunds']['forCheckout']>[number];
export type IssueView = FunctionReturnType<ComponentApi['issues']['list']>['page'][number];
/**
 * Step one: the app's tag, keys and context type. Returns { withCallbacks } for step two.
 */
export declare function definePayments<C extends GenericValidator>(component: ComponentApi, options: PaymentsOptions<C>): {
    withCallbacks(wiring: PaymentsWiring<Infer<C>>): Payments<C>;
};
/** The app's payments; C is its context validator (definePayments). */
export declare class Payments<C extends GenericValidator = GenericValidator> {
    readonly component: ComponentApi;
    readonly options: PaymentsOptions<C>;
    readonly wiring: PaymentsWiring<Infer<C>>;
    readonly fees: FeeRates;
    /** The callbacks' argument validators with this app's context: `internalMutation({ args: payments.args.paid, returns: paidReturns, ... })`. */
    readonly args: ReturnType<typeof callbackArgs<C>>;
    readonly paidReturns: import("convex/values").VUnion<{
        refuse: string;
    } | null, [import("convex/values").VNull<null, "required">, import("convex/values").VObject<{
        refuse: string;
    }, {
        refuse: import("convex/values").VString<string, "required">;
    }, "required", "refuse">], "required", "refuse">;
    /** @internal Use definePayments. */
    constructor(component: ComponentApi, options: PaymentsOptions<C>, wiring: PaymentsWiring<Infer<C>>);
    get app(): string;
    /** The fee schedule for one processor and method, from this app's rates. */
    feeSchedule(processor: Processor, method: Method): FeeSchedule;
    /**
     * Where a card for a charge of this amount should be saved or paid: the processor with the lower fee
     * at this app's rates (Stripe on a tie), with both fees. Only a processor the deployment has keys
     * for is chosen.
     */
    cardProcessorFor(amountCents: number): CardProcessorChoice;
    /** @internal */
    fetch: Fetch;
    /** @internal */
    stripeKeys(): StripeKeys;
    /** @internal */
    paypalKeys(): PaypalKeys;
    /** @internal Throws (a ConvexError naming where) when the context doesn't fit the app's validator. */
    checkContext(context: unknown): void;
    /**
     * @internal The rate-limit keys of one public call: the host's own `limitKey` when it gives one, else
     * the signed-in user, else `fallbackKey` (e.g. the payer's email); and everyone together.
     */
    limits(ctx: {
        auth?: AuthLike;
    }, entry: string, fallbackKey: string | undefined, scale?: number, limitKey?: string): Promise<{
        key: string;
        max: number;
        windowMs: number;
        message: string;
    }[] | undefined>;
    /** @internal */
    takeLimits(ctx: RunMutationCtx & {
        auth?: AuthLike;
    }, entry: string, fallbackKey: string | undefined, scale?: number, limitKey?: string): Promise<void>;
    /** @internal The callbacks as function handles, stored on each checkout so the component can call them. */
    handles(): Promise<{
        onPaid: import("convex/server").FunctionHandle<"mutation", Paid<Infer<C>>, {
            refuse: string;
        } | null>;
        onFailed: import("convex/server").FunctionHandle<"mutation", Failed<Infer<C>>, unknown>;
        onRefunded: import("convex/server").FunctionHandle<"mutation", Refunded<Infer<C>>, unknown>;
        onRefundNeeded: import("convex/server").FunctionHandle<"mutation", RefundNeeded<Infer<C>>, unknown>;
        onDispute: import("convex/server").FunctionHandle<"mutation", Dispute<Infer<C>>, unknown>;
        onProcessing: import("convex/server").FunctionHandle<"mutation", Processing<Infer<C>>, unknown>;
    }>;
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
    withPaypal<R>(ctx: RunActionCtx, fn: (call: Awaited<ReturnType<Payments['paypalCall']>>) => Promise<R>): Promise<R>;
    /** @internal */
    url(path: string): string;
    /**
     * Starts a checkout from an action: makes the row, asks the processor for its checkout (keyed by
     * the row's id, so a retry gets the same one), and returns where to send the buyer, or with
     * `ui: 'embedded'` what the app's page needs to show it. Rate-limited per signed-in user (else per
     * payer email, or limitKey) and overall.
     */
    start(ctx: RunActionCtx, a: StartArgs<Infer<C>> & {
        ui: 'embedded';
    }): Promise<StartedEmbedded>;
    start(ctx: RunActionCtx, a: StartArgs<Infer<C>> & {
        ui?: 'redirect';
    }): Promise<StartedRedirect>;
    start(ctx: RunActionCtx, a: StartArgs<Infer<C>>): Promise<StartedRedirect | StartedEmbedded>;
    /** @internal See hosted.ts. */
    begin(ctx: RunActionCtx, a: StartArgs<Infer<C>>, save?: {
        scheduleId: string;
        schedulePeriod: string;
        stripeCustomerId?: string;
        paypalCustomerId?: string;
    }): Promise<StartedRedirect | StartedEmbedded>;
    /** @internal See hosted.ts. */
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
    /** @internal See hosted.ts. */
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
    /** @internal See hosted.ts. */
    saveForSchedule(ctx: RunActionCtx, checkoutId: string, from: {
        stripePaymentIntent?: string;
        paypalOrder?: PaypalOrder;
    }): Promise<void>;
    /** @internal See hosted.ts. */
    capturePaypal(ctx: RunActionCtx, checkoutId: string, orderId: string, by: 'buyer' | 'background'): Promise<'declined' | undefined>;
    /**
     * For the page the buyer comes back to (`token`: Stripe's session_id or payment_intent, or PayPal's
     * token). Returns the outcome at once if the checkout is already settled; otherwise asks the
     * processor and settles (capturing an approved PayPal order), so the page doesn't wait for a
     * webhook. Null: not ours. publicApi().completeReturn wraps this with a rate limit. PayPal's
     * buttons call it when the buyer approves; `declined` then means PayPal refused what the buyer
     * chose and the buttons should let them choose again (the checkout is still pending).
     */
    completeReturn(ctx: RunActionCtx, { processor, token }: {
        processor: Processor;
        token: string;
    }): Promise<{
        checkoutId: string;
        ref: Ref;
        purpose: string;
        status: CheckoutStatus;
        declined?: true;
    } | null>;
    /**
     * Closes a checkout the buyer started and won't pay, e.g. they pressed Edit on the app's page: the
     * Stripe session is expired at Stripe, a PayPal order is left to lapse (none of its money moves
     * until the library captures, which it won't for an abandoned checkout), and the checkout is
     * abandoned now instead of when it expires. The start it counted against the buyer's own rate limit
     * is given back (pass the `limitKey` start was given, if any). If it was paid meanwhile, it is
     * settled as paid instead. Returns how it stands; null: not this app's checkout.
     *
     * Only for a checkout id the buyer was given by start (the id is the buyer's secret; anyone holding
     * it can close the unpaid checkout, nothing more). publicApi().cancelCheckout wraps this.
     */
    cancel(ctx: RunActionCtx, checkoutId: string, o?: {
        limitKey?: string;
    }): Promise<{
        status: CheckoutStatus;
    } | null>;
    /**
     * Starts saving a card or bank account for `owner` (e.g. { type: 'user', id }): makes their Stripe
     * Customer if needed and a SetupIntent for charging later with nobody present (bank accounts
     * verified at once). Returns its client secret for Stripe's Payment Element. Rate-limited, so call
     * it when the payer submits the form (`<StripeSaveMethod createSetupIntent>`), never when it opens.
     */
    setupPaymentMethod(ctx: RunActionCtx, a: {
        owner: Ref;
        payer: Payer;
        stripeCustomerId?: string;
        methods?: readonly SavedMethodKind[];
        limitKey?: string;
    }): Promise<{
        clientSecret: string;
        stripeCustomerId: string;
    }>;
    /**
     * Starts saving a card or PayPal account in PayPal's vault for `owner`: a setup token for PayPal's
     * Card Fields (`PaypalCardFields`) or its PayPal button (`PaypalSaveButton`) in the browser, with the
     * REST app's client id. A card is checked when saved ($0 authorization; 3-D Secure only if the bank
     * asks). `description` is what a PayPal account holder agrees to. Rate-limited.
     */
    setupPaypalMethod(ctx: RunActionCtx, a: {
        owner: Ref;
        payer: Payer;
        kind: 'card' | 'paypal';
        description?: string; /** For a schedule: a PayPal account agrees to recurring charges. */
        recurring?: boolean;
        limitKey?: string;
    }): Promise<{
        setupTokenId: string;
        clientId: string;
    }>;
    /**
     * Saves what the buyer approved a setup token with (the browser component's onSaved gives its id),
     * refusing a token made for someone else or a card whose check failed. Returns the saved method,
     * charged later with chargeSaved like a Stripe one. Rate-limited.
     */
    savePaypalMethod(ctx: RunActionCtx, a: {
        owner: Ref;
        setupTokenId: string;
        payerEmail?: string; /** As given to setupPaypalMethod. */
        recurring?: boolean;
        limitKey?: string;
    }): Promise<SavedMethod>;
    /** The owner's saved cards, bank accounts and PayPal accounts at both processors, newest first, each with whether a charge of it was declined. Rate-limited. */
    savedMethods(ctx: RunActionCtx, a: {
        owner: Ref;
        stripeCustomerId?: string;
        limitKey?: string;
    }): Promise<SavedMethod[]>;
    /**
     * Checks that a payment method id (from the browser) is one saved for this owner, at Stripe or in
     * PayPal's vault, and returns it; anything else throws, so nobody can pay with a made-up or someone
     * else's method. Rate-limited.
     */
    verifyMethodOwner(ctx: RunActionCtx, a: {
        owner: Ref;
        paymentMethodId: string;
        stripeCustomerId?: string;
        limitKey?: string;
    }): Promise<VerifiedMethod>;
    /**
     * The owner removes one of their saved methods (checked to be theirs): deleted from PayPal's vault
     * or detached from their Stripe Customer, and never offered or charged again. Whether it may go
     * (e.g. a bid still relies on it) is the app's to check first. Rate-limited.
     */
    removeSavedMethod(ctx: RunActionCtx, a: {
        owner: Ref;
        paymentMethodId: string;
        stripeCustomerId?: string;
        limitKey?: string;
    }): Promise<void>;
    /**
     * Charges a saved method with nobody present, from a mutation or action: records the checkout and
     * queues the charge (payments.worker().charge). A card that needs the buyer to authenticate is
     * refused rather than left waiting. Outcomes come back through the callbacks: paid; processing then
     * paid or failed for a bank account; failed (declined: true) when the bank says no. A charge whose
     * outcome is unknown is tried again a few times under the same key, then left for a person as a
     * charge_unknown issue. Same idempotencyKey, same checkout. Returns the checkout id.
     */
    chargeSaved(ctx: SchedulerCtx, a: ChargeArgs<Infer<C>>): Promise<string>;
    /** @internal chargeSaved, and a schedule's charge (tagged with the schedule and the period it pays). */
    chargeOffSession(ctx: SchedulerCtx, a: ChargeArgs<Infer<C>>, schedule?: {
        scheduleId: string;
        schedulePeriod: string;
    }): Promise<string>;
    /** @internal Which processor charges a saved method: PayPal's must be the owner's, recorded here; Stripe's need the owner's Customer. */
    chargeTarget(ctx: RunQueryCtx, a: {
        owner: Ref;
        paymentMethodId: string;
        stripeCustomerId?: string;
    }): Promise<{
        processor: Processor;
        method: Method;
        stripeCustomerId?: string;
    }>;
    /** @internal Makes (or retries) an off-session charge; payments.worker().charge runs this. */
    charge(ctx: RunActionCtx & {
        scheduler: Scheduler;
    }, checkoutId: string, manual?: boolean): Promise<void>;
    /**
     * For the buyer to pay on the app's page after an off-session charge failed: a PaymentIntent
     * (card or bank account, theirs to choose in the Payment Element) for the same amount, its outcome
     * coming back through the same callbacks with kind 'onSession'. One that is still waiting is
     * reused, so two tabs can't each take a payment; one already on its way is refused. Rate-limited, so
     * call it when the buyer presses Pay (`<StripeRetryPayment createPayment>`), not when the page opens.
     */
    retryOnSession(ctx: RunActionCtx, a: {
        checkoutId: string;
        expiresAt?: number;
        limitKey?: string;
    }): Promise<{
        checkoutId: string;
        clientSecret: string;
    }>;
    /**
     * The same, paid with PayPal's buttons on the app's page (`PaypalButtons` with the `embedded` it
     * returns): a PayPal account or a card. Only one retry is open at a time, so asking for PayPal
     * closes an unpaid Stripe one and the other way round. `returnPath` is where the buttons send the
     * buyer once paid (with PayPal's token, for completeReturn). Rate-limited.
     */
    retryWithPaypal(ctx: RunActionCtx, a: {
        checkoutId: string;
        returnPath: string;
        expiresAt?: number;
        limitKey?: string;
    }): Promise<{
        checkoutId: string;
        embedded: Extract<EmbeddedPayment, {
            processor: 'paypal';
        }>;
    }>;
    /**
     * Charges a saved method every month: the first charge now (or at firstChargeAt), then on the
     * anchor day, each an off-session checkout keyed `schedule-<id>-<period>` with the usual callbacks
     * plus scheduleCharged / scheduleFailed. Refusals are retried (retryDays, default 3, 5 and 7 days
     * after the first), then the schedule lapses; hard declines lapse it at once. From a mutation or
     * action. Returns the schedule id and the first charge's checkout id when it was made now.
     */
    startSchedule(ctx: SchedulerCtx, a: StartScheduleArgs<Infer<C>>): Promise<{
        scheduleId: string;
        checkoutId: string | null;
    }>;
    /**
     * A schedule for a new payer, its first payment saving the method: Stripe's embedded Checkout
     * (card or bank account, saved with setup_future_usage; Checkout tells the payer, and shows a
     * bank account's mandate) or PayPal (a PayPal account agreeing to recurring charges with
     * PaypalButtons, or a card in PaypalCardPayment, saved with vault-with-purchase). The app picks the
     * processor (e.g. the cheaper for the monthly amount). The schedule starts when that payment is
     * paid (or on its way, for a bank account); if it never is, scheduleChanged says not_started.
     * Rate-limited like start.
     */
    startScheduleCheckout(ctx: RunActionCtx, a: StartScheduleCheckoutArgs<Infer<C>>): Promise<(StartedRedirect | StartedEmbedded) & {
        scheduleId: string;
    }>;
    /**
     * Changes a schedule: the amount (from the next charge), the saved method (one of the owner's,
     * checked as for chargeSaved), the day of the month, the description. A new method on a schedule
     * being retried charges the refused period at once; on a lapsed one it starts again.
     */
    updateSchedule(ctx: RunMutationCtx, a: {
        scheduleId: string;
        amountCents?: number;
        paymentMethodId?: string;
        stripeCustomerId?: string;
        anchorDay?: number;
        description?: string;
        by?: string;
    }): Promise<ScheduleView>;
    /** Skips charges until `until` (ms); the first charge date after that charges again, by itself. */
    pauseSchedule(ctx: RunMutationCtx, a: {
        scheduleId: string;
        until: number;
        by?: string;
    }): Promise<ScheduleView>;
    /** A paused or lapsed schedule charges again, from `at` (default now) on its next charge date. */
    resumeSchedule(ctx: RunMutationCtx, a: {
        scheduleId: string;
        at?: number;
        by?: string;
    }): Promise<ScheduleView>;
    /** Ends a schedule for good (a charge already on its way still settles). */
    cancelSchedule(ctx: RunMutationCtx, a: {
        scheduleId: string;
        reason: string;
        by?: string;
    }): Promise<ScheduleView>;
    /** An owner's schedules, newest first, ended ones included. */
    schedulesFor(ctx: RunQueryCtx, owner: Ref): Promise<ScheduleView[]>;
    /** The schedules for one thing in the app, newest first. */
    schedulesForRef(ctx: RunQueryCtx, ref: Ref): Promise<ScheduleView[]>;
    /** One schedule, or null (also for another app's). */
    getSchedule(ctx: RunQueryCtx, scheduleId: string): Promise<{
        amountCents: number;
        anchorDay: number;
        app: string;
        context: any;
        createdAt: number;
        description: string;
        endReason: string | null;
        endedAt: number | null;
        endedBy: string | null;
        failures: number;
        hourUTC: number;
        id: string;
        interval: "month";
        lastCheckoutId: string | null;
        lastError: string | null;
        lastPaidPeriod: string | null;
        method: "card" | "ach" | "paypal";
        nextChargeAt: number | null;
        owner: {
            id: string;
            type: string;
        };
        pausedUntil: number | null;
        payer: {
            email: string;
            name?: string;
        };
        paymentMethodId: string | null;
        period: string;
        processor: "stripe" | "paypal";
        purpose: string;
        ref: {
            id: string;
            type: string;
        };
        status: "starting" | "active" | "paused" | "past_due" | "lapsed" | "cancelled";
        updatedAt: number;
    } | null>;
    /** @internal The hourly run; payments.worker().schedules runs this. */
    runSchedules(ctx: SchedulerCtx, o?: {
        scheduleId?: string;
    }): Promise<{
        charged: number;
        errors: number;
    }>;
    /** One checkout, for the app's queries (e.g. a thank-you page). */
    status(ctx: RunQueryCtx, checkoutId: string): Promise<CheckoutView>;
    get(ctx: RunQueryCtx, checkoutId: string): Promise<CheckoutView>;
    /** The checkouts for one thing in the app, newest first. */
    forRef(ctx: RunQueryCtx, ref: Ref): Promise<{
        amountCents: number;
        app: string;
        cancelUrl: string;
        chargeAttempts: number;
        chargeKey: string | null;
        context: any;
        createdAt: number;
        declineCode: string | null;
        declineKind: "hard" | "soft" | "insufficient_funds" | null;
        description: string;
        disputed: boolean;
        expiresAt: number;
        id: string;
        kind: "hosted" | "offSession" | "onSession";
        lastError: string | null;
        lastTriedAt: number | null;
        method: "card" | "ach" | "paypal";
        paidCents: number | null;
        payer: {
            email: string;
            name?: string;
        };
        paymentMethodId: string | null;
        paymentRef: string | null;
        paypalDeclinedAt: number | null;
        processor: "stripe" | "paypal";
        processorCheckoutId: string | null;
        processorFeeCents: number | null;
        purpose: string;
        ref: {
            id: string;
            type: string;
        };
        refundedCents: number;
        retryOf: string | null;
        returnUrl: string;
        scheduleId: string | null;
        schedulePeriod: string | null;
        settledAt: number | null;
        status: "created" | "pending" | "processing" | "paid" | "failed" | "abandoned" | "refund_needed";
        stripeCustomerId: string | null;
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
            chargeAttempts: number;
            chargeKey: string | null;
            context: any;
            createdAt: number;
            declineCode: string | null;
            declineKind: "hard" | "soft" | "insufficient_funds" | null;
            description: string;
            disputed: boolean;
            expiresAt: number;
            id: string;
            kind: "hosted" | "offSession" | "onSession";
            lastError: string | null;
            lastTriedAt: number | null;
            method: "card" | "ach" | "paypal";
            paidCents: number | null;
            payer: {
                email: string;
                name?: string;
            };
            paymentMethodId: string | null;
            paymentRef: string | null;
            paypalDeclinedAt: number | null;
            processor: "stripe" | "paypal";
            processorCheckoutId: string | null;
            processorFeeCents: number | null;
            purpose: string;
            ref: {
                id: string;
                type: string;
            };
            refundedCents: number;
            retryOf: string | null;
            returnUrl: string;
            scheduleId: string | null;
            schedulePeriod: string | null;
            settledAt: number | null;
            status: "created" | "pending" | "processing" | "paid" | "failed" | "abandoned" | "refund_needed";
            stripeCustomerId: string | null;
        }>;
        pageStatus?: "SplitRecommended" | "SplitRequired" | null;
        splitCursor?: string | null;
    }>;
    /** Paid checkouts with something left to refund, newest first, paginated (an index read, not a scan). */
    refundable(ctx: RunQueryCtx, o: {
        ref?: Ref;
        paginationOpts: PaginationOptions;
    }): Promise<{
        continueCursor: string;
        isDone: boolean;
        page: Array<{
            amountCents: number;
            app: string;
            cancelUrl: string;
            chargeAttempts: number;
            chargeKey: string | null;
            context: any;
            createdAt: number;
            declineCode: string | null;
            declineKind: "hard" | "soft" | "insufficient_funds" | null;
            description: string;
            disputed: boolean;
            expiresAt: number;
            id: string;
            kind: "hosted" | "offSession" | "onSession";
            lastError: string | null;
            lastTriedAt: number | null;
            method: "card" | "ach" | "paypal";
            paidCents: number | null;
            payer: {
                email: string;
                name?: string;
            };
            paymentMethodId: string | null;
            paymentRef: string | null;
            paypalDeclinedAt: number | null;
            processor: "stripe" | "paypal";
            processorCheckoutId: string | null;
            processorFeeCents: number | null;
            purpose: string;
            ref: {
                id: string;
                type: string;
            };
            refundedCents: number;
            retryOf: string | null;
            returnUrl: string;
            scheduleId: string | null;
            schedulePeriod: string | null;
            settledAt: number | null;
            status: "created" | "pending" | "processing" | "paid" | "failed" | "abandoned" | "refund_needed";
            stripeCustomerId: string | null;
        }>;
        pageStatus?: "SplitRecommended" | "SplitRequired" | null;
        splitCursor?: string | null;
    }>;
    /** Stripe's webhook: verify, de-duplicate, act. 400 for a bad signature, 500 for a real failure (Stripe retries), 200 otherwise. */
    handleStripeWebhook(ctx: RunActionCtx, request: Request, onUnhandled?: UnhandledStripeEvent): Promise<Response>;
    handlePaypalWebhook(ctx: RunActionCtx, request: Request): Promise<Response>;
    /**
     * Adds the webhook routes to the app's router, each only when its processor's keys exist. Runs the
     * keys' start-up checks first (fromEnv): a live deployment set up wrongly fails to load. Events the
     * library doesn't know, or for objects that aren't this app's, go to onUnhandledStripeEvent.
     */
    registerRoutes(http: HttpRouter, o?: {
        stripePath?: string;
        paypalPath?: string;
        onUnhandledStripeEvent?: UnhandledStripeEvent;
    }): void;
    /**
     * Asks for a refund (the whole remaining amount unless given). Who may is the app's check; `by` is
     * recorded. `hostData` (at most 10 strings of at most 200 characters, e.g. { relist: 'yes' }; keys
     * non-empty printable ASCII not starting with `$`) is kept on the refund and passed to on.refunded
     * when it is done. Returns the refund id.
     */
    requestRefund(ctx: RunMutationCtx, a: {
        checkoutId: string;
        amountCents?: number;
        reason: string;
        by?: string;
        hostData?: Record<string, string>;
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
    /** @internal See refunds.ts. */
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
        hostData: Record<string, string> | null;
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
        hostData: Record<string, string> | null;
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
        hostData: Record<string, string> | null;
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
     * Every 10 minutes (registerCrons). PayPal checkouts pending over 5 minutes: captured if the buyer
     * approved (they may have closed the tab: fix a), abandoned once expired. Expired Stripe sessions
     * and on-session payments: settled if paid, else ended at Stripe and abandoned. Off-session charges
     * whose outcome never came back: asked again. Refunds left sending over 10 minutes: asked about
     * (or sent again, safely, under the same key).
     */
    sweep(ctx: RunActionCtx & {
        scheduler: Scheduler;
    }): Promise<{
        checked: number;
        settled: number;
        abandoned: number;
        refunds: number;
        errors: number;
    }>;
    /**
     * Nightly (registerCrons): compares the last `days` of checkouts, saved-method charges and refunds
     * with each processor and opens an issue for each difference (resolving ones that went away).
     * Refunds found at the processor that the ledger lacks are recorded. PayPal's Transaction Search,
     * for captures tagged with this app that the component never heard of, is skipped (logged once a
     * day) when PayPal refuses it.
     */
    reconcile(ctx: RunActionCtx, o?: {
        days?: number;
    }): Promise<ReconcileResult>;
    /**
     * The PayPal account's history for one email, newest first: every transaction in the range whose
     * other party is that address (payments in, refunds and payments out), not only this library's.
     * Needs Transaction Search on the REST app; PayPal keeps three years, and is up to three hours late.
     */
    paypalHistory(ctx: RunActionCtx, a: PaypalHistoryArgs): Promise<PaypalHistory>;
    /** Nightly: deletes what isn't kept (see the component's maintenance.ts), a batch at a time; call again while `more`. */
    cleanup(ctx: RunMutationCtx): Promise<{
        deleted: number;
        more: boolean;
    }>;
    /** Nightly: hands the issues nobody was told about yet to the app's on.issues, then marks them told. Returns how many. */
    issuesDigest(ctx: RunMutationCtx): Promise<number>;
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
            kind: "missing_here" | "missing_there" | "amount_differs" | "status_differs" | "dispute" | "callback_failed" | "charge_unknown";
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
    /** The internal functions for the crons and scheduled charges: `export const { sweep, reconcile, cleanup, issuesDigest, charge } = payments.worker()`. */
    worker(): {
        sweep: import("convex/server").RegisteredAction<"internal", {}, Promise<null>>;
        reconcile: import("convex/server").RegisteredAction<"internal", {
            days?: number | undefined;
        }, Promise<null>>;
        cleanup: import("convex/server").RegisteredMutation<"internal", {}, Promise<{
            deleted: number;
            more: boolean;
        }>>;
        issuesDigest: import("convex/server").RegisteredMutation<"internal", {}, Promise<number>>;
        schedules: import("convex/server").RegisteredAction<"internal", {
            scheduleId?: string | undefined;
        }, Promise<null>>;
        charge: import("convex/server").RegisteredAction<"internal", {
            manual?: boolean | undefined;
            checkoutId: string;
        }, Promise<null>>;
    };
    /**
     * Public queries, mutations and actions for an admin page (refunds, issues, charges with an unknown
     * outcome), each behind authorize.admin: `export const admin = payments.adminApi()`.
     */
    adminApi(o?: AdminApiOptions): {
        access: import("convex/server").RegisteredQuery<"public", {
            auth?: any;
        }, Promise<{
            level: "admin" | "request";
            name: string;
            skipApproval: boolean;
        } | null>>;
        openRefunds: import("convex/server").RegisteredQuery<"public", {
            auth?: any;
        }, Promise<{
            checkout: {
                id: string;
                ref: {
                    id: string;
                    type: string;
                };
                purpose: string;
                kind: "hosted" | "offSession" | "onSession";
                description: string;
                processor: "stripe" | "paypal";
                method: "paypal" | "card" | "ach";
                payer: {
                    email: string;
                    name?: string;
                };
                status: "processing" | "paid" | "pending" | "failed" | "created" | "abandoned" | "refund_needed";
                paymentRef: string | null;
                amountCents: number;
                paidCents: number | null;
                refundedCents: number;
                createdAt: number;
            } | null;
            amountCents: number;
            approvedBy: string | null;
            attempts: number;
            checkoutId: string;
            createdAt: number;
            error: string | null;
            hostData: Record<string, string> | null;
            id: string;
            note: string | null;
            origin: "requested" | "needed" | "external";
            processorRefundId: string | null;
            reason: string;
            requestedBy: string | null;
            sentAt: number | null;
            status: "requested" | "approved" | "sending" | "sent" | "failed" | "manual" | "dismissed";
            updatedAt: number;
        }[]>>;
        refundable: import("convex/server").RegisteredQuery<"public", {
            ref?: {
                id: string;
                type: string;
            } | undefined;
            auth?: any;
            paginationOpts: {
                id?: number;
                endCursor?: string | null;
                maximumRowsRead?: number;
                maximumBytesRead?: number;
                numItems: number;
                cursor: string | null;
            };
        }, Promise<{
            page: {
                id: string;
                ref: {
                    id: string;
                    type: string;
                };
                purpose: string;
                kind: "hosted" | "offSession" | "onSession";
                description: string;
                processor: "stripe" | "paypal";
                method: "paypal" | "card" | "ach";
                payer: {
                    email: string;
                    name?: string;
                };
                status: "processing" | "paid" | "pending" | "failed" | "created" | "abandoned" | "refund_needed";
                paymentRef: string | null;
                amountCents: number;
                paidCents: number | null;
                refundedCents: number;
                createdAt: number;
            }[];
            continueCursor: string;
            isDone: boolean;
            pageStatus?: "SplitRecommended" | "SplitRequired" | null;
            splitCursor?: string | null;
        }>>;
        issues: import("convex/server").RegisteredQuery<"public", {
            open?: boolean | undefined;
            auth?: any;
            paginationOpts: {
                id?: number;
                endCursor?: string | null;
                maximumRowsRead?: number;
                maximumBytesRead?: number;
                numItems: number;
                cursor: string | null;
            };
        }, Promise<{
            continueCursor: string;
            isDone: boolean;
            page: Array<{
                checkoutId: string | null;
                detail: string;
                id: string;
                key: string;
                kind: "missing_here" | "missing_there" | "amount_differs" | "status_differs" | "dispute" | "callback_failed" | "charge_unknown";
                openedAt: number;
                paymentRef: string | null;
                processor: "stripe" | "paypal";
                reportedAt: number | null;
                resolvedAt: number | null;
            }>;
            pageStatus?: "SplitRecommended" | "SplitRequired" | null;
            splitCursor?: string | null;
        }>>;
        openCount: import("convex/server").RegisteredQuery<"public", {
            auth?: any;
        }, Promise<number>>;
        checkout: import("convex/server").RegisteredQuery<"public", {
            auth?: any;
            checkoutId: string;
        }, Promise<{
            checkout: {
                id: string;
                ref: {
                    id: string;
                    type: string;
                };
                purpose: string;
                kind: "hosted" | "offSession" | "onSession";
                description: string;
                processor: "stripe" | "paypal";
                method: "paypal" | "card" | "ach";
                payer: {
                    email: string;
                    name?: string;
                };
                status: "processing" | "paid" | "pending" | "failed" | "created" | "abandoned" | "refund_needed";
                paymentRef: string | null;
                amountCents: number;
                paidCents: number | null;
                refundedCents: number;
                createdAt: number;
            };
            lastError: string | null;
            refunds: {
                amountCents: number;
                approvedBy: string | null;
                attempts: number;
                checkoutId: string;
                createdAt: number;
                error: string | null;
                hostData: Record<string, string> | null;
                id: string;
                note: string | null;
                origin: "requested" | "needed" | "external";
                processorRefundId: string | null;
                reason: string;
                requestedBy: string | null;
                sentAt: number | null;
                status: "requested" | "approved" | "sending" | "sent" | "failed" | "manual" | "dismissed";
                updatedAt: number;
            }[];
        } | null>>;
        requestRefund: import("convex/server").RegisteredMutation<"public", {
            amountCents?: number | undefined;
            hostData?: Record<string, string> | undefined;
            auth?: any;
            checkoutId: string;
            reason: string;
        }, Promise<string>>;
        approveRefund: import("convex/server").RegisteredMutation<"public", {
            auth?: any;
            refundId: string;
        }, Promise<null>>;
        sendRefund: import("convex/server").RegisteredAction<"public", {
            auth?: any;
            refundId: string;
        }, Promise<{
            status: string;
            error: string | null;
        } | null>>;
        markRefundedManually: import("convex/server").RegisteredMutation<"public", {
            note?: string | undefined;
            auth?: any;
            refundId: string;
        }, Promise<null>>;
        dismissRefund: import("convex/server").RegisteredMutation<"public", {
            note?: string | undefined;
            auth?: any;
            refundId: string;
        }, Promise<null>>;
        resolveIssue: import("convex/server").RegisteredMutation<"public", {
            auth?: any;
            issueId: string;
        }, Promise<null>>;
        paypalHistory: import("convex/server").RegisteredAction<"public", {
            auth?: any;
            email: string;
            start: number;
            end: number;
        }, Promise<PaypalHistory>>;
        retryCharge: import("convex/server").RegisteredMutation<"public", {
            auth?: any;
            checkoutId: string;
        }, Promise<null>>;
        giveUpCharge: import("convex/server").RegisteredAction<"public", {
            auth?: any;
            checkoutId: string;
        }, Promise<{
            status: string;
        }>>;
    };
    /** The buyer-facing functions, rate-limited: `export const { completeReturn } = payments.publicApi()`. */
    publicApi(): {
        completeReturn: import("convex/server").RegisteredAction<"public", {
            token: string;
            processor: "stripe" | "paypal";
        }, Promise<{
            status: string;
            purpose: string;
            ref: {
                type: string;
                id: string;
            };
            declined?: true;
        } | null>>;
        cancelCheckout: import("convex/server").RegisteredAction<"public", {
            checkoutId: string;
        }, Promise<{
            status: string;
        } | null>>;
    };
    /**
     * The library's crons, on the app's cron table: sweep every 10 minutes; reconcile, the issues digest
     * and cleanup nightly (UTC hours; reconcile first, the digest half an hour after).
     */
    registerCrons(crons: Crons, o?: {
        reconcileHourUTC?: number;
        cleanupHourUTC?: number;
    }): void;
}
/** For the validators of the app's worker functions. */
export declare const workerArgs: {
    charge: {
        checkoutId: import("convex/values").VString<string, "required">;
        manual: import("convex/values").VBoolean<boolean | undefined, "optional">;
    };
    schedules: {
        scheduleId: import("convex/values").VString<string | undefined, "optional">;
    };
};
//# sourceMappingURL=index.d.ts.map