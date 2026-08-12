# Discount engine

Supabase/TAA is the authority for customer-facing discount codes. It owns code lookup,
eligibility, identity and redemption restrictions, and exact integer-pence calculations. Stripe
will later execute an already-authorized monetary result; it is not the promotion authority.

`public.evaluate_discount_code` is a server-only capability. Browser roles cannot execute it or
read the underlying discount tables. Its subtotal and shipping inputs must come from canonical
server-side catalogue and shipping resolution, never browser-calculated prices.

Identity-limited discounts fail closed. If current fingerprints cannot be generated or historical
paid-order fingerprint coverage is incomplete, the evaluator returns `identity_unavailable`.
Ordinary unrestricted checkout remains available if fingerprint infrastructure degrades.

Eligibility is not reservation. Global, per-user, and first-time-buyer checks can race until an
atomic entitlement reservation/finalization design is implemented. The production blocker remains
recorded in `docs/checkout-production-blockers.md`; limited or first-time-buyer codes must not be
enabled before it is resolved.

Schedule boundaries are deterministic: `starts_at` is inclusive and `expires_at` is exclusive.
Minimum spend uses the original merchandise subtotal and excludes shipping.

## Evaluator result

The evaluator returns one row with eligibility, a stable reason code, non-sensitive discount
metadata, merchandise and shipping discount amounts, final shipping, and final total. Ineligible
results contain zero discounts and preserve the undiscounted shipping and total.

Stable reason codes are:

- `invalid_code`
- `inactive`
- `not_started`
- `expired`
- `minimum_subtotal_not_met`
- `account_required`
- `maximum_redemptions_reached`
- `user_redemption_limit_reached`
- `not_first_order`
- `not_first_email`
- `not_first_phone`
- `not_first_household`
- `identity_unavailable`
- `eligible`

Percentage discounts use PostgreSQL numeric arithmetic and explicit rounding from integer basis
points, with optional maximum-discount and subtotal caps. Fixed discounts cannot exceed the
subtotal. Free shipping records the original shipping as `shipping_discount_amount` and reduces
`final_shipping_amount` to zero.

## Checkout execution

`create-checkout-session` accepts only an optional human-entered `discount_code`. It resolves the
cart, merchandise subtotal, eligible shipping options, selected shipping method, and authenticated
identity on the server before calling the evaluator. An ineligible result is mapped to a small
customer-safe error category and no Stripe Checkout Session is created. Checkout without a code
continues through the existing undiscounted path.

Canonical integer-pence snapshots use these meanings:

- `subtotal_amount`: merchandise before discount
- `discount_amount`: merchandise discount
- `shipping_amount`: shipping actually charged for the final selected method
- `shipping_discount_amount`: original canonical shipping waived
- `total_amount`: `subtotal_amount - discount_amount + shipping_amount`

For percentage and fixed discounts, Stripe receives a unique, once-only amount-off coupon for the
evaluator's exact `discount_amount`; Stripe never recalculates TAA eligibility or percentage rules.
The coupon ID is retained on `checkout_intents` for diagnosis and cleanup. Coupon deletion is
best-effort after terminal Checkout Session handling and does not affect an already-applied Session.
Session-creation and persistence failures expire the Session and delete the coupon best-effort
without allowing cleanup errors to hide the primary result.

Free shipping does not create a coupon. Every canonical shipping option in that Session is created
with a zero Stripe amount, while its original canonical amount and TAA method/rate identifiers are
stored in server-created Stripe shipping-rate metadata. The webhook therefore records the method
the customer actually selected and derives the waived amount without trusting browser state.

Discounted paid Sessions are reconciled before order finalization. Stripe proves the merchandise
subtotal, aggregate merchandise discount, selected shipping charge, currency, and total; the
selected server-created shipping rate proves the canonical original shipping amount. Any mismatch
is treated as a high-severity finalization error and no order is silently created. Undiscounted
Checkout Session synchronization retains its existing behavior.

`public.finalize_paid_checkout` atomically copies the discount snapshot to the paid order and, when
`discount_code_id` is present, inserts exactly one `discount_redemptions` row from the finalized
order's identity fingerprints. Pending, declined, failed, expired, and abandoned checkouts do not
consume a redemption. Replay returns the existing order without decrementing inventory or creating
a second redemption. Nullable fingerprints remain acceptable for unrestricted discounts when the
secondary fingerprint infrastructure is degraded.

## Customer application and Session replacement

The checkout UI may submit only a normalized human-entered code. Safe evaluator categories are
translated into customer messages; internal identity and redemption reasons never reach the
browser. If the discount controls are absent, checkout continues without discount UI.

Stripe Checkout Sessions are immutable for TAA discount changes. Applying or removing a code after
checkout preparation therefore uses an authorized replacement handoff:

1. Authorize the pending previous checkout by its account ownership or confirmation capability.
2. Resolve and evaluate the proposed checkout without changing the previous Session.
3. Create, verify, and persist the replacement Session, intent, and items completely.
4. Expire or safely confirm expiry of the previous Stripe Session.
5. Mark its intent expired and clean its temporary coupon best-effort.
6. Return the replacement so the browser can install the new Checkout SDK and Payment Element.

Invalid discounts leave the existing checkout untouched. If the previous Session cannot be proven
invalidated, the new Session is compensated and is never returned as a second payable path. The
browser restores the previous payment path only when Stripe confirms it remains open/unpaid and
compensation of the new Session is also confirmed; ambiguous compensation disables payment and
raises a high-severity diagnostic. The
browser retains the old confirmation capability until the replacement Payment Element is installed,
destroys the supported old Payment Element during the swap, and ignores stale Checkout change
events using a generation guard.

Percentage and fixed discounts remain attached while Stripe updates shipping within the same
Session. For free shipping, every Stripe rate remains zero while the browser displays the selected
method's original server-provided amount and an equal shipping-discount row. The paid webhook
remains the final economics authority.

Limited-redemption and first-time-buyer codes remain production-blocked: paid-order redemption
persistence and Session replacement are not entitlement reservation, so simultaneous eligible
Sessions can still race. Reservation and compensation must be implemented before those codes are
enabled.
