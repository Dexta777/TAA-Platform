-- Establish the server-owned discount catalogue, redemption history, and identity fingerprints.

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;

CREATE FUNCTION public.normalize_discount_code(p_code text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $function$
  SELECT nullif(upper(btrim(p_code)), '');
$function$;

CREATE FUNCTION public.normalize_identity_email(p_email text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $function$
  SELECT nullif(lower(regexp_replace(btrim(p_email), '[[:space:]]+', '', 'g')), '');
$function$;

CREATE FUNCTION public.normalize_identity_phone(p_phone text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $function$
DECLARE
  v_input text := btrim(COALESCE(p_phone, ''));
  v_digits text;
BEGIN
  v_digits := regexp_replace(v_input, '[^0-9]', '', 'g');

  IF v_digits = '' THEN
    RETURN NULL;
  END IF;

  IF v_digits LIKE '00%' THEN
    v_digits := substr(v_digits, 3);
  ELSIF v_input !~ '^\s*\+' AND v_digits LIKE '0%' THEN
    v_digits := '44' || substr(v_digits, 2);
  END IF;

  -- Ignore the optional UK trunk prefix sometimes written as +44 (0).
  IF v_digits LIKE '440%' THEN
    v_digits := '44' || substr(v_digits, 4);
  END IF;

  IF v_digits = '' THEN
    RETURN NULL;
  END IF;

  RETURN '+' || v_digits;
END;
$function$;

CREATE FUNCTION public.normalize_address_component(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $function$
  SELECT nullif(
    btrim(regexp_replace(upper(COALESCE(p_value, '')), '[^A-Z0-9]+', ' ', 'g')),
    ''
  );
$function$;

CREATE FUNCTION public.normalize_street_address_component(p_value text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $function$
DECLARE
  v_normalized text := public.normalize_address_component(p_value);
BEGIN
  IF v_normalized IS NULL THEN
    RETURN NULL;
  END IF;

  v_normalized := regexp_replace(v_normalized, ' STREET$', ' ST');
  v_normalized := regexp_replace(v_normalized, ' ROAD$', ' RD');
  v_normalized := regexp_replace(v_normalized, ' AVENUE$', ' AVE');
  v_normalized := regexp_replace(v_normalized, ' LANE$', ' LN');
  v_normalized := regexp_replace(v_normalized, ' DRIVE$', ' DR');
  v_normalized := regexp_replace(v_normalized, ' CLOSE$', ' CL');
  v_normalized := regexp_replace(v_normalized, ' COURT$', ' CT');
  v_normalized := regexp_replace(v_normalized, ' PLACE$', ' PL');
  v_normalized := regexp_replace(v_normalized, ' TERRACE$', ' TER');

  RETURN v_normalized;
END;
$function$;

CREATE FUNCTION public.normalize_shipping_address_identity(p_address jsonb)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $function$
DECLARE
  v_country text;
  v_postcode text;
  v_address_line_1 text;
  v_address_line_2 text;
BEGIN
  IF p_address IS NULL OR jsonb_typeof(p_address) <> 'object' THEN
    RETURN NULL;
  END IF;

  v_country := public.normalize_address_component(
    COALESCE(
      nullif(btrim(p_address ->> 'country'), ''),
      nullif(btrim(p_address #>> '{address,country}'), '')
    )
  );

  IF v_country IN ('GB', 'UK', 'U K', 'G B', 'GBR', 'UNITED KINGDOM', 'GREAT BRITAIN') THEN
    v_country := 'GB';
  END IF;

  v_postcode := nullif(
    regexp_replace(
      upper(
        COALESCE(
          nullif(btrim(p_address ->> 'postcode'), ''),
          nullif(btrim(p_address ->> 'postal_code'), ''),
          nullif(btrim(p_address #>> '{address,postcode}'), ''),
          nullif(btrim(p_address #>> '{address,postal_code}'), '')
        )
      ),
      '[^A-Z0-9]',
      '',
      'g'
    ),
    ''
  );

  v_address_line_1 := public.normalize_street_address_component(
    COALESCE(
      nullif(btrim(p_address ->> 'address_1'), ''),
      nullif(btrim(p_address ->> 'line1'), ''),
      nullif(btrim(p_address #>> '{address,address_1}'), ''),
      nullif(btrim(p_address #>> '{address,line1}'), '')
    )
  );
  v_address_line_2 := public.normalize_address_component(
    COALESCE(
      nullif(btrim(p_address ->> 'address_2'), ''),
      nullif(btrim(p_address ->> 'line2'), ''),
      nullif(btrim(p_address #>> '{address,address_2}'), ''),
      nullif(btrim(p_address #>> '{address,line2}'), '')
    )
  );

  IF v_country IS NULL OR v_postcode IS NULL OR v_address_line_1 IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN v_country || '|' || v_postcode || '|' || v_address_line_1 || '|'
    || COALESCE(v_address_line_2, '');
END;
$function$;

CREATE FUNCTION public.identity_fingerprint_hmac(p_normalized_value text)
RETURNS text
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_pepper text;
BEGIN
  IF p_normalized_value IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT decrypted_secret
  INTO v_pepper
  FROM vault.decrypted_secrets
  WHERE name = 'taa_identity_fingerprint_pepper';

  IF nullif(v_pepper, '') IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = 'TAA01',
      MESSAGE = 'Identity fingerprint pepper is not provisioned.',
      HINT = 'Create the named Supabase Vault secret taa_identity_fingerprint_pepper, then run public.backfill_paid_order_identity_fingerprints().';
  END IF;

  RETURN encode(
    extensions.hmac(p_normalized_value, v_pepper, 'sha256'),
    'hex'
  );
END;
$function$;

CREATE FUNCTION public.fingerprint_identity_email(p_email text)
RETURNS text
LANGUAGE sql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT public.identity_fingerprint_hmac(public.normalize_identity_email(p_email));
$function$;

CREATE FUNCTION public.fingerprint_identity_phone(p_phone text)
RETURNS text
LANGUAGE sql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT public.identity_fingerprint_hmac(public.normalize_identity_phone(p_phone));
$function$;

CREATE FUNCTION public.fingerprint_shipping_address(p_address jsonb)
RETURNS text
LANGUAGE sql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT public.identity_fingerprint_hmac(
    public.normalize_shipping_address_identity(p_address)
  );
$function$;

CREATE TABLE public.discount_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL,
  name text,
  description text,
  discount_type text NOT NULL,
  percent_off_bps integer,
  amount_off integer,
  active boolean NOT NULL DEFAULT true,
  starts_at timestamp with time zone,
  expires_at timestamp with time zone,
  minimum_subtotal_amount integer NOT NULL DEFAULT 0,
  maximum_discount_amount integer,
  maximum_redemptions integer,
  maximum_redemptions_per_user integer,
  requires_account boolean NOT NULL DEFAULT false,
  first_order_only boolean NOT NULL DEFAULT false,
  first_email_only boolean NOT NULL DEFAULT false,
  first_phone_only boolean NOT NULL DEFAULT false,
  first_household_only boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT discount_codes_code_normalized_check
    CHECK (code = public.normalize_discount_code(code)),
  CONSTRAINT discount_codes_type_check
    CHECK (discount_type IN ('percentage', 'fixed', 'free_shipping')),
  CONSTRAINT discount_codes_value_check
    CHECK (
      (
        discount_type = 'percentage'
        AND percent_off_bps BETWEEN 1 AND 10000
        AND amount_off IS NULL
      )
      OR (
        discount_type = 'fixed'
        AND amount_off > 0
        AND percent_off_bps IS NULL
      )
      OR (
        discount_type = 'free_shipping'
        AND percent_off_bps IS NULL
        AND amount_off IS NULL
      )
    ),
  CONSTRAINT discount_codes_minimum_subtotal_check
    CHECK (minimum_subtotal_amount >= 0),
  CONSTRAINT discount_codes_maximum_discount_check
    CHECK (
      maximum_discount_amount IS NULL
      OR (
        discount_type = 'percentage'
        AND maximum_discount_amount >= 0
      )
    ),
  CONSTRAINT discount_codes_maximum_redemptions_check
    CHECK (maximum_redemptions IS NULL OR maximum_redemptions >= 0),
  CONSTRAINT discount_codes_maximum_redemptions_per_user_check
    CHECK (
      maximum_redemptions_per_user IS NULL
      OR maximum_redemptions_per_user >= 0
    ),
  CONSTRAINT discount_codes_schedule_check
    CHECK (starts_at IS NULL OR expires_at IS NULL OR starts_at < expires_at)
);

CREATE UNIQUE INDEX discount_codes_code_case_insensitive_key
  ON public.discount_codes (lower(code));

CREATE FUNCTION public.prepare_discount_code()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  NEW.code := public.normalize_discount_code(NEW.code);
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

CREATE TRIGGER prepare_discount_code_before_write
BEFORE INSERT OR UPDATE ON public.discount_codes
FOR EACH ROW
EXECUTE FUNCTION public.prepare_discount_code();

ALTER TABLE public.discount_codes ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.checkout_intents
  ADD COLUMN discount_code_id uuid,
  ADD COLUMN discount_code text,
  ADD COLUMN discount_amount integer NOT NULL DEFAULT 0,
  ADD COLUMN shipping_discount_amount integer NOT NULL DEFAULT 0,
  ADD COLUMN stripe_coupon_id text,
  ADD CONSTRAINT checkout_intents_discount_code_id_fkey
    FOREIGN KEY (discount_code_id) REFERENCES public.discount_codes(id) ON DELETE SET NULL,
  ADD CONSTRAINT checkout_intents_discount_amount_check
    CHECK (discount_amount >= 0),
  ADD CONSTRAINT checkout_intents_shipping_discount_amount_check
    CHECK (shipping_discount_amount >= 0);

ALTER TABLE public.orders
  ADD COLUMN discount_code_id uuid,
  ADD COLUMN discount_code text,
  ADD COLUMN discount_amount integer NOT NULL DEFAULT 0,
  ADD COLUMN shipping_discount_amount integer NOT NULL DEFAULT 0,
  ADD COLUMN customer_email_fingerprint text,
  ADD COLUMN shipping_phone_fingerprint text,
  ADD COLUMN shipping_address_fingerprint text,
  ADD CONSTRAINT orders_discount_code_id_fkey
    FOREIGN KEY (discount_code_id) REFERENCES public.discount_codes(id) ON DELETE SET NULL,
  ADD CONSTRAINT orders_discount_amount_check
    CHECK (discount_amount >= 0),
  ADD CONSTRAINT orders_shipping_discount_amount_check
    CHECK (shipping_discount_amount >= 0),
  ADD CONSTRAINT orders_customer_email_fingerprint_check
    CHECK (
      customer_email_fingerprint IS NULL
      OR customer_email_fingerprint ~ '^[0-9a-f]{64}$'
    ),
  ADD CONSTRAINT orders_shipping_phone_fingerprint_check
    CHECK (
      shipping_phone_fingerprint IS NULL
      OR shipping_phone_fingerprint ~ '^[0-9a-f]{64}$'
    ),
  ADD CONSTRAINT orders_shipping_address_fingerprint_check
    CHECK (
      shipping_address_fingerprint IS NULL
      OR shipping_address_fingerprint ~ '^[0-9a-f]{64}$'
    );

CREATE FUNCTION public.set_paid_order_identity_fingerprints()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
DECLARE
  v_customer_email_fingerprint text;
  v_shipping_phone_fingerprint text;
  v_shipping_address_fingerprint text;
BEGIN
  IF NEW.status = 'paid' THEN
    BEGIN
      v_customer_email_fingerprint := public.fingerprint_identity_email(
        COALESCE(nullif(btrim(NEW.customer_email), ''), nullif(btrim(NEW.email), ''))
      );
      v_shipping_phone_fingerprint := public.fingerprint_identity_phone(NEW.shipping_phone);
      v_shipping_address_fingerprint := public.fingerprint_shipping_address(NEW.shipping_address);

      NEW.customer_email_fingerprint := v_customer_email_fingerprint;
      NEW.shipping_phone_fingerprint := v_shipping_phone_fingerprint;
      NEW.shipping_address_fingerprint := v_shipping_address_fingerprint;
    EXCEPTION
      WHEN SQLSTATE 'TAA01' THEN
        NEW.customer_email_fingerprint := NULL;
        NEW.shipping_phone_fingerprint := NULL;
        NEW.shipping_address_fingerprint := NULL;

        RAISE WARNING
          'Paid order identity fingerprints were not generated because the Vault pepper is unavailable.';
    END;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE TRIGGER set_paid_order_identity_fingerprints_before_write
BEFORE INSERT OR UPDATE OF
  status,
  customer_email,
  email,
  shipping_phone,
  shipping_address
ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.set_paid_order_identity_fingerprints();

-- The pepper is provisioned outside migrations. Run this explicitly after provisioning it.
CREATE FUNCTION public.backfill_paid_order_identity_fingerprints()
RETURNS bigint
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_updated_count bigint;
BEGIN
  -- Validate pepper availability even when there are no paid orders to update.
  PERFORM public.identity_fingerprint_hmac('identity-fingerprint-readiness-check');

  UPDATE public.orders
  SET
    customer_email_fingerprint = public.fingerprint_identity_email(
      COALESCE(nullif(btrim(customer_email), ''), nullif(btrim(email), ''))
    ),
    shipping_phone_fingerprint = public.fingerprint_identity_phone(shipping_phone),
    shipping_address_fingerprint = public.fingerprint_shipping_address(shipping_address)
  WHERE status = 'paid';

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  RETURN v_updated_count;
END;
$function$;

CREATE INDEX orders_paid_user_id_idx
  ON public.orders (user_id)
  WHERE user_id IS NOT NULL AND status = 'paid';

CREATE INDEX orders_paid_customer_email_fingerprint_idx
  ON public.orders (customer_email_fingerprint)
  WHERE customer_email_fingerprint IS NOT NULL AND status = 'paid';

CREATE INDEX orders_paid_shipping_phone_fingerprint_idx
  ON public.orders (shipping_phone_fingerprint)
  WHERE shipping_phone_fingerprint IS NOT NULL AND status = 'paid';

CREATE INDEX orders_paid_shipping_address_fingerprint_idx
  ON public.orders (shipping_address_fingerprint)
  WHERE shipping_address_fingerprint IS NOT NULL AND status = 'paid';

CREATE TABLE public.discount_redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  discount_code_id uuid NOT NULL REFERENCES public.discount_codes(id),
  checkout_intent_id uuid NOT NULL UNIQUE REFERENCES public.checkout_intents(id),
  order_id uuid NOT NULL UNIQUE REFERENCES public.orders(id),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  code_snapshot text NOT NULL,
  email_fingerprint text,
  phone_fingerprint text,
  shipping_address_fingerprint text,
  discount_amount integer NOT NULL DEFAULT 0,
  shipping_discount_amount integer NOT NULL DEFAULT 0,
  redeemed_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT discount_redemptions_code_snapshot_check
    CHECK (code_snapshot = public.normalize_discount_code(code_snapshot)),
  CONSTRAINT discount_redemptions_email_fingerprint_check
    CHECK (email_fingerprint IS NULL OR email_fingerprint ~ '^[0-9a-f]{64}$'),
  CONSTRAINT discount_redemptions_phone_fingerprint_check
    CHECK (phone_fingerprint IS NULL OR phone_fingerprint ~ '^[0-9a-f]{64}$'),
  CONSTRAINT discount_redemptions_shipping_address_fingerprint_check
    CHECK (
      shipping_address_fingerprint IS NULL
      OR shipping_address_fingerprint ~ '^[0-9a-f]{64}$'
    ),
  CONSTRAINT discount_redemptions_discount_amount_check
    CHECK (discount_amount >= 0),
  CONSTRAINT discount_redemptions_shipping_discount_amount_check
    CHECK (shipping_discount_amount >= 0)
);

CREATE INDEX discount_redemptions_discount_code_id_idx
  ON public.discount_redemptions (discount_code_id);

CREATE INDEX discount_redemptions_user_id_idx
  ON public.discount_redemptions (user_id)
  WHERE user_id IS NOT NULL;

CREATE INDEX discount_redemptions_email_fingerprint_idx
  ON public.discount_redemptions (email_fingerprint)
  WHERE email_fingerprint IS NOT NULL;

CREATE INDEX discount_redemptions_phone_fingerprint_idx
  ON public.discount_redemptions (phone_fingerprint)
  WHERE phone_fingerprint IS NOT NULL;

CREATE INDEX discount_redemptions_shipping_address_fingerprint_idx
  ON public.discount_redemptions (shipping_address_fingerprint)
  WHERE shipping_address_fingerprint IS NOT NULL;

ALTER TABLE public.discount_redemptions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON SCHEMA vault FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE vault.secrets FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE vault.decrypted_secrets FROM PUBLIC, anon, authenticated;

REVOKE ALL ON TABLE public.discount_codes FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.discount_redemptions FROM PUBLIC, anon, authenticated;

GRANT ALL ON TABLE public.discount_codes TO service_role;
GRANT ALL ON TABLE public.discount_redemptions TO service_role;

REVOKE ALL ON FUNCTION public.normalize_discount_code(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.normalize_identity_email(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.normalize_identity_phone(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.normalize_address_component(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.normalize_street_address_component(text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.normalize_shipping_address_identity(jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.identity_fingerprint_hmac(text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fingerprint_identity_email(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fingerprint_identity_phone(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fingerprint_shipping_address(jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prepare_discount_code() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_paid_order_identity_fingerprints()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.backfill_paid_order_identity_fingerprints()
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.normalize_discount_code(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.normalize_identity_email(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.normalize_identity_phone(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.normalize_address_component(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.normalize_street_address_component(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.normalize_shipping_address_identity(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.fingerprint_identity_email(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fingerprint_identity_phone(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fingerprint_shipping_address(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.prepare_discount_code() TO service_role;
GRANT EXECUTE ON FUNCTION public.set_paid_order_identity_fingerprints() TO service_role;
GRANT EXECUTE ON FUNCTION public.backfill_paid_order_identity_fingerprints() TO service_role;
