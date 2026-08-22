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

Advance the pushed Members Area Phase A authentication foundation and its published Webflow
contract toward controlled release and browser-verification gates, while finishing the operational
controls required for a deliberate reservation-v1 production rollout with global reservations off.
The production customer/account migration is applied: `auth.users → customer_profiles` is canonical,
`orders.user_id` is the permanent account authorization boundary, and email-derived order
visibility is removed. The Phase A Auth Foundation is implemented, committed, and pushed to
`origin/main`; its latest runtime correction is
`92dbfc7900ef15ffa48ca6a7134a1c1d35fb9d40`. The `Header Global` Auth contract exists in the
published Webflow site, including the shared modal, and the `/account` Auth contract is also
published. No Auth-capable frontend release has been generated or deployed, the repository callback
prelude is not loaded in production, callback ordering remains pending, and no controlled browser or
production-runtime verification has occurred. Customer signup availability, remaining Auth
dashboard configuration, dashboard data, orders, addresses, payments, checkout identity,
guest-order claiming, My Animals, and TAA Academy remain outside the completed work.

Checkout correctness defects found by the payment/recovery matrix have been corrected, focused
production re-verification is complete, and the mandatory recurring reconciliation scheduler plus
dual-layer heartbeat are production-active. The database-native lifecycle monitor and explicit
rollback thresholds are also production-active and verified. The remaining global-enable readiness
work is an authenticated external alert route with an independent critical fallback, three bounded
human-readiness action streams, and an explicit launch decision—not another repetition of
already-closed payment or recovery scenarios. The authoritative operator/incident runbook is
committed and has passed source-consistency, security, focused validation and tabletop review. Model
B has a local, undeployed implementation; it is not yet an available or production-proven failsafe.

## Git and Deployment State

- `main` began Members Area Phase A clean at
  `b6556e470e2e19565ae5965e6e7e43f454fd7faf`. The pushed Auth series on `origin/main` is:
  - `42317ebc982fee3376ed68678c7a37f01d40cd97` — Phase A Auth service, lifecycle, bootstrap,
    callback prelude, tests, and architecture documentation;
  - `c52647d3ff8dfa05c899a403fbabbe5d961835dd` — Auth foundation commit provenance correction;
  - `92dbfc7900ef15ffa48ca6a7134a1c1d35fb9d40` — Webflow Auth contract display-state correction.
- No frontend release containing this Auth runtime has been generated or deployed, and the
  customer-facing Auth experience is not activated.
- The unchanged live loader still selects release `20260816T054231Z-bec2929c0c5b` by default and
  `20260818T150958Z-bec2929c0c5b` on `/checkout-test`; both releases predate Phase A Auth.
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
  in remote commit `27d19a78ddd16002c98713946e866aac9c2851f0`.

## Customer/Account Database Foundation

Migration `20260824120500_customer_account_foundation.sql` is committed and was applied to
production Supabase project `zxmywtmjvfjgdjcstgtn` under the preceding authorized migration gate.
Its contract is:

- `auth.users → customer_profiles` is the canonical one-to-one customer identity projection;
- the Auth trigger creates missing profiles, synchronizes authoritative Auth email, and preserves
  customer-edited names;
- authenticated profile writes are column-limited to `first_name`, `last_name`, and `phone`, while
  `stripe_customer_id`, email, identity, and timestamps remain server-managed;
- non-null Stripe customer linkage is unique, guarded by a fail-closed duplicate preflight;
- customer addresses retain own-row CRUD with immutable browser ownership/timestamps and partial
  unique indexes enforcing at most one shipping and one billing default per user;
- permanent order, order-item, and shipment visibility uses only explicit Auth ownership:
  `orders.user_id = auth.uid()`; historical matching email is not authorization;
- existing guest orders remain `orders.user_id IS NULL`; no guest order is claimed or modified;
- `public.profiles` is retired only after locked, fail-closed empty/dependency checks;
- Auth/profile and legacy decrement helpers have fixed safe search paths and no browser execution;
  reservation-v1 inventory/orchestration functions are unchanged;
- historical order, item, address, price, discount, shipment, and bounded payment snapshots remain
  independent of mutable customer profile/address data.

Pre-application working-tree verification passed a clean replay of all 22 migrations, focused customer and
checkout-finalization pgTAP tests (85/85), the full database suite (613/613), database lint with zero
schema errors, local catalog privilege/RLS assertions, nine relevant Deno tests, and type checks for
the checkout creation, webhook, and reconciliation functions. The local security advisor reported
no customer/account finding; its sole warning is the pre-existing out-of-scope placement of `pg_net`
in `public`. This evidence is local only and does not establish deployment or production runtime
behavior.

## Customer Communication Preference Foundation — Pushed / Not Applied

Migration `20260824120600_customer_preference_persistence.sql` is implemented, locally verified,
and committed as `02e5112d72791566156ffd39e33bbdf7d62787a2`. That implementation was pushed
successfully to `origin/main`, which now includes the preference foundation. The migration has not
been applied to production. The pushed source adds the proposed database foundation without
changing customer identity, profile grants, checkout, reservation-v1, Auth configuration, Webflow,
Stripe, Klaviyo, or any live data:

- `customer_preferences` holds one Auth-owned current-state row, with optional order-status updates
  defaulting to enabled and marketing communications defaulting to disabled;
- the same true/false meanings apply when a customer has no preference row;
- essential confirmations, receipts, fulfilment-critical notices, account/security messages, and
  legally or operationally necessary service communications are outside preference control;
- `customer_preference_events` records append-only, server-authored evidence for real state
  transitions and stores no email, IP address, user agent, fingerprint, credential, or duplicated
  profile data;
- `set_customer_preference_v1` is the authenticated-only atomic mutation boundary, derives the Auth
  user and audit fields on the server, serializes concurrent first use, and creates no event for a
  same-value request;
- marketing transitions require the current compatibility handshake while the database records its
  own `account-settings-marketing-v1` notice constant;
- browsers can select only their own current state and cannot write either table directly or read
  event history; routine service-role access is read-only;
- both relations currently cascade with Auth user deletion, subject to a separate retention and
  erasure decision before an account-deletion workflow is designed.

Pre-commit local verification evidence recorded on 2026-08-22 established that the revised
migration replayed cleanly; the focused preference suite passed 76/76; the first-use concurrency
harness passed; the unchanged customer-account foundation passed 59/59; the full database suite
passed 689/689; and Supabase DB lint reported no schema errors for `public` or `auth`.

Production migration preflight and production migration authorization remain pending. The Settings
frontend/runtime is not implemented, the existing Webflow preference switches are not yet persisted
by TAA Platform, and Klaviyo or other downstream enforcement remains future work. Pushed to the
repository does not mean applied to production, and no production preference table or RPC is claimed
to exist. ADR-0004 records the accepted ownership and evidence architecture.

## Members Area Phase A — Authentication Foundation

The pushed Phase A series through `92dbfc7900ef15ffa48ca6a7134a1c1d35fb9d40` implements the
frontend Auth foundation in the repository without changing Supabase configuration:

- `src/services/supabase/auth.js` owns only Supabase Auth SDK calls, normalized values, and safe
  error normalization;
- the browser client explicitly uses PKCE, persistent sessions, automatic token refresh, and manual
  callback processing;
- `src/modules/account/auth.js` owns loading, guest, authenticated, error, and recovery state,
  attribute-driven login/signup/reset/update UI behavior, local logout cleanup, verified account
  session resolution, and a literal `/account` redirect allowlist;
- protected account content is always hidden during loading and guest states, including when markup
  starts hidden, and is revealed explicitly only after session plus user verification;
- the Auth modal now establishes dialog semantics, focus entry/restoration, Tab containment, Escape
  handling, trigger expansion state, and synchronous per-form submission ownership;
- persisted authenticated sessions on `/log-in`, `/sign-up`, and `/reset-password` redirect to the
  fixed `/account` destination unless a recovery callback is actively being processed;
- `public/taa-auth-callback-prelude.js` defines the future synchronous early callback boundary: only
  `/account` with expected Auth parameters is captured, callback URL material is immediately
  scrubbed, legacy token fragments fail closed without persistence, and the one-time PKCE handoff is
  removed by the main bundle before Auth initialization;
- fallback callback capture enforces the same authorization-code length and PKCE flow-ID validation
  as the early prelude; one-shot closure handoff consumption rejects malformed or stale handoffs,
  and callback-like URLs on unrelated routes remain untouched;
- bootstrap hides protected account content fail-closed and lazy-loads Auth only on matching routes
  or markup;
- `data-auth-controls="true"` extends the same canonical lifecycle to global header controls:
  unresolved and identity-revalidation states hide both controls, guests see `LOGIN`, authenticated
  customers see the semantic `/account` link, and sign-out clears authenticated UI synchronously;
- pages containing any combination of global controls, the modal, or the account root initialize one
  lazy-loaded Auth controller rather than duplicating session queries;
- Phase A keeps all account panels hidden because their data/runtime behavior belongs to later
  phases.

The published Webflow site now contains the `Header Global` Auth contract and correction wiring
against the runtime attributes below, using Dexter's `Log In Form Global` as the visual source rather
than introducing a new design:
`data-auth-controls="true"`, `data-account-link="true"`, `data-account-root="true"`,
`data-account-content`, `data-account-panel`, `data-auth-root`, `data-auth-form`, `data-auth-field`,
`data-auth-submit`, `data-auth-open`, `data-auth-toggle`, `data-auth-close`, `data-auth-logout`,
`data-auth-status`, `data-auth-error`, and `data-auth-view` state regions plus optional
`data-auth-focusable` for any additional modal control that must join the focus trap. The published
markup keeps protected account and header-state markup hidden initially as defense in depth. Visual
refinement remains owned by Dexter; the published contract has not been browser-verified with the
Phase A runtime. A future callback-ordering gate must load
the versioned `taa-auth-callback-prelude.js` synchronously on `/account` before the TAA main bundle
and before any current or future third-party script; the main bundle must then consume the one-time
handoff before third-party execution can inspect browser state. The prelude is present only in the
repository, is absent from the existing live releases, and has not been deployed or runtime-verified.

Focused Auth tests pass 45/45 and the full JavaScript suite passes 119/119. Repository ESLint, changed
file Prettier checks, the production Vite build, and `git diff --check` pass. The aggregate
`npm run check` remains blocked at its formatting stage by four pre-existing, unchanged architecture
Markdown files; this Phase A task did not rewrite them. This is committed source, local test, and
local build evidence only. It does not establish runtime integration between the published markup
and repository code, email delivery, deployed frontend code, live customer authentication, or
production runtime behavior.

## Members Area Webflow Architecture

The newer owner-supplied Webflow state supersedes the earlier component inspection:

- `Header Legacy` is the renamed predecessor and has zero intended instances;
- `Header Global` is the intentional TAA global application shell on the active surfaces selected
  by Dexter;
- navigation, cart controls, responsive controls, and the future global Auth surface share this
  shell;
- the published `Header Global` implements the single Auth modal and attribute contract;
  checkout will reuse this surface rather than own another login lifecycle;
- Dexter's `Log In Form Global` remains the visual source, and visual refinement remains owned by
  Dexter;
- the published contract is not connected to an Auth-capable live release and has not been
  browser-verified; callback-prelude deployment and ordering remain pending.

Some native Webflow Ecommerce and legacy Webflow User pages remain as platform-managed artifacts
because normal deletion is unavailable. They are excluded from the target TAA architecture and
require no user migration because no Webflow User accounts were created. Existing links, CMS-bound
links, hidden elements, and component references to those pages have not yet been exhaustively
established, so their current reference state must not be described as zero or absent.

ADR-0003 records `Header Global`, the Webflow/TAA/Supabase responsibility split, and the single Auth
lifecycle as accepted architecture. Its Webflow contract is now published, but its repository
runtime remains undeployed.

## Webflow Runtime and Analytics Ownership

The ownership boundary remains:

- Webflow owns markup, layout, and presentation;
- TAA Platform owns the Auth lifecycle, customer application runtime, and future analytics
  orchestration.

The current site-wide Webflow custom-code configuration has an empty head and a footer containing
only the TAA Platform module loader. GTM, Google Ads tags, the Klaviyo onsite loader, and Meta/GA
tracking code have been removed from that configuration and from the production HTML published at
`2026-08-20T20:37:29.266Z`. The TAA Platform module loader is therefore the sole site-wide
application loader in the final published Webflow state. A separate homepage-level Klaviyo
subscription-form handler remains in page-level custom code; it is not the removed Klaviyo onsite
loader or an analytics runtime and is not being migrated by this Auth phase.

Third-party analytics reintroduction through TAA-controlled architecture remains future work.
Analytics migration and replacement implementation are not complete.

## Members Area Auth Email Infrastructure

Owner-supplied operational evidence current to this task states that Amazon SES production sending
is available in `eu-west-2`, `auth.theanimalalchemist.com` is configured and verified, and Dexter
has configured custom Supabase Auth SMTP. Generic Supabase Auth templates remain in use pending a
later Figma-branded template gate. This task did not inspect or mutate AWS, DNS, Supabase Auth, SMTP,
or email templates and sent no email, so it creates no new delivery or production-runtime evidence.

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
- Authoritative reservation-v1 operator and incident-response runbook: REVIEWED / TABLETOP VERIFIED
  / COMMITTED; documentation blocker CLOSED.
- Reservation ownership, replacement lineage, paid finalization, unpaid release, browser recovery,
  confirmation capability and canary admission boundaries have the evidence grades recorded above.

## Latest Recorded Production Baseline

The reconciliation-heartbeat diagnosis at `2026-08-19T16:08:48Z` confirmed the synthetic
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
- open reconciliation jobs: 0.

This is the latest recorded production baseline from the reconciliation-heartbeat diagnosis.

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
  heartbeats. External notification routing remains a separate readiness blocker.
- Scheduler rollback is `cron.alter_job(jobid, active := false)` for the exact named job. It leaves
  the reconciler, Stripe webhooks, Vault credential and existing reservation-v1 lifecycle active.
- Lifecycle monitoring is scheduled independently every minute by the active production job
  `taa-checkout-health-monitor-v1`. It records one private minute-idempotent snapshot in
  `private.checkout_health_snapshots` and exposes only private operator functions.
- Three consecutive real monitor cycles at `2026-08-19T13:47:00Z`, `13:48:00Z`, and `13:49:00Z`
  completed successfully as `HEALTHY` with empty reason-code sets. At `13:49:33Z`, monitor age was
  33 seconds; the reconciler scheduler and worker remained current with zero recent failures.
- A later read-only checkpoint at `2026-08-19T15:16:05Z` remained `HEALTHY`: monitor age was about
  5 seconds, worker age about 60 seconds, consecutive worker failures and due jobs were `0`, and all
  synthetic lifecycle/incident/job counts remained `0`.
- The monitor recorded `worker_heartbeat_delayed` at `16:02:00Z` and `16:03:00Z`. Timeline evidence
  proved every cron run succeeded and every pg_net request returned HTTP 200 `empty_queue` without
  error or timeout. The monitor evaluated milliseconds before the scheduler transaction harvested
  the already-completed prior response into the durable worker ledger. The first newly visible
  completion was harvested about 21 milliseconds after the `16:02` snapshot, and scheduled health
  returned automatically to `HEALTHY` at `16:04:00Z`, about 120 seconds after the warning began,
  without operator intervention. At `16:08:48Z`, monitor age was about 48 seconds and worker age
  about 60 seconds with no reason codes, failures or backlog. The monitor behaved according to its
  documented durable-heartbeat threshold; thresholds were not changed.
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

### 1. External Alert Routing

A repository, Git-history, production Edge-secret-name, Vault-secret-name, cron, and current-process
inventory found no authenticated n8n workflow, operational mail transport, Slack/Teams webhook,
alert destination, or independent critical fallback. Supabase's commented local/auth SMTP examples
are not a configured production notification channel, and Klaviyo's catalogue/order integration is
not an operator-alert transport.

The target ownership is approved but not implemented or production-verified:

- `WARNING` and recovery from warning: email `support@theanimalalchemist.com`, owned by Dexter;
- initial `ROLLBACK_REQUIRED`: email `support@theanimalalchemist.com` and Dexter via Amazon SNS SMS;
- final failsafe: email `meg@theanimalalchemist.com` and Meg via Amazon SNS SMS when Dexter is
  unavailable or has not acknowledged within two minutes. Meg is not the initial critical
  recipient.

No SMS destination may be stored in repository files, documentation, logs or project memory. AWS
discovery established SES production sending capability and the verified TAA domain in `eu-west-1`.
SNS SMS production access remains pending; no alert topic/subscription, purpose-specific IAM
principal, alert outbox, delivery worker, credential, external test notification or production
configuration has yet been verified or created. A generic unauthenticated webhook must not be
invented merely to close this blocker.

### 2. Human Readiness Review

The authoritative runbook is `docs/checkout-operator-runbook.md`. It covers health triage, all
monitor reason codes, feature and scheduler rollback, paid incident handling, exact-attempt
recovery, monitoring failure, incident recording, strict re-enablement and the launch watch. Its
eight-scenario lifecycle tabletop and final documentation review passed.

The human-access review is now **READY AFTER THREE HUMAN ACTION STREAMS** following a fresh read-only
AWS follow-up. Dexter currently has usable GitHub administration, linked Supabase project/database
and secret metadata access, production-proven Edge-secret mutation history, and AWS SES/SNS
management access. The runbook is committed in a publicly readable Git repository and does not
depend on Codex or chat history.

AWS console authentication is hardware-FIDO protected for IAM user `Brad`; root MFA is enabled and
root access keys are absent. The live IAM audit found all non-Brad keys with no current legitimate
use inactive and only one explained active credential: Brad's approximately 1,382-day-old key
temporarily enabled for that audit. Dexter disabled that final audit key after evidence collection,
and the configured local CLI now fails authentication as expected. No post-deactivation IAM
inventory was claimed because that expected failure removed read access. Brad still inherits
`AdministratorAccess` through `APEX1.0` with no permissions boundary; narrower privilege,
temporary/federated access and IAM rationalisation are post-launch hardening for the proportionate
TAA launch model unless they become dependencies of the checkout alert path.

The three remaining human action streams are:

1. Model B is implemented locally with a fixed DELETE-only Lambda, zero-parameter SSM Automation,
   immutable Lambda-version invocation, and MFA/version-bounded Meg policy and matching permissions
   boundary. Both policies require fixed execution tag `TAA-Control=CheckoutModelB` and limit receipt
   reads to matching Model B executions without broad execution listing or retagging permission. It
   is not deployed, not available to Meg and not production-proven. Closure still requires token
   project-scope verification, non-production present/absent idempotency proof, IAM simulation,
   deployment, OFF-state production proof and a supervised Meg FIDO drill;
2. no authoritative two-human password-manager/account-recovery route independent of Dexter's Mac
   or primary MFA device is evidenced;
3. Dexter's named Stripe live/test access, MFA, account recovery, refund/manual-fulfilment authority
   and non-mutating paid-incident lookup procedure remain unverified.

For the proportionate TAA launch model, AWS does not require IAM Identity Center as an architectural
precondition. The launch-critical AWS requirement is that Brad's long-lived key is inactive outside
explicitly bounded operator work and that external alert delivery does not depend on a broad human
credential. Replacing `AdministratorAccess` with bounded roles or temporary/federated access,
deleting reviewed inactive credentials, and retiring legacy `APEX1.0`/`apex-ses` identities remain
recommended post-launch hardening unless their ownership or use becomes part of the checkout alert
path.

The local Model B source enforces only an authenticated removal of
`CHECKOUT_RESERVATIONS_ENABLED`: the Management API origin, production project configuration,
secret name, DELETE method and request body are server-side fixed; all non-empty caller input is
rejected. The credential is modeled in the dedicated AWS secret
`taa/model-b/supabase-management-token` and requires `edge_functions_secrets_write` only. No Edge
secret GET/list or `edge_functions_secrets_read` is used. The local safe receipt is credential-free,
but idempotent already-absent deletion must still be proven against a non-production test flag. The
six human-failover tabletops passed only when Dexter and his current Mac were available or when the
runbook alone was the dependency. Meg unreachable-primary, alternate-device and
credential-recovery scenarios remain blocked. Human readiness still requires deployed/proven Model
B, tested two-human recovery and Stripe operational authority. The launch-critical AWS human-key
condition is satisfied while Brad's long-lived key remains inactive; external alert delivery must
use a purpose-specific credential rather than that broad human key.

The lifecycle monitoring/rollback-threshold blocker is closed. Database monitoring deliberately
does not claim an HTTP checkout error-rate because no accurate request denominator is persisted.
Remaining readiness gates are authenticated external log/alert routing with an independent critical
fallback; Model B integration/deployment/proof and tested two-human recovery; Stripe operational
authority; and separate explicit global-enable authorisation. Global reservation enablement remains
blocked until those gates are completed and reviewed.

## Separate Security Follow-up

Local-only runbook command validation surfaced a Supabase CLI advisory that `public.sync_logs` has
RLS disabled. The baseline migration creates that table without enabling RLS; its grants do not
include ordinary DML for `anon` or `authenticated`, but privilege grants are not a substitute for a
deliberate RLS decision. Production applicability is unverified. No remediation was applied during
the checkout runbook task; review the table's intended ownership and policies separately before any
change.

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
- Do not treat local Model B tests as AWS, Supabase, deployment, runtime, or production evidence.
- Do not describe Phase A as customer-accessible until an Auth-capable frontend release, required
  Supabase Auth production settings, callback deployment and ordering, published live-script
  reconciliation, and controlled runtime verification have separate evidence. Published markup
  alone is not runtime activation.
- Always inspect `git status --short` and current Git history before attributing evidence.

## Exact Next Action

Perform a final read-only review of this documentation reconciliation, then commit and push it only
under separate explicit authorizations. The next operational gate is a separately authorized clean
generation of an immutable frontend release from the pushed Auth source. That release must contain
the versioned callback prelude and main bundle, must be verified before upload, and must not trigger
asset deployment or a Webflow loader cutover without further authorization. After deployment, load
the prelude before the main bundle and any future third-party scripts, confirm the remaining
production Auth configuration, and run controlled browser verification before customer-facing
activation.

### Model B / Launch-Readiness Follow-up — OPEN / PAUSED

The Model B workstream remains open but is currently paused pending AWS granting the required SNS
Production access. The previous final read-only pre-push review of the local Model B provenance
commits has already been completed and should not be repeated without a new evidence need. When the
AWS dependency is resolved, resume with a separate non-production task to verify fine-grained
Supabase token project scoping and prove present/absent DELETE idempotency without secret-read
permission; then review deployment-time IAM simulation and CloudFormation/change-set evidence before
any production deployment. In parallel, complete tested two-human account recovery, verify Dexter's
Stripe incident/refund/fulfilment authority, and complete SNS-backed external alert delivery using
purpose-specific credentials. A separate explicit global-reservation enablement decision remains
required after all launch gates close. Global reservations remain OFF.
