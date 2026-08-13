import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfirmationWithRetry } from './order-confirmation-polling.js';

test('confirmation polling retries a temporary application 429 without losing authority', async () => {
  const calls = [];
  const waits = [];
  const capability = 'confirmation-capability';
  const requestConfirmation = async (sessionId, confirmationToken) => {
    calls.push({ sessionId, confirmationToken });

    if (calls.length === 1) {
      throw Object.assign(new Error('Too many requests.'), {
        status: 429,
        retryable: true,
        retryAfterMs: 5000,
      });
    }

    return { order: { id: 'order-id' }, items: [], pending: false };
  };

  const result = await loadConfirmationWithRetry('cs_test', capability, {
    requestConfirmation,
    wait: async (duration) => waits.push(duration),
    maximumAttempts: 8,
    normalRetryDelayMs: 1500,
  });

  assert.equal(result.order.id, 'order-id');
  assert.deepEqual(calls, [
    { sessionId: 'cs_test', confirmationToken: capability },
    { sessionId: 'cs_test', confirmationToken: capability },
  ]);
  assert.deepEqual(waits, [5000]);
});

test('confirmation polling caps an application rate-limit wait', async () => {
  let calls = 0;
  const waits = [];

  await loadConfirmationWithRetry('cs_test', 'capability', {
    maximumAttempts: 2,
    requestConfirmation: async () => {
      calls += 1;

      if (calls === 1) {
        throw Object.assign(new Error('Too many requests.'), {
          status: 429,
          retryable: true,
          retryAfterMs: 60000,
        });
      }

      return { order: { id: 'order-id' }, items: [], pending: false };
    },
    wait: async (duration) => waits.push(duration),
    normalRetryDelayMs: 1500,
  });

  assert.deepEqual(waits, [12000]);
});
