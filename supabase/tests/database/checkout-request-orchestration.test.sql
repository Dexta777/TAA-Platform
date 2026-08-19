BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(53);

SELECT has_column(
  'public',
  'checkout_attempts',
  'in_flight_checkout_intent_id',
  'checkout attempts expose one durable in-flight intent pointer'
);

SELECT has_column(
  'public',
  'checkout_intents',
  'orchestration_state',
  'checkout intents persist orchestration state'
);

SELECT has_table(
  'public',
  'checkout_intent_shipping_options',
  'canonical shipping options have a durable snapshot table'
);

CREATE TEMPORARY TABLE orchestration_test_ids (
  name text PRIMARY KEY,
  id uuid NOT NULL
) ON COMMIT DROP;

CREATE TEMPORARY TABLE orchestration_test_snapshots (
  snapshot jsonb NOT NULL,
  items jsonb NOT NULL,
  shipping_options jsonb NOT NULL
) ON COMMIT DROP;

ALTER TABLE public.products DISABLE TRIGGER sync_klaviyo_products_after_change;
ALTER TABLE public.product_variants DISABLE TRIGGER sync_klaviyo_variants_after_change;

INSERT INTO public.products (
  id,
  name,
  slug,
  sku,
  price,
  inventory_quantity,
  active,
  weight_grams
)
VALUES
  (
    '91000000-0000-0000-0000-000000000001',
    'Orchestration product',
    'orchestration-product',
    'ORCHESTRATION-PRODUCT',
    10.00,
    5,
    true,
    100
  ),
  (
    '91000000-0000-0000-0000-000000000002',
    'Orchestration variant parent',
    'orchestration-variant-parent',
    'ORCHESTRATION-PARENT',
    12.00,
    20,
    true,
    100
  );

INSERT INTO public.product_variants (
  id,
  product_id,
  variant_name,
  variant_sku,
  price,
  inventory_quantity,
  active,
  weight_grams
)
VALUES (
  '91100000-0000-0000-0000-000000000001',
  '91000000-0000-0000-0000-000000000002',
  '100ml',
  'ORCHESTRATION-VARIANT',
  12.00,
  3,
  true,
  100
);

ALTER TABLE public.products ENABLE TRIGGER sync_klaviyo_products_after_change;
ALTER TABLE public.product_variants ENABLE TRIGGER sync_klaviyo_variants_after_change;

INSERT INTO public.shipping_methods (
  id,
  name,
  description,
  carrier,
  active,
  sort_order
)
VALUES (
  '91200000-0000-0000-0000-000000000001',
  'Tracked',
  'Tracked delivery',
  'Royal Mail',
  true,
  1
);

INSERT INTO public.shipping_rates (
  id,
  shipping_method_id,
  min_weight_grams,
  max_weight_grams,
  price,
  currency,
  active
)
VALUES (
  '91300000-0000-0000-0000-000000000001',
  '91200000-0000-0000-0000-000000000001',
  0,
  10000,
  4.99,
  'GBP',
  true
);

INSERT INTO orchestration_test_snapshots (snapshot, items, shipping_options)
VALUES (
  jsonb_build_object(
    'customer_email', NULL,
    'subtotal_amount', 2200,
    'shipping_amount', 499,
    'total_amount', 2699,
    'currency', 'gbp',
    'shipping_method_name', 'Tracked',
    'shipping_method_id', '91200000-0000-0000-0000-000000000001',
    'shipping_rate_id', '91300000-0000-0000-0000-000000000001',
    'total_weight_grams', 200,
    'shipping_name', 'Test Customer',
    'shipping_phone', '07123456789',
    'shipping_address', jsonb_build_object('address_1', '1 Test Street', 'country', 'GB'),
    'billing_name', 'Test Customer',
    'billing_address', jsonb_build_object('address_1', '1 Test Street', 'country', 'GB'),
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
  ),
  jsonb_build_array(
    jsonb_build_object(
      'product_type', 'product',
      'product_id', '91000000-0000-0000-0000-000000000001',
      'base_product_id', '91000000-0000-0000-0000-000000000001',
      'sku', 'ORCHESTRATION-PRODUCT',
      'name', 'Orchestration product',
      'product_name', 'Orchestration product',
      'variant_name', NULL,
      'quantity', 1,
      'unit_amount', 1000,
      'line_total', 1000,
      'weight_grams', 100,
      'image_url', NULL,
      'amount', NULL
    ),
    jsonb_build_object(
      'product_type', 'variant',
      'product_id', '91100000-0000-0000-0000-000000000001',
      'base_product_id', '91000000-0000-0000-0000-000000000002',
      'sku', 'ORCHESTRATION-VARIANT',
      'name', 'Orchestration variant parent — 100ml',
      'product_name', 'Orchestration variant parent',
      'variant_name', '100ml',
      'quantity', 1,
      'unit_amount', 1200,
      'line_total', 1200,
      'weight_grams', 100,
      'image_url', NULL,
      'amount', '100ml'
    )
  ),
  jsonb_build_array(
    jsonb_build_object(
      'shipping_method_id', '91200000-0000-0000-0000-000000000001',
      'shipping_rate_id', '91300000-0000-0000-0000-000000000001',
      'display_name', 'Tracked',
      'description', 'Tracked delivery',
      'carrier', 'Royal Mail',
      'amount', 499,
      'original_amount', 499,
      'currency', 'gbp'
    )
  )
);

SELECT is(
  (
    SELECT existing_checkout_intent_id
    FROM public.resolve_checkout_request_context(
      '92000000-0000-0000-0000-000000000001',
      '93000000-0000-0000-0000-000000000001',
      NULL,
      repeat('a', 64),
      NULL
    )
  ),
  NULL::uuid,
  'preflight creates and validates an attempt before mutable canonicalisation'
);

INSERT INTO orchestration_test_ids (name, id)
SELECT 'initial', checkout_intent_id
FROM public.prepare_checkout_request(
  '92000000-0000-0000-0000-000000000001',
  '93000000-0000-0000-0000-000000000001',
  NULL,
  repeat('a', 64),
  repeat('1', 64),
  NULL,
  '94000000-0000-0000-0000-000000000001',
  clock_timestamp() + interval '29 minutes',
  (SELECT snapshot FROM orchestration_test_snapshots),
  (SELECT items FROM orchestration_test_snapshots),
  (SELECT shipping_options FROM orchestration_test_snapshots)
);

SELECT is(
  (SELECT count(*) FROM orchestration_test_ids WHERE name = 'initial'),
  1::bigint,
  'atomic preparation creates one logical request'
);

SELECT ok(
  (
    SELECT attempts.in_flight_checkout_intent_id = ids.id
      AND intents.orchestration_state = 'prepared'
      AND intents.checkout_protocol_version = 'reservation_v1'
    FROM orchestration_test_ids AS ids
    JOIN public.checkout_attempts AS attempts
      ON attempts.id = '92000000-0000-0000-0000-000000000001'
    JOIN public.checkout_intents AS intents ON intents.id = ids.id
    WHERE ids.name = 'initial'
  ),
  'preparation establishes protocol state and in-flight ownership'
);

SELECT is(
  (
    SELECT count(*)
    FROM public.checkout_intent_items AS items
    WHERE items.checkout_intent_id = (
      SELECT id FROM orchestration_test_ids WHERE name = 'initial'
    )
      AND items.line_position IN (0, 1)
  ),
  2::bigint,
  'canonical item order is persisted explicitly'
);

SELECT is(
  (
    SELECT count(*)
    FROM public.inventory_reservation_items AS items
    JOIN public.inventory_reservations AS reservations
      ON reservations.id = items.reservation_id
    WHERE reservations.checkout_attempt_id = '92000000-0000-0000-0000-000000000001'
      AND items.product_id = '91000000-0000-0000-0000-000000000001'
  ),
  1::bigint,
  'the prepared request reserves product inventory through Slice 5A'
);

SELECT is(
  (
    SELECT count(*)
    FROM public.inventory_reservation_items AS items
    JOIN public.inventory_reservations AS reservations
      ON reservations.id = items.reservation_id
    WHERE reservations.checkout_attempt_id = '92000000-0000-0000-0000-000000000001'
      AND items.product_variant_id = '91100000-0000-0000-0000-000000000001'
  ),
  1::bigint,
  'the same prepared request reserves variant inventory through Slice 5A'
);

SELECT ok(
  (
    SELECT products.inventory_quantity = 5
    FROM public.products
    WHERE products.id = '91000000-0000-0000-0000-000000000001'
  )
  AND (
    SELECT variants.inventory_quantity = 3
    FROM public.product_variants AS variants
    WHERE variants.id = '91100000-0000-0000-0000-000000000001'
  ),
  'preparation does not mutate physical product or variant stock'
);

ALTER TABLE public.products DISABLE TRIGGER sync_klaviyo_products_after_change;
UPDATE public.products
SET price = 99.00
WHERE id = '91000000-0000-0000-0000-000000000001';
ALTER TABLE public.products ENABLE TRIGGER sync_klaviyo_products_after_change;

UPDATE public.shipping_rates
SET price = 19.99
WHERE id = '91300000-0000-0000-0000-000000000001';

SELECT is(
  (
    SELECT request_replayed
    FROM public.prepare_checkout_request(
      '92000000-0000-0000-0000-000000000001',
      '93000000-0000-0000-0000-000000000001',
      NULL,
      repeat('a', 64),
      repeat('1', 64),
      NULL,
      '94000000-0000-0000-0000-000000000001',
      clock_timestamp() + interval '29 minutes',
      NULL,
      NULL,
      NULL
    )
  ),
  true,
  'exact prepared replay requires no fresh mutable canonical snapshot'
);

SELECT is(
  (
    SELECT unit_amount
    FROM public.checkout_intent_items
    WHERE checkout_intent_id = (SELECT id FROM orchestration_test_ids WHERE name = 'initial')
      AND line_position = 0
  ),
  1000,
  'persisted item economics survive catalogue price changes'
);

SELECT is(
  (
    SELECT original_amount
    FROM public.checkout_intent_shipping_options
    WHERE checkout_intent_id = (SELECT id FROM orchestration_test_ids WHERE name = 'initial')
      AND position = 0
  ),
  499,
  'persisted shipping economics survive rate changes'
);

SELECT is(
  (
    SELECT count(*)
    FROM public.checkout_intents
    WHERE checkout_attempt_id = '92000000-0000-0000-0000-000000000001'
  ),
  1::bigint,
  'exact replay creates no duplicate logical request'
);

SELECT throws_ok(
  $$
    SELECT *
    FROM public.prepare_checkout_request(
      '92000000-0000-0000-0000-000000000001',
      '93000000-0000-0000-0000-000000000001',
      NULL,
      repeat('a', 64),
      repeat('f', 64),
      NULL,
      '94000000-0000-0000-0000-000000000001',
      clock_timestamp() + interval '29 minutes',
      NULL,
      NULL,
      NULL
    )
  $$,
  'P0001',
  'Checkout request conflict.',
  'the same request ID rejects a changed command fingerprint'
);

SELECT ok(
  (
    SELECT params_match
    FROM public.begin_checkout_session_creation(
      (SELECT id FROM orchestration_test_ids WHERE name = 'initial'),
      '94000000-0000-0000-0000-000000000001',
      repeat('2', 64)
    )
  ),
  'the first exact Stripe Session parameters hash is accepted'
);

SELECT ok(
  (
    SELECT params_match
    FROM public.begin_checkout_session_creation(
      (SELECT id FROM orchestration_test_ids WHERE name = 'initial'),
      '94000000-0000-0000-0000-000000000001',
      repeat('2', 64)
    )
  ),
  'an exact Stripe Session parameters hash is accepted on retry'
);

SELECT lives_ok(
  format(
    $$
      SELECT public.record_checkout_session(
        %L::uuid,
        '94000000-0000-0000-0000-000000000001',
        'cs_test_orchestration_initial',
        (SELECT stripe_session_expires_at FROM public.checkout_intents WHERE id = %L::uuid),
        '[{"position":0,"stripe_shipping_rate_id":"shr_initial"}]'::jsonb
      )
    $$,
    (SELECT id FROM orchestration_test_ids WHERE name = 'initial'),
    (SELECT id FROM orchestration_test_ids WHERE name = 'initial')
  ),
  'the idempotent Stripe Session result is recorded with its rate mapping'
);

SELECT is(
  public.activate_checkout_request(
    (SELECT id FROM orchestration_test_ids WHERE name = 'initial'),
    '94000000-0000-0000-0000-000000000001',
    repeat('3', 64),
    clock_timestamp() + interval '24 hours'
  ),
  1,
  'initial activation stores confirmation generation one'
);

SELECT ok(
  (
    SELECT attempts.active_checkout_intent_id = ids.id
      AND attempts.in_flight_checkout_intent_id IS NULL
      AND intents.orchestration_state = 'active'
      AND intents.status = 'pending'
    FROM orchestration_test_ids AS ids
    JOIN public.checkout_attempts AS attempts
      ON attempts.id = '92000000-0000-0000-0000-000000000001'
    JOIN public.checkout_intents AS intents ON intents.id = ids.id
    WHERE ids.name = 'initial'
  ),
  'initial activation atomically sets the active pointer and clears in-flight ownership'
);

SELECT ok(
  (
    SELECT worker_lease_id IS NULL AND worker_lease_expires_at IS NULL
    FROM public.checkout_intents
    WHERE id = (SELECT id FROM orchestration_test_ids WHERE name = 'initial')
  ),
  'initial activation releases its completed creation-worker lease'
);

SELECT ok(
  public.claim_checkout_lifecycle_work(
    (SELECT id FROM orchestration_test_ids WHERE name = 'initial'),
    '94000000-0000-0000-0000-000000000001'
  ),
  'active replay acquires a fresh worker lease before capability rotation'
);

SELECT is(
  public.rotate_checkout_confirmation_capability(
    (SELECT id FROM orchestration_test_ids WHERE name = 'initial'),
    '94000000-0000-0000-0000-000000000001',
    repeat('4', 64),
    clock_timestamp() + interval '24 hours'
  ),
  2,
  'active replay rotates the hash and increments confirmation generation'
);

SELECT ok(
  (
    SELECT worker_lease_id IS NULL AND worker_lease_expires_at IS NULL
    FROM public.checkout_intents
    WHERE id = (SELECT id FROM orchestration_test_ids WHERE name = 'initial')
  ),
  'confirmation capability rotation releases its completed recovery-worker lease'
);

SELECT is(
  (
    SELECT replacement_checkout_intent_id
    FROM public.resolve_checkout_request_context(
      '92000000-0000-0000-0000-000000000001',
      '93000000-0000-0000-0000-000000000002',
      NULL,
      repeat('a', 64),
      'cs_test_orchestration_initial'
    )
  ),
  (SELECT id FROM orchestration_test_ids WHERE name = 'initial'),
  'replacement preflight resolves the Stripe Session to a stable internal intent'
);

INSERT INTO orchestration_test_ids (name, id)
SELECT 'replacement', checkout_intent_id
FROM public.prepare_checkout_request(
  '92000000-0000-0000-0000-000000000001',
  '93000000-0000-0000-0000-000000000002',
  NULL,
  repeat('a', 64),
  repeat('5', 64),
  (SELECT id FROM orchestration_test_ids WHERE name = 'initial'),
  '94000000-0000-0000-0000-000000000002',
  clock_timestamp() + interval '29 minutes',
  (SELECT snapshot FROM orchestration_test_snapshots),
  (SELECT items FROM orchestration_test_snapshots),
  (SELECT shipping_options FROM orchestration_test_snapshots)
);

SELECT ok(
  (
    SELECT attempts.active_checkout_intent_id = initial.id
      AND attempts.in_flight_checkout_intent_id = replacement.id
    FROM public.checkout_attempts AS attempts
    JOIN orchestration_test_ids AS initial ON initial.name = 'initial'
    JOIN orchestration_test_ids AS replacement ON replacement.name = 'replacement'
    WHERE attempts.id = '92000000-0000-0000-0000-000000000001'
  ),
  'replacement preparation preserves A while B owns the one in-flight operation'
);

SELECT is(
  (
    SELECT count(*)
    FROM public.inventory_reservations
    WHERE checkout_attempt_id = '92000000-0000-0000-0000-000000000001'
  ),
  1::bigint,
  'replacement B reuses the attempt-owned reservation'
);

DO $replacement_activation$
DECLARE
  v_replacement_id uuid;
  v_expiry timestamp with time zone;
BEGIN
  SELECT id INTO v_replacement_id
  FROM orchestration_test_ids
  WHERE name = 'replacement';

  PERFORM * FROM public.begin_checkout_session_creation(
    v_replacement_id,
    '94000000-0000-0000-0000-000000000002',
    repeat('6', 64)
  );

  SELECT stripe_session_expires_at INTO v_expiry
  FROM public.checkout_intents
  WHERE id = v_replacement_id;

  PERFORM public.record_checkout_session(
    v_replacement_id,
    '94000000-0000-0000-0000-000000000002',
    'cs_test_orchestration_replacement',
    v_expiry,
    '[{"position":0,"stripe_shipping_rate_id":"shr_replacement"}]'::jsonb
  );

  PERFORM public.begin_checkout_replacement(
    v_replacement_id,
    '94000000-0000-0000-0000-000000000002'
  );

  PERFORM public.record_checkout_predecessor_invalidated(
    v_replacement_id,
    (SELECT id FROM orchestration_test_ids WHERE name = 'initial'),
    '94000000-0000-0000-0000-000000000002'
  );

  PERFORM public.activate_checkout_request(
    v_replacement_id,
    '94000000-0000-0000-0000-000000000002',
    repeat('7', 64),
    clock_timestamp() + interval '24 hours'
  );
END;
$replacement_activation$;

SELECT ok(
  (
    SELECT attempts.active_checkout_intent_id = replacement.id
      AND attempts.in_flight_checkout_intent_id IS NULL
    FROM public.checkout_attempts AS attempts
    JOIN orchestration_test_ids AS replacement ON replacement.name = 'replacement'
    WHERE attempts.id = '92000000-0000-0000-0000-000000000001'
  ),
  'replacement activation follows the predecessor checkpoint and completes the B compare-and-swap'
);

SELECT ok(
  (
    SELECT status = 'expired'
      AND orchestration_state = 'superseded'
      AND confirmation_token_hash IS NULL
      AND confirmation_token_expires_at IS NULL
    FROM public.checkout_intents
    WHERE id = (SELECT id FROM orchestration_test_ids WHERE name = 'initial')
  ),
  'the predecessor checkpoint supersedes A and clears its confirmation capability'
);

SELECT ok(
  (
    SELECT initial.confirmation_generation = 2
      AND replacement.confirmation_generation = 1
      AND initial.checkout_request_id <> replacement.checkout_request_id
    FROM public.checkout_intents AS initial
    JOIN public.checkout_intents AS replacement
      ON replacement.id = (SELECT id FROM orchestration_test_ids WHERE name = 'replacement')
    WHERE initial.id = (SELECT id FROM orchestration_test_ids WHERE name = 'initial')
  ),
  'confirmation generation is scoped to each checkout intent and request identity'
);

SELECT throws_ok(
  format(
    $$
      SELECT public.rotate_checkout_confirmation_capability(
        %L::uuid,
        '94000000-0000-0000-0000-000000000001',
        %L,
        clock_timestamp() + interval '24 hours'
      )
    $$,
    (SELECT id FROM orchestration_test_ids WHERE name = 'initial'),
    repeat('8', 64)
  ),
  'P0001',
  'Active checkout confirmation capability could not be rotated.',
  'stale A cannot regain active response authority'
);

INSERT INTO orchestration_test_ids (name, id)
SELECT 'compensation', checkout_intent_id
FROM public.prepare_checkout_request(
  '92000000-0000-0000-0000-000000000001',
  '93000000-0000-0000-0000-000000000003',
  NULL,
  repeat('a', 64),
  repeat('9', 64),
  (SELECT id FROM orchestration_test_ids WHERE name = 'replacement'),
  '94000000-0000-0000-0000-000000000003',
  clock_timestamp() + interval '29 minutes',
  (SELECT snapshot FROM orchestration_test_snapshots),
  (SELECT items FROM orchestration_test_snapshots),
  (SELECT shipping_options FROM orchestration_test_snapshots)
);

DO $safe_compensation$
DECLARE
  v_intent_id uuid;
  v_expiry timestamp with time zone;
BEGIN
  SELECT id INTO v_intent_id FROM orchestration_test_ids WHERE name = 'compensation';
  PERFORM * FROM public.begin_checkout_session_creation(
    v_intent_id,
    '94000000-0000-0000-0000-000000000003',
    repeat('a', 64)
  );
  SELECT stripe_session_expires_at INTO v_expiry
  FROM public.checkout_intents WHERE id = v_intent_id;
  PERFORM public.record_checkout_session(
    v_intent_id,
    '94000000-0000-0000-0000-000000000003',
    'cs_test_orchestration_compensation',
    v_expiry,
    '[{"position":0,"stripe_shipping_rate_id":"shr_compensation"}]'::jsonb
  );
  PERFORM public.begin_checkout_replacement(
    v_intent_id,
    '94000000-0000-0000-0000-000000000003'
  );
  PERFORM public.begin_checkout_compensation(
    v_intent_id,
    '94000000-0000-0000-0000-000000000003',
    'previous_checkout_usable'
  );
  PERFORM public.complete_checkout_compensation(
    v_intent_id,
    '94000000-0000-0000-0000-000000000003'
  );
END;
$safe_compensation$;

SELECT ok(
  (
    SELECT intents.orchestration_state = 'compensated'
      AND attempts.active_checkout_intent_id = replacement.id
      AND attempts.in_flight_checkout_intent_id IS NULL
      AND active_intent.orchestration_state = 'active'
      AND reservations.status = 'held'
    FROM orchestration_test_ids AS ids
    JOIN public.checkout_intents AS intents ON intents.id = ids.id
    JOIN public.checkout_attempts AS attempts ON attempts.id = intents.checkout_attempt_id
    JOIN orchestration_test_ids AS replacement ON replacement.name = 'replacement'
    JOIN public.checkout_intents AS active_intent ON active_intent.id = replacement.id
    JOIN public.inventory_reservations AS reservations
      ON reservations.checkout_attempt_id = attempts.id
    WHERE ids.name = 'compensation'
  ),
  'an expired replacement B is compensated while A remains active with held stock'
);

INSERT INTO orchestration_test_ids (name, id)
SELECT 'expired_initial', checkout_intent_id
FROM public.prepare_checkout_request(
  '92000000-0000-0000-0000-000000000002',
  '93000000-0000-0000-0000-000000000101',
  NULL,
  repeat('f', 64),
  repeat('1', 64),
  NULL,
  '94000000-0000-0000-0000-000000000101',
  clock_timestamp() + interval '29 minutes',
  (SELECT snapshot FROM orchestration_test_snapshots),
  (SELECT items FROM orchestration_test_snapshots),
  (SELECT shipping_options FROM orchestration_test_snapshots)
);

DO $expired_initial_compensation$
DECLARE
  v_intent_id uuid;
  v_expiry timestamp with time zone;
BEGIN
  SELECT id INTO v_intent_id
  FROM orchestration_test_ids
  WHERE name = 'expired_initial';

  PERFORM * FROM public.begin_checkout_session_creation(
    v_intent_id,
    '94000000-0000-0000-0000-000000000101',
    repeat('2', 64)
  );

  SELECT stripe_session_expires_at INTO v_expiry
  FROM public.checkout_intents
  WHERE id = v_intent_id;

  PERFORM public.record_checkout_session(
    v_intent_id,
    '94000000-0000-0000-0000-000000000101',
    'cs_test_orchestration_expired_initial',
    v_expiry,
    '[{"position":0,"stripe_shipping_rate_id":"shr_expired_initial"}]'::jsonb
  );

  PERFORM public.begin_checkout_compensation(
    v_intent_id,
    '94000000-0000-0000-0000-000000000101',
    'new_session_expired_before_activation'
  );
  PERFORM public.complete_checkout_compensation(
    v_intent_id,
    '94000000-0000-0000-0000-000000000101'
  );
END;
$expired_initial_compensation$;

SELECT ok(
  (
    SELECT intents.orchestration_state = 'compensated'
      AND attempts.status = 'failed'
      AND attempts.active_checkout_intent_id IS NULL
      AND attempts.in_flight_checkout_intent_id IS NULL
      AND reservations.status = 'released'
    FROM orchestration_test_ids AS ids
    JOIN public.checkout_intents AS intents ON intents.id = ids.id
    JOIN public.checkout_attempts AS attempts ON attempts.id = intents.checkout_attempt_id
    JOIN public.inventory_reservations AS reservations
      ON reservations.checkout_attempt_id = attempts.id
    WHERE ids.name = 'expired_initial'
  ),
  'an expired initial Session is terminalized without becoming active and releases stock'
);

SELECT throws_ok(
  format(
    $$
      SELECT public.activate_checkout_request(
        %L::uuid,
        '94000000-0000-0000-0000-000000000101',
        %L,
        clock_timestamp() + interval '24 hours'
      )
    $$,
    (SELECT id FROM orchestration_test_ids WHERE name = 'expired_initial'),
    repeat('3', 64)
  ),
  'P0001',
  'Checkout request no longer owns the in-flight operation.',
  'a terminalized non-payable initial Session cannot become active'
);

INSERT INTO orchestration_test_ids (name, id)
SELECT 'idempotency_error', checkout_intent_id
FROM public.prepare_checkout_request(
  '92000000-0000-0000-0000-000000000003',
  '93000000-0000-0000-0000-000000000201',
  NULL,
  repeat('e', 64),
  repeat('4', 64),
  NULL,
  '94000000-0000-0000-0000-000000000201',
  clock_timestamp() + interval '29 minutes',
  (SELECT snapshot FROM orchestration_test_snapshots),
  (SELECT items FROM orchestration_test_snapshots),
  (SELECT shipping_options FROM orchestration_test_snapshots)
);

SELECT lives_ok(
  format(
    $$
      SELECT public.mark_checkout_reconciliation_required(
        %L::uuid,
        '94000000-0000-0000-0000-000000000201',
        'session_creation_idempotency_conflict'
      )
    $$,
    (SELECT id FROM orchestration_test_ids WHERE name = 'idempotency_error')
  ),
  'a Stripe idempotency error transitions durably to reconciliation required'
);

SELECT ok(
  (
    SELECT intents.orchestration_state = 'reconciliation_required'
      AND attempts.status = 'active'
      AND attempts.in_flight_checkout_intent_id = intents.id
      AND reservations.status = 'held'
    FROM orchestration_test_ids AS ids
    JOIN public.checkout_intents AS intents ON intents.id = ids.id
    JOIN public.checkout_attempts AS attempts ON attempts.id = intents.checkout_attempt_id
    JOIN public.inventory_reservations AS reservations
      ON reservations.checkout_attempt_id = attempts.id
    WHERE ids.name = 'idempotency_error'
  ),
  'a Stripe idempotency error preserves inventory and in-flight ownership'
);

SELECT throws_ok(
  $$
    SELECT *
    FROM public.prepare_checkout_request(
      '92000000-0000-0000-0000-000000000003',
      '93000000-0000-0000-0000-000000000202',
      NULL,
      repeat('e', 64),
      repeat('5', 64),
      NULL,
      '94000000-0000-0000-0000-000000000202',
      clock_timestamp() + interval '29 minutes',
      (SELECT snapshot FROM orchestration_test_snapshots),
      (SELECT items FROM orchestration_test_snapshots),
      (SELECT shipping_options FROM orchestration_test_snapshots)
    )
  $$,
  'P0001',
  'Checkout attempt already has an unresolved operation.',
  'a Stripe idempotency error blocks a different checkout request'
);

INSERT INTO orchestration_test_ids (name, id)
SELECT 'ambiguous', checkout_intent_id
FROM public.prepare_checkout_request(
  '92000000-0000-0000-0000-000000000001',
  '93000000-0000-0000-0000-000000000004',
  NULL,
  repeat('a', 64),
  repeat('b', 64),
  (SELECT id FROM orchestration_test_ids WHERE name = 'replacement'),
  '94000000-0000-0000-0000-000000000004',
  clock_timestamp() + interval '29 minutes',
  (SELECT snapshot FROM orchestration_test_snapshots),
  (SELECT items FROM orchestration_test_snapshots),
  (SELECT shipping_options FROM orchestration_test_snapshots)
);

SELECT ok(
  (
    SELECT params_match
    FROM public.begin_checkout_session_creation(
      (SELECT id FROM orchestration_test_ids WHERE name = 'ambiguous'),
      '94000000-0000-0000-0000-000000000004',
      repeat('c', 64)
    )
  ),
  'the first parameter hash is stored before an ambiguous external operation'
);

UPDATE public.checkout_intents
SET stripe_session_expires_at = clock_timestamp() + interval '5 minutes'
WHERE id = (SELECT id FROM orchestration_test_ids WHERE name = 'ambiguous');

SELECT ok(
  (
    SELECT params_match
    FROM public.begin_checkout_session_creation(
      (SELECT id FROM orchestration_test_ids WHERE name = 'ambiguous'),
      '94000000-0000-0000-0000-000000000004',
      repeat('c', 64)
    )
  ),
  'an exact idempotent retry remains legal after the first-POST lifetime gate'
);

SELECT is(
  (
    SELECT params_match
    FROM public.begin_checkout_session_creation(
      (SELECT id FROM orchestration_test_ids WHERE name = 'ambiguous'),
      '94000000-0000-0000-0000-000000000004',
      repeat('d', 64)
    )
  ),
  false,
  'changed Stripe parameter output is detected before another POST'
);

SELECT ok(
  (
    SELECT intents.orchestration_state = 'reconciliation_required'
      AND attempts.in_flight_checkout_intent_id = intents.id
    FROM orchestration_test_ids AS ids
    JOIN public.checkout_intents AS intents ON intents.id = ids.id
    JOIN public.checkout_attempts AS attempts ON attempts.id = intents.checkout_attempt_id
    WHERE ids.name = 'ambiguous'
  ),
  'parameter mismatch retains branch-prevention ownership for reconciliation'
);

SELECT throws_ok(
  $$
    SELECT *
    FROM public.prepare_checkout_request(
      '92000000-0000-0000-0000-000000000001',
      '93000000-0000-0000-0000-000000000005',
      NULL,
      repeat('a', 64),
      repeat('e', 64),
      (SELECT id FROM orchestration_test_ids WHERE name = 'replacement'),
      '94000000-0000-0000-0000-000000000005',
      clock_timestamp() + interval '29 minutes',
      (SELECT snapshot FROM orchestration_test_snapshots),
      (SELECT items FROM orchestration_test_snapshots),
      (SELECT shipping_options FROM orchestration_test_snapshots)
    )
  $$,
  'P0001',
  'Checkout attempt already has an unresolved operation.',
  'a reconciliation-required request blocks a different replacement request'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'checkout_intents_coupon_params_hash_check'
      AND conrelid = 'public.checkout_intents'::regclass
  )
  AND EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'checkout_intents_session_params_hash_check'
      AND conrelid = 'public.checkout_intents'::regclass
  ),
  'database constraints enforce lowercase SHA-256 parameter hashes'
);

SELECT ok(
  (
    SELECT relrowsecurity
    FROM pg_class
    WHERE oid = 'public.checkout_intent_shipping_options'::regclass
  ),
  'RLS is enabled on canonical shipping snapshots'
);

SELECT ok(
  NOT has_table_privilege('anon', 'public.checkout_intent_shipping_options', 'SELECT')
    AND NOT has_table_privilege(
      'authenticated',
      'public.checkout_intent_shipping_options',
      'SELECT'
    ),
  'browser roles cannot read canonical shipping snapshots'
);

SELECT ok(
  NOT has_function_privilege(
    'anon',
    'public.prepare_checkout_request(uuid,uuid,uuid,text,text,uuid,uuid,timestamp with time zone,jsonb,jsonb,jsonb)',
    'EXECUTE'
  )
    AND NOT has_function_privilege(
      'authenticated',
      'public.activate_checkout_request(uuid,uuid,text,timestamp with time zone)',
      'EXECUTE'
    ),
  'browser roles cannot execute orchestration transitions'
);

SELECT ok(
  has_function_privilege(
    'service_role',
    'public.prepare_checkout_request(uuid,uuid,uuid,text,text,uuid,uuid,timestamp with time zone,jsonb,jsonb,jsonb)',
    'EXECUTE'
  )
    AND has_function_privilege(
      'service_role',
      'public.activate_checkout_request(uuid,uuid,text,timestamp with time zone)',
      'EXECUTE'
    ),
  'service_role can execute the orchestration protocol'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name IN ('checkout_attempts', 'checkout_intents')
      AND column_name IN ('checkout_attempt_token', 'confirmation_token')
  ),
  'raw attempt and confirmation capability columns do not exist'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'checkout_attempts_distinct_intent_pointers_check'
      AND conrelid = 'public.checkout_attempts'::regclass
  ),
  'attempt pointers cannot identify the same intent as active and in-flight'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'checkout_attempts_in_flight_intent_attempt_fkey'
      AND conrelid = 'public.checkout_attempts'::regclass
  ),
  'in-flight intent ownership is constrained to the same attempt'
);

SELECT is(
  (
    SELECT count(*)
    FROM pg_index
    WHERE indexrelid = 'public.checkout_intent_items_position_key'::regclass
      AND indisunique
  ),
  1::bigint,
  'positioned protocol items are unique within their checkout intent'
);

SELECT ok(
  (
    SELECT stripe_session_expires_at = date_trunc('second', attempts.hard_expires_at)
    FROM public.checkout_intents AS intents
    JOIN public.checkout_attempts AS attempts ON attempts.id = intents.checkout_attempt_id
    WHERE intents.id = (SELECT id FROM orchestration_test_ids WHERE name = 'initial')
  ),
  'Stripe Session hard expiry equals the unchanged attempt hard expiry'
);

SELECT ok(
  (
    SELECT reservations.expires_at < attempts.hard_expires_at
    FROM public.inventory_reservations AS reservations
    JOIN public.checkout_attempts AS attempts ON attempts.id = reservations.checkout_attempt_id
    WHERE attempts.id = '92000000-0000-0000-0000-000000000001'
  ),
  'reservation reconciliation deadline remains separate from Stripe hard expiry'
);

SELECT * FROM finish();

ROLLBACK;
