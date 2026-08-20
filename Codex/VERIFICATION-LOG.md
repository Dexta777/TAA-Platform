# TAA Platform — Verification Log

> Purpose: durable, model-agnostic evidence register for tests, deployments,
> runtime verification, canary observations, and production observations.

This file records what has actually been verified.

It must be usable by any contributor or AI agent, including Codex, Qwen,
ChatGPT, and future models.

The purpose of this log is not to demonstrate that everything worked.

Its purpose is to preserve the most accurate available account of:

> what was tested, what was deployed, what was observed, and how we know.

Failures, partial results and unresolved uncertainty are valid engineering
evidence and must be preserved alongside successful verification.

## Evidence Principles

Every verification record must distinguish between:

- **Source evidence** — implementation exists in the repository.
- **Test evidence** — behaviour was exercised by a defined test.
- **Deployment evidence** — a known revision or release was deployed.
- **Runtime evidence** — behaviour was observed in a running environment.
- **Production evidence** — behaviour was observed on the production path.

Do not infer one category from another.

Examples:

- Code existing does not prove it passed tests.
- Tests existing do not prove they were executed.
- Tests passing do not prove that revision was deployed.
- Deployment does not prove runtime behaviour.
- Canary verification does not automatically prove production readiness.

`Unknown` must remain unknown until evidence establishes otherwise.

Lack of evidence is not the same as evidence of absence.

Each verification record should state both:

1. what the evidence proves;
2. what the evidence does not prove.

Where evidence conflicts, preserve and report the conflict rather than silently
selecting whichever conclusion appears most convenient.

---

# Verification Records

## 2026-08-20 — Phase A Callback Fallback Correction Verified Locally

**Record type:** LOCAL UNCOMMITTED SOURCE, ADVERSARIAL REGRESSION, SECURITY AND BUILD EVIDENCE

**Evidence grade:** CURRENT WORKING TREE ONLY; NO WEBFLOW, DEPLOYMENT OR PRODUCTION RUNTIME PROOF

**Status:** REQUIRED FALLBACK CORRECTION IMPLEMENTED AND LOCALLY VERIFIED / NOT DEPLOYED

The fallback callback capture now enforces the same 4096-character authorization-code limit and
PKCE flow-ID validation as the early callback prelude. A supplied malformed flow ID or oversized
code produces invalid callback state, is scrubbed from the URL, and stops before PKCE exchange,
session resolution, or authenticated state. Valid callbacks, unrelated query parameters, unrelated
fragments, and callback-like material outside `/account` retain their prior behavior.

Current working-tree verification on 2026-08-20 established:

- focused Auth service, callback-prelude, bootstrap, lifecycle, modal, header, recovery, redirect,
  and adversarial callback tests: 45/45 PASS;
- full repository JavaScript suite scoped to `src/**/*.test.js`: 119/119 PASS;
- repository ESLint: PASS;
- changed-file Prettier check: PASS after formatting only the two edited callback source files;
- Vite production build: PASS, with Auth retained as a separate lazy-loaded chunk;
- `git diff --check`: PASS;
- accumulated Phase A scan: no credential, secret, private key, production callback value, customer
  PII, private filesystem path, or callback value in application logging found.

This correction also qualifies the Webflow evidence boundary: legacy Webflow User and Ecommerce
pages are excluded from the target architecture and no Webflow User migration is required, but
links, CMS-bound links, hidden elements, and component references have not been exhaustively
established. No claim of zero current references or dependencies is made.

No Webflow, Supabase, SMTP, database, Edge Function, Stripe, Klaviyo, deployment, publication,
commit, push, or production runtime state changed. The tests and build apply only to the current
dirty working tree.

## 2026-08-20 — Customer/Account Foundation Production Migration State Recorded

**Record type:** SEPARATELY CONFIRMED PRODUCTION MIGRATION EVIDENCE RECORDED DURING A LATER LOCAL GATE

**Evidence grade:** PRIOR AUTHORIZED PRODUCTION GATE; NOT RE-EXECUTED OR LIVE-RECHECKED BY THIS TASK

**Status:** APPLIED IN PRODUCTION / MIGRATION HISTORY REFLECTS APPLIED STATE

The separately authorized production migration gate confirmed successful application of
`20260824120500_customer_account_foundation.sql` to Supabase project
`zxmywtmjvfjgdjcstgtn`. Post-application migration history reflected `20260824120500` as applied.
This later record qualifies, but does not rewrite, the earlier local pre-application evidence below.
The current repository correction did not connect to or mutate Supabase and did not apply or repair
any migration.

## 2026-08-20 — Global Header Authentication State Support Verified Locally

**Record type:** LOCAL UNCOMMITTED SOURCE, MODULE, REGRESSION, SECURITY AND BUILD EVIDENCE

**Evidence grade:** CURRENT WORKING TREE ONLY; NO WEBFLOW, DEPLOYMENT OR PRODUCTION RUNTIME PROOF

**Status:** IMPLEMENTED AND LOCALLY VERIFIED / WEBFLOW CONTRACT NOT WIRED / NOT DEPLOYED

The existing Phase A controller was extended without creating a second Auth lifecycle. Global
header roots marked `data-auth-controls="true"` now consume the same loading, guest,
authenticated, error, sign-out, recovery, and identity-revalidation state that protects `/account`
and owns the global modal. Early bootstrap hides every header `data-auth-view` fail closed and uses
global controls as an Auth lazy-loading marker. Multiple Auth markers on one page still initialize
one controller and one initial session/user verification sequence.

Current working-tree verification on 2026-08-20 established:

- focused callback-prelude, bootstrap, Auth service, lifecycle, global-header, modal, recovery,
  accessibility, redirect, and submission-concurrency tests: 40/40 PASS;
- full repository JavaScript suite scoped to `src/**/*.test.js`: 114/114 PASS;
- repository ESLint: PASS;
- all changed JavaScript, callback prelude, Markdown, and test files checked with Prettier: PASS;
- Vite production build: PASS, with Auth retained as a separate lazy-loaded chunk;
- `git diff --check`: PASS;
- accumulated Phase A diff scan: no secret, SMTP credential, Supabase secret, token, private key,
  customer PII, private filesystem path, or logged callback value found.

The aggregate `npm run check` stopped in its repository-wide Prettier stage on the same four
pre-existing, unchanged architecture files: `Architecture-Glossary.md`, `Architecture-Index.md`,
`Realms.md`, and `Repository-Topology.md`. The changed-file Prettier gate and independent repository
ESLint both passed; the unrelated files were not rewritten.

The header regressions establish that both `LOGIN` and `ACCOUNT` begin hidden, initial resolution
keeps both hidden, guest state reveals only `LOGIN`, verified authentication reveals only `ACCOUNT`,
and sign-out hides stale authenticated state before the SDK request settles. A cross-tab-style Auth
identity event enters loading synchronously before re-verification and then renders the newly
verified state. The semantic account link remains the literal `/account` destination. One header
trigger opens the existing global modal contract, including the already-covered login, signup,
recovery-request, and password-update modes.

The unchanged cart, product, checkout, confirmation, callback, and Auth service tests passed inside
the 114-test JavaScript run. Source review found no Auth call into cart storage, product selection,
checkout attempts or ownership, Stripe request construction, reservation-v1, or confirmation
logic. This is regression evidence at the local source/test layer, not browser or production proof.

A separate bare `node --test` discovery command was also observed and is not the repository
JavaScript-suite command: Node discovered Deno `.ts` tests, passed 138 tests, and failed 19 because
the Node runner does not provide `Deno` or support `jsr:` imports. The established JavaScript scope
was then run explicitly and passed 114/114. No Deno source or test was changed to mask that runner
mismatch.

Owner-supplied current-state evidence says the former `Header` is now `Header Legacy` with zero
intended instances and the former `Header test` is now `Header Global`, placed on Dexter-selected
active surfaces as the intended global application shell. ADR-0003 records that architecture.
Owner-supplied evidence also states that SES production sending is available in `eu-west-2`, the
Auth subdomain is verified, and custom Supabase Auth SMTP is configured; this repository task did
not independently inspect or mutate those systems and sent no email.

No Webflow markup, attribute, component, script, or publish changed. No Supabase Auth configuration,
SMTP setting, database schema, migration, Edge Function, Stripe, Klaviyo, cart, product, checkout,
reservation, or confirmation implementation changed. Nothing was staged, committed, pushed,
deployed, published, or production-runtime verified. The evidence applies only to the current dirty
working tree and does not establish customer-facing Auth availability.

## 2026-08-20 — Members Area Phase A Authentication Foundation Corrections Verified Locally

**Record type:** LOCAL UNCOMMITTED SOURCE, MODULE, REGRESSION, SECURITY AND BUILD EVIDENCE

**Evidence grade:** CURRENT WORKING TREE ONLY; NO WEBFLOW, DEPLOYMENT OR PRODUCTION RUNTIME PROOF

**Status:** REQUIRED CORRECTIONS IMPLEMENTED AND LOCALLY VERIFIED / NOT WIRED / NOT DEPLOYED

The reviewed Phase A working tree was corrected without changing its original base commit
`b6556e470e2e19565ae5965e6e7e43f454fd7faf`. The correction makes protected account visibility an
explicit state outcome, introduces a narrowly scoped early callback prelude and one-time handoff,
redirects verified sessions away from guest Auth routes, adds modal keyboard/focus semantics, and
prevents rapid duplicate form submissions with synchronous per-form ownership.

Current working-tree verification on 2026-08-20 established:

- focused callback-prelude, bootstrap, Auth-service, lifecycle, visibility, redirect, accessibility,
  recovery, and submission-concurrency tests: 36/36 PASS;
- full repository JavaScript suite through Node's built-in test runner: 110/110 PASS;
- repository ESLint: PASS;
- changed JavaScript, prelude, and test files checked with Prettier: PASS;
- Vite production build: PASS, with Auth retained as a separate lazy-loaded chunk;
- `git diff --check`: PASS.

The tests establish that initially hidden protected content remains hidden while loading and for a
guest, then is explicitly revealed only after verified authentication; later-phase account panels
remain hidden. Callback-like query and fragment material outside `/account` is left untouched.
Approved callback material is scrubbed by the dependency-free prelude, handed off once, rejected if
stale or malformed, discarded outside `/account`, and never persists legacy access or refresh
tokens or the PKCE authorization code in browser storage. The modal exercises dialog semantics,
focus entry/restoration, forward and reverse Tab
containment, Escape, trigger expansion state, and inert hidden state. Login, signup, and recovery
forms each reject a second rapid submission while their first request is unresolved.

No Webflow surface or script ordering was changed. The prelude is a repository implementation of the
future Webflow contract, not deployed callback protection. A separately authorized Webflow gate
must place it synchronously on `/account`, then run immediate TAA handoff consumption before any
analytics, advertising, Klaviyo, or other third-party script. Protected markup must also be hidden
in the initial Webflow/CSS state. Those requirements have not been browser- or runtime-verified.

No Supabase configuration, SMTP setting, database schema, migration, Edge Function, Webflow,
Stripe, or Klaviyo system changed. No email was sent. Nothing was staged, committed, pushed,
deployed, published, or production-runtime verified. The evidence applies only to the current dirty
working tree and does not establish customer-facing Auth availability.

## 2026-08-20 — Members Area Phase A Authentication Foundation Implemented and Verified Locally

**Record type:** LOCAL UNCOMMITTED SOURCE, MODULE, REGRESSION, SECURITY AND BUILD EVIDENCE

**Evidence grade:** CURRENT WORKING TREE ONLY; NO DEPLOYMENT OR PRODUCTION RUNTIME PROOF

**Status:** IMPLEMENTED AND LOCALLY VERIFIED / NOT WIRED INTO WEBFLOW / NOT DEPLOYED

Work began from clean `main` at `b6556e470e2e19565ae5965e6e7e43f454fd7faf`, with nothing staged.
The current working tree adds the Supabase Auth service boundary, explicit persistent PKCE client
configuration, the account Auth lifecycle module, early callback capture/scrubbing, fail-closed
account preparation, conditional bootstrap loading, and focused tests. It does not add dashboard,
orders, addresses, payments, checkout account creation, guest-order claiming, My Animals, or TAA
Academy behavior.

Current working-tree verification on 2026-08-20 established:

- focused Auth service, lifecycle, redirect, callback, DOM-flash, and bootstrap tests: 23/23 PASS;
- full repository JavaScript suite through Node's built-in test runner: 97/97 PASS;
- repository ESLint: PASS;
- changed JavaScript and test files checked with Prettier: PASS;
- Vite production build: PASS, with Auth emitted as a separate lazy-loaded chunk;
- `git diff --check`: PASS;
- changed-file scan: no secret, credential, private key, customer PII, or newly embedded project
  endpoint/key value found.

The aggregate `npm run check` did not establish a repository-wide formatting pass. Its Prettier stage
reported the same four unchanged architecture Markdown files:
`Architecture-Glossary.md`, `Architecture-Index.md`, `Realms.md`, and `Repository-Topology.md`. The
task preserved those unrelated files. Independent repository ESLint and targeted formatting checks
passed.

The tests establish local module behavior: protected account content remains hidden until session
resolution; authenticated state requires a session plus a verified `getUser()` result; guest and
logout transitions clear protected UI; password recovery uses generic public messaging and a
verified recovery session; redirects allow only literal `/account`; callback query/fragment
material is captured in memory and removed before deferred bootstrap; and Auth is not loaded on an
unrelated page without matching markup.

No Supabase Auth dashboard setting, SMTP setting, CAPTCHA setting, password policy, database schema,
migration, Edge Function, Webflow page/component, Stripe integration, Klaviyo integration, or live
customer record changed. No email was sent. Nothing was staged, committed, pushed, deployed, or
published. These results do not establish production Auth activation, Webflow contract wiring,
customer signup availability, email deliverability, deployed callback safety, or live browser
behavior. In particular, application code scrubs callback material before deferred TAA bootstrap,
but the required future Webflow ordering that places callback scrubbing ahead of third-party
analytics/marketing scripts has not been performed or runtime verified.

## 2026-08-20 — Customer/Account Database Foundation Implemented and Verified Locally

**Record type:** LOCAL UNCOMMITTED MIGRATION, DATABASE, SECURITY AND REGRESSION EVIDENCE

**Evidence grade:** CURRENT WORKING TREE ONLY; NO DEPLOYMENT OR PRODUCTION RUNTIME PROOF

**Status:** IMPLEMENTED AND LOCALLY VERIFIED / NOT DEPLOYED / UNCOMMITTED

Work began from clean `main` at `b49a759aa4666fd70089ef8c460afd959dc5fc0b`, with nothing staged.
Repository preflight reconfirmed that `public.profiles` had no runtime caller, the two legacy
inventory decrement helpers had no active repository caller, and the existing checkout paths use
`customer_profiles`, `stripe_customer_id`, and `orders.user_id` in the boundaries documented by the
preceding read-only investigation. Local catalog preflights found zero `profiles` rows, zero
duplicate non-null Stripe customer IDs, and no users with duplicate shipping or billing defaults.

The current working tree adds migration `20260824120500_customer_account_foundation.sql`. It locks
the inspected legacy/profile/address tables before its destructive-data and uniqueness checks; it
fails closed on unexpected legacy profile rows, duplicate Stripe linkage, or duplicate defaults.
It then:

- backfills a missing `customer_profiles` row for each Auth user without claiming any order;
- hardens the Auth profile trigger with a fixed empty search path, fully qualified privileged
  references, browser execution revocation, authoritative email synchronization, and preservation
  of customer-edited names;
- limits authenticated profile updates to `first_name`, `last_name`, and `phone`, leaving email,
  Stripe linkage, identity, and timestamps server-managed while preserving service-role access;
- enforces unique non-null `stripe_customer_id` and one shipping/default billing address per user;
- retains own-row address CRUD while preventing browser ownership and timestamp mutation;
- replaces duplicate/email-derived order, item, and shipment access with explicit Auth ownership,
  `orders.user_id = auth.uid()`, leaving guest orders unclaimed and historical transaction fields
  unchanged;
- fixes the search path and browser execution privileges of the two unused legacy inventory
  decrement helpers without changing their inventory semantics; and
- drops the empty unused `public.profiles` table with `RESTRICT`.

The first focused pgTAP execution stopped after 20 assertions because the test used a nested
data-modifying CTE shape rejected by PostgreSQL. This was test-shape evidence, not a schema-policy
failure. The fixtures were corrected to perform the RLS mutations directly and assert their effects
separately. The final exact working-tree evidence is:

- clean local replay: all 22 migrations through `20260824120500` applied successfully;
- focused `customer-account-foundation` plus checkout-finalization pgTAP: 85/85 PASS (59 customer
  foundation and 26 finalization assertions);
- full local database suite: 18 files, 613/613 PASS;
- database lint: PASS, zero schema errors;
- local migration-history check: all 22 versions present through `20260824120500`;
- direct local catalog audit: RLS enabled on all five customer/order surfaces, no email-derived
  policy expressions, exact browser column grants, service-role profile access retained, fixed
  helper search paths, browser helper execution revoked, and zero Auth users missing a profile;
- checkout access and paid-session Deno tests: 9/9 PASS;
- Deno type checks: `create-checkout-session`, `stripe-webhook`, and
  `reconcile-checkout-reservations` PASS;
- repository ESLint and targeted Prettier for all changed Markdown: PASS;
- tracked `git diff --check` and separate no-index whitespace checks for all three untracked files:
  PASS;
- the repository-wide `npm run check` did not establish a global formatting pass because its
  Prettier stage reported four pre-existing, unmodified architecture Markdown files; this slice did
  not rewrite those unrelated files, and the independent ESLint run passed;
- local Supabase security advisor: no customer/account findings; one WARN remains for the existing
  out-of-scope `pg_net` extension in `public` (12 additional INFO findings were unrelated to this
  slice).

ADR-0002 records `auth.users → customer_profiles` as canonical identity, `orders.user_id` as
permanent account authorization, email as transaction/possible future claim evidence rather than
authorization, explicit preservation of unclaimed guest orders, immutable historical snapshots,
Stripe payment authority, and privileged server ownership of `stripe_customer_id`.

No linked or production Supabase command ran. No live data, Auth user, guest order, Edge Function,
Webflow surface, Stripe configuration, feature flag, or checkout runtime source changed. Nothing was
staged, committed, pushed, or deployed. These results apply only to the current uncommitted working
tree and do not establish live migration or production Auth behavior.

## 2026-08-19 — Model B Emergency Checkout Rollback Implemented and Verified Locally

**Record type:** LOCAL COMMITTED SOURCE, UNIT, STRUCTURED STATIC IAM AND OFFLINE TEMPLATE EVIDENCE
**Evidence grade:** LOCAL ONLY; NO AWS, SUPABASE, DEPLOYMENT, RUNTIME OR PRODUCTION PROOF
**Status:** IMPLEMENTED LOCALLY / NOT DEPLOYED / NOT PRODUCTION-PROVEN

The work began from clean synchronized `main` and `origin/main` at
`592e367b8467e10a0240befedb1cc03c47769369`, with nothing staged. Source inspection reconfirmed that
`CHECKOUT_RESERVATIONS_ENABLED` enables global reservation admission only when its normalized value
is exactly `true`; absence routes genuinely new ordinary attempts to legacy while existing
reservation-v1 attempts remain on reservation-v1.

Local implementation commit `f177965bf6d1064a4899ba679242814f6ef66c5b` adds
`infra/checkout-model-b` and `docs/checkout-model-b-rollback.md`, and updates the operator runbook and
production-blocker record. No checkout runtime file changed. The local architecture is a named
console-only Meg IAM identity with an MFA-gated policy and matching permissions boundary, version
`1` of zero-parameter SSM Automation document `TAA-EmergencyDisableCheckoutReservations`, an exact
Automation execution role, an immutable Lambda version, and a Lambda role limited to the dedicated
AWS secret `taa/model-b/supabase-management-token` plus its receipt log group.

The handler rejects non-empty caller input. Its Management API origin, production project
configuration, secret name `CHECKOUT_RESERVATIONS_ENABLED`, `DELETE` method and one-name JSON body
are fixed server-side. It accepts only HTTP 200, never issues a secret GET/list, never reads a
provider response body, and fails closed on malformed configuration, missing credentials, network
error, timeout, 401, 403, 429 and every other status. The safe success receipt contains only the
action, `OFF_CONFIRMED`, `verified_off`, a generated UUID and UTC completion time. The required
Supabase fine-grained permission is `edge_functions_secrets_write`; `edge_functions_secrets_read`
is not used.

A subsequent read-only security review identified one HIGH local IAM issue: the initial Meg policy
and boundary allowed receipt reads across unconditioned `automation-execution/*`. Commit
`f177965bf6d1064a4899ba679242814f6ef66c5b` contains the corrected scope. Both policies require
request tag `TAA-Control=CheckoutModelB`, constrain `aws:TagKeys` to that single key, and require the
matching resource tag for `GetAutomationExecution` and `DescribeAutomationStepExecutions`. Meg receives neither
`DescribeAutomationExecutions` nor `AddTagsToResource`. The execution tag is authorization metadata;
the Automation document remains zero-parameter and its rollback operation is unchanged.

A final read-only provenance/security review of the corrected tree returned **APPROVE LOCAL
IMPLEMENTATION**, with zero BLOCKER, HIGH, MEDIUM, LOW or NIT findings. Verification of the exact
source staged and committed as `f177965bf6d1064a4899ba679242814f6ef66c5b` under Node 22 produced:

- Model B handler and structured infrastructure-policy tests: 24/24 PASS;
- ESLint for the handler and tests: PASS;
- pinned `@aws-sdk/client-secrets-manager@3.1109.0` clean install and import smoke: PASS;
- pinned test-only `yaml@2.9.0` parser install and npm audit: PASS, zero vulnerabilities;
- YAML syntax parse: PASS;
- offline SAM translation using the installed translator with a non-network managed-policy loader:
  PASS;
- targeted Prettier: PASS;
- sensitive-value and machine-private-path scans: PASS;
- one-way source scan: PASS;
- `git diff --check`: PASS.

The installed SAM CLI's ordinary `sam validate` path was not accepted as local evidence: that older
CLI attempted to write outside the workspace and load managed-policy metadata from AWS IAM, then
failed before validation because the sandbox denied the write/network path. No authenticated AWS
operation or mutation succeeded. The injected offline translator subsequently validated the SAM
transform without AWS access. Deployment-time CloudFormation change-set validation and AWS IAM
simulation remain mandatory and are not implied by the local pass.

Mocked repeated HTTP 200 DELETE responses establish handler behaviour for repeated successful
control-plane outcomes. They do not establish Supabase behaviour when the target secret is already
absent. Before production deployment, a non-production test flag must prove present-then-absent
DELETE idempotency without adding secret-read permission. Provisioning must also prove whether the
fine-grained token can be restricted to the production project/resource. If either property cannot
be established, deployment must stop for security review.

No AWS resource or credential was created or changed. No Supabase API, configuration, data, secret,
or feature flag was contacted or mutated. No checkout or deployment occurred. The implementation
was committed locally as `f177965bf6d1064a4899ba679242814f6ef66c5b`; no push occurred. Global
reservations remain OFF according to the latest authoritative recorded production state. Model B
remains open until non-production integration, credential-scope review, IAM simulation, deployment,
production OFF-state proof and Meg's supervised FIDO drill pass. External alert delivery and tested
second-human account recovery also remain open.

## 2026-08-19 — AWS FIDO and Unused-Credential Cleanup Verification

**Record type:** READ-ONLY AWS IAM CREDENTIAL, MFA AND PERMISSION INVENTORY
**Evidence grade:** CURRENT AWS IAM METADATA BEFORE FINAL KEY DEACTIVATION; EXPECTED LOCAL AUTH
FAILURE AFTER OPERATOR DEACTIVATION
**Status:** CONSOLE/ROOT HARDENED; UNUSED KEYS INACTIVE; LOCAL AUDIT KEY EXPECTEDLY DISABLED

The audit authenticated directly as IAM user `Brad`, generated and read a sanitized IAM credential
report, and independently queried login, MFA, access-key, last-use, group, policy, permissions-boundary
and root-account summary metadata. It did not expose access-key IDs, MFA serials, credential values,
tokens, phone numbers or private destinations. No AWS, Supabase, checkout or production mutation was
performed by the audit.

Current human/root evidence:

- Brad has a console login profile and one registered FIDO security key, enabled on
  `2026-08-19T18:26:24Z`. This verifies the hardware-FIDO registration; identification of the
  physical device as Dexter's Trezor is operator-attested;
- root MFA is enabled and root access keys are absent;
- during the authenticated live inventory, Brad had exactly one active and zero inactive access
  keys. The active key was approximately 1,382 days old, was the configured key used for this
  read-only audit, and had current IAM activity. The historical second Brad key was absent;
- Brad remains the sole member of `APEX1.0`, inherits `AdministratorAccess`, and has no permissions
  boundary.

The operator's unused-key cleanup is verified:

- `apex-ses`: zero active, one inactive key; approximately 2,312 days old, last used for SES in
  `eu-west-2` on `2021-08-19`;
- `info`: zero active, one inactive key; approximately 1,451 days old, last used for SES SMTP in
  `eu-west-1` on `2026-05-05`;
- `ses-smtp-user.20230604-140541`: zero active, one inactive key; approximately 1,172 days old with
  no recorded use;
- `theanimalalchemist`: zero active, one inactive key; approximately 923 days old with no recorded
  use.

No unexplained active credential remained at the end of the authenticated inventory: the only
active key was the explained temporary Brad audit key. After evidence collection, Dexter disabled
that key manually. A subsequent `aws sts get-caller-identity` call failed with the expected
inactive/invalid-credential result, proving that the configured local credential can no longer
authenticate. No replacement credential was created or requested. Because that expected failure
removed read access, this record does not claim a post-deactivation live IAM inventory; it combines
the preceding sanitized inventory, Dexter's deactivation statement and the failed local STS check.

The inactive users and keys must not be deleted merely from name or age; ownership should be
reviewed separately. `apex-ses` and `APEX1.0` are strong legacy-APEX candidates, while the other
scoped SES identities require current TAA ownership classification.

For the small TAA operating model, hardware-FIDO console access, root MFA/no root keys, inactive
unused service credentials, and keeping Brad's CLI key disabled outside bounded work are a
proportionate launch posture. The expected failed STS check closes the launch-critical human-key
condition while that credential remains disabled. IAM Identity Center is not itself a checkout
launch requirement. External alert delivery must not reuse Brad's broad human key. Removing
`AdministratorAccess`, adopting bounded temporary/federated operator access, deleting reviewed
inactive credentials and retiring legacy APEX identities remain recommended post-launch hardening
unless a concrete checkout or alert dependency makes them launch-critical. Human
recovery/break-glass, external alert delivery, Meg's Model B rollback control, Stripe operational
authority and separate global-enable approval remain open. Global reservations remain OFF according
to the latest authoritative recorded state.

## 2026-08-19 — Checkout Human Operational-Readiness and Access Review

**Record type:** READ-ONLY HUMAN ACCESS, RECOVERY AND DOCUMENTATION TABLETOP
**Evidence grade:** CURRENT CLI ACCESS CLASSIFICATION PLUS DOCUMENTED HISTORICAL MUTATION EVIDENCE
**Status:** READY AFTER FOUR ACTIONS; GLOBAL ENABLEMENT REMAINS BLOCKED

The review began from clean synchronized `main` and `origin/main` at
`21e1b5b6f0de7ec082567a9da9491c67cbbce34b`, with nothing staged. It inspected the committed
operator runbook, lifecycle monitoring contract, production blockers, ADR-0001, current project
memory and relevant production-history evidence. No checkout, deployment, access grant, credential
creation, IAM/configuration change, threshold change or production mutation occurred.

Non-sensitive current capability checks established:

- Dexter's GitHub session is authenticated with repository `ADMIN`; the repository and committed
  runbook are publicly readable without Codex or chat history;
- the linked production Supabase project is visible, Edge-secret metadata can be read, and a
  credential-free linked database query succeeds; recorded production secret rotation/unset work
  separately proves the required Edge-secret mutation class;
- the reconciliation credential exists durably as the Edge secret
  `CHECKOUT_RECONCILIATION_SECRET` and scheduler Vault copy
  `taa_checkout_reconciliation_secret`, so the process copy is not the sole recoverable instance;
- the current AWS operator session is an IAM user with SES production sending and verified TAA-domain
  capability, SNS management permissions and root-account MFA present; SNS SMS remains sandboxed;
- the current AWS human-access model does not meet the required MFA/least-privilege standard and
  relies on long-lived credentials. Exact identifiers and credential values were not read or
  recorded;
- current named Stripe dashboard/live/test access, MFA and recovery were not evidenced;
- no authoritative password-manager/two-human account-recovery process or alternate-device
  Supabase/Stripe recovery was evidenced;
- Meg's runbook acknowledgement, alert receipt and infrastructure/rollback access remain
  unverified. Broad infrastructure access is neither required nor recommended.

The selected failsafe boundary is Model B: Meg should receive the final failsafe and use a separate
named MFA-protected control that can only idempotently remove `CHECKOUT_RESERVATIONS_ENABLED` from
the fixed production project. Its underlying management credential must remain hidden; the control
must not enable the flag, accept arbitrary names, reveal secrets, run SQL, deploy, or disable
reconciliation/monitoring. Model A cannot meet the five-minute rollback SLA when Dexter is
unreachable, while Model C grants unnecessary privilege.

Six documentation/access tabletops produced:

1. Dexter available: PASS; his current operator surfaces can execute the documented rollback.
2. Dexter alert path fails and Meg receives failsafe: FAIL currently; delivery and Meg's rollback
   control are not operational.
3. Dexter unreachable for 15 minutes: FAIL currently; Meg cannot perform the required five-minute
   rollback.
4. Codex unavailable: PASS for document availability; the committed runbook is independently
   readable.
5. Dexter's Mac unavailable: FAIL currently; alternate-device Supabase/Stripe/account recovery is
   not verified.
6. Primary password-manager/MFA device unavailable: FAIL currently; no tested second-human recovery
   path is evidenced.

Four human-readiness actions must close before global enablement: implement and drill Meg's Model B
control; harden AWS human access and emergency recovery; establish a tested two-human authoritative
account-recovery process independent of Dexter's Mac; and verify Dexter's named Stripe live/test
access, MFA/recovery, refund/manual-fulfilment authority and a non-mutating paid-incident lookup.
External alert routing remains a separate open blocker pending SNS SMS production access and runtime
delivery proof. Global reservations remain OFF according to the current name-only metadata check.
No credential value, phone number, customer data or private identifier was recorded.

The reviewed operational documentation is represented in local, unpushed commit
`15929c3cc5f11f6a25e64b71eb185d946efd8fed`, containing only
`docs/checkout-operator-runbook.md` and `docs/checkout-production-blockers.md`. This project-memory
record is the separate follow-on evidence boundary. No push or production action was performed.

## 2026-08-19 — Checkout Operator Runbook Reviewed and Committed Locally

**Record type:** SOURCE-CONTROL PROVENANCE; NO DEPLOYMENT OR PUSH
**Evidence grade:** REVIEWED OPERATIONAL DOCUMENTATION COMMIT
**Status:** RUNBOOK DOCUMENTATION BLOCKER CLOSED; HUMAN ACCESS READINESS REMAINS OPEN

Final review found the runbook, lifecycle-monitoring contract and production-blocker update
consistent with the deployed scheduler, reconciler and monitor architecture. The approved focused
recheck passed with 34/34 reason-code coverage, valid local references, targeted Prettier, a
sensitive-pattern scan and `git diff --check`. The three operational documents were unchanged from
the preceding full SQL/tabletop checkpoint, so the eight scenarios and local SQL execution were not
repeated merely for provenance.

Commit `158fb9bce39fe57fcf3799b546679e68241db323` (`docs: add checkout operator incident runbook`)
contains exactly:

- `docs/checkout-operator-runbook.md`;
- `docs/checkout-lifecycle-monitoring.md`;
- `docs/checkout-production-blockers.md`.

No application/runtime source, local tooling, credential, phone number, customer data or
`public.sync_logs` change entered that commit. External alert routing remains open pending SNS SMS
production access and runtime proof; operational access confirmation and a separate global-enable
authorization also remain open. Global reservations remain OFF. No AWS or production action,
deployment or push occurred.

## 2026-08-19 — Checkout Operator Runbook Created and Tabletop Verified

**Record type:** CURRENT WORKING-TREE OPERATIONAL DOCUMENTATION AND STRUCTURED TABLETOP EVIDENCE
**Evidence grade:** SOURCE-CONSISTENT DOCUMENTATION; NO PRODUCTION MUTATION
**Status:** OPERATOR/RUNBOOK BLOCKER CLOSED PENDING HUMAN REVIEW AND PROVENANCE COMMIT

Created `docs/checkout-operator-runbook.md` as the authoritative reservation-v1 health, incident,
rollback, paid-state, targeted-recovery, reconciliation, monitoring, re-enablement and launch-watch
procedure. It labels every operator surface as read-only or mutating, identifies the required
privilege, uses resource and credential names only, keeps Stripe authoritative for payment, and
forbids ad hoc inventory/order repair and inferred unpaid release.

The runbook was compared with the committed scheduler, monitor, reconciliation, attempt, intent,
reservation, order and configuration contracts. Its SQL blocks executed successfully against local
Supabase inside an explicit read-only transaction. All 31 evaluator reason codes plus the monitor
reader's three independent heartbeat codes are represented. The installed CLI also confirmed
support for the documented linked read-only query, name-only secret inventory and exact-name
secret-unset interfaces. These checks establish current working-tree documentation validity; they
are not new production-runtime evidence.

Eight non-mutating tabletop cases passed: negative ATS; paid without an order; reconciler heartbeat
stale beyond five minutes; monitor unavailable beyond five minutes; a paid manual-review operation;
lost browser capability requiring exact-attempt recovery; global reservation rollback; and a
request to re-enable after rollback. Every critical case disables new ordinary reservation-v1
admission while preserving existing v1 attempts, Stripe webhooks, reconciliation, monitoring and
targeted recovery. Paid uncertainty remains fail closed, and re-enablement requires an independent
human decision after every gate is evidenced.

The runbook records the known asynchronous worker-heartbeat harvest race and requires operators to
inspect cron fire, pg_net response, durable worker completion, failure count and backlog before
concluding that a warning is a worker failure. It does not weaken the two-minute warning or
five-minute rollback thresholds.

The current external alert ownership supersedes the earlier target contract but remains an approved
target only: warning email and initial critical email go to `support@theanimalalchemist.com`; Dexter
receives the initial critical SNS SMS; Meg is the final failsafe through
`meg@theanimalalchemist.com` and SNS SMS if Dexter is unavailable or has not acknowledged within two
minutes. SES production sending capability is known, but SNS SMS production access remains pending
and no alert delivery implementation or receipt is claimed.

No production query, checkout, reconciliation invocation, configuration mutation, deployment, AWS
mutation, threshold change, commit or push occurred during the runbook work. The latest production
state remains the preceding read-only heartbeat diagnosis: `HEALTHY`, clean synthetic lifecycle,
and `CHECKOUT_RESERVATIONS_ENABLED` absent/OFF.

During local-only command validation, the Supabase CLI independently warned that
`public.sync_logs` has RLS disabled. Repository migration source confirms that the table is created
without an `ENABLE ROW LEVEL SECURITY` statement; its recorded grants do not include ordinary DML
for `anon` or `authenticated`, but that does not replace an RLS review. Production applicability was
not queried in this documentation task. No remediation was applied; this is a separate security
follow-up and not runbook verification evidence.

## 2026-08-19 — Reconciliation Worker-Heartbeat Warning Automatically Recovered

**Record type:** READ-ONLY PRODUCTION CRON, PG_NET, WORKER-LEDGER AND HEALTH EVIDENCE
**Evidence grade:** PRODUCTION TIMELINE DIAGNOSIS
**Status:** HEALTHY — TRANSIENT WARNING RESOLVED WITHOUT INTERVENTION

At `2026-08-19T16:02:00.361497Z`, the health monitor recorded `WARNING` with the sole reason
`worker_heartbeat_delayed`. The durable worker completion visible to that snapshot was
`16:00:00.028128Z`, giving a worker age of `120.333369` seconds. The following `16:03:00.095266Z`
snapshot also recorded the same warning at `120.057876` seconds. Neither snapshot crossed the
existing five-minute rollback boundary.

The scheduler/pg_net timeline proved this was a durable-ledger observation race rather than a
worker failure. Both cron jobs fired and succeeded every minute from `15:58` through the inspected
`16:08` cycles. Every reconciler scheduler row from `15:58` through `16:07` was `http_queued` and
ultimately `succeeded`; every corresponding pg_net response was present, HTTP 200, not timed out,
had no error, and classified `empty_queue` with `claimed = 0` and zero expired empty attempts. No
`prior_request_in_flight`, lock suppression, queue failure, transport failure, HTTP failure,
authentication failure or invalid response occurred.

At `16:02`, the monitor evaluated at `16:02:00.361497Z`, while the scheduler transaction that
harvested the already-completed `16:01` pg_net response updated its ledger row at
`16:02:00.382208Z`, about 21 milliseconds later. The same ordering recurred at `16:03`: the monitor
evaluated before that minute's scheduler harvest committed. Because pg_net completion is
asynchronous and the scheduler harvests the prior response on the following minute, the independent
monitor briefly saw the last durably harvested completion as just over two minutes old.

The first new successful worker heartbeat therefore became durable about 21 milliseconds after the
initial warning snapshot. The scheduled classification returned to `HEALTHY` at
`16:04:00.019901Z`, `119.658404` seconds after the first warning, with no operator action. At the
read-only `16:08:48.301765Z` checkpoint, health was `HEALTHY` with no reason codes; monitor age was
about 48 seconds, worker age about 60 seconds, consecutive worker failures `0`, and all pending,
retry-pending, claimed and manual-review reconciliation backlog counts were `0`.

Inventory remained A `4/0/4`, BASE `1/0/1`, C `4/0/4`; active reservation-v1 attempts, intents and
admissions, held/due reservations, open incidents and open jobs were all `0`. Both named cron jobs
remained active every minute. `CHECKOUT_RESERVATIONS_ENABLED` remained absent by secret-name
metadata, so global reservations remained OFF. No worker was invoked manually, no threshold was
changed, and no production state or configuration was mutated. Monitoring behaved according to the
documented durable-heartbeat threshold and cleared automatically when the ledger advanced.

## 2026-08-19 — External Checkout Alert Target Ownership Approved; Implementation Still Open

**Record type:** OPERATOR-APPROVED TARGET ARCHITECTURE; NO IMPLEMENTATION OR DELIVERY EVIDENCE
**Evidence grade:** DOCUMENTED OWNERSHIP AND ROUTING CONTRACT ONLY
**Status:** EXTERNAL ALERT BLOCKER OPEN

The approved future routing contract is: `WARNING` and recovery from warning email
`support@theanimalalchemist.com`; `ROLLBACK_REQUIRED` email
`support@theanimalalchemist.com` and `meg@theanimalalchemist.com` plus an independently attempted
Amazon SNS SMS fallback; and recovery from `ROLLBACK_REQUIRED` email both addresses. Dexter is the
primary operator and Meg is the secondary/escalation operator. Trello is not an emergency channel.

This approval does not establish that SES, SNS, WorkMail programmatic sending, IAM, an SMS
destination, an outbox, a delivery worker, retries, or external receipt is configured or working.
No SMS destination is approved for repository, documentation, log, project-memory or Codex-output
storage. Actual AWS account/region capability, least-privilege authentication and secure destination
provisioning must be inspected before implementation. No production or AWS mutation accompanied
this record; no automatic rollback exists; global reservations remain OFF.

## 2026-08-19 — External Checkout Alert Routing Blocked Before Implementation

**Record type:** CONTEMPORANEOUS SOURCE, CONFIGURATION-METADATA AND READ-ONLY PRODUCTION EVIDENCE
**Evidence grade:** CHANNEL-INVENTORY AND PRODUCTION PREFLIGHT; NO DELIVERY IMPLEMENTATION
**Status:** BLOCKED; NO AUTHENTICATED EXTERNAL CHANNEL OR INDEPENDENT FALLBACK ESTABLISHED

After a fetch, local `main` and `origin/main` were clean and synchronized at
`5856838a058afd9f6c6ba3a04f51850c9970a3b9`, ahead/behind `0/0`, with nothing staged. A supported
linked-project read-only query at `2026-08-19T15:16:05.086352Z` returned current health `HEALTHY`,
empty reason codes, monitor age about 5 seconds, worker age about 60 seconds, consecutive worker
failures `0`, and due reconciliation jobs `0`. Both `taa-checkout-health-monitor-v1` and
`taa-checkout-reconciliation-v1` were active at `* * * * *`.

The same checkpoint proved inventory A `4/0/4`, BASE `1/0/1`, C `4/0/4`; active reservation-v1
attempts, intents, admissions, held/due reservations, open incidents, and open jobs were all `0`.
Edge-secret metadata did not contain `CHECKOUT_RESERVATIONS_ENABLED`, so global reservations
remained OFF. Production migration history ended at `20260824120400` and production cron contained
only the health monitor and reconciler jobs.

Channel discovery inspected current repository source and history, operations/service documentation,
Edge-secret names, Vault-secret names, current process variable names, Edge Functions, package
dependencies, and cron metadata. No implemented n8n workflow, n8n endpoint/credential, WorkMail or
SES transport, SMTP provider, Slack/Teams webhook, operator recipient, alert delivery worker, or
independent critical fallback was found. The repository contains only commented Supabase local/auth
SMTP examples; they are not an operational production alert channel. Existing Klaviyo credentials
support catalogue/order integration and were not reclassified as a private incident-alert route.
No secret value was inspected or emitted.

Without an authenticated destination and recipient/acknowledgement owner, a durable outbox could
not be connected to a real external delivery path, and the required production synthetic WARNING,
ROLLBACK_REQUIRED, and RECOVERY deliveries could not be verified. Building a generic webhook or
selecting a new SaaS would exceed the evidenced architecture and still leave the independent
fallback unresolved. Therefore no migration, Edge Function, test fixture, cron job, Vault/secret
write, alert delivery, deployment, checkout mutation, or automatic rollback was performed.

The exact unblock requirement is an explicit operator decision naming: (1) the currently
operational primary external channel and destination; (2) an independent critical fallback; (3)
recipient, acknowledgement, and escalation ownership; and (4) the approved non-persistent secret
provisioning method. The authoritative health thresholds remain unchanged, production health
remains at the recorded `HEALTHY` checkpoint, and global reservations remain OFF.

## 2026-08-19 — Checkout Lifecycle Monitoring Provenance Commit Created, Not Pushed

**Record type:** CONTEMPORANEOUS SOURCE-CONTROL AND FOCUSED LOCAL VERIFICATION EVIDENCE
**Evidence grade:** LOCAL COMMIT PROVENANCE FOR ALREADY-DEPLOYED PRODUCTION MONITORING
**Status:** IMPLEMENTATION COMMIT CREATED; NO PUSH OR PRODUCTION MUTATION

Starting from `27fb9dd31463e508f0561b63d4ed867889f72229`, all seven monitoring implementation,
test, operational-contract and project-memory paths were reviewed. The migration and two test
files had not changed after the recorded local verification, deployment and production-monitor
checkpoint; their filesystem modification times preceded deployment, while later changes were
limited to documentation and evidence. The focused lifecycle-monitor pgTAP rerun passed `48/48`.

The first concurrency-harness rerun proved caller B waited on caller A and retained one canonical
snapshot, but the snapshot classified `ROLLBACK_REQUIRED` because the local recurring reconciler
had added newer `vault_configuration_missing` rows after the harness's fixed fixture timestamp.
This was local fixture contamination, not a monitoring-code failure. A read-only local query proved
the exact reason codes were `scheduler_configuration_failure` and `worker_heartbeat_missing`.
After temporarily disabling only the local reconciliation cron job, clearing its local test ledger,
and restoring that local job automatically, the unchanged two-caller harness passed both lock and
single-canonical-`HEALTHY` assertions. Production cron, Vault, monitoring and checkout state were
not contacted or changed.

Focused permission checks confirmed snapshot RLS, no `anon`, `authenticated`, or `service_role`
table access, no execution access to the three private monitor functions, `SECURITY DEFINER`, empty
hardened search paths, one active minute-cadence monitor job, and credential-free cron metadata.
Targeted Markdown Prettier, shell syntax, sensitive-pattern scanning, staged-diff checking and
`git diff --check` all passed.

Commit `27d19a78ddd16002c98713946e866aac9c2851f0`, titled
`feat: monitor checkout lifecycle health`, contains exactly:

- `supabase/migrations/20260824120400_checkout_lifecycle_monitoring.sql`;
- `supabase/tests/database/checkout-lifecycle-monitoring.test.sql`;
- `supabase/tests/concurrency/checkout-health-monitor-concurrency.sh`;
- `docs/checkout-lifecycle-monitoring.md`;
- `docs/checkout-production-blockers.md`.

The migration filename and semantics remain those already applied and production-verified. It
adds only private monitoring state and the independent `taa-checkout-health-monitor-v1` job; it
does not mutate checkout/inventory lifecycle state, access credentials, change cron/Vault, or
enable or disable global reservations. No push was performed. Current production health remains
the last recorded `HEALTHY` checkpoint, and global reservations remain OFF. Remaining readiness
gates are the authoritative operator/incident runbook, external alert/log routing, human readiness
review, and separate explicit global-enable authorisation.

## 2026-08-19 — Reservation-v1 Lifecycle Monitor and Rollback Thresholds Production-Verified

**Record type:** CONTEMPORANEOUS SOURCE, LOCAL TEST, DEPLOYMENT, RUNTIME AND PRODUCTION EVIDENCE
**Evidence grade:** PRODUCTION SCHEDULED MONITORING WITH LOCAL FAILURE-INJECTION REGRESSION
**Status:** PASS; MONITORING / ROLLBACK-THRESHOLD BLOCKER CLOSED; GLOBAL RESERVATIONS OFF

The task began on clean synchronized `main` and `origin/main` at
`27fb9dd31463e508f0561b63d4ed867889f72229`, ahead/behind `0/0`, with nothing staged. Read-only
production inspection at `2026-08-19T13:30:43.291765Z` and the final pre-deploy checkpoint at
`13:46:07.447243Z` both proved A `4/0/4`, BASE `1/0/1`, C `4/0/4`; active reservation-v1 attempts,
active intents, active admissions, held/due reservations, open incidents, and open reconciliation
jobs all `0`. `taa-checkout-reconciliation-v1` was active every minute, the latest worker result was
HTTP 200 `empty_queue`, failures in the prior 10 minutes were `0`, no health-monitor job existed,
and `CHECKOUT_RESERVATIONS_ENABLED` remained absent by secret-name metadata only.

Source and lifecycle inspection established that a local reservation deadline is not authoritative
unpaid evidence; only a persisted materialised Session past `stripe_session_expires_at` can drive the
authoritative-overdue monitor. Reconciliation claims at most 25 jobs, uses two-minute worker leases,
and retries after one minute. The selected thresholds therefore warn after two minutes and require
rollback after five minutes for scheduler, worker, monitor, pending HTTP, due queue, authoritative
overdue, and unpaid manual-review age. More than one 25-job due batch requires rollback. Three
consecutive worker failures require rollback; one terminal failure warns. HTTP 401/403, Vault
configuration failure, negative ATS, impossible reservation ownership, paid/order cardinality,
consumed/order mismatch, duplicate finalization, paid inventory mismatch, paid release, paid
lifecycle mismatch, paid manual review, and severe open lifecycle incidents require immediate
`ROLLBACK_REQUIRED` classification.

Migration `20260824120400_checkout_lifecycle_monitoring.sql` adds only private monitoring
infrastructure: a 30-day snapshot ledger, a private evaluator, minute-idempotent recorder, stale-
monitor-aware current-health reader, and one independent job named
`taa-checkout-health-monitor-v1` at `* * * * *`. It emits only `HEALTHY`, `WARNING`, or
`ROLLBACK_REQUIRED`, aggregate non-sensitive metrics, and explicit reason codes. The table has RLS;
`anon`, `authenticated`, and `service_role` cannot read it or execute monitor controls. Functions
are `postgres`-owned, `SECURITY DEFINER`, and use an empty hardened search path. Monitoring performs
no repair, Stripe call, checkout mutation, inventory mutation, credential access, or feature-flag
change.

Focused test development retained its failures honestly. The first run stopped after 8 assertions
because PostgreSQL has no `min(uuid)` aggregate. The next two runs exposed an expired browser-
admission fixture and then a fixture violating the reservation expiry constraint. A later full run
showed that nullable joins hid stale unpaid-manual-review age and that the declared pgTAP plan was
five assertions short. Each defect was corrected before deployment; none reached production.

Final current-working-tree verification passed:

- clean replay of 21 migrations: PASS;
- focused lifecycle-monitor pgTAP: `48/48` PASS;
- complete database suite: `552/552` PASS across 17 files;
- monitor two-caller concurrency: PASS; caller B waited on caller A's advisory lock and both
  converged on exactly one canonical `HEALTHY` minute snapshot;
- existing inventory reservation concurrency: PASS, including one final-unit winner and no
  deadlock under opposite resource order;
- existing paid/reconciliation lifecycle concurrency: PASS, including exactly one consumed order,
  duplicate-finalizer convergence, and paid-after-release review preservation;
- database lint across `extensions`, `private`, and `public`: PASS with no schema errors;
- reconciliation/auth Deno suite: `7/7` PASS;
- reconciler Edge Function typecheck: PASS;
- shell syntax, targeted Markdown Prettier, sensitive-pattern scan, and `git diff --check`: PASS.

The linked pre-deploy dry run listed only
`20260824120400_checkout_lifecycle_monitoring.sql`, with no seed or role changes. A final fetch
confirmed local/remote Git divergence `0`, and the global flag remained absent. The linked
production deployment then applied exactly migration `20260824120400`. No Edge Function, frontend,
Webflow asset, checkout business logic, Vault value, scheduler credential, or unrelated migration
was deployed.

Production verification proved exactly one active `taa-checkout-health-monitor-v1` job at the
one-minute cadence and exact command `SELECT private.record_checkout_health_snapshot_v1();`.
Deployed table/function ownership, RLS, revocations, `SECURITY DEFINER`, and hardened search paths
matched the reviewed migration. Three consecutive real cron-generated monitor cycles completed:

- `2026-08-19T13:47:00.061343Z`: cron `succeeded`, snapshot `HEALTHY`, reason codes empty;
- `2026-08-19T13:48:00.018467Z`: cron `succeeded`, snapshot `HEALTHY`, reason codes empty;
- `2026-08-19T13:49:00.031318Z`: cron `succeeded`, snapshot `HEALTHY`, reason codes empty.

At the final `2026-08-19T13:49:33.331906Z` checkpoint, the current monitor age was 33 seconds, the
reconciliation scheduler and worker heartbeats were current, worker failures in the prior 10
minutes were `0`, and all monitored integrity/backlog counts were `0`. Inventory remained A
`4/0/4`, BASE `1/0/1`, C `4/0/4`; active attempts, intents, admissions, held/due reservations, open
incidents, and open jobs remained `0`. No production failure was fabricated or injected.

The explicit human rollback contract removes `CHECKOUT_RESERVATIONS_ENABLED`, leaving existing
reservation-v1 attempts, the reconciler schedule, Stripe webhooks, targeted recovery, and canary
admission available. No automatic rollback exists. The launch watch is at least 24 hours and the
first 10 successful non-canary reservation-v1 checkouts, whichever is longer, with required checks
before enablement, after first admission, after first successful payment, and at 15-minute,
one-hour, four-hour, and 24-hour checkpoints. Database monitoring deliberately does not invent an
HTTP checkout error-rate metric because no accurate request denominator is persisted; external
log/alert routing remains part of the operator/incident-runbook work. Global reservations remained
OFF throughout.

## 2026-08-19 — Reconciliation Scheduler Runtime Provenance Commit Created, Not Pushed

**Record type:** CONTEMPORANEOUS SOURCE-CONTROL, FOCUSED TEST AND READ-ONLY PRODUCTION PARITY EVIDENCE
**Evidence grade:** LOCAL COMMIT PROVENANCE FOR ALREADY-DEPLOYED PRODUCTION INFRASTRUCTURE
**Status:** RUNTIME COMMIT CREATED; NO PUSH OR PRODUCTION MUTATION

Starting from `e6eb75fb8500ed853dc1f326edb9af1a1fb15706`, the complete scheduler migration,
focused pgTAP regression and checkout production-blocker diff were reviewed as one operational
boundary. Migration `20260824120300_checkout_reconciliation_scheduler.sql` contains the exact job
name `taa-checkout-reconciliation-v1`, one-minute `* * * * *` cadence, runtime Vault lookup by
`taa_checkout_reconciliation_secret`, unresolved-request non-overlap fencing, a private RLS-enabled
heartbeat ledger, browser-role revocations and named-job `cron.alter_job(jobid, active := false)`
rollback. It contains no credential value or checkout/inventory mutation.

The migration and test were unchanged after the recorded 20-migration replay, `28/28` focused
pgTAP, `504/504` full database suite, database lint, `17/17` reconciliation/auth Deno suite,
reconciler typecheck and production activation checkpoint. The permitted focused verification was
therefore run against the unchanged candidate:

- scheduler pgTAP: `28/28` PASS;
- local database lint across `extensions`, `private` and `public`: PASS with no schema errors;
- targeted Markdown Prettier check: PASS;
- sensitive credential-pattern scan across all five scheduler/evidence paths: PASS;
- `git diff --check` and staged diff check: PASS.

A read-only production parity query at `2026-08-19T13:13:16.828985Z` confirmed migration version
`20260824120300` once, one active named job at the exact cadence and command, no authentication
material in cron metadata, deployed Vault-name lookup and null-body semantics, `SECURITY DEFINER`,
hardened empty search path, private-ledger RLS, and no `anon` or `authenticated` execution access.
The latest scheduler fire was `13:13:00.045618Z`, the latest completed worker heartbeat was
`13:12:00.020381Z`, and recorded worker failures remained `0`. This was observation only: no manual
reconciliation, scheduler change, Vault change, deployment, feature-flag change or production
mutation occurred.

Commit `762b3116dc76961dc32497b890369a8e951ff543`, titled
`feat: schedule checkout reconciliation`, contains exactly:

- `supabase/migrations/20260824120300_checkout_reconciliation_scheduler.sql`;
- `supabase/tests/database/checkout-reconciliation-scheduler.test.sql`;
- `docs/checkout-production-blockers.md` scheduler operational-contract updates.

Project memory remains a separate evidence boundary. No push was performed. Global reservations
remain OFF, and monitoring/rollback thresholds plus the operator runbook remain the global-enable
blockers.

## 2026-08-19 — Production Reconciliation Scheduler and Heartbeat Activated

**Record type:** CONTEMPORANEOUS DEPLOYMENT, RUNTIME AND PRODUCTION EVIDENCE
**Evidence grade:** PRODUCTION SCHEDULED EXECUTION AND DUAL-LAYER HEARTBEAT VERIFIED
**Status:** PASS; MANDATORY SCHEDULER/HEARTBEAT BLOCKER CLOSED

The bounded activation began from synchronized `main` and `origin/main` at
`e6eb75fb8500ed853dc1f326edb9af1a1fb15706`, with nothing staged and only the reviewed scheduler,
test and project-documentation paths dirty. `CHECKOUT_RECONCILIATION_SECRET` was confirmed present
and non-empty by presence only. Edge secret metadata showed the current reconciliation credential
and canary allowlist present, while `CHECKOUT_RECONCILIATION_PREVIOUS_SECRET` and
`CHECKOUT_RESERVATIONS_ENABLED` were absent.

The production preflight at `2026-08-19T13:00:48.320418Z` proved A `4/0/4`, BASE `1/0/1`, and C
`4/0/4`; active reservation-v1 attempts `0`, active intents `0`, active admissions `0`, held
reservations `0`, due reservations `0`, open incidents `0`, and open reconciliation jobs `0`.
Vault contained `taa_supabase_functions_url` by metadata/name only and did not contain
`taa_checkout_reconciliation_secret`; `pg_cron`, the named job and migration `20260824120300` were
absent. The linked dry run contained only
`20260824120300_checkout_reconciliation_scheduler.sql`, with no seed or role changes.

Explicit operator authorization was then used to copy the existing current reconciliation
credential into production Vault under the exact name `taa_checkout_reconciliation_secret`. The
first shell construction failed to parse before any command executed. The corrected operation used
a permission-restricted named pipe, passed no credential in argv, suppressed database command
output, removed the pipe immediately, and returned only a safe completion classification. A
read-only query proved the Vault name and metadata at `2026-08-19T13:01:59.813257Z`; no plaintext
credential was printed, hashed, logged, serialized or persisted outside Vault. The existing Edge
secret was not altered or rotated.

A second linked dry run again listed only the intended migration. The production database then
applied `20260824120300_checkout_reconciliation_scheduler.sql` successfully. Production history
contains version `20260824120300` exactly once. Deployed extensions are `pg_cron` `1.6.4`, `pg_net`
`0.20.0`, and Supabase Vault `0.3.1`. Exactly one job named
`taa-checkout-reconciliation-v1` is active at `* * * * *`, owned by `postgres`, and its cron command
is only `SELECT private.run_checkout_reconciliation_scheduler_v1();`. The command contains no
authentication material.

The deployed scheduler function is `postgres`-owned, `SECURITY DEFINER`, has an empty hardened
search path, performs both named Vault lookups, and sends a SQL `NULL` JSON body to the deployed
empty-body batch endpoint. Only `postgres` can execute it. RLS is enabled on the private heartbeat
ledger; `anon`, `authenticated`, and `service_role` cannot select it, and browser roles cannot use
the `private` or `cron` schemas.

Three consecutive real cron-generated worker cycles completed successfully without manual
reconciler invocation:

- scheduler fire `2026-08-19T13:04:00.117189Z`, worker completion
  `2026-08-19T13:04:00.123072Z`: HTTP 200, `empty_queue`, `claimed = 0`, terminalized empty attempts
  `0`;
- scheduler fire `2026-08-19T13:05:00.055322Z`, worker completion
  `2026-08-19T13:05:00.056912Z`: HTTP 200, `empty_queue`, `claimed = 0`, terminalized empty attempts
  `0`;
- scheduler fire `2026-08-19T13:06:00.022351Z`, worker completion
  `2026-08-19T13:06:00.023140Z`: HTTP 200, `empty_queue`, `claimed = 0`, terminalized empty attempts
  `0`.

`cron.job_run_details` recorded successful scheduler executions at `13:04`, `13:05`, `13:06`, and
`13:07Z`. At the final `2026-08-19T13:07:36.798704Z` checkpoint, the latest scheduler heartbeat was
37 seconds old and the latest validated worker completion was 97 seconds old; the durable ledger
contained three successful empty-queue completions and zero failed workers. HTTP 200 plus the
validated bounded response contract proves the endpoint was reached and authenticated; cron firing
alone was not treated as worker success.

The final production baseline remained A `4/0/4`, BASE `1/0/1`, C `4/0/4`, with active attempts,
active intents, active admissions, held reservations, due reservations, open incidents and open
jobs all `0`. `CHECKOUT_RESERVATIONS_ENABLED` remained absent, so global reservations remained OFF.

Failure visibility is split deliberately: `cron.job_run_details` shows scheduler execution, while
`private.checkout_reconciliation_scheduler_runs` records queueing, non-overlap, transport/HTTP or
response-contract failure, and validated worker completion. The provisional stale threshold
remains five minutes, equal to five missed one-minute completion heartbeats. Full alert routing is
still open. Scheduler-only rollback is to resolve the exact named job ID and call
`cron.alter_job(jobid, active := false)`; local pgTAP already proved deactivate/reactivate behavior
without deleting the reconciler, Vault credential, Stripe webhooks, or reservation lifecycle. The
production job was not disabled during verification and remains active.

## 2026-08-19 — Reconciliation Scheduler and Heartbeat Implemented Locally; Production Blocked Before Mutation

**Record type:** CONTEMPORANEOUS SOURCE, LOCAL TEST AND READ-ONLY PRODUCTION PREFLIGHT EVIDENCE
**Evidence grade:** LOCAL DATABASE/PROTOCOL VERIFICATION; PRODUCTION UNCHANGED
**Status:** LOCAL FIX READY; VAULT PROVISIONING REQUIRES EXPLICIT APPROVAL

The task began with clean synchronized `main` and `origin/main` at
`e6eb75fb8500ed853dc1f326edb9af1a1fb15706`, ahead/behind `0/0`, nothing staged and no dirty paths.
Read-only production inspection proved `pg_net` `0.20.0` and Supabase Vault `0.3.1` available,
`pg_cron` absent, `cron.job` absent, and the Vault origin secret `taa_supabase_functions_url`
present by name. Edge secret metadata showed `CHECKOUT_RECONCILIATION_SECRET` and
`CHECKOUT_RESERVATIONS_CANARY_SKUS` configured, with
`CHECKOUT_RECONCILIATION_PREVIOUS_SECRET` and `CHECKOUT_RESERVATIONS_ENABLED` absent. The inherited
current reconciliation credential was confirmed present and non-empty by presence only; its value
was never printed, hashed, serialized, persisted or logged.

The production lifecycle preflight at `2026-08-19T12:44:28.071962Z` returned A `4/0/4`, BASE
`1/0/1`, C `4/0/4`; active reservation-v1 attempts `0`, active intents `0`, active admissions `0`,
held reservations `0`, due reservations `0`, open incidents `0`, and open jobs `0`. Recorded
reservation-v1 Sessions remained test-only. The linked migration dry-run listed exactly
`20260824120300_checkout_reconciliation_scheduler.sql`, with no seeds or roles.

The selected architecture is one database-side `pg_cron` job named
`taa-checkout-reconciliation-v1` at `* * * * *`. It calls only
`private.run_checkout_reconciliation_scheduler_v1()`. That function reads the existing functions
origin and scheduler copy of the reconciliation credential from Vault, queues an authenticated
`pg_net` POST with a SQL `NULL` JSON body so the deployed handler receives the required truly empty
batch body, and persists credential-free run evidence in
`private.checkout_reconciliation_scheduler_runs`. Each cycle first harvests the prior
`net._http_response`: a validated HTTP 200 response with bounded integer counters becomes the worker
completion heartbeat; HTTP, transport and invalid-response outcomes remain durably visible.
Unresolved requests suppress another HTTP invocation while still recording the scheduler cycle.
The provisional stale-worker threshold is five minutes, derived as five missed cycles at the
one-minute cadence. Full alerting remains out of scope. The reviewed rollback is
`cron.alter_job(jobid, active := false)` for the exact named job; pgTAP proved deactivate and
reactivate behavior inside the test transaction without deleting the reconciler or credential.

Migration `20260824120300_checkout_reconciliation_scheduler.sql` creates only this scheduler
infrastructure, private ledger and one named job. It stores no credential, performs no checkout or
inventory mutation, and grants the scheduler function only to `postgres`. The private schema and
heartbeat table remain inaccessible to browser roles. The focused 28-assertion pgTAP regression
proves the job name/cadence/command, no secret-bearing cron metadata, private privileges,
`SECURITY DEFINER` and empty search path, transaction-safe deactivate/reactivate rollback, missing
Vault failure visibility, the exact authenticated null-body queue entry, non-overlap behavior and
durable empty-queue completion harvesting.

Current working-tree verification passed:

- clean replay of 20 migrations: PASS;
- focused scheduler pgTAP: `28/28` PASS after correcting two catalogue assertions found by the
  initial run;
- complete database suite: `504/504` PASS;
- database lint across `extensions`, `private` and `public`: PASS;
- focused reconciliation/operator-recovery/internal-auth Deno tests: `17/17` PASS;
- `reconcile-checkout-reservations` entrypoint typecheck: PASS;
- targeted Prettier and `git diff --check`: PASS.

The secure production Vault write was then requested through a permission-restricted,
non-persistent FIFO. The execution approval boundary rejected the credential copy before the shell
command ran because explicit approval of the exact destination was required. No workaround was
attempted. A fresh read at `2026-08-19T12:45:42.986912Z` proved the Vault name
`taa_checkout_reconciliation_secret` absent, migration `20260824120300` absent and `cron.job`
absent. Therefore no production mutation, scheduler execution or reconciler invocation occurred.

The exact resume action is explicit authorization to copy the existing
`CHECKOUT_RECONCILIATION_SECRET` into production Supabase Vault under
`taa_checkout_reconciliation_secret`. After authorization, repeat the live zero-active gate,
provision through the reviewed non-persistent operator path, apply only the reviewed migration and
observe at least three consecutive scheduled empty-queue worker completions. Global reservations
remain OFF.

## 2026-08-19 — Deliberate Working-Tree Provenance Cleanup

**Record type:** CONTEMPORANEOUS SOURCE-CONTROL, TEST AND TOOLING EVIDENCE
**Evidence grade:** LOCAL WORKING-TREE AND COMMIT PROVENANCE
**Status:** CLEANUP COMMITS CREATED LOCALLY; NO PUSH OR DEPLOYMENT

Cleanup began only after `git fetch origin` proved branch `main`, local `HEAD` and `origin/main`
were all `b3a48077a11461bdf8326521177e8a2dd1fa34d3`, with ahead/behind `0/0` and nothing staged. No
checkout, browser, production endpoint, database, secret, scheduler, monitoring or feature flag was
accessed or changed.

The previously uncommitted checkout diagnostic work was reviewed as one cohesive observability
patch. `CheckoutDatabaseError` now retains the static RPC name, and
`getCheckoutDatabaseErrorDiagnostic` returns only `rpc_name` and `database_error_code`. The
abandonment handler logs that bounded diagnostic for database failures while preserving its generic
customer response and fail-closed lifecycle behavior. Database messages, details, parameters, PII,
credentials and checkout capabilities are not logged. Commit
`21b906971b6774bab0a81a9a3082db9c529a8346`, titled
`fix: preserve safe checkout database diagnostics`, contains only the shared implementation, its
focused test and the abandonment-handler integration. It is not deployed.

Verification of that current working tree passed:

- targeted Prettier on all three diagnostic paths: unchanged;
- checkout/shared Deno suite: `108/108`;
- Deno typecheck of `create-checkout-session`, `abandon-checkout-attempt`,
  `reconcile-checkout-reservations` and `stripe-webhook`: PASS;
- `git diff --check`: PASS.

ESLint was not applicable to these TypeScript paths because the repository configuration scopes
linting to JavaScript under `src/`, `scripts/` and the ESLint configuration itself.

The durable repository engineering policy was committed independently as
`e5f8035b4e1b84a4af6e46095e6ea304d73ca9b9`, titled
`docs: establish repository verification discipline`. It contains only `AGENTS.md`. A separate
commit, `daea5bd0f16653b11f1d63c49afb44019553c8d5`, titled
`chore: ignore generated playwright artifacts`, adds only the narrow universal
`.playwright-mcp/` ignore rule.

The 147 timestamped Playwright page snapshots and 14 timestamped console logs were confirmed as
untracked generated artifacts and removed. The untracked `deno.lock` created by the contemporary
Deno run was also removed; the repository had no prior lockfile convention for it. Machine-local
`.codex/` browser MCP configuration and the mixed local/incomplete `.opencode/` tooling plus
`opencode.json` were preserved and added only to `.git/info/exclude`. No reusable OpenCode work was
discarded or forced into an unrelated commit.

`Codex/CURRENT-STATE.md` was consolidated in the pending project-memory commit so its authoritative
sections now reflect A/D/E/F/G/H production PASS, honest B/C/I/J evidence grades, closed E/F and
7C1 blockers, production-proven targeted recovery, batch readiness, global reservations OFF and the
three remaining operational blockers. This verification log retains all earlier FAIL, BLOCKED,
local-only, deployment and later production-PASS records. No historical evidence was deleted or
reclassified.

## 2026-08-19 — Scenario F Clean Provenance Commit Created, Not Pushed

**Record type:** CONTEMPORANEOUS SOURCE-CONTROL AND FOCUSED TEST EVIDENCE
**Evidence grade:** LOCAL COMMIT PROVENANCE WITH RECORDED PRODUCTION PARITY
**Status:** COMMIT CREATED; NO PUSH PERFORMED

Starting local `HEAD` and `origin/main` were both
`acab7e0681a2e54fd95c0d6fb635ab2cf53402fd`, branch `main`, with nothing staged. Complete review
found only the intended Scenario F changes in the three permitted paths. Their Git blob identities
were unchanged from the production-verification checkpoint. Linked read-only migration history
contained `20260824120200`, and direct production catalogue reads reconfirmed that the reviewed
completion/topology gates, atomic admission update, `SECURITY DEFINER`, hardened search path and
service-role-only grants match the deployed `admit_checkout_request_v1` definition.

The focused contemporary recheck passed:

- `checkout-replacement-admission-lifecycle.test.sql`: `28/28` pgTAP assertions;
- `browser-checkout-admission-concurrency.sh`: PASS;
- `bash -n`: PASS;
- targeted Prettier `--ignore-unknown`: completed without changes (the repository has no SQL or
  shell Prettier parser);
- `git diff --check`: PASS.

Because none of the three permitted files changed after the recorded verification checkpoint, the
prior full current-working-tree evidence remains applicable: 19-migration replay, database
`476/476`, five relevant concurrency harnesses, checkout/shared Deno `104/104`, four Edge
typechecks, focused frontend `13/13`, full checkout/error frontend `74/74`, database lint, ESLint,
Vite build, Prettier, shell syntax and production Scenario F runtime PASS.

Commit `b3a48077a11461bdf8326521177e8a2dd1fa34d3`, titled
`fix: allow replacement after completed admission expiry`, contains exactly:

- `supabase/migrations/20260824120200_checkout_replacement_admission_lifecycle.sql`;
- `supabase/tests/database/checkout-replacement-admission-lifecycle.test.sql`;
- the Scenario F additions to
  `supabase/tests/concurrency/browser-checkout-admission-concurrency.sh`.

No diagnostic source, project-memory or local tooling file entered the commit. The production
migration is now represented in local Git history, but no push was performed and `origin/main`
remains `acab7e0681a2e54fd95c0d6fb635ab2cf53402fd`. Scenario F remains production-runtime PASS and
the replacement-admission blocker remains CLOSED. A/D/E/G/H remain production-runtime PASS;
B/C/I/J retain their recorded evidence grades; 7C1 remains PASS/CLOSED; authenticated targeted
recovery remains PRODUCTION-PROVEN; and global reservations remain OFF. The exact next action is a
final read-only pre-push review of `b3a48077a11461bdf8326521177e8a2dd1fa34d3`, followed by push
only if separately authorized.

## 2026-08-19 — Scenario F Migration Deployment and Focused Production Runtime PASS

**Record type:** CONTEMPORANEOUS DEPLOYMENT AND PRODUCTION RUNTIME EVIDENCE
**Evidence grade:** PRODUCTION RUNTIME — FOCUSED SCENARIO F
**Status:** SCENARIO F PASS; REPLACEMENT-ADMISSION BLOCKER CLOSED

This task reviewed, deployed and production-verified only Scenario F. Scenario A, D, E, G, H, 7C1
and authenticated targeted operator recovery were not repeated. B/C/I/J were not exercised or
upgraded. No Edge Function, frontend asset, Webflow release, reconciler request, schedule,
monitoring, global flag, commit or push changed. Local and remote-tracking `main` remained
`acab7e0681a2e54fd95c0d6fb635ab2cf53402fd`; the pre-existing unrelated dirty and untracked work
remained isolated.

### Review, Preflight and Deployment

The complete Scenario F diff was reviewed before production mutation. The migration changes only
`public.admit_checkout_request_v1`. Relative to the prior authoritative definition, it adds one
completion boolean and the narrow expired-marker topology proof. It performs no data update or bulk
marker clearing and preserves capability authorization, immutable attempt/request and replacement
identity, attempt-row locking, active/in-flight and paid/terminal guards, atomic admission update,
`SECURITY DEFINER`, `search_path=public, pg_temp`, and service-role-only execute. The concurrency
harness holds the attempt lock in the winning transaction; the loser waits, then observes the
winner's live marker and fails safely, leaving one replacement lineage and one stock owner. No
material review concern was found.

At `2026-08-19T11:15:49.581334Z`, the linked production preflight returned:

- A physical/reserved/ATS `4/0/4`, BASE `1/0/1`, C `4/0/4`;
- active reservation-v1 attempts `0`, active intents `0`, active admissions `0`;
- held reservations `0`, due reservations `0`, open incidents `0`, open jobs `0`;
- recorded canary test Sessions `22`, recorded non-test Sessions `0`;
- `CHECKOUT_RESERVATIONS_ENABLED` absent and `CHECKOUT_RESERVATIONS_CANARY_SKUS` configured;
- `create-checkout-session`, `abandon-checkout-attempt` and
  `reconcile-checkout-reservations` ACTIVE;
- remote migration history ending at `20260824120100`.

The linked dry-run listed only
`20260824120200_checkout_replacement_admission_lifecycle.sql`, with empty `seeds` and `roles`.
`npx supabase db push` applied exactly that migration. The later migration list recorded local and
remote version `20260824120200`. Direct production catalogue and `pg_get_functiondef` reads proved
the deployed function contains the reviewed expired completed-marker topology gate, exact
attempt/request/replacement checks, materialised-active and coherent-terminal branches, in-flight
and active-attempt guards, and the atomic new-marker update. The deployed owner is `postgres`; the
function is `SECURITY DEFINER`; its config is `search_path=public, pg_temp`; its ACL is
postgres/service-role execute only; anon and authenticated execute remain false.

### Focused Scenario F Production Flow

`taa_browser_b` began on the visible `/checkout-test` fixture with an empty basket. One visible
HOLDER load, synthetic shipping/customer form completion and DPD selection materialised:

- attempt `233b7331...`;
- original request `6fc2da4d...`;
- original intent `e41ad961...`;
- original Stripe test Session `cs_test_a14CwVFkdV...`;
- reservation `7fec94a0...`, containing one BASE item.

The initial `create-checkout-session` returned HTTP 200 and the Payment Element was visible. A read
at `2026-08-19T11:18:14.79213Z` proved exactly one request, intent, Session, reservation and
reservation item; pending/active intent and current pointer; clear worker lease; BASE `1/1/0`; and
no order, incident or job. The admission deadline was
`2026-08-19T11:19:29.233486Z`.

No Stripe Session expiry was awaited. Immediately before replacement, at
`2026-08-19T11:19:52.173828Z`, the deadline was expired but the attempt remained active, the exact
original intent remained pending/active and current with a recorded unexpired test Session, the
in-flight pointer was null, the reservation remained held/unexpired, and the Payment Element was
still visibly payable. This matched the migration's exact eligibility rule.

The existing unrestricted synthetic `TAA10TEST` discount was entered and applied through the
visible UI. The resulting `create-checkout-session` request returned **HTTP 200**, not the former
typed 409. The discount became visible and the Payment Element remounted without any browser-console
error. The authoritative read at `2026-08-19T11:21:18.761346Z` proved:

- replacement request `faa4c813...` and intent `1c259b2b...` reference predecessor
  `e41ad961...`;
- the predecessor is `expired` / `superseded`, has no active pointer and retains its historical
  distinct test Session;
- the replacement alone is `pending` / `active`, is the attempt's active pointer, carries
  `TAA10TEST`, owns a different test Session and has no worker lease;
- one attempt, two historical requests/intents, two distinct test Sessions, exactly one
  authoritative active intent, one reservation and one reservation item;
- reservation `7fec94a0...` remains held, BASE remains `1/1/0`, and A/C remain `4/0/4`;
- no order, incident or job.

The deployed handler records predecessor invalidation only after Stripe expiry succeeds or a
retrieval proves the predecessor `expired` / `unpaid`. The observed HTTP 200 plus the durable
expired/superseded checkpoint therefore proves the old Session cannot later finalize inventory or
payment contrary to the canonical replacement lineage. The one-attempt row lock and unique
attempt/request, Session and reservation constraints remained intact; no competing or duplicate
ownership appeared.

### Cleanup and Final Baseline

Visible Clear canary basket returned HTTP 200; the fixture then visibly showed `Canary basket is
empty.` and `Your basket is empty.`, with zero console errors or warnings. At
`2026-08-19T11:21:45.339291Z`, the attempt became terminal `expired`; both lifecycle pointers were
clear; predecessor `e41ad961...` remained expired/superseded; replacement `1c259b2b...` became
`expired` / `failed` with `expired_unpaid`; and reservation `7fec94a0...` released once with
`stripe_session_expired_unpaid`. Both intent worker leases were clear. The terminal attempt retains
the replacement admission marker as historical state, but it has no operational ownership: the
attempt is terminal and the active-admission census is zero. Exactly one attempt was created during
the run; cleanup created no replacement checkout.

The final read at `2026-08-19T11:22:27.213044Z` returned:

- A `4/0/4`, BASE `1/0/1`, C `4/0/4`;
- active attempts `0`, active intents `0`, active admissions `0`;
- held reservations `0`, due reservations `0`, open incidents `0`, open jobs `0`;
- one released run reservation, two terminal lineage intents, zero orders;
- `CHECKOUT_RESERVATIONS_ENABLED` still absent and canary admission still configured.

Scenario F is **PASS — production runtime** and its replacement-admission blocker is **CLOSED**.
A/D/E/G/H remain production-runtime PASS. B/C/I retain their strong integration/concurrency grades;
J retains integration PASS with production supporting evidence. 7C1 remains PASS/CLOSED,
authenticated targeted recovery remains PRODUCTION-PROVEN, and global reservations remain OFF.
The exact next action is human review followed by a clean provenance commit of only the Scenario F
migration and focused regressions; no push, scheduler, monitoring or global enablement is authorized
by this record.

## 2026-08-19 — Scenario F Replacement-Admission Lifecycle Fix Implemented and Verified Locally

**Record type:** CONTEMPORANEOUS SOURCE AND LOCAL WORKING-TREE TEST EVIDENCE
**Evidence grade:** LOCAL DATABASE/PROTOCOL/CONCURRENCY INTEGRATION
**Status:** FIX READY FOR REVIEW; NOT DEPLOYED; SCENARIO F REMAINS PRODUCTION FAIL

No production, browser checkout, reconciliation endpoint, schedule, monitoring configuration,
feature flag, commit or remote branch was changed. Scenario A, D, E, G, H, 7C1 and targeted
operator recovery were not repeated. Local and remote-tracking `main` began at
`acab7e0681a2e54fd95c0d6fb635ab2cf53402fd`; the existing unrelated dirty and untracked work was
preserved.

### Source and Lifecycle Proof

`admit_checkout_request_v1` stores one request/replacement marker and a two-minute deadline on the
attempt while holding the attempt row lock obtained by `authorize_checkout_attempt_v1`. That marker
is an operational admission fence. Durable request and replacement audit history lives in
`checkout_intents` under the unique attempt/request key and the replacement foreign key.

The canonical `prepare_checkout_request` implementation creates an initially unbound intent before
`reserve_checkout_inventory` binds the attempt, request and replacement identities. The existing
admission-consumption trigger therefore takes its compatibility early-return on the insert because
the new row has no attempt ID. The later binding is an update, not an insert, so the completed
request's admission marker remains attached. The original admission RPC returned the exact request
as `materialized`, but rejected every different request whenever that retained marker was non-null,
even after its deadline. This source path exactly explains the production Scenario F HTTP 409.

The correct narrow invariant is: a live admission remains exclusive; an elapsed timestamp alone is
never authority to replace it; but after expiry, a marker linked to a durably materialised current
active Session or a coherent terminal request no longer owns admission exclusivity. Missing,
prepared/in-flight, reconciliation, inconsistent-lineage, wrong-capability, wrong-attempt/Session,
paid-attempt and terminal-attempt states remain fail closed.

Migration `20260824120200_checkout_replacement_admission_lifecycle.sql` replaces only
`public.admit_checkout_request_v1`. It retains the existing authorization, row lock, immutable
identity, replacement-target and active/in-flight guards. For a different request behind an expired
marker, it proves the marker resolves to the same attempt/request/replacement lineage and requires
either:

- `pending` / `active`, a recorded Stripe Session and the current active pointer; or
- terminal orchestration `failed`, `compensated` or `superseded` with terminal status.

Only then may the existing final admission update atomically overwrite the marker with the new
request and current replacement target. The migration performs no data update or bulk lease/marker
clearing. Local catalogue inspection proved the deployed local definition remains `SECURITY
DEFINER`, has `search_path=public, pg_temp`, and grants execute only to `postgres`/`service_role`.

The already-deployed `create-checkout-session` handler requires no change: it passes the immutable
attempt/request identity and replacement Session to this RPC, treats `admitted` as the permission to
continue its existing canonical preparation path, and already maps failed RPC admission to a safe
checkout error. No SQL semantics embedded in the handler prevent the changed RPC result from taking
effect immediately. No Edge Function or frontend deployment is required.

### Regression and Concurrency Evidence

The new focused pgTAP file contains 28 assertions over the real RPC/trigger/reservation protocol.
It proves request A admission, canonical retained marker state, one held reservation, durable
Session recording, activation and Scenario E immediate recovery; live-marker fencing; wrong
capability and mismatched Session/request rejection; admission of replacement B after the completed
marker expires; exact marker/lineage ownership; preserved A audit history; one B intent, one A
Session and one reservation/item; physical/reserved/ATS `1/1/0`; incomplete prepared B fencing;
normal B failure; admission after terminal B; an expired marker with no completed intent remaining
blocked; and a terminal attempt remaining closed.

The existing browser-admission concurrency harness now constructs the same stable active A state,
retains and expires its completed marker, and races two distinct replacement callers. The winner
holds the attempt row lock for two seconds; the loser waits and then receives the existing
`unresolved admitted request` failure. Materialising the winner leaves exactly two intents, one
replacement lineage, one recorded Session, one reservation, one reservation item and the winning
marker. No duplicate Stripe materialisation or stock-ownership opportunity remains.

### Commands and Results

- Clean local reset/replay: **PASS**; all 19 migrations through
  `20260824120200_checkout_replacement_admission_lifecycle.sql` applied in order.
- Focused Scenario F pgTAP: final **PASS — 28/28**. The first executable draft failed assertions 2
  and 18 because they assumed the insert trigger cleared the marker; that failure exposed the
  canonical unbound-insert/later-bind lifecycle described above. The assertions were corrected to
  reproduce production state. Two other invocations were prevented before test execution by the
  sandbox denying the Supabase CLI telemetry-file write; approved equivalent runs supplied the
  executable evidence.
- Complete database suite: **PASS — 476/476 across 15 files**. Expected local Vault-dependent
  Klaviyo and identity-fingerprint warnings remained non-fatal.
- Browser checkout admission concurrency: final **PASS**, including one-winner/two-caller expired
  completed-marker replacement. A teardown defect was found after the first pass because the new
  historical marker still referenced the predecessor during fixture deletion; teardown now clears
  fixture pointers/markers before deletion, and the final rerun passed.
- Checkout request orchestration concurrency: **PASS — seven checkpoints**, including one durable
  replacement branch and one-Session/one-reservation recovery fencing.
- Reservation lifecycle concurrency: **PASS — four races**.
- Reservation lifecycle hardening concurrency: **PASS — two races**.
- Inventory reservation concurrency: **PASS — six checkpoints**, including final-unit ATS
  `1/1/0` and reverse-order deadlock protection.
- Checkout/shared Deno suite: **PASS — 104/104 across 14 files**.
- Edge typecheck: **PASS** for `create-checkout-session`, `reconcile-checkout-reservations`,
  `stripe-webhook` and `get-checkout-confirmation`.
- Focused checkout-operation frontend tests: **PASS — 13/13**.
- Complete checkout frontend and checkout-error suite: **PASS — 74/74**.
- Local database lint: **PASS — no schema errors**.
- ESLint: **PASS**.
- Vite 8.2.1 production build: **PASS — 74 modules transformed**.
- Targeted Prettier write/check for both project-memory Markdown files: **PASS**.
- Concurrency shell syntax and `git diff --check`: **PASS**.

One combined concurrency invocation was sandbox-blocked from the Docker socket before its tests ran;
the same harnesses were then run individually through their approved local commands and passed.
These are current dirty-working-tree results and are not attributed to `HEAD` or to production.

### Deployment and Focused Runtime Plan

Deployment, if approved, is the single additive database migration only. Existing rows are not
modified. A live or incomplete old admission remains fenced; an already-expired marker linked to a
coherent completed intent becomes eligible when a legitimate future admission call evaluates it.
No bulk cleanup is required.

The minimum production verification is Scenario F only after the full clean preflight: create one
visible BASE checkout; record A and its completed marker/deadline; after the deadline use the
existing safe visible discount replacement; require HTTP success instead of 409; prove B references
A and is the sole replacement/in-flight branch; complete the normal predecessor handoff; prove A
cannot finalize stock, one attempt-owned reservation remains and ATS never becomes negative; then
use visible authoritative cleanup and require the established `4/0/4`, `1/0/1`, `4/0/4`
production baseline and zero active/open synthetic lifecycle. Do not repeat A, D, E, G, H, 7C1 or
targeted recovery.

Scenario A, D, E, G and H remain production-runtime PASS. B/C/I retain strong
integration/concurrency grades; J retains integration PASS with production supporting evidence.
7C1 remains PASS/CLOSED, targeted recovery remains PRODUCTION-PROVEN, the batch reconciler remains
VERIFIED READY FOR SCHEDULING, and global reservations remain OFF. Scenario F remains
production-runtime FAIL until deployment and focused re-verification.

## 2026-08-19 — Remaining Reservation-v1 Matrix: D/G Runtime PASS; F Runtime FAIL

**Record type:** CONTEMPORANEOUS PRODUCTION RUNTIME AND EXECUTED-INTEGRATION EVIDENCE
**Evidence grade:** MIXED; row-specific grades below
**Status:** REMAINING MATRIX FAIL; F DEFECT PROVEN; D/G PASS; B/C/I/J NOT FABRICATED

This continuation exercised only B/C/D/F/G/I/J evidence. A, E, H, 7C1 and authenticated targeted
operator recovery were not repeated. Before the first mutation, local `HEAD` and `origin/main` were
both `acab7e0681a2e54fd95c0d6fb635ab2cf53402fd`; the index was empty; the previously recorded dirty
and untracked work remained isolated. A presence-only check established the inherited
reconciliation credential was non-empty without printing, hashing, persisting or otherwise
exposing it. Name-only production configuration showed the current credential and canary allowlist
configured, with the previous credential and `CHECKOUT_RESERVATIONS_ENABLED` absent. The reconciler
remained ACTIVE and unscheduled. Inventory was A `4/0/4`, BASE `1/0/1`, C `4/0/4`; active synthetic
attempts/intents/admissions, held reservations, open incidents and open jobs were all zero.

### Scenario F — FAIL, Fail Closed

One visible BASE-only `/checkout-test` checkout in `taa_browser_b` materialised as attempt
`89245225...`, request `36162132...`, intent `00c1dd07...`, test Session `cs_test_a1vX...` and
reservation `ea167091...`. Before replacement, exactly one attempt/request/intent/Session,
reservation and reservation item existed; the intent was pending/active with both worker-lease
fields null; BASE was `1/1/0`; and there was no order, incident or job.

A read-only production query found one eligible active unrestricted synthetic discount, `TAA 10%
Test`. Applying it through the visible checkout UI was an existing safe replacement trigger, but
`create-checkout-session` returned typed HTTP 409 `operation_in_progress` on the bounded automatic
requests. No replacement intent was created. The original intent, Session and reservation remained
authoritative and payable. The attempt still held the completed original request in
`admitted_checkout_request_id`, with no replacement admission and an admission deadline of
`2026-08-19T09:18:48.673982Z`. One visible Apply Code retry after that deadline failed identically;
a production read at `09:19:53.005209Z` proved the expired marker was still attached.

The authoritative `admit_checkout_request_v1` definition explains the observed result: after
checking for an already materialised exact request, it rejects any different request whenever
`admitted_checkout_request_id` is non-null. It does not clear or supersede an expired marker from a
completed original request. This is a request-admission lifecycle defect, not incorrect browser
identity: the browser retained the original attempt and created no duplicate attempt, intent,
Session or reservation. No inventory, paid-state or order invariant failed.

Visible Clear canary basket returned HTTP 200. The attempt and intent became expired/failed, both
lifecycle pointers cleared, and the sole reservation released at
`2026-08-19T09:20:37.880903Z` with `stripe_session_expired_unpaid`. No order, incident or job was
created. Inventory returned to A `4/0/4`, BASE `1/0/1`, C `4/0/4`, and all active/open counts
returned to zero. Scenario F is **production-runtime FAIL with safe containment**.

### Scenarios D and G — PASS

After a fresh zero-active preflight, one final visible BASE-only checkout materialised as:

- attempt `a9ca0a19-687e-469b-b606-7cee273755d9`;
- request `9b93836d-749e-4b9b-9932-faaedd4046d1`;
- intent `c20efea9-c31e-4caa-98a1-9ad01202eee9`;
- Stripe test Session `cs_test_a1o7rvoAgnE1CeKxzNS5gY6jutuGW95d3G9LgnQ8InLDYTr5yP1w1hn5Dt`;
- reservation `34297dbe-a20e-457f-9350-b33f53dfd1ce`.

The Payment Element was visible. At `2026-08-19T09:26:30.986139Z`, exactly one
attempt/request/intent/Session/reservation/reservation item existed; the completed worker lease was
null; the attempt was active; the intent pending/active; the reservation held until
`2026-08-19T09:52:52.374Z`; BASE was `1/1/0`; and there was no order, incident or job. A later
read at `09:43:49.551698Z` showed the same coherent state.

The required post-deadline gate ran at `09:53:40.21632Z`. The target remained active/held and was
47.842 seconds overdue; it was the sole due reservation. There were no active non-test attempts,
open jobs/incidents, active admissions or orchestration-recovery candidates. A single authenticated
raw empty-body request with no mode began at `09:54:03Z` and completed at `09:54:07Z` with HTTP 200:

```json
{ "claimed": 1, "expired_empty_attempts_terminalized": 0 }
```

The post-request database checkpoint at `09:54:49.251274Z` proved the batch actually processed the
target. The attempt completed expired at `09:54:06.93691Z` with both pointers null; the intent was
expired/failed with `expired_unpaid`, no paid timestamp and both lease fields null; the same
reservation released once at the same timestamp with `stripe_session_expired_unpaid`, no consume or
order pointer; and the one `overdue_reservation` job resolved at `09:54:07.008474Z`, attempt count
1, no error and no lease. Exactly one attempt/request/intent/Session/reservation/reservation item
remained in audit history. There was no order or incident. Inventory was A `4/0/4`, BASE `1/0/1`, C
`4/0/4`. The deployed batch path therefore retrieved authoritative Stripe state, expired/re-read
the unpaid Session as required, and selected the one safe terminal release. D and G are
**production-runtime PASS**.

### Scenario J — Integration PASS with Production Supporting Evidence

A later authenticated raw empty-body batch ran from `09:55:05Z` to `09:55:06Z` and returned HTTP
200 with `claimed: 0` and zero expired empty attempts. At `09:55:25.823284Z`, the exact D/G target
was unchanged: its release timestamp/reason were identical; the single resolved job still had
attempt count 1 and update timestamp `09:54:07.008474Z`; no new job, order or incident existed; and
inventory was unchanged. This is production evidence that the batch scan safely excludes completed
terminal work and does not reopen or release it twice. The predefined matrix requires the batch to
actually encounter the target for production-level J, however, so an empty queue does not upgrade
the row. Executed pgTAP independently proves exact targeted `already_terminal`, repeated terminal
`historical_noop`, unchanged `released_at`, and a resolved job not reopening. J is therefore
**PASS at strong integration grade with supporting production no-op evidence**, not claimed as a
production-runtime target encounter.

### B, C and I — Strong Integration Evidence, No Safe Runtime Control

No installed Stripe CLI, repository command or documented safe Stripe test-mode event replay/delay
mechanism was available. Production webhook code was not disabled or altered, and payment/lifecycle
state was not fabricated in SQL. Batch mode also has no legitimate way to re-target Scenario A's
already-paid terminal checkout, while targeted recovery was explicitly excluded. The following
recorded Scenario E working-tree verification remains applicable because the relevant lifecycle
implementation/tests did not change: complete database suite `448/448`, checkout/shared Deno suite
`104/104`, and all relevant lifecycle concurrency harnesses PASS.

- B: exact finalizer replay returns `already_finalized` without a second order, order item or
  inventory decrement; concurrent duplicate finalizers serialize to exactly one order. **Strong
  executed database/concurrency PASS; no production webhook replay performed.**
- C: authoritative complete/unpaid state classifies as `payment_pending`; database transition
  retains attempt/reservation ownership; later paid finalization uses the same atomic path;
  transient Stripe failure never reaches terminal release. **Strong executed database/Deno PASS;
  no production delayed webhook performed.**
- I: paid recovery calls paid finalization and never expiration/release; a paid attempt is excluded
  from abandonment work; paid finalization racing terminal release serializes to one consumed
  order. **Strong executed database/Deno/concurrency PASS; no production batch paid-target encounter
  performed.**

### Cleanup and Final State

After J, visible Clear canary basket returned HTTP 200 and displayed `Canary basket is empty.` The
final production read at `2026-08-19T09:56:21.58795Z` showed:

- A physical/reserved/ATS `4/0/4`;
- BASE physical/reserved/ATS `1/0/1`;
- C physical/reserved/ATS `4/0/4`;
- zero active reservation-v1 attempts and intents;
- zero held/payment-pending reservations;
- zero open incidents, open jobs, active admissions and due reservations;
- the D/G job retained once as resolved, attempt count 1;
- zero order and incident for the D/G attempt.

Global reservations remained OFF; no schedule, monitoring, deployment, source edit, commit or push
occurred. The batch reconciler is **VERIFIED READY FOR SCHEDULING**, but remains unscheduled. A/E/H
remain production-runtime PASS, 7C1 remains PASS/CLOSED and targeted recovery remains
PRODUCTION-PROVEN without repetition. The remaining-matrix overall result is **FAIL** because F is
a proven production replacement blocker and B/C/I/J remain below production-runtime grade. The
exact next action is a focused local diagnosis and minimal regression-backed fix for stale
completed admission state in `admit_checkout_request_v1`; do not schedule or globally enable until
that fix is reviewed and the monitoring/runbook blockers are closed.

## 2026-08-19 — Scenario E Worker-Lease Provenance Commit Pushed

**Record type:** CONTEMPORANEOUS SOURCE-CONTROL PUSH AND REMOTE-PARITY VERIFICATION
**Evidence grade:** STRONG local/remote Git-ref and working-tree evidence
**Status:** PASS; `origin/main` FAST-FORWARDED TO `acab7e0`

A pre-push `git fetch origin` confirmed branch `main`, local `HEAD`
`acab7e0681a2e54fd95c0d6fb635ab2cf53402fd`, remote `origin/main`
`3bca56d258f233720d367f187b28830a9f7edfac`, local ahead/behind `1/0`, the remote commit as the
merge base and an empty index. The dirty-tree set matched the previously approved exclusions.

The non-forced command `git push origin main` fast-forwarded remote `main` from `3bca56d` to
`acab7e0`. A required second fetch then proved `HEAD` and `origin/main` both equal
`acab7e0681a2e54fd95c0d6fb635ab2cf53402fd`, ahead/behind `0/0`, and an empty index. The unrelated
modified and untracked paths remained unchanged.

No deployment, test, canary, browser checkout, reconciliation, production read/write,
configuration change or global-reservation enablement occurred. Scenario E remains
production-runtime PASS/CLOSED; A and H remain production-runtime PASS; 7C1 remains PASS/CLOSED;
authenticated targeted recovery remains PRODUCTION-PROVEN; and global reservations remain OFF.
The exact next action is to continue only the remaining B/C/D/F/G/I/J evidence in a separately
authorized task.

## 2026-08-19 — Scenario E Worker-Lease Provenance Commit Created

**Record type:** CONTEMPORANEOUS SOURCE-PROVENANCE COMMIT AND FOCUSED LOCAL VERIFICATION
**Evidence grade:** STRONG Git index, committed diff and focused database/concurrency evidence
**Status:** PASS; COMMIT CREATED; NOT PUSHED

The task began on branch `main` with local `HEAD` and `origin/main` both at
`3bca56d258f233720d367f187b28830a9f7edfac` and an empty index. Complete hunk review established
that the two existing permitted test files contained only the intended Scenario E lease-release
additions. The new migration filename was exactly
`20260824120100_checkout_worker_lease_release.sql`; the superseded unapplied
`20260825120000_checkout_worker_lease_release.sql` filename was absent. The permitted files had not
changed since the recorded full local and production verification checkpoint, so that evidence
remained applicable without rerunning the full suite.

Fresh focused verification produced:

- worker-lease pgTAP: PASS, `18/18`;
- checkout request-orchestration concurrency: PASS, all seven printed checkpoints, including
  immediate completed-activation recovery, two-worker fencing, one Session/reservation and lease
  release after capability rotation;
- shell syntax: PASS;
- pre-commit working-tree and staged `git diff --check`: PASS.

Only these paths were staged and committed:

- `supabase/migrations/20260824120100_checkout_worker_lease_release.sql`;
- `supabase/tests/database/checkout-worker-lease-release.test.sql`;
- `supabase/tests/database/checkout-request-orchestration.test.sql` Scenario E additions;
- `supabase/tests/concurrency/checkout-request-orchestration-concurrency.sh` Scenario E additions.

Commit `acab7e0681a2e54fd95c0d6fb635ab2cf53402fd`, titled
`fix: release checkout worker lease after materialization`, contains 727 insertions and 6 deletions
across exactly those four files. The committed migration version matches production history, and
its successful `activate_checkout_request` and `rotate_checkout_confirmation_capability`
transitions clear `worker_lease_id` and `worker_lease_expires_at` while retaining `SECURITY DEFINER`,
`search_path=public, pg_temp`, public/anon/authenticated revocation and service-role execution.
This matches the deployed definitions already read and production-verified during the preceding
Scenario E checkpoint.

Unrelated diagnostic source, `AGENTS.md`, project memory and local tooling remained outside the
commit and were left untouched. No deployment, production read/write, checkout, reconciliation,
matrix rerun or push occurred. `origin/main` therefore remained `3bca56d`. Scenario E remains
production-runtime PASS/CLOSED; A and H remain production-runtime PASS; 7C1 remains PASS/CLOSED;
authenticated targeted recovery remains PRODUCTION-PROVEN; and global reservations remain OFF.
Remaining matrix work is B/C/D/F/G/I/J evidence as applicable. The exact next action is human
review of `acab7e0`, then an explicitly authorized push; matrix continuation remains separate.

## 2026-08-19 — Scenario E Worker-Lease Migration Deployed; Immediate Reload PASS

**Record type:** CONTEMPORANEOUS PRODUCTION MIGRATION AND FOCUSED RUNTIME VERIFICATION
**Evidence grade:** STRONG linked migration, deployed SQL, production database and named-browser evidence
**Status:** PASS; SCENARIO E AND BROWSER RELOAD/RECOVERY BLOCKER CLOSED

After the temporal gate `2026-08-19T08:29:35Z`, the exact retained Scenario E operation was read
without invoking checkout or reconciliation. Attempt `c01262fe-50b1-463f-9bd3-b09f7df54cc1` and
intent `cccfc17f-11cb-43a9-8613-3ccee3f0990a` had naturally become `expired`; both lifecycle pointers
were null; the intent recorded orchestration `failed`, failure `expired_unpaid`, no paid timestamp
and the original test Session. Reservation `96b4eb80-7cab-4281-aa8b-41dee78d5068` was released once
at `2026-08-19T08:29:39.941677Z` with `stripe_session_expired_unpaid`, about five seconds after the
recorded Session expiry. It retained exactly one BASE item, had no consume/order pointer, and no
order, lifecycle incident or reconciliation job existed. Inventory was A physical/reserved/ATS
`4/0/4`, BASE `1/0/1`, C `4/0/4`. All synthetic active-attempt, active-intent, held-reservation,
open-incident, open-job and active-admission counts were zero. Natural terminalization therefore
required no batch or targeted reconciliation.

The unapplied and uncommitted migration was renamed from
`20260825120000_checkout_worker_lease_release.sql` to
`20260824120100_checkout_worker_lease_release.sql`. No already-applied migration changed. After the
rename, a clean local database reset replayed all 18 migrations, the focused worker-lease pgTAP file
passed `18/18`, the full database suite passed `448/448` across 14 files, all six relevant
concurrency harnesses passed, database lint reported no schema errors, and `git diff --check`
passed. Source review confirmed the rename changed only migration identity/references and the
migration contains no top-level row update, data backfill or bulk lease clearing.

The linked `supabase db push --dry-run` plan contained exactly
`20260824120100_checkout_worker_lease_release.sql`, with no roles or seeds. The subsequent linked
database push applied only that migration. A fresh migration-history read showed local and remote
version `20260824120100` aligned. No Edge Function, frontend asset, Webflow change, diagnostic source,
commit or push was performed.

Direct production `pg_get_functiondef` reads proved successful `activate_checkout_request` and
`rotate_checkout_confirmation_capability` now set both `worker_lease_id` and
`worker_lease_expires_at` to null in their completing updates. Both remain `SECURITY DEFINER` with
`search_path=public, pg_temp`; ACLs contain postgres and service role only; anon/authenticated
execute checks are false and service-role execute checks are true. The remaining validation,
row-lock, pointer, capability-generation and replacement behavior matches the reviewed migration.

### Fresh Scenario E Runtime Evidence

One BASE-only reservation-v1 checkout was created through the visible `/checkout-test` UI in the
required `taa_browser_b` session:

- attempt `7427ec6e-2486-40fc-b124-daa9b2e9979a`;
- request `eee783e8-64a1-4e7c-a5f4-2725ce90523e`;
- intent `a659fbca-3076-46cc-ada8-f6cacaeb260f`;
- Stripe test Session `cs_test_a1FKizid1MAv9Lp4PTZqI56ukh1aKc9euWNJ5mdjQZLcIQK4UzZGGNS9zN`;
- reservation `855d6727-fbcc-4e13-8075-64db43eae453`.

Before reload, the Payment Element was visible and payable. A production snapshot at
`2026-08-19T08:48:54.554860Z` showed exactly one attempt, request, intent, Session, reservation and
reservation item; one held BASE unit; zero order, incident and job; confirmation generation 1; and
both worker-lease fields null. Inventory was A `4/0/4`, BASE `1/1/0`, C `4/0/4`.

The same page reloaded at `2026-08-19T08:49:00.295Z`, before the comparable former two-minute
request/lease deadline `08:49:09.735559Z`. The sole recovery call to `create-checkout-session`
returned HTTP 200, not 202. The Payment Element became payable again. The post-reload database
snapshot retained the exact attempt/request/intent/Session/reservation IDs and all counts at one;
confirmation generation advanced to 2 at `08:49:02.526908Z`; both lease fields were null; BASE
remained `1/1/0`; and order/incident/job counts remained zero. No duplicate ownership or negative
ATS appeared.

The retained terminal tab's initial visible Clear action returned HTTP 409 and left stale tab-local
basket state, but production remained terminal and zero-active. Browser storage was neither read nor
modified. A new tab in the same named browser supplied a fresh tab-scoped checkout authority. After
the successful reload proof, its visible Clear action returned HTTP 200 and displayed
`Canary basket is empty.` The fresh attempt and intent became `expired`, both pointers were null,
the same reservation became `released` once with `stripe_session_expired_unpaid`, and no new checkout,
order, incident or job appeared.

The final checkpoint at `2026-08-19T08:50:35.254216Z` showed A `4/0/4`, BASE `1/0/1`, C `4/0/4`;
active synthetic attempts `0`, active intents `0`, held reservations `0`, open incidents `0`, open
jobs `0` and active admissions `0`. `CHECKOUT_RESERVATIONS_ENABLED` remained absent while the canary
allowlist remained configured. Scenario A and H remain production-runtime PASS without repetition.
Scenario E is production-runtime PASS, its reload/recovery blocker is closed, and F/G/I/J were not
started.

## 2026-08-19 — Scenario E Worker-Lease Lifecycle Fix Implemented and Verified Locally

**Record type:** CONTEMPORANEOUS LOCAL WORKING-TREE IMPLEMENTATION AND VERIFICATION
**Evidence grade:** STRONG local migration, database, concurrency, Edge and frontend evidence
**Status:** FIX READY FOR REVIEW; NOT DEPLOYED; SCENARIO E REMAINS PRODUCTION FAIL PENDING REVERIFICATION

Source tracing established that the intent worker lease protects one worker's Stripe Session
materialisation or recovery operation. Before `activate_checkout_request`, the handler creates or
retrieves Stripe state and `record_checkout_session` durably stores the unique Session identity and
its materialisation data under the owning lease. Activation then locks the attempt, its reservation
and relevant intents, verifies worker/in-flight/capability/replacement state, and atomically publishes
the active intent while clearing in-flight ownership. After a successful activation commit, the
handler performs only best-effort predecessor coupon cleanup, reloads the snapshot and constructs the
response; none requires continued exclusive ownership. A successful confirmation-capability
rotation similarly completes its only persistent mutation in one SQL statement, after which only
response construction remains.

Clearing the successful transition's lease cannot expose a partial state: PostgreSQL row locks and
transaction visibility prevent another worker from observing the updated intent until the complete
activation transaction commits, including its attempt pointer compare-and-swap. At that point the
recorded Session plus active intent is the established stable resume state. The next worker is
serialized through `resume_checkout_request_v1`, acquires the now-null lease and retrieves the same
Session; deterministic Session identity, attempt-owned reservation state and finalization guards are
unchanged. Failed RPCs roll back. Incomplete creation/recovery, retryable or ambiguous Stripe work,
reconciliation-required state and manual review do not reach these successful transitions, so their
leases and existing fail-closed behavior remain intact. Webhook and reconciliation claim paths
already treat null or expired intent leases as claimable and do not require successful browser
transitions to retain their completed worker lease.

One additive migration was created:
`supabase/migrations/20260824120100_checkout_worker_lease_release.sql`. It sorts after the already
deployed `20260824120000` migration and replaces only the latest authoritative definitions of
`public.activate_checkout_request(uuid, uuid, text, timestamptz)` and
`public.rotate_checkout_confirmation_capability(uuid, uuid, text, timestamptz)`. Each successful
transition now sets `worker_lease_id = NULL` and `worker_lease_expires_at = NULL` in the same update
that completes activation or confirmation-capability rotation. Existing authorization, validation,
lock ordering, state classification, capability generation, replacement semantics, SECURITY
DEFINER/search path, revokes and service-role grants are preserved.

Focused regression `supabase/tests/database/checkout-worker-lease-release.test.sql` uses the real
browser-attempt protocol and contains 18 assertions. It admits and prepares one exact request,
creates one intent and attempt-owned reservation, acquires the creation lease, records and activates
one Session, and proves both lease fields are null. A new worker immediately resumes the same
attempt/request/intent/Session/reservation. A second worker is fenced while that recovery is
incomplete; wrong capability and mismatched request controls remain rejected. Successful capability
rotation clears its lease, the next immediate recovery succeeds, and repeated recovery retains
exactly one intent, Session, reservation and reservation item with no order, incident or job.

The existing orchestration pgTAP regression now asserts release after activation and rotation and
explicitly reacquires a new lease between them. The existing concurrency harness now adds one
materialised active fixture and races two recovery workers: the second waits on the first worker's
uncommitted row lock, then receives `operation_in_progress`; the winner retains the single Session
and reservation, and successful rotation releases its lease.

### Commands and Results

- Full local database reset/replay: PASS; all 18 migrations through
  `20260824120100_checkout_worker_lease_release.sql` applied in order.
- Focused pgTAP regression: PASS; 1 file, 18 tests. The first invocation was prevented from starting
  by the sandbox denying the Supabase CLI telemetry-file write; the equivalent approved local rerun
  executed successfully. This was tooling/sandbox failure, not a database-test failure.
- Complete pgTAP/database suite: PASS; 14 files, 448 tests. Expected local Vault-dependent Klaviyo
  and fingerprint warnings remained non-fatal.
- Checkout request orchestration concurrency: PASS, including completed activation lease release,
  two-worker serialization, one Session/reservation and completed rotation lease release.
- Reservation lifecycle concurrency: PASS; paid-versus-expiry, paid-versus-release, duplicate
  finalizer and asynchronous failure/success races converged safely.
- Reservation lifecycle hardening concurrency: PASS; terminal/predecessor and paid/replacement
  races converged safely.
- Targeted reconciliation concurrency: PASS; concurrent exact claims serialized to one leased job.
- Inventory reservation concurrency: PASS; final-unit and opposite-order races preserved inventory
  invariants without deadlock.
- Browser checkout admission concurrency: PASS.
- Checkout/shared Deno suite: PASS; 104 tests, 0 failed across 14 files.
  The runner generated an untracked root `deno.lock`; it was removed after verification because it
  was not present at session start and is not part of this database-only fix.
- Edge Function typecheck: PASS for `create-checkout-session`,
  `reconcile-checkout-reservations`, `stripe-webhook` and `get-checkout-confirmation`.
- Focused `checkout-operation.test.js`: PASS; 13 tests, 0 failed.
- Complete checkout frontend plus checkout-error suite: PASS; 74 tests, 0 failed.
- Local database lint: PASS; no schema errors.
- `npm run lint`: PASS.
- `npm run build`: PASS; Vite 8.2.1 transformed 74 modules and completed the production build.
- Targeted Prettier write/check for both changed project-memory Markdown files: PASS; both were
  already formatted. The repository-wide `npm run format:check` remains non-zero because 120
  pre-existing `.playwright-mcp` YAML artifacts and four unrelated architecture Markdown files are
  not Prettier-clean; none was changed in this task. `git diff --check`: PASS after the final
  project-memory update.

This evidence applies to the current dirty working tree and must not be attributed to `HEAD`
`3bca56d`. No database push, Edge or frontend deployment, production read or write, browser checkout,
batch or targeted reconciliation, canary run, commit or push occurred. The retained Scenario E BASE
operation was explicitly untouched. The migration changes future successful RPC executions only;
it contains no data update and does not clear existing live leases. An existing active row carrying
an old worker lease will remain fenced until its recorded expiry or a separately authorized
lifecycle action. No bulk cleanup is required to make future successful transitions correct.

The currently deployed `create-checkout-session` handler already consumes the RPC contract needed
by this fix: once resume returns `resumable`, active state selects retrieval/validation of the
recorded Session and successful response construction calls confirmation-capability rotation. It
will therefore benefit immediately from the migrated SQL semantics. Approval would require only the
database migration; neither frontend nor Edge Function redeployment is indicated by this change.

Scenario A and H production evidence remains valid. Scenario E remains FAIL until the migration is
approved and deployed and one focused immediate-reload production verification proves HTTP 200 with
the same Session and exactly-once lifecycle ownership. Global reservations remain recorded OFF; no
production configuration was touched.

## 2026-08-19 — Scenario E Post-Expiry Read and Deployed HTTP 202 Root Cause

**Record type:** CONTEMPORANEOUS READ-ONLY PRODUCTION CHECKPOINT AND SOURCE/CONTRACT DIAGNOSIS
**Evidence grade:** STRONG production database, named-browser network, deployed SQL and repository source evidence
**Status:** POST-EXPIRY PASS CRITERIA NOT MET; SCENARIO D NOT ESTABLISHED; SCENARIO E ROOT CAUSE PROVEN; NO RECOVERY INVOKED

At `2026-08-19T07:05:00Z`, a read-only production query inspected the exact Scenario E attempt
`c01262fe-50b1-463f-9bd3-b09f7df54cc1`. The previously recorded
`2026-08-19T06:58:36.03Z` timestamp belongs to reservation
`96b4eb80-7cab-4281-aa8b-41dee78d5068`; it is not the Stripe Session expiry. Intent
`cccfc17f-11cb-43a9-8613-3ccee3f0990a` records Stripe Session expiry
`2026-08-19T08:29:35Z`, and the attempt hard expiry is `2026-08-19T08:29:35.714193Z`.
No live Stripe API retrieval was performed. Because the stored Stripe expiry was still in the future,
the required authoritative expired/unpaid condition was not established and no reconciler was called.

The attempt was `active`, with active intent `cccfc17f...`, no in-flight intent, admitted request
`4c76a2e0-fe41-4aaf-9312-92004787aff9` and no completion timestamp. The intent was `pending` with
orchestration `active`, one recorded test Session
`cs_test_a1vV1FbE2dvvj2FKNOw8X18NbdN64ND019wCPOBUNFW5UujtnqHS4Cj18s`, no paid timestamp and no
replacement/predecessor. The reservation remained held with exactly BASE x1, no consume, release or
order pointer. BASE order count, target incident count and target reconciliation-job count were all
zero. Inventory remained A physical/reserved/ATS `4/0/4`, BASE `1/1/0`, C `4/0/4`.

This operation did not naturally terminalise at the local reservation deadline. That result does not
establish a lifecycle failure: ADR-0001 and the production blocker contract prohibit release based on
local time alone, and the recorded Stripe Session expiry had not arrived. Scenario D therefore gains
no valid production-runtime PASS from this checkpoint. The exact state is preserved for an explicit
future recovery decision; no batch or targeted reconciliation, checkout operation, production-state
change or source change occurred.

### Proven HTTP 202 Condition

The production definition of `resume_checkout_request_v1` was read directly. For a matching
non-terminal intent, it returns `operation_in_progress` unless the caller can acquire the intent's
worker lease. Production definitions of `activate_checkout_request` and
`rotate_checkout_confirmation_capability` were also checked and neither clears `worker_lease_id` nor
`worker_lease_expires_at` after successful completion. The exact intent retained the original worker
lease until `2026-08-19T06:31:36.071595Z` despite already being `pending` / `active` with a recorded
Session.

Preserved `taa_browser_b` evidence placed the reload at `2026-08-19T06:30:22Z` and the visible Retry
Payment click at `2026-08-19T06:31:14Z`. The network list contains eight HTTP 202 responses from
`create-checkout-session`: four automatic requests and four following the visible retry. Sanitized
response bodies for the first and last manual-loop requests both contained only
`checkout_orchestration_error = operation_in_progress` and `retry_after_seconds = 3`. Both bounded
loops completed before the retained lease expired. No request was made after lease expiry, so this
record does not claim a post-lease runtime result.

Reload correctly selected `resumeCheckoutSession`, supplied the original attempt/request identity and
made no mutable shipping lookup or fresh request. The server's capability authorization and matching
intent lookup succeeded; otherwise the deployed RPC could not have reached the observed lease branch.
Database counts independently remained exactly one attempt, one request, one intent, one Session and
one reservation. The handler converted the RPC result to HTTP 202, the frontend classified it as
retryable, and its four-attempt budget exhausted before the two-minute lease. Manual Retry invokes the
same function with the same immutable identity, so it repeated the same no-progress branch.

The expected result for this materialised active state was an immediately resumable operation:
retrieve the recorded Session, verify it remains payable, rotate the confirmation capability and
return HTTP 200 with the same Session for Payment Element installation. The defect is backend
orchestration/request-state lifecycle: completed activation and recovery rotation retain a worker
lease that means "work in progress" to the next invocation. Frontend identity reconstruction and
retry safety behaved as designed.

Observed safety evidence excludes oversell, duplicate payment, duplicate reservation, duplicate
Session and duplicate lifecycle ownership. The direct customer risk is payment UI unavailability for
the remaining lease duration and consequent checkout abandonment. A resulting abandoned payable
Session can keep its legitimate reservation held until Stripe-authoritative expiry handling; the 202
loop itself does not consume, release or duplicate inventory.

### Test Gap and Proposed Fix — Not Implemented

The closest Slice 5D frontend test, `reload retry exhaustion exposes manual resume without fresh
shipping or request C`, deliberately mocks four perpetual 202 responses and proves only immutable
identity and fail-closed retry behavior. The active-recovery frontend test mocks immediate success.
The protocol unit test for recorded Session recovery begins after resume has already reached the
active snapshot. The database attempt-protocol test exercises only unmaterialised admission resume;
it has no active, materialised Session fixture retaining a future activation-worker lease.

The minimum regression must create one reservation-v1 attempt/request/intent/reservation, record and
activate one payable Session while a worker lease is live, then immediately resume the same identity
with a new worker. It must expect `resumable` followed by HTTP 200 for the same Session and assert one
attempt, request, intent, Session and reservation. Wrong capability and mismatched request controls
must remain fail closed.

The minimal proposed implementation is a new additive migration that replaces
`activate_checkout_request` and `rotate_checkout_confirmation_capability` so each successful
transition atomically sets `worker_lease_id` and `worker_lease_expires_at` to null. The existing Edge
resume path already retrieves active Sessions and rotates capability state; no frontend change and no
Edge deployment are presently indicated. A backend database migration is required. Before production
reverification, run the new database regression and existing browser-attempt,
reservation-lifecycle/7C1, checkout-protocol and checkout-operation suites. Then perform one bounded
Scenario E production canary reload inside the former two-minute failure window and prove HTTP 200,
the same Session and unchanged exactly-once lifecycle counts. A and H remain PASS; E remains FAIL
until fixed and reverified. Global reservations remain off.

## 2026-08-19 — Payment/Recovery E2E Matrix Temporal Preflight Repeated

**Record type:** CONTEMPORANEOUS PRODUCTION PREFLIGHT
**Evidence grade:** STRONG read-only production metadata/database, named-browser and deployed-source evidence
**Status:** PASS; SCENARIO A AUTHORIZED; GLOBAL RESERVATIONS OFF

At `2026-08-19T06:20:54Z`, a presence-only shell check established that
`CHECKOUT_RECONCILIATION_SECRET` exists and is non-empty. The credential value and Authorization
header were not printed, echoed, compared, hashed, serialized, logged, persisted or otherwise
exposed. `taa_browser_b` exposed its browser MCP tools and listed one current `about:blank` tab.

Fresh read-only production evidence established A physical/reserved/ATS `5/0/5`, BASE `1/0/1`, C
`5/0/5`; zero active reservation-v1 attempts, active synthetic intents, held synthetic
reservations, open lifecycle incidents, open reconciliation jobs and active admissions; 17 recorded
synthetic test-mode Sessions and zero non-test Sessions. Secret-name metadata showed the current
reconciliation secret and canary allowlist configured, with the previous-secret slot and global
reservation flag absent. Reconciliation remained unscheduled: `pg_cron` and `cron.job` were absent.
`stripe-webhook`, `create-checkout-session`, `get-checkout-confirmation` and
`reconcile-checkout-reservations` were ACTIVE.

A fresh private temporary download compared the deployed reconciler entry point and its 13 shared
imports with approved commit `3bca56d`; all 14 files matched byte-for-byte. No source,
configuration, schedule, checkout, Stripe or lifecycle mutation occurred during this checkpoint.
The controlling A-J definition and row-specific stop boundaries below remain unchanged. Scenario A
is authorized.

### A and H Checkpoint

At `2026-08-19T06:27:58Z`, `taa_browser_b` completed one visible A+C test-mode card payment through
the deployed `/checkout-test` customer UI and followed the normal redirect to
`/order-confirmation-test`. Before payment, authoritative database reads showed exactly one active
reservation-v1 attempt (`507e5c45...`), one pending/active intent (`5f6e45d4...`), one held
reservation (`901b273a...`) containing A x1 and C x1, zero orders, and inventory A `5/1/4`, BASE
`1/0/1`, C `5/1/4`. The browser showed the provider-mounted card element and a `cs_test_` Session.

After payment and ordinary signed-webhook processing, the confirmation page rendered order
`TAA-20260819-00000008`, exactly A x1 and C x1, subtotal GBP 2.00, DPD shipping GBP 4.99 and total
GBP 6.99. A fresh database read independently showed the attempt and intent paid, lifecycle pointers
clear, the reservation consumed and not released, exactly one paid order with two items, inventory A
`4/0/4`, BASE `1/0/1`, C `4/0/4`, and zero open incident or job for the attempt. Scenario A is PASS
with strong production runtime and authoritative database evidence. The legitimate capability-bound
confirmation path is PASS for scenario H; no capability value was read or recorded and the URL
contained only the test Checkout Session identifier.

No installed Stripe CLI, repository webhook-replay command or other established safe replay surface
was found. Per the controlling matrix, B is therefore not production-replayed. Delayed-success and
paid-reconciler manipulation likewise have no safe production-test control established at this
checkpoint; C and I remain eligible only for their strongest integration-test evidence and must not
be described as production runtime verification.

### E Stop Checkpoint; Remaining Mutation Stopped

At `2026-08-19T06:32:25Z`, scenario E failed its explicit production-runtime stop boundary. A single
BASE operation was created through visible `taa_browser_b` UI. Before reload it comprised exactly
attempt `c01262fe...`, intent `cccfc17f...`, request `4c76a2e0...`, one `cs_test_` Session and one
held BASE reservation `96b4eb80...`, with zero order. A normal navigation reload retained the BASE
basket but automatic recovery exhausted its retry budget with `Checkout preparation is still
processing.` The visible `Retry Payment` action produced the same unavailable-payment state.
Sanitized network evidence showed repeated HTTP 202 responses from `create-checkout-session`.

Fresh authoritative reads after the stop showed exactly one attempt, one intent, one request, one
Session and one reservation: the attempt remained active, intent pending/orchestration active,
reservation held, zero order, zero target incident and zero target job. The final worker lease
recorded by the checkpoint expired at `2026-08-19T06:31:36.071595Z`, before the final database read.
This is not duplicate lifecycle ownership; it is the matrix-defined failure to resume a coherent
active operation as payable after reload. Scenario E is FAIL with strong deployed-browser and
database evidence.

Per the controlling stop boundary, no replacement, batch reconciliation, expiry manipulation,
additional retry, Clear action, deployment, configuration change or source change followed. D, F,
G, I and J did not receive further production mutation. Current inventory is A `4/0/4`, BASE
`1/1/0`, C `4/0/4`; one synthetic attempt remains active until an authoritative unpaid lifecycle
transition occurs. Open incidents and open reconciliation jobs remain zero. Global reservations
remain off and the canary allowlist remains configured.

The independent negative confirmation control used `taa_browser_a` only because a genuinely separate
session was required. With the same test Session identifier but no capability, the confirmation
endpoint returned HTTP 404 and the page exposed no order number, items, totals, billing or shipping
details. Together with the legitimate `taa_browser_b` result above, scenario H is PASS with strong
production runtime evidence.

### Scenario Outcome Matrix at Mandatory Stop

| Row | Outcome                 | Evidence grade                                       | Durable classification                                                                                                    |
| --- | ----------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| A   | PASS                    | Strong production runtime and database               | One A+C payment, one paid order, one consumed reservation, one decrement per item.                                        |
| B   | NOT PRODUCTION-REPLAYED | Moderate existing executed integration evidence only | No established safe replay tooling; no new checkout or replay fabricated.                                                 |
| C   | NOT PRODUCTION-EXECUTED | Moderate existing executed integration evidence only | No safe delayed-success control; paid-pending preservation remains non-runtime evidence.                                  |
| D   | BLOCKED BY E STOP       | Weak production initial-state evidence only          | BASE remained open/unpaid and held; expiry outcome not exercised before stop.                                             |
| E   | FAIL                    | Strong production browser, network and database      | Coherent operation remained unique but did not resume as payable after reload and visible retry.                          |
| F   | BLOCKED BY E STOP       | Moderate existing executed integration evidence only | No visible replacement mutation followed the mandatory stop.                                                              |
| G   | BLOCKED BY E STOP       | None for production batch processing                 | Authenticated empty-body batch was not invoked.                                                                           |
| H   | PASS                    | Strong production runtime in two named sessions      | Legitimate capability rendered the exact order; independent no-capability request returned 404 and exposed no order data. |
| I   | NOT PRODUCTION-EXECUTED | Moderate existing executed integration evidence only | Paid reconciliation was not fabricated or invoked without a safe missed-event control.                                    |
| J   | BLOCKED BY E STOP       | Moderate existing executed integration evidence only | No terminal-unpaid target existed before stop; production no-op not exercised.                                            |

Overall matrix result is **FAIL at E**. The payment/recovery E2E blocker remains open and the batch
reconciler is **not verified ready for scheduling**, because G did not execute. The exact next action
is read-only observation after `2026-08-19T06:58:36.03Z`; if authoritative unpaid terminalization
does not occur, obtain an explicit recovery decision before any reconciler invocation. Diagnose the
preserved deployed reload-recovery HTTP 202 loop before resuming the remaining matrix rows.

## 2026-08-19 — Payment/Recovery E2E Matrix Resumed; Pre-Mutation Gate Passed

**Record type:** CONTEMPORANEOUS PRODUCTION PREFLIGHT
**Evidence grade:** STRONG read-only production metadata/database and deployed-source evidence
**Status:** PASS; MATRIX EXECUTION AUTHORIZED BY THE RECORDED GATES; GLOBAL RESERVATIONS OFF

At `2026-08-19T06:03:00Z`, a fresh process resumed the previously blocked A–J matrix. A
presence-only shell check established that `CHECKOUT_RECONCILIATION_SECRET` exists and is non-empty.
The credential value was not printed, echoed, compared, hashed, serialized, logged, persisted or
otherwise exposed.

The complete independent pre-mutation production gate established:

- A physical/reserved/ATS `5/0/5`, BASE `1/0/1`, C `5/0/5`;
- zero active reservation-v1 attempts, active synthetic intents, held synthetic reservations, open
  lifecycle incidents, open reconciliation jobs and active admissions;
- all 17 recorded synthetic reservation-v1 Sessions are `cs_test_`, with zero non-test Sessions;
- `CHECKOUT_RECONCILIATION_SECRET` and `CHECKOUT_RESERVATIONS_CANARY_SKUS` configured;
- `CHECKOUT_RECONCILIATION_PREVIOUS_SECRET` and `CHECKOUT_RESERVATIONS_ENABLED` absent;
- `stripe-webhook`, `create-checkout-session`, `get-checkout-confirmation` and
  `reconcile-checkout-reservations` ACTIVE;
- production `pg_cron` absent and `cron.job` absent.

A fresh private temporary download compared the deployed reconciler entry point and all 13 shared
imports against approved commit `3bca56d`; all 14 files matched byte-for-byte. The temporary audit
directory was removed. No source, deployment, configuration, schedule, Stripe object, checkout
operation or browser state changed during this checkpoint.

The historical matrix definition and exact row-specific stop conditions below remain controlling.
Scenario A was authorized by the production gates. Any invariant mismatch or genuine defect remains
a mandatory stop at that row.

### Browser-Availability Stop

At `2026-08-19T06:04:03Z`, the required visible browser-control surface reported no available
browser. The prescribed connection diagnostics were read and the one permitted browser-type listing
returned an empty list. No unrelated browser tool, standalone Playwright process, storage
manipulation or source workaround was substituted.

The matrix stopped before scenario A. No checkout attempt, Stripe object, payment, webhook replay,
reconciliation request, browser-state mutation, source/configuration change, deployment, schedule,
commit or push occurred. The passed database/configuration preflight is the final production state
observed by this process. Because production evidence is temporal, the complete zero-active and
configuration gate must be repeated after a browser backend is connected and before scenario A.
Global reservations remain off.

## 2026-08-19 — Payment/Recovery E2E Matrix Definition and Preflight

**Record type:** CONTEMPORANEOUS READ-ONLY PREFLIGHT
**Evidence grade:** STRONG source-equivalence, production metadata and database evidence
**Status:** BLOCKED BEFORE PRODUCTION MUTATION — PRIVATE BATCH CREDENTIAL ABSENT FROM PROCESS

This task is intended to close the reservation-v1 payment/recovery E2E evidence gap and manually
verify the authenticated empty-body batch reconciler. Before creating any checkout, the repository,
ADR, blocker runbook, current source, tests, Git status and recent history were inspected.

At `2026-08-19T05:42:45Z`, fresh read-only production checks established:

- A physical/reserved/ATS `5/0/5`, BASE `1/0/1`, C `5/0/5`;
- zero active reservation-v1 attempts, active canary-linked intents, held canary reservations,
  open lifecycle incidents, open reconciliation jobs and active admissions;
- all 17 recorded synthetic reservation-v1 Sessions classify as Stripe test mode and zero classify
  as non-test;
- `CHECKOUT_RECONCILIATION_SECRET` and `CHECKOUT_RESERVATIONS_CANARY_SKUS` configured;
- `CHECKOUT_RECONCILIATION_PREVIOUS_SECRET` and `CHECKOUT_RESERVATIONS_ENABLED` absent;
- `stripe-webhook`, `create-checkout-session` and `reconcile-checkout-reservations` ACTIVE;
- production `pg_cron` and `cron.job` absent.

A deployed-source download into a private temporary directory compared the reconciler entry point
and its 13 shared imports against committed `3bca56d`. All 14 files matched byte-for-byte. No code or
configuration was deployed or changed.

### Matrix Defined Before Execution

| Row                                                   | Planned minimum operation and initial state                                                                                                                                                                        | Expected authoritative result                                                                                                                                            | Inventory/order expectation                                                                                 | Incident/job and cleanup expectation                                                                            | PASS and stop boundary                                                                                                                                                                   |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A — successful payment                                | Visible checkout-test UI; one A+C canary basket; start from zero active lifecycle. Before payment require one active attempt, one pending/active intent, one held reservation and a test-mode open/unpaid Session. | Ordinary signed webhook finalizes attempt and intent as paid; reservation becomes consumed.                                                                              | Exactly one order; A and C physical each decrement once; reserved returns zero; ATS equals new physical.    | No `paid_*` incident or manual-review job. Confirmation then clears the browser basket/attempt normally.        | PASS only if Stripe is authoritatively paid and DB has exactly one coherent order/consumption. STOP on any paid-without-order, duplicate order/decrement or held reservation.            |
| B — duplicate successful webhook                      | Reuse A's Stripe test event through established replay tooling only; create no new checkout.                                                                                                                       | Replay is idempotent; paid lifecycle remains unchanged.                                                                                                                  | Still exactly one order and one decrement per item; consumed reservation remains one row.                   | No duplicate incident/job. No cleanup.                                                                          | STOP on any second order, second decrement or changed terminal ownership.                                                                                                                |
| C — delayed successful webhook                        | Use only an existing safe Stripe test-mode delayed-event mechanism; otherwise retain integration-test-only evidence.                                                                                               | Intermediate payment-pending state retains stock; later authoritative success finalizes paid exactly once.                                                               | One order/decrement after success; reservation never releases as unpaid while payment remains possible.     | Retry work resolves or remains fail-closed; no unexpected manual review.                                        | STOP if payment-pending stock releases, paid state lacks one order, or no safe runtime mechanism exists and the row is misclassified as production-tested.                               |
| D — payment failure/unpaid expiry                     | One BASE checkout left unpaid; before expiry one active attempt, pending intent, held BASE reservation, test-mode open/unpaid Session and no order.                                                                | Stripe proves expired/unpaid; attempt becomes expired, intent expired/failed with the designed unpaid classification, reservation released once.                         | BASE physical unchanged; reserved returns zero; ATS restores to physical; no order.                         | No unexpected incident; resolved reconciliation work is acceptable. Clear visible basket after terminalization. | STOP on physical decrement, duplicate release, retained held state after authoritative transition or any order.                                                                          |
| E — browser reload recovery                           | Reuse an active unpaid operation before D completes; reload through normal browser navigation without storage inspection/manipulation.                                                                             | Same attempt/request/intent/Session is resumed and payable; no protocol downgrade.                                                                                       | Same single held reservation and unchanged physical/ATS.                                                    | No new incident/job; later reuse D cleanup.                                                                     | STOP on a second attempt, intent, Session or reservation, or Payment Unavailable for a coherent active operation.                                                                        |
| F — replacement lineage                               | Reuse one active canary checkout and a documented visible replacement action, such as a valid safe test discount, only if available without database fabrication.                                                  | Replacement B correctly references A; predecessor invalidation and current-pointer handoff remain coherent; superseded Session cannot finalize stock.                    | One attempt-owned reservation throughout; no duplicate stock commitment; no order unless deliberately paid. | Authoritative abandonment expires any payable lineage and releases once.                                        | STOP on two reservations, branching replacement, stale predecessor finalization or inconsistent pointers. If no safe visible replacement trigger exists, classify integration-test-only. |
| G — missed/delayed webhook through manual batch       | Reuse D's unpaid BASE operation and invoke the private reconciler with an authenticated raw empty body/no mode at the authoritative expiry boundary, before relying on webhook cleanup.                            | Batch claims relevant due work, retrieves Stripe, expires/retrieves if required, and selects unpaid terminalization.                                                     | BASE physical unchanged; one release; reserved zero; ATS restored; unrelated lifecycle rows untouched.      | HTTP 200, safe `claimed`/cleanup counters, resolved job or coherent no-op if a race was already won by webhook. | PASS requires evidence the batch actually claimed/processed the target; an empty-queue 200 alone is insufficient. STOP on 202/4xx/5xx, wrong target, paid release or unrelated mutation. |
| H — confirmation capability                           | Reuse A after payment; follow normal redirect to `/order-confirmation-test` without reading capability material.                                                                                                   | Legitimate capability returns the correct order; supported reload/replay behavior follows current protocol. An unrelated/no-capability request must not expose an order. | Displayed order/items/totals correspond exactly to A's single order.                                        | No new incident/job. Preserve only terminal audit/order history.                                                | STOP if confirmation exposes another order, fails for the legitimate first request after normal polling, or capability appears in URL/logs.                                              |
| I — reconciliation sees authoritative paid state      | Prefer reuse of a safely controllable missed/delayed paid event; otherwise use the strongest committed integration tests and classify them honestly.                                                               | Reconciler preserves/finalizes paid; never applies unpaid release.                                                                                                       | Exactly one order/decrement; reservation consumed and reserved zero.                                        | Resolved work or fail-closed manual review; never silent release.                                               | STOP on paid release, duplicate order/decrement or fabricated DB paid state.                                                                                                             |
| J — reconciliation sees already-terminal unpaid state | After D/G, a later batch invocation or the strongest existing integration test must be a no-op for the terminal target.                                                                                            | Attempt/intent remain terminal unpaid and reservation remains released.                                                                                                  | No order, no physical decrement, no second release.                                                         | No new incident; queue state does not reopen or duplicate terminal work.                                        | PASS at production level only if the batch actually encounters the case; otherwise integration-test-only.                                                                                |

The plan intentionally reuses operations: A also covers H and is the source for B where replay is
available; one active unpaid operation covers E, D, G and potentially J; F uses the same active
operation only when doing so cannot interfere with the timed unpaid/batch proof. No test checkout is
created merely to increase scenario count.

### Pre-Mutation Stop

Presence-only environment checks found neither `CHECKOUT_RECONCILIATION_SECRET` nor
`CHECKOUT_RECONCILIATION_CANDIDATE` in the Codex process. The configured Edge secret cannot be read
back from Supabase, and no credential material was retrieved, printed, compared, hashed or recorded.
Without the current credential, scenario G cannot be executed and the batch worker cannot be
verified. Starting irreversible paid or long-lived reservation operations without this required
recovery control would be unsafe.

No browser was opened, no checkout attempt or Stripe object was created, no reconciliation endpoint
was invoked, and no production/source/configuration state changed. Final 7C1 remains PASS/CLOSED;
authenticated targeted recovery remains production-proven; global reservations remain off.

The exact next action is to start a fresh Codex process from a hidden-input shell that exports the
current credential as `CHECKOUT_RECONCILIATION_SECRET`, then repeat the presence-only and clean
baseline gates. Only after both pass may scenario A begin. The recurring scheduler remains out of
scope.

## 2026-08-19 — Reservation-v1 Production-Readiness Blocker Review

**Record type:** CONTEMPORANEOUS READ-ONLY REVIEW
**Evidence grade:** STRONG repository/source, historical verification and read-only production metadata/database evidence
**Status:** READY AFTER 4 BLOCKERS; GLOBAL RESERVATIONS REMAIN OFF

This review did not modify application source, deploy, commit, push, invoke reconciliation, create a
checkout attempt, run a canary, change Supabase/Webflow/Stripe, or enable reservations. It revised
only project memory. Final 7C1 remains PASS/CLOSED. Authenticated targeted operator recovery remains
PRODUCTION-PROVEN and must not be repeated merely because this review occurred.

Git inspection found `main` and `origin/main` at
`3bca56d258f233720d367f187b28830a9f7edfac`, ahead/behind `0/0`, with nothing staged. The known
handbook, database-diagnostic and local-tooling/project-memory changes remain outside the approved
commits.

Fresh read-only production evidence established:

- A physical/reserved/ATS `5/0/5`, BASE `1/0/1`, C `5/0/5`;
- zero active reservation-v1 attempts, active canary-linked intents, held canary reservations,
  open lifecycle incidents, open reconciliation jobs and active admissions;
- migration `20260824120000` present;
- production `pg_cron` absent and `cron.job` absent;
- `reconcile-checkout-reservations` ACTIVE v12 with `verify_jwt=false`;
- `CHECKOUT_RECONCILIATION_SECRET` and `CHECKOUT_RESERVATIONS_CANARY_SKUS` configured;
- `CHECKOUT_RECONCILIATION_PREVIOUS_SECRET` and `CHECKOUT_RESERVATIONS_ENABLED` absent.

No secret value or digest was retrieved or recorded. The reconciler's displayed v12 is configuration
revision churn; the prior verification record establishes that its bundle/source contract remains
equivalent to the approved targeted-recovery deployment. Future provenance checks must compare
source/bundle/contract equivalence rather than require a literal function version.

### Closed or Superseded Blockers

- inventory reservation ownership, immutable cart and database concurrency;
- idempotent request admission/replacement orchestration;
- browser capability protocol, bounded automatic/manual retry and persisted recovery design;
- Phase 6A ingress/security boundary;
- server-side exact-SKU canary admission;
- checkout-test fixture/release isolation and implemented global flag rollback semantics;
- final-unit contention and non-negative ATS;
- typed inventory conflict and Continue Without;
- authoritative browser cleanup and empty-attempt terminalization;
- lost-capability exact operator recovery and authenticated ingress;
- exactly-once unpaid release and synthetic inventory restoration;
- production code provenance and retired legacy endpoint removal.

The stale statement in `docs/checkout-production-blockers.md` that authenticated targeted recovery
is still outstanding is **SUPERSEDED** by the final 2026-08-18 production smoke. Correcting that
sentence is documentation work, not a reason to repeat the smoke.

### Four Remaining Enablement Blockers

1. The global empty-body reconciler worker has not been comprehensively production-verified and is
   unscheduled. ADR-0001 and the activation checklist make a private one-to-two-minute schedule
   mandatory; webhook, browser abandonment and exact manual recovery do not replace automatic
   queue scans, expired-empty cleanup or missed-webhook recovery.
2. External lifecycle monitoring, worker-heartbeat alerting and objective reservation-specific
   rollback thresholds are not evidenced.
3. No authoritative operator runbook was found for paid incidents, refund/manual fulfilment,
   scheduler/credential custody, stop conditions and global rollback.
4. Durable evidence does not close the full reservation-v1 payment/recovery E2E matrix: successful
   payment, delayed success/failure, replacement, expiry, missed webhook through batch
   reconciliation, confirmation capability, exactly-once paid stock/order finalization, and browser
   reload recovery at every request/replacement stage.

Production unpaid recovery evidence is strong but does not upgrade the paid reservation-v1 path to
production-proven. Paid-state preservation and exactly-once physical decrement therefore remain
inside blocker 4.

### Deferred, Non-Blocking Work

The dirty `checkout-orchestration.ts`, `abandon-checkout-attempt/index.ts` and focused test add safe
RPC-name/database-code diagnostics for an earlier abandonment failure. Existing deployed behavior
is fail closed, and both 7C1 cleanup and targeted recovery passed without this diagnostic patch; it
is useful observability hardening, not a reservation-enablement prerequisite. Temporary legacy
PaymentIntent webhook compatibility, the Klaviyo delivery outbox gap and discount-entitlement
concurrency are separately tracked debts and are not reservation-v1 activation blockers.

### Enablement Boundary and Next Action

Only `CHECKOUT_RESERVATIONS_ENABLED=true` globally admits genuinely new checkouts to
reservation-v1. It is an Edge secret/configuration change, not a code deployment. Removing that
variable is the preferred rollback for new ordinary attempts; existing v1 attempts must continue
as v1, and webhook/reconciliation must remain active. The exact-SKU canary allowlist remains
independent. No percentage/cohort rollout exists.

The exact next action is to prepare and approve the scheduler/monitoring/incident-response and
rollback package, including objective thresholds and the superseded-doc correction, then execute
the missing Stripe test-mode E2E matrix. After that, configure and verify the one-to-two-minute
batch schedule, recheck the zero-active baseline and seek explicit authorization for the global
flag. Another 7C1 run and another targeted operator smoke are unnecessary.

## 2026-08-18 — Final Authenticated Targeted-Recovery Smoke Resumed

**Record type:** CONTEMPORANEOUS
**Evidence grade:** STRONG production authentication, Stripe-aware runtime, database and browser evidence
**Status:** PASS — AUTHENTICATED TARGETED OPERATOR RECOVERY PRODUCTION-PROVEN

At `2026-08-18T23:00:10Z`, the authorised second and final authenticated targeted-recovery smoke
resumed from the source-equivalent ACTIVE v9 checkpoint. A presence-only process check confirmed
`CHECKOUT_RECONCILIATION_CANDIDATE` exists and is non-empty; its value was not printed, echoed,
hashed, compared, serialized or exposed.

The pre-mutation production read established A 5/0/5, BASE 1/0/1 and C 5/0/5, with zero active
reservation-v1 attempts, active canary intents, held canary reservations, open lifecycle incidents,
open reconciliation jobs and active admissions. Current function metadata remained ACTIVE v9 at
the previously proven source/contract-equivalent deployment checkpoint. Secret-name metadata
showed `CHECKOUT_RECONCILIATION_SECRET` configured with its unchanged
`2026-08-14T06:34:25.546Z` timestamp, while `CHECKOUT_RECONCILIATION_PREVIOUS_SECRET` and
`CHECKOUT_RESERVATIONS_ENABLED` were absent.

No production mutation had occurred at this checkpoint. The next bounded step is to stage the same
saved candidate only as `CHECKOUT_RECONCILIATION_PREVIOUS_SECRET`, leaving the current secret
untouched, then confirm name-only topology before opening `taa_browser_b`.

At `2026-08-18T23:03:39Z`, the same inherited candidate was staged only as
`CHECKOUT_RECONCILIATION_PREVIOUS_SECRET` through a permission-restricted, non-persistent multi-read
FIFO. A first single-read FIFO invocation was stopped after it did not complete; the immediate
name-only check proved that invocation made no change. The compatible bounded invocation then
completed successfully. The FIFO and its temporary directory were removed.

Sanitized metadata confirmed the previous slot configured at `2026-08-18T23:03:39.188Z`; the
current `CHECKOUT_RECONCILIATION_SECRET` retained its original `2026-08-14T06:34:25.546Z`
timestamp. No value was printed, persisted or exposed. The next step is to create exactly one
BASE-only target through visible `taa_browser_b` UI.

At `2026-08-18T23:05:22Z`, `taa_browser_b` visibly showed `TAA-CANARY-BASE × 1`, accepted DPD Next
Day shipping and mounted the Stripe test-mode Payment Element. No payment details were entered and
the basket was not cleared or abandoned. An isolated operator shell captured the exact canonical
attempt UUID directly from a linked read-only query into process environment; only abbreviated
identities were emitted: attempt `039572f3…`, intent `8db487c8…`, reservation `7e299901…` and
test Session `cs_test_a1Jy…`.

The authoritative database returned exactly one matching materialized operation: attempt active,
intent pending/active, reservation held, recorded Stripe Session present, no payment-intent pointer,
zero open incidents and zero open jobs. The mounted test Payment Element and fresh server-side
Session record establish the bounded target immediately before the final pre-request re-read.

Immediately before invocation, a fresh read still showed exactly one active attempt, one held
canary reservation, the same active/pending target and no incident/job. Inventory was A 5/0/5,
BASE 1/1/0 and C 5/0/5. Two local shell-wrapper commands failed before Node could call `fetch`
(history expansion, then template-literal expansion); both were parse-time failures and sent no
HTTP request. The target was re-read unchanged after them.

The single actual authenticated targeted request then used Node module mode, the candidate and
exact canonical target from process environment, `POST ?mode=targeted`, `application/json` and
`JSON.stringify({ checkout_attempt_id: targetAttemptId })`. It returned exactly **HTTP 200** with
allowlisted result **`recovered`**.

Independent database reads established attempt `039572f3…` expired/completed with both intent
pointers cleared; intent `8db487c8…` expired/failed with `expired_unpaid`; and the sole reservation
`7e299901…` released with `stripe_session_expired_unpaid`. There is one reservation row and one
BASE item row, no order, no open target incident/job and one resolved target reconciliation job.
Under the proven deployed contract, `recovered` is returned only after Stripe is authoritatively
re-read as expired/unpaid and the terminal database transition completes.

The first post-recovery census restored A 5/0/5, BASE 1/0/1 and C 5/0/5, with zero active attempts,
active canary intents, held canary reservations, open incidents, open jobs and active admissions.
Visible `taa_browser_b` cleanup then returned `abandon-checkout-attempt` HTTP 200, showed `Canary
basket is empty.`, and produced zero console errors or warnings. A fresh post-cleanup census at
`2026-08-18T23:13:44Z` remained at the exact zero-active baseline. The candidate is now eligible
for promotion; promotion had not yet occurred at this checkpoint.

After every smoke gate passed, the same inherited candidate was promoted through a fresh
permission-restricted non-persistent FIFO to `CHECKOUT_RECONCILIATION_SECRET`. Sanitized metadata
showed the current variable updated at `2026-08-18T23:14:26.647Z`. The FIFO and temporary directory
were removed, then `CHECKOUT_RECONCILIATION_PREVIOUS_SECRET` was immediately unset. Final name-only
metadata contains `CHECKOUT_RECONCILIATION_SECRET` and contains neither
`CHECKOUT_RECONCILIATION_PREVIOUS_SECRET` nor `CHECKOUT_RESERVATIONS_ENABLED`.

Supabase configuration revisions advanced the reconciler's displayed function version from v9 to
v12 across previous-secret staging, current-secret promotion and previous-secret removal. This was
configuration-only version churn: the function remains ACTIVE with `verify_jwt=false`, its source
`updated_at` value is unchanged, and its deployed bundle hash remains
`d1292a594b9e923d3e792c3faee31db517ada0fb2757e30d1376facfb77b91da`, exactly the hash proven for
the approved v9 bundle. No code was deployed.

The final read remained A 5/0/5, BASE 1/0/1 and C 5/0/5. Active reservation-v1 attempts, active
canary intents, held canary reservations, open incidents, open jobs and active admissions are all
zero. The isolated operator shell cleared its candidate, exact target and captured result variables
before exit. No credential value was printed, hashed, compared, written to a regular file or
recorded here.

**AUTHENTICATED TARGETED OPERATOR RECOVERY: PRODUCTION-PROVEN.** The candidate is now the current
credential and the bounded previous slot is absent. Final 7C1 remains PASS / CLOSED. Global
reservations remain off. No source was changed, no code was deployed, and no commit, push or 7C1
rerun occurred. The exact next action is human review of this closing evidence and selection of the
next remaining production-readiness blocker; do not repeat this final smoke or enable global
reservations as part of this record.

## 2026-08-18 — Deployed Reconciler v9 Proven Equivalent to Approved Targeted Recovery

**Record type:** CONTEMPORANEOUS
**Evidence grade:** STRONG read-only deployed-source, committed-source and focused test evidence
**Status:** SAFE TO RESUME AUTHENTICATED TARGETED-RECOVERY SMOKE

At `2026-08-18T22:53:34Z`, a minimum read-only provenance check resolved the version-drift
blocker recorded below. Current Supabase function metadata independently confirmed
`reconcile-checkout-reservations` is ACTIVE v9 with `verify_jwt=false`. The currently deployed
source was downloaded through the Supabase API into an isolated temporary directory; the
approved source at commit `3bca56d258f233720d367f187b28830a9f7edfac` was materialized beside
it with `git archive`. Neither copy touched the repository working tree.

All 14 TypeScript files in the downloaded function dependency closure matched the approved commit
byte-for-byte: the reconciler entry point and 13 shared modules (`checkout-access`,
`checkout-catalog`, `checkout-discounts`, `checkout-inventory`, `checkout-lifecycle`,
`checkout-operator-recovery`, `checkout-orchestration`, `checkout-paid-path`,
`checkout-paid-session`, `checkout-protocol`, `checkout-reconciliation`, `http-security` and
`internal-auth`). No source or semantic difference was found.

The critical deployed `checkout-orchestration.ts` SHA-256 was
`8dcd2ceedccbaac351e4865fe419d89fb5a42a2b2e4ae133098743c80ceb2f46`, exactly matching the
committed file. The known dirty diagnostic working-tree copy instead hashed to
`bf5eddafac15c1a00fde981576929a8e731cd7161954920338892988c628a6d1`. Deployed v9 therefore uses
the approved committed orchestration source and not the current uncommitted diagnostic version.

Because the entire deployed dependency closure is byte-identical, the approved recovery contracts
are unchanged in v9: bearer authentication accepts either the configured current or optional
previous reconciliation secret; authenticated `POST ?mode=targeted` accepts a JSON object with
exactly the single key `checkout_attempt_id`; targeted processing forces expiration of an open
unpaid Stripe Session before authoritative terminalization; coherent paid state is preserved;
payment-pending/transient states return retry; and unsupported or incoherent states fail closed to
manual review rather than terminalizing or releasing inventory.

Focused tests were executed from the isolated approved-commit tree with an isolated Deno cache:
`checkout-operator-recovery.test.ts` 10/10 and `internal-auth.test.ts` 3/3, total 13/13 passed.
These are contemporary source/test evidence, not a production recovery invocation.

The temporary deployed source, approved archive and isolated test cache were removed after the
comparison. No reconciliation was invoked, no secret was read or staged, no checkout was created,
and no production data, function, configuration or repository source was modified. Targeted
operator recovery remains NOT PRODUCTION-PROVEN until the bounded smoke itself passes.

The smoke precondition is revised from a literal v7 requirement to: **the deployed function must
be ACTIVE and source/contract-equivalent to the approved targeted-recovery implementation.** The
exact next action is to resume the already documented second and final authenticated targeted
recovery smoke from its candidate-presence and live zero-active preflight gates; do not infer that
this provenance result itself proves the recovery lifecycle.

## 2026-08-18 — Final Targeted-Recovery Smoke Blocked by Reconciler Version Drift

**Record type:** CONTEMPORANEOUS
**Evidence grade:** STRONG process-presence and read-only production metadata/database evidence
**Status:** BLOCKED BEFORE CANDIDATE STAGING OR CHECKOUT MUTATION

At `2026-08-18T22:43:54Z`, the authorised second targeted-recovery smoke continued from the locally
corrected Node `fetch` operator construction. A presence-only process check confirmed
`CHECKOUT_RECONCILIATION_CANDIDATE` was present and non-empty. Its value was not printed, echoed,
hashed, compared, serialized or otherwise exposed.

Git preflight remained on `main` at `3bca56d258f233720d367f187b28830a9f7edfac`, matching
`origin/main`, with the known dirty diagnostic, project-memory and local-tooling state preserved.
The committed targeted parser and handler contract remained the inspected implementation.

Read-only production preflight established:

- `CHECKOUT_RECONCILIATION_SECRET`: configured, metadata timestamp unchanged at
  `2026-08-14T06:34:25.546Z`;
- `CHECKOUT_RECONCILIATION_PREVIOUS_SECRET`: absent;
- `reconcile-checkout-reservations`: ACTIVE with `verify_jwt=false`, but reported version **9**;
- TAA-CANARY-A: physical 5, reserved 0, ATS 5;
- TAA-CANARY-BASE: physical 1, reserved 0, ATS 1;
- TAA-CANARY-C: physical 5, reserved 0, ATS 5;
- active reservation-v1 attempts: 0;
- active reservation-v1 intents: 0;
- held/payment-pending reservations: 0;
- open lifecycle incidents: 0;
- open reconciliation jobs: 0;
- active reservation-v1 admissions: 0.

The smoke procedure explicitly required the reconciler to be ACTIVE v7 and required a stop before
candidate staging on any preflight mismatch. Production metadata instead reported ACTIVE v9. No
assumption was made about why the version changed or whether v9 is source-equivalent to the
previously audited v7. The session stopped at that boundary.

No candidate was staged, no secret was changed, no project function was invoked, no browser was
opened, no checkout attempt was created, no Stripe Session was created or inspected, no production
data was changed, and the corrected targeted request was not sent. The candidate remains
unpromoted; the current secret remains configured; the previous-secret slot remains absent. The
targeted recovery lifecycle therefore remains **NOT PRODUCTION-PROVEN**.

The exact next action is a read-only provenance audit of deployed reconciler v9: establish why the
reported version differs from the required v7, recover its deployment/secret-rotation provenance,
and compare its deployed source and configuration with committed `3bca56d` without retrieving
secret values. Do not resume the smoke unless that evidence supports an explicitly revised version
precondition. Final 7C1 remains PASS / CLOSED and global reservations remain off.

## 2026-08-18 — Targeted Operator Request Construction Corrected Locally

**Record type:** CONTEMPORANEOUS
**Evidence grade:** STRONG source, byte-level local runtime and test evidence
**Status:** REQUEST CONSTRUCTION FIXED LOCALLY; PRODUCTION RECOVERY STILL UNPROVEN

### Scope and Production Boundary

At `2026-08-18T22:35:52Z`, an inspection and local-validation task diagnosed the operator-side
HTTP 400 from the preceding authenticated targeted-recovery smoke. This task did not access the
real candidate value, create a checkout attempt, list or change Supabase secrets, invoke any
production endpoint, query or mutate production data, use a browser, deploy, commit, push, rerun
7C1 or change global reservation activation. Dummy credentials and UUIDs were used exclusively.

The last verified production checkpoint therefore remains authoritative: the candidate is
unpromoted, `CHECKOUT_RECONCILIATION_PREVIOUS_SECRET` is absent, the original current secret is
unchanged, synthetic inventory is A 5/0/5, BASE 1/0/1 and C 5/0/5, active attempts/intents and held
reservations are zero, open incidents/jobs are zero, final 7C1 is PASS / CLOSED and global
reservations are off. This task created no new production evidence for those facts.

### Deployed-Equivalent Parser Contract

Source tracing from `reconcile-checkout-reservations/index.ts` through
`parseCheckoutOperatorRecoveryBody` established that targeted mode requires:

- HTTP `POST`;
- query parameter `mode=targeted` as the value returned by `URLSearchParams.get('mode')`;
- a non-empty UTF-8 body of at most 1024 bytes;
- `Content-Type: application/json`, optionally with `charset=utf-8`;
- a JSON object containing exactly one key, spelled `checkout_attempt_id`;
- a UUID that normalizes through string conversion, trimming, a 36-character limit and lower-case
  conversion, then matches the repository UUID pattern (versions 1-8 and RFC variant 8/9/a/b).

An empty body with no mode remains the legacy batch request. An empty body with any mode, a
non-empty body without exact targeted mode, malformed JSON, a non-object, missing/wrong/extra
fields or an invalid normalized UUID throws a non-`HttpSecurityError`; the entry point maps all of
those failures to HTTP 400 `{ "error": "Invalid reconciliation request." }`. Method, bearer,
content-type, body-size, content-length and invalid UTF-8 failures use their separate handler-level
status/message paths.

### Proven Root Cause

The exact failed session command was recovered from the local Codex rollout record. It generated a
curl config stream containing an over-escaped quoted `data` value. A localhost-only echo server
replayed that exact construction with a dummy bearer and valid dummy UUID. The method, path/query,
bearer presence and content type were correct, but curl transmitted only these two body bytes:

```text
UTF-8: {\
hex:   7b5c
```

The first over-escaped inner quote terminated curl's quoted config value after `{\`. The UUID was
not transmitted and no additional newline was present in the body. The real parser independently
classified this exact two-byte body as malformed JSON with
`Reconciliation request body is invalid.`, which the entry point maps to the observed generic HTTP 400. This proves an operator curl-config quoting defect; no handler defect was found.

### Locally Validated Replacement

The replacement uses the available Node runtime and built-in `fetch`. It reads
`CHECKOUT_RECONCILIATION_CANDIDATE` and `CHECKOUT_RECONCILIATION_TARGET_ATTEMPT_ID` only from
`process.env`, validates both are present and validates the attempt ID against the exact canonical
UUID pattern, constructs the payload with
`JSON.stringify({ checkout_attempt_id: targetAttemptId })`, and sends POST with exact targeted
query, JSON content type and bearer authentication. It reports only HTTP status and a sanitized
response classification. It never prints the candidate or Authorization header, places the
candidate in argv, writes it to disk or embeds it in shell history.

A localhost byte-level echo with dummy values observed exactly:

```json
{ "checkout_attempt_id": "11000000-0000-4000-8000-000000000001" }
```

The observed request was POST to the targeted path/query, content type was `application/json`, the
Authorization header was present but redacted, JSON parsing succeeded and no extra body bytes were
present. Direct calls into the real parser then accepted the exact valid body and rejected malformed
UUID, extra property, missing property, wrong key, null, empty-string UUID and malformed JSON cases.
The existing parser also lower-cases and trims UUID input and, because normalization limits to the
first 36 characters before validation, accepts a valid UUID prefix followed by suffix text. The new
operator prevalidation is deliberately stricter and requires an exact canonical 36-character UUID.

Existing relevant Deno tests executed successfully:

- checkout operator recovery: 10/10;
- internal authentication/rotation: 3/3;
- HTTP security: 17/17;
- combined result: 30 passed, 0 failed.

### Exact Next Action

Do not invoke production from this record. For the next authorised smoke, securely load the same
saved candidate into an isolated history-disabled shell, stage it only as
`CHECKOUT_RECONCILIATION_PREVIOUS_SECRET`, leave the current secret untouched, reverify the exact
zero-active baseline, create one BASE-only checkout through `taa_browser_b`, and place the captured
attempt UUID in `CHECKOUT_RECONCILIATION_TARGET_ATTEMPT_ID`. Invoke targeted mode with the locally
validated Node `fetch` construction. Stop on anything other than HTTP 200 `recovered`. Verify
Stripe expired/unpaid state, terminal attempt/intent, exactly-once reservation release, final
zero-active inventory and normal visible fixture Clear. Promote the same candidate to current and
remove the previous slot only after the entire smoke passes.

## 2026-08-18 — Authenticated Targeted-Recovery Smoke Rejected Before Recovery; Baseline Restored

**Record type:** CONTEMPORANEOUS
**Evidence grade:** STRONG production/runtime evidence
**Status:** FAIL — AUTHENTICATED INGRESS PROVEN; TARGETED RECOVERY NOT EXERCISED

At `2026-08-18T22:23:56Z`, a fresh authorised process reconstructed the documented checkpoint and
confirmed `CHECKOUT_RECONCILIATION_CANDIDATE` as present and non-empty by presence only. The value
was not printed, compared, hashed, persisted, placed in command arguments or disclosed to browser
tooling. Git remained on `main` at `3bca56d`; the known dirty working tree was preserved.

Read-only production preflight reconfirmed:

- `CHECKOUT_RECONCILIATION_SECRET` configured and
  `CHECKOUT_RECONCILIATION_PREVIOUS_SECRET` absent;
- `reconcile-checkout-reservations` ACTIVE v7 with `verify_jwt=false`;
- migration `20260824120000_targeted_checkout_attempt_reconciliation.sql` live;
- inventory A 5/0/5, BASE 1/0/1 and C 5/0/5;
- active reservation-v1 attempts, active intents, held reservations and open incidents all zero.

The candidate was staged through a permission-restricted non-persistent FIFO as
`CHECKOUT_RECONCILIATION_PREVIOUS_SECRET`, leaving the existing current secret unchanged. A
name-and-timestamp-only metadata read confirmed both names were configured. Earlier attempts to
feed the CLI through a one-read file descriptor and standard input failed before secret mutation;
the secret topology remained unchanged after each failed tooling attempt.

Using only `taa_browser_b`, the visible checkout-test fixture loaded one BASE item. Synthetic
shipping details and DPD Next Day were entered through the visible UI. `get-shipping-options` and
`create-checkout-session` returned HTTP 200, the Stripe Payment Element mounted and the browser
console contained zero errors or warnings. Authoritative database state then showed exactly one
active reservation-v1 operation: attempt `45ac1533…`, active intent `7a8c0045…`, held reservation
`d0fb350f…`, item BASE x 1, BASE inventory 1/1/0, zero open incidents and zero open reconciliation
jobs. The recorded Session classified as Stripe test mode.

The candidate authenticated a single POST to
`reconcile-checkout-reservations?mode=targeted`, but the request returned HTTP 400 with the safe
error `Invalid reconciliation request.` Authentication is checked before request parsing and an
invalid bearer would have returned HTTP 401, so this proves the staged candidate was accepted by
authenticated production ingress. It does not prove targeted claim, Stripe retrieval, Session
expiry or the recovery lifecycle, because the request was rejected during bounded request parsing.
The request was not retried and the candidate was not promoted.

Per the bounded-rotation failure path, only `CHECKOUT_RECONCILIATION_PREVIOUS_SECRET` was removed.
A final name-only metadata read confirmed that the original `CHECKOUT_RECONCILIATION_SECRET`
remained configured and the previous slot was absent. The visible `Clear canary basket` control
then returned `abandon-checkout-attempt` HTTP 200. Final authoritative state for attempt
`45ac1533…` is expired/completed with both pointers clear; intent `7a8c0045…` is expired/failed with
`expired_unpaid`; reservation `d0fb350f…` is released once with
`stripe_session_expired_unpaid`. Final inventory is A 5/0/5, BASE 1/0/1 and C 5/0/5. Active
attempts, active intents, held reservations, open incidents and open reconciliation jobs are all
zero. The fixture is visibly empty and the browser console remains clean.

This smoke is **FAIL**, not PASS. It establishes authenticated candidate ingress and safe rollback,
but the targeted recovery path remains unverified in authenticated production. The exact next
action is to correct and independently validate the non-persistent operator request construction
so that the body is exactly one JSON `checkout_attempt_id` field, then repeat a new BASE-only smoke
from the verified zero-active baseline with the same add-before-remove discipline. Do not promote
the candidate or rerun 7C1 before that smoke returns HTTP 200 `recovered` and restores all final
invariants.

## 2026-08-18 — Fresh Targeted-Recovery Smoke Start Blocked Before Mutation

**Record type:** CONTEMPORANEOUS
**Evidence grade:** STRONG local process-state verification
**Status:** BLOCKED

At `2026-08-18T22:09:22Z`, a fresh session reconstructed project state from `CURRENT-STATE.md`,
this verification log, the production blockers document, Git status and Git history. A
presence-only check found `CHECKOUT_RECONCILIATION_CANDIDATE` absent or empty in the Codex
command-execution environment. No value was printed, compared, hashed or persisted.

The required credential precondition therefore failed. The session stopped before staging
`CHECKOUT_RECONCILIATION_PREVIOUS_SECRET`, querying or mutating production, opening
`taa_browser_b`, creating a checkout attempt or invoking reconciliation. No source, secret,
Supabase, Stripe, Webflow, browser, Git history or checkout state changed. Final 7C1 remains PASS /
CLOSED and global reservations remain off.

The exact next action is to start a new Codex CLI process directly from the hidden-input shell that
exports the candidate, then repeat the presence-only check. Only after it passes may the session
independently verify the zero-active synthetic baseline and production secret-name topology before
any mutation.

## 2026-08-18 — Reconciliation Credential Topology and Rotation Audit

**Record type:** CONTEMPORANEOUS
**Evidence grade:** STRONG repository/source and production-metadata inspection
**Status:** SAFE TO ROTATE

This was an inspection-only audit. No checkout attempt was created, no reconciliation endpoint was
invoked, no secret was changed, and no source, deployment, Webflow, Stripe or checkout state was
modified. No credential value, digest, bearer header, browser storage, shell history, Keychain
secret or log Authorization header was inspected or recorded.

Git preflight confirmed branch `main`, local HEAD and `origin/main` at
`3bca56d258f233720d367f187b28830a9f7edfac`, ahead/behind `0/0`, and nothing staged. The known
modified diagnostic files and untracked project-memory/local-tooling paths remained present. A
read-only `git ls-remote` independently confirmed the live `origin/main` ref at the same SHA.

### Deployed Authentication Contract

A temporary read-only download of deployed `reconcile-checkout-reservations` v7 showed that its
entry-point SHA-256 matched the committed source exactly:

`db70f33561b37e87c66d5f2223bb1ff57d1cd70458dbed95d44e54fe63427d30`

The deployed function is ACTIVE, version 7, with `verify_jwt=false`. Its handler requires:

- current credential: `CHECKOUT_RECONCILIATION_SECRET`;
- optional bounded-rotation credential: `CHECKOUT_RECONCILIATION_PREVIOUS_SECRET`.

Both names are accepted through the function's constant-time bearer check. The Edge Function, not
the caller, supplies its server-held service-role credential for database access.

Filtered Supabase production metadata exposed variable names and timestamps only:

- `CHECKOUT_RECONCILIATION_SECRET`: configured; updated
  `2026-08-14T06:34:25.546Z`;
- `CHECKOUT_RECONCILIATION_PREVIOUS_SECRET`: not configured.

Presence-only local checks found neither variable in the current operator process.

### Caller and Scheduling Topology

The audit found these legitimate modes:

1. exact `?mode=targeted` recovery by an authorised manual operator;
2. empty-body batch reconciliation for deliberate manual verification and a future external
   scheduler after activation readiness is complete.

No current automated production caller was identified. Repository configuration explicitly creates
no reconciliation schedule. There is no GitHub Actions configuration, deployment/operator script,
server secret template, documented n8n caller, Webflow/browser caller or source invocation. A
read-only production database metadata query confirmed that `pg_cron` is not installed and the
`cron.job` catalog does not exist. No external scheduler outside those inspected surfaces is
evidenced; absence from the repository alone is not treated as proof that no undisclosed external
system could ever exist.

No established external password/secret-manager location for the existing plaintext credential is
documented. The audit therefore does not classify it as recoverable, but also does not claim it is
lost. Supabase secret listing establishes configuration metadata, not plaintext recovery.

### Rotation Decision and Next Action

**Classification: SAFE TO ROTATE.** No known live caller would be interrupted, the accepted
variable names and caller locations are known, dual-secret authentication is implemented, the
production lifecycle baseline is recorded as empty, final 7C1 remains PASS / CLOSED and global
reservations remain off.

Use a bounded add-before-remove rotation:

1. generate a new high-entropy value directly into the authoritative external operator store;
2. configure that candidate as `CHECKOUT_RECONCILIATION_PREVIOUS_SECRET`, leaving the existing
   current credential unchanged;
3. expose the candidate only to one hidden, non-persistent operator process;
4. rerun the zero-active production baseline;
5. create one fresh BASE-only synthetic checkout through `taa_browser_b` and execute the exact
   authenticated targeted recovery smoke;
6. verify Stripe-aware terminalisation, BASE release and the final zero-active baseline, then clear
   the browser fixture normally;
7. after PASS, set `CHECKOUT_RECONCILIATION_SECRET` to the same candidate and immediately remove
   `CHECKOUT_RECONCILIATION_PREVIOUS_SECRET`;
8. retain durable non-secret evidence and provide the promoted current value to any scheduler only
   if reconciliation is deliberately scheduled later.

If the smoke fails before promotion, remove the candidate previous value and leave the current
credential untouched. The production Edge secret configuration, authoritative external operator
store and isolated smoke process are the only current components requiring the new credential. No
frontend, Webflow, Stripe, database schema, Supabase CLI authentication or service-role update is
required.

The authenticated targeted production smoke remains outstanding. No test suite was executed during
this historical/operational inspection; production metadata reads and source comparison are new
contemporaneous evidence only.

## 2026-08-18 — Checkout Provenance Commits Pushed

**Record type:** CONTEMPORANEOUS
**Evidence grade:** STRONG Git remote verification
**Status:** PASS

After a fetch-only preflight confirmed `origin/main` remained
`bec2929c0c5b3b48436c3a55fb33acbe61933ce8`, local `main` was exactly two commits ahead with no
divergence and nothing staged. The approved non-force command `git push origin main` pushed:

- `2fdf3fb9512bda5e88697d4326bbb6e1f5cc02a9` —
  `fix: make checkout-test cleanup authoritative`;
- `3bca56d258f233720d367f187b28830a9f7edfac` —
  `feat: add exact checkout attempt operator recovery`.

A second fetch confirmed both local `main` and `origin/main` at
`3bca56d258f233720d367f187b28830a9f7edfac`, with ahead/behind `0/0`. The existing modified
diagnostic files and untracked project-memory/tooling paths remained outside the pushed commits,
and nothing became staged.

This was a Git push only. No deployment, Supabase, Webflow, Stripe, canary, reconciliation or global
reservation state was changed. Final 7C1 remains PASS / CLOSED, global reservations remain off,
and the authenticated targeted-operator production smoke remains outstanding. The exact next
action is to run that documented smoke only when the existing credential can be supplied securely
to the authorised operator process; diagnostic work remains deliberately uncommitted.

## 2026-08-18 — Deployed Checkout Provenance Commits

**Record type:** CONTEMPORANEOUS
**Evidence grade:** STRONG local Git and current working-tree verification
**Status:** PASS

### Objective and Scope

Represent the two currently deployed but uncommitted checkout bodies of work in two precise local
commits without staging unrelated diagnostics, project memory or local tooling. No push,
deployment, production mutation, canary, targeted reconciliation invocation or global reservation
activation was permitted.

Starting branch and revision:

- branch: `main`;
- HEAD: `bec2929c0c5b3b48436c3a55fb33acbe61933ce8`;
- staged files: none;
- starting `git diff --check`: PASS.

### Commit 1 — Checkout-Test Authoritative Cleanup

Commit:

`2fdf3fb9512bda5e88697d4326bbb6e1f5cc02a9 fix: make checkout-test cleanup authoritative`

Exact files:

- `src/app/bootstrap.js`;
- `src/modules/checkout/checkout.js`;
- `src/modules/checkout/checkout-inventory-controller.test.js`;
- `src/modules/checkout/checkout-canary-fixture.js`;
- `src/modules/checkout/checkout-canary-fixture.test.js`;
- `src/modules/checkout/checkout-reset.js`;
- `src/modules/checkout/checkout-reset.test.js`.

Current verification before staging:

- Node `v22.23.1`;
- complete checkout Node suite: PASS — 70/70;
- `npm run lint`: PASS;
- `npm run build`: PASS;
- Prettier on all seven files: PASS;
- `git diff --check`: PASS;
- cached file set and full cached diff: exact seven-file allowlist only.

This commit now represents the source used by checkout-test release
`20260818T150958Z-bec2929c0c5b`. It does not change the previously recorded final 7C1 result, which
remains PASS / CLOSED.

### Commit 2 — Exact Checkout Attempt Operator Recovery

Commit:

`3bca56d258f233720d367f187b28830a9f7edfac feat: add exact checkout attempt operator recovery`

The original local SHA `59d0bf87223a47258b38a2b9422243d30d5ad551` was amended before
push, preserving its title and seven-file set. The only amendment was a five-line status
clarification in the already-included `docs/checkout-production-blockers.md`: unauthenticated
production ingress was verified to reject access with HTTP 401; the authenticated targeted smoke
using `CHECKOUT_RECONCILIATION_SECRET` has not yet run; the path is therefore not yet
authenticated-production-proven; and that handler-level smoke remains required before global
reservations are enabled. No runtime or test file changed during the amendment.

Exact files:

- `docs/checkout-production-blockers.md`;
- `supabase/functions/reconcile-checkout-reservations/index.ts`;
- `supabase/functions/_shared/checkout-operator-recovery.ts`;
- `supabase/functions/_shared/checkout-operator-recovery.test.ts`;
- `supabase/migrations/20260824120000_targeted_checkout_attempt_reconciliation.sql`;
- `supabase/tests/database/checkout-targeted-reconciliation.test.sql`;
- `supabase/tests/concurrency/checkout-targeted-reconciliation-concurrency.sh`.

Current verification before staging:

- full local migration reset/replay through `20260824120000`: PASS;
- focused targeted-reconciliation pgTAP: PASS — 72/72;
- full pgTAP: PASS — 427/427 across 13 files;
- targeted two-session concurrency: PASS;
- Supabase database lint: PASS — no schema errors;
- relevant Deno recovery tests: PASS — 37/37;
- working-tree reconciler typecheck: PASS;
- isolated clean-candidate operator tests: PASS — 10/10;
- isolated clean-candidate reconciler typecheck: PASS;
- `npm run lint`: PASS;
- `npm run build`: PASS;
- Prettier on supported recovery files: PASS;
- `git diff --check`: PASS;
- cached file set and full cached diff: exact seven-file allowlist only.

Expected local warnings about unavailable test Vault/Klaviyo values occurred during pgTAP and did
not fail the suite. Initial sandboxed Supabase/Docker and isolated-candidate tool invocations needed
permission/cache adjustments; the required commands were rerun successfully without source
changes. A verification-generated root `deno.lock` was removed before staging.

### Production Provenance Boundary

The deployed reconciler v7 was built with the committed pre-diagnostics version of
`supabase/functions/_shared/checkout-orchestration.ts`. Commit `3bca56d` preserves that boundary:

- `3bca56d` orchestration SHA-256: `8dcd2ceedccbaac351e4865fe419d89fb5a42a2b2e4ae133098743c80ceb2f46`;
- `bec2929` orchestration SHA-256: the same value;
- still-dirty diagnostic orchestration SHA-256:
  `bf5eddafac15c1a00fde981576929a8e731cd7161954920338892988c628a6d1`.

The diagnostic orchestration and abandonment files were not staged. The authenticated targeted
operator production smoke remains outstanding and is not claimed as passed.

### Result and Current State

Local history now begins:

```text
3bca56d feat: add exact checkout attempt operator recovery
2fdf3fb fix: make checkout-test cleanup authoritative
bec2929 feat: handle checkout inventory conflicts
```

Deployed checkout-test source and deployed reconciler v7/migration source are now represented in
Git. Global reservations remain off. No push or deployment was performed. A fetch-only remote check
confirmed `origin/main` remains `bec2929c0c5b3b48436c3a55fb33acbe61933ce8`; local `main` is ahead
exactly two commits with no divergence.

Remaining modified files:

```text
 M AGENTS.md
 M supabase/functions/_shared/checkout-orchestration.ts
 M supabase/functions/abandon-checkout-attempt/index.ts
```

Remaining untracked paths:

```text
?? .codex/
?? .opencode/
?? .playwright-mcp/
?? Codex/CURRENT-STATE.md
?? Codex/VERIFICATION-LOG.md
?? opencode.json
?? supabase/functions/_shared/checkout-orchestration.test.ts
```

The two project-memory files contain this record and remain deliberately uncommitted. The exact
next action is final push review, followed by a push only after approval. Diagnostic work and
project-memory/tooling work remain separate future commit decisions. The authenticated targeted
production smoke remains outstanding and is not claimed as passed.

## 2026-08-18 — Final Slice 7C1 Reservation Contention Canary

**Record type:** CONTEMPORANEOUS
**Evidence grade:** STRONG production-canary evidence
**Status:** PASS

### Objective and Fixed Scope

Run the final production `/checkout-test` reservation-v1 contention canary using only the fixed
browser assignments `taa_browser_b` = HOLDER and `taa_browser_a` = CONTENDER. The run must exercise
the visible fixture and checkout UI, preserve BASE oversell invariants, exercise Continue Without,
and restore the exact zero-active synthetic baseline through the visible authoritative Clear path.

No application source, deployment, commit, push, targeted/global reconciliation, raw database
repair, browser storage, cookie, capability, credential, Authorization header or sensitive request
material is in scope. Only this verification record and `Codex/CURRENT-STATE.md` may change.

### Starting Repository and Deployment Checkpoint

Observed from `2026-08-18T20:21Z` through `2026-08-18T20:25Z`:

- branch: `main`;
- HEAD: `bec2929c0c5b3b48436c3a55fb33acbe61933ce8`;
- working tree: dirty before this run with the existing handbook, checkout fixture/reset,
  abandonment diagnostics, targeted recovery, project-memory and local-tooling work;
- unrelated working-tree changes are excluded and must remain untouched;
- `/checkout-test` loaded immutable release `20260818T150958Z-bec2929c0c5b`; all observed release
  and checkout fixture chunks returned HTTP 200;
- normal-route release and Stripe test-mode preconditions remain to be independently checked before
  checkout materialisation;
- both named browser sessions remained open on `/checkout-test` with all three fixture controls;
- `taa_browser_a` visibly showed `Canary basket is empty.`;
- `taa_browser_b` visibly showed stale local `TAA-CANARY-BASE x 1` while authoritative inventory
  and lifecycle state were clean. The required next preflight action is the visible Clear control,
  followed by a fresh authoritative database read before any checkout operation.

Starting authoritative production database state:

- `TAA-CANARY-A`: physical 5, reserved 0, ATS 5;
- `TAA-CANARY-BASE`: physical 1, reserved 0, ATS 1;
- `TAA-CANARY-C`: physical 5, reserved 0, ATS 5;
- active canary attempts: 0;
- active canary-linked intents: 0;
- held/payment-pending canary reservations: 0;
- open canary lifecycle incidents: 0;
- open canary reconciliation jobs: 0;
- all active reservation-v1 attempts: 0;
- all unexpired active checkout admissions: 0.

Console checkpoint: zero errors in both named browsers. No production checkout mutation has yet
occurred in this run.

### Preflight Completion

Completed at `2026-08-18T20:28Z` before checkout materialisation:

- the stale HOLDER-local BASE line was removed through the visible `Clear canary basket` control;
- both named browsers then visibly showed `Canary basket is empty.`;
- the fresh authoritative database read remained A 5/0/5, BASE 1/0/1 and C 5/0/5;
- active canary attempts, active canary-linked intents, held canary reservations, open canary
  incidents, open canary reconciliation jobs, all active reservation-v1 attempts and all unexpired
  active admissions remained zero;
- `/checkout-test` release `20260818T150958Z-bec2929c0c5b` and its observed checkout/fixture chunks
  returned HTTP 200 in both named browsers;
- a normal homepage route loaded `20260816T054231Z-bec2929c0c5b/taa-platform.js` with HTTP 200, then
  HOLDER returned to `/checkout-test` without changing browser assignment;
- the published checkout chunk contains a Stripe test publishable-key prefix and no live-key prefix;
- all 19 recorded synthetic canary Checkout Sessions with a stored Session ID classify as
  `cs_test_`; zero recorded canary Sessions classify as live or unknown. This establishes the
  required test-mode precondition without exposing any key or Session ID.

The homepage produced an existing Webflow/jQuery `Cannot read properties of undefined (reading
'id')` warning/error during the normal-route release check. `/checkout-test` had zero console errors
in both named sessions at the preflight checkpoint. The Webflow homepage diagnostic is recorded but
is not attributed to checkout and did not alter the clean canary baseline.

**Preflight result:** PASS. HOLDER checkout materialisation may begin.

### HOLDER Reservation Checkpoint

Completed at `2026-08-18T20:30Z` using only `taa_browser_b`:

- visible fixture basket: `TAA-CANARY-BASE x 1`;
- visible order summary: `TAA Reservation Canary`, quantity 1, subtotal GBP 1.00;
- synthetic shipping details were entered through normal visible fields and `DPD Next Day` was
  selected;
- Stripe Payment Element became visible; no payment details were entered and payment was not
  attempted;
- `get-shipping-options`: HTTP 200;
- `create-checkout-session`: one browser-reported `net::ERR_FAILED` with a CORS diagnostic, followed
  by HTTP 200. The successful response materialised exactly one checkout operation; no HTTP 5xx was
  observed;
- HOLDER attempt `9f6c9a55…`: `active`, reservation-v1;
- HOLDER intent `c992fd69…`: `pending` / orchestration `active`;
- HOLDER reservation `ab60bc60…`: `held`, item `TAA-CANARY-BASE x 1`;
- stored Stripe Session identifier classifies as test mode; the visible mounted Payment Element and
  pending active lifecycle are consistent with an open/unpaid checkout. No card data was entered;
- open HOLDER incidents: 0; open HOLDER reconciliation jobs: 0.

Authoritative inventory:

- A: physical 5, reserved 0, ATS 5;
- BASE: physical 1, reserved 1, ATS 0;
- C: physical 5, reserved 0, ATS 5.

**HOLDER checkpoint:** PASS. BASE is reserved exactly once and ATS is not negative. HOLDER remains
open and untouched while CONTENDER begins.

### CONTENDER Inventory-Conflict Checkpoint

Completed at `2026-08-18T20:32Z` using only `taa_browser_a`, while HOLDER remained untouched:

- visible fixture basket: A x 1, BASE x 1, C x 1;
- visible order summary contained all three expected synthetic products;
- synthetic shipping details were entered through normal visible fields and `DPD Next Day` was
  selected;
- `get-shipping-options`: HTTP 200;
- `create-checkout-session`: typed HTTP 409;
- the browser console recorded the expected failed-resource 409 diagnostic and no 5xx;
- visible conflict panel: `Some items are unavailable`, `One item is blocking checkout`,
  `TAA Reservation Canary`, `Temporarily reserved`, and `Continue Without This Item`;
- failed CONTENDER attempt `45bf9da2…`: `active` but empty/unmaterialised, with no live admission,
  no active/in-flight intent, zero intents and no reservation;
- HOLDER `9f6c9a55…` remained active with the only held BASE reservation `ab60bc60…`;
- held BASE quantity: 1 across exactly one reservation;
- no open incident exists for either operation.

Authoritative inventory remained:

- A: physical 5, reserved 0, ATS 5;
- BASE: physical 1, reserved 1, ATS 0;
- C: physical 5, reserved 0, ATS 5.

**Conflict checkpoint:** PASS. CONTENDER acquired no stock, BASE reserved never exceeded 1 and BASE
ATS never became negative. Continue Without may now run through the visible UI.

### Continue Without Checkpoint

Completed at `2026-08-18T20:33Z` through the visible CONTENDER UI:

- `Continue Without This Item` was clicked once;
- `abandon-checkout-attempt`: HTTP 200;
- failed empty attempt `45bf9da2…` became terminal `failed` with completion timestamp set, both
  lifecycle pointers clear, no live admission, zero intents, zero reservations and zero open
  incidents;
- the authoritative order summary visibly refreshed to A x 1 and C x 1 only, subtotal GBP 2.00;
- the fixture's visible `Current canary basket` also refreshed to A x 1 and C x 1 only;
- BASE was absent from both visible surfaces;
- the conflict panel cleared;
- the reduced-basket `get-shipping-options` request returned HTTP 200;
- no new 5xx or unexpected console error appeared. The previously recorded 409 resource diagnostic
  remained the only CONTENDER console error.

**Continue Without checkpoint:** PASS. The failed empty attempt is terminal and the visible cart and
checkout projection agree on A+C. A fresh reduced checkout has not yet been materialised.

### Reduced A+C Checkout Checkpoint

Completed at `2026-08-18T20:34Z` using only `taa_browser_a`:

- `Evri Second Day` was visibly selected after reduced-basket recovery;
- reduced `create-checkout-session`: HTTP 200;
- Stripe Payment Element became visible; no payment details were entered and payment was not
  attempted;
- fresh CONTENDER attempt `2f53ea72…`: `active`, reservation-v1;
- fresh CONTENDER intent `f7dc5288…`: `pending` / orchestration `active`, test-mode Session;
- fresh CONTENDER reservation `9b8469ff…`: `held`, A x 1 and C x 1 only;
- BASE is absent from the CONTENDER intent and reservation;
- old failed attempt `45bf9da2…` remains terminal and has no intent or reservation;
- HOLDER attempt `9f6c9a55…`, intent `c992fd69…` and reservation `ab60bc60…` remain active/pending,
  held and BASE-only;
- no open incident or reconciliation job exists for any operation created by this run;
- a bounded same-request admission marker on the active CONTENDER attempt remained live briefly at
  this immediate checkpoint, with no in-flight pointer and no second intent/reservation. It is
  recorded for final cleanup verification and did not create duplicate stock ownership.

Authoritative inventory:

- A: physical 5, reserved 1, ATS 4;
- BASE: physical 1, reserved 1, ATS 0;
- C: physical 5, reserved 1, ATS 4.

### Core 7C1 Invariant Checkpoint

Before cleanup:

1. HOLDER acquired the final BASE unit: **PASS**.
2. BASE reserved never exceeded 1 in any authoritative checkpoint: **PASS**.
3. BASE ATS never became negative: **PASS**.
4. CONTENDER did not acquire BASE: **PASS**.
5. CONTENDER received the designed typed HTTP 409 conflict: **PASS**.
6. Continue Without removed BASE through visible application UI: **PASS**.
7. Failed empty CONTENDER attempt was terminalised: **PASS**.
8. CONTENDER materialised an A+C-only checkout: **PASS**.
9. HOLDER remained unaffected by CONTENDER recovery: **PASS**.
10. No HTTP 5xx was observed: **PASS**. One HOLDER request-level CORS/`net::ERR_FAILED` preceded its
    successful 200 and is preserved separately.
11. No duplicate reservation was created: **PASS**.
12. No unexpected lifecycle incident opened: **PASS**.

**Core 7C1 contention:** PASS before cleanup. Overall PASS is not yet available; CONTENDER cleanup,
HOLDER cleanup and exact final baseline restoration remain mandatory.

### CONTENDER Cleanup Checkpoint

Completed first at `2026-08-18T20:37Z` through the visible
`taa_browser_a` `Clear canary basket` control:

- pre-click operation: attempt `2f53ea72…`, intent `f7dc5288…`, reservation `9b8469ff…`, A+C held;
- second run-specific `abandon-checkout-attempt`: HTTP 200, captured from the named browser network
  list after reload;
- attempt `2f53ea72…`: terminal `expired`, both lifecycle pointers clear, no active admission;
- intent `f7dc5288…`: `expired` / orchestration `failed`;
- reservation `9b8469ff…`: `released` once with reason `stripe_session_expired_unpaid`;
- open incidents: 0; open reconciliation jobs: 0;
- visible fixture basket after reload: `Canary basket is empty.`;
- post-reload console: zero errors and warnings;
- exactly three reservation-v1 attempts were created during this run: HOLDER, the terminal failed
  empty conflict attempt and the terminal reduced CONTENDER attempt. No request C/new operation was
  created during cleanup.

Authoritative inventory after CONTENDER cleanup:

- A: physical 5, reserved 0, ATS 5;
- BASE: physical 1, reserved 1, ATS 0;
- C: physical 5, reserved 0, ATS 5.

**CONTENDER cleanup:** PASS. A+C released exactly once; HOLDER remains the sole active BASE owner.
HOLDER cleanup may proceed.

### HOLDER Cleanup Checkpoint

Completed second at `2026-08-18T20:38Z` through the visible
`taa_browser_b` `Clear canary basket` control:

- pre-click UI still exposed the retained BASE basket and mounted Payment Element;
- `abandon-checkout-attempt`: HTTP 200, captured from the named browser network list after reload;
- attempt `9f6c9a55…`: terminal `expired`, both lifecycle pointers clear, no active admission;
- intent `c992fd69…`: `expired` / orchestration `failed`;
- reservation `ab60bc60…`: `released` once with reason `stripe_session_expired_unpaid`;
- open incidents: 0; open reconciliation jobs: 0;
- visible fixture basket after reload: `Canary basket is empty.`;
- post-reload console: zero errors and warnings;
- no new checkout operation was created.

**HOLDER cleanup:** PASS. BASE released exactly once.

### Final Authoritative Baseline

Verified at `2026-08-18T20:39Z`:

- A: physical 5, reserved 0, ATS 5;
- BASE: physical 1, reserved 0, ATS 1;
- C: physical 5, reserved 0, ATS 5;
- active synthetic checkout attempts: 0;
- active canary-linked intents: 0;
- held/payment-pending canary reservations: 0;
- open synthetic lifecycle incidents: 0;
- open synthetic pending/claimed/manual-review reconciliation jobs: 0;
- active synthetic admissions: 0;
- lifecycle pointers remaining on the three run attempts: 0;
- three run attempts created, all three terminal;
- orders created by this run: 0;
- consumed reservations created by this run: 0;
- both named browser fixtures visibly showed `Canary basket is empty.`.

A count-only audit of lifecycle rows updated during the canary window, excluding the exact three
run attempts, returned zero unrelated checkout-attempt updates, zero unrelated checkout-intent
updates and zero unrelated inventory-reservation updates. No unrelated row identifiers or customer
data were inspected.

### HTTP, Console and Network Summary

- HOLDER: `get-shipping-options` 200; initial `create-checkout-session` browser request
  `net::ERR_FAILED`/CORS; retry 200; cleanup `abandon-checkout-attempt` 200.
- CONTENDER: initial `get-shipping-options` 200; typed conflict `create-checkout-session` 409;
  empty-attempt `abandon-checkout-attempt` 200; reduced `get-shipping-options` 200; reduced
  `create-checkout-session` 200; reduced-operation `abandon-checkout-attempt` 200.
- No HTTP 5xx was observed.
- The expected 409 appeared as a failed-resource console diagnostic before recovery. The HOLDER
  request-level failure appeared as a CORS/`net::ERR_FAILED` diagnostic before its successful 200.
  Both `/checkout-test` consoles were clean after final reload.
- The separate normal-homepage release check recorded an existing Webflow/jQuery `id` diagnostic;
  it was outside checkout, made no checkout request and did not affect the canary result.

### Result and Exact Next Action

**Overall:** PASS
**Core 7C1 contention:** PASS
**Cleanup and final restoration:** PASS

UTC run window: `2026-08-18T20:21Z` to `2026-08-18T20:39Z`.

The exact next action is human review of this production-canary evidence and the existing dirty
working tree. Keep global reservation activation off. The separate authenticated targeted-operator
smoke remains unexecuted and should be performed only when the dedicated reconciliation credential
is securely available; it was not required or invoked for this successful 7C1 run.

No application source, deployment, production configuration, secret, commit or push was changed by
this run. No targeted/global reconciliation or raw database mutation was used. Only
`Codex/VERIFICATION-LOG.md` and `Codex/CURRENT-STATE.md` were intentionally updated.

### Final Git Status

The status shape is unchanged from the starting dirty tree; the two untracked project-memory files
contain this run's only intentional file edits:

```text
 M AGENTS.md
 M docs/checkout-production-blockers.md
 M src/app/bootstrap.js
 M src/modules/checkout/checkout-inventory-controller.test.js
 M src/modules/checkout/checkout.js
 M supabase/functions/_shared/checkout-orchestration.ts
 M supabase/functions/abandon-checkout-attempt/index.ts
 M supabase/functions/reconcile-checkout-reservations/index.ts
?? .codex/
?? .opencode/
?? .playwright-mcp/
?? Codex/CURRENT-STATE.md
?? Codex/VERIFICATION-LOG.md
?? opencode.json
?? src/modules/checkout/checkout-canary-fixture.js
?? src/modules/checkout/checkout-canary-fixture.test.js
?? src/modules/checkout/checkout-reset.js
?? src/modules/checkout/checkout-reset.test.js
?? supabase/functions/_shared/checkout-operator-recovery.test.ts
?? supabase/functions/_shared/checkout-operator-recovery.ts
?? supabase/functions/_shared/checkout-orchestration.test.ts
?? supabase/migrations/20260824120000_targeted_checkout_attempt_reconciliation.sql
?? supabase/tests/concurrency/checkout-targeted-reconciliation-concurrency.sh
?? supabase/tests/database/checkout-targeted-reconciliation.test.sql
```

## 2026-08-18 — Targeted Recovery Authenticated Production Smoke Preparation

**Record type:** CONTEMPORANEOUS
**Evidence grade:** STRONG for the preconditions and stop decision
**Status:** BLOCKED BEFORE PRODUCTION MUTATION

### Objective and Pass Criteria

Exercise `reconcile-checkout-reservations?mode=targeted` against exactly one fresh synthetic
HOLDER attempt created through the visible `/checkout-test` UI, prove the private operator can
expire an exact open/unpaid Stripe Session without a browser capability, verify atomic attempt,
intent and reservation terminalization, restore the zero-active inventory baseline, and clear the
browser basket. The full 7C1 canary is out of scope.

PASS requires all of the following:

- the starting production inventory and zero-active census are exact;
- a dedicated reconciliation credential is securely available before browser mutation;
- `taa_browser_b` alone creates exactly one fresh BASE reservation-v1 attempt through visible UI;
- authoritative Stripe evidence establishes an open/unpaid Session immediately before recovery;
- the authenticated exact request returns HTTP 200 with result `recovered`;
- Stripe is re-read as expired/unpaid and the existing atomic lifecycle expires the attempt and
  intent, clears both pointers, and releases BASE exactly once;
- no unrelated attempt, intent or reservation changes and no incident/manual-review work opens;
- inventory returns to A 5/0/5, BASE 1/0/1 and C 5/0/5;
- the visible Clear control empties the already-terminal browser basket without creating new work.

Any dirty baseline, unavailable credential, 401/403, unexpected 4xx/5xx, 202 retry, 409 review,
uncertain Stripe state or postcondition mismatch is a mandatory STOP.

### Repository and Deployment Checkpoint

Observed at `2026-08-18T17:09Z`:

- branch: `main`;
- HEAD: `bec2929c0c5b3b48436c3a55fb33acbe61933ce8`;
- working tree: dirty with the targeted recovery implementation, project-memory updates and
  preserved unrelated frontend fixture/reset, abandonment diagnostic, handbook and local-tooling
  changes;
- production migration `20260824120000_targeted_checkout_attempt_reconciliation.sql`: recorded
  live in linked migration history;
- production `reconcile-checkout-reservations`: ACTIVE v7, `verify_jwt=false`;
- checkout-test release: `20260818T150958Z-bec2929c0c5b`;
- all other production paths: `20260816T054231Z-bec2929c0c5b`;
- no source, migration, deployment, Webflow or release-routing change was made during this smoke
  preparation.

Migration `20260824120000` is future-dated relative to the current execution date of 2026-08-18.
This is non-blocking migration-management debt. The already-applied production migration must not
be renamed or rewritten.

### Independently Verified Starting Baseline

Read-only linked database queries returned exactly three inventory rows:

- `TAA-CANARY-A`: physical 5, reserved 0, ATS 5;
- `TAA-CANARY-BASE`: physical 1, reserved 0, ATS 1;
- `TAA-CANARY-C`: physical 5, reserved 0, ATS 5.

Lifecycle census:

- active checkout attempts: 0;
- active canary-linked intents: 0;
- held/payment-pending canary reservations: 0;
- open lifecycle incidents: 0.

The baseline was clean. No synthetic attempt was created after this read.

### Authentication Contract

Exact request contract established from deployed-source-equivalent code and the production runbook:

- endpoint:
  `https://zxmywtmjvfjgdjcstgtn.supabase.co/functions/v1/reconcile-checkout-reservations?mode=targeted`;
- method: `POST`;
- content type: `application/json`;
- body: exactly one `checkout_attempt_id` UUID field;
- caller authentication: `Authorization: Bearer` using the existing dedicated
  `CHECKOUT_RECONCILIATION_SECRET`;
- optional `CHECKOUT_RECONCILIATION_PREVIOUS_SECRET` is accepted only during a deliberate bounded
  rotation window;
- Supabase CLI/macOS keychain authentication is not this credential;
- the caller does not supply a service-role token. The Edge Function uses its own server-held
  service-role credential internally to invoke the service-role-only claimant.

Authentication occurs before body parsing or database access. Target mode requires both the exact
query discriminator and a non-empty one-field body; malformed target requests cannot fall through
to global batch reconciliation.

### Credential Availability and Stop Result

Presence-only checks found both dedicated environment variables absent from the current operator
process. No secret value was retrieved, printed or inferred. Because the credential was unavailable,
the task stopped before:

- opening either browser;
- loading the HOLDER basket;
- creating a checkout attempt, intent, reservation or Stripe Session;
- invoking the targeted endpoint;
- clearing any basket or changing any production lifecycle state.

Therefore there is no smoke attempt ID, targeted HTTP response, Stripe terminal result, browser
network result or browser console result for this run. The production baseline remains the starting
zero-active state.

### Safest Resume Procedure

An authorised human must obtain the existing reconciliation credential from its original external
password/secret-manager custody. Do not try to read it back from Supabase Edge configuration, use a
Supabase CLI token, rotate it, or paste it into chat.

From a new clean interactive terminal, the following command text contains no secret and makes the
value available only through a hidden, non-persistent process environment:

```zsh
cd /path/to/TAA-Platform
zsh -f
unset HISTFILE
set +x
read -r -s 'CHECKOUT_RECONCILIATION_SECRET?Paste existing reconciliation credential: '
printf '\n'
export CHECKOUT_RECONCILIATION_SECRET
exec codex resume --last
```

The credential is entered as hidden input to `read`, not as command text. It is not echoed, placed
in argv, written to a repository file or saved in shell history. A running process cannot inherit a
later export from another shell, so the operator session must be resumed from that prepared shell.
The one-shot environment disappears when that process exits. Shell tracing must remain disabled.

Official OpenAI documentation identifies `codex resume --last` as the stable way to resume the most
recent chat from the current working directory. If this is not the most recent session, use its
known session ID with `codex resume <SESSION_ID>` rather than selecting an unrelated thread.

### Current Git Status

No commit or push was performed. `git diff --check` remained clean before this record. Current
`git status --short`:

```text
 M AGENTS.md
 M docs/checkout-production-blockers.md
 M src/app/bootstrap.js
 M src/modules/checkout/checkout-inventory-controller.test.js
 M src/modules/checkout/checkout.js
 M supabase/functions/_shared/checkout-orchestration.ts
 M supabase/functions/abandon-checkout-attempt/index.ts
 M supabase/functions/reconcile-checkout-reservations/index.ts
?? .codex/
?? .opencode/
?? .playwright-mcp/
?? Codex/CURRENT-STATE.md
?? Codex/VERIFICATION-LOG.md
?? opencode.json
?? src/modules/checkout/checkout-canary-fixture.js
?? src/modules/checkout/checkout-canary-fixture.test.js
?? src/modules/checkout/checkout-reset.js
?? src/modules/checkout/checkout-reset.test.js
?? supabase/functions/_shared/checkout-operator-recovery.test.ts
?? supabase/functions/_shared/checkout-operator-recovery.ts
?? supabase/functions/_shared/checkout-orchestration.test.ts
?? supabase/migrations/20260824120000_targeted_checkout_attempt_reconciliation.sql
?? supabase/tests/concurrency/checkout-targeted-reconciliation-concurrency.sh
?? supabase/tests/database/checkout-targeted-reconciliation.test.sql
```

### Exact Next Action

Resume this task from an authorised process containing the existing dedicated reconciliation
credential, repeat all read-only baseline/deployment checks, and only then begin `taa_browser_b`
Phase 3. Do not rerun 7C1 until this authenticated smoke reaches PASS and returns to a verified
zero-active baseline.

## 2026-08-18 — Lost-Capability Exact Recovery Implementation and Canary Baseline Restoration

**Record type:** CONTEMPORANEOUS
**Evidence grade:** STRONG, with one explicit runtime gap
**Status:** DEFECT IMPLEMENTED; RETAINED OPERATIONS RECOVERED BY EXISTING EXPIRY LIFECYCLE

### Objective and Scope

Establish the authoritative lifecycle for an already-materialized reservation-v1 attempt whose
browser capability is unavailable, add the smallest exact operator recovery primitive because none
existed, verify and deploy it without publishing unrelated working-tree changes, and return the two
retained synthetic attempts to a zero-active baseline. The 7C1 contention canary was explicitly out
of scope and was not rerun.

### Starting State

The authoritative checkpoint recorded earlier on 2026-08-18 contained:

- CONTENDER attempt `615adaae…`: active reservation-v1, active/pending intent `a3b8a01c…`, held
  A+C reservation `e70c9487…`;
- HOLDER attempt `6377ce19…`: active reservation-v1, active/pending intent `b27070a7…`, held BASE
  reservation `bf1be766…`;
- active checkout attempts: 2;
- active canary-linked intents: 2;
- held canary reservations: 2;
- open lifecycle incidents: 0;
- `TAA-CANARY-A`: physical 5, reserved 1, ATS 4;
- `TAA-CANARY-BASE`: physical 1, reserved 1, ATS 0;
- `TAA-CANARY-C`: physical 5, reserved 1, ATS 4.

The CONTENDER browser displayed an empty cart and no longer had a proven recoverable operation for
the retained attempt. No browser storage, cookie, capability, credential or token was inspected.

Repository HEAD remained `bec2929c0c5b3b48436c3a55fb33acbe61933ce8`. The working tree was
already dirty with unrelated frontend fixture, abandonment diagnostic, engineering-handbook and
local-tooling changes; those changes were preserved.

### Lifecycle Reconstruction and Root Cause

Source, migration, test and deployed-function inspection established:

1. Browser `abandon-checkout-attempt` is exact and Stripe-aware, but correctly requires the raw
   browser capability. PostgreSQL stores only its hash, so a lost capability cannot be
   reconstructed or fabricated.
2. The private `reconcile-checkout-reservations` worker already owns capability-free,
   Stripe-authoritative recovery, but its existing surface is global/batched. It discovers and
   claims up to 25 eligible jobs and therefore cannot guarantee one exact attempt, CONTENDER-first
   ordering, or isolation from HOLDER and unrelated work.
3. `transition_checkout_session_terminal` is the existing exact atomic database transition, but it
   is deliberately only the database half of the lifecycle. Calling it directly without prior
   authoritative Stripe proof would be unsafe.
4. The Stripe webhook can transition an exact Session when Stripe emits a terminal event, but it is
   event-driven rather than an operator recovery surface.

The browser failure was therefore not a reason to weaken capability authentication. The defect was
the absence of an exact, private operator entry into the existing Stripe-authoritative reconciler.

### Authoritative Lifecycle

The implemented operator path preserves the frozen lifecycle:

1. lock and validate the exact reservation-v1 attempt, reservation and complete intent topology;
2. reject incoherent, paid/manual-review, cross-pointer, live-lease or unrelated states before
   external mutation;
3. retrieve the Stripe Checkout Session and validate its attempt/request/intent identity and
   canonical economics;
4. if it is open and unpaid, expire it with a stable idempotency key;
5. re-retrieve and revalidate Stripe state after expiry;
6. only after authoritative expired-and-unpaid proof, call the existing atomic terminal transition;
7. atomically mark intent/orchestration failed, release the reservation exactly once, expire the
   attempt and clear lifecycle pointers;
8. preserve/finalize paid state, retain stock for payment-pending or transient Stripe outcomes, and
   use existing retry/manual-review handling for uncertainty.

Existing database lock order, durable queue leases, Stripe idempotency, final transition rechecks,
immutable cart ownership and reservation ownership remain unchanged.

### Implementation

Recovery-specific files added or modified:

- `supabase/migrations/20260824120000_targeted_checkout_attempt_reconciliation.sql`;
- `supabase/functions/reconcile-checkout-reservations/index.ts`;
- `supabase/functions/_shared/checkout-operator-recovery.ts`;
- `supabase/functions/_shared/checkout-operator-recovery.test.ts`;
- `supabase/tests/database/checkout-targeted-reconciliation.test.sql`;
- `supabase/tests/concurrency/checkout-targeted-reconciliation-concurrency.sh`;
- `docs/checkout-production-blockers.md`;
- `Codex/CURRENT-STATE.md`;
- `Codex/VERIFICATION-LOG.md`.

The new claimant is `SECURITY DEFINER`, accepts one attempt UUID, and is executable by
`service_role` only. Target mode additionally requires the exact query discriminator
`?mode=targeted` and the sole JSON field `checkout_attempt_id`. Empty or malformed target requests
cannot fall through to the legacy batch mode. The existing empty-body/no-mode batch contract is
unchanged.

### Current Working-Tree Verification

Executed on 2026-08-18 against the identified dirty working tree:

- Node `v22.23.1`;
- full local migration reset/replay through `20260824120000`: **PASS**;
- focused targeted reconciliation pgTAP: **PASS — 72/72**;
- full pgTAP: **PASS — 427/427 across 13 files**;
- focused two-session exact-claim concurrency: **PASS**; one leased target job and unrelated work
  untouched;
- Supabase database lint: **PASS — no schema errors**;
- relevant Deno lifecycle/recovery tests: **PASS — 37/37**;
- isolated clean-candidate operator tests: **PASS — 10/10**;
- reconciler Deno typecheck in the working tree and isolated candidate: **PASS**;
- current frontend checkout tests run before the final database-only hardening: **PASS — 70/70**;
- `npm run lint`: **PASS**;
- `npm run build`: **PASS**;
- Prettier on recovery-supported changed files: **PASS**;
- `git diff --check`: **PASS**.

Expected local warnings about unavailable Klaviyo/Vault test secrets occurred during pgTAP. They did
not fail the suites and no secret value was inspected.

Three independent adversarial reviews found no remaining release-blocking database, Edge security,
or deployment issue after hardening the exact topology checks, manual-review precedence, queue
lease fencing, no-Session replacement handling and target-mode parser.

### Production Migration and Function Deployment

Read-only linked migration inventory and dry-run showed exactly one pending migration:

`20260824120000_targeted_checkout_attempt_reconciliation.sql`

That single migration was applied successfully. A post-deployment metadata query proved:

- RPC exists: true;
- `anon` execute: false;
- `authenticated` execute: false;
- `service_role` execute: true.

The Edge Function was not deployed from the dirty repository root. A clean HEAD archive was built,
and only the reviewed reconciler and operator helper were overlaid. Its unrelated
`checkout-orchestration.ts` dependency remained byte-for-byte HEAD. The isolated candidate passed
its own typecheck and 10/10 tests, then a second pristine candidate was used for the named deploy.

Production result:

- function: `reconcile-checkout-reservations`;
- deployed version: v7;
- status: ACTIVE;
- `verify_jwt`: false, preserving the existing private reconciliation-secret boundary;
- unauthenticated no-body POST: HTTP 401 before target parsing, RPC or batch work.

The existing `CHECKOUT_RECONCILIATION_SECRET` and previous rotation value were absent from the
operator process. Presence only was checked; no value was read. No authenticated target call was
made, no secret was provisioned or rotated, and no low-level database transition was used as a
bypass.

### Retained Operation Outcomes

Before an authenticated operator call could be made, fresh linked database reads showed that both
retained operations had already completed through the existing expiry lifecycle:

#### HOLDER `6377ce19…`

- attempt: `expired`, completed `2026-08-18T16:36:45.025624Z`;
- active and in-flight pointers: null;
- intent `b27070a7…`: `expired`, orchestration `failed`, safe failure code `expired_unpaid`;
- Stripe Session reference remains recorded for audit, but no secret material was read;
- BASE reservation `bf1be766…`: `released` at the same database timestamp;
- release reason: `stripe_session_expired_unpaid`;
- reconciliation jobs: 0;
- lifecycle incidents: 0.

#### CONTENDER `615adaae…`

- attempt: `expired`, completed `2026-08-18T16:39:57.145522Z`;
- active and in-flight pointers: null;
- intent `a3b8a01c…`: `expired`, orchestration `failed`, safe failure code `expired_unpaid`;
- Stripe Session reference remains recorded for audit, but no secret material was read;
- A+C reservation `e70c9487…`: `released` at the same database timestamp;
- release reason: `stripe_session_expired_unpaid`;
- reconciliation jobs: 0;
- lifecycle incidents: 0.

HOLDER naturally expired before CONTENDER. No operator recovery call was made, so the requested
CONTENDER-first operator ordering was neither attempted nor bypassed. Both completions occurred
about five seconds after their recorded Stripe Session/hard-expiry timestamps. The database state,
safe failure codes and absence of reconciliation jobs strongly support the inference that the
existing Stripe `checkout.session.expired` webhook performed the authoritative transitions. No
corresponding function log was recovered, so the exact caller is not claimed as independently
runtime-confirmed.

### Final Production State

Read-only linked database verification after both terminal transitions:

- `TAA-CANARY-A`: physical 5, reserved 0, ATS 5;
- `TAA-CANARY-BASE`: physical 1, reserved 0, ATS 1;
- `TAA-CANARY-C`: physical 5, reserved 0, ATS 5;
- active checkout attempts: 0;
- active canary-linked intents: 0;
- held/payment-pending canary reservations: 0;
- open lifecycle incidents: 0;
- no target reconciliation job exists.

The required zero-active baseline is restored. Physical inventory was not decremented.

### Security and Scope

No capability, cookie, browser storage, auth token, Authorization header, secret, PII, Stripe
secret or sensitive request body was inspected or recorded. No raw `UPDATE`/`DELETE`, direct
reservation release, direct Stripe cancellation, fabricated capability, global reservation flag,
reconciler schedule, commit or push was used. The full 7C1 canary was not rerun.

### What This Proves

- the exact operator recovery defect is implemented, locally tested and deployed behind the
  existing private authentication boundary;
- the production RPC privilege boundary and unauthenticated denial behave as designed;
- the two retained attempts reached coherent expired/unpaid terminal state through an existing
  authoritative lifecycle;
- the production canary inventory and zero-active invariants are restored.

### What This Does Not Prove

- the new target mode has not received an authenticated production request because the existing
  reconciliation credential was unavailable to this operator process;
- no direct Edge log was recovered to independently identify the caller that terminalized the two
  Sessions;
- this work does not constitute a rerun or PASS of the full 7C1 contention canary.

### Exact Next Action

Make the already-provisioned reconciliation credential available to an authorised operator process
without printing or persisting it. Run the documented authenticated target-mode safety smoke, then
perform the final 7C1 rerun from the verified zero-active inventory baseline. Stop on any 202, 409,
5xx, timeout, manual-review response or invariant drift.

### Final Git Status

No commit or push was performed. Final `git status --short`:

```text
 M AGENTS.md
 M docs/checkout-production-blockers.md
 M src/app/bootstrap.js
 M src/modules/checkout/checkout-inventory-controller.test.js
 M src/modules/checkout/checkout.js
 M supabase/functions/_shared/checkout-orchestration.ts
 M supabase/functions/abandon-checkout-attempt/index.ts
 M supabase/functions/reconcile-checkout-reservations/index.ts
?? .codex/
?? .opencode/
?? .playwright-mcp/
?? Codex/CURRENT-STATE.md
?? Codex/VERIFICATION-LOG.md
?? opencode.json
?? src/modules/checkout/checkout-canary-fixture.js
?? src/modules/checkout/checkout-canary-fixture.test.js
?? src/modules/checkout/checkout-reset.js
?? src/modules/checkout/checkout-reset.test.js
?? supabase/functions/_shared/checkout-operator-recovery.test.ts
?? supabase/functions/_shared/checkout-operator-recovery.ts
?? supabase/functions/_shared/checkout-orchestration.test.ts
?? supabase/migrations/20260824120000_targeted_checkout_attempt_reconciliation.sql
?? supabase/tests/concurrency/checkout-targeted-reconciliation-concurrency.sh
?? supabase/tests/database/checkout-targeted-reconciliation.test.sql
```

The frontend fixture/reset, abandonment diagnostic, handbook and local-tooling entries predated or
were outside this recovery implementation and were preserved. The recovery-specific scope is listed
under Implementation above.

## 2026-08-18 — Checkout Canary Authoritative Cleanup Fix Deployment

**Record type:** CONTEMPORANEOUS
**Evidence grade:** STRONG
**Status:** BLOCKED

### Objective and Scope

Deploy only the test-only `/checkout-test` authoritative cleanup fix, exercise the fixed visible
Clear canary basket control against the two retained 7C1 checkout operations, and restore the
synthetic inventory to a zero-active baseline. The full 7C1 contention canary is explicitly out of
scope for this verification.

### Starting Repository State

Observed at `2026-08-18T15:08:51Z`:

- branch: `main`
- HEAD: `bec2929c0c5b3b48436c3a55fb33acbe61933ce8`
- tracked checkout-fix changes:
  - `src/app/bootstrap.js`
  - `src/modules/checkout/checkout.js`
  - `src/modules/checkout/checkout-inventory-controller.test.js`
- untracked checkout-fix files:
  - `src/modules/checkout/checkout-canary-fixture.js`
  - `src/modules/checkout/checkout-canary-fixture.test.js`
  - `src/modules/checkout/checkout-reset.js`
  - `src/modules/checkout/checkout-reset.test.js`
- this verification record is also an intentional working-tree change;
- pre-existing backend diagnostic, engineering-handbook, local tooling and agent-memory changes
  are excluded from the frontend release scope.

The working tree is dirty. Verification and release evidence in this record therefore applies to
the identified working-tree source, not to HEAD alone.

### Starting Production State

Observed by read-only linked database queries at `2026-08-18T15:08Z`:

- HOLDER (`taa_browser_b`): attempt `6377ce19…`, active reservation-v1, active intent
  `b27070a7…`, held reservation `bf1be766…`, basket `TAA-CANARY-BASE × 1`;
- CONTENDER (`taa_browser_a`): attempt `615adaae…`, active reservation-v1, active intent
  `a3b8a01c…`, held reservation `e70c9487…`, basket `TAA-CANARY-A × 1` and
  `TAA-CANARY-C × 1`;
- both retained admissions were expired but still recorded on their active attempts;
- no open checkout lifecycle incidents were present.

Inventory checkpoint:

- `TAA-CANARY-A`: physical 5, reserved 1, ATS 4;
- `TAA-CANARY-BASE`: physical 1, reserved 1, ATS 0;
- `TAA-CANARY-C`: physical 5, reserved 1, ATS 4.

### Starting Release Routing

Read-only published HTML inspection established the pathname-specific loader:

- `/checkout-test` and `/checkout-test/` select `20260817T134038Z-bec2929c0c5b`;
- every other path selects `20260816T054231Z-bec2929c0c5b`;
- release entry origin: `https://assets.theanimalalchemist.com/releases/<release-id>/taa-platform.js`.

### Planned Verification

- rerun current working-tree checkout tests, lint, build, Prettier and diff checks;
- build and checksum one new immutable release containing only the intended frontend source;
- verify all uploaded runtime assets over HTTP before Webflow publication;
- update only the `/checkout-test` release ID in the site-wide loader;
- preserve the default release for all other routes;
- verify fixture controls and runtime diagnostics in the fixed browsers;
- clear each still-active retained operation through the visible fixture control and authoritative
  reset path;
- verify terminal attempt/intent/reservation states and the final inventory/zero-active baseline.

### Current Result

**BLOCKED at authoritative cleanup of the retained CONTENDER operation.**

The frontend deployment and fixture smoke verification passed. The first retained-operation
cleanup reloaded without abandoning the retained CONTENDER operation. No matching abandonment
request evidence survived the automatic reload, and the authoritative database state was
unchanged. The observed behaviour is consistent with the browser no longer having a recoverable
operation corresponding to that attempt. Per the task stop condition, HOLDER cleanup and the full
7C1 canary were not attempted.

### Current Working-Tree Verification

Executed against the identified dirty working tree on 2026-08-18:

- Node: `v22.23.1`;
- `node --test src/modules/checkout/*.test.js`: **PASS — 70/70**;
- `npm run lint`: **PASS**;
- `npm run build`: **PASS**;
- Prettier check on the seven checkout-fix source/test files and this log: **PASS**;
- `git diff --check`: **PASS**.

The only modified or untracked files under `src/` were the seven intended checkout-fix files.
Pre-existing backend diagnostic and local tooling/documentation changes were outside the Vite
entry graph and were not uploaded.

### Immutable Release

Release ID:

`20260818T150958Z-bec2929c0c5b`

Source context:

- HEAD `bec2929c0c5b3b48436c3a55fb33acbe61933ce8`;
- dirty working tree containing the seven explicitly scoped frontend checkout-fix files;
- no commit or push was performed.

Uploaded runtime artifacts and verified SHA-256 checksums:

- `taa-platform.js` — `6178abd5dfe44400c6665954186cc422ac3a3b810936a03ec56e8529d0c4cbfc`;
- `assets/checkout-BiGvseoH.js` — `f09ad93184964f4d5b860b6c44831307c5e7691ba55e19b393ba8d432fe6f5ee`;
- `assets/checkout-attempt-DdReLkxe.js` — `65350b883301906fe37fcd17648f82f00bcf9a49ab0563d62feb56eec127d305`;
- `assets/checkout-canary-fixture-DO3GPm_O.js` — `d4c982b490e37b2960c4757b95516c3a99ec0bd06595e681c864ccd78ed87a4e`;
- `assets/checkout-capability-ZgiHghKf.js` — `1e4dfb71f08dbc4f8b2f62c5ed525894d90a286723e060c535f282e8d883f5f6`;
- `assets/checkout-reset-un5RhHcR.js` — `8f90499a8a86bce314e6065f652c6dbad5d61e55b0dfa23a80aeda619cb3fb79`;
- `assets/client-D2HNmQK7.js` — `ae0029a506c408ece9ae4fd39192674eb326d48ff25b1acd2c277c0c835beada`;
- `assets/order-confirmation-BZDYxDLi.js` — `73f51ea927b4951dab1981d48bbf0afd21434681cac09db13c8ef855ad1851b5`;
- `assets/product-page-Cr5Axqp4.js` — `81b3f5b9c3153e417dc67781ef98742324f15c21d5bc806846e3bc857eb5679f`;
- `assets/products-BmP5eZaW.js` — `5736e53eedfe1f85edaa1b0fdc8d71966e5cb7a19795543268f0b5cf31c81dc0`.

Every remote checksum matched the local build. Every uploaded runtime URL returned HTTP 200 with
JavaScript content before Webflow publication. The local `.vite/manifest.json` was retained as
build metadata and was not uploaded, consistent with the established release process.

### Webflow Loader and Publish

Previous loader:

```html
<script type="module">
  const taaPlatformRelease = ['/checkout-test', '/checkout-test/'].includes(
    window.location.pathname
  )
    ? '20260817T134038Z-bec2929c0c5b'
    : '20260816T054231Z-bec2929c0c5b';
  import(`https://assets.theanimalalchemist.com/releases/${taaPlatformRelease}/taa-platform.js`);
</script>
```

Published loader:

```html
<script type="module">
  const taaPlatformRelease = ['/checkout-test', '/checkout-test/'].includes(
    window.location.pathname
  )
    ? '20260818T150958Z-bec2929c0c5b'
    : '20260816T054231Z-bec2929c0c5b';
  import(`https://assets.theanimalalchemist.com/releases/${taaPlatformRelease}/taa-platform.js`);
</script>
```

Only the checkout-test release literal changed. Webflow saved the site custom code and published
successfully to the selected staging and production domains at approximately
`2026-08-18T15:17Z`.

Post-publish observations:

- homepage loaded default `20260816T054231Z-bec2929c0c5b/taa-platform.js` — HTTP 200;
- `/checkout-test` loaded `20260818T150958Z-bec2929c0c5b/taa-platform.js` and all required checkout
  chunks — HTTP 200;
- published HTML retained pathname-specific routing for both `/checkout-test` forms;
- normal customer paths remained on the default release.

The homepage browser observation included one Webflow-generated JavaScript error and its jQuery
warning (`Cannot read properties of undefined (reading 'id')`). No TAA immutable-release URL was
present in that stack. This observation is recorded without claiming whether it predated this
publish. Both `/checkout-test` browser observations contained zero console errors and zero
warnings.

### Fixture Smoke Verification

Fixed roles:

- `taa_browser_a` — CONTENDER;
- `taa_browser_b` — HOLDER.

Both `/checkout-test` pages visibly showed:

- `Load HOLDER basket`;
- `Load CONTENDER basket`;
- `Clear canary basket`.

Visible pre-cleanup state:

- CONTENDER: `Canary basket is empty.`;
- HOLDER: `TAA-CANARY-BASE × 1`.

Both browsers loaded the new entry and required chunks with HTTP 200 and produced no checkout-test
console warnings or errors.

### Retained Operation Cleanup Attempt

Immediately before cleanup, a fresh read-only database checkpoint showed both historical retained
operations were still active despite their reservation expiry timestamps having passed:

- CONTENDER attempt `615adaae…`, intent `a3b8a01c…` pending/active, reservation `e70c9487…` held;
- HOLDER attempt `6377ce19…`, intent `b27070a7…` pending/active, reservation `bf1be766…` held;
- no open lifecycle incidents.

CONTENDER visible Clear was clicked first at approximately `2026-08-18T15:20Z`.

Observed result:

- visible basket before: empty;
- visible basket after reload: empty;
- `abandon-checkout-attempt`: no matching request was present in the browser network view after
  automatic reload; the pre-reload HTTP status is therefore **unknown**;
- checkout-test console: no error or warning;
- database after the click: attempt still active, intent still pending/active, reservation still
  held, expired admission still recorded;
- inventory remained unchanged.

Supported diagnosis:

- source calls the shared stored reset primitive when checkout initialization returns no controller
  for an empty cart;
- the primitive can call the authoritative endpoint only when a stored envelope provides a
  recoverable active operation and its attempt capability;
- the retained attempt remaining unchanged after the visible action establishes that it was not
  authoritatively abandoned;
- the reload discarded pre-reload network visibility, so the evidence does not establish whether
  no request was issued or a different/stale local operation resolved terminal/not-found;
- the supported inference is that this browser no longer had a recoverable operation corresponding
  to retained attempt `615adaae…`;
- no browser storage, cookie, token or credential was inspected to obtain this conclusion.

This is not evidence that the deployed reset path fails when a browser retains the matching active
envelope. It is evidence that retained CONTENDER operation `615adaae…` was not cleaned through this
browser session and that the matching recoverable browser operation is unavailable or stale.

Per the explicit stop condition:

- HOLDER Clear was not clicked;
- no raw SQL mutation was performed;
- no manual Stripe, intent or reservation operation was performed;
- the reconciler was not invoked;
- `terminalize_expired_empty_checkout_attempts_v1` was not invoked because these retained attempts
  are not empty and the failed fixture cleanup must not be hidden;
- the full 7C1 contention canary was not rerun.

### Final Authoritative State

Observed after the stopped CONTENDER cleanup attempt:

- active checkout attempts: 2 (`615adaae…`, `6377ce19…`);
- active canary-linked intents: 2;
- active canary reservations: 2;
- unexpected open lifecycle incidents: 0;
- `TAA-CANARY-A`: physical 5, reserved 1, ATS 4;
- `TAA-CANARY-BASE`: physical 1, reserved 1, ATS 0;
- `TAA-CANARY-C`: physical 5, reserved 1, ATS 4.

Required zero-active baseline: **NOT RESTORED**.

### Security and Scope

No capability token, cookie, authentication token, Authorization header, secret, PII or sensitive
request body was inspected or recorded. No backend, schema, Stripe lifecycle, inventory logic,
branch, commit or Git remote was changed.

### Conclusion

**BLOCKED**

- frontend release deployment: **PASS**;
- Webflow routing isolation: **PASS**;
- fixture control/runtime smoke verification: **PASS**;
- retained-operation cleanup: **BLOCKED** because CONTENDER no longer exposes a recoverable browser
  operation corresponding to retained attempt `615adaae…`;
- required inventory and zero-active baseline: **FAIL / NOT RESTORED**.

### Exact Next Action

Do not rerun 7C1. Establish an approved authoritative Stripe-aware recovery path for retained
materialized attempts whose browser capability is no longer available. The empty-attempt
terminalizer is not applicable to these rows. Preserve HOLDER without further browser mutation
until that recovery decision is made, then verify intent/reservation terminalisation and inventory
restoration before any new canary run.

### Unresolved Technical Debt

The test fixture can safely abandon a retained attempt only while its browser-scoped capability is
recoverable. A lost browser capability intentionally cannot be reconstructed client-side. An
operational Stripe-aware recovery mechanism is therefore required for canary cleanup when the
browser session is lost; this should reuse the authoritative reconciliation lifecycle rather than
weakening capability authentication or adding a browser bypass.

## 2026-08-17 — Checkout Canary Deployment and Smoke Test

**Record type:** CONTEMPORANEOUS
**Evidence grade:** STRONG

### Objective

Verify that the checkout canary fixture could be deployed and exercised without
invoking the real checkout lifecycle.

### Revision / Release

Default production release:

`20260816T054231Z-bec2929c0c5b`

Checkout-test release:

`20260817T134038Z-bec2929c0c5b`

### Environment

Webflow production deployment with isolated `/checkout-test` canary path.

### Method

- Webflow production publish
- HTTP asset verification
- browser canary smoke test
- browser console inspection
- browser network/lifecycle observation

### Result

**PASS**

### Deployment Evidence

Webflow production publish:

**PASS**

Routing behaviour:

- `/checkout-test`
- `/checkout-test/`

used the checkout-test release.

Other production paths continued using the default production release.

### Asset Verification

Default release asset:

**HTTP 200**

Checkout-test release asset:

**HTTP 200**

### Canary Runtime Verification

Path tested:

`/checkout-test`

Observed behaviour:

- all three fixture controls appeared;
- HOLDER load produced `TAA-CANARY-BASE × 1`;
- Clear restored `Canary basket is empty.`;
- no checkout lifecycle endpoint was invoked;
- browser console contained no errors;
- browser console contained no warnings.

### Evidence Classification

Source evidence:

**YES**

Test evidence:

**YES — runtime smoke test**

Deployment evidence:

**YES**

Canary/runtime evidence:

**YES**

Production checkout lifecycle verification:

**NOT ESTABLISHED BY THIS TEST**

Real Stripe payment verification:

**NOT ESTABLISHED BY THIS TEST**

Complete checkout production-readiness:

**NOT ESTABLISHED BY THIS TEST**

### What This Proves

This verifies that:

- the checkout-test canary release was successfully published;
- the expected canary fixture controls were available at runtime;
- the HOLDER fixture produced the expected basket state;
- the Clear control restored the expected empty state;
- the observed fixture interaction did not invoke the protected checkout
  lifecycle;
- the tested browser session produced no console errors or warnings.

### What This Does Not Prove

This verification does not establish:

- successful real checkout-session creation;
- successful inventory reservation through the production checkout lifecycle;
- successful Stripe payment;
- successful Stripe webhook finalisation;
- successful real-order creation;
- complete production checkout readiness;
- correctness of checkout behaviour outside the tested canary scope.

### Outstanding Uncertainty

The complete production checkout lifecycle remains outside the scope of this
verification record.

### Superseded By

None.

---

# Record Requirements

Future verification records should include the following fields where applicable.

## Date

Exact verification date.

Use the date on which the verification actually occurred where known.

## Record Type

Use one of:

- `CONTEMPORANEOUS`
- `RETROSPECTIVE`

`CONTEMPORANEOUS` means the record was created from evidence available at or
immediately around the time of verification.

`RETROSPECTIVE` means the verification history was reconstructed later from
preserved evidence.

## Evidence Grade

Use one of:

- `STRONG`
- `MODERATE`
- `INSUFFICIENT`

The meaning of these grades is defined in the Retrospective Verification Policy
below.

Contemporaneous verification supported by directly observed execution or
runtime evidence will normally qualify as `STRONG`.

## Objective

What was being verified.

State the behaviour, invariant or system property being tested rather than only
the feature name.

## Revision / Release

Record relevant identifiers where known.

Examples:

- Git commit
- branch
- migration
- Webflow release
- deployment identifier
- Edge Function revision
- database schema state

If unknown, state:

`Unknown`

## Environment

Examples:

- local
- local Supabase
- development
- canary
- staging
- production

Be as specific as the available evidence allows.

## Method

Examples:

- Node test runner
- Deno test
- SQL database test
- concurrency script
- Playwright MCP
- manual browser verification
- API request
- HTTP smoke test
- Webflow deployment smoke test
- runtime log inspection

## Result

Use one of:

- `PASS`
- `FAIL`
- `PARTIAL`
- `UNCONFIRMED`

`UNCONFIRMED` means evidence exists for the underlying implementation or
historical event but successful verification cannot be established.

## Observations

Record concrete observed behaviour.

Do not convert inference into observation.

## Evidence Sources

Identify the evidence supporting the record.

Examples:

- terminal output
- test output
- deployment output
- browser observation
- Playwright result
- runtime log
- Git commit and diff
- Codex record
- contemporaneous project handoff

## Evidence Scope

State what the verification establishes.

## Limitations

State what the verification does not establish.

## Outstanding Uncertainty

Record anything that remains unresolved.

## Follow-up

Record any required next verification step.

## Superseded By

If a later verification provides stronger or more current evidence, reference
that later record.

Otherwise:

`None`

---

# Retrospective Verification Policy

Historical verification may be reconstructed and added to this log when reliable
evidence exists for work completed before the Verification Log was established.

Retrospective verification exists to recover genuine engineering evidence, not
to reconstruct an idealised history of the project.

A historical implementation milestone must not be recorded as successfully
verified merely because:

- source code exists;
- a Git commit exists;
- a migration exists;
- a test file exists;
- a feature appears complete;
- later code depends on it;
- an AI agent considers successful verification likely.

Implementation evidence and verification evidence are separate.

## Retrospective Record Type

Every reconstructed historical entry must include:

```text
Record type: RETROSPECTIVE
```

## Evidence Grades

### STRONG

Direct evidence of the verification event exists.

Examples:

- preserved test output;
- terminal output showing successful execution;
- Playwright or browser test results;
- deployment output;
- HTTP or runtime observations;
- CI results;
- database test results;
- concurrency-test output;
- release identifiers paired with observed runtime behaviour;
- saved logs containing the actual result.

A retrospective `PASS` may be recorded when strong evidence directly establishes
successful verification.

### MODERATE

The original raw execution output is unavailable, but reliable contemporaneous
evidence records the verification result.

Examples:

- a dated engineering record explicitly stating that defined tests passed;
- a contemporaneous handoff containing the exact verification method and
  observed result;
- a commit or project record accompanied by specific test-result details;
- multiple independent contemporaneous records consistently describing the same
  verification event.

Moderate evidence may support a retrospective `PASS`, but the record must
clearly state that the original raw execution output was not recovered.

### INSUFFICIENT

Evidence establishes implementation, intention or the existence of tests but
does not establish successful verification.

Examples:

- implementation commit only;
- test file exists but no execution result exists;
- migration exists but deployment state is unknown;
- documentation says something should have been tested but contains no result;
- later recollection without supporting evidence;
- later implementation appears to depend on the feature working.

Insufficient evidence must never be converted into `PASS`.

Where historically useful, record:

```text
Result: UNCONFIRMED
```

Otherwise omit the candidate verification record.

## Retrospective Evidence Rules

1. Never infer successful verification solely from implementation history.
2. Never infer that a test ran solely because the test exists.
3. Never infer deployment solely because a migration, function, build or release
   artefact exists.
4. Never infer runtime success solely because deployment occurred.
5. Never infer production verification from local, test, canary or staging
   evidence.
6. Preserve uncertainty where original evidence cannot be recovered.
7. Prefer original contemporaneous evidence over later recollection.
8. Record contradictory evidence explicitly.
9. State when original raw output is unavailable.
10. Never upgrade `UNCONFIRMED` to `PASS` without additional supporting
    evidence.
11. Every retrospective record must identify the evidence used to reconstruct
    it.
12. Every retrospective record must state both what the evidence proves and
    what it does not prove.
13. Git chronology may establish when implementation changed but does not, by
    itself, establish successful verification.
14. The existence of later dependent code must not be used as proof that the
    earlier subsystem behaved correctly.
15. Human recollection may guide evidence discovery but should not replace
    recoverable direct evidence where stronger evidence is available.

## Historical Audit Procedure

When reconstructing TAA-Platform verification history:

1. Work chronologically.
2. Identify candidate milestones from Git history, Codex records, project
   records or preserved engineering conversations.
3. Establish what was implemented.
4. Search separately for evidence that the implementation was actually
   exercised.
5. Identify the exact verification method where possible.
6. Determine the environment in which verification occurred.
7. Determine the relevant revision or release where possible.
8. Grade the available evidence.
9. Record only conclusions justified by that evidence.
10. Mark unresolved historical verification as `UNCONFIRMED`.
11. Record important contradictory evidence.
12. State what the evidence does not prove.
13. Do not alter the historical account merely to make project maturity appear
    more complete.

## Retrospective Record Template

Historical entries should use this structure:

```markdown
## YYYY-MM-DD — Verification Title

**Record type:** RETROSPECTIVE
**Evidence grade:** STRONG | MODERATE | INSUFFICIENT

### Objective

Describe what was being verified.

### Revision / Release

Record the known revision, release, migration or deployment identifier.

If unknown:

`Unknown`

### Environment

Describe where the verification occurred.

### Method

Describe the verification method established by the available historical
evidence.

### Result

PASS | FAIL | PARTIAL | UNCONFIRMED

### Observed / Recovered Evidence

Record the concrete evidence recovered during retrospective reconstruction.

### Evidence Sources

List the evidence used to reconstruct the record.

### What This Proves

State only conclusions supported by the available evidence.

### What This Does Not Prove

State important limitations explicitly.

### Outstanding Uncertainty

Record anything that could not be established.

### Superseded By

Reference a later stronger verification record where applicable.

Otherwise:

`None`
```

---

# Evidence Precedence and Conflicts

Verification evidence may come from multiple sources.

No single source should automatically override all others.

When evaluating project state, consider:

1. source implementation;
2. test execution evidence;
3. deployment records;
4. runtime observations;
5. production observations;
6. current project state;
7. historical records.

Examples of legitimate conflicts include:

- Git `HEAD` does not contain currently deployed working-tree changes;
- a previously passing verification predates a later implementation change;
- documentation states an intended design that current implementation does not
  follow;
- deployment records show a release different from the latest commit;
- runtime behaviour contradicts expectations established by tests.

When a conflict exists:

- report it explicitly;
- identify each evidence source;
- do not silently resolve the contradiction;
- obtain stronger evidence where practical.

---

# Verification Freshness

Verification evidence has a scope in both behaviour and time.

A historical PASS does not prove that later implementation changes preserve the
same behaviour.

A verification record may become:

- still applicable;
- partially applicable;
- superseded;
- obsolete;
- uncertain after material implementation change.

Do not delete historical verification merely because it is no longer current.

Instead, create a later record and reference the earlier evidence where useful.

Where the implementation relevant to a verification has materially changed,
agents should avoid presenting old evidence as proof of current behaviour.

---

# Agent Rules

Any AI agent working on TAA-Platform must:

1. Read this file before making claims about test, deployment, runtime or
   production status.
2. Read `Codex/CURRENT-STATE.md` alongside this file when evaluating current
   project status.
3. Prefer direct evidence over assumptions.
4. Distinguish source evidence, test evidence, deployment evidence, runtime
   evidence and production evidence.
5. Never overwrite historical verification records merely because the current
   implementation has changed.
6. Add a new dated record when new verification supersedes or extends an old
   one.
7. Explicitly identify obsolete or potentially stale verification when the
   underlying implementation has materially changed.
8. Never fabricate verification.
9. Never mark a test `PASS` unless successful execution was actually
   established.
10. Never describe a test as executed merely because the test file exists.
11. Never describe deployment as established solely because deployable code or
    migration files exist.
12. Never describe canary evidence as production evidence unless the production
    path itself was tested.
13. Never convert `unknown` into `absent`.
14. Never convert implementation evidence into runtime evidence.
15. Record failures as faithfully as successes.
16. Treat this file as evidence history, not marketing or progress reporting.
17. Preserve uncertainty where the available evidence does not justify a
    stronger conclusion.
18. State when verification evidence is historical and may no longer represent
    current behaviour.
19. Do not infer that a JavaScript test is unrunnable merely because Jest or
    Vitest is absent; inspect whether Node's built-in `node:test` or another
    execution method is used.
20. When external runtime evidence is known but not reconstructable from Git,
    treat the evidence as external runtime evidence rather than denying its
    existence.
21. Never modify this log simply to make project maturity appear greater.
22. Preserve failures, partial results and contradictory evidence when they are
    material to understanding system reliability.

---

# Verification History Principle

The Verification Log is an engineering evidence ledger.

It should allow a future contributor or AI agent to answer:

- What existed?
- What was actually tested?
- What passed?
- What failed?
- What was deployed?
- What was observed at runtime?
- In which environment?
- Against which revision or release?
- What remained unknown?
- What did a particular verification not prove?
- Has later work superseded that evidence?

The implementation will evolve.

Verification history must remain auditable.
