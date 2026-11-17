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
      byPaymentRef: FunctionReference<
        "query",
        "internal",
        { paymentRef: string },
        {
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
          payer: { email: string; name?: string };
          paymentRef: string | null;
          processor: "stripe" | "paypal";
          processorCheckoutId: string | null;
          processorFeeCents: number | null;
          purpose: string;
          ref: { id: string; type: string };
          refundedCents: number;
          returnUrl: string;
          settledAt: number | null;
          status:
            | "created"
            | "pending"
            | "processing"
            | "paid"
            | "failed"
            | "abandoned"
            | "refund_needed";
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
          context: any;
          createdAt: number;
          description: string;
          disputed: boolean;
          expiresAt: number;
          id: string;
          lastError: string | null;
          method: "card" | "ach" | "paypal";
          paidCents: number | null;
          payer: { email: string; name?: string };
          paymentRef: string | null;
          processor: "stripe" | "paypal";
          processorCheckoutId: string | null;
          processorFeeCents: number | null;
          purpose: string;
          ref: { id: string; type: string };
          refundedCents: number;
          returnUrl: string;
          settledAt: number | null;
          status:
            | "created"
            | "pending"
            | "processing"
            | "paid"
            | "failed"
            | "abandoned"
            | "refund_needed";
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
          context: any;
          createdAt: number;
          description: string;
          disputed: boolean;
          expiresAt: number;
          id: string;
          lastError: string | null;
          method: "card" | "ach" | "paypal";
          paidCents: number | null;
          payer: { email: string; name?: string };
          paymentRef: string | null;
          processor: "stripe" | "paypal";
          processorCheckoutId: string | null;
          processorFeeCents: number | null;
          purpose: string;
          ref: { id: string; type: string };
          refundedCents: number;
          returnUrl: string;
          settledAt: number | null;
          status:
            | "created"
            | "pending"
            | "processing"
            | "paid"
            | "failed"
            | "abandoned"
            | "refund_needed";
        }>,
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
            onRefundNeeded?: string;
            onRefunded?: string;
          };
          cancelUrl: string;
          context?: any;
          description: string;
          expiresAt: number;
          limit?: {
            globalPerMinute: number;
            key?: string;
            perKey: number;
            windowMs: number;
          };
          method: "card" | "ach" | "paypal";
          now: number;
          payer: { email: string; name?: string };
          processor: "stripe" | "paypal";
          purpose: string;
          ref: { id: string; type: string };
          returnUrl: string;
        },
        string,
        Name
      >;
      createdSince: FunctionReference<
        "query",
        "internal",
        { after?: number; limit: number; since: number },
        Array<{
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
          payer: { email: string; name?: string };
          paymentRef: string | null;
          processor: "stripe" | "paypal";
          processorCheckoutId: string | null;
          processorFeeCents: number | null;
          purpose: string;
          ref: { id: string; type: string };
          refundedCents: number;
          returnUrl: string;
          settledAt: number | null;
          status:
            | "created"
            | "pending"
            | "processing"
            | "paid"
            | "failed"
            | "abandoned"
            | "refund_needed";
        }>,
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
          context: any;
          createdAt: number;
          description: string;
          disputed: boolean;
          expiresAt: number;
          id: string;
          lastError: string | null;
          method: "card" | "ach" | "paypal";
          paidCents: number | null;
          payer: { email: string; name?: string };
          paymentRef: string | null;
          processor: "stripe" | "paypal";
          processorCheckoutId: string | null;
          processorFeeCents: number | null;
          purpose: string;
          ref: { id: string; type: string };
          refundedCents: number;
          returnUrl: string;
          settledAt: number | null;
          status:
            | "created"
            | "pending"
            | "processing"
            | "paid"
            | "failed"
            | "abandoned"
            | "refund_needed";
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
          context: any;
          createdAt: number;
          description: string;
          disputed: boolean;
          expiresAt: number;
          id: string;
          lastError: string | null;
          method: "card" | "ach" | "paypal";
          paidCents: number | null;
          payer: { email: string; name?: string };
          paymentRef: string | null;
          processor: "stripe" | "paypal";
          processorCheckoutId: string | null;
          processorFeeCents: number | null;
          purpose: string;
          ref: { id: string; type: string };
          refundedCents: number;
          returnUrl: string;
          settledAt: number | null;
          status:
            | "created"
            | "pending"
            | "processing"
            | "paid"
            | "failed"
            | "abandoned"
            | "refund_needed";
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
            context: any;
            createdAt: number;
            description: string;
            disputed: boolean;
            expiresAt: number;
            id: string;
            lastError: string | null;
            method: "card" | "ach" | "paypal";
            paidCents: number | null;
            payer: { email: string; name?: string };
            paymentRef: string | null;
            processor: "stripe" | "paypal";
            processorCheckoutId: string | null;
            processorFeeCents: number | null;
            purpose: string;
            ref: { id: string; type: string };
            refundedCents: number;
            returnUrl: string;
            settledAt: number | null;
            status:
              | "created"
              | "pending"
              | "processing"
              | "paid"
              | "failed"
              | "abandoned"
              | "refund_needed";
          }>;
          pageStatus?: "SplitRecommended" | "SplitRequired" | null;
          splitCursor?: string | null;
        },
        Name
      >;
      markProcessing: FunctionReference<
        "mutation",
        "internal",
        { id: string; paymentRef?: string },
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
      settleFailed: FunctionReference<
        "mutation",
        "internal",
        { id: string; now: number; reason: string },
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
    disputes: {
      record: FunctionReference<
        "mutation",
        "internal",
        {
          amountCents?: number;
          disputeId: string;
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
              | "callback_failed";
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
            | "callback_failed";
          openedAt: number;
          paymentRef: string | null;
          processor: "stripe" | "paypal";
          reportedAt: number | null;
          resolvedAt: number | null;
        }>,
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
