import assert from 'node:assert/strict';
import { createServer as createHttpServer } from 'node:http';
import process from 'node:process';
import test from 'node:test';
import { createServer } from 'vite';

process.env.VITE_SUPABASE_URL = 'https://example.supabase.co';
process.env.VITE_SUPABASE_PUBLISHABLE_KEY = 'test-publishable-key';

const hmrServer = createHttpServer();
const viteServer = await createServer({
  appType: 'custom',
  server: { middlewareMode: true, ws: { server: hmrServer } },
});
const { resetCheckoutAttemptEnvelope, resetStoredCheckoutAttempt } = await viteServer.ssrLoadModule(
  '/src/modules/checkout/checkout-reset.js'
);

test.after(async () => {
  await viteServer.close();
});

function checkoutEnvelope({ active = true } = {}) {
  return {
    activeCheckout: active ? { checkoutSessionId: 'cs_test_reset' } : null,
    attempt: {
      checkoutAttemptId: '10000000-0000-4000-8000-000000000001',
      checkoutAttemptToken: 'a'.repeat(64),
    },
    currentOperation: null,
  };
}

test('stored reset is a no-op when no checkout attempt exists', async () => {
  let abandonmentCalls = 0;
  let clearCalls = 0;
  const reset = await resetStoredCheckoutAttempt({
    dependencies: {
      abandonCheckoutAttempt: async () => {
        abandonmentCalls += 1;
      },
      clearCheckoutAttempt: () => {
        clearCalls += 1;
      },
      loadCheckoutAttempt: () => null,
    },
  });

  assert.equal(reset.status, 'no_attempt');
  assert.equal(abandonmentCalls, 0);
  assert.equal(clearCalls, 0);
});

test('local-only checkout state clears without a backend abandonment call', async () => {
  let abandonmentCalls = 0;
  let clearCalls = 0;
  const reset = await resetCheckoutAttemptEnvelope(checkoutEnvelope({ active: false }), {
    dependencies: {
      abandonCheckoutAttempt: async () => {
        abandonmentCalls += 1;
      },
      clearCheckoutAttempt: () => {
        clearCalls += 1;
      },
    },
  });

  assert.equal(reset.status, 'local_only');
  assert.equal(abandonmentCalls, 0);
  assert.equal(clearCalls, 1);
});

test('active checkout reset uses the stored attempt capability and clears only after success', async () => {
  const envelope = checkoutEnvelope();
  const calls = [];
  const reset = await resetCheckoutAttemptEnvelope(envelope, {
    dependencies: {
      abandonCheckoutAttempt: async (capability) => {
        calls.push(['abandon', capability]);
        return { result: 'abandoned' };
      },
      clearCheckoutAttempt: () => calls.push(['clear']),
    },
  });

  assert.equal(reset.status, 'abandoned');
  assert.deepEqual(calls, [
    [
      'abandon',
      {
        checkoutAttemptId: envelope.attempt.checkoutAttemptId,
        checkoutAttemptToken: envelope.attempt.checkoutAttemptToken,
      },
    ],
    ['clear'],
  ]);
});

test('reconciliation-pending reset fails closed and preserves checkout state', async () => {
  let clearCalls = 0;

  await assert.rejects(
    resetCheckoutAttemptEnvelope(checkoutEnvelope(), {
      dependencies: {
        abandonCheckoutAttempt: async () => ({ result: 'reconciliation_pending' }),
        clearCheckoutAttempt: () => {
          clearCalls += 1;
        },
      },
    }),
    /still being reconciled/
  );

  assert.equal(clearCalls, 0);
});

test('already-paid reset is reported without clearing checkout state', async () => {
  let clearCalls = 0;
  const reset = await resetCheckoutAttemptEnvelope(checkoutEnvelope(), {
    dependencies: {
      abandonCheckoutAttempt: async () => ({ result: 'already_paid' }),
      clearCheckoutAttempt: () => {
        clearCalls += 1;
      },
    },
  });

  assert.equal(reset.status, 'already_paid');
  assert.equal(clearCalls, 0);
});

test('backend failure preserves checkout state', async () => {
  let clearCalls = 0;

  await assert.rejects(
    resetCheckoutAttemptEnvelope(checkoutEnvelope(), {
      dependencies: {
        abandonCheckoutAttempt: async () => {
          throw new Error('network unavailable');
        },
        clearCheckoutAttempt: () => {
          clearCalls += 1;
        },
      },
    }),
    /network unavailable/
  );

  assert.equal(clearCalls, 0);
});
