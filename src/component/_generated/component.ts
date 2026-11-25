/* eslint-disable */
/**
 * Generated `ComponentApi` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type { FunctionReference } from "convex/server";

/**
 * A utility for referencing a Convex component's exposed API.
 *
 * Useful when expecting a parameter like `components.myComponent`.
 * Usage:
 * ```ts
 * async function myFunction(ctx: QueryCtx, component: ComponentApi) {
 *   return ctx.runQuery(component.someFile.someQuery, { ...args });
 * }
 * ```
 */
export type ComponentApi<Name extends string | undefined = string | undefined> =
  {
    checkouts: {
      abandon: FunctionReference<
        "mutation",
        "internal",
        { id: string; now: number },
        | { outcome: "abandoned" }
        | {
            outcome: "already_handled";
            status:
              | "created"
              | "pending"
              | "processing"
              | "paid"
              | "failed"
              | "abandoned"
              | "refund_needed";
          },
        Name
      >;
      attach: FunctionReference<
        "mutation",
        "internal",
        { id: string; processorCheckoutId: string },
        | { outcome: "attached" }
        | {
            outcome: "already_handled";
            status:
              | "created"
              | "pending"
              | "processing"
              | "paid"
              | "failed"
              | "abandoned"
              | "refund_needed";
          },
        Name
      >;
      byChargeKey: FunctionReference<
        "query",
        "internal",
        { chargeKey: string },
        {
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
          kind: "hosted" | "offSession" | "onSession" | "onPage";
          lastError: string | null;
          lastTriedAt: number | null;
          method: "card" | "ach" | "paypal";
          paidCents: number | null;
          payer: { email: string; name?: string };
          paymentMethodId: string | null;
          paymentRef: string | null;
          paypalDeclinedAt: number | null;
          processor: "stripe" | "paypal";
          processorCheckoutId: string | null;
          processorFeeCents: number | null;
          purpose: string;
          ref: { id: string; type: string };
          refundedCents: number;
          retryOf: string | null;
          returnUrl: string;
          scheduleId: string | null;
          schedulePeriod: string | null;
          settledAt: number | null;
          status:
            | "created"
            | "pending"
            | "processing"
            | "paid"
            | "failed"
            | "abandoned"
            | "refund_needed";
          stripeCustomerId: string | null;
        } | null,
        Name
      >;
      byPaymentRef: FunctionReference<
        "query",
        "internal",
        { paymentRef: string },
        {
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
          kind: "hosted" | "offSession" | "onSession" | "onPage";
          lastError: string | null;
          lastTriedAt: number | null;
          method: "card" | "ach" | "paypal";
          paidCents: number | null;
          payer: { email: string; name?: string };
          paymentMethodId: string | null;
          paymentRef: string | null;
          paypalDeclinedAt: number | null;
          processor: "stripe" | "paypal";
          processorCheckoutId: string | null;
          processorFeeCents: number | null;
          purpose: string;
          ref: { id: string; type: string };
          refundedCents: number;
          retryOf: string | null;
          returnUrl: string;
          scheduleId: string | null;
          schedulePeriod: string | null;
          settledAt: number | null;
          status:
            | "created"
            | "pending"
            | "processing"
            | "paid"
            | "failed"
            | "abandoned"
            | "refund_needed";
          stripeCustomerId: string | null;
        } | null,
        Name
      >;
      byProcessorId: FunctionReference<
        "query",
        "internal",
        { processorCheckoutId: string },
        {
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
          kind: "hosted" | "offSession" | "onSession" | "onPage";
          lastError: string | null;
          lastTriedAt: number | null;
          method: "card" | "ach" | "paypal";
          paidCents: number | null;
          payer: { email: string; name?: string };
          paymentMethodId: string | null;
          paymentRef: string | null;
          paypalDeclinedAt: number | null;
          processor: "stripe" | "paypal";
          processorCheckoutId: string | null;
          processorFeeCents: number | null;
          purpose: string;
          ref: { id: string; type: string };
          refundedCents: number;
          retryOf: string | null;
          returnUrl: string;
          scheduleId: string | null;
          schedulePeriod: string | null;
          settledAt: number | null;
          status:
            | "created"
            | "pending"
            | "processing"
            | "paid"
            | "failed"
            | "abandoned"
            | "refund_needed";
          stripeCustomerId: string | null;
        } | null,
        Name
      >;
      byRef: FunctionReference<
        "query",
        "internal",
        { ref: { id: string; type: string } },
        Array<{
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
          kind: "hosted" | "offSession" | "onSession" | "onPage";
          lastError: string | null;
          lastTriedAt: number | null;
          method: "card" | "ach" | "paypal";
          paidCents: number | null;
          payer: { email: string; name?: string };
          paymentMethodId: string | null;
          paymentRef: string | null;
          paypalDeclinedAt: number | null;
          processor: "stripe" | "paypal";
          processorCheckoutId: string | null;
          processorFeeCents: number | null;
          purpose: string;
          ref: { id: string; type: string };
          refundedCents: number;
          retryOf: string | null;
          returnUrl: string;
          scheduleId: string | null;
          schedulePeriod: string | null;
          settledAt: number | null;
          status:
            | "created"
            | "pending"
            | "processing"
            | "paid"
            | "failed"
            | "abandoned"
            | "refund_needed";
          stripeCustomerId: string | null;
        }>,
        Name
      >;
      cancel: FunctionReference<
        "mutation",
        "internal",
        {
          checked?: boolean;
          giveBack?: { key: string; windowMs: number };
          id: string;
          now: number;
        },
        | { outcome: "abandoned" }
        | { outcome: "being_paid" }
        | { outcome: "check_processor" }
        | {
            outcome: "already_handled";
            status:
              | "created"
              | "pending"
              | "processing"
              | "paid"
              | "failed"
              | "abandoned"
              | "refund_needed";
          },
        Name
      >;
      claimCapture: FunctionReference<
        "mutation",
        "internal",
        { id: string; now: number },
        | { claimed: true }
        | {
            claimed: false;
            status:
              | "created"
              | "pending"
              | "processing"
              | "paid"
              | "failed"
              | "abandoned"
              | "refund_needed";
          },
        Name
      >;
      create: FunctionReference<
        "mutation",
        "internal",
        {
          amountCents: number;
          app: string;
          callbacks: {
            onDispute?: string;
            onFailed?: string;
            onPaid?: string;
            onProcessing?: string;
            onRefundNeeded?: string;
            onRefunded?: string;
          };
          cancelUrl: string;
          chargeKey?: string;
          context?: any;
          description: string;
          expiresAt: number;
          kind?: "hosted" | "offSession" | "onSession" | "onPage";
          limits?: Array<{
            key: string;
            max: number;
            message: string;
            windowMs: number;
          }>;
          method: "card" | "ach" | "paypal";
          now: number;
          payer: { email: string; name?: string };
          paymentMethodId?: string;
          processor: "stripe" | "paypal";
          purpose: string;
          ref: { id: string; type: string };
          retryOf?: string;
          returnUrl: string;
          scheduleId?: string;
          schedulePeriod?: string;
          stripeCustomerId?: string;
        },
        string,
        Name
      >;
      createCharge: FunctionReference<
        "mutation",
        "internal",
        {
          amountCents: number;
          app: string;
          callbacks: {
            onDispute?: string;
            onFailed?: string;
            onPaid?: string;
            onProcessing?: string;
            onRefundNeeded?: string;
            onRefunded?: string;
          };
          cancelUrl: string;
          chargeKey?: string;
          context?: any;
          description: string;
          expiresAt: number;
          failed?: { declineCode: string; reason: string };
          kind?: "hosted" | "offSession" | "onSession" | "onPage";
          limits?: Array<{
            key: string;
            max: number;
            message: string;
            windowMs: number;
          }>;
          method: "card" | "ach" | "paypal";
          now: number;
          payer: { email: string; name?: string };
          paymentMethodId?: string;
          processor: "stripe" | "paypal";
          purpose: string;
          ref: { id: string; type: string };
          retryOf?: string;
          returnUrl: string;
          scheduleId?: string;
          schedulePeriod?: string;
          stripeCustomerId?: string;
        },
        { created: boolean; id: string },
        Name
      >;
      createdSince: FunctionReference<
        "query",
        "internal",
        {
          paginationOpts: {
            cursor: string | null;
            endCursor?: string | null;
            id?: number;
            maximumBytesRead?: number;
            maximumRowsRead?: number;
            numItems: number;
          };
          since: number;
        },
        {
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
            kind: "hosted" | "offSession" | "onSession" | "onPage";
            lastError: string | null;
            lastTriedAt: number | null;
            method: "card" | "ach" | "paypal";
            paidCents: number | null;
            payer: { email: string; name?: string };
            paymentMethodId: string | null;
            paymentRef: string | null;
            paypalDeclinedAt: number | null;
            processor: "stripe" | "paypal";
            processorCheckoutId: string | null;
            processorFeeCents: number | null;
            purpose: string;
            ref: { id: string; type: string };
            refundedCents: number;
            retryOf: string | null;
            returnUrl: string;
            scheduleId: string | null;
            schedulePeriod: string | null;
            settledAt: number | null;
            status:
              | "created"
              | "pending"
              | "processing"
              | "paid"
              | "failed"
              | "abandoned"
              | "refund_needed";
            stripeCustomerId: string | null;
          }>;
          pageStatus?: "SplitRecommended" | "SplitRequired" | null;
          splitCursor?: string | null;
        },
        Name
      >;
      due: FunctionReference<
        "query",
        "internal",
        { limit: number },
        Array<{
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
          kind: "hosted" | "offSession" | "onSession" | "onPage";
          lastError: string | null;
          lastTriedAt: number | null;
          method: "card" | "ach" | "paypal";
          paidCents: number | null;
          payer: { email: string; name?: string };
          paymentMethodId: string | null;
          paymentRef: string | null;
          paypalDeclinedAt: number | null;
          processor: "stripe" | "paypal";
          processorCheckoutId: string | null;
          processorFeeCents: number | null;
          purpose: string;
          ref: { id: string; type: string };
          refundedCents: number;
          retryOf: string | null;
          returnUrl: string;
          scheduleId: string | null;
          schedulePeriod: string | null;
          settledAt: number | null;
          status:
            | "created"
            | "pending"
            | "processing"
            | "paid"
            | "failed"
            | "abandoned"
            | "refund_needed";
          stripeCustomerId: string | null;
        }>,
        Name
      >;
      failStart: FunctionReference<
        "mutation",
        "internal",
        { error: string; id: string; now: number },
        null,
        Name
      >;
      get: FunctionReference<
        "query",
        "internal",
        { id: string },
        {
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
          kind: "hosted" | "offSession" | "onSession" | "onPage";
          lastError: string | null;
          lastTriedAt: number | null;
          method: "card" | "ach" | "paypal";
          paidCents: number | null;
          payer: { email: string; name?: string };
          paymentMethodId: string | null;
          paymentRef: string | null;
          paypalDeclinedAt: number | null;
          processor: "stripe" | "paypal";
          processorCheckoutId: string | null;
          processorFeeCents: number | null;
          purpose: string;
          ref: { id: string; type: string };
          refundedCents: number;
          retryOf: string | null;
          returnUrl: string;
          scheduleId: string | null;
          schedulePeriod: string | null;
          settledAt: number | null;
          status:
            | "created"
            | "pending"
            | "processing"
            | "paid"
            | "failed"
            | "abandoned"
            | "refund_needed";
          stripeCustomerId: string | null;
        } | null,
        Name
      >;
      list: FunctionReference<
        "query",
        "internal",
        {
          paginationOpts: {
            cursor: string | null;
            endCursor?: string | null;
            id?: number;
            maximumBytesRead?: number;
            maximumRowsRead?: number;
            numItems: number;
          };
        },
        {
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
            kind: "hosted" | "offSession" | "onSession" | "onPage";
            lastError: string | null;
            lastTriedAt: number | null;
            method: "card" | "ach" | "paypal";
            paidCents: number | null;
            payer: { email: string; name?: string };
            paymentMethodId: string | null;
            paymentRef: string | null;
            paypalDeclinedAt: number | null;
            processor: "stripe" | "paypal";
            processorCheckoutId: string | null;
            processorFeeCents: number | null;
            purpose: string;
            ref: { id: string; type: string };
            refundedCents: number;
            retryOf: string | null;
            returnUrl: string;
            scheduleId: string | null;
            schedulePeriod: string | null;
            settledAt: number | null;
            status:
              | "created"
              | "pending"
              | "processing"
              | "paid"
              | "failed"
              | "abandoned"
              | "refund_needed";
            stripeCustomerId: string | null;
          }>;
          pageStatus?: "SplitRecommended" | "SplitRequired" | null;
          splitCursor?: string | null;
        },
        Name
      >;
      markProcessing: FunctionReference<
        "mutation",
        "internal",
        {
          id: string;
          method?: "card" | "ach" | "paypal";
          now?: number;
          paymentRef?: string;
        },
        | { outcome: "processing" }
        | {
            outcome: "already_handled";
            status:
              | "created"
              | "pending"
              | "processing"
              | "paid"
              | "failed"
              | "abandoned"
              | "refund_needed";
          },
        Name
      >;
      noteChargeAttempt: FunctionReference<
        "mutation",
        "internal",
        {
          error: string;
          giveUp: boolean;
          id: string;
          max: number;
          now: number;
          processorCheckoutId?: string;
        },
        number,
        Name
      >;
      noteError: FunctionReference<
        "mutation",
        "internal",
        { error: string; id: string; paypalDeclinedAt?: number },
        null,
        Name
      >;
      noteIssue: FunctionReference<
        "mutation",
        "internal",
        {
          detail: string;
          id: string;
          kind: "status_differs" | "amount_differs";
          now: number;
        },
        null,
        Name
      >;
      recordFee: FunctionReference<
        "mutation",
        "internal",
        { id: string; processorFeeCents: number },
        null,
        Name
      >;
      refundable: FunctionReference<
        "query",
        "internal",
        {
          paginationOpts: {
            cursor: string | null;
            endCursor?: string | null;
            id?: number;
            maximumBytesRead?: number;
            maximumRowsRead?: number;
            numItems: number;
          };
          ref?: { id: string; type: string };
        },
        {
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
            kind: "hosted" | "offSession" | "onSession" | "onPage";
            lastError: string | null;
            lastTriedAt: number | null;
            method: "card" | "ach" | "paypal";
            paidCents: number | null;
            payer: { email: string; name?: string };
            paymentMethodId: string | null;
            paymentRef: string | null;
            paypalDeclinedAt: number | null;
            processor: "stripe" | "paypal";
            processorCheckoutId: string | null;
            processorFeeCents: number | null;
            purpose: string;
            ref: { id: string; type: string };
            refundedCents: number;
            retryOf: string | null;
            returnUrl: string;
            scheduleId: string | null;
            schedulePeriod: string | null;
            settledAt: number | null;
            status:
              | "created"
              | "pending"
              | "processing"
              | "paid"
              | "failed"
              | "abandoned"
              | "refund_needed";
            stripeCustomerId: string | null;
          }>;
          pageStatus?: "SplitRecommended" | "SplitRequired" | null;
          splitCursor?: string | null;
        },
        Name
      >;
      releaseCapture: FunctionReference<
        "mutation",
        "internal",
        { id: string },
        null,
        Name
      >;
      reopenCharge: FunctionReference<
        "mutation",
        "internal",
        { id: string; now: number },
        null,
        Name
      >;
      reorder: FunctionReference<
        "mutation",
        "internal",
        { id: string; processorCheckoutId: string },
        | { outcome: "reordered" }
        | {
            outcome: "already_handled";
            status:
              | "created"
              | "pending"
              | "processing"
              | "paid"
              | "failed"
              | "abandoned"
              | "refund_needed";
          },
        Name
      >;
      retriesOf: FunctionReference<
        "query",
        "internal",
        { id: string },
        Array<{
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
          kind: "hosted" | "offSession" | "onSession" | "onPage";
          lastError: string | null;
          lastTriedAt: number | null;
          method: "card" | "ach" | "paypal";
          paidCents: number | null;
          payer: { email: string; name?: string };
          paymentMethodId: string | null;
          paymentRef: string | null;
          paypalDeclinedAt: number | null;
          processor: "stripe" | "paypal";
          processorCheckoutId: string | null;
          processorFeeCents: number | null;
          purpose: string;
          ref: { id: string; type: string };
          refundedCents: number;
          retryOf: string | null;
          returnUrl: string;
          scheduleId: string | null;
          schedulePeriod: string | null;
          settledAt: number | null;
          status:
            | "created"
            | "pending"
            | "processing"
            | "paid"
            | "failed"
            | "abandoned"
            | "refund_needed";
          stripeCustomerId: string | null;
        }>,
        Name
      >;
      schedulePeriodPaid: FunctionReference<
        "query",
        "internal",
        { period: string; scheduleId: string },
        boolean,
        Name
      >;
      settleFailed: FunctionReference<
        "mutation",
        "internal",
        {
          declineCode?: string;
          declineKind?: "hard" | "soft" | "insufficient_funds";
          declined?: boolean;
          id: string;
          now: number;
          processorCheckoutId?: string;
          reason: string;
        },
        | { outcome: "failed" }
        | {
            outcome: "already_handled";
            status:
              | "created"
              | "pending"
              | "processing"
              | "paid"
              | "failed"
              | "abandoned"
              | "refund_needed";
          },
        Name
      >;
      settlePaid: FunctionReference<
        "mutation",
        "internal",
        {
          id: string;
          method?: "card" | "ach" | "paypal";
          now: number;
          paidCents: number;
          paymentRef: string;
          processorCheckoutId?: string;
          processorFeeCents?: number;
        },
        | { outcome: "paid" }
        | { outcome: "refund_needed"; reason: string; refundId: string }
        | {
            outcome: "already_handled";
            status:
              | "created"
              | "pending"
              | "processing"
              | "paid"
              | "failed"
              | "abandoned"
              | "refund_needed";
          },
        Name
      >;
    };
    customers: {
      byOwner: FunctionReference<
        "query",
        "internal",
        { app: string; owner: { id: string; type: string } },
        { email: string; id: string; stripeCustomerId: string } | null,
        Name
      >;
      method: FunctionReference<
        "query",
        "internal",
        { stripePaymentMethodId: string },
        {
          declineReason: string | null;
          declined: boolean;
          kind: "card" | "ach";
          label: string;
          removed: boolean;
          stripePaymentMethodId: string;
        } | null,
        Name
      >;
      paypalCustomer: FunctionReference<
        "query",
        "internal",
        { app: string; owner: { id: string; type: string } },
        string | null,
        Name
      >;
      paypalMethod: FunctionReference<
        "query",
        "internal",
        { paymentTokenId: string },
        {
          app: string;
          method: {
            createdAt: number;
            declineReason: string | null;
            declined: boolean;
            kind: "card" | "paypal";
            label: string;
            networkRef: { date?: string; id: string; network?: string } | null;
            paymentTokenId: string;
            removed: boolean;
            usagePattern: string | null;
          };
          owner: { id: string; type: string };
          paypalCustomerId: string;
        } | null,
        Name
      >;
      paypalMethods: FunctionReference<
        "query",
        "internal",
        { app: string; owner: { id: string; type: string } },
        Array<{
          createdAt: number;
          declineReason: string | null;
          declined: boolean;
          kind: "card" | "paypal";
          label: string;
          networkRef: { date?: string; id: string; network?: string } | null;
          paymentTokenId: string;
          removed: boolean;
          usagePattern: string | null;
        }>,
        Name
      >;
      removeMethod: FunctionReference<
        "mutation",
        "internal",
        { now: number; stripePaymentMethodId: string },
        null,
        Name
      >;
      removePaypalMethod: FunctionReference<
        "mutation",
        "internal",
        { now: number; paymentTokenId: string },
        null,
        Name
      >;
      save: FunctionReference<
        "mutation",
        "internal",
        {
          app: string;
          email: string;
          now: number;
          owner: { id: string; type: string };
          stripeCustomerId: string;
        },
        { email: string; id: string; stripeCustomerId: string },
        Name
      >;
      saveMethods: FunctionReference<
        "mutation",
        "internal",
        {
          methods: Array<{
            kind: "card" | "ach";
            label: string;
            stripePaymentMethodId: string;
          }>;
          now: number;
          stripeCustomerId: string;
        },
        Array<{
          declineReason: string | null;
          declined: boolean;
          kind: "card" | "ach";
          label: string;
          removed: boolean;
          stripePaymentMethodId: string;
        }>,
        Name
      >;
      savePaypalMethod: FunctionReference<
        "mutation",
        "internal",
        {
          app: string;
          kind: "card" | "paypal";
          label: string;
          now: number;
          owner: { id: string; type: string };
          paymentTokenId: string;
          paypalCustomerId: string;
          usagePattern?: string;
        },
        {
          createdAt: number;
          declineReason: string | null;
          declined: boolean;
          kind: "card" | "paypal";
          label: string;
          networkRef: { date?: string; id: string; network?: string } | null;
          paymentTokenId: string;
          removed: boolean;
          usagePattern: string | null;
        },
        Name
      >;
    };
    disputes: {
      record: FunctionReference<
        "mutation",
        "internal",
        {
          amountCents?: number;
          disputeId: string;
          lost?: boolean;
          now: number;
          outcome?: string;
          paymentRef: string;
          processor: "stripe" | "paypal";
          reason?: string;
          status: "opened" | "closed";
        },
        "foreign" | "recorded",
        Name
      >;
    };
    events: {
      begin: FunctionReference<
        "mutation",
        "internal",
        {
          eventId: string;
          now: number;
          processor: "stripe" | "paypal";
          type: string;
        },
        "new" | "seen",
        Name
      >;
      finish: FunctionReference<
        "mutation",
        "internal",
        {
          eventId: string;
          outcome: "received" | "handled" | "ignored" | "foreign";
          processor: "stripe" | "paypal";
        },
        null,
        Name
      >;
    };
    issues: {
      list: FunctionReference<
        "query",
        "internal",
        {
          open: boolean;
          paginationOpts: {
            cursor: string | null;
            endCursor?: string | null;
            id?: number;
            maximumBytesRead?: number;
            maximumRowsRead?: number;
            numItems: number;
          };
        },
        {
          continueCursor: string;
          isDone: boolean;
          page: Array<{
            checkoutId: string | null;
            detail: string;
            id: string;
            key: string;
            kind:
              | "missing_here"
              | "missing_there"
              | "amount_differs"
              | "status_differs"
              | "dispute"
              | "callback_failed"
              | "charge_unknown";
            openedAt: number;
            paymentRef: string | null;
            processor: "stripe" | "paypal";
            reportedAt: number | null;
            resolvedAt: number | null;
          }>;
          pageStatus?: "SplitRecommended" | "SplitRequired" | null;
          splitCursor?: string | null;
        },
        Name
      >;
      markReported: FunctionReference<
        "mutation",
        "internal",
        { ids: Array<string>; now: number },
        null,
        Name
      >;
      openCount: FunctionReference<
        "query",
        "internal",
        { cap?: number },
        number,
        Name
      >;
      resolve: FunctionReference<
        "mutation",
        "internal",
        { id: string; now: number },
        null,
        Name
      >;
      sync: FunctionReference<
        "mutation",
        "internal",
        {
          checkoutId?: string;
          found: Array<{
            detail: string;
            kind:
              | "missing_here"
              | "missing_there"
              | "amount_differs"
              | "status_differs";
          }>;
          key: string;
          now: number;
          only?: Array<
            | "missing_here"
            | "missing_there"
            | "amount_differs"
            | "status_differs"
          >;
          paymentRef?: string;
          processor: "stripe" | "paypal";
        },
        { opened: number; resolved: number },
        Name
      >;
      unreported: FunctionReference<
        "query",
        "internal",
        { limit?: number },
        Array<{
          checkoutId: string | null;
          detail: string;
          id: string;
          key: string;
          kind:
            | "missing_here"
            | "missing_there"
            | "amount_differs"
            | "status_differs"
            | "dispute"
            | "callback_failed"
            | "charge_unknown";
          openedAt: number;
          paymentRef: string | null;
          processor: "stripe" | "paypal";
          reportedAt: number | null;
          resolvedAt: number | null;
        }>,
        Name
      >;
    };
    limits: {
      take: FunctionReference<
        "mutation",
        "internal",
        {
          limits: Array<{
            key: string;
            max: number;
            message: string;
            windowMs: number;
          }>;
          now: number;
        },
        null,
        Name
      >;
    };
    maintenance: {
      cleanup: FunctionReference<
        "mutation",
        "internal",
        { batch?: number; now: number },
        { deleted: number; more: boolean },
        Name
      >;
    };
    refunds: {
      approve: FunctionReference<
        "mutation",
        "internal",
        { by?: string; now: number; refundId: string },
        null,
        Name
      >;
      begin: FunctionReference<
        "mutation",
        "internal",
        { by?: string; now: number; refundId: string; skipApproval: boolean },
        | {
            amountCents: number;
            app: string;
            checkoutId: string;
            key: string;
            paymentRef: string;
            processor: "stripe" | "paypal";
            refundId: string;
            state: "send";
          }
        | { state: "already"; status: string },
        Name
      >;
      createdSince: FunctionReference<
        "query",
        "internal",
        { limit: number; since: number },
        Array<{
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
          status:
            | "requested"
            | "approved"
            | "sending"
            | "sent"
            | "failed"
            | "manual"
            | "dismissed";
          updatedAt: number;
        }>,
        Name
      >;
      dismiss: FunctionReference<
        "mutation",
        "internal",
        { by?: string; note?: string; now: number; refundId: string },
        null,
        Name
      >;
      finish: FunctionReference<
        "mutation",
        "internal",
        {
          done: boolean;
          error?: string;
          now: number;
          ok: boolean;
          processorRefundId?: string;
          refundId: string;
          unknown?: boolean;
        },
        null,
        Name
      >;
      forCheckout: FunctionReference<
        "query",
        "internal",
        { checkoutId: string },
        Array<{
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
          status:
            | "requested"
            | "approved"
            | "sending"
            | "sent"
            | "failed"
            | "manual"
            | "dismissed";
          updatedAt: number;
        }>,
        Name
      >;
      get: FunctionReference<
        "query",
        "internal",
        { refundId: string },
        {
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
          status:
            | "requested"
            | "approved"
            | "sending"
            | "sent"
            | "failed"
            | "manual"
            | "dismissed";
          updatedAt: number;
        } | null,
        Name
      >;
      listOpen: FunctionReference<
        "query",
        "internal",
        { limit?: number },
        Array<{
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
          status:
            | "requested"
            | "approved"
            | "sending"
            | "sent"
            | "failed"
            | "manual"
            | "dismissed";
          updatedAt: number;
        }>,
        Name
      >;
      markManual: FunctionReference<
        "mutation",
        "internal",
        { by?: string; note?: string; now: number; refundId: string },
        null,
        Name
      >;
      recordExternal: FunctionReference<
        "mutation",
        "internal",
        {
          amountCents: number;
          now: number;
          paymentRef: string;
          processor: "stripe" | "paypal";
          processorRefundId: string;
          reason?: string;
          refundId?: string;
          state: "done" | "pending" | "failed";
        },
        "foreign" | "recorded" | "updated" | "unchanged",
        Name
      >;
      request: FunctionReference<
        "mutation",
        "internal",
        {
          amountCents?: number;
          by?: string;
          checkoutId: string;
          hostData?: Record<string, string>;
          now: number;
          reason: string;
        },
        string,
        Name
      >;
      stuck: FunctionReference<
        "query",
        "internal",
        { before: number; limit: number },
        Array<{
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
          status:
            | "requested"
            | "approved"
            | "sending"
            | "sent"
            | "failed"
            | "manual"
            | "dismissed";
          updatedAt: number;
        }>,
        Name
      >;
    };
    schedules: {
      attachMethod: FunctionReference<
        "mutation",
        "internal",
        {
          id: string;
          now: number;
          paypal?: {
            kind: "card" | "paypal";
            label: string;
            networkRef?: { date?: string; id: string; network?: string };
            paymentTokenId: string;
            paypalCustomerId: string;
            usagePattern?: string;
          };
          stripe?: {
            kind: "card" | "ach";
            label: string;
            stripeCustomerId: string;
            stripePaymentMethodId: string;
          };
        },
        null,
        Name
      >;
      awaitPaypalVault: FunctionReference<
        "mutation",
        "internal",
        {
          id: string;
          networkRef?: { date?: string; id: string; network?: string };
          now: number;
          orderId: string;
          paypalCustomerId?: string;
        },
        null,
        Name
      >;
      cancel: FunctionReference<
        "mutation",
        "internal",
        { app: string; by?: string; id: string; now: number; reason: string },
        {
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
          owner: { id: string; type: string };
          pausedUntil: number | null;
          payer: { email: string; name?: string };
          paymentMethodId: string | null;
          period: string;
          processor: "stripe" | "paypal";
          purpose: string;
          ref: { id: string; type: string };
          status:
            | "starting"
            | "active"
            | "paused"
            | "past_due"
            | "lapsed"
            | "cancelled";
          updatedAt: number;
        },
        Name
      >;
      claim: FunctionReference<
        "mutation",
        "internal",
        { app: string; id: string; now: number },
        | {
            action: "charge";
            amountCents: number;
            context: any;
            description: string;
            key: string;
            owner: { id: string; type: string };
            payer: { email: string; name?: string };
            paymentMethodId: string;
            period: string;
            purpose: string;
            ref: { id: string; type: string };
          }
        | { action: "wait"; reason: string }
        | { action: "check_vault"; orderId: string },
        Name
      >;
      create: FunctionReference<
        "mutation",
        "internal",
        {
          amountCents: number;
          anchorDay: number;
          app: string;
          callbacks: {
            onChanged?: string;
            onCharged?: string;
            onFailed?: string;
          };
          context?: any;
          description: string;
          firstChargeAt: number;
          hourUTC: number;
          method: "card" | "ach" | "paypal";
          now: number;
          owner: { id: string; type: string };
          payer: { email: string; name?: string };
          paymentMethodId?: string;
          processor: "stripe" | "paypal";
          purpose: string;
          ref: { id: string; type: string };
          retryDays: Array<number>;
        },
        string,
        Name
      >;
      discard: FunctionReference<
        "mutation",
        "internal",
        { id: string },
        null,
        Name
      >;
      due: FunctionReference<
        "query",
        "internal",
        { app: string; limit: number; now: number },
        Array<{ app: string; id: string }>,
        Name
      >;
      forOwner: FunctionReference<
        "query",
        "internal",
        { app: string; owner: { id: string; type: string } },
        Array<{
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
          owner: { id: string; type: string };
          pausedUntil: number | null;
          payer: { email: string; name?: string };
          paymentMethodId: string | null;
          period: string;
          processor: "stripe" | "paypal";
          purpose: string;
          ref: { id: string; type: string };
          status:
            | "starting"
            | "active"
            | "paused"
            | "past_due"
            | "lapsed"
            | "cancelled";
          updatedAt: number;
        }>,
        Name
      >;
      forRef: FunctionReference<
        "query",
        "internal",
        { ref: { id: string; type: string } },
        Array<{
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
          owner: { id: string; type: string };
          pausedUntil: number | null;
          payer: { email: string; name?: string };
          paymentMethodId: string | null;
          period: string;
          processor: "stripe" | "paypal";
          purpose: string;
          ref: { id: string; type: string };
          status:
            | "starting"
            | "active"
            | "paused"
            | "past_due"
            | "lapsed"
            | "cancelled";
          updatedAt: number;
        }>,
        Name
      >;
      get: FunctionReference<
        "query",
        "internal",
        { id: string },
        {
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
          owner: { id: string; type: string };
          pausedUntil: number | null;
          payer: { email: string; name?: string };
          paymentMethodId: string | null;
          period: string;
          processor: "stripe" | "paypal";
          purpose: string;
          ref: { id: string; type: string };
          status:
            | "starting"
            | "active"
            | "paused"
            | "past_due"
            | "lapsed"
            | "cancelled";
          updatedAt: number;
        } | null,
        Name
      >;
      methodRemoved: FunctionReference<
        "mutation",
        "internal",
        { now: number; paymentMethodId: string; reason: string },
        number,
        Name
      >;
      pause: FunctionReference<
        "mutation",
        "internal",
        { app: string; by?: string; id: string; now: number; until: number },
        {
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
          owner: { id: string; type: string };
          pausedUntil: number | null;
          payer: { email: string; name?: string };
          paymentMethodId: string | null;
          period: string;
          processor: "stripe" | "paypal";
          purpose: string;
          ref: { id: string; type: string };
          status:
            | "starting"
            | "active"
            | "paused"
            | "past_due"
            | "lapsed"
            | "cancelled";
          updatedAt: number;
        },
        Name
      >;
      paypalTokenCreated: FunctionReference<
        "mutation",
        "internal",
        {
          app: string;
          now: number;
          orderId?: string;
          paypal: {
            kind: "card" | "paypal";
            label: string;
            networkRef?: { date?: string; id: string; network?: string };
            paymentTokenId: string;
            paypalCustomerId: string;
            usagePattern?: string;
          };
        },
        "attached" | "saved" | "ambiguous" | "foreign",
        Name
      >;
      resume: FunctionReference<
        "mutation",
        "internal",
        { app: string; at?: number; by?: string; id: string; now: number },
        {
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
          owner: { id: string; type: string };
          pausedUntil: number | null;
          payer: { email: string; name?: string };
          paymentMethodId: string | null;
          period: string;
          processor: "stripe" | "paypal";
          purpose: string;
          ref: { id: string; type: string };
          status:
            | "starting"
            | "active"
            | "paused"
            | "past_due"
            | "lapsed"
            | "cancelled";
          updatedAt: number;
        },
        Name
      >;
      update: FunctionReference<
        "mutation",
        "internal",
        {
          amountCents?: number;
          anchorDay?: number;
          app: string;
          by?: string;
          description?: string;
          id: string;
          method?: "card" | "ach" | "paypal";
          now: number;
          paymentMethodId?: string;
          processor?: "stripe" | "paypal";
        },
        {
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
          owner: { id: string; type: string };
          pausedUntil: number | null;
          payer: { email: string; name?: string };
          paymentMethodId: string | null;
          period: string;
          processor: "stripe" | "paypal";
          purpose: string;
          ref: { id: string; type: string };
          status:
            | "starting"
            | "active"
            | "paused"
            | "past_due"
            | "lapsed"
            | "cancelled";
          updatedAt: number;
        },
        Name
      >;
      usingMethod: FunctionReference<
        "query",
        "internal",
        { paymentMethodId: string },
        number,
        Name
      >;
    };
    settings: {
      get: FunctionReference<
        "query",
        "internal",
        {},
        { retentionDays: number },
        Name
      >;
      paypalToken: FunctionReference<
        "query",
        "internal",
        {},
        { account: string; expiresAt: number; sealed: string } | null,
        Name
      >;
      savePaypalToken: FunctionReference<
        "mutation",
        "internal",
        { account: string; expiresAt: number; sealed: string },
        null,
        Name
      >;
      searchRefusedAt: FunctionReference<
        "query",
        "internal",
        {},
        number | null,
        Name
      >;
      setSearchRefused: FunctionReference<
        "mutation",
        "internal",
        { at: number | null },
        null,
        Name
      >;
      update: FunctionReference<
        "mutation",
        "internal",
        { retentionDays: number },
        null,
        Name
      >;
    };
  };
