BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(18);

ALTER TABLE public.products DISABLE TRIGGER sync_klaviyo_products_after_change;

INSERT INTO public.products (
  id, name, slug, sku, price, inventory_quantity, active, weight_grams
)
VALUES (
  'f4000000-0000-4000-8000-000000000001',
  'Worker lease recovery product',
  'worker-lease-recovery-product',
  'WORKER-LEASE-RECOVERY',
  10.00,
  2,
  true,
  100
);

ALTER TABLE public.products ENABLE TRIGGER sync_klaviyo_products_after_change;

INSERT INTO public.shipping_methods (
  id, name, description, carrier, active, sort_order
)
VALUES (
  'f5000000-0000-4000-8000-000000000001',
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
  'f6000000-0000-4000-8000-000000000001',
  'f5000000-0000-4000-8000-000000000001',
  0,
  10000,
  4.99,
  'GBP',
  true
);

CREATE TEMPORARY TABLE worker_lease_fixture (
  checkout_intent_id uuid NOT NULL,
  reservation_id uuid NOT NULL
) ON COMMIT DROP;

SELECT is(
  (
    SELECT admission_state
    FROM public.admit_checkout_request_v1(
      'f1000000-0000-4000-8000-000000000001',
      'f2000000-0000-4000-8000-000000000001',
      NULL,
      repeat('a', 64),
      NULL
    )
  ),
  'admitted',
  'the exact browser request is admitted before materialisation'
);

INSERT INTO worker_lease_fixture (checkout_intent_id, reservation_id)
SELECT checkout_intent_id, reservation_id
FROM public.prepare_checkout_request(
  'f1000000-0000-4000-8000-000000000001',
  'f2000000-0000-4000-8000-000000000001',
  NULL,
  repeat('a', 64),
  repeat('b', 64),
  NULL,
  'f3000000-0000-4000-8000-000000000001',
  clock_timestamp() + interval '29 minutes',
  jsonb_build_object(
    'customer_email', NULL,
    'subtotal_amount', 1000,
    'shipping_amount', 499,
    'total_amount', 1499,
    'currency', 'gbp',
    'shipping_method_name', 'Tracked',
    'shipping_method_id', 'f5000000-0000-4000-8000-000000000001',
    'shipping_rate_id', 'f6000000-0000-4000-8000-000000000001',
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
  ),
  jsonb_build_array(jsonb_build_object(
    'product_type', 'product',
    'product_id', 'f4000000-0000-4000-8000-000000000001',
    'base_product_id', 'f4000000-0000-4000-8000-000000000001',
    'sku', 'WORKER-LEASE-RECOVERY',
    'name', 'Worker lease recovery product',
    'product_name', 'Worker lease recovery product',
    'variant_name', NULL,
    'quantity', 1,
    'unit_amount', 1000,
    'line_total', 1000,
    'weight_grams', 100,
    'image_url', NULL,
    'amount', NULL
  )),
  jsonb_build_array(jsonb_build_object(
    'shipping_method_id', 'f5000000-0000-4000-8000-000000000001',
    'shipping_rate_id', 'f6000000-0000-4000-8000-000000000001',
    'display_name', 'Tracked',
    'description', 'Tracked delivery',
    'carrier', 'Royal Mail',
    'amount', 499,
    'original_amount', 499,
    'currency', 'gbp'
  ))
);

SELECT ok(
  (
    SELECT intents.checkout_request_id = 'f2000000-0000-4000-8000-000000000001'
      AND attempts.in_flight_checkout_intent_id = intents.id
      AND reservations.id = fixture.reservation_id
      AND reservations.status = 'held'
    FROM worker_lease_fixture AS fixture
    JOIN public.checkout_intents AS intents ON intents.id = fixture.checkout_intent_id
    JOIN public.checkout_attempts AS attempts ON attempts.id = intents.checkout_attempt_id
    JOIN public.inventory_reservations AS reservations
      ON reservations.checkout_attempt_id = attempts.id
  ),
  'preparation creates one intent and one attempt-owned held reservation'
);

SELECT ok(
  (
    SELECT params_match
    FROM public.begin_checkout_session_creation(
      (SELECT checkout_intent_id FROM worker_lease_fixture),
      'f3000000-0000-4000-8000-000000000001',
      repeat('c', 64)
    )
  ),
  'the creation worker owns the exact Session mutation'
);

SELECT lives_ok(
  format(
    $$
      SELECT public.record_checkout_session(
        %L::uuid,
        'f3000000-0000-4000-8000-000000000001',
        'cs_test_worker_lease_recovery',
        (SELECT stripe_session_expires_at FROM public.checkout_intents WHERE id = %L::uuid),
        '[{"position":0,"stripe_shipping_rate_id":"shr_worker_lease_recovery"}]'::jsonb
      )
    $$,
    (SELECT checkout_intent_id FROM worker_lease_fixture),
    (SELECT checkout_intent_id FROM worker_lease_fixture)
  ),
  'the Stripe Session identity is durably recorded before activation'
);

SELECT is(
  public.activate_checkout_request(
    (SELECT checkout_intent_id FROM worker_lease_fixture),
    'f3000000-0000-4000-8000-000000000001',
    repeat('d', 64),
    clock_timestamp() + interval '24 hours'
  ),
  1,
  'successful activation creates confirmation generation one'
);

SELECT ok(
  (
    SELECT intents.orchestration_state = 'active'
      AND intents.status = 'pending'
      AND intents.stripe_checkout_session_id = 'cs_test_worker_lease_recovery'
      AND attempts.active_checkout_intent_id = intents.id
      AND attempts.in_flight_checkout_intent_id IS NULL
      AND reservations.id = fixture.reservation_id
      AND reservations.status = 'held'
    FROM worker_lease_fixture AS fixture
    JOIN public.checkout_intents AS intents ON intents.id = fixture.checkout_intent_id
    JOIN public.checkout_attempts AS attempts ON attempts.id = intents.checkout_attempt_id
    JOIN public.inventory_reservations AS reservations
      ON reservations.checkout_attempt_id = attempts.id
  ),
  'activation commits one stable materialised active checkout and the same reservation'
);

SELECT ok(
  (
    SELECT worker_lease_id IS NULL AND worker_lease_expires_at IS NULL
    FROM public.checkout_intents
    WHERE id = (SELECT checkout_intent_id FROM worker_lease_fixture)
  ),
  'successful activation releases the creation worker lease atomically'
);

SELECT ok(
  (
    SELECT resume_state = 'resumable'
      AND checkout_intent_id = (SELECT checkout_intent_id FROM worker_lease_fixture)
      AND checkout_session_id = 'cs_test_worker_lease_recovery'
      AND orchestration_state = 'active'
      AND worker_lease_acquired
    FROM public.resume_checkout_request_v1(
      'f1000000-0000-4000-8000-000000000001',
      'f2000000-0000-4000-8000-000000000001',
      NULL,
      repeat('a', 64),
      'f3000000-0000-4000-8000-000000000002'
    )
  ),
  'immediate reload reacquires the same materialised request with a new worker'
);

SELECT ok(
  (
    SELECT worker_lease_id = 'f3000000-0000-4000-8000-000000000002'
      AND worker_lease_expires_at > clock_timestamp()
    FROM public.checkout_intents
    WHERE id = (SELECT checkout_intent_id FROM worker_lease_fixture)
  ),
  'the recovery worker owns the resumed operation until it completes'
);

SELECT is(
  (
    SELECT resume_state
    FROM public.resume_checkout_request_v1(
      'f1000000-0000-4000-8000-000000000001',
      'f2000000-0000-4000-8000-000000000001',
      NULL,
      repeat('a', 64),
      'f3000000-0000-4000-8000-000000000003'
    )
  ),
  'operation_in_progress',
  'an incomplete recovery worker remains fenced from a different worker'
);

SELECT throws_ok(
  $$
    SELECT *
    FROM public.resume_checkout_request_v1(
      'f1000000-0000-4000-8000-000000000001',
      'f2000000-0000-4000-8000-000000000001',
      NULL,
      repeat('f', 64),
      'f3000000-0000-4000-8000-000000000003'
    )
  $$,
  'P0001',
  'Checkout attempt identity conflict.',
  'wrong attempt capability remains rejected'
);

SELECT is(
  (
    SELECT resume_state
    FROM public.resume_checkout_request_v1(
      'f1000000-0000-4000-8000-000000000001',
      'f2000000-0000-4000-8000-000000000002',
      NULL,
      repeat('a', 64),
      'f3000000-0000-4000-8000-000000000003'
    )
  ),
  'checkout_request_not_found',
  'a mismatched immutable request identity cannot claim the active intent'
);

SELECT is(
  public.rotate_checkout_confirmation_capability(
    (SELECT checkout_intent_id FROM worker_lease_fixture),
    'f3000000-0000-4000-8000-000000000002',
    repeat('e', 64),
    clock_timestamp() + interval '24 hours'
  ),
  2,
  'successful recovery rotates confirmation capability generation two'
);

SELECT ok(
  (
    SELECT confirmation_token_hash = repeat('e', 64)
      AND confirmation_generation = 2
      AND worker_lease_id IS NULL
      AND worker_lease_expires_at IS NULL
    FROM public.checkout_intents
    WHERE id = (SELECT checkout_intent_id FROM worker_lease_fixture)
  ),
  'successful capability rotation releases its recovery worker lease atomically'
);

SELECT ok(
  (
    SELECT resume_state = 'resumable'
      AND checkout_intent_id = (SELECT checkout_intent_id FROM worker_lease_fixture)
      AND checkout_session_id = 'cs_test_worker_lease_recovery'
      AND worker_lease_acquired
    FROM public.resume_checkout_request_v1(
      'f1000000-0000-4000-8000-000000000001',
      'f2000000-0000-4000-8000-000000000001',
      NULL,
      repeat('a', 64),
      'f3000000-0000-4000-8000-000000000003'
    )
  ),
  'the next immediate reload can acquire the lease after capability rotation'
);

SELECT ok(
  (
    SELECT count(*) = 1
      AND count(*) FILTER (
        WHERE checkout_request_id = 'f2000000-0000-4000-8000-000000000001'
          AND stripe_checkout_session_id = 'cs_test_worker_lease_recovery'
      ) = 1
    FROM public.checkout_intents
    WHERE checkout_attempt_id = 'f1000000-0000-4000-8000-000000000001'
  )
  AND (
    SELECT count(*) = 1
    FROM public.inventory_reservations
    WHERE checkout_attempt_id = 'f1000000-0000-4000-8000-000000000001'
      AND id = (SELECT reservation_id FROM worker_lease_fixture)
  )
  AND (
    SELECT count(*) = 1
    FROM public.inventory_reservation_items AS items
    WHERE items.reservation_id = (SELECT reservation_id FROM worker_lease_fixture)
  ),
  'repeated recovery preserves one request, Session, reservation and reservation item'
);

SELECT is(
  public.rotate_checkout_confirmation_capability(
    (SELECT checkout_intent_id FROM worker_lease_fixture),
    'f3000000-0000-4000-8000-000000000003',
    repeat('1', 64),
    clock_timestamp() + interval '24 hours'
  ),
  3,
  'the second recovery completes through confirmation generation three'
);

SELECT ok(
  (
    SELECT orchestration_state = 'active'
      AND status = 'pending'
      AND worker_lease_id IS NULL
      AND worker_lease_expires_at IS NULL
    FROM public.checkout_intents
    WHERE id = (SELECT checkout_intent_id FROM worker_lease_fixture)
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.orders
    WHERE checkout_attempt_id = 'f1000000-0000-4000-8000-000000000001'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.checkout_lifecycle_incidents
    WHERE checkout_attempt_id = 'f1000000-0000-4000-8000-000000000001'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.checkout_reconciliation_jobs
    WHERE checkout_attempt_id = 'f1000000-0000-4000-8000-000000000001'
  ),
  'completed recoveries leave one active checkout without order, incident or job side effects'
);

SELECT * FROM finish();

ROLLBACK;
