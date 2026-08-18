import assert from 'node:assert/strict';
import { createServer as createHttpServer } from 'node:http';
import process from 'node:process';
import test from 'node:test';
import { createServer } from 'vite';

process.env.VITE_SUPABASE_URL = 'https://example.supabase.co';
process.env.VITE_SUPABASE_PUBLISHABLE_KEY = 'test-publishable-key';

const hmrServer = createHttpServer();
const viteServer = await createServer({
  appType: 'custom',
  server: { middlewareMode: true, ws: { server: hmrServer } },
});
const { initCheckoutCanaryFixture, isCheckoutCanaryFixturePath } = await viteServer.ssrLoadModule(
  '/src/modules/checkout/checkout-canary-fixture.js'
);
const { getCart, removeCartItems } = await viteServer.ssrLoadModule('/src/modules/cart/cart.js');

test.after(async () => {
  await viteServer.close();
});

class FakeStorage {
  constructor(cart = []) {
    this.entries = new Map([['taa_cart', JSON.stringify(cart)]]);
  }

  getItem(key) {
    return this.entries.has(key) ? this.entries.get(key) : null;
  }

  removeItem(key) {
    this.entries.delete(key);
  }

  setItem(key, value) {
    this.entries.set(key, String(value));
  }
}

class FakeElement {
  constructor(tagName = 'div', attributes = {}) {
    this.tagName = tagName.toLowerCase();
    this.attributes = new Map(Object.entries(attributes));
    this.children = [];
    this.disabled = false;
    this.hidden = false;
    this.id = '';
    this.listeners = new Map();
    this.ownerDocument = null;
    this.parentNode = null;
    this.textContent = '';
    this.type = '';
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  appendChild(child) {
    child.ownerDocument = this.ownerDocument;
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  async dispatch(type) {
    for (const listener of this.listeners.get(type) || []) {
      await listener({ preventDefault() {}, target: this, type });
    }
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  matches(selector) {
    const valueMatch = selector.match(/^\[([^=]+)="([^"]+)"\]$/);
    if (valueMatch) return this.attributes.get(valueMatch[1]) === valueMatch[2];

    const presenceMatch = selector.match(/^\[([^=]+)\]$/);
    return Boolean(presenceMatch && this.attributes.has(presenceMatch[1]));
  }

  prepend(child) {
    child.ownerDocument = this.ownerDocument;
    child.parentNode = this;
    this.children.unshift(child);
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    const matches = [];

    this.children.forEach((child) => {
      if (child.matches(selector)) matches.push(child);
      matches.push(...child.querySelectorAll(selector));
    });

    return matches;
  }

  replaceChildren(...children) {
    this.children.forEach((child) => {
      child.parentNode = null;
    });
    this.children = [];
    children.forEach((child) => this.appendChild(child));
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }
}

function canaryProduct(sku) {
  return {
    active: true,
    currency: 'GBP',
    default_amount: 'Test',
    id: `${sku}-id`,
    image_url: null,
    inventory_quantity: 5,
    name: sku,
    price: 1,
    sku,
    stripe_price_id: null,
  };
}

function cartItem(sku) {
  return {
    amount: 'Test',
    base_product_id: `${sku}-id`,
    base_sku: sku,
    currency: 'GBP',
    price: 1,
    product_id: `${sku}-id`,
    quantity: 1,
    sku,
    title: sku,
    variant: 'default',
  };
}

function createFixture({
  cart = [],
  resetCheckoutAttempt = async () => ({ status: 'no_attempt' }),
  resolveProduct = async (sku) => canaryProduct(sku),
} = {}) {
  const ownerDocument = {
    createElement(tagName) {
      const element = new FakeElement(tagName);
      element.ownerDocument = ownerDocument;
      return element;
    },
  };
  const root = new FakeElement('main', { 'data-checkout-root': 'true' });
  const resolvedSkus = [];
  let reloadCount = 0;

  root.ownerDocument = ownerDocument;
  globalThis.localStorage = new FakeStorage(cart);

  const controller = initCheckoutCanaryFixture({
    root,
    pathname: '/checkout-test',
    dependencies: {
      getActiveProductBySku: async (sku) => {
        resolvedSkus.push(sku);
        return resolveProduct(sku);
      },
      refreshCartUi() {},
      reloadCheckout() {
        reloadCount += 1;
      },
      resetCheckoutAttempt,
    },
  });

  return {
    controller,
    get reloadCount() {
      return reloadCount;
    },
    resolvedSkus,
    root,
  };
}

test('fixture is available only on the checkout-test path', () => {
  const root = new FakeElement('main');

  assert.equal(isCheckoutCanaryFixturePath('/checkout-test'), true);
  assert.equal(isCheckoutCanaryFixturePath('/checkout-test/'), true);
  assert.equal(isCheckoutCanaryFixturePath('/checkout'), false);
  assert.equal(initCheckoutCanaryFixture({ root, pathname: '/checkout' }), null);
  assert.equal(root.children.length, 0);
});

test('HOLDER control resolves BASE and uses the canonical cart insertion path', async () => {
  const fixture = createFixture();

  await fixture.root.querySelector('[data-checkout-canary-load="holder"]').dispatch('click');

  assert.deepEqual(fixture.resolvedSkus, ['TAA-CANARY-BASE']);
  assert.deepEqual(
    getCart().map(({ sku, quantity }) => ({ quantity, sku })),
    [{ quantity: 1, sku: 'TAA-CANARY-BASE' }]
  );
  assert.equal(fixture.reloadCount, 1);
  assert.equal(
    fixture.root.querySelector('[data-checkout-canary-item]').textContent,
    'TAA-CANARY-BASE × 1'
  );
});

test('CONTENDER control loads the exact three-item canary basket through cart.js', async () => {
  const fixture = createFixture();

  await fixture.root.querySelector('[data-checkout-canary-load="contender"]').dispatch('click');

  assert.deepEqual(fixture.resolvedSkus, ['TAA-CANARY-A', 'TAA-CANARY-BASE', 'TAA-CANARY-C']);
  assert.deepEqual(
    getCart().map(({ sku, quantity }) => ({ quantity, sku })),
    [
      { quantity: 1, sku: 'TAA-CANARY-A' },
      { quantity: 1, sku: 'TAA-CANARY-BASE' },
      { quantity: 1, sku: 'TAA-CANARY-C' },
    ]
  );
  assert.equal(fixture.root.querySelectorAll('[data-checkout-canary-item]').length, 3);
  assert.equal(fixture.reloadCount, 1);
});

test('Clear canary basket awaits authoritative reset before removing canary lines', async () => {
  let cartDuringReset;
  const fixture = createFixture({
    cart: [cartItem('TAA-CANARY-BASE')],
    resetCheckoutAttempt: async () => {
      cartDuringReset = getCart();
      return { status: 'abandoned' };
    },
  });

  await fixture.root.querySelector('[data-checkout-canary-clear="true"]').dispatch('click');

  assert.deepEqual(
    cartDuringReset.map(({ sku }) => sku),
    ['TAA-CANARY-BASE']
  );
  assert.deepEqual(getCart(), []);
  assert.equal(fixture.root.querySelector('[data-checkout-canary-state]').children.length, 1);
  assert.equal(
    fixture.root.querySelector('[data-checkout-canary-state]').children[0].textContent,
    'Canary basket is empty.'
  );
  assert.equal(fixture.reloadCount, 1);
});

test('Clear canary basket clears normally when no checkout attempt exists', async () => {
  const fixture = createFixture({ cart: [cartItem('TAA-CANARY-BASE')] });

  await fixture.root.querySelector('[data-checkout-canary-clear="true"]').dispatch('click');

  assert.deepEqual(getCart(), []);
  assert.equal(fixture.reloadCount, 1);
});

test('Clear canary basket preserves cart and page when authoritative reset fails', async (context) => {
  context.mock.method(console, 'error', () => {});
  const fixture = createFixture({
    cart: [cartItem('TAA-CANARY-BASE')],
    resetCheckoutAttempt: async () => {
      throw new Error('Checkout could not be reset safely.');
    },
  });

  await fixture.root.querySelector('[data-checkout-canary-clear="true"]').dispatch('click');

  assert.deepEqual(
    getCart().map(({ sku }) => sku),
    ['TAA-CANARY-BASE']
  );
  assert.equal(fixture.reloadCount, 0);
  assert.equal(fixture.root.querySelector('[data-checkout-canary-error]').hidden, false);
  assert.equal(
    fixture.root.querySelector('[data-checkout-canary-error]').textContent,
    'Checkout could not be reset safely.'
  );
});

test('Clear canary basket preserves a checkout reported as already paid', async (context) => {
  context.mock.method(console, 'error', () => {});
  const fixture = createFixture({
    cart: [cartItem('TAA-CANARY-BASE')],
    resetCheckoutAttempt: async () => ({ status: 'already_paid' }),
  });

  await fixture.root.querySelector('[data-checkout-canary-clear="true"]').dispatch('click');

  assert.deepEqual(
    getCart().map(({ sku }) => sku),
    ['TAA-CANARY-BASE']
  );
  assert.equal(fixture.reloadCount, 0);
  assert.equal(
    fixture.root.querySelector('[data-checkout-canary-error]').textContent,
    'A paid checkout cannot be cleared from the canary fixture.'
  );
});

test('Clear canary basket refuses to operate over non-canary lines', async (context) => {
  context.mock.method(console, 'error', () => {});
  let resetCalls = 0;
  const fixture = createFixture({
    cart: [cartItem('RETAIL-SKU'), cartItem('TAA-CANARY-BASE')],
    resetCheckoutAttempt: async () => {
      resetCalls += 1;
      return { status: 'abandoned' };
    },
  });

  await fixture.root.querySelector('[data-checkout-canary-clear="true"]').dispatch('click');

  assert.deepEqual(
    getCart().map(({ sku }) => sku),
    ['RETAIL-SKU', 'TAA-CANARY-BASE']
  );
  assert.equal(resetCalls, 0);
  assert.equal(fixture.reloadCount, 0);
  assert.equal(
    fixture.root.querySelector('[data-checkout-canary-error]').textContent,
    'Remove non-canary items before loading a canary test basket.'
  );
});

test('fixture render rereads the authoritative cart after Continue Without removes BASE', () => {
  const fixture = createFixture({
    cart: [cartItem('TAA-CANARY-A'), cartItem('TAA-CANARY-BASE'), cartItem('TAA-CANARY-C')],
  });

  removeCartItems(['TAA-CANARY-BASE']);
  fixture.controller.render();

  assert.deepEqual(
    fixture.root.querySelectorAll('[data-checkout-canary-item]').map((item) => item.textContent),
    ['TAA-CANARY-A × 1', 'TAA-CANARY-C × 1']
  );
});

test('fixture refuses to load over a non-canary basket', async (context) => {
  context.mock.method(console, 'error', () => {});
  const fixture = createFixture({ cart: [cartItem('RETAIL-SKU')] });

  await fixture.root.querySelector('[data-checkout-canary-load="holder"]').dispatch('click');

  assert.deepEqual(fixture.resolvedSkus, []);
  assert.deepEqual(
    getCart().map(({ sku }) => sku),
    ['RETAIL-SKU']
  );
  assert.equal(fixture.reloadCount, 0);
  assert.equal(fixture.root.querySelector('[data-checkout-canary-error]').hidden, false);
  assert.equal(
    fixture.root.querySelector('[data-checkout-canary-error]').textContent,
    'Remove non-canary items before loading a canary test basket.'
  );
});

test('fixture rejects a resolved product outside the canary allowlist boundary', async (context) => {
  context.mock.method(console, 'error', () => {});
  const fixture = createFixture({
    resolveProduct: async () => canaryProduct('RETAIL-SKU'),
  });

  await fixture.root.querySelector('[data-checkout-canary-load="holder"]').dispatch('click');

  assert.deepEqual(getCart(), []);
  assert.equal(fixture.reloadCount, 0);
  assert.equal(fixture.root.querySelector('[data-checkout-canary-error]').hidden, false);
  assert.equal(
    fixture.root.querySelector('[data-checkout-canary-error]').textContent,
    'The requested canary product could not be resolved safely.'
  );
});
