BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(47);

CREATE TEMPORARY TABLE inventory_conflict_result (
  sqlstate text,
  detail jsonb
) ON COMMIT DROP;

CREATE TEMPORARY TABLE inventory_conflict_preparation_result (
  name text PRIMARY KEY,
  sqlstate text,
  detail text,
  message text
) ON COMMIT DROP;

CREATE TEMPORARY TABLE inventory_conflict_prepared_ids (
  checkout_intent_id uuid PRIMARY KEY
) ON COMMIT DROP;

ALTER TABLE public.products DISABLE TRIGGER sync_klaviyo_products_after_change;

INSERT INTO public.products (id, name, slug, sku, price, inventory_quantity, active)
VALUES
  ('7c100000-0000-4000-8000-000000000001', 'Available', '7c1-available', '7C1-A', 10, 5, true),
  ('7c100000-0000-4000-8000-000000000002', 'Temporary one', '7c1-temp-one', '7C1-B', 10, 1, true),
  ('7c100000-0000-4000-8000-000000000003', 'Physical zero', '7c1-physical', '7C1-C', 10, 0, true),
  ('7c100000-0000-4000-8000-000000000004', 'Temporary two', '7c1-temp-two', '7C1-D', 10, 2, true);

ALTER TABLE public.products ENABLE TRIGGER sync_klaviyo_products_after_change;

INSERT INTO public.shipping_methods (
  id, name, description, carrier, active, sort_order
)
VALUES (
  '7c110000-0000-4000-8000-000000000001', '7C1 Tracked', 'Tracked', 'Test', true, 1
);

INSERT INTO public.shipping_rates (
  id, shipping_method_id, min_weight_grams, max_weight_grams, price, currency, active
)
VALUES (
  '7c120000-0000-4000-8000-000000000001',
  '7c110000-0000-4000-8000-000000000001', 0, 100000, 4.99, 'GBP', true
);

INSERT INTO public.checkout_intents (
  id, status, subtotal_amount, shipping_amount, total_amount, currency
)
VALUES
  ('7c200000-0000-4000-8000-000000000001', 'preparing', 3000, 0, 3000, 'gbp'),
  ('7c200000-0000-4000-8000-000000000002', 'preparing', 4000, 0, 4000, 'gbp');

INSERT INTO public.checkout_intent_items (
  checkout_intent_id, product_type, product_id, base_product_id, sku, name, product_name,
  quantity, unit_amount, line_total, weight_grams, line_position
)
VALUES
  (
    '7c200000-0000-4000-8000-000000000001', 'product',
    '7c100000-0000-4000-8000-000000000002', '7c100000-0000-4000-8000-000000000002',
    '7C1-B', 'Temporary one', 'Temporary one', 1, 1000, 1000, 100, 0
  ),
  (
    '7c200000-0000-4000-8000-000000000001', 'product',
    '7c100000-0000-4000-8000-000000000004', '7c100000-0000-4000-8000-000000000004',
    '7C1-D', 'Temporary two', 'Temporary two', 2, 1000, 2000, 200, 1
  ),
  (
    '7c200000-0000-4000-8000-000000000002', 'product',
    '7c100000-0000-4000-8000-000000000001', '7c100000-0000-4000-8000-000000000001',
    '7C1-A', 'Available', 'Available', 1, 1000, 1000, 100, 0
  ),
  (
    '7c200000-0000-4000-8000-000000000002', 'product',
    '7c100000-0000-4000-8000-000000000002', '7c100000-0000-4000-8000-000000000002',
    '7C1-B', 'Temporary one', 'Temporary one', 1, 1000, 1000, 100, 1
  ),
  (
    '7c200000-0000-4000-8000-000000000002', 'product',
    '7c100000-0000-4000-8000-000000000003', '7c100000-0000-4000-8000-000000000003',
    '7C1-C', 'Physical zero', 'Physical zero', 1, 1000, 1000, 100, 2
  ),
  (
    '7c200000-0000-4000-8000-000000000002', 'product',
    '7c100000-0000-4000-8000-000000000004', '7c100000-0000-4000-8000-000000000004',
    '7C1-D', 'Temporary two', 'Temporary two', 1, 1000, 1000, 100, 3
  );

DO $setup_attempts$
BEGIN
  PERFORM * FROM public.create_or_validate_checkout_attempt(
    '7c300000-0000-4000-8000-000000000001', NULL, repeat('1', 64)
  );
  PERFORM * FROM public.create_or_validate_checkout_attempt(
    '7c300000-0000-4000-8000-000000000002', NULL, repeat('2', 64)
  );
END;
$setup_attempts$;

SELECT lives_ok(
  $$
    SELECT * FROM public.reserve_checkout_inventory(
      '7c300000-0000-4000-8000-000000000001',
      '7c400000-0000-4000-8000-000000000001',
      '7c200000-0000-4000-8000-000000000001',
      repeat('a', 64),
      clock_timestamp() + interval '29 minutes',
      NULL
    )
  $$,
  'the winning basket obtains its all-or-nothing reservation'
);

DO $capture_conflict$
DECLARE
  v_sqlstate text;
  v_detail text;
BEGIN
  BEGIN
    PERFORM * FROM public.reserve_checkout_inventory(
      '7c300000-0000-4000-8000-000000000002',
      '7c400000-0000-4000-8000-000000000002',
      '7c200000-0000-4000-8000-000000000002',
      repeat('b', 64),
      clock_timestamp() + interval '29 minutes',
      NULL
    );
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE, v_detail = PG_EXCEPTION_DETAIL;
    INSERT INTO inventory_conflict_result VALUES (v_sqlstate, v_detail::jsonb);
  END;
END;
$capture_conflict$;

SELECT is((SELECT sqlstate FROM inventory_conflict_result), 'TAI01', 'conflict uses SQLSTATE TAI01');
SELECT is(
  (SELECT jsonb_array_length(detail -> 'unavailable_items') FROM inventory_conflict_result),
  3,
  'all conflicting lines are returned together'
);
SELECT is(
  (SELECT detail -> 'unavailable_items' -> 0 ->> 'sku' FROM inventory_conflict_result),
  '7C1-B',
  'conflicts retain canonical cart ordering'
);
SELECT is(
  (SELECT detail -> 'unavailable_items' -> 0 ->> 'reason' FROM inventory_conflict_result),
  'temporarily_reserved',
  'held physical stock is classified as temporarily reserved'
);
SELECT is(
  (SELECT detail -> 'unavailable_items' -> 1 ->> 'reason' FROM inventory_conflict_result),
  'out_of_stock',
  'physical insufficiency is classified as out of stock'
);
SELECT is(
  (SELECT detail -> 'unavailable_items' -> 2 ->> 'reason' FROM inventory_conflict_result),
  'temporarily_reserved',
  'a second held item is included in the same conflict'
);
SELECT ok(
  NOT ((SELECT detail -> 'unavailable_items' FROM inventory_conflict_result) @>
    '[{"sku":"7C1-A"}]'::jsonb),
  'available items are excluded from the conflict detail'
);
SELECT is(
  (SELECT count(*) FROM public.inventory_reservations
    WHERE checkout_attempt_id = '7c300000-0000-4000-8000-000000000002'),
  0::bigint,
  'the losing attempt creates no reservation'
);
SELECT is(
  (SELECT count(*) FROM public.inventory_reservation_items AS items
    JOIN public.inventory_reservations AS reservations ON reservations.id = items.reservation_id
    WHERE reservations.checkout_attempt_id = '7c300000-0000-4000-8000-000000000002'),
  0::bigint,
  'the losing attempt creates no reservation items'
);
SELECT is(
  (SELECT inventory_quantity FROM public.products WHERE sku = '7C1-C'),
  0,
  'physical inventory remains unchanged after conflict'
);
SELECT is(
  (SELECT status FROM public.inventory_reservations
    WHERE checkout_attempt_id = '7c300000-0000-4000-8000-000000000001'),
  'held',
  'the winning reservation remains held and unaffected'
);
SELECT is(
  (SELECT count(*) FROM public.checkout_intents
    WHERE id = '7c200000-0000-4000-8000-000000000002'
      AND stripe_checkout_session_id IS NOT NULL),
  0::bigint,
  'the conflict has no persisted Stripe Session'
);

SELECT is(
  (
    SELECT admission_state
    FROM public.admit_checkout_request_v1(
      '7c300000-0000-4000-8000-000000000003',
      '7c400000-0000-4000-8000-000000000003',
      NULL,
      repeat('3', 64),
      NULL
    )
  ),
  'admitted',
  'the mixed-basket preparation request is admitted before canonical persistence'
);

DO $capture_prepare_conflict$
DECLARE
  v_sqlstate text;
  v_detail text;
  v_message text;
BEGIN
  BEGIN
    PERFORM *
    FROM public.prepare_checkout_request(
      '7c300000-0000-4000-8000-000000000003',
      '7c400000-0000-4000-8000-000000000003',
      NULL,
      repeat('3', 64),
      repeat('c', 64),
      NULL,
      '7c410000-0000-4000-8000-000000000003',
      clock_timestamp() + interval '29 minutes',
      jsonb_build_object(
        'subtotal_amount', 3000,
        'shipping_amount', 499,
        'total_amount', 3499,
        'currency', 'gbp',
        'shipping_method_name', '7C1 Tracked',
        'shipping_method_id', '7c110000-0000-4000-8000-000000000001',
        'shipping_rate_id', '7c120000-0000-4000-8000-000000000001',
        'total_weight_grams', 300,
        'shipping_address', '{}'::jsonb,
        'billing_address', '{}'::jsonb,
        'billing_is_different', false,
        'stripe_return_url', 'https://example.test/return'
      ),
      jsonb_build_array(
        jsonb_build_object(
          'product_type', 'product', 'product_id', '7c100000-0000-4000-8000-000000000001',
          'base_product_id', '7c100000-0000-4000-8000-000000000001', 'sku', '7C1-A',
          'name', 'Available', 'product_name', 'Available', 'quantity', 1,
          'unit_amount', 1000, 'line_total', 1000, 'weight_grams', 100
        ),
        jsonb_build_object(
          'product_type', 'product', 'product_id', '7c100000-0000-4000-8000-000000000002',
          'base_product_id', '7c100000-0000-4000-8000-000000000002', 'sku', '7C1-B',
          'name', 'Temporary one', 'product_name', 'Temporary one', 'quantity', 1,
          'unit_amount', 1000, 'line_total', 1000, 'weight_grams', 100
        ),
        jsonb_build_object(
          'product_type', 'product', 'product_id', '7c100000-0000-4000-8000-000000000003',
          'base_product_id', '7c100000-0000-4000-8000-000000000003', 'sku', '7C1-C',
          'name', 'Physical zero', 'product_name', 'Physical zero', 'quantity', 1,
          'unit_amount', 1000, 'line_total', 1000, 'weight_grams', 100
        )
      ),
      jsonb_build_array(
        jsonb_build_object(
          'shipping_method_id', '7c110000-0000-4000-8000-000000000001',
          'shipping_rate_id', '7c120000-0000-4000-8000-000000000001',
          'display_name', '7C1 Tracked', 'amount', 499, 'original_amount', 499,
          'currency', 'gbp'
        )
      )
    );
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS
      v_sqlstate = RETURNED_SQLSTATE,
      v_detail = PG_EXCEPTION_DETAIL,
      v_message = MESSAGE_TEXT;
    INSERT INTO inventory_conflict_preparation_result
    VALUES ('mixed_prepare', v_sqlstate, v_detail, v_message);
  END;
END;
$capture_prepare_conflict$;

SELECT is(
  (SELECT sqlstate FROM inventory_conflict_preparation_result WHERE name = 'mixed_prepare'),
  'TAI01',
  'the real prepare RPC propagates the typed inventory conflict'
);
SELECT is(
  (SELECT count(*) FROM public.checkout_intents
    WHERE checkout_attempt_id = '7c300000-0000-4000-8000-000000000003'),
  0::bigint,
  'failed preparation rolls back its checkout intent'
);
SELECT is(
  (SELECT count(*) FROM public.checkout_intent_items AS items
    JOIN public.checkout_intents AS intents ON intents.id = items.checkout_intent_id
    WHERE intents.checkout_attempt_id = '7c300000-0000-4000-8000-000000000003'),
  0::bigint,
  'failed preparation rolls back its checkout intent items'
);
SELECT is(
  (SELECT count(*) FROM public.inventory_reservations
    WHERE checkout_attempt_id = '7c300000-0000-4000-8000-000000000003'),
  0::bigint,
  'failed preparation rolls back its reservation header'
);
SELECT is(
  (SELECT count(*) FROM public.inventory_reservation_items AS items
    JOIN public.inventory_reservations AS reservations ON reservations.id = items.reservation_id
    WHERE reservations.checkout_attempt_id = '7c300000-0000-4000-8000-000000000003'),
  0::bigint,
  'failed preparation rolls back every reservation item'
);
SELECT is(
  (SELECT admitted_checkout_request_id FROM public.checkout_attempts
    WHERE id = '7c300000-0000-4000-8000-000000000003'),
  '7c400000-0000-4000-8000-000000000003'::uuid,
  'failed preparation restores its admission marker for authoritative cancellation'
);
SELECT is(
  (SELECT status FROM public.inventory_reservations
    WHERE checkout_attempt_id = '7c300000-0000-4000-8000-000000000001'),
  'held',
  'real preparation rollback leaves the winning reservation untouched'
);
SELECT ok(
  public.cancel_checkout_request_admission_v1(
    '7c300000-0000-4000-8000-000000000003',
    '7c400000-0000-4000-8000-000000000003',
    NULL,
    repeat('3', 64)
  ),
  'the rolled-back preparation admission can be cancelled authoritatively'
);

SELECT is(
  (
    SELECT admission_state
    FROM public.admit_checkout_request_v1(
      '7c300000-0000-4000-8000-000000000004',
      '7c400000-0000-4000-8000-000000000004',
      NULL,
      repeat('4', 64),
      NULL
    )
  ),
  'admitted',
  'the temporary-conflict request is initially admitted'
);

DO $temporary_conflict_retries$
DECLARE
  v_attempt integer;
  v_sqlstate text;
  v_detail text;
  v_message text;
BEGIN
  FOR v_attempt IN 1..2 LOOP
    BEGIN
      PERFORM *
      FROM public.prepare_checkout_request(
        '7c300000-0000-4000-8000-000000000004',
        '7c400000-0000-4000-8000-000000000004',
        NULL,
        repeat('4', 64),
        repeat('d', 64),
        NULL,
        '7c410000-0000-4000-8000-000000000004',
        clock_timestamp() + interval '29 minutes',
        jsonb_build_object(
          'subtotal_amount', 1000, 'shipping_amount', 499, 'total_amount', 1499,
          'currency', 'gbp', 'shipping_method_name', '7C1 Tracked',
          'shipping_method_id', '7c110000-0000-4000-8000-000000000001',
          'shipping_rate_id', '7c120000-0000-4000-8000-000000000001',
          'total_weight_grams', 100, 'shipping_address', '{}'::jsonb,
          'billing_address', '{}'::jsonb, 'billing_is_different', false,
          'stripe_return_url', 'https://example.test/return'
        ),
        jsonb_build_array(jsonb_build_object(
          'product_type', 'product', 'product_id', '7c100000-0000-4000-8000-000000000002',
          'base_product_id', '7c100000-0000-4000-8000-000000000002', 'sku', '7C1-B',
          'name', 'Temporary one', 'product_name', 'Temporary one', 'quantity', 1,
          'unit_amount', 1000, 'line_total', 1000, 'weight_grams', 100
        )),
        jsonb_build_array(jsonb_build_object(
          'shipping_method_id', '7c110000-0000-4000-8000-000000000001',
          'shipping_rate_id', '7c120000-0000-4000-8000-000000000001',
          'display_name', '7C1 Tracked', 'amount', 499, 'original_amount', 499,
          'currency', 'gbp'
        ))
      );
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS
        v_sqlstate = RETURNED_SQLSTATE,
        v_detail = PG_EXCEPTION_DETAIL,
        v_message = MESSAGE_TEXT;
      INSERT INTO inventory_conflict_preparation_result
      VALUES ('temporary_' || v_attempt, v_sqlstate, v_detail, v_message);
    END;

    IF v_attempt = 1 THEN
      IF NOT public.cancel_checkout_request_admission_v1(
        '7c300000-0000-4000-8000-000000000004',
        '7c400000-0000-4000-8000-000000000004',
        NULL,
        repeat('4', 64)
      ) THEN
        RAISE EXCEPTION 'First temporary-conflict admission cancellation failed.';
      END IF;

      PERFORM *
      FROM public.admit_checkout_request_v1(
        '7c300000-0000-4000-8000-000000000004',
        '7c400000-0000-4000-8000-000000000004',
        NULL,
        repeat('4', 64),
        NULL
      );
    END IF;
  END LOOP;
END;
$temporary_conflict_retries$;

SELECT is(
  (SELECT count(*) FROM inventory_conflict_preparation_result
    WHERE name IN ('temporary_1', 'temporary_2') AND sqlstate = 'TAI01'),
  2::bigint,
  'the same admitted request returns deliberate conflicts while the winner still holds stock'
);
SELECT is(
  (SELECT admitted_checkout_request_id FROM public.checkout_attempts
    WHERE id = '7c300000-0000-4000-8000-000000000004'),
  '7c400000-0000-4000-8000-000000000004'::uuid,
  'the second failed retry restores the same request admission marker'
);
SELECT ok(
  public.cancel_checkout_request_admission_v1(
    '7c300000-0000-4000-8000-000000000004',
    '7c400000-0000-4000-8000-000000000004',
    NULL,
    repeat('4', 64)
  ),
  'the second temporary conflict cancels the same request admission'
);
SELECT is(
  (
    SELECT reservation_status
    FROM public.release_checkout_inventory_reservation(
      '7c300000-0000-4000-8000-000000000001',
      '7c1 authoritative test release'
    )
  ),
  'released',
  'the winning reservation is authoritatively released before the final retry'
);
SELECT is(
  (
    SELECT admission_state
    FROM public.admit_checkout_request_v1(
      '7c300000-0000-4000-8000-000000000004',
      '7c400000-0000-4000-8000-000000000004',
      NULL,
      repeat('4', 64),
      NULL
    )
  ),
  'admitted',
  'the same attempt and request are re-admitted after authoritative release'
);

INSERT INTO inventory_conflict_prepared_ids
SELECT checkout_intent_id
FROM public.prepare_checkout_request(
  '7c300000-0000-4000-8000-000000000004',
  '7c400000-0000-4000-8000-000000000004',
  NULL,
  repeat('4', 64),
  repeat('d', 64),
  NULL,
  '7c410000-0000-4000-8000-000000000004',
  clock_timestamp() + interval '29 minutes',
  jsonb_build_object(
    'subtotal_amount', 1000, 'shipping_amount', 499, 'total_amount', 1499,
    'currency', 'gbp', 'shipping_method_name', '7C1 Tracked',
    'shipping_method_id', '7c110000-0000-4000-8000-000000000001',
    'shipping_rate_id', '7c120000-0000-4000-8000-000000000001',
    'total_weight_grams', 100, 'shipping_address', '{}'::jsonb,
    'billing_address', '{}'::jsonb, 'billing_is_different', false,
    'stripe_return_url', 'https://example.test/return'
  ),
  jsonb_build_array(jsonb_build_object(
    'product_type', 'product', 'product_id', '7c100000-0000-4000-8000-000000000002',
    'base_product_id', '7c100000-0000-4000-8000-000000000002', 'sku', '7C1-B',
    'name', 'Temporary one', 'product_name', 'Temporary one', 'quantity', 1,
    'unit_amount', 1000, 'line_total', 1000, 'weight_grams', 100
  )),
  jsonb_build_array(jsonb_build_object(
    'shipping_method_id', '7c110000-0000-4000-8000-000000000001',
    'shipping_rate_id', '7c120000-0000-4000-8000-000000000001',
    'display_name', '7C1 Tracked', 'amount', 499, 'original_amount', 499,
    'currency', 'gbp'
  ))
);

SELECT is(
  (SELECT count(*) FROM public.checkout_intents
    WHERE checkout_attempt_id = '7c300000-0000-4000-8000-000000000004'
      AND checkout_request_id = '7c400000-0000-4000-8000-000000000004'),
  1::bigint,
  'same-request success creates exactly one durable preparation identity'
);
SELECT is(
  (SELECT count(*) FROM public.inventory_reservations
    WHERE checkout_attempt_id = '7c300000-0000-4000-8000-000000000004'),
  1::bigint,
  'same-request success creates exactly one eventual loser reservation'
);
SELECT ok(
  (SELECT stripe_checkout_session_id IS NULL
    FROM public.checkout_intents
    WHERE id = (SELECT checkout_intent_id FROM inventory_conflict_prepared_ids)),
  'pre-Stripe same-request retries create no duplicate Stripe Session identity'
);

ALTER TABLE public.products DISABLE TRIGGER sync_klaviyo_products_after_change;

INSERT INTO public.products (id, name, slug, sku, price, inventory_quantity, active)
VALUES
  (
    '7e100000-0000-4000-8000-000000000001', 'Bounded 200', 'bounded-200',
    repeat('L', 200), 10, 0, true
  ),
  (
    '7e100000-0000-4000-8000-000000000002', 'Unbounded 201', 'unbounded-201',
    repeat('M', 201), 10, 0, true
  );

INSERT INTO public.products (id, name, slug, sku, price, inventory_quantity, active)
SELECT
  md5('7c1-ascii-' || value)::uuid,
  'ASCII bound ' || value,
  'ascii-bound-' || value,
  lpad(value::text, 3, '0') || repeat('A', 197),
  10,
  0,
  true
FROM generate_series(1, 100) AS values(value);

INSERT INTO public.products (id, name, slug, sku, price, inventory_quantity, active)
SELECT
  md5('7c1-multibyte-' || value)::uuid,
  'Multibyte bound ' || value,
  'multibyte-bound-' || value,
  lpad(value::text, 3, '0') || repeat('界', 197),
  10,
  0,
  true
FROM generate_series(1, 100) AS values(value);

ALTER TABLE public.products ENABLE TRIGGER sync_klaviyo_products_after_change;

INSERT INTO public.checkout_intents (
  id, status, subtotal_amount, shipping_amount, total_amount, currency
)
VALUES
  ('7e200000-0000-4000-8000-000000000001', 'preparing', 1000, 0, 1000, 'gbp'),
  ('7e200000-0000-4000-8000-000000000002', 'preparing', 1000, 0, 1000, 'gbp'),
  ('7e200000-0000-4000-8000-000000000003', 'preparing', 100000, 0, 100000, 'gbp'),
  ('7e200000-0000-4000-8000-000000000004', 'preparing', 100000, 0, 100000, 'gbp');

INSERT INTO public.checkout_intent_items (
  checkout_intent_id, product_type, product_id, base_product_id, sku, name, product_name,
  quantity, unit_amount, line_total, weight_grams, line_position
)
VALUES
  (
    '7e200000-0000-4000-8000-000000000001', 'product',
    '7e100000-0000-4000-8000-000000000001', '7e100000-0000-4000-8000-000000000001',
    repeat('L', 200), 'Bounded 200', 'Bounded 200', 1, 1000, 1000, 100, 0
  ),
  (
    '7e200000-0000-4000-8000-000000000002', 'product',
    '7e100000-0000-4000-8000-000000000002', '7e100000-0000-4000-8000-000000000002',
    repeat('M', 201), 'Unbounded 201', 'Unbounded 201', 1, 1000, 1000, 100, 0
  );

INSERT INTO public.checkout_intent_items (
  checkout_intent_id, product_type, product_id, base_product_id, sku, name, product_name,
  quantity, unit_amount, line_total, weight_grams, line_position
)
SELECT
  '7e200000-0000-4000-8000-000000000003',
  'product',
  md5('7c1-ascii-' || value)::uuid,
  md5('7c1-ascii-' || value)::uuid,
  lpad(value::text, 3, '0') || repeat('A', 197),
  'ASCII bound ' || value,
  'ASCII bound ' || value,
  1, 1000, 1000, 100, value - 1
FROM generate_series(1, 100) AS values(value);

INSERT INTO public.checkout_intent_items (
  checkout_intent_id, product_type, product_id, base_product_id, sku, name, product_name,
  quantity, unit_amount, line_total, weight_grams, line_position
)
SELECT
  '7e200000-0000-4000-8000-000000000004',
  'product',
  md5('7c1-multibyte-' || value)::uuid,
  md5('7c1-multibyte-' || value)::uuid,
  lpad(value::text, 3, '0') || repeat('界', 197),
  'Multibyte bound ' || value,
  'Multibyte bound ' || value,
  1, 1000, 1000, 100, value - 1
FROM generate_series(1, 100) AS values(value);

DO $setup_detail_bound_attempts$
DECLARE
  v_index integer;
BEGIN
  FOR v_index IN 1..4 LOOP
    PERFORM *
    FROM public.create_or_validate_checkout_attempt(
      ('7e300000-0000-4000-8000-' || lpad(v_index::text, 12, '0'))::uuid,
      NULL,
      repeat(v_index::text, 64)
    );
  END LOOP;
END;
$setup_detail_bound_attempts$;

DO $capture_detail_bounds$
DECLARE
  v_index integer;
  v_sqlstate text;
  v_detail text;
  v_message text;
BEGIN
  FOR v_index IN 1..4 LOOP
    BEGIN
      PERFORM *
      FROM public.reserve_checkout_inventory(
        ('7e300000-0000-4000-8000-' || lpad(v_index::text, 12, '0'))::uuid,
        ('7e400000-0000-4000-8000-' || lpad(v_index::text, 12, '0'))::uuid,
        ('7e200000-0000-4000-8000-' || lpad(v_index::text, 12, '0'))::uuid,
        repeat(v_index::text, 64),
        clock_timestamp() + interval '29 minutes',
        NULL
      );
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS
        v_sqlstate = RETURNED_SQLSTATE,
        v_detail = PG_EXCEPTION_DETAIL,
        v_message = MESSAGE_TEXT;
      INSERT INTO inventory_conflict_preparation_result
      VALUES ('detail_bound_' || v_index, v_sqlstate, v_detail, v_message);
    END;
  END LOOP;
END;
$capture_detail_bounds$;

SELECT is(
  (SELECT sqlstate FROM inventory_conflict_preparation_result WHERE name = 'detail_bound_1'),
  'TAI01',
  'a canonical SKU of exactly 200 characters may use the typed conflict contract'
);
SELECT ok(
  (SELECT sqlstate = 'P0001'
      AND message = 'Checkout inventory conflict detail contains an invalid SKU.'
    FROM inventory_conflict_preparation_result WHERE name = 'detail_bound_2'),
  'a canonical SKU of 201 characters fails generically without TAI01 exposure'
);
SELECT is(
  (SELECT jsonb_array_length(detail::jsonb -> 'unavailable_items')
    FROM inventory_conflict_preparation_result WHERE name = 'detail_bound_3'),
  100,
  'the maximum valid ASCII conflict array remains typed and complete'
);
SELECT ok(
  (SELECT sqlstate = 'TAI01' AND octet_length(detail) <= 32768
    FROM inventory_conflict_preparation_result WHERE name = 'detail_bound_3'),
  'the maximum valid ASCII conflict payload remains within the 32 KiB byte bound'
);
SELECT ok(
  (SELECT sqlstate = 'P0001'
      AND message = 'Checkout inventory conflict detail exceeds the safe byte limit.'
    FROM inventory_conflict_preparation_result WHERE name = 'detail_bound_4'),
  'a character-valid multibyte payload is rejected when its serialized bytes exceed 32 KiB'
);

INSERT INTO public.checkout_attempts (
  id, capability_hash, capability_expires_at, status, hard_expires_at,
  checkout_protocol_version, admitted_checkout_request_id, admitted_request_expires_at,
  created_at, updated_at
)
VALUES
  (
    '7c500000-0000-4000-8000-000000000001', repeat('3', 64),
    clock_timestamp() - interval '2 minutes', 'active', clock_timestamp() - interval '1 minute',
    'reservation_v1', '7c600000-0000-4000-8000-000000000001',
    clock_timestamp() - interval '90 seconds', clock_timestamp() - interval '2 hours',
    clock_timestamp() - interval '2 hours'
  ),
  (
    '7c500000-0000-4000-8000-000000000002', repeat('4', 64),
    clock_timestamp() - interval '2 minutes', 'active', clock_timestamp() - interval '1 minute',
    'reservation_v1', NULL, NULL, clock_timestamp() - interval '2 hours',
    clock_timestamp() - interval '2 hours'
  ),
  (
    '7c500000-0000-4000-8000-000000000003', repeat('5', 64),
    clock_timestamp() - interval '2 minutes', 'active', clock_timestamp() - interval '1 minute',
    'reservation_v1', NULL, NULL, clock_timestamp() - interval '2 hours',
    clock_timestamp() - interval '2 hours'
  ),
  (
    '7c500000-0000-4000-8000-000000000004', repeat('6', 64),
    clock_timestamp() - interval '2 minutes', 'active', clock_timestamp() - interval '1 minute',
    'reservation_v1', NULL, NULL, clock_timestamp() - interval '2 hours',
    clock_timestamp() - interval '2 hours'
  );

INSERT INTO public.checkout_intents (
  id, status, subtotal_amount, shipping_amount, total_amount, currency
)
VALUES ('7c700000-0000-4000-8000-000000000001', 'preparing', 1000, 0, 1000, 'gbp');

UPDATE public.checkout_intents
SET
  checkout_attempt_id = '7c500000-0000-4000-8000-000000000003',
  checkout_request_id = '7c600000-0000-4000-8000-000000000003',
  command_fingerprint = repeat('c', 64)
WHERE id = '7c700000-0000-4000-8000-000000000001';

INSERT INTO public.inventory_reservations (
  checkout_attempt_id, status, reserved_at, expires_at, updated_at
)
VALUES (
  '7c500000-0000-4000-8000-000000000004', 'held', clock_timestamp(),
  clock_timestamp() + interval '20 minutes', clock_timestamp()
);

SELECT is(
  public.terminalize_expired_empty_checkout_attempts_v1(1),
  1,
  'empty-attempt cleanup obeys its requested batch bound'
);
SELECT is(
  (SELECT count(*) FROM public.checkout_attempts
    WHERE id IN (
      '7c500000-0000-4000-8000-000000000001',
      '7c500000-0000-4000-8000-000000000002'
    ) AND status = 'expired'),
  1::bigint,
  'only one eligible empty attempt is terminalized in the first batch'
);
SELECT is(
  public.terminalize_expired_empty_checkout_attempts_v1(100),
  1,
  'a later bounded batch terminalizes the remaining eligible empty attempt'
);
SELECT ok(
  (SELECT bool_and(
      status = 'expired'
      AND completed_at IS NOT NULL
      AND admitted_checkout_request_id IS NULL
      AND admitted_request_expires_at IS NULL
    ) FROM public.checkout_attempts
    WHERE id IN (
      '7c500000-0000-4000-8000-000000000001',
      '7c500000-0000-4000-8000-000000000002'
    )),
  'cleanup expires audit rows and clears stale admission markers'
);
SELECT is(
  (SELECT status FROM public.checkout_attempts
    WHERE id = '7c500000-0000-4000-8000-000000000003'),
  'active',
  'cleanup ignores an attempt with a checkout intent'
);
SELECT is(
  (SELECT status FROM public.checkout_attempts
    WHERE id = '7c500000-0000-4000-8000-000000000004'),
  'active',
  'cleanup ignores an attempt with an inventory reservation'
);
SELECT matches(
  pg_get_functiondef('public.terminalize_expired_empty_checkout_attempts_v1(integer)'::regprocedure),
  'FOR UPDATE OF attempts SKIP LOCKED',
  'cleanup claims rows with SKIP LOCKED'
);
SELECT matches(
  pg_get_functiondef('public.terminalize_expired_empty_checkout_attempts_v1(integer)'::regprocedure),
  'LIMIT p_batch_size',
  'cleanup is explicitly bounded by batch size'
);
SELECT throws_ok(
  $$SELECT public.terminalize_expired_empty_checkout_attempts_v1(101)$$,
  'Expired empty checkout attempt batch size must be between 1 and 100.',
  'cleanup rejects an excessive batch size'
);
SELECT ok(
  NOT has_function_privilege(
    'anon', 'public.terminalize_expired_empty_checkout_attempts_v1(integer)', 'EXECUTE'
  ) AND NOT has_function_privilege(
    'authenticated', 'public.terminalize_expired_empty_checkout_attempts_v1(integer)', 'EXECUTE'
  ),
  'browser roles cannot execute empty-attempt maintenance'
);
SELECT ok(
  has_function_privilege(
    'service_role', 'public.terminalize_expired_empty_checkout_attempts_v1(integer)', 'EXECUTE'
  ),
  'service_role can execute bounded empty-attempt maintenance'
);

SELECT * FROM finish();

ROLLBACK;
