#!/usr/bin/env bash

set -euo pipefail

database_container="${SUPABASE_DB_CONTAINER:-supabase_db_TAA-Platform}"
test_directory="$(mktemp -d "${TMPDIR:-/tmp}/taa-checkout-admission.XXXXXX")"
admit_output="${test_directory}/admit.log"
resume_output="${test_directory}/resume.log"
competing_output="${test_directory}/competing.log"
replacement_winner_output="${test_directory}/replacement-winner.log"
replacement_loser_output="${test_directory}/replacement-loser.log"
psql_command=(
  docker exec -i "${database_container}"
  psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres
)

cleanup_fixtures() {
  "${psql_command[@]}" >/dev/null 2>&1 <<'SQL' || true
UPDATE public.checkout_attempts
SET
  active_checkout_intent_id = NULL,
  in_flight_checkout_intent_id = NULL,
  admitted_checkout_request_id = NULL,
  admitted_replaces_checkout_intent_id = NULL,
  admitted_request_expires_at = NULL
WHERE id IN (
  'f1000000-0000-4000-8000-000000000001',
  'fb300000-0000-4000-8000-000000000001'
);

DELETE FROM public.inventory_reservations
WHERE checkout_attempt_id = 'fb300000-0000-4000-8000-000000000001';

DELETE FROM public.checkout_intents
WHERE checkout_attempt_id = 'fb300000-0000-4000-8000-000000000001';

DELETE FROM public.checkout_attempts
WHERE id IN (
  'f1000000-0000-4000-8000-000000000001',
  'fb300000-0000-4000-8000-000000000001'
);

DELETE FROM public.shipping_rates
WHERE id = 'fb200000-0000-4000-8000-000000000001';

DELETE FROM public.shipping_methods
WHERE id = 'fb100000-0000-4000-8000-000000000001';

ALTER TABLE public.products DISABLE TRIGGER sync_klaviyo_products_after_change;
DELETE FROM public.products
WHERE id = 'fb000000-0000-4000-8000-000000000001';
ALTER TABLE public.products ENABLE TRIGGER sync_klaviyo_products_after_change;
SQL
}

cleanup() {
  cleanup_fixtures
  rm -f \
    "${admit_output}" \
    "${resume_output}" \
    "${competing_output}" \
    "${replacement_winner_output}" \
    "${replacement_loser_output}"
  rmdir "${test_directory}"
}

trap cleanup EXIT
cleanup_fixtures

"${psql_command[@]}" >"${admit_output}" 2>&1 <<'SQL'
SELECT admission_state
FROM public.admit_checkout_request_v1(
  'f1000000-0000-4000-8000-000000000001',
  'f2000000-0000-4000-8000-000000000001',
  NULL,
  repeat('a', 64),
  NULL
);
SQL

(
  "${psql_command[@]}" >/dev/null 2>&1 <<'SQL'
BEGIN;
SELECT id FROM public.checkout_attempts
WHERE id = 'f1000000-0000-4000-8000-000000000001'
FOR UPDATE;
SELECT pg_sleep(2);
COMMIT;
SQL
) &
canonical_pid=$!

sleep 0.25

(
  "${psql_command[@]}" >"${resume_output}" 2>&1 <<'SQL'
SELECT resume_state
FROM public.resume_checkout_request_v1(
  'f1000000-0000-4000-8000-000000000001',
  'f2000000-0000-4000-8000-000000000001',
  NULL,
  repeat('a', 64),
  'f3000000-0000-4000-8000-000000000001'
);
SQL
) &
resume_pid=$!

set +e
"${psql_command[@]}" >"${competing_output}" 2>&1 <<'SQL'
SELECT admission_state
FROM public.admit_checkout_request_v1(
  'f1000000-0000-4000-8000-000000000001',
  'f2000000-0000-4000-8000-000000000002',
  NULL,
  repeat('a', 64),
  NULL
);
SQL
competing_status=$?
set -e

wait "${canonical_pid}"
wait "${resume_pid}"

if ! grep -q 'admitted' "${admit_output}"; then
  echo 'Admission concurrency test failed: original request was not admitted.' >&2
  exit 1
fi

if ! grep -q 'operation_in_progress' "${resume_output}"; then
  echo 'Admission concurrency test failed: resume did not observe durable admission.' >&2
  exit 1
fi

if [[ "${competing_status}" -eq 0 ]] ||
  ! grep -q 'unresolved admitted request' "${competing_output}"; then
  echo 'Admission concurrency test failed: competing request was not rejected.' >&2
  exit 1
fi

request_count="$(
  "${psql_command[@]}" -Atc "SELECT count(*) FROM public.checkout_attempts
    WHERE id = 'f1000000-0000-4000-8000-000000000001'
      AND admitted_checkout_request_id = 'f2000000-0000-4000-8000-000000000001';"
)"

if [[ "${request_count}" != '1' ]]; then
  echo 'Admission concurrency test failed: durable admission identity changed.' >&2
  exit 1
fi

"${psql_command[@]}" >/dev/null <<'SQL'
ALTER TABLE public.products DISABLE TRIGGER sync_klaviyo_products_after_change;

INSERT INTO public.products (
  id, name, slug, sku, price, inventory_quantity, active, weight_grams
)
VALUES (
  'fb000000-0000-4000-8000-000000000001',
  'Replacement admission concurrency product',
  'replacement-admission-concurrency-product',
  'REPLACEMENT-ADMISSION-CONCURRENCY',
  10.00,
  1,
  true,
  100
);

ALTER TABLE public.products ENABLE TRIGGER sync_klaviyo_products_after_change;

INSERT INTO public.shipping_methods (
  id, name, description, carrier, active, sort_order
)
VALUES (
  'fb100000-0000-4000-8000-000000000001',
  'Tracked',
  'Tracked delivery',
  'Royal Mail',
  true,
  1
);

INSERT INTO public.shipping_rates (
  id, shipping_method_id, min_weight_grams, max_weight_grams, price, currency, active
)
VALUES (
  'fb200000-0000-4000-8000-000000000001',
  'fb100000-0000-4000-8000-000000000001',
  0,
  10000,
  4.99,
  'GBP',
  true
);

DO $fixture$
DECLARE
  v_intent_id uuid;
  v_expiry timestamp with time zone;
BEGIN
  PERFORM *
  FROM public.admit_checkout_request_v1(
    'fb300000-0000-4000-8000-000000000001',
    'fb400000-0000-4000-8000-000000000001',
    NULL,
    repeat('a', 64),
    NULL
  );

  SELECT checkout_intent_id
  INTO v_intent_id
  FROM public.prepare_checkout_request(
    'fb300000-0000-4000-8000-000000000001',
    'fb400000-0000-4000-8000-000000000001',
    NULL,
    repeat('a', 64),
    repeat('b', 64),
    NULL,
    'fb500000-0000-4000-8000-000000000001',
    clock_timestamp() + interval '29 minutes',
    jsonb_build_object(
      'customer_email', NULL,
      'subtotal_amount', 1000,
      'shipping_amount', 499,
      'total_amount', 1499,
      'currency', 'gbp',
      'shipping_method_name', 'Tracked',
      'shipping_method_id', 'fb100000-0000-4000-8000-000000000001',
      'shipping_rate_id', 'fb200000-0000-4000-8000-000000000001',
      'total_weight_grams', 100,
      'shipping_name', 'Test Customer',
      'shipping_address', '{}'::jsonb,
      'billing_name', 'Test Customer',
      'billing_address', '{}'::jsonb,
      'billing_is_different', false,
      'stripe_customer_id', NULL,
      'create_account_requested', false,
      'discount_code_id', NULL,
      'discount_code', NULL,
      'discount_amount', 0,
      'shipping_discount_amount', 0,
      'discount_name', NULL,
      'discount_type', NULL,
      'stripe_return_url', 'https://example.test/return'
    ),
    jsonb_build_array(jsonb_build_object(
      'product_type', 'product',
      'product_id', 'fb000000-0000-4000-8000-000000000001',
      'base_product_id', 'fb000000-0000-4000-8000-000000000001',
      'sku', 'REPLACEMENT-ADMISSION-CONCURRENCY',
      'name', 'Replacement admission concurrency product',
      'product_name', 'Replacement admission concurrency product',
      'variant_name', NULL,
      'quantity', 1,
      'unit_amount', 1000,
      'line_total', 1000,
      'weight_grams', 100,
      'image_url', NULL,
      'amount', NULL
    )),
    jsonb_build_array(jsonb_build_object(
      'shipping_method_id', 'fb100000-0000-4000-8000-000000000001',
      'shipping_rate_id', 'fb200000-0000-4000-8000-000000000001',
      'display_name', 'Tracked',
      'description', 'Tracked delivery',
      'carrier', 'Royal Mail',
      'amount', 499,
      'original_amount', 499,
      'currency', 'gbp'
    ))
  );

  PERFORM *
  FROM public.begin_checkout_session_creation(
    v_intent_id,
    'fb500000-0000-4000-8000-000000000001',
    repeat('c', 64)
  );

  SELECT stripe_session_expires_at
  INTO v_expiry
  FROM public.checkout_intents
  WHERE id = v_intent_id;

  PERFORM public.record_checkout_session(
    v_intent_id,
    'fb500000-0000-4000-8000-000000000001',
    'cs_test_replacement_admission_concurrency_a',
    v_expiry,
    '[{"position":0,"stripe_shipping_rate_id":"shr_replacement_concurrency"}]'::jsonb
  );

  PERFORM public.activate_checkout_request(
    v_intent_id,
    'fb500000-0000-4000-8000-000000000001',
    repeat('d', 64),
    clock_timestamp() + interval '24 hours'
  );

  UPDATE public.checkout_attempts
  SET
    admitted_checkout_request_id = 'fb400000-0000-4000-8000-000000000001',
    admitted_replaces_checkout_intent_id = NULL,
    admitted_request_expires_at = clock_timestamp() - interval '1 second'
  WHERE id = 'fb300000-0000-4000-8000-000000000001';
END;
$fixture$;
SQL

(
  "${psql_command[@]}" >"${replacement_winner_output}" 2>&1 <<'SQL'
BEGIN;
SELECT admission_state
FROM public.admit_checkout_request_v1(
  'fb300000-0000-4000-8000-000000000001',
  'fb400000-0000-4000-8000-000000000002',
  NULL,
  repeat('a', 64),
  'cs_test_replacement_admission_concurrency_a'
);
SELECT pg_sleep(2);
COMMIT;
SQL
) &
replacement_winner_pid=$!

sleep 0.25

set +e
"${psql_command[@]}" >"${replacement_loser_output}" 2>&1 <<'SQL'
SELECT admission_state
FROM public.admit_checkout_request_v1(
  'fb300000-0000-4000-8000-000000000001',
  'fb400000-0000-4000-8000-000000000003',
  NULL,
  repeat('a', 64),
  'cs_test_replacement_admission_concurrency_a'
);
SQL
replacement_loser_status=$?
set -e

wait "${replacement_winner_pid}"

if ! grep -q 'admitted' "${replacement_winner_output}"; then
  echo 'Replacement admission concurrency test failed: no canonical winner.' >&2
  exit 1
fi

if [[ "${replacement_loser_status}" -eq 0 ]] ||
  ! grep -q 'unresolved admitted request' "${replacement_loser_output}"; then
  echo 'Replacement admission concurrency test failed: competing caller was not fenced.' >&2
  exit 1
fi

"${psql_command[@]}" >/dev/null <<'SQL'
DO $materialize_winner$
DECLARE
  v_initial_intent_id uuid;
BEGIN
  SELECT id
  INTO v_initial_intent_id
  FROM public.checkout_intents
  WHERE checkout_attempt_id = 'fb300000-0000-4000-8000-000000000001'
    AND checkout_request_id = 'fb400000-0000-4000-8000-000000000001';

  PERFORM *
  FROM public.prepare_checkout_request(
    'fb300000-0000-4000-8000-000000000001',
    'fb400000-0000-4000-8000-000000000002',
    NULL,
    repeat('a', 64),
    repeat('e', 64),
    v_initial_intent_id,
    'fb500000-0000-4000-8000-000000000002',
    clock_timestamp() + interval '29 minutes',
    jsonb_build_object(
      'customer_email', NULL,
      'subtotal_amount', 1000,
      'shipping_amount', 499,
      'total_amount', 1499,
      'currency', 'gbp',
      'shipping_method_name', 'Tracked',
      'shipping_method_id', 'fb100000-0000-4000-8000-000000000001',
      'shipping_rate_id', 'fb200000-0000-4000-8000-000000000001',
      'total_weight_grams', 100,
      'shipping_name', 'Test Customer',
      'shipping_address', '{}'::jsonb,
      'billing_name', 'Test Customer',
      'billing_address', '{}'::jsonb,
      'billing_is_different', false,
      'stripe_customer_id', NULL,
      'create_account_requested', false,
      'discount_code_id', NULL,
      'discount_code', NULL,
      'discount_amount', 0,
      'shipping_discount_amount', 0,
      'discount_name', NULL,
      'discount_type', NULL,
      'stripe_return_url', 'https://example.test/return'
    ),
    jsonb_build_array(jsonb_build_object(
      'product_type', 'product',
      'product_id', 'fb000000-0000-4000-8000-000000000001',
      'base_product_id', 'fb000000-0000-4000-8000-000000000001',
      'sku', 'REPLACEMENT-ADMISSION-CONCURRENCY',
      'name', 'Replacement admission concurrency product',
      'product_name', 'Replacement admission concurrency product',
      'variant_name', NULL,
      'quantity', 1,
      'unit_amount', 1000,
      'line_total', 1000,
      'weight_grams', 100,
      'image_url', NULL,
      'amount', NULL
    )),
    jsonb_build_array(jsonb_build_object(
      'shipping_method_id', 'fb100000-0000-4000-8000-000000000001',
      'shipping_rate_id', 'fb200000-0000-4000-8000-000000000001',
      'display_name', 'Tracked',
      'description', 'Tracked delivery',
      'carrier', 'Royal Mail',
      'amount', 499,
      'original_amount', 499,
      'currency', 'gbp'
    ))
  );
END;
$materialize_winner$;
SQL

replacement_counts="$({
  "${psql_command[@]}" -Atc "SELECT
    (SELECT count(*) FROM public.checkout_intents
      WHERE checkout_attempt_id = 'fb300000-0000-4000-8000-000000000001'),
    (SELECT count(*) FROM public.checkout_intents
      WHERE checkout_attempt_id = 'fb300000-0000-4000-8000-000000000001'
        AND replaces_checkout_intent_id IS NOT NULL),
    (SELECT count(*) FROM public.checkout_intents
      WHERE checkout_attempt_id = 'fb300000-0000-4000-8000-000000000001'
        AND stripe_checkout_session_id IS NOT NULL),
    (SELECT count(*) FROM public.inventory_reservations
      WHERE checkout_attempt_id = 'fb300000-0000-4000-8000-000000000001'),
    (SELECT count(*) FROM public.inventory_reservation_items AS items
      JOIN public.inventory_reservations AS reservations ON reservations.id = items.reservation_id
      WHERE reservations.checkout_attempt_id = 'fb300000-0000-4000-8000-000000000001'),
    (SELECT count(*) FROM public.checkout_attempts
      WHERE id = 'fb300000-0000-4000-8000-000000000001'
        AND admitted_checkout_request_id = 'fb400000-0000-4000-8000-000000000002');"
} | tr -d '[:space:]')"

if [[ "${replacement_counts}" != '2|1|1|1|1|1' ]]; then
  echo "Replacement admission concurrency test failed: lifecycle counts ${replacement_counts}." >&2
  exit 1
fi

echo 'Browser checkout admission concurrency test passed.'
