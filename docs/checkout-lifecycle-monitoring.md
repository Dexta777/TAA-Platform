# Checkout Lifecycle Monitoring and Rollback Contract

## Scope

This document defines the reservation-v1 lifecycle health contract. The monitor observes durable
database state once per minute and records a private, credential-free snapshot. It does not repair
checkout state, call Stripe, enable reservations, or execute rollback automatically.

The authoritative operator classification is one of:

- `HEALTHY`: no warning or rollback condition is present.
- `WARNING`: a transient condition is outside the normal one-minute processing envelope but has not
  crossed the rollback boundary.
- `ROLLBACK_REQUIRED`: a correctness invariant is broken or recovery coverage has exceeded its safe
  time or capacity boundary.

The private monitor job is `taa-checkout-health-monitor-v1`, runs every minute, and executes only
`private.record_checkout_health_snapshot_v1()`. Snapshots are minute-idempotent, immutable during
their 30-day retention window, contain only aggregate counts/timestamps/reason codes, and are not
accessible to `anon`, `authenticated`, or `service_role`.

## Authoritative Signals

| Signal                                           | Source                                                                                  | Meaning                                                                                  |
| ------------------------------------------------ | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Physical, reserved, and ATS quantities           | `products`, `product_variants`, `inventory_reservations`, `inventory_reservation_items` | Current authoritative inventory ownership; instantaneous                                 |
| Attempt, intent, order, and reservation topology | `checkout_attempts`, `checkout_intents`, `orders`, `order_items`, reservation tables    | Exactly-once paid/finalized lifecycle integrity; instantaneous                           |
| Lifecycle incidents                              | `checkout_lifecycle_incidents`                                                          | Durable ambiguity or invariant-conflict evidence; historical until resolved              |
| Reconciliation queue                             | `checkout_reconciliation_jobs`                                                          | Pending, claimed, retry, and manual-review recovery obligations; instantaneous plus age  |
| Scheduler heartbeat                              | `private.checkout_reconciliation_scheduler_runs.scheduler_fired_at`                     | The reconciliation cron fired; historical                                                |
| Worker heartbeat                                 | `private.checkout_reconciliation_scheduler_runs.worker_completed_at`                    | The authenticated reconciler completed successfully; historical                          |
| Monitor heartbeat                                | `private.checkout_health_snapshots.evaluated_at`                                        | The independent monitor completed; historical                                            |
| Authoritative unpaid deadline                    | Active intent `stripe_session_expires_at` with a persisted Stripe Session               | The materialised Session's authoritative expiry, not merely a local reservation deadline |

The database does not persist a sufficiently accurate denominator for a checkout HTTP error-rate
metric. Edge/log error-rate alerting therefore remains a separate external-observability concern;
the lifecycle monitor does not fabricate one from incidents or reconciliation records.

## Thresholds and Reason Codes

The reconciliation and monitor cadence is one minute. Two minutes allows one missed/slow cycle and
is the warning boundary. Five minutes allows multiple recovery opportunities and is the maximum
safe stale-heartbeat/backlog boundary. Reconciliation claims at most 25 jobs per cycle, so more than
25 due jobs exceeds one full worker batch and requires rollback.

| Reason code                                                 | Classification      | Condition                                                                                                            | Operator response                                                              | Maximum response |
| ----------------------------------------------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ---------------- |
| `inventory_negative_ats`                                    | `ROLLBACK_REQUIRED` | Physical minus active reserved quantity is below zero                                                                | Roll back global admission; preserve evidence; investigate inventory ownership | 5 minutes        |
| `reservation_ownership_invalid`                             | `ROLLBACK_REQUIRED` | Missing/duplicate reservation items, duplicate attempt ownership, or active ownership attached to a terminal attempt | Roll back global admission; preserve evidence                                  | 5 minutes        |
| `paid_order_cardinality_invalid`                            | `ROLLBACK_REQUIRED` | A paid reservation-v1 attempt does not have exactly one order                                                        | Roll back; stop payment-path expansion; preserve evidence                      | 5 minutes        |
| `consumed_reservation_order_invalid`                        | `ROLLBACK_REQUIRED` | A consumed reservation lacks the one canonical attempt order or points to another order                              | Roll back; preserve evidence                                                   | 5 minutes        |
| `duplicate_order_finalization`                              | `ROLLBACK_REQUIRED` | More than one order exists for one checkout attempt                                                                  | Roll back immediately; preserve payment/order evidence                         | 5 minutes        |
| `paid_inventory_mismatch`                                   | `ROLLBACK_REQUIRED` | Paid intent/order/reservation items are not bidirectionally identical                                                | Roll back; preserve evidence                                                   | 5 minutes        |
| `paid_state_released_as_unpaid`                             | `ROLLBACK_REQUIRED` | A paid attempt/intent has a released reservation                                                                     | Roll back immediately; preserve evidence                                       | 5 minutes        |
| `paid_lifecycle_invalid`                                    | `ROLLBACK_REQUIRED` | A paid intent is not backed by a paid attempt and its canonical order                                                | Roll back; preserve evidence                                                   | 5 minutes        |
| `paid_or_integrity_incident_open`                           | `ROLLBACK_REQUIRED` | Any open paid, finalization, Stripe-identity, or idempotency integrity incident                                      | Roll back; follow incident runbook                                             | 5 minutes        |
| `stripe_discovery_incident_open`                            | `WARNING`           | A new `stripe_session_discovery_failed` incident is open                                                             | Investigate Stripe discovery and queue state                                   | 15 minutes       |
| `stripe_discovery_incident_stale`                           | `ROLLBACK_REQUIRED` | Discovery incident remains open for more than five minutes                                                           | Roll back; preserve evidence                                                   | 5 minutes        |
| `scheduler_heartbeat_delayed`                               | `WARNING`           | Latest reconciliation scheduler fire is older than two minutes                                                       | Inspect cron run history and database availability                             | 10 minutes       |
| `scheduler_heartbeat_stale` / `scheduler_heartbeat_missing` | `ROLLBACK_REQUIRED` | No scheduler heartbeat or latest fire is older than five minutes                                                     | Roll back; keep reconciler/webhook deployed                                    | 5 minutes        |
| `worker_heartbeat_delayed`                                  | `WARNING`           | Latest successful reconciler completion is older than two minutes                                                    | Inspect pg_net and worker result ledger                                        | 10 minutes       |
| `worker_heartbeat_stale` / `worker_heartbeat_missing`       | `ROLLBACK_REQUIRED` | No successful worker heartbeat or it is older than five minutes                                                      | Roll back; leave scheduler and recovery available                              | 5 minutes        |
| `scheduler_configuration_failure`                           | `ROLLBACK_REQUIRED` | Latest scheduler cycle reports missing/invalid Vault configuration                                                   | Roll back; repair Vault metadata without exposing credentials                  | 5 minutes        |
| `scheduler_authentication_failure`                          | `ROLLBACK_REQUIRED` | Latest terminal worker result is HTTP 401 or 403                                                                     | Roll back; investigate the private auth boundary                               | 5 minutes        |
| `scheduler_invocation_warning`                              | `WARNING`           | Latest scheduler cycle reports lock contention or HTTP queue failure                                                 | Inspect recurrence; escalate if heartbeat/backlog crosses five minutes         | 10 minutes       |
| `reconciliation_worker_failure`                             | `WARNING`           | Latest terminal worker invocation failed once                                                                        | Inspect the next cycle and transport/HTTP result                               | 10 minutes       |
| `reconciliation_worker_failures_persistent`                 | `ROLLBACK_REQUIRED` | Three terminal worker failures occurred after the last success                                                       | Roll back; preserve ledger evidence                                            | 5 minutes        |
| `scheduler_request_in_flight_delayed`                       | `WARNING`           | An unresolved pg_net invocation is older than two minutes                                                            | Inspect pg_net response state                                                  | 10 minutes       |
| `scheduler_request_in_flight_stale`                         | `ROLLBACK_REQUIRED` | An unresolved pg_net invocation is older than five minutes                                                           | Roll back; preserve transport evidence                                         | 5 minutes        |
| `reconciliation_backlog_delayed`                            | `WARNING`           | Due pending/expired-claim work is older than two minutes                                                             | Inspect queue and next worker cycle                                            | 10 minutes       |
| `reconciliation_backlog_stale`                              | `ROLLBACK_REQUIRED` | Due work is older than five minutes or exceeds the 25-job batch capacity                                             | Roll back; keep reconciliation running                                         | 5 minutes        |
| `unpaid_manual_review_open`                                 | `WARNING`           | A recent non-paid manual-review job requires operator attention                                                      | Triage authoritative Stripe state; do not infer unpaid from browser/local time | 15 minutes       |
| `unpaid_manual_review_stale`                                | `ROLLBACK_REQUIRED` | Non-paid manual review remains unresolved for more than five minutes                                                 | Roll back; use approved recovery/runbook only                                  | 5 minutes        |
| `paid_manual_review_open`                                   | `ROLLBACK_REQUIRED` | Any paid or paid-integrity job is in manual review                                                                   | Roll back immediately; preserve payment evidence                               | 5 minutes        |
| `authoritative_reservation_overdue`                         | `WARNING`           | A held reservation's persisted Stripe Session expiry is more than two minutes old                                    | Inspect reconciliation and authoritative Session state                         | 10 minutes       |
| `authoritative_reservation_overdue_stale`                   | `ROLLBACK_REQUIRED` | The same authoritative expiry is more than five minutes old                                                          | Roll back; preserve lifecycle evidence                                         | 5 minutes        |
| `monitor_heartbeat_delayed`                                 | `WARNING`           | Latest health snapshot is older than two minutes                                                                     | Inspect monitor cron history                                                   | 10 minutes       |
| `monitor_heartbeat_stale` / `monitor_heartbeat_missing`     | `ROLLBACK_REQUIRED` | No health snapshot or latest snapshot is older than five minutes                                                     | Roll back because lifecycle health can no longer be established                | 5 minutes        |

A local `inventory_reservations.expires_at` value does not by itself produce an overdue reason while
the persisted Stripe Session remains legitimately payable. Payment-pending state is covered by the
reconciliation queue and paid/manual-review rules.

## Explicit Feature Rollback

Rollback is a human-authorised operator action. It is not performed by the monitor.

1. Preserve the current health snapshot, reason codes, reconciliation ledger, incident/job counts,
   and non-sensitive inventory totals.
2. Remove `CHECKOUT_RESERVATIONS_ENABLED` from the production Edge Function secret/configuration
   using the approved Supabase operator workflow. Absence is the authoritative OFF state.
3. Verify the variable is absent by name/metadata only and verify new ordinary checkouts select the
   legacy protocol without creating a canary.
4. Leave `taa-checkout-reconciliation-v1` active.
5. Leave Stripe webhooks, the reconciliation credential, the reconciler Edge Function, and
   authenticated targeted recovery active.
6. Existing reservation-v1 attempts continue under reservation-v1. Canary admission may remain
   available unless a separate incident decision disables it.
7. Do not perform direct SQL repair. Follow the approved incident/recovery runbook for affected
   attempts.

The monitor itself can be deactivated independently, without changing checkout or reconciliation:

```sql
SELECT cron.alter_job(jobid, active := false)
FROM cron.job
WHERE jobname = 'taa-checkout-health-monitor-v1';
```

This monitor-only rollback is not a substitute for feature rollback when current health is
`ROLLBACK_REQUIRED`.

## Controlled Global-Enable Watch Window

Global enablement remains a separate, explicit decision. The initial watch window is at least 24
hours and at least the first 10 successful non-canary reservation-v1 checkouts, whichever takes
longer. This conservative event-and-time boundary accounts for currently limited production-volume
evidence.

1. Immediately before enablement, require current health `HEALTHY`, monitor/reconciler heartbeats
   under two minutes, no open incidents/jobs, no held overdue reservations, and documented rollback
   access.
2. Enable only through the approved `CHECKOUT_RESERVATIONS_ENABLED` production configuration change.
3. Read current health immediately after the first non-canary reservation-v1 admission.
4. Read current health immediately after the first successful payment and verify exactly one order,
   one consumed reservation, and one physical decrement through aggregate/operator-safe evidence.
5. Keep the monitor and reconciler running continuously. Review at 15 minutes, one hour, four hours,
   and 24 hours, and after each of the first 10 successful reservation-v1 checkouts.
6. A `ROLLBACK_REQUIRED` result requires feature rollback within five minutes. A `WARNING` blocks
   further rollout expansion and requires investigation; if it persists to its five-minute rollback
   boundary or gains a rollback reason, roll back.
7. End the initial watch only after both the time and event minimums pass with no rollback event and
   all warnings resolved.
