export type PreviousCheckoutStatus = {
  status: string | null;
  payment_status: string | null;
};

type ReplacementFailureCode = 'previous_checkout_usable' | 'previous_checkout_unavailable';

export class CheckoutReplacementConflictError extends Error {
  publicCode: ReplacementFailureCode;

  constructor(publicCode: ReplacementFailureCode) {
    super('Checkout could not be safely replaced.');
    this.name = 'CheckoutReplacementConflictError';
    this.publicCode = publicCode;
  }
}

export function validateReplacementAccess({
  authorized,
  previousStatus,
  previousUserId,
  authenticatedUserId,
}: {
  authorized: boolean;
  previousStatus: string | null;
  previousUserId: string | null;
  authenticatedUserId: string | null;
}) {
  if (!authorized) return { allowed: false, status: 403 } as const;
  if (previousStatus !== 'pending') return { allowed: false, status: 409 } as const;

  if (previousUserId && previousUserId !== authenticatedUserId) {
    return { allowed: false, status: 403 } as const;
  }

  return { allowed: true, status: 200 } as const;
}

export function isCheckoutSafelyInvalidated(checkout: PreviousCheckoutStatus) {
  return checkout.status === 'expired' && checkout.payment_status === 'unpaid';
}

export function isCheckoutStillUsable(checkout: PreviousCheckoutStatus) {
  return checkout.status === 'open' && checkout.payment_status === 'unpaid';
}

export async function provePreviousCheckoutIntentExpired({
  transitionPreviousCheckoutToExpired,
  retrievePreviousCheckoutIntentStatus,
}: {
  transitionPreviousCheckoutToExpired: () => Promise<string | null>;
  retrievePreviousCheckoutIntentStatus: () => Promise<string | null>;
}) {
  let transitionedStatus: string | null = null;

  try {
    transitionedStatus = await transitionPreviousCheckoutToExpired();
  } catch {
    // A follow-up read may still prove that the transition reached terminal state.
  }

  if (transitionedStatus === 'expired') return;

  let currentStatus: string | null = null;

  try {
    currentStatus = await retrievePreviousCheckoutIntentStatus();
  } catch {
    // The actionable error below deliberately avoids exposing database details.
  }

  if (currentStatus === 'expired') return;

  throw new Error('Previous checkout intent could not be proven expired.');
}

export async function completeCheckoutReplacement({
  expirePreviousCheckout,
  retrievePreviousCheckout,
  compensateNewCheckout,
  markPreviousCheckoutExpired,
  cleanupPreviousCoupon,
  reportFailure,
}: {
  expirePreviousCheckout: () => Promise<PreviousCheckoutStatus>;
  retrievePreviousCheckout: () => Promise<PreviousCheckoutStatus>;
  compensateNewCheckout: () => Promise<boolean>;
  markPreviousCheckoutExpired: () => Promise<void>;
  cleanupPreviousCoupon: () => Promise<void>;
  reportFailure: (context: string, error: unknown) => void;
}) {
  function reportFailureSafely(context: string, error: unknown) {
    try {
      reportFailure(context, error);
    } catch {
      // Diagnostics must not interrupt compensation or terminal-state handling.
    }
  }

  async function compensateNewCheckoutSafely() {
    try {
      return await compensateNewCheckout();
    } catch (error) {
      reportFailureSafely('new_checkout_compensation', error);
      return false;
    }
  }

  let previousCheckout: PreviousCheckoutStatus | null = null;

  try {
    previousCheckout = await expirePreviousCheckout();
  } catch {
    try {
      previousCheckout = await retrievePreviousCheckout();
    } catch {
      // Retrieval failure means the previous payment path cannot be proven safe.
    }
  }

  if (!previousCheckout || !isCheckoutSafelyInvalidated(previousCheckout)) {
    const newCheckoutInvalidated = await compensateNewCheckoutSafely();

    throw new CheckoutReplacementConflictError(
      newCheckoutInvalidated && previousCheckout && isCheckoutStillUsable(previousCheckout)
        ? 'previous_checkout_usable'
        : 'previous_checkout_unavailable'
    );
  }

  try {
    await markPreviousCheckoutExpired();
  } catch (error) {
    reportFailureSafely('previous_checkout_status_proof', error);
    await compensateNewCheckoutSafely();

    throw new CheckoutReplacementConflictError('previous_checkout_unavailable');
  }

  try {
    await cleanupPreviousCoupon();
  } catch (error) {
    reportFailureSafely('previous_coupon_cleanup', error);
  }
}
