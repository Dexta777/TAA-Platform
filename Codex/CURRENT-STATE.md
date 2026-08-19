# TAA Platform — Current State

> Purpose: canonical operational memory for AI agents and human contributors.
> This file describes the latest supported project state. Historical failures,
> blocked attempts and superseded evidence remain in `Codex/VERIFICATION-LOG.md`.

## Evidence Contract

Project claims must keep source, test, deployment, runtime and production evidence separate.
`Unknown` is not `absent`, and a lower verification layer must not be presented as a higher one.
The working tree, Git history, deployment records and runtime evidence must all be inspected before
making claims about current operational state.

## Current Objective

Finish the operational controls required for a deliberate reservation-v1 production rollout while
keeping global reservations off. Checkout correctness defects found by the payment/recovery matrix
have been corrected, focused production re-verification is complete, and the mandatory recurring
reconciliation scheduler plus dual-layer heartbeat are production-active. The database-native
lifecycle monitor and explicit rollback thresholds are also production-active and verified. The
remaining global-enable readiness work is the operator/incident runbook and an explicit launch
decision, not another repetition of already-closed payment or recovery scenarios.

## Git and Deployment State

- `origin/main` remains at `27fb9dd31463e508f0561b63d4ed867889f72229`.
- Local `main` contains unpushed monitoring provenance: implementation commit
  `27d19a78ddd16002c98713946e866aac9c2851f0` plus the project-memory evidence update in
  this commit.
- Migration `20260824120200_checkout_replacement_admission_lifecycle.sql` is deployed and represented
  in remote Git history.
- The synchronized cleanup series contains:
  - `21b906971b6774bab0a81a9a3082db9c529a8346` — safe checkout database diagnostics;
  - `e5f8035b4e1b84a4af6e46095e6ea304d73ca9b9` — repository verification discipline;
  - `daea5bd0f16653b11f1d63c49afb44019553c8d5` — generated Playwright artifact ignore rule;
  - `e6eb75fb8500ed853dc1f326edb9af1a1fb15706` — project-memory consolidation.
- The diagnostic commit is not deployed. It changes observability only and requires an Edge
  Function deployment if separately approved later.
- Scheduler migration `20260824120300_checkout_reconciliation_scheduler.sql` is deployed in
  production and represented with its focused regression and operational contract in commit
  `762b3116dc76961dc32497b890369a8e951ff543`.
- Monitoring migration `20260824120400_checkout_lifecycle_monitoring.sql` is deployed in production
  and represented with its focused database/concurrency regressions and operational documentation
  in local commit `27d19a78ddd16002c98713946e866aac9c2851f0`.

## Reservation-v1 Matrix

| Scenario                                           | Current evidence                                | Result                 |
| -------------------------------------------------- | ----------------------------------------------- | ---------------------- |
| A — successful payment                             | Production runtime                              | PASS                   |
| B — duplicate webhook/finalization                 | Strong integration and concurrency              | PASS at recorded layer |
| C — delayed/missed success                         | Strong integration                              | PASS at recorded layer |
| D — authoritative unpaid expiry                    | Production runtime                              | PASS                   |
| E — browser reload recovery                        | Production runtime                              | PASS; blocker CLOSED   |
| F — replacement lineage                            | Production runtime                              | PASS; blocker CLOSED   |
| G — authenticated empty-body batch reconciliation  | Production runtime                              | PASS                   |
| H — confirmation capability                        | Production runtime                              | PASS                   |
| I — paid-state preservation through reconciliation | Strong integration and concurrency              | PASS at recorded layer |
| J — terminal-unpaid reconciliation no-op           | Integration plus supporting production evidence | PASS at recorded layer |

B/C/I/J retain their honest evidence grades. They must not be described as production-runtime PASS
or repeated merely to improve labels without a documented safe runtime mechanism.

## Closed Checkout Correctness Work

- Scenario E worker-lease lifecycle defect: CLOSED and production-runtime verified.
- Scenario F replacement-admission lifecycle defect: CLOSED and production-runtime verified.
- 7C1 final-unit inventory conflict behavior: PASS / CLOSED.
- Authenticated exact-attempt operator recovery: PRODUCTION-PROVEN.
- Batch reconciler: VERIFIED READY FOR SCHEDULING and now SCHEDULED with production heartbeat
  evidence.
- Reservation-v1 lifecycle monitor and objective rollback thresholds: PRODUCTION ACTIVE / CLOSED.
- Reservation ownership, replacement lineage, paid finalization, unpaid release, browser recovery,
  confirmation capability and canary admission boundaries have the evidence grades recorded above.

## Latest Recorded Production Baseline

The monitoring activation final safety checkpoint at `2026-08-19T13:49:33Z` confirmed the synthetic
environment remains:

| SKU               | Physical | Reserved | ATS |
| ----------------- | -------: | -------: | --: |
| `TAA-CANARY-A`    |        4 |        0 |   4 |
| `TAA-CANARY-BASE` |        1 |        0 |   1 |
| `TAA-CANARY-C`    |        4 |        0 |   4 |

A and C remain physically 4 because Scenario A legitimately purchased one unit of each.

The same checkpoint recorded:

- active synthetic attempts: 0;
- active synthetic intents: 0;
- active admissions: 0;
- held reservations: 0;
- due reservations: 0;
- open lifecycle incidents: 0;
- open reconciliation jobs: 0;
- empty synthetic basket.

This is the latest recorded production baseline from the monitoring activation verification.

## Production Configuration

- Global reservations remain OFF; `CHECKOUT_RESERVATIONS_ENABLED` was absent at the latest recorded
  production checkpoint.
- Synthetic canary admission remains configured independently of the global flag.
- Recorded canary Checkout Sessions use Stripe TEST MODE.
- The reconciler remains available and authenticated batch behavior is production-proven.
- Reconciliation is scheduled every minute by the active production `pg_cron` job
  `taa-checkout-reconciliation-v1`. The job invokes `pg_net`, resolves its origin and credential
  from Vault at runtime, and records credential-free scheduler and worker evidence in
  `private.checkout_reconciliation_scheduler_runs`.
- Vault contains the scheduler credential under the name `taa_checkout_reconciliation_secret`.
  It was copied from the existing Edge credential through the approved non-persistent FIFO path;
  no value was written to source, migration SQL, cron metadata, logs or project memory.
- Three consecutive scheduled empty-queue completions were observed at `2026-08-19T13:04:00Z`,
  `13:05:00Z`, and `13:06:00Z`. Each recorded HTTP 200, `claimed = 0`, zero terminalized empty
  attempts, and no worker failure. At `13:07:36Z`, the scheduler heartbeat was 37 seconds old and
  the latest completed worker heartbeat was 97 seconds old.
- The provisional stale-worker threshold is five minutes: five missed one-minute completion
  heartbeats. External notification routing remains part of the operator/incident-runbook task.
- Scheduler rollback is `cron.alter_job(jobid, active := false)` for the exact named job. It leaves
  the reconciler, Stripe webhooks, Vault credential and existing reservation-v1 lifecycle active.
- Lifecycle monitoring is scheduled independently every minute by the active production job
  `taa-checkout-health-monitor-v1`. It records one private minute-idempotent snapshot in
  `private.checkout_health_snapshots` and exposes only private operator functions.
- Three consecutive real monitor cycles at `2026-08-19T13:47:00Z`, `13:48:00Z`, and `13:49:00Z`
  completed successfully as `HEALTHY` with empty reason-code sets. At `13:49:33Z`, monitor age was
  33 seconds; the reconciler scheduler and worker remained current with zero recent failures.
- Monitor, scheduler, and worker heartbeat warning thresholds are two minutes and rollback
  thresholds are five minutes. Critical inventory, paid/order, paid-release, duplicate-finalization,
  paid/manual-review, scheduler-authentication, and severe lifecycle-incident conditions require
  immediate `ROLLBACK_REQUIRED` classification.
- The explicit feature rollback is operator-authorised removal of
  `CHECKOUT_RESERVATIONS_ENABLED`; it is not automated. Existing reservation-v1 attempts,
  reconciliation, Stripe webhooks, targeted recovery, and canary admission remain available.
- The complete reason-code, response-time, feature rollback, and initial 24-hour/10-success launch
  watch contract is recorded in `docs/checkout-lifecycle-monitoring.md`.

## Open Global-Enable Blockers

### 1. Operator Runbook

The authoritative paid-incident, refund/manual-fulfilment, reconciliation, rollback and escalation
runbook remains open. It must identify operational ownership, access, alert response and rollback
steps without recording credentials.

The lifecycle monitoring/rollback-threshold blocker is closed. Database monitoring deliberately
does not claim an HTTP checkout error-rate because no accurate request denominator is persisted.
Remaining readiness gates are the authoritative operator/incident runbook, external log/alert
routing, human readiness review, and separate explicit global-enable authorisation. Global
reservation enablement remains blocked until those gates are completed and reviewed.

## Current Architecture

### Frontend

- Vite and JavaScript ES modules;
- Webflow as hosted/CMS presentation;
- data-attribute application contracts;
- Stripe Checkout Elements;
- `localStorage` for the non-sensitive basket and `sessionStorage` for tab-scoped checkout recovery.

### Backend

- Supabase PostgreSQL owns reservation, inventory, order and checkout lifecycle transitions;
- Stripe remains authoritative for payment and Checkout Session state;
- Edge Functions own authenticated integration and orchestration boundaries;
- one attempt-owned reservation survives Session replacement;
- paid and unpaid transitions remain fail closed under ambiguity.

ADR-0001 remains the authority for reservation-owned checkout finalization and lock ordering.

## Local-Only Tooling

- `.codex/` contains the machine-local named browser MCP profiles and remains local-only.
- `.opencode/` and `opencode.json` contain local/incomplete OpenCode tooling and generated
  dependencies. They are preserved locally and deferred for a separate deliberate tooling review.
- These paths are excluded through local `.git/info/exclude`, not committed project ignore rules.
- `.playwright-mcp/` is generated browser output and is universally ignored.

## Current Constraints

- Do not enable global reservations as an incidental part of another task.
- The reconciliation scheduler is production-active. Do not alter or disable it except through an
  explicit operational decision or the documented scheduler-only rollback.
- The lifecycle monitor is production-active. Do not alter it or treat its classification as an
  automatic feature-flag command; rollback remains an explicit operator action.
- Do not repeat A/D/E/F/G/H, 7C1 or targeted recovery without a new evidence need.
- Do not upgrade B/C/I/J beyond their recorded evidence layers.
- Do not deploy the local diagnostic commit without a separate review and deployment instruction.
- Always inspect `git status --short` and current Git history before attributing evidence.

## Exact Next Action

Perform a final read-only review of the two local monitoring provenance commits and push only under
separate explicit authorisation. Then complete the authoritative operator/incident runbook,
external alert/log routing, and human readiness review before a separate global-enable decision.
Global reservations remain off.
