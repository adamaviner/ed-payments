# Rules for apps that use @earthdance/payments

For people and coding agents working in an app's `convex/` folder. Copy this section into the app's
own `AGENTS.md` / `CLAUDE.md`, or point to it there: `node_modules/@earthdance/payments/AGENTS.md`.
The README has the API and the "Adopt in 5 steps" set-up.

1. **Never call Stripe or PayPal yourself.** No `api.stripe.com`, `paypal.com`, `stripe` npm package or
   processor SDK in the app's server code. Every payment, saved method, retry, refund, webhook and
   reconciliation goes through the library, which owns the keys, idempotency, retries and the records.
   If the library can't do something you need, add it to the library. Stripe.js (and its React
   elements) in the browser, for the card form, is the one exception.
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
6. **Who may do what is the app's.** Gate your own actions (`setupPaymentMethod`, `chargeSaved`,
   `retryOnSession` callers) with your own login; the admin functions go through `authorize.admin`.
   A `stripeCustomerId` passed to adopt an existing Customer must come from your own records, never
   from the browser: the library records it as that owner's for good.
7. **Webhooks with the CLI.** Register them with `npx ed-payments webhooks`, not by hand, and run it
   again after upgrading the library.
8. **Test through the fakes.** `registerPayments(t)` from `@earthdance/payments/test`; don't mock
   `fetch` or a processor SDK yourself. Use test keys and `PAYMENTS_MODE` unset everywhere but production.
