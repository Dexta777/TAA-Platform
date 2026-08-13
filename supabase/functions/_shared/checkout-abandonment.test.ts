import { assertEquals } from 'jsr:@std/assert@1';
import {
  checkoutSessionMatchesAttempt,
  getCheckoutAbandonmentAction,
} from './checkout-abandonment.ts';

const identity = {
  checkoutAttemptId: '10000000-0000-4000-8000-000000000001',
  checkoutRequestId: '20000000-0000-4000-8000-000000000001',
  checkoutIntentId: '30000000-0000-4000-8000-000000000001',
};

Deno.test('abandonment requires the complete reservation-v1 Stripe identity', () => {
  const session = {
    client_reference_id: identity.checkoutIntentId,
    metadata: {
      protocol_version: 'reservation_v1',
      checkout_attempt_id: identity.checkoutAttemptId,
      checkout_request_id: identity.checkoutRequestId,
      checkout_intent_id: identity.checkoutIntentId,
    },
  };

  assertEquals(
    checkoutSessionMatchesAttempt(
      session as never,
      identity.checkoutAttemptId,
      identity.checkoutIntentId,
      identity.checkoutRequestId
    ),
    true
  );
  assertEquals(
    checkoutSessionMatchesAttempt(
      {
        ...session,
        metadata: { ...session.metadata, checkout_request_id: crypto.randomUUID() },
      } as never,
      identity.checkoutAttemptId,
      identity.checkoutIntentId,
      identity.checkoutRequestId
    ),
    false
  );
});

Deno.test('abandonment releases only after authoritative expired and unpaid proof', () => {
  assertEquals(
    getCheckoutAbandonmentAction({ status: 'open', payment_status: 'unpaid' }),
    'expire_then_verify'
  );
  assertEquals(
    getCheckoutAbandonmentAction({ status: 'expired', payment_status: 'unpaid' }),
    'terminalize'
  );
  assertEquals(
    getCheckoutAbandonmentAction({ status: 'complete', payment_status: 'unpaid' }),
    'reconciliation_pending'
  );
  assertEquals(
    getCheckoutAbandonmentAction({ status: 'complete', payment_status: 'paid' }),
    'already_paid'
  );
});
