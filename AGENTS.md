# Rules for apps that use @earthdance/payments

For people and coding agents working in an app's `convex/` folder. Copy this section into the app's
own `AGENTS.md` / `CLAUDE.md`, or point to it there: `node_modules/@earthdance/payments/AGENTS.md`.
The README has the API and the "Adopt in 5 steps" set-up.

1. **Never call Stripe or PayPal yourself.** No `api.stripe.com`, `paypal.com`, `stripe` npm package or
   processor SDK in the app's server code. Every payment, saved method, retry, refund, webhook and
   reconciliation goes through the library, which owns the keys, idempotency, retries and the records.
   If the library can't do something you need, add it to the library. In the browser, use the
   library's React components for every Stripe or PayPal form; don't load Stripe.js or
   `@stripe/react-stripe-js` yourself.
2. **Never store card or bank data.** No card numbers, CVCs, bank account numbers or client secrets in
   any table, log or error. Keep only what the library hands back (checkout ids, payment method ids,
   labels like "Visa •••• 4242").
3. **Price on the server, before `start` or `chargeSaved`.** The amount comes from your own records in
   the action or mutation that starts the payment, never from the browser. The `context` you pass is
   for the callbacks; it is checked against your context validator, but it is not a price.
4. **Every money change goes through the ledger.** Refunds are `requestRefund` / `sendRefund` /
   `markRefundedManually` (or the admin page from `adminApi`), never a field you set yourself. What a
   payment means for your records (an order, a bid paid, an item refunded) happens in the callbacks,
   which run inside the library's transaction: write your rows there, and return `{ refuse }` from
   `paid` (or throw) when the sale can't happen, so the money is owed back.
5. **One instance, all callbacks.** `definePayments(...).withCallbacks(...)` once, in `convex/payments.ts`.
   Every callback is required, even if it only logs. Use `payments.args.*` as their `args`.
6. **Who may do what is the app's.** Gate your own actions (`setupPaymentMethod`, `setupPaypalMethod`,
   `savePaypalMethod`, `removeSavedMethod`, `chargeSaved`, `retryOnSession`, `retryWithPaypal`, and every schedule function) with your own login; the admin functions go through `authorize.admin` (and `authorize.request` for those who may only ask for refunds, `authorize.stepUp` for a second check before a refund is approved or sent).
   A `stripeCustomerId` passed to adopt an existing Customer must come from your own records, never
   from the browser: the library records it as that owner's for good.
7. **Webhooks with the CLI.** Register them with `npx ed-payments webhooks`, not by hand, and run it
   again after upgrading the library.
8. **Test through the fakes.** `registerPayments(t)` from `@earthdance/payments/test`; don't mock
   `fetch` or a processor SDK yourself. Use test keys and `PAYMENTS_MODE` unset everywhere but production.
9. **Use the React package for the return page and the admin page** (`@earthdance/payments/react`)
   rather than writing your own: `useCheckoutReturn(api.payments.completeReturn, { processor, token })`
   asks once and gives a state for you to word; `<PaymentsAdminPage api={api.paymentsAdmin} />` does
   refunds (partial ones checked against what is left), approvals and issues. Add
   `@source '../node_modules/@earthdance/payments/dist';` to your CSS. Never show a refund or payment
   as done before the server says so.
10. **Paying on your own page:** with the fields in your own form, `<StripeOnPagePayment>` / `<PaypalOnPagePayment>`
    whose `start` calls your action around `start(ctx, { ..., ui: 'onPage', replaces })` at the press (pass the
    `checkoutId` your last press got as `replaces`; never start when the form opens). Or `start(ctx, { ..., ui: 'embedded' })`, then `<PaypalButtons>` or
    `<StripeEmbeddedCheckout>` with the returned `embedded`; never load PayPal's or Stripe's scripts
    yourself or capture from the browser. Give them an `onFallback` that starts the same purchase as a
    redirect, so a blocked script never strands the buyer. When the buyer leaves the payment step
    (Edit, or the fallback), close the started checkout with `publicApi().cancelCheckout`.
11. **Saving for later in PayPal's vault:** `setupPaypalMethod` in your action, `<PaypalCardFields>` or
    `<PaypalSaveButton>` with the setup token, then `savePaypalMethod` with the id `onSaved` gives you;
    store only the returned `paymentMethodId` (`paypal:…`). Pick where a new card goes with
    `cardProcessorFor(amount)`, not by hand. Before `removeSavedMethod`, check nothing of yours (an open
    bid) still relies on the method. Never send card numbers to your server: Card Fields keep them in PayPal's frames.
12. **Repeating charges are schedules.** Never write your own cron that calls `chargeSaved` every month:
    `startSchedule` (a saved method) or `startScheduleCheckout` (a first payment that saves it) and the
    exported `worker().schedules` own the dates, the idempotency keys, the retries (3, 5, 7 days, then
    lapsed; hard declines at once) and processor-side removal. The processor for a new card is yours to
    choose (`cardProcessorFor` on the monthly amount) and pass in. Record a period in `scheduleCharged`, send
    the failed-charge email from `scheduleFailed` on `attempt === 1` (and staff on `final`), and confirmations
    from `scheduleChanged`. Changes go through `updateSchedule` / `pauseSchedule` / `resumeSchedule` /
    `cancelSchedule`, after your own check that the caller may (e.g. a signed link).

13. **Saving with Stripe, or paying a retry:** show the form first and create the intent on submit.
    Use `<StripeSaveMethod>` (its `createSetupIntent` calls your action around `setupPaymentMethod`) or
    `<StripeRetryPayment>` (its `createPayment` calls your action around `retryOnSession`). Never call
    `setupPaymentMethod` or `retryOnSession` when a form opens: each call makes an intent at Stripe and
    counts against the rate limit, even if the buyer walks away. The page Stripe may redirect back to
    checks its address before loading the form: `checkoutReturnToken` then `useCheckoutReturn` for a
    payment, `useStripeSetupReturn` for a saved method. The forms don't read a return themselves.
