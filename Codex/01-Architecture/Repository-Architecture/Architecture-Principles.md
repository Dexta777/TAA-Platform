# Architecture Principles

> Architecture should make the coherent path easier than the incoherent one.

## Purpose

This document defines the principles used to evaluate architectural decisions within the TAA Platform.

Architectural Principles are rules of judgement. They guide decision-making when multiple technically valid solutions exist and preserve coherence as the platform evolves.

They do not prescribe technologies, frameworks or implementation patterns.

---

## Authority

This document governs:

- architectural judgement
- evaluation of proposals
- ownership decisions
- abstraction
- architectural boundaries
- Rectification

---

## Scope

This document defines how architectural decisions should be judged.

Definitions of architectural concepts belong in their canonical documents.

---

# The Nature of an Architectural Principle

A principle is not a preference.

A principle is a durable rule of judgement that influences future decisions.

A principle earns its place only when it consistently:

- solves a recurring problem
- reduces complexity
- improves architectural coherence

---

# Principles

## Responsibility Before Technology

Responsibilities should be discovered before technologies are selected.

Technology enables architecture.

It should never define it.

---

## Cohesion Over Convenience

Responsibilities that change together should remain together.

Responsibilities that change independently should remain separate.

Convenience should never become the organising force of the architecture.

---

## Explicit Ownership

Every significant responsibility should have an explicit owner.

Shared use does not imply shared ownership.

Ambiguity should be resolved before implementation proceeds.

---

## Deliberate Boundaries

Boundaries exist to preserve understanding.

A good boundary:

- makes ownership clear
- reduces accidental coupling
- hides implementation
- enables independent evolution

Every boundary should justify the complexity it introduces.

---

## Encapsulate Knowledge

Business knowledge should remain with the Realm that owns it.

Other parts of the platform should consume capabilities rather than reproduce that knowledge.

Encapsulation protects understanding from gradual divergence.

---

## Stable Meaning, Flexible Implementation

Implementation will evolve.

Architectural meaning should endure.

Frameworks, providers and programming languages may change without changing the ownership or purpose of the platform.

---

## Replaceability

Supporting Structures should remain replaceable wherever practical.

The business architecture should not become inseparable from a particular provider, framework or infrastructure choice.

---

## Abstraction Must Be Earned

Every abstraction introduces a new concept.

It should therefore solve a demonstrated problem rather than anticipate a hypothetical one.

Prefer honest duplication over premature abstraction.

---

## Complexity Must Pay Rent

Every architectural element increases the cognitive cost of the platform.

Complexity should only exist when it materially improves:

- clarity
- ownership
- resilience
- replaceability
- independent evolution

---

## Evolution Before Revolution

Architecture should evolve through deliberate, coherent refinement.

Prefer small, understandable changes over large rewrites that conceal multiple architectural decisions.

---

## Preserve Reasoning

Significant architectural decisions should be preserved through Architecture Decision Records.

Implementation explains what exists.

An ADR explains why.

---

## Make Failure Visible

Architecture should make failures observable.

Recovery begins with understanding.

Important flows should make ownership, failure and recovery responsibilities explicit.

---

## Security Follows Ownership

Security should reinforce architectural ownership.

Mechanisms may be implemented by Supporting Structures, but business authorisation remains the responsibility of the owning Realm.

---

## Rectification Over Concealment

When implementation and architecture diverge, investigate the cause.

Either:

1. implementation should change, or
2. the architecture should be rectified.

Neither outcome should occur silently.

---

# Evaluating an Architectural Proposal

Before accepting a proposal, ask:

1. What responsibility is being introduced?
2. Who owns it?
3. Does it strengthen cohesion?
4. Does it preserve clear boundaries?
5. Is the abstraction earned?
6. Is the complexity justified?
7. Does the reasoning deserve an ADR?

If these questions cannot be answered confidently, the proposal is not yet architecturally mature.

---

# Signs of Architectural Decay

Common indicators include:

- duplicated business knowledge
- ambiguous ownership
- circular dependencies
- infrastructure making business decisions
- unnecessary abstractions
- increasing cognitive complexity

These indicate the need for Rectification.

---

# Guidance for Artisans and Agents

Before changing the architecture:

1. Understand the responsibility.
2. Identify the owner.
3. Apply these principles.
4. Prefer the smallest coherent change.
5. Preserve significant reasoning.
6. Rectify related constitutional documents where understanding improves.

---

# Closing Reflection

Architecture is the stewardship of understanding.

Good architecture preserves meaning while allowing implementation to evolve.

Its purpose is not to maximise sophistication.

Its purpose is to make coherent decisions inevitable.

────────────────────────────────────────────

The Atelier Doctrine

"Every iteration approaches perfection without claiming it."

Authority:
High

Status:
Living

Rectification:
1
