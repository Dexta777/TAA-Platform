# Reservation-v1 Checkout Operator and Incident-Response Runbook

## Status and scope

This is the authoritative operator runbook for TAA reservation-v1 checkout. It covers health
assessment, incident triage, feature rollback, paid-state handling, targeted recovery,
reconciliation and monitoring failures, re-enablement, and the initial launch watch.

It does not authorize global enablement, direct database repair, automatic rollback, refund,
fulfilment, or infrastructure deployment. External alert delivery is not production-operational;
the pending routing contract is documented below.

Related authority:

- [Checkout lifecycle monitoring and rollback contract](./checkout-lifecycle-monitoring.md)
- [Model B emergency checkout rollback](./checkout-model-b-rollback.md)
- [Checkout production blockers](./checkout-production-blockers.md)
- [ADR-0001 — Reservation-owned checkout finalization](../Codex/01-Architecture/Repository-Architecture/ADR/ADR-0001-reservation-owned-checkout-finalization.md)
- [Verification evidence](../Codex/VERIFICATION-LOG.md)

## Non-negotiable safety rules

1. Stripe is authoritative for payment and Checkout Session state. Browser state, local deadlines,
   and incomplete database state cannot prove that a checkout is unpaid.
2. Never release inventory as unpaid when Stripe payment evidence exists or is uncertain.
3. Never repair checkout, order, reservation, or inventory state with ad hoc SQL.
4. Never create a second order, decrement inventory manually, or retry fulfilment blindly.
5. `ROLLBACK_REQUIRED` means disable new ordinary reservation-v1 admission within five minutes.
   Rollback is a human action; monitoring never toggles the flag.
6. Feature rollback does not cancel or convert existing reservation-v1 attempts. Their webhook,
   reconciliation, monitoring, and targeted-recovery paths must remain available.
7. Never place a credential, bearer header, capability, SMS destination, or customer/payment data in
   commands, logs, incident records, tickets, or chat.
8. Use UTC for every incident timestamp. Preserve evidence before mutating configuration.
9. Stop on contradictory topology, negative ATS, more than one order, a paid release path, or
   uncertainty about payment or fulfilment. Escalate rather than infer.

## Emergency checkout rollback

Use this quick reference only when the authoritative health result is `ROLLBACK_REQUIRED`, health
has been unknowable for more than five minutes, or the reason-specific matrix below requires
rollback.

1. **IDENTIFY:** record UTC time, health classification, reason codes, and safe aggregate metrics.
2. **DISABLE:** remove only `CHECKOUT_RESERVATIONS_ENABLED` through the authorized Supabase
   production-configuration workflow.
3. **VERIFY:** require the variable to be absent by name/metadata only. Absence is authoritative
   OFF.
4. **PRESERVE:** leave existing reservation-v1 attempts, Stripe webhooks, reconciliation,
   monitoring, and targeted recovery active.
5. **RECORD:** open or update the incident record. Never include secrets, customer data, raw
   provider errors, or an SMS destination.
6. **STOP:** do not release stock, create or delete an order, refund, fulfil, disable canary
   admission, or re-enable reservations without the separate procedure and authority below.

If the operator cannot complete step 2 within five minutes, escalate through the approved human
failsafe. Model B now has a local, undeployed implementation, but external alert delivery and the
failsafe mutation path are not production-operational, so controlled global enablement remains
blocked.

## Ownership

- **Primary operator:** Dexter.
- **Secondary/final failsafe:** Meg.
- Dexter owns initial triage, rollback, Supabase/Stripe investigation, recovery decisions, and the
  incident record.
- Meg must have this runbook, understand that new reservation admission may need disabling, and be
  able to contact/escalate to Dexter. Her direct Supabase/AWS infrastructure access is not verified;
  do not assume it exists. That is an operational limitation until access is explicitly granted and
  tested.

## Human access readiness

Access evidence uses three classifications:

- **VERIFIED ACCESS:** the current read-only review proved the existing operator session can reach
  the required surface, or a recent recorded production operation proved the same mutation class.
- **DOCUMENTED BUT NOT VERIFIED:** source or historical evidence identifies the surface, but current
  human access was not proven without mutation.
- **MISSING:** no usable current access or recovery evidence was found. This means missing evidence;
  it must not be rewritten as proof that no account exists.

### Current capability matrix

| Capability                                                                        | System / privilege                                            | Dexter                                                                                                                | Meg                           | Meg needs it?                                                                                 | Recovery position                                                                                                       |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ----------------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Read health, heartbeats, incidents, jobs, overdue reservations, ATS, and topology | Supabase linked database operator with `private`/`cron` reads | VERIFIED ACCESS                                                                                                       | MISSING                       | No for routine work; the emergency control should return a safe receipt, not private topology | Current access is tied to Dexter's working operator session; alternate-device recovery is not verified.                 |
| Read global/canary flag names and manage Edge configuration                       | Supabase project secret metadata/write boundary               | VERIFIED ACCESS; current reads and recorded secret rotation/unset operations                                          | MISSING                       | Only one-way global disable                                                                   | A second human cannot currently perform the rollback.                                                                   |
| Disable `taa-checkout-reconciliation-v1` exceptionally                            | Supabase postgres/cron operator                               | VERIFIED ACCESS for the underlying operator session; mutation deliberately not repeated                               | MISSING                       | No                                                                                            | Dexter or a separately authorized database operator; do not include this in Meg's minimal role.                         |
| Invoke exact targeted recovery                                                    | Reconciler endpoint plus `CHECKOUT_RECONCILIATION_SECRET`     | VERIFIED ACCESS; production-proven                                                                                    | MISSING                       | No                                                                                            | Rotate the credential through Supabase Edge secret plus Vault if the current value is lost; never recover it from logs. |
| Retrieve authoritative payment state and decide refund/manual fulfilment          | Stripe live/test operator tooling                             | MISSING current human-access evidence                                                                                 | MISSING                       | No; escalate                                                                                  | Verify Dexter's named Stripe access, MFA, recovery route, and a non-mutating lookup drill before enablement.            |
| Execute an approved refund or manual fulfilment after the incident decision       | Stripe plus fulfilment/dispatch operations                    | MISSING current named-access/authority evidence                                                                       | MISSING                       | No; escalate                                                                                  | Name and verify the executor and audit route; never make both actions independently.                                    |
| Manage SES/SNS resources for the future alert route                               | AWS operator                                                  | Console hardware-FIDO VERIFIED; broad human key is disabled; alert-path purpose-specific access remains unimplemented | MISSING                       | No                                                                                            | Use a purpose-specific alert credential; narrower human privilege remains post-launch hardening.                        |
| Read and administer repository                                                    | GitHub                                                        | VERIFIED ACCESS (`ADMIN`); repository/runbook is publicly readable                                                    | MISSING as a named-user check | Read only                                                                                     | The committed runbook does not depend on Codex, chat history, or a private browser profile.                             |
| Publish Webflow                                                                   | Webflow site publisher                                        | DOCUMENTED BUT NOT VERIFIED currently; prior production publish exists                                                | MISSING                       | No                                                                                            | Can defer until a release requires Webflow; not needed for emergency rollback.                                          |
| Recover accounts and operational secrets from another device                      | Authoritative password manager/account recovery               | MISSING                                                                                                               | MISSING                       | Meg needs only her named failsafe credential, not Dexter's secrets                            | No documented, tested two-human recovery path exists.                                                                   |

### Approved target role for Meg: Model B

Meg should receive final-failsafe alerts, read this runbook, contact Dexter, and have a narrowly
scoped ability to **disable** new global reservation admission when Dexter is unavailable. She does
not need database, Stripe, AWS, scheduler, recovery-secret, deployment, or general Supabase
administration.

The break-glass control must:

- authenticate Meg through a separate named account with phishing-resistant MFA where supported;
- be reachable without Dexter's Mac, Codex, Dropbox, or a Dexter-owned browser session;
- be hard-coded to the production project and the single idempotent operation “remove
  `CHECKOUT_RESERVATIONS_ENABLED`”;
- never set or enable the flag, list/read secret values, accept arbitrary secret names, run SQL,
  deploy, disable reconciliation/monitoring, or expose its underlying credential;
- return a non-sensitive receipt proving OFF/absent and record an audit event;
- be rate-limited, independently recoverable, and tested by Meg before global enablement.

Supabase's management boundary offers project Edge-secret write permission rather than a
single-secret human role. Do not give that credential directly to Meg. Keep it behind the fixed
one-way control and review that control separately before deployment. Model A (alert/escalation
only) does not survive Dexter being unreachable beyond the five-minute rollback SLA. Model C
(broad infrastructure access) is unnecessary and violates least privilege.

The bounded control is now implemented locally in
[`checkout-model-b-rollback.md`](./checkout-model-b-rollback.md). It is **not deployed, not
production-proven, and not available to Meg**. Its fixed path uses a zero-parameter SSM Automation
document pinned to an immutable Lambda version. The handler issues only the fixed Management API
DELETE for `CHECKOUT_RESERVATIONS_ENABLED`, using a hidden purpose-specific token with
`edge_functions_secrets_write` only. IAM requires fixed execution tag
`TAA-Control=CheckoutModelB`, and Meg may read only receipts carrying that tag; she cannot list,
browse, or retag unrelated SSM Automation executions. The document itself remains zero-parameter,
and the handler does not list/read Edge secrets. Model B remains a must-close blocker until the
non-production idempotency test, credential project-scope gate, IAM simulation, deployment,
OFF-state production proof, and supervised Meg drill all pass.

### Must-close human-readiness actions

1. Review, non-production-verify, deploy, and production-prove the local Model B one-way rollback
   control; have Meg locate this runbook, acknowledge her role, use her named MFA-protected identity,
   and complete a supervised rollback drill without broad infrastructure access.
2. Establish an authoritative password-manager/account-recovery process that a second human can
   use without Dexter's Mac or primary MFA device, covering Supabase, AWS, Stripe, and GitHub account
   recovery without sharing passwords.
3. Verify Dexter's named Stripe live/test operational access, MFA and account recovery; name and
   verify refund/manual-fulfilment authority; then perform a documentation-only paid-incident lookup
   drill without payment, refund, fulfilment, or checkout mutation.

External alert delivery and its SNS production proof remain a separate must-close launch blocker.
Brad's console hardware-FIDO protection, root MFA/no root keys, inactive unused service credentials,
and disabled-at-rest human CLI key satisfy the proportionate launch-critical AWS key condition.
AdministratorAccess replacement, temporary/federated access, and legacy IAM rationalisation remain
post-launch hardening unless a broad human credential is proposed for Model B or alert delivery.

### Single-point-of-failure classification

| Dependency                          | Classification                  | Rationale / required hardening                                                                                      |
| ----------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Dexter alone                        | SHOULD HARDEN BEFORE ENABLEMENT | Current rollback succeeds only while Dexter is reachable; close Model B.                                            |
| Dexter's Mac                        | SHOULD HARDEN BEFORE ENABLEMENT | Current Supabase/AWS operator sessions are usable here, but alternate-device recovery is unverified.                |
| One browser profile                 | ACCEPTABLE                      | Emergency rollback, monitor reads, and the committed runbook do not depend on checkout browser state.               |
| One password-manager account/device | SHOULD HARDEN BEFORE ENABLEMENT | No authoritative manager or second-human recovery process is evidenced.                                             |
| One MFA device                      | SHOULD HARDEN BEFORE ENABLEMENT | AWS hardware FIDO is verified; Supabase/GitHub/Stripe recovery and backup-factor ownership remain unverified.       |
| One AWS root/admin identity         | SHOULD HARDEN BEFORE ENABLEMENT | Root MFA is present, but root/emergency ownership and multi-person recovery are not documented or tested.           |
| One Supabase owner identity         | SHOULD HARDEN BEFORE ENABLEMENT | Dexter's current access works; a separate narrow rollback and control-plane recovery path do not.                   |
| Codex availability                  | ACCEPTABLE                      | This committed runbook is authoritative and executable without chat history.                                        |
| Dropbox availability                | CAN DEFER                       | Git contains the runbook and is independently readable; Dropbox is not the sole copy.                               |
| Live website availability           | ACCEPTABLE                      | The Supabase control-plane rollback and Git-hosted instructions do not depend on the customer site being reachable. |

## Command conventions and privileges

Set only non-secret operator context in shell variables. Do not paste secret values into history.

```sh
export TAA_PRODUCTION_PROJECT_REF='<production-project-ref>'
```

| Label     | Meaning                                                                               |
| --------- | ------------------------------------------------------------------------------------- |
| READ ONLY | May read production state but must not call a lifecycle transition or change config.  |
| MUTATING  | Changes production configuration or scheduler state; requires explicit authorization. |
| PRIVILEGE | Required access boundary.                                                             |

The SQL below is supported through the linked production Supabase CLI. It requires the authenticated
Supabase operator/login role with access to `private` and `cron`; browser, `anon`, `authenticated`,
and `service_role` roles cannot read the private monitor/scheduler tables or invoke their controls.

## First response

1. Open an incident record using the template below.
2. Capture current UTC time, classification, reason codes, and safe aggregate metrics.
3. If health is `HEALTHY`, do not mutate anything. Close only after confirming no independent
   incident signal exists.
4. If health is `WARNING`, stop rollout expansion and investigate within the reason's response time.
5. If health is `ROLLBACK_REQUIRED`, preserve evidence and disable new global admission within five
   minutes. Existing reservation-v1 attempts continue.
6. If health cannot be determined for more than five minutes, treat it as
   `ROLLBACK_REQUIRED` because safety visibility is lost.

## Authoritative operator surfaces

### Current health and heartbeat metrics

**READ ONLY — PRIVILEGE: linked Supabase database operator**

```sh
npx supabase db query --linked "
SELECT
  snapshot_at,
  classification,
  reason_codes,
  metrics
FROM private.get_checkout_health_v1();
"
```

Use `classification` and `reason_codes` as the authoritative monitor result. The metrics contain
credential-free aggregate counts and the monitor, scheduler, and worker heartbeat timestamps/ages.

### Monitor and reconciliation cron state

**READ ONLY — PRIVILEGE: linked Supabase database operator**

```sh
npx supabase db query --linked "
SELECT jobname, schedule, active
FROM cron.job
WHERE jobname IN (
  'taa-checkout-health-monitor-v1',
  'taa-checkout-reconciliation-v1'
)
ORDER BY jobname;

SELECT
  jobs.jobname,
  runs.status,
  runs.start_time,
  runs.end_time
FROM cron.job AS jobs
JOIN cron.job_run_details AS runs ON runs.jobid = jobs.jobid
WHERE jobs.jobname IN (
  'taa-checkout-health-monitor-v1',
  'taa-checkout-reconciliation-v1'
)
ORDER BY runs.start_time DESC
LIMIT 20;
"
```

### Reconciliation scheduler and worker ledger

**READ ONLY — PRIVILEGE: linked Supabase database operator**

```sh
npx supabase db query --linked "
SELECT
  scheduler_fired_at,
  scheduler_result,
  worker_state,
  worker_result,
  response_received_at,
  worker_completed_at,
  http_status,
  claimed_count,
  expired_empty_attempts_terminalized
FROM private.checkout_reconciliation_scheduler_runs
ORDER BY scheduler_fired_at DESC
LIMIT 20;
"
```

To distinguish pg_net transport from worker classification without exposing response content:

```sh
npx supabase db query --linked "
SELECT
  runs.scheduler_fired_at,
  runs.scheduler_result,
  responses.status_code,
  responses.timed_out,
  responses.error_msg IS NOT NULL AS has_transport_error,
  responses.created AS response_created_at
FROM private.checkout_reconciliation_scheduler_runs AS runs
LEFT JOIN net._http_response AS responses ON responses.id = runs.net_request_id
ORDER BY runs.scheduler_fired_at DESC
LIMIT 20;
"
```

Never select `responses.content` or raw error text into an incident transcript.

### Lifecycle incidents and reconciliation jobs

**READ ONLY — PRIVILEGE: linked Supabase database operator**

```sh
npx supabase db query --linked "
SELECT
  left(id::text, 8) AS incident_id,
  incident_type,
  status,
  occurrence_count,
  first_seen_at,
  last_seen_at,
  left(checkout_attempt_id::text, 8) AS attempt_id,
  left(checkout_intent_id::text, 8) AS intent_id
FROM public.checkout_lifecycle_incidents
WHERE status = 'open'
ORDER BY first_seen_at;

SELECT
  left(id::text, 8) AS job_id,
  reason,
  status,
  available_at,
  attempt_count,
  last_error_code,
  left(checkout_attempt_id::text, 8) AS attempt_id,
  left(checkout_intent_id::text, 8) AS intent_id
FROM public.checkout_reconciliation_jobs
WHERE status <> 'resolved'
ORDER BY created_at;
"
```

Do not copy `diagnostic_details`, customer columns, addresses, or payment details into the incident
record.

### Active lifecycle and authoritative overdue reservations

**READ ONLY — PRIVILEGE: linked Supabase database operator**

```sh
npx supabase db query --linked "
SELECT
  count(*) FILTER (
    WHERE checkout_protocol_version = 'reservation_v1'
      AND status IN ('active', 'payment_pending')
  ) AS active_attempts,
  count(*) FILTER (
    WHERE checkout_protocol_version = 'reservation_v1'
      AND admitted_checkout_request_id IS NOT NULL
      AND admitted_request_expires_at > clock_timestamp()
  ) AS active_admissions
FROM public.checkout_attempts;

SELECT count(*) AS active_intents
FROM public.checkout_intents
WHERE checkout_protocol_version = 'reservation_v1'
  AND orchestration_state IN (
    'prepared',
    'creating_coupon',
    'creating_session',
    'session_created',
    'replacing',
    'active',
    'reconciliation_required'
  );

SELECT
  left(reservations.id::text, 8) AS reservation_id,
  left(attempts.id::text, 8) AS attempt_id,
  left(intents.id::text, 8) AS intent_id,
  reservations.status,
  attempts.status AS attempt_status,
  intents.orchestration_state,
  intents.stripe_session_expires_at,
  extract(epoch FROM clock_timestamp() - intents.stripe_session_expires_at) AS overdue_seconds
FROM public.inventory_reservations AS reservations
JOIN public.checkout_attempts AS attempts
  ON attempts.id = reservations.checkout_attempt_id
JOIN public.checkout_intents AS intents
  ON intents.id = COALESCE(
    attempts.in_flight_checkout_intent_id,
    attempts.active_checkout_intent_id
  )
WHERE reservations.status = 'held'
  AND attempts.status = 'active'
  AND intents.stripe_checkout_session_id IS NOT NULL
  AND intents.stripe_session_expires_at <= clock_timestamp()
  AND intents.orchestration_state IN (
    'session_created',
    'replacing',
    'active',
    'reconciliation_required'
  )
ORDER BY intents.stripe_session_expires_at;
"
```

This is the monitor's authoritative-overdue candidate topology. A local
`inventory_reservations.expires_at` timestamp alone is not authority to release stock.

### Inventory and ATS

**READ ONLY — PRIVILEGE: linked Supabase database operator**

```sh
npx supabase db query --linked "
WITH reserved_products AS (
  SELECT items.product_id, sum(items.quantity)::bigint AS reserved
  FROM public.inventory_reservation_items AS items
  JOIN public.inventory_reservations AS reservations
    ON reservations.id = items.reservation_id
  WHERE items.product_id IS NOT NULL
    AND reservations.status IN ('held', 'payment_pending')
  GROUP BY items.product_id
),
reserved_variants AS (
  SELECT items.product_variant_id, sum(items.quantity)::bigint AS reserved
  FROM public.inventory_reservation_items AS items
  JOIN public.inventory_reservations AS reservations
    ON reservations.id = items.reservation_id
  WHERE items.product_variant_id IS NOT NULL
    AND reservations.status IN ('held', 'payment_pending')
  GROUP BY items.product_variant_id
),
positions AS (
  SELECT
    products.sku,
    products.inventory_quantity::bigint AS physical,
    COALESCE(reserved_products.reserved, 0) AS reserved
  FROM public.products
  LEFT JOIN reserved_products ON reserved_products.product_id = products.id
  UNION ALL
  SELECT
    variants.variant_sku,
    variants.inventory_quantity::bigint,
    COALESCE(reserved_variants.reserved, 0)
  FROM public.product_variants AS variants
  LEFT JOIN reserved_variants ON reserved_variants.product_variant_id = variants.id
)
SELECT sku, physical, reserved, physical - reserved AS ats
FROM positions
WHERE physical - reserved < 0 OR reserved > 0
ORDER BY sku;
"
```

An empty result means no active reservation or negative ATS position. For a known affected SKU,
add an exact `sku = '<sku>'` filter locally; SKU is not customer PII.

### Paid/order/reservation topology for one exact attempt

**READ ONLY — PRIVILEGE: linked Supabase database operator**

Replace `<exact-attempt-uuid>` locally. Record only abbreviated IDs.

```sh
npx supabase db query --linked "
SELECT
  left(attempts.id::text, 8) AS attempt_id,
  attempts.status AS attempt_status,
  left(attempts.active_checkout_intent_id::text, 8) AS active_intent_id,
  left(attempts.in_flight_checkout_intent_id::text, 8) AS in_flight_intent_id,
  reservations.status AS reservation_status,
  left(reservations.order_id::text, 8) AS reservation_order_id,
  (SELECT count(*) FROM public.orders WHERE checkout_attempt_id = attempts.id) AS order_count
FROM public.checkout_attempts AS attempts
LEFT JOIN public.inventory_reservations AS reservations
  ON reservations.checkout_attempt_id = attempts.id
WHERE attempts.id = '<exact-attempt-uuid>'::uuid;

SELECT
  left(intents.id::text, 8) AS intent_id,
  intents.status,
  intents.orchestration_state,
  intents.stripe_checkout_session_id,
  intents.payment_intent_id,
  intents.stripe_session_expires_at
FROM public.checkout_intents AS intents
WHERE intents.checkout_attempt_id = '<exact-attempt-uuid>'::uuid
ORDER BY intents.created_at;

SELECT
  left(orders.id::text, 8) AS order_id,
  left(orders.checkout_intent_id::text, 8) AS intent_id
FROM public.orders
WHERE checkout_attempt_id = '<exact-attempt-uuid>'::uuid;
"
```

Provider IDs are for privileged Stripe lookup only. Do not paste them into the incident record.

### Global and canary admission state

**READ ONLY — PRIVILEGE: Supabase project operator**

```sh
npx supabase secrets list \
  --project-ref "$TAA_PRODUCTION_PROJECT_REF" \
  --output json \
  | jq '[.secrets[]
      | select(
          .name == "CHECKOUT_RESERVATIONS_ENABLED"
          or .name == "CHECKOUT_RESERVATIONS_CANARY_SKUS"
          or .name == "CHECKOUT_RECONCILIATION_SECRET"
          or .name == "CHECKOUT_RECONCILIATION_PREVIOUS_SECRET"
        )
      | {name, updated_at}]'
```

Absence of `CHECKOUT_RESERVATIONS_ENABLED` is authoritative OFF. This command reads names and
metadata only; never print configuration values. Canary admission is separate.

For scheduler Vault configuration, query names and timestamps only:

```sh
npx supabase db query --linked "
SELECT name, created_at, updated_at
FROM vault.secrets
WHERE name IN (
  'taa_checkout_reconciliation_secret',
  'taa_supabase_functions_url'
)
ORDER BY name;
"
```

This is **READ ONLY** and requires the linked database operator. Never select from
`vault.decrypted_secrets`, `secret`, or any decrypted/value-bearing column into operator output.

## Health-response matrix

`Continue v1` below always means existing reservation-v1 attempts remain reservation-v1. Unless a
row explicitly permits an exact recovery decision, targeted recovery is not a generic repair tool.
These rules apply to every row:

- existing reservation-v1 attempts continue through their v1 webhook/reconciliation paths;
- keep reconciliation active unless its repeated execution is itself proven harmful and the
  exceptional scheduler-deactivation procedure is separately authorized;
- begin the listed response within its maximum response time;
- an unresolved warning that reaches the evaluator's existing critical condition becomes
  `ROLLBACK_REQUIRED`; do not extend or reinterpret the threshold in the runbook.

Integrity reasons such as negative ATS, invalid ownership, and paid/order inconsistency prove the
checkout lifecycle is unsafe. Heartbeat, transport, authentication, and backlog reasons can instead
mean that checkout data is still coherent while observability or recovery coverage is impaired.
Both categories require global-admission rollback when the authoritative evaluator reaches
`ROLLBACK_REQUIRED`; the latter is not permission to wait beyond the approved recovery-coverage
boundary.

| Reason code                                                 | Severity          | Immediate action and investigation                                                                 | Response | Disable new admission | Reconciliation / targeted recovery / escalation                                                   |
| ----------------------------------------------------------- | ----------------- | -------------------------------------------------------------------------------------------------- | -------: | --------------------- | ------------------------------------------------------------------------------------------------- |
| `inventory_negative_ats`                                    | ROLLBACK_REQUIRED | Preserve SKU totals and ownership topology; stop inventory/payment expansion.                      |    5 min | Yes                   | Keep reconciliation active; no ad hoc or targeted inventory cleanup; escalate Dexter immediately. |
| `reservation_ownership_invalid`                             | ROLLBACK_REQUIRED | Preserve attempt/reservation/item counts and duplicate ownership evidence.                         |    5 min | Yes                   | Keep reconciliation active; targeted recovery only after topology is proven coherent.             |
| `paid_order_cardinality_invalid`                            | ROLLBACK_REQUIRED | Follow paid incident tree; verify Stripe and order count.                                          |    5 min | Yes                   | Keep reconciliation active; no blind retry; escalate Dexter.                                      |
| `consumed_reservation_order_invalid`                        | ROLLBACK_REQUIRED | Preserve consumed reservation/order linkage and follow paid incident tree.                         |    5 min | Yes                   | Do not decrement/release; exact recovery only after payment/topology review.                      |
| `duplicate_order_finalization`                              | ROLLBACK_REQUIRED | Stop fulfilment duplication; preserve both order records and Stripe evidence.                      |    5 min | Yes                   | Keep reconciliation active; no targeted repetition; escalate immediately.                         |
| `paid_inventory_mismatch`                                   | ROLLBACK_REQUIRED | Preserve intent/order/reservation items and physical totals.                                       |    5 min | Yes                   | No manual stock correction; human fulfil/refund decision required.                                |
| `paid_state_released_as_unpaid`                             | ROLLBACK_REQUIRED | Treat Stripe-paid state as authoritative; preserve release evidence.                               |    5 min | Yes                   | Never re-release or decrement ad hoc; escalate immediately.                                       |
| `paid_lifecycle_invalid`                                    | ROLLBACK_REQUIRED | Compare paid intent, attempt, reservation and canonical order.                                     |    5 min | Yes                   | Keep worker/webhook evidence; human resolution required.                                          |
| `paid_or_integrity_incident_open`                           | ROLLBACK_REQUIRED | Read incident type and affected topology; follow paid incident tree where payment is involved.     |    5 min | Yes                   | Keep reconciliation active unless independently harmful; escalate Dexter.                         |
| `stripe_discovery_incident_open`                            | WARNING           | Inspect incident age, attempt pointers, queue and Stripe availability.                             |   15 min | Not yet               | Continue v1/reconciliation; exact targeted recovery only with a known attempt and decision.       |
| `stripe_discovery_incident_stale`                           | ROLLBACK_REQUIRED | Preserve discovery evidence; disable new admission.                                                |    5 min | Yes                   | Continue v1 and recovery coverage; escalate.                                                      |
| `scheduler_heartbeat_delayed`                               | WARNING           | Inspect cron fire, latest scheduler row and database availability.                                 |   10 min | Not yet               | Keep scheduler active; disable if it reaches five minutes.                                        |
| `scheduler_heartbeat_stale` / `scheduler_heartbeat_missing` | ROLLBACK_REQUIRED | Verify cron job state and run history; preserve failure evidence.                                  |    5 min | Yes                   | Keep/restart only through reviewed operator action; existing v1 continues.                        |
| `worker_heartbeat_delayed`                                  | WARNING           | Inspect cron, pg_net, durable completion, failure count and backlog.                               |   10 min | Not yet               | Keep scheduler active. Account for the documented harvest race before declaring failure.          |
| `worker_heartbeat_stale` / `worker_heartbeat_missing`       | ROLLBACK_REQUIRED | Establish last actual HTTP/result and whether completion evidence is absent.                       |    5 min | Yes                   | Keep reconciliation infrastructure; targeted recovery only for an urgent exact attempt.           |
| `scheduler_configuration_failure`                           | ROLLBACK_REQUIRED | Inspect Vault secret-name presence and URL validity without reading values.                        |    5 min | Yes                   | Do not delete credentials; repair through approved secret workflow.                               |
| `scheduler_authentication_failure`                          | ROLLBACK_REQUIRED | Preserve 401/403 ledger evidence; verify current/previous secret metadata and deployment contract. |    5 min | Yes                   | Do not print/rotate credentials casually; keep webhook active.                                    |
| `scheduler_invocation_warning`                              | WARNING           | Determine lock contention versus `http_queue_failed`; inspect recurrence.                          |   10 min | Not yet               | Keep active unless invocation itself is harmful; escalate at five-minute boundary.                |
| `reconciliation_worker_failure`                             | WARNING           | Inspect the next scheduled result and safe HTTP/transport classification.                          |   10 min | Not yet               | Keep active; one transient failure is not authority to alter inventory.                           |
| `reconciliation_worker_failures_persistent`                 | ROLLBACK_REQUIRED | Preserve three-failure sequence and last success.                                                  |    5 min | Yes                   | Keep infrastructure available; disable cron only for harmful repetition.                          |
| `scheduler_request_in_flight_delayed`                       | WARNING           | Inspect pending row and pg_net response metadata.                                                  |   10 min | Not yet               | The next cron may harvest it; do not manually invoke batch reconciliation.                        |
| `scheduler_request_in_flight_stale`                         | ROLLBACK_REQUIRED | Preserve unresolved request evidence and disable new admission.                                    |    5 min | Yes                   | Do not queue competing work; targeted use requires a separate exact decision.                     |
| `reconciliation_backlog_delayed`                            | WARNING           | Inspect due-job age, claims, failures and next cycle.                                              |   10 min | Not yet               | Keep scheduler active; no bulk manual invocation.                                                 |
| `reconciliation_backlog_stale`                              | ROLLBACK_REQUIRED | Due work is over five minutes or over one 25-job batch; capture depth/age.                         |    5 min | Yes                   | Keep reconciliation active unless harmful; escalate capacity/failure cause.                       |
| `unpaid_manual_review_open`                                 | WARNING           | Retrieve Stripe state and topology; do not infer unpaid.                                           |   15 min | Not yet               | Exact targeted recovery may be appropriate after review; stop on ambiguity.                       |
| `unpaid_manual_review_stale`                                | ROLLBACK_REQUIRED | Preserve manual-review evidence and disable new admission.                                         |    5 min | Yes                   | Exact recovery only under the targeted procedure.                                                 |
| `paid_manual_review_open`                                   | ROLLBACK_REQUIRED | Follow paid incident tree immediately.                                                             |    5 min | Yes                   | Never release as unpaid; human fulfil/refund decision required.                                   |
| `authoritative_reservation_overdue`                         | WARNING           | Inspect persisted Session expiry, Stripe state and worker queue.                                   |   10 min | Not yet               | Keep scheduler active; targeted recovery may be used for the exact attempt after prechecks.       |
| `authoritative_reservation_overdue_stale`                   | ROLLBACK_REQUIRED | Preserve lifecycle evidence and disable new admission.                                             |    5 min | Yes                   | Keep reconciliation/Stripe authority; never use local expiry alone.                               |
| `monitor_heartbeat_delayed`                                 | WARNING           | Inspect monitor cron and latest snapshot/evaluator result.                                         |   10 min | Not yet               | Stop rollout expansion; do not change thresholds.                                                 |
| `monitor_heartbeat_stale` / `monitor_heartbeat_missing`     | ROLLBACK_REQUIRED | Health cannot be established; preserve cron evidence and disable new admission.                    |    5 min | Yes                   | Keep reconciliation active; restore monitoring through reviewed action.                           |

An evaluator error is diagnosed through failed monitor cron runs plus missing snapshot advancement; it
eventually produces `monitor_heartbeat_delayed` and then `monitor_heartbeat_stale`. External alert
pipeline unavailability is not currently emitted as a monitor reason because delivery is not yet
deployed. It remains a launch blocker, not a reason to fabricate health.

## Global reservation rollback

### Precheck

1. Read current health, reason codes, and metrics.
2. Capture UTC time, current flag-name metadata, inventory/ATS, open incidents/jobs, active
   attempts/intents/admissions, and scheduler/worker/monitor heartbeat state.
3. Open or update the incident record. Do not record configuration values.

### Action

**MUTATING — PRIVILEGE: authorized Supabase project operator**

```sh
npx supabase secrets unset CHECKOUT_RESERVATIONS_ENABLED \
  --project-ref "$TAA_PRODUCTION_PROJECT_REF"
```

This disables genuinely new ordinary reservation-v1 admission. It does not rewrite existing
attempts or disable canary admission.

### Verify

1. Re-run the name-only secret query and require `CHECKOUT_RESERVATIONS_ENABLED` to be absent.
2. Read both cron jobs and require them to remain active at one-minute cadence.
3. Confirm the deployed Stripe webhook, reconciler, and targeted endpoint remain available through
   the established function inventory. Do not redeploy them:

   ```sh
   npx supabase functions list \
     --project-ref "$TAA_PRODUCTION_PROJECT_REF" \
     --output json \
     | jq '[.functions[]
         | select(
             .slug == "stripe-webhook"
             or .slug == "reconcile-checkout-reservations"
           )
         | {slug, status, version, verify_jwt, updated_at}]'
   ```

   This is **READ ONLY** and requires Supabase project-operator access. Targeted recovery is a mode
   of `reconcile-checkout-reservations`, not a separate deployed function.

4. Existing attempt retries/resumes must remain reservation-v1 because the handler authenticates
   their stored protocol independently of new-admission flags.
5. Confirm the next naturally occurring ordinary checkout uses legacy behavior. Do not create a
   checkout solely for this runbook verification.
6. Continue monitoring existing v1 attempts until terminal.

### Optional all-new-v1 stop

Canary admission is separate. Remove it only under an explicit decision to stop all new
reservation-v1 admissions:

```sh
npx supabase secrets unset CHECKOUT_RESERVATIONS_CANARY_SKUS \
  --project-ref "$TAA_PRODUCTION_PROJECT_REF"
```

This is **MUTATING** and does not convert or abandon existing v1 attempts.

## Paid-state incident decision tree

For any evidence of Stripe payment, **STOP** unpaid release logic. Retrieve the Checkout Session and
PaymentIntent through privileged Stripe tooling and establish payment/refund state. Then compare the
attempt, all intents, reservation, order count, order linkage, item topology, webhook evidence,
reconciliation ledger, and real fulfilment state.

| Proven state                                                                          | Decision                                                                                                             |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Stripe paid + exactly one canonical order + consumed reservation + matching inventory | Healthy. Verify single fulfilment and close the incident with evidence.                                              |
| Stripe paid + no order                                                                | Critical. Roll back new admission, preserve evidence, and determine manual fulfilment or refund.                     |
| Stripe paid + more than one order                                                     | Critical. Roll back, stop duplicate fulfilment, identify one canonical payment, and escalate. Never delete evidence. |
| Consumed reservation + not exactly one canonical order                                | Critical. Roll back and preserve consumption/order linkage. Do not decrement again.                                  |
| Stripe paid + reservation/order/inventory mismatch                                    | Critical. Roll back; do not repair stock ad hoc. Determine fulfilment or refund from proven facts.                   |
| Paid or paid-integrity manual-review job                                              | Critical. Roll back and assign a human owner immediately.                                                            |

For every unsafe paid case:

1. Disable new global reservation admission within five minutes.
2. Preserve Stripe status/timestamps, abbreviated attempt/intent/reservation/order IDs, incident/job
   records, and aggregate inventory. Never copy card, address, customer, or raw provider data.
3. Do not manually release or consume the reservation, decrement stock, create/delete an order, or
   replay fulfilment.
4. Establish real-world fulfilment state: not started, prepared, dispatched, delivered, or already
   refunded.
5. One named incident owner chooses **manual fulfilment** or **refund** based on authoritative
   payment and fulfilment facts. There is no automated refund path in this architecture.
6. Record the decision and a safe external transaction/reference identifier. Do not record customer
   or payment details.
7. Never execute both fulfilment and refund accidentally. A later exceptional business decision to
   do both requires separate human authorization and an explicit record.
8. Verify final Stripe, order, reservation, inventory, and fulfilment state before closure.

## Targeted operator recovery

Targeted recovery is production-proven for one exact reservation-v1 attempt. It is appropriate only
when all are true:

- the exact attempt ID is known;
- the checkout materialized and belongs to reservation-v1;
- browser capability is unavailable or the operation otherwise requires exact operator recovery;
- Stripe-authoritative payment/Session resolution is required;
- the operator has recorded before-state invariants and has authority to act.

It must not be used as batch reconciliation, to hide a failed canary, without an exact attempt ID,
as inventory cleanup, solely because local expiry elapsed, or repeatedly against ambiguous paid
state.

### Request contract

- Endpoint: `POST /functions/v1/reconcile-checkout-reservations?mode=targeted`
- Authentication variable: `CHECKOUT_RECONCILIATION_SECRET`
- Body: exact JSON object containing only `checkout_attempt_id`
- Maximum scope: one attempt at a time

Never place the bearer value in argv, history, source or a transcript. Use the production-proven
non-persistent FIFO/header mechanism or an equivalently reviewed secret-aware client. That client
must populate the bearer authorization header directly from `CHECKOUT_RECONCILIATION_SECRET`, send
`Content-Type: application/json`, and use this body:

```text
{"checkout_attempt_id":"<exact-attempt-uuid>"}
```

### Result handling

| HTTP/result                                   | Operator action                                                                                                           |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 200 `recovered`                               | Provisionally successful; require terminal attempt, released-once reservation, no order, no incident, coherent inventory. |
| 200 `paid_preserved`                          | Provisionally successful; require paid attempt, consumed reservation and exactly one canonical order.                     |
| 200 `already_terminal`                        | No new work; independently verify the terminal topology before closure.                                                   |
| 202 `reconciliation_pending`                  | STOP. Preserve the reservation and allow scheduled retry; do not invoke the next target.                                  |
| 409 `manual_review_required`                  | STOP and follow paid/unpaid manual-review procedure.                                                                      |
| 409 `not_reservation_v1` / `not_materialized` | STOP; the target is outside the recovery contract.                                                                        |
| 404 `attempt_not_found`                       | STOP and verify the supplied exact ID.                                                                                    |
| 400                                           | Request contract failure; do not broaden the body or fall through to batch mode.                                          |
| 401/403                                       | STOP; preserve authentication evidence without printing the credential.                                                   |
| Any unexpected response                       | STOP; do not retry blindly.                                                                                               |

Before and after, verify attempt/intent pointers, reservation state/items, Stripe Session/payment
state, order count, incidents/jobs, ATS and exactly-once ownership. A response alone is never proof
of recovery.

## Reconciler and scheduler incidents

- Job: `taa-checkout-reconciliation-v1`
- Cadence: every minute
- Warning: scheduler/worker heartbeat over two minutes
- Rollback required: missing or over five minutes

### Known transient timing pattern

The monitor and scheduler are independent cron jobs. pg_net completion is asynchronous and the
scheduler harvests the prior response on a later cycle. A monitor snapshot can run milliseconds
before that harvest commits and briefly report `worker_heartbeat_delayed` even though pg_net already
returned HTTP 200.

For a transient warning, inspect all five layers before declaring failure:

1. cron fired;
2. scheduler recorded `http_queued` or an explicit suppression/config result;
3. pg_net produced a status/timeout/error classification;
4. durable worker state advanced to `succeeded`/`failed`;
5. failure count and queue backlog remained bounded.

Do not change thresholds or manually invoke reconciliation to erase the warning. Escalate if durable
health does not recover before the existing five-minute boundary.

### When the scheduler stays active

Keep it active during feature rollback, transient heartbeat warnings, ordinary backlog, Stripe
uncertainty, paid/manual-review incidents, and while existing v1 attempts remain. Global rollback
must not delete the job, reconciler, Vault credential, or webhook.

### Exceptional scheduler deactivation

Temporarily disable only when its own repeated execution is proven harmful, a credential-abuse
incident requires containment, or an approved scheduler-specific rollback is underway. Disable new
global admission first and preserve evidence.

**MUTATING — PRIVILEGE: postgres/cron operator**

```sql
SELECT cron.alter_job(jobid, active := false)
FROM cron.job
WHERE jobname = 'taa-checkout-reconciliation-v1';
```

This does not delete the Edge Function, Vault credential, webhooks, jobs, or attempts. Re-enable
only by separate authorization after the cause is fixed and current health can be established.

## Monitor incidents

- Job: `taa-checkout-health-monitor-v1`
- Cadence: every minute
- Warning: latest snapshot over two minutes old
- Rollback required: missing or over five minutes old

If the monitor is delayed, inspect the named cron job, latest run result, latest snapshot timestamp,
and whether `private.evaluate_checkout_health_v1()` or snapshot persistence failed. Do not infer
`HEALTHY` from the absence of a new snapshot.

If the monitor job stops, evaluator errors continue, snapshots stop advancing, or health cannot be
established for over five minutes: disable new global admission within five minutes of the critical
classification. Keep reconciliation and webhooks active. Monitoring never changes the flag itself.

Disable the monitor job only if the monitor itself is proven to cause harmful database impact and
global admission is already OFF. A stopped monitor removes safety visibility and is not a healthy
steady state.

## External alert routing pending

External alert routing is not production-operational and remains a controlled global-enable
blocker. Readiness discovery established SES production sending capability for the TAA domain.
Amazon SNS SMS production access is pending; no alert worker or verified delivery route is live.
Manual polling is not a permanent substitute.

Approved future ownership, not current delivery evidence:

- `WARNING`: email `support@theanimalalchemist.com` for Dexter/primary response.
- Initial `ROLLBACK_REQUIRED`: email `support@theanimalalchemist.com` and Dexter via SNS SMS.
- Final failsafe: `meg@theanimalalchemist.com` and Meg via SNS SMS if Dexter is unavailable or the
  incident remains unacknowledged after two minutes, preserving the five-minute rollback SLA.
- Meg is not the initial critical recipient.

No SMS destination belongs in Git, this runbook, project memory, logs, or chat.

## Credential and configuration ownership

| Purpose                             | Name only                                  | Owner/access note                                                                                                          |
| ----------------------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| Reconciler current credential       | `CHECKOUT_RECONCILIATION_SECRET`           | Supabase Edge secret; Dexter/operator process for approved recovery. Rotate rather than trying to recover a lost value.    |
| Reconciler rotation overlap         | `CHECKOUT_RECONCILIATION_PREVIOUS_SECRET`  | Optional bounded rotation only; remove after callers switch.                                                               |
| Scheduler reconciliation credential | Vault `taa_checkout_reconciliation_secret` | Read by the private scheduler at runtime; rotate with the Edge copy and do not delete during feature rollback.             |
| Scheduler function origin           | Vault `taa_supabase_functions_url`         | Origin metadata; preserve during feature rollback.                                                                         |
| Monitor                             | No delivery credential                     | Private postgres function and cron job.                                                                                    |
| Global admission                    | `CHECKOUT_RESERVATIONS_ENABLED`            | Supabase Edge configuration; Dexter controls production mutation. Model B is local only and must still be deployed/proven. |
| Canary admission                    | `CHECKOUT_RESERVATIONS_CANARY_SKUS`        | Separate Supabase Edge configuration; not part of Meg's emergency control.                                                 |
| Model B credential                  | `taa/model-b/supabase-management-token`    | Future dedicated AWS secret; not provisioned. Token requires `edge_functions_secrets_write` only.                          |
| Model B runbook                     | `TAA-EmergencyDisableCheckoutReservations` | Future pinned SSM Automation version; local template only, not deployed or available to Meg.                               |
| Supabase control-plane access       | Named Supabase user/session                | Dexter's current session is verified; alternate-device and second-human recovery are not.                                  |
| AWS human access                    | Named AWS identity                         | Current access is verified but MFA/least-privilege recovery requirements remain open.                                      |
| Stripe operator access              | Named Stripe user                          | Current live/test access, MFA, and recovery are not verified.                                                              |
| GitHub operator access              | Named GitHub user                          | Dexter has current repository administration; public runbook remains readable without Codex.                               |
| Future alert delivery               | Not provisioned/verified                   | Must use least privilege and secure AWS/Supabase secret storage; names recorded only after implementation.                 |

Meg must know where the approved Supabase/AWS operator access is held and how to reach Dexter, but
this runbook does not assert that she currently possesses infrastructure credentials.

## Human failover tabletop

These are documentation/access outcomes, not production exercises:

| Scenario                                                           | Who acts / safe action                                                                                      | Result                            | Remaining gap                                                               |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- | --------------------------------- | --------------------------------------------------------------------------- |
| Dexter receives `ROLLBACK_REQUIRED` and is available               | Dexter preserves evidence, removes only the global flag, verifies OFF, and keeps lifecycle services active. | PASS with current operator access | External alert receipt is not live yet.                                     |
| Dexter's alert path fails and Meg receives the final failsafe      | Meg reads this runbook and contacts Dexter; she must use Model B if he cannot respond.                      | FAIL currently                    | Failsafe delivery is absent and local Model B is not deployed/tested.       |
| Meg receives the failsafe and Dexter is unreachable for 15 minutes | Meg must disable global admission within the five-minute SLA through Model B.                               | FAIL currently                    | Local source is not a verified mutation path; Model A remains insufficient. |
| Codex is unavailable                                               | Read this committed document directly from Git; perform no chat-dependent step.                             | PASS for document availability    | Meg has not acknowledged/tested the path.                                   |
| Dexter's Mac is unavailable                                        | Use an independently recoverable named account and this Git-hosted runbook.                                 | FAIL currently                    | Alternate-device Supabase/Stripe/account recovery is not verified.          |
| The password-manager primary device is unavailable                 | Use documented second-human recovery without sharing credentials.                                           | FAIL currently                    | No authoritative password-manager or tested recovery process is evidenced.  |

Until all three human-readiness actions above and external alert delivery are proven, a critical
incident can become unrecoverable when Dexter or his primary device is unavailable. Global
reservations must remain OFF.

## Incident record template

```text
Incident ID:
UTC opened:
Health classification:
Reason codes:
Affected attempt/order IDs (first 8 characters only):
Operator:
Global reservation flag: OFF / ON / UNKNOWN
Canary admission: CONFIGURED / OFF / UNKNOWN
Scheduler heartbeat/state:
Worker heartbeat/state:
Monitor heartbeat/state:
Payment state: PAID / UNPAID / PROCESSING / UNKNOWN
Inventory invariant state:
Open incident/job summary:
Action taken:
Global rollback UTC (if any):
Fulfilment state:
Decision: NONE / MANUAL FULFILMENT / REFUND
Safe external transaction/reference:
Recovery verification:
UTC closed:
Follow-up issue/reference:
```

Never include credentials, bearer headers, capabilities, customer identity/address, card/payment
details, raw database/provider errors, or SMS destinations.

## Re-enablement gate after rollback

Re-enablement is a separate explicit human decision. Every requirement must be evidenced:

- root cause identified or risk conclusively bounded;
- current health `HEALTHY` with no critical reason code;
- monitor, scheduler and worker heartbeats current;
- no authoritative-overdue held reservation;
- no open paid/integrity incident;
- no paid or critical manual-review job;
- inventory ownership and ATS valid;
- paid/order/reservation cardinality valid;
- any code/configuration fix deployed and verified at the appropriate layer;
- external alert delivery production-proven;
- incident record and follow-up complete;
- Dexter/authorized human explicitly approves re-enablement.

“It looks fine now,” elapsed time, or one healthy snapshot is insufficient. Do not re-enable in the
same action that applies a fix or closes an incident.

## Controlled global-enable launch watch

The watch lasts **at least 24 hours and the first 10 successful non-canary reservation-v1
checkouts, whichever is longer**.

| Checkpoint                                   | Required checks                                                                                                                                          |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Immediately before enablement                | `HEALTHY`; current three heartbeats; valid inventory; no open incidents/jobs or overdue reservations; alert delivery healthy; rollback access confirmed. |
| Immediately after first non-canary admission | Health/reasons; one coherent attempt/request/intent/reservation; ATS; no duplicate ownership.                                                            |
| After first successful payment               | Stripe paid; exactly one order; exactly one consumed reservation; one physical decrement; no paid incident.                                              |
| 15 minutes                                   | Health and three heartbeats; inventory; paid/order integrity; incidents/jobs; overdue reservations; alert delivery.                                      |
| 1 hour                                       | Same full check plus warning history and reconciliation failure/backlog trend.                                                                           |
| 4 hours                                      | Same full check plus all non-canary v1 outcomes to date.                                                                                                 |
| 24 hours                                     | Same full check; do not end watch unless 10 successful non-canary checkouts are also complete.                                                           |
| Each success through number 10               | Paid/order/reservation exactly-once checks, inventory, incidents/jobs and current health.                                                                |

Any `ROLLBACK_REQUIRED` reason invokes global rollback within five minutes. Any `WARNING` freezes
rollout expansion and starts reason-specific investigation. Continue the watch until both the time
and event minimums pass with all warnings resolved and no rollback event.

## Closure checklist

An incident closes only when:

- the authoritative state and cause are known;
- required rollback/recovery/refund/fulfilment actions are complete;
- exactly-once order/reservation/inventory invariants are verified;
- current health and heartbeats are established;
- existing affected attempts are terminal or have an explicitly owned follow-up;
- the incident record is complete and contains no sensitive data;
- re-enablement, if desired, is deferred to a separate authorized decision.
