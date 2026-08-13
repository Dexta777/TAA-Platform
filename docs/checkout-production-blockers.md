# Checkout Sessions production blockers

## Reservation-v1 activation readiness

Slice 5C implements attempt-owned stock reservation, atomic paid consumption, authoritative Stripe
lifecycle handling, and durable reconciliation. `CHECKOUT_RESERVATIONS_ENABLED` remains off.

Slice 5D adds browser attempt admission, same-tab recovery, capability-authorized abandonment and
reservation-v1 confirmation. The feature flag controls admission of genuinely new attempts only.
Existing reservation-v1 attempts must continue through retry, resume, replacement, confirmation,
webhook finalization and reconciliation while the flag is off. Browser state is a tab-scoped
capability cache; PostgreSQL and Stripe remain authoritative.

Before enabling it in production:

1. Deploy and verify the additive Slice 5C migration and both Edge Functions while the feature flag
   remains off.
2. Provision a high-entropy `CHECKOUT_RECONCILIATION_SECRET` independently in each environment.
3. Configure external monitoring for open `checkout_lifecycle_incidents`, especially every
   `paid_*` incident.
4. Verify the reconciliation worker manually, then activate a one-to-two-minute production
   schedule. No schedule is created by the repository migration.
5. Confirm the worker can retrieve, expire, list, and recover Checkout Sessions with bounded
   pagination.
6. Establish an operator runbook for refunding or manually fulfilling paid incidents.
7. Run an end-to-end payment, delayed-payment, replacement, expiry, and missed-webhook exercise in
   staging before enabling the feature flag.
8. Deploy the immutable Slice 5D frontend and verify reload recovery at every request/replacement
   stage before enabling new reservation attempts.
9. Remove the deployed legacy Webflow order-confirmation caller, disable or undeploy
   `get-order-confirmation`, and prove that an arbitrary PaymentIntent ID cannot return order PII.

The repository retains `get-order-confirmation` temporarily because
`legacy/webflow/order-confirmation.js` still references it. It is not an approved production path
for reservation checkout and must never be reactivated as part of rollback. Only
`get-checkout-confirmation`, authorized by account ownership or a valid confirmation capability,
may serve order confirmation PII after cutover.

An overdue local reservation is never released solely because its timestamp elapsed. Stripe must
authoritatively prove that no payable path remains. Stripe unavailability therefore retains stock
and retries later.

## Klaviyo delivery after webhook replay

Klaviyo delivery is intentionally best effort and happens only after a newly finalized order. If
Klaviyo fails after the transaction commits, a replay sees the order as already finalized and does
not retry the event. This is not an order-integrity failure, but it requires a durable outbox or an
equivalent retry mechanism before Klaviyo delivery can be considered reliable.

## Public checkout endpoint abuse protection

`create-checkout-session` is intentionally public so guest checkout can create a Session. It uses
privileged server-side Supabase access internally after independently validating catalogue and
shipping data. Before meaningful production traffic, the public checkout endpoints require an
appropriate rate-limiting and abuse-protection layer.

The current permissive CORS policy must also be restricted to approved TAA production and staging
origins before production cutover. CORS is browser defence-in-depth only; it is not authentication
and does not prevent direct requests to a public Edge Function.

## Discount entitlement concurrency

Limited-redemption and first-time-buyer discounts require atomic entitlement reservation before
live use. Without reservation and compensation, simultaneous checkouts can both pass eligibility
checks before either redemption is persisted. The final discount flow must reserve entitlement for
a bounded period and release it when checkout expires or payment fails, analogous to the inventory
race above.

## First-time-buyer fingerprint readiness

Identity fingerprinting is secondary anti-abuse infrastructure. Its failure must not prevent a
successfully paid checkout from becoming an order; paid-order finalization continues with null
fingerprints and an operational warning when the Vault pepper is unavailable.

First-time-buyer and other identity-limited discount eligibility must fail closed independently.
If a discount requires account, email, phone, or household history and the required current
fingerprints cannot be generated—or historical paid-order fingerprint coverage is incomplete—the
discount must be rejected or shown as unavailable. General checkout must remain available without
that discount.

Before enabling any first-time-buyer or identity-limited code:

1. Provision the named identity fingerprint pepper in Supabase Vault.
2. Complete the historical paid-order fingerprint backfill.
3. Verify that no applicable paid order is missing any required fingerprint.
4. Ensure entitlement validation rejects the discount whenever fingerprint infrastructure or
   historical coverage is unhealthy.
