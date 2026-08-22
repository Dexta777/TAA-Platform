#!/usr/bin/env bash

set -euo pipefail

database_container="${SUPABASE_DB_CONTAINER:-supabase_db_TAA-Platform}"
test_directory="$(mktemp -d "${TMPDIR:-/tmp}/taa-customer-preferences.XXXXXX")"
first_output="${test_directory}/first.log"
second_output="${test_directory}/second.log"
test_user_id='cf000000-0000-4000-8000-000000000001'
psql_command=(
  docker exec -i "${database_container}"
  psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres
)

cleanup_fixture() {
  "${psql_command[@]}" >/dev/null 2>&1 <<'SQL' || true
DELETE FROM auth.users
WHERE id = 'cf000000-0000-4000-8000-000000000001';
SQL
}

cleanup() {
  cleanup_fixture
  rm -f "${first_output}" "${second_output}"
  rmdir "${test_directory}"
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

trap cleanup EXIT
cleanup_fixture

"${psql_command[@]}" >/dev/null <<'SQL'
INSERT INTO auth.users (
  id,
  instance_id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
VALUES (
  'cf000000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'preference-concurrency@example.test',
  '',
  statement_timestamp(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,
  statement_timestamp(),
  statement_timestamp()
);
SQL

"${psql_command[@]}" >"${first_output}" 2>&1 <<'SQL' &
BEGIN;
SET application_name = 'taa_customer_preference_a';
SELECT set_config(
  'request.jwt.claim.sub',
  'cf000000-0000-4000-8000-000000000001',
  true
);
SET LOCAL ROLE authenticated;
SELECT optional_order_updates_enabled
FROM public.set_customer_preference_v1(
  'optional_order_updates',
  false,
  NULL
);
SELECT pg_sleep(3);
COMMIT;
SQL
first_pid=$!

wait_for_database_condition \
  "SELECT count(*) FROM pg_stat_activity WHERE application_name = 'taa_customer_preference_a' AND state = 'active' AND query LIKE 'SELECT pg_sleep%';" \
  'Preference caller A did not reach its uncommitted hold.'

"${psql_command[@]}" >"${second_output}" 2>&1 <<'SQL' &
BEGIN;
SET application_name = 'taa_customer_preference_b';
SELECT set_config(
  'request.jwt.claim.sub',
  'cf000000-0000-4000-8000-000000000001',
  true
);
SET LOCAL ROLE authenticated;
SELECT optional_order_updates_enabled
FROM public.set_customer_preference_v1(
  'optional_order_updates',
  false,
  NULL
);
COMMIT;
SQL
second_pid=$!

wait_for_database_condition \
  "SELECT count(*) FROM pg_stat_activity AS blocked JOIN pg_stat_activity AS blocker ON blocker.pid = ANY(pg_blocking_pids(blocked.pid)) WHERE blocked.application_name = 'taa_customer_preference_b' AND blocker.application_name = 'taa_customer_preference_a' AND blocked.wait_event_type = 'Lock';" \
  'Preference caller B was not observed waiting on caller A.'

wait "${first_pid}"
wait "${second_pid}"

if ! rg -q '^ f$' "${first_output}" || ! rg -q '^ f$' "${second_output}"; then
  echo 'Concurrent preference callers did not both receive the authoritative false state.' >&2
  sed 's/^/  A: /' "${first_output}" >&2
  sed 's/^/  B: /' "${second_output}" >&2
  exit 1
fi

preference_state="$("${psql_command[@]}" -At <<'SQL'
SELECT concat_ws(
  '|',
  count(*),
  bool_and(NOT optional_order_updates_enabled),
  bool_and(NOT marketing_communications_enabled)
)
FROM public.customer_preferences
WHERE user_id = 'cf000000-0000-4000-8000-000000000001';
SQL
)"

if [[ "${preference_state}" != '1|t|t' ]]; then
  echo "Concurrent first use produced unexpected current state: ${preference_state}" >&2
  exit 1
fi

event_state="$("${psql_command[@]}" -At <<'SQL'
SELECT concat_ws(
  '|',
  count(*),
  min(preference_key),
  bool_and(old_value),
  bool_and(NOT new_value),
  min(source),
  count(notice_version)
)
FROM public.customer_preference_events
WHERE user_id = 'cf000000-0000-4000-8000-000000000001';
SQL
)"

if [[ "${event_state}" != '1|optional_order_updates|t|t|account_settings|0' ]]; then
  echo "Concurrent first use produced inconsistent event history: ${event_state}" >&2
  exit 1
fi

echo 'PASS: concurrent first preference use serialized to one truthful row and one real transition event.'
