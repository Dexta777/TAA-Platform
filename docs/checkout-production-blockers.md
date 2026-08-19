# Checkout Sessions production blockers

## Reservation-v1 activation readiness

Slice 5C implements attempt-owned stock reservation, atomic paid consumption, authoritative Stripe
lifecycle handling, and durable reconciliation. `CHECKOUT_RESERVATIONS_ENABLED` remains off.

Slice 5D adds browser attempt admission, same-tab recovery, capability-authorized abandonment and
reservation-v1 confirmation. The feature flag controls admission of genuinely new attempts only.
Existing reservation-v1 attempts must continue through retry, resume, replacement, confirmation,
webhook finalization and reconciliation while the flag is off. Browser state is a tab-scoped
capability cache; PostgreSQL and Stripe remain authoritative.

### Reservation-v1 canary admission

`CHECKOUT_RESERVATIONS_CANARY_SKUS` permits server-side admission of synthetic canary baskets while
`CHECKOUT_RESERVATIONS_ENABLED` remains absent or false. Configure it as a strict JSON array with no
more than 100 individually permitted product or variant SKUs, for example:

```text
CHECKOUT_RESERVATIONS_CANARY_SKUS='["TAA-CANARY-BASE","TAA-CANARY-VARIANT"]'
```

The value is server-only. It must never use a `VITE_` prefix or be returned to the browser. Matching
uses exact, case-sensitive equality against the canonical active catalogue SKU returned from
`products.sku` or `product_variants.variant_sku`. Every basket member must be allowlisted. A mixed
canary and ordinary basket stays on the legacy path, and each variant must be allowlisted separately
from its base product.

Missing, blank, empty, malformed, non-array or excessive configuration disables new canary
admission. Any non-string, empty, whitespace-only or over-200-character member invalidates the
entire configuration. Ordinary and mixed baskets are rejected by a cheap submitted-SKU filter;
potential all-canary baskets must still pass the existing canonical catalogue resolver before any
durable reservation-v1 attempt is admitted. Catalogue validation and infrastructure failures remain
fail closed and are not reinterpreted as successful legacy checkout.

For rollout, keep `CHECKOUT_RESERVATIONS_ENABLED` absent or false, provision only synthetic SKUs,
configure the exact server-side allowlist, and verify that ordinary and mixed baskets remain legacy
before exercising canary payment and recovery. `CHECKOUT_RESERVATIONS_ENABLED=true` remains the
global activation control and takes precedence over canary configuration.

Rollback by removing or blanking `CHECKOUT_RESERVATIONS_CANARY_SKUS`. This prevents new canary
reservation admissions while ordinary checkout remains legacy when the global flag is false.
Existing authenticated reservation-v1 attempts always continue through reservation-v1 recovery,
even after their SKU is removed, the canary configuration is disabled, or the global flag is false.

Before enabling it in production:

1. Deploy and verify the additive Slice 5C migration and both Edge Functions while the feature flag
   remains off.
2. Provision a high-entropy `CHECKOUT_RECONCILIATION_SECRET` independently in each environment.
3. Configure external monitoring for open `checkout_lifecycle_incidents`, especially every
   `paid_*` incident.
4. Verify the reconciliation worker manually, then deploy and verify the dedicated one-to-two-minute
   production scheduler migration.
5. Confirm the worker can retrieve, expire, list, and recover Checkout Sessions with bounded
   pagination.
6. Establish an operator runbook for refunding or manually fulfilling paid incidents.
7. Run an end-to-end payment, delayed-payment, replacement, expiry, and missed-webhook exercise in
   staging before enabling the feature flag.
8. Deploy the immutable Slice 5D frontend and verify reload recovery at every request/replacement
   stage before enabling new reservation attempts.
9. Keep the retired `get-order-confirmation` endpoint absent and verify that only the
   capability-authorized replacement serves order confirmation PII.

This list is the original activation checklist, not a claim that every item remains open. The
dated status records below are authoritative: scheduler, lifecycle-monitoring, operator-runbook,
payment/recovery and confirmation blockers are closed at their recorded evidence layers. External
alert delivery, human readiness/access review and a separate global-enable authorization remain
open.

Current scheduler status (2026-08-19): additive migration
`20260824120300_checkout_reconciliation_scheduler.sql` is deployed. The production job
`taa-checkout-reconciliation-v1` is active every minute and invokes the reconciler through `pg_net`
using the Vault credential name `taa_checkout_reconciliation_secret`; neither migration SQL nor
cron metadata contains the credential. `cron.job_run_details` supplies scheduler-fire evidence and
the private scheduler ledger supplies validated worker-completion evidence. Three consecutive
scheduled empty-queue executions completed at `13:04`, `13:05`, and `13:06Z` with HTTP 200,
`claimed = 0`, zero terminalized empty attempts, no lifecycle mutation, and no worker failure. The
provisional stale-worker threshold is five minutes at the one-minute cadence. Rollback resolves the
exact named job and calls `cron.alter_job(jobid, active := false)` while retaining the reconciler,
webhook lifecycle and Vault credential. The scheduler/heartbeat blocker is closed; alert routing,
objective rollback thresholds and the operator runbook were still open at that scheduler-only
checkpoint. The monitoring record below supersedes the threshold status. Global reservations
remain off.

Current lifecycle-monitoring status (2026-08-19): additive migration
`20260824120400_checkout_lifecycle_monitoring.sql` is deployed. The independent production job
`taa-checkout-health-monitor-v1` is active every minute and records private, minute-idempotent,
credential-free snapshots with an explicit `HEALTHY`, `WARNING`, or `ROLLBACK_REQUIRED`
classification and reason codes. Three consecutive scheduled snapshots at `13:47`, `13:48`, and
`13:49Z` were `HEALTHY` with empty reason sets; reconciliation remained current, inventory remained
A `4/0/4`, BASE `1/0/1`, C `4/0/4`, and all synthetic lifecycle/incident/job counts remained zero.
The monitor, scheduler, and worker heartbeat warning boundary is two minutes and rollback boundary
is five minutes. Inventory/paid/order integrity, paid release, duplicate finalization, paid manual
review, severe lifecycle incidents, and scheduler authentication/configuration failures require
immediate rollback classification. The monitor never mutates checkout state or feature flags.

External-alerting status (2026-08-19): a clean read-only inventory found no authenticated n8n,
WorkMail/SES, SMTP, Slack/Teams, or other operator-alert route in repository source/history,
production Edge-secret names, Vault-secret names, current process configuration, deployed cron, or
Edge Functions. Target ownership is subsequently approved: warning and warning-recovery email goes
to `support@theanimalalchemist.com`; initial rollback-required notification goes to that address and
Dexter via Amazon SNS SMS. Meg is the final failsafe through `meg@theanimalalchemist.com` and SNS SMS
if Dexter is unavailable or has not acknowledged within two minutes; she is not the initial
critical recipient. Trello is not an emergency channel.

That approval is architecture, not implementation evidence. AWS discovery established SES
production sending capability and a verified TAA-domain identity in `eu-west-1`; SNS SMS production
access remains pending. No alert SNS topic/subscription, purpose-specific IAM identity, delivery
credential, outbox, worker, cron job, deployment, synthetic notification or external receipt has
been verified or created. No SMS destination may enter repository files, documentation, logs or
project memory. External alert routing remains blocked pending secure provisioning, implementation
and production delivery verification; global reservations remain off.

The explicit operator response and complete reason-code catalogue are documented in
`docs/checkout-lifecycle-monitoring.md`. Feature rollback removes
`CHECKOUT_RESERVATIONS_ENABLED`, leaving existing reservation-v1 attempts, reconciliation, Stripe
webhooks, targeted recovery, and canary admission available. The initial launch watch is at least
24 hours and the first 10 successful non-canary reservation-v1 checkouts, whichever is longer. The
monitoring/rollback-threshold blocker is closed. The authoritative operator/incident runbook is
`docs/checkout-operator-runbook.md`; its source-consistency and eight-scenario tabletop review pass,
closing the documentation blocker pending human review and provenance commit. External alert
routing, human readiness/access review and a separate launch decision remain open. Global
reservations remain off.

The historical `legacy/webflow/order-confirmation.js` reference is not a deployable function or an
approved production path. `get-order-confirmation` must never be restored as part of rollback. Only
`get-checkout-confirmation`, authorized by account ownership or a valid confirmation capability,
may serve order confirmation PII.

An overdue local reservation is never released solely because its timestamp elapsed. Stripe must
authoritatively prove that no payable path remains. Stripe unavailability therefore retains stock
and retries later.

### Slice 7C1 inventory-conflict Webflow contract

The deliberate checkout inventory-conflict panel requires these elements inside
`[data-checkout-root="true"]`:

- `[data-checkout-inventory-conflict]` — focusable live region and panel wrapper.
- `[data-checkout-inventory-title]` — conflict heading.
- `[data-checkout-inventory-message]` — safe summary text.
- `[data-checkout-inventory-items]` — generated item container.
- `[data-checkout-inventory-retry]` — semantic button for one manual availability recheck.
- `[data-checkout-inventory-continue]` — semantic button that removes every unavailable line.

JavaScript generates each item with `[data-checkout-inventory-item]`,
`[data-checkout-inventory-item-title]`, `[data-checkout-inventory-item-reason]`, and, when the
current cart has an image, `[data-checkout-inventory-item-image]`. Webflow owns visible layout and
styling. The panel and conditional Try Again action use the established `data-ui-hidden` attribute
for hidden state; the published site must keep its existing rule that hides that attribute.

The backend returns canonical SKUs and reasons only. Titles and images are mapped from the current
local basket, and both actions are fenced by the cart fingerprint and checkout request identity.
The typed `TAI01` database detail is emitted only when every canonical SKU is non-empty and at most
200 characters, and its serialized JSON is capped at 32,768 bytes; violations fail as generic
internal checkout errors rather than exposing a truncated or oversized typed payload.
Try Again is present only when every conflict is temporary, performs one customer-initiated check,
and creates no automatic retry loop. Continue Without explicitly updates `taa_cart`, safely
terminalizes/resets the failed empty attempt, and re-runs catalogue, shipping, discount, inventory,
and Session preparation for the reduced basket.

Slice 7C2 may attach availability-subscription UI to the generated item or panel selectors above.
Slice 7C1 exposes no Notify action and makes no notification or delivery promise.

The reconciler now invokes bounded service-only cleanup for expired active reservation-v1 attempts
that provably have no intent, reservation, live pointer, or active admission. It retains those rows
as `expired` audit history. The reconciler is scheduled by the active production job documented
above. Global reservation enablement remains blocked on external alert routing, human
readiness/access review and a separate enablement decision; the monitoring and operator-runbook
blockers are closed.

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

Use this security-first order; never put the token or environment-specific project URL in Git, SQL,
logs, `sync_logs`, or trigger data:

1. Generate one random purpose-specific secret and provision the same value as the Edge secret
   `TAA_KLAVIYO_CATALOG_SYNC_SECRET` and Vault secret `taa_klaviyo_catalog_sync_secret`.
2. Provision the environment's origin-only Supabase project base URL as the Vault secret
   `taa_supabase_functions_url`, without `/functions/v1`, a path, query, or fragment. Hosted values
   must use HTTPS; local development may use an explicitly allowed local host. One trailing slash
   is accepted and removed by the trigger.
3. Deploy `sync-klaviyo-catalog` requiring `x-taa-internal-token`. Old unauthenticated `pg_net`
   calls may temporarily fail at this point, which is safer than accepting unauthenticated writes.
4. Apply the additive Phase 6A hardening migration only after both Vault values exist. The trigger
   reads the environment URL and token from Vault, then constructs the catalogue-sync function URL.
5. Verify authenticated product and variant trigger sync in staging.
6. Verify missing and wrong tokens have no provider or database side effects.

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

### Exact-attempt operator recovery

If a materialized reservation-v1 attempt loses its browser capability, operators must not fabricate
a capability or mutate Stripe, attempt, intent, or reservation rows directly. The private
`reconcile-checkout-reservations?mode=targeted` accepts an exact operator request containing only a
`checkout_attempt_id`. The explicit query mode and non-empty exact JSON body are both required;
omitting either fails with HTTP 400 instead of falling through to the legacy empty-body batch
worker. It uses the same reconciliation secret as batch operation and calls
`claim_checkout_attempt_reconciliation_job_v1`, which is executable only by `service_role`.

Targeted mode does not run the global queue scan or expired-empty-attempt sweep. It claims durable
work for only the requested attempt and current intent, respects an existing worker lease or retry
delay, and then uses the existing reconciliation lifecycle. Stripe state is retrieved and fully
validated. An open/unpaid Session is expired with the established deterministic idempotency key and
retrieved again before PostgreSQL may release stock. Paid state follows paid finalization instead of
abandonment. Transient or ambiguous state retains the reservation and leaves durable retry work;
identity or integrity conflict remains in manual review.

An in-flight intent with no locally recorded Session is still materialized when it belongs to the
attempt and its attempt-owned reservation exists. Targeted recovery sends that state through the
existing bounded Stripe Session discovery path; it must not classify an ambiguous external create
as an empty attempt. After exhaustive no-match proof and hard expiry, a pre-checkpoint replacement
is failed while its payable predecessor and reservation remain active, then the same targeted
operation advances to that predecessor. An initial or post-checkpoint replacement terminalizes the
whole attempt. Any inconsistent pointer/checkpoint topology enters manual review.

An operator invocation is successful only when its response and a fresh database read agree that
the attempt is terminal with a released reservation, or that authoritative paid finalization
preserved a consumed reservation. Run one attempt at a time when recovery order matters, and stop
before the next target on any retry, manual-review, or unexpected response. Supply the existing
reconciliation secret through the operator process environment; never place it in command
arguments, source, logs, documentation, or browser tooling.

Production verification status: unauthenticated ingress rejects access with HTTP 401, and the
authenticated exact-attempt production smoke is PRODUCTION-PROVEN. The evidence is retained in
`Codex/VERIFICATION-LOG.md`; it must not be rerun merely for repetition.

## Legacy endpoint retirement

The following legacy Edge Functions have been retired remotely and removed from the deployable
repository configuration:

- `delete-klaviyo-old-products` — retired; do not restore.
- `get-order-confirmation` — retired; do not restore.
- `create-payment-intent` — retired; do not restore, including during checkout rollback.

Legacy PaymentIntent creation is closed. At retirement time, three historical PaymentIntent-only
checkout rows remained pending. Their authoritative Stripe state requires later reconciliation, so
the Stripe webhook's legacy `payment_intent.succeeded`, `payment_intent.payment_failed`, and
`payment_intent.canceled` compatibility branches remain temporarily. Removing that compatibility
is a separate later task after the outstanding rows are authoritatively reconciled and a sufficient
observation window has elapsed.

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
