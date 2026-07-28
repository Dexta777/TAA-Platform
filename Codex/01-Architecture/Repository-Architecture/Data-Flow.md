# Data Flow

> Information should move with purpose while ownership remains constant.

## Purpose

This document defines how information moves throughout the TAA Platform.

Data Flow governs the movement of information between Realms, Supporting Structures and external systems while preserving ownership, meaning and traceability.

Moving information never transfers responsibility for that information.

---

## Authority

This document governs:

- movement of information
- communication patterns
- events
- commands
- queries
- projections
- integration flow

---

## Scope

This document defines how information moves.

It does not define:

- state ownership
- dependency direction
- repository organisation
- implementation technology

Those concerns are defined in their canonical constitutional documents.

---

# Principles

## Ownership Never Moves

When information leaves a Realm, ownership remains with the originating Realm.

Consumers receive information.

They do not inherit authority over its meaning.

---

## Flow Should Be Intentional

Every movement should answer:

- Who owns this information?
- Why is it moving?
- Who consumes it?
- What happens if delivery fails?

Movement without purpose creates accidental architecture.

---

## Prefer Direct Communication

Information should travel directly from the authoritative owner whenever practical.

Unnecessary intermediaries increase complexity, latency and ambiguity.

---

## Communication Patterns

### Commands

Commands express intent.

They ask an owning Realm to perform work.

The receiving Realm decides whether the request succeeds.

### Queries

Queries request information without changing business state.

Where practical, queries should consume Public Capabilities rather than persistence.

### Events

Events communicate completed facts.

Events describe what has happened.

They should never instruct another Realm how to respond.

---

## Projections

Projections exist to optimise a specific use case such as reporting, search or read performance.

A projection is always derived.

It never becomes the source of truth.

---

## External Communication

External systems communicate through approved Interfaces and Gateways.

Provider-specific details should remain isolated from business flows.

---

## Failure and Traceability

Flows should make ownership and recovery explicit.

For important information it should always be possible to determine:

- where it originated
- which Realm owns it
- where it travelled
- whether it was transformed
- who is responsible if delivery fails

Silent data loss is unacceptable.

---

# Guidance for Artisans and Agents

Before introducing a new flow ask:

1. Does information genuinely need to move?
2. Which Realm owns its meaning?
3. Is a Command, Query or Event the correct interaction?
4. Is a Projection sufficient instead of another authority?
5. Does the flow preserve traceability?
6. Does this decision warrant an ADR?

---

# Signs of Flow Decay

- duplicated synchronisation
- undocumented transformations
- hidden data pipelines
- competing authorities
- business rules inside integrations
- consumers modifying another Realm's data directly

These indicate the need for Rectification.

---

# Closing Reflection

Information gains value through meaning.

Meaning belongs to the Realm that owns it.

Data Flow exists to ensure information may travel freely without allowing ownership to become fragmented.

────────────────────────────────────────────

The Atelier Doctrine

"Every iteration approaches perfection without claiming it."

Authority:
High

Status:
Living

Rectification:
1
