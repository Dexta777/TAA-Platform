-- Evaluate reservation-v1 lifecycle integrity independently from checkout and
-- reconciliation execution. Monitoring records non-sensitive snapshots only;
-- it never repairs lifecycle state or changes feature flags.

CREATE TABLE private.checkout_health_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_minute timestamp with time zone NOT NULL UNIQUE,
  evaluated_at timestamp with time zone NOT NULL,
  classification text NOT NULL,
  reason_codes text[] NOT NULL DEFAULT ARRAY[]::text[],
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT checkout_health_snapshots_minute_check
    CHECK (snapshot_minute = date_trunc('minute', evaluated_at)),
  CONSTRAINT checkout_health_snapshots_classification_check
    CHECK (classification IN ('HEALTHY', 'WARNING', 'ROLLBACK_REQUIRED')),
  CONSTRAINT checkout_health_snapshots_reason_shape_check
    CHECK (
      (classification = 'HEALTHY' AND cardinality(reason_codes) = 0)
      OR (classification <> 'HEALTHY' AND cardinality(reason_codes) > 0)
    ),
  CONSTRAINT checkout_health_snapshots_metrics_check
    CHECK (jsonb_typeof(metrics) = 'object')
);

ALTER TABLE private.checkout_health_snapshots ENABLE ROW LEVEL SECURITY;

CREATE INDEX checkout_health_snapshots_evaluated_idx
  ON private.checkout_health_snapshots (evaluated_at DESC);

REVOKE ALL ON TABLE private.checkout_health_snapshots
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION private.evaluate_checkout_health_v1(
  p_now timestamp with time zone DEFAULT clock_timestamp()
)
RETURNS TABLE (
  classification text,
  reason_codes text[],
  metrics jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_warning_reasons text[] := ARRAY[]::text[];
  v_rollback_reasons text[] := ARRAY[]::text[];
  v_negative_ats_count integer := 0;
  v_reservation_ownership_invalid_count integer := 0;
  v_paid_order_invalid_count integer := 0;
  v_duplicate_order_count integer := 0;
  v_consumed_reservation_invalid_count integer := 0;
  v_paid_inventory_mismatch_count integer := 0;
  v_paid_release_path_count integer := 0;
  v_paid_lifecycle_invalid_count integer := 0;
  v_severe_incident_count integer := 0;
  v_discovery_incident_count integer := 0;
  v_oldest_discovery_incident_age_seconds numeric;
  v_scheduler_fired_at timestamp with time zone;
  v_scheduler_result text;
  v_scheduler_age_seconds numeric;
  v_worker_completed_at timestamp with time zone;
  v_worker_age_seconds numeric;
  v_latest_terminal_worker_state text;
  v_latest_terminal_http_status integer;
  v_consecutive_worker_failures integer := 0;
  v_pending_scheduler_age_seconds numeric;
  v_due_job_count integer := 0;
  v_due_job_age_seconds numeric;
  v_manual_review_count integer := 0;
  v_paid_manual_review_count integer := 0;
  v_unpaid_manual_review_age_seconds numeric;
  v_authoritative_overdue_count integer := 0;
  v_authoritative_overdue_age_seconds numeric;
BEGIN
  IF p_now IS NULL THEN
    RAISE EXCEPTION 'Checkout health evaluation time is required.';
  END IF;

  WITH reserved_products AS (
    SELECT
      items.product_id,
      sum(items.quantity)::bigint AS reserved_quantity
    FROM public.inventory_reservation_items AS items
    JOIN public.inventory_reservations AS reservations
      ON reservations.id = items.reservation_id
    WHERE items.product_id IS NOT NULL
      AND reservations.status IN ('held', 'payment_pending')
    GROUP BY items.product_id
  ),
  reserved_variants AS (
    SELECT
      items.product_variant_id,
      sum(items.quantity)::bigint AS reserved_quantity
    FROM public.inventory_reservation_items AS items
    JOIN public.inventory_reservations AS reservations
      ON reservations.id = items.reservation_id
    WHERE items.product_variant_id IS NOT NULL
      AND reservations.status IN ('held', 'payment_pending')
    GROUP BY items.product_variant_id
  ),
  inventory_positions AS (
    SELECT
      products.inventory_quantity::bigint AS physical_quantity,
      COALESCE(reserved_products.reserved_quantity, 0) AS reserved_quantity
    FROM public.products
    LEFT JOIN reserved_products ON reserved_products.product_id = products.id
    UNION ALL
    SELECT
      variants.inventory_quantity::bigint,
      COALESCE(reserved_variants.reserved_quantity, 0)
    FROM public.product_variants AS variants
    LEFT JOIN reserved_variants ON reserved_variants.product_variant_id = variants.id
  )
  SELECT count(*)::integer
  INTO v_negative_ats_count
  FROM inventory_positions
  WHERE physical_quantity - reserved_quantity < 0;

  SELECT count(*)::integer
  INTO v_reservation_ownership_invalid_count
  FROM (
    SELECT reservations.id
    FROM public.inventory_reservations AS reservations
    JOIN public.checkout_attempts AS attempts
      ON attempts.id = reservations.checkout_attempt_id
    WHERE reservations.status IN ('held', 'payment_pending')
      AND (
        attempts.status NOT IN ('active', 'payment_pending')
        OR NOT EXISTS (
          SELECT 1
          FROM public.inventory_reservation_items AS items
          WHERE items.reservation_id = reservations.id
        )
      )
    UNION ALL
    SELECT min(reservations.id::text)::uuid
    FROM public.inventory_reservations AS reservations
    GROUP BY reservations.checkout_attempt_id
    HAVING count(*) > 1
    UNION ALL
    SELECT min(items.id::text)::uuid
    FROM public.inventory_reservation_items AS items
    GROUP BY items.reservation_id, items.product_id
    HAVING items.product_id IS NOT NULL AND count(*) > 1
    UNION ALL
    SELECT min(items.id::text)::uuid
    FROM public.inventory_reservation_items AS items
    GROUP BY items.reservation_id, items.product_variant_id
    HAVING items.product_variant_id IS NOT NULL AND count(*) > 1
  ) AS invalid_ownership;

  SELECT count(*)::integer
  INTO v_paid_order_invalid_count
  FROM public.checkout_attempts AS attempts
  WHERE attempts.checkout_protocol_version = 'reservation_v1'
    AND attempts.status = 'paid'
    AND (
      SELECT count(*)
      FROM public.orders
      WHERE orders.checkout_attempt_id = attempts.id
    ) <> 1;

  SELECT count(*)::integer
  INTO v_duplicate_order_count
  FROM (
    SELECT orders.checkout_attempt_id
    FROM public.orders
    JOIN public.checkout_attempts AS attempts
      ON attempts.id = orders.checkout_attempt_id
    WHERE attempts.checkout_protocol_version = 'reservation_v1'
    GROUP BY orders.checkout_attempt_id
    HAVING count(*) > 1
  ) AS duplicate_orders;

  SELECT count(*)::integer
  INTO v_consumed_reservation_invalid_count
  FROM public.inventory_reservations AS reservations
  JOIN public.checkout_attempts AS attempts
    ON attempts.id = reservations.checkout_attempt_id
  WHERE reservations.status = 'consumed'
    AND (
      attempts.status <> 'paid'
      OR (
        SELECT count(*)
        FROM public.orders
        WHERE orders.checkout_attempt_id = attempts.id
      ) <> 1
      OR NOT EXISTS (
        SELECT 1
        FROM public.orders
        WHERE orders.id = reservations.order_id
          AND orders.checkout_attempt_id = attempts.id
      )
    );

  SELECT count(*)::integer
  INTO v_paid_inventory_mismatch_count
  FROM public.checkout_attempts AS attempts
  JOIN public.inventory_reservations AS reservations
    ON reservations.checkout_attempt_id = attempts.id
  JOIN public.orders
    ON orders.checkout_attempt_id = attempts.id
  JOIN public.checkout_intents AS intents
    ON intents.id = orders.checkout_intent_id
  WHERE attempts.checkout_protocol_version = 'reservation_v1'
    AND attempts.status = 'paid'
    AND reservations.status = 'consumed'
    AND reservations.order_id = orders.id
    AND (
      NOT public.checkout_reservation_cart_matches(intents.id, reservations.id)
      OR EXISTS (
        (
          SELECT
            items.sku,
            items.product_type,
            items.unit_amount,
            sum(items.quantity)::bigint,
            sum(items.line_total)::bigint
          FROM public.checkout_intent_items AS items
          WHERE items.checkout_intent_id = intents.id
          GROUP BY items.sku, items.product_type, items.unit_amount
        )
        EXCEPT
        (
          SELECT
            items.sku,
            items.product_type,
            items.unit_amount,
            sum(items.quantity)::bigint,
            sum(round(items.line_total * 100))::bigint
          FROM public.order_items AS items
          WHERE items.order_id = orders.id
          GROUP BY items.sku, items.product_type, items.unit_amount
        )
      )
      OR EXISTS (
        (
          SELECT
            items.sku,
            items.product_type,
            items.unit_amount,
            sum(items.quantity)::bigint,
            sum(round(items.line_total * 100))::bigint
          FROM public.order_items AS items
          WHERE items.order_id = orders.id
          GROUP BY items.sku, items.product_type, items.unit_amount
        )
        EXCEPT
        (
          SELECT
            items.sku,
            items.product_type,
            items.unit_amount,
            sum(items.quantity)::bigint,
            sum(items.line_total)::bigint
          FROM public.checkout_intent_items AS items
          WHERE items.checkout_intent_id = intents.id
          GROUP BY items.sku, items.product_type, items.unit_amount
        )
      )
    );

  SELECT count(*)::integer
  INTO v_paid_release_path_count
  FROM public.inventory_reservations AS reservations
  JOIN public.checkout_attempts AS attempts
    ON attempts.id = reservations.checkout_attempt_id
  WHERE reservations.status = 'released'
    AND (
      attempts.status = 'paid'
      OR EXISTS (
        SELECT 1
        FROM public.checkout_intents AS intents
        WHERE intents.checkout_attempt_id = attempts.id
          AND (intents.status = 'paid' OR intents.orchestration_state = 'paid')
      )
    );

  SELECT count(*)::integer
  INTO v_paid_lifecycle_invalid_count
  FROM public.checkout_intents AS intents
  JOIN public.checkout_attempts AS attempts
    ON attempts.id = intents.checkout_attempt_id
  WHERE intents.checkout_protocol_version = 'reservation_v1'
    AND (intents.status = 'paid' OR intents.orchestration_state = 'paid')
    AND (
      attempts.status <> 'paid'
      OR NOT EXISTS (
        SELECT 1
        FROM public.orders
        WHERE orders.checkout_attempt_id = attempts.id
          AND orders.checkout_intent_id = intents.id
      )
    );

  SELECT count(*)::integer
  INTO v_severe_incident_count
  FROM public.checkout_lifecycle_incidents AS incidents
  WHERE incidents.status = 'open'
    AND incidents.incident_type <> 'stripe_session_discovery_failed';

  SELECT
    count(*)::integer,
    extract(epoch FROM p_now - min(incidents.first_seen_at))
  INTO v_discovery_incident_count, v_oldest_discovery_incident_age_seconds
  FROM public.checkout_lifecycle_incidents AS incidents
  WHERE incidents.status = 'open'
    AND incidents.incident_type = 'stripe_session_discovery_failed';

  SELECT runs.scheduler_fired_at, runs.scheduler_result
  INTO v_scheduler_fired_at, v_scheduler_result
  FROM private.checkout_reconciliation_scheduler_runs AS runs
  ORDER BY runs.scheduler_fired_at DESC
  LIMIT 1;

  IF v_scheduler_fired_at IS NOT NULL THEN
    v_scheduler_age_seconds := extract(epoch FROM p_now - v_scheduler_fired_at);
  END IF;

  SELECT max(runs.worker_completed_at)
  INTO v_worker_completed_at
  FROM private.checkout_reconciliation_scheduler_runs AS runs
  WHERE runs.worker_state = 'succeeded';

  IF v_worker_completed_at IS NOT NULL THEN
    v_worker_age_seconds := extract(epoch FROM p_now - v_worker_completed_at);
  END IF;

  SELECT runs.worker_state, runs.http_status
  INTO v_latest_terminal_worker_state, v_latest_terminal_http_status
  FROM private.checkout_reconciliation_scheduler_runs AS runs
  WHERE runs.worker_state IN ('succeeded', 'failed')
  ORDER BY COALESCE(runs.response_received_at, runs.scheduler_fired_at) DESC
  LIMIT 1;

  IF v_latest_terminal_worker_state = 'failed' THEN
    SELECT count(*)::integer
    INTO v_consecutive_worker_failures
    FROM private.checkout_reconciliation_scheduler_runs AS runs
    WHERE runs.worker_state = 'failed'
      AND COALESCE(runs.response_received_at, runs.scheduler_fired_at) > COALESCE(
        (
          SELECT max(successes.worker_completed_at)
          FROM private.checkout_reconciliation_scheduler_runs AS successes
          WHERE successes.worker_state = 'succeeded'
        ),
        '-infinity'::timestamp with time zone
      );
  END IF;

  SELECT extract(epoch FROM p_now - min(runs.scheduler_fired_at))
  INTO v_pending_scheduler_age_seconds
  FROM private.checkout_reconciliation_scheduler_runs AS runs
  WHERE runs.worker_state = 'pending';

  SELECT
    count(*)::integer,
    extract(epoch FROM p_now - min(
      CASE
        WHEN jobs.status = 'pending' THEN jobs.available_at
        ELSE jobs.worker_lease_expires_at
      END
    ))
  INTO v_due_job_count, v_due_job_age_seconds
  FROM public.checkout_reconciliation_jobs AS jobs
  WHERE (jobs.status = 'pending' AND jobs.available_at <= p_now)
     OR (
       jobs.status = 'claimed'
       AND jobs.worker_lease_expires_at <= p_now
     );

  SELECT
    count(*)::integer,
    count(*) FILTER (
      WHERE COALESCE(attempts.status = 'paid', false)
        OR COALESCE(intents.status = 'paid', false)
        OR COALESCE(intents.orchestration_state = 'paid', false)
        OR (
          incidents.id IS NOT NULL
          AND incidents.incident_type <> 'stripe_session_discovery_failed'
        )
    )::integer,
    extract(epoch FROM p_now - min(jobs.updated_at) FILTER (
      WHERE NOT (
        COALESCE(attempts.status = 'paid', false)
        OR COALESCE(intents.status = 'paid', false)
        OR COALESCE(intents.orchestration_state = 'paid', false)
        OR (
          incidents.id IS NOT NULL
          AND incidents.incident_type <> 'stripe_session_discovery_failed'
        )
      )
    ))
  INTO v_manual_review_count, v_paid_manual_review_count, v_unpaid_manual_review_age_seconds
  FROM public.checkout_reconciliation_jobs AS jobs
  LEFT JOIN public.checkout_attempts AS attempts
    ON attempts.id = jobs.checkout_attempt_id
  LEFT JOIN public.checkout_intents AS intents
    ON intents.id = jobs.checkout_intent_id
  LEFT JOIN public.checkout_lifecycle_incidents AS incidents
    ON incidents.id = jobs.lifecycle_incident_id
  WHERE jobs.status = 'manual_review';

  SELECT
    count(*)::integer,
    extract(epoch FROM p_now - min(intents.stripe_session_expires_at))
  INTO v_authoritative_overdue_count, v_authoritative_overdue_age_seconds
  FROM public.inventory_reservations AS reservations
  JOIN public.checkout_attempts AS attempts
    ON attempts.id = reservations.checkout_attempt_id
  JOIN public.checkout_intents AS intents
    ON intents.id = COALESCE(
      attempts.in_flight_checkout_intent_id,
      attempts.active_checkout_intent_id
    )
  WHERE reservations.status = 'held'
    AND attempts.status = 'active'
    AND intents.stripe_checkout_session_id IS NOT NULL
    AND intents.stripe_session_expires_at IS NOT NULL
    AND intents.stripe_session_expires_at <= p_now
    AND intents.orchestration_state IN (
      'session_created',
      'replacing',
      'active',
      'reconciliation_required'
    );

  IF v_negative_ats_count > 0 THEN
    v_rollback_reasons := array_append(v_rollback_reasons, 'inventory_negative_ats');
  END IF;
  IF v_reservation_ownership_invalid_count > 0 THEN
    v_rollback_reasons := array_append(v_rollback_reasons, 'reservation_ownership_invalid');
  END IF;
  IF v_paid_order_invalid_count > 0 THEN
    v_rollback_reasons := array_append(v_rollback_reasons, 'paid_order_cardinality_invalid');
  END IF;
  IF v_duplicate_order_count > 0 THEN
    v_rollback_reasons := array_append(v_rollback_reasons, 'duplicate_order_finalization');
  END IF;
  IF v_consumed_reservation_invalid_count > 0 THEN
    v_rollback_reasons := array_append(v_rollback_reasons, 'consumed_reservation_order_invalid');
  END IF;
  IF v_paid_inventory_mismatch_count > 0 THEN
    v_rollback_reasons := array_append(v_rollback_reasons, 'paid_inventory_mismatch');
  END IF;
  IF v_paid_release_path_count > 0 THEN
    v_rollback_reasons := array_append(v_rollback_reasons, 'paid_state_released_as_unpaid');
  END IF;
  IF v_paid_lifecycle_invalid_count > 0 THEN
    v_rollback_reasons := array_append(v_rollback_reasons, 'paid_lifecycle_invalid');
  END IF;
  IF v_severe_incident_count > 0 THEN
    v_rollback_reasons := array_append(v_rollback_reasons, 'paid_or_integrity_incident_open');
  END IF;

  IF v_discovery_incident_count > 0 THEN
    IF COALESCE(v_oldest_discovery_incident_age_seconds, 0) > 300 THEN
      v_rollback_reasons := array_append(v_rollback_reasons, 'stripe_discovery_incident_stale');
    ELSE
      v_warning_reasons := array_append(v_warning_reasons, 'stripe_discovery_incident_open');
    END IF;
  END IF;

  IF v_scheduler_fired_at IS NULL THEN
    v_rollback_reasons := array_append(v_rollback_reasons, 'scheduler_heartbeat_missing');
  ELSIF v_scheduler_age_seconds > 300 THEN
    v_rollback_reasons := array_append(v_rollback_reasons, 'scheduler_heartbeat_stale');
  ELSIF v_scheduler_age_seconds > 120 THEN
    v_warning_reasons := array_append(v_warning_reasons, 'scheduler_heartbeat_delayed');
  END IF;

  IF v_worker_completed_at IS NULL THEN
    v_rollback_reasons := array_append(v_rollback_reasons, 'worker_heartbeat_missing');
  ELSIF v_worker_age_seconds > 300 THEN
    v_rollback_reasons := array_append(v_rollback_reasons, 'worker_heartbeat_stale');
  ELSIF v_worker_age_seconds > 120 THEN
    v_warning_reasons := array_append(v_warning_reasons, 'worker_heartbeat_delayed');
  END IF;

  IF v_scheduler_result IN ('vault_configuration_missing', 'vault_configuration_invalid') THEN
    v_rollback_reasons := array_append(v_rollback_reasons, 'scheduler_configuration_failure');
  ELSIF v_scheduler_result IN ('http_queue_failed', 'scheduler_lock_busy') THEN
    v_warning_reasons := array_append(v_warning_reasons, 'scheduler_invocation_warning');
  END IF;

  IF v_latest_terminal_worker_state = 'failed'
    AND v_latest_terminal_http_status IN (401, 403) THEN
    v_rollback_reasons := array_append(v_rollback_reasons, 'scheduler_authentication_failure');
  ELSIF v_latest_terminal_worker_state = 'failed' THEN
    IF v_consecutive_worker_failures >= 3 THEN
      v_rollback_reasons := array_append(v_rollback_reasons, 'reconciliation_worker_failures_persistent');
    ELSE
      v_warning_reasons := array_append(v_warning_reasons, 'reconciliation_worker_failure');
    END IF;
  END IF;

  IF v_pending_scheduler_age_seconds > 300 THEN
    v_rollback_reasons := array_append(v_rollback_reasons, 'scheduler_request_in_flight_stale');
  ELSIF v_pending_scheduler_age_seconds > 120 THEN
    v_warning_reasons := array_append(v_warning_reasons, 'scheduler_request_in_flight_delayed');
  END IF;

  IF v_due_job_count > 25 OR v_due_job_age_seconds > 300 THEN
    v_rollback_reasons := array_append(v_rollback_reasons, 'reconciliation_backlog_stale');
  ELSIF v_due_job_age_seconds > 120 THEN
    v_warning_reasons := array_append(v_warning_reasons, 'reconciliation_backlog_delayed');
  END IF;

  IF v_paid_manual_review_count > 0 THEN
    v_rollback_reasons := array_append(v_rollback_reasons, 'paid_manual_review_open');
  END IF;
  IF v_manual_review_count - v_paid_manual_review_count > 0 THEN
    IF COALESCE(v_unpaid_manual_review_age_seconds, 0) > 300 THEN
      v_rollback_reasons := array_append(v_rollback_reasons, 'unpaid_manual_review_stale');
    ELSE
      v_warning_reasons := array_append(v_warning_reasons, 'unpaid_manual_review_open');
    END IF;
  END IF;

  IF v_authoritative_overdue_count > 0 THEN
    IF COALESCE(v_authoritative_overdue_age_seconds, 0) > 300 THEN
      v_rollback_reasons := array_append(v_rollback_reasons, 'authoritative_reservation_overdue_stale');
    ELSIF COALESCE(v_authoritative_overdue_age_seconds, 0) > 120 THEN
      v_warning_reasons := array_append(v_warning_reasons, 'authoritative_reservation_overdue');
    END IF;
  END IF;

  SELECT COALESCE(array_agg(DISTINCT reason ORDER BY reason), ARRAY[]::text[])
  INTO v_warning_reasons
  FROM unnest(v_warning_reasons) AS reason;

  SELECT COALESCE(array_agg(DISTINCT reason ORDER BY reason), ARRAY[]::text[])
  INTO v_rollback_reasons
  FROM unnest(v_rollback_reasons) AS reason;

  classification := CASE
    WHEN cardinality(v_rollback_reasons) > 0 THEN 'ROLLBACK_REQUIRED'
    WHEN cardinality(v_warning_reasons) > 0 THEN 'WARNING'
    ELSE 'HEALTHY'
  END;
  reason_codes := ARRAY(
    SELECT DISTINCT reason
    FROM unnest(v_warning_reasons || v_rollback_reasons) AS reason
    ORDER BY reason
  );
  metrics := jsonb_build_object(
    'negative_ats_count', v_negative_ats_count,
    'reservation_ownership_invalid_count', v_reservation_ownership_invalid_count,
    'paid_order_invalid_count', v_paid_order_invalid_count,
    'duplicate_order_count', v_duplicate_order_count,
    'consumed_reservation_invalid_count', v_consumed_reservation_invalid_count,
    'paid_inventory_mismatch_count', v_paid_inventory_mismatch_count,
    'paid_release_path_count', v_paid_release_path_count,
    'paid_lifecycle_invalid_count', v_paid_lifecycle_invalid_count,
    'severe_incident_count', v_severe_incident_count,
    'discovery_incident_count', v_discovery_incident_count,
    'scheduler_fired_at', v_scheduler_fired_at,
    'scheduler_age_seconds', v_scheduler_age_seconds,
    'worker_completed_at', v_worker_completed_at,
    'worker_age_seconds', v_worker_age_seconds,
    'consecutive_worker_failures', v_consecutive_worker_failures,
    'pending_scheduler_age_seconds', v_pending_scheduler_age_seconds,
    'due_job_count', v_due_job_count,
    'due_job_age_seconds', v_due_job_age_seconds,
    'manual_review_count', v_manual_review_count,
    'paid_manual_review_count', v_paid_manual_review_count,
    'authoritative_overdue_count', v_authoritative_overdue_count,
    'authoritative_overdue_age_seconds', v_authoritative_overdue_age_seconds,
    'warning_reason_codes', to_jsonb(v_warning_reasons),
    'rollback_reason_codes', to_jsonb(v_rollback_reasons)
  );

  RETURN NEXT;
END;
$function$;

REVOKE ALL ON FUNCTION private.evaluate_checkout_health_v1(timestamp with time zone)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.evaluate_checkout_health_v1(timestamp with time zone) TO postgres;

CREATE FUNCTION private.record_checkout_health_snapshot_v1(
  p_now timestamp with time zone DEFAULT clock_timestamp()
)
RETURNS private.checkout_health_snapshots
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_evaluation record;
  v_snapshot private.checkout_health_snapshots%ROWTYPE;
  v_snapshot_minute timestamp with time zone;
BEGIN
  IF p_now IS NULL THEN
    RAISE EXCEPTION 'Checkout health snapshot time is required.';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('taa.checkout.health.monitor.v1', 0)
  );

  v_snapshot_minute := date_trunc('minute', p_now);

  SELECT evaluation.*
  INTO v_evaluation
  FROM private.evaluate_checkout_health_v1(p_now) AS evaluation;

  INSERT INTO private.checkout_health_snapshots (
    snapshot_minute,
    evaluated_at,
    classification,
    reason_codes,
    metrics
  )
  VALUES (
    v_snapshot_minute,
    p_now,
    v_evaluation.classification,
    v_evaluation.reason_codes,
    v_evaluation.metrics
  )
  ON CONFLICT (snapshot_minute) DO NOTHING
  RETURNING * INTO v_snapshot;

  IF v_snapshot.id IS NULL THEN
    SELECT snapshots.*
    INTO v_snapshot
    FROM private.checkout_health_snapshots AS snapshots
    WHERE snapshots.snapshot_minute = v_snapshot_minute;
  END IF;

  DELETE FROM private.checkout_health_snapshots AS snapshots
  WHERE snapshots.evaluated_at < p_now - interval '30 days';

  RETURN v_snapshot;
END;
$function$;

REVOKE ALL ON FUNCTION private.record_checkout_health_snapshot_v1(timestamp with time zone)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.record_checkout_health_snapshot_v1(timestamp with time zone) TO postgres;

CREATE FUNCTION private.get_checkout_health_v1(
  p_now timestamp with time zone DEFAULT clock_timestamp()
)
RETURNS TABLE (
  snapshot_id uuid,
  snapshot_at timestamp with time zone,
  classification text,
  reason_codes text[],
  metrics jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_snapshot private.checkout_health_snapshots%ROWTYPE;
  v_age_seconds numeric;
BEGIN
  IF p_now IS NULL THEN
    RAISE EXCEPTION 'Checkout health read time is required.';
  END IF;

  SELECT snapshots.*
  INTO v_snapshot
  FROM private.checkout_health_snapshots AS snapshots
  ORDER BY snapshots.evaluated_at DESC
  LIMIT 1;

  IF v_snapshot.id IS NULL THEN
    snapshot_id := NULL;
    snapshot_at := NULL;
    classification := 'ROLLBACK_REQUIRED';
    reason_codes := ARRAY['monitor_heartbeat_missing'];
    metrics := jsonb_build_object('monitor_age_seconds', NULL);
    RETURN NEXT;
    RETURN;
  END IF;

  v_age_seconds := extract(epoch FROM p_now - v_snapshot.evaluated_at);
  snapshot_id := v_snapshot.id;
  snapshot_at := v_snapshot.evaluated_at;
  metrics := v_snapshot.metrics || jsonb_build_object('monitor_age_seconds', v_age_seconds);

  IF v_age_seconds > 300 THEN
    classification := 'ROLLBACK_REQUIRED';
    reason_codes := ARRAY(
      SELECT DISTINCT reason
      FROM unnest(v_snapshot.reason_codes || ARRAY['monitor_heartbeat_stale']) AS reason
      ORDER BY reason
    );
  ELSIF v_age_seconds > 120 AND v_snapshot.classification = 'HEALTHY' THEN
    classification := 'WARNING';
    reason_codes := ARRAY['monitor_heartbeat_delayed'];
  ELSIF v_age_seconds > 120 THEN
    classification := v_snapshot.classification;
    reason_codes := ARRAY(
      SELECT DISTINCT reason
      FROM unnest(v_snapshot.reason_codes || ARRAY['monitor_heartbeat_delayed']) AS reason
      ORDER BY reason
    );
  ELSE
    classification := v_snapshot.classification;
    reason_codes := v_snapshot.reason_codes;
  END IF;

  RETURN NEXT;
END;
$function$;

REVOKE ALL ON FUNCTION private.get_checkout_health_v1(timestamp with time zone)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.get_checkout_health_v1(timestamp with time zone) TO postgres;

COMMENT ON TABLE private.checkout_health_snapshots IS
  'Private, credential-free reservation-v1 lifecycle health snapshots retained for 30 days.';
COMMENT ON FUNCTION private.evaluate_checkout_health_v1(timestamp with time zone) IS
  'Evaluates checkout integrity, reconciliation health, and explicit rollback thresholds without mutating lifecycle state.';
COMMENT ON FUNCTION private.record_checkout_health_snapshot_v1(timestamp with time zone) IS
  'Records at most one immutable checkout health snapshot per minute and prunes snapshots older than 30 days.';
COMMENT ON FUNCTION private.get_checkout_health_v1(timestamp with time zone) IS
  'Returns the latest checkout health snapshot with independent monitor-heartbeat staleness classification.';

DO $block$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM cron.job
    WHERE jobname = 'taa-checkout-health-monitor-v1'
  ) THEN
    RAISE EXCEPTION 'Checkout health monitor job already exists.';
  END IF;
END;
$block$;

SELECT cron.schedule(
  'taa-checkout-health-monitor-v1',
  '* * * * *',
  'SELECT private.record_checkout_health_snapshot_v1();'
);

-- Feature rollback is an explicit operator action and is intentionally not
-- implemented here. Monitor rollback disables only this monitor job:
-- SELECT cron.alter_job(jobid, active := false)
-- FROM cron.job
-- WHERE jobname = 'taa-checkout-health-monitor-v1';
