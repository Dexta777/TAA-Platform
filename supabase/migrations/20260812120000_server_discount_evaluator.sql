-- Evaluate TAA-owned discount eligibility and calculate canonical integer-pence results.

CREATE FUNCTION public.evaluate_discount_code(
  p_code text,
  p_subtotal_amount integer,
  p_shipping_amount integer,
  p_user_id uuid DEFAULT NULL,
  p_email text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_shipping_address jsonb DEFAULT NULL,
  p_now timestamp with time zone DEFAULT now()
)
RETURNS TABLE (
  eligible boolean,
  reason_code text,
  discount_code_id uuid,
  code text,
  name text,
  description text,
  discount_type text,
  minimum_subtotal_amount integer,
  requires_account boolean,
  first_order_only boolean,
  discount_amount integer,
  shipping_discount_amount integer,
  final_shipping_amount integer,
  total_amount integer
)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_discount_code public.discount_codes%ROWTYPE;
  v_normalized_code text;
  v_email_fingerprint text;
  v_phone_fingerprint text;
  v_shipping_address_fingerprint text;
  v_redemption_count bigint;
  v_calculated_discount numeric;
BEGIN
  IF p_subtotal_amount IS NULL OR p_shipping_amount IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '22004',
      MESSAGE = 'Subtotal and shipping amounts are required.';
  END IF;

  IF p_subtotal_amount < 0 OR p_shipping_amount < 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'Subtotal and shipping amounts cannot be negative.';
  END IF;

  IF p_now IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '22004',
      MESSAGE = 'Evaluation timestamp is required.';
  END IF;

  IF p_subtotal_amount::bigint + p_shipping_amount::bigint > 2147483647 THEN
    RAISE EXCEPTION USING
      ERRCODE = '22003',
      MESSAGE = 'Checkout total exceeds the supported integer-pence range.';
  END IF;

  eligible := false;
  reason_code := 'invalid_code';
  discount_code_id := NULL;
  code := NULL;
  name := NULL;
  description := NULL;
  discount_type := NULL;
  minimum_subtotal_amount := NULL;
  requires_account := NULL;
  first_order_only := NULL;
  discount_amount := 0;
  shipping_discount_amount := 0;
  final_shipping_amount := p_shipping_amount;
  total_amount := p_subtotal_amount + p_shipping_amount;

  v_normalized_code := public.normalize_discount_code(p_code);

  IF v_normalized_code IS NULL THEN
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT discount_codes.*
  INTO v_discount_code
  FROM public.discount_codes
  WHERE discount_codes.code = v_normalized_code;

  IF NOT FOUND THEN
    RETURN NEXT;
    RETURN;
  END IF;

  discount_code_id := v_discount_code.id;
  code := v_discount_code.code;
  name := v_discount_code.name;
  description := v_discount_code.description;
  discount_type := v_discount_code.discount_type;
  minimum_subtotal_amount := v_discount_code.minimum_subtotal_amount;
  requires_account := v_discount_code.requires_account;
  first_order_only := v_discount_code.first_order_only;

  IF NOT v_discount_code.active THEN
    reason_code := 'inactive';
    RETURN NEXT;
    RETURN;
  END IF;

  -- starts_at is inclusive; expires_at is exclusive.
  IF v_discount_code.starts_at IS NOT NULL AND p_now < v_discount_code.starts_at THEN
    reason_code := 'not_started';
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_discount_code.expires_at IS NOT NULL AND p_now >= v_discount_code.expires_at THEN
    reason_code := 'expired';
    RETURN NEXT;
    RETURN;
  END IF;

  IF p_subtotal_amount < v_discount_code.minimum_subtotal_amount THEN
    reason_code := 'minimum_subtotal_not_met';
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_discount_code.requires_account AND p_user_id IS NULL THEN
    reason_code := 'account_required';
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_discount_code.maximum_redemptions_per_user IS NOT NULL AND p_user_id IS NULL THEN
    reason_code := 'account_required';
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_discount_code.first_order_only AND p_user_id IS NULL THEN
    reason_code := 'account_required';
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_discount_code.maximum_redemptions IS NOT NULL THEN
    SELECT count(*)
    INTO v_redemption_count
    FROM public.discount_redemptions
    WHERE discount_redemptions.discount_code_id = v_discount_code.id;

    IF v_redemption_count >= v_discount_code.maximum_redemptions THEN
      reason_code := 'maximum_redemptions_reached';
      RETURN NEXT;
      RETURN;
    END IF;
  END IF;

  IF v_discount_code.maximum_redemptions_per_user IS NOT NULL THEN
    SELECT count(*)
    INTO v_redemption_count
    FROM public.discount_redemptions
    WHERE discount_redemptions.discount_code_id = v_discount_code.id
      AND discount_redemptions.user_id = p_user_id;

    IF v_redemption_count >= v_discount_code.maximum_redemptions_per_user THEN
      reason_code := 'user_redemption_limit_reached';
      RETURN NEXT;
      RETURN;
    END IF;
  END IF;

  IF v_discount_code.first_order_only AND EXISTS (
    SELECT 1
    FROM public.orders
    WHERE orders.status = 'paid'
      AND orders.user_id = p_user_id
  ) THEN
    reason_code := 'not_first_order';
    RETURN NEXT;
    RETURN;
  END IF;

  BEGIN
    IF v_discount_code.first_email_only THEN
      IF EXISTS (
        SELECT 1
        FROM public.orders
        WHERE orders.status = 'paid'
          AND public.normalize_identity_email(
            COALESCE(
              nullif(btrim(orders.customer_email), ''),
              nullif(btrim(orders.email), '')
            )
          ) IS NOT NULL
          AND orders.customer_email_fingerprint IS NULL
      ) THEN
        reason_code := 'identity_unavailable';
        RETURN NEXT;
        RETURN;
      END IF;

      IF public.normalize_identity_email(p_email) IS NULL THEN
        reason_code := 'identity_unavailable';
        RETURN NEXT;
        RETURN;
      END IF;

      v_email_fingerprint := public.fingerprint_identity_email(p_email);

      IF EXISTS (
        SELECT 1
        FROM public.orders
        WHERE orders.status = 'paid'
          AND orders.customer_email_fingerprint = v_email_fingerprint
      ) THEN
        reason_code := 'not_first_email';
        RETURN NEXT;
        RETURN;
      END IF;
    END IF;

    IF v_discount_code.first_phone_only THEN
      IF EXISTS (
        SELECT 1
        FROM public.orders
        WHERE orders.status = 'paid'
          AND public.normalize_identity_phone(orders.shipping_phone) IS NOT NULL
          AND orders.shipping_phone_fingerprint IS NULL
      ) THEN
        reason_code := 'identity_unavailable';
        RETURN NEXT;
        RETURN;
      END IF;

      IF public.normalize_identity_phone(p_phone) IS NULL THEN
        reason_code := 'identity_unavailable';
        RETURN NEXT;
        RETURN;
      END IF;

      v_phone_fingerprint := public.fingerprint_identity_phone(p_phone);

      IF EXISTS (
        SELECT 1
        FROM public.orders
        WHERE orders.status = 'paid'
          AND orders.shipping_phone_fingerprint = v_phone_fingerprint
      ) THEN
        reason_code := 'not_first_phone';
        RETURN NEXT;
        RETURN;
      END IF;
    END IF;

    IF v_discount_code.first_household_only THEN
      IF EXISTS (
        SELECT 1
        FROM public.orders
        WHERE orders.status = 'paid'
          AND public.normalize_shipping_address_identity(orders.shipping_address) IS NOT NULL
          AND orders.shipping_address_fingerprint IS NULL
      ) THEN
        reason_code := 'identity_unavailable';
        RETURN NEXT;
        RETURN;
      END IF;

      IF public.normalize_shipping_address_identity(p_shipping_address) IS NULL THEN
        reason_code := 'identity_unavailable';
        RETURN NEXT;
        RETURN;
      END IF;

      v_shipping_address_fingerprint := public.fingerprint_shipping_address(p_shipping_address);

      IF EXISTS (
        SELECT 1
        FROM public.orders
        WHERE orders.status = 'paid'
          AND orders.shipping_address_fingerprint = v_shipping_address_fingerprint
      ) THEN
        reason_code := 'not_first_household';
        RETURN NEXT;
        RETURN;
      END IF;
    END IF;
  EXCEPTION
    WHEN SQLSTATE 'TAA01' THEN
      reason_code := 'identity_unavailable';
      RETURN NEXT;
      RETURN;
  END;

  IF v_discount_code.discount_type = 'percentage' THEN
    v_calculated_discount := round(
      p_subtotal_amount::numeric * v_discount_code.percent_off_bps::numeric / 10000
    );

    IF v_discount_code.maximum_discount_amount IS NOT NULL THEN
      v_calculated_discount := least(
        v_calculated_discount,
        v_discount_code.maximum_discount_amount::numeric
      );
    END IF;

    discount_amount := least(v_calculated_discount, p_subtotal_amount::numeric)::integer;
  ELSIF v_discount_code.discount_type = 'fixed' THEN
    discount_amount := least(v_discount_code.amount_off, p_subtotal_amount);
  ELSIF v_discount_code.discount_type = 'free_shipping' THEN
    shipping_discount_amount := p_shipping_amount;
    final_shipping_amount := 0;
  ELSE
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'Stored discount type is unsupported.';
  END IF;

  total_amount := p_subtotal_amount - discount_amount + final_shipping_amount;
  eligible := true;
  reason_code := 'eligible';

  RETURN NEXT;
END;
$function$;

REVOKE ALL ON FUNCTION public.evaluate_discount_code(
  text,
  integer,
  integer,
  uuid,
  text,
  text,
  jsonb,
  timestamp with time zone
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.evaluate_discount_code(
  text,
  integer,
  integer,
  uuid,
  text,
  text,
  jsonb,
  timestamp with time zone
) TO service_role;
