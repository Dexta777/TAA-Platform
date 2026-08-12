import {
  CheckoutReplacementConflictError,
  completeCheckoutReplacement,
  provePreviousCheckoutIntentExpired,
  validateReplacementAccess,
} from './checkout-replacement.ts';

function assertEquals(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}.`);
  }
}

async function assertReplacementConflict(callback: () => Promise<void>, expectedCode: string) {
  try {
    await callback();
  } catch (error) {
    if (!(error instanceof CheckoutReplacementConflictError)) throw error;

    assertEquals(error.publicCode, expectedCode);
    return;
  }

  throw new Error('Expected replacement conflict.');
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
      return { status: 'expired', payment_status: 'unpaid' };
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
    reportFailure: () => {},
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
      await provePreviousCheckoutIntentExpired({
        transitionPreviousCheckoutToExpired: async () => {
          calls.push('old_intent_transition_attempted');
          return null;
        },
        retrievePreviousCheckoutIntentStatus: async () => {
          calls.push('old_intent_expired_proven');
          return 'expired';
        },
      });
    },
    cleanupPreviousCoupon: async () => {
      calls.push('old_coupon_cleaned');
    },
    reportFailure: () => {},
  });

  assertEquals(calls, [
    'old_intent_transition_attempted',
    'old_intent_expired_proven',
    'old_coupon_cleaned',
  ]);
});

Deno.test(
  'database status update failure compensates the new checkout and fails closed',
  async () => {
    const calls: string[] = [];

    await assertReplacementConflict(
      () =>
        completeCheckoutReplacement({
          expirePreviousCheckout: async () => {
            calls.push('old_checkout_expired');
            return { status: 'expired', payment_status: 'unpaid' };
          },
          retrievePreviousCheckout: async () => {
            throw new Error('retrieval should not be required');
          },
          compensateNewCheckout: async () => {
            calls.push('new_checkout_compensated');
            return true;
          },
          markPreviousCheckoutExpired: async () => {
            calls.push('old_intent_status_failed');
            throw new Error('status unavailable');
          },
          cleanupPreviousCoupon: async () => {
            calls.push('old_coupon_cleaned');
          },
          reportFailure: (context) => {
            calls.push(context);
          },
        }),
      'previous_checkout_unavailable'
    );

    assertEquals(calls, [
      'old_checkout_expired',
      'old_intent_status_failed',
      'previous_checkout_status_proof',
      'new_checkout_compensated',
    ]);
  }
);

Deno.test(
  'zero-row database transition with paid status compensates and fails closed',
  async () => {
    const calls: string[] = [];

    await assertReplacementConflict(
      () =>
        completeCheckoutReplacement({
          expirePreviousCheckout: async () => ({ status: 'expired', payment_status: 'unpaid' }),
          retrievePreviousCheckout: async () => {
            throw new Error('retrieval should not be required');
          },
          compensateNewCheckout: async () => {
            calls.push('new_checkout_compensated');
            return true;
          },
          markPreviousCheckoutExpired: async () => {
            await provePreviousCheckoutIntentExpired({
              transitionPreviousCheckoutToExpired: async () => null,
              retrievePreviousCheckoutIntentStatus: async () => 'paid',
            });
          },
          cleanupPreviousCoupon: async () => {
            calls.push('old_coupon_cleaned');
          },
          reportFailure: (context) => {
            calls.push(context);
          },
        }),
      'previous_checkout_unavailable'
    );

    assertEquals(calls, ['previous_checkout_status_proof', 'new_checkout_compensated']);
  }
);

Deno.test('zero-row database transition with expired status continues idempotently', async () => {
  const calls: string[] = [];

  await completeCheckoutReplacement({
    expirePreviousCheckout: async () => ({ status: 'expired', payment_status: 'unpaid' }),
    retrievePreviousCheckout: async () => {
      throw new Error('retrieval should not be required');
    },
    compensateNewCheckout: async () => {
      calls.push('new_checkout_compensated');
      return true;
    },
    markPreviousCheckoutExpired: async () => {
      await provePreviousCheckoutIntentExpired({
        transitionPreviousCheckoutToExpired: async () => null,
        retrievePreviousCheckoutIntentStatus: async () => 'expired',
      });
      calls.push('old_intent_expired_proven');
    },
    cleanupPreviousCoupon: async () => {
      calls.push('old_coupon_cleaned');
    },
    reportFailure: () => {},
  });

  assertEquals(calls, ['old_intent_expired_proven', 'old_coupon_cleaned']);
});

Deno.test('unconfirmed compensation after database status failure still fails closed', async () => {
  const calls: string[] = [];

  await assertReplacementConflict(
    () =>
      completeCheckoutReplacement({
        expirePreviousCheckout: async () => ({ status: 'expired', payment_status: 'unpaid' }),
        retrievePreviousCheckout: async () => {
          throw new Error('retrieval should not be required');
        },
        compensateNewCheckout: async () => {
          calls.push('new_checkout_compensation_unconfirmed');
          return false;
        },
        markPreviousCheckoutExpired: async () => {
          throw new Error('status unavailable');
        },
        cleanupPreviousCoupon: async () => {
          calls.push('old_coupon_cleaned');
        },
        reportFailure: (context) => {
          calls.push(context);
        },
      }),
    'previous_checkout_unavailable'
  );

  assertEquals(calls, ['previous_checkout_status_proof', 'new_checkout_compensation_unconfirmed']);
});

Deno.test('coupon cleanup remains non-fatal after Stripe and database terminal state', async () => {
  const calls: string[] = [];

  await completeCheckoutReplacement({
    expirePreviousCheckout: async () => {
      calls.push('old_checkout_expired');
      return { status: 'expired', payment_status: 'unpaid' };
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
      calls.push('old_coupon_cleanup_failed');
      throw new Error('coupon cleanup failed');
    },
    reportFailure: (context) => {
      calls.push(context);
    },
  });

  assertEquals(calls, [
    'old_checkout_expired',
    'old_intent_expired',
    'old_coupon_cleanup_failed',
    'previous_coupon_cleanup',
  ]);
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
        reportFailure: () => {},
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
        reportFailure: () => {},
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
        reportFailure: () => {},
      });

      throw new Error('Expected replacement conflict.');
    } catch (error) {
      if (!(error instanceof CheckoutReplacementConflictError)) throw error;

      assertEquals(error.publicCode, 'previous_checkout_unavailable');
    }
  }
);
