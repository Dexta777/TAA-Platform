-- Slice 5B.1: fail-closed Stripe orchestration and explicit replacement history.

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
        'reconciliation_required'
      )
    );

COMMENT ON COLUMN public.checkout_intents.confirmation_generation IS
  'Monotonic only within one checkout_intent. Stale-response checks must also bind checkout_intent_id and checkout_request_id.';

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
  v_intent public.checkout_intents%ROWTYPE;
  v_attempt public.checkout_attempts%ROWTYPE;
  v_generation integer;
  v_now timestamp with time zone := clock_timestamp();
BEGIN
  SELECT intents.* INTO v_intent
  FROM public.checkout_intents AS intents
  WHERE intents.id = p_checkout_intent_id
  FOR UPDATE;

  IF NOT FOUND
    OR v_intent.worker_lease_id IS DISTINCT FROM p_worker_lease_id
    OR v_intent.worker_lease_expires_at <= v_now THEN
    RAISE EXCEPTION 'Checkout worker lease is invalid.';
  END IF;

  SELECT attempts.* INTO v_attempt
  FROM public.checkout_attempts AS attempts
  WHERE attempts.id = v_intent.checkout_attempt_id
  FOR UPDATE;

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
  ELSE
    IF v_intent.orchestration_state <> 'replacing'
      OR v_attempt.active_checkout_intent_id IS DISTINCT FROM v_intent.replaces_checkout_intent_id THEN
      RAISE EXCEPTION 'Checkout replacement activation conflict.';
    END IF;

    UPDATE public.checkout_intents
    SET
      status = 'expired',
      orchestration_state = 'superseded',
      confirmation_token_hash = NULL,
      confirmation_token_expires_at = NULL,
      orchestration_updated_at = v_now
    WHERE id = v_intent.replaces_checkout_intent_id
      AND checkout_attempt_id = v_intent.checkout_attempt_id
      AND orchestration_state = 'active';

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Previous active checkout could not be transitioned.';
    END IF;
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
    AND active_checkout_intent_id IS NOT DISTINCT FROM v_intent.replaces_checkout_intent_id
    AND in_flight_checkout_intent_id = v_intent.id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Checkout active intent compare-and-swap failed.';
  END IF;

  RETURN v_generation;
END;
$function$;
