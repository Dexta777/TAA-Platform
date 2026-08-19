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
have been corrected and focused production re-verification is complete. The remaining work is
operational readiness, not another repetition of already-closed payment or recovery scenarios.

## Git and Deployment State

- `origin/main` contains Scenario F commit
  `b3a48077a11461bdf8326521177e8a2dd1fa34d3`.
- Migration `20260824120200_checkout_replacement_admission_lifecycle.sql` is deployed and represented
  in remote Git history.
- The local cleanup series contains:
  - `21b906971b6774bab0a81a9a3082db9c529a8346` — safe checkout database diagnostics;
  - `e5f8035b4e1b84a4af6e46095e6ea304d73ca9b9` — repository verification discipline;
  - `daea5bd0f16653b11f1d63c49afb44019553c8d5` — generated Playwright artifact ignore rule;
  - this project-memory consolidation commit.
- The cleanup series is local-only pending final review. No cleanup commit has been pushed.
- The diagnostic commit is not deployed. It changes observability only and requires an Edge
  Function deployment if separately approved later.

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
- Batch reconciler: VERIFIED READY FOR SCHEDULING.
- Reservation ownership, replacement lineage, paid finalization, unpaid release, browser recovery,
  confirmation capability and canary admission boundaries have the evidence grades recorded above.

## Latest Recorded Production Baseline

The latest focused Scenario F cleanup returned the synthetic environment to:

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

This is the latest recorded baseline, not a live re-read performed during source-control cleanup.

## Production Configuration

- Global reservations remain OFF; `CHECKOUT_RESERVATIONS_ENABLED` was absent at the latest recorded
  production checkpoint.
- Synthetic canary admission remains configured independently of the global flag.
- Recorded canary Checkout Sessions use Stripe TEST MODE.
- The reconciler remains available and authenticated batch behavior is production-proven.
- Reconciliation remains unscheduled.
- No monitoring or scheduler configuration was changed during the checkout correctness work or the
  working-tree cleanup.

## Open Global-Enable Blockers

### 1. Reconciliation Scheduling

The batch reconciler is verified ready, but no production schedule is evidenced. Scheduling must
remain gated on the monitoring and operator-readiness work below.

### 2. Monitoring and Objective Rollback Thresholds

External monitoring and heartbeat evidence remain open for lifecycle incidents, retry/manual-review
jobs, overdue held reservations and reconciler execution. Numeric rollback thresholds and the
post-enable canary gate still require documented approval.

### 3. Operator Runbook

The authoritative paid-incident, refund/manual-fulfilment, reconciliation, rollback and escalation
runbook remains open. It must identify operational ownership, access, alert response and rollback
steps without recording credentials.

Global reservation enablement remains blocked until these controls are completed and reviewed.

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
- Do not schedule reconciliation before monitoring, rollback thresholds and the operator runbook are
  approved.
- Do not repeat A/D/E/F/G/H, 7C1 or targeted recovery without a new evidence need.
- Do not upgrade B/C/I/J beyond their recorded evidence layers.
- Do not deploy the local diagnostic commit without a separate review and deployment instruction.
- Always inspect `git status --short` and current Git history before attributing evidence.

## Exact Next Action

Perform a final read-only review of the local cleanup commits, then push them only under separate
explicit authorization. After provenance is synchronized, complete the monitoring, rollback
threshold and operator-runbook work before configuring the reconciliation schedule or considering
global reservation enablement.
