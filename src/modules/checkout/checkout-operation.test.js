import assert from 'node:assert/strict';
import test from 'node:test';
import {
  invokeCheckoutOperationOnce,
  invokeCheckoutOperationWithRetry,
  recoverCheckoutOperationBeforeFreshState,
  requestCurrentCheckoutOperation,
} from './checkout-operation.js';

test('manual inventory retry submits exactly once without an automatic retry loop', async () => {
  const phases = [];
  let calls = 0;
  const conflict = Object.assign(new Error('still temporarily reserved'), {
    checkoutInventoryError: 'inventory_conflict',
  });

  await assert.rejects(
    () =>
      invokeCheckoutOperationOnce(
        async () => {
          calls += 1;
          throw conflict;
        },
        { persistPhase: (phase) => phases.push(phase) }
      ),
    conflict
  );

  assert.equal(calls, 1);
  assert.deepEqual(phases, ['submitted']);
});

test('manual inventory Try Again re-admits the same request and never creates request C', async () => {
  const envelope = operationFixture('initial');
  const requestIds = [];
  let inventoryHeld = true;
  const dependencies = {
    createCheckoutSession: async (payload) => {
      requestIds.push(payload.checkoutRequestId);

      if (inventoryHeld) {
        throw Object.assign(new Error('temporarily reserved'), {
          checkoutInventoryError: 'inventory_conflict',
          unavailableItems: [{ sku: 'SKU', reason: 'temporarily_reserved' }],
        });
      }

      return { checkout_protocol_version: 'reservation_v1' };
    },
    resumeCheckoutSession: async () => assert.fail('same-page Try Again retains its command'),
    invokeWithRetry: (request) => invokeCheckoutOperationOnce(request, { persistPhase: () => {} }),
  };

  await assert.rejects(() =>
    requestCurrentCheckoutOperation({
      envelope,
      currentCommand: { cart: [{ sku: 'SKU', quantity: 1 }] },
      ...dependencies,
    })
  );

  inventoryHeld = false;
  await requestCurrentCheckoutOperation({
    envelope,
    currentCommand: { cart: [{ sku: 'SKU', quantity: 1 }] },
    ...dependencies,
  });

  assert.deepEqual(requestIds, [
    envelope.currentOperation.checkoutRequestId,
    envelope.currentOperation.checkoutRequestId,
  ]);
});

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
      exposeManualRetry: async () => calls.push('retry'),
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
      exposeManualRetry: async () => calls.push('retry'),
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

test('reload retry exhaustion exposes manual resume without fresh shipping or request C', async () => {
  const envelope = operationFixture('replacement');
  const originalOperation = structuredClone(envelope.currentOperation);
  const calls = [];
  let retryAvailable = false;

  const outcome = await recoverCheckoutOperationBeforeFreshState({
    operation: envelope.currentOperation,
    requestOperation: () =>
      requestCurrentCheckoutOperation({
        envelope,
        currentCommand: null,
        createCheckoutSession: async () => calls.push('create-c'),
        resumeCheckoutSession: async (payload) => {
          calls.push(['resume-b', payload]);
          throw Object.assign(new Error('still processing'), {
            orchestrationError: 'operation_in_progress',
            retryable: true,
          });
        },
        invokeWithRetry: (request) =>
          invokeCheckoutOperationWithRetry(request, {
            persistPhase: () => {},
            wait: async () => {},
          }),
      }),
    installPreparedCheckout: async () => calls.push('install'),
    navigateToConfirmation: () => calls.push('confirmation'),
    discardLocalOperation: async () => calls.push('discard'),
    resetTerminalOperation: async () => {
      calls.push('reset');
      return true;
    },
    loadFreshShippingOptions: async () => calls.push('fresh-shipping'),
    exposeManualRetry: async () => {
      retryAvailable = true;
      calls.push('retry-available');
    },
  });

  assert.equal(outcome, 'retry');
  assert.equal(retryAvailable, true);
  assert.deepEqual(envelope.currentOperation, originalOperation);
  assert.equal(calls.filter((entry) => Array.isArray(entry) && entry[0] === 'resume-b').length, 4);
  assert.equal(calls.includes('fresh-shipping'), false);
  assert.equal(calls.includes('reset'), false);
  assert.equal(calls.includes('create-c'), false);

  calls.length = 0;

  await assert.rejects(() =>
    requestCurrentCheckoutOperation({
      envelope,
      currentCommand: null,
      invokeWithRetry: async (request) => request(),
      createCheckoutSession: async () => calls.push('create-c'),
      resumeCheckoutSession: async (payload) => {
        calls.push(['manual-resume-b', payload]);
        throw new Error('manual retry fixture');
      },
    })
  );

  assert.deepEqual(calls, [
    [
      'manual-resume-b',
      {
        checkoutAttemptId: envelope.attempt.checkoutAttemptId,
        checkoutAttemptToken: envelope.attempt.checkoutAttemptToken,
        checkoutRequestId: envelope.currentOperation.checkoutRequestId,
      },
    ],
  ]);
});

test('reconciliation-required recovery remains fail closed without ordinary retry availability', async () => {
  const envelope = operationFixture('replacement');
  const calls = [];
  const error = Object.assign(new Error('reconciliation required'), {
    orchestrationError: 'reconciliation_required',
    retryable: true,
  });

  await assert.rejects(
    () =>
      recoverCheckoutOperationBeforeFreshState({
        operation: envelope.currentOperation,
        requestOperation: async () => {
          throw error;
        },
        installPreparedCheckout: async () => calls.push('install'),
        navigateToConfirmation: () => calls.push('confirmation'),
        discardLocalOperation: async () => calls.push('discard'),
        resetTerminalOperation: async () => {
          calls.push('reset');
          return true;
        },
        loadFreshShippingOptions: async () => calls.push('fresh-shipping'),
        exposeManualRetry: async () => calls.push('retry-available'),
      }),
    error
  );

  assert.deepEqual(calls, []);
});

test('pre-admission 429 keeps the local request prepared and reuses its identity', async () => {
  const phases = [];
  const waits = [];
  const requestIds = [];
  const envelope = operationFixture('replacement');

  await assert.rejects(() =>
    requestCurrentCheckoutOperation({
      envelope,
      currentCommand: { replaceCheckoutSessionId: 'cs_test_a' },
      createCheckoutSession: async (payload) => {
        requestIds.push(payload.checkoutRequestId);
        throw Object.assign(new Error('network budget exceeded'), {
          status: 429,
          orchestrationError: 'rate_limited',
          checkoutRequestAdmitted: false,
          retryable: true,
          retryAfterMs: 1000,
        });
      },
      resumeCheckoutSession: async () => assert.fail('a same-page retry retains its command'),
      invokeWithRetry: (request) =>
        invokeCheckoutOperationWithRetry(request, {
          persistPhase: (phase) => phases.push(phase),
          wait: async (duration) => waits.push(duration),
        }),
    })
  );

  assert.deepEqual(requestIds, Array(4).fill(envelope.currentOperation.checkoutRequestId));
  assert.equal(phases.at(-1), 'prepared-locally');
  assert.equal(phases.includes('processing'), false);
  assert.deepEqual(waits, [1000, 1000, 1000]);
});

test('a long application cooldown stops automatic waiting and preserves manual retry', async () => {
  const phases = [];
  const waits = [];
  const error = Object.assign(new Error('cooldown'), {
    status: 429,
    orchestrationError: 'rate_limited',
    checkoutRequestAdmitted: true,
    retryable: true,
    retryAfterMs: 60000,
  });

  await assert.rejects(
    () =>
      invokeCheckoutOperationWithRetry(
        async () => {
          throw error;
        },
        {
          persistPhase: (phase) => phases.push(phase),
          wait: async (duration) => waits.push(duration),
        }
      ),
    error
  );

  assert.deepEqual(phases, ['submitted']);
  assert.deepEqual(waits, []);
});

test('persisted-operation 429 retries and resumes only the same replacement request', async () => {
  const envelope = operationFixture('replacement');
  const createCalls = [];

  await assert.rejects(() =>
    requestCurrentCheckoutOperation({
      envelope,
      currentCommand: { replaceCheckoutSessionId: 'cs_test_a' },
      createCheckoutSession: async (payload) => {
        createCalls.push(payload.checkoutRequestId);
        throw Object.assign(new Error('request retry budget exceeded'), {
          status: 429,
          orchestrationError: 'rate_limited',
          checkoutRequestAdmitted: true,
          retryable: true,
          retryAfterMs: 1000,
        });
      },
      resumeCheckoutSession: async () => assert.fail('same-page retry retains its command'),
      invokeWithRetry: (request) =>
        invokeCheckoutOperationWithRetry(request, {
          persistPhase: () => {},
          wait: async () => {},
        }),
    })
  );

  const resumeCalls = [];

  await requestCurrentCheckoutOperation({
    envelope,
    currentCommand: null,
    invokeWithRetry: async (request) => request(),
    createCheckoutSession: async () => assert.fail('reload must not create request C'),
    resumeCheckoutSession: async (payload) => {
      resumeCalls.push(payload);
      return { checkout_protocol_version: 'reservation_v1' };
    },
  });

  assert.deepEqual(createCalls, Array(4).fill(envelope.currentOperation.checkoutRequestId));
  assert.deepEqual(resumeCalls, [
    {
      checkoutAttemptId: envelope.attempt.checkoutAttemptId,
      checkoutAttemptToken: envelope.attempt.checkoutAttemptToken,
      checkoutRequestId: envelope.currentOperation.checkoutRequestId,
    },
  ]);
});
