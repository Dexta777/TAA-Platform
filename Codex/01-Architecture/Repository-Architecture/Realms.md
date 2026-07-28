# Realms

> Every business responsibility has a steward.

## Purpose

This document defines the enduring **business knowledge** owned by the platform.

A Realm is an architectural boundary that owns a coherent area of business knowledge and exposes **Public Capabilities**.

## Authority

This document governs:

- business ownership
- Realm boundaries
- Public Capabilities
- creation and rectification of Realms

## Nature of a Realm

A Realm owns knowledge.

Implementation contains logic.

Knowledge remains with the Realm regardless of technology.

## Characteristics

Every Realm possesses:

- one primary purpose
- explicit stewardship
- cohesive knowledge
- clear boundaries
- Public Capabilities
- minimal architectural dependencies

Public Capabilities are the **only architectural surface** exposed by a Realm.

## Existing Realms

### Accounts

Owns customer identity and account knowledge.

Depends upon Public Capabilities from:
- Commerce
- Orders
- Courses

### Commerce

Owns commercial knowledge governing how products become purchases.

Depends upon Public Capabilities from:
- Accounts
- Catalogue
- Orders

### Catalogue

Owns product knowledge.

Depends upon Public Capabilities from:
- Commerce
- Content

### Orders

Owns authoritative order knowledge throughout the order lifecycle.

Depends upon Public Capabilities from:
- Accounts
- Commerce
- Catalogue

### Content

Owns editorial and educational knowledge.

Depends upon Public Capabilities from:
- Catalogue
- Courses

### Courses

Owns structured learning knowledge.

Depends upon Public Capabilities from:
- Accounts
- Commerce
- Content

## Creating a Realm

Create a new Realm only when:

- genuinely new business knowledge emerges
- stewardship cannot be expressed within an existing Realm
- the responsibility has enduring meaning
- another architect would independently identify the same boundary

Large codebases do not justify new Realms.

Distinct understanding does.

## Closing Reflection

A Realm is a promise to steward one coherent area of business knowledge.

Rectification: 1
