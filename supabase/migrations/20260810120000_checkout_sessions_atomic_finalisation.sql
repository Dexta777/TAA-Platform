-- Support Stripe Checkout Elements Sessions without invalidating legacy PaymentIntent rows.

ALTER TABLE public.checkout_intents
  ALTER COLUMN payment_intent_id DROP NOT NULL;

ALTER TABLE public.checkout_intents
  ADD COLUMN stripe_checkout_session_id text,
  ADD COLUMN user_id uuid,
  ADD COLUMN stripe_customer_id text,
  ADD COLUMN confirmation_token_hash text,
  ADD COLUMN confirmation_token_expires_at timestamp with time zone,
  ADD COLUMN create_account_requested boolean NOT NULL DEFAULT false;

ALTER TABLE public.checkout_intents
  ADD CONSTRAINT checkout_intents_stripe_checkout_session_id_key
    UNIQUE (stripe_checkout_session_id),
  ADD CONSTRAINT checkout_intents_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD CONSTRAINT checkout_intents_confirmation_token_hash_check
    CHECK (
      (
        confirmation_token_hash IS NULL
        AND confirmation_token_expires_at IS NULL
      )
      OR (
        confirmation_token_hash ~ '^[0-9a-f]{64}$'
        AND confirmation_token_expires_at IS NOT NULL
      )
    );

ALTER TABLE public.checkout_intent_items
  ADD COLUMN base_product_id uuid,
  ADD COLUMN product_name text,
  ADD COLUMN variant_name text;

ALTER TABLE public.checkout_intent_items
  ADD CONSTRAINT checkout_intent_items_base_product_id_fkey
    FOREIGN KEY (base_product_id) REFERENCES public.products(id) ON DELETE SET NULL;

CREATE INDEX checkout_intents_user_id_idx
  ON public.checkout_intents (user_id)
  WHERE user_id IS NOT NULL;

CREATE INDEX checkout_intents_status_idx
  ON public.checkout_intents (status);

ALTER TABLE public.orders
  ADD COLUMN checkout_intent_id uuid,
  ADD COLUMN stripe_checkout_session_id text;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_checkout_intent_id_key UNIQUE (checkout_intent_id),
  ADD CONSTRAINT orders_checkout_intent_id_fkey
    FOREIGN KEY (checkout_intent_id) REFERENCES public.checkout_intents(id) ON DELETE SET NULL,
  ADD CONSTRAINT orders_stripe_checkout_session_id_key
    UNIQUE (stripe_checkout_session_id);

CREATE SEQUENCE public.taa_order_number_seq;

REVOKE ALL ON SEQUENCE public.taa_order_number_seq FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.finalize_paid_checkout(
  p_checkout_session_id text DEFAULT NULL,
  p_payment_intent_id text DEFAULT NULL,
  p_stripe_customer_id text DEFAULT NULL,
  p_payment_method_type text DEFAULT NULL,
  p_payment_brand text DEFAULT NULL,
  p_payment_last4 text DEFAULT NULL,
  p_payment_exp_month integer DEFAULT NULL,
  p_payment_exp_year integer DEFAULT NULL
)
RETURNS TABLE (
  order_id uuid,
  order_number text,
  already_finalized boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_checkout_intent public.checkout_intents%ROWTYPE;
  v_checkout_item public.checkout_intent_items%ROWTYPE;
  v_order_id uuid;
  v_order_number text;
  v_inventory_product_id uuid;
  v_item_count integer;
BEGIN
  IF nullif(btrim(p_checkout_session_id), '') IS NULL
    AND nullif(btrim(p_payment_intent_id), '') IS NULL THEN
    RAISE EXCEPTION 'A Checkout Session ID or PaymentIntent ID is required.';
  END IF;

  IF nullif(btrim(p_checkout_session_id), '') IS NOT NULL THEN
    SELECT checkout_intents.*
    INTO v_checkout_intent
    FROM public.checkout_intents
    WHERE stripe_checkout_session_id = btrim(p_checkout_session_id)
    FOR UPDATE;

    IF FOUND
      AND nullif(btrim(p_payment_intent_id), '') IS NOT NULL
      AND v_checkout_intent.payment_intent_id IS DISTINCT FROM btrim(p_payment_intent_id) THEN
      RAISE EXCEPTION 'Checkout Session and PaymentIntent do not identify the same checkout.';
    END IF;
  ELSE
    SELECT checkout_intents.*
    INTO v_checkout_intent
    FROM public.checkout_intents
    WHERE payment_intent_id = btrim(p_payment_intent_id)
    FOR UPDATE;
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Checkout intent not found.';
  END IF;

  SELECT orders.id, orders.order_number
  INTO v_order_id, v_order_number
  FROM public.orders
  WHERE orders.checkout_intent_id = v_checkout_intent.id
    OR (
      v_checkout_intent.payment_intent_id IS NOT NULL
      AND orders.payment_intent_id = v_checkout_intent.payment_intent_id
    )
  ORDER BY
    CASE WHEN orders.checkout_intent_id = v_checkout_intent.id THEN 0 ELSE 1 END
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    UPDATE public.checkout_intents
    SET
      status = 'paid',
      paid_at = COALESCE(paid_at, now()),
      payment_intent_id = COALESCE(payment_intent_id, nullif(btrim(p_payment_intent_id), '')),
      stripe_customer_id = COALESCE(
        nullif(btrim(p_stripe_customer_id), ''),
        stripe_customer_id
      )
    WHERE id = v_checkout_intent.id;

    UPDATE public.orders
    SET
      checkout_intent_id = COALESCE(checkout_intent_id, v_checkout_intent.id),
      stripe_checkout_session_id = COALESCE(
        stripe_checkout_session_id,
        v_checkout_intent.stripe_checkout_session_id
      ),
      stripe_customer_id = COALESCE(
        stripe_customer_id,
        nullif(btrim(p_stripe_customer_id), '')
      )
    WHERE id = v_order_id;

    RETURN QUERY SELECT v_order_id, v_order_number, true;
    RETURN;
  END IF;

  IF nullif(btrim(v_checkout_intent.customer_email), '') IS NULL THEN
    RAISE EXCEPTION 'Checkout customer email is required.';
  END IF;

  SELECT count(*)
  INTO v_item_count
  FROM public.checkout_intent_items
  WHERE checkout_intent_id = v_checkout_intent.id;

  IF v_item_count = 0 THEN
    RAISE EXCEPTION 'Checkout items not found.';
  END IF;

  FOR v_checkout_item IN
    SELECT *
    FROM public.checkout_intent_items
    WHERE checkout_intent_id = v_checkout_intent.id
    ORDER BY product_type, product_id, id
  LOOP
    IF v_checkout_item.quantity IS NULL OR v_checkout_item.quantity < 1 THEN
      RAISE EXCEPTION 'Invalid checkout quantity for SKU %.', v_checkout_item.sku;
    END IF;

    v_inventory_product_id := NULL;

    IF v_checkout_item.product_type = 'product' THEN
      UPDATE public.products
      SET inventory_quantity = inventory_quantity - v_checkout_item.quantity
      WHERE id = v_checkout_item.product_id
        AND active = true
        AND inventory_quantity >= v_checkout_item.quantity
      RETURNING id INTO v_inventory_product_id;
    ELSIF v_checkout_item.product_type = 'variant' THEN
      UPDATE public.product_variants
      SET inventory_quantity = inventory_quantity - v_checkout_item.quantity
      WHERE id = v_checkout_item.product_id
        AND active = true
        AND inventory_quantity >= v_checkout_item.quantity
      RETURNING product_id INTO v_inventory_product_id;
    ELSE
      RAISE EXCEPTION 'Unsupported checkout product type for SKU %.', v_checkout_item.sku;
    END IF;

    IF v_inventory_product_id IS NULL THEN
      RAISE EXCEPTION 'Insufficient inventory for SKU %.', v_checkout_item.sku;
    END IF;
  END LOOP;

  v_order_number := 'TAA-'
    || to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYYMMDD')
    || '-'
    || lpad(nextval('public.taa_order_number_seq')::text, 8, '0');

  INSERT INTO public.orders (
    user_id,
    email,
    order_number,
    stripe_payment_intent_id,
    status,
    total,
    currency,
    shipping_name,
    shipping_address,
    payment_intent_id,
    customer_email,
    subtotal_amount,
    shipping_amount,
    total_amount,
    shipping_method_name,
    shipping_phone,
    billing_name,
    billing_address,
    fulfillment_status,
    payment_method_type,
    payment_brand,
    payment_last4,
    payment_exp_month,
    payment_exp_year,
    stripe_customer_id,
    checkout_intent_id,
    stripe_checkout_session_id
  )
  VALUES (
    v_checkout_intent.user_id,
    v_checkout_intent.customer_email,
    v_order_number,
    COALESCE(
      nullif(btrim(p_payment_intent_id), ''),
      v_checkout_intent.payment_intent_id
    ),
    'paid',
    v_checkout_intent.total_amount::numeric / 100,
    upper(v_checkout_intent.currency),
    v_checkout_intent.shipping_name,
    v_checkout_intent.shipping_address,
    COALESCE(
      nullif(btrim(p_payment_intent_id), ''),
      v_checkout_intent.payment_intent_id
    ),
    v_checkout_intent.customer_email,
    v_checkout_intent.subtotal_amount,
    v_checkout_intent.shipping_amount,
    v_checkout_intent.total_amount,
    v_checkout_intent.shipping_method_name,
    v_checkout_intent.shipping_phone,
    v_checkout_intent.billing_name,
    v_checkout_intent.billing_address,
    'unfulfilled',
    p_payment_method_type,
    p_payment_brand,
    p_payment_last4,
    p_payment_exp_month,
    p_payment_exp_year,
    COALESCE(
      nullif(btrim(p_stripe_customer_id), ''),
      v_checkout_intent.stripe_customer_id
    ),
    v_checkout_intent.id,
    v_checkout_intent.stripe_checkout_session_id
  )
  RETURNING id INTO v_order_id;

  INSERT INTO public.order_items (
    order_id,
    product_id,
    sku,
    product_name,
    quantity,
    unit_price,
    line_total,
    product_type,
    name,
    unit_amount,
    image_url,
    amount
  )
  SELECT
    v_order_id,
    COALESCE(
      checkout_items.base_product_id,
      CASE
        WHEN checkout_items.product_type = 'variant' THEN variants.product_id
        ELSE checkout_items.product_id
      END
    ),
    checkout_items.sku,
    COALESCE(checkout_items.product_name, checkout_items.name),
    checkout_items.quantity,
    checkout_items.unit_amount::numeric / 100,
    checkout_items.line_total::numeric / 100,
    checkout_items.product_type,
    checkout_items.name,
    checkout_items.unit_amount,
    checkout_items.image_url,
    checkout_items.amount
  FROM public.checkout_intent_items AS checkout_items
  LEFT JOIN public.product_variants AS variants
    ON checkout_items.product_type = 'variant'
    AND variants.id = checkout_items.product_id
  WHERE checkout_items.checkout_intent_id = v_checkout_intent.id;

  GET DIAGNOSTICS v_item_count = ROW_COUNT;

  IF v_item_count = 0 THEN
    RAISE EXCEPTION 'Order items could not be created.';
  END IF;

  UPDATE public.checkout_intents
  SET
    status = 'paid',
    paid_at = now(),
    payment_intent_id = COALESCE(
      payment_intent_id,
      nullif(btrim(p_payment_intent_id), '')
    ),
    stripe_customer_id = COALESCE(
      nullif(btrim(p_stripe_customer_id), ''),
      stripe_customer_id
    )
  WHERE id = v_checkout_intent.id;

  RETURN QUERY SELECT v_order_id, v_order_number, false;
END;
$function$;

REVOKE ALL ON FUNCTION public.finalize_paid_checkout(
  text,
  text,
  text,
  text,
  text,
  text,
  integer,
  integer
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.finalize_paid_checkout(
  text,
  text,
  text,
  text,
  text,
  text,
  integer,
  integer
) TO service_role;
