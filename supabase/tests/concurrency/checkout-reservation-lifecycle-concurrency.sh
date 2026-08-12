#!/usr/bin/env bash

set -euo pipefail

database_container="${SUPABASE_DB_CONTAINER:-supabase_db_TAA-Platform}"
test_directory="$(mktemp -d "${TMPDIR:-/tmp}/taa-checkout-lifecycle.XXXXXX")"
psql_command=(docker exec -i "${database_container}" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres)

cleanup() {
  "${psql_command[@]}" >/dev/null 2>&1 <<'SQL' || true
UPDATE public.checkout_attempts
SET active_checkout_intent_id = NULL, in_flight_checkout_intent_id = NULL
WHERE id::text LIKE 'c1000000-0000-4000-8000-00000000000%';
DELETE FROM public.checkout_reconciliation_jobs
WHERE checkout_attempt_id::text LIKE 'c1000000-0000-4000-8000-00000000000%';
DELETE FROM public.checkout_lifecycle_incidents
WHERE checkout_attempt_id::text LIKE 'c1000000-0000-4000-8000-00000000000%';
DELETE FROM public.inventory_reservations
WHERE checkout_attempt_id::text LIKE 'c1000000-0000-4000-8000-00000000000%';
DELETE FROM public.orders
WHERE checkout_attempt_id::text LIKE 'c1000000-0000-4000-8000-00000000000%';
DELETE FROM public.checkout_intents
WHERE checkout_attempt_id::text LIKE 'c1000000-0000-4000-8000-00000000000%';
DELETE FROM public.checkout_attempts
WHERE id::text LIKE 'c1000000-0000-4000-8000-00000000000%';
DROP FUNCTION IF EXISTS public.slice5c_concurrency_fixture(uuid, uuid, text);
DELETE FROM public.products WHERE id = 'c0000000-0000-4000-8000-000000000001';
SQL
  rm -f "${test_directory}"/*.log
  rmdir "${test_directory}"
}

trap cleanup EXIT
cleanup
test_directory="$(mktemp -d "${TMPDIR:-/tmp}/taa-checkout-lifecycle.XXXXXX")"
trap cleanup EXIT

"${psql_command[@]}" >/dev/null <<'SQL'
ALTER TABLE public.products DISABLE TRIGGER sync_klaviyo_products_after_change;
INSERT INTO public.products (id, name, slug, sku, price, inventory_quantity, active)
VALUES (
  'c0000000-0000-4000-8000-000000000001',
  'Slice 5C concurrency product',
  'slice-5c-concurrency-product',
  'SLICE-5C-CONCURRENCY',
  10.00,
  10,
  true
);
ALTER TABLE public.products ENABLE TRIGGER sync_klaviyo_products_after_change;

CREATE FUNCTION public.slice5c_concurrency_fixture(
  p_attempt_id uuid,
  p_intent_id uuid,
  p_session_id text
)
RETURNS void
LANGUAGE plpgsql
AS $function$
DECLARE
  v_now timestamp with time zone := clock_timestamp();
  v_reservation_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.checkout_attempts (
    id, capability_hash, capability_expires_at, hard_expires_at
  ) VALUES (
    p_attempt_id, repeat('a', 64), v_now + interval '90 minutes',
    v_now + interval '119 minutes'
  );
  INSERT INTO public.checkout_intents (
    id, payment_intent_id, stripe_checkout_session_id, status, customer_email,
    subtotal_amount, shipping_amount, total_amount, currency, checkout_attempt_id,
    checkout_request_id, command_fingerprint, checkout_protocol_version,
    orchestration_state, orchestration_updated_at, stripe_return_url,
    stripe_session_expires_at
  ) VALUES (
    p_intent_id, 'pi_' || replace(p_intent_id::text, '-', ''), p_session_id,
    'pending', 'concurrency@example.com', 1000, 0, 1000, 'gbp', p_attempt_id,
    p_intent_id, repeat('b', 64), 'reservation_v1', 'active', v_now,
    'https://example.com/checkout', date_trunc('second', v_now + interval '119 minutes')
  );
  INSERT INTO public.checkout_intent_items (
    checkout_intent_id, product_type, product_id, base_product_id, sku, name,
    product_name, quantity, unit_amount, line_total, weight_grams, line_position
  ) VALUES (
    p_intent_id, 'product', 'c0000000-0000-4000-8000-000000000001',
    'c0000000-0000-4000-8000-000000000001', 'SLICE-5C-CONCURRENCY',
    'Slice 5C concurrency product', 'Slice 5C concurrency product', 1, 1000,
    1000, 100, 0
  );
  UPDATE public.checkout_attempts SET active_checkout_intent_id = p_intent_id
  WHERE id = p_attempt_id;
  INSERT INTO public.inventory_reservations (
    id, checkout_attempt_id, status, reserved_at, expires_at
  ) VALUES (
    v_reservation_id, p_attempt_id, 'held', v_now, v_now + interval '29 minutes'
  );
  INSERT INTO public.inventory_reservation_items (
    reservation_id, product_id, sku_snapshot, quantity
  ) VALUES (
    v_reservation_id, 'c0000000-0000-4000-8000-000000000001',
    'SLICE-5C-CONCURRENCY', 1
  );
END;
$function$;

SELECT public.slice5c_concurrency_fixture(
  'c1000000-0000-4000-8000-000000000001',
  'c2000000-0000-4000-8000-000000000001',
  'cs_slice5c_race_finalizer_expiry'
);
SELECT public.slice5c_concurrency_fixture(
  'c1000000-0000-4000-8000-000000000002',
  'c2000000-0000-4000-8000-000000000002',
  'cs_slice5c_race_finalizer_reconciler'
);
SELECT public.slice5c_concurrency_fixture(
  'c1000000-0000-4000-8000-000000000003',
  'c2000000-0000-4000-8000-000000000003',
  'cs_slice5c_race_duplicate_finalizer'
);
SELECT public.slice5c_concurrency_fixture(
  'c1000000-0000-4000-8000-000000000004',
  'c2000000-0000-4000-8000-000000000004',
  'cs_slice5c_race_async_failure'
);
SQL

wait_until_blocked() {
  local blocked_name="$1"
  local blocker_name="$2"

  for _attempt in {1..100}; do
    if [[ "$("${psql_command[@]}" -Atc "SELECT count(*) FROM pg_stat_activity AS blocked JOIN pg_stat_activity AS blocker ON blocker.pid = ANY(pg_blocking_pids(blocked.pid)) WHERE blocked.application_name = '${blocked_name}' AND blocker.application_name = '${blocker_name}';")" == '1' ]]; then
      return 0
    fi
    sleep 0.05
  done

  echo "${blocked_name} was not observed waiting for ${blocker_name}." >&2
  return 1
}

run_finalize_first_race() {
  local suffix="$1"
  local attempt_id="$2"
  local session_id="$3"
  local payment_intent_id="$4"
  local terminal_reason="$5"
  local first_log="${test_directory}/${suffix}-first.log"
  local second_log="${test_directory}/${suffix}-second.log"

  "${psql_command[@]}" >"${first_log}" 2>&1 <<SQL &
BEGIN;
SET application_name = '${suffix}_finalizer';
SELECT id FROM public.checkout_attempts WHERE id = '${attempt_id}' FOR UPDATE;
SELECT pg_sleep(2);
SELECT * FROM public.finalize_paid_checkout('${session_id}', '${payment_intent_id}');
COMMIT;
SQL
  local first_pid=$!

  sleep 0.2
  "${psql_command[@]}" >"${second_log}" 2>&1 <<SQL &
SET application_name = '${suffix}_terminal';
SELECT * FROM public.transition_checkout_session_terminal('${session_id}', '${terminal_reason}');
SQL
  local second_pid=$!

  wait_until_blocked "${suffix}_terminal" "${suffix}_finalizer"
  wait "${first_pid}"
  wait "${second_pid}"

  local state
  state="$("${psql_command[@]}" -Atc "SELECT concat_ws('|', reservations.status, count(orders.id), count(incidents.id)) FROM public.inventory_reservations AS reservations LEFT JOIN public.orders AS orders ON orders.checkout_attempt_id = reservations.checkout_attempt_id LEFT JOIN public.checkout_lifecycle_incidents AS incidents ON incidents.checkout_attempt_id = reservations.checkout_attempt_id WHERE reservations.checkout_attempt_id = '${attempt_id}' GROUP BY reservations.status;")"

  if [[ "${state}" != 'consumed|1|0' ]]; then
    echo "${suffix} produced unexpected state: ${state}" >&2
    exit 1
  fi
}

run_finalize_first_race \
  'slice5c_expiry' \
  'c1000000-0000-4000-8000-000000000001' \
  'cs_slice5c_race_finalizer_expiry' \
  'pi_c2000000000040008000000000000001' \
  'expired_unpaid'
echo 'PASS: paid finalization versus expiry serialized to one consumed order.'

run_finalize_first_race \
  'slice5c_reconciler' \
  'c1000000-0000-4000-8000-000000000002' \
  'cs_slice5c_race_finalizer_reconciler' \
  'pi_c2000000000040008000000000000002' \
  'expired_unpaid'
echo 'PASS: paid finalization versus reconciler release serialized to one consumed order.'

"${psql_command[@]}" >"${test_directory}/duplicate-first.log" 2>&1 <<'SQL' &
BEGIN;
SET application_name = 'slice5c_duplicate_a';
SELECT id FROM public.checkout_attempts
WHERE id = 'c1000000-0000-4000-8000-000000000003' FOR UPDATE;
SELECT pg_sleep(2);
SELECT * FROM public.finalize_paid_checkout(
  'cs_slice5c_race_duplicate_finalizer',
  'pi_c2000000000040008000000000000003'
);
COMMIT;
SQL
duplicate_first_pid=$!
sleep 0.2
"${psql_command[@]}" >"${test_directory}/duplicate-second.log" 2>&1 <<'SQL' &
SET application_name = 'slice5c_duplicate_b';
SELECT finalization_outcome FROM public.finalize_paid_checkout(
  'cs_slice5c_race_duplicate_finalizer',
  'pi_c2000000000040008000000000000003'
);
SQL
duplicate_second_pid=$!
wait_until_blocked 'slice5c_duplicate_b' 'slice5c_duplicate_a'
wait "${duplicate_first_pid}"
wait "${duplicate_second_pid}"

duplicate_count="$("${psql_command[@]}" -Atc "SELECT count(*) FROM public.orders WHERE checkout_attempt_id = 'c1000000-0000-4000-8000-000000000003';")"
if [[ "${duplicate_count}" != '1' ]] || ! grep -q 'already_finalized' "${test_directory}/duplicate-second.log"; then
  echo 'Duplicate finalizers did not converge on one replay-safe order.' >&2
  exit 1
fi
echo 'PASS: duplicate finalizers converged on exactly one order.'

"${psql_command[@]}" >"${test_directory}/failure-first.log" 2>&1 <<'SQL' &
BEGIN;
SET application_name = 'slice5c_failure_a';
SELECT id FROM public.checkout_attempts
WHERE id = 'c1000000-0000-4000-8000-000000000004' FOR UPDATE;
SELECT pg_sleep(2);
SELECT * FROM public.transition_checkout_session_terminal(
  'cs_slice5c_race_async_failure',
  'async_payment_failed'
);
COMMIT;
SQL
failure_first_pid=$!
sleep 0.2
"${psql_command[@]}" >"${test_directory}/failure-second.log" 2>&1 <<'SQL' &
SET application_name = 'slice5c_failure_b';
SELECT * FROM public.finalize_paid_checkout(
  'cs_slice5c_race_async_failure',
  'pi_c2000000000040008000000000000004'
);
SQL
failure_second_pid=$!
wait_until_blocked 'slice5c_failure_b' 'slice5c_failure_a'
wait "${failure_first_pid}"
wait "${failure_second_pid}"

failure_state="$("${psql_command[@]}" -Atc "SELECT concat_ws('|', reservations.status, count(orders.id), count(incidents.id)) FROM public.inventory_reservations AS reservations LEFT JOIN public.orders AS orders ON orders.checkout_attempt_id = reservations.checkout_attempt_id LEFT JOIN public.checkout_lifecycle_incidents AS incidents ON incidents.checkout_attempt_id = reservations.checkout_attempt_id WHERE reservations.checkout_attempt_id = 'c1000000-0000-4000-8000-000000000004' GROUP BY reservations.status;")"
if [[ "${failure_state}" != 'released|0|1' ]] || ! grep -q 'manual_review_required' "${test_directory}/failure-second.log"; then
  echo "Async failure versus success produced unexpected state: ${failure_state}" >&2
  exit 1
fi
echo 'PASS: async failure versus success preserved release and recorded paid-after-release review.'
