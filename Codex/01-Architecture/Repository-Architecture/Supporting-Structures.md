# Supporting Structures

> Supporting Structures enable the platform without owning the business.

## Purpose

This document defines the technical structures that enable the TAA Platform.

Supporting Structures provide infrastructure, integration, persistence and operational capabilities that allow the business architecture to function. They exist to serve the Realms, never to replace them.

Business knowledge belongs to Realms.

Supporting Structures provide the technical means through which that knowledge is expressed.

---

## Authority

This document governs:

- Supporting Structure categories
- technical responsibilities
- integration boundaries
- infrastructure ownership
- persistence responsibilities
- operational capabilities

---

## Scope

This document defines the architectural role of Supporting Structures.

It does not define:

- business ownership
- repository placement
- dependency direction
- implementation conventions
- deployment procedures

Those concerns are defined within their respective constitutional documents.

---

# The Nature of a Supporting Structure

Supporting Structures enable the platform.

They do not own its business understanding.

Every Supporting Structure exists because a technical capability is required to support one or more Realms.

A Supporting Structure may provide sophisticated behaviour, coordinate complex systems or communicate with external providers, but it should never become the authority for business knowledge.

Business decisions belong to the Realm that owns them.

Supporting Structures merely enable those decisions to be carried out.

---

# Principles

Supporting Structures should:

- enable rather than own
- remain replaceable where practical
- expose capabilities rather than implementation
- minimise coupling to external providers
- avoid accumulating business knowledge
- evolve independently of the business architecture

When a Supporting Structure begins making business decisions, architectural ownership has drifted and Rectification should be considered.

---

# Categories of Supporting Structures

## Interfaces

Interfaces expose the platform to external consumers.

Their responsibility is to translate external requests into Public Capabilities without exposing the internal architecture.

Interfaces should remain thin. They coordinate communication. They do not contain business policy.

## Gateways

Gateways isolate communication with external systems.

A Gateway owns communication, not the business reason for communicating.

## Infrastructure

Infrastructure provides technical capabilities such as configuration, logging, monitoring, caching, queues, authentication mechanisms and scheduling.

Infrastructure enables business behaviour. It never defines business behaviour.

## Persistence

Persistence stores and retrieves information on behalf of the Realms.

Persistence owns storage, not meaning.

## Automation

Automation coordinates workflows between systems.

Automation should coordinate responsibilities, never own them.

## Operational Tooling

Operational Tooling supports development, maintenance and operation of the platform.

## Testing

Testing verifies implementation behaviour.

Tests provide confidence. They do not define architecture.

## Public Assets

Public Assets contain resources served directly to clients.

Business behaviour should never reside here.

## Transitional Structures

Historical implementation may temporarily remain until deliberate Rectification establishes clearer ownership.

---

# Supporting Structures and Realms

Realms answer:

> **What does the business know?**

Supporting Structures answer:

> **How is that knowledge enabled?**

---

# Architectural Boundaries

Supporting Structures should:

- serve the Realms
- avoid owning business rules
- expose stable capabilities
- minimise provider coupling
- remain replaceable where practical

They should never become alternate business owners.

---

# Signs of Structural Decay

- business rules inside infrastructure
- duplicated integrations
- persistence making business decisions
- automation determining business policy
- utility directories accumulating unrelated responsibilities

These indicate the need for Rectification.

---

# Guidance for Artisans and Agents

Before introducing a Supporting Structure ask:

1. Does it own business knowledge?
2. Should it be a Realm instead?
3. Can an existing Supporting Structure fulfil this responsibility?
4. Does it preserve replaceability?
5. Does the decision require an ADR?

---

# Closing Reflection

Supporting Structures provide capability without claiming ownership.

Their greatest strength is not sophisticated implementation.

It is the discipline of knowing where their responsibility ends.

────────────────────────────────────────────

The Atelier Doctrine

"Every iteration approaches perfection without claiming it."

Authority:
High

Status:
Living

Rectification:
1
