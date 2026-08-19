BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(28);

SELECT is(
  (SELECT extversion FROM pg_extension WHERE extname = 'pg_cron'),
  '1.6.4',
  'pg_cron is installed at the supported local version'
);

SELECT is(
  (SELECT count(*)::integer FROM cron.job WHERE jobname = 'taa-checkout-reconciliation-v1'),
  1,
  'exactly one named reconciliation scheduler job exists'
);

SELECT is(
  (SELECT schedule FROM cron.job WHERE jobname = 'taa-checkout-reconciliation-v1'),
  '* * * * *',
  'the reconciliation scheduler runs every minute'
);

SELECT is(
  (SELECT command FROM cron.job WHERE jobname = 'taa-checkout-reconciliation-v1'),
  'SELECT private.run_checkout_reconciliation_scheduler_v1();',
  'cron metadata contains only the private scheduler function call'
);

SELECT ok(
  (SELECT active FROM cron.job WHERE jobname = 'taa-checkout-reconciliation-v1'),
  'the reconciliation scheduler is active'
);

SELECT ok(
  (SELECT command !~* '(authorization|bearer|secret|token)'
   FROM cron.job WHERE jobname = 'taa-checkout-reconciliation-v1'),
  'cron metadata contains no authentication material'
);

SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'private.checkout_reconciliation_scheduler_runs'::regclass),
  'the durable scheduler heartbeat table has RLS enabled'
);

SELECT ok(
  NOT has_schema_privilege('anon', 'private', 'USAGE')
    AND NOT has_schema_privilege('authenticated', 'private', 'USAGE'),
  'browser roles cannot use the private scheduler schema'
);

SELECT ok(
  NOT has_table_privilege('anon', 'private.checkout_reconciliation_scheduler_runs', 'SELECT')
    AND NOT has_table_privilege('authenticated', 'private.checkout_reconciliation_scheduler_runs', 'SELECT')
    AND NOT has_table_privilege('service_role', 'private.checkout_reconciliation_scheduler_runs', 'SELECT'),
  'the scheduler heartbeat ledger is restricted to database operators'
);

SELECT ok(
  NOT has_function_privilege('anon', 'private.run_checkout_reconciliation_scheduler_v1()', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'private.run_checkout_reconciliation_scheduler_v1()', 'EXECUTE')
    AND NOT has_function_privilege('service_role', 'private.run_checkout_reconciliation_scheduler_v1()', 'EXECUTE'),
  'browser and service roles cannot invoke the scheduler primitive'
);

SELECT ok(
  (SELECT prosecdef FROM pg_proc WHERE oid = 'private.run_checkout_reconciliation_scheduler_v1()'::regprocedure),
  'the scheduler function is SECURITY DEFINER'
);

SELECT ok(
  (SELECT proconfig @> ARRAY['search_path=""']
   FROM pg_proc
   WHERE oid = 'private.run_checkout_reconciliation_scheduler_v1()'::regprocedure),
  'the scheduler function has an empty hardened search path'
);

SELECT ok(
  NOT has_schema_privilege('anon', 'cron', 'USAGE')
    AND NOT has_schema_privilege('authenticated', 'cron', 'USAGE'),
  'browser roles cannot resolve or invoke cron scheduling primitives'
);

SELECT ok(
  NOT (
    has_schema_privilege('anon', 'cron', 'USAGE')
    AND has_table_privilege('anon', 'cron.job', 'SELECT,INSERT,UPDATE,DELETE')
  )
    AND NOT (
      has_schema_privilege('authenticated', 'cron', 'USAGE')
      AND has_table_privilege('authenticated', 'cron.job', 'SELECT,INSERT,UPDATE,DELETE')
    ),
  'browser roles cannot read or mutate cron job metadata'
);

SELECT lives_ok(
  format(
    'SELECT cron.alter_job(%s, active := false)',
    (SELECT jobid FROM cron.job WHERE jobname = 'taa-checkout-reconciliation-v1')
  ),
  'the documented rollback can deactivate the job without deleting infrastructure'
);

SELECT ok(
  NOT (SELECT active FROM cron.job WHERE jobname = 'taa-checkout-reconciliation-v1'),
  'rollback leaves the scheduler job inactive'
);

SELECT lives_ok(
  format(
    'SELECT cron.alter_job(%s, active := true)',
    (SELECT jobid FROM cron.job WHERE jobname = 'taa-checkout-reconciliation-v1')
  ),
  'the scheduler can be reactivated after rollback verification'
);

SELECT ok(
  (SELECT active FROM cron.job WHERE jobname = 'taa-checkout-reconciliation-v1'),
  'rollback verification leaves the scheduler active'
);

TRUNCATE private.checkout_reconciliation_scheduler_runs;
DELETE FROM vault.secrets
WHERE name IN ('taa_supabase_functions_url', 'taa_checkout_reconciliation_secret');

SELECT is(
  private.run_checkout_reconciliation_scheduler_v1(),
  NULL::bigint,
  'missing Vault configuration does not queue an unauthenticated request'
);

SELECT is(
  (SELECT scheduler_result FROM private.checkout_reconciliation_scheduler_runs ORDER BY scheduler_fired_at DESC LIMIT 1),
  'vault_configuration_missing',
  'missing Vault configuration is durably visible'
);

TRUNCATE private.checkout_reconciliation_scheduler_runs;

SELECT vault.create_secret(
  'http://host.docker.internal:54321',
  'taa_supabase_functions_url',
  'Scheduler pgTAP fixture URL'
);

SELECT vault.create_secret(
  'scheduler-pgtap-fixture-secret',
  'taa_checkout_reconciliation_secret',
  'Scheduler pgTAP fixture credential'
);

CREATE TEMPORARY TABLE scheduler_fixture (
  request_id bigint NOT NULL
) ON COMMIT DROP;

INSERT INTO scheduler_fixture (request_id)
SELECT private.run_checkout_reconciliation_scheduler_v1();

SELECT ok(
  (SELECT request_id IS NOT NULL FROM scheduler_fixture),
  'valid Vault configuration queues one pg_net request'
);

SELECT ok(
  (
    SELECT queued.method = 'POST'
      AND queued.url = 'http://host.docker.internal:54321/functions/v1/reconcile-checkout-reservations'
      AND queued.body IS NULL
      AND queued.headers ->> 'Content-Type' = 'application/json'
      AND queued.headers ->> 'Authorization' = 'Bearer scheduler-pgtap-fixture-secret'
    FROM net.http_request_queue AS queued
    WHERE queued.id = (SELECT request_id FROM scheduler_fixture)
  ),
  'the scheduler queues the exact authenticated empty-body batch request'
);

SELECT is(
  (SELECT count(*)::integer FROM private.checkout_reconciliation_scheduler_runs WHERE worker_state = 'pending'),
  1,
  'the queued request creates one pending worker heartbeat'
);

SELECT is(
  private.run_checkout_reconciliation_scheduler_v1(),
  NULL::bigint,
  'an unresolved request prevents overlapping worker invocation'
);

SELECT ok(
  (SELECT count(*) = 1 FROM net.http_request_queue
   WHERE url = 'http://host.docker.internal:54321/functions/v1/reconcile-checkout-reservations')
    AND EXISTS (
      SELECT 1
      FROM private.checkout_reconciliation_scheduler_runs
      WHERE scheduler_result = 'prior_request_in_flight'
        AND worker_state = 'not_invoked'
    ),
  'an overlapping scheduler cycle is visible but creates no duplicate HTTP request'
);

INSERT INTO net._http_response (
  id,
  status_code,
  content_type,
  headers,
  content,
  timed_out,
  error_msg,
  created
)
VALUES (
  (SELECT request_id FROM scheduler_fixture),
  200,
  'application/json',
  '{}'::jsonb,
  '{"claimed":0,"expired_empty_attempts_terminalized":0}',
  false,
  NULL,
  clock_timestamp()
);

SELECT ok(
  private.run_checkout_reconciliation_scheduler_v1() IS NOT NULL,
  'the next scheduler cycle harvests completion and queues the next recurrence'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM private.checkout_reconciliation_scheduler_runs
    WHERE net_request_id = (SELECT request_id FROM scheduler_fixture)
      AND worker_state = 'succeeded'
      AND worker_result = 'empty_queue'
      AND http_status = 200
      AND claimed_count = 0
      AND expired_empty_attempts_terminalized = 0
      AND worker_completed_at = response_received_at
  ),
  'a valid empty-queue response becomes a durable worker-completion heartbeat'
);

SELECT ok(
  (SELECT count(*) = 1 FROM private.checkout_reconciliation_scheduler_runs WHERE worker_state = 'pending')
    AND (SELECT count(*) = 1 FROM private.checkout_reconciliation_scheduler_runs WHERE worker_state = 'succeeded'),
  'successive cycles retain one completed heartbeat and one non-overlapping pending request'
);

SELECT * FROM finish();

ROLLBACK;
