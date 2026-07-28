# Architecture Glossary

> A shared language is the foundation of a shared architecture.

## Purpose

This glossary provides the canonical definitions for the architectural vocabulary used throughout the TAA Codex.

Every defined term has one authoritative meaning.

Architectural documents should reference these definitions rather than redefine them.

---

## Authority

This glossary governs the meaning of architectural terminology.

Where terminology conflicts across documents, this glossary is authoritative.

---

## Scope

This document defines language.

It does not define architectural rules, implementation guidance or design decisions.

---

# Repository

The complete organisational structure that contains the platform, its knowledge, implementation and supporting services.

See:
- Repository Topology

---

# Responsibility

A coherent obligation that belongs to one architectural owner.

Responsibilities should have one obvious home.

See:
- Repository Topology

---

# Realm

A business boundary that owns a coherent area of business knowledge and exposes Public Capabilities.

See:
- Realms

---

# Public Capability

A stable architectural promise exposed by a Realm.

It describes what another Realm may rely upon without revealing implementation.

See:
- Realms
- Dependency Rules

---

# Supporting Structure

A technical structure that enables Realms without owning business knowledge.

See:
- Supporting Structures

---

# Interface

The architectural edge of the platform.

Interfaces translate external requests into Public Capabilities.

They do not own business behaviour.

See:
- Supporting Structures

---

# Gateway

A Supporting Structure responsible for communicating with an external provider.

A Gateway owns integration, not business policy.

See:
- Supporting Structures
- Dependency Rules

---

# Infrastructure

Technical capabilities that enable the platform, such as configuration, logging, queues and monitoring.

Infrastructure supports Realms without becoming one.

See:
- Supporting Structures

---

# Persistence

The storage of information on behalf of a Realm.

Persistence stores business state but does not own its meaning.

See:
- Supporting Structures
- State Management

---

# Dependency

A deliberate relationship in which one architectural element relies upon another.

Dependencies should point toward stable business meaning.

See:
- Dependency Rules

---

# Event

A published fact describing something that has happened.

Events communicate history, not intent.

See:
- Data Flow

---

# Command

A request asking another owner to perform work.

Commands express intent.

See:
- Data Flow

---

# Query

A request for information that does not change authoritative business state.

See:
- Data Flow

---

# Projection

A derived representation of authoritative information created for a specific purpose.

A projection is never the source of truth.

See:
- Data Flow
- State Management

---

# State

Information that exists over time.

Every meaningful state has one owner and one lifecycle.

See:
- State Management

---

# Source of Truth

The single authoritative owner of a business fact.

Other representations are derived, projected or cached.

See:
- State Management

---

# Derived State

State calculated from authoritative information.

It should be reproducible.

See:
- State Management

---

# Cached State

A temporary copy maintained for performance.

A cache never becomes authoritative.

See:
- State Management

---

# Architecture Decision Record (ADR)

A permanent record explaining why a significant architectural decision was made.

Implementation records what exists.

An ADR preserves why it exists.

See:
- ADR

---

# Rectification

The deliberate refinement of architecture and knowledge as understanding evolves.

Rectification improves coherence without erasing reasoning.

Rectification is a first-class architectural activity within the Codex.

See:
- Leaf I — Genesis
- Architecture Principles

---

# Stewardship

The ongoing responsibility to preserve clarity, coherence and meaning throughout the platform and its knowledge.

Stewardship values long-term integrity over short-term convenience.

---

# Closing Reflection

Architecture begins with language.

When every important concept has one meaning, every architectural decision begins from shared understanding.

The glossary exists to preserve that shared language as the platform evolves.

────────────────────────────────────────────

The Atelier Doctrine

"Every iteration approaches perfection without claiming it."

Authority:
High

Status:
Living

Rectification:
0
