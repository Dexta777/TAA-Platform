BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(53);

SELECT col_not_null(
  'public',
  'products',
  'inventory_quantity',
  'product physical inventory is non-null'
);

SELECT col_not_null(
  'public',
  'product_variants',
  'inventory_quantity',
  'variant physical inventory is non-null'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'products_inventory_quantity_non_negative_check'
      AND conrelid = 'public.products'::regclass
  ),
  'products enforce non-negative physical inventory'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'product_variants_inventory_quantity_non_negative_check'
      AND conrelid = 'public.product_variants'::regclass
  ),
  'variants enforce non-negative physical inventory'
);

ALTER TABLE public.products DISABLE TRIGGER sync_klaviyo_products_after_change;
ALTER TABLE public.product_variants DISABLE TRIGGER sync_klaviyo_variants_after_change;

INSERT INTO public.products (
  id,
  name,
  slug,
  sku,
  price,
  inventory_quantity,
  active
)
VALUES
  (
    '31000000-0000-0000-0000-000000000001',
    'Reservation test product',
    'reservation-test-product',
    'RESERVATION-PRODUCT',
    10.00,
    5,
    true
  ),
  (
    '31000000-0000-0000-0000-000000000002',
    'Reservation variant parent',
    'reservation-variant-parent',
    'RESERVATION-PARENT',
    10.00,
    100,
    true
  );

INSERT INTO public.product_variants (
  id,
  product_id,
  variant_name,
  variant_sku,
  price,
  inventory_quantity,
  active
)
VALUES (
  '32000000-0000-0000-0000-000000000001',
  '31000000-0000-0000-0000-000000000002',
  'Reservation test variant',
  'RESERVATION-VARIANT',
  12.00,
  3,
  true
);

ALTER TABLE public.products ENABLE TRIGGER sync_klaviyo_products_after_change;
ALTER TABLE public.product_variants ENABLE TRIGGER sync_klaviyo_variants_after_change;

INSERT INTO public.checkout_intents (
  id,
  status,
  subtotal_amount,
  shipping_amount,
  total_amount,
  currency
)
VALUES
  ('51000000-0000-0000-0000-000000000001', 'preparing', 2000, 499, 2499, 'gbp'),
  ('51000000-0000-0000-0000-000000000002', 'preparing', 2400, 499, 2899, 'gbp'),
  ('51000000-0000-0000-0000-000000000003', 'preparing', 4000, 499, 4499, 'gbp'),
  ('51000000-0000-0000-0000-000000000004', 'preparing', 2000, 499, 2499, 'gbp'),
  ('51000000-0000-0000-0000-000000000005', 'preparing', 3000, 499, 3499, 'gbp'),
  ('51000000-0000-0000-0000-000000000006', 'preparing', 1000, 499, 1499, 'gbp'),
  ('51000000-0000-0000-0000-000000000007', 'preparing', 1000, 499, 1499, 'gbp'),
  ('51000000-0000-0000-0000-000000000008', 'pending', 1000, 499, 1499, 'gbp');

INSERT INTO public.checkout_intent_items (
  checkout_intent_id,
  product_type,
  product_id,
  base_product_id,
  sku,
  name,
  product_name,
  quantity,
  unit_amount,
  line_total,
  weight_grams
)
VALUES
  (
    '51000000-0000-0000-0000-000000000001',
    'product',
    '31000000-0000-0000-0000-000000000001',
    '31000000-0000-0000-0000-000000000001',
    'RESERVATION-PRODUCT',
    'Reservation test product',
    'Reservation test product',
    2,
    1000,
    2000,
    200
  ),
  (
    '51000000-0000-0000-0000-000000000002',
    'variant',
    '32000000-0000-0000-0000-000000000001',
    '31000000-0000-0000-0000-000000000002',
    'RESERVATION-VARIANT',
    'Reservation test variant',
    'Reservation variant parent',
    2,
    1200,
    2400,
    200
  ),
  (
    '51000000-0000-0000-0000-000000000003',
    'product',
    '31000000-0000-0000-0000-000000000001',
    '31000000-0000-0000-0000-000000000001',
    'RESERVATION-PRODUCT',
    'Reservation test product',
    'Reservation test product',
    4,
    1000,
    4000,
    400
  ),
  (
    '51000000-0000-0000-0000-000000000004',
    'product',
    '31000000-0000-0000-0000-000000000001',
    '31000000-0000-0000-0000-000000000001',
    'RESERVATION-PRODUCT',
    'Reservation test product',
    'Reservation test product',
    2,
    1000,
    2000,
    200
  ),
  (
    '51000000-0000-0000-0000-000000000005',
    'product',
    '31000000-0000-0000-0000-000000000001',
    '31000000-0000-0000-0000-000000000001',
    'RESERVATION-PRODUCT',
    'Reservation test product',
    'Reservation test product',
    3,
    1000,
    3000,
    300
  ),
  (
    '51000000-0000-0000-0000-000000000006',
    'product',
    '31000000-0000-0000-0000-000000000001',
    '31000000-0000-0000-0000-000000000001',
    'RESERVATION-PRODUCT',
    'Reservation test product',
    'Reservation test product',
    1,
    1000,
    1000,
    100
  ),
  (
    '51000000-0000-0000-0000-000000000007',
    'product',
    '31000000-0000-0000-0000-000000000001',
    '31000000-0000-0000-0000-000000000001',
    'RESERVATION-PRODUCT',
    'Reservation test product',
    'Reservation test product',
    1,
    1000,
    1000,
    100
  );

SELECT is(
  (
    SELECT already_exists
    FROM public.create_or_validate_checkout_attempt(
      '41000000-0000-0000-0000-000000000001',
      NULL,
      repeat('a', 64)
    )
  ),
  false,
  'a checkout attempt is created once'
);

SELECT is(
  (
    SELECT already_exists
    FROM public.create_or_validate_checkout_attempt(
      '41000000-0000-0000-0000-000000000001',
      NULL,
      repeat('a', 64)
    )
  ),
  true,
  'the same attempt identity validates idempotently'
);

SELECT throws_ok(
  $$
    SELECT *
    FROM public.create_or_validate_checkout_attempt(
      '41000000-0000-0000-0000-000000000001',
      NULL,
      repeat('b', 64)
    )
  $$,
  'P0001',
  'Checkout attempt identity conflict.',
  'an existing attempt rejects a different capability identity'
);

DO $setup_attempts$
BEGIN
  PERFORM * FROM public.create_or_validate_checkout_attempt(
    '41000000-0000-0000-0000-000000000002', NULL, repeat('b', 64)
  );
  PERFORM * FROM public.create_or_validate_checkout_attempt(
    '41000000-0000-0000-0000-000000000003', NULL, repeat('c', 64)
  );
  PERFORM * FROM public.create_or_validate_checkout_attempt(
    '41000000-0000-0000-0000-000000000004', NULL, repeat('d', 64)
  );
  PERFORM * FROM public.create_or_validate_checkout_attempt(
    '41000000-0000-0000-0000-000000000005', NULL, repeat('e', 64)
  );
END;
$setup_attempts$;

SELECT lives_ok(
  $$
    SELECT *
    FROM public.reserve_checkout_inventory(
      '41000000-0000-0000-0000-000000000001',
      '61000000-0000-0000-0000-000000000001',
      '51000000-0000-0000-0000-000000000001',
      repeat('1', 64),
      clock_timestamp() + interval '29 minutes'
    )
  $$,
  'product inventory can be reserved'
);

SELECT ok(
  (
    SELECT reservations.status = 'held'
      AND items.product_id = '31000000-0000-0000-0000-000000000001'
      AND items.product_variant_id IS NULL
      AND items.quantity = 2
    FROM public.inventory_reservations AS reservations
    JOIN public.inventory_reservation_items AS items
      ON items.reservation_id = reservations.id
    WHERE reservations.checkout_attempt_id = '41000000-0000-0000-0000-000000000001'
  ),
  'a product reservation stores one explicit product item'
);

SELECT is(
  (
    SELECT inventory_quantity
    FROM public.products
    WHERE id = '31000000-0000-0000-0000-000000000001'
  ),
  5,
  'reserving does not decrement physical product inventory'
);

SELECT ok(
  (
    SELECT on_hand_quantity = 5
      AND reserved_quantity = 2
      AND available_to_sell = 3
    FROM public.get_inventory_available_to_sell(
      '31000000-0000-0000-0000-000000000001',
      NULL
    )
  ),
  'available-to-sell subtracts held product reservations from on-hand stock'
);

ALTER TABLE public.products DISABLE TRIGGER sync_klaviyo_products_after_change;

UPDATE public.products
SET inventory_quantity = 1
WHERE id = '31000000-0000-0000-0000-000000000001';

SELECT ok(
  (
    SELECT on_hand_quantity = 1
      AND reserved_quantity = 2
      AND available_to_sell = -1
    FROM public.get_inventory_available_to_sell(
      '31000000-0000-0000-0000-000000000001',
      NULL
    )
  ),
  'negative available-to-sell remains an unclamped inventory integrity signal'
);

UPDATE public.products
SET inventory_quantity = 5
WHERE id = '31000000-0000-0000-0000-000000000001';

ALTER TABLE public.products ENABLE TRIGGER sync_klaviyo_products_after_change;

SELECT lives_ok(
  $$
    SELECT *
    FROM public.reserve_checkout_inventory(
      '41000000-0000-0000-0000-000000000002',
      '61000000-0000-0000-0000-000000000002',
      '51000000-0000-0000-0000-000000000002',
      repeat('2', 64),
      clock_timestamp() + interval '29 minutes'
    )
  $$,
  'variant inventory can be reserved'
);

SELECT ok(
  (
    SELECT items.product_id IS NULL
      AND items.product_variant_id = '32000000-0000-0000-0000-000000000001'
      AND items.quantity = 2
    FROM public.inventory_reservations AS reservations
    JOIN public.inventory_reservation_items AS items
      ON items.reservation_id = reservations.id
    WHERE reservations.checkout_attempt_id = '41000000-0000-0000-0000-000000000002'
  ),
  'a variant reservation stores one explicit variant item'
);

SELECT ok(
  (
    SELECT on_hand_quantity = 3
      AND reserved_quantity = 2
      AND available_to_sell = 1
    FROM public.get_inventory_available_to_sell(
      NULL,
      '32000000-0000-0000-0000-000000000001'
    )
  ),
  'available-to-sell is calculated independently for variants'
);

SELECT throws_ok(
  $$
    SELECT *
    FROM public.reserve_checkout_inventory(
      '41000000-0000-0000-0000-000000000003',
      '61000000-0000-0000-0000-000000000003',
      '51000000-0000-0000-0000-000000000003',
      repeat('3', 64),
      clock_timestamp() + interval '29 minutes'
    )
  $$,
  'TAI01',
  'Checkout inventory conflict.',
  'a reservation exceeding available-to-sell uses the typed inventory conflict'
);

SELECT is(
  (
    SELECT count(*)
    FROM public.inventory_reservations
    WHERE checkout_attempt_id = '41000000-0000-0000-0000-000000000003'
  ),
  0::bigint,
  'an insufficient request creates no reservation'
);

SELECT is(
  (
    SELECT request_replayed
    FROM public.reserve_checkout_inventory(
      '41000000-0000-0000-0000-000000000001',
      '61000000-0000-0000-0000-000000000001',
      '51000000-0000-0000-0000-000000000001',
      repeat('1', 64),
      clock_timestamp() + interval '29 minutes'
    )
  ),
  true,
  'an identical request is replayed idempotently'
);

SELECT is(
  (
    SELECT count(*)
    FROM public.inventory_reservations
    WHERE checkout_attempt_id = '41000000-0000-0000-0000-000000000001'
  ),
  1::bigint,
  'duplicate requests do not create another reservation header'
);

SELECT throws_ok(
  $$
    SELECT *
    FROM public.reserve_checkout_inventory(
      '41000000-0000-0000-0000-000000000001',
      '61000000-0000-0000-0000-000000000001',
      '51000000-0000-0000-0000-000000000001',
      repeat('f', 64),
      clock_timestamp() + interval '29 minutes'
    )
  $$,
  'P0001',
  'Checkout request conflict.',
  'the same request ID rejects a changed command fingerprint'
);

SELECT is(
  (
    SELECT reservation_reused
    FROM public.reserve_checkout_inventory(
      '41000000-0000-0000-0000-000000000001',
      '61000000-0000-0000-0000-000000000004',
      '51000000-0000-0000-0000-000000000004',
      repeat('4', 64),
      clock_timestamp() + interval '29 minutes',
      '51000000-0000-0000-0000-000000000001'
    )
  ),
  true,
  'a replacement-style request reuses the attempt reservation'
);

SELECT ok(
  (
    SELECT count(*) = 1
    FROM public.inventory_reservations
    WHERE checkout_attempt_id = '41000000-0000-0000-0000-000000000001'
  )
  AND (
    SELECT count(*) = 2
    FROM public.checkout_intents
    WHERE checkout_attempt_id = '41000000-0000-0000-0000-000000000001'
  ),
  'replacement requests retain one reservation and distinct request records'
);

SELECT throws_ok(
  $$
    SELECT *
    FROM public.reserve_checkout_inventory(
      '41000000-0000-0000-0000-000000000001',
      '61000000-0000-0000-0000-000000000005',
      '51000000-0000-0000-0000-000000000005',
      repeat('5', 64),
      clock_timestamp() + interval '29 minutes',
      '51000000-0000-0000-0000-000000000004'
    )
  $$,
  'P0001',
  'Checkout attempt cart is immutable.',
  'a replacement request cannot change the attempt cart'
);

SELECT is(
  (
    SELECT already_released
    FROM public.release_checkout_inventory_reservation(
      '41000000-0000-0000-0000-000000000001',
      'test_release'
    )
  ),
  false,
  'the first release performs the reservation transition'
);

SELECT ok(
  (
    SELECT status = 'released'
      AND released_at IS NOT NULL
      AND release_reason = 'test_release'
    FROM public.inventory_reservations
    WHERE checkout_attempt_id = '41000000-0000-0000-0000-000000000001'
  ),
  'release records an auditable terminal reservation state'
);

SELECT is(
  (
    SELECT available_to_sell
    FROM public.get_inventory_available_to_sell(
      '31000000-0000-0000-0000-000000000001',
      NULL
    )
  ),
  5::bigint,
  'release restores product available-to-sell'
);

SELECT is(
  (
    SELECT already_released
    FROM public.release_checkout_inventory_reservation(
      '41000000-0000-0000-0000-000000000001',
      'different_retry_reason'
    )
  ),
  true,
  'repeated release is idempotent'
);

SELECT is(
  (
    SELECT inventory_quantity
    FROM public.products
    WHERE id = '31000000-0000-0000-0000-000000000001'
  ),
  5,
  'release does not mutate physical inventory'
);

UPDATE public.checkout_attempts
SET
  status = 'expired',
  capability_expires_at = clock_timestamp() - interval '1 hour',
  hard_expires_at = clock_timestamp() - interval '1 hour',
  created_at = clock_timestamp() - interval '2 hours',
  updated_at = clock_timestamp(),
  completed_at = clock_timestamp()
WHERE id = '41000000-0000-0000-0000-000000000001';

SELECT is(
  (
    SELECT request_replayed AND reservation_status = 'released'
    FROM public.reserve_checkout_inventory(
      '41000000-0000-0000-0000-000000000001',
      '61000000-0000-0000-0000-000000000001',
      '51000000-0000-0000-0000-000000000001',
      repeat('1', 64),
      clock_timestamp() + interval '29 minutes'
    )
  ),
  true,
  'an exact request replays without changing its terminal reservation state'
);

SELECT ok(
  (
    SELECT count(*) = 1
    FROM public.inventory_reservations
    WHERE checkout_attempt_id = '41000000-0000-0000-0000-000000000001'
  )
  AND (
    SELECT count(*) = 1
    FROM public.inventory_reservation_items AS items
    JOIN public.inventory_reservations AS reservations
      ON reservations.id = items.reservation_id
    WHERE reservations.checkout_attempt_id = '41000000-0000-0000-0000-000000000001'
  ),
  'terminal replay creates no additional reservation header or item'
);

SELECT is(
  (
    SELECT inventory_quantity
    FROM public.products
    WHERE id = '31000000-0000-0000-0000-000000000001'
  ),
  5,
  'terminal replay does not mutate physical inventory'
);

SELECT throws_ok(
  $$
    SELECT *
    FROM public.reserve_checkout_inventory(
      '41000000-0000-0000-0000-000000000001',
      '61000000-0000-0000-0000-000000000009',
      '51000000-0000-0000-0000-000000000005',
      repeat('5', 64),
      clock_timestamp() + interval '29 minutes',
      '51000000-0000-0000-0000-000000000004'
    )
  $$,
  'P0001',
  'Checkout attempt is no longer active.',
  'a terminal attempt rejects a new checkout request ID'
);

SELECT throws_ok(
  $$
    SELECT *
    FROM public.reserve_checkout_inventory(
      '41000000-0000-0000-0000-000000000001',
      '61000000-0000-0000-0000-000000000001',
      '51000000-0000-0000-0000-000000000001',
      repeat('f', 64),
      clock_timestamp() + interval '29 minutes'
    )
  $$,
  'P0001',
  'Checkout request conflict.',
  'terminal replay still rejects a changed command fingerprint'
);

SELECT lives_ok(
  $$
    SELECT *
    FROM public.reserve_checkout_inventory(
      '41000000-0000-0000-0000-000000000004',
      '61000000-0000-0000-0000-000000000006',
      '51000000-0000-0000-0000-000000000006',
      repeat('6', 64),
      clock_timestamp() + interval '29 minutes'
    )
  $$,
  'a second attempt can reserve stock released by the first'
);

INSERT INTO public.orders (
  id,
  email,
  order_number,
  status,
  total,
  checkout_intent_id,
  checkout_attempt_id
)
VALUES (
  '71000000-0000-0000-0000-000000000004',
  'consumed-reservation@example.com',
  'TAA-RESERVATION-CONSUMED-TEST',
  'paid',
  10.00,
  '51000000-0000-0000-0000-000000000006',
  '41000000-0000-0000-0000-000000000004'
);

UPDATE public.inventory_reservations
SET
  status = 'consumed',
  consumed_at = clock_timestamp(),
  order_id = '71000000-0000-0000-0000-000000000004',
  updated_at = clock_timestamp()
WHERE checkout_attempt_id = '41000000-0000-0000-0000-000000000004';

SELECT throws_ok(
  $$
    SELECT *
    FROM public.release_checkout_inventory_reservation(
      '41000000-0000-0000-0000-000000000004',
      'invalid_release'
    )
  $$,
  'P0001',
  'Consumed inventory reservation cannot be released.',
  'a consumed reservation cannot be released'
);

SELECT is(
  (
    SELECT available_to_sell
    FROM public.get_inventory_available_to_sell(
      '31000000-0000-0000-0000-000000000001',
      NULL
    )
  ),
  5::bigint,
  'consumed reservations do not subtract from available-to-sell'
);

SELECT lives_ok(
  $$
    SELECT *
    FROM public.reserve_checkout_inventory(
      '41000000-0000-0000-0000-000000000005',
      '61000000-0000-0000-0000-000000000007',
      '51000000-0000-0000-0000-000000000007',
      repeat('7', 64),
      clock_timestamp() + interval '29 minutes'
    )
  $$,
  'an additional held reservation can be created'
);

UPDATE public.inventory_reservations
SET
  reserved_at = clock_timestamp() - interval '2 hours',
  expires_at = clock_timestamp() - interval '1 hour',
  updated_at = clock_timestamp()
WHERE checkout_attempt_id = '41000000-0000-0000-0000-000000000005';

SELECT is(
  (
    SELECT available_to_sell
    FROM public.get_inventory_available_to_sell(
      '31000000-0000-0000-0000-000000000001',
      NULL
    )
  ),
  4::bigint,
  'an overdue held reservation still subtracts from available-to-sell'
);

UPDATE public.inventory_reservations
SET status = 'payment_pending', updated_at = clock_timestamp()
WHERE checkout_attempt_id = '41000000-0000-0000-0000-000000000005';

SELECT is(
  (
    SELECT available_to_sell
    FROM public.get_inventory_available_to_sell(
      '31000000-0000-0000-0000-000000000001',
      NULL
    )
  ),
  4::bigint,
  'payment-pending reservations continue to subtract from available-to-sell'
);

SELECT ok(
  (
    SELECT reservation_status = 'payment_pending'
      AND jsonb_array_length(items) = 1
      AND items -> 0 ->> 'sku' = 'RESERVATION-PRODUCT'
    FROM public.get_checkout_reservation_state(
      '41000000-0000-0000-0000-000000000005'
    )
  ),
  'server inspection returns lifecycle and item state without capability material'
);

SELECT ok(
  (
    SELECT count(*) = 1
    FROM pg_index
    WHERE indrelid = 'public.inventory_reservations'::regclass
      AND indisunique
      AND indexrelid = 'public.inventory_reservations_checkout_attempt_id_key'::regclass
  ),
  'the database enforces one reservation header per attempt'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'inventory_reservation_items_resource_check'
      AND conrelid = 'public.inventory_reservation_items'::regclass
  ),
  'reservation items require exactly one product or variant resource'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'inventory_reservation_items_quantity_check'
      AND conrelid = 'public.inventory_reservation_items'::regclass
  ),
  'reservation items require a positive quantity'
);

SELECT ok(
  (
    SELECT count(*) = 1
    FROM pg_index
    WHERE indrelid = 'public.orders'::regclass
      AND indisunique
      AND indexrelid = 'public.orders_checkout_attempt_id_key'::regclass
  ),
  'new-attempt orders are unique while historical null attempts remain permitted'
);

SELECT lives_ok(
  $$
    UPDATE public.checkout_intents
    SET status = 'pending'
    WHERE id = '51000000-0000-0000-0000-000000000008'
      AND checkout_attempt_id IS NULL
      AND checkout_request_id IS NULL
      AND command_fingerprint IS NULL
  $$,
  'historical checkout intents remain valid without attempt identity'
);

SELECT ok(
  (
    SELECT bool_and(relrowsecurity)
    FROM pg_class
    WHERE oid IN (
      'public.checkout_attempts'::regclass,
      'public.inventory_reservations'::regclass,
      'public.inventory_reservation_items'::regclass
    )
  ),
  'RLS is enabled on all attempt and reservation tables'
);

SELECT ok(
  NOT has_table_privilege('anon', 'public.checkout_attempts', 'SELECT')
    AND NOT has_table_privilege('anon', 'public.checkout_attempts', 'INSERT')
    AND NOT has_table_privilege('anon', 'public.inventory_reservations', 'SELECT')
    AND NOT has_table_privilege('anon', 'public.inventory_reservations', 'UPDATE')
    AND NOT has_table_privilege('anon', 'public.inventory_reservation_items', 'SELECT')
    AND NOT has_table_privilege('anon', 'public.inventory_reservation_items', 'INSERT'),
  'anon cannot read or write checkout attempts and reservations'
);

SELECT ok(
  NOT has_table_privilege('authenticated', 'public.checkout_attempts', 'SELECT')
    AND NOT has_table_privilege('authenticated', 'public.checkout_attempts', 'INSERT')
    AND NOT has_table_privilege('authenticated', 'public.inventory_reservations', 'SELECT')
    AND NOT has_table_privilege('authenticated', 'public.inventory_reservations', 'UPDATE')
    AND NOT has_table_privilege(
      'authenticated',
      'public.inventory_reservation_items',
      'SELECT'
    )
    AND NOT has_table_privilege(
      'authenticated',
      'public.inventory_reservation_items',
      'INSERT'
    ),
  'authenticated cannot read or write checkout attempts and reservations'
);

SELECT ok(
  NOT has_function_privilege(
    'anon',
    'public.create_or_validate_checkout_attempt(uuid,uuid,text)',
    'EXECUTE'
  )
    AND NOT has_function_privilege(
      'anon',
      'public.reserve_checkout_inventory(uuid,uuid,uuid,text,timestamp with time zone,uuid)',
      'EXECUTE'
    )
    AND NOT has_function_privilege(
      'anon',
      'public.release_checkout_inventory_reservation(uuid,text)',
      'EXECUTE'
    )
    AND NOT has_function_privilege(
      'anon',
      'public.get_inventory_available_to_sell(uuid,uuid)',
      'EXECUTE'
    ),
  'anon cannot execute reservation transitions or inspection'
);

SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'public.create_or_validate_checkout_attempt(uuid,uuid,text)',
    'EXECUTE'
  )
    AND NOT has_function_privilege(
      'authenticated',
      'public.reserve_checkout_inventory(uuid,uuid,uuid,text,timestamp with time zone,uuid)',
      'EXECUTE'
    )
    AND NOT has_function_privilege(
      'authenticated',
      'public.release_checkout_inventory_reservation(uuid,text)',
      'EXECUTE'
    )
    AND NOT has_function_privilege(
      'authenticated',
      'public.get_checkout_reservation_state(uuid)',
      'EXECUTE'
    ),
  'authenticated cannot execute reservation transitions or inspection'
);

SELECT ok(
  has_function_privilege(
    'service_role',
    'public.create_or_validate_checkout_attempt(uuid,uuid,text)',
    'EXECUTE'
  )
    AND has_function_privilege(
      'service_role',
      'public.reserve_checkout_inventory(uuid,uuid,uuid,text,timestamp with time zone,uuid)',
      'EXECUTE'
    )
    AND has_function_privilege(
      'service_role',
      'public.release_checkout_inventory_reservation(uuid,text)',
      'EXECUTE'
    )
    AND has_function_privilege(
      'service_role',
      'public.get_checkout_reservation_state(uuid)',
      'EXECUTE'
    ),
  'service_role can execute the reservation kernel'
);

SELECT lives_ok(
  $$
    SELECT *
    FROM public.release_checkout_inventory_reservation(
      '41000000-0000-0000-0000-000000000005',
      'authoritative_reconciliation'
    )
  $$,
  'a payment-pending reservation can be authoritatively released'
);

SELECT is(
  (
    SELECT available_to_sell
    FROM public.get_inventory_available_to_sell(
      '31000000-0000-0000-0000-000000000001',
      NULL
    )
  ),
  5::bigint,
  'terminal product reservations leave all physical stock available'
);

SELECT * FROM finish();

ROLLBACK;
