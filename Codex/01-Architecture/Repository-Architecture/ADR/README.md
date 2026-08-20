# Architecture Decision Records

> Architectural decisions should preserve their reasoning, not merely their outcome.

## Purpose

This directory contains Architecture Decision Records for the TAA Platform.

An Architecture Decision Record, or ADR, preserves a significant architectural decision together with the context, reasoning, alternatives, consequences, and current status of that decision.

The purpose of an ADR is not to prove that a decision was perfect.

Its purpose is to make the decision understandable.

---

## When an ADR Is Required

Create an ADR when a decision:

- changes repository structure
- establishes or removes an architectural boundary
- introduces a significant dependency
- selects or replaces an external platform
- changes a source of truth
- affects more than one Realm
- establishes a pattern future work is expected to follow
- would be difficult to reverse
- requires future artisans to understand why it was made

Routine implementation choices do not require ADRs.

---

## Naming Convention

Use sequential numbers and descriptive kebab-case titles.

```text
ADR-0001-establish-repository-realms.md
ADR-0002-adopt-supabase-as-commerce-source-of-truth.md
ADR-0003-isolate-stripe-behind-a-gateway.md
```

Numbers are never reused.

Rejected or superseded ADRs remain part of the architectural history.

---

## ADR Statuses

Each ADR should use one of the following statuses:

- Proposed
- Accepted
- Rejected
- Superseded
- Deprecated

An accepted ADR may later be superseded, but it should not be rewritten to conceal its original reasoning.

---

## ADR Template

```markdown
# ADR-0000 — Decision Title

## Status

Proposed

## Context

What condition, constraint, or recurring problem requires a decision?

## Decision

What has been decided?

## Reasoning

Why is this decision considered the most coherent option?

## Alternatives Considered

### Alternative One

Why was it considered?

Why was it not selected?

### Alternative Two

Why was it considered?

Why was it not selected?

## Consequences

### Benefits

What becomes easier, clearer, safer, or more coherent?

### Costs

What complexity, limitation, or obligation does the decision introduce?

## Rectification Conditions

Under what future conditions should this decision be reconsidered?

## Related Documents

- [Repository Architecture](../README.md)

## Related Leaves

- [Leaf II — Architecture](../../../Leaves/Leaf-II-Architecture.md)

────────────────────────────────────────────

The Atelier Doctrine

"Every iteration approaches perfection without claiming it."

Authority:
High

Status:
Proposed

Rectification:
0
```

---

## ADR Index

- [ADR-0001 — Reservation-Owned Checkout Finalization](ADR-0001-reservation-owned-checkout-finalization.md)
- [ADR-0002 — Customer Identity and Order Ownership](ADR-0002-customer-identity-and-order-ownership.md)

---

## Related Documents

- [Repository Architecture](../README.md)
- [Repository Topology](../Repository-Topology.md)
- [Architecture Principles](../Architecture-Principles.md)
- [Dependency Rules](../Dependency-Rules.md)

## Related Leaves

- [Leaf I — Genesis](../../../Leaves/Leaf-I-Genesis.md)
- [Leaf II — Architecture](../../../Leaves/Leaf-II-Architecture.md)

────────────────────────────────────────────

The Atelier Doctrine

"Every iteration approaches perfection without claiming it."

Authority:
High

Status:
Living

Rectification:
0
