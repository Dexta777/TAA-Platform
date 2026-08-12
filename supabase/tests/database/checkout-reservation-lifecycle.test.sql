BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(38);

ALTER TABLE public.products DISABLE TRIGGER sync_klaviyo_products_after_change;

INSERT INTO public.products (id, name, slug, sku, price, inventory_quantity, active)
VALUES
  (
    'a1000000-0000-0000-0000-000000000001',
    'Slice 5C stocked product',
    'slice-5c-stocked-product',
    'SLICE-5C-STOCKED',
    10.00,
    30,
    true
  ),
  (
    'a1000000-0000-0000-0000-000000000002',
    'Slice 5C invariant product',
    'slice-5c-invariant-product',
    'SLICE-5C-INVARIANT',
    10.00,
    0,
    true
  );

ALTER TABLE public.products ENABLE TRIGGER sync_klaviyo_products_after_change;

INSERT INTO public.discount_codes (id, code, discount_type, percent_off_bps, active)
VALUES (
  'a2000000-0000-0000-0000-000000000001',
  'SLICE5C10',
  'percentage',
  1000,
  true
);

CREATE FUNCTION pg_temp.make_checkout(
  p_attempt_id uuid,
  p_intent_id uuid,
  p_session_id text,
  p_product_id uuid DEFAULT 'a1000000-0000-0000-0000-000000000001',
  p_quantity integer DEFAULT 1,
  p_pointer text DEFAULT 'active',
  p_orchestration_state text DEFAULT 'active',
  p_reservation_status text DEFAULT 'held'
)
RETURNS uuid
LANGUAGE plpgsql
AS $function$
DECLARE
  v_reservation_id uuid := gen_random_uuid();
  v_now timestamp with time zone := clock_timestamp();
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
    'slice5c@example.com',
    p_quantity * 1000,
    0,
    p_quantity * 1000,
    'gbp',
    'Test shipping',
    p_attempt_id,
    p_intent_id,
    repeat('b', 64),
    'reservation_v1',
    p_orchestration_state,
    v_now,
    'https://example.com/checkout',
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
  SELECT
    p_intent_id,
    'product',
    products.id,
    products.id,
    products.sku,
    products.name,
    products.name,
    p_quantity,
    1000,
    p_quantity * 1000,
    100,
    0
  FROM public.products
  WHERE products.id = p_product_id;

  UPDATE public.checkout_attempts
  SET
    active_checkout_intent_id = CASE WHEN p_pointer = 'active' THEN p_intent_id END,
    in_flight_checkout_intent_id = CASE WHEN p_pointer = 'in_flight' THEN p_intent_id END
  WHERE id = p_attempt_id;

  INSERT INTO public.inventory_reservations (
    id,
    checkout_attempt_id,
    status,
    reserved_at,
    expires_at,
    released_at,
    release_reason
  )
  VALUES (
    v_reservation_id,
    p_attempt_id,
    p_reservation_status,
    v_now,
    v_now + interval '29 minutes',
    CASE WHEN p_reservation_status = 'released' THEN v_now END,
    CASE WHEN p_reservation_status = 'released' THEN 'test_release' END
  );

  INSERT INTO public.inventory_reservation_items (
    reservation_id,
    product_id,
    sku_snapshot,
    quantity
  )
  SELECT v_reservation_id, products.id, products.sku, p_quantity
  FROM public.products
  WHERE products.id = p_product_id;

  RETURN v_reservation_id;
END;
$function$;

SELECT pg_temp.make_checkout(
  'b1000000-0000-0000-0000-000000000001',
  'b2000000-0000-0000-0000-000000000001',
  'cs_slice5c_finalize'
);

UPDATE public.checkout_intents
SET
  discount_code_id = 'a2000000-0000-0000-0000-000000000001',
  discount_code = 'SLICE5C10',
  discount_amount = 100,
  total_amount = 900
WHERE id = 'b2000000-0000-0000-0000-000000000001';

CREATE TEMP TABLE slice5c_finalization_result AS
SELECT *
FROM public.finalize_paid_checkout(
  'cs_slice5c_finalize',
  'pi_b2000000000000000000000000000001'
);

SELECT is(
  (SELECT finalization_outcome FROM slice5c_finalization_result),
  'finalized',
  'a held reservation finalizes successfully'
);

SELECT is(
  (SELECT inventory_quantity FROM public.products WHERE id = 'a1000000-0000-0000-0000-000000000001'),
  29,
  'reservation-aware finalization decrements physical stock exactly once'
);

SELECT is(
  (
    SELECT checkout_attempt_id
    FROM public.orders
    WHERE id = (SELECT order_id FROM slice5c_finalization_result)
  ),
  'b1000000-0000-0000-0000-000000000001'::uuid,
  'the order records its checkout attempt'
);

SELECT ok(
  (
    SELECT status = 'consumed'
      AND consumed_at IS NOT NULL
      AND order_id = (SELECT order_id FROM slice5c_finalization_result)
    FROM public.inventory_reservations
    WHERE checkout_attempt_id = 'b1000000-0000-0000-0000-000000000001'
  ),
  'the consumed reservation links to the finalized order'
);

SELECT is(
  (
    SELECT count(*)
    FROM public.discount_redemptions
    WHERE checkout_intent_id = 'b2000000-0000-0000-0000-000000000001'
  ),
  1::bigint,
  'discount redemption is created exactly once'
);

CREATE TEMP TABLE slice5c_replay_result AS
SELECT *
FROM public.finalize_paid_checkout(
  'cs_slice5c_finalize',
  'pi_b2000000000000000000000000000001'
);

SELECT ok(
  (SELECT already_finalized FROM slice5c_replay_result)
    AND (SELECT finalization_outcome = 'already_finalized' FROM slice5c_replay_result),
  'an exact finalizer replay returns the existing order'
);

SELECT ok(
  (SELECT inventory_quantity = 29 FROM public.products WHERE id = 'a1000000-0000-0000-0000-000000000001')
    AND (
      SELECT count(*) = 1
      FROM public.orders
      WHERE checkout_attempt_id = 'b1000000-0000-0000-0000-000000000001'
    )
    AND (
      SELECT count(*) = 1
      FROM public.order_items
      WHERE order_id = (SELECT order_id FROM slice5c_finalization_result)
    ),
  'finalizer replay does not decrement or duplicate order records'
);

UPDATE public.order_items
SET quantity = quantity + 1
WHERE order_id = (SELECT order_id FROM slice5c_finalization_result);

CREATE TEMP TABLE slice5c_inconsistent_replay_result AS
SELECT *
FROM public.finalize_paid_checkout(
  'cs_slice5c_finalize',
  'pi_b2000000000000000000000000000001'
);

SELECT is(
  (SELECT finalization_outcome FROM slice5c_inconsistent_replay_result),
  'manual_review_required',
  'an inconsistent existing order is not accepted as an idempotent replay'
);

SELECT is(
  (
    SELECT incident_type
    FROM public.checkout_lifecycle_incidents
    WHERE checkout_intent_id = 'b2000000-0000-0000-0000-000000000001'
  ),
  'finalization_integrity_conflict',
  'an inconsistent existing order is durably recorded for manual review'
);

SELECT pg_temp.make_checkout(
  'b1000000-0000-0000-0000-000000000002',
  'b2000000-0000-0000-0000-000000000002',
  'cs_slice5c_pending'
);

SELECT lives_ok(
  $$SELECT * FROM public.mark_checkout_payment_pending(
    'cs_slice5c_pending',
    'pi_b2000000000000000000000000000002'
  )$$,
  'a current held checkout can become payment pending'
);

SELECT ok(
  (
    SELECT attempts.status = 'payment_pending' AND reservations.status = 'payment_pending'
    FROM public.checkout_attempts AS attempts
    JOIN public.inventory_reservations AS reservations
      ON reservations.checkout_attempt_id = attempts.id
    WHERE attempts.id = 'b1000000-0000-0000-0000-000000000002'
  ),
  'payment pending retains reserved availability'
);

SELECT is(
  (
    SELECT finalization_outcome
    FROM public.finalize_paid_checkout(
      'cs_slice5c_pending',
      'pi_b2000000000000000000000000000002'
    )
  ),
  'finalized',
  'a payment-pending reservation finalizes through the same atomic path'
);

SELECT pg_temp.make_checkout(
  'b1000000-0000-0000-0000-000000000003',
  'b2000000-0000-0000-0000-000000000003',
  'cs_slice5c_missing'
);
DELETE FROM public.inventory_reservations
WHERE checkout_attempt_id = 'b1000000-0000-0000-0000-000000000003';

SELECT is(
  (
    SELECT finalization_outcome
    FROM public.finalize_paid_checkout(
      'cs_slice5c_missing',
      'pi_b2000000000000000000000000000003'
    )
  ),
  'manual_review_required',
  'a paid reservation-v1 checkout with no reservation fails closed'
);

SELECT is(
  (
    SELECT incident_type
    FROM public.checkout_lifecycle_incidents
    WHERE checkout_intent_id = 'b2000000-0000-0000-0000-000000000003'
  ),
  'paid_reservation_missing',
  'the missing paid reservation is durably recorded'
);

SELECT pg_temp.make_checkout(
  'b1000000-0000-0000-0000-000000000004',
  'b2000000-0000-0000-0000-000000000004',
  'cs_slice5c_released',
  'a1000000-0000-0000-0000-000000000001',
  1,
  'active',
  'active',
  'released'
);

SELECT is(
  (
    SELECT finalization_outcome
    FROM public.finalize_paid_checkout(
      'cs_slice5c_released',
      'pi_b2000000000000000000000000000004'
    )
  ),
  'manual_review_required',
  'authoritative payment after reservation release requires manual review'
);

SELECT is(
  (
    SELECT incident_type
    FROM public.checkout_lifecycle_incidents
    WHERE checkout_intent_id = 'b2000000-0000-0000-0000-000000000004'
  ),
  'paid_reservation_released',
  'paid-after-release is persisted as a high-severity incident'
);

SELECT pg_temp.make_checkout(
  'b1000000-0000-0000-0000-000000000005',
  'b2000000-0000-0000-0000-000000000005',
  'cs_slice5c_cart_mismatch'
);
UPDATE public.inventory_reservation_items
SET quantity = 2
WHERE reservation_id = (
  SELECT id FROM public.inventory_reservations
  WHERE checkout_attempt_id = 'b1000000-0000-0000-0000-000000000005'
);

SELECT is(
  (
    SELECT finalization_outcome
    FROM public.finalize_paid_checkout(
      'cs_slice5c_cart_mismatch',
      'pi_b2000000000000000000000000000005'
    )
  ),
  'manual_review_required',
  'a reservation cart mismatch fails closed'
);

SELECT pg_temp.make_checkout(
  'b1000000-0000-0000-0000-000000000006',
  'b2000000-0000-0000-0000-000000000006',
  'cs_slice5c_wrong_path',
  'a1000000-0000-0000-0000-000000000001',
  1,
  'none'
);

SELECT is(
  (
    SELECT finalization_outcome
    FROM public.finalize_paid_checkout(
      'cs_slice5c_wrong_path',
      'pi_b2000000000000000000000000000006'
    )
  ),
  'manual_review_required',
  'a paid intent outside the legitimate current path fails closed'
);

SELECT pg_temp.make_checkout(
  'b1000000-0000-0000-0000-000000000007',
  'b2000000-0000-0000-0000-000000000007',
  'cs_slice5c_stock_invariant',
  'a1000000-0000-0000-0000-000000000002'
);

SELECT is(
  (
    SELECT finalization_outcome
    FROM public.finalize_paid_checkout(
      'cs_slice5c_stock_invariant',
      'pi_b2000000000000000000000000000007'
    )
  ),
  'manual_review_required',
  'physical stock below the reservation produces a manual-review outcome'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM public.orders
    WHERE checkout_attempt_id = 'b1000000-0000-0000-0000-000000000007'
  )
    AND (
      SELECT status = 'held'
      FROM public.inventory_reservations
      WHERE checkout_attempt_id = 'b1000000-0000-0000-0000-000000000007'
    ),
  'inventory invariant failure creates no order and retains the reservation'
);

SELECT pg_temp.make_checkout(
  'b1000000-0000-0000-0000-000000000008',
  'b2000000-0000-0000-0000-000000000008',
  'cs_slice5c_active_expiry'
);
SELECT * FROM public.transition_checkout_session_terminal(
  'cs_slice5c_active_expiry',
  'expired_unpaid'
);

SELECT ok(
  (
    SELECT attempts.status = 'expired'
      AND attempts.active_checkout_intent_id IS NULL
      AND reservations.status = 'released'
    FROM public.checkout_attempts AS attempts
    JOIN public.inventory_reservations AS reservations
      ON reservations.checkout_attempt_id = attempts.id
    WHERE attempts.id = 'b1000000-0000-0000-0000-000000000008'
  ),
  'authoritative expiry releases an active reservation atomically'
);

SELECT pg_temp.make_checkout(
  'b1000000-0000-0000-0000-000000000009',
  'b2000000-0000-0000-0000-000000000009',
  'cs_slice5c_superseded',
  'a1000000-0000-0000-0000-000000000001',
  1,
  'none',
  'superseded'
);
UPDATE public.checkout_intents
SET status = 'expired'
WHERE id = 'b2000000-0000-0000-0000-000000000009';

SELECT is(
  (
    SELECT lifecycle_outcome
    FROM public.transition_checkout_session_terminal(
      'cs_slice5c_superseded',
      'expired_unpaid'
    )
  ),
  'historical_noop',
  'a delayed superseded expiry is a lifecycle no-op'
);

SELECT is(
  (
    SELECT status
    FROM public.inventory_reservations
    WHERE checkout_attempt_id = 'b1000000-0000-0000-0000-000000000009'
  ),
  'held',
  'a delayed superseded expiry does not release shared stock'
);

SELECT pg_temp.make_checkout(
  'b1000000-0000-0000-0000-000000000010',
  'b2000000-0000-0000-0000-000000000010',
  'cs_slice5c_compensated',
  'a1000000-0000-0000-0000-000000000001',
  1,
  'none',
  'compensated'
);
UPDATE public.checkout_intents SET status = 'expired'
WHERE id = 'b2000000-0000-0000-0000-000000000010';

SELECT is(
  (
    SELECT reservation_status
    FROM public.transition_checkout_session_terminal(
      'cs_slice5c_compensated',
      'expired_unpaid'
    )
  ),
  'held',
  'an expired compensated Session has no reservation effect'
);

SELECT pg_temp.make_checkout(
  'b1000000-0000-0000-0000-000000000011',
  'b2000000-0000-0000-0000-000000000011',
  'cs_slice5c_initial_inflight',
  'a1000000-0000-0000-0000-000000000001',
  1,
  'in_flight',
  'session_created'
);
SELECT * FROM public.transition_checkout_session_terminal(
  'cs_slice5c_initial_inflight',
  'expired_unpaid'
);

SELECT ok(
  (
    SELECT attempts.status = 'expired'
      AND attempts.in_flight_checkout_intent_id IS NULL
      AND reservations.status = 'released'
    FROM public.checkout_attempts AS attempts
    JOIN public.inventory_reservations AS reservations
      ON reservations.checkout_attempt_id = attempts.id
    WHERE attempts.id = 'b1000000-0000-0000-0000-000000000011'
  ),
  'an expired initial in-flight Session releases when no payable path remains'
);

-- Replacement B before predecessor invalidation retains active A and the reservation.
SELECT pg_temp.make_checkout(
  'b1000000-0000-0000-0000-000000000012',
  'b2000000-0000-0000-0000-000000000012',
  'cs_slice5c_replacement_a'
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
  checkout_attempt_id,
  checkout_request_id,
  command_fingerprint,
  replaces_checkout_intent_id,
  checkout_protocol_version,
  orchestration_state,
  orchestration_updated_at,
  worker_lease_id,
  worker_lease_expires_at,
  stripe_return_url,
  stripe_session_expires_at
)
SELECT
  'b2000000-0000-0000-0000-000000000112',
  'pi_b2000000000000000000000000000112',
  'cs_slice5c_replacement_b',
  'pending',
  customer_email,
  subtotal_amount,
  shipping_amount,
  total_amount,
  currency,
  checkout_attempt_id,
  'b2000000-0000-0000-0000-000000000112',
  repeat('c', 64),
  id,
  checkout_protocol_version,
  'replacing',
  clock_timestamp(),
  'b3000000-0000-0000-0000-000000000012',
  clock_timestamp() + interval '2 minutes',
  stripe_return_url,
  stripe_session_expires_at
FROM public.checkout_intents
WHERE id = 'b2000000-0000-0000-0000-000000000012';
INSERT INTO public.checkout_intent_items (
  checkout_intent_id, product_type, product_id, base_product_id, sku, name,
  product_name, quantity, unit_amount, line_total, weight_grams, line_position
)
SELECT
  'b2000000-0000-0000-0000-000000000112', product_type, product_id,
  base_product_id, sku, name, product_name, quantity, unit_amount, line_total,
  weight_grams, line_position
FROM public.checkout_intent_items
WHERE checkout_intent_id = 'b2000000-0000-0000-0000-000000000012';
UPDATE public.checkout_attempts
SET in_flight_checkout_intent_id = 'b2000000-0000-0000-0000-000000000112'
WHERE id = 'b1000000-0000-0000-0000-000000000012';

SELECT is(
  (
    SELECT lifecycle_outcome
    FROM public.transition_checkout_session_terminal(
      'cs_slice5c_replacement_b',
      'expired_unpaid'
    )
  ),
  'replacement_compensated',
  'replacement B expiry before predecessor invalidation compensates only B'
);

SELECT ok(
  (
    SELECT attempts.active_checkout_intent_id = 'b2000000-0000-0000-0000-000000000012'
      AND reservations.status = 'held'
    FROM public.checkout_attempts AS attempts
    JOIN public.inventory_reservations AS reservations
      ON reservations.checkout_attempt_id = attempts.id
    WHERE attempts.id = 'b1000000-0000-0000-0000-000000000012'
  ),
  'replacement B compensation preserves active A and its reservation'
);

-- Fresh replacement pair proves the checkpoint and post-checkpoint terminal path.
SELECT pg_temp.make_checkout(
  'b1000000-0000-0000-0000-000000000013',
  'b2000000-0000-0000-0000-000000000013',
  'cs_slice5c_checkpoint_a'
);
INSERT INTO public.checkout_intents (
  id, payment_intent_id, stripe_checkout_session_id, status, customer_email,
  subtotal_amount, shipping_amount, total_amount, currency, checkout_attempt_id,
  checkout_request_id, command_fingerprint, replaces_checkout_intent_id,
  checkout_protocol_version, orchestration_state, orchestration_updated_at,
  worker_lease_id, worker_lease_expires_at, stripe_return_url,
  stripe_session_expires_at
)
SELECT
  'b2000000-0000-0000-0000-000000000113',
  'pi_b2000000000000000000000000000113',
  'cs_slice5c_checkpoint_b',
  'pending', customer_email, subtotal_amount, shipping_amount, total_amount,
  currency, checkout_attempt_id,
  'b2000000-0000-0000-0000-000000000113', repeat('d', 64), id,
  checkout_protocol_version, 'replacing', clock_timestamp(),
  'b3000000-0000-0000-0000-000000000013',
  clock_timestamp() + interval '2 minutes', stripe_return_url,
  stripe_session_expires_at
FROM public.checkout_intents
WHERE id = 'b2000000-0000-0000-0000-000000000013';
INSERT INTO public.checkout_intent_items (
  checkout_intent_id, product_type, product_id, base_product_id, sku, name,
  product_name, quantity, unit_amount, line_total, weight_grams, line_position
)
SELECT
  'b2000000-0000-0000-0000-000000000113', product_type, product_id,
  base_product_id, sku, name, product_name, quantity, unit_amount, line_total,
  weight_grams, line_position
FROM public.checkout_intent_items
WHERE checkout_intent_id = 'b2000000-0000-0000-0000-000000000013';
UPDATE public.checkout_attempts
SET in_flight_checkout_intent_id = 'b2000000-0000-0000-0000-000000000113'
WHERE id = 'b1000000-0000-0000-0000-000000000013';

SELECT lives_ok(
  $$SELECT public.record_checkout_predecessor_invalidated(
    'b2000000-0000-0000-0000-000000000113',
    'b2000000-0000-0000-0000-000000000013',
    'b3000000-0000-0000-0000-000000000013'
  )$$,
  'authoritative predecessor invalidation is checkpointed atomically'
);

SELECT ok(
  (
    SELECT attempts.active_checkout_intent_id IS NULL
      AND replacements.predecessor_invalidated_at IS NOT NULL
      AND predecessors.orchestration_state = 'superseded'
    FROM public.checkout_attempts AS attempts
    JOIN public.checkout_intents AS replacements
      ON replacements.id = attempts.in_flight_checkout_intent_id
    JOIN public.checkout_intents AS predecessors
      ON predecessors.id = replacements.replaces_checkout_intent_id
    WHERE attempts.id = 'b1000000-0000-0000-0000-000000000013'
  ),
  'the checkpoint removes A payment authority while retaining in-flight B'
);

SELECT * FROM public.transition_checkout_session_terminal(
  'cs_slice5c_checkpoint_b',
  'expired_unpaid'
);

SELECT ok(
  (
    SELECT attempts.status = 'expired'
      AND attempts.in_flight_checkout_intent_id IS NULL
      AND reservations.status = 'released'
    FROM public.checkout_attempts AS attempts
    JOIN public.inventory_reservations AS reservations
      ON reservations.checkout_attempt_id = attempts.id
    WHERE attempts.id = 'b1000000-0000-0000-0000-000000000013'
  ),
  'post-checkpoint B expiry releases because no payable path remains'
);

SELECT pg_temp.make_checkout(
  'b1000000-0000-0000-0000-000000000014',
  'b2000000-0000-0000-0000-000000000014',
  'cs_slice5c_async_failure'
);
SELECT * FROM public.mark_checkout_payment_pending(
  'cs_slice5c_async_failure',
  'pi_b2000000000000000000000000000014'
);
SELECT * FROM public.transition_checkout_session_terminal(
  'cs_slice5c_async_failure',
  'async_payment_failed'
);

SELECT ok(
  (
    SELECT attempts.status = 'failed'
      AND reservations.status = 'released'
    FROM public.checkout_attempts AS attempts
    JOIN public.inventory_reservations AS reservations
      ON reservations.checkout_attempt_id = attempts.id
    WHERE attempts.id = 'b1000000-0000-0000-0000-000000000014'
  ),
  'authoritative async payment failure releases payment-pending stock'
);

SELECT is(
  (
    SELECT occurrence_count
    FROM public.checkout_lifecycle_incidents
    WHERE checkout_intent_id = 'b2000000-0000-0000-0000-000000000003'
  ),
  1,
  'a first incident delivery has occurrence count one'
);

SELECT public.record_checkout_lifecycle_incident(
  'paid_reservation_missing',
  'b1000000-0000-0000-0000-000000000003',
  'b2000000-0000-0000-0000-000000000003',
  'cs_slice5c_missing',
  'pi_b2000000000000000000000000000003',
  '{"reason":"attempt_reservation_missing"}'::jsonb
);

SELECT is(
  (
    SELECT occurrence_count
    FROM public.checkout_lifecycle_incidents
    WHERE checkout_intent_id = 'b2000000-0000-0000-0000-000000000003'
  ),
  2,
  'duplicate incident delivery increments the deterministic incident'
);

UPDATE public.inventory_reservations
SET
  reserved_at = clock_timestamp() - interval '2 hours',
  expires_at = clock_timestamp() - interval '1 hour'
WHERE checkout_attempt_id = 'b1000000-0000-0000-0000-000000000009';

CREATE TEMP TABLE slice5c_claimed_jobs AS
SELECT *
FROM public.claim_checkout_reconciliation_jobs(
  'b4000000-0000-0000-0000-000000000001',
  25
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM slice5c_claimed_jobs
    WHERE checkout_attempt_id = 'b1000000-0000-0000-0000-000000000009'
      AND reason = 'overdue_reservation'
  ),
  'the bounded worker claim discovers an overdue held reservation'
);

SELECT lives_ok(
  format(
    $$SELECT public.complete_checkout_reconciliation_job(
      %L::uuid,
      'b4000000-0000-0000-0000-000000000001',
      'retry',
      'stripe_unavailable',
      60
    )$$,
    (
      SELECT job_id
      FROM slice5c_claimed_jobs
      WHERE checkout_attempt_id = 'b1000000-0000-0000-0000-000000000009'
    )
  ),
  'a claimed reconciliation job can retain stock and schedule a bounded retry'
);

SELECT ok(
  NOT has_function_privilege(
    'anon',
    'public.finalize_paid_checkout(text,text,text,text,text,text,integer,integer)',
    'EXECUTE'
  )
    AND NOT has_function_privilege(
      'authenticated',
      'public.transition_checkout_session_terminal(text,text)',
      'EXECUTE'
    ),
  'browser roles cannot execute paid or terminal lifecycle transitions'
);

SELECT ok(
  NOT has_function_privilege(
    'anon',
    'public.record_checkout_lifecycle_incident(text,uuid,uuid,text,text,jsonb)',
    'EXECUTE'
  )
    AND NOT has_function_privilege(
      'authenticated',
      'public.claim_checkout_reconciliation_jobs(uuid,integer)',
      'EXECUTE'
    ),
  'browser roles cannot record incidents or claim reconciliation work'
);

SELECT ok(
  NOT has_table_privilege('anon', 'public.checkout_lifecycle_incidents', 'SELECT')
    AND NOT has_table_privilege(
      'authenticated',
      'public.checkout_reconciliation_jobs',
      'SELECT'
    ),
  'browser roles cannot read lifecycle incidents or reconciliation jobs'
);

SELECT * FROM finish();

ROLLBACK;
