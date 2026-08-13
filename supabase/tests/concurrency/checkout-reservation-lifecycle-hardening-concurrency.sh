#!/usr/bin/env bash

set -euo pipefail

database_container="${SUPABASE_DB_CONTAINER:-supabase_db_TAA-Platform}"
test_directory="$(mktemp -d "${TMPDIR:-/tmp}/taa-checkout-lifecycle-hardening.XXXXXX")"
psql_command=(docker exec -i "${database_container}" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres)

cleanup() {
  "${psql_command[@]}" >/dev/null 2>&1 <<'SQL' || true
UPDATE public.checkout_attempts
SET active_checkout_intent_id = NULL, in_flight_checkout_intent_id = NULL
WHERE id::text LIKE 'e1000000-0000-4000-8000-00000000000%';
DELETE FROM public.checkout_reconciliation_jobs
WHERE checkout_attempt_id::text LIKE 'e1000000-0000-4000-8000-00000000000%';
DELETE FROM public.checkout_lifecycle_incidents
WHERE checkout_attempt_id::text LIKE 'e1000000-0000-4000-8000-00000000000%';
DELETE FROM public.inventory_reservations
WHERE checkout_attempt_id::text LIKE 'e1000000-0000-4000-8000-00000000000%';
DELETE FROM public.orders
WHERE checkout_attempt_id::text LIKE 'e1000000-0000-4000-8000-00000000000%';
DELETE FROM public.checkout_intents
WHERE checkout_attempt_id::text LIKE 'e1000000-0000-4000-8000-00000000000%';
DELETE FROM public.checkout_attempts
WHERE id::text LIKE 'e1000000-0000-4000-8000-00000000000%';
DROP FUNCTION IF EXISTS public.slice5c1_replacement_fixture(uuid, uuid, uuid, text, text);
DELETE FROM public.products WHERE id = 'e0000000-0000-4000-8000-000000000001';
SQL
  rm -f "${test_directory}"/*.log
  rmdir "${test_directory}"
}

trap cleanup EXIT
cleanup
test_directory="$(mktemp -d "${TMPDIR:-/tmp}/taa-checkout-lifecycle-hardening.XXXXXX")"
trap cleanup EXIT

"${psql_command[@]}" >/dev/null <<'SQL'
ALTER TABLE public.products DISABLE TRIGGER sync_klaviyo_products_after_change;
INSERT INTO public.products (id, name, slug, sku, price, inventory_quantity, active)
VALUES (
  'e0000000-0000-4000-8000-000000000001',
  'Slice 5C.1 concurrency product',
  'slice-5c-1-concurrency-product',
  'SLICE-5C-1-CONCURRENCY',
  10.00,
  10,
  true
);
ALTER TABLE public.products ENABLE TRIGGER sync_klaviyo_products_after_change;

CREATE FUNCTION public.slice5c1_replacement_fixture(
  p_attempt_id uuid,
  p_active_id uuid,
  p_replacement_id uuid,
  p_active_session_id text,
  p_replacement_session_id text
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
    orchestration_state, orchestration_updated_at, confirmation_token_hash,
    confirmation_token_expires_at, stripe_return_url, stripe_session_expires_at
  ) VALUES (
    p_active_id, 'pi_' || replace(p_active_id::text, '-', ''), p_active_session_id,
    'pending', 'concurrency@example.com', 1000, 0, 1000, 'gbp', p_attempt_id,
    p_active_id, repeat('b', 64), 'reservation_v1', 'active', v_now,
    repeat('c', 64), v_now + interval '30 minutes', 'https://example.com/checkout',
    date_trunc('second', v_now + interval '119 minutes')
  );
  INSERT INTO public.checkout_intents (
    id, payment_intent_id, stripe_checkout_session_id, status, customer_email,
    subtotal_amount, shipping_amount, total_amount, currency, checkout_attempt_id,
    checkout_request_id, command_fingerprint, replaces_checkout_intent_id,
    checkout_protocol_version, orchestration_state, orchestration_updated_at,
    worker_lease_id, worker_lease_expires_at, stripe_return_url,
    stripe_session_expires_at
  ) VALUES (
    p_replacement_id, 'pi_' || replace(p_replacement_id::text, '-', ''),
    p_replacement_session_id, 'pending', 'concurrency@example.com', 1000, 0,
    1000, 'gbp', p_attempt_id, p_replacement_id, repeat('d', 64), p_active_id,
    'reservation_v1', 'replacing', v_now,
    'e3000000-0000-4000-8000-000000000001', v_now + interval '2 minutes',
    'https://example.com/checkout', date_trunc('second', v_now + interval '119 minutes')
  );
  INSERT INTO public.checkout_intent_items (
    checkout_intent_id, product_type, product_id, base_product_id, sku, name,
    product_name, quantity, unit_amount, line_total, weight_grams, line_position
  )
  SELECT
    intents.id, 'product', products.id, products.id, products.sku, products.name,
    products.name, 1, 1000, 1000, 100, 0
  FROM public.checkout_intents AS intents
  CROSS JOIN public.products
  WHERE intents.id IN (p_active_id, p_replacement_id)
    AND products.id = 'e0000000-0000-4000-8000-000000000001';
  UPDATE public.checkout_attempts
  SET active_checkout_intent_id = p_active_id,
      in_flight_checkout_intent_id = p_replacement_id
  WHERE id = p_attempt_id;
  INSERT INTO public.inventory_reservations (
    id, checkout_attempt_id, status, reserved_at, expires_at
  ) VALUES (
    v_reservation_id, p_attempt_id, 'held', v_now, v_now + interval '29 minutes'
  );
  INSERT INTO public.inventory_reservation_items (
    reservation_id, product_id, sku_snapshot, quantity
  ) VALUES (
    v_reservation_id, 'e0000000-0000-4000-8000-000000000001',
    'SLICE-5C-1-CONCURRENCY', 1
  );
END;
$function$;

SELECT public.slice5c1_replacement_fixture(
  'e1000000-0000-4000-8000-000000000001',
  'e2000000-0000-4000-8000-000000000001',
  'e2000000-0000-4000-8000-000000000101',
  'cs_slice5c1_race_terminal_a',
  'cs_slice5c1_race_terminal_b'
);
SELECT public.slice5c1_replacement_fixture(
  'e1000000-0000-4000-8000-000000000002',
  'e2000000-0000-4000-8000-000000000002',
  'e2000000-0000-4000-8000-000000000102',
  'cs_slice5c1_race_paid_a',
  'cs_slice5c1_race_paid_b'
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

"${psql_command[@]}" >"${test_directory}/terminal-first.log" 2>&1 <<'SQL' &
BEGIN;
SET application_name = 'slice5c1_terminal_a';
SELECT id FROM public.checkout_attempts
WHERE id = 'e1000000-0000-4000-8000-000000000001' FOR UPDATE;
SELECT pg_sleep(2);
SELECT * FROM public.transition_checkout_session_terminal(
  'cs_slice5c1_race_terminal_a',
  'expired_unpaid'
);
COMMIT;
SQL
terminal_pid=$!
sleep 0.2
"${psql_command[@]}" >"${test_directory}/checkpoint-second.log" 2>&1 <<'SQL' &
SET application_name = 'slice5c1_checkpoint_b';
SELECT public.record_checkout_predecessor_invalidated(
  'e2000000-0000-4000-8000-000000000101',
  'e2000000-0000-4000-8000-000000000001',
  'e3000000-0000-4000-8000-000000000001'
);
SQL
checkpoint_pid=$!
wait_until_blocked 'slice5c1_checkpoint_b' 'slice5c1_terminal_a'
wait "${terminal_pid}"
wait "${checkpoint_pid}"

terminal_state="$("${psql_command[@]}" -Atc "SELECT concat_ws('|', reservations.status, attempts.active_checkout_intent_id IS NULL, attempts.in_flight_checkout_intent_id = 'e2000000-0000-4000-8000-000000000101', predecessors.orchestration_state, replacements.predecessor_invalidated_at IS NOT NULL) FROM public.checkout_attempts AS attempts JOIN public.inventory_reservations AS reservations ON reservations.checkout_attempt_id = attempts.id JOIN public.checkout_intents AS predecessors ON predecessors.id = 'e2000000-0000-4000-8000-000000000001' JOIN public.checkout_intents AS replacements ON replacements.id = 'e2000000-0000-4000-8000-000000000101' WHERE attempts.id = 'e1000000-0000-4000-8000-000000000001';")"
if [[ "${terminal_state}" != 'held|t|t|superseded|t' ]]; then
  echo "A-terminal/B-in-flight race produced unexpected state: ${terminal_state}" >&2
  exit 1
fi
echo 'PASS: A terminal versus predecessor checkpoint retained B and converged idempotently.'

"${psql_command[@]}" >"${test_directory}/paid-first.log" 2>&1 <<'SQL' &
BEGIN;
SET application_name = 'slice5c1_paid_a';
SELECT id FROM public.checkout_attempts
WHERE id = 'e1000000-0000-4000-8000-000000000002' FOR UPDATE;
SELECT pg_sleep(2);
SELECT finalization_outcome FROM public.finalize_paid_checkout(
  'cs_slice5c1_race_paid_a',
  'pi_e2000000000040008000000000000002'
);
COMMIT;
SQL
paid_pid=$!
sleep 0.2
"${psql_command[@]}" >"${test_directory}/replacement-terminal-second.log" 2>&1 <<'SQL' &
SET application_name = 'slice5c1_terminal_b';
SELECT * FROM public.transition_checkout_session_terminal(
  'cs_slice5c1_race_paid_b',
  'expired_unpaid'
);
SQL
replacement_terminal_pid=$!
wait_until_blocked 'slice5c1_terminal_b' 'slice5c1_paid_a'
wait "${paid_pid}"
wait "${replacement_terminal_pid}"

if ! grep -q 'manual_review_required' "${test_directory}/paid-first.log"; then
  echo 'A paid finalizer bypassed the unresolved B guard.' >&2
  exit 1
fi

"${psql_command[@]}" >/dev/null <<'SQL'
SELECT * FROM public.finalize_paid_checkout(
  'cs_slice5c1_race_paid_a',
  'pi_e2000000000040008000000000000002'
);
SQL

paid_state="$("${psql_command[@]}" -Atc "SELECT concat_ws('|', reservations.status, count(DISTINCT orders.id), count(DISTINCT incidents.id), products.inventory_quantity) FROM public.inventory_reservations AS reservations JOIN public.products ON products.id = 'e0000000-0000-4000-8000-000000000001' LEFT JOIN public.orders AS orders ON orders.checkout_attempt_id = reservations.checkout_attempt_id LEFT JOIN public.checkout_lifecycle_incidents AS incidents ON incidents.checkout_attempt_id = reservations.checkout_attempt_id WHERE reservations.checkout_attempt_id = 'e1000000-0000-4000-8000-000000000002' GROUP BY reservations.status, products.inventory_quantity;")"
if [[ "${paid_state}" != 'consumed|1|1|9' ]]; then
  echo "A-paid/B-in-flight race produced unexpected state: ${paid_state}" >&2
  exit 1
fi
echo 'PASS: A paid versus B terminal serialized through guard, compensation, and one finalization.'
