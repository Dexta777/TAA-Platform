#!/usr/bin/env bash

set -euo pipefail

database_container="${SUPABASE_DB_CONTAINER:-supabase_db_TAA-Platform}"
test_directory="$(mktemp -d "${TMPDIR:-/tmp}/taa-inventory-concurrency.XXXXXX")"
first_output="${test_directory}/first.log"
second_output="${test_directory}/second.log"
reverse_first_output="${test_directory}/reverse-first.log"
reverse_second_output="${test_directory}/reverse-second.log"
first_input="${test_directory}/first.sql.fifo"
first_pid=''
second_pid=''
psql_command=(
  docker exec -i "${database_container}"
  psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres
)

cleanup_fixtures() {
  "${psql_command[@]}" >/dev/null 2>&1 <<'SQL' || true
DELETE FROM public.inventory_reservations
WHERE checkout_attempt_id IN (
  '81000000-0000-0000-0000-000000000001',
  '81000000-0000-0000-0000-000000000002',
  '81000000-0000-0000-0000-000000000003',
  '81000000-0000-0000-0000-000000000004'
);

DELETE FROM public.checkout_intents
WHERE id IN (
  '82000000-0000-0000-0000-000000000001',
  '82000000-0000-0000-0000-000000000002',
  '82000000-0000-0000-0000-000000000003',
  '82000000-0000-0000-0000-000000000004'
);

DELETE FROM public.checkout_attempts
WHERE id IN (
  '81000000-0000-0000-0000-000000000001',
  '81000000-0000-0000-0000-000000000002',
  '81000000-0000-0000-0000-000000000003',
  '81000000-0000-0000-0000-000000000004'
);

DELETE FROM public.product_variants
WHERE id = '80000000-0000-0000-0000-000000000003';

DELETE FROM public.products
WHERE id IN (
  '80000000-0000-0000-0000-000000000001',
  '80000000-0000-0000-0000-000000000002'
);
SQL
}

cleanup() {
  exec 3>&- || true

  if [[ -n "${first_pid}" ]] && kill -0 "${first_pid}" 2>/dev/null; then
    kill "${first_pid}" 2>/dev/null || true
    wait "${first_pid}" 2>/dev/null || true
  fi

  if [[ -n "${second_pid}" ]] && kill -0 "${second_pid}" 2>/dev/null; then
    kill "${second_pid}" 2>/dev/null || true
    wait "${second_pid}" 2>/dev/null || true
  fi

  cleanup_fixtures
  rm -f "${first_output}" "${second_output}" "${reverse_first_output}" \
    "${reverse_second_output}" "${first_input}"
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

wait_for_database_condition() {
  local condition_sql="$1"
  local failure_message="$2"
  local attempts=100

  for ((attempt = 1; attempt <= attempts; attempt += 1)); do
    if [[ "$("${psql_command[@]}" -Atc "${condition_sql}")" == '1' ]]; then
      return 0
    fi

    sleep 0.1
  done

  echo "${failure_message}" >&2
  return 1
}

mkfifo "${first_input}"
exec 3<>"${first_input}"

"${psql_command[@]}" <"${first_input}" >"${first_output}" 2>&1 &
first_pid=$!

printf '%s\n' "
BEGIN;
SET application_name = 'taa_inventory_concurrency_a';
SELECT *
FROM public.reserve_checkout_inventory(
  '81000000-0000-0000-0000-000000000001',
  '83000000-0000-0000-0000-000000000001',
  '82000000-0000-0000-0000-000000000001',
  repeat('1', 64),
  clock_timestamp() + interval '29 minutes'
);
" >&3

wait_for_database_condition \
  "SELECT count(*) FROM pg_stat_activity WHERE application_name = 'taa_inventory_concurrency_a' AND state = 'idle in transaction' AND xact_start IS NOT NULL;" \
  'Connection A did not complete its reservation while remaining uncommitted.'

echo 'PASS: connection A reserved the final unit and is idle in an open, uncommitted transaction.'

"${psql_command[@]}" >"${second_output}" 2>&1 <<'SQL' &
BEGIN;
SET application_name = 'taa_inventory_concurrency_b';
SELECT *
FROM public.reserve_checkout_inventory(
  '81000000-0000-0000-0000-000000000002',
  '83000000-0000-0000-0000-000000000002',
  '82000000-0000-0000-0000-000000000002',
  repeat('2', 64),
  clock_timestamp() + interval '29 minutes'
);
COMMIT;
SQL
second_pid=$!

wait_for_database_condition \
  "SELECT count(*) FROM pg_stat_activity AS blocked JOIN pg_stat_activity AS blocker ON blocker.pid = ANY(pg_blocking_pids(blocked.pid)) WHERE blocked.application_name = 'taa_inventory_concurrency_b' AND blocker.application_name = 'taa_inventory_concurrency_a' AND blocked.wait_event_type = 'Lock' AND blocked.query LIKE '%reserve_checkout_inventory%';" \
  'Connection B was not observed waiting on connection A during inventory reservation.'

if ! kill -0 "${second_pid}" 2>/dev/null; then
  echo 'Connection B completed before connection A committed.' >&2
  sed 's/^/  /' "${second_output}" >&2
  exit 1
fi

echo 'PASS: connection B is blocked on connection A while A holds the catalogue row lock uncommitted.'

printf '%s\n' 'COMMIT;' '\q' >&3
exec 3>&-

set +e
wait "${first_pid}"
first_status=$?
first_pid=''
wait "${second_pid}"
second_status=$?
second_pid=''
set -e

if [[ ${first_status} -ne 0 ]]; then
  echo 'Connection A failed instead of committing its reservation.' >&2
  sed 's/^/  /' "${first_output}" >&2
  exit 1
fi

if [[ ${second_status} -eq 0 ]]; then
  echo 'Connection B unexpectedly reserved inventory after connection A committed.' >&2
  sed 's/^/  /' "${second_output}" >&2
  exit 1
fi

if ! grep -Fq 'ERROR:  Checkout inventory conflict.' "${second_output}" ||
  ! grep -Fq '"sku": "CONCURRENCY-RESERVATION-PRODUCT", "reason": "temporarily_reserved"' "${second_output}"; then
  echo 'Connection B did not return the typed temporary inventory conflict after A committed.' >&2
  sed 's/^/  /' "${second_output}" >&2
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

echo 'PASS: after connection A committed, connection B resumed with the typed temporary conflict.'
echo 'PASS: on-hand=1, reserved=1, available-to-sell=0, held-reservations=1.'

"${psql_command[@]}" >/dev/null <<'SQL'
ALTER TABLE public.products DISABLE TRIGGER sync_klaviyo_products_after_change;
ALTER TABLE public.product_variants DISABLE TRIGGER sync_klaviyo_variants_after_change;

INSERT INTO public.products (id, name, slug, sku, price, inventory_quantity, active)
VALUES (
  '80000000-0000-0000-0000-000000000002',
  'Reverse-order product',
  'reverse-order-product',
  'REVERSE-ORDER-PRODUCT',
  10.00,
  1,
  true
);

INSERT INTO public.product_variants (
  id, product_id, variant_name, variant_sku, price, inventory_quantity, active
)
VALUES (
  '80000000-0000-0000-0000-000000000003',
  '80000000-0000-0000-0000-000000000002',
  'Reverse variant',
  'REVERSE-ORDER-VARIANT',
  10.00,
  1,
  true
);

ALTER TABLE public.products ENABLE TRIGGER sync_klaviyo_products_after_change;
ALTER TABLE public.product_variants ENABLE TRIGGER sync_klaviyo_variants_after_change;

SELECT * FROM public.create_or_validate_checkout_attempt(
  '81000000-0000-0000-0000-000000000003', NULL, repeat('c', 64)
);
SELECT * FROM public.create_or_validate_checkout_attempt(
  '81000000-0000-0000-0000-000000000004', NULL, repeat('d', 64)
);

INSERT INTO public.checkout_intents (
  id, status, subtotal_amount, shipping_amount, total_amount, currency
)
VALUES
  ('82000000-0000-0000-0000-000000000003', 'preparing', 2000, 499, 2499, 'gbp'),
  ('82000000-0000-0000-0000-000000000004', 'preparing', 2000, 499, 2499, 'gbp');

INSERT INTO public.checkout_intent_items (
  checkout_intent_id, product_type, product_id, base_product_id, sku, name, product_name,
  quantity, unit_amount, line_total, weight_grams, line_position
)
VALUES
  (
    '82000000-0000-0000-0000-000000000003', 'product',
    '80000000-0000-0000-0000-000000000002', '80000000-0000-0000-0000-000000000002',
    'REVERSE-ORDER-PRODUCT', 'Reverse-order product', 'Reverse-order product',
    1, 1000, 1000, 100, 0
  ),
  (
    '82000000-0000-0000-0000-000000000003', 'variant',
    '80000000-0000-0000-0000-000000000003', '80000000-0000-0000-0000-000000000002',
    'REVERSE-ORDER-VARIANT', 'Reverse variant', 'Reverse-order product',
    1, 1000, 1000, 100, 1
  ),
  (
    '82000000-0000-0000-0000-000000000004', 'variant',
    '80000000-0000-0000-0000-000000000003', '80000000-0000-0000-0000-000000000002',
    'REVERSE-ORDER-VARIANT', 'Reverse variant', 'Reverse-order product',
    1, 1000, 1000, 100, 0
  ),
  (
    '82000000-0000-0000-0000-000000000004', 'product',
    '80000000-0000-0000-0000-000000000002', '80000000-0000-0000-0000-000000000002',
    'REVERSE-ORDER-PRODUCT', 'Reverse-order product', 'Reverse-order product',
    1, 1000, 1000, 100, 1
  );
SQL

"${psql_command[@]}" >"${reverse_first_output}" 2>&1 <<'SQL' &
BEGIN;
SET application_name = 'taa_inventory_reverse_order_a';
SELECT * FROM public.reserve_checkout_inventory(
  '81000000-0000-0000-0000-000000000003',
  '83000000-0000-0000-0000-000000000003',
  '82000000-0000-0000-0000-000000000003',
  repeat('3', 64),
  clock_timestamp() + interval '29 minutes'
);
SELECT pg_sleep(2);
COMMIT;
SQL
first_pid=$!

wait_for_database_condition \
  "SELECT count(*) FROM pg_stat_activity WHERE application_name = 'taa_inventory_reverse_order_a' AND wait_event = 'PgSleep';" \
  'Reverse-order connection A did not acquire both resource locks before waiting.'

"${psql_command[@]}" >"${reverse_second_output}" 2>&1 <<'SQL' &
BEGIN;
SET application_name = 'taa_inventory_reverse_order_b';
SELECT * FROM public.reserve_checkout_inventory(
  '81000000-0000-0000-0000-000000000004',
  '83000000-0000-0000-0000-000000000004',
  '82000000-0000-0000-0000-000000000004',
  repeat('4', 64),
  clock_timestamp() + interval '29 minutes'
);
COMMIT;
SQL
second_pid=$!

set +e
wait "${first_pid}"
first_status=$?
first_pid=''
wait "${second_pid}"
second_status=$?
second_pid=''
set -e

if [[ ${first_status} -ne 0 || ${second_status} -eq 0 ]]; then
  echo 'Reverse-order product/variant concurrency did not produce one winner and one loser.' >&2
  sed 's/^/  A: /' "${reverse_first_output}" >&2
  sed 's/^/  B: /' "${reverse_second_output}" >&2
  exit 1
fi

if grep -Fq 'deadlock detected' "${reverse_first_output}" ||
  grep -Fq 'deadlock detected' "${reverse_second_output}"; then
  echo 'Reverse-order product/variant baskets deadlocked.' >&2
  exit 1
fi

if ! grep -Fq 'REVERSE-ORDER-VARIANT' "${reverse_second_output}" ||
  ! grep -Fq 'REVERSE-ORDER-PRODUCT' "${reverse_second_output}"; then
  echo 'Reverse-order loser did not receive both deterministic inventory conflicts.' >&2
  sed 's/^/  /' "${reverse_second_output}" >&2
  exit 1
fi

reverse_state="$("${psql_command[@]}" -At <<'SQL'
SELECT concat_ws(
  '|',
  (SELECT count(*) FROM public.inventory_reservations
    WHERE checkout_attempt_id IN (
      '81000000-0000-0000-0000-000000000003',
      '81000000-0000-0000-0000-000000000004'
    ) AND status = 'held'),
  (SELECT count(*) FROM public.inventory_reservation_items AS items
    JOIN public.inventory_reservations AS reservations ON reservations.id = items.reservation_id
    WHERE reservations.checkout_attempt_id = '81000000-0000-0000-0000-000000000003'),
  (SELECT count(*) FROM public.inventory_reservations
    WHERE checkout_attempt_id = '81000000-0000-0000-0000-000000000004')
);
SQL
)"

if [[ "${reverse_state}" != '1|2|0' ]]; then
  echo "Unexpected reverse-order final state: ${reverse_state}" >&2
  exit 1
fi

echo 'PASS: opposite product/variant submission order completed without deadlock.'
echo 'PASS: reverse-order concurrency produced one complete reservation and one zero-reservation conflict.'
