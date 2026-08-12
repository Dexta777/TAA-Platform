-- Slice 5A: stable checkout attempts and attempt-owned inventory reservations.

DO $block$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.products
    WHERE inventory_quantity IS NULL OR inventory_quantity < 0
  ) THEN
    RAISE EXCEPTION
      'Cannot enforce non-negative product inventory: products contains null or negative inventory_quantity values.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.product_variants
    WHERE inventory_quantity IS NULL OR inventory_quantity < 0
  ) THEN
    RAISE EXCEPTION
      'Cannot enforce non-negative variant inventory: product_variants contains null or negative inventory_quantity values.';
  END IF;
END;
$block$;

ALTER TABLE public.products
  ALTER COLUMN inventory_quantity SET NOT NULL,
  ADD CONSTRAINT products_inventory_quantity_non_negative_check
    CHECK (inventory_quantity >= 0);

ALTER TABLE public.product_variants
  ALTER COLUMN inventory_quantity SET NOT NULL,
  ADD CONSTRAINT product_variants_inventory_quantity_non_negative_check
    CHECK (inventory_quantity >= 0);

CREATE TABLE public.checkout_attempts (
  id uuid PRIMARY KEY,
  user_id uuid,
  capability_hash text NOT NULL,
  capability_expires_at timestamp with time zone NOT NULL,
  status text NOT NULL DEFAULT 'active',
  active_checkout_intent_id uuid,
  hard_expires_at timestamp with time zone NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  completed_at timestamp with time zone,
  CONSTRAINT checkout_attempts_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT checkout_attempts_capability_hash_check
    CHECK (capability_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT checkout_attempts_status_check
    CHECK (status IN ('active', 'payment_pending', 'paid', 'expired', 'failed')),
  CONSTRAINT checkout_attempts_expiry_check
    CHECK (
      capability_expires_at <= hard_expires_at
      AND hard_expires_at > created_at
      AND hard_expires_at <= created_at + interval '2 hours'
    ),
  CONSTRAINT checkout_attempts_completion_check
    CHECK (
      (status IN ('active', 'payment_pending') AND completed_at IS NULL)
      OR (status IN ('paid', 'expired', 'failed') AND completed_at IS NOT NULL)
    )
);

ALTER TABLE public.checkout_attempts ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.checkout_intents
  ADD COLUMN checkout_attempt_id uuid,
  ADD COLUMN checkout_request_id uuid,
  ADD COLUMN command_fingerprint text,
  ADD COLUMN replaces_checkout_intent_id uuid,
  ADD CONSTRAINT checkout_intents_checkout_attempt_id_fkey
    FOREIGN KEY (checkout_attempt_id) REFERENCES public.checkout_attempts(id) ON DELETE SET NULL,
  ADD CONSTRAINT checkout_intents_attempt_request_check
    CHECK (
      (
        checkout_attempt_id IS NULL
        AND checkout_request_id IS NULL
        AND command_fingerprint IS NULL
        AND replaces_checkout_intent_id IS NULL
      )
      OR (
        checkout_attempt_id IS NOT NULL
        AND checkout_request_id IS NOT NULL
        AND command_fingerprint ~ '^[0-9a-f]{64}$'
      )
    );

ALTER TABLE public.checkout_intents
  ADD CONSTRAINT checkout_intents_id_checkout_attempt_id_key
    UNIQUE (id, checkout_attempt_id),
  ADD CONSTRAINT checkout_intents_replacement_attempt_fkey
    FOREIGN KEY (replaces_checkout_intent_id, checkout_attempt_id)
    REFERENCES public.checkout_intents(id, checkout_attempt_id)
    ON DELETE RESTRICT;

CREATE UNIQUE INDEX checkout_intents_attempt_request_key
  ON public.checkout_intents (checkout_attempt_id, checkout_request_id)
  WHERE checkout_attempt_id IS NOT NULL AND checkout_request_id IS NOT NULL;

CREATE INDEX checkout_intents_checkout_attempt_id_idx
  ON public.checkout_intents (checkout_attempt_id)
  WHERE checkout_attempt_id IS NOT NULL;

CREATE INDEX checkout_intents_replaces_checkout_intent_id_idx
  ON public.checkout_intents (replaces_checkout_intent_id)
  WHERE replaces_checkout_intent_id IS NOT NULL;

ALTER TABLE public.checkout_attempts
  ADD CONSTRAINT checkout_attempts_active_checkout_intent_attempt_fkey
    FOREIGN KEY (active_checkout_intent_id, id)
    REFERENCES public.checkout_intents(id, checkout_attempt_id)
    ON DELETE RESTRICT;

CREATE UNIQUE INDEX checkout_attempts_active_checkout_intent_id_key
  ON public.checkout_attempts (active_checkout_intent_id)
  WHERE active_checkout_intent_id IS NOT NULL;

CREATE TABLE public.inventory_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  checkout_attempt_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'held',
  reserved_at timestamp with time zone NOT NULL DEFAULT now(),
  expires_at timestamp with time zone NOT NULL,
  consumed_at timestamp with time zone,
  released_at timestamp with time zone,
  release_reason text,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT inventory_reservations_checkout_attempt_id_key
    UNIQUE (checkout_attempt_id),
  CONSTRAINT inventory_reservations_checkout_attempt_id_fkey
    FOREIGN KEY (checkout_attempt_id) REFERENCES public.checkout_attempts(id) ON DELETE RESTRICT,
  CONSTRAINT inventory_reservations_status_check
    CHECK (status IN ('held', 'payment_pending', 'consumed', 'released')),
  CONSTRAINT inventory_reservations_expiry_check
    CHECK (expires_at > reserved_at),
  CONSTRAINT inventory_reservations_lifecycle_check
    CHECK (
      (
        status IN ('held', 'payment_pending')
        AND consumed_at IS NULL
        AND released_at IS NULL
        AND release_reason IS NULL
      )
      OR (
        status = 'consumed'
        AND consumed_at IS NOT NULL
        AND released_at IS NULL
        AND release_reason IS NULL
      )
      OR (
        status = 'released'
        AND consumed_at IS NULL
        AND released_at IS NOT NULL
        AND nullif(btrim(release_reason), '') IS NOT NULL
        AND length(release_reason) <= 100
      )
    )
);

ALTER TABLE public.inventory_reservations ENABLE ROW LEVEL SECURITY;

CREATE INDEX inventory_reservations_status_expires_at_idx
  ON public.inventory_reservations (status, expires_at)
  WHERE status IN ('held', 'payment_pending');

CREATE TABLE public.inventory_reservation_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id uuid NOT NULL,
  product_id uuid,
  product_variant_id uuid,
  sku_snapshot text NOT NULL,
  quantity integer NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT inventory_reservation_items_reservation_id_fkey
    FOREIGN KEY (reservation_id)
    REFERENCES public.inventory_reservations(id)
    ON DELETE CASCADE,
  CONSTRAINT inventory_reservation_items_product_id_fkey
    FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE RESTRICT,
  CONSTRAINT inventory_reservation_items_product_variant_id_fkey
    FOREIGN KEY (product_variant_id)
    REFERENCES public.product_variants(id)
    ON DELETE RESTRICT,
  CONSTRAINT inventory_reservation_items_resource_check
    CHECK (num_nonnulls(product_id, product_variant_id) = 1),
  CONSTRAINT inventory_reservation_items_sku_snapshot_check
    CHECK (nullif(btrim(sku_snapshot), '') IS NOT NULL),
  CONSTRAINT inventory_reservation_items_quantity_check
    CHECK (quantity > 0)
);

ALTER TABLE public.inventory_reservation_items ENABLE ROW LEVEL SECURITY;

CREATE UNIQUE INDEX inventory_reservation_items_product_key
  ON public.inventory_reservation_items (reservation_id, product_id)
  WHERE product_id IS NOT NULL;

CREATE UNIQUE INDEX inventory_reservation_items_variant_key
  ON public.inventory_reservation_items (reservation_id, product_variant_id)
  WHERE product_variant_id IS NOT NULL;

CREATE INDEX inventory_reservation_items_product_id_idx
  ON public.inventory_reservation_items (product_id)
  WHERE product_id IS NOT NULL;

CREATE INDEX inventory_reservation_items_product_variant_id_idx
  ON public.inventory_reservation_items (product_variant_id)
  WHERE product_variant_id IS NOT NULL;

ALTER TABLE public.orders
  ADD COLUMN checkout_attempt_id uuid,
  ADD CONSTRAINT orders_checkout_attempt_id_fkey
    FOREIGN KEY (checkout_attempt_id) REFERENCES public.checkout_attempts(id) ON DELETE SET NULL,
  ADD CONSTRAINT orders_checkout_intent_attempt_fkey
    FOREIGN KEY (checkout_intent_id, checkout_attempt_id)
    REFERENCES public.checkout_intents(id, checkout_attempt_id)
    ON DELETE RESTRICT;

CREATE UNIQUE INDEX orders_checkout_attempt_id_key
  ON public.orders (checkout_attempt_id)
  WHERE checkout_attempt_id IS NOT NULL;

CREATE FUNCTION public.create_or_validate_checkout_attempt(
  p_checkout_attempt_id uuid,
  p_user_id uuid,
  p_capability_hash text
)
RETURNS TABLE (
  checkout_attempt_id uuid,
  attempt_status text,
  capability_expires_at timestamp with time zone,
  hard_expires_at timestamp with time zone,
  already_exists boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_attempt public.checkout_attempts%ROWTYPE;
  v_created boolean := false;
  v_now timestamp with time zone := clock_timestamp();
BEGIN
  IF p_checkout_attempt_id IS NULL THEN
    RAISE EXCEPTION 'Checkout attempt ID is required.';
  END IF;

  IF p_capability_hash IS NULL OR p_capability_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Checkout attempt capability hash must be lowercase SHA-256 hex.';
  END IF;

  INSERT INTO public.checkout_attempts (
    id,
    user_id,
    capability_hash,
    capability_expires_at,
    status,
    hard_expires_at,
    created_at,
    updated_at
  )
  VALUES (
    p_checkout_attempt_id,
    p_user_id,
    p_capability_hash,
    v_now + interval '2 hours',
    'active',
    v_now + interval '2 hours',
    v_now,
    v_now
  )
  ON CONFLICT (id) DO NOTHING
  RETURNING * INTO v_attempt;

  v_created := FOUND;

  IF NOT v_created THEN
    SELECT attempts.*
    INTO v_attempt
    FROM public.checkout_attempts AS attempts
    WHERE attempts.id = p_checkout_attempt_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Checkout attempt could not be created or loaded.';
    END IF;

    IF v_attempt.user_id IS DISTINCT FROM p_user_id
      OR v_attempt.capability_hash IS DISTINCT FROM p_capability_hash THEN
      RAISE EXCEPTION 'Checkout attempt identity conflict.';
    END IF;
  END IF;

  RETURN QUERY
  SELECT
    v_attempt.id,
    v_attempt.status,
    v_attempt.capability_expires_at,
    v_attempt.hard_expires_at,
    NOT v_created;
END;
$function$;

CREATE FUNCTION public.get_inventory_available_to_sell(
  p_product_id uuid,
  p_product_variant_id uuid
)
RETURNS TABLE (
  on_hand_quantity integer,
  reserved_quantity bigint,
  available_to_sell bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_on_hand integer;
  v_reserved bigint;
BEGIN
  IF num_nonnulls(p_product_id, p_product_variant_id) <> 1 THEN
    RAISE EXCEPTION 'Exactly one product or product variant ID is required.';
  END IF;

  IF p_product_id IS NOT NULL THEN
    SELECT products.inventory_quantity
    INTO v_on_hand
    FROM public.products
    WHERE products.id = p_product_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Inventory product not found.';
    END IF;

    SELECT COALESCE(sum(items.quantity), 0)::bigint
    INTO v_reserved
    FROM public.inventory_reservation_items AS items
    JOIN public.inventory_reservations AS reservations
      ON reservations.id = items.reservation_id
    WHERE items.product_id = p_product_id
      AND reservations.status IN ('held', 'payment_pending');
  ELSE
    SELECT variants.inventory_quantity
    INTO v_on_hand
    FROM public.product_variants AS variants
    WHERE variants.id = p_product_variant_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Inventory product variant not found.';
    END IF;

    SELECT COALESCE(sum(items.quantity), 0)::bigint
    INTO v_reserved
    FROM public.inventory_reservation_items AS items
    JOIN public.inventory_reservations AS reservations
      ON reservations.id = items.reservation_id
    WHERE items.product_variant_id = p_product_variant_id
      AND reservations.status IN ('held', 'payment_pending');
  END IF;

  RETURN QUERY
  SELECT v_on_hand, v_reserved, v_on_hand::bigint - v_reserved;
END;
$function$;

CREATE FUNCTION public.checkout_reservation_cart_matches(
  p_checkout_intent_id uuid,
  p_reservation_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  WITH requested_items AS (
    SELECT
      checkout_items.product_type,
      checkout_items.product_id AS resource_id,
      min(checkout_items.sku) AS sku,
      sum(checkout_items.quantity)::bigint AS quantity
    FROM public.checkout_intent_items AS checkout_items
    WHERE checkout_items.checkout_intent_id = p_checkout_intent_id
    GROUP BY checkout_items.product_type, checkout_items.product_id
  ),
  reserved_items AS (
    SELECT
      CASE
        WHEN reservation_items.product_id IS NOT NULL THEN 'product'
        ELSE 'variant'
      END AS product_type,
      COALESCE(reservation_items.product_id, reservation_items.product_variant_id) AS resource_id,
      reservation_items.sku_snapshot AS sku,
      reservation_items.quantity::bigint AS quantity
    FROM public.inventory_reservation_items AS reservation_items
    WHERE reservation_items.reservation_id = p_reservation_id
  ),
  differences AS (
    (SELECT * FROM requested_items EXCEPT SELECT * FROM reserved_items)
    UNION ALL
    (SELECT * FROM reserved_items EXCEPT SELECT * FROM requested_items)
  )
  SELECT NOT EXISTS (SELECT 1 FROM differences);
$function$;

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
DECLARE
  v_attempt public.checkout_attempts%ROWTYPE;
  v_checkout_intent public.checkout_intents%ROWTYPE;
  v_existing_request public.checkout_intents%ROWTYPE;
  v_replaced_intent public.checkout_intents%ROWTYPE;
  v_reservation public.inventory_reservations%ROWTYPE;
  v_item record;
  v_active boolean;
  v_available bigint;
  v_now timestamp with time zone := clock_timestamp();
BEGIN
  IF p_checkout_attempt_id IS NULL
    OR p_checkout_request_id IS NULL
    OR p_checkout_intent_id IS NULL THEN
    RAISE EXCEPTION 'Checkout attempt, request and intent IDs are required.';
  END IF;

  IF p_command_fingerprint IS NULL OR p_command_fingerprint !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Checkout command fingerprint must be lowercase SHA-256 hex.';
  END IF;

  IF p_expires_at IS NULL
    OR p_expires_at <= v_now
    OR p_expires_at > v_now + interval '30 minutes' THEN
    RAISE EXCEPTION 'Reservation expiry must be within the next 30 minutes.';
  END IF;

  SELECT attempts.*
  INTO v_attempt
  FROM public.checkout_attempts AS attempts
  WHERE attempts.id = p_checkout_attempt_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Checkout attempt not found.';
  END IF;

  IF v_attempt.status <> 'active' OR v_attempt.hard_expires_at <= v_now THEN
    RAISE EXCEPTION 'Checkout attempt is no longer active.';
  END IF;

  IF p_expires_at > v_attempt.hard_expires_at THEN
    RAISE EXCEPTION 'Reservation expiry exceeds the checkout attempt lifetime.';
  END IF;

  SELECT checkout_intents.*
  INTO v_existing_request
  FROM public.checkout_intents
  WHERE checkout_intents.checkout_attempt_id = p_checkout_attempt_id
    AND checkout_intents.checkout_request_id = p_checkout_request_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing_request.id IS DISTINCT FROM p_checkout_intent_id
      OR v_existing_request.command_fingerprint IS DISTINCT FROM p_command_fingerprint
      OR v_existing_request.replaces_checkout_intent_id
        IS DISTINCT FROM p_replaces_checkout_intent_id THEN
      RAISE EXCEPTION 'Checkout request conflict.';
    END IF;

    SELECT reservations.*
    INTO v_reservation
    FROM public.inventory_reservations AS reservations
    WHERE reservations.checkout_attempt_id = p_checkout_attempt_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Checkout request exists without its inventory reservation.';
    END IF;

    IF NOT public.checkout_reservation_cart_matches(
      v_existing_request.id,
      v_reservation.id
    ) THEN
      RAISE EXCEPTION 'Checkout attempt cart is immutable.';
    END IF;

    RETURN QUERY
    SELECT
      v_existing_request.id,
      v_reservation.id,
      v_reservation.status,
      true,
      true;
    RETURN;
  END IF;

  SELECT checkout_intents.*
  INTO v_checkout_intent
  FROM public.checkout_intents
  WHERE checkout_intents.id = p_checkout_intent_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Persisted checkout request snapshot not found.';
  END IF;

  IF v_checkout_intent.checkout_attempt_id IS NOT NULL
    OR v_checkout_intent.checkout_request_id IS NOT NULL
    OR v_checkout_intent.command_fingerprint IS NOT NULL THEN
    RAISE EXCEPTION 'Checkout intent is already bound to another request.';
  END IF;

  SELECT reservations.*
  INTO v_reservation
  FROM public.inventory_reservations AS reservations
  WHERE reservations.checkout_attempt_id = p_checkout_attempt_id
  FOR UPDATE;

  IF p_replaces_checkout_intent_id IS NOT NULL THEN
    SELECT checkout_intents.*
    INTO v_replaced_intent
    FROM public.checkout_intents
    WHERE checkout_intents.id = p_replaces_checkout_intent_id
    FOR UPDATE;

    IF NOT FOUND
      OR v_replaced_intent.checkout_attempt_id IS DISTINCT FROM p_checkout_attempt_id THEN
      RAISE EXCEPTION 'Replacement target does not belong to this checkout attempt.';
    END IF;

    IF v_reservation.id IS NULL THEN
      RAISE EXCEPTION 'Replacement request requires an existing inventory reservation.';
    END IF;
  ELSIF v_reservation.id IS NOT NULL THEN
    RAISE EXCEPTION 'A subsequent checkout request must identify its replacement target.';
  END IF;

  UPDATE public.checkout_intents
  SET
    checkout_attempt_id = p_checkout_attempt_id,
    checkout_request_id = p_checkout_request_id,
    command_fingerprint = p_command_fingerprint,
    replaces_checkout_intent_id = p_replaces_checkout_intent_id
  WHERE id = p_checkout_intent_id;

  IF NOT EXISTS (
    SELECT 1
    FROM public.checkout_intent_items AS checkout_items
    WHERE checkout_items.checkout_intent_id = p_checkout_intent_id
  ) THEN
    RAISE EXCEPTION 'Checkout request has no persisted canonical items.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.checkout_intent_items AS checkout_items
    WHERE checkout_items.checkout_intent_id = p_checkout_intent_id
      AND (
        checkout_items.product_type NOT IN ('product', 'variant')
        OR checkout_items.product_id IS NULL
        OR checkout_items.quantity IS NULL
        OR checkout_items.quantity < 1
      )
  ) THEN
    RAISE EXCEPTION 'Checkout request contains invalid canonical inventory items.';
  END IF;

  FOR v_item IN
    SELECT
      checkout_items.product_type,
      checkout_items.product_id,
      min(checkout_items.sku) AS sku,
      sum(checkout_items.quantity)::bigint AS quantity
    FROM public.checkout_intent_items AS checkout_items
    WHERE checkout_items.checkout_intent_id = p_checkout_intent_id
    GROUP BY checkout_items.product_type, checkout_items.product_id
    ORDER BY
      CASE checkout_items.product_type WHEN 'product' THEN 0 ELSE 1 END,
      checkout_items.product_id
  LOOP
    IF v_item.quantity > 2147483647 THEN
      RAISE EXCEPTION 'Checkout inventory quantity is too large for SKU %.', v_item.sku;
    END IF;

    IF v_item.product_type = 'product' THEN
      SELECT products.active
      INTO v_active
      FROM public.products
      WHERE products.id = v_item.product_id
      FOR UPDATE;

      IF NOT FOUND OR v_active IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'Inventory product is unavailable for SKU %.', v_item.sku;
      END IF;
    ELSE
      SELECT variants.active
      INTO v_active
      FROM public.product_variants AS variants
      WHERE variants.id = v_item.product_id
      FOR UPDATE;

      IF NOT FOUND OR v_active IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'Inventory product variant is unavailable for SKU %.', v_item.sku;
      END IF;
    END IF;

    IF v_reservation.id IS NULL THEN
      SELECT availability.available_to_sell
      INTO v_available
      FROM public.get_inventory_available_to_sell(
        CASE WHEN v_item.product_type = 'product' THEN v_item.product_id ELSE NULL END,
        CASE WHEN v_item.product_type = 'variant' THEN v_item.product_id ELSE NULL END
      ) AS availability;

      IF v_available < v_item.quantity THEN
        RAISE EXCEPTION 'Insufficient available inventory for SKU %.', v_item.sku;
      END IF;
    END IF;
  END LOOP;

  IF v_reservation.id IS NOT NULL THEN
    IF v_reservation.status <> 'held' THEN
      RAISE EXCEPTION 'Inventory reservation can no longer be reused.';
    END IF;

    IF NOT public.checkout_reservation_cart_matches(
      p_checkout_intent_id,
      v_reservation.id
    ) THEN
      RAISE EXCEPTION 'Checkout attempt cart is immutable.';
    END IF;

    UPDATE public.inventory_reservations
    SET
      expires_at = greatest(expires_at, p_expires_at),
      updated_at = v_now
    WHERE id = v_reservation.id
    RETURNING * INTO v_reservation;

    RETURN QUERY
    SELECT
      p_checkout_intent_id,
      v_reservation.id,
      v_reservation.status,
      false,
      true;
    RETURN;
  END IF;

  INSERT INTO public.inventory_reservations (
    checkout_attempt_id,
    status,
    reserved_at,
    expires_at,
    updated_at
  )
  VALUES (
    p_checkout_attempt_id,
    'held',
    v_now,
    p_expires_at,
    v_now
  )
  RETURNING * INTO v_reservation;

  INSERT INTO public.inventory_reservation_items (
    reservation_id,
    product_id,
    product_variant_id,
    sku_snapshot,
    quantity
  )
  SELECT
    v_reservation.id,
    CASE WHEN checkout_items.product_type = 'product' THEN checkout_items.product_id END,
    CASE WHEN checkout_items.product_type = 'variant' THEN checkout_items.product_id END,
    min(checkout_items.sku),
    sum(checkout_items.quantity)::integer
  FROM public.checkout_intent_items AS checkout_items
  WHERE checkout_items.checkout_intent_id = p_checkout_intent_id
  GROUP BY checkout_items.product_type, checkout_items.product_id
  ORDER BY
    CASE checkout_items.product_type WHEN 'product' THEN 0 ELSE 1 END,
    checkout_items.product_id;

  RETURN QUERY
  SELECT
    p_checkout_intent_id,
    v_reservation.id,
    v_reservation.status,
    false,
    false;
END;
$function$;

CREATE FUNCTION public.release_checkout_inventory_reservation(
  p_checkout_attempt_id uuid,
  p_release_reason text
)
RETURNS TABLE (
  reservation_id uuid,
  reservation_status text,
  already_released boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_reservation public.inventory_reservations%ROWTYPE;
  v_reason text := btrim(p_release_reason);
  v_now timestamp with time zone := clock_timestamp();
BEGIN
  IF p_checkout_attempt_id IS NULL THEN
    RAISE EXCEPTION 'Checkout attempt ID is required.';
  END IF;

  IF nullif(v_reason, '') IS NULL OR length(v_reason) > 100 THEN
    RAISE EXCEPTION 'Reservation release reason must contain between 1 and 100 characters.';
  END IF;

  PERFORM attempts.id
  FROM public.checkout_attempts AS attempts
  WHERE attempts.id = p_checkout_attempt_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Checkout attempt not found.';
  END IF;

  SELECT reservations.*
  INTO v_reservation
  FROM public.inventory_reservations AS reservations
  WHERE reservations.checkout_attempt_id = p_checkout_attempt_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Inventory reservation not found.';
  END IF;

  IF v_reservation.status = 'released' THEN
    RETURN QUERY SELECT v_reservation.id, v_reservation.status, true;
    RETURN;
  END IF;

  IF v_reservation.status = 'consumed' THEN
    RAISE EXCEPTION 'Consumed inventory reservation cannot be released.';
  END IF;

  UPDATE public.inventory_reservations
  SET
    status = 'released',
    released_at = v_now,
    release_reason = v_reason,
    updated_at = v_now
  WHERE id = v_reservation.id
  RETURNING * INTO v_reservation;

  RETURN QUERY SELECT v_reservation.id, v_reservation.status, false;
END;
$function$;

CREATE FUNCTION public.get_checkout_reservation_state(p_checkout_attempt_id uuid)
RETURNS TABLE (
  checkout_attempt_id uuid,
  reservation_id uuid,
  reservation_status text,
  reserved_at timestamp with time zone,
  expires_at timestamp with time zone,
  consumed_at timestamp with time zone,
  released_at timestamp with time zone,
  release_reason text,
  items jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT
    reservations.checkout_attempt_id,
    reservations.id,
    reservations.status,
    reservations.reserved_at,
    reservations.expires_at,
    reservations.consumed_at,
    reservations.released_at,
    reservations.release_reason,
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'product_id', items.product_id,
          'product_variant_id', items.product_variant_id,
          'sku', items.sku_snapshot,
          'quantity', items.quantity
        )
        ORDER BY items.product_id NULLS LAST, items.product_variant_id NULLS LAST
      ) FILTER (WHERE items.id IS NOT NULL),
      '[]'::jsonb
    )
  FROM public.inventory_reservations AS reservations
  LEFT JOIN public.inventory_reservation_items AS items
    ON items.reservation_id = reservations.id
  WHERE reservations.checkout_attempt_id = p_checkout_attempt_id
  GROUP BY reservations.id;
$function$;

REVOKE ALL ON TABLE public.checkout_attempts
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.inventory_reservations
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.inventory_reservation_items
  FROM PUBLIC, anon, authenticated;

GRANT ALL ON TABLE public.checkout_attempts TO service_role;
GRANT ALL ON TABLE public.inventory_reservations TO service_role;
GRANT ALL ON TABLE public.inventory_reservation_items TO service_role;

REVOKE ALL ON FUNCTION public.create_or_validate_checkout_attempt(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_inventory_available_to_sell(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.checkout_reservation_cart_matches(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reserve_checkout_inventory(
  uuid,
  uuid,
  uuid,
  text,
  timestamp with time zone,
  uuid
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_checkout_inventory_reservation(uuid, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_checkout_reservation_state(uuid)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_or_validate_checkout_attempt(uuid, uuid, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.get_inventory_available_to_sell(uuid, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.reserve_checkout_inventory(
  uuid,
  uuid,
  uuid,
  text,
  timestamp with time zone,
  uuid
) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_checkout_inventory_reservation(uuid, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.get_checkout_reservation_state(uuid)
  TO service_role;
