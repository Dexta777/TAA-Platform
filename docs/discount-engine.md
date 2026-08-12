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
