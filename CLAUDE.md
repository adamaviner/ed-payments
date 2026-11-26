# @earthdance/payments

Convex component + client that owns Earthdance's payment paths: Stripe and PayPal checkouts, saved
methods charged off-session, on-session retries, webhooks, refunds, disputes, the nightly comparison.
`README.md` has the design, the API, host set-up and releasing; `AGENTS.md` is the rules shipped to
apps that use it. The plans it was built from are ed-schedule's `payments_library_plan.md` (v0.1) and
the v0.2 plan ("own all payment paths, bids included").

- `npm run check` before committing (build first; the example app typechecks through `dist`).
- `npm run test:sandbox` with test keys (`ED_PAYMENTS_SANDBOX_ENV=<env file>`) after changing wire code.
- After changing component functions or schema: `npm run build:codegen` and commit `src/component/_generated`.
- Formatting is Prettier's (no semicolons, single quotes, 200 columns). Imports inside `src` use `.js` extensions.
- `core` imports nothing from Convex. `component` has no network access, no secrets, no routes, no crons.
  The client runs in the host's actions and does the network calls with the secrets the host passes.
  Nothing here may assume an app's login, router or framework: ed-market and ed-schedule both use it.
- `src/react` is browser code: it imports pure `core` modules and only types from `client`. No UI
  library: its own primitives in `ui.tsx`, with shadcn token classes. Its tests run in happy-dom
  (`// @vitest-environment happy-dom`); `example/src` shows and typechecks every piece.
- Never `v.id()` of an app table: app rows are `ref: { type, id }` strings. Amounts are integer cents, USD only.
- No processor SDKs: Stripe and PayPal through `fetch`, so everything runs in Convex's default runtime.
  Look up the processors' current docs for every request shape; a new object the library reads gets a
  captured fixture and a line in `src/testing/contract.test.ts`.
- Every new event the library handles goes in `STRIPE_EVENTS` / `PAYPAL_EVENTS` (the CLI registers those).
- Every new public entry is rate-limited and gets a row in `src/client/api.test.ts`'s refusal table.
- No `any`, no `@ts-ignore`, no lint suppression without a reason, no `.only` / `.skip`. Mark one-off
  code `remove-after: YYYY-MM-DD` with what to check.
- Never use live processor keys in tests or fixtures; fixtures are scrubbed of personal data, account and key ids, client secrets.
- Comments explain why, in plain sentences.
- Release only with `npm run release -- X.Y.Z`; never commit `dist` on a branch.

## Where things are

- Hosted checkouts, refunds, sweep: `src/client/index.ts` (being split into `hosted.ts` / `refunds.ts` / `sweep.ts`)
- Saved methods + off-session charges: `src/client/saved.ts`; PayPal vault: `src/client/paypalVault.ts`
- Monthly schedules: `src/component/schedules.ts` (state) + `src/client/schedules.ts` (charging)
- Admin functions: `src/client/api.ts` (`adminApi` / `publicApi` / `worker`); admin page: `src/react/PaymentsAdminPage.tsx`
- Fakes: `src/testing/fake{Stripe,Paypal}.ts`; every route they answer and every webhook they make has a line in
  `src/testing/contract.test.ts` (`drift` in `src/testing/drift.ts`)

## Money invariants (tests must cover any change to them)

- One payment per thing: a second payment for the same retry chain, the same schedule period OR the same chain of presses (replaces) settles as refund_needed. In a chain of presses the first payment to settle is the one paid, even on a replaced checkout, and the others are closed.
- State flags are fields, never `lastError` text.
- Index scans use cursors; a row that is skipped must leave the scanned range.

## Releasing

- After a release, update README "Status" and the install tag in "Adopt in 5 steps"; a hand-off note is per-task and is deleted when the task ends.
- Release from main only, after the stage branch is merged (v0.6.0 forked once).
