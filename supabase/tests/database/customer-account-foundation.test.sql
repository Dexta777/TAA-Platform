BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(59);

DELETE FROM vault.secrets
WHERE name = 'taa_identity_fingerprint_pepper';

SELECT vault.create_secret(
  encode(extensions.gen_random_bytes(32), 'hex'),
  'taa_identity_fingerprint_pepper',
  'Transaction-scoped customer account foundation test pepper'
);

INSERT INTO auth.users (id, email, raw_user_meta_data)
VALUES
  (
    'ca000000-0000-4000-8000-000000000001',
    'customer-a@example.test',
    '{"first_name":"Initial A","last_name":"Customer"}'::jsonb
  ),
  (
    'ca000000-0000-4000-8000-000000000002',
    'customer-b@example.test',
    '{"first_name":"Initial B","last_name":"Customer"}'::jsonb
  );

SELECT hasnt_table(
  'public',
  'profiles',
  'the unused legacy profiles table is retired'
);

SELECT is(
  (
    SELECT count(*)
    FROM public.customer_profiles
    WHERE id IN (
      'ca000000-0000-4000-8000-000000000001',
      'ca000000-0000-4000-8000-000000000002'
    )
  ),
  2::bigint,
  'the Auth trigger creates one canonical customer profile per new user'
);

SELECT is(
  (
    SELECT email
    FROM public.customer_profiles
    WHERE id = 'ca000000-0000-4000-8000-000000000001'
  ),
  'customer-a@example.test',
  'the canonical profile receives the authoritative Auth email'
);

SELECT set_config(
  'request.jwt.claim.sub',
  'ca000000-0000-4000-8000-000000000001',
  true
);
SELECT set_config('request.jwt.claim.email', 'customer-a@example.test', true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*) FROM public.customer_profiles),
  1::bigint,
  'customer A can select customer A profile'
);

SELECT is(
  (
    SELECT count(*)
    FROM public.customer_profiles
    WHERE id = 'ca000000-0000-4000-8000-000000000002'
  ),
  0::bigint,
  'customer A cannot select customer B profile'
);

SELECT lives_ok(
  $$
    UPDATE public.customer_profiles
    SET first_name = 'Edited A', last_name = 'Member', phone = 'test-phone-a'
    WHERE id = auth.uid()
  $$,
  'customer A can update the permitted self-service profile fields'
);

SELECT ok(
  (
    SELECT first_name = 'Edited A'
      AND last_name = 'Member'
      AND phone = 'test-phone-a'
    FROM public.customer_profiles
    WHERE id = auth.uid()
  ),
  'permitted profile changes persist on the owned row'
);

SELECT throws_ok(
  $$UPDATE public.customer_profiles SET stripe_customer_id = 'cus_browser_forbidden' WHERE id = auth.uid()$$,
  '42501',
  'permission denied for table customer_profiles',
  'a customer cannot change privileged Stripe linkage'
);

SELECT throws_ok(
  $$UPDATE public.customer_profiles SET email = 'forbidden@example.test' WHERE id = auth.uid()$$,
  '42501',
  'permission denied for table customer_profiles',
  'a customer cannot change the server-managed profile email'
);

SELECT throws_ok(
  $$UPDATE public.customer_profiles SET created_at = clock_timestamp() WHERE id = auth.uid()$$,
  '42501',
  'permission denied for table customer_profiles',
  'a customer cannot change profile creation time'
);

SELECT throws_ok(
  $$UPDATE public.customer_profiles SET updated_at = clock_timestamp() WHERE id = auth.uid()$$,
  '42501',
  'permission denied for table customer_profiles',
  'a customer cannot change profile update time directly'
);

SELECT throws_ok(
  $$UPDATE public.customer_profiles SET id = 'ca000000-0000-4000-8000-000000000002' WHERE id = auth.uid()$$,
  '42501',
  'permission denied for table customer_profiles',
  'a customer cannot change canonical profile ownership'
);

SELECT lives_ok(
  $$
    INSERT INTO public.customer_addresses (
      user_id, label, first_name, last_name, address_1, city, postcode, country
    )
    VALUES (
      auth.uid(), 'A primary', 'Address', 'Owner', '1 Fixture Lane',
      'Fixture City', 'TEST A', 'United Kingdom'
    )
  $$,
  'customer A can insert an owned address without server-managed columns'
);

SELECT is(
  (
    SELECT count(*)
    FROM public.customer_addresses
    WHERE label = 'A primary'
  ),
  1::bigint,
  'customer A can select the owned address'
);

SELECT lives_ok(
  $$
    UPDATE public.customer_addresses
    SET city = 'Updated Fixture City'
    WHERE label = 'A primary'
  $$,
  'customer A can update ordinary fields on the owned address'
);

SELECT is(
  (
    SELECT city
    FROM public.customer_addresses
    WHERE label = 'A primary'
  ),
  'Updated Fixture City',
  'the permitted owned-address update persists'
);

SELECT lives_ok(
  $$
    INSERT INTO public.customer_addresses (
      user_id, label, first_name, last_name, address_1, city, postcode, country
    )
    VALUES (
      auth.uid(), 'A disposable', 'Address', 'Owner', '2 Fixture Lane',
      'Fixture City', 'TEST A', 'United Kingdom'
    )
  $$,
  'customer A can create a second non-default address'
);

SELECT lives_ok(
  $$DELETE FROM public.customer_addresses WHERE label = 'A disposable'$$,
  'customer A can delete an owned address'
);

SELECT is(
  (
    SELECT count(*)
    FROM public.customer_addresses
    WHERE label = 'A disposable'
  ),
  0::bigint,
  'the owned address deletion persists'
);

RESET ROLE;

INSERT INTO public.customer_addresses (
  user_id, label, first_name, last_name, address_1, city, postcode, country
)
VALUES (
  'ca000000-0000-4000-8000-000000000002',
  'B private',
  'Other',
  'Customer',
  '3 Fixture Lane',
  'Fixture City',
  'TEST B',
  'United Kingdom'
);

SET LOCAL ROLE authenticated;

SELECT is(
  (
    SELECT count(*)
    FROM public.customer_addresses
    WHERE label = 'B private'
  ),
  0::bigint,
  'customer A cannot select customer B address'
);

SELECT throws_ok(
  $$
    INSERT INTO public.customer_addresses (
      user_id, label, first_name, last_name, address_1, city, postcode, country
    )
    VALUES (
      'ca000000-0000-4000-8000-000000000002',
      'Forbidden B insert',
      'Other',
      'Customer',
      'Forbidden Fixture Lane',
      'Fixture City',
      'TEST B',
      'United Kingdom'
    )
  $$,
  '42501',
  'new row violates row-level security policy for table "customer_addresses"',
  'customer A cannot insert an address owned by customer B'
);

SELECT lives_ok(
  $$UPDATE public.customer_addresses SET city = 'Forbidden City' WHERE label = 'B private'$$,
  'an RLS-filtered update against customer B address does not expose or change it'
);

SELECT lives_ok(
  $$DELETE FROM public.customer_addresses WHERE label = 'B private'$$,
  'an RLS-filtered delete against customer B address does not expose or remove it'
);

SELECT throws_ok(
  $$
    UPDATE public.customer_addresses
    SET user_id = 'ca000000-0000-4000-8000-000000000002'
    WHERE label = 'A primary'
  $$,
  '42501',
  'permission denied for table customer_addresses',
  'a customer cannot reassign address ownership'
);

SELECT throws_ok(
  $$UPDATE public.customer_addresses SET created_at = clock_timestamp() WHERE label = 'A primary'$$,
  '42501',
  'permission denied for table customer_addresses',
  'a customer cannot change address creation time'
);

SELECT throws_ok(
  $$UPDATE public.customer_addresses SET updated_at = clock_timestamp() WHERE label = 'A primary'$$,
  '42501',
  'permission denied for table customer_addresses',
  'a customer cannot change address update time directly'
);

SELECT lives_ok(
  $$
    INSERT INTO public.customer_addresses (
      user_id, label, first_name, last_name, address_1, city, postcode, country,
      is_default_shipping
    )
    VALUES (
      auth.uid(), 'A shipping default', 'Address', 'Owner', '4 Fixture Lane',
      'Fixture City', 'TEST A', 'United Kingdom', true
    )
  $$,
  'one default shipping address succeeds'
);

SELECT throws_ok(
  $$
    INSERT INTO public.customer_addresses (
      user_id, label, first_name, last_name, address_1, city, postcode, country,
      is_default_shipping
    )
    VALUES (
      auth.uid(), 'A duplicate shipping', 'Address', 'Owner', '5 Fixture Lane',
      'Fixture City', 'TEST A', 'United Kingdom', true
    )
  $$,
  '23505',
  'duplicate key value violates unique constraint "customer_addresses_one_default_shipping_per_user"',
  'a second simultaneous default shipping address is rejected'
);

SELECT lives_ok(
  $$
    INSERT INTO public.customer_addresses (
      user_id, label, first_name, last_name, address_1, city, postcode, country,
      is_default_billing
    )
    VALUES (
      auth.uid(), 'A billing default', 'Address', 'Owner', '6 Fixture Lane',
      'Fixture City', 'TEST A', 'United Kingdom', true
    )
  $$,
  'one default billing address succeeds'
);

SELECT throws_ok(
  $$
    INSERT INTO public.customer_addresses (
      user_id, label, first_name, last_name, address_1, city, postcode, country,
      is_default_billing
    )
    VALUES (
      auth.uid(), 'A duplicate billing', 'Address', 'Owner', '7 Fixture Lane',
      'Fixture City', 'TEST A', 'United Kingdom', true
    )
  $$,
  '23505',
  'duplicate key value violates unique constraint "customer_addresses_one_default_billing_per_user"',
  'a second simultaneous default billing address is rejected'
);

RESET ROLE;

SELECT is(
  (
    SELECT city
    FROM public.customer_addresses
    WHERE label = 'B private'
  ),
  'Fixture City',
  'customer A did not change customer B address'
);

SELECT is(
  (
    SELECT count(*)
    FROM public.customer_addresses
    WHERE label = 'B private'
  ),
  1::bigint,
  'customer A did not delete customer B address'
);

SELECT lives_ok(
  $$
    INSERT INTO public.customer_addresses (
      user_id, label, first_name, last_name, address_1, city, postcode, country,
      is_default_shipping, is_default_billing
    )
    VALUES (
      'ca000000-0000-4000-8000-000000000002',
      'B both defaults',
      'Other',
      'Customer',
      '8 Fixture Lane',
      'Fixture City',
      'TEST B',
      'United Kingdom',
      true,
      true
    )
  $$,
  'one address may be both the shipping and billing default'
);

UPDATE public.customer_profiles
SET stripe_customer_id = 'cus_unique_a'
WHERE id = 'ca000000-0000-4000-8000-000000000001';

SELECT throws_ok(
  $$
    UPDATE public.customer_profiles
    SET stripe_customer_id = 'cus_unique_a'
    WHERE id = 'ca000000-0000-4000-8000-000000000002'
  $$,
  '23505',
  'duplicate key value violates unique constraint "customer_profiles_stripe_customer_id_key"',
  'duplicate non-null Stripe customer linkage is rejected'
);

UPDATE auth.users
SET email = 'customer-a-updated@example.test'
WHERE id = 'ca000000-0000-4000-8000-000000000001';

SELECT is(
  (
    SELECT email
    FROM public.customer_profiles
    WHERE id = 'ca000000-0000-4000-8000-000000000001'
  ),
  'customer-a-updated@example.test',
  'an Auth email change synchronizes the canonical profile email'
);

SELECT ok(
  (
    SELECT first_name = 'Edited A' AND last_name = 'Member'
    FROM public.customer_profiles
    WHERE id = 'ca000000-0000-4000-8000-000000000001'
  ),
  'Auth email synchronization does not overwrite customer-edited names'
);

INSERT INTO public.orders (
  id, user_id, email, order_number, status, total, currency, shipping_name,
  shipping_address, billing_name, billing_address, customer_email
)
VALUES
  (
    'ca100000-0000-4000-8000-000000000001',
    'ca000000-0000-4000-8000-000000000001',
    'customer-a-updated@example.test',
    'TAA-ACCOUNT-A',
    'paid',
    10.00,
    'GBP',
    'Historical A',
    '{"address_1":"Historical A Lane"}'::jsonb,
    'Historical Billing A',
    '{"address_1":"Historical Billing A Lane"}'::jsonb,
    'customer-a-updated@example.test'
  ),
  (
    'ca100000-0000-4000-8000-000000000002',
    'ca000000-0000-4000-8000-000000000002',
    'customer-b@example.test',
    'TAA-ACCOUNT-B',
    'paid',
    20.00,
    'GBP',
    'Historical B',
    '{"address_1":"Historical B Lane"}'::jsonb,
    'Historical Billing B',
    '{"address_1":"Historical Billing B Lane"}'::jsonb,
    'customer-b@example.test'
  ),
  (
    'ca100000-0000-4000-8000-000000000003',
    NULL,
    'guest-other@example.test',
    'TAA-GUEST-OTHER',
    'paid',
    30.00,
    'GBP',
    'Historical Guest',
    '{"address_1":"Historical Guest Lane"}'::jsonb,
    'Historical Guest Billing',
    '{"address_1":"Historical Guest Billing Lane"}'::jsonb,
    'guest-other@example.test'
  ),
  (
    'ca100000-0000-4000-8000-000000000004',
    NULL,
    'customer-a-updated@example.test',
    'TAA-GUEST-MATCHING-EMAIL',
    'paid',
    40.00,
    'GBP',
    'Historical Matching Guest',
    '{"address_1":"Historical Matching Guest Lane"}'::jsonb,
    'Historical Matching Guest Billing',
    '{"address_1":"Historical Matching Billing Lane"}'::jsonb,
    'customer-a-updated@example.test'
  );

INSERT INTO public.order_items (
  id, order_id, sku, product_name, quantity, unit_price, line_total
)
VALUES
  ('ca200000-0000-4000-8000-000000000001', 'ca100000-0000-4000-8000-000000000001', 'ACCOUNT-A', 'Account A item', 1, 10.00, 10.00),
  ('ca200000-0000-4000-8000-000000000002', 'ca100000-0000-4000-8000-000000000002', 'ACCOUNT-B', 'Account B item', 1, 20.00, 20.00),
  ('ca200000-0000-4000-8000-000000000003', 'ca100000-0000-4000-8000-000000000003', 'GUEST-OTHER', 'Guest other item', 1, 30.00, 30.00),
  ('ca200000-0000-4000-8000-000000000004', 'ca100000-0000-4000-8000-000000000004', 'GUEST-MATCH', 'Guest matching item', 1, 40.00, 40.00);

INSERT INTO public.shipments (id, order_id, status)
VALUES
  ('ca300000-0000-4000-8000-000000000001', 'ca100000-0000-4000-8000-000000000001', 'pending'),
  ('ca300000-0000-4000-8000-000000000002', 'ca100000-0000-4000-8000-000000000002', 'pending'),
  ('ca300000-0000-4000-8000-000000000003', 'ca100000-0000-4000-8000-000000000003', 'pending'),
  ('ca300000-0000-4000-8000-000000000004', 'ca100000-0000-4000-8000-000000000004', 'pending');

SELECT set_config(
  'request.jwt.claim.sub',
  'ca000000-0000-4000-8000-000000000001',
  true
);
SELECT set_config('request.jwt.claim.email', 'customer-a-updated@example.test', true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*) FROM public.orders WHERE order_number = 'TAA-ACCOUNT-A'),
  1::bigint,
  'customer A can select the order explicitly owned by customer A'
);

SELECT is(
  (SELECT count(*) FROM public.orders WHERE order_number = 'TAA-ACCOUNT-B'),
  0::bigint,
  'customer A cannot select customer B order'
);

SELECT is(
  (SELECT count(*) FROM public.orders WHERE order_number = 'TAA-GUEST-OTHER'),
  0::bigint,
  'customer A cannot select an unowned guest order'
);

SELECT is(
  (SELECT count(*) FROM public.orders WHERE order_number = 'TAA-GUEST-MATCHING-EMAIL'),
  0::bigint,
  'matching authenticated email alone does not expose a guest order'
);

SELECT is(
  (SELECT count(*) FROM public.order_items WHERE sku = 'ACCOUNT-A'),
  1::bigint,
  'customer A can select items from the explicitly owned order'
);

SELECT is(
  (SELECT count(*) FROM public.order_items WHERE sku = 'ACCOUNT-B'),
  0::bigint,
  'customer A cannot select customer B order items'
);

SELECT is(
  (SELECT count(*) FROM public.order_items WHERE sku = 'GUEST-MATCH'),
  0::bigint,
  'matching email alone does not expose guest-order items'
);

SELECT is(
  (
    SELECT count(*)
    FROM public.shipments
    WHERE id = 'ca300000-0000-4000-8000-000000000001'
  ),
  1::bigint,
  'customer A can select the shipment for the explicitly owned order'
);

SELECT is(
  (
    SELECT count(*)
    FROM public.shipments
    WHERE id = 'ca300000-0000-4000-8000-000000000002'
  ),
  0::bigint,
  'customer A cannot select customer B shipment'
);

SELECT is(
  (
    SELECT count(*)
    FROM public.shipments
    WHERE id = 'ca300000-0000-4000-8000-000000000004'
  ),
  0::bigint,
  'matching email alone does not expose a guest-order shipment'
);

UPDATE public.customer_profiles
SET first_name = 'Later Profile Name'
WHERE id = auth.uid();

UPDATE public.customer_addresses
SET address_1 = 'Later Mutable Address'
WHERE label = 'A primary';

RESET ROLE;

SELECT ok(
  (
    SELECT shipping_name = 'Historical A'
      AND shipping_address = '{"address_1":"Historical A Lane"}'::jsonb
      AND billing_name = 'Historical Billing A'
      AND billing_address = '{"address_1":"Historical Billing A Lane"}'::jsonb
    FROM public.orders
    WHERE id = 'ca100000-0000-4000-8000-000000000001'
  ),
  'mutable profile and address changes do not alter historical order snapshots'
);

SELECT is(
  (
    SELECT count(*)
    FROM public.orders
    WHERE id IN (
      'ca100000-0000-4000-8000-000000000003',
      'ca100000-0000-4000-8000-000000000004'
    )
      AND user_id IS NULL
  ),
  2::bigint,
  'existing-style guest orders remain unclaimed with null user ownership'
);

SELECT ok(
  NOT has_table_privilege('authenticated', 'public.customer_profiles', 'UPDATE')
    AND NOT has_table_privilege('authenticated', 'public.customer_profiles', 'INSERT')
    AND has_column_privilege('authenticated', 'public.customer_profiles', 'first_name', 'UPDATE')
    AND has_column_privilege('authenticated', 'public.customer_profiles', 'last_name', 'UPDATE')
    AND has_column_privilege('authenticated', 'public.customer_profiles', 'phone', 'UPDATE')
    AND NOT has_column_privilege('authenticated', 'public.customer_profiles', 'email', 'UPDATE')
    AND NOT has_column_privilege('authenticated', 'public.customer_profiles', 'stripe_customer_id', 'UPDATE')
    AND NOT has_column_privilege('authenticated', 'public.customer_profiles', 'created_at', 'UPDATE')
    AND NOT has_column_privilege('authenticated', 'public.customer_profiles', 'updated_at', 'UPDATE'),
  'authenticated profile UPDATE privileges are limited to self-service columns'
);

SELECT ok(
  has_table_privilege('service_role', 'public.customer_profiles', 'SELECT,INSERT,UPDATE')
    AND has_column_privilege('service_role', 'public.customer_profiles', 'stripe_customer_id', 'UPDATE'),
  'service role retains trusted profile and Stripe-linkage access'
);

SELECT ok(
  has_table_privilege('authenticated', 'public.customer_addresses', 'SELECT,DELETE')
    AND NOT has_table_privilege('authenticated', 'public.customer_addresses', 'INSERT')
    AND NOT has_table_privilege('authenticated', 'public.customer_addresses', 'UPDATE')
    AND has_column_privilege('authenticated', 'public.customer_addresses', 'user_id', 'INSERT')
    AND NOT has_column_privilege('authenticated', 'public.customer_addresses', 'id', 'INSERT')
    AND NOT has_column_privilege('authenticated', 'public.customer_addresses', 'user_id', 'UPDATE')
    AND NOT has_column_privilege('authenticated', 'public.customer_addresses', 'created_at', 'INSERT')
    AND NOT has_column_privilege('authenticated', 'public.customer_addresses', 'updated_at', 'UPDATE'),
  'authenticated address grants support own CRUD without ownership or timestamp mutation'
);

SELECT ok(
  has_table_privilege('authenticated', 'public.orders', 'SELECT')
    AND NOT has_table_privilege('authenticated', 'public.orders', 'INSERT,UPDATE,DELETE,TRUNCATE')
    AND has_table_privilege('authenticated', 'public.order_items', 'SELECT')
    AND NOT has_table_privilege('authenticated', 'public.order_items', 'INSERT,UPDATE,DELETE,TRUNCATE')
    AND has_table_privilege('authenticated', 'public.shipments', 'SELECT')
    AND NOT has_table_privilege('authenticated', 'public.shipments', 'INSERT,UPDATE,DELETE,TRUNCATE'),
  'historical order, item, and shipment tables are browser read-only'
);

SELECT is(
  (
    SELECT count(*)
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'orders'
      AND cmd = 'SELECT'
      AND roles = ARRAY['authenticated']::name[]
      AND qual LIKE '%auth.uid()%'
      AND qual NOT LIKE '%auth.email()%'
  ),
  1::bigint,
  'orders end with exactly one authenticated user-id ownership policy'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('orders', 'order_items', 'shipments')
      AND (qual LIKE '%auth.email()%' OR with_check LIKE '%auth.email()%')
  ),
  'no order-family policy retains email-derived authorization'
);

SELECT ok(
  NOT has_function_privilege('anon', 'public.handle_new_customer()', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.handle_new_customer()', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.set_customer_account_updated_at()', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.set_customer_account_updated_at()', 'EXECUTE'),
  'trigger helpers are not directly executable by browser roles'
);

SELECT ok(
  NOT has_function_privilege('anon', 'public.decrement_product_inventory(uuid,integer)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.decrement_product_inventory(uuid,integer)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.decrement_variant_inventory(uuid,integer)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.decrement_variant_inventory(uuid,integer)', 'EXECUTE'),
  'legacy inventory decrement helpers are not browser executable'
);

SELECT ok(
  has_function_privilege('service_role', 'public.decrement_product_inventory(uuid,integer)', 'EXECUTE')
    AND has_function_privilege('service_role', 'public.decrement_variant_inventory(uuid,integer)', 'EXECUTE'),
  'the trusted service role retains legacy inventory-helper execution'
);

SELECT ok(
  (
    SELECT bool_and(proconfig = ARRAY['search_path=""']::text[])
    FROM pg_proc
    WHERE oid IN (
      'public.handle_new_customer()'::regprocedure,
      'public.set_customer_account_updated_at()'::regprocedure,
      'public.decrement_product_inventory(uuid,integer)'::regprocedure,
      'public.decrement_variant_inventory(uuid,integer)'::regprocedure
    )
  ),
  'customer and legacy privileged helpers use a fixed empty search path'
);

SELECT ok(
  to_regclass('public.customer_profiles_stripe_customer_id_key') IS NOT NULL
    AND to_regclass('public.customer_addresses_one_default_shipping_per_user') IS NOT NULL
    AND to_regclass('public.customer_addresses_one_default_billing_per_user') IS NOT NULL,
  'Stripe linkage and default-address uniqueness indexes are installed'
);

SELECT * FROM finish();

ROLLBACK;
