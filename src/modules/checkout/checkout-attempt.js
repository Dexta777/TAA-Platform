export const CHECKOUT_ATTEMPT_STORAGE_KEY = 'taa_checkout_attempt_v1';
export const CHECKOUT_PROTOCOL_VERSION = 'reservation_v1';
export const CHECKOUT_STORAGE_VERSION = 1;

const CART_FINGERPRINT_PREFIX = 'taa-checkout-cart:v1\n';
const OPERATION_PHASES = new Set([
  'prepared-locally',
  'submitted',
  'processing',
  'reconciliation-pending',
  'candidate-received',
]);

function getStorage(storage) {
  return storage || window.sessionStorage;
}

function isNonEmptyString(value) {
  return typeof value === 'string' && Boolean(value.trim());
}

function isCapability(value) {
  return (
    value &&
    typeof value === 'object' &&
    isNonEmptyString(value.checkoutRequestId) &&
    isNonEmptyString(value.checkoutIntentId) &&
    isNonEmptyString(value.checkoutSessionId) &&
    isNonEmptyString(value.confirmationToken) &&
    Number.isSafeInteger(value.confirmationGeneration) &&
    value.confirmationGeneration >= 1
  );
}

function isOperation(value) {
  return (
    value &&
    typeof value === 'object' &&
    isNonEmptyString(value.checkoutRequestId) &&
    ['initial', 'replacement'].includes(value.kind) &&
    OPERATION_PHASES.has(value.phase) &&
    Number.isFinite(Number(value.createdAt)) &&
    (value.candidate === null || isCapability(value.candidate))
  );
}

function isEnvelope(value) {
  return (
    value &&
    typeof value === 'object' &&
    value.version === CHECKOUT_STORAGE_VERSION &&
    value.protocol === CHECKOUT_PROTOCOL_VERSION &&
    value.attempt &&
    isNonEmptyString(value.attempt.checkoutAttemptId) &&
    /^[0-9a-f]{64}$/.test(value.attempt.checkoutAttemptToken) &&
    /^[0-9a-f]{64}$/.test(value.attempt.cartFingerprint) &&
    Number.isFinite(Number(value.attempt.createdAt)) &&
    (value.activeCheckout === null || isCapability(value.activeCheckout)) &&
    (value.currentOperation === null || isOperation(value.currentOperation))
  );
}

function clone(value) {
  return value === null ? null : structuredClone(value);
}

export function probeCheckoutSessionStorage(storage) {
  const target = getStorage(storage);
  const probeKey = `${CHECKOUT_ATTEMPT_STORAGE_KEY}:probe`;

  try {
    target.setItem(probeKey, '1');
    const available = target.getItem(probeKey) === '1';
    target.removeItem(probeKey);

    return available;
  } catch {
    return false;
  }
}

export function normalizeCartForFingerprint(cart) {
  if (!Array.isArray(cart) || cart.length === 0) {
    throw new Error('Your basket is empty.');
  }

  const quantitiesBySku = new Map();

  cart.forEach((item) => {
    const sku = String(item?.sku ?? '').trim();
    const quantity = Number(item?.quantity);

    if (!sku || !Number.isSafeInteger(quantity) || quantity < 1) {
      throw new Error('The basket contains an invalid item.');
    }

    const aggregate = (quantitiesBySku.get(sku) || 0) + quantity;

    if (!Number.isSafeInteger(aggregate)) {
      throw new Error('The basket contains an invalid quantity.');
    }

    quantitiesBySku.set(sku, aggregate);
  });

  return Array.from(quantitiesBySku, ([sku, quantity]) => ({ sku, quantity })).sort(
    (left, right) => (left.sku < right.sku ? -1 : left.sku > right.sku ? 1 : 0)
  );
}

export async function fingerprintCart(cart) {
  const normalizedCart = normalizeCartForFingerprint(cart);
  const input = new TextEncoder().encode(
    `${CART_FINGERPRINT_PREFIX}${JSON.stringify(normalizedCart)}`
  );
  const digest = await crypto.subtle.digest('SHA-256', input);

  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function createCheckoutAttemptEnvelope(cartFingerprint) {
  if (!/^[0-9a-f]{64}$/.test(String(cartFingerprint))) {
    throw new Error('Checkout cart fingerprint is invalid.');
  }

  const tokenBytes = crypto.getRandomValues(new Uint8Array(32));
  const checkoutAttemptToken = Array.from(tokenBytes, (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('');

  return {
    version: CHECKOUT_STORAGE_VERSION,
    protocol: CHECKOUT_PROTOCOL_VERSION,
    attempt: {
      checkoutAttemptId: crypto.randomUUID(),
      checkoutAttemptToken,
      createdAt: Date.now(),
      cartFingerprint,
    },
    activeCheckout: null,
    currentOperation: null,
  };
}

export function loadCheckoutAttempt(storage) {
  const target = getStorage(storage);

  try {
    const rawValue = target.getItem(CHECKOUT_ATTEMPT_STORAGE_KEY);

    if (!rawValue) return null;

    const envelope = JSON.parse(rawValue);

    if (!isEnvelope(envelope)) {
      target.removeItem(CHECKOUT_ATTEMPT_STORAGE_KEY);
      return null;
    }

    return clone(envelope);
  } catch (error) {
    throw new Error('Checkout session state could not be read.', { cause: error });
  }
}

export function saveCheckoutAttempt(envelope, storage) {
  if (!isEnvelope(envelope)) {
    throw new Error('Checkout session state is invalid.');
  }

  try {
    getStorage(storage).setItem(CHECKOUT_ATTEMPT_STORAGE_KEY, JSON.stringify(envelope));
  } catch (error) {
    throw new Error('Checkout session state could not be saved.', { cause: error });
  }

  return clone(envelope);
}

export function clearCheckoutAttempt(storage) {
  try {
    getStorage(storage).removeItem(CHECKOUT_ATTEMPT_STORAGE_KEY);
  } catch (error) {
    throw new Error('Checkout session state could not be cleared.', { cause: error });
  }
}

export function beginCheckoutOperation(envelope, kind, selectedShippingMethodName = '') {
  if (!isEnvelope(envelope) || !['initial', 'replacement'].includes(kind)) {
    throw new Error('Checkout operation state is invalid.');
  }

  if (envelope.currentOperation) {
    return clone(envelope);
  }

  const nextEnvelope = clone(envelope);
  nextEnvelope.currentOperation = {
    checkoutRequestId: crypto.randomUUID(),
    kind,
    phase: 'prepared-locally',
    replaces:
      kind === 'replacement' && nextEnvelope.activeCheckout
        ? {
            checkoutRequestId: nextEnvelope.activeCheckout.checkoutRequestId,
            checkoutIntentId: nextEnvelope.activeCheckout.checkoutIntentId,
            checkoutSessionId: nextEnvelope.activeCheckout.checkoutSessionId,
          }
        : null,
    candidate: null,
    selectedShippingMethodName: String(selectedShippingMethodName ?? '').trim(),
    createdAt: Date.now(),
  };

  return nextEnvelope;
}

export function beginCheckoutResume(envelope) {
  if (!isEnvelope(envelope)) throw new Error('Checkout session state is invalid.');
  if (envelope.currentOperation) return clone(envelope);
  if (!envelope.activeCheckout) throw new Error('Checkout recovery state is incomplete.');

  const nextEnvelope = clone(envelope);
  nextEnvelope.currentOperation = {
    checkoutRequestId: nextEnvelope.activeCheckout.checkoutRequestId,
    kind: 'initial',
    phase: 'submitted',
    replaces: null,
    candidate: { ...nextEnvelope.activeCheckout },
    selectedShippingMethodName: nextEnvelope.activeCheckout.selectedShippingMethodName || '',
    createdAt: Date.now(),
  };

  return nextEnvelope;
}

export function setCheckoutOperationPhase(envelope, phase) {
  if (!isEnvelope(envelope) || !envelope.currentOperation || !OPERATION_PHASES.has(phase)) {
    throw new Error('Checkout operation phase is invalid.');
  }

  const nextEnvelope = clone(envelope);
  nextEnvelope.currentOperation.phase = phase;

  return nextEnvelope;
}

export function discardCheckoutOperation(envelope) {
  if (!isEnvelope(envelope)) throw new Error('Checkout session state is invalid.');

  const nextEnvelope = clone(envelope);
  nextEnvelope.currentOperation = null;

  return nextEnvelope;
}

export function setCheckoutCandidate(envelope, capability) {
  if (!isEnvelope(envelope) || !envelope.currentOperation || !isCapability(capability)) {
    throw new Error('Checkout candidate capability is invalid.');
  }

  if (capability.checkoutRequestId !== envelope.currentOperation.checkoutRequestId) {
    throw new Error('Checkout candidate does not belong to the current request.');
  }

  const currentCandidate = envelope.currentOperation.candidate;

  if (currentCandidate) {
    const sameIdentity =
      currentCandidate.checkoutRequestId === capability.checkoutRequestId &&
      currentCandidate.checkoutIntentId === capability.checkoutIntentId &&
      currentCandidate.checkoutSessionId === capability.checkoutSessionId;

    if (
      !sameIdentity ||
      capability.confirmationGeneration < currentCandidate.confirmationGeneration
    ) {
      throw new Error('Checkout candidate response is stale or conflicting.');
    }

    if (
      capability.confirmationGeneration === currentCandidate.confirmationGeneration &&
      capability.confirmationToken !== currentCandidate.confirmationToken
    ) {
      throw new Error('Checkout candidate generation conflicts with stored authority.');
    }
  }

  const nextEnvelope = clone(envelope);
  nextEnvelope.currentOperation.phase = 'candidate-received';
  nextEnvelope.currentOperation.candidate = { ...capability };

  return nextEnvelope;
}

export function promoteCheckoutCandidate(envelope, selectedShippingMethodName = '') {
  if (!isEnvelope(envelope) || !envelope.currentOperation?.candidate) {
    throw new Error('Checkout candidate is unavailable.');
  }

  const nextEnvelope = clone(envelope);
  nextEnvelope.activeCheckout = {
    ...nextEnvelope.currentOperation.candidate,
    selectedShippingMethodName: String(selectedShippingMethodName ?? '').trim(),
  };
  nextEnvelope.currentOperation = null;

  return nextEnvelope;
}

export function getCheckoutCapabilityForSession(envelope, checkoutSessionId) {
  if (!isEnvelope(envelope)) return null;

  const normalizedSessionId = String(checkoutSessionId ?? '').trim();
  const candidates = [envelope.currentOperation?.candidate, envelope.activeCheckout];
  const capability = candidates.find(
    (candidate) => candidate?.checkoutSessionId === normalizedSessionId
  );

  return capability ? { ...capability } : null;
}
