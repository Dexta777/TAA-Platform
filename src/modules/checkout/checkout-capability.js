import { getCheckoutCapabilityForSession, loadCheckoutAttempt } from './checkout-attempt.js';

const CAPABILITY_KEY_PREFIX = 'taa_checkout_confirmation:';
const CAPABILITY_TTL_MS = 24 * 60 * 60 * 1000;

function getStorageKey(checkoutSessionId) {
  const normalizedSessionId = String(checkoutSessionId ?? '').trim();

  return normalizedSessionId ? `${CAPABILITY_KEY_PREFIX}${normalizedSessionId}` : '';
}

export function storeCheckoutCapability(checkoutSessionId, confirmationToken, checkoutIntentId) {
  const storageKey = getStorageKey(checkoutSessionId);
  const normalizedToken = String(confirmationToken ?? '').trim();

  if (!storageKey || !normalizedToken) {
    throw new Error('Checkout confirmation details are incomplete.');
  }

  try {
    localStorage.setItem(
      storageKey,
      JSON.stringify({
        checkoutIntentId: checkoutIntentId || null,
        confirmationToken: normalizedToken,
        createdAt: Date.now(),
      })
    );
  } catch (error) {
    throw new Error('Checkout confirmation could not be saved in this browser.', {
      cause: error,
    });
  }
}

export function getCheckoutCapability(checkoutSessionId) {
  const storageKey = getStorageKey(checkoutSessionId);

  if (!storageKey) return null;

  try {
    const storedValue = localStorage.getItem(storageKey);

    if (!storedValue) return null;

    const capability = JSON.parse(storedValue);

    const createdAt = Number(capability?.createdAt);
    const expired = !Number.isFinite(createdAt) || Date.now() - createdAt > CAPABILITY_TTL_MS;

    if (!capability || typeof capability.confirmationToken !== 'string' || expired) {
      localStorage.removeItem(storageKey);
      return null;
    }

    return { ...capability };
  } catch (error) {
    console.error('Checkout confirmation capability could not be read.', error);

    try {
      localStorage.removeItem(storageKey);
    } catch {
      // The read diagnostic above is sufficient when storage itself is unavailable.
    }

    return null;
  }
}

export function getCheckoutCapabilityForConfirmation(checkoutSessionId) {
  let reservationCapability = null;

  try {
    reservationCapability = getCheckoutCapabilityForSession(
      loadCheckoutAttempt(),
      checkoutSessionId
    );
  } catch (error) {
    console.error('Reservation checkout capability could not be read.', error);
  }

  if (reservationCapability) {
    return { ...reservationCapability, protocol: 'reservation_v1' };
  }

  const legacyCapability = getCheckoutCapability(checkoutSessionId);

  return legacyCapability ? { ...legacyCapability, protocol: 'legacy' } : null;
}

export function removeCheckoutCapability(checkoutSessionId) {
  const storageKey = getStorageKey(checkoutSessionId);

  if (!storageKey) return;

  try {
    localStorage.removeItem(storageKey);
  } catch (error) {
    console.error('Checkout confirmation capability could not be removed.', error);
  }
}
