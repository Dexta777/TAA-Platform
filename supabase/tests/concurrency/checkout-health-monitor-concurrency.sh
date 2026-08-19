#!/usr/bin/env bash

set -euo pipefail

database_container="${SUPABASE_DB_CONTAINER:-supabase_db_TAA-Platform}"
test_directory="$(mktemp -d "${TMPDIR:-/tmp}/taa-checkout-health-monitor.XXXXXX")"
first_output="${test_directory}/first.log"
second_output="${test_directory}/second.log"
psql_command=(
  docker exec -i "${database_container}"
  psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres
)

cleanup_fixtures() {
  "${psql_command[@]}" >/dev/null 2>&1 <<'SQL' || true
DELETE FROM private.checkout_health_snapshots
WHERE snapshot_minute = '2026-08-19T14:00:00Z';

DELETE FROM private.checkout_reconciliation_scheduler_runs
WHERE net_request_id = 9100001;
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
INSERT INTO private.checkout_reconciliation_scheduler_runs (
  scheduler_fired_at,
  scheduler_result,
  net_request_id,
  worker_state,
  worker_result,
  response_received_at,
  worker_completed_at,
  http_status,
  claimed_count,
  expired_empty_attempts_terminalized,
  updated_at
)
VALUES (
  '2026-08-19T13:59:35Z',
  'http_queued',
  9100001,
  'succeeded',
  'empty_queue',
  '2026-08-19T13:59:40Z',
  '2026-08-19T13:59:40Z',
  200,
  0,
  0,
  '2026-08-19T13:59:40Z'
);
SQL

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

"${psql_command[@]}" >"${first_output}" 2>&1 <<'SQL' &
BEGIN;
SET application_name = 'taa_health_monitor_a';
SELECT (private.record_checkout_health_snapshot_v1('2026-08-19T14:00:10Z')).id;
SELECT pg_sleep(3);
COMMIT;
SQL
first_pid=$!

wait_for_database_condition \
  "SELECT count(*) FROM pg_stat_activity WHERE application_name = 'taa_health_monitor_a' AND state = 'active' AND query LIKE 'SELECT pg_sleep%';" \
  'Monitor caller A did not reach its uncommitted hold.'

"${psql_command[@]}" >"${second_output}" 2>&1 <<'SQL' &
SET application_name = 'taa_health_monitor_b';
SELECT (private.record_checkout_health_snapshot_v1('2026-08-19T14:00:20Z')).id;
SQL
second_pid=$!

wait_for_database_condition \
  "SELECT count(*) FROM pg_stat_activity AS blocked JOIN pg_stat_activity AS blocker ON blocker.pid = ANY(pg_blocking_pids(blocked.pid)) WHERE blocked.application_name = 'taa_health_monitor_b' AND blocker.application_name = 'taa_health_monitor_a' AND blocked.wait_event_type = 'Lock';" \
  'Monitor caller B was not observed waiting on caller A.'

echo 'PASS: competing monitor evaluation waited for the canonical minute snapshot lock.'

wait "${first_pid}"
wait "${second_pid}"

snapshot_state="$("${psql_command[@]}" -At <<'SQL'
SELECT concat_ws(
  '|',
  count(*),
  count(DISTINCT id),
  min(classification),
  max(classification)
)
FROM private.checkout_health_snapshots
WHERE snapshot_minute = '2026-08-19T14:00:00Z';
SQL
)"

if [[ "${snapshot_state}" != '1|1|HEALTHY|HEALTHY' ]]; then
  echo "Unexpected concurrent monitor snapshot state: ${snapshot_state}" >&2
  exit 1
fi

echo 'PASS: concurrent evaluation retained exactly one canonical HEALTHY snapshot.'
