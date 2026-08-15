-- Slice 7C1: typed item-aware inventory conflicts and bounded empty-attempt cleanup.

CREATE OR REPLACE FUNCTION public.reserve_checkout_inventory(
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
  v_max_conflict_detail_bytes constant integer := 32768;
  v_max_conflict_sku_characters constant integer := 200;
  v_conflict_detail jsonb;
  v_has_reservation boolean := false;
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

  v_has_reservation := FOUND;

  PERFORM intents.id
  FROM public.checkout_intents AS intents
  WHERE intents.id IN (p_checkout_intent_id, p_replaces_checkout_intent_id)
     OR (
       intents.checkout_attempt_id = p_checkout_attempt_id
       AND intents.checkout_request_id = p_checkout_request_id
     )
  ORDER BY intents.id
  FOR UPDATE;

  IF NOT v_has_reservation THEN
    PERFORM products.id
    FROM public.products AS products
    JOIN (
      SELECT DISTINCT items.product_id
      FROM public.checkout_intent_items AS items
      WHERE items.checkout_intent_id = p_checkout_intent_id
        AND items.product_type = 'product'
    ) AS requested_products ON requested_products.product_id = products.id
    ORDER BY products.id
    FOR UPDATE OF products;

    PERFORM variants.id
    FROM public.product_variants AS variants
    JOIN (
      SELECT DISTINCT items.product_id
      FROM public.checkout_intent_items AS items
      WHERE items.checkout_intent_id = p_checkout_intent_id
        AND items.product_type = 'variant'
    ) AS requested_variants ON requested_variants.product_id = variants.id
    ORDER BY variants.id
    FOR UPDATE OF variants;

    WITH requested_items AS (
      SELECT
        items.product_type,
        items.product_id,
        min(items.sku) AS sku,
        sum(items.quantity)::bigint AS quantity,
        min(COALESCE(items.line_position, 2147483647)) AS first_position
      FROM public.checkout_intent_items AS items
      WHERE items.checkout_intent_id = p_checkout_intent_id
      GROUP BY items.product_type, items.product_id
    ),
    item_availability AS (
      SELECT
        requested.sku,
        requested.quantity,
        requested.first_position,
        availability.on_hand_quantity,
        availability.available_to_sell
      FROM requested_items AS requested
      CROSS JOIN LATERAL public.get_inventory_available_to_sell(
        CASE WHEN requested.product_type = 'product' THEN requested.product_id END,
        CASE WHEN requested.product_type = 'variant' THEN requested.product_id END
      ) AS availability
    ),
    conflicts AS (
      SELECT
        availability.sku,
        CASE
          WHEN availability.on_hand_quantity::bigint < availability.quantity
            THEN 'out_of_stock'
          ELSE 'temporarily_reserved'
        END AS reason,
        availability.first_position
      FROM item_availability AS availability
      WHERE availability.on_hand_quantity::bigint < availability.quantity
         OR availability.available_to_sell < availability.quantity
    ),
    ordered_conflicts AS (
      SELECT DISTINCT ON (conflicts.sku)
        conflicts.sku,
        conflicts.reason,
        conflicts.first_position
      FROM conflicts
      ORDER BY conflicts.sku, conflicts.first_position
    ),
    bounded_conflicts AS (
      SELECT ordered.sku, ordered.reason, ordered.first_position
      FROM ordered_conflicts AS ordered
      ORDER BY ordered.first_position, ordered.sku
      LIMIT 100
    )
    SELECT CASE
      WHEN count(*) = 0 THEN NULL
      ELSE jsonb_build_object(
        'unavailable_items',
        jsonb_agg(
          jsonb_build_object('sku', bounded.sku, 'reason', bounded.reason)
          ORDER BY bounded.first_position, bounded.sku
        )
      )
    END
    INTO v_conflict_detail
    FROM bounded_conflicts AS bounded;

    IF v_conflict_detail IS NOT NULL THEN
      IF EXISTS (
        SELECT 1
        FROM jsonb_array_elements(v_conflict_detail -> 'unavailable_items') AS item(value)
        WHERE nullif(btrim(item.value ->> 'sku'), '') IS NULL
          OR char_length(item.value ->> 'sku') > v_max_conflict_sku_characters
      ) THEN
        RAISE EXCEPTION 'Checkout inventory conflict detail contains an invalid SKU.';
      END IF;

      IF octet_length(v_conflict_detail::text) > v_max_conflict_detail_bytes THEN
        RAISE EXCEPTION 'Checkout inventory conflict detail exceeds the safe byte limit.';
      END IF;

      RAISE EXCEPTION USING
        ERRCODE = 'TAI01',
        MESSAGE = 'Checkout inventory conflict.',
        DETAIL = v_conflict_detail::text;
    END IF;
  END IF;

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

CREATE FUNCTION public.terminalize_expired_empty_checkout_attempts_v1(
  p_batch_size integer DEFAULT 25
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_now timestamp with time zone := clock_timestamp();
  v_terminalized integer;
BEGIN
  IF p_batch_size IS NULL OR p_batch_size < 1 OR p_batch_size > 100 THEN
    RAISE EXCEPTION 'Expired empty checkout attempt batch size must be between 1 and 100.';
  END IF;

  WITH candidates AS MATERIALIZED (
    SELECT attempts.id
    FROM public.checkout_attempts AS attempts
    WHERE attempts.checkout_protocol_version = 'reservation_v1'
      AND attempts.status = 'active'
      AND attempts.hard_expires_at <= v_now
      AND attempts.active_checkout_intent_id IS NULL
      AND attempts.in_flight_checkout_intent_id IS NULL
      AND (
        attempts.admitted_checkout_request_id IS NULL
        OR attempts.admitted_request_expires_at <= v_now
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.checkout_intents AS intents
        WHERE intents.checkout_attempt_id = attempts.id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.inventory_reservations AS reservations
        WHERE reservations.checkout_attempt_id = attempts.id
      )
    ORDER BY attempts.hard_expires_at, attempts.id
    FOR UPDATE OF attempts SKIP LOCKED
    LIMIT p_batch_size
  ),
  terminalized AS (
    UPDATE public.checkout_attempts AS attempts
    SET
      status = 'expired',
      admitted_checkout_request_id = NULL,
      admitted_replaces_checkout_intent_id = NULL,
      admitted_request_expires_at = NULL,
      completed_at = v_now,
      updated_at = v_now
    FROM candidates
    WHERE attempts.id = candidates.id
    RETURNING attempts.id
  )
  SELECT count(*)::integer
  INTO v_terminalized
  FROM terminalized;

  RETURN v_terminalized;
END;
$function$;

REVOKE ALL ON FUNCTION public.terminalize_expired_empty_checkout_attempts_v1(integer)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.terminalize_expired_empty_checkout_attempts_v1(integer)
  TO service_role;
