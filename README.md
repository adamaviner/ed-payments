# @earthdance/payments

Payments for Earthdance's Convex apps: Stripe and PayPal checkouts, saved cards and bank accounts
charged with nobody present, the buyer paying on the app's page after a decline, both processors'
webhooks, a refund ledger, disputes, a sweep for payments nobody finished, and a nightly comparison
with the processors. One npm package holding a Convex component (the tables) and the client code
apps call from their `convex/` folder (the network calls). Shaped like `@earthdance/mail`.

**The library owns every payment path:** API calls, retries, idempotency, webhooks, refunds,
disputes and reconciliation. An app prices things, keeps its own records and decides what a payment
means for them, in callbacks. It never calls Stripe or PayPal itself. The rules an app (and a
coding agent working in it) follows are in [`AGENTS.md`](AGENTS.md), shipped in the package.

**Status:** v0.6: payments in USD, one-off and monthly (schedules): hosted and embedded checkouts (Stripe Checkout, PayPal), saved
methods charged off-session (Stripe cards and bank accounts, PayPal-vaulted cards and PayPal accounts), on-session retries. Not here: subscriptions, order models, emails.
The plans it was built from are ed-schedule's `payments_library_plan.md` (v0.1) and the v0.2 plan
("own all payment paths, bids included").

## Adopt in 5 steps

The example app (`example/convex`) is a complete host; these are its files.

**1. Install and mount.** `npm install github:adamaviner/ed-payments#v0.2.1` (pnpm: `pnpm add ...`).

```ts
// convex/convex.config.ts
import payments from '@earthdance/payments/convex.config.js'
app.use(payments)
```

**2. Define it** in `convex/payments.ts`, with every callback (all are required) and your admin check:

```ts
import { definePayments, fromEnv } from '@earthdance/payments'

export const paymentContext = v.union(v.object({ itemId: v.string() }), v.object({ bidId: v.id('bids') }))

export const payments = definePayments(components.payments, {
  app: 'shop', // tags everything at the processors; apps can share an account
  context: paymentContext, // what every payment carries for the callbacks; checked at start
  stripe: fromEnv.stripe(), // STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, checked against PAYMENTS_MODE
  paypal: fromEnv.paypal(), // PAYPAL_CLIENT_ID, _SECRET, _WEBHOOK_ID, PAYPAL_API_BASE
}).withCallbacks({
  on: { paid: internal.shop.onPaid, failed: ..., refunded: ..., refundNeeded: ..., dispute: ..., processing: ..., issues: ... },
  authorize: { admin: internal.shop.isAdmin }, // internal query: { name } or null; optional request (may only ask for refunds) and stepUp (a second check before money moves)
  worker: internal.payments, // where the worker functions below are exported
})

export const { sweep, reconcile, cleanup, issuesDigest, charge, schedules } = payments.worker() // schedules: only with schedules
export const { completeReturn, cancelCheckout } = payments.publicApi()
```

Two calls, not one: the references in `withCallbacks` name the app's own modules, this one included,
so a single generic call would infer its type from itself (TypeScript's TS7022). The first call fixes
the types; the second has nothing to infer. No type annotations are needed anywhere.

**3. Write the callbacks** as internal mutations with the library's argument validators, typed with
your context. Each runs inside the transaction that records the payment: `onPaid` writing the order
and the library marking it paid happen together or not at all.

```ts
export const onPaid = internalMutation({
  args: payments.args.paid,
  returns: paidReturns,
  handler: async (ctx, a): Promise<PaidResult> => {
    // a.context is typed; return { refuse: 'why' } (or throw) and the money is owed back as a refund
    await ctx.db.insert('orders', { ... })
    return null
  },
})
// payments.args.failed, .refunded, .refundNeeded, .dispute, .processing, .issues likewise
```

**4. Routes, crons and the admin page's functions:**

```ts
// convex/http.ts
payments.registerRoutes(http) // /stripe/webhook, /paypal/webhook; refuses a live deployment set up wrongly
// convex/crons.ts
payments.registerCrons(crons) // sweep every 10 minutes; reconcile, issues digest, cleanup nightly; schedules hourly (when exported)
// convex/paymentsAdmin.ts (Convex registers only top-level exports, so they are named)
export const { access, openRefunds, refundable, issues, openCount, checkout, requestRefund, approveRefund, sendRefund, markRefundedManually, dismissRefund, resolveIssue, retryCharge, giveUpCharge } =
  payments.adminApi({ skipApproval: true })
// optional: export paypalHistory too, for an admin page searching PayPal by email (see API)
```

**5. Take payments** from your own actions, priced on the server:

```ts
// a hosted checkout
const { redirectUrl } = await payments.start(ctx, {
  ref: { type: 'item', id },
  purpose: 'order',
  description,
  amountCents,
  processor: 'stripe',
  method: 'ach',
  payer: { email },
  returnPath: `/items/${id}/thanks`,
  cancelPath: `/items/${id}`,
  context: { itemId: id },
})
// a saved card: setupPaymentMethod (client secret for Stripe's Payment Element), verifyMethodOwner, then later from a mutation
await payments.chargeSaved(ctx, { ref, purpose: 'bid', description, amountCents, payer, owner: { type: 'user', id }, paymentMethodId, idempotencyKey: `bid-${bidId}`, context: { bidId } })
// or in PayPal's vault, when PayPal is cheaper for the amount (cardProcessorFor): setupPaypalMethod, then
// <PaypalCardFields> / <PaypalSaveButton> in the browser, then savePaypalMethod with the setup token; chargeSaved is the same
// after a decline, the buyer pays on your page (Stripe's Payment Element, or PayPal's buttons with retryWithPaypal)
const { clientSecret } = await payments.retryOnSession(ctx, { checkoutId })
```

Then register the webhooks: `npx ed-payments webhooks --stripe https://<deployment>.convex.site/stripe/webhook --env-file .env.local`
(and `--paypal .../paypal/webhook`). In tests: `const { stripe, paypal } = registerPayments(t)` from
`@earthdance/payments/test`.

**Then, in the browser** (optional), the return page and the admin page from
`@earthdance/payments/react`; see "The React package" below.

## The React package (`@earthdance/payments/react`)

Two pieces for an app's React code, over the functions it exported in steps 2 and 4. Its `react` peer
dependency is optional, so an app with no React (or its own pages) needs nothing more. It brings its
own few primitives (plain `button` and `input`, no UI library), styled with Tailwind classes on the
shadcn theme tokens (`bg-muted`, `text-destructive`, ...), so colours come from the app's theme. Add to
the app's main CSS, or Tailwind 4 skips the package's classes:

```css
@source '../node_modules/@earthdance/payments/dist';
```

It knows nothing about the app's login (`auth` goes through to `authorize.admin` as it is), router
or bundler. `example/src` is the reference, typechecked in `npm run check` against the example's api.

**Paying on the app's own page: `PaypalButtons` and `StripeEmbeddedCheckout`.** Start the checkout
with `ui: 'embedded'` (`start` then returns `{ checkoutId, embedded }` instead of `redirectUrl`) and
pass `embedded` to the matching component:

```tsx
const { embedded } = await startHere(args) // the app's action: payments.start(ctx, { ..., ui: 'embedded' })
embedded.processor === 'paypal' ? (
  <PaypalButtons payment={embedded} completeReturn={api.payments.completeReturn} onFallback={redirect} />
) : (
  <StripeEmbeddedCheckout payment={embedded} publishableKey={STRIPE_PUBLISHABLE_KEY} onFallback={redirect} />
)
```

- **PayPal:** its JS SDK (v5 `paypal.Buttons`) for the REST app's client id, which `start` returns
  (public; it also says sandbox or live). The PayPal button and "Debit or Credit Card"; Venmo and Pay
  Later are turned off. The order names no `payment_source`, so the button pressed decides. On
  approval the component calls `completeReturn`, which captures; if PayPal declines the card
  (`INSTRUMENT_DECLINED`) the buyer is told and the buttons restart on the same order. Then it goes to
  `returnPath` with PayPal's token, the page a redirect ends on.
- **Stripe:** a Checkout Session with `ui_mode: 'embedded_page'` (API `2026-10-28.endive` refuses the
  old `embedded`), shown with `createEmbeddedCheckoutPage` from `https://js.stripe.com/endive/stripe.js`.
  Pass the app's publishable key. Stripe sends the buyer to `returnPath` (with `session_id`) when paid.
- **When a script doesn't load** (an ad blocker, a slow connection: 8 seconds), the component offers
  "Pay on PayPal's/Stripe's site instead", calling `onFallback`. The app starts the same purchase as a
  redirect and sends the buyer there. A script with no answer at all is given up after 30 seconds
  (shown as not loaded), so it never holds up the next embedded form on the page.
- **When the buyer goes back to change their choices** (an Edit button), call
  `cancelCheckout({ checkoutId })` from `publicApi()` (or `payments.cancel(ctx, checkoutId)` from
  the app's own action) with the id `start` returned. The Stripe session is expired at Stripe, the
  checkout is abandoned at once (a PayPal order is then never captured), and the start is given back
  to the buyer's own rate limit, once. A checkout paid in the meantime is settled as paid instead.
  Call it for the unused embedded checkout after `onFallback` too.
- Webhooks, refunds, the sweep and the comparison treat these checkouts like any other.

**The return page: `useCheckoutReturn(completeReturn, { processor, token })`.** The app reads the
token from its own URL (Stripe adds `session_id`, PayPal adds `token`) and words every state itself.
The hook asks `completeReturn` once: StrictMode's double effects and two mounts at once share one
call; a reload asks again, which the library answers the same. It returns one of

| `state`                                                          | Means                                                                                                                                                                                                   |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `checking`                                                       | Asking.                                                                                                                                                                                                 |
| `paid`                                                           | The app recorded the sale.                                                                                                                                                                              |
| `processing`                                                     | A bank payment on its way (days).                                                                                                                                                                       |
| `refund_needed`                                                  | The money arrived but the app refused the sale (sold out); it is owed back.                                                                                                                             |
| `failed`                                                         | The processor said no.                                                                                                                                                                                  |
| `cancelled`                                                      | Nothing paid, at least not yet: the buyer turned back (PayPal sends its token to the cancel page too), it expired, or (rarely) the processor is still finishing it; the callbacks say if it pays later. |
| `error` with `reason`: `no_token`, `not_found`, `request_failed` | No token in the address, not one of this app's payments, or the call failed (`error`).                                                                                                                  |

with `purpose` and `ref` on the settled states, and `retry()` to ask again after `request_failed`
(each call counts against the few the library allows per token).

```tsx
const params = new URLSearchParams(location.search) // or the router's
const sessionId = params.get('session_id')
const result = useCheckoutReturn(api.payments.completeReturn, sessionId ? { processor: 'stripe', token: sessionId } : { processor: 'paypal', token: params.get('token') })
if (result.state === 'checking') return <p>Confirming your payment…</p>
```

**The admin page: `<PaymentsAdminPage>`.** Three parts: refunds to do (approve, send, mark refunded
elsewhere, don't refund), paid payments to refund in full or in part, and open issues (mark resolved;
for a charge with an unknown outcome, try again or give up). Amounts are typed in dollars and checked
against what is left (paid, less refunded, less open refunds, failed ones included until sent again or
dismissed) before the server checks again; a refund recorded but not sent clears its form and waits in
refunds to do;
anything that moves money asks twice; every action shows its error by its row; nothing changes on the
page until the server says so. `refundQuestion` lets the app ask something before a refund (e.g. "Put
this item back on sale?" when it refunds everything left): the refund waits until one answer is picked,
none is picked for the admin, and the answer is kept on the refund as `hostData[key]` (shown in the
ledger, passed to `on.refunded`).

```tsx
<PaymentsAdminPage
  api={api.paymentsAdmin} // the module from step 4, checked against the library's adminApi
  auth={{ token }} // only for apps with their own session tokens; leave out on Convex auth
  skipApproval // the same as adminApi({ skipApproval }) on the server
  refLink={(ref) => (ref.type === 'item' ? <Link to={`/items/${ref.id}`}>The item</Link> : null)}
  refundQuestion={(checkout, amountCents, leftCents) =>
    amountCents === leftCents
      ? {
          key: 'restock',
          label: `Put “${checkout.description}” back on sale?`,
          options: [
            { value: 'yes', label: 'Yes' },
            { value: 'no', label: 'No' },
          ],
        }
      : null
  }
/>
```

**Who may do what on the admin page.** `authorize.admin` may do everything. An optional
`authorize.request` query (same shape) may see payments and issues and ask for refunds, nothing
more: the page shows it only the refund form (always "Ask to refund") and the list of open refunds.
The page asks `api.paymentsAdmin.access` (`{ level: 'admin' | 'request', name } | null`), so
export `access` too. An optional `authorize.stepUp` query (`{ auth, action: 'approve' | 'send',
refundId }` → null, or a sentence) runs right before a refund is approved or sent. A sentence
refuses with `ConvexError({ code: 'step_up', message })`. Give the page `onStepUp={(action) =>
askForPasskey()}` and it runs the app's check, then tries once more.

**Paying a schedule's first payment by card at PayPal: `<PaypalCardPayment payment={embedded}
completeReturn={api.payments.completeReturn} submitLabel="Give $25 monthly" />`.** It uses PayPal's
Card Fields, loaded under their own namespace. It captures through `completeReturn`, then goes to
`returnUrl`; a declined card is said under the fields.

Also exported: `parseRefundAmount(text, leftCents)`, `refundableCents(checkout, openRefunds)`,
`errorMessage(err)`, and the types (`PaymentsAdminApi`, `CompleteReturnRef`, `OpenRefund`,
`CheckoutSummary`, `PaymentIssue`, `CheckoutReturn`, `RefundQuestion`). For a badge, query `api.paymentsAdmin.openCount`.

## Schedules (monthly charges)

The library charges a saved method every month itself, rather than through Stripe Billing or PayPal
Subscriptions. That gives one mechanism for cards, bank accounts and PayPal accounts at both
processors, lets the amount change without new plans, and avoids Billing's 0.7% fee. What the
processors require, and what was checked against them, is in [`docs/recurring-findings.md`](docs/recurring-findings.md).

**Wiring.** Add three callbacks to `withCallbacks({ on })`: `scheduleCharged`, `scheduleFailed`
and `scheduleChanged`, with `payments.args.scheduleCharged` and the others as their `args`.
Export `schedules` from `payments.worker()`. `registerCrons` then runs it hourly, at minute 5.
`definePayments({ schedules: { hourUTC, retryDays } })` changes the charge hour (default 15 UTC)
and the retry days (default `[3, 5, 7]`).

```ts
// A payer with a saved method (savedMethods / verifyMethodOwner): first charge now, then monthly
const { scheduleId, checkoutId } = await payments.startSchedule(ctx, { owner, ref, purpose: 'donation', description, payer, amountCents, context, paymentMethodId })
// A new payer: the first payment saves the method. The app picks the processor, e.g. the cheaper for the monthly amount
const processor = payments.cardProcessorFor(amountCents).processor
const { scheduleId, checkoutId, embedded } = await payments.startScheduleCheckout(ctx, {
  owner,
  ref,
  purpose,
  description,
  payer,
  amountCents,
  context,
  processor,
  method: 'card',
  returnPath,
  cancelPath,
})
// later, from the app's own (signed-link) pages
await payments.updateSchedule(ctx, { scheduleId, amountCents, paymentMethodId, anchorDay, by })
await payments.pauseSchedule(ctx, { scheduleId, until, by })
await payments.resumeSchedule(ctx, { scheduleId, by })
await payments.cancelSchedule(ctx, { scheduleId, reason, by })
await payments.schedulesFor(ctx, owner) // also schedulesForRef(ref), getSchedule(id)
```

- **Charges.** Each period ('YYYY-MM', UTC) is charged on the anchor day (1-28; the default is the
  first charge's day, kept to 28) at the charge hour.
  - Each charge is an ordinary off-session checkout tagged with the schedule, so `paid`,
    `failed`, refunds, disputes, the sweep and the comparison all apply. `scheduleCharged` follows
    `paid`.
  - The idempotency key is `schedule-<id>-<period>` (`-2`, `-3`... for retries, which charge
    nothing twice because each comes only after the try before was refused). A period is never
    charged twice, and a period already paid is never charged again after a resume or a change of
    day.
  - A bank debit moves the schedule on while it is processing. If it bounces later, the schedule
    goes back to that period, unless the next one was already tried.
- **Refusals.** The schedule goes `past_due` and the period is retried 3, 5 and 7 days after the
  first refusal; after the last, the schedule is `lapsed` (`scheduleFailed` with `final: true`).
  - Hard declines lapse it at once: lost, stolen or expired cards, closed bank accounts, revoked
    authorizations, `advice_code: do_not_try_again`, and a method that is gone (`METHOD_REMOVED`).
  - An insufficient-funds retry moves to the 1st or 15th when one falls within four days after it.
  - `scheduleFailed` gives `attempt`, `final`, `declineCode`, `declineKind` and `nextRetryAt`.
    The app sends its failed-charge email on `attempt === 1`.
  - A new method (`updateSchedule`) on a `past_due` schedule charges the refused period at once.
    On a `lapsed` one, it starts again at the next charge date, like `resumeSchedule`.
- **First payment that saves the method** (`startScheduleCheckout`, embedded by default). The
  schedule is `starting` until that payment is paid (or, for a bank account, on its way). Then
  `scheduleChanged` says `started` and `scheduleCharged` has `first: true`. If the payment never
  completes (the payer pressed Edit and `cancelCheckout` ran, or it expired), `scheduleChanged`
  says `not_started`.
  - **Stripe** (card or `ach`): an embedded Checkout session for the payer's Customer, with
    `setup_future_usage: off_session` (bank accounts verified at once). Checkout tells the payer the
    method is saved, and shows a bank account's mandate. Show it with `StripeEmbeddedCheckout`.
  - **PayPal `paypal`:** the order saves the account (vault with purchase, `RECURRING_PREPAID`).
    `embedded.only === 'paypal'`, and `PaypalButtons` shows the PayPal button alone.
  - **PayPal `card`:** the order saves the card and marks its payment the first of a recurring
    series. `embedded.only === 'card'`; show it with `PaypalCardPayment` (PayPal's Card Fields).
    Later charges are marked RECURRING with the first payment's network reference.
- **Removed at the processor.** `payment_method.detached` (Stripe) or `VAULT.PAYMENT-TOKEN.DELETED`
  (PayPal) cancels every schedule using the method, with `scheduleChanged` showing `by:
'processor'` and a reason. Run the webhook CLI again after upgrading: both events are new.
  `removeSavedMethod` refuses a method a schedule still uses.
- **Statuses:** `starting`, `active`, `paused` (until `pausedUntil`, then active again by
  itself), `past_due`, `lapsed`, `cancelled`. Schedules are kept forever (one row per agreement).

## How it works

- **Checkout kinds.** `hosted` (Stripe Checkout or PayPal), `offSession` (a saved method charged with
  nobody present), `onSession` (the buyer pays with Stripe's Payment Element on the app's page, e.g.
  after a decline). All three are rows in the same table, carry the same tags, and go through the same
  callbacks, refunds, disputes, sweep and comparison.
- **States.** `created` → `pending` (at the processor) → `paid`. A bank payment goes `processing` first
  (days), then `paid` or `failed`. Unpaid past `expiresAt` → `abandoned` (never for off-session
  charges, which end paid, failed or by a person's decision). Paid but refused by the app (or not the
  amount asked) → `refund_needed`, with a refund for the whole amount waiting. Every transition answers
  `already_handled` when the row has moved on, so webhooks, return pages, retries and the sweep can race.
- **Callbacks** are internal mutations, stored as function handles on each checkout and called by the
  component inside the transaction that records the change. `paid` returns `null` or `{ refuse }`;
  refusing or throwing (its writes roll back) makes the checkout `refund_needed` and calls
  `refundNeeded`. A throw in any other callback opens a `callback_failed` issue and the change stands.
  Every callback gets `kind`, `purpose`, `ref`, `payer` and the typed `context`. The `context` is
  checked against the app's validator at `start` / `chargeSaved`, and by Convex when each callback runs.
- **Saved methods.** One Stripe Customer per owner (made with an idempotency key, so two first saves
  make one), a SetupIntent with `usage: off_session`, `allowed_payment_method_types` card and
  `us_bank_account` (Stripe refuses `payment_method_types` since 2026-09-30.endive) and instant bank
  verification. `savedMethods` lists them with a `declined` flag; `verifyMethodOwner` refuses a method
  that isn't the owner's (an id from the browser can't be trusted).
- **PayPal's vault.** `setupPaypalMethod` makes a setup token (Payment Method Tokens v3) tagged with
  the owner (`merchant_customer_id` `<app>.<type>.<id>`, so a token from someone else's browser is
  refused when saved) and, after the first save, their PayPal customer. A card is typed into PayPal's
  Card Fields and checked when saved: `verification_method: SCA_WHEN_REQUIRED` with an
  `experience_context` (without one PayPal neither checks nor approves the card; seen in the sandbox) runs
  a $0 authorization, and 3-D Secure only when the bank asks. A card that fails is refused (422
  `INVALID_PAYMENT_SOURCE`, or `verification_status: FAILED`, deleted again). A PayPal account is
  approved on PayPal's page for unscheduled charges after the fact (`UNSCHEDULED_POSTPAID`, `usage_type:
MERCHANT`). `savePaypalMethod` turns the approved token into a payment token and records it: the
  component's rows are the list (PayPal's own list of a customer's tokens lags by minutes, both ways).
  Ids are `paypal:<payment token id>`, beside Stripe's `pm_…`, so `savedMethods`, `verifyMethodOwner`,
  `removeSavedMethod` and `chargeSaved` take either. `cardProcessorFor(amount)` picks the processor with
  the lower card fee at the app's rates.
- **Off-session charges on PayPal.** An order naming the saved method (`vault_id`; a card also
  `stored_credential` MERCHANT / UNSCHEDULED / SUBSEQUENT), captured at once. Every try sends the same
  `PayPal-Request-Id` (from the charge key), so PayPal makes one order whatever happens. A decline (422
  `INSTRUMENT_DECLINED` and the like, or a capture `DECLINED`) fails it with `declined: true`; a `PENDING`
  capture is `processing` until `PAYMENT.CAPTURE.COMPLETED`; no answer is tried again as for Stripe, then a
  `charge_unknown` issue. Giving up looks at the order if one is known; otherwise the nightly Transaction
  Search catches a capture that turns up.
- **Off-session charges.** `chargeSaved` records the checkout and queues `worker.charge`: a
  PaymentIntent with `off_session`, `confirm` and `error_on_requires_action`, under the app's
  idempotency key. Paid → `paid`; a bank account → `processing`, then the webhook settles it; a decline
  (402 `card_error`, or `authentication_required`) → `failed` with `declined: true`, and the method is
  marked so it isn't offered again. A transient error (no answer, 429, 5xx) is tried again after 1, 2,
  3, 4 minutes; before each new try the customer's PaymentIntents are searched for this checkout,
  because Stripe replays a key's first answer (even a 500), so a new key is used only once nothing was
  found. After five tries, or at once for anything odd, a `charge_unknown` issue asks a person, who
  retries it or gives it up (Stripe is asked first: a charge it shows paid is settled, an open one canceled; otherwise `failed`, and the app decides what next). The sweep leaves charges handed to a person alone. A charge and its on-session retries pay for one thing: a second payment for it is owed back (`refund_needed`), and only one retry can be open at a time. A charge whose queued try died is
  picked up by the sweep after 10 quiet minutes.
- **On-session retries with PayPal.** `retryWithPaypal` makes an order for PayPal's buttons (a PayPal
  account or a card), settled like an embedded checkout. One retry is open at a time: asking for the
  other processor closes the open one (a Stripe PaymentIntent canceled first).
- **On-session retries.** `retryOnSession` makes a PaymentIntent for the same amount (card or bank,
  the buyer's choice), or hands back the one still waiting, so two tabs can't each pay; one already on
  its way is refused. A decline there only notes the error (the buyer tries again on the page); paid,
  processing and a bounced bank payment settle as above. The sweep cancels expired ones at Stripe.
- **Tags.** Stripe `metadata.app` + `metadata.checkoutId` (sessions, their PaymentIntents, direct
  PaymentIntents, refunds), PayPal `custom_id` = `<app>:<checkoutId>`. A webhook for anything without
  this app's tag, or that the component doesn't know, is answered 200 as `foreign`, never retried, and
  handed to `onUnhandledStripeEvent` if the app gave one; so are event kinds the library doesn't know.
- **Webhooks.** Each route checks the signature (400 if bad), records the event id (a repeat of a
  handled one gets 200 at once), then acts; a failure after the check answers 500 so the processor
  retries. The events are `STRIPE_EVENTS` and `PAYPAL_EVENTS` in `@earthdance/payments/core`; the CLI
  registers exactly those.
- **Return page.** `completeReturn` (rate-limited in `publicApi`) settles from the processor when the
  webhook hasn't come: a session, a PaymentIntent (`?payment_intent=` after a bank login or 3-D Secure),
  or a PayPal order (captured only when `APPROVED`; `ORDER_ALREADY_CAPTURED` means fetch and settle).
- **Refunds** are a ledger (many per checkout): requested → approved → sending → sent, or failed (send
  again), recorded as done by hand, or dismissed. Amounts are checked against paid − refunded − in
  progress. Keyed by the refund id, so a double click or a retry refunds once. Refunds made in a
  dashboard arrive by webhook (or the nightly comparison) as `external`. A refund can carry the app's
  `hostData` (`requestRefund({ ..., hostData })`, a few short strings, e.g. an admin's answer), which
  `on.refunded` receives when it is done (also when that request was refunded in a dashboard instead: an
  untagged refund of the same amount closes it); refunds the library or a dashboard made on their own
  have none. `on.refunded` can come twice for one refund (failed at the processor after sending, then
  sent again), so act on it idempotently.
- **Sweep** (every 10 minutes): PayPal approvals whose webhook never came are captured; expired
  checkouts are settled if paid after all, else ended at the processor and abandoned; quiet off-session
  charges are tried again; refunds left sending are checked.
- **Reconcile** (nightly, last 3 days): Stripe sessions, direct PaymentIntents and refunds tagged for the
  app against the component, both ways; PayPal orders of the window; PayPal Transaction Search for
  captures the component lacks (skipped, logged once a day, when PayPal refuses it). Differences are
  issues; one that goes away is resolved. The digest (`issuesDigest`) hands new issues to `on.issues`.
- **Rate limits** on every public entry: `start`, `setupPaymentMethod`, `retryOnSession` and the return
  page. Per signed-in user (else per payer email, or the token on the return page), per window, and for
  everyone together per minute. Defaults 5 per 10 minutes and 30 a minute (the return page four times
  that); `limits` in `definePayments`.
- **Keys** come from `fromEnv`. `PAYMENTS_MODE=live` marks the production deployment: there every set-up
  problem (a test key, the sandbox, a missing webhook secret or id) stops the push with the reason;
  elsewhere live keys or PayPal's live API are refused and the rest is only logged. Keys in the wrong
  mode are refused at every call, not only at start-up. `PAYPAL_API_BASE` unset means the sandbox in
  test mode and live in live mode; any other value is refused.
- **Secrets** are never stored, logged or put in an error: the PayPal token is cached encrypted with the
  client secret; client secrets for the browser are fetched from Stripe each time and handed straight
  back. A test scans every stored row and every log line for them.
- **Fees** are configuration per processor and method; the defaults are Stripe's published US rates
  (card 2.9% + 30¢, ACH 0.8% capped at $5) for all of them, PayPal included.

## What was checked against the processors

- **Stage 0 (v0.1):** a component mutation calls a host `internalMutation` through a function handle in
  the same transaction; when it throws, only its writes roll back (convex-test and a local backend).
- **Stripe test mode** (API `2026-10-28.endive`, `npm run test:sandbox`, 2026-11-17): card and ACH
  Checkout Sessions made, read, expired; a Customer made twice under one idempotency key (one Customer);
  a SetupIntent for off-session use with `allowed_payment_method_types` and instant bank verification;
  `payment_method_types` refused (400); test methods attached and listed; off-session charges paid
  (and the same key replaying the same PaymentIntent), declined (402 `card_error`/`card_declined`, the
  PaymentIntent in the error), needing authentication (402 `authentication_required`), a bank account
  `processing` (no mandate needed for an attached test account); an on-session PaymentIntent made and
  canceled; PaymentIntents listed. **Not possible with ed-market's test key:** refunds and webhook
  endpoints (403 `more_permissions_required`; the suite says so), and reading events.
- **PayPal sandbox** (same day): token, an order made twice under one request id (one order), read,
  capture before approval refused (422 `ORDER_NOT_APPROVED`), `verify-webhook-signature` answering
  `FAILURE` for a made-up signature, Transaction Search refused (403: not enabled on the app), and the
  webhook CLI creating a webhook with exactly `PAYPAL_EVENTS`, leaving it, and removing it.
- **Embedded checkouts** (2026-11-18): an `embedded_page` session made in test mode (a client secret, no
  `url`; `embedded` refused with 400) and a buttons order (no `payment_source`, `application_context`)
  made in the sandbox. Refunds, webhook endpoints and Transaction Search now pass with ed-market's
  updated test keys, and a hosted Stripe bank payment and a PayPal card payment were each paid,
  settled by webhook and refunded in part and in full on ed-market's dev deployment. In a browser on
  ed-market's checkout (dev deployment): Stripe's embedded page mounted (once, under React's
  development double mount: Stripe refuses a second embedded Checkout while one exists) and a bank
  payment made in it with Stripe's test bank, returning to the thank-you page and recorded as an
  order; PayPal's buttons rendered (PayPal and "Debit or Credit Card" only). **Not yet:** a payment
  through PayPal's buttons (PayPal blocks automated browsers; needs a person with a sandbox buyer).
- **Local Convex backend:** the example app pushes and its generated functions run; a deployment with
  `PAYMENTS_MODE=live` and a test Stripe key is refused at push with the reason.
- **Only against the fakes** (no browser in the loop, or no permission): a completed Stripe Checkout
  payment and its webhook, a Payment Element confirm, Stripe refunds and disputes, a PayPal approval,
  capture and refund, a genuine webhook delivery being verified, the Stripe webhook CLI. These are for
  the live-mode run below.

## Layout

```
src/core       pure TypeScript, no Convex: fees, money, types, the processors' wire code, event lists   @earthdance/payments/core
src/component  the Convex component: tables, queries, mutations; no network, no secrets, no routes, no crons
src/client     what the app's convex/ code imports: definePayments, fromEnv, validators                 @earthdance/payments
src/react      the return page hook and the admin page                                                @earthdance/payments/react
src/cli        npx ed-payments webhooks
src/test.ts    register / registerPayments for convex-test, fake Stripe and PayPal, fixtures            @earthdance/payments/test
sandbox/       the real test-mode / sandbox calls (npm run test:sandbox)
example/convex a complete host app (typechecked in check)
example/src    its return page and Admin → Payments (typechecked in check)
AGENTS.md      the rules for apps that use it (shipped in the package)
```

## API

### `@earthdance/payments`

`definePayments(components.payments, options).withCallbacks(wiring)` → `payments`. Options: `app`,
`context` (a validator), `stripe`, `paypal` (`fromEnv.stripe()` / `.paypal()`), `siteUrl` (default
`SITE_URL`), `fees`, `limits`, `brandName`, `fetch` (tests). Wiring: `on` (all seven callbacks),
`authorize.admin`, `worker`.

| Method                                                                                  | From                     | Does                                                                                                                   |
| --------------------------------------------------------------------------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `start(ctx, args)`                                                                      | action                   | A hosted checkout; `{ checkoutId, redirectUrl }`, or with `ui: 'embedded'` `{ checkoutId, embedded }`. Rate-limited.   |
| `cancel(ctx, checkoutId, { limitKey? })`                                                | action                   | Closes an unpaid hosted checkout the buyer won't use (Edit); gives their start back. `{ status }`, or null.            |
| `setupPaymentMethod(ctx, { owner, payer, methods? })`                                   | action                   | `{ clientSecret, stripeCustomerId }` for the Payment Element (`methods: ['ach']`: bank accounts only). Rate-limited.   |
| `setupPaypalMethod(ctx, { owner, payer, kind, description? })`                          | action                   | `{ setupTokenId, clientId }` for `PaypalCardFields` (`kind: 'card'`) or `PaypalSaveButton` (`'paypal'`). Rate-limited. |
| `savePaypalMethod(ctx, { owner, setupTokenId })`                                        | action                   | The saved method; refuses another owner's token or a card that failed its check. Rate-limited.                         |
| `savedMethods(ctx, { owner })`                                                          | action                   | `[{ paymentMethodId, processor, kind, label, declined, createdAt }]` at both processors, newest first.                 |
| `verifyMethodOwner(ctx, { owner, paymentMethodId })`                                    | action                   | The method with its `customerId`, or throws if it isn't the owner's.                                                   |
| `removeSavedMethod(ctx, { owner, paymentMethodId })`                                    | action                   | Deleted from PayPal's vault or detached at Stripe; never offered or charged again.                                     |
| `cardProcessorFor(amountCents)`                                                         | any                      | `{ processor, feeCents: { stripe, paypal } }`: where a card for this amount costs less.                                |
| `startSchedule(ctx, args)` / `startScheduleCheckout(ctx, args)`                         | mutation/action / action | A monthly schedule on a saved method / with a first payment that saves it (see Schedules).                             |
| `updateSchedule`, `pauseSchedule`, `resumeSchedule`, `cancelSchedule`                   | mutation                 | Change, pause, resume, end; `by` is recorded and passed to `scheduleChanged`.                                          |
| `schedulesFor(ctx, owner)`, `schedulesForRef(ctx, ref)`, `getSchedule(ctx, id)`         | query                    | Schedules, ended ones included.                                                                                        |
| `retryWithPaypal(ctx, { checkoutId, returnPath })`                                      | action                   | `{ checkoutId, embedded }` for `PaypalButtons` after a decline. Rate-limited.                                          |
| `chargeSaved(ctx, args)`                                                                | mutation/action          | Queues an off-session charge; the checkout id. Same `idempotencyKey`, same checkout.                                   |
| `retryOnSession(ctx, { checkoutId })`                                                   | action                   | `{ checkoutId, clientSecret }` for the buyer to pay after a decline. Rate-limited.                                     |
| `completeReturn(ctx, { processor, token })`                                             | action                   | Settles if the processor says so; `{ checkoutId, ref, purpose, status }` or null.                                      |
| `status` / `get`, `forRef`, `byPaymentRef`, `list`, `refundable`                        | query                    | Checkouts (`refundable` is paged and indexed).                                                                         |
| `requestRefund`, `approveRefund`, `markRefundedManually`, `dismissRefund`, `sendRefund` | mutation/action          | The ledger; `by` is recorded.                                                                                          |
| `openRefunds`, `refundsFor`, `refund`, `issues`, `openIssueCount`, `resolveIssue`       | query/mutation           | Refunds and issues.                                                                                                    |
| `paypalHistory(ctx, { email, start, end })`                                             | action                   | The PayPal account's whole history (not only this library's) with that address as the other party, newest first.       |
| `registerRoutes(http, { onUnhandledStripeEvent })`, `registerCrons(crons)`              | –                        | Routes (when keys exist; start-up checks) and crons.                                                                   |
| `worker()`, `adminApi({ skipApproval })`, `publicApi()`                                 | –                        | Functions for the app to export (see step 4).                                                                          |
| `sweep`, `reconcile`, `cleanup`, `issuesDigest`                                         | action/mutation          | The upkeep the crons run.                                                                                              |
| `args.paid` … `args.issues`, `paidReturns`                                              | –                        | Callback validators with the app's context (also `callbackArgs(validator)`, and untyped `paidArgs`…).                  |

`adminApi` functions take an optional `auth` argument, passed to `authorize.admin` as it came (for apps
with their own session tokens); apps on Convex auth leave it out, as the caller's identity carries
through. Each refuses with "Only an admin may do this." when the check says no.

`paypalHistory` (an admin function too, not used by `PaymentsAdminPage`, so export it only if you have
a page for it; `PaypalHistoryRef` / `PaypalHistoryLine` from the React package type it) searches with
PayPal's Transaction Search, which needs "Transaction search" on the REST app, keeps three years, is up
to three hours late, and can't filter by email: it reads every 31-day window of the range (four at a
time) and keeps the lines whose payer email matches. PayPal names the other party there whichever way
the money went, so payments in, refunds and payments sent all match; guest card payments (T0005) carry
no email and never do. Each line has PayPal's event code in words (`paypalEventType`), the signed
amount and fee, name, items, subject/note, and a `url` to the transaction on PayPal's site.

### `@earthdance/payments/core`

Fees and money (`feeRates`, `feeSchedule`, `estimateProcessingFee`, `grossUpForProcessingFee`,
`processingFeeFor`, `compareProcessingFees`, `isLargeTransaction`, `LARGE_TRANSACTION_THRESHOLD_CENTS`,
`centsToDecimal`, `decimalToCents`, `dollars`), tags, `ProcessorError` (with `declined`, `retryable`),
the wire code (`stripe.*`, `paypal.*`, signatures, parsers) and `STRIPE_EVENTS` / `PAYPAL_EVENTS`.

### `@earthdance/payments/react`

`PaypalButtons`, `StripeEmbeddedCheckout`, `useCheckoutReturn`, `PaymentsAdminPage` and helpers; see
"The React package" above.

### `@earthdance/payments/test`

`registerPayments(t)` (the component plus fake Stripe and PayPal behind `fetch`), `register(t)`,
`fakeStripe()` (sessions, customers, saved methods with `saveMethod(customer, 'ok' | 'decline' | 'auth' | 'bank')`,
PaymentIntents with `confirm`, `settleBank`, `intentEvent`, refunds, disputes, webhook endpoints),
`fakePaypal()`, the fixtures and event builders. `src/testing/contract.test.ts` checks every fake
answer against a saved real object.

## Fixtures

`src/testing/fixtures/{stripe,paypal}/*.json`; each says where it came from in `_source`.

- **Captured** from Stripe test mode (API `2026-10-28.endive`): sessions, a customer, card and bank
  payment methods and their list, a SetupIntent, off-session PaymentIntents (paid, bank processing),
  an on-session one and its cancel, an expanded one, a list, the 402 decline and authentication errors,
  the 400 for `payment_method_types`, a 403 for a missing permission. From the PayPal sandbox: a created
  order, an unapproved order, `ORDER_NOT_APPROVED`, Transaction Search's 403, verification's `FAILURE`.
- **Built** from those real objects as the processor documents: the Stripe `checkout.session.*`,
  `payment_intent.*`, `charge.refunded`, `refund.*` and `charge.dispute.*` events; PayPal's approved
  order, `CHECKOUT.ORDER.APPROVED`, `ORDER_ALREADY_CAPTURED` and the dispute events.
- **Documented samples:** PayPal's captured order and `PAYMENT.CAPTURE.*` events; Stripe's refund and
  webhook endpoint objects.
- Scrubbed of account ids, key ids, emails, client secrets, merchant and payer ids.

## Setting up an app's processors

Per deployment (dev, prod), on the Convex deployment (`npx convex env set`):

- `PAYMENTS_MODE=live` on production only. `SITE_URL` (the return pages).
- Stripe: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`. A restricted key needs **write** on Checkout
  Sessions, PaymentIntents, SetupIntents, Customers and Refunds, **read** on PaymentMethods (**write**
  for `removeSavedMethod` to detach them; without it they are only hidden), Charges,
  Disputes and Events, and **write** on Webhook Endpoints for the CLI. ACH: switch on "ACH Direct Debit"
  under Payment methods.
- PayPal: `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID`, `PAYPAL_API_BASE`. Tick
  "Transaction search" under the REST app's features (it can take hours to reach tokens). For PayPal's
  vault: the account approved for Expanded Checkout (advanced card payments) and "Save payment methods"
  ticked on the REST app (live and sandbox apps each have their own switches).
- Webhooks, with exactly the library's events:
  `npx ed-payments webhooks --stripe https://<deployment>.convex.site/stripe/webhook --env-file <file>`
  (prints the new `STRIPE_WEBHOOK_SECRET` once) and
  `npx ed-payments webhooks --paypal https://<deployment>.convex.site/paypal/webhook --env-file <file>`
  (prints the `PAYPAL_WEBHOOK_ID`). Run again after upgrading the library; `--extra-events` for events
  the app's own handler needs; `--dry-run` shows what would change; `--remove` deletes it; live keys
  need `--live`. By hand instead: the lists are `STRIPE_EVENTS` and `PAYPAL_EVENTS`. The CLI prints the new Stripe signing secret: run it in your own terminal, not where CI logs are kept.
- Pass PayPal's real rates in `fees.paypal` once known.
- Schedules: export `worker().schedules` and the three schedule callbacks, and register the webhooks again (`payment_method.detached` and `VAULT.PAYMENT-TOKEN.DELETED` are new in v0.6). Saving a PayPal account for recurring charges needs the same billing-agreement (reference transactions) approval as the vault.

## Live-mode run (before relying on it)

Per processor and method (Stripe card, Stripe ACH, PayPal), with live keys, `PAYMENTS_MODE=live`, and
the webhooks registered on the live deployment:

1. Pay a small real amount (e.g. $1.00). The return page shows it paid; the app's record exists.
2. In the processor's dashboard, the webhook was delivered once with 200 (a redelivery answers "Already handled").
3. Refund part of it from the admin page. The processor shows the refund; the ledger agrees; the refund webhook didn't add a second row.
4. Refund the rest. The app's `refunded` callback sees it all back.
5. Next morning, after the comparison: no open issues for these payments.
6. PayPal: approve and close the tab before returning; within 10 minutes the sale is recorded. Reload the return page: no error.
7. Stripe ACH: the payment waits as processing until Stripe settles it (days).
8. **Saved methods:** save a real card through the app's form (a SetupIntent); charge it off-session
   (e.g. a $1 winning bid); the charge settles as paid and the app's record follows. Then save a card
   that will decline (or remove funds), charge it: `failed` with `declined`, the card shown as declined,
   and the buyer's retry page takes a payment on-session. Refund one of them from the admin page.
9. Check the fees recorded (`processorFeeCents`) against the processor's.
10. **PayPal's vault:** save a real card through `PaypalCardFields` and a PayPal account through
    `PaypalSaveButton`; charge each off-session ($1); both settle paid with PayPal's fee recorded (the
    sandbox kept 2.59% + 49¢ on a saved card). Remove one: gone from the bid form and from PayPal. After a
    decline, pay on the retry page with PayPal's buttons.

## Developing

```sh
npm install
npm run build:codegen   # after changing component functions: regenerates src/component/_generated, then builds
npm run check           # typecheck (with the example, through dist), lint, format check, tests
ED_PAYMENTS_SANDBOX_ENV=../ed-market/.env.local npm run test:sandbox   # real test-mode / sandbox calls; test keys only
```

`build:codegen` and `npx convex codegen` (for `example/convex/_generated`) need a deployment. This
repo uses an anonymous local one (no Convex account, no quota): the first time,
`CONVEX_AGENT_MODE=anonymous npx convex dev --once` creates it and writes `.env.local`; it runs on
ports 3410/3411 so it doesn't collide with ed-mail's (3400) or ed-schedule's (3210 and up).
`test:sandbox` runs no files (and says so) without a Stripe test key or PayPal sandbox keys, and
refuses live ones.

## Releasing

```sh
npm run release -- 0.2.0
```

From a clean branch: builds, runs every check, commits the version bump, puts the tag on a commit
just past it that adds `dist`, and pushes both. Branches never hold `dist`. Apps install the tag:
`npm install github:adamaviner/ed-payments#v0.2.0` (pnpm: `pnpm add github:adamaviner/ed-payments#v0.2.0`).
