import {
  CheckoutEconomicsMismatchError,
  getStripeCouponParameters,
  getStripeShippingAmount,
  mapPublicDiscountError,
  parseOriginalShippingAmount,
  reconcilePaidDiscountEconomics,
  verifyCreatedDiscountEconomics,
} from './checkout-discounts.ts';

function assertEquals(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}.`);
  }
}

function assertMismatch(callback: () => unknown) {
  try {
    callback();
  } catch (error) {
    if (error instanceof CheckoutEconomicsMismatchError) return;

    throw error;
  }

  throw new Error('Expected checkout economics mismatch.');
}

Deno.test('public discount errors expose only stable customer categories', () => {
  assertEquals(mapPublicDiscountError('expired'), 'invalid_code');
  assertEquals(mapPublicDiscountError('minimum_subtotal_not_met'), 'minimum_subtotal_not_met');
  assertEquals(mapPublicDiscountError('account_required'), 'account_required');
  assertEquals(mapPublicDiscountError('not_first_household'), 'not_eligible');
  assertEquals(mapPublicDiscountError('identity_unavailable'), 'discount_unavailable');
});

Deno.test('free shipping zeroes every Stripe shipping option', () => {
  assertEquals(getStripeShippingAmount(499, 'free_shipping'), 0);
  assertEquals(getStripeShippingAmount(499, 'percentage'), 499);
  assertEquals(getStripeShippingAmount(499, null), 499);
});

Deno.test('merchandise discounts map the exact TAA amount to a once-only coupon', () => {
  assertEquals(
    getStripeCouponParameters(
      {
        eligible: true,
        reason_code: 'eligible',
        discount_code_id: '20000000-0000-0000-0000-000000000001',
        code: 'TAA10',
        name: 'Ten percent',
        discount_type: 'percentage',
        minimum_subtotal_amount: 0,
        discount_amount: 190,
        shipping_discount_amount: 0,
        final_shipping_amount: 499,
        total_amount: 2204,
      },
      '40000000-0000-0000-0000-000000000001'
    ),
    {
      amount_off: 190,
      currency: 'gbp',
      duration: 'once',
      name: 'TAA TAA10',
      metadata: {
        source: 'the_animal_alchemist_webflow',
        checkout_intent_id: '40000000-0000-0000-0000-000000000001',
        taa_discount_code_id: '20000000-0000-0000-0000-000000000001',
        taa_discount_code: 'TAA10',
      },
    }
  );
});

Deno.test('created merchandise discount economics must match TAA amounts', () => {
  verifyCreatedDiscountEconomics(
    {
      amountSubtotal: 1895,
      amountDiscount: 190,
      shippingAmount: 499,
      amountTotal: 2204,
      currency: 'gbp',
    },
    { subtotalAmount: 1895, discountAmount: 190, shippingAmount: 499, totalAmount: 2204 }
  );

  assertMismatch(() =>
    verifyCreatedDiscountEconomics(
      {
        amountSubtotal: 1895,
        amountDiscount: 189,
        shippingAmount: 499,
        amountTotal: 2205,
        currency: 'gbp',
      },
      { subtotalAmount: 1895, discountAmount: 190, shippingAmount: 499, totalAmount: 2204 }
    )
  );
});

Deno.test('paid merchandise discount reconciles the actual selected shipping method', () => {
  assertEquals(
    reconcilePaidDiscountEconomics({
      actual: {
        amountSubtotal: 1895,
        amountDiscount: 190,
        shippingAmount: 699,
        amountTotal: 2404,
        currency: 'gbp',
      },
      stored: { subtotalAmount: 1895, discountAmount: 190, shippingDiscountAmount: 0 },
      originalShippingAmount: 699,
    }),
    {
      subtotalAmount: 1895,
      shippingAmount: 699,
      shippingDiscountAmount: 0,
      totalAmount: 2404,
    }
  );
});

Deno.test('paid free shipping derives the waived amount from trusted rate metadata', () => {
  assertEquals(parseOriginalShippingAmount('699'), 699);
  assertEquals(
    reconcilePaidDiscountEconomics({
      actual: {
        amountSubtotal: 1895,
        amountDiscount: 0,
        shippingAmount: 0,
        amountTotal: 1895,
        currency: 'gbp',
      },
      stored: { subtotalAmount: 1895, discountAmount: 0, shippingDiscountAmount: 499 },
      originalShippingAmount: 699,
    }),
    {
      subtotalAmount: 1895,
      shippingAmount: 0,
      shippingDiscountAmount: 699,
      totalAmount: 1895,
    }
  );
});

Deno.test('paid free shipping fails closed on non-zero Stripe economics', () => {
  assertMismatch(() =>
    reconcilePaidDiscountEconomics({
      actual: {
        amountSubtotal: 1895,
        amountDiscount: 0,
        shippingAmount: 499,
        amountTotal: 2394,
        currency: 'gbp',
      },
      stored: { subtotalAmount: 1895, discountAmount: 0, shippingDiscountAmount: 499 },
      originalShippingAmount: 499,
    })
  );
});
