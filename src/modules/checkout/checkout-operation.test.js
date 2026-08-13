import assert from 'node:assert/strict';
import test from 'node:test';
import {
  invokeCheckoutOperationWithRetry,
  recoverCheckoutOperationBeforeFreshState,
  requestCurrentCheckoutOperation,
} from './checkout-operation.js';

function operationFixture(kind = 'initial') {
  return {
    attempt: {
      checkoutAttemptId: '10000000-0000-4000-8000-000000000001',
      checkoutAttemptToken: 'a'.repeat(64),
    },
    activeCheckout: {
      checkoutRequestId: '20000000-0000-4000-8000-000000000001',
      checkoutIntentId: '30000000-0000-4000-8000-000000000001',
      checkoutSessionId: 'cs_test_a',
      confirmationToken: 'confirmation-a',
      confirmationGeneration: 1,
      selectedShippingMethodName: 'Frozen shipping',
    },
    currentOperation: {
      checkoutRequestId:
        kind === 'replacement'
          ? '20000000-0000-4000-8000-000000000002'
          : '20000000-0000-4000-8000-000000000001',
      kind,
      phase: 'processing',
      selectedShippingMethodName: 'Frozen shipping',
    },
  };
}

function retryDependencies(calls, result = { checkout_protocol_version: 'reservation_v1' }) {
  return {
    invokeWithRetry: async (request) => request(),
    createCheckoutSession: async (payload) => {
      calls.push(['create', payload]);
      return result;
    },
    resumeCheckoutSession: async (payload) => {
      calls.push(['resume', payload]);
      return result;
    },
  };
}

test('active v1 and replacement recovery resume before any mutable shipping lookup', async () => {
  for (const kind of ['initial', 'replacement']) {
    const calls = [];
    const envelope = operationFixture(kind);

    const outcome = await recoverCheckoutOperationBeforeFreshState({
      operation: envelope.currentOperation,
      requestOperation: async () => {
        calls.push('resume');
        return { checkout_state: 'active' };
      },
      installPreparedCheckout: async () => calls.push('install-frozen-snapshot'),
      navigateToConfirmation: () => calls.push('confirmation'),
      discardLocalOperation: async () => calls.push('discard'),
      resetTerminalOperation: async () => {
        calls.push('reset');
        return true;
      },
      loadFreshShippingOptions: async () => {
        calls.push('fresh-shipping');
        throw new Error('Mutable shipping configuration changed.');
      },
    });

    assert.equal(outcome, 'installed');
    assert.deepEqual(calls, ['resume', 'install-frozen-snapshot']);
  }
});

test('prepared-local not-found and terminal reset load fresh shipping only after safe resolution', async () => {
  const scenarios = [
    {
      phase: 'prepared-locally',
      orchestrationError: 'checkout_request_not_found',
      expected: ['resume', 'discard', 'fresh-shipping'],
    },
    {
      phase: 'processing',
      orchestrationError: 'request_not_materialized',
      expected: ['resume', 'reset', 'fresh-shipping'],
    },
  ];

  for (const scenario of scenarios) {
    const calls = [];
    const operation = { ...operationFixture().currentOperation, phase: scenario.phase };

    const outcome = await recoverCheckoutOperationBeforeFreshState({
      operation,
      requestOperation: async () => {
        calls.push('resume');
        throw Object.assign(new Error('recovery state'), {
          orchestrationError: scenario.orchestrationError,
        });
      },
      installPreparedCheckout: async () => calls.push('install'),
      navigateToConfirmation: () => calls.push('confirmation'),
      discardLocalOperation: async () => calls.push('discard'),
      resetTerminalOperation: async () => {
        calls.push('reset');
        return true;
      },
      loadFreshShippingOptions: async () => calls.push('fresh-shipping'),
    });

    assert.equal(outcome, 'fresh');
    assert.deepEqual(calls, scenario.expected);
  }
});

test('retry with an in-memory replacement command reuses request B and never substitutes A shipping', async () => {
  const calls = [];
  const envelope = operationFixture('replacement');
  const currentCommand = {
    cart: [{ sku: 'SKU', quantity: 1 }],
    discountCode: 'SAVE10',
    replaceCheckoutSessionId: 'cs_test_a',
  };

  await requestCurrentCheckoutOperation({
    envelope,
    currentCommand,
    ...retryDependencies(calls),
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'create');
  assert.equal(calls[0][1].checkoutRequestId, envelope.currentOperation.checkoutRequestId);
  assert.equal(calls[0][1].checkoutAttemptId, envelope.attempt.checkoutAttemptId);
  assert.equal(calls[0][1].replaceCheckoutSessionId, 'cs_test_a');
  assert.equal(
    calls.some(([name]) => name === 'update-shipping-a'),
    false
  );
});

test('manual retry after reload resumes replacement B with the same request identity', async () => {
  const calls = [];
  const envelope = operationFixture('replacement');

  await requestCurrentCheckoutOperation({
    envelope,
    currentCommand: null,
    ...retryDependencies(calls),
  });

  assert.deepEqual(calls, [
    [
      'resume',
      {
        checkoutAttemptId: envelope.attempt.checkoutAttemptId,
        checkoutAttemptToken: envelope.attempt.checkoutAttemptToken,
        checkoutRequestId: envelope.currentOperation.checkoutRequestId,
      },
    ],
  ]);
});

test('202 and retryable failures repeatedly invoke replacement B without creating C', async () => {
  const calls = [];
  const phases = [];
  const waits = [];
  const envelope = operationFixture('replacement');
  const currentCommand = { replaceCheckoutSessionId: 'cs_test_a' };
  let responseNumber = 0;
  const dependencies = retryDependencies(calls);
  dependencies.createCheckoutSession = async (payload) => {
    calls.push(['create', payload]);
    responseNumber += 1;

    if (responseNumber === 1) {
      throw Object.assign(new Error('202 operation in progress'), {
        orchestrationError: 'operation_in_progress',
        retryable: true,
        retryAfterMs: 3000,
      });
    }

    if (responseNumber === 2) {
      throw Object.assign(new Error('503 rate limited'), {
        orchestrationError: 'stripe_rate_limited',
        retryable: true,
        retryAfterMs: 5000,
      });
    }

    return { checkout_protocol_version: 'reservation_v1' };
  };

  await requestCurrentCheckoutOperation({
    envelope,
    currentCommand,
    ...dependencies,
    invokeWithRetry: (request) =>
      invokeCheckoutOperationWithRetry(request, {
        persistPhase: (phase) => phases.push(phase),
        wait: async (duration) => waits.push(duration),
      }),
  });

  assert.equal(calls.length, 3);
  assert.deepEqual(
    calls.map(([, payload]) => payload.checkoutRequestId),
    Array(3).fill(envelope.currentOperation.checkoutRequestId)
  );
  assert.deepEqual(waits, [3000, 5000]);
  assert.deepEqual(phases, ['submitted', 'processing', 'submitted', 'processing', 'submitted']);
});

test('automatic retry exhaustion leaves the same replacement request available for manual resume', async () => {
  const envelope = operationFixture('replacement');
  const calls = [];

  await assert.rejects(() =>
    requestCurrentCheckoutOperation({
      envelope,
      currentCommand: { replaceCheckoutSessionId: 'cs_test_a' },
      createCheckoutSession: async (payload) => {
        calls.push(payload.checkoutRequestId);
        throw Object.assign(new Error('still processing'), {
          orchestrationError: 'operation_in_progress',
          retryable: true,
        });
      },
      resumeCheckoutSession: async () => assert.fail('resume is not used while command exists'),
      invokeWithRetry: (request) =>
        invokeCheckoutOperationWithRetry(request, {
          persistPhase: () => {},
          wait: async () => {},
        }),
    })
  );

  assert.deepEqual(calls, Array(4).fill(envelope.currentOperation.checkoutRequestId));
});
