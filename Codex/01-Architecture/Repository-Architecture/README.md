# Repository Architecture

> The repository is organised by responsibility so that every part of the platform has one obvious home.

## Purpose

This directory defines the architectural organisation of the TAA Platform repository.

Its purpose is not merely to catalogue directories or implementation details.

It preserves the reasoning by which responsibilities are organised, boundaries are maintained, dependencies are controlled, and future growth remains coherent.

The repository should communicate the structure of the platform before an artisan reads its implementation.

---

## Authority

The documents within this directory govern:

- repository organisation
- architectural responsibility
- placement of new capabilities
- boundaries between areas of the platform
- dependency direction
- ownership of state
- movement of data
- architectural decision-making

Where implementation conflicts with the documented architecture, implementation should not automatically be treated as authoritative.

The discrepancy should first be understood.

If implementation reveals a better architectural pattern, the architecture should be rectified deliberately and the reasoning preserved through an Architecture Decision Record.

---

## Scope

This directory concerns the architectural shape of the repository.

It does not define:

- coding style
- framework-specific conventions
- user interface design
- deployment procedures
- operational runbooks
- product requirements
- detailed implementation APIs

Those concerns belong elsewhere within the Codex.

---

## Architectural Question

Leaf II centres upon one question:

> **How should the platform be organised so that it remains coherent as it evolves?**

Each document within this directory answers one part of that question.

---

## Reading Order

Read these documents in the following order when seeking a complete understanding of the architecture.

### 1. [Repository Topology](./Repository-Topology.md)

Answers:

> **Where does responsibility live?**

Defines the overall shape of the repository, the distinction between Realms and Supporting Structures, and the principle that every responsibility should have one obvious home.

---

### 2. [Realms](./Realms.md)

Answers:

> **Which business capability owns each responsibility?**

Defines the enduring business capabilities of the platform and the boundaries between them.

---

### 3. [Supporting Structures](./Supporting-Structures.md)

Answers:

> **How are non-domain concerns organised?**

Defines Interfaces, Gateways, Infrastructure, Tests, Scripts, and the structures that support the Realms without owning business meaning.

---

### 4. [Architecture Principles](./Architecture-Principles.md)

Answers:

> **What makes an architectural decision coherent?**

Defines the principles used to evaluate architecture before implementation begins.

---

### 5. [Dependency Rules](./Dependency-Rules.md)

Answers:

> **Who may depend on whom?**

Defines permitted dependency direction and protects the platform from accidental coupling.

---

### 6. [Data Flow](./Data-Flow.md)

Answers:

> **How does truth move through the platform?**

Defines how information enters, travels through, and leaves the system.

---

### 7. [State Management](./State-Management.md)

Answers:

> **Who owns each form of state?**

Defines state ownership, persistence boundaries, derived state, transient state, and sources of truth.

---

### 8. [Architecture Decision Records](./ADR/README.md)

Answers:

> **Why was an architectural decision made?**

Preserves architectural reasoning so that future artisans and agents do not infer intent from implementation alone.

---

## Architectural Model

The repository is understood through four levels:

```text
Repository
│
├── Realms
│   └── Modules
│       └── Implementation
│
└── Supporting Structures
    └── Implementation
```

### Repository

The complete organised body of platform knowledge and implementation.

### Realms

Enduring business capabilities that own distinct areas of business understanding.

### Modules

Cohesive responsibilities within a Realm.

### Supporting Structures

Technical structures that enable the Realms without owning the purpose of the business.

### Implementation

The concrete expression of those responsibilities through code, configuration, schemas, and tests.

---

## Current Architectural Sequence

```text
Repository Topology
        │
        ▼
Realms and Supporting Structures
        │
        ▼
Architecture Principles
        │
        ▼
Dependency Rules
        │
        ▼
Data Flow
        │
        ▼
State Management
        │
        ▼
Architecture Decision Records
```

Each document depends conceptually upon those before it.

Later documents should not contradict earlier ones without deliberate Rectification.

---

## Navigating the Architecture

Use the following guide when approaching a question.

| Question                                       | Read                          |
| ---------------------------------------------- | ----------------------------- |
| Where should this capability live?             | Repository Topology           |
| Which business area owns this decision?        | Realms                        |
| Is this domain logic or supporting technology? | Supporting Structures         |
| Is this architectural choice coherent?         | Architecture Principles       |
| May this area depend upon another?             | Dependency Rules              |
| How should this information travel?            | Data Flow                     |
| Where should this state live?                  | State Management              |
| Why was the current approach chosen?           | Architecture Decision Records |

---

## Cross-Reference Convention

Architectural documents should conclude with relevant relationships where they exist.

Use the following structure:

```text
Related Documents

- [Document Name](./Document-Name.md)

Related Leaves

- [Leaf I — Genesis](../../Leaves/Leaf-I-Genesis.md)

Related ADRs

- [ADR-0001 — Decision Title](./ADR/ADR-0001-decision-title.md)
```

Only include relationships that materially assist understanding.

Cross-references should not become decorative lists.

They should reveal meaningful connections between principles, decisions, and implementation.

---

## Document Relationships

### Related Documents

- [Repository Topology](./Repository-Topology.md)
- [Realms](./Realms.md)
- [Supporting Structures](./Supporting-Structures.md)
- [Architecture Principles](./Architecture-Principles.md)
- [Dependency Rules](./Dependency-Rules.md)
- [Data Flow](./Data-Flow.md)
- [State Management](./State-Management.md)
- [Architecture Decision Records](./ADR/README.md)

### Related Leaves

- [Leaf I — Genesis](../../Leaves/Leaf-I-Genesis.md)
- [Leaf II — Architecture](../../Leaves/Leaf-II-Architecture.md)

### Related ADRs

No Architecture Decision Records have yet coagulated.

---

## Guidance for Artisans and Agents

Before introducing a new directory, abstraction, dependency, state store, gateway, or architectural pattern:

1. Read this document.
2. Read the document governing the relevant concern.
3. Inspect the existing architecture.
4. Identify the responsibility being introduced.
5. Determine its rightful owner.
6. Confirm that the dependency direction remains valid.
7. Reuse an existing structure where responsibility already exists.
8. Create a new structure only when a genuinely new responsibility has emerged.
9. Record significant architectural decisions through an ADR.
10. Rectify the Codex when practice reveals a better understanding.

Do not infer architectural intent from code alone.

Implementation shows what currently exists.

The Codex preserves why it exists.

---

## Stewardship

Repository architecture should evolve through deliberate Rectification rather than incidental accumulation.

A new architectural concept should enter the Codex only when it:

1. solves a recurring problem
2. reduces complexity
3. changes future decisions

Architecture should lag behind proven practice, but it should not remain silent after a pattern has demonstrated its value.

---

## Closing Reflection

The purpose of repository architecture is not to impose order for its own sake.

It is to make responsibility visible.

When responsibility becomes visible, ownership becomes clear.

When ownership becomes clear, boundaries become coherent.

When boundaries become coherent, implementation becomes simpler.

The repository should therefore teach its own organisation.

Every contribution should strengthen that teaching.

────────────────────────────────────────────

The Atelier Doctrine

"Every iteration approaches perfection without claiming it."

Authority:
High

Status:
Living

Rectification:
0
