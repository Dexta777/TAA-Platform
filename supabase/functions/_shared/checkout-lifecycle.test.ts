import { assertEquals, assertThrows } from 'jsr:@std/assert@1';
import type Stripe from 'npm:stripe@22.4.0';
import {
  CheckoutLifecycleValidationError,
  classifyAuthoritativeCheckoutSession,
  isPaidInFlightReplacement,
  validateAuthoritativeCheckoutSession,
  type CheckoutLifecycleCandidate,
} from './checkout-lifecycle.ts';

function candidate(overrides: Partial<CheckoutLifecycleCandidate> = {}) {
  return {
    id: '40000000-0000-0000-0000-000000000001',
    checkout_attempt_id: '41000000-0000-0000-0000-000000000001',
    checkout_request_id: '42000000-0000-0000-0000-000000000001',
    replaces_checkout_intent_id: null,
    checkout_protocol_version: 'reservation_v1',
    predecessor_invalidated_at: null,
    stripe_checkout_session_id: 'cs_test_lifecycle',
    payment_intent_id: 'pi_test_lifecycle',
    currency: 'gbp',
    subtotal_amount: 1000,
    active_checkout_intent_id: '40000000-0000-0000-0000-000000000001',
    in_flight_checkout_intent_id: null,
    ...overrides,
  };
}

function session(overrides: Partial<Stripe.Checkout.Session> = {}) {
  const value = candidate();

  return {
    id: value.stripe_checkout_session_id,
    object: 'checkout.session',
    client_reference_id: value.id,
    currency: value.currency,
    amount_subtotal: value.subtotal_amount,
    status: 'complete',
    payment_status: 'paid',
    metadata: {
      source: 'the_animal_alchemist_webflow',
      protocol_version: 'reservation_v1',
      checkout_attempt_id: value.checkout_attempt_id,
      checkout_request_id: value.checkout_request_id,
      checkout_intent_id: value.id,
    },
    payment_intent: {
      id: value.payment_intent_id!,
      object: 'payment_intent',
      metadata: {
        source: 'the_animal_alchemist_webflow',
        protocol_version: 'reservation_v1',
        checkout_attempt_id: value.checkout_attempt_id,
        checkout_request_id: value.checkout_request_id,
        checkout_intent_id: value.id,
      },
    } as unknown as Stripe.PaymentIntent,
    ...overrides,
  } as Stripe.Checkout.Session;
}

Deno.test(
  'authoritative lifecycle classification covers paid, pending, expired, and open states',
  () => {
    assertEquals(classifyAuthoritativeCheckoutSession(session()), 'finalize');
    assertEquals(
      classifyAuthoritativeCheckoutSession(
        session({ status: 'complete', payment_status: 'unpaid' })
      ),
      'payment_pending'
    );
    assertEquals(
      classifyAuthoritativeCheckoutSession(
        session({ status: 'expired', payment_status: 'unpaid' })
      ),
      'expired_unpaid'
    );
    assertEquals(
      classifyAuthoritativeCheckoutSession(session({ status: 'open', payment_status: 'unpaid' })),
      'retain'
    );
  }
);

Deno.test('authoritative Session metadata and PaymentIntent metadata must match PostgreSQL', () => {
  validateAuthoritativeCheckoutSession(session(), candidate());

  const error = assertThrows(
    () =>
      validateAuthoritativeCheckoutSession(
        session({ metadata: { source: 'untrusted' } }),
        candidate()
      ),
    CheckoutLifecycleValidationError
  );

  assertEquals(error.code, 'source_mismatch');
});

Deno.test('canonical economics and current lifecycle ownership are validated', () => {
  assertThrows(
    () => validateAuthoritativeCheckoutSession(session({ amount_subtotal: 999 }), candidate()),
    CheckoutLifecycleValidationError
  );
  assertThrows(
    () =>
      validateAuthoritativeCheckoutSession(
        session(),
        candidate({ active_checkout_intent_id: null })
      ),
    CheckoutLifecycleValidationError
  );
});

Deno.test('paid in-flight replacement is identified before predecessor invalidation', () => {
  assertEquals(
    isPaidInFlightReplacement(
      candidate({
        replaces_checkout_intent_id: '40000000-0000-0000-0000-000000000000',
        active_checkout_intent_id: '40000000-0000-0000-0000-000000000000',
        in_flight_checkout_intent_id: '40000000-0000-0000-0000-000000000001',
      })
    ),
    true
  );
});
