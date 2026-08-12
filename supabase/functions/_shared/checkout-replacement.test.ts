import {
  CheckoutReplacementConflictError,
  completeCheckoutReplacement,
  validateReplacementAccess,
} from './checkout-replacement.ts';

function assertEquals(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}.`);
  }
}

Deno.test('replacement access requires ownership or a valid capability', () => {
  assertEquals(
    validateReplacementAccess({
      authorized: false,
      previousStatus: 'pending',
      previousUserId: null,
      authenticatedUserId: null,
    }),
    { allowed: false, status: 403 }
  );

  assertEquals(
    validateReplacementAccess({
      authorized: true,
      previousStatus: 'pending',
      previousUserId: null,
      authenticatedUserId: null,
    }),
    { allowed: true, status: 200 }
  );
});

Deno.test('replacement rejects an authenticated account mismatch', () => {
  assertEquals(
    validateReplacementAccess({
      authorized: true,
      previousStatus: 'pending',
      previousUserId: 'user-one',
      authenticatedUserId: 'user-two',
    }),
    { allowed: false, status: 403 }
  );
});

Deno.test('replacement requires the previous checkout intent to remain pending', () => {
  assertEquals(
    validateReplacementAccess({
      authorized: true,
      previousStatus: 'paid',
      previousUserId: 'user-one',
      authenticatedUserId: 'user-one',
    }),
    { allowed: false, status: 409 }
  );
});

Deno.test('successful replacement invalidates the old checkout after new preparation', async () => {
  const calls: string[] = ['new_checkout_prepared'];

  await completeCheckoutReplacement({
    expirePreviousCheckout: async () => {
      calls.push('old_checkout_expired');
    },
    retrievePreviousCheckout: async () => {
      throw new Error('retrieval should not be required');
    },
    compensateNewCheckout: async () => {
      calls.push('new_checkout_compensated');
      return true;
    },
    markPreviousCheckoutExpired: async () => {
      calls.push('old_intent_expired');
    },
    cleanupPreviousCoupon: async () => {
      calls.push('old_coupon_cleaned');
    },
    reportNonFatalFailure: () => {},
  });

  assertEquals(calls, [
    'new_checkout_prepared',
    'old_checkout_expired',
    'old_intent_expired',
    'old_coupon_cleaned',
  ]);
});

Deno.test('an already expired unpaid checkout permits replacement to continue', async () => {
  const calls: string[] = [];

  await completeCheckoutReplacement({
    expirePreviousCheckout: async () => {
      throw new Error('already expired');
    },
    retrievePreviousCheckout: async () => ({ status: 'expired', payment_status: 'unpaid' }),
    compensateNewCheckout: async () => {
      calls.push('new_checkout_compensated');
      return true;
    },
    markPreviousCheckoutExpired: async () => {
      calls.push('old_intent_expired');
    },
    cleanupPreviousCoupon: async () => {
      calls.push('old_coupon_cleaned');
    },
    reportNonFatalFailure: () => {},
  });

  assertEquals(calls, ['old_intent_expired', 'old_coupon_cleaned']);
});

Deno.test(
  'an open unpaid old checkout compensates the new checkout and remains usable',
  async () => {
    const calls: string[] = [];

    try {
      await completeCheckoutReplacement({
        expirePreviousCheckout: async () => {
          throw new Error('transient expiry failure');
        },
        retrievePreviousCheckout: async () => ({ status: 'open', payment_status: 'unpaid' }),
        compensateNewCheckout: async () => {
          calls.push('new_checkout_compensated');
          return true;
        },
        markPreviousCheckoutExpired: async () => {},
        cleanupPreviousCoupon: async () => {},
        reportNonFatalFailure: () => {},
      });

      throw new Error('Expected replacement conflict.');
    } catch (error) {
      if (!(error instanceof CheckoutReplacementConflictError)) throw error;

      assertEquals(error.publicCode, 'previous_checkout_usable');
    }

    assertEquals(calls, ['new_checkout_compensated']);
  }
);

Deno.test(
  'a completed paid old checkout compensates the new checkout and fails closed',
  async () => {
    const calls: string[] = [];

    try {
      await completeCheckoutReplacement({
        expirePreviousCheckout: async () => {
          throw new Error('checkout completed');
        },
        retrievePreviousCheckout: async () => ({ status: 'complete', payment_status: 'paid' }),
        compensateNewCheckout: async () => {
          calls.push('new_checkout_compensated');
          return true;
        },
        markPreviousCheckoutExpired: async () => {},
        cleanupPreviousCoupon: async () => {},
        reportNonFatalFailure: () => {},
      });

      throw new Error('Expected replacement conflict.');
    } catch (error) {
      if (!(error instanceof CheckoutReplacementConflictError)) throw error;

      assertEquals(error.publicCode, 'previous_checkout_unavailable');
    }

    assertEquals(calls, ['new_checkout_compensated']);
  }
);

Deno.test(
  'unconfirmed new checkout compensation makes both payment paths unavailable',
  async () => {
    try {
      await completeCheckoutReplacement({
        expirePreviousCheckout: async () => {
          throw new Error('transient expiry failure');
        },
        retrievePreviousCheckout: async () => ({ status: 'open', payment_status: 'unpaid' }),
        compensateNewCheckout: async () => false,
        markPreviousCheckoutExpired: async () => {},
        cleanupPreviousCoupon: async () => {},
        reportNonFatalFailure: () => {},
      });

      throw new Error('Expected replacement conflict.');
    } catch (error) {
      if (!(error instanceof CheckoutReplacementConflictError)) throw error;

      assertEquals(error.publicCode, 'previous_checkout_unavailable');
    }
  }
);
