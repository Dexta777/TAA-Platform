import { assertEquals, assertRejects } from 'jsr:@std/assert@1';
import type Stripe from 'npm:stripe@22.4.0';
import type { CheckoutLifecycleCandidate } from './checkout-lifecycle.ts';
import {
  classifyTargetedRecoveryState,
  getNoSessionRecoveryAction,
  parseCheckoutOperatorRecoveryBody,
  processKnownCheckoutSession,
  type TargetedRecoveryState,
} from './checkout-operator-recovery.ts';

const attemptId = '11000000-0000-4000-8000-000000000001';
const requestId = '12000000-0000-4000-8000-000000000001';
const intentId = '13000000-0000-4000-8000-000000000001';
const sessionId = 'cs_operator_recovery';

const candidate: CheckoutLifecycleCandidate = {
  id: intentId,
  checkout_attempt_id: attemptId,
  checkout_request_id: requestId,
  replaces_checkout_intent_id: null,
  checkout_protocol_version: 'reservation_v1',
  predecessor_invalidated_at: null,
  stripe_checkout_session_id: sessionId,
  payment_intent_id: null,
  currency: 'gbp',
  subtotal_amount: 2500,
  active_checkout_intent_id: intentId,
  in_flight_checkout_intent_id: null,
};

function session(
  status: Stripe.Checkout.Session.Status | null,
  paymentStatus: Stripe.Checkout.Session.PaymentStatus
) {
  return {
    id: sessionId,
    object: 'checkout.session',
    status,
    payment_status: paymentStatus,
    currency: 'gbp',
    amount_subtotal: 2500,
    client_reference_id: intentId,
    payment_intent: null,
    metadata: {
      source: 'the_animal_alchemist_webflow',
      protocol_version: 'reservation_v1',
      checkout_attempt_id: attemptId,
      checkout_request_id: requestId,
      checkout_intent_id: intentId,
    },
  } as unknown as Stripe.Checkout.Session;
}

function dependencies(
  retrieveSession: (checkoutSessionId: string) => Promise<Stripe.Checkout.Session>
) {
  const calls: string[] = [];

  return {
    calls,
    value: {
      retrieveSession: async (checkoutSessionId: string) => {
        calls.push(`retrieve:${checkoutSessionId}`);
        return await retrieveSession(checkoutSessionId);
      },
      loadCandidate: async () => candidate,
      expireSession: async () => {
        calls.push('expire');
      },
      finalizeSession: async () => {
        calls.push('finalize');
        return 'resolved' as const;
      },
      markPaymentPending: async () => {
        calls.push('payment_pending');
      },
      transitionTerminal: async () => {
        calls.push('terminalize');
      },
      recordUnsupportedState: async () => {
        calls.push('manual_review');
      },
      now: () => Date.parse('2026-08-18T12:00:00.000Z'),
    },
  };
}

Deno.test('operator request parsing preserves batch mode and validates an exact target', () => {
  assertEquals(parseCheckoutOperatorRecoveryBody('', null), { mode: 'batch' });
  assertEquals(
    parseCheckoutOperatorRecoveryBody(
      JSON.stringify({ checkout_attempt_id: attemptId }),
      'targeted'
    ),
    { mode: 'targeted', checkoutAttemptId: attemptId }
  );
});

Deno.test(
  'operator request parsing rejects malformed, non-exact, and invalid target bodies',
  () => {
    for (const body of [
      '{',
      '{}',
      '[]',
      JSON.stringify({ checkout_attempt_id: attemptId, extra: true }),
      JSON.stringify({ checkout_attempt_id: 'not-a-uuid' }),
    ]) {
      assertRejects(async () => parseCheckoutOperatorRecoveryBody(body, 'targeted'));
    }

    assertRejects(async () =>
      parseCheckoutOperatorRecoveryBody(JSON.stringify({ checkout_attempt_id: attemptId }), null)
    );
    for (const requestedMode of ['', 'batch', 'targeted']) {
      assertRejects(async () => parseCheckoutOperatorRecoveryBody('', requestedMode));
    }
  }
);

function targetedState(overrides: Partial<TargetedRecoveryState> = {}): TargetedRecoveryState {
  return {
    attemptStatus: 'expired',
    activeCheckoutIntentId: null,
    inFlightCheckoutIntentId: null,
    reservationStatus: 'released',
    reservationOrderId: null,
    intents: [{ id: intentId, status: 'expired', orchestrationState: 'failed' }],
    orders: [],
    manualReviewJobCount: 0,
    ...overrides,
  };
}

Deno.test('targeted postconditions require coherent terminal and paid shapes', () => {
  assertEquals(classifyTargetedRecoveryState(targetedState()), 'recovered');
  assertEquals(
    classifyTargetedRecoveryState(
      targetedState({
        intents: [{ id: intentId, status: 'paid', orchestrationState: 'paid' }],
      })
    ),
    'integrity_review'
  );

  const orderId = '14000000-0000-4000-8000-000000000001';
  const paidState = targetedState({
    attemptStatus: 'paid',
    reservationStatus: 'consumed',
    reservationOrderId: orderId,
    intents: [{ id: intentId, status: 'paid', orchestrationState: 'paid' }],
    orders: [{ id: orderId, checkoutIntentId: intentId }],
  });

  assertEquals(classifyTargetedRecoveryState(paidState), 'paid_preserved');
  assertEquals(
    classifyTargetedRecoveryState({
      ...paidState,
      intents: [{ id: intentId, status: 'failed', orchestrationState: 'failed' }],
    }),
    'integrity_review'
  );
  assertEquals(
    classifyTargetedRecoveryState({ ...paidState, manualReviewJobCount: 1 }),
    'integrity_review'
  );
});

Deno.test('no-Session recovery action is selected only for a coherent lifecycle topology', () => {
  const replacementId = '13000000-0000-4000-8000-000000000002';

  assertEquals(
    getNoSessionRecoveryAction({
      checkoutIntentId: intentId,
      replacesCheckoutIntentId: null,
      predecessorInvalidatedAt: null,
      activeCheckoutIntentId: null,
      inFlightCheckoutIntentId: intentId,
    }),
    'terminalize_attempt'
  );
  assertEquals(
    getNoSessionRecoveryAction({
      checkoutIntentId: replacementId,
      replacesCheckoutIntentId: intentId,
      predecessorInvalidatedAt: null,
      activeCheckoutIntentId: intentId,
      inFlightCheckoutIntentId: replacementId,
    }),
    'fail_pre_checkpoint_replacement'
  );
  assertEquals(
    getNoSessionRecoveryAction({
      checkoutIntentId: replacementId,
      replacesCheckoutIntentId: intentId,
      predecessorInvalidatedAt: '2026-08-18T12:00:00.000Z',
      activeCheckoutIntentId: null,
      inFlightCheckoutIntentId: replacementId,
    }),
    'terminalize_attempt'
  );
  assertEquals(
    getNoSessionRecoveryAction({
      checkoutIntentId: replacementId,
      replacesCheckoutIntentId: intentId,
      predecessorInvalidatedAt: null,
      activeCheckoutIntentId: null,
      inFlightCheckoutIntentId: replacementId,
    }),
    'manual_review'
  );
  assertEquals(
    getNoSessionRecoveryAction({
      checkoutIntentId: replacementId,
      replacesCheckoutIntentId: intentId,
      predecessorInvalidatedAt: null,
      activeCheckoutIntentId: '15000000-0000-4000-8000-000000000001',
      inFlightCheckoutIntentId: replacementId,
    }),
    'manual_review'
  );
  assertEquals(
    getNoSessionRecoveryAction({
      checkoutIntentId: replacementId,
      replacesCheckoutIntentId: intentId,
      predecessorInvalidatedAt: '2026-08-18T12:00:00.000Z',
      activeCheckoutIntentId: intentId,
      inFlightCheckoutIntentId: replacementId,
    }),
    'manual_review'
  );
});

Deno.test(
  'active unpaid recovery expires Stripe before authoritative terminalization',
  async () => {
    const sessions = [session('open', 'unpaid'), session('expired', 'unpaid')];
    const deps = dependencies(async () => sessions.shift()!);

    const outcome = await processKnownCheckoutSession(
      {
        checkoutSessionId: sessionId,
        reservationExpiresAt: '2026-08-18T13:00:00.000Z',
        forceExpireOpenSession: true,
      },
      deps.value
    );

    assertEquals(outcome, 'resolved');
    assertEquals(deps.calls, [
      `retrieve:${sessionId}`,
      'expire',
      `retrieve:${sessionId}`,
      'terminalize',
    ]);
  }
);

Deno.test(
  'already expired unpaid recovery terminalizes without a second Stripe expiry',
  async () => {
    const deps = dependencies(async () => session('expired', 'unpaid'));

    assertEquals(
      await processKnownCheckoutSession(
        {
          checkoutSessionId: sessionId,
          reservationExpiresAt: '2026-08-18T11:00:00.000Z',
          forceExpireOpenSession: true,
        },
        deps.value
      ),
      'resolved'
    );
    assertEquals(deps.calls, [`retrieve:${sessionId}`, 'terminalize']);
  }
);

Deno.test('transient Stripe failure never reaches the terminal database callback', async () => {
  const deps = dependencies(async () => {
    throw new Error('transient Stripe failure');
  });

  await assertRejects(
    () =>
      processKnownCheckoutSession(
        {
          checkoutSessionId: sessionId,
          reservationExpiresAt: '2026-08-18T11:00:00.000Z',
          forceExpireOpenSession: true,
        },
        deps.value
      ),
    Error,
    'transient Stripe failure'
  );
  assertEquals(deps.calls, [`retrieve:${sessionId}`]);
});

Deno.test('paid recovery uses paid finalization and never expires or releases', async () => {
  const deps = dependencies(async () => session('complete', 'paid'));

  assertEquals(
    await processKnownCheckoutSession(
      {
        checkoutSessionId: sessionId,
        reservationExpiresAt: '2026-08-18T11:00:00.000Z',
        forceExpireOpenSession: true,
      },
      deps.value
    ),
    'resolved'
  );
  assertEquals(deps.calls, [`retrieve:${sessionId}`, 'finalize']);
});

Deno.test('complete unpaid recovery retains stock in payment-pending retry', async () => {
  const deps = dependencies(async () => session('complete', 'unpaid'));

  assertEquals(
    await processKnownCheckoutSession(
      {
        checkoutSessionId: sessionId,
        reservationExpiresAt: '2026-08-18T11:00:00.000Z',
        forceExpireOpenSession: true,
      },
      deps.value
    ),
    'retry'
  );
  assertEquals(deps.calls, [`retrieve:${sessionId}`, 'payment_pending']);
});

Deno.test('unsupported Stripe state records manual review without terminalization', async () => {
  const deps = dependencies(async () => session(null, 'unpaid'));

  assertEquals(
    await processKnownCheckoutSession(
      {
        checkoutSessionId: sessionId,
        reservationExpiresAt: '2026-08-18T11:00:00.000Z',
        forceExpireOpenSession: true,
      },
      deps.value
    ),
    'manual_review'
  );
  assertEquals(deps.calls, [`retrieve:${sessionId}`, 'manual_review']);
});
