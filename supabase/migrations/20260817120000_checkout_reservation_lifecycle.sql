-- Slice 5C: reservation-aware paid finalization and authoritative Stripe lifecycle recovery.

DO $block$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.inventory_reservations
    WHERE status = 'consumed'
       OR (
         status IN ('held', 'payment_pending')
         AND (consumed_at IS NOT NULL OR released_at IS NOT NULL OR release_reason IS NOT NULL)
       )
       OR (
         status = 'released'
         AND (consumed_at IS NOT NULL OR released_at IS NULL)
       )
  ) THEN
    RAISE EXCEPTION
      'Cannot install Slice 5C: inventory_reservations contains incompatible lifecycle data.';
  END IF;
END;
$block$;

ALTER TABLE public.inventory_reservations
  ADD COLUMN order_id uuid,
  ADD CONSTRAINT inventory_reservations_order_id_key UNIQUE (order_id),
  ADD CONSTRAINT inventory_reservations_order_id_fkey
    FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE RESTRICT,
  DROP CONSTRAINT inventory_reservations_lifecycle_check,
  ADD CONSTRAINT inventory_reservations_lifecycle_check
    CHECK (
      (
        status IN ('held', 'payment_pending')
        AND consumed_at IS NULL
        AND released_at IS NULL
        AND release_reason IS NULL
        AND order_id IS NULL
      )
      OR (
        status = 'consumed'
        AND consumed_at IS NOT NULL
        AND released_at IS NULL
        AND release_reason IS NULL
        AND order_id IS NOT NULL
      )
      OR (
        status = 'released'
        AND consumed_at IS NULL
        AND released_at IS NOT NULL
        AND nullif(btrim(release_reason), '') IS NOT NULL
        AND length(release_reason) <= 100
        AND order_id IS NULL
      )
    );

ALTER TABLE public.checkout_intents
  ADD COLUMN predecessor_invalidated_at timestamp with time zone,
  ADD CONSTRAINT checkout_intents_predecessor_invalidation_check
    CHECK (predecessor_invalidated_at IS NULL OR replaces_checkout_intent_id IS NOT NULL);

ALTER TABLE public.checkout_intents
  DROP CONSTRAINT checkout_intents_orchestration_state_check,
  ADD CONSTRAINT checkout_intents_orchestration_state_check
    CHECK (
      orchestration_state IS NULL
      OR orchestration_state IN (
        'prepared',
        'creating_coupon',
        'creating_session',
        'session_created',
        'replacing',
        'active',
        'superseded',
        'compensating',
        'compensated',
        'failed',
        'reconciliation_required',
        'paid'
      )
    );

CREATE TABLE public.checkout_lifecycle_incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_key text NOT NULL UNIQUE,
  checkout_attempt_id uuid,
  checkout_intent_id uuid,
  stripe_checkout_session_id text,
  payment_intent_id text,
  incident_type text NOT NULL,
  diagnostic_details jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurrence_count integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'open',
  first_seen_at timestamp with time zone NOT NULL DEFAULT now(),
  last_seen_at timestamp with time zone NOT NULL DEFAULT now(),
  resolved_at timestamp with time zone,
  CONSTRAINT checkout_lifecycle_incidents_attempt_id_fkey
    FOREIGN KEY (checkout_attempt_id)
    REFERENCES public.checkout_attempts(id)
    ON DELETE RESTRICT,
  CONSTRAINT checkout_lifecycle_incidents_intent_id_fkey
    FOREIGN KEY (checkout_intent_id)
    REFERENCES public.checkout_intents(id)
    ON DELETE RESTRICT,
  CONSTRAINT checkout_lifecycle_incidents_key_check
    CHECK (incident_key ~ '^[0-9a-f]{64}$'),
  CONSTRAINT checkout_lifecycle_incidents_type_check
    CHECK (
      incident_type IN (
        'paid_inventory_invariant_broken',
        'paid_reservation_released',
        'paid_reservation_missing',
        'paid_reservation_cart_mismatch',
        'paid_path_conflict',
        'stripe_session_match_conflict',
        'stripe_idempotency_history_conflict',
        'stripe_session_discovery_failed',
        'finalization_integrity_conflict'
      )
    ),
  CONSTRAINT checkout_lifecycle_incidents_details_check
    CHECK (jsonb_typeof(diagnostic_details) = 'object'),
  CONSTRAINT checkout_lifecycle_incidents_occurrence_check
    CHECK (occurrence_count > 0),
  CONSTRAINT checkout_lifecycle_incidents_status_check
    CHECK (status IN ('open', 'resolved')),
  CONSTRAINT checkout_lifecycle_incidents_resolution_check
    CHECK (
      (status = 'open' AND resolved_at IS NULL)
      OR (status = 'resolved' AND resolved_at IS NOT NULL)
    )
);

ALTER TABLE public.checkout_lifecycle_incidents ENABLE ROW LEVEL SECURITY;

CREATE INDEX checkout_lifecycle_incidents_open_idx
  ON public.checkout_lifecycle_incidents (last_seen_at, incident_type)
  WHERE status = 'open';

CREATE TABLE public.checkout_reconciliation_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_key text NOT NULL UNIQUE,
  checkout_attempt_id uuid,
  checkout_intent_id uuid,
  lifecycle_incident_id uuid,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  available_at timestamp with time zone NOT NULL DEFAULT now(),
  worker_lease_id uuid,
  worker_lease_expires_at timestamp with time zone,
  attempt_count integer NOT NULL DEFAULT 0,
  last_error_code text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT checkout_reconciliation_jobs_attempt_id_fkey
    FOREIGN KEY (checkout_attempt_id)
    REFERENCES public.checkout_attempts(id)
    ON DELETE RESTRICT,
  CONSTRAINT checkout_reconciliation_jobs_intent_id_fkey
    FOREIGN KEY (checkout_intent_id)
    REFERENCES public.checkout_intents(id)
    ON DELETE RESTRICT,
  CONSTRAINT checkout_reconciliation_jobs_incident_id_fkey
    FOREIGN KEY (lifecycle_incident_id)
    REFERENCES public.checkout_lifecycle_incidents(id)
    ON DELETE RESTRICT,
  CONSTRAINT checkout_reconciliation_jobs_key_check
    CHECK (job_key ~ '^[0-9a-f]{64}$'),
  CONSTRAINT checkout_reconciliation_jobs_reason_check
    CHECK (nullif(btrim(reason), '') IS NOT NULL AND length(reason) <= 100),
  CONSTRAINT checkout_reconciliation_jobs_status_check
    CHECK (status IN ('pending', 'claimed', 'manual_review', 'resolved')),
  CONSTRAINT checkout_reconciliation_jobs_lease_check
    CHECK (
      (status = 'claimed' AND num_nonnulls(worker_lease_id, worker_lease_expires_at) = 2)
      OR (status <> 'claimed' AND worker_lease_id IS NULL AND worker_lease_expires_at IS NULL)
    ),
  CONSTRAINT checkout_reconciliation_jobs_attempt_count_check
    CHECK (attempt_count >= 0),
  CONSTRAINT checkout_reconciliation_jobs_target_check
    CHECK (num_nonnulls(checkout_attempt_id, checkout_intent_id, lifecycle_incident_id) > 0)
);

ALTER TABLE public.checkout_reconciliation_jobs ENABLE ROW LEVEL SECURITY;

CREATE INDEX checkout_reconciliation_jobs_claim_idx
  ON public.checkout_reconciliation_jobs (available_at, created_at)
  WHERE status IN ('pending', 'claimed');

REVOKE ALL ON TABLE public.checkout_lifecycle_incidents
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.checkout_reconciliation_jobs
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.checkout_lifecycle_incidents TO service_role;
GRANT ALL ON TABLE public.checkout_reconciliation_jobs TO service_role;

CREATE FUNCTION public.enqueue_checkout_reconciliation(
  p_checkout_attempt_id uuid,
  p_checkout_intent_id uuid,
  p_lifecycle_incident_id uuid,
  p_reason text,
  p_manual_review boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_job_id uuid;
  v_reason text := left(COALESCE(nullif(btrim(p_reason), ''), 'lifecycle_reconciliation'), 100);
  v_job_key text;
BEGIN
  IF num_nonnulls(p_checkout_attempt_id, p_checkout_intent_id, p_lifecycle_incident_id) = 0 THEN
    RAISE EXCEPTION 'A reconciliation target is required.';
  END IF;

  v_job_key := encode(
    extensions.digest(
      concat_ws(
        '|',
        COALESCE(p_checkout_attempt_id::text, '-'),
        COALESCE(p_checkout_intent_id::text, '-'),
        COALESCE(p_lifecycle_incident_id::text, '-'),
        v_reason
      ),
      'sha256'
    ),
    'hex'
  );

  INSERT INTO public.checkout_reconciliation_jobs (
    job_key,
    checkout_attempt_id,
    checkout_intent_id,
    lifecycle_incident_id,
    reason,
    status,
    available_at,
    updated_at
  )
  VALUES (
    v_job_key,
    p_checkout_attempt_id,
    p_checkout_intent_id,
    p_lifecycle_incident_id,
    v_reason,
    CASE WHEN p_manual_review THEN 'manual_review' ELSE 'pending' END,
    clock_timestamp(),
    clock_timestamp()
  )
  ON CONFLICT (job_key) DO UPDATE
  SET
    status = CASE
      WHEN public.checkout_reconciliation_jobs.status = 'resolved'
        THEN EXCLUDED.status
      WHEN EXCLUDED.status = 'manual_review'
        THEN 'manual_review'
      ELSE public.checkout_reconciliation_jobs.status
    END,
    available_at = least(public.checkout_reconciliation_jobs.available_at, EXCLUDED.available_at),
    worker_lease_id = CASE
      WHEN EXCLUDED.status = 'manual_review' THEN NULL
      ELSE public.checkout_reconciliation_jobs.worker_lease_id
    END,
    worker_lease_expires_at = CASE
      WHEN EXCLUDED.status = 'manual_review' THEN NULL
      ELSE public.checkout_reconciliation_jobs.worker_lease_expires_at
    END,
    updated_at = clock_timestamp()
  RETURNING id INTO v_job_id;

  RETURN v_job_id;
END;
$function$;

CREATE FUNCTION public.record_checkout_predecessor_invalidated(
  p_replacement_intent_id uuid,
  p_predecessor_intent_id uuid,
  p_worker_lease_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_attempt_id uuid;
  v_attempt public.checkout_attempts%ROWTYPE;
  v_replacement public.checkout_intents%ROWTYPE;
  v_predecessor public.checkout_intents%ROWTYPE;
  v_now timestamp with time zone := clock_timestamp();
BEGIN
  SELECT checkout_attempt_id
  INTO v_attempt_id
  FROM public.checkout_intents
  WHERE id = p_replacement_intent_id;

  IF v_attempt_id IS NULL THEN
    RAISE EXCEPTION 'Checkout replacement intent not found.';
  END IF;

  SELECT attempts.*
  INTO v_attempt
  FROM public.checkout_attempts AS attempts
  WHERE attempts.id = v_attempt_id
  FOR UPDATE;

  PERFORM reservations.id
  FROM public.inventory_reservations AS reservations
  WHERE reservations.checkout_attempt_id = v_attempt_id
  FOR UPDATE;

  PERFORM intents.id
  FROM public.checkout_intents AS intents
  WHERE intents.id IN (p_replacement_intent_id, p_predecessor_intent_id)
  ORDER BY intents.id
  FOR UPDATE;

  SELECT intents.*
  INTO v_replacement
  FROM public.checkout_intents AS intents
  WHERE intents.id = p_replacement_intent_id;

  SELECT intents.*
  INTO v_predecessor
  FROM public.checkout_intents AS intents
  WHERE intents.id = p_predecessor_intent_id;

  IF v_replacement.predecessor_invalidated_at IS NOT NULL THEN
    IF v_attempt.active_checkout_intent_id IS NULL
      AND v_attempt.in_flight_checkout_intent_id = v_replacement.id
      AND v_replacement.replaces_checkout_intent_id = v_predecessor.id
      AND v_predecessor.checkout_attempt_id = v_attempt.id
      AND v_predecessor.status = 'expired'
      AND v_predecessor.orchestration_state = 'superseded' THEN
      RETURN;
    END IF;

    RAISE EXCEPTION 'Checkout predecessor invalidation replay is inconsistent.';
  END IF;

  IF v_replacement.checkout_attempt_id IS DISTINCT FROM v_attempt.id
    OR v_predecessor.checkout_attempt_id IS DISTINCT FROM v_attempt.id
    OR v_replacement.replaces_checkout_intent_id IS DISTINCT FROM v_predecessor.id
    OR v_attempt.in_flight_checkout_intent_id IS DISTINCT FROM v_replacement.id
    OR v_attempt.active_checkout_intent_id IS DISTINCT FROM v_predecessor.id THEN
    RAISE EXCEPTION 'Checkout predecessor invalidation ownership conflict.';
  END IF;

  IF v_replacement.worker_lease_id IS DISTINCT FROM p_worker_lease_id
    OR v_replacement.worker_lease_expires_at <= v_now THEN
    RAISE EXCEPTION 'Checkout worker lease is invalid.';
  END IF;

  IF v_replacement.orchestration_state <> 'replacing'
    OR v_predecessor.orchestration_state <> 'active' THEN
    RAISE EXCEPTION 'Checkout replacement is not ready for predecessor invalidation.';
  END IF;

  UPDATE public.checkout_intents
  SET
    status = 'expired',
    orchestration_state = 'superseded',
    confirmation_token_hash = NULL,
    confirmation_token_expires_at = NULL,
    orchestration_updated_at = v_now
  WHERE id = v_predecessor.id;

  UPDATE public.checkout_attempts
  SET active_checkout_intent_id = NULL, updated_at = v_now
  WHERE id = v_attempt.id
    AND active_checkout_intent_id = v_predecessor.id
    AND in_flight_checkout_intent_id = v_replacement.id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Checkout predecessor invalidation compare-and-swap failed.';
  END IF;

  UPDATE public.checkout_intents
  SET predecessor_invalidated_at = v_now, orchestration_updated_at = v_now
  WHERE id = v_replacement.id;
END;
$function$;

ALTER FUNCTION public.reserve_checkout_inventory(
  uuid,
  uuid,
  uuid,
  text,
  timestamp with time zone,
  uuid
) RENAME TO reserve_checkout_inventory_locked_implementation;

REVOKE ALL ON FUNCTION public.reserve_checkout_inventory_locked_implementation(
  uuid,
  uuid,
  uuid,
  text,
  timestamp with time zone,
  uuid
) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.reserve_checkout_inventory(
  p_checkout_attempt_id uuid,
  p_checkout_request_id uuid,
  p_checkout_intent_id uuid,
  p_command_fingerprint text,
  p_expires_at timestamp with time zone,
  p_replaces_checkout_intent_id uuid DEFAULT NULL
)
RETURNS TABLE (
  checkout_intent_id uuid,
  reservation_id uuid,
  reservation_status text,
  request_replayed boolean,
  reservation_reused boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  PERFORM attempts.id
  FROM public.checkout_attempts AS attempts
  WHERE attempts.id = p_checkout_attempt_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Checkout attempt not found.';
  END IF;

  PERFORM reservations.id
  FROM public.inventory_reservations AS reservations
  WHERE reservations.checkout_attempt_id = p_checkout_attempt_id
  FOR UPDATE;

  PERFORM intents.id
  FROM public.checkout_intents AS intents
  WHERE intents.id IN (p_checkout_intent_id, p_replaces_checkout_intent_id)
     OR (
       intents.checkout_attempt_id = p_checkout_attempt_id
       AND intents.checkout_request_id = p_checkout_request_id
     )
  ORDER BY intents.id
  FOR UPDATE;

  RETURN QUERY
  SELECT *
  FROM public.reserve_checkout_inventory_locked_implementation(
    p_checkout_attempt_id,
    p_checkout_request_id,
    p_checkout_intent_id,
    p_command_fingerprint,
    p_expires_at,
    p_replaces_checkout_intent_id
  );
END;
$function$;

ALTER FUNCTION public.prepare_checkout_request(
  uuid,
  uuid,
  uuid,
  text,
  text,
  uuid,
  uuid,
  timestamp with time zone,
  jsonb,
  jsonb,
  jsonb
) RENAME TO prepare_checkout_request_locked_implementation;

REVOKE ALL ON FUNCTION public.prepare_checkout_request_locked_implementation(
  uuid,
  uuid,
  uuid,
  text,
  text,
  uuid,
  uuid,
  timestamp with time zone,
  jsonb,
  jsonb,
  jsonb
) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.prepare_checkout_request(
  p_checkout_attempt_id uuid,
  p_checkout_request_id uuid,
  p_user_id uuid,
  p_capability_hash text,
  p_command_fingerprint text,
  p_replaces_checkout_intent_id uuid,
  p_worker_lease_id uuid,
  p_reservation_expires_at timestamp with time zone,
  p_snapshot jsonb DEFAULT NULL,
  p_items jsonb DEFAULT NULL,
  p_shipping_options jsonb DEFAULT NULL
)
RETURNS TABLE (
  checkout_intent_id uuid,
  reservation_id uuid,
  orchestration_state text,
  request_replayed boolean,
  worker_lease_acquired boolean,
  worker_lease_expires_at timestamp with time zone
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  PERFORM *
  FROM public.create_or_validate_checkout_attempt(
    p_checkout_attempt_id,
    p_user_id,
    p_capability_hash
  );

  PERFORM attempts.id
  FROM public.checkout_attempts AS attempts
  WHERE attempts.id = p_checkout_attempt_id
  FOR UPDATE;

  PERFORM reservations.id
  FROM public.inventory_reservations AS reservations
  WHERE reservations.checkout_attempt_id = p_checkout_attempt_id
  FOR UPDATE;

  PERFORM intents.id
  FROM public.checkout_intents AS intents
  WHERE intents.id IN (p_replaces_checkout_intent_id)
     OR (
       intents.checkout_attempt_id = p_checkout_attempt_id
       AND (
         intents.checkout_request_id = p_checkout_request_id
         OR intents.id IN (
           SELECT attempts.active_checkout_intent_id
           FROM public.checkout_attempts AS attempts
           WHERE attempts.id = p_checkout_attempt_id
           UNION ALL
           SELECT attempts.in_flight_checkout_intent_id
           FROM public.checkout_attempts AS attempts
           WHERE attempts.id = p_checkout_attempt_id
         )
       )
     )
  ORDER BY intents.id
  FOR UPDATE;

  RETURN QUERY
  SELECT *
  FROM public.prepare_checkout_request_locked_implementation(
    p_checkout_attempt_id,
    p_checkout_request_id,
    p_user_id,
    p_capability_hash,
    p_command_fingerprint,
    p_replaces_checkout_intent_id,
    p_worker_lease_id,
    p_reservation_expires_at,
    p_snapshot,
    p_items,
    p_shipping_options
  );
END;
$function$;

ALTER FUNCTION public.fail_checkout_request(uuid, uuid, text)
  RENAME TO fail_checkout_request_locked_implementation;

REVOKE ALL ON FUNCTION public.fail_checkout_request_locked_implementation(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.fail_checkout_request(
  p_checkout_intent_id uuid,
  p_worker_lease_id uuid,
  p_failure_code text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_attempt_id uuid;
  v_attempt public.checkout_attempts%ROWTYPE;
BEGIN
  SELECT checkout_attempt_id
  INTO v_attempt_id
  FROM public.checkout_intents
  WHERE id = p_checkout_intent_id;

  IF v_attempt_id IS NULL THEN
    RAISE EXCEPTION 'Checkout request cannot be failed safely.';
  END IF;

  SELECT attempts.*
  INTO v_attempt
  FROM public.checkout_attempts AS attempts
  WHERE attempts.id = v_attempt_id
  FOR UPDATE;

  PERFORM reservations.id
  FROM public.inventory_reservations AS reservations
  WHERE reservations.checkout_attempt_id = v_attempt_id
  FOR UPDATE;

  PERFORM intents.id
  FROM public.checkout_intents AS intents
  WHERE intents.id IN (
    p_checkout_intent_id,
    v_attempt.active_checkout_intent_id,
    v_attempt.in_flight_checkout_intent_id
  )
  ORDER BY intents.id
  FOR UPDATE;

  PERFORM public.fail_checkout_request_locked_implementation(
    p_checkout_intent_id,
    p_worker_lease_id,
    p_failure_code
  );
END;
$function$;

ALTER FUNCTION public.complete_checkout_compensation(uuid, uuid)
  RENAME TO complete_checkout_compensation_locked_implementation;

REVOKE ALL ON FUNCTION public.complete_checkout_compensation_locked_implementation(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.complete_checkout_compensation(
  p_checkout_intent_id uuid,
  p_worker_lease_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_attempt_id uuid;
  v_attempt public.checkout_attempts%ROWTYPE;
BEGIN
  SELECT checkout_attempt_id
  INTO v_attempt_id
  FROM public.checkout_intents
  WHERE id = p_checkout_intent_id;

  IF v_attempt_id IS NULL THEN
    RAISE EXCEPTION 'Checkout compensation cannot be completed.';
  END IF;

  SELECT attempts.*
  INTO v_attempt
  FROM public.checkout_attempts AS attempts
  WHERE attempts.id = v_attempt_id
  FOR UPDATE;

  PERFORM reservations.id
  FROM public.inventory_reservations AS reservations
  WHERE reservations.checkout_attempt_id = v_attempt_id
  FOR UPDATE;

  PERFORM intents.id
  FROM public.checkout_intents AS intents
  WHERE intents.id IN (
    p_checkout_intent_id,
    v_attempt.active_checkout_intent_id,
    v_attempt.in_flight_checkout_intent_id
  )
  ORDER BY intents.id
  FOR UPDATE;

  PERFORM public.complete_checkout_compensation_locked_implementation(
    p_checkout_intent_id,
    p_worker_lease_id
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.activate_checkout_request(
  p_checkout_intent_id uuid,
  p_worker_lease_id uuid,
  p_confirmation_token_hash text,
  p_confirmation_token_expires_at timestamp with time zone
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_attempt_id uuid;
  v_intent public.checkout_intents%ROWTYPE;
  v_attempt public.checkout_attempts%ROWTYPE;
  v_generation integer;
  v_now timestamp with time zone := clock_timestamp();
BEGIN
  SELECT checkout_attempt_id
  INTO v_attempt_id
  FROM public.checkout_intents
  WHERE id = p_checkout_intent_id;

  IF v_attempt_id IS NULL THEN
    RAISE EXCEPTION 'Checkout request not found.';
  END IF;

  SELECT attempts.*
  INTO v_attempt
  FROM public.checkout_attempts AS attempts
  WHERE attempts.id = v_attempt_id
  FOR UPDATE;

  PERFORM reservations.id
  FROM public.inventory_reservations AS reservations
  WHERE reservations.checkout_attempt_id = v_attempt_id
  FOR UPDATE;

  PERFORM intents.id
  FROM public.checkout_intents AS intents
  WHERE intents.id IN (
    p_checkout_intent_id,
    v_attempt.active_checkout_intent_id,
    v_attempt.in_flight_checkout_intent_id
  )
  ORDER BY intents.id
  FOR UPDATE;

  SELECT intents.*
  INTO v_intent
  FROM public.checkout_intents AS intents
  WHERE intents.id = p_checkout_intent_id;

  IF v_intent.worker_lease_id IS DISTINCT FROM p_worker_lease_id
    OR v_intent.worker_lease_expires_at <= v_now THEN
    RAISE EXCEPTION 'Checkout worker lease is invalid.';
  END IF;

  IF v_attempt.in_flight_checkout_intent_id IS DISTINCT FROM v_intent.id THEN
    RAISE EXCEPTION 'Checkout request no longer owns the in-flight operation.';
  END IF;

  IF p_confirmation_token_hash IS NULL
    OR p_confirmation_token_hash !~ '^[0-9a-f]{64}$'
    OR p_confirmation_token_expires_at <= v_now THEN
    RAISE EXCEPTION 'Checkout confirmation capability is invalid.';
  END IF;

  IF v_intent.replaces_checkout_intent_id IS NULL THEN
    IF v_intent.orchestration_state <> 'session_created'
      OR v_attempt.active_checkout_intent_id IS NOT NULL THEN
      RAISE EXCEPTION 'Initial checkout activation conflict.';
    END IF;
  ELSIF v_intent.orchestration_state <> 'replacing'
    OR v_intent.predecessor_invalidated_at IS NULL
    OR v_attempt.active_checkout_intent_id IS NOT NULL THEN
    RAISE EXCEPTION 'Checkout replacement predecessor has not been invalidated.';
  END IF;

  UPDATE public.checkout_intents
  SET
    status = 'pending',
    orchestration_state = 'active',
    confirmation_token_hash = p_confirmation_token_hash,
    confirmation_token_expires_at = p_confirmation_token_expires_at,
    confirmation_generation = confirmation_generation + 1,
    orchestration_failure_code = NULL,
    orchestration_updated_at = v_now
  WHERE id = v_intent.id
  RETURNING confirmation_generation INTO v_generation;

  UPDATE public.checkout_attempts
  SET
    active_checkout_intent_id = v_intent.id,
    in_flight_checkout_intent_id = NULL,
    updated_at = v_now
  WHERE id = v_attempt.id
    AND active_checkout_intent_id IS NULL
    AND in_flight_checkout_intent_id = v_intent.id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Checkout active intent compare-and-swap failed.';
  END IF;

  RETURN v_generation;
END;
$function$;

CREATE FUNCTION public.claim_checkout_lifecycle_work(
  p_checkout_intent_id uuid,
  p_worker_lease_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_attempt_id uuid;
  v_attempt public.checkout_attempts%ROWTYPE;
  v_now timestamp with time zone := clock_timestamp();
BEGIN
  IF p_worker_lease_id IS NULL THEN
    RAISE EXCEPTION 'Checkout lifecycle worker lease ID is required.';
  END IF;

  SELECT checkout_attempt_id
  INTO v_attempt_id
  FROM public.checkout_intents
  WHERE id = p_checkout_intent_id;

  IF v_attempt_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT attempts.*
  INTO v_attempt
  FROM public.checkout_attempts AS attempts
  WHERE attempts.id = v_attempt_id
  FOR UPDATE;

  PERFORM reservations.id
  FROM public.inventory_reservations AS reservations
  WHERE reservations.checkout_attempt_id = v_attempt_id
  FOR UPDATE;

  PERFORM intents.id
  FROM public.checkout_intents AS intents
  WHERE intents.id IN (
    p_checkout_intent_id,
    v_attempt.active_checkout_intent_id,
    v_attempt.in_flight_checkout_intent_id
  )
  ORDER BY intents.id
  FOR UPDATE;

  UPDATE public.checkout_intents
  SET
    worker_lease_id = p_worker_lease_id,
    worker_lease_expires_at = v_now + interval '2 minutes',
    orchestration_updated_at = v_now
  WHERE id = p_checkout_intent_id
    AND checkout_attempt_id = v_attempt_id
    AND (
      worker_lease_id IS NULL
      OR worker_lease_expires_at <= v_now
      OR worker_lease_id = p_worker_lease_id
    );

  RETURN FOUND;
END;
$function$;

CREATE FUNCTION public.record_discovered_checkout_session(
  p_checkout_intent_id uuid,
  p_worker_lease_id uuid,
  p_stripe_checkout_session_id text,
  p_stripe_session_expires_at timestamp with time zone,
  p_shipping_rate_ids jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_attempt_id uuid;
  v_attempt public.checkout_attempts%ROWTYPE;
  v_intent public.checkout_intents%ROWTYPE;
  v_expected_count integer;
  v_updated_count integer;
  v_now timestamp with time zone := clock_timestamp();
BEGIN
  SELECT checkout_attempt_id
  INTO v_attempt_id
  FROM public.checkout_intents
  WHERE id = p_checkout_intent_id;

  IF v_attempt_id IS NULL THEN
    RAISE EXCEPTION 'Checkout request not found.';
  END IF;

  SELECT attempts.*
  INTO v_attempt
  FROM public.checkout_attempts AS attempts
  WHERE attempts.id = v_attempt_id
  FOR UPDATE;

  PERFORM reservations.id
  FROM public.inventory_reservations AS reservations
  WHERE reservations.checkout_attempt_id = v_attempt_id
  FOR UPDATE;

  PERFORM intents.id
  FROM public.checkout_intents AS intents
  WHERE intents.id IN (
    p_checkout_intent_id,
    v_attempt.active_checkout_intent_id,
    v_attempt.in_flight_checkout_intent_id
  )
  ORDER BY intents.id
  FOR UPDATE;

  SELECT intents.*
  INTO v_intent
  FROM public.checkout_intents AS intents
  WHERE intents.id = p_checkout_intent_id;

  IF v_intent.worker_lease_id IS DISTINCT FROM p_worker_lease_id
    OR v_intent.worker_lease_expires_at <= v_now
    OR v_attempt.in_flight_checkout_intent_id IS DISTINCT FROM v_intent.id
    OR v_intent.orchestration_state NOT IN ('creating_session', 'reconciliation_required')
    OR v_intent.stripe_session_params_hash IS NULL
    OR nullif(btrim(p_stripe_checkout_session_id), '') IS NULL
    OR p_stripe_session_expires_at IS DISTINCT FROM v_intent.stripe_session_expires_at THEN
    RAISE EXCEPTION 'Discovered Checkout Session cannot be recorded.';
  END IF;

  IF v_intent.stripe_checkout_session_id IS NOT NULL
    AND v_intent.stripe_checkout_session_id <> btrim(p_stripe_checkout_session_id) THEN
    RAISE EXCEPTION 'Discovered Checkout Session conflicts with the recorded request.';
  END IF;

  SELECT count(*)
  INTO v_expected_count
  FROM public.checkout_intent_shipping_options
  WHERE checkout_intent_id = v_intent.id;

  IF jsonb_typeof(p_shipping_rate_ids) <> 'array'
    OR jsonb_array_length(p_shipping_rate_ids) <> v_expected_count THEN
    RAISE EXCEPTION 'Discovered Stripe shipping rate results are incomplete.';
  END IF;

  UPDATE public.checkout_intent_shipping_options AS options
  SET stripe_shipping_rate_id = rates.value ->> 'stripe_shipping_rate_id'
  FROM jsonb_array_elements(p_shipping_rate_ids) AS rates(value)
  WHERE options.checkout_intent_id = v_intent.id
    AND options.position = (rates.value ->> 'position')::integer
    AND nullif(btrim(rates.value ->> 'stripe_shipping_rate_id'), '') IS NOT NULL;

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;

  IF v_updated_count <> v_expected_count THEN
    RAISE EXCEPTION 'Discovered Stripe shipping rate results do not match the canonical snapshot.';
  END IF;

  UPDATE public.checkout_intents
  SET
    stripe_checkout_session_id = btrim(p_stripe_checkout_session_id),
    orchestration_state = 'session_created',
    orchestration_failure_code = NULL,
    orchestration_updated_at = v_now
  WHERE id = v_intent.id;
END;
$function$;

CREATE FUNCTION public.claim_checkout_reconciliation_jobs(
  p_worker_lease_id uuid,
  p_batch_size integer DEFAULT 25
)
RETURNS TABLE (
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
  v_candidate record;
  v_now timestamp with time zone := clock_timestamp();
BEGIN
  IF p_worker_lease_id IS NULL THEN
    RAISE EXCEPTION 'Reconciliation worker lease ID is required.';
  END IF;

  IF p_batch_size < 1 OR p_batch_size > 100 THEN
    RAISE EXCEPTION 'Reconciliation batch size must be between 1 and 100.';
  END IF;

  FOR v_candidate IN
    SELECT
      reservations.checkout_attempt_id,
      COALESCE(
        attempts.in_flight_checkout_intent_id,
        attempts.active_checkout_intent_id
      ) AS checkout_intent_id,
      CASE
        WHEN reservations.status = 'payment_pending' THEN 'payment_pending_verification'
        ELSE 'overdue_reservation'
      END AS reason
    FROM public.inventory_reservations AS reservations
    JOIN public.checkout_attempts AS attempts
      ON attempts.id = reservations.checkout_attempt_id
    WHERE reservations.status IN ('held', 'payment_pending')
      AND (
        reservations.expires_at <= v_now
        OR reservations.status = 'payment_pending'
      )
    ORDER BY reservations.expires_at, reservations.checkout_attempt_id
    LIMIT p_batch_size * 2
  LOOP
    PERFORM public.enqueue_checkout_reconciliation(
      v_candidate.checkout_attempt_id,
      v_candidate.checkout_intent_id,
      NULL,
      v_candidate.reason,
      false
    );
  END LOOP;

  FOR v_candidate IN
    SELECT
      intents.checkout_attempt_id,
      intents.id AS checkout_intent_id
    FROM public.checkout_intents AS intents
    WHERE intents.checkout_protocol_version = 'reservation_v1'
      AND (
        intents.orchestration_state = 'reconciliation_required'
        OR (
          intents.orchestration_state IN (
            'creating_coupon',
            'creating_session',
            'session_created',
            'replacing',
            'compensating'
          )
          AND intents.worker_lease_expires_at <= v_now
        )
      )
    ORDER BY intents.orchestration_updated_at, intents.id
    LIMIT p_batch_size * 2
  LOOP
    PERFORM public.enqueue_checkout_reconciliation(
      v_candidate.checkout_attempt_id,
      v_candidate.checkout_intent_id,
      NULL,
      'orchestration_recovery',
      false
    );
  END LOOP;

  -- Candidate enqueueing uses clock_timestamp(); refresh the claim boundary so newly
  -- enqueued work is eligible in this same bounded claim.
  v_now := clock_timestamp();

  RETURN QUERY
  WITH claimable AS (
    SELECT jobs.id
    FROM public.checkout_reconciliation_jobs AS jobs
    WHERE (
        jobs.status = 'pending'
        OR (
          jobs.status = 'claimed'
          AND jobs.worker_lease_expires_at <= v_now
        )
      )
      AND jobs.available_at <= v_now
    ORDER BY jobs.available_at, jobs.created_at, jobs.id
    LIMIT p_batch_size
    FOR UPDATE SKIP LOCKED
  ),
  claimed AS (
    UPDATE public.checkout_reconciliation_jobs AS jobs
    SET
      status = 'claimed',
      worker_lease_id = p_worker_lease_id,
      worker_lease_expires_at = v_now + interval '2 minutes',
      attempt_count = jobs.attempt_count + 1,
      updated_at = v_now
    FROM claimable
    WHERE jobs.id = claimable.id
    RETURNING jobs.*
  )
  SELECT
    claimed.id,
    claimed.checkout_attempt_id,
    claimed.checkout_intent_id,
    claimed.lifecycle_incident_id,
    claimed.reason,
    claimed.attempt_count
  FROM claimed
  ORDER BY claimed.created_at, claimed.id;
END;
$function$;

CREATE FUNCTION public.complete_checkout_reconciliation_job(
  p_job_id uuid,
  p_worker_lease_id uuid,
  p_outcome text,
  p_error_code text DEFAULT NULL,
  p_retry_after_seconds integer DEFAULT 60
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_now timestamp with time zone := clock_timestamp();
BEGIN
  IF p_outcome NOT IN ('resolved', 'retry', 'manual_review') THEN
    RAISE EXCEPTION 'Unsupported reconciliation job outcome.';
  END IF;

  IF p_retry_after_seconds < 1 OR p_retry_after_seconds > 86400 THEN
    RAISE EXCEPTION 'Reconciliation retry delay must be between 1 and 86400 seconds.';
  END IF;

  UPDATE public.checkout_reconciliation_jobs
  SET
    status = CASE
      WHEN p_outcome = 'retry' THEN 'pending'
      ELSE p_outcome
    END,
    available_at = CASE
      WHEN p_outcome = 'retry'
        THEN v_now + make_interval(secs => p_retry_after_seconds)
      ELSE available_at
    END,
    worker_lease_id = NULL,
    worker_lease_expires_at = NULL,
    last_error_code = left(nullif(btrim(p_error_code), ''), 100),
    updated_at = v_now
  WHERE id = p_job_id
    AND status = 'claimed'
    AND worker_lease_id = p_worker_lease_id
    AND worker_lease_expires_at > v_now;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reconciliation job lease is invalid.';
  END IF;
END;
$function$;

CREATE FUNCTION public.record_checkout_lifecycle_incident(
  p_incident_type text,
  p_checkout_attempt_id uuid DEFAULT NULL,
  p_checkout_intent_id uuid DEFAULT NULL,
  p_stripe_checkout_session_id text DEFAULT NULL,
  p_payment_intent_id text DEFAULT NULL,
  p_diagnostic_details jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_incident_id uuid;
  v_incident_key text;
BEGIN
  IF p_incident_type NOT IN (
    'paid_inventory_invariant_broken',
    'paid_reservation_released',
    'paid_reservation_missing',
    'paid_reservation_cart_mismatch',
    'paid_path_conflict',
    'stripe_session_match_conflict',
    'stripe_idempotency_history_conflict',
    'stripe_session_discovery_failed',
    'finalization_integrity_conflict'
  ) THEN
    RAISE EXCEPTION 'Unsupported checkout lifecycle incident type.';
  END IF;

  IF jsonb_typeof(COALESCE(p_diagnostic_details, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'Checkout lifecycle incident details must be a JSON object.';
  END IF;

  v_incident_key := encode(
    extensions.digest(
      concat_ws(
        '|',
        p_incident_type,
        COALESCE(p_checkout_attempt_id::text, '-'),
        COALESCE(p_checkout_intent_id::text, '-'),
        COALESCE(nullif(btrim(p_stripe_checkout_session_id), ''), '-'),
        COALESCE(nullif(btrim(p_payment_intent_id), ''), '-')
      ),
      'sha256'
    ),
    'hex'
  );

  INSERT INTO public.checkout_lifecycle_incidents (
    incident_key,
    checkout_attempt_id,
    checkout_intent_id,
    stripe_checkout_session_id,
    payment_intent_id,
    incident_type,
    diagnostic_details
  )
  VALUES (
    v_incident_key,
    p_checkout_attempt_id,
    p_checkout_intent_id,
    nullif(btrim(p_stripe_checkout_session_id), ''),
    nullif(btrim(p_payment_intent_id), ''),
    p_incident_type,
    COALESCE(p_diagnostic_details, '{}'::jsonb)
  )
  ON CONFLICT (incident_key) DO UPDATE
  SET
    diagnostic_details = EXCLUDED.diagnostic_details,
    occurrence_count = public.checkout_lifecycle_incidents.occurrence_count + 1,
    status = 'open',
    last_seen_at = clock_timestamp(),
    resolved_at = NULL
  RETURNING id INTO v_incident_id;

  PERFORM public.enqueue_checkout_reconciliation(
    p_checkout_attempt_id,
    p_checkout_intent_id,
    v_incident_id,
    p_incident_type,
    true
  );

  RETURN v_incident_id;
END;
$function$;

CREATE FUNCTION public.mark_checkout_payment_pending(
  p_checkout_session_id text,
  p_payment_intent_id text DEFAULT NULL
)
RETURNS TABLE (lifecycle_outcome text, already_applied boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_attempt_id uuid;
  v_attempt public.checkout_attempts%ROWTYPE;
  v_intent public.checkout_intents%ROWTYPE;
  v_reservation public.inventory_reservations%ROWTYPE;
  v_now timestamp with time zone := clock_timestamp();
BEGIN
  IF nullif(btrim(p_checkout_session_id), '') IS NULL THEN
    RAISE EXCEPTION 'Checkout Session ID is required.';
  END IF;

  SELECT checkout_attempt_id
  INTO v_attempt_id
  FROM public.checkout_intents
  WHERE stripe_checkout_session_id = btrim(p_checkout_session_id)
    AND checkout_protocol_version = 'reservation_v1';

  IF v_attempt_id IS NULL THEN
    RAISE EXCEPTION 'Reservation checkout intent not found.';
  END IF;

  SELECT attempts.*
  INTO v_attempt
  FROM public.checkout_attempts AS attempts
  WHERE attempts.id = v_attempt_id
  FOR UPDATE;

  SELECT reservations.*
  INTO v_reservation
  FROM public.inventory_reservations AS reservations
  WHERE reservations.checkout_attempt_id = v_attempt_id
  FOR UPDATE;

  PERFORM intents.id
  FROM public.checkout_intents AS intents
  WHERE intents.id IN (
    v_attempt.active_checkout_intent_id,
    v_attempt.in_flight_checkout_intent_id
  )
    OR intents.stripe_checkout_session_id = btrim(p_checkout_session_id)
  ORDER BY intents.id
  FOR UPDATE;

  SELECT intents.*
  INTO v_intent
  FROM public.checkout_intents AS intents
  WHERE intents.stripe_checkout_session_id = btrim(p_checkout_session_id);

  IF v_intent.checkout_attempt_id IS DISTINCT FROM v_attempt.id
    OR v_reservation.id IS NULL THEN
    RAISE EXCEPTION 'Checkout payment-pending ownership is inconsistent.';
  END IF;

  IF nullif(btrim(p_payment_intent_id), '') IS NOT NULL
    AND v_intent.payment_intent_id IS NOT NULL
    AND v_intent.payment_intent_id IS DISTINCT FROM btrim(p_payment_intent_id) THEN
    RAISE EXCEPTION 'Checkout Session and PaymentIntent do not identify the same checkout.';
  END IF;

  IF v_reservation.status = 'consumed' AND v_attempt.status = 'paid' THEN
    RETURN QUERY SELECT 'already_finalized'::text, true;
    RETURN;
  END IF;

  IF v_reservation.status = 'released' THEN
    RAISE EXCEPTION 'Released inventory reservation cannot become payment pending.';
  END IF;

  IF v_attempt.active_checkout_intent_id IS DISTINCT FROM v_intent.id
    AND NOT (
      v_attempt.active_checkout_intent_id IS NULL
      AND v_attempt.in_flight_checkout_intent_id = v_intent.id
      AND v_intent.replaces_checkout_intent_id IS NOT NULL
      AND v_intent.predecessor_invalidated_at IS NOT NULL
    ) THEN
    RAISE EXCEPTION 'Checkout intent is not the legitimate current payment path.';
  END IF;

  IF v_reservation.status = 'payment_pending' AND v_attempt.status = 'payment_pending' THEN
    RETURN QUERY SELECT 'payment_pending'::text, true;
    RETURN;
  END IF;

  IF v_reservation.status <> 'held' OR v_attempt.status <> 'active' THEN
    RAISE EXCEPTION 'Checkout cannot become payment pending from its current state.';
  END IF;

  UPDATE public.inventory_reservations
  SET status = 'payment_pending', updated_at = v_now
  WHERE id = v_reservation.id;

  UPDATE public.checkout_intents
  SET
    status = 'payment_pending',
    payment_intent_id = COALESCE(
      payment_intent_id,
      nullif(btrim(p_payment_intent_id), '')
    ),
    orchestration_updated_at = v_now
  WHERE id = v_intent.id;

  UPDATE public.checkout_attempts
  SET status = 'payment_pending', updated_at = v_now
  WHERE id = v_attempt.id;

  RETURN QUERY SELECT 'payment_pending'::text, false;
END;
$function$;

CREATE FUNCTION public.transition_checkout_session_terminal(
  p_checkout_session_id text,
  p_reason text
)
RETURNS TABLE (
  lifecycle_outcome text,
  reservation_status text,
  already_applied boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_attempt_id uuid;
  v_attempt public.checkout_attempts%ROWTYPE;
  v_intent public.checkout_intents%ROWTYPE;
  v_reservation public.inventory_reservations%ROWTYPE;
  v_now timestamp with time zone := clock_timestamp();
  v_attempt_status text;
  v_intent_status text;
  v_release_reason text;
BEGIN
  IF nullif(btrim(p_checkout_session_id), '') IS NULL THEN
    RAISE EXCEPTION 'Checkout Session ID is required.';
  END IF;

  IF p_reason NOT IN ('expired_unpaid', 'async_payment_failed') THEN
    RAISE EXCEPTION 'Unsupported terminal Checkout Session reason.';
  END IF;

  SELECT checkout_attempt_id
  INTO v_attempt_id
  FROM public.checkout_intents
  WHERE stripe_checkout_session_id = btrim(p_checkout_session_id)
    AND checkout_protocol_version = 'reservation_v1';

  IF v_attempt_id IS NULL THEN
    RAISE EXCEPTION 'Reservation checkout intent not found.';
  END IF;

  SELECT attempts.*
  INTO v_attempt
  FROM public.checkout_attempts AS attempts
  WHERE attempts.id = v_attempt_id
  FOR UPDATE;

  SELECT reservations.*
  INTO v_reservation
  FROM public.inventory_reservations AS reservations
  WHERE reservations.checkout_attempt_id = v_attempt_id
  FOR UPDATE;

  PERFORM intents.id
  FROM public.checkout_intents AS intents
  WHERE intents.id IN (
    v_attempt.active_checkout_intent_id,
    v_attempt.in_flight_checkout_intent_id
  )
    OR intents.stripe_checkout_session_id = btrim(p_checkout_session_id)
  ORDER BY intents.id
  FOR UPDATE;

  SELECT intents.*
  INTO v_intent
  FROM public.checkout_intents AS intents
  WHERE intents.stripe_checkout_session_id = btrim(p_checkout_session_id);

  IF v_intent.checkout_attempt_id IS DISTINCT FROM v_attempt.id
    OR v_reservation.id IS NULL THEN
    RAISE EXCEPTION 'Terminal Checkout Session ownership is inconsistent.';
  END IF;

  IF v_reservation.status = 'consumed' THEN
    RETURN QUERY SELECT 'already_finalized'::text, 'consumed'::text, true;
    RETURN;
  END IF;

  IF v_intent.id IS DISTINCT FROM v_attempt.active_checkout_intent_id
    AND v_intent.id IS DISTINCT FROM v_attempt.in_flight_checkout_intent_id THEN
    IF v_intent.orchestration_state IN ('superseded', 'compensated', 'failed') THEN
      RETURN QUERY SELECT 'historical_noop'::text, v_reservation.status, true;
      RETURN;
    END IF;

    RAISE EXCEPTION 'Terminal Checkout Session is not owned by a current lifecycle pointer.';
  END IF;

  v_attempt_status := CASE
    WHEN p_reason = 'expired_unpaid' THEN 'expired'
    ELSE 'failed'
  END;
  v_intent_status := CASE
    WHEN p_reason = 'expired_unpaid' THEN 'expired'
    ELSE 'failed'
  END;
  v_release_reason := CASE
    WHEN p_reason = 'expired_unpaid' THEN 'stripe_session_expired_unpaid'
    ELSE 'stripe_async_payment_failed'
  END;

  IF v_attempt.active_checkout_intent_id = v_intent.id THEN
    UPDATE public.checkout_intents
    SET
      status = v_intent_status,
      orchestration_state = 'failed',
      orchestration_failure_code = p_reason,
      confirmation_token_hash = NULL,
      confirmation_token_expires_at = NULL,
      orchestration_updated_at = v_now
    WHERE id = v_intent.id;

    UPDATE public.inventory_reservations
    SET
      status = 'released',
      released_at = v_now,
      release_reason = v_release_reason,
      updated_at = v_now
    WHERE id = v_reservation.id
      AND status IN ('held', 'payment_pending');

    UPDATE public.checkout_attempts
    SET
      status = v_attempt_status,
      active_checkout_intent_id = NULL,
      in_flight_checkout_intent_id = NULL,
      completed_at = COALESCE(completed_at, v_now),
      updated_at = v_now
    WHERE id = v_attempt.id;

    RETURN QUERY SELECT v_attempt_status, 'released'::text, false;
    RETURN;
  END IF;

  IF v_intent.replaces_checkout_intent_id IS NOT NULL
    AND v_intent.predecessor_invalidated_at IS NULL
    AND v_attempt.active_checkout_intent_id IS NOT NULL THEN
    UPDATE public.checkout_intents
    SET
      status = v_intent_status,
      orchestration_state = 'compensated',
      orchestration_failure_code = p_reason,
      confirmation_token_hash = NULL,
      confirmation_token_expires_at = NULL,
      orchestration_updated_at = v_now
    WHERE id = v_intent.id;

    UPDATE public.checkout_attempts
    SET in_flight_checkout_intent_id = NULL, updated_at = v_now
    WHERE id = v_attempt.id;

    RETURN QUERY SELECT 'replacement_compensated'::text, v_reservation.status, false;
    RETURN;
  END IF;

  IF v_attempt.active_checkout_intent_id IS NULL
    AND (
      v_intent.replaces_checkout_intent_id IS NULL
      OR v_intent.predecessor_invalidated_at IS NOT NULL
    ) THEN
    UPDATE public.checkout_intents
    SET
      status = v_intent_status,
      orchestration_state = CASE
        WHEN v_intent.replaces_checkout_intent_id IS NULL THEN 'failed'
        ELSE 'compensated'
      END,
      orchestration_failure_code = p_reason,
      confirmation_token_hash = NULL,
      confirmation_token_expires_at = NULL,
      orchestration_updated_at = v_now
    WHERE id = v_intent.id;

    UPDATE public.inventory_reservations
    SET
      status = 'released',
      released_at = v_now,
      release_reason = v_release_reason,
      updated_at = v_now
    WHERE id = v_reservation.id
      AND status IN ('held', 'payment_pending');

    UPDATE public.checkout_attempts
    SET
      status = v_attempt_status,
      in_flight_checkout_intent_id = NULL,
      completed_at = COALESCE(completed_at, v_now),
      updated_at = v_now
    WHERE id = v_attempt.id;

    RETURN QUERY SELECT v_attempt_status, 'released'::text, false;
    RETURN;
  END IF;

  RAISE EXCEPTION 'Terminal Checkout Session state requires reconciliation.';
END;
$function$;

CREATE FUNCTION public.terminalize_checkout_without_session(
  p_checkout_intent_id uuid,
  p_worker_lease_id uuid,
  p_reason text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_attempt_id uuid;
  v_attempt public.checkout_attempts%ROWTYPE;
  v_intent public.checkout_intents%ROWTYPE;
  v_reservation public.inventory_reservations%ROWTYPE;
  v_now timestamp with time zone := clock_timestamp();
BEGIN
  IF p_reason <> 'hard_expiry_no_session_proven' THEN
    RAISE EXCEPTION 'Unsupported no-Session terminal reason.';
  END IF;

  SELECT checkout_attempt_id
  INTO v_attempt_id
  FROM public.checkout_intents
  WHERE id = p_checkout_intent_id;

  IF v_attempt_id IS NULL THEN
    RAISE EXCEPTION 'Checkout request not found.';
  END IF;

  SELECT attempts.*
  INTO v_attempt
  FROM public.checkout_attempts AS attempts
  WHERE attempts.id = v_attempt_id
  FOR UPDATE;

  SELECT reservations.*
  INTO v_reservation
  FROM public.inventory_reservations AS reservations
  WHERE reservations.checkout_attempt_id = v_attempt_id
  FOR UPDATE;

  PERFORM intents.id
  FROM public.checkout_intents AS intents
  WHERE intents.id IN (
    p_checkout_intent_id,
    v_attempt.active_checkout_intent_id,
    v_attempt.in_flight_checkout_intent_id
  )
  ORDER BY intents.id
  FOR UPDATE;

  SELECT intents.*
  INTO v_intent
  FROM public.checkout_intents AS intents
  WHERE intents.id = p_checkout_intent_id;

  IF v_intent.worker_lease_id IS DISTINCT FROM p_worker_lease_id
    OR v_intent.worker_lease_expires_at <= v_now
    OR v_intent.stripe_checkout_session_id IS NOT NULL
    OR v_intent.orchestration_failure_code LIKE '%idempotency_conflict'
    OR v_attempt.hard_expires_at + interval '5 minutes' > v_now
    OR v_attempt.active_checkout_intent_id IS NOT NULL
    OR v_attempt.in_flight_checkout_intent_id IS DISTINCT FROM v_intent.id
    OR v_reservation.status NOT IN ('held', 'payment_pending') THEN
    RAISE EXCEPTION 'Checkout without a Session cannot be terminalized safely.';
  END IF;

  UPDATE public.checkout_intents
  SET
    status = 'failed',
    orchestration_state = 'failed',
    orchestration_failure_code = p_reason,
    orchestration_updated_at = v_now
  WHERE id = v_intent.id;

  UPDATE public.inventory_reservations
  SET
    status = 'released',
    released_at = v_now,
    release_reason = p_reason,
    updated_at = v_now
  WHERE id = v_reservation.id;

  UPDATE public.checkout_attempts
  SET
    status = 'failed',
    in_flight_checkout_intent_id = NULL,
    completed_at = v_now,
    updated_at = v_now
  WHERE id = v_attempt.id;
END;
$function$;

ALTER FUNCTION public.finalize_paid_checkout(
  text,
  text,
  text,
  text,
  text,
  text,
  integer,
  integer
) RENAME TO finalize_legacy_paid_checkout;

REVOKE ALL ON FUNCTION public.finalize_legacy_paid_checkout(
  text,
  text,
  text,
  text,
  text,
  text,
  integer,
  integer
) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.finalize_reserved_paid_checkout(
  p_checkout_session_id text,
  p_payment_intent_id text,
  p_stripe_customer_id text,
  p_payment_method_type text,
  p_payment_brand text,
  p_payment_last4 text,
  p_payment_exp_month integer,
  p_payment_exp_year integer
)
RETURNS TABLE (
  order_id uuid,
  order_number text,
  already_finalized boolean,
  finalization_outcome text,
  incident_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_attempt_id uuid;
  v_attempt public.checkout_attempts%ROWTYPE;
  v_intent public.checkout_intents%ROWTYPE;
  v_reservation public.inventory_reservations%ROWTYPE;
  v_order public.orders%ROWTYPE;
  v_inventory_issue record;
  v_order_id uuid;
  v_order_number text;
  v_incident_id uuid;
  v_redemption_count integer;
  v_item_count integer;
  v_now timestamp with time zone := clock_timestamp();
BEGIN
  SELECT checkout_attempt_id
  INTO v_attempt_id
  FROM public.checkout_intents
  WHERE (
      nullif(btrim(p_checkout_session_id), '') IS NOT NULL
      AND stripe_checkout_session_id = btrim(p_checkout_session_id)
    )
    OR (
      nullif(btrim(p_checkout_session_id), '') IS NULL
      AND payment_intent_id = btrim(p_payment_intent_id)
    );

  IF v_attempt_id IS NULL THEN
    SELECT intents.*
    INTO v_intent
    FROM public.checkout_intents AS intents
    WHERE intents.stripe_checkout_session_id = btrim(p_checkout_session_id)
       OR intents.payment_intent_id = btrim(p_payment_intent_id)
    LIMIT 1;

    v_incident_id := public.record_checkout_lifecycle_incident(
      'paid_reservation_missing',
      NULL,
      v_intent.id,
      p_checkout_session_id,
      p_payment_intent_id,
      jsonb_build_object('reason', 'checkout_attempt_missing')
    );

    RETURN QUERY
    SELECT NULL::uuid, NULL::text, false, 'manual_review_required'::text, v_incident_id;
    RETURN;
  END IF;

  SELECT attempts.*
  INTO v_attempt
  FROM public.checkout_attempts AS attempts
  WHERE attempts.id = v_attempt_id
  FOR UPDATE;

  SELECT reservations.*
  INTO v_reservation
  FROM public.inventory_reservations AS reservations
  WHERE reservations.checkout_attempt_id = v_attempt_id
  FOR UPDATE;

  PERFORM intents.id
  FROM public.checkout_intents AS intents
  WHERE intents.checkout_attempt_id = v_attempt_id
    AND (
      intents.id IN (
        v_attempt.active_checkout_intent_id,
        v_attempt.in_flight_checkout_intent_id
      )
      OR intents.stripe_checkout_session_id = btrim(p_checkout_session_id)
      OR intents.payment_intent_id = btrim(p_payment_intent_id)
    )
  ORDER BY intents.id
  FOR UPDATE;

  SELECT intents.*
  INTO v_intent
  FROM public.checkout_intents AS intents
  WHERE intents.checkout_attempt_id = v_attempt_id
    AND (
      (
        nullif(btrim(p_checkout_session_id), '') IS NOT NULL
        AND intents.stripe_checkout_session_id = btrim(p_checkout_session_id)
      )
      OR (
        nullif(btrim(p_checkout_session_id), '') IS NULL
        AND intents.payment_intent_id = btrim(p_payment_intent_id)
      )
    );

  IF v_intent.id IS NULL
    OR v_intent.checkout_protocol_version IS DISTINCT FROM 'reservation_v1'
    OR v_intent.checkout_attempt_id IS DISTINCT FROM v_attempt.id THEN
    v_incident_id := public.record_checkout_lifecycle_incident(
      'paid_path_conflict',
      v_attempt.id,
      v_intent.id,
      p_checkout_session_id,
      p_payment_intent_id,
      jsonb_build_object('reason', 'intent_ownership_mismatch')
    );

    RETURN QUERY
    SELECT NULL::uuid, NULL::text, false, 'manual_review_required'::text, v_incident_id;
    RETURN;
  END IF;

  IF v_reservation.id IS NULL THEN
    v_incident_id := public.record_checkout_lifecycle_incident(
      'paid_reservation_missing',
      v_attempt.id,
      v_intent.id,
      p_checkout_session_id,
      p_payment_intent_id,
      jsonb_build_object('reason', 'attempt_reservation_missing')
    );

    RETURN QUERY
    SELECT NULL::uuid, NULL::text, false, 'manual_review_required'::text, v_incident_id;
    RETURN;
  END IF;

  IF nullif(btrim(p_checkout_session_id), '') IS NULL
    OR v_intent.stripe_checkout_session_id IS DISTINCT FROM btrim(p_checkout_session_id)
    OR (
      nullif(btrim(p_payment_intent_id), '') IS NOT NULL
      AND v_intent.payment_intent_id IS NOT NULL
      AND v_intent.payment_intent_id IS DISTINCT FROM btrim(p_payment_intent_id)
    ) THEN
    v_incident_id := public.record_checkout_lifecycle_incident(
      'stripe_session_match_conflict',
      v_attempt.id,
      v_intent.id,
      p_checkout_session_id,
      p_payment_intent_id,
      jsonb_build_object('reason', 'stripe_identifier_mismatch')
    );

    RETURN QUERY
    SELECT NULL::uuid, NULL::text, false, 'manual_review_required'::text, v_incident_id;
    RETURN;
  END IF;

  IF NOT public.checkout_reservation_cart_matches(v_intent.id, v_reservation.id) THEN
    v_incident_id := public.record_checkout_lifecycle_incident(
      'paid_reservation_cart_mismatch',
      v_attempt.id,
      v_intent.id,
      p_checkout_session_id,
      p_payment_intent_id,
      jsonb_build_object('reason', 'canonical_cart_mismatch')
    );

    RETURN QUERY
    SELECT NULL::uuid, NULL::text, false, 'manual_review_required'::text, v_incident_id;
    RETURN;
  END IF;

  PERFORM products.id
  FROM public.products
  WHERE products.id IN (
    SELECT items.product_id
    FROM public.inventory_reservation_items AS items
    WHERE items.reservation_id = v_reservation.id
      AND items.product_id IS NOT NULL
  )
  ORDER BY products.id
  FOR UPDATE;

  PERFORM variants.id
  FROM public.product_variants AS variants
  WHERE variants.id IN (
    SELECT items.product_variant_id
    FROM public.inventory_reservation_items AS items
    WHERE items.reservation_id = v_reservation.id
      AND items.product_variant_id IS NOT NULL
  )
  ORDER BY variants.id
  FOR UPDATE;

  SELECT orders.*
  INTO v_order
  FROM public.orders
  WHERE orders.checkout_attempt_id = v_attempt.id
     OR orders.checkout_intent_id = v_intent.id
     OR orders.stripe_checkout_session_id = v_intent.stripe_checkout_session_id
     OR (
       v_intent.payment_intent_id IS NOT NULL
       AND orders.payment_intent_id = v_intent.payment_intent_id
     )
  ORDER BY orders.id
  LIMIT 1
  FOR UPDATE;

  IF v_order.id IS NOT NULL THEN
    SELECT count(*)
    INTO v_redemption_count
    FROM public.discount_redemptions AS redemptions
    WHERE redemptions.checkout_intent_id = v_intent.id
       OR redemptions.order_id = v_order.id;

    IF v_order.checkout_attempt_id IS DISTINCT FROM v_attempt.id
      OR v_order.checkout_intent_id IS DISTINCT FROM v_intent.id
      OR v_order.stripe_checkout_session_id IS DISTINCT FROM v_intent.stripe_checkout_session_id
      OR v_order.payment_intent_id IS DISTINCT FROM v_intent.payment_intent_id
      OR v_attempt.status <> 'paid'
      OR v_intent.status <> 'paid'
      OR v_reservation.status <> 'consumed'
      OR v_reservation.order_id IS DISTINCT FROM v_order.id
      OR (
        v_intent.discount_code_id IS NOT NULL
        AND v_redemption_count <> 1
      )
      OR (
        v_intent.discount_code_id IS NULL
        AND v_redemption_count <> 0
      )
      OR EXISTS (
        (
          SELECT
            items.sku,
            items.product_type,
            items.unit_amount,
            sum(items.quantity)::bigint,
            sum(items.line_total)::bigint
          FROM public.checkout_intent_items AS items
          WHERE items.checkout_intent_id = v_intent.id
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
          WHERE items.order_id = v_order.id
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
          WHERE items.order_id = v_order.id
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
          WHERE items.checkout_intent_id = v_intent.id
          GROUP BY items.sku, items.product_type, items.unit_amount
        )
      ) THEN
      v_incident_id := public.record_checkout_lifecycle_incident(
        'finalization_integrity_conflict',
        v_attempt.id,
        v_intent.id,
        p_checkout_session_id,
        p_payment_intent_id,
        jsonb_build_object('reason', 'existing_order_replay_mismatch')
      );

      RETURN QUERY
      SELECT NULL::uuid, NULL::text, false, 'manual_review_required'::text, v_incident_id;
      RETURN;
    END IF;

    RETURN QUERY
    SELECT v_order.id, v_order.order_number, true, 'already_finalized'::text, NULL::uuid;
    RETURN;
  END IF;

  IF v_reservation.status = 'released' THEN
    v_incident_id := public.record_checkout_lifecycle_incident(
      'paid_reservation_released',
      v_attempt.id,
      v_intent.id,
      p_checkout_session_id,
      p_payment_intent_id,
      jsonb_build_object('release_reason', v_reservation.release_reason)
    );

    RETURN QUERY
    SELECT NULL::uuid, NULL::text, false, 'manual_review_required'::text, v_incident_id;
    RETURN;
  END IF;

  IF v_reservation.status NOT IN ('held', 'payment_pending') THEN
    v_incident_id := public.record_checkout_lifecycle_incident(
      'finalization_integrity_conflict',
      v_attempt.id,
      v_intent.id,
      p_checkout_session_id,
      p_payment_intent_id,
      jsonb_build_object('reason', 'reservation_state_without_order')
    );

    RETURN QUERY
    SELECT NULL::uuid, NULL::text, false, 'manual_review_required'::text, v_incident_id;
    RETURN;
  END IF;

  IF v_attempt.active_checkout_intent_id IS DISTINCT FROM v_intent.id
    AND NOT (
      v_attempt.active_checkout_intent_id IS NULL
      AND v_attempt.in_flight_checkout_intent_id = v_intent.id
      AND v_intent.replaces_checkout_intent_id IS NOT NULL
      AND v_intent.predecessor_invalidated_at IS NOT NULL
    ) THEN
    v_incident_id := public.record_checkout_lifecycle_incident(
      'paid_path_conflict',
      v_attempt.id,
      v_intent.id,
      p_checkout_session_id,
      p_payment_intent_id,
      jsonb_build_object(
        'active_checkout_intent_id', v_attempt.active_checkout_intent_id,
        'in_flight_checkout_intent_id', v_attempt.in_flight_checkout_intent_id
      )
    );

    RETURN QUERY
    SELECT NULL::uuid, NULL::text, false, 'manual_review_required'::text, v_incident_id;
    RETURN;
  END IF;

  SELECT issues.*
  INTO v_inventory_issue
  FROM (
    SELECT
      'product'::text AS resource_type,
      reservation_items.product_id AS resource_id,
      reservation_items.quantity AS reserved_quantity,
      products.inventory_quantity AS physical_quantity
    FROM public.inventory_reservation_items AS reservation_items
    JOIN public.products ON products.id = reservation_items.product_id
    WHERE reservation_items.reservation_id = v_reservation.id
      AND reservation_items.product_id IS NOT NULL
      AND products.inventory_quantity < reservation_items.quantity
    UNION ALL
    SELECT
      'variant'::text,
      reservation_items.product_variant_id,
      reservation_items.quantity,
      variants.inventory_quantity
    FROM public.inventory_reservation_items AS reservation_items
    JOIN public.product_variants AS variants
      ON variants.id = reservation_items.product_variant_id
    WHERE reservation_items.reservation_id = v_reservation.id
      AND reservation_items.product_variant_id IS NOT NULL
      AND variants.inventory_quantity < reservation_items.quantity
  ) AS issues
  ORDER BY issues.resource_type, issues.resource_id
  LIMIT 1;

  IF FOUND THEN
    v_incident_id := public.record_checkout_lifecycle_incident(
      'paid_inventory_invariant_broken',
      v_attempt.id,
      v_intent.id,
      p_checkout_session_id,
      p_payment_intent_id,
      jsonb_build_object(
        'resource_type', v_inventory_issue.resource_type,
        'resource_id', v_inventory_issue.resource_id,
        'reserved_quantity', v_inventory_issue.reserved_quantity,
        'physical_quantity', v_inventory_issue.physical_quantity
      )
    );

    RETURN QUERY
    SELECT NULL::uuid, NULL::text, false, 'manual_review_required'::text, v_incident_id;
    RETURN;
  END IF;

  UPDATE public.products AS products
  SET inventory_quantity = products.inventory_quantity - reservation_items.quantity
  FROM public.inventory_reservation_items AS reservation_items
  WHERE reservation_items.reservation_id = v_reservation.id
    AND reservation_items.product_id = products.id;

  UPDATE public.product_variants AS variants
  SET inventory_quantity = variants.inventory_quantity - reservation_items.quantity
  FROM public.inventory_reservation_items AS reservation_items
  WHERE reservation_items.reservation_id = v_reservation.id
    AND reservation_items.product_variant_id = variants.id;

  v_order_number := 'TAA-'
    || to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYYMMDD')
    || '-'
    || lpad(nextval('public.taa_order_number_seq')::text, 8, '0');

  INSERT INTO public.orders (
    user_id,
    email,
    order_number,
    stripe_payment_intent_id,
    status,
    total,
    currency,
    shipping_name,
    shipping_address,
    payment_intent_id,
    customer_email,
    subtotal_amount,
    shipping_amount,
    total_amount,
    shipping_method_name,
    shipping_phone,
    billing_name,
    billing_address,
    fulfillment_status,
    payment_method_type,
    payment_brand,
    payment_last4,
    payment_exp_month,
    payment_exp_year,
    stripe_customer_id,
    checkout_intent_id,
    stripe_checkout_session_id,
    discount_code_id,
    discount_code,
    discount_amount,
    shipping_discount_amount,
    checkout_attempt_id
  )
  VALUES (
    v_intent.user_id,
    v_intent.customer_email,
    v_order_number,
    COALESCE(nullif(btrim(p_payment_intent_id), ''), v_intent.payment_intent_id),
    'paid',
    v_intent.total_amount::numeric / 100,
    upper(v_intent.currency),
    v_intent.shipping_name,
    v_intent.shipping_address,
    COALESCE(nullif(btrim(p_payment_intent_id), ''), v_intent.payment_intent_id),
    v_intent.customer_email,
    v_intent.subtotal_amount,
    v_intent.shipping_amount,
    v_intent.total_amount,
    v_intent.shipping_method_name,
    v_intent.shipping_phone,
    v_intent.billing_name,
    v_intent.billing_address,
    'unfulfilled',
    p_payment_method_type,
    p_payment_brand,
    p_payment_last4,
    p_payment_exp_month,
    p_payment_exp_year,
    COALESCE(nullif(btrim(p_stripe_customer_id), ''), v_intent.stripe_customer_id),
    v_intent.id,
    v_intent.stripe_checkout_session_id,
    v_intent.discount_code_id,
    v_intent.discount_code,
    v_intent.discount_amount,
    v_intent.shipping_discount_amount,
    v_attempt.id
  )
  RETURNING id INTO v_order_id;

  INSERT INTO public.order_items (
    order_id,
    product_id,
    sku,
    product_name,
    quantity,
    unit_price,
    line_total,
    product_type,
    name,
    unit_amount,
    image_url,
    amount
  )
  SELECT
    v_order_id,
    COALESCE(
      items.base_product_id,
      CASE WHEN items.product_type = 'variant' THEN variants.product_id ELSE items.product_id END
    ),
    items.sku,
    COALESCE(items.product_name, items.name),
    items.quantity,
    items.unit_amount::numeric / 100,
    items.line_total::numeric / 100,
    items.product_type,
    items.name,
    items.unit_amount,
    items.image_url,
    items.amount
  FROM public.checkout_intent_items AS items
  LEFT JOIN public.product_variants AS variants
    ON items.product_type = 'variant'
    AND variants.id = items.product_id
  WHERE items.checkout_intent_id = v_intent.id
  ORDER BY items.line_position, items.id;

  GET DIAGNOSTICS v_item_count = ROW_COUNT;

  IF v_item_count = 0 THEN
    RAISE EXCEPTION 'Order items could not be created.';
  END IF;

  INSERT INTO public.discount_redemptions (
    discount_code_id,
    checkout_intent_id,
    order_id,
    user_id,
    code_snapshot,
    email_fingerprint,
    phone_fingerprint,
    shipping_address_fingerprint,
    discount_amount,
    shipping_discount_amount
  )
  SELECT
    v_intent.discount_code_id,
    v_intent.id,
    orders.id,
    orders.user_id,
    v_intent.discount_code,
    orders.customer_email_fingerprint,
    orders.shipping_phone_fingerprint,
    orders.shipping_address_fingerprint,
    v_intent.discount_amount,
    v_intent.shipping_discount_amount
  FROM public.orders
  WHERE orders.id = v_order_id
    AND v_intent.discount_code_id IS NOT NULL;

  UPDATE public.inventory_reservations
  SET
    status = 'consumed',
    consumed_at = v_now,
    order_id = v_order_id,
    updated_at = v_now
  WHERE id = v_reservation.id
    AND status IN ('held', 'payment_pending');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Inventory reservation could not be consumed.';
  END IF;

  UPDATE public.checkout_intents
  SET
    status = 'paid',
    paid_at = COALESCE(paid_at, v_now),
    payment_intent_id = COALESCE(
      payment_intent_id,
      nullif(btrim(p_payment_intent_id), '')
    ),
    stripe_customer_id = COALESCE(
      nullif(btrim(p_stripe_customer_id), ''),
      stripe_customer_id
    ),
    orchestration_state = 'paid',
    confirmation_token_hash = NULL,
    confirmation_token_expires_at = NULL,
    orchestration_updated_at = v_now
  WHERE id = v_intent.id;

  UPDATE public.checkout_attempts
  SET
    status = 'paid',
    active_checkout_intent_id = NULL,
    in_flight_checkout_intent_id = NULL,
    completed_at = COALESCE(completed_at, v_now),
    updated_at = v_now
  WHERE id = v_attempt.id;

  RETURN QUERY
  SELECT v_order_id, v_order_number, false, 'finalized'::text, NULL::uuid;
END;
$function$;

REVOKE ALL ON FUNCTION public.finalize_reserved_paid_checkout(
  text,
  text,
  text,
  text,
  text,
  text,
  integer,
  integer
) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.finalize_paid_checkout(
  p_checkout_session_id text DEFAULT NULL,
  p_payment_intent_id text DEFAULT NULL,
  p_stripe_customer_id text DEFAULT NULL,
  p_payment_method_type text DEFAULT NULL,
  p_payment_brand text DEFAULT NULL,
  p_payment_last4 text DEFAULT NULL,
  p_payment_exp_month integer DEFAULT NULL,
  p_payment_exp_year integer DEFAULT NULL
)
RETURNS TABLE (
  order_id uuid,
  order_number text,
  already_finalized boolean,
  finalization_outcome text,
  incident_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_protocol_version text;
BEGIN
  IF nullif(btrim(p_checkout_session_id), '') IS NULL
    AND nullif(btrim(p_payment_intent_id), '') IS NULL THEN
    RAISE EXCEPTION 'A Checkout Session ID or PaymentIntent ID is required.';
  END IF;

  SELECT checkout_protocol_version
  INTO v_protocol_version
  FROM public.checkout_intents
  WHERE (
      nullif(btrim(p_checkout_session_id), '') IS NOT NULL
      AND stripe_checkout_session_id = btrim(p_checkout_session_id)
    )
    OR (
      nullif(btrim(p_checkout_session_id), '') IS NULL
      AND payment_intent_id = btrim(p_payment_intent_id)
    );

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Checkout intent not found.';
  END IF;

  IF v_protocol_version IS NULL THEN
    RETURN QUERY
    SELECT
      legacy.order_id,
      legacy.order_number,
      legacy.already_finalized,
      CASE
        WHEN legacy.already_finalized THEN 'already_finalized'
        ELSE 'finalized'
      END,
      NULL::uuid
    FROM public.finalize_legacy_paid_checkout(
      p_checkout_session_id,
      p_payment_intent_id,
      p_stripe_customer_id,
      p_payment_method_type,
      p_payment_brand,
      p_payment_last4,
      p_payment_exp_month,
      p_payment_exp_year
    ) AS legacy;
    RETURN;
  END IF;

  IF v_protocol_version <> 'reservation_v1' THEN
    RAISE EXCEPTION 'Unsupported checkout protocol version.';
  END IF;

  RETURN QUERY
  SELECT *
  FROM public.finalize_reserved_paid_checkout(
    p_checkout_session_id,
    p_payment_intent_id,
    p_stripe_customer_id,
    p_payment_method_type,
    p_payment_brand,
    p_payment_last4,
    p_payment_exp_month,
    p_payment_exp_year
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.finalize_paid_checkout(
  text,
  text,
  text,
  text,
  text,
  text,
  integer,
  integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_paid_checkout(
  text,
  text,
  text,
  text,
  text,
  text,
  integer,
  integer
) TO service_role;

REVOKE ALL ON FUNCTION public.enqueue_checkout_reconciliation(uuid, uuid, uuid, text, boolean)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_checkout_lifecycle_incident(
  text,
  uuid,
  uuid,
  text,
  text,
  jsonb
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_checkout_predecessor_invalidated(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_checkout_lifecycle_work(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_discovered_checkout_session(
  uuid,
  uuid,
  text,
  timestamptz,
  jsonb
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_checkout_reconciliation_jobs(uuid, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_checkout_reconciliation_job(
  uuid,
  uuid,
  text,
  text,
  integer
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_checkout_payment_pending(text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.transition_checkout_session_terminal(text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.terminalize_checkout_without_session(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reserve_checkout_inventory(uuid, uuid, uuid, text, timestamptz, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prepare_checkout_request(
  uuid,
  uuid,
  uuid,
  text,
  text,
  uuid,
  uuid,
  timestamptz,
  jsonb,
  jsonb,
  jsonb
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.activate_checkout_request(uuid, uuid, text, timestamptz)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fail_checkout_request(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_checkout_compensation(uuid, uuid)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.enqueue_checkout_reconciliation(uuid, uuid, uuid, text, boolean)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.record_checkout_lifecycle_incident(
  text,
  uuid,
  uuid,
  text,
  text,
  jsonb
) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_checkout_predecessor_invalidated(uuid, uuid, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_checkout_lifecycle_work(uuid, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.record_discovered_checkout_session(
  uuid,
  uuid,
  text,
  timestamptz,
  jsonb
) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_checkout_reconciliation_jobs(uuid, integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_checkout_reconciliation_job(
  uuid,
  uuid,
  text,
  text,
  integer
) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_checkout_payment_pending(text, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.transition_checkout_session_terminal(text, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.terminalize_checkout_without_session(uuid, uuid, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.reserve_checkout_inventory(uuid, uuid, uuid, text, timestamptz, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.prepare_checkout_request(
  uuid,
  uuid,
  uuid,
  text,
  text,
  uuid,
  uuid,
  timestamptz,
  jsonb,
  jsonb,
  jsonb
) TO service_role;
GRANT EXECUTE ON FUNCTION public.activate_checkout_request(uuid, uuid, text, timestamptz)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_checkout_request(uuid, uuid, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_checkout_compensation(uuid, uuid)
  TO service_role;

COMMENT ON TABLE public.checkout_lifecycle_incidents IS
  'PII-free durable operational incidents for checkout lifecycle states requiring manual review.';
COMMENT ON TABLE public.checkout_reconciliation_jobs IS
  'Server-only bounded work queue for Stripe-aware checkout lifecycle reconciliation.';
COMMENT ON COLUMN public.checkout_intents.predecessor_invalidated_at IS
  'Database checkpoint recorded only after Stripe proves a replacement predecessor expired and unpaid.';
