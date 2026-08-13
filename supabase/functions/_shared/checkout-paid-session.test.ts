import { assertEquals, assertThrows } from 'jsr:@std/assert@1';
import type Stripe from 'npm:stripe@22.4.0';
import type { CheckoutLifecycleCandidate } from './checkout-lifecycle.ts';
import {
  PaidCheckoutSessionValidationError,
  validatePaidCheckoutSessionEconomics,
} from './checkout-paid-session.ts';

const candidate: CheckoutLifecycleCandidate = {
  id: '43000000-0000-0000-0000-000000000001',
  checkout_attempt_id: '41000000-0000-0000-0000-000000000001',
  checkout_request_id: '42000000-0000-0000-0000-000000000001',
  replaces_checkout_intent_id: null,
  checkout_protocol_version: 'reservation_v1',
  predecessor_invalidated_at: null,
  stripe_checkout_session_id: 'cs_paid_economics',
  payment_intent_id: 'pi_paid_economics',
  currency: 'gbp',
  subtotal_amount: 2000,
  active_checkout_intent_id: '43000000-0000-0000-0000-000000000001',
  in_flight_checkout_intent_id: null,
};

function paymentIntent() {
  return {
    id: candidate.payment_intent_id!,
    object: 'payment_intent',
    metadata: {
      source: 'the_animal_alchemist_webflow',
      protocol_version: 'reservation_v1',
      checkout_attempt_id: candidate.checkout_attempt_id,
      checkout_request_id: candidate.checkout_request_id,
      checkout_intent_id: candidate.id,
    },
  } as unknown as Stripe.PaymentIntent;
}

function session(overrides: Record<string, unknown> = {}) {
  return {
    id: candidate.stripe_checkout_session_id,
    object: 'checkout.session',
    client_reference_id: candidate.id,
    status: 'complete',
    payment_status: 'paid',
    currency: 'gbp',
    amount_subtotal: 2000,
    amount_total: 2500,
    total_details: { amount_discount: 0 },
    shipping_cost: { amount_total: 500, shipping_rate: 'shr_paid_economics' },
    metadata: {
      source: 'the_animal_alchemist_webflow',
      protocol_version: 'reservation_v1',
      checkout_attempt_id: candidate.checkout_attempt_id,
      checkout_request_id: candidate.checkout_request_id,
      checkout_intent_id: candidate.id,
    },
    payment_intent: paymentIntent(),
    ...overrides,
  } as unknown as Stripe.Checkout.Session;
}

function shippingRate(overrides: Record<string, unknown> = {}) {
  return {
    id: 'shr_paid_economics',
    object: 'shipping_rate',
    display_name: 'Tracked',
    metadata: {
      shipping_method_id: 'method-tracked',
      shipping_rate_id: 'rate-tracked',
      original_shipping_amount: '500',
    },
    ...overrides,
  } as unknown as Stripe.ShippingRate;
}

function checkoutIntent(overrides: Record<string, unknown> = {}) {
  return {
    id: candidate.id,
    user_id: null,
    shipping_name: null,
    shipping_phone: null,
    shipping_address: null,
    billing_name: null,
    billing_address: null,
    subtotal_amount: 2000,
    discount_code_id: null,
    discount_code: null,
    discount_amount: 0,
    shipping_discount_amount: 0,
    stripe_coupon_id: null,
    ...overrides,
  };
}

function shippingOption(overrides: Record<string, unknown> = {}) {
  return {
    shipping_method_id: 'method-tracked',
    shipping_rate_id: 'rate-tracked',
    display_name: 'Tracked',
    amount: 500,
    original_amount: 500,
    currency: 'gbp',
    stripe_shipping_rate_id: 'shr_paid_economics',
    ...overrides,
  };
}

function validate(
  overrides: {
    session?: Record<string, unknown>;
    checkoutIntent?: Record<string, unknown>;
    shippingRate?: Record<string, unknown>;
    shippingOption?: Record<string, unknown>;
  } = {}
) {
  return validatePaidCheckoutSessionEconomics({
    session: session(overrides.session),
    paymentIntent: paymentIntent(),
    candidate,
    checkoutIntent: checkoutIntent(overrides.checkoutIntent),
    shippingRate: shippingRate(overrides.shippingRate),
    shippingOption: shippingOption(overrides.shippingOption),
  });
}

function assertValidationCode(code: string, callback: () => unknown) {
  const error = assertThrows(callback, PaidCheckoutSessionValidationError);
  assertEquals(error.code, code);
}

Deno.test('webhook and reconciler share valid no-discount paid economics', () => {
  const webhookResult = validate();
  const reconcilerResult = validate();

  assertEquals(webhookResult, reconcilerResult);
  assertEquals(webhookResult, {
    subtotalAmount: 2000,
    shippingAmount: 500,
    shippingDiscountAmount: 0,
    totalAmount: 2500,
  });
});

Deno.test('paid economics reject the wrong discount amount', () => {
  assertValidationCode('economics_amount_discount', () =>
    validate({
      session: {
        amount_total: 2299,
        total_details: { amount_discount: 201 },
      },
      checkoutIntent: {
        discount_code_id: 'discount-id',
        discount_code: 'SAVE10',
        discount_amount: 200,
      },
    })
  );
});

Deno.test('paid economics reject the wrong shipping amount', () => {
  assertValidationCode('economics_shipping_amount', () =>
    validate({
      session: { shipping_cost: { amount_total: 499, shipping_rate: 'shr_paid_economics' } },
    })
  );
});

Deno.test('paid economics reject the wrong total', () => {
  assertValidationCode('economics_amount_total', () =>
    validate({ session: { amount_total: 2499 } })
  );
});

Deno.test('paid economics reject the wrong selected shipping rate', () => {
  assertValidationCode('selected_shipping_rate_mismatch', () =>
    validate({ shippingOption: { stripe_shipping_rate_id: 'shr_other' } })
  );
});

Deno.test('paid economics accept a valid merchandise discount', () => {
  assertEquals(
    validate({
      session: {
        amount_total: 2300,
        total_details: { amount_discount: 200 },
      },
      checkoutIntent: {
        discount_code_id: 'discount-id',
        discount_code: 'SAVE10',
        discount_amount: 200,
      },
    }),
    {
      subtotalAmount: 2000,
      shippingAmount: 500,
      shippingDiscountAmount: 0,
      totalAmount: 2300,
    }
  );
});

Deno.test('paid economics accept valid free shipping', () => {
  assertEquals(
    validate({
      session: {
        amount_total: 2000,
        total_details: { amount_discount: 0 },
        shipping_cost: { amount_total: 0, shipping_rate: 'shr_paid_economics' },
      },
      checkoutIntent: {
        discount_code_id: 'discount-id',
        discount_code: 'FREESHIP',
        shipping_discount_amount: 500,
      },
      shippingOption: { amount: 0 },
    }),
    {
      subtotalAmount: 2000,
      shippingAmount: 0,
      shippingDiscountAmount: 500,
      totalAmount: 2000,
    }
  );
});
