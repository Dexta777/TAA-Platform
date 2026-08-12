#!/usr/bin/env bash

set -euo pipefail

database_container="${SUPABASE_DB_CONTAINER:-supabase_db_TAA-Platform}"
test_directory="$(mktemp -d "${TMPDIR:-/tmp}/taa-inventory-concurrency.XXXXXX")"
first_output="${test_directory}/first.log"
second_output="${test_directory}/second.log"
psql_command=(
  docker exec -i "${database_container}"
  psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres
)

cleanup_fixtures() {
  "${psql_command[@]}" >/dev/null 2>&1 <<'SQL' || true
DELETE FROM public.inventory_reservations
WHERE checkout_attempt_id IN (
  '81000000-0000-0000-0000-000000000001',
  '81000000-0000-0000-0000-000000000002'
);

DELETE FROM public.checkout_intents
WHERE id IN (
  '82000000-0000-0000-0000-000000000001',
  '82000000-0000-0000-0000-000000000002'
);

DELETE FROM public.checkout_attempts
WHERE id IN (
  '81000000-0000-0000-0000-000000000001',
  '81000000-0000-0000-0000-000000000002'
);

DELETE FROM public.products
WHERE id = '80000000-0000-0000-0000-000000000001';
SQL
}

cleanup() {
  cleanup_fixtures
  rm -f "${first_output}" "${second_output}"
  rmdir "${test_directory}"
}

trap cleanup EXIT

cleanup_fixtures

"${psql_command[@]}" >/dev/null <<'SQL'
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
  '80000000-0000-0000-0000-000000000001',
  'Concurrency reservation product',
  'concurrency-reservation-product',
  'CONCURRENCY-RESERVATION-PRODUCT',
  10.00,
  1,
  true
);

ALTER TABLE public.products ENABLE TRIGGER sync_klaviyo_products_after_change;

SELECT *
FROM public.create_or_validate_checkout_attempt(
  '81000000-0000-0000-0000-000000000001',
  NULL,
  repeat('a', 64)
);

SELECT *
FROM public.create_or_validate_checkout_attempt(
  '81000000-0000-0000-0000-000000000002',
  NULL,
  repeat('b', 64)
);

INSERT INTO public.checkout_intents (
  id,
  status,
  subtotal_amount,
  shipping_amount,
  total_amount,
  currency
)
VALUES
  ('82000000-0000-0000-0000-000000000001', 'preparing', 1000, 499, 1499, 'gbp'),
  ('82000000-0000-0000-0000-000000000002', 'preparing', 1000, 499, 1499, 'gbp');

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
VALUES
  (
    '82000000-0000-0000-0000-000000000001',
    'product',
    '80000000-0000-0000-0000-000000000001',
    '80000000-0000-0000-0000-000000000001',
    'CONCURRENCY-RESERVATION-PRODUCT',
    'Concurrency reservation product',
    'Concurrency reservation product',
    1,
    1000,
    1000,
    100
  ),
  (
    '82000000-0000-0000-0000-000000000002',
    'product',
    '80000000-0000-0000-0000-000000000001',
    '80000000-0000-0000-0000-000000000001',
    'CONCURRENCY-RESERVATION-PRODUCT',
    'Concurrency reservation product',
    'Concurrency reservation product',
    1,
    1000,
    1000,
    100
  );
SQL

run_reservation() {
  local attempt_id="$1"
  local request_id="$2"
  local intent_id="$3"
  local fingerprint_character="$4"
  local output_file="$5"

  "${psql_command[@]}" >"${output_file}" 2>&1 <<SQL
BEGIN;
SELECT pg_sleep(1);
SELECT *
FROM public.reserve_checkout_inventory(
  '${attempt_id}',
  '${request_id}',
  '${intent_id}',
  repeat('${fingerprint_character}', 64),
  clock_timestamp() + interval '29 minutes'
);
COMMIT;
SQL
}

run_reservation \
  '81000000-0000-0000-0000-000000000001' \
  '83000000-0000-0000-0000-000000000001' \
  '82000000-0000-0000-0000-000000000001' \
  '1' \
  "${first_output}" &
first_pid=$!

run_reservation \
  '81000000-0000-0000-0000-000000000002' \
  '83000000-0000-0000-0000-000000000002' \
  '82000000-0000-0000-0000-000000000002' \
  '2' \
  "${second_output}" &
second_pid=$!

set +e
wait "${first_pid}"
first_status=$?
wait "${second_pid}"
second_status=$?
set -e

success_count=0
failure_output=""

if [[ ${first_status} -eq 0 ]]; then
  success_count=$((success_count + 1))
else
  failure_output="${first_output}"
fi

if [[ ${second_status} -eq 0 ]]; then
  success_count=$((success_count + 1))
else
  failure_output="${second_output}"
fi

if [[ ${success_count} -ne 1 ]]; then
  echo "Expected exactly one successful reservation; observed ${success_count}." >&2
  echo "First connection output:" >&2
  sed 's/^/  /' "${first_output}" >&2
  echo "Second connection output:" >&2
  sed 's/^/  /' "${second_output}" >&2
  exit 1
fi

if ! grep -q 'Insufficient available inventory for SKU CONCURRENCY-RESERVATION-PRODUCT.' "${failure_output}"; then
  echo 'The losing connection did not fail for insufficient available inventory.' >&2
  sed 's/^/  /' "${failure_output}" >&2
  exit 1
fi

final_state="$("${psql_command[@]}" -At <<'SQL'
SELECT concat_ws(
  '|',
  availability.on_hand_quantity,
  availability.reserved_quantity,
  availability.available_to_sell,
  (
    SELECT count(*)
    FROM public.inventory_reservations
    WHERE checkout_attempt_id IN (
      '81000000-0000-0000-0000-000000000001',
      '81000000-0000-0000-0000-000000000002'
    )
      AND status = 'held'
  )
)
FROM public.get_inventory_available_to_sell(
  '80000000-0000-0000-0000-000000000001',
  NULL
) AS availability;
SQL
)"

if [[ "${final_state}" != '1|1|0|1' ]]; then
  echo "Unexpected final inventory state: ${final_state}" >&2
  exit 1
fi

echo 'PASS: two independent connections produced one reservation and one insufficient-availability failure.'
echo 'PASS: on-hand=1, reserved=1, available-to-sell=0, held-reservations=1.'
