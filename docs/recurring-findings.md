# Recurring charges on saved methods: what the processors say (2026-11-21)

Checked before building schedules (v0.6.0). Sources are the processors' current docs, read on
2026-11-21, and calls to Stripe test mode and the PayPal sandbox with ed-market's dev keys (scratch
scripts, then `sandbox/schedules.sandbox.test.ts`).

## Decision this confirms

Earthdance's monthly gifts are the library's own schedules: a saved method charged off-session every
month, not Stripe Billing subscriptions or PayPal Subscriptions.

- **Stripe Billing** is 0.7% of billing volume on pay-as-you-go, with no monthly fee
  (https://stripe.com/billing/pricing). That is on top of card processing (2.9% + 30¢) or ACH
  (0.8%, capped at $5). Running our own schedules saves that 0.7%.
- **PayPal Subscriptions** need a plan for each price. Our schedules let the amount change freely.

## PayPal (Orders v2 spec 2.36, Payment Method Tokens v3)

- **Merchant-initiated charge of a saved card.** Send `payment_source.card.vault_id` with
  `stored_credential {payment_initiator: MERCHANT, payment_type: RECURRING, usage: SUBSEQUENT,
previous_network_transaction_reference}`.
  - The reference is `{id, network, date?}`, taken from the first payment's
    `purchase_units[].payments.captures[].network_transaction_reference`. Mastercard and Discover
    need `date`.
  - PayPal only accepts a previous reference with `MERCHANT`.
  - **Sandbox:** paid with the reference, and also without it (PayPal fills one in). The library
    sends the reference when it has one: cards saved with a payment have one; cards saved by
    setup token don't.
- **Merchant-initiated charge of a saved PayPal account.** Its `stored_credential` is different:
  `payment_initiator`, `usage` and `usage_pattern`, with no `payment_type` and no reference.
  - The library sends `{MERCHANT, SUBSEQUENT, usage_pattern}` only for accounts it saved under a
    known pattern (`RECURRING_PREPAID` for schedules).
  - Accounts saved earlier for bids are charged as before, with no `stored_credential`.
  - **Not tried in the sandbox:** approving a PayPal account needs a buyer in a browser.
- **Saving a card with its first payment (vault with purchase).** Create the order with this
  `payment_source.card`:
  - `attributes.vault.store_in_vault: ON_SUCCESS`
  - `attributes.verification.method: SCA_WHEN_REQUIRED`
  - `stored_credential {CUSTOMER, RECURRING, FIRST}` (`usage: FIRST` is allowed only with a
    `CUSTOMER` initiator)
  - `experience_context`, with no card number

  Card Fields then put the card on the order (`confirm-payment-source`), and the server captures it.

  **Sandbox:** the order was CREATED, then APPROVED after confirm. The capture came back COMPLETED
  with `payment_source.card.attributes.vault {id, status: VAULTED, customer.id}` and a network
  reference. GET on the order shows the vault too. Fixture: `order-vault-card-captured.json`.

- **Saving a PayPal account with its first payment.** `payment_source.paypal.attributes.vault`
  takes `{store_in_vault: ON_SUCCESS, usage_type: MERCHANT, customer_type: CONSUMER, usage_pattern,
permit_multiple_payment_tokens, description}` plus `experience_context`.
  - Orders v2 has no `billing_plan` object.
  - The spec suggests `SUBSCRIPTION_PREPAID` for a fixed amount and `RECURRING_PREPAID` when the
    amount can vary, so the library uses `RECURRING_PREPAID`.
  - **Sandbox:** both patterns were accepted (PAYER_ACTION_REQUIRED). A setup token with
    `RECURRING_PREPAID` was accepted too.
  - The account needs PayPal's approval for billing agreements (reference transactions), the same
    as for bids.
  - If the capture says `APPROVED` rather than `VAULTED`, the token isn't saved yet and comes
    later in `VAULT.PAYMENT-TOKEN.CREATED`. PayPal documents the APPROVED vault as only
    `{status, links: [up]}` (no id, no customer), and its event samples carry `resource.id` (the
    token), `customer.id` and `payment_source`, but **no order id**. Shopware's PayPal plugin reads
    the order from `resource.metadata.order_id` (SwagPayPal #845/#849), which is unconfirmed here: the
    sandbox always answered VAULTED, and delivering the event needs a public webhook URL.
  - **Handled:** the schedule records `paypalVaultPending` (order, PayPal customer when known, the
    capture's network reference), starts, and waits. The library doesn't depend on the event: the
    schedules worker reads the order again (`GET /v2/checkout/orders/{id}`, five minutes after the
    capture, then hourly), and once `payment_source.<card|paypal>.attributes.vault` is
    `{id, status: VAULTED, customer.id}` it saves and attaches the token through the same mutation as
    the event. A failed read (network, 404) just waits for the next run. The event, if it arrives
    first, is matched by `metadata.order_id` when present (now optional), else by PayPal customer
    among this app's waiting schedules (never guessing between several); a brand-new payer's event
    with neither is left to the order read. No token within three days: the schedule fails as
    `METHOD_NOT_SAVED` (`checkoutId: null`) without charging, and the app asks the payer for another
    method. That the order shows the token VAULTED after an APPROVED capture is PayPal's documented
    order shape (the `up` link points at the order), but unconfirmed here, like the APPROVED answer itself. Fixtures built
    from PayPal's samples: `VAULT.PAYMENT-TOKEN.CREATED.json`, `-paypal.json`,
    `order-vault-approved-captured.json`.
- **Removal at PayPal.** `VAULT.PAYMENT-TOKEN.DELETED` is listed as an event, but PayPal publishes
  no payload. Whether it fires when a buyer cancels the agreement from their PayPal account is **not
  documented**.
  - The library reads `resource.id` and cancels the schedules that use that token.
  - Fallback: a charge on a deleted token is refused (`INVALID_PAYMENT_SOURCE`, a hard decline), so
    the schedule lapses at once.
- **Fees in the sandbox:** a saved card was charged 2.59% + 49¢ ($0.75 on $10, $1.14 on $25).
- **Sandbox quirk:** a test card used many times in a day starts answering `PAYER_CANNOT_PAY`
  (seen with 4005519200000004). The suites now use 4111… and 5555….

## Stripe (API 2026-10-28.endive)

- **Off-session charges** are unchanged: `off_session`, `confirm`, `error_on_requires_action`.
  **Test mode:** `pm_card_visa` paid. `pm_card_chargeCustomerFail` answered 402 with
  `card_declined` / `generic_decline` / `advice_code: try_again_later`.
  `pm_card_visa_chargeDeclinedInsufficientFunds` can't be attached (Stripe declines it at attach),
  so insufficient funds and lost cards are tested only through the fakes.
- **Bank debits that bounce** carry their reason in `last_payment_error.code`, with
  `decline_code` left as `generic_decline`. **Test mode, about 45 s after `processing`:**
  `account_closed`, `insufficient_funds`, `no_account`, `debit_not_authorized`.
- **Hard declines** (no retry), from Smart Retries and the decline codes page:
  - `lost_card`, `stolen_card`, `pickup_card`, `expired_card`, `incorrect_number`,
    `revocation_of_authorization`, `revocation_of_all_authorizations`,
    `authentication_required`, `highest_risk_level`, `transaction_not_allowed`
  - `advice_code: do_not_try_again` or `confirm_card_data`
  - Bank debits: `account_closed`, `no_account`, `debit_not_authorized`, and similar codes
  - For ACH, Stripe retries only insufficient funds, at most twice within 40 days. The library's
    schedule of three retries (day 3, 5, 7) is within that.
  - The list is in `src/core/declines.ts`.
- **Saving and paying in one step in embedded Checkout.** Use `ui_mode: embedded_page`,
  `mode: payment`, `customer` (not `customer_email`, since Stripe takes only one of the two) and
  `payment_intent_data.setup_future_usage: off_session`.
  - Checkout tells the payer the method will be saved.
  - Bank accounts are supported in payment mode, and the library sends
    `payment_method_options.us_bank_account.verification_method: instant`.
  - **Test mode:** card and bank sessions were made (a client secret), but completing them needs a
    browser.
  - `mode: setup` isn't needed.
  - Options exist for wording but aren't used: `consent_collection.payment_method_reuse_agreement`
    and `custom_text`.
- **ACH mandate.** Checkout and the Payment Element show the mandate and record acceptance by
  themselves; Stripe emails the customer a copy.
  - For recurring debits, Nacha asks that the payer be told the amount (or a range) and how often,
    and given 7 days' notice before the timing changes. That is the app's wording: the monthly
    amount and day on the form, and an email when either changes.
  - Revoking the mandate means detaching the method. The PaymentIntent's `mandate_options` has
    nothing for intervals for US bank accounts.
- **Removal at Stripe:** `payment_method.detached` (the PaymentMethod, with `customer` null).
  The library cancels the schedules using that method.

## Not verified against a real processor

- A PayPal account saved with a payment, then charged with `stored_credential`: the buyer has to
  approve in a browser.
- Completing a Stripe embedded Checkout that saves the method: the webhook path runs only through
  the fakes.
- The payload of `VAULT.PAYMENT-TOKEN.DELETED`.
