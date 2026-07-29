# Webflow Custom Code

## Purpose

This directory mirrors the locations where custom code is injected into Webflow.

Its purpose is to ensure every piece of deployed code exists within version control before it is added to the live website.

---

## Directory Structure

```text
custom-code/
│
├── site/
│   ├── head/
│   └── footer/
│
├── pages/
│
└── embeds/
```

---

## Responsibilities

### site/head

Code inserted into:

Site Settings → Custom Code → Head

Examples include:

- analytics
- tracking
- schema
- fonts
- third-party initialisation

---

### site/footer

Code inserted into:

Site Settings → Custom Code → Footer

Typically contains:

- application bootstrap
- global JavaScript
- shared initialisation

---

### pages

Contains page-specific custom code.

Each page should have its own directory.

Example:

```text
pages/
    product/
        footer.html

    account/
        footer.html
```

---

### embeds

Contains code embedded directly into Webflow components.

Each embed should have its own directory.

---

## Principles

Every deployed script should have exactly one home.

Repository files should be edited.

Webflow should receive deployed copies.

No production code should exist only inside the Webflow Designer.

---

The Atelier Doctrine

"Every iteration approaches perfection without claiming it."
