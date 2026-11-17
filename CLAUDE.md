# @earthdance/payments

Convex component + client for Earthdance's payments (Stripe and PayPal checkouts, webhooks, refunds,
the nightly comparison). `README.md` has the design, the API, host set-up and releasing. The plan it
was built from is ed-schedule's `payments_library_plan.md`.

- `npm run check` before committing (build first; the example app typechecks through `dist`).
- After changing component functions or schema: `npm run build:codegen` and commit `src/component/_generated`.
- Formatting is Prettier's (no semicolons, single quotes, 200 columns). Imports inside `src` use `.js` extensions.
- `core` imports nothing from Convex. `component` has no network access, no secrets, no routes, no crons.
  The client runs in the host's actions and does the network calls with the secrets the host passes.
  Nothing here may assume an app's login, router or framework: ed-market and ed-schedule both use it.
- Never `v.id()` of an app table: app rows are `ref: { type, id }` strings. Amounts are integer cents, USD only.
- No processor SDKs: Stripe and PayPal through `fetch`, so everything runs in Convex's default runtime.
- No `any`, no `@ts-ignore`, no lint suppression without a reason, no `.only` / `.skip`. Mark one-off
  code `remove-after: YYYY-MM-DD` with what to check.
- Never use live processor keys in tests or fixtures; fixtures are scrubbed of personal data and account ids.
- Comments explain why, in plain sentences.
- Release only with `npm run release -- X.Y.Z`; never commit `dist` on a branch.
