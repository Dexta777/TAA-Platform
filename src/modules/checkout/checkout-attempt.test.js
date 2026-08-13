import assert from 'node:assert/strict';
import test from 'node:test';
import {
  beginCheckoutOperation,
  beginCheckoutResume,
  CHECKOUT_ATTEMPT_STORAGE_KEY,
  clearCheckoutAttempt,
  createCheckoutAttemptEnvelope,
  discardCheckoutOperation,
  fingerprintCart,
  getCheckoutCapabilityForSession,
  loadCheckoutAttempt,
  normalizeCartForFingerprint,
  probeCheckoutSessionStorage,
  promoteCheckoutCandidate,
  saveCheckoutAttempt,
  setCheckoutCandidate,
  setCheckoutOperationPhase,
} from './checkout-attempt.js';

class FakeStorage {
  constructor({ unavailable = false } = {}) {
    this.unavailable = unavailable;
    this.values = new Map();
  }

  getItem(key) {
    if (this.unavailable) throw new Error('unavailable');
    return this.values.get(key) ?? null;
  }

  setItem(key, value) {
    if (this.unavailable) throw new Error('unavailable');
    this.values.set(key, String(value));
  }

  removeItem(key) {
    if (this.unavailable) throw new Error('unavailable');
    this.values.delete(key);
  }
}

const CART = [
  { sku: ' SKU-B ', quantity: 1 },
  { sku: 'SKU-A', quantity: 2 },
  { sku: 'SKU-B', quantity: 3 },
];

async function createEnvelope() {
  return createCheckoutAttemptEnvelope(await fingerprintCart(CART));
}

function capability(overrides = {}) {
  return {
    checkoutRequestId: '20000000-0000-4000-8000-000000000001',
    checkoutIntentId: '30000000-0000-4000-8000-000000000001',
    checkoutSessionId: 'cs_test_one',
    confirmationToken: 'confirmation-one',
    confirmationGeneration: 1,
    ...overrides,
  };
}

test('attempt capabilities contain 256 random bits and persist only to supplied session storage', async () => {
  const sessionStorage = new FakeStorage();
  const localStorage = new FakeStorage();
  const envelope = await createEnvelope();

  assert.match(envelope.attempt.checkoutAttemptToken, /^[0-9a-f]{64}$/);
  assert.match(
    envelope.attempt.checkoutAttemptId,
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
  );

  saveCheckoutAttempt(envelope, sessionStorage);

  assert.ok(sessionStorage.getItem(CHECKOUT_ATTEMPT_STORAGE_KEY));
  assert.equal(localStorage.getItem(CHECKOUT_ATTEMPT_STORAGE_KEY), null);
});

test('cart fingerprint normalization aggregates duplicate SKUs, preserves case and sorts', async () => {
  assert.deepEqual(normalizeCartForFingerprint(CART), [
    { sku: 'SKU-A', quantity: 2 },
    { sku: 'SKU-B', quantity: 4 },
  ]);
  assert.equal(
    await fingerprintCart(CART),
    await fingerprintCart([
      { sku: 'SKU-B', quantity: 4 },
      { sku: 'SKU-A', quantity: 2 },
    ])
  );
  assert.notEqual(
    await fingerprintCart(CART),
    await fingerprintCart([{ sku: 'sku-b', quantity: 4 }])
  );
  await assert.rejects(() => fingerprintCart([{ sku: 'SKU-A', quantity: 0 }]));
});

test('session storage is probed and unavailable storage fails closed', () => {
  assert.equal(probeCheckoutSessionStorage(new FakeStorage()), true);
  assert.equal(probeCheckoutSessionStorage(new FakeStorage({ unavailable: true })), false);
});

test('one request ID survives processing phases and resume while replacement gets a new ID', async () => {
  let envelope = beginCheckoutOperation(await createEnvelope(), 'initial', 'Royal Mail');
  const initialRequestId = envelope.currentOperation.checkoutRequestId;

  envelope = setCheckoutOperationPhase(envelope, 'submitted');
  envelope = setCheckoutOperationPhase(envelope, 'processing');
  envelope = setCheckoutOperationPhase(envelope, 'reconciliation-pending');

  assert.equal(envelope.currentOperation.checkoutRequestId, initialRequestId);

  envelope = setCheckoutCandidate(envelope, capability({ checkoutRequestId: initialRequestId }));
  envelope = promoteCheckoutCandidate(envelope, 'Royal Mail');
  envelope = beginCheckoutResume(envelope);

  assert.equal(envelope.currentOperation.checkoutRequestId, initialRequestId);

  envelope = discardCheckoutOperation(envelope);
  envelope = beginCheckoutOperation(envelope, 'replacement', 'Royal Mail');

  assert.notEqual(envelope.currentOperation.checkoutRequestId, initialRequestId);
  assert.equal(envelope.currentOperation.replaces.checkoutRequestId, initialRequestId);
});

test('confirmation generations are monotonic only within the same logical request', async () => {
  let envelope = beginCheckoutOperation(await createEnvelope(), 'initial');
  const requestId = envelope.currentOperation.checkoutRequestId;

  envelope = setCheckoutCandidate(
    envelope,
    capability({ checkoutRequestId: requestId, confirmationGeneration: 3 })
  );
  envelope = setCheckoutCandidate(
    envelope,
    capability({
      checkoutRequestId: requestId,
      confirmationToken: 'confirmation-four',
      confirmationGeneration: 4,
    })
  );

  assert.throws(() =>
    setCheckoutCandidate(
      envelope,
      capability({ checkoutRequestId: requestId, confirmationGeneration: 2 })
    )
  );

  envelope = promoteCheckoutCandidate(envelope);
  envelope = beginCheckoutOperation(envelope, 'replacement');
  const replacementRequestId = envelope.currentOperation.checkoutRequestId;
  envelope = setCheckoutCandidate(
    envelope,
    capability({
      checkoutRequestId: replacementRequestId,
      checkoutIntentId: '30000000-0000-4000-8000-000000000002',
      checkoutSessionId: 'cs_test_two',
      confirmationToken: 'replacement-one',
      confirmationGeneration: 1,
    })
  );

  assert.equal(envelope.currentOperation.candidate.confirmationGeneration, 1);
});

test('a stale predecessor capability cannot overwrite the intended replacement', async () => {
  let envelope = beginCheckoutOperation(await createEnvelope(), 'initial');
  const firstRequestId = envelope.currentOperation.checkoutRequestId;
  envelope = setCheckoutCandidate(
    envelope,
    capability({ checkoutRequestId: firstRequestId, confirmationGeneration: 8 })
  );
  envelope = promoteCheckoutCandidate(envelope);
  envelope = beginCheckoutOperation(envelope, 'replacement');

  assert.throws(() =>
    setCheckoutCandidate(
      envelope,
      capability({ checkoutRequestId: firstRequestId, confirmationGeneration: 9 })
    )
  );
});

test('candidate promotion exposes one matching confirmation tuple and storage returns copies', async () => {
  const storage = new FakeStorage();
  let envelope = beginCheckoutOperation(await createEnvelope(), 'initial');
  const requestId = envelope.currentOperation.checkoutRequestId;
  envelope = setCheckoutCandidate(envelope, capability({ checkoutRequestId: requestId }));
  envelope = promoteCheckoutCandidate(envelope, 'Tracked');
  saveCheckoutAttempt(envelope, storage);

  const loaded = loadCheckoutAttempt(storage);
  const storedCapability = getCheckoutCapabilityForSession(loaded, 'cs_test_one');

  assert.equal(storedCapability.checkoutRequestId, requestId);
  assert.equal(loaded.activeCheckout.selectedShippingMethodName, 'Tracked');
  loaded.activeCheckout.confirmationToken = 'mutated';
  assert.equal(
    getCheckoutCapabilityForSession(loadCheckoutAttempt(storage), 'cs_test_one').confirmationToken,
    'confirmation-one'
  );

  clearCheckoutAttempt(storage);
  assert.equal(loadCheckoutAttempt(storage), null);
});
