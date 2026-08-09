# Webflow Module Staging and Cutover

## Purpose

This procedure governs the future staging and production cutover of the modular product, cart,
drawer, and basket runtime. It does not authorize a deployment or a Webflow change.

## Runtime ownership invariant

Exactly one ecommerce runtime may own these interfaces on any page:

```text
[data-product-sku]
[data-commerce-action="add_to_cart"]
[data-cart-*]
[data-basket-*]
```

The permitted state is:

```text
legacy runtime XOR modular runtime
```

Never load the legacy and modular ecommerce runtimes together. A runtime flag on the modular
application would not be sufficient if legacy handlers could still bind underneath it.

## Build artifact contract

Run `npm run build` with the required browser-safe Vite environment variables supplied by the
release environment. The build uses `src/main.js` as its JavaScript entry and produces:

```text
dist/
├── taa-platform.js
├── assets/
│   └── <lazy-or-shared-name>-<content-hash>.js
└── .vite/
    └── manifest.json
```

`taa-platform.js` is the stable application entry. Lazy and shared chunks use content-hashed
names. The relative asset base keeps imports within the deployed release tree and avoids coupling
the build to a hosting provider or domain. The manifest is deployment metadata only; the browser
application does not consume it.

Do not commit `dist/`. Do not place service-role keys, Stripe secret keys, database passwords, or
private Klaviyo keys in Vite variables. Only browser-safe configuration may enter a browser build.

## Immutable release contract

Publish every build as one complete, immutable release:

```text
<asset-origin>/
└── taa-platform/
    └── releases/
        └── <release-id>/
            ├── taa-platform.js
            └── assets/
                └── ...
```

The release identifier may later be a Git commit SHA, release tag, or deployment identifier. Do
not overwrite files inside a published release directory.

A future Webflow reference will point to the entry inside one complete release:

```html
<script
  type="module"
  src="https://<asset-origin>/taa-platform/releases/<release-id>/taa-platform.js"
></script>
```

This example is documentation only. Do not insert it until the cutover is approved.

The entry and all of its hashed chunks form one atomic release. Upload and verify the entire
directory before Webflow references it. Deploying only the entry or only some chunks can combine
incompatible assets and cause lazy imports to fail. Rollback must select a previous complete
release, not mix files from releases. No `current` pointer or symlink is defined yet.

## Asset-host requirements

The future provider-neutral static asset host must provide:

- HTTPS;
- JavaScript files with a correct JavaScript MIME type;
- cross-origin ES-module loading from the relevant Webflow staging and production origins;
- every file from a release under the same intact release tree;
- reliable cache headers and cache invalidation behaviour; and
- availability sufficient for an ecommerce runtime.

Immutable versioned release files should use long-lived caching. Hosting provider selection and
provider-specific configuration are separate decisions.

## Staging procedure

### Phase A — Build and host one release

1. Build one complete modular release with its browser-safe environment configuration.
2. Upload `taa-platform.js`, all `assets/` chunks, and deployment metadata together.
3. Verify that the entry and every manifest-referenced file exist and return successful responses.
4. Verify that the entry resolves its lazy chunks within the same release directory.

### Phase B — Establish runtime ownership

1. Identify whether the current legacy product/cart runtime is installed in site-wide custom code,
   page-level custom code, or embedded code blocks. Do not assume its location.
2. On the intentionally isolated test surface, remove or disable the legacy ecommerce runtime
   before adding the modular module reference.
3. Load only the modular `taa-platform.js` from the staged immutable release.
4. Inspect loaded script/module resources, the network panel, console diagnostics, and event
   behaviour. Confirm that exactly one runtime owns the ecommerce controls.

### Phase C — Test Webflow staging

Use the Webflow staging domain or intentionally isolated non-production pages before the production
custom domain. Exercise, where the catalogue provides suitable products:

- a non-product/global page;
- a product page without variants;
- a product page with variants;
- the basket page;
- the cart drawer; and
- cart count badges.

Do not publish a production cutover as part of staging setup.

## Staging acceptance matrix

### Global or non-product page

- The global entry loads, but the product/Supabase chunk is not requested without
  `[data-product-sku]`.
- The persisted cart and count badge render.
- The drawer opens and closes.
- Escape handling and focus movement/restoration work.
- There are no unexpected console errors.

### Product page

- Product data loads and unavailable products fail closed.
- Variant selection works and price/amount presentation updates.
- Out-of-stock presentation prevents adding.
- A valid selection adds to the basket and opens the drawer.
- Adding the same SKU increments its quantity.
- Quantity and stock validation errors display correctly.

### Drawer

- Unit prices and subtotal are correct.
- Quantity changes and removal target the intended SKU.
- Empty state and badge synchronisation are correct.

### Basket page

- Line totals and subtotal are correct.
- Quantity changes and removal target the intended SKU.
- Empty state, error target, and badge synchronisation are correct.

### Persistence

- Refreshing the page preserves the cart through the compatible `taa_cart` schema.
- Drawer and basket representations remain consistent after refresh.

### Network and release integrity

- The global entry loads successfully.
- The product chunk remains lazy.
- Every chunk request succeeds with no 404 or mixed-content failure.
- Every loaded chunk belongs to the same immutable release directory.

### Runtime coexistence

- Inspect loaded scripts and module resources; no legacy ecommerce script is present on the modular
  test surface.
- Interact with add, quantity, remove, drawer, and basket controls; each action occurs once.
- Check network activity and console diagnostics for evidence of duplicate handlers or duplicate
  product queries.
- Acceptance requires exactly one ecommerce runtime owning the controls. Apparent functionality
  alone is insufficient.

## Production cutover doctrine

Document and approve the exact Webflow edits before executing this sequence:

1. Create and verify a complete immutable modular release.
2. Complete the staging acceptance matrix.
3. Preserve a recoverable reference to the last known-good legacy setup.
4. Remove or disable the legacy ecommerce runtime.
5. Add the module script referencing the tested immutable release.
6. Publish Webflow.
7. Immediately smoke-test product, cart, drawer, basket, persistence, and network behaviour.
8. Monitor browser errors, failed asset requests, and order flow.

Do not permanently delete the legacy source during the initial cutover window.

## Rollback doctrine

If the modular cutover must be reversed:

1. Remove or disable the modular module script.
2. Restore or re-enable the last known-good legacy runtime.
3. Republish Webflow.
4. Verify product and cart functionality and confirm only the legacy runtime is active.

If a previous modular release is known-good, a future release process may instead point Webflow
back to that complete immutable release. Never enable modular and legacy runtimes simultaneously as
a rollback strategy.

## Checkout boundary

Checkout remains separate and is not part of this cutover:

```text
modular product/cart runtime
→ compatible taa_cart schema
→ existing checkout
```

The existing checkout may continue consuming compatible cart data during a later controlled
migration. This document does not claim that checkout has been migrated or cut over.
