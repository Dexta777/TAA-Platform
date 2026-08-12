BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(24);

DELETE FROM vault.secrets
WHERE name = 'taa_identity_fingerprint_pepper';

SELECT vault.create_secret(
  encode(extensions.gen_random_bytes(32), 'hex'),
  'taa_identity_fingerprint_pepper',
  'Transaction-scoped discount checkout finalization test pepper'
);

INSERT INTO auth.users (id, email, raw_user_meta_data)
VALUES (
  '10000000-0000-0000-0000-000000000101',
  'discount.finalizer@example.com',
  '{}'::jsonb
);

INSERT INTO public.discount_codes (
  id,
  code,
  discount_type,
  percent_off_bps,
  active
)
VALUES (
  '20000000-0000-0000-0000-000000000101',
  'TAA10-FINALIZER',
  'percentage',
  1000,
  true
);

INSERT INTO public.discount_codes (
  id,
  code,
  discount_type,
  active
)
VALUES (
  '20000000-0000-0000-0000-000000000102',
  'FREESHIP-FINALIZER',
  'free_shipping',
  true
);

ALTER TABLE public.products DISABLE TRIGGER sync_klaviyo_products_after_change;

INSERT INTO public.products (
  id,
  name,
  slug,
  sku,
  price,
  inventory_quantity,
  active
)
VALUES (
  '30000000-0000-0000-0000-000000000101',
  'Discount finalization test product',
  'discount-finalization-test-product',
  'DISCOUNT-FINALIZATION-TEST',
  18.95,
  10,
  true
);

ALTER TABLE public.products ENABLE TRIGGER sync_klaviyo_products_after_change;

INSERT INTO public.checkout_intents (
  id,
  stripe_checkout_session_id,
  payment_intent_id,
  user_id,
  status,
  customer_email,
  subtotal_amount,
  shipping_amount,
  total_amount,
  currency,
  shipping_method_name,
  shipping_phone,
  shipping_address,
  discount_code_id,
  discount_code,
  discount_amount,
  shipping_discount_amount
)
VALUES
  (
    '40000000-0000-0000-0000-000000000101',
    'cs_finalizer_no_discount',
    'pi_finalizer_no_discount',
    NULL,
    'pending',
    'guest@example.com',
    1000,
    499,
    1499,
    'gbp',
    'Standard',
    '07123 456789',
    '{"address_1":"12 High Street","postcode":"SW1A 1AA","country":"GB"}'::jsonb,
    NULL,
    NULL,
    0,
    0
  ),
  (
    '40000000-0000-0000-0000-000000000102',
    'cs_finalizer_merchandise',
    'pi_finalizer_merchandise',
    '10000000-0000-0000-0000-000000000101',
    'pending',
    'discount.finalizer@example.com',
    1895,
    499,
    2204,
    'gbp',
    'Standard',
    '07123 456789',
    '{"address_1":"12 High Street","postcode":"SW1A 1AA","country":"GB"}'::jsonb,
    '20000000-0000-0000-0000-000000000101',
    'TAA10-FINALIZER',
    190,
    0
  ),
  (
    '40000000-0000-0000-0000-000000000103',
    'cs_finalizer_free_shipping',
    'pi_finalizer_free_shipping',
    NULL,
    'pending',
    'freeship@example.com',
    1895,
    0,
    1895,
    'gbp',
    'Express',
    '07123 456789',
    '{"address_1":"12 High Street","postcode":"SW1A 1AA","country":"GB"}'::jsonb,
    '20000000-0000-0000-0000-000000000102',
    'FREESHIP-FINALIZER',
    0,
    699
  ),
  (
    '40000000-0000-0000-0000-000000000104',
    'cs_finalizer_failed',
    'pi_finalizer_failed',
    NULL,
    'failed',
    'failed@example.com',
    1895,
    499,
    2204,
    'gbp',
    'Standard',
    NULL,
    NULL,
    '20000000-0000-0000-0000-000000000101',
    'TAA10-FINALIZER',
    190,
    0
  ),
  (
    '40000000-0000-0000-0000-000000000105',
    'cs_finalizer_expired',
    'pi_finalizer_expired',
    NULL,
    'expired',
    'expired@example.com',
    1895,
    499,
    2204,
    'gbp',
    'Standard',
    NULL,
    NULL,
    '20000000-0000-0000-0000-000000000101',
    'TAA10-FINALIZER',
    190,
    0
  ),
  (
    '40000000-0000-0000-0000-000000000106',
    'cs_finalizer_degraded_identity',
    'pi_finalizer_degraded_identity',
    NULL,
    'pending',
    'degraded.discount@example.com',
    1000,
    499,
    1399,
    'gbp',
    'Standard',
    '07123 456789',
    '{"address_1":"12 High Street","postcode":"SW1A 1AA","country":"GB"}'::jsonb,
    '20000000-0000-0000-0000-000000000101',
    'TAA10-FINALIZER',
    100,
    0
  );

INSERT INTO public.checkout_intent_items (
  checkout_intent_id,
  product_type,
  product_id,
  base_product_id,
  sku,
  name,
  product_name,
  quantity,
  unit_amount,
  line_total,
  weight_grams
)
SELECT
  checkout_intents.id,
  'product',
  '30000000-0000-0000-0000-000000000101',
  '30000000-0000-0000-0000-000000000101',
  'DISCOUNT-FINALIZATION-TEST',
  'Discount finalization test product',
  'Discount finalization test product',
  1,
  checkout_intents.subtotal_amount,
  checkout_intents.subtotal_amount,
  100
FROM public.checkout_intents
WHERE id IN (
  '40000000-0000-0000-0000-000000000101',
  '40000000-0000-0000-0000-000000000102',
  '40000000-0000-0000-0000-000000000103',
  '40000000-0000-0000-0000-000000000106'
);

SELECT lives_ok(
  $$
    SELECT *
    FROM public.finalize_paid_checkout(
      p_checkout_session_id => 'cs_finalizer_no_discount',
      p_payment_intent_id => 'pi_finalizer_no_discount'
    )
  $$,
  'no-discount checkout finalization still succeeds'
);

SELECT ok(
  (
    SELECT discount_code_id IS NULL
      AND discount_code IS NULL
      AND discount_amount = 0
      AND shipping_discount_amount = 0
      AND subtotal_amount = 1000
      AND shipping_amount = 499
      AND total_amount = 1499
    FROM public.orders
    WHERE checkout_intent_id = '40000000-0000-0000-0000-000000000101'
  ),
  'no-discount order keeps null and zero discount snapshots'
);

SELECT is(
  (
    SELECT count(*)
    FROM public.discount_redemptions
    WHERE checkout_intent_id = '40000000-0000-0000-0000-000000000101'
  ),
  0::bigint,
  'no-discount finalization creates no redemption'
);

SELECT lives_ok(
  $$
    SELECT *
    FROM public.finalize_paid_checkout(
      p_checkout_session_id => 'cs_finalizer_merchandise',
      p_payment_intent_id => 'pi_finalizer_merchandise'
    )
  $$,
  'merchandise-discount checkout finalization succeeds'
);

SELECT ok(
  (
    SELECT discount_code_id = '20000000-0000-0000-0000-000000000101'
      AND discount_code = 'TAA10-FINALIZER'
      AND discount_amount = 190
      AND shipping_discount_amount = 0
    FROM public.orders
    WHERE checkout_intent_id = '40000000-0000-0000-0000-000000000102'
  ),
  'merchandise discount snapshot is copied to the order'
);

SELECT ok(
  (
    SELECT subtotal_amount = 1895
      AND shipping_amount = 499
      AND total_amount = 2204
      AND total = 22.04
    FROM public.orders
    WHERE checkout_intent_id = '40000000-0000-0000-0000-000000000102'
  ),
  'merchandise-discount order retains canonical amount semantics'
);

SELECT is(
  (
    SELECT count(*)
    FROM public.discount_redemptions
    WHERE checkout_intent_id = '40000000-0000-0000-0000-000000000102'
  ),
  1::bigint,
  'merchandise-discount finalization creates exactly one redemption'
);

SELECT ok(
  (
    SELECT code_snapshot = 'TAA10-FINALIZER'
      AND discount_amount = 190
      AND shipping_discount_amount = 0
      AND user_id = '10000000-0000-0000-0000-000000000101'
    FROM public.discount_redemptions
    WHERE checkout_intent_id = '40000000-0000-0000-0000-000000000102'
  ),
  'redemption stores the paid checkout discount and account snapshots'
);

SELECT ok(
  (
    SELECT redemptions.email_fingerprint = orders.customer_email_fingerprint
      AND redemptions.phone_fingerprint = orders.shipping_phone_fingerprint
      AND redemptions.shipping_address_fingerprint = orders.shipping_address_fingerprint
      AND redemptions.email_fingerprint IS NOT NULL
      AND redemptions.phone_fingerprint IS NOT NULL
      AND redemptions.shipping_address_fingerprint IS NOT NULL
    FROM public.discount_redemptions AS redemptions
    JOIN public.orders
      ON orders.id = redemptions.order_id
    WHERE redemptions.checkout_intent_id = '40000000-0000-0000-0000-000000000102'
  ),
  'redemption copies the finalized order identity fingerprints'
);

SELECT lives_ok(
  $$
    SELECT *
    FROM public.finalize_paid_checkout(
      p_checkout_session_id => 'cs_finalizer_free_shipping',
      p_payment_intent_id => 'pi_finalizer_free_shipping'
    )
  $$,
  'free-shipping checkout finalization succeeds'
);

SELECT ok(
  (
    SELECT subtotal_amount = 1895
      AND discount_amount = 0
      AND shipping_amount = 0
      AND shipping_discount_amount = 699
      AND total_amount = 1895
      AND total = 18.95
    FROM public.orders
    WHERE checkout_intent_id = '40000000-0000-0000-0000-000000000103'
  ),
  'free-shipping order preserves the waived actual method amount and total'
);

SELECT ok(
  (
    SELECT code_snapshot = 'FREESHIP-FINALIZER'
      AND discount_amount = 0
      AND shipping_discount_amount = 699
    FROM public.discount_redemptions
    WHERE checkout_intent_id = '40000000-0000-0000-0000-000000000103'
  ),
  'free-shipping redemption persists the shipping discount'
);

CREATE TEMPORARY TABLE inventory_before_replay (
  quantity integer NOT NULL
) ON COMMIT DROP;

INSERT INTO inventory_before_replay (quantity)
SELECT inventory_quantity
FROM public.products
WHERE id = '30000000-0000-0000-0000-000000000101';

SELECT ok(
  (
    SELECT already_finalized
    FROM public.finalize_paid_checkout(
      p_checkout_session_id => 'cs_finalizer_merchandise',
      p_payment_intent_id => 'pi_finalizer_merchandise'
    )
  ),
  'finalizer reports a replay as already finalized'
);

SELECT is(
  (
    SELECT count(*)
    FROM public.orders
    WHERE checkout_intent_id = '40000000-0000-0000-0000-000000000102'
  ),
  1::bigint,
  'finalizer replay keeps exactly one order'
);

SELECT is(
  (
    SELECT count(*)
    FROM public.discount_redemptions
    WHERE checkout_intent_id = '40000000-0000-0000-0000-000000000102'
  ),
  1::bigint,
  'finalizer replay keeps exactly one redemption'
);

SELECT is(
  (
    SELECT inventory_quantity
    FROM public.products
    WHERE id = '30000000-0000-0000-0000-000000000101'
  ),
  (SELECT quantity FROM inventory_before_replay),
  'finalizer replay does not decrement inventory again'
);

SELECT is(
  (
    SELECT count(*)
    FROM public.discount_redemptions
    WHERE checkout_intent_id IN (
      '40000000-0000-0000-0000-000000000104',
      '40000000-0000-0000-0000-000000000105'
    )
  ),
  0::bigint,
  'failed and expired checkout intents do not consume redemptions'
);

DELETE FROM vault.secrets
WHERE name = 'taa_identity_fingerprint_pepper';

SELECT lives_ok(
  $$
    SELECT *
    FROM public.finalize_paid_checkout(
      p_checkout_session_id => 'cs_finalizer_degraded_identity',
      p_payment_intent_id => 'pi_finalizer_degraded_identity'
    )
  $$,
  'unrestricted discounted checkout finalizes when fingerprinting is degraded'
);

SELECT ok(
  (
    SELECT customer_email_fingerprint IS NULL
      AND shipping_phone_fingerprint IS NULL
      AND shipping_address_fingerprint IS NULL
    FROM public.orders
    WHERE checkout_intent_id = '40000000-0000-0000-0000-000000000106'
  ),
  'degraded unrestricted discounted order keeps null identity fingerprints'
);

SELECT ok(
  (
    SELECT email_fingerprint IS NULL
      AND phone_fingerprint IS NULL
      AND shipping_address_fingerprint IS NULL
    FROM public.discount_redemptions
    WHERE checkout_intent_id = '40000000-0000-0000-0000-000000000106'
  ),
  'degraded unrestricted redemption accepts nullable identity fingerprints'
);

SELECT is(
  (
    SELECT count(*)
    FROM public.discount_redemptions
    WHERE checkout_intent_id = '40000000-0000-0000-0000-000000000106'
  ),
  1::bigint,
  'degraded unrestricted finalization still creates one redemption'
);

SELECT ok(
  NOT has_table_privilege('anon', 'public.discount_codes', 'SELECT')
    AND NOT has_table_privilege('anon', 'public.discount_redemptions', 'SELECT')
    AND NOT has_table_privilege('anon', 'public.discount_redemptions', 'INSERT'),
  'anon receives no discount table privileges'
);

SELECT ok(
  NOT has_table_privilege('authenticated', 'public.discount_codes', 'SELECT')
    AND NOT has_table_privilege('authenticated', 'public.discount_redemptions', 'SELECT')
    AND NOT has_table_privilege('authenticated', 'public.discount_redemptions', 'INSERT'),
  'authenticated receives no discount table privileges'
);

SELECT ok(
  NOT has_function_privilege(
    'anon',
    'public.evaluate_discount_code(text,integer,integer,uuid,text,text,jsonb,timestamp with time zone)',
    'EXECUTE'
  )
    AND NOT has_function_privilege(
      'authenticated',
      'public.evaluate_discount_code(text,integer,integer,uuid,text,text,jsonb,timestamp with time zone)',
      'EXECUTE'
    )
    AND NOT has_function_privilege(
      'anon',
      'public.finalize_paid_checkout(text,text,text,text,text,text,integer,integer)',
      'EXECUTE'
    )
    AND NOT has_function_privilege(
      'authenticated',
      'public.finalize_paid_checkout(text,text,text,text,text,text,integer,integer)',
      'EXECUTE'
    ),
  'evaluator and finalizer remain server-only'
);

SELECT * FROM finish();

ROLLBACK;
