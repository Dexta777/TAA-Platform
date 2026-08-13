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

Phase 6A adds exact-origin browser admission, project browser-key admission, bounded bodies, and an
atomic PostgreSQL-backed limiter. Before deploying Phase 6A:

1. Configure `TAA_BROWSER_ALLOWED_ORIGINS` with exact origins. Production must include
   `https://www.theanimalalchemist.com`; the apex is not implicit.
2. Provision one high-entropy `TAA_RATE_LIMIT_PEPPER` per environment. Losing or changing it resets
   derived limiter identities but exposes no raw network addresses.
3. Apply the Phase 6A migration and deploy all public functions together so handler/RPC contracts
   remain aligned. Do not enable reservations as part of this deployment.
4. Verify pre-admission checkout 429 responses say `checkout_request_admitted: false`, while an
   already persisted operation says `true` and retains the same request ID.
5. Exercise the launch policies under representative NAT and IPv6 traffic, then tune named policy
   values only from measured results.

Limiter failure is deliberately fail closed with 503 before Stripe or expensive business work.
CORS and the project browser key are ingress defence-in-depth, not sensitive checkout authority;
account ownership and checkout capabilities remain mandatory.

## Private Klaviyo catalogue-sync cutover

Use this security-first order; never put the token in Git, SQL, logs, `sync_logs`, or trigger data:

1. Generate one random purpose-specific secret and provision the same value as the Edge secret
   `TAA_KLAVIYO_CATALOG_SYNC_SECRET` and Vault secret `taa_klaviyo_catalog_sync_secret`.
2. Deploy `sync-klaviyo-catalog` requiring `x-taa-internal-token`. Old unauthenticated `pg_net`
   calls may temporarily fail at this point, which is safer than accepting unauthenticated writes.
3. Apply the additive Phase 6A migration so the trigger reads Vault and sends the token.
4. Verify authenticated product and variant trigger sync in staging.
5. Verify missing and wrong tokens have no provider or database side effects.

Missing Vault configuration, authentication failure, queue failure, or provider failure must never
abort the underlying product mutation.

## Webhook and reconciler operations

Staging E2E must record Stripe webhook processing duration for completed, delayed-payment,
replacement, and expiry paths. Alert before the duration approaches Stripe's delivery timeout; the
synchronous Slice 5C paid path is intentionally unchanged in Phase 6A.

Reconciler rotation uses `CHECKOUT_RECONCILIATION_SECRET` as current and optionally
`CHECKOUT_RECONCILIATION_PREVIOUS_SECRET` during a bounded rotation window. Remove the previous
secret after all callers have switched. Successful authentication remains a prerequisite to any
job claim. Phase 6A creates no reconciliation schedule.

## Legacy endpoint retirement order

Do not undeploy during Phase 6A. After Webflow and custom-code callers are proven absent, retire in
this order:

1. `delete-klaviyo-old-products`
2. `get-order-confirmation` (never re-enable it during rollback)
3. `create-payment-intent`

When retiring `create-payment-intent`, preserve webhook support only for already-existing legacy
PaymentIntents until reconciliation proves that compatibility path is no longer needed.

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
