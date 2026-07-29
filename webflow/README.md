# Webflow

## Purpose

This directory contains everything required to integrate the TAA Platform with Webflow.

Webflow is the presentation layer of the platform. It hosts the user interface and acts as the deployment target for custom code.

The repository remains the source of truth.

No business logic should exist exclusively inside the Webflow Designer.

---

## Directory Structure

```text
webflow/
│
├── custom-code/
├── scripts/
├── styles/
├── components/
└── assets/
```

---

## Responsibilities

### custom-code

Contains code that is pasted directly into Webflow.

Examples include:

- Site Head Code
- Site Footer Code
- Page Custom Code
- Embed Code

---

### scripts

Contains JavaScript source code maintained within the repository.

Where practical, Webflow should consume code from here rather than becoming the development environment.

---

### styles

Contains custom CSS not managed by the Webflow Designer.

---

### components

Contains reusable interface components, snippets and implementation guidance.

---

### assets

Contains static assets that are managed outside Webflow.

---

## Principles

- Git is the source of truth.
- Webflow is a deployment target.
- Changes are developed locally before being deployed.
- Repository history preserves architectural knowledge.

---

The Atelier Doctrine

"Every iteration approaches perfection without claiming it."
