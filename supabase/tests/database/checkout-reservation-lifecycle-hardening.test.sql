BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(20);

ALTER TABLE public.products DISABLE TRIGGER sync_klaviyo_products_after_change;

INSERT INTO public.products (id, name, slug, sku, price, inventory_quantity, active)
VALUES (
  'd0000000-0000-4000-8000-000000000001',
  'Slice 5C.1 product',
  'slice-5c-1-product',
  'SLICE-5C-1',
  10.00,
  20,
  true
);

ALTER TABLE public.products ENABLE TRIGGER sync_klaviyo_products_after_change;

CREATE FUNCTION pg_temp.make_replacement_pair(
  p_attempt_id uuid,
  p_active_id uuid,
  p_replacement_id uuid,
  p_active_session_id text,
  p_replacement_session_id text,
  p_valid_replacement boolean DEFAULT true
)
RETURNS void
LANGUAGE plpgsql
AS $function$
DECLARE
  v_now timestamp with time zone := clock_timestamp();
  v_reservation_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.checkout_attempts (
    id, capability_hash, capability_expires_at, hard_expires_at
  ) VALUES (
    p_attempt_id, repeat('a', 64), v_now + interval '90 minutes',
    v_now + interval '119 minutes'
  );

  INSERT INTO public.checkout_intents (
    id, payment_intent_id, stripe_checkout_session_id, status, customer_email,
    subtotal_amount, shipping_amount, total_amount, currency,
    shipping_method_name, checkout_attempt_id, checkout_request_id,
    command_fingerprint, checkout_protocol_version, orchestration_state,
    orchestration_updated_at, confirmation_token_hash,
    confirmation_token_expires_at, stripe_return_url, stripe_session_expires_at
  ) VALUES (
    p_active_id, 'pi_' || replace(p_active_id::text, '-', ''), p_active_session_id,
    'pending', 'slice5c1@example.com', 1000, 0, 1000, 'gbp', 'Test shipping',
    p_attempt_id, p_active_id, repeat('b', 64), 'reservation_v1', 'active', v_now,
    repeat('c', 64), v_now + interval '30 minutes', 'https://example.com/checkout',
    date_trunc('second', v_now + interval '119 minutes')
  );

  INSERT INTO public.checkout_intents (
    id, payment_intent_id, stripe_checkout_session_id, status, customer_email,
    subtotal_amount, shipping_amount, total_amount, currency,
    shipping_method_name, checkout_attempt_id, checkout_request_id,
    command_fingerprint, replaces_checkout_intent_id, checkout_protocol_version,
    orchestration_state, orchestration_updated_at, worker_lease_id,
    worker_lease_expires_at, stripe_return_url, stripe_session_expires_at
  ) VALUES (
    p_replacement_id, 'pi_' || replace(p_replacement_id::text, '-', ''),
    p_replacement_session_id, 'pending', 'slice5c1@example.com', 1000, 0, 1000,
    'gbp', 'Test shipping', p_attempt_id, p_replacement_id, repeat('d', 64),
    CASE WHEN p_valid_replacement THEN p_active_id END, 'reservation_v1',
    'replacing', v_now, 'd3000000-0000-4000-8000-000000000001',
    v_now + interval '2 minutes', 'https://example.com/checkout',
    date_trunc('second', v_now + interval '119 minutes')
  );

  INSERT INTO public.checkout_intent_items (
    checkout_intent_id, product_type, product_id, base_product_id, sku, name,
    product_name, quantity, unit_amount, line_total, weight_grams, line_position
  )
  SELECT
    intents.id, 'product', products.id, products.id, products.sku, products.name,
    products.name, 1, 1000, 1000, 100, 0
  FROM public.checkout_intents AS intents
  CROSS JOIN public.products
  WHERE intents.id IN (p_active_id, p_replacement_id)
    AND products.id = 'd0000000-0000-4000-8000-000000000001';

  UPDATE public.checkout_attempts
  SET
    active_checkout_intent_id = p_active_id,
    in_flight_checkout_intent_id = p_replacement_id
  WHERE id = p_attempt_id;

  INSERT INTO public.inventory_reservations (
    id, checkout_attempt_id, status, reserved_at, expires_at
  ) VALUES (
    v_reservation_id, p_attempt_id, 'held', v_now, v_now + interval '29 minutes'
  );

  INSERT INTO public.inventory_reservation_items (
    reservation_id, product_id, sku_snapshot, quantity
  ) VALUES (
    v_reservation_id, 'd0000000-0000-4000-8000-000000000001', 'SLICE-5C-1', 1
  );
END;
$function$;

SELECT pg_temp.make_replacement_pair(
  'd1000000-0000-4000-8000-000000000001',
  'd2000000-0000-4000-8000-000000000001',
  'd2000000-0000-4000-8000-000000000101',
  'cs_slice5c1_expiring_a',
  'cs_slice5c1_replacement_b'
);

SELECT is(
  (
    SELECT lifecycle_outcome
    FROM public.transition_checkout_session_terminal(
      'cs_slice5c1_expiring_a',
      'expired_unpaid'
    )
  ),
  'predecessor_invalidated',
  'authoritative A expiry checkpoints a legitimate in-flight B'
);

SELECT ok(
  (
    SELECT reservations.status = 'held'
      AND attempts.status = 'active'
      AND attempts.active_checkout_intent_id IS NULL
      AND attempts.in_flight_checkout_intent_id = 'd2000000-0000-4000-8000-000000000101'
    FROM public.checkout_attempts AS attempts
    JOIN public.inventory_reservations AS reservations
      ON reservations.checkout_attempt_id = attempts.id
    WHERE attempts.id = 'd1000000-0000-4000-8000-000000000001'
  ),
  'A expiry retains the attempt and reservation beneath B'
);

SELECT ok(
  (
    SELECT predecessors.status = 'expired'
      AND predecessors.orchestration_state = 'superseded'
      AND predecessors.confirmation_token_hash IS NULL
      AND replacements.predecessor_invalidated_at IS NOT NULL
    FROM public.checkout_intents AS predecessors
    JOIN public.checkout_intents AS replacements
      ON replacements.replaces_checkout_intent_id = predecessors.id
    WHERE predecessors.id = 'd2000000-0000-4000-8000-000000000001'
  ),
  'A is superseded and B records predecessor invalidation atomically'
);

SELECT lives_ok(
  $$SELECT public.record_checkout_predecessor_invalidated(
    'd2000000-0000-4000-8000-000000000101',
    'd2000000-0000-4000-8000-000000000001',
    'd3000000-0000-4000-8000-000000000001'
  )$$,
  'the original create-checkout worker sees an exact checkpoint replay'
);

SELECT is(
  (
    SELECT status
    FROM public.inventory_reservations
    WHERE checkout_attempt_id = 'd1000000-0000-4000-8000-000000000001'
  ),
  'held',
  'checkpoint replay leaves the shared reservation held'
);

SELECT pg_temp.make_replacement_pair(
  'd1000000-0000-4000-8000-000000000002',
  'd2000000-0000-4000-8000-000000000002',
  'd2000000-0000-4000-8000-000000000102',
  'cs_slice5c1_failed_a',
  'cs_slice5c1_after_failed_a'
);

SELECT is(
  (
    SELECT lifecycle_outcome
    FROM public.transition_checkout_session_terminal(
      'cs_slice5c1_failed_a',
      'async_payment_failed'
    )
  ),
  'predecessor_invalidated',
  'authoritative async failure of A also preserves legitimate B'
);

SELECT ok(
  (
    SELECT predecessors.status = 'failed'
      AND predecessors.orchestration_state = 'superseded'
      AND replacements.predecessor_invalidated_at IS NOT NULL
      AND reservations.status = 'held'
    FROM public.checkout_intents AS predecessors
    JOIN public.checkout_intents AS replacements
      ON replacements.replaces_checkout_intent_id = predecessors.id
    JOIN public.inventory_reservations AS reservations
      ON reservations.checkout_attempt_id = predecessors.checkout_attempt_id
    WHERE predecessors.id = 'd2000000-0000-4000-8000-000000000002'
  ),
  'async failure records terminal A without releasing B stock'
);

SELECT pg_temp.make_replacement_pair(
  'd1000000-0000-4000-8000-000000000003',
  'd2000000-0000-4000-8000-000000000003',
  'd2000000-0000-4000-8000-000000000103',
  'cs_slice5c1_invalid_a',
  'cs_slice5c1_invalid_b',
  false
);

SELECT is(
  (
    SELECT lifecycle_outcome
    FROM public.transition_checkout_session_terminal(
      'cs_slice5c1_invalid_a',
      'expired_unpaid'
    )
  ),
  'reconciliation_required',
  'an unrelated in-flight pointer fails closed'
);

SELECT ok(
  (
    SELECT reservations.status = 'held'
      AND attempts.active_checkout_intent_id = 'd2000000-0000-4000-8000-000000000003'
      AND attempts.in_flight_checkout_intent_id = 'd2000000-0000-4000-8000-000000000103'
    FROM public.checkout_attempts AS attempts
    JOIN public.inventory_reservations AS reservations
      ON reservations.checkout_attempt_id = attempts.id
    WHERE attempts.id = 'd1000000-0000-4000-8000-000000000003'
  ),
  'an invalid in-flight relationship never releases the reservation'
);

SELECT pg_temp.make_replacement_pair(
  'd1000000-0000-4000-8000-000000000004',
  'd2000000-0000-4000-8000-000000000004',
  'd2000000-0000-4000-8000-000000000104',
  'cs_slice5c1_paid_a',
  'cs_slice5c1_blocking_b'
);

CREATE TEMP TABLE slice5c1_blocked_finalization AS
SELECT *
FROM public.finalize_paid_checkout(
  'cs_slice5c1_paid_a',
  'pi_d2000000000040008000000000000004'
);

SELECT is(
  (SELECT finalization_outcome FROM slice5c1_blocked_finalization),
  'manual_review_required',
  'paid A cannot directly finalize while B remains unresolved'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM public.orders
    WHERE checkout_attempt_id = 'd1000000-0000-4000-8000-000000000004'
  )
    AND (
      SELECT status = 'held'
      FROM public.inventory_reservations
      WHERE checkout_attempt_id = 'd1000000-0000-4000-8000-000000000004'
    )
    AND (
      SELECT inventory_quantity = 20
      FROM public.products
      WHERE id = 'd0000000-0000-4000-8000-000000000001'
    ),
  'the finalizer guard creates no order, consumption, or stock decrement'
);

SELECT is(
  (
    SELECT incident_type
    FROM public.checkout_lifecycle_incidents
    WHERE checkout_intent_id = 'd2000000-0000-4000-8000-000000000004'
  ),
  'paid_path_conflict',
  'the blocked paid path is durably owned by reconciliation'
);

SELECT is(
  (
    SELECT lifecycle_outcome
    FROM public.transition_checkout_session_terminal(
      'cs_slice5c1_blocking_b',
      'expired_unpaid'
    )
  ),
  'replacement_compensated',
  'authoritatively expired B is compensated without releasing A stock'
);

SELECT is(
  (
    SELECT finalization_outcome
    FROM public.finalize_paid_checkout(
      'cs_slice5c1_paid_a',
      'pi_d2000000000040008000000000000004'
    )
  ),
  'finalized',
  'paid A finalizes after B is safely cleared'
);

SELECT ok(
  (
    SELECT reservations.status = 'consumed'
      AND reservations.order_id = orders.id
    FROM public.inventory_reservations AS reservations
    JOIN public.orders AS orders
      ON orders.checkout_attempt_id = reservations.checkout_attempt_id
    WHERE reservations.checkout_attempt_id = 'd1000000-0000-4000-8000-000000000004'
  )
    AND (
      SELECT count(*) = 1
      FROM public.orders
      WHERE checkout_attempt_id = 'd1000000-0000-4000-8000-000000000004'
    )
    AND (
      SELECT inventory_quantity = 19
      FROM public.products
      WHERE id = 'd0000000-0000-4000-8000-000000000001'
    ),
  'resolved A finalization consumes and decrements exactly once'
);

SELECT public.enqueue_checkout_reconciliation(
  'd1000000-0000-4000-8000-000000000004',
  'd2000000-0000-4000-8000-000000000004',
  NULL,
  'lease_test_one',
  false
);
SELECT public.enqueue_checkout_reconciliation(
  'd1000000-0000-4000-8000-000000000004',
  'd2000000-0000-4000-8000-000000000004',
  NULL,
  'lease_test_two',
  false
);

CREATE TEMP TABLE slice5c1_claimed_jobs AS
SELECT *
FROM public.claim_checkout_reconciliation_jobs(
  'd4000000-0000-4000-8000-000000000001',
  25
);

SELECT is(
  (
    SELECT count(*)
    FROM slice5c1_claimed_jobs
    WHERE checkout_intent_id = 'd2000000-0000-4000-8000-000000000004'
      AND reason IN ('lease_test_one', 'lease_test_two')
  ),
  2::bigint,
  'two differently keyed jobs for one intent can share one queue batch'
);

SELECT ok(
  'd5000000-0000-4000-8000-000000000001'::uuid
    <> 'd5000000-0000-4000-8000-000000000002'::uuid,
  'the jobs use distinct lifecycle lease identifiers'
);

SELECT ok(
  public.claim_checkout_lifecycle_work(
    'd2000000-0000-4000-8000-000000000004',
    'd5000000-0000-4000-8000-000000000001'
  ),
  'the first job acquires lifecycle fencing authority'
);

SELECT ok(
  NOT public.claim_checkout_lifecycle_work(
    'd2000000-0000-4000-8000-000000000004',
    'd5000000-0000-4000-8000-000000000002'
  ),
  'the second same-intent job cannot share lifecycle authority'
);

SELECT ok(
  NOT has_function_privilege(
    'anon',
    'public.transition_checkout_session_terminal(text,text)',
    'EXECUTE'
  )
    AND NOT has_function_privilege(
      'authenticated',
      'public.finalize_paid_checkout(text,text,text,text,text,text,integer,integer)',
      'EXECUTE'
    ),
  'Slice 5C.1 preserves browser privilege isolation'
);

SELECT * FROM finish();

ROLLBACK;
