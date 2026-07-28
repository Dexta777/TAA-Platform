# State Management

> State should have one owner, one meaning and one authoritative home.

## Purpose

This document defines how state is owned, classified and managed throughout the TAA Platform.

State Management preserves architectural coherence by ensuring every meaningful piece of information has one authoritative owner throughout its lifecycle.

---

## Authority

This document governs:

- ownership of state
- sources of truth
- persisted state
- derived state
- cached state
- ephemeral state
- state lifecycles

---

## Scope

This document defines architectural stewardship of state.

It does not define storage technologies, framework-specific state libraries or implementation patterns.

---

# Principles

## One Source of Truth

Every authoritative fact has one declared source of truth.

Only the owning Realm defines its meaning and validity.

---

## Ownership Before Storage

Architecture cares first about ownership.

Storage technologies may change.

Ownership should not.

Persistence stores state.

It does not own it.

---

## Categories of State

### Authoritative State

The canonical business information owned by a Realm.

### Derived State

Calculated from authoritative information.

It should always be reproducible.

### Cached State

Maintained solely to improve performance.

Caches are never authoritative.

### Ephemeral State

Temporary information whose value ends with the activity that created it.

---

## State Mutation

Only the owning Realm may modify authoritative business state.

Other parts of the platform may query, project or cache that state but should never become competing authorities.

Every significant mutation should be intentional, validated and traceable.

---

## State Lifecycle

Every important state should define:

1. Creation
2. Validation
3. Mutation
4. Consumption
5. Archival
6. Deletion

---

## Synchronisation

Synchronisation exists to align representations of authoritative information.

It should never create additional authorities.

Recovery should be deterministic whenever synchronisation fails.

---

## Immutable History

Historical business facts should remain immutable wherever practical.

History informs future decisions.

It should not be rewritten.

---

# Guidance for Artisans and Agents

Before introducing new state ask:

1. Which Realm owns it?
2. Is it authoritative, derived, cached or ephemeral?
3. Can it be reproduced?
4. Who may modify it?
5. What is its lifecycle?
6. Does this require an ADR?

---

# Signs of State Decay

- multiple writable copies
- hidden mutations
- duplicated business knowledge
- caches becoming authoritative
- unclear ownership
- inconsistent lifecycle management

These indicate the need for Rectification.

---

# Closing Reflection

State is the memory of the platform.

Its value lies not in where it is stored but in who remains responsible for its meaning.

When ownership remains singular, trust is preserved.

────────────────────────────────────────────

The Atelier Doctrine

"Every iteration approaches perfection without claiming it."

Authority:
High

Status:
Living

Rectification:
1
