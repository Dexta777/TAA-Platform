import assert from 'node:assert/strict';
import test from 'node:test';
import {
  continueWithoutUnavailableItems,
  createCheckoutInventoryConflict,
  mapCheckoutInventoryConflict,
} from './checkout-inventory-conflict.js';

class FakeElement {
  constructor(tagName = 'div', attributes = {}) {
    this.tagName = tagName;
    this.attributes = new Map(Object.entries(attributes));
    this.children = [];
    this.disabled = false;
    this.focused = false;
    this.listeners = new Map();
    this.parentNode = null;
    this.textContent = '';
    this.src = '';
    this.alt = '';
    this.ownerDocument = null;
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
      await listener({ preventDefault() {} });
    }
  }

  focus() {
    this.focused = true;
  }

  matches(selector) {
    const valueMatch = selector.match(/^\[([^=]+)="([^"]+)"\]$/);

    if (valueMatch) return this.attributes.get(valueMatch[1]) === valueMatch[2];

    const presenceMatch = selector.match(/^\[([^=]+)\]$/);
    return Boolean(presenceMatch && this.attributes.has(presenceMatch[1]));
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

  remove() {
    if (!this.parentNode) return;

    this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
    this.parentNode = null;
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }
}

function createFixture() {
  const ownerDocument = {
    createElement(tagName) {
      const element = new FakeElement(tagName);
      element.ownerDocument = ownerDocument;
      return element;
    },
  };
  const root = new FakeElement();
  root.ownerDocument = ownerDocument;
  const region = root.appendChild(
    new FakeElement('section', { 'data-checkout-inventory-conflict': 'true' })
  );
  const title = region.appendChild(
    new FakeElement('h2', { 'data-checkout-inventory-title': 'true' })
  );
  const message = region.appendChild(
    new FakeElement('p', { 'data-checkout-inventory-message': 'true' })
  );
  const items = region.appendChild(
    new FakeElement('div', { 'data-checkout-inventory-items': 'true' })
  );
  const retry = region.appendChild(
    new FakeElement('button', { 'data-checkout-inventory-retry': 'true' })
  );
  const continueButton = region.appendChild(
    new FakeElement('button', { 'data-checkout-inventory-continue': 'true' })
  );

  return { continueButton, items, message, region, retry, root, title };
}

const cart = [
  {
    sku: 'A',
    title: 'Dracorium',
    variant: 'Dog Wound Latex',
    image: 'https://example.test/a.jpg',
    quantity: 1,
    untouched: { keep: true },
  },
  { sku: 'B', title: 'Fortifico', variant: 'default', quantity: 2 },
  { sku: 'C', title: 'Available', quantity: 3 },
];

function inventoryError(items) {
  return {
    checkoutInventoryError: 'inventory_conflict',
    unavailableItems: items,
  };
}

function createDeferred() {
  let resolve;
  const promise = new Promise((nextResolve) => {
    resolve = nextResolve;
  });

  return { promise, resolve };
}

test('canonical conflicts map only to current local cart presentation data', () => {
  const mapped = mapCheckoutInventoryConflict(
    inventoryError([
      { sku: 'A', reason: 'temporarily_reserved' },
      { sku: 'B', reason: 'out_of_stock' },
    ]),
    cart
  );

  assert.equal(mapped.unavailableItems[0].title, 'Dracorium | Dog Wound Latex');
  assert.equal(mapped.unavailableItems[0].image, 'https://example.test/a.jpg');
  assert.equal(mapped.unavailableItems[1].title, 'Fortifico');
  assert.equal(mapped.canRetry, false);
  assert.equal(
    mapCheckoutInventoryConflict(inventoryError([{ sku: 'STALE', reason: 'out_of_stock' }]), cart),
    null
  );
});

test('mixed conflict renders deliberate accessible UI and hides Try Again', async () => {
  const fixture = createFixture();
  const calls = [];
  const controller = createCheckoutInventoryConflict(fixture.root, {
    onContinue: async (conflict) => calls.push(['continue', conflict]),
    onRetry: async (conflict) => calls.push(['retry', conflict]),
  });
  const conflict = {
    ...mapCheckoutInventoryConflict(
      inventoryError([
        { sku: 'A', reason: 'temporarily_reserved' },
        { sku: 'B', reason: 'out_of_stock' },
      ]),
      cart
    ),
    cartFingerprint: 'fingerprint',
    checkoutRequestId: 'request',
  };

  assert.equal(fixture.region.attributes.get('data-ui-hidden'), 'true');
  assert.equal(controller.show(conflict), true);
  assert.equal(fixture.region.attributes.has('data-ui-hidden'), false);
  assert.equal(fixture.region.attributes.get('role'), 'alert');
  assert.equal(fixture.region.focused, true);
  assert.equal(fixture.retry.attributes.get('data-ui-hidden'), 'true');
  assert.equal(fixture.continueButton.textContent, 'Continue Without These Items');
  assert.equal(fixture.items.querySelectorAll('[data-checkout-inventory-item]').length, 2);
  assert.equal(
    fixture.items.querySelector('[data-checkout-inventory-item-title]').textContent,
    'Dracorium | Dog Wound Latex'
  );

  await fixture.retry.dispatch('click');
  await fixture.continueButton.dispatch('click');
  assert.deepEqual(
    calls.map(([action]) => action),
    ['continue']
  );
});

test('all temporary conflicts expose one deliberate manual Try Again action', async () => {
  const fixture = createFixture();
  const calls = [];
  const controller = createCheckoutInventoryConflict(fixture.root, {
    onContinue: async () => {},
    onRetry: async (conflict) => calls.push(conflict),
  });
  const conflict = {
    ...mapCheckoutInventoryConflict(
      inventoryError([
        { sku: 'A', reason: 'temporarily_reserved' },
        { sku: 'B', reason: 'temporarily_reserved' },
      ]),
      cart
    ),
    cartFingerprint: 'fingerprint',
    checkoutRequestId: 'request',
  };

  controller.show(conflict);
  assert.equal(fixture.retry.attributes.has('data-ui-hidden'), false);
  await fixture.retry.dispatch('click');
  assert.equal(calls.length, 1);

  controller.hide();
  assert.equal(fixture.region.attributes.get('data-ui-hidden'), 'true');
  assert.equal(fixture.items.querySelectorAll('[data-checkout-inventory-item]').length, 0);
});

test('rapid Try Again clicks acquire one synchronous action owner', async () => {
  const fixture = createFixture();
  const deferred = createDeferred();
  let backendCalls = 0;
  const controller = createCheckoutInventoryConflict(fixture.root, {
    onContinue: async () => {},
    onRetry: async () => {
      backendCalls += 1;
      await deferred.promise;
    },
  });
  const conflict = {
    ...mapCheckoutInventoryConflict(
      inventoryError([{ sku: 'A', reason: 'temporarily_reserved' }]),
      cart
    ),
    cartFingerprint: 'fingerprint',
    checkoutRequestId: 'request',
  };

  controller.show(conflict);
  const firstClick = fixture.retry.dispatch('click');
  const secondClick = fixture.retry.dispatch('click');

  assert.equal(backendCalls, 1);
  assert.equal(fixture.region.attributes.get('aria-busy'), 'true');
  assert.equal(fixture.retry.disabled, true);

  deferred.resolve();
  await Promise.all([firstClick, secondClick]);

  assert.equal(backendCalls, 1);
  assert.equal(fixture.region.attributes.has('data-ui-hidden'), false);
  assert.equal(fixture.region.attributes.get('aria-busy'), 'false');
});

test('successful rapid Try Again invalidates captured conflict actions', async () => {
  const fixture = createFixture();
  const deferred = createDeferred();
  let backendCalls = 0;
  let payable = false;
  let controller;
  controller = createCheckoutInventoryConflict(fixture.root, {
    onContinue: async () => {},
    onRetry: async () => {
      backendCalls += 1;
      await deferred.promise;
      payable = true;
      controller.hide();
    },
  });
  const conflict = {
    ...mapCheckoutInventoryConflict(
      inventoryError([{ sku: 'A', reason: 'temporarily_reserved' }]),
      cart
    ),
    cartFingerprint: 'fingerprint',
    checkoutRequestId: 'request',
  };

  controller.show(conflict);
  const firstClick = fixture.retry.dispatch('click');
  const secondClick = fixture.retry.dispatch('click');
  deferred.resolve();
  await Promise.all([firstClick, secondClick]);
  await fixture.retry.dispatch('click');

  assert.equal(backendCalls, 1);
  assert.equal(payable, true);
  assert.equal(fixture.region.attributes.get('data-ui-hidden'), 'true');
});

test('Continue Without and competing conflict actions mutate exactly once', async () => {
  const fixture = createFixture();
  const deferred = createDeferred();
  const calls = [];
  const controller = createCheckoutInventoryConflict(fixture.root, {
    onContinue: async () => {
      calls.push('continue');
      await deferred.promise;
    },
    onRetry: async () => calls.push('retry'),
  });
  const conflict = {
    ...mapCheckoutInventoryConflict(
      inventoryError([{ sku: 'A', reason: 'temporarily_reserved' }]),
      cart
    ),
    cartFingerprint: 'fingerprint',
    checkoutRequestId: 'request',
  };

  controller.show(conflict);
  const continueClick = fixture.continueButton.dispatch('click');
  const duplicateContinue = fixture.continueButton.dispatch('click');
  const competingRetry = fixture.retry.dispatch('click');

  assert.deepEqual(calls, ['continue']);
  deferred.resolve();
  await Promise.all([continueClick, duplicateContinue, competingRetry]);
  assert.deepEqual(calls, ['continue']);
});

test('Continue Without preserves unaffected lines and explicitly resets in the same document', async () => {
  const calls = [];
  const originalRemainingLine = cart[2];
  let storedCart = cart;
  const conflict = {
    unavailableItems: [
      { sku: 'A', reason: 'temporarily_reserved' },
      { sku: 'B', reason: 'out_of_stock' },
    ],
  };
  const outcome = await continueWithoutUnavailableItems({
    conflict,
    isCurrent: async () => true,
    removeItems: (skus) => {
      calls.push(['storage-write', skus]);
      storedCart = storedCart.filter((item) => !skus.includes(item.sku));
      return storedCart;
    },
    resetCheckout: async () => calls.push(['explicit-reset']),
  });

  assert.equal(outcome.status, 'continued');
  assert.equal(outcome.cart[0], originalRemainingLine);
  assert.deepEqual(calls, [['storage-write', ['A', 'B']], ['explicit-reset']]);
});

test('Continue Without all items produces empty state while stale conflicts mutate nothing', async () => {
  let removeCalls = 0;
  let resetCalls = 0;
  const conflict = { unavailableItems: [{ sku: 'A', reason: 'out_of_stock' }] };
  const empty = await continueWithoutUnavailableItems({
    conflict,
    isCurrent: async () => true,
    removeItems: () => {
      removeCalls += 1;
      return [];
    },
    resetCheckout: async () => {
      resetCalls += 1;
    },
  });

  assert.equal(empty.status, 'empty');
  assert.equal(removeCalls, 1);
  assert.equal(resetCalls, 1);

  const stale = await continueWithoutUnavailableItems({
    conflict,
    isCurrent: async () => false,
    removeItems: () => {
      removeCalls += 1;
      return [];
    },
    resetCheckout: async () => {
      resetCalls += 1;
    },
  });

  assert.equal(stale.status, 'stale');
  assert.equal(removeCalls, 1);
  assert.equal(resetCalls, 1);
});

test('partial inventory markup fails gracefully', () => {
  const root = new FakeElement();
  root.appendChild(new FakeElement('section', { 'data-checkout-inventory-conflict': 'true' }));
  const originalError = console.error;
  const diagnostics = [];
  console.error = (...values) => diagnostics.push(values.join(' '));

  try {
    const controller = createCheckoutInventoryConflict(root, {
      onContinue: async () => {},
      onRetry: async () => {},
    });

    assert.equal(controller.isReady, false);
    assert.equal(controller.show({ unavailableItems: [], canRetry: false }), false);
    assert.equal(diagnostics.length, 1);
  } finally {
    console.error = originalError;
  }
});
