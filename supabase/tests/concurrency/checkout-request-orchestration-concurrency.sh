#!/usr/bin/env bash

set -euo pipefail

database_container="${SUPABASE_DB_CONTAINER:-supabase_db_TAA-Platform}"
test_directory="$(mktemp -d "${TMPDIR:-/tmp}/taa-checkout-orchestration.XXXXXX")"
first_output="${test_directory}/first.log"
second_output="${test_directory}/second.log"
third_output="${test_directory}/third.log"
psql_command=(
  docker exec -i "${database_container}"
  psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres
)

cleanup_fixtures() {
  "${psql_command[@]}" >/dev/null 2>&1 <<'SQL' || true
UPDATE public.checkout_attempts
SET
  active_checkout_intent_id = NULL,
  in_flight_checkout_intent_id = NULL
WHERE id IN (
  'a1000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000002',
  'a1000000-0000-4000-8000-000000000003'
);

DELETE FROM public.inventory_reservations
WHERE checkout_attempt_id IN (
  'a1000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000002',
  'a1000000-0000-4000-8000-000000000003'
);

DELETE FROM public.checkout_intents
WHERE checkout_attempt_id IN (
  'a1000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000002',
  'a1000000-0000-4000-8000-000000000003'
);

DELETE FROM public.checkout_attempts
WHERE id IN (
  'a1000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000002',
  'a1000000-0000-4000-8000-000000000003'
);

DELETE FROM public.shipping_rates
WHERE id = 'a3000000-0000-4000-8000-000000000001';

DELETE FROM public.shipping_methods
WHERE id = 'a2000000-0000-4000-8000-000000000001';

DELETE FROM public.products
WHERE id = 'a0000000-0000-4000-8000-000000000001';
SQL
}

cleanup() {
  cleanup_fixtures
  rm -f "${first_output}" "${second_output}" "${third_output}"
  rmdir "${test_directory}"
}

trap cleanup EXIT

cleanup_fixtures

"${psql_command[@]}" >/dev/null <<'SQL'
ALTER TABLE public.products DISABLE TRIGGER sync_klaviyo_products_after_change;

INSERT INTO public.products (
  id, name, slug, sku, price, inventory_quantity, active, weight_grams
)
VALUES (
  'a0000000-0000-4000-8000-000000000001',
  'Orchestration concurrency product',
  'orchestration-concurrency-product',
  'ORCHESTRATION-CONCURRENCY',
  10.00,
  3,
  true,
  100
);

ALTER TABLE public.products ENABLE TRIGGER sync_klaviyo_products_after_change;

INSERT INTO public.shipping_methods (
  id, name, description, carrier, active, sort_order
)
VALUES (
  'a2000000-0000-4000-8000-000000000001',
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
  'a3000000-0000-4000-8000-000000000001',
  'a2000000-0000-4000-8000-000000000001',
  0,
  10000,
  4.99,
  'GBP',
  true
);
SQL

prepare_request_sql() {
  local attempt_id="$1"
  local request_id="$2"
  local capability_character="$3"
  local fingerprint_character="$4"
  local replacement_intent_id="$5"
  local worker_id="$6"

  local replacement_sql='NULL'

  if [[ -n "${replacement_intent_id}" ]]; then
    replacement_sql="'${replacement_intent_id}'::uuid"
  fi

  printf '%s' "SELECT checkout_intent_id, request_replayed
FROM public.prepare_checkout_request(
  '${attempt_id}',
  '${request_id}',
  NULL,
  repeat('${capability_character}', 64),
  repeat('${fingerprint_character}', 64),
  ${replacement_sql},
  '${worker_id}',
  clock_timestamp() + interval '29 minutes',
  jsonb_build_object(
    'subtotal_amount', 1000,
    'shipping_amount', 499,
    'total_amount', 1499,
    'currency', 'gbp',
    'shipping_method_name', 'Tracked',
    'shipping_method_id', 'a2000000-0000-4000-8000-000000000001',
    'shipping_rate_id', 'a3000000-0000-4000-8000-000000000001',
    'total_weight_grams', 100,
    'shipping_address', '{}'::jsonb,
    'billing_address', '{}'::jsonb,
    'billing_is_different', false,
    'create_account_requested', false,
    'discount_amount', 0,
    'shipping_discount_amount', 0,
    'stripe_return_url', 'https://example.test/return'
  ),
  jsonb_build_array(jsonb_build_object(
    'product_type', 'product',
    'product_id', 'a0000000-0000-4000-8000-000000000001',
    'base_product_id', 'a0000000-0000-4000-8000-000000000001',
    'sku', 'ORCHESTRATION-CONCURRENCY',
    'name', 'Orchestration concurrency product',
    'product_name', 'Orchestration concurrency product',
    'quantity', 1,
    'unit_amount', 1000,
    'line_total', 1000,
    'weight_grams', 100
  )),
  jsonb_build_array(jsonb_build_object(
    'shipping_method_id', 'a2000000-0000-4000-8000-000000000001',
    'shipping_rate_id', 'a3000000-0000-4000-8000-000000000001',
    'display_name', 'Tracked',
    'amount', 499,
    'original_amount', 499,
    'currency', 'gbp'
  ))
);"
}

wait_for_database_condition() {
  local condition_sql="$1"
  local failure_message="$2"

  for _attempt in {1..100}; do
    if [[ "$("${psql_command[@]}" -Atc "${condition_sql}")" == '1' ]]; then
      return 0
    fi

    sleep 0.05
  done

  echo "${failure_message}" >&2
  return 1
}

identical_sql="$(prepare_request_sql \
  'a1000000-0000-4000-8000-000000000001' \
  'a4000000-0000-4000-8000-000000000001' \
  'a' \
  '1' \
  '' \
  'a5000000-0000-4000-8000-000000000001')"

"${psql_command[@]}" >"${first_output}" 2>&1 <<SQL &
BEGIN;
SET application_name = 'taa_orchestration_identical_a';
SELECT * FROM public.create_or_validate_checkout_attempt(
  'a1000000-0000-4000-8000-000000000001', NULL, repeat('a', 64)
);
${identical_sql}
SELECT pg_sleep(3);
COMMIT;
SQL
first_pid=$!

wait_for_database_condition \
  "SELECT count(*) FROM pg_stat_activity WHERE application_name = 'taa_orchestration_identical_a' AND state = 'active' AND query LIKE 'SELECT pg_sleep%';" \
  'Identical connection A did not reach its post-prepare uncommitted hold.'

"${psql_command[@]}" >"${second_output}" 2>&1 <<SQL &
SET application_name = 'taa_orchestration_identical_b';
$(prepare_request_sql \
  'a1000000-0000-4000-8000-000000000001' \
  'a4000000-0000-4000-8000-000000000001' \
  'a' \
  '1' \
  '' \
  'a5000000-0000-4000-8000-000000000002')
SQL
second_pid=$!

wait_for_database_condition \
  "SELECT count(*) FROM pg_stat_activity AS blocked JOIN pg_stat_activity AS blocker ON blocker.pid = ANY(pg_blocking_pids(blocked.pid)) WHERE blocked.application_name = 'taa_orchestration_identical_b' AND blocker.application_name = 'taa_orchestration_identical_a' AND blocked.wait_event_type = 'Lock';" \
  'Identical connection B was not observed waiting for A to commit.'

echo 'PASS: identical request B waited on uncommitted request A before replaying it.'

wait "${first_pid}"
wait "${second_pid}"

identical_state="$("${psql_command[@]}" -At <<'SQL'
SELECT concat_ws(
  '|',
  count(*),
  count(DISTINCT attempts.in_flight_checkout_intent_id),
  (SELECT count(*) FROM public.inventory_reservations
   WHERE checkout_attempt_id = 'a1000000-0000-4000-8000-000000000001')
)
FROM public.checkout_intents AS intents
JOIN public.checkout_attempts AS attempts ON attempts.id = intents.checkout_attempt_id
WHERE intents.checkout_attempt_id = 'a1000000-0000-4000-8000-000000000001';
SQL
)"

if [[ "${identical_state}" != '1|1|1' ]]; then
  echo "Identical prepare race produced unexpected state: ${identical_state}" >&2
  exit 1
fi

if ! grep -q '| t' "${second_output}"; then
  echo 'The second identical prepare did not replay the first logical request.' >&2
  sed 's/^/  /' "${second_output}" >&2
  exit 1
fi

echo 'PASS: two identical prepares resolved to one logical request, one reservation, and one in-flight pointer.'

"${psql_command[@]}" >/dev/null <<'SQL'
SELECT * FROM public.resolve_checkout_request_context(
  'a1000000-0000-4000-8000-000000000002',
  'a4000000-0000-4000-8000-000000000010',
  NULL,
  repeat('b', 64),
  NULL
);

WITH prepared AS (
  SELECT * FROM public.prepare_checkout_request(
    'a1000000-0000-4000-8000-000000000002',
    'a4000000-0000-4000-8000-000000000010',
    NULL,
    repeat('b', 64),
    repeat('2', 64),
    NULL,
    'a5000000-0000-4000-8000-000000000010',
    clock_timestamp() + interval '29 minutes',
    jsonb_build_object(
      'subtotal_amount', 1000,
      'shipping_amount', 499,
      'total_amount', 1499,
      'currency', 'gbp',
      'shipping_method_name', 'Tracked',
      'shipping_method_id', 'a2000000-0000-4000-8000-000000000001',
      'shipping_rate_id', 'a3000000-0000-4000-8000-000000000001',
      'total_weight_grams', 100,
      'shipping_address', '{}'::jsonb,
      'billing_address', '{}'::jsonb,
      'billing_is_different', false,
      'create_account_requested', false,
      'discount_amount', 0,
      'shipping_discount_amount', 0,
      'stripe_return_url', 'https://example.test/return'
    ),
    jsonb_build_array(jsonb_build_object(
      'product_type', 'product',
      'product_id', 'a0000000-0000-4000-8000-000000000001',
      'base_product_id', 'a0000000-0000-4000-8000-000000000001',
      'sku', 'ORCHESTRATION-CONCURRENCY',
      'name', 'Orchestration concurrency product',
      'product_name', 'Orchestration concurrency product',
      'quantity', 1,
      'unit_amount', 1000,
      'line_total', 1000,
      'weight_grams', 100
    )),
    jsonb_build_array(jsonb_build_object(
      'shipping_method_id', 'a2000000-0000-4000-8000-000000000001',
      'shipping_rate_id', 'a3000000-0000-4000-8000-000000000001',
      'display_name', 'Tracked',
      'amount', 499,
      'original_amount', 499,
      'currency', 'gbp'
    ))
  )
)
UPDATE public.checkout_intents AS intents
SET
  orchestration_state = 'active',
  status = 'pending',
  stripe_checkout_session_id = 'cs_test_orchestration_active',
  stripe_session_params_hash = repeat('3', 64)
FROM prepared
WHERE intents.id = prepared.checkout_intent_id;

UPDATE public.checkout_attempts
SET
  active_checkout_intent_id = in_flight_checkout_intent_id,
  in_flight_checkout_intent_id = NULL
WHERE id = 'a1000000-0000-4000-8000-000000000002';
SQL

active_intent_id="$("${psql_command[@]}" -Atc "SELECT active_checkout_intent_id FROM public.checkout_attempts WHERE id = 'a1000000-0000-4000-8000-000000000002';")"

replacement_b_sql="$(prepare_request_sql \
  'a1000000-0000-4000-8000-000000000002' \
  'a4000000-0000-4000-8000-000000000011' \
  'b' \
  '4' \
  "${active_intent_id}" \
  'a5000000-0000-4000-8000-000000000011')"

replacement_c_sql="$(prepare_request_sql \
  'a1000000-0000-4000-8000-000000000002' \
  'a4000000-0000-4000-8000-000000000012' \
  'b' \
  '5' \
  "${active_intent_id}" \
  'a5000000-0000-4000-8000-000000000012')"

"${psql_command[@]}" >"${second_output}" 2>&1 <<SQL &
BEGIN;
SET application_name = 'taa_orchestration_branch_b';
${replacement_b_sql}
SELECT pg_sleep(3);
COMMIT;
SQL
second_pid=$!

wait_for_database_condition \
  "SELECT count(*) FROM pg_stat_activity WHERE application_name = 'taa_orchestration_branch_b' AND state = 'active' AND query LIKE 'SELECT pg_sleep%';" \
  'Replacement B did not reach its post-prepare uncommitted hold.'

"${psql_command[@]}" >"${third_output}" 2>&1 <<SQL &
SET application_name = 'taa_orchestration_branch_c';
${replacement_c_sql}
SQL
third_pid=$!

wait_for_database_condition \
  "SELECT count(*) FROM pg_stat_activity AS blocked JOIN pg_stat_activity AS blocker ON blocker.pid = ANY(pg_blocking_pids(blocked.pid)) WHERE blocked.application_name = 'taa_orchestration_branch_c' AND blocker.application_name = 'taa_orchestration_branch_b' AND blocked.wait_event_type = 'Lock';" \
  'Replacement C was not observed waiting for uncommitted replacement B.'

echo 'PASS: replacement C waited for uncommitted replacement B before branch validation.'

wait "${second_pid}"

set +e
wait "${third_pid}"
third_status=$?
set -e

if [[ ${third_status} -eq 0 ]]; then
  echo 'Replacement C unexpectedly established a second in-flight branch from A.' >&2
  exit 1
fi

if ! grep -q 'Checkout attempt already has an unresolved operation.' "${third_output}"; then
  echo 'Replacement C failed for an unexpected reason.' >&2
  sed 's/^/  /' "${third_output}" >&2
  exit 1
fi

branch_state="$("${psql_command[@]}" -Atc "SELECT concat_ws('|', count(*), count(DISTINCT attempts.in_flight_checkout_intent_id)) FROM public.checkout_intents AS intents JOIN public.checkout_attempts AS attempts ON attempts.id = intents.checkout_attempt_id WHERE intents.checkout_attempt_id = 'a1000000-0000-4000-8000-000000000002' AND intents.replaces_checkout_intent_id = '${active_intent_id}';")"

if [[ "${branch_state}" != '1|1' ]]; then
  echo "Replacement race produced unexpected branching state: ${branch_state}" >&2
  exit 1
fi

echo 'PASS: racing replacement B and C from active A established only one durable in-flight branch.'

"${psql_command[@]}" >/dev/null <<'SQL'
SELECT admission_state
FROM public.admit_checkout_request_v1(
  'a1000000-0000-4000-8000-000000000003',
  'a4000000-0000-4000-8000-000000000020',
  NULL,
  repeat('c', 64),
  NULL
);
SQL

"${psql_command[@]}" >/dev/null <<SQL
$(prepare_request_sql \
  'a1000000-0000-4000-8000-000000000003' \
  'a4000000-0000-4000-8000-000000000020' \
  'c' \
  '6' \
  '' \
  'a5000000-0000-4000-8000-000000000020')
SQL

lease_intent_id="$("${psql_command[@]}" -Atc "SELECT in_flight_checkout_intent_id FROM public.checkout_attempts WHERE id = 'a1000000-0000-4000-8000-000000000003';")"

"${psql_command[@]}" >/dev/null <<SQL
SELECT *
FROM public.begin_checkout_session_creation(
  '${lease_intent_id}',
  'a5000000-0000-4000-8000-000000000020',
  repeat('7', 64)
);

SELECT public.record_checkout_session(
  '${lease_intent_id}',
  'a5000000-0000-4000-8000-000000000020',
  'cs_test_orchestration_lease_release',
  (SELECT stripe_session_expires_at FROM public.checkout_intents WHERE id = '${lease_intent_id}'),
  '[{"position":0,"stripe_shipping_rate_id":"shr_lease_release"}]'::jsonb
);

SELECT public.activate_checkout_request(
  '${lease_intent_id}',
  'a5000000-0000-4000-8000-000000000020',
  repeat('8', 64),
  clock_timestamp() + interval '24 hours'
);
SQL

activation_state="$("${psql_command[@]}" -Atc "SELECT concat_ws('|', orchestration_state, status, worker_lease_id IS NULL, worker_lease_expires_at IS NULL) FROM public.checkout_intents WHERE id = '${lease_intent_id}';")"

if [[ "${activation_state}" != 'active|pending|t|t' ]]; then
  echo "Completed activation retained unsafe worker state: ${activation_state}" >&2
  exit 1
fi

echo 'PASS: completed activation published one active Session and released its creation-worker lease.'

"${psql_command[@]}" >"${first_output}" 2>&1 <<SQL &
BEGIN;
SET application_name = 'taa_orchestration_resume_a';
SELECT resume_state, checkout_intent_id, checkout_session_id, worker_lease_acquired
FROM public.resume_checkout_request_v1(
  'a1000000-0000-4000-8000-000000000003',
  'a4000000-0000-4000-8000-000000000020',
  NULL,
  repeat('c', 64),
  'a5000000-0000-4000-8000-000000000021'
);
SELECT pg_sleep(3);
COMMIT;
SQL
first_pid=$!

wait_for_database_condition \
  "SELECT count(*) FROM pg_stat_activity WHERE application_name = 'taa_orchestration_resume_a' AND state = 'active' AND query LIKE 'SELECT pg_sleep%';" \
  'Recovery worker A did not reach its post-resume uncommitted hold.'

"${psql_command[@]}" >"${second_output}" 2>&1 <<'SQL' &
SET application_name = 'taa_orchestration_resume_b';
SELECT resume_state, checkout_intent_id, checkout_session_id, worker_lease_acquired
FROM public.resume_checkout_request_v1(
  'a1000000-0000-4000-8000-000000000003',
  'a4000000-0000-4000-8000-000000000020',
  NULL,
  repeat('c', 64),
  'a5000000-0000-4000-8000-000000000022'
);
SQL
second_pid=$!

wait_for_database_condition \
  "SELECT count(*) FROM pg_stat_activity AS blocked JOIN pg_stat_activity AS blocker ON blocker.pid = ANY(pg_blocking_pids(blocked.pid)) WHERE blocked.application_name = 'taa_orchestration_resume_b' AND blocker.application_name = 'taa_orchestration_resume_a' AND blocked.wait_event_type = 'Lock';" \
  'Recovery worker B was not observed waiting for uncommitted recovery worker A.'

echo 'PASS: recovery worker B waited for worker A before observing lease ownership.'

wait "${first_pid}"
wait "${second_pid}"

if ! grep -q 'resumable' "${first_output}"; then
  echo 'Recovery worker A did not acquire the completed activation.' >&2
  sed 's/^/  /' "${first_output}" >&2
  exit 1
fi

if ! grep -q 'operation_in_progress' "${second_output}"; then
  echo 'Recovery worker B did not remain fenced behind worker A.' >&2
  sed 's/^/  /' "${second_output}" >&2
  exit 1
fi

lease_race_state="$("${psql_command[@]}" -Atc "SELECT concat_ws('|', count(*), count(DISTINCT stripe_checkout_session_id), (SELECT count(*) FROM public.inventory_reservations WHERE checkout_attempt_id = 'a1000000-0000-4000-8000-000000000003'), bool_and(worker_lease_id = 'a5000000-0000-4000-8000-000000000021')) FROM public.checkout_intents WHERE checkout_attempt_id = 'a1000000-0000-4000-8000-000000000003';")"

if [[ "${lease_race_state}" != '1|1|1|t' ]]; then
  echo "Concurrent resume produced unexpected lifecycle ownership: ${lease_race_state}" >&2
  exit 1
fi

"${psql_command[@]}" >/dev/null <<SQL
SELECT public.rotate_checkout_confirmation_capability(
  '${lease_intent_id}',
  'a5000000-0000-4000-8000-000000000021',
  repeat('9', 64),
  clock_timestamp() + interval '24 hours'
);
SQL

completed_state="$("${psql_command[@]}" -Atc "SELECT concat_ws('|', worker_lease_id IS NULL, worker_lease_expires_at IS NULL, confirmation_generation) FROM public.checkout_intents WHERE id = '${lease_intent_id}';")"

if [[ "${completed_state}" != 't|t|2' ]]; then
  echo "Completed recovery retained unsafe worker state: ${completed_state}" >&2
  exit 1
fi

echo 'PASS: racing recovery workers retained one Session and reservation; completed rotation released the winning lease.'
