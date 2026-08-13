#!/usr/bin/env bash

set -euo pipefail

database_container="${SUPABASE_DB_CONTAINER:-supabase_db_TAA-Platform}"
test_directory="$(mktemp -d "${TMPDIR:-/tmp}/taa-rate-limit.XXXXXX")"
psql_command=(
  docker exec -i "${database_container}"
  psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres -At
)

cleanup() {
  "${psql_command[@]}" -c \
    "DELETE FROM private.edge_rate_limit_buckets WHERE bucket_key LIKE 'concurrency-rate-limit-%';" \
    >/dev/null 2>&1 || true
  rm -f "${test_directory}"/*.log
  rmdir "${test_directory}"
}

trap cleanup EXIT
cleanup
mkdir -p "${test_directory}"

for request_number in 1 2 3 4 5 6; do
  (
    "${psql_command[@]}" >"${test_directory}/${request_number}.log" <<'SQL'
SELECT allowed
FROM public.consume_edge_rate_limits(
  '[
    {"bucket_key":"concurrency-rate-limit-shared","dimension":"shared","refill_tokens":5,"refill_window_seconds":3600,"burst_capacity":5},
    {"bucket_key":"concurrency-rate-limit-client","dimension":"client","refill_tokens":5,"refill_window_seconds":3600,"burst_capacity":5}
  ]'::jsonb
);
SQL
  ) &
done

wait

allowed_count="$(awk '$0 == "t" { count += 1 } END { print count + 0 }' "${test_directory}"/*.log)"
denied_count="$(awk '$0 == "f" { count += 1 } END { print count + 0 }' "${test_directory}"/*.log)"

if [[ "${allowed_count}" != '5' || "${denied_count}" != '1' ]]; then
  echo "Rate-limit concurrency test failed: allowed=${allowed_count}, denied=${denied_count}." >&2
  exit 1
fi

stored_tokens="$(
  "${psql_command[@]}" -c \
    "SELECT floor(tokens)::integer FROM private.edge_rate_limit_buckets
     WHERE bucket_key = 'concurrency-rate-limit-shared';"
)"

if [[ "${stored_tokens}" != '0' ]]; then
  echo "Rate-limit concurrency test failed: shared bucket overspent (${stored_tokens})." >&2
  exit 1
fi

(
  "${psql_command[@]}" >"${test_directory}/lock-order-a.log" <<'SQL'
SET statement_timeout = '5s';
SELECT allowed
FROM public.consume_edge_rate_limits(
  '[
    {"bucket_key":"concurrency-rate-limit-lock-a","dimension":"a","refill_tokens":10,"refill_window_seconds":60,"burst_capacity":10},
    {"bucket_key":"concurrency-rate-limit-lock-b","dimension":"b","refill_tokens":10,"refill_window_seconds":60,"burst_capacity":10}
  ]'::jsonb
);
SQL
) &

(
  "${psql_command[@]}" >"${test_directory}/lock-order-b.log" <<'SQL'
SET statement_timeout = '5s';
SELECT allowed
FROM public.consume_edge_rate_limits(
  '[
    {"bucket_key":"concurrency-rate-limit-lock-b","dimension":"b","refill_tokens":10,"refill_window_seconds":60,"burst_capacity":10},
    {"bucket_key":"concurrency-rate-limit-lock-a","dimension":"a","refill_tokens":10,"refill_window_seconds":60,"burst_capacity":10}
  ]'::jsonb
);
SQL
) &

wait

if ! grep -qx 'SET' "${test_directory}/lock-order-a.log" || \
  ! grep -qx 't' "${test_directory}/lock-order-a.log" || \
  ! grep -qx 'SET' "${test_directory}/lock-order-b.log" || \
  ! grep -qx 't' "${test_directory}/lock-order-b.log"; then
  echo 'Rate-limit concurrency test failed: reverse lock order did not converge.' >&2
  exit 1
fi

echo 'Production security rate-limit concurrency test passed.'
