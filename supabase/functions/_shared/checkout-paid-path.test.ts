import { assertEquals } from 'jsr:@std/assert@1';
import type Stripe from 'npm:stripe@22.4.0';
import type { CheckoutLifecycleCandidate } from './checkout-lifecycle.ts';
import {
  hasUnresolvedInFlightReplacement,
  resolvePaidActiveIntentReplacement,
} from './checkout-paid-path.ts';

const activeId = '43000000-0000-0000-0000-000000000001';
const replacementId = '43000000-0000-0000-0000-000000000002';

function candidate(
  id: string,
  overrides: Partial<CheckoutLifecycleCandidate> = {}
): CheckoutLifecycleCandidate {
  return {
    id,
    checkout_attempt_id: '41000000-0000-0000-0000-000000000001',
    checkout_request_id: id,
    replaces_checkout_intent_id: id === replacementId ? activeId : null,
    checkout_protocol_version: 'reservation_v1',
    predecessor_invalidated_at: null,
    stripe_checkout_session_id: id === activeId ? 'cs_active' : 'cs_replacement',
    payment_intent_id: id === activeId ? 'pi_active' : 'pi_replacement',
    currency: 'gbp',
    subtotal_amount: 1000,
    active_checkout_intent_id: activeId,
    in_flight_checkout_intent_id: replacementId,
    ...overrides,
  };
}

function replacementSession(
  status: Stripe.Checkout.Session.Status,
  paymentStatus: Stripe.Checkout.Session.PaymentStatus
) {
  const replacement = candidate(replacementId);

  return {
    id: replacement.stripe_checkout_session_id,
    object: 'checkout.session',
    client_reference_id: replacement.id,
    status,
    payment_status: paymentStatus,
    currency: 'gbp',
    amount_subtotal: 1000,
    metadata: {
      source: 'the_animal_alchemist_webflow',
      protocol_version: 'reservation_v1',
      checkout_attempt_id: replacement.checkout_attempt_id,
      checkout_request_id: replacement.checkout_request_id,
      checkout_intent_id: replacement.id,
    },
    payment_intent: {
      id: 'pi_replacement',
      metadata: {
        source: 'the_animal_alchemist_webflow',
        protocol_version: 'reservation_v1',
        checkout_attempt_id: replacement.checkout_attempt_id,
        checkout_request_id: replacement.checkout_request_id,
        checkout_intent_id: replacement.id,
      },
    } as unknown as Stripe.PaymentIntent,
  } as unknown as Stripe.Checkout.Session;
}

function harness(initialSession: Stripe.Checkout.Session) {
  let currentSession = initialSession;
  let active = candidate(activeId);
  const conflicts: string[] = [];
  let expires = 0;
  let terminalizes = 0;

  return {
    dependencies: {
      loadCandidate: async (intentId: string) =>
        intentId === activeId ? active : candidate(replacementId),
      retrieveSession: async () => currentSession,
      expireSession: async () => {
        expires += 1;
        currentSession = replacementSession('expired', 'unpaid');
      },
      terminalizeReplacement: async () => {
        terminalizes += 1;
        active = candidate(activeId, { in_flight_checkout_intent_id: null });
      },
      recordConflict: async (reason: string) => {
        conflicts.push(reason);
      },
    },
    result: () => ({ conflicts, expires, terminalizes }),
  };
}

Deno.test('paid active intent identifies a blocking in-flight replacement', () => {
  assertEquals(hasUnresolvedInFlightReplacement(candidate(activeId)), true);
  assertEquals(
    hasUnresolvedInFlightReplacement(candidate(activeId, { in_flight_checkout_intent_id: null })),
    false
  );
});

Deno.test(
  'an already expired unpaid replacement is compensated before active finalization',
  async () => {
    const test = harness(replacementSession('expired', 'unpaid'));
    const result = await resolvePaidActiveIntentReplacement(candidate(activeId), test.dependencies);

    assertEquals(result?.in_flight_checkout_intent_id, null);
    assertEquals(test.result(), { conflicts: [], expires: 0, terminalizes: 1 });
  }
);

Deno.test(
  'an open unpaid replacement is expired and proven before active finalization',
  async () => {
    const test = harness(replacementSession('open', 'unpaid'));
    const result = await resolvePaidActiveIntentReplacement(candidate(activeId), test.dependencies);

    assertEquals(result?.in_flight_checkout_intent_id, null);
    assertEquals(test.result(), { conflicts: [], expires: 1, terminalizes: 1 });
  }
);

Deno.test('a paid replacement creates a paid-path conflict without terminalization', async () => {
  const test = harness(replacementSession('complete', 'paid'));
  const result = await resolvePaidActiveIntentReplacement(candidate(activeId), test.dependencies);

  assertEquals(result, null);
  assertEquals(test.result(), {
    conflicts: ['blocking_replacement_finalize'],
    expires: 0,
    terminalizes: 0,
  });
});
