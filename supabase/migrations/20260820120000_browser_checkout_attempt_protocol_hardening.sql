-- Slice 5D.1: harden raw attempt capability expiry and reservation-aware abandonment.

CREATE OR REPLACE FUNCTION public.authorize_checkout_attempt_v1(
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

  IF v_attempt.capability_expires_at <= clock_timestamp() THEN
    RAISE EXCEPTION 'Checkout attempt capability has expired.';
  END IF;

  IF v_attempt.user_id IS NOT NULL
    AND v_attempt.user_id IS DISTINCT FROM p_current_user_id THEN
    RAISE EXCEPTION 'Checkout attempt account identity conflict.';
  END IF;

  RETURN v_attempt;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_checkout_attempt_abandonment_context_v1(
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
      WHEN v_attempt.status IN ('expired', 'failed')
        AND (v_reservation_status IS NULL OR v_reservation_status = 'released')
        THEN 'already_terminal'
      WHEN v_attempt.status IN ('expired', 'failed')
        AND v_reservation_status = 'consumed'
        THEN 'integrity_review'
      WHEN v_attempt.status IN ('expired', 'failed') THEN 'reconciliation_pending'
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

CREATE OR REPLACE FUNCTION public.terminalize_unmaterialized_checkout_attempt_v1(
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
  v_reservation_status text;
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

  SELECT reservations.status
  INTO v_reservation_status
  FROM public.inventory_reservations AS reservations
  WHERE reservations.checkout_attempt_id = v_attempt.id
  FOR UPDATE;

  IF v_attempt.status IN ('expired', 'failed') THEN
    RETURN v_reservation_status IS NULL OR v_reservation_status = 'released';
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
    OR v_reservation_status IS NOT NULL THEN
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

REVOKE ALL ON FUNCTION public.authorize_checkout_attempt_v1(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_checkout_attempt_abandonment_context_v1(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.terminalize_unmaterialized_checkout_attempt_v1(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.authorize_checkout_attempt_v1(uuid, uuid, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.get_checkout_attempt_abandonment_context_v1(uuid, uuid, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.terminalize_unmaterialized_checkout_attempt_v1(uuid, uuid, text)
  TO service_role;
