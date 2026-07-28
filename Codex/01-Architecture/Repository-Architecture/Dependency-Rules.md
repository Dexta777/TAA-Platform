# Dependency Rules

> Dependencies should strengthen understanding rather than increase coupling.

## Purpose

This document defines the permitted dependency relationships within the TAA Platform.

Dependency Rules preserve architectural coherence by ensuring dependencies point toward stable business meaning rather than volatile implementation.

---

## Authority

This document governs:

- dependency direction
- Realm dependencies
- Supporting Structure dependencies
- external provider access
- shared abstractions
- architectural coupling

---

## Scope

This document defines architectural dependency relationships.

It does not define implementation techniques, programming language imports or package management.

---

# Principles

## Depend Upon Meaning

Dependencies should be formed around capabilities and responsibilities, never implementation details.

Business meaning should remain stable even when technology changes.

---

## Realm Dependencies

A Realm may depend upon another Realm only through its Public Capabilities.

A Realm should never depend upon:

- internal implementation
- persistence details
- provider APIs
- internal repository structure

---

## Supporting Structures

Supporting Structures enable Realms.

They should never direct business behaviour or become alternate business owners.

---

## External Providers

External systems should always be isolated behind Gateways.

The business architecture depends upon the Gateway.

The Gateway depends upon the provider.

---

## Shared Responsibilities

Shared abstractions should exist only when responsibility is genuinely shared.

Do not introduce shared code simply to remove duplication.

---

## Circular Dependencies

Circular dependencies indicate unclear ownership.

Rather than accepting the cycle, clarify the architectural boundary.

---

## Minimal Coupling

Every dependency introduces knowledge.

Prefer the smallest dependency that faithfully expresses the required responsibility.

---

# Guidance for Artisans and Agents

Before introducing a dependency ask:

1. Who owns the capability?
2. Am I depending on meaning or implementation?
3. Can an existing Public Capability be used?
4. Is a Gateway required?
5. Does this increase coupling unnecessarily?
6. Does this decision require an ADR?

---

# Signs of Dependency Decay

- circular dependencies
- duplicated integrations
- direct provider access
- hidden runtime coupling
- shared utilities becoming business owners
- Realms accessing each other's persistence

These indicate the need for Rectification.

---

# Closing Reflection

Dependencies express relationships of trust.

Well-designed dependencies clarify ownership while preserving independence.

The strongest architecture is one where every dependency exists for a deliberate and understandable reason.

────────────────────────────────────────────

The Atelier Doctrine

"Every iteration approaches perfection without claiming it."

Authority:
High

Status:
Living

Rectification:
1
