# Repository Naming Conventions

## Purpose

This document defines the naming conventions used throughout the repository.

Its purpose is to ensure every file, directory and identifier follows a consistent, predictable standard.

Consistency reduces cognitive load, improves discoverability and allows both humans and autonomous agents to navigate the repository without ambiguity.

---

## Principles

- Predictability over preference.
- Consistency over novelty.
- Purpose over implementation.
- Repository-wide conventions take precedence over framework-specific conventions unless explicitly documented.

---

# Repository

## Directories

Use:

```text
kebab-case
```

Examples:

```text
custom-code
customer-accounts
third-party-services
```

---

## Files

Unless otherwise required by the platform, all files use:

```text
kebab-case
```

Examples:

```text
checkout-client.js
repository-topology.md
product-card.css
organisation-schema.json
```

---

## Exceptions

Platform-defined filenames retain their required names.

Examples:

```text
.env
.env.local
.env.production
package.json
package-lock.json
README.md
LICENSE
```

---

# JavaScript

## Variables

Use:

```text
camelCase
```

Examples:

```javascript
cartTotal;
selectedVariant;
checkoutSession;
```

---

## Functions

Use:

```text
camelCase
```

Examples:

```javascript
loadProduct();
createCheckout();
updateCart();
```

---

## Classes

Use:

```text
PascalCase
```

Examples:

```javascript
CartManager;
CheckoutClient;
ProductLoader;
```

---

## Constants

Use:

```text
SCREAMING_SNAKE_CASE
```

Examples:

```javascript
DEFAULT_TIMEOUT;
MAX_CART_ITEMS;
STRIPE_API_VERSION;
```

---

# HTML

## Custom Elements

Prefix project-owned custom elements with:

```text
taa-
```

Examples:

```html
<taa-cart>
  <taa-checkout> <taa-product-card></taa-product-card></taa-checkout
></taa-cart>
```

---

## Data Attributes

Use:

```text
data-kebab-case
```

Examples:

```text
data-product-sku
data-cart-count
data-stripe-price-id
```

---

# CSS

## Classes

Use:

```text
kebab-case
```

Examples:

```text
product-card
checkout-button
customer-account
```

---

# Git

## Branches

Examples:

```text
feature/cart
feature/customer-accounts
fix/checkout-tax
docs/naming-conventions
refactor/product-loader
```

---

## Commits

Use Conventional Commits.

Examples:

```text
feat(cart): add quantity controls

fix(checkout): prevent duplicate sessions

docs(standards): establish naming conventions

refactor(product): extract loader
```

---

# Reserved Names

Avoid generic filenames.

Poor:

```text
helpers.js
utils.js
common.js
misc.js
temp.js
```

Prefer names that describe responsibility.

Good:

```text
checkout-client.js
cart-manager.js
product-loader.js
inventory-service.js
```

---

# Naming Doctrine

> Names describe purpose, not implementation.

Every name should communicate **why** something exists rather than **how** it currently works.

---

## Governance

This document is normative.

New code should conform to these conventions.

Existing code should adopt these conventions when it is substantially modified or migrated.

Do not rename files solely for stylistic reasons unless part of an agreed refactoring.
