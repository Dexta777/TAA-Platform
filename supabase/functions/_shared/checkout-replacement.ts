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

export async function completeCheckoutReplacement({
  expirePreviousCheckout,
  retrievePreviousCheckout,
  compensateNewCheckout,
  markPreviousCheckoutExpired,
  cleanupPreviousCoupon,
  reportNonFatalFailure,
}: {
  expirePreviousCheckout: () => Promise<void>;
  retrievePreviousCheckout: () => Promise<PreviousCheckoutStatus>;
  compensateNewCheckout: () => Promise<boolean>;
  markPreviousCheckoutExpired: () => Promise<void>;
  cleanupPreviousCoupon: () => Promise<void>;
  reportNonFatalFailure: (context: string, error: unknown) => void;
}) {
  try {
    await expirePreviousCheckout();
  } catch {
    let previousCheckout: PreviousCheckoutStatus | null = null;

    try {
      previousCheckout = await retrievePreviousCheckout();
    } catch {
      // Retrieval failure means the previous payment path cannot be proven safe.
    }

    if (!previousCheckout || !isCheckoutSafelyInvalidated(previousCheckout)) {
      const newCheckoutInvalidated = await compensateNewCheckout();

      throw new CheckoutReplacementConflictError(
        newCheckoutInvalidated && previousCheckout && isCheckoutStillUsable(previousCheckout)
          ? 'previous_checkout_usable'
          : 'previous_checkout_unavailable'
      );
    }
  }

  try {
    await markPreviousCheckoutExpired();
  } catch (error) {
    reportNonFatalFailure('previous_checkout_status_update', error);
  }

  try {
    await cleanupPreviousCoupon();
  } catch (error) {
    reportNonFatalFailure('previous_coupon_cleanup', error);
  }
}
