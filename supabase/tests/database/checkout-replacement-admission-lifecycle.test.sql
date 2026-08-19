BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(28);

ALTER TABLE public.products DISABLE TRIGGER sync_klaviyo_products_after_change;

INSERT INTO public.products (
  id, name, slug, sku, price, inventory_quantity, active, weight_grams
)
VALUES (
  'fa000000-0000-4000-8000-000000000001',
  'Replacement admission product',
  'replacement-admission-product',
  'REPLACEMENT-ADMISSION',
  10.00,
  1,
  true,
  100
);

ALTER TABLE public.products ENABLE TRIGGER sync_klaviyo_products_after_change;

INSERT INTO public.shipping_methods (
  id, name, description, carrier, active, sort_order
)
VALUES (
  'fa100000-0000-4000-8000-000000000001',
  'Tracked',
  'Tracked delivery',
  'Royal Mail',
  true,
  1
);

INSERT INTO public.shipping_rates (
  id, shipping_method_id, min_weight_grams, max_weight_grams, price, currency, active
)
VALUES (
  'fa200000-0000-4000-8000-000000000001',
  'fa100000-0000-4000-8000-000000000001',
  0,
  10000,
  4.99,
  'GBP',
  true
);

CREATE TEMPORARY TABLE replacement_admission_fixture (
  initial_intent_id uuid,
  replacement_intent_id uuid,
  reservation_id uuid
) ON COMMIT DROP;

CREATE TEMPORARY TABLE replacement_admission_snapshot AS
SELECT
  jsonb_build_object(
    'customer_email', NULL,
    'subtotal_amount', 1000,
    'shipping_amount', 499,
    'total_amount', 1499,
    'currency', 'gbp',
    'shipping_method_name', 'Tracked',
    'shipping_method_id', 'fa100000-0000-4000-8000-000000000001',
    'shipping_rate_id', 'fa200000-0000-4000-8000-000000000001',
    'total_weight_grams', 100,
    'shipping_name', 'Test Customer',
    'shipping_address', '{}'::jsonb,
    'billing_name', 'Test Customer',
    'billing_address', '{}'::jsonb,
    'billing_is_different', false,
    'stripe_customer_id', NULL,
    'create_account_requested', false,
    'discount_code_id', NULL,
    'discount_code', NULL,
    'discount_amount', 0,
    'shipping_discount_amount', 0,
    'discount_name', NULL,
    'discount_type', NULL,
    'stripe_return_url', 'https://example.test/return'
  ) AS snapshot,
  jsonb_build_array(jsonb_build_object(
    'product_type', 'product',
    'product_id', 'fa000000-0000-4000-8000-000000000001',
    'base_product_id', 'fa000000-0000-4000-8000-000000000001',
    'sku', 'REPLACEMENT-ADMISSION',
    'name', 'Replacement admission product',
    'product_name', 'Replacement admission product',
    'variant_name', NULL,
    'quantity', 1,
    'unit_amount', 1000,
    'line_total', 1000,
    'weight_grams', 100,
    'image_url', NULL,
    'amount', NULL
  )) AS items,
  jsonb_build_array(jsonb_build_object(
    'shipping_method_id', 'fa100000-0000-4000-8000-000000000001',
    'shipping_rate_id', 'fa200000-0000-4000-8000-000000000001',
    'display_name', 'Tracked',
    'description', 'Tracked delivery',
    'carrier', 'Royal Mail',
    'amount', 499,
    'original_amount', 499,
    'currency', 'gbp'
  )) AS shipping_options;

SELECT is(
  (
    SELECT admission_state
    FROM public.admit_checkout_request_v1(
      'fa300000-0000-4000-8000-000000000001',
      'fa400000-0000-4000-8000-000000000001',
      NULL,
      repeat('a', 64),
      NULL
    )
  ),
  'admitted',
  'request A acquires the initial admission fence'
);

INSERT INTO replacement_admission_fixture (initial_intent_id, reservation_id)
SELECT checkout_intent_id, reservation_id
FROM public.prepare_checkout_request(
  'fa300000-0000-4000-8000-000000000001',
  'fa400000-0000-4000-8000-000000000001',
  NULL,
  repeat('a', 64),
  repeat('b', 64),
  NULL,
  'fa500000-0000-4000-8000-000000000001',
  clock_timestamp() + interval '29 minutes',
  (SELECT snapshot FROM replacement_admission_snapshot),
  (SELECT items FROM replacement_admission_snapshot),
  (SELECT shipping_options FROM replacement_admission_snapshot)
);

SELECT ok(
  (
    SELECT attempts.in_flight_checkout_intent_id = fixture.initial_intent_id
      AND reservations.id = fixture.reservation_id
      AND reservations.status = 'held'
      AND attempts.admitted_checkout_request_id = 'fa400000-0000-4000-8000-000000000001'
      AND attempts.admitted_replaces_checkout_intent_id IS NULL
    FROM replacement_admission_fixture AS fixture
    JOIN public.checkout_attempts AS attempts
      ON attempts.id = 'fa300000-0000-4000-8000-000000000001'
    JOIN public.inventory_reservations AS reservations
      ON reservations.checkout_attempt_id = attempts.id
  ),
  'canonical two-phase preparation retains request A admission while owning one reservation'
);

SELECT ok(
  (
    SELECT params_match
    FROM public.begin_checkout_session_creation(
      (SELECT initial_intent_id FROM replacement_admission_fixture),
      'fa500000-0000-4000-8000-000000000001',
      repeat('c', 64)
    )
  ),
  'request A creation worker owns the Stripe Session mutation'
);

SELECT lives_ok(
  format(
    $$
      SELECT public.record_checkout_session(
        %L::uuid,
        'fa500000-0000-4000-8000-000000000001',
        'cs_test_replacement_admission_a',
        (SELECT stripe_session_expires_at FROM public.checkout_intents WHERE id = %L::uuid),
        '[{"position":0,"stripe_shipping_rate_id":"shr_replacement_admission"}]'::jsonb
      )
    $$,
    (SELECT initial_intent_id FROM replacement_admission_fixture),
    (SELECT initial_intent_id FROM replacement_admission_fixture)
  ),
  'request A records its authoritative Stripe Session identity'
);

SELECT is(
  public.activate_checkout_request(
    (SELECT initial_intent_id FROM replacement_admission_fixture),
    'fa500000-0000-4000-8000-000000000001',
    repeat('d', 64),
    clock_timestamp() + interval '24 hours'
  ),
  1,
  'request A completes as the active materialised checkout'
);

SELECT ok(
  (
    SELECT intents.status = 'pending'
      AND intents.orchestration_state = 'active'
      AND intents.stripe_checkout_session_id = 'cs_test_replacement_admission_a'
      AND intents.worker_lease_id IS NULL
      AND intents.worker_lease_expires_at IS NULL
      AND attempts.active_checkout_intent_id = intents.id
      AND attempts.in_flight_checkout_intent_id IS NULL
    FROM replacement_admission_fixture AS fixture
    JOIN public.checkout_intents AS intents ON intents.id = fixture.initial_intent_id
    JOIN public.checkout_attempts AS attempts ON attempts.id = intents.checkout_attempt_id
  ),
  'request A is a stable materialised state with its completed worker lease released'
);

SELECT ok(
  (
    SELECT resume_state = 'resumable'
      AND checkout_intent_id = (SELECT initial_intent_id FROM replacement_admission_fixture)
      AND checkout_session_id = 'cs_test_replacement_admission_a'
      AND worker_lease_acquired
    FROM public.resume_checkout_request_v1(
      'fa300000-0000-4000-8000-000000000001',
      'fa400000-0000-4000-8000-000000000001',
      NULL,
      repeat('a', 64),
      'fa500000-0000-4000-8000-000000000002'
    )
  ),
  'Scenario E immediate same-request recovery remains resumable'
);

SELECT is(
  public.rotate_checkout_confirmation_capability(
    (SELECT initial_intent_id FROM replacement_admission_fixture),
    'fa500000-0000-4000-8000-000000000002',
    repeat('e', 64),
    clock_timestamp() + interval '24 hours'
  ),
  2,
  'Scenario E recovery completes through the existing capability rotation contract'
);

SELECT ok(
  (
    SELECT worker_lease_id IS NULL AND worker_lease_expires_at IS NULL
    FROM public.checkout_intents
    WHERE id = (SELECT initial_intent_id FROM replacement_admission_fixture)
  ),
  'Scenario E capability rotation still releases its completed worker lease'
);

UPDATE public.checkout_attempts
SET
  admitted_checkout_request_id = 'fa400000-0000-4000-8000-000000000001',
  admitted_replaces_checkout_intent_id = NULL,
  admitted_request_expires_at = clock_timestamp() + interval '1 minute'
WHERE id = 'fa300000-0000-4000-8000-000000000001';

SELECT throws_ok(
  $$
    SELECT *
    FROM public.admit_checkout_request_v1(
      'fa300000-0000-4000-8000-000000000001',
      'fa400000-0000-4000-8000-000000000002',
      NULL,
      repeat('a', 64),
      'cs_test_replacement_admission_a'
    )
  $$,
  'P0001',
  'Checkout attempt already has an unresolved admitted request.',
  'a live unexpired admission remains fenced even when its request is materialised'
);

UPDATE public.checkout_attempts
SET admitted_request_expires_at = clock_timestamp() - interval '1 second'
WHERE id = 'fa300000-0000-4000-8000-000000000001';

SELECT throws_ok(
  $$
    SELECT *
    FROM public.admit_checkout_request_v1(
      'fa300000-0000-4000-8000-000000000001',
      'fa400000-0000-4000-8000-000000000002',
      NULL,
      repeat('f', 64),
      'cs_test_replacement_admission_a'
    )
  $$,
  'P0001',
  'Checkout attempt identity conflict.',
  'an expired completed admission does not weaken capability authentication'
);

SELECT throws_ok(
  $$
    SELECT *
    FROM public.admit_checkout_request_v1(
      'fa300000-0000-4000-8000-000000000001',
      'fa400000-0000-4000-8000-000000000002',
      NULL,
      repeat('a', 64),
      'cs_test_wrong_attempt'
    )
  $$,
  'P0001',
  'Checkout replacement target is invalid.',
  'a replacement Session outside the attempt cannot establish replacement identity'
);

SELECT ok(
  (
    SELECT admission_state = 'admitted'
      AND replacement_checkout_intent_id = (
        SELECT initial_intent_id FROM replacement_admission_fixture
      )
      AND existing_checkout_intent_id IS NULL
    FROM public.admit_checkout_request_v1(
      'fa300000-0000-4000-8000-000000000001',
      'fa400000-0000-4000-8000-000000000002',
      NULL,
      repeat('a', 64),
      'cs_test_replacement_admission_a'
    )
  ),
  'an expired completed admission permits legitimate replacement request B'
);

SELECT ok(
  (
    SELECT admitted_checkout_request_id = 'fa400000-0000-4000-8000-000000000002'
      AND admitted_replaces_checkout_intent_id = (
        SELECT initial_intent_id FROM replacement_admission_fixture
      )
      AND admitted_request_expires_at > clock_timestamp()
    FROM public.checkout_attempts
    WHERE id = 'fa300000-0000-4000-8000-000000000001'
  ),
  'replacement B atomically becomes the sole canonical admitted request'
);

SELECT is(
  (
    SELECT admission_state
    FROM public.admit_checkout_request_v1(
      'fa300000-0000-4000-8000-000000000001',
      'fa400000-0000-4000-8000-000000000002',
      NULL,
      repeat('a', 64),
      'cs_test_replacement_admission_a'
    )
  ),
  'admitted',
  'the winning replacement request replays without branching'
);

SELECT is(
  (
    SELECT resume_state
    FROM public.resume_checkout_request_v1(
      'fa300000-0000-4000-8000-000000000001',
      'fa400000-0000-4000-8000-000000000003',
      NULL,
      repeat('a', 64),
      'fa500000-0000-4000-8000-000000000003'
    )
  ),
  'checkout_request_not_found',
  'a mismatched request identity cannot resume replacement B'
);

SELECT ok(
  (
    SELECT checkout_request_id = 'fa400000-0000-4000-8000-000000000001'
      AND replaces_checkout_intent_id IS NULL
      AND stripe_checkout_session_id = 'cs_test_replacement_admission_a'
      AND orchestration_state = 'active'
    FROM public.checkout_intents
    WHERE id = (SELECT initial_intent_id FROM replacement_admission_fixture)
  ),
  'request A remains historically and operationally traceable after readmission'
);

WITH prepared AS (
  SELECT *
  FROM public.prepare_checkout_request(
    'fa300000-0000-4000-8000-000000000001',
    'fa400000-0000-4000-8000-000000000002',
    NULL,
    repeat('a', 64),
    repeat('1', 64),
    (SELECT initial_intent_id FROM replacement_admission_fixture),
    'fa500000-0000-4000-8000-000000000004',
    clock_timestamp() + interval '29 minutes',
    (SELECT snapshot FROM replacement_admission_snapshot),
    (SELECT items FROM replacement_admission_snapshot),
    (SELECT shipping_options FROM replacement_admission_snapshot)
  )
)
UPDATE replacement_admission_fixture AS fixture
SET replacement_intent_id = prepared.checkout_intent_id
FROM prepared;

SELECT ok(
  (
    SELECT replacement.checkout_request_id = 'fa400000-0000-4000-8000-000000000002'
      AND replacement.replaces_checkout_intent_id = fixture.initial_intent_id
      AND replacement.orchestration_state = 'prepared'
      AND attempts.active_checkout_intent_id = fixture.initial_intent_id
      AND attempts.in_flight_checkout_intent_id = fixture.replacement_intent_id
      AND attempts.admitted_checkout_request_id = 'fa400000-0000-4000-8000-000000000002'
      AND attempts.admitted_replaces_checkout_intent_id = fixture.initial_intent_id
    FROM replacement_admission_fixture AS fixture
    JOIN public.checkout_intents AS replacement
      ON replacement.id = fixture.replacement_intent_id
    JOIN public.checkout_attempts AS attempts
      ON attempts.id = replacement.checkout_attempt_id
  ),
  'replacement B materialises once with exact predecessor lineage and retains its admission fence'
);

SELECT ok(
  (
    SELECT count(*) = 2
      AND count(*) FILTER (
        WHERE checkout_request_id = 'fa400000-0000-4000-8000-000000000001'
          AND stripe_checkout_session_id = 'cs_test_replacement_admission_a'
      ) = 1
      AND count(*) FILTER (
        WHERE checkout_request_id = 'fa400000-0000-4000-8000-000000000002'
          AND replaces_checkout_intent_id = (
            SELECT initial_intent_id FROM replacement_admission_fixture
          )
      ) = 1
    FROM public.checkout_intents
    WHERE checkout_attempt_id = 'fa300000-0000-4000-8000-000000000001'
  )
  AND (
    SELECT count(*) = 1
    FROM public.inventory_reservations
    WHERE checkout_attempt_id = 'fa300000-0000-4000-8000-000000000001'
      AND id = (SELECT reservation_id FROM replacement_admission_fixture)
  )
  AND (
    SELECT count(*) = 1
    FROM public.inventory_reservation_items
    WHERE reservation_id = (SELECT reservation_id FROM replacement_admission_fixture)
  ),
  'replacement admission preserves one Session identity and one attempt-owned reservation'
);

SELECT ok(
  (
    SELECT on_hand_quantity = 1
      AND reserved_quantity = 1
      AND available_to_sell = 0
    FROM public.get_inventory_available_to_sell(
      'fa000000-0000-4000-8000-000000000001',
      NULL::uuid
    )
  ),
  'replacement preparation cannot bypass final-unit inventory ownership'
);

UPDATE public.checkout_attempts
SET
  admitted_checkout_request_id = 'fa400000-0000-4000-8000-000000000002',
  admitted_replaces_checkout_intent_id = (
    SELECT initial_intent_id FROM replacement_admission_fixture
  ),
  admitted_request_expires_at = clock_timestamp() - interval '1 second'
WHERE id = 'fa300000-0000-4000-8000-000000000001';

SELECT throws_ok(
  $$
    SELECT *
    FROM public.admit_checkout_request_v1(
      'fa300000-0000-4000-8000-000000000001',
      'fa400000-0000-4000-8000-000000000003',
      NULL,
      repeat('a', 64),
      'cs_test_replacement_admission_a'
    )
  $$,
  'P0001',
  'Checkout attempt already has an unresolved admitted request.',
  'an expired but prepared in-flight request remains fenced'
);

SELECT lives_ok(
  format(
    $$
      SELECT public.fail_checkout_request(
        %L::uuid,
        'fa500000-0000-4000-8000-000000000004',
        'replacement_fixture_failure'
      )
    $$,
    (SELECT replacement_intent_id FROM replacement_admission_fixture)
  ),
  'the incomplete replacement can reach its normal terminal failure boundary'
);

SELECT ok(
  (
    SELECT replacement.status = 'failed'
      AND replacement.orchestration_state = 'failed'
      AND attempts.status = 'active'
      AND attempts.active_checkout_intent_id = fixture.initial_intent_id
      AND attempts.in_flight_checkout_intent_id IS NULL
    FROM replacement_admission_fixture AS fixture
    JOIN public.checkout_intents AS replacement
      ON replacement.id = fixture.replacement_intent_id
    JOIN public.checkout_attempts AS attempts
      ON attempts.id = replacement.checkout_attempt_id
  ),
  'terminal replacement failure releases in-flight ownership without changing predecessor A'
);

SELECT is(
  (
    SELECT admission_state
    FROM public.admit_checkout_request_v1(
      'fa300000-0000-4000-8000-000000000001',
      'fa400000-0000-4000-8000-000000000003',
      NULL,
      repeat('a', 64),
      'cs_test_replacement_admission_a'
    )
  ),
  'admitted',
  'an expired terminal replacement admission permits one later replacement'
);

SELECT ok(
  (
    SELECT admitted_checkout_request_id = 'fa400000-0000-4000-8000-000000000003'
      AND admitted_replaces_checkout_intent_id = (
        SELECT initial_intent_id FROM replacement_admission_fixture
      )
    FROM public.checkout_attempts
    WHERE id = 'fa300000-0000-4000-8000-000000000001'
  ),
  'the later replacement atomically supersedes only the expired terminal admission marker'
);

SELECT is(
  (
    SELECT admission_state
    FROM public.admit_checkout_request_v1(
      'fa300000-0000-4000-8000-000000000002',
      'fa400000-0000-4000-8000-000000000004',
      NULL,
      repeat('2', 64),
      NULL
    )
  ),
  'admitted',
  'a separate never-materialised request acquires its admission normally'
);

UPDATE public.checkout_attempts
SET admitted_request_expires_at = clock_timestamp() - interval '1 second'
WHERE id = 'fa300000-0000-4000-8000-000000000002';

SELECT throws_ok(
  $$
    SELECT *
    FROM public.admit_checkout_request_v1(
      'fa300000-0000-4000-8000-000000000002',
      'fa400000-0000-4000-8000-000000000005',
      NULL,
      repeat('2', 64),
      NULL
    )
  $$,
  'P0001',
  'Checkout attempt already has an unresolved admitted request.',
  'an expired marker without a completed request never grants concurrent ownership'
);

UPDATE public.checkout_attempts
SET status = 'failed', completed_at = clock_timestamp()
WHERE id = 'fa300000-0000-4000-8000-000000000002';

SELECT throws_ok(
  $$
    SELECT *
    FROM public.admit_checkout_request_v1(
      'fa300000-0000-4000-8000-000000000002',
      'fa400000-0000-4000-8000-000000000006',
      NULL,
      repeat('2', 64),
      NULL
    )
  $$,
  'P0001',
  'Checkout attempt is no longer active.',
  'a terminal checkout attempt cannot admit a replacement'
);

SELECT * FROM finish();

ROLLBACK;
