import test from 'node:test';
import assert from 'node:assert/strict';
import { getDiscountErrorMessage, normalizeDiscountCode } from './checkout-discount.js';
import { getCheckoutDiscountDisplay } from './checkout-summary.js';

test('discount input normalization trims and uppercases customer input', () => {
  assert.equal(normalizeDiscountCode('  save10  '), 'SAVE10');
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
