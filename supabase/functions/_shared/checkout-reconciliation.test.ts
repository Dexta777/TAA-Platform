import { assertEquals } from 'jsr:@std/assert@1';
import type Stripe from 'npm:stripe@22.4.0';
import {
  getCheckoutDiscoveryWindow,
  selectDiscoveredCheckoutSession,
} from './checkout-reconciliation.ts';

const identity = {
  checkoutAttemptId: '41000000-0000-0000-0000-000000000001',
  checkoutRequestId: '42000000-0000-0000-0000-000000000001',
  checkoutIntentId: '43000000-0000-0000-0000-000000000001',
};

function session(id: string, overrides: Partial<Stripe.Checkout.Session> = {}) {
  return {
    id,
    object: 'checkout.session',
    client_reference_id: identity.checkoutIntentId,
    metadata: {
      source: 'the_animal_alchemist_webflow',
      protocol_version: 'reservation_v1',
      checkout_attempt_id: identity.checkoutAttemptId,
      checkout_request_id: identity.checkoutRequestId,
      checkout_intent_id: identity.checkoutIntentId,
    },
    ...overrides,
  } as Stripe.Checkout.Session;
}

Deno.test('bounded discovery selects exactly one full metadata match', () => {
  const result = selectDiscoveredCheckoutSession(
    [session('cs_wrong', { client_reference_id: 'wrong' }), session('cs_match')],
    identity
  );

  assertEquals(result.outcome, 'found');
  assertEquals(result.session?.id, 'cs_match');
});

Deno.test('bounded discovery rejects multiple matching Sessions', () => {
  const result = selectDiscoveredCheckoutSession(
    [session('cs_match_one'), session('cs_match_two')],
    identity
  );

  assertEquals(result.outcome, 'conflict');
});

Deno.test('discovery window is bounded by creation, hard expiry, and margin', () => {
  assertEquals(
    getCheckoutDiscoveryWindow({
      createdAt: '2026-08-12T10:00:00.000Z',
      hardExpiresAt: '2026-08-12T12:00:00.000Z',
    }),
    { gte: 1786528500, lte: 1786536300 }
  );
});
