BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(19);

DELETE FROM vault.secrets
WHERE name = 'taa_identity_fingerprint_pepper';

SELECT throws_ok(
  $$SELECT public.fingerprint_identity_email('customer@example.com')$$,
  'TAA01',
  'Identity fingerprint pepper is not provisioned.',
  'fingerprinting fails clearly when the named pepper is missing'
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
  '10000000-0000-0000-0000-000000000001',
  'Fingerprint finalization test product',
  'fingerprint-finalization-test-product',
  'FINGERPRINT-FINALIZATION-TEST',
  10.00,
  1,
  true
);

ALTER TABLE public.products ENABLE TRIGGER sync_klaviyo_products_after_change;

INSERT INTO public.checkout_intents (
  id,
  payment_intent_id,
  status,
  customer_email,
  subtotal_amount,
  shipping_amount,
  total_amount,
  shipping_phone,
  shipping_address
)
VALUES (
  '20000000-0000-0000-0000-000000000001',
  'pi_fingerprint_degraded_test',
  'pending',
  'degraded@example.com',
  1000,
  0,
  1000,
  '07123 456789',
  '{"address_1":"12 High Street","postcode":"SW1A 1AA","country":"GB"}'::jsonb
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
VALUES (
  '20000000-0000-0000-0000-000000000001',
  'product',
  '10000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  'FINGERPRINT-FINALIZATION-TEST',
  'Fingerprint finalization test product',
  'Fingerprint finalization test product',
  1,
  1000,
  1000,
  100
);

SELECT lives_ok(
  $$
    SELECT *
    FROM public.finalize_paid_checkout(
      p_payment_intent_id => 'pi_fingerprint_degraded_test'
    )
  $$,
  'paid checkout finalization succeeds when the pepper is unavailable'
);

SELECT ok(
  (
    SELECT status = 'paid'
      AND customer_email_fingerprint IS NULL
      AND shipping_phone_fingerprint IS NULL
      AND shipping_address_fingerprint IS NULL
    FROM public.orders
    WHERE checkout_intent_id = '20000000-0000-0000-0000-000000000001'
  ),
  'the finalized degraded order retains null identity fingerprints'
);

SELECT throws_ok(
  $$SELECT public.backfill_paid_order_identity_fingerprints()$$,
  'TAA01',
  'Identity fingerprint pepper is not provisioned.',
  'the historical backfill remains strict when the pepper is unavailable'
);

DO $test_setup$
DECLARE
  v_secret_id uuid;
  v_test_pepper text := encode(extensions.gen_random_bytes(32), 'hex');
BEGIN
  SELECT id
  INTO v_secret_id
  FROM vault.secrets
  WHERE name = 'taa_identity_fingerprint_pepper';

  IF v_secret_id IS NULL THEN
    PERFORM vault.create_secret(
      v_test_pepper,
      'taa_identity_fingerprint_pepper',
      'Transaction-scoped pgTAP identity fingerprint pepper'
    );
  ELSE
    PERFORM vault.update_secret(v_secret_id, v_test_pepper);
  END IF;
END;
$test_setup$;

SELECT is(
  public.fingerprint_identity_email(' Customer@Example.COM '),
  public.fingerprint_identity_email('customer@example.com'),
  'equivalent email forms have the same fingerprint'
);

SELECT is(
  public.fingerprint_identity_phone('+44 (0) 7123 456789'),
  public.fingerprint_identity_phone('07123 456789'),
  'equivalent UK phone forms have the same fingerprint'
);

SELECT is(
  public.fingerprint_shipping_address(
    '{"address_1":"12 High Street","address_2":"Flat 2","postcode":"SW1A 1AA","country":"United Kingdom"}'::jsonb
  ),
  public.fingerprint_shipping_address(
    '{"line1":"12 HIGH ST.","line2":"Flat-2","postal_code":"sw1a1aa","country":"GB"}'::jsonb
  ),
  'equivalent normalized shipping addresses have the same fingerprint'
);

SELECT isnt(
  public.fingerprint_identity_email('customer@example.com'),
  public.fingerprint_identity_email('different@example.com'),
  'different identities have different fingerprints'
);

CREATE TEMPORARY TABLE fingerprint_before_pepper_change (
  fingerprint text NOT NULL
) ON COMMIT DROP;

INSERT INTO fingerprint_before_pepper_change (fingerprint)
VALUES (public.fingerprint_identity_email('customer@example.com'));

SELECT vault.update_secret(
  (
    SELECT id
    FROM vault.secrets
    WHERE name = 'taa_identity_fingerprint_pepper'
  ),
  encode(extensions.gen_random_bytes(32), 'hex')
);

SELECT isnt(
  public.fingerprint_identity_email('customer@example.com'),
  (SELECT fingerprint FROM fingerprint_before_pepper_change),
  'the same identity has a different fingerprint with a different pepper'
);

SELECT matches(
  public.fingerprint_identity_email('customer@example.com'),
  '^[0-9a-f]{64}$',
  'fingerprints are lowercase 64-character SHA-256 hex strings'
);

INSERT INTO public.orders (
  email,
  order_number,
  status,
  total,
  customer_email,
  shipping_phone,
  shipping_address
)
VALUES (
  'customer@example.com',
  'TAA-FINGERPRINT-TRIGGER-TEST',
  'paid',
  10.00,
  'customer@example.com',
  '07123 456789',
  '{"address_1":"12 High Street","address_2":"Flat 2","postcode":"SW1A 1AA","country":"GB"}'::jsonb
);

SELECT ok(
  (
    SELECT customer_email_fingerprint IS NOT NULL
      AND shipping_phone_fingerprint IS NOT NULL
      AND shipping_address_fingerprint IS NOT NULL
    FROM public.orders
    WHERE order_number = 'TAA-FINGERPRINT-TRIGGER-TEST'
  ),
  'the paid-order trigger stores all identity fingerprints'
);

UPDATE public.orders
SET
  customer_email_fingerprint = NULL,
  shipping_phone_fingerprint = NULL,
  shipping_address_fingerprint = NULL
WHERE order_number = 'TAA-FINGERPRINT-TRIGGER-TEST';

SELECT cmp_ok(
  public.backfill_paid_order_identity_fingerprints(),
  '>=',
  1::bigint,
  'the explicit paid-order backfill updates paid orders'
);

SELECT ok(
  (
    SELECT customer_email_fingerprint IS NOT NULL
      AND shipping_phone_fingerprint IS NOT NULL
      AND shipping_address_fingerprint IS NOT NULL
    FROM public.orders
    WHERE order_number = 'TAA-FINGERPRINT-TRIGGER-TEST'
  ),
  'the paid-order backfill restores all identity fingerprints'
);

SELECT ok(
  NOT has_function_privilege(
    'anon',
    'public.fingerprint_identity_email(text)',
    'EXECUTE'
  )
    AND NOT has_function_privilege(
      'anon',
      'public.fingerprint_identity_phone(text)',
      'EXECUTE'
    )
    AND NOT has_function_privilege(
      'anon',
      'public.fingerprint_shipping_address(jsonb)',
      'EXECUTE'
    ),
  'anon cannot execute identity fingerprint helpers'
);

SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'public.fingerprint_identity_email(text)',
    'EXECUTE'
  )
    AND NOT has_function_privilege(
      'authenticated',
      'public.fingerprint_identity_phone(text)',
      'EXECUTE'
    )
    AND NOT has_function_privilege(
      'authenticated',
      'public.fingerprint_shipping_address(jsonb)',
      'EXECUTE'
    ),
  'authenticated cannot execute identity fingerprint helpers'
);

SELECT ok(
  NOT has_schema_privilege('anon', 'vault', 'USAGE')
    AND NOT has_table_privilege('anon', 'vault.decrypted_secrets', 'SELECT'),
  'anon cannot access Vault or decrypted secrets'
);

SELECT ok(
  NOT has_schema_privilege('authenticated', 'vault', 'USAGE')
    AND NOT has_table_privilege('authenticated', 'vault.decrypted_secrets', 'SELECT'),
  'authenticated cannot access Vault or decrypted secrets'
);

SELECT ok(
  has_function_privilege(
    'service_role',
    'public.fingerprint_identity_email(text)',
    'EXECUTE'
  ),
  'service_role can execute the required fingerprint functionality'
);

SELECT ok(
  NOT has_function_privilege(
    'service_role',
    'public.identity_fingerprint_hmac(text)',
    'EXECUTE'
  ),
  'service_role cannot call the internal normalized-value HMAC helper directly'
);

SELECT * FROM finish();

ROLLBACK;
