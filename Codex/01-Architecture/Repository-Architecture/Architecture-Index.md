# Architecture Index

> The Architecture Index is the primary navigation guide to the Constitutional Architecture of the TAA Platform.

## Purpose

This document provides a question-oriented index to the architectural documents within the Codex.

Rather than navigating by filenames, artisans and agents should begin with the architectural question they are trying to answer.

The Index directs them to the document that is authoritative for that concern.

---

## Authority

This document governs architectural navigation.

It does not define architectural law.

The referenced documents remain authoritative.

---

## Scope

This index covers the Constitutional Architecture of the platform contained within Leaf II.

---

# Begin With the Question

## Where should this responsibility live?

→ Repository Topology

Questions include:

- Where does this belong?
- Should this become a new directory?
- Does this responsibility already have a home?
- Is this repository structure coherent?

---

## Who owns this business behaviour?

→ Realms

Questions include:

- Which Realm owns this?
- Is this business logic?
- Should this become a new Realm?
- Which Public Capability should expose this?

---

## Is this infrastructure or business?

→ Supporting Structures

Questions include:

- Is this a Gateway?
- Is this persistence?
- Is this automation?
- Is this an Interface?
- Does this support the business without owning it?

---

## How should an architect evaluate this decision?

→ Architecture Principles

Questions include:

- Is this good architecture?
- Is this abstraction earned?
- Is complexity justified?
- Does this strengthen ownership?
- Does this preserve cohesion?

---

## Can these components depend upon one another?

→ Dependency Rules

Questions include:

- Is this dependency allowed?
- Which direction should dependencies flow?
- Should this dependency go through a Public Capability?
- Should a Gateway be introduced?

---

## How should information move?

→ Data Flow

Questions include:

- Should this be an Event?
- Is this a Command?
- Should this be a Query?
- Should this become a Projection?
- How should failures be handled?

---

## Who owns this information?

→ State Management

Questions include:

- Is this authoritative?
- Is this derived state?
- Is this cached?
- Where is the Source of Truth?
- Who may modify this state?

---

## Why does the architecture look like this?

→ Architecture Decision Records (ADR)

Questions include:

- Why was this introduced?
- Why was another approach rejected?
- What assumptions existed at the time?
- When should this decision be reconsidered?

---

## What does this architectural term mean?

→ Architecture Glossary

Questions include:

- What is a Realm?
- What is a Public Capability?
- What is Rectification?
- What is a Projection?
- What is Stewardship?

---

# Constitutional Reading Order

New contributors should read the constitutional documents in the following order:

1. Repository Topology
2. Architecture Glossary
3. Realms
4. Supporting Structures
5. Architecture Principles
6. Dependency Rules
7. Data Flow
8. State Management
9. Architecture Decision Records

This order progresses from repository organisation through business ownership, technical support, architectural judgement and operational behaviour.

---

# Constitutional Relationship

The constitutional documents answer different questions.

| Question | Authority |
|----------|-----------|
| Where does responsibility belong? | Repository Topology |
| What do these terms mean? | Architecture Glossary |
| Who owns business knowledge? | Realms |
| What supports the business? | Supporting Structures |
| How should architects think? | Architecture Principles |
| Who may depend upon whom? | Dependency Rules |
| How does information move? | Data Flow |
| Who owns information? | State Management |
| Why was this decision made? | ADR |

Together they form the Constitutional Architecture of the TAA Platform.

---

# Guidance for Artisans and Agents

When making an architectural decision:

1. Begin with the question.
2. Use this index to locate the authoritative document.
3. Follow the constitutional guidance.
4. Record significant deviations through an ADR.
5. Rectify the Constitution if understanding evolves.

The Constitution exists to guide future decisions rather than merely explain past ones.

---

# Closing Reflection

Architecture is easier to navigate when organised around questions rather than documents.

The Architecture Index exists to ensure that every important architectural question has one obvious place to begin.

It is the doorway into the Constitutional Architecture of the TAA Platform.

────────────────────────────────────────────

The Atelier Doctrine

"Every iteration approaches perfection without claiming it."

Authority:
High

Status:
Living

Rectification:
0
