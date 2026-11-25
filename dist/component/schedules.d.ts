import { type Infer } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel.js';
import { type MutationCtx } from './_generated/server.js';
import { type DeclineKind } from '../core/declines.js';
export declare const scheduleView: import("convex/values").VObject<{
    method: "paypal" | "card" | "ach";
    id: string;
    status: "starting" | "active" | "paused" | "past_due" | "lapsed" | "cancelled";
    description: string;
    app: string;
    owner: {
        id: string;
        type: string;
    };
    ref: {
        id: string;
        type: string;
    };
    amountCents: number;
    context: any;
    payer: {
        name?: string | undefined;
        email: string;
    };
    paymentMethodId: string | null;
    processor: "stripe" | "paypal";
    purpose: string;
    period: string;
    anchorDay: number;
    hourUTC: number;
    createdAt: number;
    nextChargeAt: number | null;
    lastError: string | null;
    updatedAt: number;
    interval: "month";
    lastPaidPeriod: string | null;
    pausedUntil: number | null;
    failures: number;
    lastCheckoutId: string | null;
    endReason: string | null;
    endedBy: string | null;
    endedAt: number | null;
}, {
    id: import("convex/values").VString<string, "required">;
    app: import("convex/values").VString<string, "required">;
    owner: import("convex/values").VObject<{
        id: string;
        type: string;
    }, {
        type: import("convex/values").VString<string, "required">;
        id: import("convex/values").VString<string, "required">;
    }, "required", "id" | "type">;
    ref: import("convex/values").VObject<{
        id: string;
        type: string;
    }, {
        type: import("convex/values").VString<string, "required">;
        id: import("convex/values").VString<string, "required">;
    }, "required", "id" | "type">;
    purpose: import("convex/values").VString<string, "required">;
    description: import("convex/values").VString<string, "required">;
    payer: import("convex/values").VObject<{
        name?: string | undefined;
        email: string;
    }, {
        name: import("convex/values").VString<string | undefined, "optional">;
        email: import("convex/values").VString<string, "required">;
    }, "required", "name" | "email">;
    processor: import("convex/values").VUnion<"stripe" | "paypal", [import("convex/values").VLiteral<"stripe", "required">, import("convex/values").VLiteral<"paypal", "required">], "required", never>;
    method: import("convex/values").VUnion<"paypal" | "card" | "ach", [import("convex/values").VLiteral<"card", "required">, import("convex/values").VLiteral<"ach", "required">, import("convex/values").VLiteral<"paypal", "required">], "required", never>;
    paymentMethodId: import("convex/values").VUnion<string | null, [import("convex/values").VString<string, "required">, import("convex/values").VNull<null, "required">], "required", never>;
    amountCents: import("convex/values").VFloat64<number, "required">;
    interval: import("convex/values").VLiteral<"month", "required">;
    anchorDay: import("convex/values").VFloat64<number, "required">;
    hourUTC: import("convex/values").VFloat64<number, "required">;
    status: import("convex/values").VUnion<"starting" | "active" | "paused" | "past_due" | "lapsed" | "cancelled", [import("convex/values").VLiteral<"starting", "required">, import("convex/values").VLiteral<"active", "required">, import("convex/values").VLiteral<"paused", "required">, import("convex/values").VLiteral<"past_due", "required">, import("convex/values").VLiteral<"lapsed", "required">, import("convex/values").VLiteral<"cancelled", "required">], "required", never>;
    /** When the next charge (or retry, or the end of a pause) is due; null once lapsed or cancelled, or while starting. */
    nextChargeAt: import("convex/values").VUnion<number | null, [import("convex/values").VFloat64<number, "required">, import("convex/values").VNull<null, "required">], "required", never>;
    period: import("convex/values").VString<string, "required">;
    lastPaidPeriod: import("convex/values").VUnion<string | null, [import("convex/values").VString<string, "required">, import("convex/values").VNull<null, "required">], "required", never>;
    pausedUntil: import("convex/values").VUnion<number | null, [import("convex/values").VFloat64<number, "required">, import("convex/values").VNull<null, "required">], "required", never>;
    failures: import("convex/values").VFloat64<number, "required">;
    lastCheckoutId: import("convex/values").VUnion<string | null, [import("convex/values").VString<string, "required">, import("convex/values").VNull<null, "required">], "required", never>;
    lastError: import("convex/values").VUnion<string | null, [import("convex/values").VString<string, "required">, import("convex/values").VNull<null, "required">], "required", never>;
    endReason: import("convex/values").VUnion<string | null, [import("convex/values").VString<string, "required">, import("convex/values").VNull<null, "required">], "required", never>;
    endedBy: import("convex/values").VUnion<string | null, [import("convex/values").VString<string, "required">, import("convex/values").VNull<null, "required">], "required", never>;
    endedAt: import("convex/values").VUnion<number | null, [import("convex/values").VFloat64<number, "required">, import("convex/values").VNull<null, "required">], "required", never>;
    context: import("convex/values").VAny<any, "required", string>;
    createdAt: import("convex/values").VFloat64<number, "required">;
    updatedAt: import("convex/values").VFloat64<number, "required">;
}, "required", "method" | "id" | "status" | "description" | "app" | "owner" | "ref" | "amountCents" | "context" | "payer" | "paymentMethodId" | "processor" | "purpose" | "period" | "anchorDay" | "hourUTC" | "createdAt" | "nextChargeAt" | "lastError" | "updatedAt" | "ref.id" | "ref.type" | `context.${string}` | "payer.name" | "payer.email" | "interval" | "lastPaidPeriod" | "pausedUntil" | "failures" | "lastCheckoutId" | "endReason" | "endedBy" | "endedAt" | "owner.id" | "owner.type">;
export type ScheduleView = Infer<typeof scheduleView>;
export declare function viewSchedule(s: Doc<'schedules'>): ScheduleView;
export type ScheduleChange = 'started' | 'not_started' | 'amount' | 'method' | 'anchor' | 'paused' | 'resumed' | 'cancelled';
export declare const create: import("convex/server").RegisteredMutation<"public", {
    context?: any;
    paymentMethodId?: string | undefined;
    method: "paypal" | "card" | "ach";
    description: string;
    app: string;
    owner: {
        id: string;
        type: string;
    };
    now: number;
    ref: {
        id: string;
        type: string;
    };
    amountCents: number;
    callbacks: {
        onFailed?: string | undefined;
        onCharged?: string | undefined;
        onChanged?: string | undefined;
    };
    payer: {
        name?: string | undefined;
        email: string;
    };
    processor: "stripe" | "paypal";
    purpose: string;
    anchorDay: number;
    firstChargeAt: number;
    hourUTC: number;
    retryDays: number[];
}, Promise<import("convex/values").GenericId<"schedules">>>;
/** A starting schedule whose first checkout couldn't even be made (the app's call threw): gone, as if never asked for. */
export declare const discard: import("convex/server").RegisteredMutation<"public", {
    id: string;
}, Promise<null>>;
export declare const get: import("convex/server").RegisteredQuery<"public", {
    id: string;
}, Promise<{
    method: "paypal" | "card" | "ach";
    id: string;
    status: "starting" | "active" | "paused" | "past_due" | "lapsed" | "cancelled";
    description: string;
    app: string;
    owner: {
        id: string;
        type: string;
    };
    ref: {
        id: string;
        type: string;
    };
    amountCents: number;
    context: any;
    payer: {
        name?: string | undefined;
        email: string;
    };
    paymentMethodId: string | null;
    processor: "stripe" | "paypal";
    purpose: string;
    period: string;
    anchorDay: number;
    hourUTC: number;
    createdAt: number;
    nextChargeAt: number | null;
    lastError: string | null;
    updatedAt: number;
    interval: "month";
    lastPaidPeriod: string | null;
    pausedUntil: number | null;
    failures: number;
    lastCheckoutId: string | null;
    endReason: string | null;
    endedBy: string | null;
    endedAt: number | null;
} | null>>;
/** An owner's schedules in one app, newest first (at most 50), ended ones included. */
export declare const forOwner: import("convex/server").RegisteredQuery<"public", {
    app: string;
    owner: {
        id: string;
        type: string;
    };
}, Promise<{
    method: "paypal" | "card" | "ach";
    id: string;
    status: "starting" | "active" | "paused" | "past_due" | "lapsed" | "cancelled";
    description: string;
    app: string;
    owner: {
        id: string;
        type: string;
    };
    ref: {
        id: string;
        type: string;
    };
    amountCents: number;
    context: any;
    payer: {
        name?: string | undefined;
        email: string;
    };
    paymentMethodId: string | null;
    processor: "stripe" | "paypal";
    purpose: string;
    period: string;
    anchorDay: number;
    hourUTC: number;
    createdAt: number;
    nextChargeAt: number | null;
    lastError: string | null;
    updatedAt: number;
    interval: "month";
    lastPaidPeriod: string | null;
    pausedUntil: number | null;
    failures: number;
    lastCheckoutId: string | null;
    endReason: string | null;
    endedBy: string | null;
    endedAt: number | null;
}[]>>;
export declare const forRef: import("convex/server").RegisteredQuery<"public", {
    ref: {
        id: string;
        type: string;
    };
}, Promise<{
    method: "paypal" | "card" | "ach";
    id: string;
    status: "starting" | "active" | "paused" | "past_due" | "lapsed" | "cancelled";
    description: string;
    app: string;
    owner: {
        id: string;
        type: string;
    };
    ref: {
        id: string;
        type: string;
    };
    amountCents: number;
    context: any;
    payer: {
        name?: string | undefined;
        email: string;
    };
    paymentMethodId: string | null;
    processor: "stripe" | "paypal";
    purpose: string;
    period: string;
    anchorDay: number;
    hourUTC: number;
    createdAt: number;
    nextChargeAt: number | null;
    lastError: string | null;
    updatedAt: number;
    interval: "month";
    lastPaidPeriod: string | null;
    pausedUntil: number | null;
    failures: number;
    lastCheckoutId: string | null;
    endReason: string | null;
    endedBy: string | null;
    endedAt: number | null;
}[]>>;
/** One app's schedules the worker should act on now: due charges and retries, and pauses that have ended. */
export declare const due: import("convex/server").RegisteredQuery<"public", {
    app: string;
    limit: number;
    now: number;
}, Promise<{
    id: string;
    app: string;
}[]>>;
/** Schedules still relying on a saved method (not cancelled), so it isn't removed from under them. */
export declare const usingMethod: import("convex/server").RegisteredQuery<"public", {
    paymentMethodId: string;
}, Promise<number>>;
/**
 * The worker asks whether a schedule's charge is due, and gets what to charge, keyed by schedule and
 * period (and attempt, for retries: a refused try charged nothing). A pause that has ended resumes
 * it; a charge still open (no answer yet) holds it back an hour; a method that is gone fails the
 * period as a hard decline, without a charge. A schedule waiting for a PayPal token saved after its
 * first payment gets check_vault (read that order again) until the wait is over, then fails as
 * METHOD_NOT_SAVED, without a charge.
 */
export declare const claim: import("convex/server").RegisteredMutation<"public", {
    id: string;
    app: string;
    now: number;
}, Promise<{
    action: "wait";
    reason: string;
} | {
    action: "check_vault";
    orderId: string;
    key?: undefined;
    period?: undefined;
    amountCents?: undefined;
    paymentMethodId?: undefined;
    owner?: undefined;
    ref?: undefined;
    purpose?: undefined;
    description?: undefined;
    payer?: undefined;
    context?: undefined;
} | {
    action: "charge";
    key: string;
    period: string;
    amountCents: number;
    paymentMethodId: string;
    owner: {
        id: string;
        type: string;
    };
    ref: {
        id: string;
        type: string;
    };
    purpose: string;
    description: string;
    payer: {
        name?: string | undefined;
        email: string;
    };
    context: any;
    orderId?: undefined;
}>>;
/** A checkout was made for a schedule (checkouts.create): it is the period's latest try. */
export declare function noteScheduleCheckout(ctx: MutationCtx, scheduleId: Id<'schedules'>, checkoutId: Id<'checkouts'>, period: string, offSession: boolean, now: number): Promise<void>;
type CheckoutDoc = Doc<'checkouts'>;
export declare function scheduleProcessing(ctx: MutationCtx, c: CheckoutDoc, now: number): Promise<void>;
export declare function schedulePaid(ctx: MutationCtx, c: CheckoutDoc, paid: {
    paidCents: number;
    paymentRef: string;
}, now: number): Promise<void>;
/**
 * A schedule's charge was refused, bounced or given up. The current period is retried or lapses. A
 * bank debit that bounces after the schedule moved on takes it back to that period, unless the next
 * period was already tried; then the host is only told.
 */
export declare function scheduleFailed(ctx: MutationCtx, c: CheckoutDoc, f: {
    reason: string;
    declineCode?: string;
    kind?: DeclineKind;
    wasProcessing: boolean;
}, now: number): Promise<void>;
/** A starting schedule's first checkout was abandoned or failed: the schedule never starts. */
export declare function scheduleAbandoned(ctx: MutationCtx, c: CheckoutDoc, now: number): Promise<void>;
/**
 * The method a starting schedule's first payment saved (Stripe's setup_future_usage, PayPal's vault
 * with purchase), recorded as the owner's saved method and the schedule's. Repeats change nothing.
 */
export declare const attachMethod: import("convex/server").RegisteredMutation<"public", {
    stripe?: {
        kind: "card" | "ach";
        label: string;
        stripeCustomerId: string;
        stripePaymentMethodId: string;
    } | undefined;
    paypal?: {
        networkRef?: {
            network?: string | undefined;
            date?: string | undefined;
            id: string;
        } | undefined;
        usagePattern?: string | undefined;
        kind: "paypal" | "card";
        label: string;
        paymentTokenId: string;
        paypalCustomerId: string;
    } | undefined;
    id: string;
    now: number;
}, Promise<null>>;
/**
 * A schedule's first PayPal payment was taken but PayPal answered vault status APPROVED (or nothing):
 * the method is saved later, its token sent in VAULT.PAYMENT-TOKEN.CREATED. Recorded before the
 * payment is settled, so the schedule starts knowing it waits. The PayPal customer is the order's
 * when it names one, else the owner's (whose id the order was made with).
 */
export declare const awaitPaypalVault: import("convex/server").RegisteredMutation<"public", {
    networkRef?: {
        network?: string | undefined;
        date?: string | undefined;
        id: string;
    } | undefined;
    paypalCustomerId?: string | undefined;
    id: string;
    now: number;
    orderId: string;
}, Promise<null>>;
/**
 * VAULT.PAYMENT-TOKEN.CREATED: the schedule whose first payment saved this token takes it. Found by
 * the order the event names (the checkout's order), else by the PayPal customer among this app's
 * schedules waiting for a token; with several waiting, none is guessed ('ambiguous'). A token for a
 * schedule that can't take it any more (it lapsed waiting, was cancelled, or has a method) is still
 * kept as the owner's saved method, so the app can offer it. 'saved': nothing new to attach (also a
 * token this app saved another way); 'foreign': no schedule or saved method of this app has it.
 */
export declare const paypalTokenCreated: import("convex/server").RegisteredMutation<"public", {
    orderId?: string | undefined;
    paypal: {
        networkRef?: {
            network?: string | undefined;
            date?: string | undefined;
            id: string;
        } | undefined;
        usagePattern?: string | undefined;
        kind: "paypal" | "card";
        label: string;
        paymentTokenId: string;
        paypalCustomerId: string;
    };
    app: string;
    now: number;
}, Promise<"attached" | "foreign" | "saved" | "ambiguous">>;
/**
 * New amount (from the next charge), saved method (checked by the client to be the owner's), day of
 * the month or description. A new method on a schedule being retried charges the refused period
 * again at once; on a lapsed one it starts again from the next charge date.
 */
export declare const update: import("convex/server").RegisteredMutation<"public", {
    method?: "paypal" | "card" | "ach" | undefined;
    description?: string | undefined;
    amountCents?: number | undefined;
    paymentMethodId?: string | undefined;
    processor?: "stripe" | "paypal" | undefined;
    by?: string | undefined;
    anchorDay?: number | undefined;
    id: string;
    app: string;
    now: number;
}, Promise<{
    method: "paypal" | "card" | "ach";
    id: string;
    status: "starting" | "active" | "paused" | "past_due" | "lapsed" | "cancelled";
    description: string;
    app: string;
    owner: {
        id: string;
        type: string;
    };
    ref: {
        id: string;
        type: string;
    };
    amountCents: number;
    context: any;
    payer: {
        name?: string | undefined;
        email: string;
    };
    paymentMethodId: string | null;
    processor: "stripe" | "paypal";
    purpose: string;
    period: string;
    anchorDay: number;
    hourUTC: number;
    createdAt: number;
    nextChargeAt: number | null;
    lastError: string | null;
    updatedAt: number;
    interval: "month";
    lastPaidPeriod: string | null;
    pausedUntil: number | null;
    failures: number;
    lastCheckoutId: string | null;
    endReason: string | null;
    endedBy: string | null;
    endedAt: number | null;
}>>;
/** Skips charges until `until`, then the first charge date from then on charges again, by itself. */
export declare const pause: import("convex/server").RegisteredMutation<"public", {
    by?: string | undefined;
    id: string;
    app: string;
    now: number;
    until: number;
}, Promise<{
    method: "paypal" | "card" | "ach";
    id: string;
    status: "starting" | "active" | "paused" | "past_due" | "lapsed" | "cancelled";
    description: string;
    app: string;
    owner: {
        id: string;
        type: string;
    };
    ref: {
        id: string;
        type: string;
    };
    amountCents: number;
    context: any;
    payer: {
        name?: string | undefined;
        email: string;
    };
    paymentMethodId: string | null;
    processor: "stripe" | "paypal";
    purpose: string;
    period: string;
    anchorDay: number;
    hourUTC: number;
    createdAt: number;
    nextChargeAt: number | null;
    lastError: string | null;
    updatedAt: number;
    interval: "month";
    lastPaidPeriod: string | null;
    pausedUntil: number | null;
    failures: number;
    lastCheckoutId: string | null;
    endReason: string | null;
    endedBy: string | null;
    endedAt: number | null;
}>>;
/** A paused or lapsed schedule charges again: from `at` (default now), at the first charge date of an unpaid period. */
export declare const resume: import("convex/server").RegisteredMutation<"public", {
    at?: number | undefined;
    by?: string | undefined;
    id: string;
    app: string;
    now: number;
}, Promise<{
    method: "paypal" | "card" | "ach";
    id: string;
    status: "starting" | "active" | "paused" | "past_due" | "lapsed" | "cancelled";
    description: string;
    app: string;
    owner: {
        id: string;
        type: string;
    };
    ref: {
        id: string;
        type: string;
    };
    amountCents: number;
    context: any;
    payer: {
        name?: string | undefined;
        email: string;
    };
    paymentMethodId: string | null;
    processor: "stripe" | "paypal";
    purpose: string;
    period: string;
    anchorDay: number;
    hourUTC: number;
    createdAt: number;
    nextChargeAt: number | null;
    lastError: string | null;
    updatedAt: number;
    interval: "month";
    lastPaidPeriod: string | null;
    pausedUntil: number | null;
    failures: number;
    lastCheckoutId: string | null;
    endReason: string | null;
    endedBy: string | null;
    endedAt: number | null;
}>>;
/** Ends a schedule for good. A charge already on its way still settles (and is reported). */
export declare const cancel: import("convex/server").RegisteredMutation<"public", {
    by?: string | undefined;
    id: string;
    app: string;
    now: number;
    reason: string;
}, Promise<{
    method: "paypal" | "card" | "ach";
    id: string;
    status: "starting" | "active" | "paused" | "past_due" | "lapsed" | "cancelled";
    description: string;
    app: string;
    owner: {
        id: string;
        type: string;
    };
    ref: {
        id: string;
        type: string;
    };
    amountCents: number;
    context: any;
    payer: {
        name?: string | undefined;
        email: string;
    };
    paymentMethodId: string | null;
    processor: "stripe" | "paypal";
    purpose: string;
    period: string;
    anchorDay: number;
    hourUTC: number;
    createdAt: number;
    nextChargeAt: number | null;
    lastError: string | null;
    updatedAt: number;
    interval: "month";
    lastPaidPeriod: string | null;
    pausedUntil: number | null;
    failures: number;
    lastCheckoutId: string | null;
    endReason: string | null;
    endedBy: string | null;
    endedAt: number | null;
}>>;
/**
 * A saved method was removed at the processor (a PayPal account holder cancelled the agreement, the
 * card was detached at Stripe): every schedule using it is cancelled, saying so, and the method is
 * marked removed so nothing offers or charges it again.
 */
export declare const methodRemoved: import("convex/server").RegisteredMutation<"public", {
    now: number;
    paymentMethodId: string;
    reason: string;
}, Promise<number>>;
export {};
//# sourceMappingURL=schedules.d.ts.map