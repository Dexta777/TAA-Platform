-- Slice 5B: durable Checkout request orchestration and Stripe operation fencing.

ALTER TABLE public.checkout_attempts
  ADD COLUMN in_flight_checkout_intent_id uuid,
  ADD CONSTRAINT checkout_attempts_distinct_intent_pointers_check
    CHECK (
      active_checkout_intent_id IS NULL
      OR in_flight_checkout_intent_id IS NULL
      OR active_checkout_intent_id <> in_flight_checkout_intent_id
    );

ALTER TABLE public.checkout_intents
  ADD COLUMN checkout_protocol_version text,
  ADD COLUMN orchestration_state text,
  ADD COLUMN orchestration_failure_code text,
  ADD COLUMN orchestration_updated_at timestamp with time zone,
  ADD COLUMN worker_lease_id uuid,
  ADD COLUMN worker_lease_expires_at timestamp with time zone,
  ADD COLUMN stripe_return_url text,
  ADD COLUMN stripe_session_expires_at timestamp with time zone,
  ADD COLUMN discount_name text,
  ADD COLUMN discount_type text,
  ADD COLUMN stripe_coupon_params_hash text,
  ADD COLUMN stripe_session_params_hash text,
  ADD COLUMN confirmation_generation integer NOT NULL DEFAULT 0,
  ADD CONSTRAINT checkout_intents_protocol_version_check
    CHECK (checkout_protocol_version IS NULL OR checkout_protocol_version = 'reservation_v1'),
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
        'compensating',
        'compensated',
        'failed',
        'reconciliation_required'
      )
    ),
  ADD CONSTRAINT checkout_intents_protocol_state_check
    CHECK (
      (checkout_protocol_version IS NULL AND orchestration_state IS NULL)
      OR (checkout_protocol_version = 'reservation_v1' AND orchestration_state IS NOT NULL)
    ),
  ADD CONSTRAINT checkout_intents_worker_lease_check
    CHECK (num_nonnulls(worker_lease_id, worker_lease_expires_at) IN (0, 2)),
  ADD CONSTRAINT checkout_intents_coupon_params_hash_check
    CHECK (
      stripe_coupon_params_hash IS NULL
      OR stripe_coupon_params_hash ~ '^[0-9a-f]{64}$'
    ),
  ADD CONSTRAINT checkout_intents_session_params_hash_check
    CHECK (
      stripe_session_params_hash IS NULL
      OR stripe_session_params_hash ~ '^[0-9a-f]{64}$'
    ),
  ADD CONSTRAINT checkout_intents_confirmation_generation_check
    CHECK (confirmation_generation >= 0),
  ADD CONSTRAINT checkout_intents_discount_type_check
    CHECK (
      discount_type IS NULL
      OR discount_type IN ('percentage', 'fixed', 'free_shipping')
    );

ALTER TABLE public.checkout_attempts
  ADD CONSTRAINT checkout_attempts_in_flight_intent_attempt_fkey
    FOREIGN KEY (in_flight_checkout_intent_id, id)
    REFERENCES public.checkout_intents(id, checkout_attempt_id)
    ON DELETE RESTRICT;

CREATE INDEX checkout_attempts_in_flight_checkout_intent_id_idx
  ON public.checkout_attempts (in_flight_checkout_intent_id)
  WHERE in_flight_checkout_intent_id IS NOT NULL;

ALTER TABLE public.checkout_intent_items
  ADD COLUMN line_position integer,
  ADD CONSTRAINT checkout_intent_items_line_position_check
    CHECK (line_position IS NULL OR line_position >= 0);

CREATE UNIQUE INDEX checkout_intent_items_position_key
  ON public.checkout_intent_items (checkout_intent_id, line_position)
  WHERE line_position IS NOT NULL;

CREATE TABLE public.checkout_intent_shipping_options (
  checkout_intent_id uuid NOT NULL,
  position integer NOT NULL,
  shipping_method_id uuid NOT NULL,
  shipping_rate_id uuid NOT NULL,
  display_name text NOT NULL,
  description text,
  carrier text,
  amount integer NOT NULL,
  original_amount integer NOT NULL,
  currency text NOT NULL,
  stripe_shipping_rate_id text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT checkout_intent_shipping_options_pkey
    PRIMARY KEY (checkout_intent_id, position),
  CONSTRAINT checkout_intent_shipping_options_checkout_intent_id_fkey
    FOREIGN KEY (checkout_intent_id)
    REFERENCES public.checkout_intents(id)
    ON DELETE CASCADE,
  CONSTRAINT checkout_intent_shipping_options_position_check
    CHECK (position >= 0),
  CONSTRAINT checkout_intent_shipping_options_display_name_check
    CHECK (nullif(btrim(display_name), '') IS NOT NULL),
  CONSTRAINT checkout_intent_shipping_options_amount_check
    CHECK (amount >= 0 AND original_amount >= 0),
  CONSTRAINT checkout_intent_shipping_options_currency_check
    CHECK (currency ~ '^[a-z]{3}$')
);

ALTER TABLE public.checkout_intent_shipping_options ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.checkout_intent_shipping_options
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.checkout_intent_shipping_options TO service_role;

CREATE FUNCTION public.resolve_checkout_request_context(
  p_checkout_attempt_id uuid,
  p_checkout_request_id uuid,
  p_user_id uuid,
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
  existing_orchestration_state text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_attempt public.checkout_attempts%ROWTYPE;
  v_existing public.checkout_intents%ROWTYPE;
  v_replacement_id uuid;
BEGIN
  IF p_checkout_attempt_id IS NULL OR p_checkout_request_id IS NULL THEN
    RAISE EXCEPTION 'Checkout attempt and request IDs are required.';
  END IF;

  PERFORM *
  FROM public.create_or_validate_checkout_attempt(
    p_checkout_attempt_id,
    p_user_id,
    p_capability_hash
  );

  SELECT attempts.*
  INTO v_attempt
  FROM public.checkout_attempts AS attempts
  WHERE attempts.id = p_checkout_attempt_id
  FOR UPDATE;

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

  RETURN QUERY
  SELECT
    v_attempt.status,
    date_trunc('second', v_attempt.hard_expires_at),
    v_attempt.active_checkout_intent_id,
    v_attempt.in_flight_checkout_intent_id,
    v_replacement_id,
    v_existing.id,
    v_existing.command_fingerprint,
    v_existing.orchestration_state;
END;
$function$;

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
DECLARE
  v_attempt public.checkout_attempts%ROWTYPE;
  v_existing public.checkout_intents%ROWTYPE;
  v_intent_id uuid := gen_random_uuid();
  v_reservation record;
  v_now timestamp with time zone := clock_timestamp();
  v_lease_expires_at timestamp with time zone := v_now + interval '2 minutes';
  v_lease_acquired boolean := false;
  v_discount_code_id uuid;
  v_shipping_method_id uuid;
  v_shipping_rate_id uuid;
BEGIN
  IF p_checkout_attempt_id IS NULL
    OR p_checkout_request_id IS NULL
    OR p_worker_lease_id IS NULL THEN
    RAISE EXCEPTION 'Checkout attempt, request and worker lease IDs are required.';
  END IF;

  IF p_command_fingerprint IS NULL OR p_command_fingerprint !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Checkout command fingerprint must be lowercase SHA-256 hex.';
  END IF;

  PERFORM *
  FROM public.create_or_validate_checkout_attempt(
    p_checkout_attempt_id,
    p_user_id,
    p_capability_hash
  );

  SELECT attempts.*
  INTO v_attempt
  FROM public.checkout_attempts AS attempts
  WHERE attempts.id = p_checkout_attempt_id
  FOR UPDATE;

  SELECT intents.*
  INTO v_existing
  FROM public.checkout_intents AS intents
  WHERE intents.checkout_attempt_id = p_checkout_attempt_id
    AND intents.checkout_request_id = p_checkout_request_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.command_fingerprint IS DISTINCT FROM p_command_fingerprint
      OR v_existing.replaces_checkout_intent_id
        IS DISTINCT FROM p_replaces_checkout_intent_id THEN
      RAISE EXCEPTION 'Checkout request conflict.';
    END IF;

    IF v_existing.checkout_protocol_version IS DISTINCT FROM 'reservation_v1' THEN
      RAISE EXCEPTION 'Checkout request protocol conflict.';
    END IF;

    IF v_existing.orchestration_state NOT IN ('failed', 'compensated', 'reconciliation_required')
      AND (
        v_existing.worker_lease_id IS NULL
        OR v_existing.worker_lease_expires_at <= v_now
        OR v_existing.worker_lease_id = p_worker_lease_id
      ) THEN
      UPDATE public.checkout_intents
      SET
        worker_lease_id = p_worker_lease_id,
        worker_lease_expires_at = v_lease_expires_at,
        orchestration_updated_at = v_now
      WHERE id = v_existing.id
      RETURNING * INTO v_existing;

      v_lease_acquired := true;
    END IF;

    SELECT reservations.id
    INTO v_reservation
    FROM public.inventory_reservations AS reservations
    WHERE reservations.checkout_attempt_id = p_checkout_attempt_id;

    RETURN QUERY
    SELECT
      v_existing.id,
      v_reservation.id,
      v_existing.orchestration_state,
      true,
      v_lease_acquired,
      v_existing.worker_lease_expires_at;
    RETURN;
  END IF;

  IF v_attempt.status <> 'active' OR v_attempt.hard_expires_at <= v_now THEN
    RAISE EXCEPTION 'Checkout attempt is no longer active.';
  END IF;

  IF v_attempt.hard_expires_at < v_now + interval '31 minutes' THEN
    RAISE EXCEPTION 'Checkout attempt has insufficient lifetime for a new Stripe Session.';
  END IF;

  IF v_attempt.in_flight_checkout_intent_id IS NOT NULL THEN
    RAISE EXCEPTION 'Checkout attempt already has an unresolved operation.';
  END IF;

  IF p_replaces_checkout_intent_id IS NULL THEN
    IF v_attempt.active_checkout_intent_id IS NOT NULL THEN
      RAISE EXCEPTION 'A checkout replacement target is required.';
    END IF;
  ELSIF v_attempt.active_checkout_intent_id IS DISTINCT FROM p_replaces_checkout_intent_id THEN
    RAISE EXCEPTION 'Checkout replacement target is not the active intent.';
  END IF;

  IF p_snapshot IS NULL
    OR jsonb_typeof(p_items) <> 'array'
    OR jsonb_array_length(p_items) = 0
    OR jsonb_typeof(p_shipping_options) <> 'array'
    OR jsonb_array_length(p_shipping_options) = 0 THEN
    RAISE EXCEPTION 'Canonical checkout snapshot is required.';
  END IF;

  v_discount_code_id := nullif(p_snapshot ->> 'discount_code_id', '')::uuid;
  v_shipping_method_id := nullif(p_snapshot ->> 'shipping_method_id', '')::uuid;
  v_shipping_rate_id := nullif(p_snapshot ->> 'shipping_rate_id', '')::uuid;

  INSERT INTO public.checkout_intents (
    id,
    payment_intent_id,
    status,
    customer_email,
    subtotal_amount,
    shipping_amount,
    total_amount,
    currency,
    shipping_method_name,
    shipping_method_id,
    shipping_rate_id,
    total_weight_grams,
    shipping_name,
    shipping_phone,
    shipping_address,
    billing_name,
    billing_address,
    billing_is_different,
    stripe_checkout_session_id,
    user_id,
    stripe_customer_id,
    confirmation_token_hash,
    confirmation_token_expires_at,
    create_account_requested,
    discount_code_id,
    discount_code,
    discount_amount,
    shipping_discount_amount,
    stripe_coupon_id,
    checkout_protocol_version,
    orchestration_state,
    orchestration_updated_at,
    worker_lease_id,
    worker_lease_expires_at,
    stripe_return_url,
    stripe_session_expires_at,
    discount_name,
    discount_type
  )
  VALUES (
    v_intent_id,
    NULL,
    'preparing',
    nullif(p_snapshot ->> 'customer_email', ''),
    (p_snapshot ->> 'subtotal_amount')::integer,
    (p_snapshot ->> 'shipping_amount')::integer,
    (p_snapshot ->> 'total_amount')::integer,
    p_snapshot ->> 'currency',
    p_snapshot ->> 'shipping_method_name',
    v_shipping_method_id,
    v_shipping_rate_id,
    (p_snapshot ->> 'total_weight_grams')::integer,
    nullif(p_snapshot ->> 'shipping_name', ''),
    nullif(p_snapshot ->> 'shipping_phone', ''),
    COALESCE(p_snapshot -> 'shipping_address', '{}'::jsonb),
    nullif(p_snapshot ->> 'billing_name', ''),
    COALESCE(p_snapshot -> 'billing_address', '{}'::jsonb),
    COALESCE((p_snapshot ->> 'billing_is_different')::boolean, false),
    NULL,
    p_user_id,
    nullif(p_snapshot ->> 'stripe_customer_id', ''),
    NULL,
    NULL,
    COALESCE((p_snapshot ->> 'create_account_requested')::boolean, false),
    v_discount_code_id,
    nullif(p_snapshot ->> 'discount_code', ''),
    COALESCE((p_snapshot ->> 'discount_amount')::integer, 0),
    COALESCE((p_snapshot ->> 'shipping_discount_amount')::integer, 0),
    NULL,
    'reservation_v1',
    'prepared',
    v_now,
    p_worker_lease_id,
    v_lease_expires_at,
    p_snapshot ->> 'stripe_return_url',
    date_trunc('second', v_attempt.hard_expires_at),
    nullif(p_snapshot ->> 'discount_name', ''),
    nullif(p_snapshot ->> 'discount_type', '')
  );

  INSERT INTO public.checkout_intent_items (
    checkout_intent_id,
    product_type,
    product_id,
    base_product_id,
    sku,
    name,
    product_name,
    variant_name,
    quantity,
    unit_amount,
    line_total,
    weight_grams,
    image_url,
    amount,
    line_position
  )
  SELECT
    v_intent_id,
    item.value ->> 'product_type',
    (item.value ->> 'product_id')::uuid,
    nullif(item.value ->> 'base_product_id', '')::uuid,
    item.value ->> 'sku',
    item.value ->> 'name',
    item.value ->> 'product_name',
    nullif(item.value ->> 'variant_name', ''),
    (item.value ->> 'quantity')::integer,
    (item.value ->> 'unit_amount')::integer,
    (item.value ->> 'line_total')::integer,
    (item.value ->> 'weight_grams')::integer,
    nullif(item.value ->> 'image_url', ''),
    nullif(item.value ->> 'amount', ''),
    item.ordinality::integer - 1
  FROM jsonb_array_elements(p_items) WITH ORDINALITY AS item(value, ordinality);

  INSERT INTO public.checkout_intent_shipping_options (
    checkout_intent_id,
    position,
    shipping_method_id,
    shipping_rate_id,
    display_name,
    description,
    carrier,
    amount,
    original_amount,
    currency
  )
  SELECT
    v_intent_id,
    option.ordinality::integer - 1,
    (option.value ->> 'shipping_method_id')::uuid,
    (option.value ->> 'shipping_rate_id')::uuid,
    option.value ->> 'display_name',
    nullif(option.value ->> 'description', ''),
    nullif(option.value ->> 'carrier', ''),
    (option.value ->> 'amount')::integer,
    (option.value ->> 'original_amount')::integer,
    option.value ->> 'currency'
  FROM jsonb_array_elements(p_shipping_options)
    WITH ORDINALITY AS option(value, ordinality);

  SELECT *
  INTO v_reservation
  FROM public.reserve_checkout_inventory(
    p_checkout_attempt_id,
    p_checkout_request_id,
    v_intent_id,
    p_command_fingerprint,
    p_reservation_expires_at,
    p_replaces_checkout_intent_id
  );

  UPDATE public.checkout_attempts
  SET
    in_flight_checkout_intent_id = v_intent_id,
    updated_at = v_now
  WHERE id = p_checkout_attempt_id;

  RETURN QUERY
  SELECT
    v_intent_id,
    v_reservation.reservation_id,
    'prepared'::text,
    false,
    true,
    v_lease_expires_at;
END;
$function$;

CREATE FUNCTION public.begin_checkout_coupon_creation(
  p_checkout_intent_id uuid,
  p_worker_lease_id uuid,
  p_params_hash text
)
RETURNS TABLE (params_match boolean, orchestration_state text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_intent public.checkout_intents%ROWTYPE;
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

  IF p_params_hash IS NULL OR p_params_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Stripe coupon parameters hash is invalid.';
  END IF;

  IF v_intent.stripe_coupon_params_hash IS NOT NULL
    AND v_intent.stripe_coupon_params_hash <> p_params_hash THEN
    UPDATE public.checkout_intents
    SET
      orchestration_state = 'reconciliation_required',
      orchestration_failure_code = 'coupon_params_mismatch',
      orchestration_updated_at = v_now
    WHERE id = p_checkout_intent_id;

    RETURN QUERY SELECT false, 'reconciliation_required'::text;
    RETURN;
  END IF;

  IF v_intent.orchestration_state NOT IN ('prepared', 'creating_coupon') THEN
    RAISE EXCEPTION 'Checkout request cannot begin coupon creation from its current state.';
  END IF;

  UPDATE public.checkout_intents
  SET
    stripe_coupon_params_hash = p_params_hash,
    orchestration_state = 'creating_coupon',
    orchestration_updated_at = v_now
  WHERE id = p_checkout_intent_id;

  RETURN QUERY SELECT true, 'creating_coupon'::text;
END;
$function$;

CREATE FUNCTION public.record_checkout_coupon(
  p_checkout_intent_id uuid,
  p_worker_lease_id uuid,
  p_stripe_coupon_id text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_intent public.checkout_intents%ROWTYPE;
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

  IF v_intent.orchestration_state <> 'creating_coupon'
    OR v_intent.stripe_coupon_params_hash IS NULL
    OR nullif(btrim(p_stripe_coupon_id), '') IS NULL THEN
    RAISE EXCEPTION 'Stripe coupon result cannot be recorded.';
  END IF;

  IF v_intent.stripe_coupon_id IS NOT NULL
    AND v_intent.stripe_coupon_id <> btrim(p_stripe_coupon_id) THEN
    RAISE EXCEPTION 'Stripe coupon result conflicts with the recorded request.';
  END IF;

  UPDATE public.checkout_intents
  SET
    stripe_coupon_id = btrim(p_stripe_coupon_id),
    orchestration_state = 'prepared',
    orchestration_updated_at = v_now
  WHERE id = p_checkout_intent_id;
END;
$function$;

CREATE FUNCTION public.begin_checkout_session_creation(
  p_checkout_intent_id uuid,
  p_worker_lease_id uuid,
  p_params_hash text
)
RETURNS TABLE (params_match boolean, orchestration_state text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_intent public.checkout_intents%ROWTYPE;
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

  IF p_params_hash IS NULL OR p_params_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Stripe Session parameters hash is invalid.';
  END IF;

  IF v_intent.stripe_session_params_hash IS NOT NULL
    AND v_intent.stripe_session_params_hash <> p_params_hash THEN
    UPDATE public.checkout_intents
    SET
      orchestration_state = 'reconciliation_required',
      orchestration_failure_code = 'session_params_mismatch',
      orchestration_updated_at = v_now
    WHERE id = p_checkout_intent_id;

    RETURN QUERY SELECT false, 'reconciliation_required'::text;
    RETURN;
  END IF;

  IF v_intent.orchestration_state NOT IN ('prepared', 'creating_session') THEN
    RAISE EXCEPTION 'Checkout request cannot begin Session creation from its current state.';
  END IF;

  IF v_intent.stripe_session_params_hash IS NULL
    AND v_intent.stripe_session_expires_at < v_now + interval '31 minutes' THEN
    RAISE EXCEPTION 'Checkout attempt has insufficient lifetime for a new Stripe Session.';
  END IF;

  UPDATE public.checkout_intents
  SET
    stripe_session_params_hash = p_params_hash,
    orchestration_state = 'creating_session',
    orchestration_updated_at = v_now
  WHERE id = p_checkout_intent_id;

  RETURN QUERY SELECT true, 'creating_session'::text;
END;
$function$;

CREATE FUNCTION public.record_checkout_session(
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
  v_intent public.checkout_intents%ROWTYPE;
  v_now timestamp with time zone := clock_timestamp();
  v_expected_count integer;
  v_updated_count integer;
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

  IF v_intent.orchestration_state NOT IN ('creating_session', 'session_created')
    OR nullif(btrim(p_stripe_checkout_session_id), '') IS NULL
    OR v_intent.stripe_session_params_hash IS NULL
    OR p_stripe_session_expires_at IS DISTINCT FROM v_intent.stripe_session_expires_at THEN
    RAISE EXCEPTION 'Stripe Session result cannot be recorded.';
  END IF;

  IF v_intent.stripe_checkout_session_id IS NOT NULL
    AND v_intent.stripe_checkout_session_id <> btrim(p_stripe_checkout_session_id) THEN
    RAISE EXCEPTION 'Stripe Session result conflicts with the recorded request.';
  END IF;

  SELECT count(*) INTO v_expected_count
  FROM public.checkout_intent_shipping_options
  WHERE checkout_intent_id = p_checkout_intent_id;

  IF jsonb_typeof(p_shipping_rate_ids) <> 'array'
    OR jsonb_array_length(p_shipping_rate_ids) <> v_expected_count THEN
    RAISE EXCEPTION 'Stripe shipping rate results are incomplete.';
  END IF;

  UPDATE public.checkout_intent_shipping_options AS options
  SET stripe_shipping_rate_id = rates.value ->> 'stripe_shipping_rate_id'
  FROM jsonb_array_elements(p_shipping_rate_ids) AS rates(value)
  WHERE options.checkout_intent_id = p_checkout_intent_id
    AND options.position = (rates.value ->> 'position')::integer
    AND nullif(btrim(rates.value ->> 'stripe_shipping_rate_id'), '') IS NOT NULL;

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;

  IF v_updated_count <> v_expected_count THEN
    RAISE EXCEPTION 'Stripe shipping rate results do not match the canonical snapshot.';
  END IF;

  UPDATE public.checkout_intents
  SET
    stripe_checkout_session_id = btrim(p_stripe_checkout_session_id),
    orchestration_state = 'session_created',
    orchestration_updated_at = v_now
  WHERE id = p_checkout_intent_id;
END;
$function$;

CREATE FUNCTION public.begin_checkout_replacement(
  p_checkout_intent_id uuid,
  p_worker_lease_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_intent public.checkout_intents%ROWTYPE;
BEGIN
  SELECT intents.* INTO v_intent
  FROM public.checkout_intents AS intents
  WHERE intents.id = p_checkout_intent_id
  FOR UPDATE;

  IF NOT FOUND
    OR v_intent.worker_lease_id IS DISTINCT FROM p_worker_lease_id
    OR v_intent.worker_lease_expires_at <= clock_timestamp() THEN
    RAISE EXCEPTION 'Checkout worker lease is invalid.';
  END IF;

  IF v_intent.replaces_checkout_intent_id IS NULL
    OR v_intent.orchestration_state NOT IN ('session_created', 'replacing') THEN
    RAISE EXCEPTION 'Checkout request is not ready for replacement.';
  END IF;

  UPDATE public.checkout_intents
  SET orchestration_state = 'replacing', orchestration_updated_at = clock_timestamp()
  WHERE id = p_checkout_intent_id;
END;
$function$;

CREATE FUNCTION public.activate_checkout_request(
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

CREATE FUNCTION public.rotate_checkout_confirmation_capability(
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
  v_intent public.checkout_intents%ROWTYPE;
  v_now timestamp with time zone := clock_timestamp();
BEGIN
  SELECT intents.* INTO v_intent
  FROM public.checkout_intents AS intents
  WHERE intents.id = p_checkout_intent_id
  FOR UPDATE;

  IF NOT FOUND
    OR v_intent.worker_lease_id IS DISTINCT FROM p_worker_lease_id
    OR v_intent.worker_lease_expires_at <= v_now
    OR v_intent.stripe_checkout_session_id IS NOT NULL THEN
    RAISE EXCEPTION 'Checkout request cannot be failed safely.';
  END IF;

  UPDATE public.checkout_intents
  SET
    status = 'failed',
    orchestration_state = 'failed',
    orchestration_failure_code = left(COALESCE(nullif(btrim(p_failure_code), ''), 'stripe_failure'), 100),
    orchestration_updated_at = v_now
  WHERE id = v_intent.id;

  UPDATE public.checkout_attempts
  SET
    in_flight_checkout_intent_id = NULL,
    status = CASE WHEN v_intent.replaces_checkout_intent_id IS NULL THEN 'failed' ELSE status END,
    completed_at = CASE
      WHEN v_intent.replaces_checkout_intent_id IS NULL THEN v_now
      ELSE completed_at
    END,
    updated_at = v_now
  WHERE id = v_intent.checkout_attempt_id
    AND in_flight_checkout_intent_id = v_intent.id;

  IF v_intent.replaces_checkout_intent_id IS NULL THEN
    PERFORM *
    FROM public.release_checkout_inventory_reservation(
      v_intent.checkout_attempt_id,
      'initial_checkout_failed'
    );
  END IF;
END;
$function$;

CREATE FUNCTION public.begin_checkout_compensation(
  p_checkout_intent_id uuid,
  p_worker_lease_id uuid,
  p_failure_code text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  UPDATE public.checkout_intents
  SET
    orchestration_state = 'compensating',
    orchestration_failure_code = left(COALESCE(nullif(btrim(p_failure_code), ''), 'compensation'), 100),
    orchestration_updated_at = clock_timestamp()
  WHERE id = p_checkout_intent_id
    AND worker_lease_id = p_worker_lease_id
    AND worker_lease_expires_at > clock_timestamp()
    AND stripe_checkout_session_id IS NOT NULL
    AND orchestration_state IN ('session_created', 'replacing', 'compensating');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Checkout compensation cannot begin from its current state.';
  END IF;
END;
$function$;

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
  v_intent public.checkout_intents%ROWTYPE;
  v_now timestamp with time zone := clock_timestamp();
BEGIN
  SELECT intents.* INTO v_intent
  FROM public.checkout_intents AS intents
  WHERE intents.id = p_checkout_intent_id
  FOR UPDATE;

  IF NOT FOUND
    OR v_intent.worker_lease_id IS DISTINCT FROM p_worker_lease_id
    OR v_intent.worker_lease_expires_at <= v_now
    OR v_intent.orchestration_state <> 'compensating' THEN
    RAISE EXCEPTION 'Checkout compensation cannot be completed.';
  END IF;

  UPDATE public.checkout_intents
  SET
    status = 'expired',
    orchestration_state = 'compensated',
    confirmation_token_hash = NULL,
    confirmation_token_expires_at = NULL,
    orchestration_updated_at = v_now
  WHERE id = v_intent.id;

  UPDATE public.checkout_attempts
  SET
    in_flight_checkout_intent_id = NULL,
    status = CASE WHEN v_intent.replaces_checkout_intent_id IS NULL THEN 'failed' ELSE status END,
    completed_at = CASE
      WHEN v_intent.replaces_checkout_intent_id IS NULL THEN v_now
      ELSE completed_at
    END,
    updated_at = v_now
  WHERE id = v_intent.checkout_attempt_id
    AND in_flight_checkout_intent_id = v_intent.id;

  IF v_intent.replaces_checkout_intent_id IS NULL THEN
    PERFORM *
    FROM public.release_checkout_inventory_reservation(
      v_intent.checkout_attempt_id,
      'initial_checkout_compensated'
    );
  END IF;
END;
$function$;

CREATE FUNCTION public.mark_checkout_reconciliation_required(
  p_checkout_intent_id uuid,
  p_worker_lease_id uuid,
  p_failure_code text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  UPDATE public.checkout_intents
  SET
    orchestration_state = 'reconciliation_required',
    orchestration_failure_code = left(
      COALESCE(nullif(btrim(p_failure_code), ''), 'stripe_state_ambiguous'),
      100
    ),
    orchestration_updated_at = clock_timestamp()
  WHERE id = p_checkout_intent_id
    AND worker_lease_id = p_worker_lease_id
    AND worker_lease_expires_at > clock_timestamp();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Checkout reconciliation state could not be recorded.';
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.resolve_checkout_request_context(uuid, uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prepare_checkout_request(
  uuid, uuid, uuid, text, text, uuid, uuid, timestamp with time zone, jsonb, jsonb, jsonb
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.begin_checkout_coupon_creation(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_checkout_coupon(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.begin_checkout_session_creation(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_checkout_session(
  uuid, uuid, text, timestamp with time zone, jsonb
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.begin_checkout_replacement(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.activate_checkout_request(
  uuid, uuid, text, timestamp with time zone
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rotate_checkout_confirmation_capability(
  uuid, uuid, text, timestamp with time zone
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fail_checkout_request(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.begin_checkout_compensation(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_checkout_compensation(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_checkout_reconciliation_required(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.resolve_checkout_request_context(uuid, uuid, uuid, text, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.prepare_checkout_request(
  uuid, uuid, uuid, text, text, uuid, uuid, timestamp with time zone, jsonb, jsonb, jsonb
) TO service_role;
GRANT EXECUTE ON FUNCTION public.begin_checkout_coupon_creation(uuid, uuid, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.record_checkout_coupon(uuid, uuid, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.begin_checkout_session_creation(uuid, uuid, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.record_checkout_session(
  uuid, uuid, text, timestamp with time zone, jsonb
) TO service_role;
GRANT EXECUTE ON FUNCTION public.begin_checkout_replacement(uuid, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.activate_checkout_request(
  uuid, uuid, text, timestamp with time zone
) TO service_role;
GRANT EXECUTE ON FUNCTION public.rotate_checkout_confirmation_capability(
  uuid, uuid, text, timestamp with time zone
) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_checkout_request(uuid, uuid, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.begin_checkout_compensation(uuid, uuid, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_checkout_compensation(uuid, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_checkout_reconciliation_required(uuid, uuid, text)
  TO service_role;
