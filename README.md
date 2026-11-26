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

**Status:** v0.9.2: payments in USD, one-off and monthly (schedules): hosted and embedded checkouts (Stripe Checkout, PayPal), saved
methods charged off-session (Stripe cards and bank accounts, PayPal-vaulted cards and PayPal accounts), on-session retries. Not here: subscriptions, order models, emails.
The plans it was built from are ed-schedule's `payments_library_plan.md` (v0.1) and the v0.2 plan
("own all payment paths, bids included").

## Adopt in 5 steps

The example app (`example/convex`) is a complete host; these are its files.

**1. Install and mount.** `npm install github:adamaviner/ed-payments#v0.9.2` (pnpm: `pnpm add ...`).

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
payments.registerCrons(crons) // sweep every 10 minutes; reconcile, issues digest, cleanup nightly; schedules hourly (with the schedule callbacks)
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
// a saved card: <StripeSaveMethod> in the browser, whose createSetupIntent calls your action around setupPaymentMethod
// (only when the payer submits: it is rate-limited), then verifyMethodOwner with the method onSaved gives you, then later from a mutation
await payments.chargeSaved(ctx, { ref, purpose: 'bid', description, amountCents, payer, owner: { type: 'user', id }, paymentMethodId, idempotencyKey: `bid-${bidId}`, context: { bidId } })
// or in PayPal's vault, when PayPal is cheaper for the amount (cardProcessorFor): setupPaypalMethod, then
// <PaypalCardFields> / <PaypalSaveButton> in the browser, then savePaypalMethod with the setup token; chargeSaved is the same
// after a decline, the buyer pays on your page: <StripeRetryPayment> calling your action around retryOnSession when they
// press Pay, or PayPal's buttons with retryWithPaypal
const { clientSecret } = await payments.retryOnSession(ctx, { checkoutId })
```

Then register the webhooks: `npx ed-payments webhooks --stripe https://<deployment>.convex.site/stripe/webhook --env-file .env.local`
(and `--paypal .../paypal/webhook`). In tests: `const { stripe, paypal } = registerPayments(t)` from
`@earthdance/payments/test`.

**Then, in the browser** (optional), the return page and the admin page from
`@earthdance/payments/react`; see "The React package" below.

## The React package (`@earthdance/payments/react`)

The browser side of the payment paths, for an app's React code, over the functions it exported in steps 2 and 4:

- paying on the app's own page: `PaypalButtons` and `StripeEmbeddedCheckout` (an embedded checkout),
  `PaypalCardPayment` (a schedule's first payment by card at PayPal), `StripeRetryPayment` (a retry after a decline);
- saving a method to charge later: `PaypalCardFields`, `PaypalSaveButton`, `StripeSaveMethod`, and
  `useStripeSetupReturn` for a save that needed a redirect;
- the return page: `checkoutReturnToken` and `useCheckoutReturn`;
- Admin → Payments: `PaymentsAdminPage`, with `parseRefundAmount`, `refundableCents` and `errorMessage`.

Its `react` peer
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
  Money that still arrives after the buyer cancelled (a Stripe payment racing the cancel) is owed back:
  `refund_needed`, never kept. While a PayPal capture is under way the cancel is refused with the
  sentence "This payment is being paid right now…" (show it, then check the checkout again); a
  capture that died more than five minutes ago doesn't block it, PayPal being asked first.
  Call it for the unused embedded checkout after `onFallback` too.
- Webhooks, refunds, the sweep and the comparison treat these checkouts like any other.

**Saving a method and paying a retry with Stripe: `StripeSaveMethod` and `StripeRetryPayment`.**
Stripe's Payment Element (a card or a US bank account), the Stripe counterparts of `PaypalCardFields`.
Show the form first and create the intent on submit: both use Stripe's deferred-intent mode, so the
form shows at once with no SetupIntent or PaymentIntent. When the payer presses the button, Stripe
checks the fields (`elements.submit()`; a typo never makes an intent), then the component calls the
app's action (`createSetupIntent` around `setupPaymentMethod`, `createPayment` around
`retryOnSession`), then Stripe confirms it (a bank login or 3-D Secure in Stripe's window when
needed). Both actions are rate-limited per payer, so making the intent when the form opens would let
merely opening forms use up a payer's tries.

```tsx
<StripeSaveMethod
  publishableKey={STRIPE_PUBLISHABLE_KEY}
  methods={['card', 'ach']} // what the SetupIntent is made for: ['ach'] when cards go to PayPal
  createSetupIntent={() => stripeSetupIntent({ methods })} // the app's action: payments.setupPaymentMethod(ctx, { owner, payer, methods }).clientSecret
  onSaved={(paymentMethodId) => placeBid({ itemId, amountCents, paymentMethodId })} // checks it with verifyMethodOwner
  submitLabel="Place bid"
  note="You’re only charged if you win."
  appearance={theme?.stripe} // const theme = usePageTheme(COLORS), below
/>
<StripeRetryPayment
  publishableKey={STRIPE_PUBLISHABLE_KEY}
  amountCents={bid.amountCents} // the declined charge's amount
  createPayment={() => retryBidPayment({ bidId })} // the app's action: payments.retryOnSession(ctx, { checkoutId }).clientSecret
  onPaid={(outcome) => setDone(outcome)} // 'succeeded', or 'processing' for a bank payment on its way
  submitLabel="Pay $120.00"
/>
```

- **Options from the library.** The Elements options (`saveMethodElementsOptions(methods)`,
  `retryPaymentElementsOptions(amountCents)`, exported) come from the same constants as the intents
  the server makes (`SAVED_METHOD_TYPES`, `SAVED_METHOD_OPTIONS` in `core`): Stripe refuses to
  confirm an intent whose method types or options differ from the form's. Saving is `setupFutureUsage:
'off_session'`, and bank accounts are verified at once (Financial Connections, no micro-deposits).
  Card is listed first.
- **Stripe.js** is loaded from `https://js.stripe.com/endive/stripe.js`, as for the embedded Checkout,
  with the app's publishable key. If it or the element doesn't load, the form says so and its button
  stays off.
- **Errors** (Stripe's, or a throw from the app's callbacks) are shown under the form, and the button
  can be pressed again. When `onSaved` throws after Stripe saved the method (a bid too low, say), the
  next press calls `onSaved` again with the same method rather than saving another, unless the payer
  changed the fields.
- **`appearance`** is Stripe's Appearance API; the frames can't see the page's CSS, so pass literal
  colors, dark ones on a dark page. A new one restyles the form in place, keeping what was typed.
  Rather than copying the palette by hand, read it from the page with `usePageTheme` (below).
- **Redirects.** Cards and instantly verified bank accounts finish on the page (`redirect:
'if_required'`). Should a method need a redirect (some banks' logins do), Stripe comes back to
  `returnUrl` (default: the page) and the forms don't read it: the page checks its address first and
  shows the outcome instead of the form. For a payment, `checkoutReturnToken(location.search)` gives
  `{ processor: 'stripe', token: payment_intent }` for `useCheckoutReturn`, which settles it without
  waiting for the webhook. A form that read the return itself would only see it if the page could show
  the form again, and a page whose form refuses a paid payment (most do) would show that refusal to a
  payer who just paid. For a save, `useStripeSetupReturn(publishableKey, search)` says `saved` (with the
  `paymentMethodId`), `processing`, `failed` or `unknown` (Stripe couldn't say; don't invite another
  save before checking). Pass `search` from the router in a server-rendered app; without it the address is
  read from `window.location` (none on the server, so hydration matches). On `saved`: Stripe saved the method, but what `onSaved` was to do with it (place
  the bid) didn't happen, so say so and let the payer finish with it; `savedMethods` lists it.

**The return page: `useCheckoutReturn(completeReturn, { processor, token })`.** The app reads the
token from its own URL (Stripe adds `session_id`, or `payment_intent` after a Payment Element's
redirect; PayPal adds `token`), most simply with `checkoutReturnToken(search)`, and words every state itself.
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
const back = checkoutReturnToken(location.search) // or the router's search params; null: not a return
const result = useCheckoutReturn(api.payments.completeReturn, back ?? { processor: 'stripe', token: null })
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
The page asks `api.paymentsAdmin.access` (`{ level: 'admin' | 'request', name, skipApproval } | null`), so
export `access` too; whether a refund waits for approval is the server's `adminApi({ skipApproval })`, read from there. An optional `authorize.stepUp` query (`{ auth, action: 'approve' | 'send',
refundId }` → null, or a sentence) runs right before a refund is approved or sent. A sentence
refuses with `ConvexError({ code: 'step_up', message })`. Give the page `onStepUp={(action) =>
askForPasskey()}` and it runs the app's check, then tries once more.

**Paying a schedule's first payment by card at PayPal: `<PaypalCardPayment payment={embedded}
completeReturn={api.payments.completeReturn} submitLabel="Give $25 monthly" />`.** It uses PayPal's
Card Fields, loaded under their own namespace, styled like `PaypalCardFields` (`style` for the frames' colors). It
captures through `completeReturn`, then goes to `returnUrl`. Only a declined card is said under the fields: once
the capture has started, anything else (an error, no answer) also goes to `returnUrl`, whose page asks the server
how it stands, because a capture whose answer was lost may have taken the money.

Also exported: `parseRefundAmount(text, leftCents)`, `refundableCents(checkout, openRefunds)`,
`errorMessage(err)`, and the types (`PaymentsAdminApi`, `CompleteReturnRef`, `OpenRefund`,
`CheckoutSummary`, `PaymentIssue`, `CheckoutReturn`, `RefundQuestion`). For a badge, query `api.paymentsAdmin.openCount`.

### Page colours for the payment fields

Stripe's and PayPal's fields sit in frames that can't see the page's CSS, so they only take literal
colours. `usePageTheme` reads the app's own colour variables from the page and builds both styles, so
there's no second palette to keep in step with the real one:

```tsx
const COLORS: PageColors = { background: '--background', text: '--foreground', mutedText: '--muted-foreground', primary: '--primary', danger: '--destructive', border: '--input', radius: '--radius' }
const theme = usePageTheme(COLORS)
<StripeSaveMethod ... appearance={theme?.stripe} />
{theme && <PaypalCardFields ... style={theme.paypal} />}
```

- Each variable is read from `<html>` (define the tokens on `:root`) and must hold a whole CSS colour:
  `oklch()`, `color(srgb …)`, hex, rgb, hsl. Bare HSL triplets (`0 0% 100%`, used as `hsl(var(--x))`) aren't
  colours on their own and fall back. Each is turned into `rgb()` / `rgba()` by painting it on a 1-pixel
  canvas; colours outside sRGB are clipped. Dark or light is told by the background (by the class when the
  background is see-through), which picks Stripe's `night` or `stripe` base.
- It looks again when the class, `style` or `data-theme` of `<html>`, the stylesheets in `<head>` or the
  system's dark setting change, and paints again only when the variables differ. Stripe restyles in place;
  PayPal's card fields only take a style when made, so they are drawn again, clearing a half-typed card:
  render them once `theme` is defined, so a server-rendered page doesn't draw them twice.
- A variable missing or not a colour, no canvas, or a canvas that hides its pixels: Stripe's own `night` / `stripe` theme, chosen from a
  `dark` / `light` class on `<html>`, else the system setting; never white fields on a dark page.
- On the server it gives `undefined` (there is no page); the browser's first render fills it in.

## Schedules (monthly charges)

The library charges a saved method every month itself, rather than through Stripe Billing or PayPal
Subscriptions. That gives one mechanism for cards, bank accounts and PayPal accounts at both
processors, lets the amount change without new plans, and avoids Billing's 0.7% fee. What the
processors require, and what was checked against them, is in [`docs/recurring-findings.md`](docs/recurring-findings.md).

**Wiring.** Add three callbacks to `withCallbacks({ on })`: `scheduleCharged`, `scheduleFailed`
and `scheduleChanged`, with `payments.args.scheduleCharged` and the others as their `args`.
Export `schedules` from `payments.worker()`. With the three callbacks wired, `registerCrons` runs it hourly, at minute 5.
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
    authorizations, `advice_code: do_not_try_again`, a method that is gone (`METHOD_REMOVED`), and a
    method PayPal never finished saving (`METHOD_NOT_SAVED`, below).
  - An insufficient-funds retry moves to the 1st or 15th when one falls within four days after it.
  - `scheduleFailed` gives `attempt`, `final`, `declineCode`, `declineKind` and `nextRetryAt`.
    The app sends its failed-charge email on `attempt === 1`.
  - Two codes mean nothing was charged (`checkoutId: null`), and are exported from
    `@earthdance/payments/core`: `METHOD_REMOVED` (the saved method is gone: ask for another) and
    `METHOD_NOT_SAVED` (PayPal took the first payment but never finished saving the method: word it
    as "we couldn't save your payment method", not as a failed payment).
  - A new method (`updateSchedule`) on a `past_due` schedule charges the refused period at once.
    On a `lapsed` one, it starts again at the next charge date, like `resumeSchedule`.
- **First payment that saves the method** (`startScheduleCheckout`, embedded by default). The
  schedule is `starting` until that payment is paid (or, for a bank account, on its way). Then
  `scheduleChanged` says `started` and `scheduleCharged` has `first: true`. If the payment never
  completes (the payer pressed Edit and `cancelCheckout` ran, or it expired), `scheduleChanged`
  says `not_started`. If the first payment arrives anyway after the checkout expired (not after the
  payer cancelled it, when it is owed back), the schedule starts after all (`started`).
  - **Stripe** (card or `ach`): an embedded Checkout session for the payer's Customer, with
    `setup_future_usage: off_session` (bank accounts verified at once). Checkout tells the payer the
    method is saved, and shows a bank account's mandate. Show it with `StripeEmbeddedCheckout`.
  - **PayPal `paypal`:** the order saves the account (vault with purchase, `RECURRING_PREPAID`).
    `embedded.only === 'paypal'`, and `PaypalButtons` shows the PayPal button alone.
  - **PayPal `card`:** the order saves the card and marks its payment the first of a recurring
    series. `embedded.only === 'card'`; show it with `PaypalCardPayment` (PayPal's Card Fields).
    Later charges are marked RECURRING with the first payment's network reference.
  - **PayPal saving after the payment.** PayPal may answer the capture with vault status
    `APPROVED` instead of `VAULTED`: paid, but the token comes later in
    `VAULT.PAYMENT-TOKEN.CREATED`. The schedule then starts with `paymentMethodId: null` and waits
    for it instead of failing. The schedules worker reads the first payment's order again (five
    minutes after the capture, then at each hourly run), and attaches the token once the order shows
    it `VAULTED`; it doesn't need the webhook. The event, when it comes first, attaches it too (the
    two together save it once): its token goes to the schedule whose first order it names
    (`metadata.order_id`, not in PayPal's docs), or else to the one schedule of this app waiting
    with that PayPal customer (several waiting: none is guessed). An order that can't be read is
    tried again at the next run. If no token comes within three days, the schedule fails as
    `METHOD_NOT_SAVED` (lapsed, `scheduleFailed` with `checkoutId: null`, `final: true`)
    without charging, so the app asks the payer for another method. A token that comes later still
    is kept as the payer's saved method for `updateSchedule`.
- **Removed at the processor.** `payment_method.detached` (Stripe) or `VAULT.PAYMENT-TOKEN.DELETED`
  (PayPal) cancels every schedule using the method, with `scheduleChanged` showing `by:
'processor'` and a reason. Run the webhook CLI again after upgrading: both events are new.
  `removeSavedMethod` refuses a method a schedule still uses.
- **Statuses:** `starting`, `active`, `paused` (until `pausedUntil`, then active again by
  itself), `past_due`, `lapsed`, `cancelled`. Schedules are kept forever (one row per agreement).
  A charge already on its way when the payer pauses that is then refused (or a bank debit that
  bounces) keeps the pause: `scheduleFailed` says so (`nextRetryAt: null`, `status: 'paused'`), and the
  refused period is charged when the pause ends.

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
  retries it or gives it up (Stripe is asked first: a charge it shows paid is settled, an open one canceled; PayPal's order is read, or without an order id Transaction Search is searched for a capture tagged with the charge, and giving up is refused until three hours after the last try, since PayPal's search lags that much; otherwise `failed`, and the app decides what next). The sweep leaves charges handed to a person alone. A charge and its on-session retries pay for one thing, as does each period of a schedule: a second payment for it is owed back (`refund_needed`), and only one retry can be open at a time. An on-session retry of a schedule's charge pays that period and moves the schedule on; one asked for once the period is paid is refused. A charge whose queued try died is
  picked up by the sweep after 10 quiet minutes.
  A method that isn't saved for the payer (a PayPal token that isn't theirs or isn't recorded, or a
  payer with no Stripe Customer here) isn't thrown: `chargeSaved` records the checkout failed at once,
  `declineCode: 'METHOD_NOT_SAVED'` (`declineKind: 'hard'`, `declined: false`, nothing charged), and
  `failed` runs in that transaction as for a decline, so the payer pays with `retryOnSession` or
  `retryWithPaypal`. The same key returns that checkout, with no second callback.
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
  have none. A refund the processor fails after reporting it done comes to `on.refunded` again with
  `reversed: true` (and `refundedCents` without it); sent again later, it comes once more, so act on it
  idempotently. While a dispute is open on a payment, refunds of it are refused (requesting, sending and
  marking done by hand); each dispute is kept, so a payment is disputed until all of its disputes end,
  and a Stripe dispute lost is taken off what is left to refund (a PayPal one comes back as a refund
  event). Marking a refund done by hand is checked against what is left after refunds in progress.
- **Sweep** (every 10 minutes): PayPal approvals whose webhook never came are captured; expired
  checkouts are settled if paid after all, else ended at the processor and abandoned; quiet off-session
  charges are tried again; refunds left sending are checked.
- **Reconcile** (nightly, last 3 days): Stripe sessions, direct PaymentIntents and refunds tagged for the
  app against the component, both ways; PayPal orders of the window (refunds they list that the ledger
  lacks are recorded, as Stripe's are); PayPal Transaction Search for
  captures the component lacks (skipped, logged once a day, when PayPal refuses it). Differences are
  issues; one that goes away is resolved. The digest (`issuesDigest`) hands new issues to `on.issues`.
- **Rate limits** on every public entry: `start`, `setupPaymentMethod`, `setupPaypalMethod`,
  `savePaypalMethod`, `savedMethods`, `verifyMethodOwner`, `removeSavedMethod`, `retryOnSession`,
  `retryWithPaypal`, the return page and `cancelCheckout`. Per key, per window: the `limitKey` the host
  passes (each of those takes one), else the signed-in user, else the payer's email (the owner, for the
  saved-method lists and checks; the token on the return page); and for everyone together per minute.
  Listing and checking saved methods allow four times as many. A PayPal webhook whose
  `paypal-transmission-time` is more than ten minutes from now is refused (400) before PayPal is asked
  to verify it. Defaults 5 per 10 minutes and 30 a minute (the return page four times
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
               (index.ts the Payments facade; hosted.ts, refunds.ts, sweep.ts, saved.ts, paypalVault.ts,
               schedules.ts the flows; api.ts the generated functions; util.ts leaf helpers)
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

| Method                                                                                  | From                     | Does                                                                                                                                                           |
| --------------------------------------------------------------------------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `start(ctx, args)`                                                                      | action                   | `{ checkoutId, redirectUrl }`; `ui: 'embedded'`: `{ checkoutId, embedded }`; `ui: 'onPage'`: `{ checkoutId, onPage, reused }` (below). Rate-limited.           |
| `cancel(ctx, checkoutId, { limitKey? })`                                                | action                   | Closes an unpaid hosted or on-page checkout the buyer won't use (Edit); gives their start back. `{ status }`, or null.                                         |
| `setupPaymentMethod(ctx, { owner, payer, methods? })`                                   | action                   | `{ clientSecret, stripeCustomerId }`; call it on submit, from `StripeSaveMethod`'s `createSetupIntent` (`methods: ['ach']`: bank accounts only). Rate-limited. |
| `setupPaypalMethod(ctx, { owner, payer, kind, description? })`                          | action                   | `{ setupTokenId, clientId }` for `PaypalCardFields` (`kind: 'card'`) or `PaypalSaveButton` (`'paypal'`). Rate-limited.                                         |
| `savePaypalMethod(ctx, { owner, setupTokenId })`                                        | action                   | The saved method; refuses another owner's token or a card that failed its check. Rate-limited.                                                                 |
| `savedMethods(ctx, { owner })`                                                          | action                   | `[{ paymentMethodId, processor, kind, label, declined, createdAt }]` at both processors, newest first.                                                         |
| `verifyMethodOwner(ctx, { owner, paymentMethodId })`                                    | action                   | The method with its `customerId`, or throws if it isn't the owner's.                                                                                           |
| `removeSavedMethod(ctx, { owner, paymentMethodId })`                                    | action                   | Deleted from PayPal's vault or detached at Stripe; never offered or charged again.                                                                             |
| `cardProcessorFor(amountCents)`                                                         | any                      | `{ processor, feeCents: { stripe, paypal } }`: where a card for this amount costs less.                                                                        |
| `startSchedule(ctx, args)` / `startScheduleCheckout(ctx, args)`                         | mutation/action / action | A monthly schedule on a saved method / with a first payment that saves it (see Schedules).                                                                     |
| `updateSchedule`, `pauseSchedule`, `resumeSchedule`, `cancelSchedule`                   | mutation                 | Change, pause, resume, end; `by` is recorded and passed to `scheduleChanged`.                                                                                  |
| `schedulesFor(ctx, owner)`, `schedulesForRef(ctx, ref)`, `getSchedule(ctx, id)`         | query                    | Schedules, ended ones included.                                                                                                                                |
| `retryWithPaypal(ctx, { checkoutId, returnPath })`                                      | action                   | `{ checkoutId, embedded }` for `PaypalButtons` after a decline. Rate-limited.                                                                                  |
| `chargeSaved(ctx, args)`                                                                | mutation/action          | Queues an off-session charge; the checkout id. Same `idempotencyKey`, same checkout. A method not saved for the payer: failed at once (`METHOD_NOT_SAVED`).    |
| `retryOnSession(ctx, { checkoutId })`                                                   | action                   | `{ checkoutId, clientSecret }` for the buyer to pay after a decline; call it on submit, from `StripeRetryPayment`'s `createPayment`. Rate-limited.             |
| `completeReturn(ctx, { processor, token })`                                             | action                   | Settles if the processor says so; `{ checkoutId, ref, purpose, status }` or null.                                                                              |
| `status` / `get`, `forRef`, `byPaymentRef`, `list`, `refundable`                        | query                    | Checkouts (`refundable` is paged and indexed).                                                                                                                 |
| `requestRefund`, `approveRefund`, `markRefundedManually`, `dismissRefund`, `sendRefund` | mutation/action          | The ledger; `by` is recorded.                                                                                                                                  |
| `openRefunds`, `refundsFor`, `refund`, `issues`, `openIssueCount`, `resolveIssue`       | query/mutation           | Refunds and issues.                                                                                                                                            |
| `paypalHistory(ctx, { email, start, end })`                                             | action                   | The PayPal account's whole history (not only this library's) with that address as the other party, newest first.                                               |
| `registerRoutes(http, { onUnhandledStripeEvent })`, `registerCrons(crons)`              | –                        | Routes (when keys exist; start-up checks) and crons.                                                                                                           |
| `worker()`, `adminApi({ skipApproval })`, `publicApi()`                                 | –                        | Functions for the app to export (see step 4).                                                                                                                  |
| `sweep`, `reconcile`, `cleanup`, `issuesDigest`                                         | action/mutation          | The upkeep the crons run.                                                                                                                                      |
| `args.paid` … `args.issues`, `paidReturns`                                              | –                        | Callback validators with the app's context (also `callbackArgs(validator)`, and untyped `paidArgs`…).                                                          |

**`ui: 'onPage'` and `replaces`.** `start` and `startScheduleCheckout` with `ui: 'onPage'` make the payment when the
payer presses pay on the app's own form, and return `onPage` for the browser: Stripe `{ processor, clientSecret, returnUrl }`
(a PaymentIntent for the one method chosen, `card` or `ach`, confirmed by the Payment Element in deferred-intent mode; on a
schedule's first payment it is the payer's Customer's with `setup_future_usage: 'off_session'`, and the method is saved to
the schedule before the payment settles), or PayPal `{ processor, orderId, clientId, returnUrl, only? }` (the same order as
`ui: 'embedded'`). The checkout's `kind` is `onPage` in the callbacks; its PaymentIntent's webhooks, `completeReturn`
(Stripe's `payment_intent`), the sweep and `cancel` settle or close it. Pass the `checkoutId` the payer's last press got
as `replaces` (each press with it counts against a separate `replace` limit, twice the start limit and keyed by the
checkout it names unless the app gives a `limitKey` or the payer is signed in, before Stripe or PayPal is asked): while that checkout is still open with ten minutes or more left, for the same `ref` and `purpose`, amount,
processor, method, payer, description, context and return page, and the same schedule (a starting schedule of the same owner,
anchor day and context) or none, the same client secret or order comes back with `reused: true` and no start is counted.
Otherwise one for the same `ref` and `purpose` is cancelled (its start given back; a starting schedule ends as
`not_started`), one for another thing is left alone, and a new one started. One for the same `ref` and `purpose` that is paid or on its way is refused ("This is
already paid." / "A payment for this is already on its way."). The new checkout is recorded on the old one (`replacedBy`) in the
transaction that makes it, so two presses naming the same checkout make one: the later press follows `replacedBy` and
reuses that checkout (or, if it differs, replaces it in turn). After a PayPal decline at the capture (`INSTRUMENT_DECLINED`) the same order comes back. When
PayPal won't take it again the library makes a new order under the same checkout, counting no new start, and never captures the
old one; `completeReturn` then answers `declined: true` with `reordered: true`, and the next `start` with `replaces` returns the
new order. That covers a card declined in Card Fields (PayPal answers the capture 201 with the order `COMPLETED` and its capture
`DECLINED`, then takes no other card on that order), `ORDER_ALREADY_CAPTURED` with nothing paid, `MAX_NUMBER_OF_PAYMENT_ATTEMPTS_EXCEEDED`,
`ORDER_EXPIRED`, `ORDER_COMPLETED_OR_VOIDED` with the order unpaid, and an order that is gone.

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
`centsToDecimal`, `decimalToCents`, `dollars`), the saved-method types (`SAVED_METHOD_TYPES`,
`SAVED_METHOD_OPTIONS`, `stripeMethodType`), tags, `ProcessorError` (with `declined`, `retryable`),
the wire code (`stripe.*`, `paypal.*`, signatures, parsers) and `STRIPE_EVENTS` / `PAYPAL_EVENTS`.

### `@earthdance/payments/react`

`PaypalButtons`, `StripeEmbeddedCheckout`, `PaypalCardPayment`, `PaypalCardFields`, `PaypalSaveButton`,
`StripeSaveMethod`, `StripeRetryPayment`, `useStripeSetupReturn`, `useCheckoutReturn`, `checkoutReturnToken`,
`usePageTheme`, `PaymentsAdminPage` and helpers; see
"The React package" above.

### `@earthdance/payments/test`

`registerPayments(t)` (the component plus fake Stripe and PayPal behind `fetch`), `register(t)`,
`fakeStripe()` (sessions, customers, saved methods with `saveMethod(customer, 'ok' | 'decline' | 'auth' | 'bank')`,
PaymentIntents with `confirm`, `settleBank`, `intentEvent`, refunds, disputes, webhook endpoints),
`fakePaypal()`, the fixtures and event builders. `src/testing/contract.test.ts` checks every route a
fake answers, and every webhook body it makes, against a saved real object (`drift`: no invented
fields, no other types, no null where the processor has a value, every list element). The fakes
refuse what the processors refuse: Stripe's 400 `idempotency_error` for a key reused with other
parameters, and PayPal replays a request id's first answer with its first status. The sandbox suites
compare live answers' fields with the fixtures (`keyDiff`), so a stale fixture shows.

## Fixtures

`src/testing/fixtures/{stripe,paypal}/*.json`; each says where it came from in `_source`.

- **Captured** from Stripe test mode (API `2026-10-28.endive`): sessions, a customer, card and bank
  payment methods and their list, a SetupIntent, off-session PaymentIntents (paid, bank processing),
  an on-session one and its cancel, an expanded one, a list, the 402 decline and authentication errors,
  the 400 for `payment_method_types`, the 400 for a reused idempotency key. From the PayPal sandbox: a
  token, a created order, an unapproved order, `ORDER_NOT_APPROVED`, a 404, Transaction Search's rows and
  its 403, the webhooks list, verification's `FAILURE`.
- **Built** from those real objects as the processor documents: the Stripe `checkout.session.*`,
  `payment_intent.*`, `charge.refunded`, `refund.*` and `charge.dispute.*` events; PayPal's approved
  order, `CHECKOUT.ORDER.APPROVED`, `ORDER_ALREADY_CAPTURED` and the dispute events.
- **Documented samples:** PayPal's captured order and `PAYMENT.CAPTURE.*` events; Stripe's refund,
  webhook endpoint and deleted webhook endpoint objects.
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

## Upgrade notes

### v0.10.0 (unreleased)

- **`usePageTheme(colors)`** reads the app's colour tokens from the page and give
  `{ dark, stripe, paypal }`: pass `stripe` as a Stripe form's `appearance` and `paypal` as the card fields'
  `style`. An app with hand-copied palettes (`STRIPE_APPEARANCE`, `PAYPAL_FIELD_STYLE`) can drop them.

### v0.9.2

- **`chargeSaved` no longer throws for a method that isn't saved for the payer** ("That payment method
  isn’t saved for this payer." / "This payer has no saved payment method here."). It returns a checkout
  id as usual, for a checkout already `failed` with `declineCode: 'METHOD_NOT_SAVED'` (`declined: false`,
  nothing charged), and `on.failed` runs for it in that transaction, as for a declined charge; the same
  key returns it again without a second callback. `retryOnSession` and `retryWithPaypal` take it, so the
  payer can pay with another card or PayPal. An app that caught the throw (to ask for another method)
  drops that catch and lets its failed-charge path run; word `METHOD_NOT_SAVED` as "pay with another
  method", not as a declined card. A bad amount, a misused key or a wrong context still throws.

### v0.9.1

- **`registerCrons` adds the hourly `payments schedules` cron only when `on.scheduleCharged`,
  `on.scheduleFailed` and `on.scheduleChanged` are wired.** Before, it added it for every app (the worker
  reference always seems to have `schedules`), so an app without schedules had to export `schedules` from
  `payments.worker()` or its deploys failed. That export can go now; keeping it does no harm.
- **A `v.id()` in the context may have capital letters** (as ids made by convex-test do, ending in the table
  name). v0.9.0 refused them, so a host's tests failed on tables named in mixed case; production ids were fine.

### v0.9.0 (audit fixes)

Nothing to migrate; these change what a host sees:

- **Money on a checkout the buyer cancelled** (`cancelCheckout` / `payments.cancel`) that arrives anyway
  is now `refund_needed` (`on.refundNeeded`), not `paid`. A checkout that only expired still settles as paid.
- **`cancelCheckout` can refuse** while a PayPal capture is under way, throwing "This payment is being paid
  right now…". Show the sentence and check the checkout again.
- **One payment per schedule period:** a second payment for a period is `refund_needed`. An on-session
  retry of a schedule's charge pays that period; asking for one once the period is paid throws "This is already paid."
- **`giveUpCharge` on a PayPal charge with no order id** looks in Transaction Search first and is refused
  until three hours after the charge's last try when nothing shows yet.
- **A charge key reused** for another amount, payment method or `ref` now throws instead of returning
  the first charge.
- **Refunds are refused while a dispute is open**, and a lost Stripe dispute is taken off what is left
  to refund. `on.refunded` may come with `reversed: true` (add nothing to your validator: `payments.args.refunded` has it).
- **Rate limits:** `savedMethods`, `verifyMethodOwner` and `removeSavedMethod` are now limited (per
  owner; the first two at four times the usual number). Every public entry takes an optional
  `limitKey`, which now counts instead of the signed-in user too (`start`'s did only for signed-out payers).
- **A `v.id()` in the context** must look like a Convex id (it was any string).
- **PayPal webhooks** sent more than ten minutes before they arrive are refused (400) without asking PayPal.
- **`compareProcessingFees` steers to ACH on the total paid by card** (the fee included when the buyer covers it), not on the amount before fees. An app that greys out the card option on its own rule should use `steerToAch` so the two agree.
- **Register the webhooks again** (`npx ed-payments webhooks --paypal …`): `VAULT.PAYMENT-TOKEN.CREATED` is
  new. A schedule whose first PayPal payment saves the method after the capture (vault `APPROVED`) waits up to
  three days for the token instead of lapsing at its next charge: the schedules worker reads the order again
  (needs `worker().schedules` exported, as schedules already do), and the event, when it comes, is a faster path.
- **`METHOD_NOT_SAVED`** is a new `scheduleFailed` `declineCode` (`checkoutId: null`, `final: true`):
  that wait ran out. Nothing was charged or refused; word it as a payment method that couldn't be saved,
  not a failed payment, and ask for another method.
- `PaymentsAdminPage` has no `skipApproval` prop: it reads the server's `adminApi({ skipApproval })`
  through the `access` query, so the page and the server can't disagree. Remove the prop (TypeScript
  refuses it now).
- `paypalCardPaySdkUrl` and `paypalVaultSdkUrl` are no longer exported from `@earthdance/payments/react`: the
  components load PayPal's SDK themselves, and an app never should (AGENTS.md rule 1).

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
npm run release -- 0.8.0
```

From a clean branch: builds, runs every check, commits the version bump, puts the tag on a commit
just past it that adds `dist`, and pushes both. Branches never hold `dist`. Apps install the tag:
`npm install github:adamaviner/ed-payments#v0.8.0` (pnpm: `pnpm add github:adamaviner/ed-payments#v0.8.0`).
After a release, update "Status" above and the tag in "Adopt in 5 steps".
