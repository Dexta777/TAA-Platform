-- Slice 5C.1: harden active/predecessor races and paid-path finalization.

CREATE OR REPLACE FUNCTION public.record_checkout_predecessor_invalidated(
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
      AND v_predecessor.status IN ('expired', 'failed')
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

CREATE OR REPLACE FUNCTION public.transition_checkout_session_terminal(
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
  v_in_flight public.checkout_intents%ROWTYPE;
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

  IF v_attempt.active_checkout_intent_id = v_intent.id
    AND v_attempt.in_flight_checkout_intent_id IS NOT NULL
    AND v_attempt.in_flight_checkout_intent_id <> v_intent.id THEN
    SELECT intents.*
    INTO v_in_flight
    FROM public.checkout_intents AS intents
    WHERE intents.id = v_attempt.in_flight_checkout_intent_id;

    IF v_in_flight.id IS NULL
      OR v_in_flight.checkout_attempt_id IS DISTINCT FROM v_attempt.id
      OR v_in_flight.replaces_checkout_intent_id IS DISTINCT FROM v_intent.id
      OR v_in_flight.status <> 'pending'
      OR v_in_flight.orchestration_state NOT IN ('replacing', 'reconciliation_required')
      OR v_reservation.status NOT IN ('held', 'payment_pending') THEN
      UPDATE public.checkout_intents
      SET
        orchestration_state = 'reconciliation_required',
        orchestration_failure_code = 'active_terminal_in_flight_conflict',
        confirmation_token_hash = NULL,
        confirmation_token_expires_at = NULL,
        orchestration_updated_at = v_now
      WHERE id = v_intent.id;

      RETURN QUERY
      SELECT 'reconciliation_required'::text, v_reservation.status, false;
      RETURN;
    END IF;

    UPDATE public.checkout_intents
    SET
      status = v_intent_status,
      orchestration_state = 'superseded',
      orchestration_failure_code = p_reason,
      confirmation_token_hash = NULL,
      confirmation_token_expires_at = NULL,
      orchestration_updated_at = v_now
    WHERE id = v_intent.id;

    UPDATE public.checkout_intents
    SET
      predecessor_invalidated_at = COALESCE(predecessor_invalidated_at, v_now),
      orchestration_updated_at = v_now
    WHERE id = v_in_flight.id;

    UPDATE public.checkout_attempts
    SET active_checkout_intent_id = NULL, updated_at = v_now
    WHERE id = v_attempt.id
      AND active_checkout_intent_id = v_intent.id
      AND in_flight_checkout_intent_id = v_in_flight.id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Terminal predecessor compare-and-swap failed.';
    END IF;

    RETURN QUERY
    SELECT 'predecessor_invalidated'::text, v_reservation.status, false;
    RETURN;
  END IF;

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

ALTER FUNCTION public.finalize_reserved_paid_checkout(
  text,
  text,
  text,
  text,
  text,
  text,
  integer,
  integer
) RENAME TO finalize_reserved_paid_checkout_slice5c_implementation;

REVOKE ALL ON FUNCTION public.finalize_reserved_paid_checkout_slice5c_implementation(
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
  v_incident_id uuid;
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
    RETURN QUERY
    SELECT *
    FROM public.finalize_reserved_paid_checkout_slice5c_implementation(
      p_checkout_session_id,
      p_payment_intent_id,
      p_stripe_customer_id,
      p_payment_method_type,
      p_payment_brand,
      p_payment_last4,
      p_payment_exp_month,
      p_payment_exp_year
    );
    RETURN;
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

  IF v_attempt.active_checkout_intent_id = v_intent.id
    AND v_attempt.in_flight_checkout_intent_id IS NOT NULL
    AND v_attempt.in_flight_checkout_intent_id <> v_intent.id THEN
    v_incident_id := public.record_checkout_lifecycle_incident(
      'paid_path_conflict',
      v_attempt.id,
      v_intent.id,
      p_checkout_session_id,
      p_payment_intent_id,
      jsonb_build_object(
        'reason', 'paid_active_with_unresolved_replacement',
        'active_checkout_intent_id', v_attempt.active_checkout_intent_id,
        'in_flight_checkout_intent_id', v_attempt.in_flight_checkout_intent_id
      )
    );

    RETURN QUERY
    SELECT NULL::uuid, NULL::text, false, 'manual_review_required'::text, v_incident_id;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT *
  FROM public.finalize_reserved_paid_checkout_slice5c_implementation(
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

REVOKE ALL ON FUNCTION public.record_checkout_predecessor_invalidated(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.transition_checkout_session_terminal(text, text)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.record_checkout_predecessor_invalidated(uuid, uuid, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.transition_checkout_session_terminal(text, text)
  TO service_role;
