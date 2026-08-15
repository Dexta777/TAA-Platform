import assert from 'node:assert/strict';
import test from 'node:test';
import { createCheckoutInvocationError } from './checkout-errors.js';

test('application 429 retains safe admission metadata and a realistic Retry-After', () => {
  const error = createCheckoutInvocationError(
    {
      error: 'Too many requests.',
      checkout_orchestration_error: 'rate_limited',
      rate_limit_scope: 'persisted_operation',
      checkout_request_admitted: true,
      retry_after_seconds: 600,
    },
    'Payment could not be prepared.',
    { status: 429 }
  );

  assert.equal(error.status, 429);
  assert.equal(error.retryAfterMs, 600000);
  assert.equal(error.retryable, true);
  assert.equal(error.rateLimitScope, 'persisted_operation');
  assert.equal(error.checkoutRequestAdmitted, true);
  assert.equal(error.orchestrationError, 'rate_limited');
});

test('application rate limiting remains distinct from Stripe rate limiting', () => {
  const applicationError = createCheckoutInvocationError(
    { checkout_orchestration_error: 'rate_limited' },
    'fallback',
    { status: 429 }
  );
  const stripeError = createCheckoutInvocationError(
    { checkout_orchestration_error: 'stripe_rate_limited' },
    'fallback',
    { status: 503 }
  );

  assert.equal(applicationError.orchestrationError, 'rate_limited');
  assert.equal(stripeError.orchestrationError, 'stripe_rate_limited');
  assert.equal(stripeError.checkoutRequestAdmitted, null);
});

test('valid item-aware inventory conflict is defensively mapped and immutable', () => {
  const error = createCheckoutInvocationError(
    {
      error: '<strong>untrusted server title</strong>',
      checkout_inventory_error: 'inventory_conflict',
      checkout_request_admitted: false,
      retryable: false,
      unavailable_items: [
        { sku: 'CANONICAL-A', reason: 'temporarily_reserved' },
        { sku: 'CANONICAL-B', reason: 'out_of_stock' },
      ],
    },
    'Payment could not be prepared.',
    { status: 409 }
  );

  assert.equal(error.message, 'One or more items in your basket are currently unavailable.');
  assert.equal(error.checkoutInventoryError, 'inventory_conflict');
  assert.equal(error.checkoutRequestAdmitted, false);
  assert.equal(error.retryable, false);
  assert.deepEqual(error.unavailableItems, [
    { sku: 'CANONICAL-A', reason: 'temporarily_reserved' },
    { sku: 'CANONICAL-B', reason: 'out_of_stock' },
  ]);
  assert.equal(Object.isFrozen(error.unavailableItems), true);
  assert.equal(Object.isFrozen(error.unavailableItems[0]), true);
});

test('malformed inventory payload remains a generic checkout failure', () => {
  const malformedPayloads = [
    {
      checkout_inventory_error: 'inventory_conflict',
      checkout_request_admitted: true,
      retryable: false,
      unavailable_items: [{ sku: 'A', reason: 'out_of_stock' }],
    },
    {
      checkout_inventory_error: 'inventory_conflict',
      checkout_request_admitted: false,
      retryable: false,
      unavailable_items: [{ sku: 'A', reason: 'unknown' }],
    },
    {
      checkout_inventory_error: 'inventory_conflict',
      checkout_request_admitted: false,
      retryable: false,
      unavailable_items: [
        { sku: 'A', reason: 'out_of_stock' },
        { sku: 'A', reason: 'out_of_stock' },
      ],
    },
  ];

  malformedPayloads.forEach((payload) => {
    const error = createCheckoutInvocationError(
      { error: '<script>unsafe</script>', ...payload },
      'Payment could not be prepared.',
      { status: 409 }
    );

    assert.equal(error.message, 'Payment could not be prepared.');
    assert.equal(error.checkoutInventoryError, null);
    assert.deepEqual(error.unavailableItems, []);
  });
});
