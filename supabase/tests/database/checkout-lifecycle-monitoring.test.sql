BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(48);

ALTER TABLE public.products DISABLE TRIGGER sync_klaviyo_products_after_change;

INSERT INTO public.products (
  id, name, slug, sku, price, inventory_quantity, active, weight_grams
)
VALUES (
  'e1000000-0000-4000-8000-000000000001',
  'Checkout health monitor fixture',
  'checkout-health-monitor-fixture',
  'CHECKOUT-HEALTH-MONITOR',
  10.00,
  10,
  true,
  100
);

ALTER TABLE public.products ENABLE TRIGGER sync_klaviyo_products_after_change;

CREATE FUNCTION pg_temp.reset_checkout_health_fixture(
  p_now timestamp with time zone
)
RETURNS void
LANGUAGE plpgsql
AS $function$
BEGIN
  TRUNCATE
    private.checkout_health_snapshots,
    private.checkout_reconciliation_scheduler_runs,
    public.checkout_reconciliation_jobs,
    public.checkout_lifecycle_incidents,
    public.inventory_reservation_items,
    public.inventory_reservations,
    public.order_items,
    public.orders,
    public.checkout_intent_shipping_options,
    public.checkout_intent_items,
    public.checkout_intents,
    public.checkout_attempts
  CASCADE;

  UPDATE public.products
  SET inventory_quantity = 10
  WHERE id = 'e1000000-0000-4000-8000-000000000001';

  INSERT INTO private.checkout_reconciliation_scheduler_runs (
    scheduler_fired_at,
    scheduler_result,
    net_request_id,
    worker_state,
    worker_result,
    response_received_at,
    worker_completed_at,
    http_status,
    claimed_count,
    expired_empty_attempts_terminalized,
    updated_at
  )
  VALUES (
    p_now - interval '35 seconds',
    'http_queued',
    9000001,
    'succeeded',
    'empty_queue',
    p_now - interval '30 seconds',
    p_now - interval '30 seconds',
    200,
    0,
    0,
    p_now - interval '30 seconds'
  );
END;
$function$;

CREATE FUNCTION pg_temp.make_monitor_attempt(
  p_attempt_id uuid,
  p_status text,
  p_now timestamp with time zone
)
RETURNS void
LANGUAGE plpgsql
AS $function$
BEGIN
  INSERT INTO public.checkout_attempts (
    id,
    capability_hash,
    capability_expires_at,
    status,
    hard_expires_at,
    created_at,
    updated_at,
    completed_at,
    checkout_protocol_version
  )
  VALUES (
    p_attempt_id,
    repeat('a', 64),
    p_now + interval '30 minutes',
    p_status,
    p_now + interval '60 minutes',
    p_now - interval '60 minutes',
    p_now,
    CASE WHEN p_status IN ('paid', 'expired', 'failed') THEN p_now ELSE NULL END,
    'reservation_v1'
  );
END;
$function$;

CREATE FUNCTION pg_temp.make_monitor_intent(
  p_intent_id uuid,
  p_attempt_id uuid,
  p_status text,
  p_orchestration_state text,
  p_session_expires_at timestamp with time zone,
  p_now timestamp with time zone
)
RETURNS void
LANGUAGE plpgsql
AS $function$
BEGIN
  UPDATE public.checkout_attempts
  SET
    admitted_checkout_request_id = p_intent_id,
    admitted_request_expires_at = clock_timestamp() + interval '5 minutes'
  WHERE id = p_attempt_id;

  INSERT INTO public.checkout_intents (
    id,
    payment_intent_id,
    stripe_checkout_session_id,
    status,
    subtotal_amount,
    shipping_amount,
    total_amount,
    currency,
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
    'cs_test_' || replace(p_intent_id::text, '-', ''),
    p_status,
    1000,
    0,
    1000,
    'gbp',
    p_attempt_id,
    p_intent_id,
    repeat('b', 64),
    'reservation_v1',
    p_orchestration_state,
    p_now,
    'https://example.test/checkout',
    p_session_expires_at
  );

  UPDATE public.checkout_attempts
  SET active_checkout_intent_id = p_intent_id
  WHERE id = p_attempt_id;
END;
$function$;

CREATE FUNCTION pg_temp.make_monitor_reservation(
  p_attempt_id uuid,
  p_status text,
  p_quantity integer,
  p_now timestamp with time zone,
  p_order_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
AS $function$
DECLARE
  v_reservation_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.inventory_reservations (
    id,
    checkout_attempt_id,
    status,
    reserved_at,
    expires_at,
    consumed_at,
    order_id,
    updated_at
  )
  VALUES (
    v_reservation_id,
    p_attempt_id,
    p_status,
    p_now - interval '10 minutes',
    p_now + interval '30 minutes',
    CASE WHEN p_status = 'consumed' THEN p_now ELSE NULL END,
    p_order_id,
    p_now
  );

  INSERT INTO public.inventory_reservation_items (
    reservation_id,
    product_id,
    sku_snapshot,
    quantity
  )
  VALUES (
    v_reservation_id,
    'e1000000-0000-4000-8000-000000000001',
    'CHECKOUT-HEALTH-MONITOR',
    p_quantity
  );

  RETURN v_reservation_id;
END;
$function$;

SELECT is(
  (SELECT count(*)::integer FROM cron.job WHERE jobname = 'taa-checkout-health-monitor-v1'),
  1,
  'exactly one named checkout health monitor job exists'
);

SELECT is(
  (SELECT schedule FROM cron.job WHERE jobname = 'taa-checkout-health-monitor-v1'),
  '* * * * *',
  'the checkout health monitor runs every minute'
);

SELECT is(
  (SELECT command FROM cron.job WHERE jobname = 'taa-checkout-health-monitor-v1'),
  'SELECT private.record_checkout_health_snapshot_v1();',
  'cron invokes only the private health snapshot recorder'
);

SELECT ok(
  (SELECT active FROM cron.job WHERE jobname = 'taa-checkout-health-monitor-v1'),
  'the checkout health monitor job is active'
);

SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'private.checkout_health_snapshots'::regclass),
  'the health snapshot table has RLS enabled'
);

SELECT ok(
  NOT has_table_privilege('anon', 'private.checkout_health_snapshots', 'SELECT')
    AND NOT has_table_privilege('authenticated', 'private.checkout_health_snapshots', 'SELECT')
    AND NOT has_table_privilege('service_role', 'private.checkout_health_snapshots', 'SELECT'),
  'browser and service roles cannot read private health snapshots'
);

SELECT ok(
  NOT has_function_privilege(
    'anon',
    'private.evaluate_checkout_health_v1(timestamp with time zone)',
    'EXECUTE'
  )
    AND NOT has_function_privilege(
      'authenticated',
      'private.record_checkout_health_snapshot_v1(timestamp with time zone)',
      'EXECUTE'
    )
    AND NOT has_function_privilege(
      'service_role',
      'private.get_checkout_health_v1(timestamp with time zone)',
      'EXECUTE'
    ),
  'browser and service roles cannot invoke private health controls'
);

SELECT ok(
  (SELECT prosecdef FROM pg_proc WHERE oid = 'private.evaluate_checkout_health_v1(timestamp with time zone)'::regprocedure)
    AND (
      SELECT proconfig @> ARRAY['search_path=""']
      FROM pg_proc
      WHERE oid = 'private.evaluate_checkout_health_v1(timestamp with time zone)'::regprocedure
    ),
  'the evaluator is SECURITY DEFINER with an empty hardened search path'
);

SELECT pg_temp.reset_checkout_health_fixture('2026-08-19T12:00:00Z');

SELECT is(
  (
    SELECT classification
    FROM private.evaluate_checkout_health_v1('2026-08-19T12:00:00Z')
  ),
  'HEALTHY',
  'a clean lifecycle and current reconciler heartbeat evaluate HEALTHY'
);

SELECT is(
  (
    SELECT cardinality(reason_codes)
    FROM private.evaluate_checkout_health_v1('2026-08-19T12:00:00Z')
  ),
  0,
  'the healthy result has no reason codes'
);

SELECT private.record_checkout_health_snapshot_v1('2026-08-19T12:00:10Z');
SELECT private.record_checkout_health_snapshot_v1('2026-08-19T12:00:45Z');

SELECT is(
  (SELECT count(*)::integer FROM private.checkout_health_snapshots),
  1,
  'repeated monitor execution is minute-idempotent'
);

SELECT is(
  (
    SELECT classification
    FROM private.get_checkout_health_v1('2026-08-19T12:02:11Z')
  ),
  'WARNING',
  'a monitor heartbeat older than two minutes is WARNING'
);

SELECT ok(
  (
    SELECT 'monitor_heartbeat_delayed' = ANY(reason_codes)
    FROM private.get_checkout_health_v1('2026-08-19T12:02:11Z')
  ),
  'the delayed monitor reason is explicit'
);

SELECT is(
  (
    SELECT classification
    FROM private.get_checkout_health_v1('2026-08-19T12:05:11Z')
  ),
  'ROLLBACK_REQUIRED',
  'a monitor heartbeat older than five minutes requires rollback'
);

SELECT ok(
  (
    SELECT 'monitor_heartbeat_stale' = ANY(reason_codes)
    FROM private.get_checkout_health_v1('2026-08-19T12:05:11Z')
  ),
  'the stale monitor reason is explicit'
);

SELECT pg_temp.reset_checkout_health_fixture('2026-08-19T12:00:00Z');
SELECT pg_temp.make_monitor_attempt(
  'e2000000-0000-4000-8000-000000000001', 'active', '2026-08-19T12:00:00Z'
);
SELECT pg_temp.make_monitor_reservation(
  'e2000000-0000-4000-8000-000000000001', 'held', 11, '2026-08-19T12:00:00Z'
);

SELECT ok(
  (
    SELECT classification = 'ROLLBACK_REQUIRED'
      AND 'inventory_negative_ats' = ANY(reason_codes)
    FROM private.evaluate_checkout_health_v1('2026-08-19T12:00:00Z')
  ),
  'negative ATS requires rollback immediately'
);

SELECT pg_temp.reset_checkout_health_fixture('2026-08-19T12:00:00Z');
SELECT pg_temp.make_monitor_attempt(
  'e2000000-0000-4000-8000-000000000002', 'active', '2026-08-19T12:00:00Z'
);
INSERT INTO public.inventory_reservations (
  checkout_attempt_id, status, reserved_at, expires_at, updated_at
)
VALUES (
  'e2000000-0000-4000-8000-000000000002',
  'held',
  '2026-08-19T11:50:00Z',
  '2026-08-19T12:30:00Z',
  '2026-08-19T12:00:00Z'
);

SELECT ok(
  (
    SELECT classification = 'ROLLBACK_REQUIRED'
      AND 'reservation_ownership_invalid' = ANY(reason_codes)
    FROM private.evaluate_checkout_health_v1('2026-08-19T12:00:00Z')
  ),
  'an active reservation without authoritative items requires rollback'
);

SELECT pg_temp.reset_checkout_health_fixture('2026-08-19T12:00:00Z');
SELECT pg_temp.make_monitor_attempt(
  'e2000000-0000-4000-8000-000000000003', 'paid', '2026-08-19T12:00:00Z'
);

SELECT ok(
  (
    SELECT classification = 'ROLLBACK_REQUIRED'
      AND 'paid_order_cardinality_invalid' = ANY(reason_codes)
    FROM private.evaluate_checkout_health_v1('2026-08-19T12:00:00Z')
  ),
  'a paid attempt without exactly one order requires rollback'
);

SELECT pg_temp.reset_checkout_health_fixture('2026-08-19T12:00:00Z');
SELECT pg_temp.make_monitor_attempt(
  'e2000000-0000-4000-8000-000000000004', 'paid', '2026-08-19T12:00:00Z'
);
INSERT INTO public.orders (id, email, order_number, total, checkout_attempt_id)
VALUES (
  'e5000000-0000-4000-8000-000000000001',
  'monitor@example.test',
  'TAA-MONITOR-WRONG-ORDER',
  10.00,
  NULL
);
SELECT pg_temp.make_monitor_reservation(
  'e2000000-0000-4000-8000-000000000004',
  'consumed',
  1,
  '2026-08-19T12:00:00Z',
  'e5000000-0000-4000-8000-000000000001'
);

SELECT ok(
  (
    SELECT classification = 'ROLLBACK_REQUIRED'
      AND 'consumed_reservation_order_invalid' = ANY(reason_codes)
    FROM private.evaluate_checkout_health_v1('2026-08-19T12:00:00Z')
  ),
  'a consumed reservation not linked to the attempt order requires rollback'
);

SELECT pg_temp.reset_checkout_health_fixture('2026-08-19T12:00:00Z');
DROP INDEX public.orders_checkout_attempt_id_key;
SELECT pg_temp.make_monitor_attempt(
  'e2000000-0000-4000-8000-000000000005', 'paid', '2026-08-19T12:00:00Z'
);
INSERT INTO public.orders (id, email, order_number, total, checkout_attempt_id)
VALUES
  (
    'e5000000-0000-4000-8000-000000000002',
    'monitor@example.test',
    'TAA-MONITOR-DUPLICATE-1',
    10.00,
    'e2000000-0000-4000-8000-000000000005'
  ),
  (
    'e5000000-0000-4000-8000-000000000003',
    'monitor@example.test',
    'TAA-MONITOR-DUPLICATE-2',
    10.00,
    'e2000000-0000-4000-8000-000000000005'
  );

SELECT ok(
  (
    SELECT classification = 'ROLLBACK_REQUIRED'
      AND 'duplicate_order_finalization' = ANY(reason_codes)
    FROM private.evaluate_checkout_health_v1('2026-08-19T12:00:00Z')
  ),
  'duplicate order finalization requires rollback'
);

SELECT pg_temp.reset_checkout_health_fixture('2026-08-19T12:00:00Z');
SELECT pg_temp.make_monitor_attempt(
  'e2000000-0000-4000-8000-000000000006', 'paid', '2026-08-19T12:00:00Z'
);
SELECT pg_temp.make_monitor_intent(
  'e3000000-0000-4000-8000-000000000001',
  'e2000000-0000-4000-8000-000000000006',
  'paid',
  'paid',
  '2026-08-19T11:50:00Z',
  '2026-08-19T12:00:00Z'
);
INSERT INTO public.checkout_intent_items (
  checkout_intent_id,
  product_type,
  product_id,
  sku,
  name,
  quantity,
  unit_amount,
  line_total
)
VALUES (
  'e3000000-0000-4000-8000-000000000001',
  'product',
  'e1000000-0000-4000-8000-000000000001',
  'CHECKOUT-HEALTH-MONITOR',
  'Checkout health monitor fixture',
  1,
  1000,
  1000
);
INSERT INTO public.orders (
  id,
  email,
  order_number,
  total,
  payment_intent_id,
  checkout_intent_id,
  stripe_checkout_session_id,
  checkout_attempt_id
)
VALUES (
  'e5000000-0000-4000-8000-000000000004',
  'monitor@example.test',
  'TAA-MONITOR-MISMATCH',
  20.00,
  'pi_e3000000000040008000000000000001',
  'e3000000-0000-4000-8000-000000000001',
  'cs_test_e3000000000040008000000000000001',
  'e2000000-0000-4000-8000-000000000006'
);
INSERT INTO public.order_items (
  order_id,
  product_id,
  sku,
  quantity,
  unit_price,
  line_total,
  product_type,
  unit_amount
)
VALUES (
  'e5000000-0000-4000-8000-000000000004',
  'e1000000-0000-4000-8000-000000000001',
  'CHECKOUT-HEALTH-MONITOR',
  2,
  10.00,
  20.00,
  'product',
  1000
);
SELECT pg_temp.make_monitor_reservation(
  'e2000000-0000-4000-8000-000000000006',
  'consumed',
  1,
  '2026-08-19T12:00:00Z',
  'e5000000-0000-4000-8000-000000000004'
);

SELECT ok(
  (
    SELECT classification = 'ROLLBACK_REQUIRED'
      AND 'paid_inventory_mismatch' = ANY(reason_codes)
    FROM private.evaluate_checkout_health_v1('2026-08-19T12:00:00Z')
  ),
  'paid order items inconsistent with consumed inventory require rollback'
);

SELECT pg_temp.reset_checkout_health_fixture('2026-08-19T12:00:00Z');
INSERT INTO public.checkout_lifecycle_incidents (
  incident_key, incident_type, diagnostic_details, status, first_seen_at, last_seen_at
)
VALUES (
  repeat('c', 64),
  'paid_path_conflict',
  '{}'::jsonb,
  'open',
  '2026-08-19T11:59:00Z',
  '2026-08-19T11:59:00Z'
);

SELECT ok(
  (
    SELECT classification = 'ROLLBACK_REQUIRED'
      AND 'paid_or_integrity_incident_open' = ANY(reason_codes)
    FROM private.evaluate_checkout_health_v1('2026-08-19T12:00:00Z')
  ),
  'an unexpected paid lifecycle incident requires rollback'
);

SELECT pg_temp.reset_checkout_health_fixture('2026-08-19T12:00:00Z');
INSERT INTO private.checkout_reconciliation_scheduler_runs (
  scheduler_fired_at,
  scheduler_result,
  net_request_id,
  worker_state,
  worker_result,
  response_received_at,
  http_status,
  updated_at
)
VALUES (
  '2026-08-19T11:59:45Z',
  'http_queued',
  9000002,
  'failed',
  'http_error',
  '2026-08-19T11:59:50Z',
  500,
  '2026-08-19T11:59:50Z'
);

SELECT ok(
  (
    SELECT classification = 'WARNING'
      AND 'reconciliation_worker_failure' = ANY(reason_codes)
    FROM private.evaluate_checkout_health_v1('2026-08-19T12:00:00Z')
  ),
  'one transient reconciliation worker failure is WARNING'
);

INSERT INTO private.checkout_reconciliation_scheduler_runs (
  scheduler_fired_at,
  scheduler_result,
  net_request_id,
  worker_state,
  worker_result,
  response_received_at,
  http_status,
  updated_at
)
VALUES
  (
    '2026-08-19T11:59:46Z', 'http_queued', 9000003, 'failed', 'http_error',
    '2026-08-19T11:59:51Z', 500, '2026-08-19T11:59:51Z'
  ),
  (
    '2026-08-19T11:59:47Z', 'http_queued', 9000004, 'failed', 'http_error',
    '2026-08-19T11:59:52Z', 500, '2026-08-19T11:59:52Z'
  );

SELECT ok(
  (
    SELECT classification = 'ROLLBACK_REQUIRED'
      AND 'reconciliation_worker_failures_persistent' = ANY(reason_codes)
    FROM private.evaluate_checkout_health_v1('2026-08-19T12:00:00Z')
  ),
  'three consecutive reconciliation worker failures require rollback'
);

SELECT pg_temp.reset_checkout_health_fixture('2026-08-19T12:00:00Z');
INSERT INTO private.checkout_reconciliation_scheduler_runs (
  scheduler_fired_at,
  scheduler_result,
  net_request_id,
  worker_state,
  worker_result,
  response_received_at,
  http_status,
  updated_at
)
VALUES (
  '2026-08-19T11:59:45Z',
  'http_queued',
  9000005,
  'failed',
  'http_error',
  '2026-08-19T11:59:50Z',
  401,
  '2026-08-19T11:59:50Z'
);

SELECT ok(
  (
    SELECT classification = 'ROLLBACK_REQUIRED'
      AND 'scheduler_authentication_failure' = ANY(reason_codes)
    FROM private.evaluate_checkout_health_v1('2026-08-19T12:00:00Z')
  ),
  'a scheduler authentication failure requires rollback immediately'
);

SELECT pg_temp.reset_checkout_health_fixture('2026-08-19T12:00:00Z');
UPDATE private.checkout_reconciliation_scheduler_runs
SET
  scheduler_fired_at = '2026-08-19T11:53:00Z',
  response_received_at = '2026-08-19T11:53:05Z',
  worker_completed_at = '2026-08-19T11:53:05Z',
  updated_at = '2026-08-19T11:53:05Z';

SELECT ok(
  (
    SELECT classification = 'ROLLBACK_REQUIRED'
      AND 'worker_heartbeat_stale' = ANY(reason_codes)
    FROM private.evaluate_checkout_health_v1('2026-08-19T12:00:00Z')
  ),
  'a worker heartbeat older than five minutes requires rollback'
);

SELECT pg_temp.reset_checkout_health_fixture('2026-08-19T12:00:00Z');
SELECT pg_temp.make_monitor_attempt(
  'e2000000-0000-4000-8000-000000000007', 'active', '2026-08-19T12:00:00Z'
);
SELECT pg_temp.make_monitor_intent(
  'e3000000-0000-4000-8000-000000000002',
  'e2000000-0000-4000-8000-000000000007',
  'pending',
  'active',
  '2026-08-19T11:57:00Z',
  '2026-08-19T12:00:00Z'
);
SELECT pg_temp.make_monitor_reservation(
  'e2000000-0000-4000-8000-000000000007', 'held', 1, '2026-08-19T12:00:00Z'
);

SELECT ok(
  (
    SELECT classification = 'WARNING'
      AND 'authoritative_reservation_overdue' = ANY(reason_codes)
    FROM private.evaluate_checkout_health_v1('2026-08-19T12:00:00Z')
  ),
  'a Stripe-expired held reservation older than two minutes is WARNING'
);

UPDATE public.checkout_intents
SET stripe_session_expires_at = '2026-08-19T11:54:00Z'
WHERE id = 'e3000000-0000-4000-8000-000000000002';

SELECT ok(
  (
    SELECT classification = 'ROLLBACK_REQUIRED'
      AND 'authoritative_reservation_overdue_stale' = ANY(reason_codes)
    FROM private.evaluate_checkout_health_v1('2026-08-19T12:00:00Z')
  ),
  'a Stripe-expired held reservation older than five minutes requires rollback'
);

UPDATE public.checkout_intents
SET stripe_session_expires_at = '2026-08-19T12:20:00Z'
WHERE id = 'e3000000-0000-4000-8000-000000000002';
UPDATE public.inventory_reservations
SET expires_at = '2026-08-19T11:51:00Z'
WHERE checkout_attempt_id = 'e2000000-0000-4000-8000-000000000007';

SELECT is(
  (
    SELECT classification
    FROM private.evaluate_checkout_health_v1('2026-08-19T12:00:00Z')
  ),
  'HEALTHY',
  'local reservation expiry alone does not misclassify a still-payable Stripe Session'
);

SELECT pg_temp.reset_checkout_health_fixture('2026-08-19T12:00:00Z');
SELECT pg_temp.make_monitor_attempt(
  'e2000000-0000-4000-8000-000000000008', 'active', '2026-08-19T12:00:00Z'
);
INSERT INTO public.checkout_reconciliation_jobs (
  job_key,
  checkout_attempt_id,
  reason,
  status,
  available_at,
  created_at,
  updated_at
)
VALUES (
  repeat('d', 64),
  'e2000000-0000-4000-8000-000000000008',
  'reconciliation_retry',
  'pending',
  '2026-08-19T11:57:00Z',
  '2026-08-19T11:57:00Z',
  '2026-08-19T11:57:00Z'
);

SELECT ok(
  (
    SELECT classification = 'WARNING'
      AND 'reconciliation_backlog_delayed' = ANY(reason_codes)
    FROM private.evaluate_checkout_health_v1('2026-08-19T12:00:00Z')
  ),
  'a due reconciliation retry older than two minutes is WARNING'
);

UPDATE public.checkout_reconciliation_jobs
SET available_at = '2026-08-19T11:54:00Z'
WHERE job_key = repeat('d', 64);

SELECT ok(
  (
    SELECT classification = 'ROLLBACK_REQUIRED'
      AND 'reconciliation_backlog_stale' = ANY(reason_codes)
    FROM private.evaluate_checkout_health_v1('2026-08-19T12:00:00Z')
  ),
  'a due reconciliation retry older than five minutes requires rollback'
);

SELECT pg_temp.reset_checkout_health_fixture('2026-08-19T12:00:00Z');
SELECT pg_temp.make_monitor_attempt(
  'e2000000-0000-4000-8000-000000000009', 'active', '2026-08-19T12:00:00Z'
);
INSERT INTO public.checkout_reconciliation_jobs (
  job_key,
  checkout_attempt_id,
  reason,
  status,
  available_at,
  created_at,
  updated_at
)
VALUES (
  repeat('e', 64),
  'e2000000-0000-4000-8000-000000000009',
  'reconciliation_intent_missing',
  'manual_review',
  '2026-08-19T11:59:00Z',
  '2026-08-19T11:59:00Z',
  '2026-08-19T11:59:00Z'
);

SELECT ok(
  (
    SELECT classification = 'WARNING'
      AND 'unpaid_manual_review_open' = ANY(reason_codes)
    FROM private.evaluate_checkout_health_v1('2026-08-19T12:00:00Z')
  ),
  'a recent unpaid manual-review job is WARNING'
);

UPDATE public.checkout_reconciliation_jobs
SET updated_at = '2026-08-19T11:54:00Z'
WHERE job_key = repeat('e', 64);

SELECT ok(
  (
    SELECT classification = 'ROLLBACK_REQUIRED'
      AND 'unpaid_manual_review_stale' = ANY(reason_codes)
    FROM private.evaluate_checkout_health_v1('2026-08-19T12:00:00Z')
  ),
  'an unpaid manual-review job older than five minutes requires rollback'
);

SELECT pg_temp.reset_checkout_health_fixture('2026-08-19T12:00:00Z');
SELECT pg_temp.make_monitor_attempt(
  'e2000000-0000-4000-8000-000000000010', 'paid', '2026-08-19T12:00:00Z'
);
INSERT INTO public.checkout_reconciliation_jobs (
  job_key,
  checkout_attempt_id,
  reason,
  status,
  available_at,
  created_at,
  updated_at
)
VALUES (
  repeat('f', 64),
  'e2000000-0000-4000-8000-000000000010',
  'paid_manual_review',
  'manual_review',
  '2026-08-19T11:59:50Z',
  '2026-08-19T11:59:50Z',
  '2026-08-19T11:59:50Z'
);

SELECT ok(
  (
    SELECT classification = 'ROLLBACK_REQUIRED'
      AND 'paid_manual_review_open' = ANY(reason_codes)
    FROM private.evaluate_checkout_health_v1('2026-08-19T12:00:00Z')
  ),
  'paid uncertainty in manual review requires rollback immediately'
);

SELECT pg_temp.reset_checkout_health_fixture('2026-08-19T12:00:00Z');
TRUNCATE private.checkout_reconciliation_scheduler_runs;

SELECT ok(
  (
    SELECT classification = 'ROLLBACK_REQUIRED'
      AND 'scheduler_heartbeat_missing' = ANY(reason_codes)
      AND 'worker_heartbeat_missing' = ANY(reason_codes)
    FROM private.evaluate_checkout_health_v1('2026-08-19T12:00:00Z')
  ),
  'missing scheduler and worker heartbeats require rollback'
);

SELECT is(
  (
    SELECT classification
    FROM private.get_checkout_health_v1('2026-08-19T12:00:00Z')
  ),
  'ROLLBACK_REQUIRED',
  'a missing monitor snapshot is independently detectable'
);

SELECT ok(
  (
    SELECT 'monitor_heartbeat_missing' = ANY(reason_codes)
    FROM private.get_checkout_health_v1('2026-08-19T12:00:00Z')
  ),
  'the missing monitor heartbeat reason is explicit'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM private.checkout_health_snapshots
    WHERE metrics ? 'negative_ats_count'
      AND metrics ? 'worker_age_seconds'
  ),
  0,
  'failure fixtures do not persist snapshots unless the recorder is invoked'
);

SELECT ok(
  (SELECT command !~* '(authorization|bearer|secret|token)'
   FROM cron.job
   WHERE jobname = 'taa-checkout-health-monitor-v1'),
  'health monitor cron metadata contains no credential material'
);

SELECT ok(
  NOT has_schema_privilege('anon', 'cron', 'USAGE')
    AND NOT has_schema_privilege('authenticated', 'cron', 'USAGE'),
  'browser roles remain fenced from cron controls'
);

SELECT lives_ok(
  format(
    'SELECT cron.alter_job(%s, active := false)',
    (SELECT jobid FROM cron.job WHERE jobname = 'taa-checkout-health-monitor-v1')
  ),
  'the monitor-only rollback can deactivate the named monitor job'
);

SELECT ok(
  NOT (SELECT active FROM cron.job WHERE jobname = 'taa-checkout-health-monitor-v1'),
  'monitor rollback leaves the monitor job inactive'
);

SELECT lives_ok(
  format(
    'SELECT cron.alter_job(%s, active := true)',
    (SELECT jobid FROM cron.job WHERE jobname = 'taa-checkout-health-monitor-v1')
  ),
  'the monitor can be reactivated after rollback verification'
);

SELECT ok(
  (SELECT active FROM cron.job WHERE jobname = 'taa-checkout-health-monitor-v1'),
  'rollback verification leaves the monitor active'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_proc
    WHERE pronamespace = 'private'::regnamespace
      AND proname LIKE '%checkout_health%'
      AND proacl::text ~ '(anon|authenticated|service_role)=X'
  ),
  'no private checkout health function grants execute to browser or service roles'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM cron.job
    WHERE jobname = 'taa-checkout-reconciliation-v1'
      AND active
  ),
  1,
  'monitoring does not alter the active reconciliation scheduler'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM cron.job
    WHERE jobname = 'taa-checkout-health-monitor-v1'
      AND active
  ),
  1,
  'the focused suite leaves the checkout health monitor active'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM private.checkout_health_snapshots
  ),
  0,
  'the focused suite leaves no persisted fixture snapshot'
);

SELECT * FROM finish();

ROLLBACK;
