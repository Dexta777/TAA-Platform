import { CheckoutInputError } from './checkout-catalog.ts';
import {
  createReservationCanaryConfigurationReader,
  decideCheckoutAdmission,
  hasOnlyCanonicalCanarySkus,
  hasOnlySubmittedCanarySkus,
  INVALID_RESERVATION_CANARY_CONFIGURATION_WARNING,
  MAXIMUM_RESERVATION_CANARY_SKUS,
  parseReservationCanarySkus,
  qualifiesForReservationCanary,
  reportInvalidReservationCanaryConfiguration,
  type ReservationCanaryConfiguration,
} from './checkout-admission.ts';

function assert(condition: unknown, message = 'Assertion failed.') {
  if (!condition) throw new Error(message);
}

function assertEquals(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}.`);
  }
}

async function assertRejects(callback: () => Promise<unknown>, expected: Error) {
  try {
    await callback();
  } catch (error) {
    assert(error === expected, 'Expected the original failure to be preserved.');
    return;
  }

  throw new Error('Expected the operation to reject.');
}

function configuredCanaries(...skus: string[]): ReservationCanaryConfiguration {
  return { status: 'enabled', skus: new Set(skus) };
}

function disabledCanaries(): ReservationCanaryConfiguration {
  return { status: 'disabled', skus: new Set() };
}

function invalidCanaries(): ReservationCanaryConfiguration {
  return { status: 'invalid', skus: new Set() };
}

function newAttemptLookup() {
  return Promise.resolve({
    attempt_exists: false,
    checkout_protocol_version: null,
  });
}

function createMutableCanaryConfigurationReader(initialRawValue: string | undefined) {
  let rawValue = initialRawValue;
  let parseCount = 0;
  const warnings: string[] = [];
  const getConfiguration = createReservationCanaryConfigurationReader({
    readRawValue: () => rawValue,
    parse: (value) => {
      parseCount += 1;
      return parseReservationCanarySkus(value);
    },
    warn: (message) => warnings.push(message),
  });

  return {
    getConfiguration,
    getParseCount: () => parseCount,
    setRawValue: (value: string | undefined) => {
      rawValue = value;
    },
    warnings,
  };
}

function decideNewCanaryBasket(
  sku: string,
  getCanaryConfiguration: () => ReservationCanaryConfiguration,
  onCanonicalResolution: () => void = () => {}
) {
  return decideCheckoutAdmission({
    operation: '',
    reservationsEnabled: false,
    attemptCredentialsSupplied: true,
    getExistingAttemptProtocol: newAttemptLookup,
    getCanaryConfiguration,
    cart: [{ sku, quantity: 1 }],
    resolveCanonicalCart: async () => {
      onCanonicalResolution();
      return [{ sku }];
    },
  });
}

Deno.test('missing, blank, and empty-array canary configuration disable canary admission', () => {
  assertEquals(parseReservationCanarySkus(undefined).status, 'disabled');
  assertEquals(parseReservationCanarySkus('   ').status, 'disabled');
  assertEquals(parseReservationCanarySkus('[]').status, 'disabled');
});

Deno.test('malformed JSON and non-array configuration invalidate the entire allowlist', () => {
  assertEquals(parseReservationCanarySkus('["CANARY"').status, 'invalid');
  assertEquals(parseReservationCanarySkus('{"sku":"CANARY"}').status, 'invalid');
});

Deno.test('non-string, empty, and whitespace-only entries invalidate the entire allowlist', () => {
  assertEquals(parseReservationCanarySkus('["CANARY", 1]').status, 'invalid');
  assertEquals(parseReservationCanarySkus('["CANARY", ""]').status, 'invalid');
  assertEquals(parseReservationCanarySkus('["CANARY", "   "]').status, 'invalid');
});

Deno.test('overlong SKU and excessive entry count invalidate the entire allowlist', () => {
  assertEquals(parseReservationCanarySkus(JSON.stringify(['A'.repeat(201)])).status, 'invalid');
  assertEquals(
    parseReservationCanarySkus(
      JSON.stringify(
        Array.from({ length: MAXIMUM_RESERVATION_CANARY_SKUS + 1 }, (_, index) => `SKU-${index}`)
      )
    ).status,
    'invalid'
  );
});

Deno.test('valid canary configuration trims, deduplicates, and preserves case', () => {
  const configuration = parseReservationCanarySkus('[" TAA-CANARY ","TAA-CANARY","taa-canary"]');

  assertEquals(configuration.status, 'enabled');
  assertEquals(Array.from(configuration.skus), ['TAA-CANARY', 'taa-canary']);
});

Deno.test('invalid configuration reports only the generic warning', () => {
  const warnings: string[] = [];
  const secretLookingValue = 'DO-NOT-LOG-THIS-SKU';
  const configuration = parseReservationCanarySkus(JSON.stringify([secretLookingValue, 1]));

  reportInvalidReservationCanaryConfiguration(configuration, (message) => warnings.push(message));

  assertEquals(warnings, [INVALID_RESERVATION_CANARY_CONFIGURATION_WARNING]);
  assertEquals(warnings.join('').includes(secretLookingValue), false);
});

Deno.test('disabled and enabled configuration do not emit an invalid-configuration warning', () => {
  const warnings: string[] = [];
  const warn = (message: string) => warnings.push(message);

  reportInvalidReservationCanaryConfiguration(disabledCanaries(), warn);
  reportInvalidReservationCanaryConfiguration(configuredCanaries('CANARY'), warn);

  assertEquals(warnings, []);
});

Deno.test('unchanged raw canary configuration reuses the parsed result', () => {
  const reader = createMutableCanaryConfigurationReader('["TAA-CANARY"]');

  const first = reader.getConfiguration();
  const second = reader.getConfiguration();

  assert(first === second, 'Expected unchanged configuration to reuse the cached object.');
  assertEquals(reader.getParseCount(), 1);
  assertEquals(reader.warnings, []);
});

Deno.test('unchanged malformed canary configuration emits one generic warning', () => {
  const reader = createMutableCanaryConfigurationReader('{broken');

  reader.getConfiguration();
  reader.getConfiguration();

  assertEquals(reader.getParseCount(), 1);
  assertEquals(reader.warnings, [INVALID_RESERVATION_CANARY_CONFIGURATION_WARNING]);
});

Deno.test('submitted SKU filtering uses trimmed exact case-sensitive membership only', () => {
  const canarySkus = new Set(['TAA-CANARY']);

  assertEquals(hasOnlySubmittedCanarySkus([{ sku: ' TAA-CANARY ' }], canarySkus), true);
  assertEquals(hasOnlySubmittedCanarySkus([{ sku: 'taa-canary' }], canarySkus), false);
  assertEquals(hasOnlySubmittedCanarySkus([{ sku: 'TAA-CANARY-EXTRA' }], canarySkus), false);
  assertEquals(hasOnlySubmittedCanarySkus([{ sku: 'TAA' }], canarySkus), false);
});

Deno.test('canonical SKU filtering requires every returned base or variant SKU', () => {
  const canarySkus = new Set(['TAA-CANARY-BASE', 'TAA-CANARY-VARIANT']);

  assertEquals(
    hasOnlyCanonicalCanarySkus(
      [{ sku: 'TAA-CANARY-BASE' }, { sku: 'TAA-CANARY-VARIANT' }],
      canarySkus
    ),
    true
  );
  assertEquals(
    hasOnlyCanonicalCanarySkus([{ sku: 'TAA-CANARY-BASE' }, { sku: 'ORDINARY-SKU' }], canarySkus),
    false
  );
});

Deno.test(
  'ordinary and mixed baskets remain legacy without canary catalogue pre-resolution',
  async () => {
    let canonicalResolutionCount = 0;
    const resolveCanonicalCart = async () => {
      canonicalResolutionCount += 1;
      return [{ sku: 'TAA-CANARY' }];
    };

    const ordinary = await decideCheckoutAdmission({
      operation: '',
      reservationsEnabled: false,
      attemptCredentialsSupplied: true,
      getExistingAttemptProtocol: newAttemptLookup,
      getCanaryConfiguration: () => configuredCanaries('TAA-CANARY'),
      cart: [{ sku: 'ORDINARY-SKU', quantity: 1 }],
      resolveCanonicalCart,
    });
    const mixed = await decideCheckoutAdmission({
      operation: '',
      reservationsEnabled: false,
      attemptCredentialsSupplied: true,
      getExistingAttemptProtocol: newAttemptLookup,
      getCanaryConfiguration: () => configuredCanaries('TAA-CANARY'),
      cart: [
        { sku: 'TAA-CANARY', quantity: 1 },
        { sku: 'ORDINARY-SKU', quantity: 1 },
      ],
      resolveCanonicalCart,
    });

    assertEquals(ordinary, { route: 'legacy', attemptExists: false });
    assertEquals(mixed, { route: 'legacy', attemptExists: false });
    assertEquals(canonicalResolutionCount, 0);
  }
);

Deno.test('canonical canary base and variant baskets use reservation v1', async () => {
  for (const sku of ['TAA-CANARY-BASE', 'TAA-CANARY-VARIANT']) {
    let canonicalResolutionCount = 0;
    const decision = await decideCheckoutAdmission({
      operation: '',
      reservationsEnabled: false,
      attemptCredentialsSupplied: true,
      getExistingAttemptProtocol: newAttemptLookup,
      getCanaryConfiguration: () => configuredCanaries(sku),
      cart: [{ sku, quantity: 1 }],
      resolveCanonicalCart: async () => {
        canonicalResolutionCount += 1;
        return [{ sku }];
      },
    });

    assertEquals(decision, { route: 'reservation_v1', attemptExists: false });
    assertEquals(canonicalResolutionCount, 1);
  }
});

Deno.test(
  'case and substring mismatches remain legacy without canonical pre-resolution',
  async () => {
    let canonicalResolutionCount = 0;
    const resolveCanonicalCart = async () => {
      canonicalResolutionCount += 1;
      return [{ sku: 'TAA-CANARY' }];
    };

    for (const sku of ['taa-canary', 'TAA-CANARY-EXTRA', 'TAA']) {
      const decision = await decideCheckoutAdmission({
        operation: '',
        reservationsEnabled: false,
        attemptCredentialsSupplied: true,
        getExistingAttemptProtocol: newAttemptLookup,
        getCanaryConfiguration: () => configuredCanaries('TAA-CANARY'),
        cart: [{ sku, quantity: 1 }],
        resolveCanonicalCart,
      });

      assertEquals(decision.route, 'legacy');
    }

    assertEquals(canonicalResolutionCount, 0);
  }
);

Deno.test(
  'candidate canary basket requires canonical resolution and canonical agreement',
  async () => {
    let canonicalResolutionCount = 0;
    const decision = await decideCheckoutAdmission({
      operation: '',
      reservationsEnabled: false,
      attemptCredentialsSupplied: true,
      getExistingAttemptProtocol: newAttemptLookup,
      getCanaryConfiguration: () => configuredCanaries('TAA-CANARY'),
      cart: [{ sku: 'TAA-CANARY', quantity: 1 }],
      resolveCanonicalCart: async () => {
        canonicalResolutionCount += 1;
        return [{ sku: 'CANONICAL-MISMATCH' }];
      },
    });

    assertEquals(decision, { route: 'legacy', attemptExists: false });
    assertEquals(canonicalResolutionCount, 1);
  }
);

Deno.test(
  'unknown and inactive allowlisted SKUs preserve catalogue validation failures',
  async () => {
    for (const message of ['Product unavailable: UNKNOWN', 'Product unavailable: INACTIVE']) {
      const catalogueError = new CheckoutInputError(message);

      await assertRejects(
        () =>
          decideCheckoutAdmission({
            operation: '',
            reservationsEnabled: false,
            attemptCredentialsSupplied: true,
            getExistingAttemptProtocol: newAttemptLookup,
            getCanaryConfiguration: () =>
              configuredCanaries(message.endsWith('UNKNOWN') ? 'UNKNOWN' : 'INACTIVE'),
            cart: [{ sku: message.endsWith('UNKNOWN') ? 'UNKNOWN' : 'INACTIVE', quantity: 1 }],
            resolveCanonicalCart: () => Promise.reject(catalogueError),
          }),
        catalogueError
      );
    }
  }
);

Deno.test(
  'catalogue infrastructure failure during canary proof propagates before admission',
  async () => {
    const catalogueError = new Error('Product catalogue lookup failed.');

    await assertRejects(
      () =>
        qualifiesForReservationCanary({
          cart: [{ sku: 'TAA-CANARY', quantity: 1 }],
          configuration: configuredCanaries('TAA-CANARY'),
          resolveCanonicalCart: () => Promise.reject(catalogueError),
        }),
      catalogueError
    );
  }
);

Deno.test('same-isolate canary removal disables the next new admission', async () => {
  const reader = createMutableCanaryConfigurationReader('["TAA-CANARY"]');

  assertEquals(await decideNewCanaryBasket('TAA-CANARY', reader.getConfiguration), {
    route: 'reservation_v1',
    attemptExists: false,
  });

  reader.setRawValue(undefined);

  assertEquals(await decideNewCanaryBasket('TAA-CANARY', reader.getConfiguration), {
    route: 'legacy',
    attemptExists: false,
  });
  assertEquals(reader.getParseCount(), 2);
});

Deno.test('same-isolate blank canary configuration disables the next new admission', async () => {
  const reader = createMutableCanaryConfigurationReader('["TAA-CANARY"]');

  assertEquals(
    (await decideNewCanaryBasket('TAA-CANARY', reader.getConfiguration)).route,
    'reservation_v1'
  );

  reader.setRawValue('');

  assertEquals(
    (await decideNewCanaryBasket('TAA-CANARY', reader.getConfiguration)).route,
    'legacy'
  );
  assertEquals(reader.getParseCount(), 2);
});

Deno.test('same-isolate allowlist replacement stops A and admits B', async () => {
  const reader = createMutableCanaryConfigurationReader('["TAA-CANARY-A"]');

  assertEquals(
    (await decideNewCanaryBasket('TAA-CANARY-A', reader.getConfiguration)).route,
    'reservation_v1'
  );
  assertEquals(
    (await decideNewCanaryBasket('TAA-CANARY-B', reader.getConfiguration)).route,
    'legacy'
  );

  reader.setRawValue('["TAA-CANARY-B"]');

  assertEquals(
    (await decideNewCanaryBasket('TAA-CANARY-A', reader.getConfiguration)).route,
    'legacy'
  );
  assertEquals(
    (await decideNewCanaryBasket('TAA-CANARY-B', reader.getConfiguration)).route,
    'reservation_v1'
  );
  assertEquals(reader.getParseCount(), 2);
});

Deno.test(
  'same-isolate malformed replacement disables new admission before durable admission',
  async () => {
    const reader = createMutableCanaryConfigurationReader('["TAA-CANARY"]');
    let canonicalResolutionCount = 0;
    let durableAdmissionCount = 0;
    const decide = async () => {
      const decision = await decideNewCanaryBasket('TAA-CANARY', reader.getConfiguration, () => {
        canonicalResolutionCount += 1;
      });

      if (decision.route === 'reservation_v1') durableAdmissionCount += 1;

      return decision;
    };

    assertEquals((await decide()).route, 'reservation_v1');

    reader.setRawValue('{broken');

    assertEquals((await decide()).route, 'legacy');
    assertEquals(canonicalResolutionCount, 1);
    assertEquals(durableAdmissionCount, 1);
    assertEquals(reader.warnings, [INVALID_RESERVATION_CANARY_CONFIGURATION_WARNING]);
  }
);

Deno.test(
  'global activation takes precedence over ordinary baskets and malformed canary config',
  async () => {
    let attemptLookupCount = 0;
    let canaryConfigurationReadCount = 0;
    let canonicalResolutionCount = 0;
    const decision = await decideCheckoutAdmission({
      operation: '',
      reservationsEnabled: true,
      attemptCredentialsSupplied: true,
      getExistingAttemptProtocol: async () => {
        attemptLookupCount += 1;
        return await newAttemptLookup();
      },
      getCanaryConfiguration: () => {
        canaryConfigurationReadCount += 1;
        return invalidCanaries();
      },
      cart: [{ sku: 'ORDINARY-SKU', quantity: 1 }],
      resolveCanonicalCart: async () => {
        canonicalResolutionCount += 1;
        return [{ sku: 'ORDINARY-SKU' }];
      },
    });

    assertEquals(decision, { route: 'reservation_v1', attemptExists: false });
    assertEquals(attemptLookupCount, 0);
    assertEquals(canaryConfigurationReadCount, 0);
    assertEquals(canonicalResolutionCount, 0);
  }
);

Deno.test(
  'existing reservation v1 continues after same-isolate canary removal while new admission stops',
  async () => {
    const reader = createMutableCanaryConfigurationReader('["REMOVED-CANARY"]');
    let canonicalResolutionCount = 0;

    reader.getConfiguration();
    reader.setRawValue(undefined);

    const existingDecision = await decideCheckoutAdmission({
      operation: '',
      reservationsEnabled: false,
      attemptCredentialsSupplied: true,
      getExistingAttemptProtocol: () =>
        Promise.resolve({
          attempt_exists: true,
          checkout_protocol_version: 'reservation_v1',
        }),
      getCanaryConfiguration: reader.getConfiguration,
      cart: [{ sku: 'REMOVED-CANARY', quantity: 1 }],
      resolveCanonicalCart: async () => {
        canonicalResolutionCount += 1;
        return [{ sku: 'REMOVED-CANARY' }];
      },
    });

    assertEquals(existingDecision, { route: 'reservation_v1', attemptExists: true });
    assertEquals(reader.getParseCount(), 1);
    assertEquals(canonicalResolutionCount, 0);

    const newDecision = await decideNewCanaryBasket(
      'REMOVED-CANARY',
      reader.getConfiguration,
      () => {
        canonicalResolutionCount += 1;
      }
    );

    assertEquals(newDecision, { route: 'legacy', attemptExists: false });
    assertEquals(reader.getParseCount(), 2);
    assertEquals(canonicalResolutionCount, 0);
  }
);

Deno.test('resume operation does not consult blank canary configuration', async () => {
  const reader = createMutableCanaryConfigurationReader('');
  let attemptLookupCount = 0;
  let canonicalResolutionCount = 0;
  const decision = await decideCheckoutAdmission({
    operation: 'resume',
    reservationsEnabled: false,
    attemptCredentialsSupplied: true,
    getExistingAttemptProtocol: async () => {
      attemptLookupCount += 1;
      return await newAttemptLookup();
    },
    getCanaryConfiguration: reader.getConfiguration,
    cart: undefined,
    resolveCanonicalCart: async () => {
      canonicalResolutionCount += 1;
      return [];
    },
  });

  assertEquals(decision, { route: 'reservation_v1', attemptExists: false });
  assertEquals(attemptLookupCount, 0);
  assertEquals(reader.getParseCount(), 0);
  assertEquals(canonicalResolutionCount, 0);
});

Deno.test(
  'attempt capability and authenticated-user failures happen before canary qualification',
  async () => {
    for (const authorizationError of [
      new Error('Checkout attempt identity conflict.'),
      new Error('Checkout attempt account identity conflict.'),
    ]) {
      let canonicalResolutionCount = 0;

      await assertRejects(
        () =>
          decideCheckoutAdmission({
            operation: '',
            reservationsEnabled: false,
            attemptCredentialsSupplied: true,
            getExistingAttemptProtocol: () => Promise.reject(authorizationError),
            getCanaryConfiguration: () => configuredCanaries('TAA-CANARY'),
            cart: [{ sku: 'TAA-CANARY', quantity: 1 }],
            resolveCanonicalCart: async () => {
              canonicalResolutionCount += 1;
              return [{ sku: 'TAA-CANARY' }];
            },
          }),
        authorizationError
      );

      assertEquals(canonicalResolutionCount, 0);
    }
  }
);

Deno.test(
  'successful canonical proof completes before reservation admission can begin',
  async () => {
    const events: string[] = [];
    const decision = await decideCheckoutAdmission({
      operation: '',
      reservationsEnabled: false,
      attemptCredentialsSupplied: true,
      getExistingAttemptProtocol: async () => {
        events.push('attempt-protocol');
        return await newAttemptLookup();
      },
      getCanaryConfiguration: () => configuredCanaries('TAA-CANARY'),
      cart: [{ sku: 'TAA-CANARY', quantity: 1 }],
      resolveCanonicalCart: async () => {
        events.push('canonical-proof');
        return [{ sku: 'TAA-CANARY' }];
      },
    });

    if (decision.route === 'reservation_v1') events.push('admit-checkout-request');

    assertEquals(events, ['attempt-protocol', 'canonical-proof', 'admit-checkout-request']);
    assertEquals(Object.keys(decision).sort(), ['attemptExists', 'route']);
  }
);

Deno.test(
  'canary proof does not replace the reservation handler catalogue validation',
  async () => {
    let canonicalResolutionCount = 0;
    const cart = [{ sku: 'TAA-CANARY', quantity: 1 }];
    const resolveCanonicalCart = async (_cart: unknown[]) => {
      canonicalResolutionCount += 1;
      return [{ sku: 'TAA-CANARY' }];
    };
    const decision = await decideCheckoutAdmission({
      operation: '',
      reservationsEnabled: false,
      attemptCredentialsSupplied: true,
      getExistingAttemptProtocol: newAttemptLookup,
      getCanaryConfiguration: () => configuredCanaries('TAA-CANARY'),
      cart,
      resolveCanonicalCart,
    });

    assertEquals(decision, { route: 'reservation_v1', attemptExists: false });
    assertEquals(canonicalResolutionCount, 1);

    await resolveCanonicalCart(cart);

    assertEquals(canonicalResolutionCount, 2);
  }
);
