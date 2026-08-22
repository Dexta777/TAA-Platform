# ADR-0004 — Customer Communication Preference Ownership

## Status

Accepted

## Context

TAA customers need to control optional order-status notifications and marketing communications
without weakening essential transactional delivery. Marketing choices also require durable evidence
of the customer's action and the notice version presented at that time. A browser-writable boolean
alone cannot preserve that evidence, and an event-only model would make current-state reads more
complex than the Settings product needs.

Customer identity is already owned by `auth.users`, with `public.customer_profiles` as its
one-to-one application projection. Communication preferences must use the same identity boundary,
must not accept browser-supplied ownership or audit metadata, and must remain independent of
Klaviyo or any other delivery provider.

## Decision

TAA separates current customer preference state from immutable transition evidence:

- `public.customer_preferences` stores one current-state row per Auth user;
- `public.customer_preference_events` stores server-authored evidence for each real transition;
- both relations use the Auth user ID as their ownership boundary and currently cascade when that
  Auth user is deleted;
- a narrowly scoped authenticated `public.set_customer_preference_v1` RPC is the only routine
  mutation path;
- the RPC derives `user_id`, timestamps, event source, and the authoritative marketing notice
  version on the server, locks the current-state row, and writes state plus evidence atomically;
- same-value requests return authoritative state without fabricating an event;
- authenticated browsers may read only their own current state and have no direct write or event
  access;
- routine service-role access is read-only and has no event update or deletion privilege.

Optional order-status updates default to enabled, including when no current-state row exists. This
preference controls only optional fulfilment convenience messages. It never suppresses order
confirmations, payment or receipt information, fulfilment-critical messages, account or security
communications, or legally or operationally necessary service messages.

Marketing communications default to disabled, including when no current-state row exists. A real
marketing transition requires explicit customer action and the current application handshake
version `account-settings-marketing-v1`. The database records that server-owned version rather than
treating caller input as evidence. The exact customer-facing wording associated with a notice
version is owned by product documentation and remains separate from this schema decision.

## Reasoning

One current-state row makes account rendering direct and allows defaults to remain explicit. A
separate append-only event stream preserves who changed what, when, from which approved product
surface, and against which marketing notice version. Performing both writes in one database
function prevents partial state, browser-authored evidence, and races during lazy first use.

Lazy row creation avoids migration backfills and profile-trigger coupling. Defaults are defined in
the table, RPC, and product semantics, so a missing row remains meaningful without weakening the
first mutation. No additional index is needed for the primary-key current-state lookup; one
composite index supports ordered per-user event history.

## Alternatives Considered

### Direct Browser Writes Plus a Trigger

Rejected. A trigger could append evidence, but direct browser writes would require a broader table
mutation surface and make the notice-version handshake and lazy first-use contract less explicit.

### Current-State Booleans Without Event History

Rejected. This would not preserve marketing consent and withdrawal evidence over time.

### Event History Without a Current-State Table

Rejected. Reconstructing every account view from an event stream adds unnecessary query and
concurrency complexity at TAA's current scale.

### Eager Rows Created by the Auth Profile Trigger

Rejected for this phase. Preferences need not expand the identity trigger, and lazy creation keeps
the migration additive with no customer-row backfill.

### Delivery-Provider-Owned Preferences

Rejected. Klaviyo or another delivery tool may later consume authorized state, but it is not the
customer preference source of truth.

## Consequences

### Benefits

- Auth ownership, RLS, grants, and the RPC form one explicit security boundary.
- Marketing enablement, withdrawal, source, time, and notice version remain auditable.
- Concurrent first use converges on one current row and truthful committed transitions.
- Essential transactional communications cannot be disabled by either preference.
- Delivery providers can change without moving ownership of customer choice.

### Costs

- Settings runtime must call the RPC rather than writing preference columns directly.
- Notice-version changes require a deliberately coordinated product and database change.
- Event data introduces a retention decision before customer account deletion can be offered.
- The migration and UI remain separate deployment gates; accepted architecture does not mean the
  schema is applied or the Settings product exists.

## Account-Deletion Retention Boundary

The initial relations use `ON DELETE CASCADE` because TAA has no customer account-deletion product
workflow. Before introducing one, TAA must separately decide consent-evidence retention,
withdrawal or suppression evidence, erasure requirements, and whether preference history should
survive identity deletion. This ADR does not justify retaining additional PII to solve that future
problem.

## Rectification Conditions

Reconsider this decision if account deletion requires retained consent evidence, a legal review
changes the evidence requirements, preference writes move to a trusted server workflow, or the
number and complexity of preferences make the versioned RPC contract unsuitable.

## Related Documents

- [Customer Identity and Order Ownership](ADR-0002-customer-identity-and-order-ownership.md)
- [Members Area Authentication](ADR-0003-members-area-authentication.md)
- [Repository Architecture](../README.md)
- [Current State](../../../CURRENT-STATE.md)

────────────────────────────────────────────

The Atelier Doctrine

"Every iteration approaches perfection without claiming it."

Authority:
High

Status:
Accepted

Rectification:
0
