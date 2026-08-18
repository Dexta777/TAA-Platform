#!/usr/bin/env bash

set -euo pipefail

database_container="${SUPABASE_DB_CONTAINER:-supabase_db_TAA-Platform}"
test_directory="$(mktemp -d "${TMPDIR:-/tmp}/taa-targeted-reconciliation.XXXXXX")"
psql_command=(docker exec -i "${database_container}" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres)

cleanup() {
  "${psql_command[@]}" >/dev/null 2>&1 <<'SQL' || true
UPDATE public.checkout_attempts
SET active_checkout_intent_id = NULL, in_flight_checkout_intent_id = NULL
WHERE id::text LIKE 'd6000000-0000-4000-8000-00000000000%';
DELETE FROM public.checkout_reconciliation_jobs
WHERE checkout_attempt_id::text LIKE 'd6000000-0000-4000-8000-00000000000%';
DELETE FROM public.inventory_reservations
WHERE checkout_attempt_id::text LIKE 'd6000000-0000-4000-8000-00000000000%';
DELETE FROM public.checkout_intents
WHERE checkout_attempt_id::text LIKE 'd6000000-0000-4000-8000-00000000000%';
DELETE FROM public.checkout_attempts
WHERE id::text LIKE 'd6000000-0000-4000-8000-00000000000%';
SQL
  rm -f "${test_directory}"/*.log
  rmdir "${test_directory}"
}

trap cleanup EXIT
cleanup
test_directory="$(mktemp -d "${TMPDIR:-/tmp}/taa-targeted-reconciliation.XXXXXX")"
trap cleanup EXIT

"${psql_command[@]}" >/dev/null <<'SQL'
INSERT INTO public.checkout_attempts (
  id, capability_hash, capability_expires_at, hard_expires_at
)
VALUES
  (
    'd6000000-0000-4000-8000-000000000001', repeat('a', 64),
    clock_timestamp() + interval '90 minutes', clock_timestamp() + interval '119 minutes'
  ),
  (
    'd6000000-0000-4000-8000-000000000002', repeat('b', 64),
    clock_timestamp() + interval '90 minutes', clock_timestamp() + interval '119 minutes'
  );

INSERT INTO public.checkout_intents (
  id, payment_intent_id, stripe_checkout_session_id, status, customer_email,
  subtotal_amount, shipping_amount, total_amount, currency, checkout_attempt_id,
  checkout_request_id, command_fingerprint, checkout_protocol_version,
  orchestration_state, orchestration_updated_at, stripe_return_url,
  stripe_session_expires_at
)
VALUES
  (
    'd7000000-0000-4000-8000-000000000001',
    'pi_d7000000000040008000000000000001', 'cs_targeted_concurrency_one',
    'pending', 'targeted-concurrency@example.com', 1000, 0, 1000, 'gbp',
    'd6000000-0000-4000-8000-000000000001',
    'd7000000-0000-4000-8000-000000000001', repeat('c', 64),
    'reservation_v1', 'active', clock_timestamp(), 'https://example.test/return',
    date_trunc('second', clock_timestamp() + interval '119 minutes')
  ),
  (
    'd7000000-0000-4000-8000-000000000002',
    'pi_d7000000000040008000000000000002', 'cs_targeted_concurrency_unrelated',
    'pending', 'targeted-concurrency@example.com', 1000, 0, 1000, 'gbp',
    'd6000000-0000-4000-8000-000000000002',
    'd7000000-0000-4000-8000-000000000002', repeat('d', 64),
    'reservation_v1', 'active', clock_timestamp(), 'https://example.test/return',
    date_trunc('second', clock_timestamp() + interval '119 minutes')
  );

UPDATE public.checkout_attempts
SET
  checkout_protocol_version = 'reservation_v1',
  active_checkout_intent_id = CASE id
    WHEN 'd6000000-0000-4000-8000-000000000001'
      THEN 'd7000000-0000-4000-8000-000000000001'::uuid
    ELSE 'd7000000-0000-4000-8000-000000000002'::uuid
  END
WHERE id::text LIKE 'd6000000-0000-4000-8000-00000000000%';

INSERT INTO public.inventory_reservations (
  checkout_attempt_id, status, reserved_at, expires_at
)
VALUES
  (
    'd6000000-0000-4000-8000-000000000001', 'held', clock_timestamp(),
    clock_timestamp() + interval '29 minutes'
  ),
  (
    'd6000000-0000-4000-8000-000000000002', 'held', clock_timestamp(),
    clock_timestamp() + interval '29 minutes'
  );
SQL

wait_until_blocked() {
  for _attempt in {1..100}; do
    if [[ "$("${psql_command[@]}" -Atc "SELECT count(*) FROM pg_stat_activity AS blocked JOIN pg_stat_activity AS blocker ON blocker.pid = ANY(pg_blocking_pids(blocked.pid)) WHERE blocked.application_name = 'targeted_claim_worker_two' AND blocker.application_name = 'targeted_claim_worker_one';")" == '1' ]]; then
      return 0
    fi
    sleep 0.05
  done

  echo 'The second exact claimant was not observed waiting on the target attempt lock.' >&2
  return 1
}

"${psql_command[@]}" >"${test_directory}/worker-one.log" 2>&1 <<'SQL' &
BEGIN;
SET application_name = 'targeted_claim_worker_one';
SELECT id
FROM public.checkout_attempts
WHERE id = 'd6000000-0000-4000-8000-000000000001'
FOR UPDATE;
SELECT pg_sleep(2);
SELECT claim_state
FROM public.claim_checkout_attempt_reconciliation_job_v1(
  'd6000000-0000-4000-8000-000000000001',
  'd8000000-0000-4000-8000-000000000001'
);
COMMIT;
SQL
worker_one_pid=$!
sleep 0.2

"${psql_command[@]}" >"${test_directory}/worker-two.log" 2>&1 <<'SQL' &
SET application_name = 'targeted_claim_worker_two';
SELECT claim_state
FROM public.claim_checkout_attempt_reconciliation_job_v1(
  'd6000000-0000-4000-8000-000000000001',
  'd8000000-0000-4000-8000-000000000002'
);
SQL
worker_two_pid=$!

wait_until_blocked
wait "${worker_one_pid}"
wait "${worker_two_pid}"

if ! grep -q 'claimed' "${test_directory}/worker-one.log"; then
  echo 'The first exact claimant did not acquire the target job.' >&2
  exit 1
fi

if ! grep -q 'operation_in_progress' "${test_directory}/worker-two.log"; then
  echo 'The concurrent exact claimant did not observe the active lease.' >&2
  exit 1
fi

target_state="$("${psql_command[@]}" -Atc "SELECT concat_ws('|', count(*), max(status), max(attempt_count), max(worker_lease_id::text)) FROM public.checkout_reconciliation_jobs WHERE checkout_attempt_id = 'd6000000-0000-4000-8000-000000000001';")"
if [[ "${target_state}" != '1|claimed|1|d8000000-0000-4000-8000-000000000001' ]]; then
  echo "Concurrent exact claim produced unexpected target state: ${target_state}" >&2
  exit 1
fi

unrelated_state="$("${psql_command[@]}" -Atc "SELECT concat_ws('|', attempts.status, reservations.status, count(jobs.id)) FROM public.checkout_attempts AS attempts JOIN public.inventory_reservations AS reservations ON reservations.checkout_attempt_id = attempts.id LEFT JOIN public.checkout_reconciliation_jobs AS jobs ON jobs.checkout_attempt_id = attempts.id WHERE attempts.id = 'd6000000-0000-4000-8000-000000000002' GROUP BY attempts.status, reservations.status;")"
if [[ "${unrelated_state}" != 'active|held|0' ]]; then
  echo "Concurrent exact claim affected unrelated state: ${unrelated_state}" >&2
  exit 1
fi

echo 'PASS: concurrent exact claims serialized to one leased target job and left unrelated work untouched.'
