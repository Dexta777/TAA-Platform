# ADR-0003 — Members Area Authentication

## Status

Accepted

## Context

Customer identity affects navigation, account access, password recovery, and checkout entry across
the TAA site. Webflow remains the presentation layer, while Supabase Auth is the canonical identity
system and TAA Platform JavaScript owns application behaviour. Creating page-specific Auth
controllers or allowing checkout to own a separate login lifecycle would duplicate session state
and make customer identity inconsistent across surfaces.

The Webflow component named `Header Global` is the intentional TAA global application shell on the
active surfaces selected by the site owner. Its predecessor is named `Header Legacy` and has no
intended instances. Some native Webflow Ecommerce and Webflow User pages remain as platform-managed
artifacts, but they are not part of the target identity architecture. No Webflow User accounts were
created, so no legacy user migration is required. Existing links, CMS-bound links, hidden elements,
and component references to those platform pages have not yet been exhaustively established.

## Decision

Authentication controls live in `Header Global` because customer identity is a site-wide concern.
The header presents `LOGIN` to guests and `ACCOUNT` to authenticated customers. `ACCOUNT` is a
semantic link to the canonical customer destination, `/account`.

One global Auth modal lives inside `Header Global` and supports login, signup, password-recovery
request, and password update during a verified recovery lifecycle. Checkout reuses this global
login surface. Checkout's create-account checkbox remains a separate future workflow and does not
share ownership with the global login modal.

There is one browser Auth lifecycle. The same Supabase session state controls `Header Global`,
protects `/account`, and drives the Auth modal. Session resolution is fail closed: guest and
authenticated controls remain hidden until identity is resolved, and stale authenticated UI is
cleared synchronously when identity must be reverified.

Ownership is divided as follows:

### Webflow

- markup;
- layout;
- styling;
- accessible semantic elements and initial hidden state.

### TAA Platform

- session lifecycle;
- Auth state;
- modal state and accessibility behaviour;
- visibility transitions;
- fixed safe redirects.

### Supabase Auth

- canonical customer identity;
- sessions;
- credential and recovery lifecycle.

Legacy Webflow Users and Ecommerce pages are not part of the target architecture. This decision
does not claim that all current references to their remaining platform pages have already been
identified or retired.

## Reasoning

A single lifecycle prevents duplicate session queries, conflicting UI states, and checkout-specific
identity rules. Keeping markup and styling in Webflow preserves the presentation boundary, while
attribute-driven JavaScript allows the component to evolve without coupling application behaviour
to generated Webflow classes. A literal `/account` destination avoids unnecessary navigation logic
and open-redirect risk.

## Alternatives Considered

### Account-Page-Only Authentication

Rejected. Login is needed across the site, and an account-only controller would make global
navigation unaware of identity.

### Checkout-Owned Login UI

Rejected. Checkout may consume the shared identity state, but it must not create a competing Auth
lifecycle or destination policy.

### Webflow Users

Rejected. Supabase Auth is the canonical identity system, and no Webflow User population requires
migration.

### Separate Desktop and Mobile Auth Modals

Rejected. Responsive controls may differ in markup, but they should open one shared modal and
consume one session state.

## Consequences

### Benefits

- Header, account, and checkout entry points observe one verified identity state.
- Guest and authenticated controls fail closed during initial resolution and identity changes.
- Webflow remains free to own presentation without becoming the authentication authority.
- Checkout can later integrate authenticated identity without duplicating login behaviour.

### Costs

- Every active `Header Global` instance must implement the documented data-attribute contract.
- Callback scrubbing and TAA handoff must execute before third-party scripts on Auth callback paths.
- Webflow contract wiring, publishing, Auth configuration, and browser verification remain separate
  operational gates.

## Rectification Conditions

Reconsider this decision only if the global application shell changes, Supabase Auth is replaced as
the canonical identity authority, or a future rendering architecture can preserve the same single
session lifecycle and fail-closed visibility guarantees more coherently.

## Related Documents

- [Customer Identity and Order Ownership](ADR-0002-customer-identity-and-order-ownership.md)
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
