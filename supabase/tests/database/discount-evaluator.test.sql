BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(50);

DELETE FROM vault.secrets
WHERE name = 'taa_identity_fingerprint_pepper';

SELECT vault.create_secret(
  encode(extensions.gen_random_bytes(32), 'hex'),
  'taa_identity_fingerprint_pepper',
  'Transaction-scoped discount evaluator test pepper'
);

INSERT INTO auth.users (id, email, raw_user_meta_data)
VALUES
  ('10000000-0000-0000-0000-000000000001', 'prior@example.com', '{}'::jsonb),
  ('10000000-0000-0000-0000-000000000002', 'redeemer@example.com', '{}'::jsonb),
  ('10000000-0000-0000-0000-000000000003', 'other@example.com', '{}'::jsonb),
  ('10000000-0000-0000-0000-000000000004', 'new@example.com', '{}'::jsonb);

INSERT INTO public.discount_codes (
  id,
  code,
  discount_type,
  percent_off_bps,
  amount_off,
  active,
  starts_at,
  expires_at,
  minimum_subtotal_amount,
  maximum_discount_amount,
  maximum_redemptions,
  maximum_redemptions_per_user,
  requires_account,
  first_order_only,
  first_email_only,
  first_phone_only,
  first_household_only
)
VALUES
  (
    '20000000-0000-0000-0000-000000000001',
    'TAA10',
    'percentage',
    1000,
    NULL,
    true,
    NULL,
    NULL,
    0,
    NULL,
    NULL,
    NULL,
    false,
    false,
    false,
    false,
    false
  ),
  (
    '20000000-0000-0000-0000-000000000002',
    'INACTIVE',
    'percentage',
    1000,
    NULL,
    false,
    NULL,
    NULL,
    0,
    NULL,
    NULL,
    NULL,
    false,
    false,
    false,
    false,
    false
  ),
  (
    '20000000-0000-0000-0000-000000000003',
    'SCHEDULED',
    'percentage',
    1000,
    NULL,
    true,
    '2026-08-12 10:00:00+00',
    '2026-08-12 11:00:00+00',
    0,
    NULL,
    NULL,
    NULL,
    false,
    false,
    false,
    false,
    false
  ),
  (
    '20000000-0000-0000-0000-000000000004',
    'MINIMUM',
    'fixed',
    NULL,
    100,
    true,
    NULL,
    NULL,
    2000,
    NULL,
    NULL,
    NULL,
    false,
    false,
    false,
    false,
    false
  ),
  (
    '20000000-0000-0000-0000-000000000005',
    'PERCENTCAP',
    'percentage',
    1000,
    NULL,
    true,
    NULL,
    NULL,
    0,
    100,
    NULL,
    NULL,
    false,
    false,
    false,
    false,
    false
  ),
  (
    '20000000-0000-0000-0000-000000000006',
    'PERCENT100',
    'percentage',
    10000,
    NULL,
    true,
    NULL,
    NULL,
    0,
    NULL,
    NULL,
    NULL,
    false,
    false,
    false,
    false,
    false
  ),
  (
    '20000000-0000-0000-0000-000000000007',
    'FIXED500',
    'fixed',
    NULL,
    500,
    true,
    NULL,
    NULL,
    0,
    NULL,
    NULL,
    NULL,
    false,
    false,
    false,
    false,
    false
  ),
  (
    '20000000-0000-0000-0000-000000000008',
    'FIXEDBIG',
    'fixed',
    NULL,
    5000,
    true,
    NULL,
    NULL,
    0,
    NULL,
    NULL,
    NULL,
    false,
    false,
    false,
    false,
    false
  ),
  (
    '20000000-0000-0000-0000-000000000009',
    'FREESHIP',
    'free_shipping',
    NULL,
    NULL,
    true,
    NULL,
    NULL,
    0,
    NULL,
    NULL,
    NULL,
    false,
    false,
    false,
    false,
    false
  ),
  (
    '20000000-0000-0000-0000-000000000010',
    'ACCOUNT',
    'fixed',
    NULL,
    100,
    true,
    NULL,
    NULL,
    0,
    NULL,
    NULL,
    NULL,
    true,
    false,
    false,
    false,
    false
  ),
  (
    '20000000-0000-0000-0000-000000000011',
    'FIRSTORDER',
    'fixed',
    NULL,
    100,
    true,
    NULL,
    NULL,
    0,
    NULL,
    NULL,
    NULL,
    true,
    true,
    false,
    false,
    false
  ),
  (
    '20000000-0000-0000-0000-000000000012',
    'FIRSTEMAIL',
    'fixed',
    NULL,
    100,
    true,
    NULL,
    NULL,
    0,
    NULL,
    NULL,
    NULL,
    false,
    false,
    true,
    false,
    false
  ),
  (
    '20000000-0000-0000-0000-000000000013',
    'FIRSTPHONE',
    'fixed',
    NULL,
    100,
    true,
    NULL,
    NULL,
    0,
    NULL,
    NULL,
    NULL,
    false,
    false,
    false,
    true,
    false
  ),
  (
    '20000000-0000-0000-0000-000000000014',
    'FIRSTHOUSE',
    'fixed',
    NULL,
    100,
    true,
    NULL,
    NULL,
    0,
    NULL,
    NULL,
    NULL,
    false,
    false,
    false,
    false,
    true
  ),
  (
    '20000000-0000-0000-0000-000000000015',
    'GLOBALMAX',
    'fixed',
    NULL,
    100,
    true,
    NULL,
    NULL,
    0,
    NULL,
    1,
    NULL,
    false,
    false,
    false,
    false,
    false
  ),
  (
    '20000000-0000-0000-0000-000000000016',
    'USERMAX',
    'fixed',
    NULL,
    100,
    true,
    NULL,
    NULL,
    0,
    NULL,
    NULL,
    1,
    false,
    false,
    false,
    false,
    false
  );

INSERT INTO public.orders (
  id,
  user_id,
  email,
  order_number,
  status,
  total,
  customer_email,
  shipping_phone,
  shipping_address
)
VALUES (
  '30000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  'prior.customer@example.com',
  'TAA-EVALUATOR-PRIOR',
  'paid',
  10.00,
  'prior.customer@example.com',
  '+44 7123 456789',
  '{"address_1":"12 High Street","address_2":"Flat 2","postcode":"SW1A 1AA","country":"GB"}'::jsonb
);

INSERT INTO public.checkout_intents (
  id,
  payment_intent_id,
  status,
  customer_email,
  subtotal_amount,
  shipping_amount,
  total_amount
)
VALUES
  (
    '40000000-0000-0000-0000-000000000001',
    'pi_evaluator_global',
    'paid',
    'redeemer@example.com',
    1000,
    0,
    1000
  ),
  (
    '40000000-0000-0000-0000-000000000002',
    'pi_evaluator_user',
    'paid',
    'redeemer@example.com',
    1000,
    0,
    1000
  );

INSERT INTO public.orders (
  id,
  user_id,
  email,
  order_number,
  status,
  total,
  customer_email,
  checkout_intent_id
)
VALUES
  (
    '30000000-0000-0000-0000-000000000002',
    '10000000-0000-0000-0000-000000000002',
    'redeemer@example.com',
    'TAA-EVALUATOR-GLOBAL',
    'paid',
    10.00,
    'redeemer@example.com',
    '40000000-0000-0000-0000-000000000001'
  ),
  (
    '30000000-0000-0000-0000-000000000003',
    '10000000-0000-0000-0000-000000000002',
    'redeemer@example.com',
    'TAA-EVALUATOR-USER',
    'paid',
    10.00,
    'redeemer@example.com',
    '40000000-0000-0000-0000-000000000002'
  );

INSERT INTO public.discount_redemptions (
  discount_code_id,
  checkout_intent_id,
  order_id,
  user_id,
  code_snapshot,
  discount_amount
)
VALUES
  (
    '20000000-0000-0000-0000-000000000015',
    '40000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000002',
    '10000000-0000-0000-0000-000000000002',
    'GLOBALMAX',
    100
  ),
  (
    '20000000-0000-0000-0000-000000000016',
    '40000000-0000-0000-0000-000000000002',
    '30000000-0000-0000-0000-000000000003',
    '10000000-0000-0000-0000-000000000002',
    'USERMAX',
    100
  );

SELECT throws_ok(
  $$SELECT * FROM public.evaluate_discount_code('TAA10', -1, 499)$$,
  '22023',
  'Subtotal and shipping amounts cannot be negative.',
  'negative subtotal is rejected'
);

SELECT throws_ok(
  $$SELECT * FROM public.evaluate_discount_code('TAA10', 1895, -1)$$,
  '22023',
  'Subtotal and shipping amounts cannot be negative.',
  'negative shipping is rejected'
);

SELECT is(
  (SELECT reason_code FROM public.evaluate_discount_code(NULL, 1895, 499)),
  'invalid_code',
  'missing code is invalid'
);

SELECT is(
  (SELECT reason_code FROM public.evaluate_discount_code('UNKNOWN', 1895, 499)),
  'invalid_code',
  'unknown code is invalid'
);

SELECT is(
  (SELECT reason_code FROM public.evaluate_discount_code('INACTIVE', 1895, 499)),
  'inactive',
  'inactive code is rejected'
);

SELECT is(
  (
    SELECT reason_code
    FROM public.evaluate_discount_code(
      'SCHEDULED',
      1895,
      499,
      p_now => '2026-08-12 09:59:59+00'
    )
  ),
  'not_started',
  'code is unavailable before starts_at'
);

SELECT is(
  (
    SELECT reason_code
    FROM public.evaluate_discount_code(
      'SCHEDULED',
      1895,
      499,
      p_now => '2026-08-12 10:00:00+00'
    )
  ),
  'eligible',
  'starts_at boundary is inclusive'
);

SELECT is(
  (
    SELECT reason_code
    FROM public.evaluate_discount_code(
      'SCHEDULED',
      1895,
      499,
      p_now => '2026-08-12 11:00:01+00'
    )
  ),
  'expired',
  'code is unavailable after expires_at'
);

SELECT is(
  (
    SELECT reason_code
    FROM public.evaluate_discount_code(
      'SCHEDULED',
      1895,
      499,
      p_now => '2026-08-12 11:00:00+00'
    )
  ),
  'expired',
  'expires_at boundary is exclusive'
);

SELECT is(
  (SELECT reason_code FROM public.evaluate_discount_code('MINIMUM', 1999, 5000)),
  'minimum_subtotal_not_met',
  'shipping does not count toward minimum subtotal'
);

SELECT is(
  (SELECT reason_code FROM public.evaluate_discount_code('MINIMUM', 2000, 0)),
  'eligible',
  'exact minimum subtotal is eligible'
);

SELECT is(
  (SELECT code FROM public.evaluate_discount_code(' taa10 ', 1895, 499)),
  'TAA10',
  'submitted code is normalized for lookup'
);

SELECT is(
  (SELECT discount_amount FROM public.evaluate_discount_code('TAA10', 1895, 499)),
  190,
  '10 percent of 1895 rounds to 190 pence'
);

SELECT is(
  (SELECT total_amount FROM public.evaluate_discount_code('TAA10', 1895, 499)),
  2204,
  'percentage total uses subtotal minus discount plus shipping'
);

SELECT is(
  (SELECT discount_amount FROM public.evaluate_discount_code('PERCENTCAP', 1895, 499)),
  100,
  'percentage maximum discount cap is applied'
);

SELECT is(
  (SELECT discount_amount FROM public.evaluate_discount_code('PERCENT100', 1895, 499)),
  1895,
  '100 percent discount cannot exceed subtotal'
);

SELECT is(
  (SELECT discount_amount FROM public.evaluate_discount_code('FIXED500', 1895, 499)),
  500,
  'fixed discount uses its configured pence amount'
);

SELECT is(
  (SELECT total_amount FROM public.evaluate_discount_code('FIXED500', 1895, 499)),
  1894,
  'fixed discount total is correct'
);

SELECT is(
  (SELECT discount_amount FROM public.evaluate_discount_code('FIXEDBIG', 1895, 499)),
  1895,
  'fixed discount larger than subtotal is capped at subtotal'
);

SELECT is(
  (SELECT discount_amount FROM public.evaluate_discount_code('FREESHIP', 1895, 499)),
  0,
  'free shipping does not discount merchandise'
);

SELECT is(
  (
    SELECT shipping_discount_amount
    FROM public.evaluate_discount_code('FREESHIP', 1895, 499)
  ),
  499,
  'free shipping records the original shipping as the shipping discount'
);

SELECT is(
  (SELECT final_shipping_amount FROM public.evaluate_discount_code('FREESHIP', 1895, 499)),
  0,
  'free shipping reduces final shipping to zero'
);

SELECT is(
  (SELECT total_amount FROM public.evaluate_discount_code('FREESHIP', 1895, 499)),
  1895,
  'free shipping leaves merchandise subtotal unchanged'
);

SELECT is(
  (SELECT reason_code FROM public.evaluate_discount_code('ACCOUNT', 1895, 499)),
  'account_required',
  'account-required code rejects a guest'
);

SELECT is(
  (
    SELECT reason_code
    FROM public.evaluate_discount_code(
      'ACCOUNT',
      1895,
      499,
      p_user_id => '10000000-0000-0000-0000-000000000004'
    )
  ),
  'eligible',
  'account-required code allows an eligible authenticated user'
);

SELECT is(
  (SELECT reason_code FROM public.evaluate_discount_code('FIRSTORDER', 1895, 499)),
  'account_required',
  'first-order-only code requires an authenticated user'
);

SELECT is(
  (
    SELECT reason_code
    FROM public.evaluate_discount_code(
      'FIRSTORDER',
      1895,
      499,
      p_user_id => '10000000-0000-0000-0000-000000000001'
    )
  ),
  'not_first_order',
  'previous paid order rejects first-order-only code'
);

SELECT is(
  (
    SELECT reason_code
    FROM public.evaluate_discount_code(
      'FIRSTEMAIL',
      1895,
      499,
      p_email => 'prior.customer@example.com'
    )
  ),
  'not_first_email',
  'previous paid email rejects first-email-only code'
);

SELECT is(
  (
    SELECT reason_code
    FROM public.evaluate_discount_code(
      'FIRSTEMAIL',
      1895,
      499,
      p_email => ' PRIOR.CUSTOMER@EXAMPLE.COM '
    )
  ),
  'not_first_email',
  'equivalent normalized email rejects first-email-only code'
);

SELECT is(
  (SELECT reason_code FROM public.evaluate_discount_code('FIRSTEMAIL', 1895, 499)),
  'identity_unavailable',
  'missing current email fails closed'
);

SELECT is(
  (
    SELECT reason_code
    FROM public.evaluate_discount_code(
      'FIRSTPHONE',
      1895,
      499,
      p_phone => '+447123456789'
    )
  ),
  'not_first_phone',
  'previous paid phone rejects first-phone-only code'
);

SELECT is(
  (
    SELECT reason_code
    FROM public.evaluate_discount_code(
      'FIRSTPHONE',
      1895,
      499,
      p_phone => '07123 456789'
    )
  ),
  'not_first_phone',
  'equivalent UK phone formatting rejects first-phone-only code'
);

SELECT is(
  (SELECT reason_code FROM public.evaluate_discount_code('FIRSTPHONE', 1895, 499)),
  'identity_unavailable',
  'missing current phone fails closed'
);

SELECT is(
  (
    SELECT reason_code
    FROM public.evaluate_discount_code(
      'FIRSTHOUSE',
      1895,
      499,
      p_shipping_address =>
        '{"line1":"12 HIGH ST.","line2":"Flat-2","postal_code":"sw1a1aa","country":"United Kingdom"}'::jsonb
    )
  ),
  'not_first_household',
  'normalized street and postcode equivalent rejects first-household-only code'
);

SELECT is(
  (
    SELECT reason_code
    FROM public.evaluate_discount_code(
      'FIRSTHOUSE',
      1895,
      499,
      p_email => 'brand.new@example.com',
      p_shipping_address =>
        '{"address_1":"12 High Street","address_2":"Flat 2","postcode":"SW1A 1AA","country":"GB"}'::jsonb
    )
  ),
  'not_first_household',
  'new email with the same household remains ineligible'
);

SELECT is(
  (
    SELECT reason_code
    FROM public.evaluate_discount_code(
      'FIRSTPHONE',
      1895,
      499,
      p_user_id => '10000000-0000-0000-0000-000000000004',
      p_phone => '07123 456789'
    )
  ),
  'not_first_phone',
  'new account with the same phone remains ineligible'
);

SELECT is(
  (SELECT reason_code FROM public.evaluate_discount_code('FIRSTHOUSE', 1895, 499)),
  'identity_unavailable',
  'missing current shipping address fails closed'
);

DELETE FROM vault.secrets
WHERE name = 'taa_identity_fingerprint_pepper';

SELECT is(
  (
    SELECT reason_code
    FROM public.evaluate_discount_code(
      'FIRSTEMAIL',
      1895,
      499,
      p_email => 'new.identity@example.com'
    )
  ),
  'identity_unavailable',
  'missing Vault pepper makes identity-limited code unavailable'
);

SELECT is(
  (SELECT reason_code FROM public.evaluate_discount_code('TAA10', 1895, 499)),
  'eligible',
  'missing Vault pepper does not affect unrestricted discount'
);

SELECT vault.create_secret(
  encode(extensions.gen_random_bytes(32), 'hex'),
  'taa_identity_fingerprint_pepper',
  'Replacement transaction-scoped discount evaluator test pepper'
);

INSERT INTO public.orders (
  id,
  email,
  order_number,
  status,
  total,
  customer_email
)
VALUES (
  '30000000-0000-0000-0000-000000000010',
  'coverage.email@example.com',
  'TAA-EVALUATOR-COVERAGE-EMAIL',
  'paid',
  10.00,
  'coverage.email@example.com'
);

UPDATE public.orders
SET customer_email_fingerprint = NULL
WHERE id = '30000000-0000-0000-0000-000000000010';

SELECT is(
  (
    SELECT reason_code
    FROM public.evaluate_discount_code(
      'FIRSTEMAIL',
      1895,
      499,
      p_email => 'new.identity@example.com'
    )
  ),
  'identity_unavailable',
  'incomplete historical email fingerprints fail closed'
);

DELETE FROM public.orders
WHERE id = '30000000-0000-0000-0000-000000000010';

INSERT INTO public.orders (
  id,
  email,
  order_number,
  status,
  total,
  shipping_phone
)
VALUES (
  '30000000-0000-0000-0000-000000000011',
  'coverage.phone@example.com',
  'TAA-EVALUATOR-COVERAGE-PHONE',
  'paid',
  10.00,
  '07000 111222'
);

UPDATE public.orders
SET shipping_phone_fingerprint = NULL
WHERE id = '30000000-0000-0000-0000-000000000011';

SELECT is(
  (
    SELECT reason_code
    FROM public.evaluate_discount_code(
      'FIRSTPHONE',
      1895,
      499,
      p_phone => '07000 333444'
    )
  ),
  'identity_unavailable',
  'incomplete historical phone fingerprints fail closed'
);

DELETE FROM public.orders
WHERE id = '30000000-0000-0000-0000-000000000011';

INSERT INTO public.orders (
  id,
  email,
  order_number,
  status,
  total,
  shipping_address
)
VALUES (
  '30000000-0000-0000-0000-000000000012',
  'coverage.address@example.com',
  'TAA-EVALUATOR-COVERAGE-ADDRESS',
  'paid',
  10.00,
  '{"address_1":"99 New Road","postcode":"W1A 1AA","country":"GB"}'::jsonb
);

UPDATE public.orders
SET shipping_address_fingerprint = NULL
WHERE id = '30000000-0000-0000-0000-000000000012';

SELECT is(
  (
    SELECT reason_code
    FROM public.evaluate_discount_code(
      'FIRSTHOUSE',
      1895,
      499,
      p_shipping_address =>
        '{"address_1":"100 Other Road","postcode":"W1A 2AA","country":"GB"}'::jsonb
    )
  ),
  'identity_unavailable',
  'incomplete historical address fingerprints fail closed'
);

DELETE FROM public.orders
WHERE id = '30000000-0000-0000-0000-000000000012';

SELECT is(
  (SELECT reason_code FROM public.evaluate_discount_code('GLOBALMAX', 1895, 499)),
  'maximum_redemptions_reached',
  'global maximum redemption limit is enforced'
);

SELECT is(
  (
    SELECT reason_code
    FROM public.evaluate_discount_code(
      'USERMAX',
      1895,
      499,
      p_user_id => '10000000-0000-0000-0000-000000000002'
    )
  ),
  'user_redemption_limit_reached',
  'per-user maximum redemption limit is enforced'
);

SELECT is(
  (
    SELECT reason_code
    FROM public.evaluate_discount_code(
      'USERMAX',
      1895,
      499,
      p_user_id => '10000000-0000-0000-0000-000000000003'
    )
  ),
  'eligible',
  'another user redemption does not consume this user allowance'
);

SELECT ok(
  NOT has_function_privilege(
    'anon',
    'public.evaluate_discount_code(text,integer,integer,uuid,text,text,jsonb,timestamp with time zone)',
    'EXECUTE'
  ),
  'anon cannot execute discount evaluator'
);

SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'public.evaluate_discount_code(text,integer,integer,uuid,text,text,jsonb,timestamp with time zone)',
    'EXECUTE'
  ),
  'authenticated cannot execute discount evaluator'
);

SELECT ok(
  has_function_privilege(
    'service_role',
    'public.evaluate_discount_code(text,integer,integer,uuid,text,text,jsonb,timestamp with time zone)',
    'EXECUTE'
  ),
  'service_role can execute discount evaluator'
);

SELECT ok(
  NOT has_table_privilege('anon', 'public.discount_codes', 'SELECT')
    AND NOT has_table_privilege('anon', 'public.discount_redemptions', 'SELECT')
    AND NOT has_function_privilege(
      'anon',
      'public.fingerprint_identity_email(text)',
      'EXECUTE'
    ),
  'anon has no direct discount-table or fingerprint-helper access'
);

SELECT ok(
  NOT has_table_privilege('authenticated', 'public.discount_codes', 'SELECT')
    AND NOT has_table_privilege('authenticated', 'public.discount_redemptions', 'SELECT')
    AND NOT has_function_privilege(
      'authenticated',
      'public.fingerprint_identity_email(text)',
      'EXECUTE'
    ),
  'authenticated has no direct discount-table or fingerprint-helper access'
);

SELECT * FROM finish();

ROLLBACK;
