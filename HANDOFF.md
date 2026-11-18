# Hand-off: payments library v0.2 work (2026-11-17)

Spec: `/Users/adam/.claude-seat1/plans/why-do-bid-refunds-lovely-russell.md` (the v0.2 plan). Background:
ed-schedule's `payments_library_plan.md` (v0.1). The original brief had four deliverables; status below.

## Status per deliverable

1. **Library v0.2 (this repo, branch `library`): done.** Released as tag `v0.2.0` (see git log; release
   script pushes branch and tag). PR adamaviner/ed-payments#1 description updated for v0.2. Not merged.
   - Saved methods + off-session charges + on-session retries (`src/client/saved.ts`), `definePayments`
     (`src/client/index.ts`), typed context checked at start (`src/client/context.ts`), required callbacks,
     `adminApi`/`publicApi`/`worker` behind `authorize.admin` (`src/client/api.ts`), `registerCrons`,
     `fromEnv` with live/test checks (`src/client/env.ts`), webhook CLI (`src/cli/`, `npx ed-payments webhooks`),
     indexed paged `refundable` (component `checkouts.refundable`), rate limits on start/setup/retry/return
     (`src/component/limits.ts`), secrets scan + table-driven refusal tests (`src/client/api.test.ts`),
     contract tests for the fakes (`src/testing/contract.test.ts`), key-gated `npm run test:sandbox`
     (`sandbox/`, `vitest.sandbox.config.ts`), `registerPayments(t)` (`src/test.ts`), README "Adopt in 5
     steps", `AGENTS.md` host rules (shipped in the package via `files`), `example/convex` a complete host.
   - Checks: `npm run check` green, 162 tests / 11 files. `npm run test:sandbox` (with
     `ED_PAYMENTS_SANDBOX_ENV=/Users/adam/source/earthdance/ed-market/.env.local`) green, 9 tests.
   - A fresh reviewer pass found 5 money bugs; all fixed with regression tests (commit "Fixes from the review pass").
     Open questions it raised, not changed: (7) the return page's per-token limit can be dodged with random
     tokens, which only eats the global cap (no money at risk); (8) the sweep's `due` query reads 200 rows per
     status, off-session rows sort last (fine at Earthdance's volume; add a kind/lastTriedAt index if it grows).
2. **ed-market onto v0.2: started, not building.** Worktree `/Users/adam/source/earthdance/ed-market-payments`.
   - Branch `payments-library` (PR adamaviner/earthdance-market#14) is still at v0.1 (`1c3c25a`), clean, untouched.
   - Local-only branch `payments-library-v02-wip` (commit `bae1ac0`, NOT pushed, does not build) holds the start:
     `convex/payments/library.ts` (definePayments + worker/public exports, context = `v.union(orderInput, {bidId})`),
     `convex/payments/callbacks.ts` (all seven callbacks + `adminName` authorize query; orders vs bids dispatch),
     `convex/bidPayments.ts` (now `recordBidPayment` returning a refusal reason + `getBidForRetry`),
     `convex/bidPaymentProcessing.ts` (helpers `failBidPayment`, `markBidPaymentProcessing`, `recordRetryBounced`),
     `convex/orders.ts` (`insertCheckoutOrder` replaces `onCheckoutPaid`/`choicesFromContext`).
   - Remaining, file by file (in this order):
     - `package.json`: `@earthdance/payments` → `github:adamaviner/ed-payments#v0.2.0`; remove `stripe`. `pnpm install`.
     - `convex/payments/bids.ts` (new, replaces `stripeBidding.ts`, no `"use node"`): `getBidPaymentMethod`
       (`savedMethods` first non-declined, else `setupPaymentMethod`; pass `stripeCustomerId: user.stripeCustomerId`
       to adopt existing Customers), `placeBid` (`verifyMethodOwner` → `internal.auctions.placeBid` with
       `stripePaymentMethodType` from kind and `paymentMethodCustomerId` = returned `stripeCustomerId`),
       `retryPayment` (owner + `payment_failed` check via `getBidForRetry`, then `retryOnSession` with
       `expiresAt` = window start + 7 days).
     - `convex/payments/admin.ts` (new): `export const { openRefunds, refundable, issues, openCount, checkout, requestRefund, approveRefund, sendRefund, markRefundedManually, dismissRefund, resolveIssue, retryCharge, giveUpCharge } = payments.adminApi({ skipApproval: true })`.
     - `convex/payments/checkout.ts`: keep `startCheckout` (drop callback args, `limitKey`), keep
       `flagPreLibraryPayment` + move `flagPreLibraryCheckout` here from `bidEvents.ts` (remove-after 2026-12-31),
       delete `completeReturn` (now `api.payments.library.completeReturn`) and the old callbacks.
     - `convex/auctionClose.ts`: `scheduleCharge` → `payments.chargeSaved(ctx, { ref: {type:'bid', id}, purpose: 'bid', owner: {type:'user', id: bid.bidderUserId}, paymentMethodId: bid.stripePaymentMethodId, stripeCustomerId: bid.stripeCustomerId, idempotencyKey: \`bid-charge-${bidId}-${selectedAt}\`, context: { bidId }, ... })`, store `chargeCheckoutId`on the bid; drop`flagStalledCharge`.
     - `convex/auctions.ts`: `placeBid` no longer requires `user.stripeCustomerId`; `listFailedPayments`
       `hasChargeError` from the library checkout (`pending` with `lastError`).
     - `convex/schema.ts`: drop `refundRequests` (+ `refundRequestStatus`, `refundMethod`), bids'
       `retryPaymentIntentId`, `chargeErrorMessage`, `chargeErrorAt`; add `chargeCheckoutId`. Keep `users.stripeCustomerId` (adoption).
     - `convex/users.ts`: remove `setStripeCustomerId`.
     - `convex/email.ts`: `sendPaymentIssuesEmail` takes `{ details: string[] }` (callbacks.issues sends it); drop its `payments` import.
     - `convex/http.ts`: `payments.registerRoutes(http, { onUnhandledStripeEvent: flagPreLibraryCheckout })`.
     - `convex/crons.ts`: replace the four payments crons with `payments.registerCrons(crons)`.
     - `src/lib/fees.ts`: `LARGE_TRANSACTION_THRESHOLD_CENTS` re-exported from core.
     - Delete: `convex/payments/{stripeBidding,bidEvents,bidRefunds,refundsAdmin,worker}.ts`,
       `convex/refundRequests.ts`, `convex/chargeIssues.ts`, `src/lib/stripe.ts`,
       `src/components/admin-refund-requests.tsx`, `src/components/admin-charge-issues.tsx`.
     - UI: `bid-form.tsx`, `bid-payment-retry.tsx` → new `api.payments.bids.*`; return pages →
       `api.payments.library.completeReturn`; `admin-sidebar.tsx` badge → `api.payments.admin.openCount`;
       `admin-checkout-refunds.tsx` → `api.payments.admin.*` (show `charge_unknown` issues with Retry / Give up).
     - Tests: `testHelpers.test.ts` uses `registerPayments(t)` (stubs fetch with the fakes; set
       `STRIPE_WEBHOOK_SECRET=whsec_fake_test_secret` in tests); rewrite `stripePayments.test.ts` (no `vi.mock('stripe')`)
       through `fakeStripe` (`saveMethod(customer,'ok'|'decline'|'auth'|'bank')`, `confirm`, `settleBank`,
       `t.finishAllScheduledFunctions(vi.runAllTimers)`); `paymentIssues.test.ts` and `checkoutPayments.test.ts`
       onto the admin functions; `auctions.test.ts` `markBidPaid` section onto `callbacks.paid`, `attemptCharge`
       expectations onto the library's `charge`.
     - Docs: `PAYMENTS.md`, `AUCTIONS.md`, `CLAUDE.md`, `.env.local.example` (`PAYMENTS_MODE`, `PAYPAL_API_BASE` meaning).
     - Checks: `npx tsc --noEmit`, `pnpm lint`, `pnpm test`, `pnpm build`; reviewer pass; push `payments-library`; update PR #14.
     - Line counts (baseline, before): server payment glue `convex/payments/*` 819 + `refundRequests.ts` 121 +
       `chargeIssues.ts` 132 + `src/lib/stripe.ts` 14 = **1086**; bid callbacks `bidPayments.ts` 164 +
       `bidPaymentProcessing.ts` 82 = 246; UI 795 (two return pages 139, three admin components 547, retry page 107).
3. **React package `@earthdance/payments/react`: not started.** Plan: `src/react/` like ed-mail's (`./react`
   export, optional peer deps react, convex/react), `useCheckoutReturn(completeReturn, processor, token)` and a
   `PaymentsAdminPage` over the `adminApi` functions (refunds, refundable, issues incl. charge_unknown Retry/Give up).
   ed-market's `admin-checkout-refunds.tsx` is the model. Then release v0.2.1 and bump ed-market.
4. **ed-schedule `new-payment-flow` skill + guard rule: not started.** Worktree to create:
   `git -C /Users/adam/source/earthdance/ed-schedule worktree add /Users/adam/source/earthdance/ed-schedule/.claude/worktrees/payments-skill -b payments-skill origin/main`;
   model on `.claude/skills/new-email-kind/SKILL.md`; rule in `.claude/hooks/guard.sh` and
   `scripts/checks/conventions.test.ts` refusing `api.stripe.com` / `paypal.com` in app code. Commit there; do NOT push.

## Deviations from the plan, and why (don't undo)

- **Two calls: `definePayments(component, options).withCallbacks({ on, authorize, worker })`**, not one. A single
  generic call whose arguments name `internal.*` makes TypeScript infer the instance from itself (TS7022; verified on
  the example). The second call is non-generic, so no annotation is needed anywhere.
- **`adminApi()` can't be exported as one object** (`export const admin = payments.adminApi()`): Convex registers
  only top-level exports. Hosts destructure it by name in their own module (README step 4).
- **`authorize.admin` is an internal query returning `{ name } | null`, called with `{ auth }` when given**, so apps
  with their own session tokens (ed-schedule) work; apps on Convex auth ignore it (identity carries into the nested
  query: checked in convex-test; on the local backend only the refusal path, since it has no auth provider).
- **Callbacks are global (in `withCallbacks`), not per `start`**; still stored as handles per checkout row. All seven
  required: paid, failed, refunded, refundNeeded, dispute, processing (new, for the bid's 7-day pause), issues (digest).
- **No `stripePaymentIntentId` column:** an off/on-session checkout's PaymentIntent id is its `processorCheckoutId`
  (and `paymentRef` once paid). `kind` is optional in the schema (v0.1 rows read as `hosted`).
- **Charge retries:** Stripe replays a key's first answer even for a 500, so a retry first lists the customer's
  PaymentIntents for this checkout and only then uses a new key (`<key>:try-N`); if the list is too long to be sure
  it hands the charge to a person instead of guessing. Give-up asks Stripe first. Keep this.
- **`PAYMENTS_MODE=live`** marks production (Convex has no such flag). Unset `PAYPAL_API_BASE` = sandbox in test,
  live in live mode. Wrong-mode keys are refused at push and at every call (push refusal verified on the local backend).
- **Sandbox suite gated by its own config** (runs no files and says so without keys), not `.skip`.
- Stripe API `2026-10-28.endive`: PaymentIntents and SetupIntents refuse `payment_method_types` (400); the library
  sends `allowed_payment_method_types`. Verified in test mode.

## Verified against real processors vs only fakes

- Stripe test mode: sessions; Customer idempotency; SetupIntent off_session + instant bank verification; old parameter
  refused; off-session paid / same-key replay / declined 402 / authentication_required 402 / bank processing; on-session
  PaymentIntent + cancel; list. Not possible with ed-market's restricted test key: refunds and webhook endpoints (403
  `more_permissions_required`).
- PayPal sandbox: token, order create (request-id replay), get, capture-before-approval 422, verify → FAILURE, Transaction
  Search 403, webhook CLI create/unchanged/remove (sandbox webhook removed).
- Fakes only: completed hosted payments and their webhooks, Payment Element confirms, Stripe refunds/disputes, PayPal
  approval/capture/refund, genuine webhook verification, the Stripe webhook CLI.

## Environment

- Local anonymous backend for this repo on ports 3410/3411 (`.convex/local/default`), used by `npx convex codegen` with
  `CONVEX_AGENT_MODE=anonymous`. Not left running. ed-market worktree's would be 3420.
- Test keys only in `/Users/adam/source/earthdance/ed-market/.env.local` (Stripe `rk_test_`, PayPal sandbox, no `PAYPAL_API_BASE`).
- Scratch scripts in `/tmp/edp-scripts` (fixture capture), not part of any repo.

## Owner to-dos (Adam), when ed-market ships on v0.2

- Env on prod Convex: `PAYMENTS_MODE=live`, `PAYPAL_API_BASE` unset or the live URL. Dev: leave `PAYMENTS_MODE` unset.
- Stripe restricted key permissions: write Checkout Sessions, PaymentIntents, SetupIntents, Customers, Refunds,
  Webhook Endpoints; read PaymentMethods, Charges, Disputes, Events.
- Webhooks: `npx ed-payments webhooks --stripe https://<deployment>.convex.site/stripe/webhook --env-file <file>` and
  `--paypal .../paypal/webhook` per deployment; set the printed `STRIPE_WEBHOOK_SECRET` / `PAYPAL_WEBHOOK_ID`.
- PayPal Transaction Search permission; PayPal's nonprofit fee rate into `PAYPAL_CARD_FEE_RATE`.
- Before deploying the schema drop: delete prod `refundRequests` rows (after resolving any open ones) and unset bids'
  `retryPaymentIntentId`, `chargeErrorMessage`, `chargeErrorAt`; bids paid/charged before the switch have no
  `chargeCheckoutId`, so their retry page can't use the library (none should be mid-retry at switch time).
- Live run per README, including off-session bid charges (step 8).
