-- Slice 5D: browser attempt admission, reload recovery and retained paid confirmation authority.

ALTER TABLE public.checkout_attempts
  ADD COLUMN checkout_protocol_version text,
  ADD COLUMN admitted_checkout_request_id uuid,
  ADD COLUMN admitted_replaces_checkout_intent_id uuid,
  ADD COLUMN admitted_request_expires_at timestamp with time zone,
  ADD CONSTRAINT checkout_attempts_protocol_version_check
    CHECK (checkout_protocol_version IS NULL OR checkout_protocol_version = 'reservation_v1'),
  ADD CONSTRAINT checkout_attempts_admission_shape_check
    CHECK (
      (
        admitted_checkout_request_id IS NULL
        AND admitted_replaces_checkout_intent_id IS NULL
        AND admitted_request_expires_at IS NULL
      )
      OR (
        checkout_protocol_version = 'reservation_v1'
        AND admitted_checkout_request_id IS NOT NULL
        AND admitted_request_expires_at IS NOT NULL
      )
    );

UPDATE public.checkout_attempts AS attempts
SET checkout_protocol_version = 'reservation_v1'
WHERE EXISTS (
  SELECT 1
  FROM public.checkout_intents AS intents
  WHERE intents.checkout_attempt_id = attempts.id
    AND intents.checkout_protocol_version = 'reservation_v1'
);

CREATE FUNCTION public.authorize_checkout_attempt_v1(
  p_checkout_attempt_id uuid,
  p_current_user_id uuid,
  p_capability_hash text
)
RETURNS public.checkout_attempts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_attempt public.checkout_attempts%ROWTYPE;
BEGIN
  IF p_checkout_attempt_id IS NULL
    OR p_capability_hash IS NULL
    OR p_capability_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Checkout attempt identity is invalid.';
  END IF;

  SELECT attempts.*
  INTO v_attempt
  FROM public.checkout_attempts AS attempts
  WHERE attempts.id = p_checkout_attempt_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF v_attempt.capability_hash IS DISTINCT FROM p_capability_hash THEN
    RAISE EXCEPTION 'Checkout attempt identity conflict.';
  END IF;

  IF v_attempt.user_id IS NOT NULL
    AND v_attempt.user_id IS DISTINCT FROM p_current_user_id THEN
    RAISE EXCEPTION 'Checkout attempt account identity conflict.';
  END IF;

  RETURN v_attempt;
END;
$function$;

CREATE FUNCTION public.get_checkout_attempt_protocol(
  p_checkout_attempt_id uuid,
  p_current_user_id uuid,
  p_capability_hash text
)
RETURNS TABLE (
  attempt_exists boolean,
  checkout_protocol_version text,
  attempt_status text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_attempt public.checkout_attempts%ROWTYPE;
BEGIN
  v_attempt := public.authorize_checkout_attempt_v1(
    p_checkout_attempt_id,
    p_current_user_id,
    p_capability_hash
  );

  IF v_attempt.id IS NULL THEN
    RETURN QUERY SELECT false, NULL::text, NULL::text;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT true, v_attempt.checkout_protocol_version, v_attempt.status;
END;
$function$;

CREATE FUNCTION public.admit_checkout_request_v1(
  p_checkout_attempt_id uuid,
  p_checkout_request_id uuid,
  p_current_user_id uuid,
  p_capability_hash text,
  p_replace_checkout_session_id text DEFAULT NULL
)
RETURNS TABLE (
  attempt_status text,
  hard_expires_at timestamp with time zone,
  active_checkout_intent_id uuid,
  in_flight_checkout_intent_id uuid,
  replacement_checkout_intent_id uuid,
  existing_checkout_intent_id uuid,
  existing_command_fingerprint text,
  existing_orchestration_state text,
  admission_state text,
  bound_user_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_attempt public.checkout_attempts%ROWTYPE;
  v_existing public.checkout_intents%ROWTYPE;
  v_replacement_id uuid;
  v_now timestamp with time zone := clock_timestamp();
BEGIN
  IF p_checkout_attempt_id IS NULL OR p_checkout_request_id IS NULL THEN
    RAISE EXCEPTION 'Checkout attempt and request IDs are required.';
  END IF;

  IF p_capability_hash IS NULL OR p_capability_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Checkout attempt identity is invalid.';
  END IF;

  INSERT INTO public.checkout_attempts (
    id,
    user_id,
    capability_hash,
    capability_expires_at,
    status,
    hard_expires_at,
    checkout_protocol_version,
    created_at,
    updated_at
  )
  VALUES (
    p_checkout_attempt_id,
    p_current_user_id,
    p_capability_hash,
    v_now + interval '2 hours',
    'active',
    v_now + interval '2 hours',
    'reservation_v1',
    v_now,
    v_now
  )
  ON CONFLICT (id) DO NOTHING;

  v_attempt := public.authorize_checkout_attempt_v1(
    p_checkout_attempt_id,
    p_current_user_id,
    p_capability_hash
  );

  IF v_attempt.id IS NULL THEN
    RAISE EXCEPTION 'Checkout attempt could not be created or loaded.';
  END IF;

  IF v_attempt.checkout_protocol_version IS DISTINCT FROM 'reservation_v1' THEN
    RAISE EXCEPTION 'Checkout attempt protocol conflict.';
  END IF;

  IF nullif(btrim(p_replace_checkout_session_id), '') IS NOT NULL THEN
    SELECT intents.id
    INTO v_replacement_id
    FROM public.checkout_intents AS intents
    WHERE intents.checkout_attempt_id = p_checkout_attempt_id
      AND intents.stripe_checkout_session_id = btrim(p_replace_checkout_session_id);

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Checkout replacement target is invalid.';
    END IF;
  END IF;

  SELECT intents.*
  INTO v_existing
  FROM public.checkout_intents AS intents
  WHERE intents.checkout_attempt_id = p_checkout_attempt_id
    AND intents.checkout_request_id = p_checkout_request_id;

  IF v_existing.id IS NOT NULL THEN
    RETURN QUERY
    SELECT
      v_attempt.status,
      date_trunc('second', v_attempt.hard_expires_at),
      v_attempt.active_checkout_intent_id,
      v_attempt.in_flight_checkout_intent_id,
      v_replacement_id,
      v_existing.id,
      v_existing.command_fingerprint,
      v_existing.orchestration_state,
      'materialized'::text,
      v_attempt.user_id;
    RETURN;
  END IF;

  IF v_attempt.status <> 'active' OR v_attempt.hard_expires_at <= v_now THEN
    RAISE EXCEPTION 'Checkout attempt is no longer active.';
  END IF;

  IF v_attempt.admitted_checkout_request_id IS NOT NULL THEN
    IF v_attempt.admitted_checkout_request_id = p_checkout_request_id
      AND v_attempt.admitted_replaces_checkout_intent_id IS NOT DISTINCT FROM v_replacement_id THEN
      RETURN QUERY
      SELECT
        v_attempt.status,
        date_trunc('second', v_attempt.hard_expires_at),
        v_attempt.active_checkout_intent_id,
        v_attempt.in_flight_checkout_intent_id,
        v_replacement_id,
        NULL::uuid,
        NULL::text,
        NULL::text,
        CASE
          WHEN v_attempt.admitted_request_expires_at > v_now THEN 'admitted'
          ELSE 'request_not_materialized'
        END,
        v_attempt.user_id;
      RETURN;
    END IF;

    RAISE EXCEPTION 'Checkout attempt already has an unresolved admitted request.';
  END IF;

  IF v_attempt.in_flight_checkout_intent_id IS NOT NULL THEN
    RAISE EXCEPTION 'Checkout attempt already has an unresolved operation.';
  END IF;

  IF v_replacement_id IS NULL THEN
    IF v_attempt.active_checkout_intent_id IS NOT NULL THEN
      RAISE EXCEPTION 'A checkout replacement target is required.';
    END IF;
  ELSIF v_attempt.active_checkout_intent_id IS DISTINCT FROM v_replacement_id THEN
    RAISE EXCEPTION 'Checkout replacement target is not the active intent.';
  END IF;

  UPDATE public.checkout_attempts
  SET
    admitted_checkout_request_id = p_checkout_request_id,
    admitted_replaces_checkout_intent_id = v_replacement_id,
    admitted_request_expires_at = v_now + interval '2 minutes',
    updated_at = v_now
  WHERE id = v_attempt.id;

  RETURN QUERY
  SELECT
    v_attempt.status,
    date_trunc('second', v_attempt.hard_expires_at),
    v_attempt.active_checkout_intent_id,
    v_attempt.in_flight_checkout_intent_id,
    v_replacement_id,
    NULL::uuid,
    NULL::text,
    NULL::text,
    'admitted'::text,
    v_attempt.user_id;
END;
$function$;

CREATE FUNCTION public.consume_checkout_request_admission_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_attempt public.checkout_attempts%ROWTYPE;
BEGIN
  IF NEW.checkout_protocol_version IS DISTINCT FROM 'reservation_v1' THEN
    RETURN NEW;
  END IF;

  SELECT attempts.*
  INTO v_attempt
  FROM public.checkout_attempts AS attempts
  WHERE attempts.id = NEW.checkout_attempt_id
  FOR UPDATE;

  -- Pre-Slice-5D fixtures and already-running attempts have no attempt marker.
  IF v_attempt.checkout_protocol_version IS NULL THEN
    RETURN NEW;
  END IF;

  IF v_attempt.checkout_protocol_version <> 'reservation_v1'
    OR v_attempt.admitted_checkout_request_id IS DISTINCT FROM NEW.checkout_request_id
    OR v_attempt.admitted_replaces_checkout_intent_id
      IS DISTINCT FROM NEW.replaces_checkout_intent_id
    OR v_attempt.admitted_request_expires_at <= clock_timestamp() THEN
    RAISE EXCEPTION 'Checkout request admission is invalid or expired.';
  END IF;

  UPDATE public.checkout_attempts
  SET
    admitted_checkout_request_id = NULL,
    admitted_replaces_checkout_intent_id = NULL,
    admitted_request_expires_at = NULL,
    updated_at = clock_timestamp()
  WHERE id = v_attempt.id;

  RETURN NEW;
END;
$function$;

CREATE TRIGGER consume_checkout_request_admission_v1_before_insert
BEFORE INSERT ON public.checkout_intents
FOR EACH ROW
EXECUTE FUNCTION public.consume_checkout_request_admission_v1();

REVOKE ALL ON FUNCTION public.consume_checkout_request_admission_v1() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.consume_checkout_request_admission_v1() FROM anon;
REVOKE ALL ON FUNCTION public.consume_checkout_request_admission_v1() FROM authenticated;

CREATE FUNCTION public.cancel_checkout_request_admission_v1(
  p_checkout_attempt_id uuid,
  p_checkout_request_id uuid,
  p_current_user_id uuid,
  p_capability_hash text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_attempt public.checkout_attempts%ROWTYPE;
BEGIN
  v_attempt := public.authorize_checkout_attempt_v1(
    p_checkout_attempt_id,
    p_current_user_id,
    p_capability_hash
  );

  IF v_attempt.id IS NULL
    OR v_attempt.checkout_protocol_version IS DISTINCT FROM 'reservation_v1' THEN
    RETURN false;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.checkout_intents AS intents
    WHERE intents.checkout_attempt_id = v_attempt.id
      AND intents.checkout_request_id = p_checkout_request_id
  ) THEN
    RETURN false;
  END IF;

  UPDATE public.checkout_attempts
  SET
    admitted_checkout_request_id = NULL,
    admitted_replaces_checkout_intent_id = NULL,
    admitted_request_expires_at = NULL,
    updated_at = clock_timestamp()
  WHERE id = v_attempt.id
    AND admitted_checkout_request_id = p_checkout_request_id;

  RETURN FOUND;
END;
$function$;

CREATE FUNCTION public.resume_checkout_request_v1(
  p_checkout_attempt_id uuid,
  p_checkout_request_id uuid,
  p_current_user_id uuid,
  p_capability_hash text,
  p_worker_lease_id uuid
)
RETURNS TABLE (
  resume_state text,
  attempt_status text,
  checkout_intent_id uuid,
  checkout_session_id text,
  orchestration_state text,
  worker_lease_acquired boolean,
  worker_lease_expires_at timestamp with time zone
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_attempt public.checkout_attempts%ROWTYPE;
  v_intent public.checkout_intents%ROWTYPE;
  v_now timestamp with time zone := clock_timestamp();
  v_lease_acquired boolean := false;
BEGIN
  IF p_checkout_request_id IS NULL OR p_worker_lease_id IS NULL THEN
    RAISE EXCEPTION 'Checkout request and worker lease IDs are required.';
  END IF;

  v_attempt := public.authorize_checkout_attempt_v1(
    p_checkout_attempt_id,
    p_current_user_id,
    p_capability_hash
  );

  IF v_attempt.id IS NULL
    OR v_attempt.checkout_protocol_version IS DISTINCT FROM 'reservation_v1' THEN
    RETURN QUERY
    SELECT 'checkout_request_not_found', NULL::text, NULL::uuid, NULL::text,
      NULL::text, false, NULL::timestamp with time zone;
    RETURN;
  END IF;

  SELECT intents.*
  INTO v_intent
  FROM public.checkout_intents AS intents
  WHERE intents.checkout_attempt_id = v_attempt.id
    AND intents.checkout_request_id = p_checkout_request_id
  FOR UPDATE;

  IF v_intent.id IS NULL THEN
    IF v_attempt.admitted_checkout_request_id IS DISTINCT FROM p_checkout_request_id THEN
      RETURN QUERY
      SELECT 'checkout_request_not_found', v_attempt.status, NULL::uuid, NULL::text,
        NULL::text, false, NULL::timestamp with time zone;
    ELSIF v_attempt.admitted_request_expires_at > v_now THEN
      RETURN QUERY
      SELECT 'operation_in_progress', v_attempt.status, NULL::uuid, NULL::text,
        NULL::text, false, v_attempt.admitted_request_expires_at;
    ELSE
      RETURN QUERY
      SELECT 'request_not_materialized', v_attempt.status, NULL::uuid, NULL::text,
        NULL::text, false, v_attempt.admitted_request_expires_at;
    END IF;
    RETURN;
  END IF;

  IF v_attempt.status = 'paid' OR v_intent.status = 'paid' THEN
    RETURN QUERY
    SELECT 'paid', v_attempt.status, v_intent.id, v_intent.stripe_checkout_session_id,
      v_intent.orchestration_state, false, NULL::timestamp with time zone;
    RETURN;
  END IF;

  IF v_attempt.status = 'payment_pending' OR v_intent.status = 'payment_pending' THEN
    RETURN QUERY
    SELECT 'payment_pending', v_attempt.status, v_intent.id,
      v_intent.stripe_checkout_session_id, v_intent.orchestration_state, false,
      NULL::timestamp with time zone;
    RETURN;
  END IF;

  IF v_intent.orchestration_state = 'reconciliation_required' THEN
    RETURN QUERY
    SELECT 'reconciliation_required', v_attempt.status, v_intent.id,
      v_intent.stripe_checkout_session_id, v_intent.orchestration_state, false,
      NULL::timestamp with time zone;
    RETURN;
  END IF;

  IF v_intent.orchestration_state IN ('failed', 'compensated', 'superseded')
    OR v_attempt.status NOT IN ('active', 'payment_pending') THEN
    RETURN QUERY
    SELECT 'checkout_attempt_terminal', v_attempt.status, v_intent.id,
      v_intent.stripe_checkout_session_id, v_intent.orchestration_state, false,
      NULL::timestamp with time zone;
    RETURN;
  END IF;

  IF v_intent.worker_lease_id IS NULL
    OR v_intent.worker_lease_expires_at <= v_now
    OR v_intent.worker_lease_id = p_worker_lease_id THEN
    UPDATE public.checkout_intents
    SET
      worker_lease_id = p_worker_lease_id,
      worker_lease_expires_at = v_now + interval '2 minutes',
      orchestration_updated_at = v_now
    WHERE id = v_intent.id
    RETURNING * INTO v_intent;

    v_lease_acquired := true;
  END IF;

  RETURN QUERY
  SELECT
    CASE WHEN v_lease_acquired THEN 'resumable' ELSE 'operation_in_progress' END,
    v_attempt.status,
    v_intent.id,
    v_intent.stripe_checkout_session_id,
    v_intent.orchestration_state,
    v_lease_acquired,
    v_intent.worker_lease_expires_at;
END;
$function$;

CREATE FUNCTION public.get_checkout_attempt_abandonment_context_v1(
  p_checkout_attempt_id uuid,
  p_current_user_id uuid,
  p_capability_hash text
)
RETURNS TABLE (
  context_state text,
  attempt_status text,
  active_checkout_intent_id uuid,
  active_checkout_request_id uuid,
  active_checkout_session_id text,
  in_flight_checkout_intent_id uuid,
  in_flight_checkout_request_id uuid,
  in_flight_checkout_session_id text,
  admission_active boolean,
  reservation_status text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_attempt public.checkout_attempts%ROWTYPE;
  v_reservation_status text;
  v_active_session text;
  v_active_request_id uuid;
  v_in_flight_session text;
  v_in_flight_request_id uuid;
BEGIN
  v_attempt := public.authorize_checkout_attempt_v1(
    p_checkout_attempt_id,
    p_current_user_id,
    p_capability_hash
  );

  IF v_attempt.id IS NULL THEN
    RETURN QUERY
    SELECT 'attempt_not_found', NULL::text, NULL::uuid, NULL::uuid, NULL::text,
      NULL::uuid, NULL::uuid, NULL::text, false, NULL::text;
    RETURN;
  END IF;

  SELECT reservations.status
  INTO v_reservation_status
  FROM public.inventory_reservations AS reservations
  WHERE reservations.checkout_attempt_id = v_attempt.id
  FOR UPDATE;

  SELECT intents.checkout_request_id, intents.stripe_checkout_session_id
  INTO v_active_request_id, v_active_session
  FROM public.checkout_intents AS intents
  WHERE intents.id = v_attempt.active_checkout_intent_id;

  SELECT intents.checkout_request_id, intents.stripe_checkout_session_id
  INTO v_in_flight_request_id, v_in_flight_session
  FROM public.checkout_intents AS intents
  WHERE intents.id = v_attempt.in_flight_checkout_intent_id;

  RETURN QUERY
  SELECT
    CASE
      WHEN v_attempt.status = 'paid' THEN 'already_paid'
      WHEN v_attempt.status IN ('expired', 'failed') THEN 'already_terminal'
      WHEN v_attempt.status = 'payment_pending' THEN 'reconciliation_pending'
      WHEN v_attempt.in_flight_checkout_intent_id IS NOT NULL THEN 'reconciliation_pending'
      WHEN v_attempt.active_checkout_intent_id IS NOT NULL THEN 'active_session'
      WHEN v_attempt.admitted_checkout_request_id IS NOT NULL
        AND v_attempt.admitted_request_expires_at > clock_timestamp()
        THEN 'operation_in_progress'
      ELSE 'safe_unmaterialized'
    END,
    v_attempt.status,
    v_attempt.active_checkout_intent_id,
    v_active_request_id,
    v_active_session,
    v_attempt.in_flight_checkout_intent_id,
    v_in_flight_request_id,
    v_in_flight_session,
    v_attempt.admitted_checkout_request_id IS NOT NULL
      AND v_attempt.admitted_request_expires_at > clock_timestamp(),
    v_reservation_status;
END;
$function$;

CREATE FUNCTION public.terminalize_unmaterialized_checkout_attempt_v1(
  p_checkout_attempt_id uuid,
  p_current_user_id uuid,
  p_capability_hash text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_attempt public.checkout_attempts%ROWTYPE;
  v_now timestamp with time zone := clock_timestamp();
BEGIN
  v_attempt := public.authorize_checkout_attempt_v1(
    p_checkout_attempt_id,
    p_current_user_id,
    p_capability_hash
  );

  IF v_attempt.id IS NULL THEN
    RETURN false;
  END IF;

  IF v_attempt.status IN ('expired', 'failed') THEN
    RETURN true;
  END IF;

  IF v_attempt.status <> 'active'
    OR v_attempt.active_checkout_intent_id IS NOT NULL
    OR v_attempt.in_flight_checkout_intent_id IS NOT NULL
    OR (
      v_attempt.admitted_checkout_request_id IS NOT NULL
      AND v_attempt.admitted_request_expires_at > v_now
    )
    OR EXISTS (
      SELECT 1 FROM public.checkout_intents AS intents
      WHERE intents.checkout_attempt_id = v_attempt.id
    )
    OR EXISTS (
      SELECT 1 FROM public.inventory_reservations AS reservations
      WHERE reservations.checkout_attempt_id = v_attempt.id
    ) THEN
    RETURN false;
  END IF;

  UPDATE public.checkout_attempts
  SET
    status = 'failed',
    admitted_checkout_request_id = NULL,
    admitted_replaces_checkout_intent_id = NULL,
    admitted_request_expires_at = NULL,
    completed_at = v_now,
    updated_at = v_now
  WHERE id = v_attempt.id;

  RETURN true;
END;
$function$;

ALTER FUNCTION public.finalize_reserved_paid_checkout(
  text, text, text, text, text, text, integer, integer
) RENAME TO finalize_reserved_paid_checkout_slice5d_implementation;

REVOKE ALL ON FUNCTION public.finalize_reserved_paid_checkout_slice5d_implementation(
  text, text, text, text, text, text, integer, integer
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
  v_intent public.checkout_intents%ROWTYPE;
  v_result record;
  v_confirmation_token_hash text;
  v_confirmation_token_expires_at timestamp with time zone;
  v_confirmation_generation integer;
BEGIN
  SELECT checkout_attempt_id
  INTO v_attempt_id
  FROM public.checkout_intents
  WHERE stripe_checkout_session_id = nullif(btrim(p_checkout_session_id), '')
     OR (
       nullif(btrim(p_checkout_session_id), '') IS NULL
       AND payment_intent_id = nullif(btrim(p_payment_intent_id), '')
     );

  IF v_attempt_id IS NOT NULL THEN
    PERFORM attempts.id
    FROM public.checkout_attempts AS attempts
    WHERE attempts.id = v_attempt_id
    FOR UPDATE;

    PERFORM reservations.id
    FROM public.inventory_reservations AS reservations
    WHERE reservations.checkout_attempt_id = v_attempt_id
    FOR UPDATE;

    PERFORM intents.id
    FROM public.checkout_intents AS intents
    WHERE intents.checkout_attempt_id = v_attempt_id
    ORDER BY intents.id
    FOR UPDATE;

    SELECT intents.*
    INTO v_intent
    FROM public.checkout_intents AS intents
    WHERE intents.checkout_attempt_id = v_attempt_id
      AND (
        intents.stripe_checkout_session_id = nullif(btrim(p_checkout_session_id), '')
        OR (
          nullif(btrim(p_checkout_session_id), '') IS NULL
          AND intents.payment_intent_id = nullif(btrim(p_payment_intent_id), '')
        )
      );

    IF v_intent.confirmation_token_hash IS NOT NULL
      AND v_intent.confirmation_token_expires_at > clock_timestamp() THEN
      v_confirmation_token_hash := v_intent.confirmation_token_hash;
      v_confirmation_token_expires_at := v_intent.confirmation_token_expires_at;
      v_confirmation_generation := v_intent.confirmation_generation;
    END IF;
  END IF;

  SELECT *
  INTO v_result
  FROM public.finalize_reserved_paid_checkout_slice5d_implementation(
    p_checkout_session_id,
    p_payment_intent_id,
    p_stripe_customer_id,
    p_payment_method_type,
    p_payment_brand,
    p_payment_last4,
    p_payment_exp_month,
    p_payment_exp_year
  );

  IF v_result.order_id IS NOT NULL AND v_confirmation_token_hash IS NOT NULL THEN
    UPDATE public.checkout_intents
    SET
      confirmation_token_hash = v_confirmation_token_hash,
      confirmation_token_expires_at = v_confirmation_token_expires_at,
      confirmation_generation = v_confirmation_generation
    WHERE id = v_intent.id
      AND status = 'paid';
  END IF;

  RETURN QUERY
  SELECT
    v_result.order_id,
    v_result.order_number,
    v_result.already_finalized,
    v_result.finalization_outcome,
    v_result.incident_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.authorize_checkout_attempt_v1(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_checkout_attempt_protocol(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admit_checkout_request_v1(uuid, uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cancel_checkout_request_admission_v1(uuid, uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.resume_checkout_request_v1(uuid, uuid, uuid, text, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_checkout_attempt_abandonment_context_v1(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.terminalize_unmaterialized_checkout_attempt_v1(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finalize_reserved_paid_checkout(
  text, text, text, text, text, text, integer, integer
) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.authorize_checkout_attempt_v1(uuid, uuid, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.get_checkout_attempt_protocol(uuid, uuid, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.admit_checkout_request_v1(uuid, uuid, uuid, text, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_checkout_request_admission_v1(uuid, uuid, uuid, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.resume_checkout_request_v1(uuid, uuid, uuid, text, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.get_checkout_attempt_abandonment_context_v1(uuid, uuid, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.terminalize_unmaterialized_checkout_attempt_v1(uuid, uuid, text)
  TO service_role;
