import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createCheckoutDiscount,
  getDiscountErrorMessage,
  normalizeDiscountCode,
  toSingleAppliedDiscount,
} from './checkout-discount.js';
import { createCheckoutSummary, getCheckoutDiscountDisplay } from './checkout-summary.js';

class FakeClassList {
  constructor(classes = []) {
    this.classes = new Set(classes);
  }

  add(...classes) {
    classes.forEach((className) => this.classes.add(className));
  }

  contains(className) {
    return this.classes.has(className);
  }

  remove(...classes) {
    classes.forEach((className) => this.classes.delete(className));
  }

  toggle(className, force) {
    const shouldAdd = force === undefined ? !this.contains(className) : Boolean(force);

    if (shouldAdd) {
      this.add(className);
    } else {
      this.remove(className);
    }

    return shouldAdd;
  }
}

class FakeElement {
  constructor(attributes = {}) {
    this.attributes = new Map(Object.entries(attributes));
    this.children = [];
    this.classList = new FakeClassList();
    this.disabled = false;
    this.hidden = false;
    this.listeners = new Map();
    this.parentNode = null;
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
    this.children.push(child);
    return child;
  }

  cloneNode(deep = false) {
    const clone = new FakeElement(Object.fromEntries(this.attributes));
    clone.classList = new FakeClassList(this.classList.classes);
    clone.disabled = this.disabled;
    clone.hidden = this.hidden;
    clone.style = { ...this.style };
    clone.textContent = this.textContent;
    clone.value = this.value;

    if (deep) this.children.forEach((child) => clone.appendChild(child.cloneNode(true)));

    return clone;
  }

  async dispatch(type) {
    const event = { preventDefault() {} };

    for (const listener of this.listeners.get(type) || []) {
      await listener(event);
    }
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

function createDiscountFixture({ includeSuccess = false, partial = false } = {}) {
  const root = new FakeElement();
  const input = root.appendChild(new FakeElement({ 'data-discount-code': 'true' }));

  if (partial) return { root, input };

  const apply = root.appendChild(new FakeElement({ 'data-discount-apply': 'true' }));
  const wrapper = root.appendChild(new FakeElement({ 'data-applied-discounts': 'true' }));
  const template = wrapper.appendChild(
    new FakeElement({ 'data-applied-discount-template': 'true' })
  );
  template.hidden = true;
  template.style.display = 'none';
  template.appendChild(new FakeElement({ 'data-applied-discount-code': 'true' }));
  template.appendChild(new FakeElement({ 'data-applied-discount-remove': 'true' }));
  const success = includeSuccess
    ? root.appendChild(new FakeElement({ 'data-discount-success': 'true' }))
    : null;
  const error = root.appendChild(new FakeElement({ 'data-discount-error': 'true' }));

  return { apply, error, input, root, success, template, wrapper };
}

function getGeneratedRows(wrapper) {
  return wrapper.querySelectorAll('[data-applied-discount-generated="true"]');
}

function createSummaryFixture() {
  const root = new FakeElement();
  const discountRow = root.appendChild(new FakeElement({ 'data-checkout-discount-row': 'true' }));
  const discountAmount = discountRow.appendChild(
    new FakeElement({ 'data-checkout-discount': 'true' })
  );

  return { discountAmount, discountRow, root };
}

test('discount input normalization trims and uppercases customer input', () => {
  assert.equal(normalizeDiscountCode('  save10  '), 'SAVE10');
});

test('single-code presentation state never contains more than one discount', () => {
  assert.deepEqual(toSingleAppliedDiscount(null), []);
  assert.deepEqual(toSingleAppliedDiscount([{ code: 'FIRST' }, { code: 'SECOND' }]), []);
  assert.deepEqual(toSingleAppliedDiscount({ code: 'SAVE10' }), [{ code: 'SAVE10' }]);
});

test('public discount errors map to safe customer messages', () => {
  assert.equal(
    getDiscountErrorMessage({ discountError: 'not_eligible' }),
    "This discount code isn't available for this order."
  );
  assert.equal(
    getDiscountErrorMessage({
      discountError: 'minimum_subtotal_not_met',
      minimumSubtotalAmount: 2500,
    }),
    'This code requires a minimum spend of £25.00.'
  );
  assert.equal(
    getDiscountErrorMessage({ discountError: 'not_first_household' }),
    'Discount code could not be applied.'
  );
});

test('no discount hides the summary row and never displays negative zero', () => {
  assert.deepEqual(getCheckoutDiscountDisplay(null), {
    visible: false,
    amount: 0,
    code: '',
    label: 'Discount',
  });
});

test('percentage and fixed discounts display the merchandise discount', () => {
  assert.deepEqual(
    getCheckoutDiscountDisplay({
      code: 'SAVE10',
      type: 'percentage',
      discount_amount: 190,
      shipping_discount_amount: 0,
    }),
    {
      visible: true,
      amount: 190,
      code: 'SAVE10',
      label: 'Discount',
    }
  );

  assert.deepEqual(
    getCheckoutDiscountDisplay({
      code: 'SAVE5',
      type: 'fixed',
      discount_amount: 500,
      shipping_discount_amount: 0,
    }),
    {
      visible: true,
      amount: 500,
      code: 'SAVE5',
      label: 'Discount',
    }
  );
});

test('free shipping displays the selected method original price as shipping discount', () => {
  assert.deepEqual(
    getCheckoutDiscountDisplay(
      {
        code: 'FREESHIP',
        type: 'free_shipping',
        discount_amount: 0,
        shipping_discount_amount: 499,
      },
      { original_shipping: 699, shipping: 0 }
    ),
    {
      visible: true,
      amount: 699,
      code: 'FREESHIP',
      label: 'Shipping discount',
    }
  );
});

test('successful application clears input and renders one generated row from the template', async () => {
  const fixture = createDiscountFixture();
  let controller;
  controller = createCheckoutDiscount(fixture.root, {
    onApply: async (code) => controller.setAppliedDiscount({ code }),
    onRemove: async () => {},
  });
  fixture.input.value = '  save10  ';

  await fixture.apply.dispatch('click');

  const rows = getGeneratedRows(fixture.wrapper);
  assert.equal(controller.available, true);
  assert.equal(fixture.input.value, '');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].querySelector('[data-applied-discount-code="true"]').textContent, 'SAVE10');
  assert.equal(fixture.template.attributes.get('data-applied-discount-template'), 'true');
  assert.equal(fixture.template.hidden, true);
  assert.equal(fixture.template.classList.contains('is-visible'), false);
  assert.equal(rows[0].classList.contains('is-visible'), true);
  assert.equal(fixture.error.classList.contains('is-visible'), false);
});

test('successful replacement renders only the replacement code', async () => {
  const fixture = createDiscountFixture();
  let controller;
  controller = createCheckoutDiscount(fixture.root, {
    onApply: async (code) => controller.setAppliedDiscount({ code }),
    onRemove: async () => {},
  });
  controller.setAppliedDiscount({ code: 'FIRST' });
  fixture.input.value = 'second';

  await fixture.apply.dispatch('click');

  const rows = getGeneratedRows(fixture.wrapper);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].classList.contains('is-visible'), true);
  assert.equal(rows[0].querySelector('[data-applied-discount-code="true"]').textContent, 'SECOND');
  assert.deepEqual(controller.getAppliedDiscount(), { code: 'SECOND' });
});

test('failed replacement preserves the applied row and entered code', async () => {
  const fixture = createDiscountFixture();
  const originalConsoleError = console.error;
  console.error = () => {};

  try {
    const controller = createCheckoutDiscount(fixture.root, {
      onApply: async () => {
        throw { discountError: 'invalid_code' };
      },
      onRemove: async () => {},
    });
    controller.setAppliedDiscount({ code: 'FIRST' });
    fixture.input.value = 'badcode';

    await fixture.apply.dispatch('click');

    const rows = getGeneratedRows(fixture.wrapper);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].querySelector('[data-applied-discount-code="true"]').textContent, 'FIRST');
    assert.equal(fixture.input.value, 'BADCODE');
    assert.equal(fixture.error.textContent, 'This discount code is not valid.');
    assert.equal(fixture.error.classList.contains('is-visible'), true);

    controller.setAppliedDiscount({ code: 'FIRST' });
    assert.equal(fixture.error.textContent, '');
    assert.equal(fixture.error.classList.contains('is-visible'), false);
  } finally {
    console.error = originalConsoleError;
  }
});

test('generated remove control clears the applied row after successful removal', async () => {
  const fixture = createDiscountFixture();
  let removeCalls = 0;
  const controller = createCheckoutDiscount(fixture.root, {
    onApply: async () => {},
    onRemove: async () => {
      removeCalls += 1;
    },
  });
  controller.setAppliedDiscount({ code: 'SAVE10' });
  const generatedRow = getGeneratedRows(fixture.wrapper)[0];

  await generatedRow.querySelector('[data-applied-discount-remove="true"]').dispatch('click');

  assert.equal(removeCalls, 1);
  assert.equal(getGeneratedRows(fixture.wrapper).length, 0);
  assert.equal(fixture.template.attributes.get('data-applied-discount-template'), 'true');
  assert.equal(fixture.template.classList.contains('is-visible'), false);
  assert.equal(controller.getAppliedDiscount(), null);
});

test('optional success element still displays apply and removal messages', async () => {
  const fixture = createDiscountFixture({ includeSuccess: true });
  let controller;
  controller = createCheckoutDiscount(fixture.root, {
    onApply: async (code) => controller.setAppliedDiscount({ code }),
    onRemove: async () => {},
  });
  fixture.input.value = 'save10';

  await fixture.apply.dispatch('click');

  assert.equal(fixture.success.textContent, 'SAVE10 has been applied.');
  assert.equal(fixture.success.classList.contains('is-visible'), true);
  assert.equal(fixture.error.classList.contains('is-visible'), false);

  const generatedRow = getGeneratedRows(fixture.wrapper)[0];
  await generatedRow.querySelector('[data-applied-discount-remove="true"]').dispatch('click');

  assert.equal(fixture.success.textContent, 'Discount code removed.');
  assert.equal(fixture.success.classList.contains('is-visible'), true);
  assert.equal(fixture.error.classList.contains('is-visible'), false);
});

test('busy state disables input, apply, and generated remove without hiding its row', () => {
  const fixture = createDiscountFixture();
  const controller = createCheckoutDiscount(fixture.root, {
    onApply: async () => {},
    onRemove: async () => {},
  });
  controller.setAppliedDiscount({ code: 'SAVE10' });
  controller.setBusy(true);
  const generatedRow = getGeneratedRows(fixture.wrapper)[0];
  const remove = generatedRow.querySelector('[data-applied-discount-remove="true"]');

  assert.equal(fixture.input.disabled, true);
  assert.equal(fixture.apply.disabled, true);
  assert.equal(remove.disabled, true);
  assert.equal(generatedRow.classList.contains('is-visible'), true);
});

test('summary row toggles semantic visibility for active and absent discounts', () => {
  const fixture = createSummaryFixture();
  const summary = createCheckoutSummary(fixture.root);

  assert.equal(fixture.discountRow.classList.contains('is-visible'), false);

  summary.renderDiscount({
    code: 'SAVE10',
    type: 'percentage',
    discount_amount: 190,
    shipping_discount_amount: 0,
  });

  assert.equal(fixture.discountRow.classList.contains('is-visible'), true);
  assert.equal(fixture.discountAmount.textContent, '-£1.90');

  summary.renderDiscount(null);

  assert.equal(fixture.discountRow.classList.contains('is-visible'), false);
  assert.equal(fixture.discountAmount.textContent, '');
});

test('partial or absent discount markup is unavailable without breaking initialization', () => {
  const originalConsoleError = console.error;
  const diagnostics = [];
  console.error = (message) => diagnostics.push(message);

  try {
    const partial = createCheckoutDiscount(createDiscountFixture({ partial: true }).root, {
      onApply: async () => {},
      onRemove: async () => {},
    });
    const absent = createCheckoutDiscount(new FakeElement(), {
      onApply: async () => {},
      onRemove: async () => {},
    });

    assert.equal(partial.available, false);
    assert.equal(absent.available, false);
    assert.equal(diagnostics.length, 1);
  } finally {
    console.error = originalConsoleError;
  }
});
