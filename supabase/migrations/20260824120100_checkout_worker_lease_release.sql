-- Release browser-orchestration leases when their successful transition has completed.

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
    worker_lease_id = NULL,
    worker_lease_expires_at = NULL,
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

CREATE OR REPLACE FUNCTION public.rotate_checkout_confirmation_capability(
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
  v_generation integer;
  v_now timestamp with time zone := clock_timestamp();
BEGIN
  UPDATE public.checkout_intents AS intents
  SET
    confirmation_token_hash = p_confirmation_token_hash,
    confirmation_token_expires_at = p_confirmation_token_expires_at,
    confirmation_generation = intents.confirmation_generation + 1,
    worker_lease_id = NULL,
    worker_lease_expires_at = NULL,
    orchestration_updated_at = v_now
  FROM public.checkout_attempts AS attempts
  WHERE intents.id = p_checkout_intent_id
    AND intents.checkout_attempt_id = attempts.id
    AND intents.orchestration_state = 'active'
    AND attempts.active_checkout_intent_id = intents.id
    AND intents.worker_lease_id = p_worker_lease_id
    AND intents.worker_lease_expires_at > v_now
    AND p_confirmation_token_hash ~ '^[0-9a-f]{64}$'
    AND p_confirmation_token_expires_at > v_now
  RETURNING intents.confirmation_generation INTO v_generation;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active checkout confirmation capability could not be rotated.';
  END IF;

  RETURN v_generation;
END;
$function$;

REVOKE ALL ON FUNCTION public.activate_checkout_request(uuid, uuid, text, timestamptz)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rotate_checkout_confirmation_capability(uuid, uuid, text, timestamptz)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.activate_checkout_request(uuid, uuid, text, timestamptz)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.rotate_checkout_confirmation_capability(uuid, uuid, text, timestamptz)
  TO service_role;
