-- Canonical customer identity and permanent account ownership boundary.
--
-- This migration deliberately does not claim guest orders or alter checkout
-- orchestration. It only constrains browser access to the existing canonical
-- account and historical transaction tables.

DO $preflight$
BEGIN
  IF to_regclass('public.profiles') IS NULL THEN
    RAISE EXCEPTION 'Legacy public.profiles table is missing; refusing unreviewed retirement.';
  END IF;
END;
$preflight$;

-- Freeze the inspected legacy/profile/address state before checking it so the
-- fail-closed assumptions remain true until the migration commits.
LOCK TABLE public.profiles IN ACCESS EXCLUSIVE MODE;
LOCK TABLE public.customer_profiles, public.customer_addresses IN SHARE ROW EXCLUSIVE MODE;

DO $preflight_data$
BEGIN
  IF EXISTS (SELECT 1 FROM public.profiles) THEN
    RAISE EXCEPTION 'Legacy public.profiles contains rows; explicit migration is required.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.customer_profiles
    WHERE stripe_customer_id IS NOT NULL
    GROUP BY stripe_customer_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate customer_profiles.stripe_customer_id values prevent hardening.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.customer_addresses
    WHERE is_default_shipping
    GROUP BY user_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Multiple default shipping addresses exist for one customer.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.customer_addresses
    WHERE is_default_billing
    GROUP BY user_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Multiple default billing addresses exist for one customer.';
  END IF;
END;
$preflight_data$;

-- Every Auth user owns exactly one canonical customer profile. Existing names
-- remain customer-owned; only the authoritative Auth email is synchronized.
INSERT INTO public.customer_profiles AS profile (
  id,
  email,
  first_name,
  last_name,
  created_at,
  updated_at
)
SELECT
  users.id,
  users.email,
  users.raw_user_meta_data ->> 'first_name',
  users.raw_user_meta_data ->> 'last_name',
  COALESCE(users.created_at, statement_timestamp()),
  statement_timestamp()
FROM auth.users AS users
ON CONFLICT (id) DO UPDATE
SET
  email = EXCLUDED.email,
  updated_at = CASE
    WHEN profile.email IS DISTINCT FROM EXCLUDED.email THEN statement_timestamp()
    ELSE profile.updated_at
  END;

UPDATE public.customer_profiles
SET
  created_at = COALESCE(created_at, statement_timestamp()),
  updated_at = COALESCE(updated_at, statement_timestamp())
WHERE created_at IS NULL OR updated_at IS NULL;

ALTER TABLE public.customer_profiles
  ALTER COLUMN created_at SET DEFAULT now(),
  ALTER COLUMN created_at SET NOT NULL,
  ALTER COLUMN updated_at SET DEFAULT now(),
  ALTER COLUMN updated_at SET NOT NULL;

CREATE OR REPLACE FUNCTION public.handle_new_customer()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  INSERT INTO public.customer_profiles AS profile (
    id,
    email,
    first_name,
    last_name,
    created_at,
    updated_at
  )
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data ->> 'first_name',
    NEW.raw_user_meta_data ->> 'last_name',
    pg_catalog.statement_timestamp(),
    pg_catalog.statement_timestamp()
  )
  ON CONFLICT (id) DO UPDATE
  SET
    email = EXCLUDED.email,
    updated_at = CASE
      WHEN profile.email IS DISTINCT FROM EXCLUDED.email
        THEN pg_catalog.statement_timestamp()
      ELSE profile.updated_at
    END;

  RETURN NEW;
END;
$function$;

ALTER FUNCTION public.handle_new_customer() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.handle_new_customer() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.handle_new_customer() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handle_new_customer() TO postgres;

DROP TRIGGER IF EXISTS on_auth_customer_created ON auth.users;
CREATE TRIGGER on_auth_customer_created
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.handle_new_customer();

DROP TRIGGER IF EXISTS on_auth_customer_email_changed ON auth.users;
CREATE TRIGGER on_auth_customer_email_changed
AFTER UPDATE OF email ON auth.users
FOR EACH ROW
WHEN (OLD.email IS DISTINCT FROM NEW.email)
EXECUTE FUNCTION public.handle_new_customer();

CREATE OR REPLACE FUNCTION public.set_customer_account_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  NEW.updated_at := pg_catalog.statement_timestamp();
  RETURN NEW;
END;
$function$;

ALTER FUNCTION public.set_customer_account_updated_at() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.set_customer_account_updated_at() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_customer_account_updated_at() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_customer_account_updated_at() TO postgres;

DROP TRIGGER IF EXISTS set_customer_profiles_updated_at ON public.customer_profiles;
CREATE TRIGGER set_customer_profiles_updated_at
BEFORE UPDATE ON public.customer_profiles
FOR EACH ROW
EXECUTE FUNCTION public.set_customer_account_updated_at();

DROP TRIGGER IF EXISTS set_customer_addresses_updated_at ON public.customer_addresses;
CREATE TRIGGER set_customer_addresses_updated_at
BEFORE UPDATE ON public.customer_addresses
FOR EACH ROW
EXECUTE FUNCTION public.set_customer_account_updated_at();

CREATE UNIQUE INDEX customer_profiles_stripe_customer_id_key
ON public.customer_profiles (stripe_customer_id)
WHERE stripe_customer_id IS NOT NULL;

CREATE UNIQUE INDEX customer_addresses_one_default_shipping_per_user
ON public.customer_addresses (user_id)
WHERE is_default_shipping;

CREATE UNIQUE INDEX customer_addresses_one_default_billing_per_user
ON public.customer_addresses (user_id)
WHERE is_default_billing;

-- Browser profile access: full own-row reads, but only ordinary self-service
-- fields may be changed. Email and Stripe linkage remain server-managed.
DROP POLICY IF EXISTS "Customers can update own profile" ON public.customer_profiles;
DROP POLICY IF EXISTS "Customers can view own profile" ON public.customer_profiles;

CREATE POLICY "Customers can view own profile"
ON public.customer_profiles
FOR SELECT
TO authenticated
USING ((SELECT auth.uid()) = id);

CREATE POLICY "Customers can update own profile"
ON public.customer_profiles
FOR UPDATE
TO authenticated
USING ((SELECT auth.uid()) = id)
WITH CHECK ((SELECT auth.uid()) = id);

REVOKE ALL PRIVILEGES ON TABLE public.customer_profiles FROM anon, authenticated;
GRANT SELECT ON TABLE public.customer_profiles TO authenticated;
GRANT UPDATE (first_name, last_name, phone) ON TABLE public.customer_profiles TO authenticated;

-- Browser address access remains own-row CRUD, with ownership and timestamps
-- excluded from the writable column set.
DROP POLICY IF EXISTS "Customers can create own addresses" ON public.customer_addresses;
DROP POLICY IF EXISTS "Customers can delete own addresses" ON public.customer_addresses;
DROP POLICY IF EXISTS "Customers can update own addresses" ON public.customer_addresses;
DROP POLICY IF EXISTS "Customers can view own addresses" ON public.customer_addresses;

CREATE POLICY "Customers can view own addresses"
ON public.customer_addresses
FOR SELECT
TO authenticated
USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "Customers can create own addresses"
ON public.customer_addresses
FOR INSERT
TO authenticated
WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "Customers can update own addresses"
ON public.customer_addresses
FOR UPDATE
TO authenticated
USING ((SELECT auth.uid()) = user_id)
WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "Customers can delete own addresses"
ON public.customer_addresses
FOR DELETE
TO authenticated
USING ((SELECT auth.uid()) = user_id);

REVOKE ALL PRIVILEGES ON TABLE public.customer_addresses FROM anon, authenticated;
GRANT SELECT, DELETE ON TABLE public.customer_addresses TO authenticated;
GRANT INSERT (
  user_id,
  label,
  first_name,
  last_name,
  company,
  address_1,
  address_2,
  city,
  county,
  postcode,
  country,
  phone,
  is_default_shipping,
  is_default_billing
) ON TABLE public.customer_addresses TO authenticated;
GRANT UPDATE (
  label,
  first_name,
  last_name,
  company,
  address_1,
  address_2,
  city,
  county,
  postcode,
  country,
  phone,
  is_default_shipping,
  is_default_billing
) ON TABLE public.customer_addresses TO authenticated;

-- Historical order visibility is permanently tied to explicit account
-- ownership. Email remains transaction data and future claim evidence only.
DROP POLICY IF EXISTS "Customers can view own orders" ON public.orders;
DROP POLICY IF EXISTS "Users can view their own orders" ON public.orders;

CREATE POLICY "Customers can view own orders"
ON public.orders
FOR SELECT
TO authenticated
USING ((SELECT auth.uid()) = user_id);

REVOKE ALL PRIVILEGES ON TABLE public.orders FROM anon, authenticated;
GRANT SELECT ON TABLE public.orders TO authenticated;

DROP POLICY IF EXISTS "Customers can view own order items" ON public.order_items;
DROP POLICY IF EXISTS "Users can view their own order items" ON public.order_items;

CREATE POLICY "Customers can view own order items"
ON public.order_items
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.orders
    WHERE orders.id = order_items.order_id
      AND orders.user_id = (SELECT auth.uid())
  )
);

REVOKE ALL PRIVILEGES ON TABLE public.order_items FROM anon, authenticated;
GRANT SELECT ON TABLE public.order_items TO authenticated;

DROP POLICY IF EXISTS "Users can view their own shipments" ON public.shipments;

CREATE POLICY "Customers can view own shipments"
ON public.shipments
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.orders
    WHERE orders.id = shipments.order_id
      AND orders.user_id = (SELECT auth.uid())
  )
);

REVOKE ALL PRIVILEGES ON TABLE public.shipments FROM anon, authenticated;
GRANT SELECT ON TABLE public.shipments TO authenticated;

-- These legacy inventory helpers have no active repository caller. Preserve
-- their semantics for the trusted service path while removing browser RPC
-- exposure and search-path mutability.
ALTER FUNCTION public.decrement_product_inventory(uuid, integer)
  SET search_path = '';
REVOKE ALL ON FUNCTION public.decrement_product_inventory(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.decrement_product_inventory(uuid, integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.decrement_product_inventory(uuid, integer) TO service_role;

ALTER FUNCTION public.decrement_variant_inventory(uuid, integer)
  SET search_path = '';
REVOKE ALL ON FUNCTION public.decrement_variant_inventory(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.decrement_variant_inventory(uuid, integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.decrement_variant_inventory(uuid, integer) TO service_role;

-- RESTRICT is the final dependency guard: unexpected external dependencies
-- abort the entire transactional migration instead of being cascaded away.
DROP TABLE public.profiles RESTRICT;

COMMENT ON TABLE public.customer_profiles IS
  'Canonical one-to-one customer identity projection from auth.users.';
COMMENT ON COLUMN public.customer_profiles.stripe_customer_id IS
  'Privileged server-managed Stripe customer linkage; never browser-writable.';
COMMENT ON COLUMN public.orders.user_id IS
  'Permanent authenticated account ownership. NULL denotes an unclaimed guest order.';
