-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

DROP EXTENSION pg_net;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE UPDATE ON SEQUENCES FROM anon;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE UPDATE ON SEQUENCES FROM authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE UPDATE ON SEQUENCES FROM service_role;

CREATE EXTENSION pg_net WITH SCHEMA public;

CREATE FUNCTION public.decrement_product_inventory (
  product_id_input uuid,
  quantity_input   integer
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  AS $function$
begin
  update public.products
  set inventory_quantity = inventory_quantity - quantity_input
  where id = product_id_input
  and inventory_quantity >= quantity_input;
end;
$function$;

GRANT ALL ON FUNCTION public.decrement_product_inventory(uuid, integer) TO service_role;

CREATE FUNCTION public.decrement_variant_inventory (
  variant_id_input uuid,
  quantity_input   integer
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  AS $function$
begin
  update public.product_variants
  set inventory_quantity = inventory_quantity - quantity_input
  where id = variant_id_input
  and inventory_quantity >= quantity_input;
end;
$function$;

GRANT ALL ON FUNCTION public.decrement_variant_inventory(uuid, integer) TO service_role;

CREATE FUNCTION public.handle_new_customer()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
begin
  insert into public.customer_profiles (
    id,
    email,
    first_name,
    last_name,
    created_at,
    updated_at
  )
  values (
    new.id,
    new.email,
    new.raw_user_meta_data ->> 'first_name',
    new.raw_user_meta_data ->> 'last_name',
    now(),
    now()
  )
  on conflict (id) do nothing;

  return new;
end;
$function$;

CREATE TRIGGER on_auth_customer_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_customer();

CREATE FUNCTION public.rls_auto_enable()
  RETURNS event_trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'pg_catalog'
  AS $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$;

CREATE FUNCTION public.trigger_klaviyo_catalog_sync()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  AS $function$
begin
  perform net.http_post(
    url := 'https://zxmywtmjvfjgdjcstgtn.supabase.co/functions/v1/sync-klaviyo-catalog',
    headers := jsonb_build_object(
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object(
      'source_table', tg_table_name,
      'operation', tg_op,
      'record_id', coalesce(new.id, old.id),
      'old_record', case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end,
      'new_record', case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end
    )
  );

  return coalesce(new, old);
end;
$function$;

CREATE TABLE public.checkout_intent_items (
  id                 uuid                     DEFAULT gen_random_uuid() NOT NULL,
  checkout_intent_id uuid,
  product_type       text,
  product_id         uuid,
  sku                text                     NOT NULL,
  name               text,
  quantity           integer                  NOT NULL,
  unit_amount        integer                  NOT NULL,
  line_total         integer                  NOT NULL,
  weight_grams       integer,
  created_at         timestamp with time zone DEFAULT now(),
  image_url          text,
  amount             text
);

ALTER TABLE public.checkout_intent_items
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.checkout_intent_items
  ADD CONSTRAINT checkout_intent_items_pkey PRIMARY KEY (id);

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.checkout_intent_items TO anon;

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.checkout_intent_items TO authenticated;

GRANT INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.checkout_intent_items TO service_role;

CREATE TABLE public.checkout_intents (
  id                   uuid                     DEFAULT gen_random_uuid() NOT NULL,
  payment_intent_id    text                     NOT NULL,
  status               text                     DEFAULT 'pending'::text NOT NULL,
  customer_email       text,
  subtotal_amount      integer                  NOT NULL,
  shipping_amount      integer                  NOT NULL,
  total_amount         integer                  NOT NULL,
  currency             text                     DEFAULT 'gbp'::text NOT NULL,
  shipping_method_name text,
  shipping_method_id   uuid,
  shipping_rate_id     uuid,
  total_weight_grams   integer,
  created_at           timestamp with time zone DEFAULT now(),
  paid_at              timestamp with time zone,
  shipping_name        text,
  shipping_phone       text,
  shipping_address     jsonb,
  billing_name         text,
  billing_address      jsonb,
  billing_is_different boolean                  DEFAULT false
);

ALTER TABLE public.checkout_intents
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.checkout_intents
  ADD CONSTRAINT checkout_intents_payment_intent_id_key UNIQUE (payment_intent_id);

ALTER TABLE public.checkout_intents
  ADD CONSTRAINT checkout_intents_pkey PRIMARY KEY (id);

ALTER TABLE public.checkout_intent_items
  ADD CONSTRAINT checkout_intent_items_checkout_intent_id_fkey FOREIGN KEY (checkout_intent_id) REFERENCES public.checkout_intents(id) ON DELETE CASCADE;

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.checkout_intents TO anon;

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.checkout_intents TO authenticated;

GRANT INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.checkout_intents TO service_role;

CREATE TABLE public.customer_addresses (
  id                  uuid                     DEFAULT gen_random_uuid() NOT NULL,
  user_id             uuid                     NOT NULL,
  label               text,
  first_name          text                     NOT NULL,
  last_name           text                     NOT NULL,
  company             text,
  address_1           text                     NOT NULL,
  address_2           text,
  city                text                     NOT NULL,
  county              text,
  postcode            text                     NOT NULL,
  country             text                     DEFAULT 'United Kingdom'::text NOT NULL,
  phone               text,
  is_default_shipping boolean                  DEFAULT false NOT NULL,
  is_default_billing  boolean                  DEFAULT false NOT NULL,
  created_at          timestamp with time zone DEFAULT now() NOT NULL,
  updated_at          timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.customer_addresses
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.customer_addresses
  ADD CONSTRAINT customer_addresses_pkey PRIMARY KEY (id);

ALTER TABLE public.customer_addresses
  ADD CONSTRAINT customer_addresses_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.customer_addresses TO anon;

GRANT ALL ON public.customer_addresses TO authenticated;

GRANT ALL ON public.customer_addresses TO service_role;

CREATE POLICY "Customers can create own addresses" ON public.customer_addresses
  FOR INSERT
  TO authenticated
  WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));

CREATE POLICY "Customers can delete own addresses" ON public.customer_addresses
  FOR DELETE
  TO authenticated
  USING ((( SELECT auth.uid() AS uid) = user_id));

CREATE POLICY "Customers can update own addresses" ON public.customer_addresses
  FOR UPDATE
  TO authenticated
  USING ((( SELECT auth.uid() AS uid) = user_id))
  WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));

CREATE POLICY "Customers can view own addresses" ON public.customer_addresses
  FOR SELECT
  TO authenticated
  USING ((( SELECT auth.uid() AS uid) = user_id));

CREATE TABLE public.customer_profiles (
  id                 uuid                     NOT NULL,
  email              text,
  first_name         text,
  last_name          text,
  stripe_customer_id text,
  created_at         timestamp with time zone DEFAULT now(),
  updated_at         timestamp with time zone DEFAULT now(),
  phone              text
);

ALTER TABLE public.customer_profiles
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.customer_profiles
  ADD CONSTRAINT customer_profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.customer_profiles
  ADD CONSTRAINT customer_profiles_pkey PRIMARY KEY (id);

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.customer_profiles TO anon;

GRANT INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.customer_profiles TO authenticated;

GRANT ALL ON public.customer_profiles TO service_role;

CREATE POLICY "Customers can update own profile" ON public.customer_profiles
  FOR UPDATE
  TO authenticated
  USING ((( SELECT auth.uid() AS uid) = id))
  WITH CHECK ((( SELECT auth.uid() AS uid) = id));

CREATE POLICY "Customers can view own profile" ON public.customer_profiles
  FOR SELECT
  TO authenticated
  USING ((( SELECT auth.uid() AS uid) = id));

CREATE TABLE public.order_items (
  id           uuid          DEFAULT gen_random_uuid() NOT NULL,
  order_id     uuid,
  product_id   uuid,
  sku          text,
  product_name text,
  quantity     integer       NOT NULL,
  unit_price   numeric(10,2) NOT NULL,
  line_total   numeric(10,2) NOT NULL,
  product_type text,
  name         text,
  unit_amount  integer,
  image_url    text,
  amount       text
);

ALTER TABLE public.order_items
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.order_items
  ADD CONSTRAINT order_items_pkey PRIMARY KEY (id);

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.order_items TO anon;

GRANT MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE ON public.order_items TO authenticated;

GRANT INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.order_items TO service_role;

CREATE TABLE public.orders (
  id                       uuid                     DEFAULT gen_random_uuid() NOT NULL,
  user_id                  uuid,
  email                    text                     NOT NULL,
  order_number             text                     NOT NULL,
  stripe_payment_intent_id text,
  status                   text                     DEFAULT 'pending'::text,
  total                    numeric(10,2)            NOT NULL,
  currency                 text                     DEFAULT 'GBP'::text,
  shipping_name            text,
  shipping_address         jsonb,
  created_at               timestamp with time zone DEFAULT now(),
  payment_intent_id        text,
  customer_email           text,
  subtotal_amount          integer,
  shipping_amount          integer,
  total_amount             integer,
  shipping_method_name     text,
  shipping_phone           text,
  billing_name             text,
  billing_address          jsonb,
  fulfillment_status       text                     DEFAULT 'unfulfilled'::text,
  payment_method_type      text,
  payment_brand            text,
  payment_last4            text,
  payment_exp_month        integer,
  payment_exp_year         integer,
  stripe_customer_id       text
);

CREATE POLICY "Customers can view own order items" ON public.order_items
  FOR SELECT
  TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM public.orders
  WHERE ((orders.id = order_items.order_id) AND (orders.user_id = ( SELECT auth.uid() AS uid))))));

CREATE POLICY "Users can view their own order items" ON public.order_items
  FOR SELECT
  USING ((EXISTS ( SELECT 1
   FROM public.orders
  WHERE ((orders.id = order_items.order_id) AND ((orders.user_id = auth.uid()) OR (orders.email = auth.email()))))));

ALTER TABLE public.orders
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_order_number_key UNIQUE (order_number);

ALTER TABLE public.orders
  ADD CONSTRAINT orders_pkey PRIMARY KEY (id);

ALTER TABLE public.order_items
  ADD CONSTRAINT order_items_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_stripe_payment_intent_id_key UNIQUE (stripe_payment_intent_id);

ALTER TABLE public.orders
  ADD CONSTRAINT orders_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.orders TO anon;

GRANT MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE ON public.orders TO authenticated;

GRANT INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.orders TO service_role;

CREATE UNIQUE INDEX orders_payment_intent_id_key ON public.orders (payment_intent_id);

CREATE POLICY "Customers can view own orders" ON public.orders
  FOR SELECT
  TO authenticated
  USING ((( SELECT auth.uid() AS uid) = user_id));

CREATE POLICY "Users can view their own orders" ON public.orders
  FOR SELECT
  USING (((auth.uid() = user_id) OR (email = auth.email())));

CREATE TABLE public.product_variants (
  id                         uuid                     DEFAULT gen_random_uuid() NOT NULL,
  product_id                 uuid                     NOT NULL,
  variant_name               text                     NOT NULL,
  variant_sku                text                     NOT NULL,
  price                      numeric(10,2)            NOT NULL,
  compare_at_price           numeric(10,2),
  currency                   text                     DEFAULT 'GBP'::text,
  inventory_quantity         integer                  DEFAULT 0,
  weight_grams               integer,
  stripe_price_id            text,
  active                     boolean                  DEFAULT true,
  sort_order                 integer                  DEFAULT 0,
  created_at                 timestamp with time zone DEFAULT now(),
  updated_at                 timestamp with time zone DEFAULT now(),
  klaviyo_catalog_variant_id text,
  klaviyo_catalog_synced_at  timestamp with time zone
);

ALTER TABLE public.product_variants
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.product_variants
  ADD CONSTRAINT product_variants_pkey PRIMARY KEY (id);

ALTER TABLE public.product_variants
  ADD CONSTRAINT product_variants_variant_sku_key UNIQUE (variant_sku);

GRANT MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE ON public.product_variants TO anon;

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.product_variants TO authenticated;

GRANT MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE ON public.product_variants TO service_role;

CREATE TRIGGER sync_klaviyo_variants_after_change
  AFTER INSERT OR UPDATE OF product_id,
    variant_name, variant_sku, price, compare_at_price, currency, inventory_quantity, weight_grams, active, sort_order ON public.product_variants
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_klaviyo_catalog_sync();

CREATE POLICY "Anyone can view active product variants" ON public.product_variants
  FOR SELECT
  TO anon
  USING ((active = true));

CREATE TABLE public.products (
  id                        uuid                     DEFAULT gen_random_uuid() NOT NULL,
  name                      text                     NOT NULL,
  slug                      text                     NOT NULL,
  sku                       text                     NOT NULL,
  description               text,
  price                     numeric(10,2)            NOT NULL,
  currency                  text                     DEFAULT 'GBP'::text,
  image_url                 text,
  category                  text,
  active                    boolean                  DEFAULT true,
  weight_grams              integer,
  inventory_quantity        integer                  DEFAULT 0,
  webflow_product_url       text,
  created_at                timestamp with time zone DEFAULT now(),
  compare_at_price          numeric(10,2),
  length_mm                 integer,
  width_mm                  integer,
  height_mm                 integer,
  stripe_product_id         text,
  stripe_price_id           text,
  updated_at                timestamp with time zone DEFAULT now(),
  default_amount            text,
  klaviyo_catalog_item_id   text,
  klaviyo_catalog_synced_at timestamp with time zone
);

ALTER TABLE public.products
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.products
  ADD CONSTRAINT products_pkey PRIMARY KEY (id);

ALTER TABLE public.order_items
  ADD CONSTRAINT order_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id);

ALTER TABLE public.product_variants
  ADD CONSTRAINT product_variants_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;

ALTER TABLE public.products
  ADD CONSTRAINT products_sku_key UNIQUE (sku);

ALTER TABLE public.products
  ADD CONSTRAINT products_slug_key UNIQUE (slug);

GRANT ALL ON public.products TO anon;

GRANT ALL ON public.products TO authenticated;

GRANT ALL ON public.products TO service_role;

CREATE TRIGGER sync_klaviyo_products_after_change
  AFTER INSERT OR UPDATE OF sku,
    name, description, price, currency, image_url, category, active, weight_grams, inventory_quantity, webflow_product_url, default_amount ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_klaviyo_catalog_sync();

CREATE POLICY "Anyone can view active products" ON public.products
  FOR SELECT
  TO anon
  USING ((active = true));

CREATE TABLE public.profiles (
  id         uuid                     NOT NULL,
  email      text                     NOT NULL,
  first_name text,
  last_name  text,
  created_at timestamp with time zone DEFAULT now()
);

ALTER TABLE public.profiles
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.profiles TO anon;

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.profiles TO authenticated;

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.profiles TO service_role;

CREATE POLICY "Users can update their own profile" ON public.profiles
  FOR UPDATE
  USING ((auth.uid() = id));

CREATE POLICY "Users can view their own profile" ON public.profiles
  FOR SELECT
  USING ((auth.uid() = id));

CREATE TABLE public.shipments (
  id                    uuid                     DEFAULT gen_random_uuid() NOT NULL,
  order_id              uuid,
  courier               text,
  shippo_transaction_id text,
  tracking_number       text,
  tracking_url          text,
  label_url             text,
  status                text                     DEFAULT 'pending'::text,
  created_at            timestamp with time zone DEFAULT now()
);

ALTER TABLE public.shipments
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.shipments
  ADD CONSTRAINT shipments_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;

ALTER TABLE public.shipments
  ADD CONSTRAINT shipments_pkey PRIMARY KEY (id);

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.shipments TO anon;

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.shipments TO authenticated;

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.shipments TO service_role;

CREATE POLICY "Users can view their own shipments" ON public.shipments
  FOR SELECT
  USING ((EXISTS ( SELECT 1
   FROM public.orders
  WHERE ((orders.id = shipments.order_id) AND ((orders.user_id = auth.uid()) OR (orders.email = auth.email()))))));

CREATE TABLE public.shipping_methods (
  id          uuid    DEFAULT gen_random_uuid() NOT NULL,
  name        text    NOT NULL,
  description text,
  carrier     text,
  active      boolean DEFAULT true,
  sort_order  integer DEFAULT 0
);

ALTER TABLE public.shipping_methods
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.shipping_methods
  ADD CONSTRAINT shipping_methods_pkey PRIMARY KEY (id);

GRANT MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE ON public.shipping_methods TO anon;

GRANT MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE ON public.shipping_methods TO authenticated;

GRANT MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE ON public.shipping_methods TO service_role;

CREATE POLICY "Public read active shipping methods" ON public.shipping_methods
  FOR SELECT
  USING ((active = true));

CREATE TABLE public.shipping_rates (
  id                 uuid          DEFAULT gen_random_uuid() NOT NULL,
  shipping_method_id uuid,
  min_weight_grams   integer       NOT NULL,
  max_weight_grams   integer       NOT NULL,
  price              numeric(10,2) NOT NULL,
  currency           text          DEFAULT 'GBP'::text,
  active             boolean       DEFAULT true
);

ALTER TABLE public.shipping_rates
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.shipping_rates
  ADD CONSTRAINT shipping_rates_pkey PRIMARY KEY (id);

ALTER TABLE public.shipping_rates
  ADD CONSTRAINT shipping_rates_shipping_method_id_fkey FOREIGN KEY (shipping_method_id) REFERENCES public.shipping_methods(id) ON DELETE CASCADE;

GRANT MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE ON public.shipping_rates TO anon;

GRANT MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE ON public.shipping_rates TO authenticated;

GRANT MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE ON public.shipping_rates TO service_role;

CREATE POLICY "Public read active shipping rates" ON public.shipping_rates
  FOR SELECT
  USING ((active = true));

CREATE TABLE public.sync_logs (
  id           uuid                     DEFAULT gen_random_uuid() NOT NULL,
  sync_type    text,
  synced_at    timestamp with time zone DEFAULT now(),
  status       text,
  details      jsonb,
  record_id    uuid,
  source_table text
);

ALTER TABLE public.sync_logs
  ADD CONSTRAINT sync_logs_pkey PRIMARY KEY (id);

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.sync_logs TO anon;

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.sync_logs TO authenticated;

GRANT INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE ON public.sync_logs TO service_role;

CREATE EVENT TRIGGER ensure_rls
  ON ddl_command_end
  WHEN TAG IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
  EXECUTE FUNCTION public.rls_auto_enable();
