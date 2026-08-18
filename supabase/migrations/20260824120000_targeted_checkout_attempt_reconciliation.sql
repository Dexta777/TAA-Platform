-- Exact, operator-only admission to the existing Stripe-aware reconciliation worker.

CREATE FUNCTION public.claim_checkout_attempt_reconciliation_job_v1(
  p_checkout_attempt_id uuid,
  p_worker_lease_id uuid
)
RETURNS TABLE (
  claim_state text,
  job_id uuid,
  checkout_attempt_id uuid,
  checkout_intent_id uuid,
  lifecycle_incident_id uuid,
  reason text,
  attempt_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_attempt public.checkout_attempts%ROWTYPE;
  v_reservation public.inventory_reservations%ROWTYPE;
  v_intent public.checkout_intents%ROWTYPE;
  v_active_intent public.checkout_intents%ROWTYPE;
  v_in_flight_intent public.checkout_intents%ROWTYPE;
  v_job public.checkout_reconciliation_jobs%ROWTYPE;
  v_job_id uuid;
  v_now timestamp with time zone := clock_timestamp();
  v_reason constant text := 'operator_attempt_recovery';
  v_topology_valid boolean := false;
BEGIN
  IF p_checkout_attempt_id IS NULL THEN
    RAISE EXCEPTION 'Checkout attempt ID is required.';
  END IF;

  IF p_worker_lease_id IS NULL THEN
    RAISE EXCEPTION 'Reconciliation worker lease ID is required.';
  END IF;

  SELECT attempts.*
  INTO v_attempt
  FROM public.checkout_attempts AS attempts
  WHERE attempts.id = p_checkout_attempt_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY
    SELECT
      'attempt_not_found'::text,
      NULL::uuid,
      p_checkout_attempt_id,
      NULL::uuid,
      NULL::uuid,
      NULL::text,
      0;
    RETURN;
  END IF;

  IF v_attempt.checkout_protocol_version IS DISTINCT FROM 'reservation_v1' THEN
    RETURN QUERY
    SELECT
      'not_reservation_v1'::text,
      NULL::uuid,
      v_attempt.id,
      NULL::uuid,
      NULL::uuid,
      NULL::text,
      0;
    RETURN;
  END IF;

  SELECT reservations.*
  INTO v_reservation
  FROM public.inventory_reservations AS reservations
  WHERE reservations.checkout_attempt_id = v_attempt.id
  FOR UPDATE;

  PERFORM intents.id
  FROM public.checkout_intents AS intents
  WHERE intents.checkout_attempt_id = v_attempt.id
  ORDER BY intents.id
  FOR UPDATE;

  -- An unresolved incident always wins over terminal/paid shortcuts. Otherwise
  -- a paid-without-order incident could be mislabeled as a harmless replay.
  SELECT jobs.*
  INTO v_job
  FROM public.checkout_reconciliation_jobs AS jobs
  WHERE jobs.checkout_attempt_id = v_attempt.id
    AND jobs.status = 'manual_review'
  ORDER BY jobs.created_at, jobs.id
  LIMIT 1
  FOR UPDATE;

  IF v_job.id IS NOT NULL THEN
    RETURN QUERY
    SELECT
      'manual_review_required'::text,
      v_job.id,
      v_attempt.id,
      v_job.checkout_intent_id,
      v_job.lifecycle_incident_id,
      v_job.reason,
      v_job.attempt_count;
    RETURN;
  END IF;

  IF v_attempt.status = 'paid'
    AND v_reservation.id IS NOT NULL
    AND v_reservation.status = 'consumed'
    AND v_reservation.order_id IS NOT NULL
    AND v_attempt.active_checkout_intent_id IS NULL
    AND v_attempt.in_flight_checkout_intent_id IS NULL
    AND (
      SELECT count(*)
      FROM public.checkout_intents AS intents
      JOIN public.orders AS orders
        ON orders.checkout_intent_id = intents.id
        AND orders.checkout_attempt_id = v_attempt.id
        AND orders.id = v_reservation.order_id
      WHERE intents.checkout_attempt_id = v_attempt.id
        AND intents.status = 'paid'
        AND intents.orchestration_state = 'paid'
    ) = 1
    AND NOT EXISTS (
      SELECT 1
      FROM public.checkout_intents AS intents
      WHERE intents.checkout_attempt_id = v_attempt.id
        AND NOT (
          (
            intents.status = 'paid'
            AND intents.orchestration_state = 'paid'
            AND EXISTS (
              SELECT 1
              FROM public.orders AS orders
              WHERE orders.id = v_reservation.order_id
                AND orders.checkout_attempt_id = v_attempt.id
                AND orders.checkout_intent_id = intents.id
            )
          )
          OR (
            intents.status IN ('expired', 'failed')
            AND intents.orchestration_state IN ('failed', 'superseded', 'compensated')
          )
        )
    ) THEN
    RETURN QUERY
    SELECT
      'already_paid'::text,
      NULL::uuid,
      v_attempt.id,
      NULL::uuid,
      NULL::uuid,
      NULL::text,
      0;
    RETURN;
  END IF;

  IF v_attempt.status = 'paid'
    OR (v_reservation.id IS NOT NULL AND v_reservation.status = 'consumed') THEN
    RETURN QUERY
    SELECT
      'integrity_review'::text,
      NULL::uuid,
      v_attempt.id,
      NULL::uuid,
      NULL::uuid,
      NULL::text,
      0;
    RETURN;
  END IF;

  IF v_attempt.status IN ('expired', 'failed')
    AND v_reservation.id IS NOT NULL
    AND v_reservation.status = 'released'
    AND v_attempt.active_checkout_intent_id IS NULL
    AND v_attempt.in_flight_checkout_intent_id IS NULL
    AND EXISTS (
      SELECT 1
      FROM public.checkout_intents AS intents
      WHERE intents.checkout_attempt_id = v_attempt.id
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.checkout_intents AS intents
      WHERE intents.checkout_attempt_id = v_attempt.id
        AND NOT (
          intents.status IN ('expired', 'failed')
          AND intents.orchestration_state IN ('failed', 'superseded', 'compensated')
        )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.orders AS orders
      WHERE orders.checkout_attempt_id = v_attempt.id
        OR orders.checkout_intent_id IN (
          SELECT intents.id
          FROM public.checkout_intents AS intents
          WHERE intents.checkout_attempt_id = v_attempt.id
        )
    ) THEN
    RETURN QUERY
    SELECT
      'already_terminal'::text,
      NULL::uuid,
      v_attempt.id,
      NULL::uuid,
      NULL::uuid,
      NULL::text,
      0;
    RETURN;
  END IF;

  IF v_attempt.status IN ('active', 'payment_pending')
    AND v_reservation.id IS NULL
    AND v_attempt.active_checkout_intent_id IS NULL
    AND v_attempt.in_flight_checkout_intent_id IS NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.checkout_intents AS intents
      WHERE intents.checkout_attempt_id = v_attempt.id
    ) THEN
    RETURN QUERY
    SELECT
      'not_materialized'::text,
      NULL::uuid,
      v_attempt.id,
      NULL::uuid,
      NULL::uuid,
      NULL::text,
      0;
    RETURN;
  END IF;

  IF v_attempt.status NOT IN ('active', 'payment_pending')
    OR v_reservation.id IS NULL
    OR v_reservation.status NOT IN ('held', 'payment_pending') THEN
    RETURN QUERY
    SELECT
      'integrity_review'::text,
      NULL::uuid,
      v_attempt.id,
      NULL::uuid,
      NULL::uuid,
      NULL::text,
      0;
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.checkout_intents AS intents
    WHERE intents.checkout_attempt_id = v_attempt.id
      AND intents.id IS DISTINCT FROM v_attempt.active_checkout_intent_id
      AND intents.id IS DISTINCT FROM v_attempt.in_flight_checkout_intent_id
      AND NOT (
        intents.status IN ('expired', 'failed')
        AND intents.orchestration_state IN ('failed', 'superseded', 'compensated')
      )
  ) THEN
    RETURN QUERY
    SELECT
      'integrity_review'::text,
      NULL::uuid,
      v_attempt.id,
      NULL::uuid,
      NULL::uuid,
      NULL::text,
      0;
    RETURN;
  END IF;

  SELECT intents.*
  INTO v_active_intent
  FROM public.checkout_intents AS intents
  WHERE intents.id = v_attempt.active_checkout_intent_id
    AND intents.checkout_attempt_id = v_attempt.id;

  SELECT intents.*
  INTO v_in_flight_intent
  FROM public.checkout_intents AS intents
  WHERE intents.id = v_attempt.in_flight_checkout_intent_id
    AND intents.checkout_attempt_id = v_attempt.id;

  IF NOT EXISTS (
    SELECT 1
    FROM public.orders AS orders
    WHERE orders.checkout_attempt_id = v_attempt.id
      OR orders.checkout_intent_id IN (
        SELECT intents.id
        FROM public.checkout_intents AS intents
        WHERE intents.checkout_attempt_id = v_attempt.id
      )
  ) THEN
    IF v_attempt.status = 'payment_pending'
      AND v_reservation.status = 'payment_pending' THEN
      v_topology_valid :=
        v_attempt.active_checkout_intent_id IS NOT NULL
        AND v_attempt.in_flight_checkout_intent_id IS NULL
        AND v_active_intent.id IS NOT DISTINCT FROM v_attempt.active_checkout_intent_id
        AND v_active_intent.checkout_protocol_version IS NOT DISTINCT FROM 'reservation_v1'
        AND v_active_intent.status = 'payment_pending'
        AND v_active_intent.orchestration_state IN ('active', 'reconciliation_required')
        AND nullif(btrim(v_active_intent.stripe_checkout_session_id), '') IS NOT NULL
        AND (
          (
            v_active_intent.replaces_checkout_intent_id IS NULL
            AND v_active_intent.predecessor_invalidated_at IS NULL
          )
          OR (
            v_active_intent.replaces_checkout_intent_id IS NOT NULL
            AND v_active_intent.predecessor_invalidated_at IS NOT NULL
            AND v_active_intent.replaces_checkout_intent_id
              IS DISTINCT FROM v_active_intent.id
          )
        );
    ELSIF v_attempt.status = 'active'
      AND v_reservation.status = 'held' THEN
      v_topology_valid :=
        num_nonnulls(
          v_attempt.active_checkout_intent_id,
          v_attempt.in_flight_checkout_intent_id
        ) > 0;

      IF v_attempt.active_checkout_intent_id IS NOT NULL THEN
        v_topology_valid := v_topology_valid
          AND v_active_intent.id IS NOT DISTINCT FROM v_attempt.active_checkout_intent_id
          AND v_active_intent.checkout_protocol_version IS NOT DISTINCT FROM 'reservation_v1'
          AND v_active_intent.status = 'pending'
          AND v_active_intent.orchestration_state IN ('active', 'reconciliation_required')
          AND nullif(btrim(v_active_intent.stripe_checkout_session_id), '') IS NOT NULL
          AND (
            (
              v_active_intent.replaces_checkout_intent_id IS NULL
              AND v_active_intent.predecessor_invalidated_at IS NULL
            )
            OR (
              v_active_intent.replaces_checkout_intent_id IS NOT NULL
              AND v_active_intent.predecessor_invalidated_at IS NOT NULL
              AND v_active_intent.replaces_checkout_intent_id
                IS DISTINCT FROM v_active_intent.id
              AND v_active_intent.replaces_checkout_intent_id
                IS DISTINCT FROM v_attempt.in_flight_checkout_intent_id
            )
          );
      END IF;

      IF v_attempt.in_flight_checkout_intent_id IS NOT NULL THEN
        v_topology_valid := v_topology_valid
          AND v_in_flight_intent.id IS NOT DISTINCT FROM v_attempt.in_flight_checkout_intent_id
          AND v_in_flight_intent.checkout_protocol_version IS NOT DISTINCT FROM 'reservation_v1'
          AND v_in_flight_intent.status = 'preparing'
          AND v_in_flight_intent.orchestration_state IN (
            'prepared',
            'creating_coupon',
            'creating_session',
            'session_created',
            'replacing',
            'compensating',
            'reconciliation_required'
          )
          AND (
            (
              v_in_flight_intent.orchestration_state IN (
                'prepared',
                'creating_coupon',
                'creating_session'
              )
              AND nullif(btrim(v_in_flight_intent.stripe_checkout_session_id), '') IS NULL
            )
            OR (
              v_in_flight_intent.orchestration_state IN (
                'session_created',
                'replacing',
                'compensating'
              )
              AND nullif(btrim(v_in_flight_intent.stripe_checkout_session_id), '') IS NOT NULL
            )
            OR v_in_flight_intent.orchestration_state = 'reconciliation_required'
          )
          AND (
            (
              v_in_flight_intent.replaces_checkout_intent_id IS NULL
              AND v_attempt.active_checkout_intent_id IS NULL
              AND v_in_flight_intent.predecessor_invalidated_at IS NULL
              AND v_in_flight_intent.orchestration_state <> 'replacing'
            )
            OR (
              v_in_flight_intent.replaces_checkout_intent_id IS NOT NULL
              AND v_in_flight_intent.replaces_checkout_intent_id
                IS DISTINCT FROM v_in_flight_intent.id
              AND (
                (
                  v_attempt.active_checkout_intent_id IS NOT NULL
                  AND v_in_flight_intent.replaces_checkout_intent_id
                    IS NOT DISTINCT FROM v_attempt.active_checkout_intent_id
                  AND v_in_flight_intent.predecessor_invalidated_at IS NULL
                )
                OR (
                  v_attempt.active_checkout_intent_id IS NULL
                  AND v_in_flight_intent.predecessor_invalidated_at IS NOT NULL
                  AND v_in_flight_intent.orchestration_state IN (
                    'replacing',
                    'compensating',
                    'reconciliation_required'
                  )
                )
              )
            )
          );
      END IF;
    END IF;
  END IF;

  IF NOT COALESCE(v_topology_valid, false) THEN
    RETURN QUERY
    SELECT
      'integrity_review'::text,
      NULL::uuid,
      v_attempt.id,
      COALESCE(
        v_attempt.in_flight_checkout_intent_id,
        v_attempt.active_checkout_intent_id
      ),
      NULL::uuid,
      NULL::text,
      0;
    RETURN;
  END IF;

  IF v_attempt.in_flight_checkout_intent_id IS NOT NULL THEN
    v_intent := v_in_flight_intent;
  ELSE
    v_intent := v_active_intent;
  END IF;

  -- Any live lease anywhere on the attempt fences this exact operation. A
  -- same-worker replay is safe only when it owns this selected current intent.
  SELECT jobs.*
  INTO v_job
  FROM public.checkout_reconciliation_jobs AS jobs
  WHERE jobs.checkout_attempt_id = v_attempt.id
    AND jobs.status = 'claimed'
    AND jobs.worker_lease_expires_at > v_now
    AND NOT (
      jobs.checkout_intent_id = v_intent.id
      AND jobs.worker_lease_id = p_worker_lease_id
    )
  ORDER BY jobs.worker_lease_expires_at, jobs.created_at, jobs.id
  LIMIT 1
  FOR UPDATE;

  IF v_job.id IS NOT NULL THEN
    RETURN QUERY
    SELECT
      'operation_in_progress'::text,
      v_job.id,
      v_attempt.id,
      v_job.checkout_intent_id,
      v_job.lifecycle_incident_id,
      v_job.reason,
      v_job.attempt_count;
    RETURN;
  END IF;

  SELECT jobs.*
  INTO v_job
  FROM public.checkout_reconciliation_jobs AS jobs
  WHERE jobs.checkout_attempt_id = v_attempt.id
    AND jobs.checkout_intent_id = v_intent.id
    AND jobs.status = 'claimed'
    AND jobs.worker_lease_expires_at > v_now
    AND jobs.worker_lease_id = p_worker_lease_id
  ORDER BY jobs.created_at, jobs.id
  LIMIT 1
  FOR UPDATE;

  IF v_job.id IS NOT NULL THEN
    RETURN QUERY
    SELECT
      'already_claimed'::text,
      v_job.id,
      v_attempt.id,
      v_job.checkout_intent_id,
      v_job.lifecycle_incident_id,
      v_job.reason,
      v_job.attempt_count;
    RETURN;
  END IF;

  -- Respect any existing durable work for this exact attempt/intent. This avoids
  -- starting a second external Stripe operation under a different queue reason.
  SELECT jobs.*
  INTO v_job
  FROM public.checkout_reconciliation_jobs AS jobs
  WHERE jobs.checkout_attempt_id = v_attempt.id
    AND jobs.checkout_intent_id = v_intent.id
    AND jobs.status IN ('manual_review', 'claimed', 'pending')
  ORDER BY
    CASE jobs.status
      WHEN 'manual_review' THEN 0
      WHEN 'claimed' THEN 1
      WHEN 'pending' THEN 1
      ELSE 2
    END,
    CASE
      WHEN jobs.status = 'claimed' THEN jobs.worker_lease_expires_at
      ELSE jobs.available_at
    END,
    jobs.created_at,
    jobs.id
  LIMIT 1
  FOR UPDATE;

  IF v_job.id IS NULL THEN
    SELECT jobs.*
    INTO v_job
    FROM public.checkout_reconciliation_jobs AS jobs
    WHERE jobs.checkout_attempt_id = v_attempt.id
      AND jobs.checkout_intent_id = v_intent.id
      AND jobs.lifecycle_incident_id IS NULL
      AND jobs.reason = v_reason
    ORDER BY jobs.created_at, jobs.id
    LIMIT 1
    FOR UPDATE;

    IF v_job.id IS NULL OR v_job.status = 'resolved' THEN
      v_job_id := public.enqueue_checkout_reconciliation(
        v_attempt.id,
        v_intent.id,
        NULL,
        v_reason,
        false
      );

      SELECT jobs.*
      INTO v_job
      FROM public.checkout_reconciliation_jobs AS jobs
      WHERE jobs.id = v_job_id
      FOR UPDATE;
    END IF;
  END IF;

  -- A newly enqueued job uses clock_timestamp(); refresh the claim boundary so
  -- it is eligible during this same exact-target transaction.
  v_now := clock_timestamp();

  IF v_job.status = 'manual_review' THEN
    RETURN QUERY
    SELECT
      'manual_review_required'::text,
      v_job.id,
      v_attempt.id,
      v_intent.id,
      v_job.lifecycle_incident_id,
      v_job.reason,
      v_job.attempt_count;
    RETURN;
  END IF;

  IF v_job.status = 'pending' AND v_job.available_at > v_now THEN
    RETURN QUERY
    SELECT
      'retry_not_due'::text,
      v_job.id,
      v_attempt.id,
      v_intent.id,
      v_job.lifecycle_incident_id,
      v_job.reason,
      v_job.attempt_count;
    RETURN;
  END IF;

  UPDATE public.checkout_reconciliation_jobs AS jobs
  SET
    status = 'claimed',
    worker_lease_id = p_worker_lease_id,
    worker_lease_expires_at = v_now + interval '2 minutes',
    attempt_count = jobs.attempt_count + 1,
    updated_at = v_now
  WHERE jobs.id = v_job.id
    AND jobs.available_at <= v_now
    AND (
      jobs.status = 'pending'
      OR (
        jobs.status = 'claimed'
        AND jobs.worker_lease_expires_at <= v_now
      )
    )
  RETURNING jobs.* INTO v_job;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Targeted reconciliation job could not be claimed.';
  END IF;

  RETURN QUERY
  SELECT
    'claimed'::text,
    v_job.id,
    v_attempt.id,
    v_intent.id,
    v_job.lifecycle_incident_id,
    v_job.reason,
    v_job.attempt_count;
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_checkout_attempt_reconciliation_job_v1(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_checkout_attempt_reconciliation_job_v1(uuid, uuid)
  TO service_role;

COMMENT ON FUNCTION public.claim_checkout_attempt_reconciliation_job_v1(uuid, uuid) IS
  'Claims durable reconciliation work for exactly one materialized reservation-v1 attempt. Stripe authority remains in the private Edge worker.';
