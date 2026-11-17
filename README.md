# @earthdance/payments

Payments for Earthdance's Convex apps: Stripe and PayPal checkouts, both processors' webhooks, a
refund ledger, disputes, a sweep for checkouts nobody finished, and a nightly comparison with the
processors. One npm package holding a Convex component (the tables) and the client code apps call
from their `convex/` folder (the network calls). Shaped like `@earthdance/mail`.

The plan it was built from is ed-schedule's `payments_library_plan.md` (stage 2 of the WordPress
migration). ed-market adopts it first; ed-schedule in stage 3.

**Status:** v0.1.0. One-off payments in USD. Not here: subscriptions, saved cards and off-session
charges (ed-market's bidding keeps its own Stripe code), order models, staff screens, emails.

## What was checked before building (2026-11-16/17)

1. **Callbacks inside the settling transaction (decision 5).** A component mutation calls a host
   `internalMutation` through a `createFunctionHandle` string with `ctx.runMutation`, in the same
   transaction; when the handle throws, the component catches it and only the handle's writes roll
   back. _Tested_ in convex-test 0.0.71 and on a local anonymous backend (convex 1.50). The error
   arrives as `"Uncaught Error: <message>\n    at handler (...)"`; the library keeps the message.
   So "paid" and the host's order are written together or not at all, and no outbox is needed.
2. **Stripe** (docs.stripe.com, API `2026-10-28.endive`, pinned in `STRIPE_API_VERSION`): that
   version removed `payment_method_types` from Checkout Sessions; the library sends
   `allowed_payment_method_types`, which only offers methods switched on in the Dashboard. Webhook
   signatures: HMAC-SHA256 of `<t>.<raw body>` with the endpoint secret, any `v1` entry, 5-minute
   tolerance, unknown entries ignored. `charge.refunded` no longer lists refunds, so the library
   fetches them. _Tested against Stripe test mode_ with the built core: creating card and
   `us_bank_account` sessions, retrieving, expiring, listing, the 404 and "already expired" errors,
   and that an idempotency key reused with different parameters is refused (so the library builds a
   request's parameters once).
3. **PayPal** (OpenAPI specs from developer.paypal.com: Orders 2.36, Payments v2, Webhooks v1,
   Transaction Search v1): orders use `payment_source.paypal.experience_context` (the old
   `application_context` is deprecated) and come back `PAYER_ACTION_REQUIRED` with a `payer-action`
   link; `PayPal-Request-Id` makes create, capture and refund safe to repeat; a second capture is
   422 `ORDER_ALREADY_CAPTURED`; the v2 capture failure event is `PAYMENT.CAPTURE.DECLINED`
   (`DENIED` is v1; both are handled). _Tested against the sandbox_ with the built core: token,
   create (and the same order back for the same request id), get, capture of an unapproved order
   (422 `ORDER_NOT_APPROVED`), 404 for an unknown capture, verify-webhook-signature with the raw body
   spliced in (answers `FAILURE` for a made-up signature), and Transaction Search answering 403
   `NOT_AUTHORIZED` on an app without it.
4. **Not verified against the processors** (no browser in the loop, and the test keys lack some
   permissions; see "Fixtures"): a completed Stripe payment and its webhook, Stripe refunds and
   disputes, a PayPal approval, capture and refund, and the real `verify-webhook-signature` accepting
   a genuine delivery. These are covered by the fakes and by the live-mode run below.

## Layout

```
src/core       pure TypeScript, no Convex: fees, types, the processors' wire code     @earthdance/payments/core
src/component  the Convex component: tables, queries, mutations; no network, no secrets, no routes, no crons
src/client     what the app's convex/ code imports: Payments, callback validators     @earthdance/payments
src/test.ts    convex-test registration, fake Stripe and PayPal, fixtures             @earthdance/payments/test
example/convex a minimal app wired up the way an app should be (typechecked in check)
```

## How it works

- **Checkout states.** `created` (row made) → `pending` (buyer sent to the processor) → `paid`.
  A bank payment goes `pending` → `processing` → `paid` or `failed`. Unpaid past `expiresAt` →
  `abandoned`. Paid but refused by the app (or the amount isn't what was asked) → `refund_needed`.
  Partly refunded and refunded are read from `refundedCents`. Every transition answers
  `already_handled` when the row has moved on, so webhooks, the return page and the sweep can race.
- **Callbacks.** `start` takes the app's internal mutations (`onPaid`, `onFailed`, `onRefunded`,
  `onRefundNeeded`, `onDispute`) and stores them as function handles. The component calls them
  inside the transaction that records the change. `onPaid` returns `null` to accept or
  `{ refuse: 'why' }`; refusing or throwing (its writes roll back) makes the checkout
  `refund_needed`, records a refund for the whole amount and calls `onRefundNeeded`. A throw in any
  other callback opens a `callback_failed` issue and the change stands.
- **Tags.** Every checkout carries the app's name: Stripe `metadata.app` (and `client_reference_id`
  = the checkout id, also on the PaymentIntent's metadata), PayPal `custom_id` = `<app>:<checkoutId>`,
  refunds likewise. A webhook for anything without this app's tag, or for an id the component
  doesn't know, is answered 200 and recorded as `foreign`, never retried (fix c). Apps can share
  one processor account.
- **Webhooks.** Each route checks the signature (400 if bad), records the event id (a repeat of a
  handled one gets 200 at once), then acts. A failure after the check answers 500 so the processor
  retries; the event stays "received" so the retry acts again. Stripe: `checkout.session.completed`,
  `checkout.session.async_payment_succeeded` / `_failed`, `checkout.session.expired`,
  `charge.refunded`, `refund.created` / `.updated` / `.failed`, `charge.dispute.created` / `.closed`;
  anything else, and anything foreign, goes to `onUnhandledStripeEvent`. PayPal:
  `CHECKOUT.ORDER.APPROVED` (captured at once: fix a), `PAYMENT.CAPTURE.COMPLETED` / `.PENDING` /
  `.DECLINED` / `.DENIED`, `PAYMENT.CAPTURE.REFUNDED` / `.REVERSED`, `CUSTOMER.DISPUTE.CREATED` /
  `.RESOLVED`.
- **Return page.** `completeReturn` settles from the processor when the webhook hasn't come yet;
  PayPal captures only an `APPROVED` order, and `ORDER_ALREADY_CAPTURED` means "fetch the order and
  settle from it" (fix b).
- **Refunds** are a ledger (many per checkout): requested → approved → sending → sent, or failed
  (send again), or recorded as done by hand, or dismissed. Amounts are checked against paid −
  refunded − in progress. The processor call is keyed by the refund id, so sending again after a
  failure or a crash never refunds twice. Refunds made in a dashboard arrive by webhook (or the
  nightly comparison) and are added as `external`; one already recorded by hand is linked, not
  counted twice. Paid checkouts and refunds are never deleted.
- **Sweep** (every 10 minutes): PayPal checkouts pending over 5 minutes are captured if approved
  (fix a, when the webhook never came); expired ones are abandoned (Stripe sessions expired at
  Stripe first, or settled if they were paid after all); refunds left sending over 10 minutes are
  checked with the processor.
- **Reconcile** (nightly, last 3 days): Stripe sessions and refunds tagged for the app against the
  component, both ways; PayPal orders of the window fetched and compared; PayPal Transaction Search
  for captures tagged for the app that the component lacks, skipped (logged, asked again a day later)
  when PayPal refuses. Differences are `issues` (`missing_here`, `missing_there`, `amount_differs`,
  `status_differs`); one that goes away is resolved. Missed refunds are recorded on the way.
- **Rate limit** on `start`: per key (e.g. the buyer's email, 5 per 10 minutes) and in all (30 a
  minute), configurable.
- **The PayPal token** is cached in the component, encrypted with the client secret, until five
  minutes before it expires.
- **Fees** are configuration per processor and method; the defaults are Stripe's published US rates
  (card 2.9% + 30¢, ACH 0.8% capped at $5) for all of them, PayPal included.

## Using it in an app

The example app (`example/convex`) is the reference.

```ts
// convex/convex.config.ts
import payments from '@earthdance/payments/convex.config.js'
app.use(payments)

// convex/payments.ts (annotated, to break the type cycle through paymentsWorker.ts)
export const payments: Payments = new Payments(components.payments, {
  app: 'market',
  siteUrl: () => process.env.SITE_URL!,
  stripe: () => (process.env.STRIPE_SECRET_KEY ? { secretKey: process.env.STRIPE_SECRET_KEY, webhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? '' } : null),
  paypal: () => ({ clientId, clientSecret, webhookId, apiBase: PAYPAL_LIVE_API }),
  fees: { paypal: { card: { basisPoints: 199, fixedCents: 49, capCents: null } } }, // PayPal's real rates
  limits: { perKey: 5, windowMinutes: 10, globalPerMinute: 30 },
})

// convex/paymentsWorker.ts, and the crons
export const { sweep, reconcile, cleanup } = payments.worker()
crons.interval('payments sweep', { minutes: 10 }, internal.paymentsWorker.sweep, {})
crons.daily('payments reconcile', { hourUTC: 9, minuteUTC: 0 }, internal.paymentsWorker.reconcile, {})

// convex/http.ts
payments.registerRoutes(http, { onUnhandledStripeEvent: async (ctx, event) => { ... } })

// an action that starts a checkout
const { redirectUrl } = await payments.start(ctx, {
  ref: { type: 'offering', id }, purpose: 'order', description: title, amountCents, processor: 'paypal', method: 'card',
  payer: { name, email }, returnPath: `/checkout/${id}/return`, cancelPath: `/checkout/${id}`, expiresAt, limitKey: email,
  context: { ...what onPaid needs }, onPaid: internal.orders.onCheckoutPaid, onRefundNeeded: internal.orders.onRefundNeeded,
})
// with internalMutation({ args: paidArgs, returns: paidReturns, handler }) and the other *Args validators

// the return page's action: Stripe appends ?session_id=, PayPal ?token=
await payments.completeReturn(ctx, { processor: 'paypal', token })
```

```ts
// in a convex-test suite
import paymentsTest, { fakePaypal, fakeStripe } from '@earthdance/payments/test'
const t = convexTest(schema, modules)
paymentsTest.register(t)
const pp = fakePaypal()
const stripe = fakeStripe({ fallback: pp.fetch })
vi.stubGlobal('fetch', stripe.fetch)
await t.fetch('/paypal/webhook', pp.approve(orderId)) // the buyer approved
await t.fetch('/stripe/webhook', await stripe.pay(sessionId)) // signed with FAKE_STRIPE_WEBHOOK_SECRET
```

## API

### `@earthdance/payments`

`new Payments(components.payments, options)`; options: `app`, `siteUrl`, `stripe`, `paypal`,
`fees`, `limits`, `brandName`, `fetch` (tests).

| Method                                                                          | From             | Does                                                                                                                                        |
| ------------------------------------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `start(ctx, args)`                                                              | action           | Makes the checkout and the processor's; returns `{ checkoutId, redirectUrl }`.                                                              |
| `completeReturn(ctx, { processor, token })`                                     | action           | For the return page: settles if the processor says so; `{ checkoutId, ref, status }` or null.                                               |
| `status` / `get(ctx, id)`, `forRef(ctx, ref)`, `byPaymentRef`, `list`           | query            | Checkouts.                                                                                                                                  |
| `registerRoutes(http, { stripePath, paypalPath, onUnhandledStripeEvent })`      | –                | The webhook routes (or call `handleStripeWebhook` / `handlePaypalWebhook` from your own).                                                   |
| `requestRefund`, `approveRefund`, `markRefundedManually`, `dismissRefund`       | mutation         | The ledger; `by` is recorded, who may is the app's check.                                                                                   |
| `sendRefund(ctx, refundId, { skipApproval, by })`                               | action           | Through the processor, keyed by the refund id.                                                                                              |
| `openRefunds`, `refundsFor(ctx, checkoutId)`, `refund(ctx, id)`                 | query            | Refunds.                                                                                                                                    |
| `sweep(ctx)`, `reconcile(ctx, { days })`                                        | action           | Upkeep; `worker()` wraps them (and `cleanup`) as internal functions for crons.                                                              |
| `cleanup(ctx)`                                                                  | mutation         | Deletes abandoned/failed checkouts after the retention (90 days), events after 30 days, resolved issues after 180; `more` means call again. |
| `unreportedIssues` / `markReported`, `issues`, `openIssueCount`, `resolveIssue` | query / mutation | Issues, and a digest's bookkeeping.                                                                                                         |
| `settings` / `updateSettings`                                                   | query / mutation | Retention days.                                                                                                                             |
| `feeSchedule(processor, method)`, `fees`                                        | –                | This app's fee rates.                                                                                                                       |

Callback validators: `paidArgs` + `paidReturns`, `failedArgs`, `refundedArgs`, `refundNeededArgs`,
`disputeArgs` (and their types `Paid`, `Failed`, ...). `errorText`, `PAYPAL_LIVE_API`,
`PAYPAL_SANDBOX_API`.

### `@earthdance/payments/core`

Fees (`feeRates`, `feeSchedule`, `estimateProcessingFee`, `grossUpForProcessingFee`,
`processingFeeFor`, `processingFeeFromAmounts`, `compareProcessingFees`, `isLargeTransaction`,
`DEFAULT_FEE_RATES`, `STRIPE_CARD_RATE`, `STRIPE_ACH_RATE`, `NO_FEE`), money (`centsToDecimal`,
`decimalToCents`, `dollars`, `assertCents`), tags (`tagFor`, `parseTag`), `ProcessorError`, and the
wire code (`stripe.*`, `paypal.*`, `verifyStripeSignature`, `signStripePayload`,
`verifyPaypalWebhook`, `searchTransactions`, parsers).

### `@earthdance/payments/test`

`register(t, name = 'payments')`, `fakeStripe()`, `fakePaypal()`, the fixtures and the
`stripeEvent` / `paypalEvent` builders.

## Fixtures

`src/testing/fixtures/{stripe,paypal}/*.json`; each says where it came from in `_source`.

- **Captured** from Stripe test mode (API `2026-10-28.endive`) with ed-market's test key: open card
  and ACH sessions, an expired session, a session list, a PaymentIntent with its charge, the 404 and
  "can't expire" errors. From the PayPal sandbox: a created order, an unapproved order, the 422
  `ORDER_NOT_APPROVED`, the 403 from Transaction Search and the `FAILURE` from verification.
- **Built** from those real objects with fields changed as the processor documents, because the
  Stripe test key has no Events, Charges or Refunds permission (so no real events or refunds could
  be read) and a PayPal approval needs a buyer in a browser: the Stripe `checkout.session.*`,
  `charge.refunded`, `refund.*` and `charge.dispute.*` events; PayPal's approved order,
  `CHECKOUT.ORDER.APPROVED`, `ORDER_ALREADY_CAPTURED` and the dispute events.
- **Documented samples** from PayPal's OpenAPI specs: the captured order and the
  `PAYMENT.CAPTURE.*` events (with `custom_id` added). Stripe's documented refund object.
- Scrubbed of account ids, emails, merchant and payer ids. Signatures in tests use a test secret.

## Setting up an app's processors

**Stripe** (Dashboard → Developers → Webhooks; one endpoint per deployment):

- Endpoint `https://<deployment>.convex.site/stripe/webhook`, events: `checkout.session.completed`,
  `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`,
  `checkout.session.expired`, `charge.refunded`, `refund.created`, `refund.updated`, `refund.failed`,
  `charge.dispute.created`, `charge.dispute.closed`, plus whatever the app's own handler needs
  (ed-market: `payment_intent.succeeded`, `payment_intent.processing`, `payment_intent.payment_failed`).
- A restricted key needs write on Checkout Sessions and PaymentIntents, write on Charges and Refunds
  (refunds), and read on Disputes and Events. ed-market's current test key lacks Charges/Refunds and
  Events.
- ACH: switch on "ACH Direct Debit" under Payment methods, or Stripe won't offer it.
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` on the deployment.

**PayPal** (developer.paypal.com → Apps & Credentials → the app):

- Webhook `https://<deployment>.convex.site/paypal/webhook`, events: `CHECKOUT.ORDER.APPROVED`,
  `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.PENDING`, `PAYMENT.CAPTURE.DECLINED`,
  `PAYMENT.CAPTURE.DENIED`, `PAYMENT.CAPTURE.REFUNDED`, `PAYMENT.CAPTURE.REVERSED`,
  `CUSTOMER.DISPUTE.CREATED`, `CUSTOMER.DISPUTE.RESOLVED`. Its id is `PAYPAL_WEBHOOK_ID`.
- Transaction Search: tick it under the app's features ("Transaction search"); without it the
  nightly comparison can't find PayPal payments the app never heard of, and says so in the logs.
  New permissions can take a few hours to reach existing tokens.
- `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID`, `PAYPAL_API_BASE`
  (`https://api-m.paypal.com` live, `https://api-m.sandbox.paypal.com` sandbox).
- Pass PayPal's real rates in `fees.paypal` once known.

## Live-mode run (before relying on it)

Per processor and method (Stripe card, Stripe ACH, PayPal): with live keys and the webhooks above
registered on the live deployment, and ed-market temporarily sending one card payment to Stripe
(its cards normally go to PayPal):

1. Pay a small real amount (e.g. $1.00). The return page shows it paid; the app's order exists.
2. In the processor's dashboard, the webhook was delivered once with 200 (a redelivery from the
   dashboard answers "Already handled").
3. Refund part of it from the app's refund page. The processor shows the refund; `refundedCents`
   and the ledger agree; the refund webhook didn't add a second row.
4. Refund the rest. The app's order is marked refunded (ed-market's `onRefunded`).
5. Next morning, after the nightly comparison: no open issues for these payments.
6. PayPal only: approve on PayPal's page and close the tab before returning; within 10 minutes the
   sale is recorded (the approval webhook, or the sweep). Then reload the return page: it shows the
   payment, no error.
7. Stripe ACH: the order waits as processing until Stripe's `async_payment_succeeded` (days).
8. Check the fee recorded (`processorFeeCents`) against the processor's.

## Developing

```sh
npm install
npm run build:codegen   # after changing component functions: regenerates src/component/_generated, then builds
npm run check           # typecheck (with the example, through dist), lint, format check, tests
```

`build:codegen` and `npx convex codegen` (for `example/convex/_generated`) need a deployment. This
repo uses an anonymous local one (no Convex account, no quota): the first time,
`CONVEX_AGENT_MODE=anonymous npx convex dev --once` creates it and writes `.env.local`; it runs on
ports 3410/3411 (moved there in `.convex/local/default/config.json` and `.env.local`) so it doesn't
collide with ed-mail's (3400) or ed-schedule's (3210 and up).

## Releasing

```sh
npm run release -- 0.1.0
```

From a clean branch: builds, runs every check, commits the version bump, puts the tag on a commit
just past it that adds `dist`, and pushes both. Branches never hold `dist`. Apps install the tag:
`npm install github:adamaviner/ed-payments#v0.1.0` (pnpm: `pnpm add github:adamaviner/ed-payments#v0.1.0`).
