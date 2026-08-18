import assert from 'node:assert/strict';
import { createServer as createHttpServer } from 'node:http';
import process from 'node:process';
import test from 'node:test';
import { createServer } from 'vite';

process.env.VITE_STRIPE_PUBLISHABLE_KEY = 'pk_test_checkout_inventory_controller';
process.env.VITE_SUPABASE_URL = 'https://example.supabase.co';
process.env.VITE_SUPABASE_PUBLISHABLE_KEY = 'test-publishable-key';

const hmrServer = createHttpServer();
const viteServer = await createServer({
  appType: 'custom',
  server: { middlewareMode: true, ws: { server: hmrServer } },
});
const { initCheckout } = await viteServer.ssrLoadModule('/src/modules/checkout/checkout.js');

test.after(async () => {
  await viteServer.close();
});

class FakeStorage {
  constructor(entries = {}) {
    this.entries = new Map(Object.entries(entries));
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

class FakeClassList {
  constructor() {
    this.values = new Set();
  }

  toggle(value, force) {
    if (force === false) this.values.delete(value);
    else if (force === true) this.values.add(value);
    else if (this.values.has(value)) this.values.delete(value);
    else this.values.add(value);
  }
}

class FakeElement {
  constructor(tagName = 'div', attributes = {}) {
    this.tagName = tagName.toLowerCase();
    this.attributes = new Map(Object.entries(attributes));
    this.children = [];
    this.classList = new FakeClassList();
    this.disabled = false;
    this.checked = false;
    this.listeners = new Map();
    this.parentNode = null;
    this.ownerDocument = null;
    this.style = {};
    this.textContent = '';
    this.value = '';
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  appendChild(child) {
    child.parentNode = this;
    child.ownerDocument = this.ownerDocument;
    this.children.push(child);
    return child;
  }

  async dispatch(type) {
    for (const listener of this.listeners.get(type) || []) {
      await listener({ preventDefault() {}, target: this, type });
    }
  }

  dispatchEvent(event) {
    void this.dispatch(event.type);
    return true;
  }

  focus() {}

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  matches(selector) {
    if (selector === 'input[type="radio"]') {
      return this.tagName === 'input' && this.attributes.get('type') === 'radio';
    }

    if (selector === 'input[type="radio"]:checked') {
      return this.matches('input[type="radio"]') && this.checked;
    }

    const valueMatch = selector.match(/^\[([^=]+)="([^"]+)"\]$/);
    if (valueMatch) return this.attributes.get(valueMatch[1]) === valueMatch[2];

    const presenceMatch = selector.match(/^\[([^=]+)\]$/);
    return Boolean(presenceMatch && this.attributes.has(presenceMatch[1]));
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    if (selector.includes(',')) {
      return Array.from(
        new Set(selector.split(',').flatMap((part) => this.querySelectorAll(part.trim())))
      );
    }

    if (selector === '[data-shipping-method-option="true"] input[type="radio"]:checked') {
      return this.querySelectorAll('[data-shipping-method-option="true"]')
        .map((wrapper) => wrapper.querySelector('input[type="radio"]:checked'))
        .filter(Boolean);
    }

    const matches = [];

    this.children.forEach((child) => {
      if (child.matches(selector)) matches.push(child);
      matches.push(...child.querySelectorAll(selector));
    });

    return matches;
  }

  closest(selector) {
    let element = this;

    while (element) {
      if (element.matches(selector)) return element;
      element = element.parentNode;
    }

    return null;
  }

  remove() {
    if (!this.parentNode) return;
    this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
    this.parentNode = null;
  }

  removeAttribute(name) {
    this.attributes.delete(name);
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

function createFixture({ conflictMarkup = 'complete', cart }) {
  const storage = new FakeStorage({ taa_cart: JSON.stringify(cart) });
  const sessionStorage = new FakeStorage();
  const ownerDocument = {
    createElement(tagName) {
      const element = new FakeElement(tagName);
      element.ownerDocument = ownerDocument;
      return element;
    },
  };
  const root = new FakeElement('main', { 'data-checkout-root': 'true' });
  root.ownerDocument = ownerDocument;
  const payButton = root.appendChild(new FakeElement('button', { 'data-pay-button': 'true' }));
  const errorElement = root.appendChild(new FakeElement('div', { 'data-checkout-error': 'true' }));
  const paymentWrapper = root.appendChild(
    new FakeElement('div', { 'data-stripe-payment-element': 'true' })
  );
  const shippingWrapper = root.appendChild(
    new FakeElement('div', {
      'data-shipping-method-option': 'true',
      'data-shipping-method-name': 'Tracked',
    })
  );
  const shippingRadio = shippingWrapper.appendChild(new FakeElement('input', { type: 'radio' }));
  let conflictRegion = null;
  let retryButton = null;
  let continueButton = null;

  if (conflictMarkup !== 'absent') {
    conflictRegion = root.appendChild(
      new FakeElement('section', { 'data-checkout-inventory-conflict': 'true' })
    );

    if (conflictMarkup === 'complete') {
      conflictRegion.appendChild(
        new FakeElement('h2', { 'data-checkout-inventory-title': 'true' })
      );
      conflictRegion.appendChild(
        new FakeElement('p', { 'data-checkout-inventory-message': 'true' })
      );
      conflictRegion.appendChild(
        new FakeElement('div', { 'data-checkout-inventory-items': 'true' })
      );
      retryButton = conflictRegion.appendChild(
        new FakeElement('button', { 'data-checkout-inventory-retry': 'true' })
      );
      continueButton = conflictRegion.appendChild(
        new FakeElement('button', { 'data-checkout-inventory-continue': 'true' })
      );
    }
  }

  globalThis.localStorage = storage;
  globalThis.window = {
    addEventListener() {},
    location: { assign() {} },
    sessionStorage,
    setTimeout,
  };

  return {
    conflictRegion,
    continueButton,
    errorElement,
    payButton,
    paymentWrapper,
    retryButton,
    root,
    sessionStorage,
    shippingRadio,
    storage,
  };
}

function physicalConflict(items) {
  return Object.assign(new Error('One or more items in your basket are currently unavailable.'), {
    checkoutInventoryError: 'inventory_conflict',
    checkoutRequestAdmitted: false,
    retryable: false,
    unavailableItems: items,
  });
}

function temporaryConflict(sku) {
  return physicalConflict([{ sku, reason: 'temporarily_reserved' }]);
}

function shippingResult(cart) {
  return {
    subtotal: 1000,
    total_weight_grams: 100,
    currency: 'gbp',
    options: [
      {
        id: 'shipping-method',
        rate_id: 'shipping-rate',
        name: 'Tracked',
        shipping: 499,
        original_shipping: 499,
        currency: 'gbp',
        stripe_shipping_rate_id: 'shr_test',
      },
    ],
    items: cart.map((item) => ({
      sku: item.sku,
      quantity: item.quantity,
      product_name: item.title,
      unit_amount: 1000,
      image_url: item.image || null,
    })),
  };
}

function createStripeElementsDependency() {
  const session = {
    currency: 'gbp',
    total: {
      shippingRate: { minorUnitsAmount: 499 },
      subtotal: { minorUnitsAmount: 1000 },
      total: { minorUnitsAmount: 1499 },
    },
  };
  const actions = {
    getSession: () => session,
    updateShippingOption: async () => ({ session, type: 'success' }),
  };

  return async () => ({
    createPaymentElement() {
      return {
        destroy() {},
        mount(wrapper) {
          wrapper.appendChild(new FakeElement('iframe', { 'data-payment-mounted': 'true' }));
        },
      };
    },
    loadActions: async () => ({ actions, type: 'success' }),
    on() {},
  });
}

function reservationCheckoutResult(payload, currentCart) {
  return {
    checkout_protocol_version: 'reservation_v1',
    checkout_attempt_id: payload.checkoutAttemptId,
    checkout_request_id: payload.checkoutRequestId,
    checkout_intent_id: '10000000-0000-4000-8000-000000000001',
    checkout_session_id: 'cs_test_inventory_success',
    checkout_state: 'active',
    client_secret: 'cs_test_inventory_success_secret',
    confirmation_generation: 1,
    confirmation_token: 'confirmation-token',
    currency: 'gbp',
    items: currentCart.map((item) => ({
      sku: item.sku,
      quantity: item.quantity,
      product_name: item.title,
      unit_amount: 1000,
      image_url: null,
    })),
    shipping_options: shippingResult(currentCart).options,
    shipping: 499,
    subtotal: 1000,
    total: 1499,
  };
}

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  throw new Error('Timed out waiting for checkout controller state.');
}

const cart = [
  { sku: 'A', title: 'Available A', quantity: 1, price: 10, currency: 'GBP' },
  { sku: 'B', title: 'Unavailable B', quantity: 1, price: 10, currency: 'GBP' },
  { sku: 'C', title: 'Available C', quantity: 1, price: 10, currency: 'GBP' },
];

test('real checkout controller continues without one item through explicit reset and shipping reload', async () => {
  const fixture = createFixture({ cart, conflictMarkup: 'complete' });
  let shippingCalls = 0;
  let abandonmentCalls = 0;
  const observedCarts = [];
  const controller = await initCheckout({
    root: fixture.root,
    dependencies: {
      abandonCheckoutAttempt: async () => {
        abandonmentCalls += 1;
        return { result: 'abandoned' };
      },
      getShippingOptions: async (currentCart) => {
        shippingCalls += 1;
        if (shippingCalls === 1) {
          throw physicalConflict([{ sku: 'B', reason: 'out_of_stock' }]);
        }
        return shippingResult(currentCart);
      },
      onCartChanged: (currentCart) => observedCarts.push(currentCart),
    },
  });

  assert.ok(controller);
  assert.equal(fixture.conflictRegion.attributes.has('data-ui-hidden'), false);
  const firstEnvelope = JSON.parse(fixture.sessionStorage.getItem('taa_checkout_attempt_v1'));
  const firstClick = fixture.continueButton.dispatch('click');
  const secondClick = fixture.continueButton.dispatch('click');
  await Promise.all([firstClick, secondClick]);
  const nextEnvelope = JSON.parse(fixture.sessionStorage.getItem('taa_checkout_attempt_v1'));

  assert.deepEqual(JSON.parse(fixture.storage.getItem('taa_cart')), [cart[0], cart[2]]);
  assert.equal(abandonmentCalls, 0);
  assert.equal(shippingCalls, 2);
  assert.deepEqual(observedCarts, [[cart[0], cart[2]]]);
  assert.equal(fixture.payButton.textContent, 'Select Shipping');
  assert.notEqual(nextEnvelope.attempt.checkoutAttemptId, firstEnvelope.attempt.checkoutAttemptId);
  assert.notEqual(nextEnvelope.attempt.cartFingerprint, firstEnvelope.attempt.cartFingerprint);
});

test('real checkout controller removes an all-unavailable basket without fresh checkout work', async () => {
  const onlyUnavailable = [cart[1]];
  const fixture = createFixture({ cart: onlyUnavailable, conflictMarkup: 'complete' });
  let shippingCalls = 0;
  let abandonmentCalls = 0;
  await initCheckout({
    root: fixture.root,
    dependencies: {
      abandonCheckoutAttempt: async () => {
        abandonmentCalls += 1;
        return { result: 'abandoned' };
      },
      createCheckoutSession: async () => {
        throw physicalConflict([{ sku: 'B', reason: 'out_of_stock' }]);
      },
      getShippingOptions: async (currentCart) => {
        shippingCalls += 1;
        return shippingResult(currentCart);
      },
    },
  });

  fixture.shippingRadio.checked = true;
  await fixture.shippingRadio.dispatch('change');
  await waitFor(() => fixture.conflictRegion.attributes.has('data-ui-hidden') === false);

  const firstClick = fixture.continueButton.dispatch('click');
  const secondClick = fixture.continueButton.dispatch('click');
  await Promise.all([firstClick, secondClick]);

  assert.deepEqual(JSON.parse(fixture.storage.getItem('taa_cart')), []);
  assert.equal(abandonmentCalls, 1);
  assert.equal(shippingCalls, 1);
  assert.equal(fixture.payButton.textContent, 'Basket Empty');
  assert.equal(fixture.sessionStorage.getItem('taa_checkout_attempt_v1'), null);
});

test('real checkout controller ignores a rapid duplicate retry while inventory remains held', async () => {
  const retryCart = [cart[1]];
  const fixture = createFixture({ cart: retryCart, conflictMarkup: 'complete' });
  const requestIds = [];
  await initCheckout({
    root: fixture.root,
    dependencies: {
      createCheckoutSession: async (payload) => {
        requestIds.push(payload.checkoutRequestId);
        throw temporaryConflict('B');
      },
      getShippingOptions: async () => shippingResult(retryCart),
    },
  });

  fixture.shippingRadio.checked = true;
  await fixture.shippingRadio.dispatch('change');
  await waitFor(() => fixture.conflictRegion.attributes.has('data-ui-hidden') === false);

  const firstClick = fixture.retryButton.dispatch('click');
  const secondClick = fixture.retryButton.dispatch('click');
  await Promise.all([firstClick, secondClick]);

  assert.equal(requestIds.length, 2);
  assert.equal(new Set(requestIds).size, 1);
  assert.equal(fixture.conflictRegion.attributes.has('data-ui-hidden'), false);
  assert.equal(fixture.payButton.textContent, 'Payment Unavailable');
});

test('real checkout controller preserves payable success after rapid retry clicks', async () => {
  const retryCart = [cart[1]];
  const fixture = createFixture({ cart: retryCart, conflictMarkup: 'complete' });
  const requestIds = [];
  let invocation = 0;
  const controller = await initCheckout({
    root: fixture.root,
    dependencies: {
      createCheckoutElementsSdk: createStripeElementsDependency(),
      createCheckoutSession: async (payload) => {
        invocation += 1;
        requestIds.push(payload.checkoutRequestId);
        if (invocation === 1) throw temporaryConflict('B');
        return reservationCheckoutResult(payload, retryCart);
      },
      getShippingOptions: async () => shippingResult(retryCart),
    },
  });

  fixture.shippingRadio.checked = true;
  await fixture.shippingRadio.dispatch('change');
  await waitFor(() => fixture.conflictRegion.attributes.has('data-ui-hidden') === false);

  const firstClick = fixture.retryButton.dispatch('click');
  const secondClick = fixture.retryButton.dispatch('click');
  await Promise.all([firstClick, secondClick]);
  await waitFor(() => fixture.payButton.textContent === 'Place Order');
  await fixture.retryButton.dispatch('click');

  assert.equal(requestIds.length, 2);
  assert.equal(new Set(requestIds).size, 1);
  assert.equal(fixture.paymentWrapper.children.length, 1);
  assert.equal(fixture.conflictRegion.attributes.get('data-ui-hidden'), 'true');
  assert.equal(fixture.payButton.textContent, 'Place Order');
  assert.ok(controller.getCheckoutSession());
});

test('controller reset capability abandons an active checkout without clearing its cart', async () => {
  const activeCart = [cart[1]];
  const fixture = createFixture({ cart: activeCart, conflictMarkup: 'complete' });
  let abandonmentCalls = 0;
  const controller = await initCheckout({
    root: fixture.root,
    dependencies: {
      abandonCheckoutAttempt: async () => {
        abandonmentCalls += 1;
        return { result: 'abandoned' };
      },
      createCheckoutElementsSdk: createStripeElementsDependency(),
      createCheckoutSession: async (payload) => reservationCheckoutResult(payload, activeCart),
      getShippingOptions: async () => shippingResult(activeCart),
    },
  });

  fixture.shippingRadio.checked = true;
  await fixture.shippingRadio.dispatch('change');
  await waitFor(() => fixture.payButton.textContent === 'Place Order');

  const reset = await controller.resetCheckoutAttempt();

  assert.equal(reset.status, 'abandoned');
  assert.equal(abandonmentCalls, 1);
  assert.deepEqual(JSON.parse(fixture.storage.getItem('taa_cart')), activeCart);
  assert.equal(fixture.sessionStorage.getItem('taa_checkout_attempt_v1'), null);
  assert.equal(fixture.paymentWrapper.children.length, 0);
});

for (const conflictMarkup of ['absent', 'partial']) {
  test(`real checkout controller fails safely with ${conflictMarkup} inventory markup`, async () => {
    const fixture = createFixture({ cart, conflictMarkup });
    const originalError = console.error;
    console.error = () => {};

    try {
      const controller = await initCheckout({
        root: fixture.root,
        dependencies: {
          getShippingOptions: async () => {
            throw physicalConflict([{ sku: 'B', reason: 'out_of_stock' }]);
          },
        },
      });

      assert.equal(controller, null);
      assert.equal(fixture.payButton.textContent, 'Payment Unavailable');
      assert.equal(
        fixture.errorElement.textContent,
        'One or more items in your basket are currently unavailable.'
      );
      assert.deepEqual(JSON.parse(fixture.storage.getItem('taa_cart')), cart);
    } finally {
      console.error = originalError;
    }
  });
}
