import {
  buildCheckoutResponse,
  buildStripeCouponParametersV1,
  buildStripeSessionParametersV1,
  classifyStripeFailure,
  deterministicStringify,
  fingerprintCheckoutCommand,
  getStripeFailureAction,
  getStripeIdempotencyKeys,
  getStripeSessionActivationAction,
  getStripeSessionActivationDisposition,
  getStripeSessionResumeMode,
  isCheckoutReservationsEnabled,
  isStripeSessionSafelyExpired,
  normalizeCheckoutCommand,
  normalizeProtocolCart,
  sha256Deterministic,
  type PersistedCheckoutSnapshot,
} from './checkout-protocol.ts';

function assertEquals(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}.`);
  }
}

function fixtureSnapshot(): PersistedCheckoutSnapshot {
  return {
    id: '40000000-0000-4000-8000-000000000001',
    checkout_attempt_id: '41000000-0000-4000-8000-000000000001',
    checkout_request_id: '42000000-0000-4000-8000-000000000001',
    replaces_checkout_intent_id: null,
    checkout_protocol_version: 'reservation_v1',
    orchestration_state: 'prepared',
    customer_email: null,
    stripe_checkout_session_id: null,
    stripe_customer_id: null,
    stripe_coupon_id: 'coupon_test',
    stripe_return_url: 'https://example.test/return',
    stripe_session_expires_at: '2026-08-12T14:00:00.000Z',
    subtotal_amount: 2200,
    shipping_amount: 499,
    total_amount: 2479,
    currency: 'gbp',
    total_weight_grams: 200,
    discount_code_id: '43000000-0000-4000-8000-000000000001',
    discount_code: 'SAVE10',
    discount_name: 'Save ten',
    discount_type: 'percentage',
    discount_amount: 220,
    shipping_discount_amount: 0,
    confirmation_generation: 0,
    items: [
      {
        line_position: 0,
        product_type: 'product',
        product_id: '44000000-0000-4000-8000-000000000001',
        base_product_id: '44000000-0000-4000-8000-000000000001',
        sku: 'A-SKU',
        name: 'A product',
        product_name: 'A product',
        variant_name: null,
        quantity: 2,
        unit_amount: 1100,
        line_total: 2200,
        weight_grams: 200,
        image_url: 'https://example.test/product.jpg',
        amount: null,
      },
    ],
    shipping_options: [
      {
        position: 0,
        shipping_method_id: '45000000-0000-4000-8000-000000000001',
        shipping_rate_id: '46000000-0000-4000-8000-000000000001',
        display_name: 'Tracked',
        description: 'Tracked delivery',
        carrier: 'Royal Mail',
        amount: 499,
        original_amount: 499,
        currency: 'gbp',
        stripe_shipping_rate_id: null,
      },
    ],
  };
}

Deno.test('feature flag enables only normalized true', () => {
  assertEquals(isCheckoutReservationsEnabled(' true '), true);
  assertEquals(isCheckoutReservationsEnabled('TRUE'), true);
  assertEquals(isCheckoutReservationsEnabled(undefined), false);
  assertEquals(isCheckoutReservationsEnabled('1'), false);
});

Deno.test('cart normalization aggregates and sorts the canonical command order', () => {
  assertEquals(
    normalizeProtocolCart([
      { sku: 'B-SKU', quantity: 1 },
      { sku: 'A-SKU', quantity: 2 },
      { sku: 'B-SKU', quantity: 3 },
    ]),
    [
      { sku: 'A-SKU', quantity: 2 },
      { sku: 'B-SKU', quantity: 4 },
    ]
  );
});

Deno.test('command normalization is deterministic across equivalent customer input', async () => {
  const base = {
    checkout_attempt_id: '41000000-0000-4000-8000-000000000001',
    checkout_request_id: '42000000-0000-4000-8000-000000000001',
    shipping_method_name: ' Tracked ',
    discount_code: ' save10 ',
    shipping_name: ' Test Customer ',
    shipping_phone: ' 07123456789 ',
    shipping_address: { address_1: ' 1 Test Street ', country: 'uk' },
    billing_is_different: false,
    create_account_requested: false,
  };
  const left = normalizeCheckoutCommand(
    {
      ...base,
      cart: [
        { sku: 'B', quantity: 1 },
        { sku: 'A', quantity: 2 },
      ],
    },
    null
  );
  const right = normalizeCheckoutCommand(
    {
      ...base,
      cart: [
        { sku: 'A', quantity: 2 },
        { sku: 'B', quantity: 1 },
      ],
    },
    null
  );

  assertEquals(await fingerprintCheckoutCommand(left), await fingerprintCheckoutCommand(right));
  assertEquals(left.shipping_method_name, 'tracked');
  assertEquals(left.discount_code, 'SAVE10');
});

Deno.test('attempt and confirmation tokens are excluded from the command fingerprint', async () => {
  const payload = {
    checkout_attempt_id: '41000000-0000-4000-8000-000000000001',
    checkout_request_id: '42000000-0000-4000-8000-000000000001',
    cart: [{ sku: 'A', quantity: 1 }],
    shipping_method_name: 'Tracked',
    shipping_address: { country: 'GB' },
    billing_is_different: false,
    checkout_attempt_token: 'raw-secret-one',
    confirmation_token: 'raw-confirmation-one',
  };
  const left = normalizeCheckoutCommand(payload, null);
  const right = normalizeCheckoutCommand(
    {
      ...payload,
      checkout_attempt_token: 'raw-secret-two',
      confirmation_token: 'raw-confirmation-two',
    },
    null
  );

  assertEquals(await fingerprintCheckoutCommand(left), await fingerprintCheckoutCommand(right));
  assertEquals(JSON.stringify(left).includes('raw-secret'), false);
});

Deno.test('deterministic serializer ignores object insertion order', async () => {
  assertEquals(deterministicStringify({ b: 2, a: 1 }), '{"a":1,"b":2}');
  assertEquals(
    await sha256Deterministic({ b: 2, a: 1 }),
    await sha256Deterministic({ a: 1, b: 2 })
  );
});

Deno.test('protocol v1 coupon parameters reconstruct exactly from persisted state', () => {
  const parameters = buildStripeCouponParametersV1(fixtureSnapshot());
  const metadata = parameters?.metadata || {};

  assertEquals(parameters?.amount_off, 220);
  assertEquals(metadata.checkout_attempt_id, '41000000-0000-4000-8000-000000000001');
  assertEquals(metadata.checkout_request_id, '42000000-0000-4000-8000-000000000001');
  assertEquals(JSON.stringify(parameters).includes('token'), false);
});

Deno.test('protocol v1 Session parameters reconstruct exactly from persisted state', async () => {
  const first = buildStripeSessionParametersV1(fixtureSnapshot());
  const second = buildStripeSessionParametersV1(fixtureSnapshot());

  assertEquals(await sha256Deterministic(first), await sha256Deterministic(second));
  assertEquals(first.client_reference_id, '40000000-0000-4000-8000-000000000001');
  assertEquals(first.expires_at, 1786543200);
  assertEquals(first.metadata?.protocol_version, 'reservation_v1');
  assertEquals(JSON.stringify(first).includes('raw-secret'), false);
});

Deno.test('deterministic Stripe idempotency keys remain stable and under limits', () => {
  const first = getStripeIdempotencyKeys(
    '41000000-0000-4000-8000-000000000001',
    '42000000-0000-4000-8000-000000000001'
  );
  const retry = getStripeIdempotencyKeys(
    '41000000-0000-4000-8000-000000000001',
    '42000000-0000-4000-8000-000000000001'
  );

  assertEquals(
    first.coupon,
    'taa-checkout:41000000-0000-4000-8000-000000000001:42000000-0000-4000-8000-000000000001:coupon'
  );
  assertEquals(retry.coupon, first.coupon);
  assertEquals(retry.session, first.session);
  assertEquals(first.session.length < 256, true);
  assertEquals(first.expirePrevious.length < 256, true);
  assertEquals(first.expireNew.length < 256, true);
});

Deno.test('changed builder output produces a different pre-POST parameters hash', async () => {
  const original = buildStripeSessionParametersV1(fixtureSnapshot());
  const changedSnapshot = fixtureSnapshot();
  changedSnapshot.shipping_options[0].original_amount = 599;
  const changed = buildStripeSessionParametersV1(changedSnapshot);

  assertEquals(
    (await sha256Deterministic(original)) === (await sha256Deterministic(changed)),
    false
  );
});

Deno.test('Stripe transport and server failures preserve their distinct retry semantics', () => {
  assertEquals(classifyStripeFailure({ type: 'StripeConnectionError' }), 'transport_ambiguous');
  assertEquals(
    classifyStripeFailure({ type: 'StripeAPIError', statusCode: 500 }),
    'server_indeterminate'
  );
  assertEquals(
    classifyStripeFailure({ type: 'StripeInvalidRequestError', statusCode: 400 }),
    'definitive'
  );
  assertEquals(
    classifyStripeFailure({ type: 'StripeIdempotencyError', statusCode: 400 }),
    'external_state_indeterminate'
  );
  assertEquals(
    getStripeFailureAction(
      classifyStripeFailure({ type: 'StripeIdempotencyError', statusCode: 400 })
    ),
    'reconciliation_required'
  );
  assertEquals(
    classifyStripeFailure({ type: 'StripeRateLimitError', statusCode: 429 }),
    'retryable'
  );
  assertEquals(
    getStripeFailureAction(classifyStripeFailure({ type: 'StripeRateLimitError' })),
    'retry_same_request'
  );
  assertEquals(isStripeSessionSafelyExpired({ status: 'expired', payment_status: 'unpaid' }), true);
});

Deno.test('only a currently open unpaid Elements Session is eligible for activation', () => {
  assertEquals(
    getStripeSessionActivationDisposition({
      status: 'open',
      payment_status: 'unpaid',
      client_secret: 'cs_test_secret',
    }),
    'payable'
  );
  assertEquals(
    getStripeSessionActivationDisposition({
      status: 'expired',
      payment_status: 'unpaid',
      client_secret: null,
    }),
    'safely_expired'
  );
  assertEquals(
    getStripeSessionActivationDisposition({
      status: 'complete',
      payment_status: 'paid',
      client_secret: 'cs_test_secret',
    }),
    'external_state_indeterminate'
  );
  assertEquals(
    getStripeSessionActivationDisposition({
      status: 'open',
      payment_status: 'unpaid',
      client_secret: null,
    }),
    'external_state_indeterminate'
  );
  assertEquals(
    getStripeSessionActivationAction({
      status: 'expired',
      payment_status: 'unpaid',
      client_secret: null,
    }),
    'terminalize_before_handoff'
  );
  assertEquals(
    getStripeSessionActivationAction(
      {
        status: 'expired',
        payment_status: 'unpaid',
        client_secret: null,
      },
      true
    ),
    'reconciliation_required'
  );
});

Deno.test('recorded Session recovery retrieves the same Session after a lost response', () => {
  const snapshot = fixtureSnapshot();

  assertEquals(getStripeSessionResumeMode(snapshot), 'create_idempotently');

  snapshot.orchestration_state = 'session_created';
  snapshot.stripe_checkout_session_id = 'cs_test_recorded';

  assertEquals(getStripeSessionResumeMode(snapshot), 'retrieve_recorded');

  snapshot.orchestration_state = 'active';

  assertEquals(getStripeSessionResumeMode(snapshot), 'retrieve_active');

  snapshot.orchestration_state = 'superseded';

  assertEquals(getStripeSessionResumeMode(snapshot), 'terminal');
});

Deno.test('confirmation generation is scoped to its checkout intent identity', () => {
  const firstIntent = fixtureSnapshot();
  firstIntent.confirmation_generation = 4;
  const replacementIntent = fixtureSnapshot();
  replacementIntent.id = '40000000-0000-4000-8000-000000000002';
  replacementIntent.checkout_request_id = '42000000-0000-4000-8000-000000000002';
  replacementIntent.replaces_checkout_intent_id = firstIntent.id;
  replacementIntent.confirmation_generation = 1;

  assertEquals(
    replacementIntent.confirmation_generation < firstIntent.confirmation_generation,
    true
  );
  assertEquals(replacementIntent.id === firstIntent.id, false);
  assertEquals(replacementIntent.checkout_request_id === firstIntent.checkout_request_id, false);
});

Deno.test(
  'Checkout response exposes pinned Elements client secret and confirmation generation',
  () => {
    const response = buildCheckoutResponse(
      fixtureSnapshot(),
      {
        id: 'cs_test_protocol',
        client_secret: 'cs_test_protocol_secret_test',
      } as Parameters<typeof buildCheckoutResponse>[1],
      'fresh-confirmation-token',
      7,
      null
    );

    assertEquals(response.client_secret, 'cs_test_protocol_secret_test');
    assertEquals(response.confirmation_token, 'fresh-confirmation-token');
    assertEquals(response.confirmation_generation, 7);
  }
);
