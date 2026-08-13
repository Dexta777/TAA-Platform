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
