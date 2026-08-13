BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(19);

INSERT INTO auth.users (id, email, raw_user_meta_data)
VALUES
  ('e0000000-0000-4000-8000-000000000001', 'slice5d-a@example.com', '{}'::jsonb),
  ('e0000000-0000-4000-8000-000000000002', 'slice5d-b@example.com', '{}'::jsonb);

SELECT is(
  (
    SELECT admission_state
    FROM public.admit_checkout_request_v1(
      'e1000000-0000-4000-8000-000000000001',
      'e2000000-0000-4000-8000-000000000001',
      NULL,
      repeat('a', 64),
      NULL
    )
  ),
  'admitted',
  'a new request is durably admitted before canonical preparation'
);

SELECT ok(
  (
    SELECT checkout_protocol_version = 'reservation_v1'
      AND admitted_checkout_request_id = 'e2000000-0000-4000-8000-000000000001'
      AND user_id IS NULL
    FROM public.checkout_attempts
    WHERE id = 'e1000000-0000-4000-8000-000000000001'
  ),
  'new guest admission records protocol and immutable guest binding'
);

SELECT is(
  (
    SELECT admission_state
    FROM public.admit_checkout_request_v1(
      'e1000000-0000-4000-8000-000000000001',
      'e2000000-0000-4000-8000-000000000001',
      'e0000000-0000-4000-8000-000000000001',
      repeat('a', 64),
      NULL
    )
  ),
  'admitted',
  'the same admitted guest request replays after the browser signs in'
);

SELECT is(
  (
    SELECT user_id
    FROM public.checkout_attempts
    WHERE id = 'e1000000-0000-4000-8000-000000000001'
  ),
  NULL::uuid,
  'guest to signed-in replay never upgrades attempt ownership'
);

SELECT throws_ok(
  $$SELECT * FROM public.admit_checkout_request_v1(
    'e1000000-0000-4000-8000-000000000001',
    'e2000000-0000-4000-8000-000000000002',
    NULL,
    repeat('a', 64),
    NULL
  )$$,
  'Checkout attempt already has an unresolved admitted request.',
  'a different request cannot branch an unresolved admission'
);

SELECT is(
  (
    SELECT resume_state
    FROM public.resume_checkout_request_v1(
      'e1000000-0000-4000-8000-000000000001',
      'e2000000-0000-4000-8000-000000000001',
      NULL,
      repeat('a', 64),
      'e3000000-0000-4000-8000-000000000001'
    )
  ),
  'operation_in_progress',
  'resume sees admitted canonical work without creating a request'
);

UPDATE public.checkout_attempts
SET admitted_request_expires_at = clock_timestamp() - interval '1 second'
WHERE id = 'e1000000-0000-4000-8000-000000000001';

SELECT is(
  (
    SELECT resume_state
    FROM public.resume_checkout_request_v1(
      'e1000000-0000-4000-8000-000000000001',
      'e2000000-0000-4000-8000-000000000001',
      NULL,
      repeat('a', 64),
      'e3000000-0000-4000-8000-000000000002'
    )
  ),
  'request_not_materialized',
  'expired admission is an explicit never-materialized state'
);

SELECT throws_ok(
  $$INSERT INTO public.checkout_intents (
    id, status, subtotal_amount, shipping_amount, total_amount, currency,
    checkout_attempt_id, checkout_request_id, command_fingerprint,
    checkout_protocol_version, orchestration_state, orchestration_updated_at,
    stripe_return_url, stripe_session_expires_at
  ) VALUES (
    'e4000000-0000-4000-8000-000000000001', 'preparing', 1000, 0, 1000, 'gbp',
    'e1000000-0000-4000-8000-000000000001',
    'e2000000-0000-4000-8000-000000000001', repeat('b', 64),
    'reservation_v1', 'prepared', clock_timestamp(), 'https://example.test/return',
    clock_timestamp() + interval '30 minutes'
  )$$,
  'Checkout request admission is invalid or expired.',
  'an expired admission prevents an old worker from materializing its request'
);

SELECT ok(
  public.terminalize_unmaterialized_checkout_attempt_v1(
    'e1000000-0000-4000-8000-000000000001', NULL, repeat('a', 64)
  ),
  'expired admission with no intent or reservation is safely terminalized'
);

SELECT is(
  (
    SELECT status
    FROM public.checkout_attempts
    WHERE id = 'e1000000-0000-4000-8000-000000000001'
  ),
  'failed',
  'safe never-materialized terminalization closes the attempt'
);

SELECT lives_ok(
  $$SELECT * FROM public.admit_checkout_request_v1(
    'e1000000-0000-4000-8000-000000000002',
    'e2000000-0000-4000-8000-000000000002',
    'e0000000-0000-4000-8000-000000000001',
    repeat('c', 64),
    NULL
  )$$,
  'an authenticated attempt is admitted for its current owner'
);

SELECT throws_ok(
  $$SELECT * FROM public.get_checkout_attempt_protocol(
    'e1000000-0000-4000-8000-000000000002',
    'e0000000-0000-4000-8000-000000000002',
    repeat('c', 64)
  )$$,
  'Checkout attempt account identity conflict.',
  'authenticated user B cannot use authenticated user A attempt'
);

SELECT throws_ok(
  $$SELECT * FROM public.get_checkout_attempt_protocol(
    'e1000000-0000-4000-8000-000000000002', NULL, repeat('c', 64)
  )$$,
  'Checkout attempt account identity conflict.',
  'an authenticated attempt cannot continue after logout'
);

SELECT throws_ok(
  $$SELECT * FROM public.get_checkout_attempt_protocol(
    'e1000000-0000-4000-8000-000000000002',
    'e0000000-0000-4000-8000-000000000001',
    repeat('d', 64)
  )$$,
  'Checkout attempt identity conflict.',
  'an incorrect attempt capability is rejected'
);

ALTER TABLE public.products DISABLE TRIGGER sync_klaviyo_products_after_change;

INSERT INTO public.products (id, name, slug, sku, price, inventory_quantity, active)
VALUES (
  'e5000000-0000-4000-8000-000000000001',
  'Slice 5D confirmation product',
  'slice-5d-confirmation-product',
  'SLICE-5D-CONFIRM',
  10.00,
  5,
  true
);

ALTER TABLE public.products ENABLE TRIGGER sync_klaviyo_products_after_change;

INSERT INTO public.checkout_attempts (
  id, capability_hash, capability_expires_at, hard_expires_at
) VALUES (
  'e1000000-0000-4000-8000-000000000003', repeat('e', 64),
  clock_timestamp() + interval '90 minutes', clock_timestamp() + interval '119 minutes'
);

INSERT INTO public.checkout_intents (
  id, payment_intent_id, stripe_checkout_session_id, status, customer_email,
  subtotal_amount, shipping_amount, total_amount, currency, shipping_method_name,
  checkout_attempt_id, checkout_request_id, command_fingerprint,
  checkout_protocol_version, orchestration_state, orchestration_updated_at,
  confirmation_token_hash, confirmation_token_expires_at, confirmation_generation,
  stripe_return_url, stripe_session_expires_at
) VALUES (
  'e4000000-0000-4000-8000-000000000003',
  'pi_slice5d_confirm', 'cs_slice5d_confirm', 'pending', 'guest@example.com',
  1000, 0, 1000, 'gbp', 'Test shipping',
  'e1000000-0000-4000-8000-000000000003',
  'e2000000-0000-4000-8000-000000000003', repeat('f', 64),
  'reservation_v1', 'active', clock_timestamp(), repeat('1', 64),
  clock_timestamp() + interval '30 minutes', 4, 'https://example.test/return',
  clock_timestamp() + interval '119 minutes'
);

UPDATE public.checkout_attempts
SET
  checkout_protocol_version = 'reservation_v1',
  active_checkout_intent_id = 'e4000000-0000-4000-8000-000000000003'
WHERE id = 'e1000000-0000-4000-8000-000000000003';

INSERT INTO public.checkout_intent_items (
  checkout_intent_id, product_type, product_id, base_product_id, sku, name,
  product_name, quantity, unit_amount, line_total, weight_grams, line_position
) VALUES (
  'e4000000-0000-4000-8000-000000000003', 'product',
  'e5000000-0000-4000-8000-000000000001',
  'e5000000-0000-4000-8000-000000000001', 'SLICE-5D-CONFIRM',
  'Slice 5D confirmation product', 'Slice 5D confirmation product', 1, 1000, 1000, 100, 0
);

INSERT INTO public.inventory_reservations (
  id, checkout_attempt_id, status, reserved_at, expires_at
) VALUES (
  'e6000000-0000-4000-8000-000000000001',
  'e1000000-0000-4000-8000-000000000003', 'held', clock_timestamp(),
  clock_timestamp() + interval '29 minutes'
);

INSERT INTO public.inventory_reservation_items (
  reservation_id, product_id, sku_snapshot, quantity
) VALUES (
  'e6000000-0000-4000-8000-000000000001',
  'e5000000-0000-4000-8000-000000000001', 'SLICE-5D-CONFIRM', 1
);

SELECT is(
  (
    SELECT finalization_outcome
    FROM public.finalize_paid_checkout('cs_slice5d_confirm', 'pi_slice5d_confirm')
  ),
  'finalized',
  'reservation-v1 guest checkout finalizes successfully'
);

SELECT ok(
  (
    SELECT status = 'paid'
      AND confirmation_token_hash = repeat('1', 64)
      AND confirmation_token_expires_at > clock_timestamp()
      AND confirmation_generation = 4
    FROM public.checkout_intents
    WHERE id = 'e4000000-0000-4000-8000-000000000003'
  ),
  'paid guest checkout preserves its current confirmation capability and TTL'
);

SELECT ok(
  NOT has_function_privilege(
    'anon',
    'public.admit_checkout_request_v1(uuid,uuid,uuid,text,text)',
    'EXECUTE'
  )
    AND NOT has_function_privilege(
      'authenticated',
      'public.resume_checkout_request_v1(uuid,uuid,uuid,text,uuid)',
      'EXECUTE'
    ),
  'browser roles cannot execute admission or resume RPCs'
);

SELECT ok(
  NOT has_function_privilege(
    'anon',
    'public.get_checkout_attempt_abandonment_context_v1(uuid,uuid,text)',
    'EXECUTE'
  )
    AND NOT has_function_privilege(
      'authenticated',
      'public.terminalize_unmaterialized_checkout_attempt_v1(uuid,uuid,text)',
      'EXECUTE'
    ),
  'browser roles cannot execute abandonment RPCs'
);

SELECT ok(
  has_function_privilege(
    'service_role',
    'public.admit_checkout_request_v1(uuid,uuid,uuid,text,text)',
    'EXECUTE'
  )
    AND has_function_privilege(
      'service_role',
      'public.resume_checkout_request_v1(uuid,uuid,uuid,text,uuid)',
      'EXECUTE'
    ),
  'service role can execute the Slice 5D protocol functions'
);

SELECT * FROM finish();

ROLLBACK;
