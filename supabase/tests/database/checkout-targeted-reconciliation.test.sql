BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(72);

ALTER TABLE public.products DISABLE TRIGGER sync_klaviyo_products_after_change;

INSERT INTO public.products (id, name, slug, sku, price, inventory_quantity, active)
VALUES (
  'd0000000-0000-4000-8000-000000000001',
  'Targeted reconciliation product',
  'targeted-reconciliation-product',
  'TARGETED-RECONCILIATION',
  25.00,
  20,
  true
);

ALTER TABLE public.products ENABLE TRIGGER sync_klaviyo_products_after_change;

CREATE FUNCTION pg_temp.make_targeted_checkout(
  p_attempt_id uuid,
  p_intent_id uuid,
  p_session_id text
)
RETURNS void
LANGUAGE plpgsql
AS $function$
DECLARE
  v_now timestamp with time zone := clock_timestamp();
  v_reservation_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.checkout_attempts (
    id,
    capability_hash,
    capability_expires_at,
    hard_expires_at
  )
  VALUES (
    p_attempt_id,
    repeat('a', 64),
    v_now + interval '90 minutes',
    v_now + interval '119 minutes'
  );

  INSERT INTO public.checkout_intents (
    id,
    payment_intent_id,
    stripe_checkout_session_id,
    status,
    customer_email,
    subtotal_amount,
    shipping_amount,
    total_amount,
    currency,
    shipping_method_name,
    checkout_attempt_id,
    checkout_request_id,
    command_fingerprint,
    checkout_protocol_version,
    orchestration_state,
    orchestration_updated_at,
    stripe_return_url,
    stripe_session_expires_at
  )
  VALUES (
    p_intent_id,
    'pi_' || replace(p_intent_id::text, '-', ''),
    p_session_id,
    'pending',
    'targeted-reconciliation@example.com',
    2500,
    0,
    2500,
    'gbp',
    'Test shipping',
    p_attempt_id,
    p_intent_id,
    repeat('b', 64),
    'reservation_v1',
    'active',
    v_now,
    'https://example.test/return',
    date_trunc('second', v_now + interval '119 minutes')
  );

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
    weight_grams,
    line_position
  )
  VALUES (
    p_intent_id,
    'product',
    'd0000000-0000-4000-8000-000000000001',
    'd0000000-0000-4000-8000-000000000001',
    'TARGETED-RECONCILIATION',
    'Targeted reconciliation product',
    'Targeted reconciliation product',
    1,
    2500,
    2500,
    100,
    0
  );

  UPDATE public.checkout_attempts
  SET
    checkout_protocol_version = 'reservation_v1',
    active_checkout_intent_id = p_intent_id
  WHERE id = p_attempt_id;

  INSERT INTO public.inventory_reservations (
    id,
    checkout_attempt_id,
    status,
    reserved_at,
    expires_at
  )
  VALUES (
    v_reservation_id,
    p_attempt_id,
    'held',
    v_now,
    v_now + interval '29 minutes'
  );

  INSERT INTO public.inventory_reservation_items (
    reservation_id,
    product_id,
    sku_snapshot,
    quantity
  )
  VALUES (
    v_reservation_id,
    'd0000000-0000-4000-8000-000000000001',
    'TARGETED-RECONCILIATION',
    1
  );
END;
$function$;

SELECT throws_ok(
  $$SELECT * FROM public.claim_checkout_attempt_reconciliation_job_v1(
    NULL,
    'd3000000-0000-4000-8000-000000000001'
  )$$,
  'Checkout attempt ID is required.',
  'an exact reconciliation claim requires an attempt ID'
);

SELECT throws_ok(
  $$SELECT * FROM public.claim_checkout_attempt_reconciliation_job_v1(
    'd1000000-0000-4000-8000-000000000001',
    NULL
  )$$,
  'Reconciliation worker lease ID is required.',
  'an exact reconciliation claim requires a worker lease ID'
);

SELECT is(
  (
    SELECT claim_state
    FROM public.claim_checkout_attempt_reconciliation_job_v1(
      'd1000000-0000-4000-8000-000000000099',
      'd3000000-0000-4000-8000-000000000099'
    )
  ),
  'attempt_not_found',
  'an unknown target returns a safe not-found state'
);

SELECT is(
  (SELECT count(*) FROM public.checkout_reconciliation_jobs),
  0::bigint,
  'an unknown target creates no reconciliation work'
);

INSERT INTO public.checkout_attempts (
  id,
  capability_hash,
  capability_expires_at,
  hard_expires_at
)
VALUES (
  'd1000000-0000-4000-8000-000000000004',
  repeat('c', 64),
  clock_timestamp() + interval '90 minutes',
  clock_timestamp() + interval '119 minutes'
);

SELECT is(
  (
    SELECT claim_state
    FROM public.claim_checkout_attempt_reconciliation_job_v1(
      'd1000000-0000-4000-8000-000000000004',
      'd3000000-0000-4000-8000-000000000004'
    )
  ),
  'not_reservation_v1',
  'a non-reservation attempt is never admitted to operator recovery'
);

INSERT INTO public.checkout_attempts (
  id,
  capability_hash,
  capability_expires_at,
  hard_expires_at,
  checkout_protocol_version
)
VALUES (
  'd1000000-0000-4000-8000-000000000003',
  repeat('d', 64),
  clock_timestamp() + interval '90 minutes',
  clock_timestamp() + interval '119 minutes',
  'reservation_v1'
);

SELECT is(
  (
    SELECT claim_state
    FROM public.claim_checkout_attempt_reconciliation_job_v1(
      'd1000000-0000-4000-8000-000000000003',
      'd3000000-0000-4000-8000-000000000003'
    )
  ),
  'not_materialized',
  'an empty reservation-v1 attempt is not treated as materialized work'
);

SELECT pg_temp.make_targeted_checkout(
  'd1000000-0000-4000-8000-000000000001',
  'd2000000-0000-4000-8000-000000000001',
  'cs_targeted_reconciliation_one'
);
SELECT pg_temp.make_targeted_checkout(
  'd1000000-0000-4000-8000-000000000002',
  'd2000000-0000-4000-8000-000000000002',
  'cs_targeted_reconciliation_unrelated'
);
SELECT pg_temp.make_targeted_checkout(
  'd1000000-0000-4000-8000-000000000007',
  'd2000000-0000-4000-8000-000000000007',
  'cs_targeted_reconciliation_predecessor'
);
SELECT pg_temp.make_targeted_checkout(
  'd1000000-0000-4000-8000-000000000009',
  'd2000000-0000-4000-8000-000000000009',
  'cs_targeted_reconciliation_missing_pointer'
);

UPDATE public.checkout_attempts
SET active_checkout_intent_id = NULL
WHERE id = 'd1000000-0000-4000-8000-000000000009';

SELECT is(
  (
    SELECT claim_state
    FROM public.claim_checkout_attempt_reconciliation_job_v1(
      'd1000000-0000-4000-8000-000000000009',
      'd3000000-0000-4000-8000-000000000009'
    )
  ),
  'integrity_review',
  'held stock without a valid current pointer fails closed as an integrity conflict'
);

SELECT ok(
  (
    SELECT status = 'held'
    FROM public.inventory_reservations
    WHERE checkout_attempt_id = 'd1000000-0000-4000-8000-000000000009'
  )
    AND NOT EXISTS (
      SELECT 1
      FROM public.checkout_reconciliation_jobs
      WHERE checkout_attempt_id = 'd1000000-0000-4000-8000-000000000009'
    ),
  'the inconsistent held reservation remains untouched and creates no work'
);

SELECT pg_temp.make_targeted_checkout(
  'd1000000-0000-4000-8000-000000000015',
  'd2000000-0000-4000-8000-000000000015',
  'cs_targeted_reconciliation_active_paid_cross'
);

UPDATE public.checkout_intents
SET status = 'paid', orchestration_state = 'paid', paid_at = clock_timestamp()
WHERE id = 'd2000000-0000-4000-8000-000000000015';

SELECT is(
  (
    SELECT claim_state
    FROM public.claim_checkout_attempt_reconciliation_job_v1(
      'd1000000-0000-4000-8000-000000000015',
      'd3000000-0000-4000-8000-000000000015'
    )
  ),
  'integrity_review',
  'an active attempt cannot admit a terminal or paid current intent to recovery'
);

SELECT ok(
  (
    SELECT status = 'held'
    FROM public.inventory_reservations
    WHERE checkout_attempt_id = 'd1000000-0000-4000-8000-000000000015'
  )
    AND NOT EXISTS (
      SELECT 1
      FROM public.checkout_reconciliation_jobs
      WHERE checkout_attempt_id = 'd1000000-0000-4000-8000-000000000015'
    ),
  'crossed active/paid state retains stock and creates no work'
);

SELECT pg_temp.make_targeted_checkout(
  'd1000000-0000-4000-8000-000000000016',
  'd2000000-0000-4000-8000-000000000016',
  'cs_targeted_reconciliation_crossed_live_state'
);

UPDATE public.inventory_reservations
SET status = 'payment_pending'
WHERE checkout_attempt_id = 'd1000000-0000-4000-8000-000000000016';

UPDATE public.checkout_attempts
SET status = 'payment_pending'
WHERE id = 'd1000000-0000-4000-8000-000000000016';

UPDATE public.checkout_intents
SET status = 'payment_pending', orchestration_state = 'prepared'
WHERE id = 'd2000000-0000-4000-8000-000000000016';

SELECT is(
  (
    SELECT claim_state
    FROM public.claim_checkout_attempt_reconciliation_job_v1(
      'd1000000-0000-4000-8000-000000000016',
      'd3000000-0000-4000-8000-000000000016'
    )
  ),
  'integrity_review',
  'an impossible payment-pending/prepared intent pair fails closed'
);

SELECT ok(
  (
    SELECT status = 'payment_pending'
    FROM public.inventory_reservations
    WHERE checkout_attempt_id = 'd1000000-0000-4000-8000-000000000016'
  )
    AND NOT EXISTS (
      SELECT 1
      FROM public.checkout_reconciliation_jobs
      WHERE checkout_attempt_id = 'd1000000-0000-4000-8000-000000000016'
    ),
  'crossed live state retains stock and creates no work'
);

SELECT pg_temp.make_targeted_checkout(
  'd1000000-0000-4000-8000-000000000017',
  'd2000000-0000-4000-8000-000000000017',
  'cs_targeted_reconciliation_unpointed_live'
);

UPDATE public.checkout_attempts
SET checkout_protocol_version = NULL
WHERE id = 'd1000000-0000-4000-8000-000000000017';

INSERT INTO public.checkout_intents (
  id,
  payment_intent_id,
  stripe_checkout_session_id,
  status,
  customer_email,
  subtotal_amount,
  shipping_amount,
  total_amount,
  currency,
  shipping_method_name,
  checkout_attempt_id,
  checkout_request_id,
  command_fingerprint,
  checkout_protocol_version,
  orchestration_state,
  orchestration_failure_code,
  orchestration_updated_at,
  stripe_session_params_hash,
  stripe_return_url,
  stripe_session_expires_at
)
SELECT
  'd2000000-0000-4000-8000-000000000117',
  NULL,
  NULL,
  'preparing',
  customer_email,
  subtotal_amount,
  shipping_amount,
  total_amount,
  currency,
  shipping_method_name,
  checkout_attempt_id,
  'd2000000-0000-4000-8000-000000000117',
  repeat('2', 64),
  'reservation_v1',
  'reconciliation_required',
  'test_only_unpointed_live',
  clock_timestamp(),
  repeat('5', 64),
  stripe_return_url,
  stripe_session_expires_at
FROM public.checkout_intents
WHERE id = 'd2000000-0000-4000-8000-000000000017';

UPDATE public.checkout_attempts
SET checkout_protocol_version = 'reservation_v1'
WHERE id = 'd1000000-0000-4000-8000-000000000017';

SELECT is(
  (
    SELECT claim_state
    FROM public.claim_checkout_attempt_reconciliation_job_v1(
      'd1000000-0000-4000-8000-000000000017',
      'd3000000-0000-4000-8000-000000000017'
    )
  ),
  'integrity_review',
  'an unpointed live intent blocks targeted mutation before Stripe work'
);

SELECT ok(
  (
    SELECT status = 'held'
    FROM public.inventory_reservations
    WHERE checkout_attempt_id = 'd1000000-0000-4000-8000-000000000017'
  )
    AND NOT EXISTS (
      SELECT 1
      FROM public.checkout_reconciliation_jobs
      WHERE checkout_attempt_id = 'd1000000-0000-4000-8000-000000000017'
    ),
  'unpointed live-intent conflict retains stock and creates no work'
);

SELECT pg_temp.make_targeted_checkout(
  'd1000000-0000-4000-8000-000000000019',
  'd2000000-0000-4000-8000-000000000019',
  'cs_targeted_reconciliation_active_role_inversion'
);

UPDATE public.checkout_intents
SET status = 'preparing', orchestration_state = 'prepared'
WHERE id = 'd2000000-0000-4000-8000-000000000019';

SELECT is(
  (
    SELECT claim_state
    FROM public.claim_checkout_attempt_reconciliation_job_v1(
      'd1000000-0000-4000-8000-000000000019',
      'd3000000-0000-4000-8000-000000000019'
    )
  ),
  'integrity_review',
  'a preparing intent cannot occupy the active pointer role'
);

SELECT ok(
  (
    SELECT status = 'held'
    FROM public.inventory_reservations
    WHERE checkout_attempt_id = 'd1000000-0000-4000-8000-000000000019'
  )
    AND NOT EXISTS (
      SELECT 1
      FROM public.checkout_reconciliation_jobs
      WHERE checkout_attempt_id = 'd1000000-0000-4000-8000-000000000019'
    ),
  'active-pointer role inversion retains stock and creates no work'
);

SELECT pg_temp.make_targeted_checkout(
  'd1000000-0000-4000-8000-000000000020',
  'd2000000-0000-4000-8000-000000000020',
  'cs_targeted_reconciliation_live_order_conflict'
);

INSERT INTO public.orders (
  id,
  email,
  order_number,
  status,
  total,
  currency,
  checkout_intent_id,
  stripe_checkout_session_id,
  checkout_attempt_id
)
VALUES (
  'd5000000-0000-4000-8000-000000000020',
  'targeted-reconciliation@example.com',
  'TAA-TARGETED-ORDER-CONFLICT',
  'paid',
  25.00,
  'GBP',
  'd2000000-0000-4000-8000-000000000020',
  'cs_targeted_reconciliation_live_order_conflict',
  'd1000000-0000-4000-8000-000000000020'
);

SELECT is(
  (
    SELECT claim_state
    FROM public.claim_checkout_attempt_reconciliation_job_v1(
      'd1000000-0000-4000-8000-000000000020',
      'd3000000-0000-4000-8000-000000000020'
    )
  ),
  'integrity_review',
  'an active attempt with an existing order fails closed before Stripe work'
);

SELECT ok(
  (
    SELECT status = 'held'
    FROM public.inventory_reservations
    WHERE checkout_attempt_id = 'd1000000-0000-4000-8000-000000000020'
  )
    AND NOT EXISTS (
      SELECT 1
      FROM public.checkout_reconciliation_jobs
      WHERE checkout_attempt_id = 'd1000000-0000-4000-8000-000000000020'
    ),
  'live order conflict retains stock and creates no recovery work'
);

UPDATE public.checkout_attempts
SET checkout_protocol_version = NULL
WHERE id = 'd1000000-0000-4000-8000-000000000007';

INSERT INTO public.checkout_intents (
  id,
  payment_intent_id,
  stripe_checkout_session_id,
  status,
  customer_email,
  subtotal_amount,
  shipping_amount,
  total_amount,
  currency,
  shipping_method_name,
  checkout_attempt_id,
  checkout_request_id,
  command_fingerprint,
  replaces_checkout_intent_id,
  checkout_protocol_version,
  orchestration_state,
  orchestration_failure_code,
  orchestration_updated_at,
  stripe_session_params_hash,
  stripe_return_url,
  stripe_session_expires_at
)
SELECT
  'd2000000-0000-4000-8000-000000000107',
  NULL,
  NULL,
  'preparing',
  customer_email,
  subtotal_amount,
  shipping_amount,
  total_amount,
  currency,
  shipping_method_name,
  checkout_attempt_id,
  'd2000000-0000-4000-8000-000000000107',
  repeat('e', 64),
  id,
  'reservation_v1',
  'reconciliation_required',
  'session_create_ambiguous',
  clock_timestamp(),
  repeat('3', 64),
  stripe_return_url,
  stripe_session_expires_at
FROM public.checkout_intents
WHERE id = 'd2000000-0000-4000-8000-000000000007';

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
  weight_grams,
  line_position
)
SELECT
  'd2000000-0000-4000-8000-000000000107',
  product_type,
  product_id,
  base_product_id,
  sku,
  name,
  product_name,
  quantity,
  unit_amount,
  line_total,
  weight_grams,
  line_position
FROM public.checkout_intent_items
WHERE checkout_intent_id = 'd2000000-0000-4000-8000-000000000007';

UPDATE public.checkout_attempts
SET
  checkout_protocol_version = 'reservation_v1',
  in_flight_checkout_intent_id = 'd2000000-0000-4000-8000-000000000107'
WHERE id = 'd1000000-0000-4000-8000-000000000007';

UPDATE public.checkout_intents
SET replaces_checkout_intent_id = 'd2000000-0000-4000-8000-000000000107'
WHERE id = 'd2000000-0000-4000-8000-000000000007';

SELECT is(
  (
    SELECT claim_state
    FROM public.claim_checkout_attempt_reconciliation_job_v1(
      'd1000000-0000-4000-8000-000000000007',
      'd3000000-0000-4000-8000-000000000307'
    )
  ),
  'integrity_review',
  'a circular active/replacement lineage without a completed checkpoint fails closed'
);

SELECT ok(
  (
    SELECT status = 'held'
    FROM public.inventory_reservations
    WHERE checkout_attempt_id = 'd1000000-0000-4000-8000-000000000007'
  )
    AND NOT EXISTS (
      SELECT 1
      FROM public.checkout_reconciliation_jobs
      WHERE checkout_attempt_id = 'd1000000-0000-4000-8000-000000000007'
    ),
  'circular replacement lineage retains stock and creates no work'
);

UPDATE public.checkout_intents
SET replaces_checkout_intent_id = NULL
WHERE id = 'd2000000-0000-4000-8000-000000000007';

UPDATE public.checkout_intents
SET status = 'paid', orchestration_state = 'paid', paid_at = clock_timestamp()
WHERE id = 'd2000000-0000-4000-8000-000000000007';

SELECT is(
  (
    SELECT claim_state
    FROM public.claim_checkout_attempt_reconciliation_job_v1(
      'd1000000-0000-4000-8000-000000000007',
      'd3000000-0000-4000-8000-000000000207'
    )
  ),
  'integrity_review',
  'a crossed paid predecessor blocks two-pointer replacement recovery'
);

SELECT ok(
  (
    SELECT status = 'held'
    FROM public.inventory_reservations
    WHERE checkout_attempt_id = 'd1000000-0000-4000-8000-000000000007'
  )
    AND NOT EXISTS (
      SELECT 1
      FROM public.checkout_reconciliation_jobs
      WHERE checkout_attempt_id = 'd1000000-0000-4000-8000-000000000007'
    ),
  'crossed two-pointer topology retains stock and creates no work'
);

UPDATE public.checkout_intents
SET status = 'pending', orchestration_state = 'active', paid_at = NULL
WHERE id = 'd2000000-0000-4000-8000-000000000007';

CREATE TEMP TABLE replacement_discovery_claim AS
SELECT *
FROM public.claim_checkout_attempt_reconciliation_job_v1(
  'd1000000-0000-4000-8000-000000000007',
  'd3000000-0000-4000-8000-000000000007'
);

SELECT is(
  (SELECT claim_state FROM replacement_discovery_claim),
  'claimed',
  'a materialized replacement with no recorded Session enters authoritative discovery work'
);

SELECT is(
  (SELECT checkout_intent_id FROM replacement_discovery_claim),
  'd2000000-0000-4000-8000-000000000107'::uuid,
  'targeted recovery selects the in-flight replacement ahead of its payable predecessor'
);

SELECT ok(
  public.claim_checkout_lifecycle_work(
    'd2000000-0000-4000-8000-000000000107',
    'd4000000-0000-4000-8000-000000000107'
  ),
  'the no-Session replacement obtains the existing lifecycle fence'
);

SELECT lives_ok(
  $$SELECT public.fail_checkout_request(
    'd2000000-0000-4000-8000-000000000107',
    'd4000000-0000-4000-8000-000000000107',
    'hard_expiry_no_session_proven'
  )$$,
  'a proven pre-checkpoint no-Session replacement uses the existing safe failure transition'
);

SELECT ok(
  (
    SELECT attempts.status = 'active'
      AND attempts.active_checkout_intent_id = 'd2000000-0000-4000-8000-000000000007'
      AND attempts.in_flight_checkout_intent_id IS NULL
      AND replacements.status = 'failed'
      AND replacements.orchestration_state = 'failed'
      AND reservations.status = 'held'
    FROM public.checkout_attempts AS attempts
    JOIN public.checkout_intents AS replacements
      ON replacements.id = 'd2000000-0000-4000-8000-000000000107'
    JOIN public.inventory_reservations AS reservations
      ON reservations.checkout_attempt_id = attempts.id
    WHERE attempts.id = 'd1000000-0000-4000-8000-000000000007'
  ),
  'pre-checkpoint replacement failure preserves predecessor A and its held reservation'
);

SELECT lives_ok(
  format(
    $$SELECT public.complete_checkout_reconciliation_job(
      %L::uuid,
      'd3000000-0000-4000-8000-000000000007',
      'resolved',
      NULL,
      60
    )$$,
    (SELECT job_id FROM replacement_discovery_claim)
  ),
  'the resolved replacement discovery job can be completed normally'
);

CREATE TEMP TABLE predecessor_followup_claim AS
SELECT *
FROM public.claim_checkout_attempt_reconciliation_job_v1(
  'd1000000-0000-4000-8000-000000000007',
  'd3000000-0000-4000-8000-000000000107'
);

SELECT ok(
  (
    SELECT claim_state = 'claimed'
      AND checkout_intent_id = 'd2000000-0000-4000-8000-000000000007'
    FROM predecessor_followup_claim
  ),
  'the next exact iteration advances to predecessor A without creating request C'
);

SELECT pg_temp.make_targeted_checkout(
  'd1000000-0000-4000-8000-000000000008',
  'd2000000-0000-4000-8000-000000000008',
  'cs_targeted_reconciliation_lease_fence'
);

UPDATE public.checkout_attempts
SET checkout_protocol_version = NULL
WHERE id = 'd1000000-0000-4000-8000-000000000008';

INSERT INTO public.checkout_intents (
  id,
  payment_intent_id,
  stripe_checkout_session_id,
  status,
  customer_email,
  subtotal_amount,
  shipping_amount,
  total_amount,
  currency,
  shipping_method_name,
  checkout_attempt_id,
  checkout_request_id,
  command_fingerprint,
  checkout_protocol_version,
  orchestration_state,
  orchestration_updated_at,
  stripe_return_url,
  stripe_session_expires_at
)
SELECT
  'd2000000-0000-4000-8000-000000000108',
  'pi_d2000000000040008000000000000108',
  'cs_targeted_reconciliation_historical_lease',
  'expired',
  customer_email,
  subtotal_amount,
  shipping_amount,
  total_amount,
  currency,
  shipping_method_name,
  checkout_attempt_id,
  'd2000000-0000-4000-8000-000000000108',
  repeat('f', 64),
  'reservation_v1',
  'superseded',
  clock_timestamp(),
  stripe_return_url,
  stripe_session_expires_at
FROM public.checkout_intents
WHERE id = 'd2000000-0000-4000-8000-000000000008';

UPDATE public.checkout_attempts
SET checkout_protocol_version = 'reservation_v1'
WHERE id = 'd1000000-0000-4000-8000-000000000008';

CREATE TEMP TABLE lease_fence_jobs AS
SELECT
  public.enqueue_checkout_reconciliation(
    'd1000000-0000-4000-8000-000000000008',
    'd2000000-0000-4000-8000-000000000008',
    NULL,
    'expired_current_lease_test',
    false
  ) AS expired_current_job_id,
  public.enqueue_checkout_reconciliation(
    'd1000000-0000-4000-8000-000000000008',
    'd2000000-0000-4000-8000-000000000108',
    NULL,
    'live_historical_lease_test',
    false
  ) AS live_historical_job_id;

UPDATE public.checkout_reconciliation_jobs
SET
  status = 'claimed',
  worker_lease_id = 'd3000000-0000-4000-8000-000000000208',
  worker_lease_expires_at = clock_timestamp() - interval '1 minute',
  available_at = clock_timestamp() - interval '2 hours',
  attempt_count = 4,
  created_at = clock_timestamp() - interval '2 hours'
WHERE id = (SELECT expired_current_job_id FROM lease_fence_jobs);

UPDATE public.checkout_reconciliation_jobs
SET
  status = 'claimed',
  worker_lease_id = 'd3000000-0000-4000-8000-000000000308',
  worker_lease_expires_at = clock_timestamp() + interval '1 minute',
  available_at = clock_timestamp() - interval '1 hour',
  attempt_count = 2,
  created_at = clock_timestamp() - interval '1 hour'
WHERE id = (SELECT live_historical_job_id FROM lease_fence_jobs);

CREATE TEMP TABLE lease_fence_checkpoint AS
SELECT id, worker_lease_id, worker_lease_expires_at, attempt_count
FROM public.checkout_reconciliation_jobs
WHERE id IN (
  (SELECT expired_current_job_id FROM lease_fence_jobs),
  (SELECT live_historical_job_id FROM lease_fence_jobs)
);

CREATE TEMP TABLE lease_fence_claim AS
SELECT *
FROM public.claim_checkout_attempt_reconciliation_job_v1(
  'd1000000-0000-4000-8000-000000000008',
  'd3000000-0000-4000-8000-000000000408'
);

SELECT ok(
  (
    SELECT claim_state = 'operation_in_progress'
      AND job_id = (SELECT live_historical_job_id FROM lease_fence_jobs)
    FROM lease_fence_claim
  ),
  'an attempt-wide live lease blocks takeover of an older expired current-intent job'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM public.checkout_reconciliation_jobs AS jobs
    JOIN lease_fence_checkpoint AS checkpoint USING (id)
    WHERE jobs.worker_lease_id IS DISTINCT FROM checkpoint.worker_lease_id
      OR jobs.worker_lease_expires_at IS DISTINCT FROM checkpoint.worker_lease_expires_at
      OR jobs.attempt_count IS DISTINCT FROM checkpoint.attempt_count
  ),
  'the live-lease fence leaves both jobs and attempt counts unchanged'
);

SELECT pg_temp.make_targeted_checkout(
  'd1000000-0000-4000-8000-000000000014',
  'd2000000-0000-4000-8000-000000000014',
  'cs_targeted_reconciliation_due_ordering'
);

CREATE TEMP TABLE pending_order_jobs AS
SELECT
  public.enqueue_checkout_reconciliation(
    'd1000000-0000-4000-8000-000000000014',
    'd2000000-0000-4000-8000-000000000014',
    NULL,
    'future_pending_test',
    false
  ) AS future_job_id,
  public.enqueue_checkout_reconciliation(
    'd1000000-0000-4000-8000-000000000014',
    'd2000000-0000-4000-8000-000000000014',
    NULL,
    'due_pending_test',
    false
  ) AS due_job_id;

UPDATE public.checkout_reconciliation_jobs
SET
  available_at = clock_timestamp() + interval '10 minutes',
  created_at = clock_timestamp() - interval '2 hours'
WHERE id = (SELECT future_job_id FROM pending_order_jobs);

UPDATE public.checkout_reconciliation_jobs
SET
  available_at = clock_timestamp() - interval '1 minute',
  created_at = clock_timestamp() - interval '1 hour'
WHERE id = (SELECT due_job_id FROM pending_order_jobs);

CREATE TEMP TABLE due_pending_claim AS
SELECT *
FROM public.claim_checkout_attempt_reconciliation_job_v1(
  'd1000000-0000-4000-8000-000000000014',
  'd3000000-0000-4000-8000-000000000014'
);

SELECT ok(
  (
    SELECT claim_state = 'claimed'
      AND job_id = (SELECT due_job_id FROM pending_order_jobs)
    FROM due_pending_claim
  ),
  'due exact work is claimed ahead of an older future-backoff job'
);

SELECT ok(
  (
    SELECT status = 'pending'
      AND available_at > clock_timestamp()
      AND attempt_count = 0
    FROM public.checkout_reconciliation_jobs
    WHERE id = (SELECT future_job_id FROM pending_order_jobs)
  ),
  'selecting due work does not pull future backoff forward'
);

SELECT pg_temp.make_targeted_checkout(
  'd1000000-0000-4000-8000-000000000013',
  'd2000000-0000-4000-8000-000000000013',
  'cs_targeted_reconciliation_post_checkpoint_predecessor'
);

UPDATE public.checkout_attempts
SET checkout_protocol_version = NULL
WHERE id = 'd1000000-0000-4000-8000-000000000013';

INSERT INTO public.checkout_intents (
  id,
  payment_intent_id,
  stripe_checkout_session_id,
  status,
  customer_email,
  subtotal_amount,
  shipping_amount,
  total_amount,
  currency,
  shipping_method_name,
  checkout_attempt_id,
  checkout_request_id,
  command_fingerprint,
  replaces_checkout_intent_id,
  checkout_protocol_version,
  predecessor_invalidated_at,
  orchestration_state,
  orchestration_failure_code,
  orchestration_updated_at,
  stripe_session_params_hash,
  stripe_return_url,
  stripe_session_expires_at
)
SELECT
  'd2000000-0000-4000-8000-000000000113',
  NULL,
  NULL,
  'preparing',
  customer_email,
  subtotal_amount,
  shipping_amount,
  total_amount,
  currency,
  shipping_method_name,
  checkout_attempt_id,
  'd2000000-0000-4000-8000-000000000113',
  repeat('1', 64),
  id,
  'reservation_v1',
  clock_timestamp(),
  'reconciliation_required',
  'session_create_ambiguous',
  clock_timestamp(),
  repeat('4', 64),
  stripe_return_url,
  stripe_session_expires_at
FROM public.checkout_intents
WHERE id = 'd2000000-0000-4000-8000-000000000013';

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
  weight_grams,
  line_position
)
SELECT
  'd2000000-0000-4000-8000-000000000113',
  product_type,
  product_id,
  base_product_id,
  sku,
  name,
  product_name,
  quantity,
  unit_amount,
  line_total,
  weight_grams,
  line_position
FROM public.checkout_intent_items
WHERE checkout_intent_id = 'd2000000-0000-4000-8000-000000000013';

UPDATE public.checkout_attempts
SET checkout_protocol_version = 'reservation_v1'
WHERE id = 'd1000000-0000-4000-8000-000000000013';

UPDATE public.checkout_intents
SET status = 'expired', orchestration_state = 'superseded'
WHERE id = 'd2000000-0000-4000-8000-000000000013';

UPDATE public.checkout_attempts
SET
  active_checkout_intent_id = NULL,
  in_flight_checkout_intent_id = 'd2000000-0000-4000-8000-000000000113',
  created_at = clock_timestamp() - interval '119 minutes',
  capability_expires_at = clock_timestamp() - interval '30 minutes',
  hard_expires_at = clock_timestamp() - interval '10 minutes'
WHERE id = 'd1000000-0000-4000-8000-000000000013';

UPDATE public.checkout_intents
SET replaces_checkout_intent_id = id
WHERE id = 'd2000000-0000-4000-8000-000000000113';

SELECT is(
  (
    SELECT claim_state
    FROM public.claim_checkout_attempt_reconciliation_job_v1(
      'd1000000-0000-4000-8000-000000000013',
      'd3000000-0000-4000-8000-000000000213'
    )
  ),
  'integrity_review',
  'a post-checkpoint replacement cannot identify itself as predecessor'
);

SELECT ok(
  (
    SELECT status = 'held'
    FROM public.inventory_reservations
    WHERE checkout_attempt_id = 'd1000000-0000-4000-8000-000000000013'
  )
    AND NOT EXISTS (
      SELECT 1
      FROM public.checkout_reconciliation_jobs
      WHERE checkout_attempt_id = 'd1000000-0000-4000-8000-000000000013'
    ),
  'self-referential replacement lineage retains stock and creates no work'
);

UPDATE public.checkout_intents
SET replaces_checkout_intent_id = 'd2000000-0000-4000-8000-000000000013'
WHERE id = 'd2000000-0000-4000-8000-000000000113';

CREATE TEMP TABLE post_checkpoint_claim AS
SELECT *
FROM public.claim_checkout_attempt_reconciliation_job_v1(
  'd1000000-0000-4000-8000-000000000013',
  'd3000000-0000-4000-8000-000000000013'
);

SELECT ok(
  (
    SELECT claim_state = 'claimed'
      AND checkout_intent_id = 'd2000000-0000-4000-8000-000000000113'
    FROM post_checkpoint_claim
  ),
  'a post-checkpoint no-Session replacement is admitted for authoritative recovery'
);

SELECT ok(
  public.claim_checkout_lifecycle_work(
    'd2000000-0000-4000-8000-000000000113',
    'd4000000-0000-4000-8000-000000000113'
  ),
  'the post-checkpoint replacement obtains the existing lifecycle fence'
);

SELECT lives_ok(
  $$SELECT public.terminalize_checkout_without_session(
    'd2000000-0000-4000-8000-000000000113',
    'd4000000-0000-4000-8000-000000000113',
    'hard_expiry_no_session_proven'
  )$$,
  'a proven post-checkpoint no-Session replacement terminalizes the whole attempt'
);

SELECT ok(
  (
    SELECT attempts.status = 'failed'
      AND attempts.active_checkout_intent_id IS NULL
      AND attempts.in_flight_checkout_intent_id IS NULL
      AND replacements.status = 'failed'
      AND replacements.orchestration_state = 'failed'
      AND reservations.status = 'released'
    FROM public.checkout_attempts AS attempts
    JOIN public.checkout_intents AS replacements
      ON replacements.id = 'd2000000-0000-4000-8000-000000000113'
    JOIN public.inventory_reservations AS reservations
      ON reservations.checkout_attempt_id = attempts.id
    WHERE attempts.id = 'd1000000-0000-4000-8000-000000000013'
  ),
  'post-checkpoint terminalization clears pointers and releases its held reservation once'
);

CREATE TEMP TABLE first_targeted_claim AS
SELECT *
FROM public.claim_checkout_attempt_reconciliation_job_v1(
  'd1000000-0000-4000-8000-000000000001',
  'd3000000-0000-4000-8000-000000000001'
);

SELECT is(
  (SELECT claim_state FROM first_targeted_claim),
  'claimed',
  'an active materialized attempt with held stock is claimed without a browser capability'
);

SELECT ok(
  (
    SELECT checkout_attempt_id = 'd1000000-0000-4000-8000-000000000001'
      AND checkout_intent_id = 'd2000000-0000-4000-8000-000000000001'
      AND reason = 'operator_attempt_recovery'
    FROM first_targeted_claim
  ),
  'the exact job records only the requested attempt and current intent'
);

SELECT is(
  (
    SELECT count(*)
    FROM public.checkout_reconciliation_jobs
    WHERE checkout_attempt_id = 'd1000000-0000-4000-8000-000000000001'
  ),
  1::bigint,
  'exact recovery creates one deterministic durable job'
);

SELECT ok(
  (
    SELECT status = 'active'
      AND active_checkout_intent_id = 'd2000000-0000-4000-8000-000000000002'
    FROM public.checkout_attempts
    WHERE id = 'd1000000-0000-4000-8000-000000000002'
  )
    AND (
      SELECT status = 'held'
      FROM public.inventory_reservations
      WHERE checkout_attempt_id = 'd1000000-0000-4000-8000-000000000002'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.checkout_reconciliation_jobs
      WHERE checkout_attempt_id = 'd1000000-0000-4000-8000-000000000002'
    ),
  'claiming one attempt leaves an unrelated attempt, reservation, and queue untouched'
);

SELECT is(
  (
    SELECT claim_state
    FROM public.claim_checkout_attempt_reconciliation_job_v1(
      'd1000000-0000-4000-8000-000000000001',
      'd3000000-0000-4000-8000-000000000001'
    )
  ),
  'already_claimed',
  'a same-worker replay reuses the existing exact lease'
);

SELECT is(
  (
    SELECT attempt_count
    FROM public.checkout_reconciliation_jobs
    WHERE id = (SELECT job_id FROM first_targeted_claim)
  ),
  1,
  'a same-worker replay does not increment the job attempt count'
);

SELECT is(
  (
    SELECT claim_state
    FROM public.claim_checkout_attempt_reconciliation_job_v1(
      'd1000000-0000-4000-8000-000000000001',
      'd3000000-0000-4000-8000-000000000002'
    )
  ),
  'operation_in_progress',
  'a second worker cannot overlap an active exact lease'
);

SELECT lives_ok(
  format(
    $$SELECT public.complete_checkout_reconciliation_job(
      %L::uuid,
      'd3000000-0000-4000-8000-000000000001',
      'retry',
      'stripe_unavailable',
      60
    )$$,
    (SELECT job_id FROM first_targeted_claim)
  ),
  'a transient operator recovery failure schedules the existing bounded retry'
);

CREATE TEMP TABLE retry_checkpoint AS
SELECT available_at
FROM public.checkout_reconciliation_jobs
WHERE id = (SELECT job_id FROM first_targeted_claim);

SELECT is(
  (
    SELECT claim_state
    FROM public.claim_checkout_attempt_reconciliation_job_v1(
      'd1000000-0000-4000-8000-000000000001',
      'd3000000-0000-4000-8000-000000000003'
    )
  ),
  'retry_not_due',
  'an early operator retry respects the durable retry delay'
);

SELECT is(
  (
    SELECT available_at
    FROM public.checkout_reconciliation_jobs
    WHERE id = (SELECT job_id FROM first_targeted_claim)
  ),
  (SELECT available_at FROM retry_checkpoint),
  'an early operator retry does not pull the job availability forward'
);

UPDATE public.checkout_reconciliation_jobs
SET available_at = clock_timestamp() - interval '1 second'
WHERE id = (SELECT job_id FROM first_targeted_claim);

CREATE TEMP TABLE reclaimed_targeted_job AS
SELECT *
FROM public.claim_checkout_attempt_reconciliation_job_v1(
  'd1000000-0000-4000-8000-000000000001',
  'd3000000-0000-4000-8000-000000000003'
);

SELECT ok(
  (SELECT claim_state = 'claimed' AND attempt_count = 2 FROM reclaimed_targeted_job),
  'a due retry reclaims the same job and increments its count once'
);

SELECT lives_ok(
  format(
    $$SELECT * FROM public.transition_checkout_session_terminal(
      'cs_targeted_reconciliation_one',
      'expired_unpaid'
    );
    SELECT public.complete_checkout_reconciliation_job(
      %L::uuid,
      'd3000000-0000-4000-8000-000000000003',
      'resolved',
      NULL,
      60
    )$$,
    (SELECT job_id FROM reclaimed_targeted_job)
  ),
  'authoritative terminalization and exact job completion succeed together'
);

SELECT ok(
  (
    SELECT attempts.status = 'expired'
      AND attempts.active_checkout_intent_id IS NULL
      AND attempts.in_flight_checkout_intent_id IS NULL
      AND intents.status = 'expired'
      AND intents.orchestration_state = 'failed'
      AND reservations.status = 'released'
    FROM public.checkout_attempts AS attempts
    JOIN public.checkout_intents AS intents
      ON intents.checkout_attempt_id = attempts.id
    JOIN public.inventory_reservations AS reservations
      ON reservations.checkout_attempt_id = attempts.id
    WHERE attempts.id = 'd1000000-0000-4000-8000-000000000001'
  ),
  'attempt, intent, and reservation reach one internally consistent terminal state'
);

SELECT is(
  (
    SELECT claim_state
    FROM public.claim_checkout_attempt_reconciliation_job_v1(
      'd1000000-0000-4000-8000-000000000001',
      'd3000000-0000-4000-8000-000000000004'
    )
  ),
  'already_terminal',
  'a repeated exact recovery call is an idempotent terminal no-op'
);

CREATE TEMP TABLE release_checkpoint AS
SELECT released_at
FROM public.inventory_reservations
WHERE checkout_attempt_id = 'd1000000-0000-4000-8000-000000000001';

SELECT is(
  (
    SELECT lifecycle_outcome
    FROM public.transition_checkout_session_terminal(
      'cs_targeted_reconciliation_one',
      'expired_unpaid'
    )
  ),
  'historical_noop',
  'a repeated terminal transition does not release inventory again'
);

SELECT is(
  (
    SELECT released_at
    FROM public.inventory_reservations
    WHERE checkout_attempt_id = 'd1000000-0000-4000-8000-000000000001'
  ),
  (SELECT released_at FROM release_checkpoint),
  'reservation release is applied exactly once'
);

SELECT ok(
  (
    SELECT status = 'resolved' AND attempt_count = 2
    FROM public.checkout_reconciliation_jobs
    WHERE id = (SELECT job_id FROM first_targeted_claim)
  ),
  'terminal replay does not reopen a resolved recovery job'
);

SELECT public.record_checkout_lifecycle_incident(
  'paid_reservation_released',
  'd1000000-0000-4000-8000-000000000001',
  'd2000000-0000-4000-8000-000000000001',
  'cs_targeted_reconciliation_one',
  NULL,
  '{"reason":"test_only"}'::jsonb
);

SELECT is(
  (
    SELECT claim_state
    FROM public.claim_checkout_attempt_reconciliation_job_v1(
      'd1000000-0000-4000-8000-000000000001',
      'd3000000-0000-4000-8000-000000000104'
    )
  ),
  'manual_review_required',
  'a terminal-looking attempt never masks unresolved manual-review work'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM public.checkout_reconciliation_jobs
    WHERE checkout_attempt_id = 'd1000000-0000-4000-8000-000000000001'
      AND status = 'manual_review'
      AND lifecycle_incident_id IS NOT NULL
  ),
  'the terminal incident remains in manual review'
);

SELECT pg_temp.make_targeted_checkout(
  'd1000000-0000-4000-8000-000000000005',
  'd2000000-0000-4000-8000-000000000005',
  'cs_targeted_reconciliation_manual'
);

CREATE TEMP TABLE manual_targeted_claim AS
SELECT *
FROM public.claim_checkout_attempt_reconciliation_job_v1(
  'd1000000-0000-4000-8000-000000000005',
  'd3000000-0000-4000-8000-000000000005'
);

SELECT public.complete_checkout_reconciliation_job(
  (SELECT job_id FROM manual_targeted_claim),
  'd3000000-0000-4000-8000-000000000005',
  'manual_review',
  'identity_conflict',
  60
);

SELECT is(
  (
    SELECT claim_state
    FROM public.claim_checkout_attempt_reconciliation_job_v1(
      'd1000000-0000-4000-8000-000000000005',
      'd3000000-0000-4000-8000-000000000006'
    )
  ),
  'manual_review_required',
  'manual-review work is never downgraded to an ordinary retry'
);

SELECT ok(
  (
    SELECT status = 'manual_review'
      AND worker_lease_id IS NULL
      AND worker_lease_expires_at IS NULL
    FROM public.checkout_reconciliation_jobs
    WHERE id = (SELECT job_id FROM manual_targeted_claim)
  ),
  'manual-review queue state remains fail closed'
);

SELECT pg_temp.make_targeted_checkout(
  'd1000000-0000-4000-8000-000000000006',
  'd2000000-0000-4000-8000-000000000006',
  'cs_targeted_reconciliation_paid'
);

SELECT is(
  (
    SELECT finalization_outcome
    FROM public.finalize_paid_checkout(
      'cs_targeted_reconciliation_paid',
      'pi_d2000000000040008000000000000006'
    )
  ),
  'finalized',
  'the existing paid path consumes a targeted reservation atomically'
);

SELECT is(
  (
    SELECT claim_state
    FROM public.claim_checkout_attempt_reconciliation_job_v1(
      'd1000000-0000-4000-8000-000000000006',
      'd3000000-0000-4000-8000-000000000006'
    )
  ),
  'already_paid',
  'a paid attempt is preserved and never admitted to abandonment work'
);

SELECT is(
  (
    SELECT count(*)
    FROM public.checkout_reconciliation_jobs
    WHERE checkout_attempt_id = 'd1000000-0000-4000-8000-000000000006'
  ),
  0::bigint,
  'paid preservation creates no operator recovery job'
);

SELECT public.record_checkout_lifecycle_incident(
  'paid_path_conflict',
  'd1000000-0000-4000-8000-000000000006',
  'd2000000-0000-4000-8000-000000000006',
  'cs_targeted_reconciliation_paid',
  'pi_d2000000000040008000000000000006',
  '{"reason":"test_only"}'::jsonb
);

SELECT is(
  (
    SELECT claim_state
    FROM public.claim_checkout_attempt_reconciliation_job_v1(
      'd1000000-0000-4000-8000-000000000006',
      'd3000000-0000-4000-8000-000000000106'
    )
  ),
  'manual_review_required',
  'a paid-looking attempt never masks unresolved manual-review work'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM public.checkout_reconciliation_jobs
    WHERE checkout_attempt_id = 'd1000000-0000-4000-8000-000000000006'
      AND status = 'manual_review'
      AND lifecycle_incident_id IS NOT NULL
  ),
  'the paid incident remains in manual review'
);

SELECT pg_temp.make_targeted_checkout(
  'd1000000-0000-4000-8000-000000000010',
  'd2000000-0000-4000-8000-000000000010',
  'cs_targeted_reconciliation_crossed_terminal'
);

SELECT *
FROM public.transition_checkout_session_terminal(
  'cs_targeted_reconciliation_crossed_terminal',
  'expired_unpaid'
);

UPDATE public.checkout_intents
SET status = 'paid', orchestration_state = 'paid', paid_at = clock_timestamp()
WHERE id = 'd2000000-0000-4000-8000-000000000010';

SELECT is(
  (
    SELECT claim_state
    FROM public.claim_checkout_attempt_reconciliation_job_v1(
      'd1000000-0000-4000-8000-000000000010',
      'd3000000-0000-4000-8000-000000000010'
    )
  ),
  'integrity_review',
  'expired and released state with a paid intent fails closed'
);

SELECT is(
  (
    SELECT count(*)
    FROM public.checkout_reconciliation_jobs
    WHERE checkout_attempt_id = 'd1000000-0000-4000-8000-000000000010'
  ),
  0::bigint,
  'crossed terminal/paid state creates no operator recovery job'
);

SELECT pg_temp.make_targeted_checkout(
  'd1000000-0000-4000-8000-000000000011',
  'd2000000-0000-4000-8000-000000000011',
  'cs_targeted_reconciliation_crossed_paid'
);

SELECT *
FROM public.finalize_paid_checkout(
  'cs_targeted_reconciliation_crossed_paid',
  'pi_d2000000000040008000000000000011'
);

UPDATE public.checkout_intents
SET status = 'failed', orchestration_state = 'failed'
WHERE id = 'd2000000-0000-4000-8000-000000000011';

SELECT is(
  (
    SELECT claim_state
    FROM public.claim_checkout_attempt_reconciliation_job_v1(
      'd1000000-0000-4000-8000-000000000011',
      'd3000000-0000-4000-8000-000000000011'
    )
  ),
  'integrity_review',
  'paid and consumed state without a coherent paid intent fails closed'
);

SELECT is(
  (
    SELECT count(*)
    FROM public.checkout_reconciliation_jobs
    WHERE checkout_attempt_id = 'd1000000-0000-4000-8000-000000000011'
  ),
  0::bigint,
  'crossed paid/terminal state creates no operator recovery job'
);

SELECT ok(
  NOT has_function_privilege(
    'anon',
    'public.claim_checkout_attempt_reconciliation_job_v1(uuid,uuid)',
    'EXECUTE'
  )
    AND NOT has_function_privilege(
      'authenticated',
      'public.claim_checkout_attempt_reconciliation_job_v1(uuid,uuid)',
      'EXECUTE'
    )
    AND has_function_privilege(
      'service_role',
      'public.claim_checkout_attempt_reconciliation_job_v1(uuid,uuid)',
      'EXECUTE'
    ),
  'only service_role can claim exact operator recovery work'
);

SELECT ok(
  pg_get_functiondef(
    'public.claim_checkout_attempt_reconciliation_job_v1(uuid,uuid)'::regprocedure
  ) !~ 'claim_checkout_reconciliation_jobs'
    AND pg_get_functiondef(
      'public.claim_checkout_attempt_reconciliation_job_v1(uuid,uuid)'::regprocedure
    ) !~ 'terminalize_expired_empty_checkout_attempts_v1',
  'the exact claimant contains no global queue scan or empty-attempt sweep'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM public.checkout_reconciliation_jobs
    WHERE checkout_attempt_id = 'd1000000-0000-4000-8000-000000000002'
      AND status = 'claimed'
  ),
  'no unrelated queue job receives an operator worker lease'
);

SELECT * FROM finish();

ROLLBACK;
