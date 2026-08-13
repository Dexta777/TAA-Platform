#!/usr/bin/env bash

set -euo pipefail

database_container="${SUPABASE_DB_CONTAINER:-supabase_db_TAA-Platform}"
test_directory="$(mktemp -d "${TMPDIR:-/tmp}/taa-checkout-admission.XXXXXX")"
admit_output="${test_directory}/admit.log"
resume_output="${test_directory}/resume.log"
competing_output="${test_directory}/competing.log"
psql_command=(
  docker exec -i "${database_container}"
  psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres
)

cleanup_fixtures() {
  "${psql_command[@]}" >/dev/null 2>&1 <<'SQL' || true
DELETE FROM public.checkout_attempts
WHERE id = 'f1000000-0000-4000-8000-000000000001';
SQL
}

cleanup() {
  cleanup_fixtures
  rm -f "${admit_output}" "${resume_output}" "${competing_output}"
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

echo 'Browser checkout admission concurrency test passed.'
