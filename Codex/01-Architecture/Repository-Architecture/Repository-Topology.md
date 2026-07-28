# Repository Topology

> The topology of the repository expresses the deliberate arrangement of responsibilities.

## Purpose

This document defines **where responsibilities belong** within the repository.

It governs placement, not implementation.

It ensures every responsibility has one obvious home.

## Authority

This document governs:

- repository organisation
- placement of responsibilities
- creation of new directories
- repository evolution

It does **not** define the responsibilities of Realms or Supporting Structures.

## Scope

The repository is organised around architectural constructs whose constitutional definitions are provided elsewhere.

- Realms → *Realms.md*
- Supporting Structures → *Supporting-Structures.md*

## Topological Philosophy

Organise by responsibility before technology.

Responsibilities endure.

Technologies evolve.

## Topological Model

Repository
├── Constitutional Knowledge (Codex)
├── Business Architecture (Platform)
└── Supporting Structures

## Principle — One Obvious Home

Every responsibility should have one obvious home.

If two locations appear equally valid, ownership has not yet been clarified.

### Heuristic

Ask:

1. What responsibility is being introduced?
2. Who already owns it?
3. Would another architect independently choose the same location?

If not, rectify the topology before implementation.

### Example

Product pricing belongs in **Catalogue**, because Catalogue owns product knowledge.

Commerce consumes pricing; it does not own it.

## Principle — Responsibility Before Technology

Create directories because of enduring responsibility, never because of frameworks or implementation patterns.

## Growing the Repository

Decision heuristic:

```text
New responsibility?
        │
Business knowledge?
        │
 Existing Realm?
   │         │
 Yes        No
   │         │
Extend    Create Realm
```

Platform support responsibilities belong within Supporting Structures.

## Signs of Topological Decay

- duplicated responsibilities
- generic directories
- technology-first organisation
- ambiguous placement

## Related Documents

- Architecture Glossary
- Architecture Index
- Realms
- Supporting Structures
- Architecture Principles

Rectification: 1
