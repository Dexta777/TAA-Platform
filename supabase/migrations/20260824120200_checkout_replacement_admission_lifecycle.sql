-- Permit a new checkout replacement after an expired, durably completed admission.

CREATE OR REPLACE FUNCTION public.admit_checkout_request_v1(
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
  v_admitted_request_completed boolean := false;
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

    IF v_attempt.admitted_request_expires_at <= v_now THEN
      SELECT EXISTS (
        SELECT 1
        FROM public.checkout_intents AS intents
        WHERE intents.checkout_attempt_id = v_attempt.id
          AND intents.checkout_request_id = v_attempt.admitted_checkout_request_id
          AND intents.replaces_checkout_intent_id
            IS NOT DISTINCT FROM v_attempt.admitted_replaces_checkout_intent_id
          AND (
            (
              intents.orchestration_state = 'active'
              AND intents.status = 'pending'
              AND intents.stripe_checkout_session_id IS NOT NULL
              AND v_attempt.active_checkout_intent_id = intents.id
            )
            OR (
              intents.orchestration_state IN ('failed', 'compensated', 'superseded')
              AND intents.status IN ('failed', 'expired')
            )
          )
      )
      INTO v_admitted_request_completed;
    END IF;

    IF NOT v_admitted_request_completed THEN
      RAISE EXCEPTION 'Checkout attempt already has an unresolved admitted request.';
    END IF;
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

REVOKE ALL ON FUNCTION public.admit_checkout_request_v1(uuid, uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.admit_checkout_request_v1(uuid, uuid, uuid, text, text)
  TO service_role;
