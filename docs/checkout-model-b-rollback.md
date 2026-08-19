# Model B Emergency Checkout Rollback

## Status

**IMPLEMENTED LOCALLY / NOT DEPLOYED / NOT PRODUCTION-PROVEN**

This document describes the bounded failsafe that is intended to let Meg disable new ordinary
reservation-v1 admission when Dexter cannot respond within the five-minute rollback SLA. The local
implementation does not authorize deployment or global reservation enablement.

The source is in [`infra/checkout-model-b`](../infra/checkout-model-b). No AWS resource, AWS
credential, Supabase credential, production configuration, or checkout runtime code was created or
changed by the local implementation.

## Safety contract

The only permitted outcome is removal of the fixed production Edge Function secret:

```text
CHECKOUT_RESERVATIONS_ENABLED
```

Absence is OFF because checkout enables global reservation admission only when the normalized
value is exactly `true`. Removing the flag sends genuinely new ordinary checkouts to the legacy
route. It does not cancel or convert existing reservation-v1 attempts and does not disable Stripe
webhooks, reconciliation, lifecycle monitoring, targeted recovery, or separate canary admission.

The control cannot enable the flag. Meg cannot supply a project ref, secret name, value, HTTP
method, URL, Lambda ARN, shell command, or Automation parameter.

## Architecture

```text
Meg named console-only IAM identity
        │ hardware FIDO MFA required
        ▼
TAA-EmergencyDisableCheckoutReservations
pinned SSM Automation document version 1
        │ request tag fixed by IAM:
        │ TAA-Control = CheckoutModelB
        │ zero document parameters
        ▼
immutable Lambda version ARN
        │
        ├─ fixed Management API origin
        ├─ fixed production project configuration
        ├─ DELETE only
        ├─ body exactly ["CHECKOUT_RESERVATIONS_ENABLED"]
        └─ dedicated server-side token
        ▼
sanitized receipt + AWS execution audit
```

The SSM execution role can invoke only the published immutable Lambda version. The Lambda execution
role can read only the pre-provisioned AWS secret
`taa/model-b/supabase-management-token` and write only to the dedicated Model B log group. The
template does not create that secret, a secret value, a console password, or an access key.

## Fixed Management API operation

The handler rejects every non-empty invocation payload before reading the credential. Its only
outbound request is:

- origin: fixed in source as `https://api.supabase.com`;
- path: fixed production project configuration plus `/secrets`;
- method: `DELETE`;
- body: exactly `["CHECKOUT_RESERVATIONS_ENABLED"]`;
- timeout: 8 seconds inside a 15-second Lambda timeout;
- success: authenticated HTTP 200 only.

It never issues a secret-list/read request and never reads or returns the Management API response
body. It fails closed on invalid configuration, unavailable credentials, network failure, timeout,
HTTP 401, HTTP 403, HTTP 429, or any status other than 200.

A success returns only:

```json
{
  "action": "emergency_disable_checkout_reservations",
  "result": "OFF_CONFIRMED",
  "verified_off": true,
  "receipt_id": "generated UUID",
  "completed_at_utc": "UTC timestamp"
}
```

`verified_off` means the fixed authenticated DELETE received the approved control-plane success
status. It does not depend on a value-bearing GET. The token, Authorization header, project ref,
provider response body, customer data, and checkout identifiers are absent from logs and receipts.

## Credential boundary

Provision one purpose-specific Supabase Management API credential into the dedicated AWS secret at
deployment time. Its required fine-grained permission is:

```text
edge_functions_secrets_write
```

`edge_functions_secrets_read` is neither required nor permitted by this design. Never use Dexter's
Owner PAT, Brad's broad human credential, a service-role key, or an alert-delivery credential.

Production-project/resource scoping of the fine-grained token is a mandatory provisioning-time
verification gate. If Supabase cannot enforce the intended project scope, stop before deployment
and record the residual management-token blast radius for explicit security review. Do not add
secret-read permission to compensate.

## Meg identity and permissions

The template models named user `taa-meg-checkout-rollback` with:

- no programmatic access key;
- no template-created login profile or password;
- a permissions boundary matching the Model B execution surface;
- an identity policy limited to starting version `1` of the exact Automation document with fixed
  execution tag `TAA-Control=CheckoutModelB`, viewing only execution receipts carrying that tag,
  and passing only the fixed Automation execution role to SSM;
- MFA-required allow statements plus an explicit no-MFA deny;
- explicit denial of access-key and service-specific credential management.

Meg receives no Lambda invocation or administration, Secrets Manager, IAM administration, SNS,
SES, CloudWatch Logs, Parameter Store, Supabase, database, deployment, checkout, monitoring,
reconciliation, webhook, or feature-enable permission through this identity.

The fixed execution tag is authorization metadata, not an Automation target or checkout input. The
SSM document still has zero parameters. `aws:RequestTag/TAA-Control` and `aws:TagKeys` require the
one approved tag when the execution starts; `aws:ResourceTag/TAA-Control` limits receipt reads to
Model B executions. Meg has no `ssm:AddTagsToResource` or `ssm:DescribeAutomationExecutions`
permission and cannot browse or retag unrelated Automation executions.

FIDO registration, console-login recovery, absence of programmatic credentials, document-version
pinning, and the effective policy result must be verified after provisioning. Static source review
cannot substitute for AWS IAM simulation and a supervised login drill.

## Idempotency

The handler treats every authenticated HTTP 200 from the fixed DELETE as `OFF_CONFIRMED`:

1. flag present, DELETE returns 200: success;
2. flag absent, DELETE returns 200: safe repeated success;
3. flag absent, API behaviour not yet established: deployment remains blocked.

Before production deployment, run the same fixed-delete contract against a non-production test
flag twice: once while present and once while already absent. Both calls must return the documented
success status without requiring `edge_functions_secrets_read`. If absent-target deletion is not a
safe success, stop. Do not silently add a GET or read permission.

## Operator procedure after deployment

This procedure is **not operational until every deployment gate below passes**.

1. **IDENTIFY:** record UTC time, `ROLLBACK_REQUIRED` reasons, and safe aggregate metrics.
2. **SIGN IN:** Meg uses her named AWS console-only identity and registered hardware FIDO factor.
3. **SELECT:** open only `TAA-EmergencyDisableCheckoutReservations`, pinned version `1`.
4. **TAG:** in the Automation execution page's **Tags** section, enter exactly key `TAA-Control`
   and value `CheckoutModelB`. Do not add another tag. This is authorization metadata required by
   IAM, not a document parameter or execution target.
5. **VERIFY INPUTS:** the Automation page must expose zero document parameters. If any input is
   requested, STOP.
6. **EXECUTE:** start the one Automation execution. Do not start another document or version.
7. **VERIFY RECEIPT:** require `OFF_CONFIRMED`, `verified_off: true`, a receipt UUID, and UTC time.
   `Already OFF` is a successful outcome after the non-production idempotency gate passes.
8. **PRESERVE:** leave existing v1 attempts, webhooks, reconciliation, monitoring, targeted recovery,
   and canary admission unchanged.
9. **RECORD:** place only the safe receipt fields and Automation execution reference in the incident
   record. Never copy logs, credentials, response bodies, or infrastructure identifiers.
10. **STOP:** do not re-enable reservations. Re-enablement remains Dexter/authorized-human work under
    the separate gate.

Any control failure, unexpected prompt, missing MFA, unexpected status, or missing receipt is a
STOP condition. Escalate; do not use a broad credential or ad hoc Supabase operation to make the
drill pass.

## Audit and failure behaviour

The durable audit consists of the named IAM principal and SSM Automation execution recorded by AWS,
the single immutable Lambda invocation, and the sanitized success/failure event in the dedicated
365-day log group. A successful receipt contains no sensitive identifier. Failures record only a
bounded reason code such as configuration invalid, credential unavailable, network error, timeout,
unauthorized, forbidden, rate-limited, or unexpected status.

AWS CloudTrail/SSM retention and operator access to the specific execution receipt must be verified
at deployment time. Meg does not need general CloudWatch Logs access.

## Deployment and verification gates

Do not deploy until a separate review approves all of the following:

1. the local source, dependency lock, template, IAM policies, tests, and documentation are committed
   and reviewed;
2. the dedicated Management API token has only `edge_functions_secrets_write` and its production
   project/resource scope is verified;
3. the two-call non-production present/absent test proves DELETE idempotency without a GET;
4. the reviewed deployment package is built from the lock file, its SHA-256 is supplied to the
   Lambda version, and the SSM document points to the resulting version ARN;
5. no conflicting SSM document exists, the first deployed document version is exactly `1`, and Meg
   cannot select `$LATEST` or another version;
6. AWS IAM policy simulation proves the Meg identity/boundary, Automation role, and Lambda role
   allow the intended path and deny the prohibited actions, including untagged or differently tagged
   execution starts and reads of unrelated Automation executions;
7. the AWS secret is provisioned securely without placing its value in argv, logs, source,
   CloudFormation parameters, shell history, or template output;
8. Meg's named console login and hardware FIDO MFA are configured, recoverable, and have no access
   key;
9. a safe synthetic package test proves receipts and logs remain sanitized;
10. while global reservations are already OFF, Meg completes a supervised production execution and
    receives `OFF_CONFIRMED` within five minutes without changing canary admission or lifecycle
    services;
11. independent operator evidence confirms the global flag remains absent by name/metadata only and
    the reconciler, monitor, webhooks, and targeted recovery remain available.

Static tests must be supplemented by deployment-time IAM simulation, CloudFormation change-set
review, document-version inspection, CloudTrail/SSM receipt inspection, and the supervised drill.

## Local verification

Run from the repository root:

```bash
node --test infra/checkout-model-b/tests/*.test.mjs
npx eslint \
  infra/checkout-model-b/src/disable-checkout-reservations.mjs \
  infra/checkout-model-b/tests/*.test.mjs
npx prettier --check infra/checkout-model-b docs/checkout-model-b-rollback.md
git diff --check
```

The tests mock the credential provider and network boundary; they require no AWS or Supabase
credential. They cover the fixed request, rejected input, failure classifications, non-leaking
receipt/log behaviour, repeated mocked success, zero-parameter Automation, immutable-version pin,
structured parsing of the fixed request/resource-tag conditions in both Meg policies, rejection of
unsafe policy variants, exact-role permissions, and absence of secret creation.

## Removing Model B itself

Removal is a separate authorized AWS change. First revoke Meg's execution policy, then disable or
remove the pinned SSM document, Lambda version/function, and the two execution roles through the
reviewed infrastructure stack. Preserve the incident/CloudTrail audit and log retention required by
policy. Remove the dedicated AWS secret only after confirming no deployed Model B version depends
on it. Removing Model B must never create or set `CHECKOUT_RESERVATIONS_ENABLED` and does not alter
checkout data or lifecycle services.
