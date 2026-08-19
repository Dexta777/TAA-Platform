-- Schedule the private reservation-v1 reconciler and persist separate scheduler
-- and worker-completion heartbeat evidence without storing credentials in cron
-- metadata or repository SQL.

CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Keep the extension schema outside browser-role reach. pg_cron owns some
-- function ACLs through supabase_admin, so schema usage is the enforceable
-- boundary available to ordinary migrations.
REVOKE ALL ON SCHEMA cron FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA cron FROM PUBLIC, anon, authenticated;

CREATE TABLE private.checkout_reconciliation_scheduler_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scheduler_fired_at timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
  scheduler_result text NOT NULL,
  net_request_id bigint UNIQUE,
  worker_state text NOT NULL,
  worker_result text,
  response_received_at timestamp with time zone,
  worker_completed_at timestamp with time zone,
  http_status integer,
  claimed_count integer,
  expired_empty_attempts_terminalized integer,
  updated_at timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT checkout_reconciliation_scheduler_runs_scheduler_result_check
    CHECK (
      scheduler_result IN (
        'http_queued',
        'scheduler_lock_busy',
        'prior_request_in_flight',
        'vault_configuration_missing',
        'vault_configuration_invalid',
        'http_queue_failed'
      )
    ),
  CONSTRAINT checkout_reconciliation_scheduler_runs_worker_state_check
    CHECK (worker_state IN ('not_invoked', 'pending', 'succeeded', 'failed')),
  CONSTRAINT checkout_reconciliation_scheduler_runs_worker_result_check
    CHECK (
      worker_result IS NULL
      OR worker_result IN (
        'empty_queue',
        'work_completed',
        'http_error',
        'transport_error',
        'invalid_response'
      )
    ),
  CONSTRAINT checkout_reconciliation_scheduler_runs_request_check
    CHECK (
      (scheduler_result = 'http_queued' AND net_request_id IS NOT NULL)
      OR (scheduler_result <> 'http_queued' AND net_request_id IS NULL)
    ),
  CONSTRAINT checkout_reconciliation_scheduler_runs_worker_lifecycle_check
    CHECK (
      (
        worker_state = 'not_invoked'
        AND worker_result IS NULL
        AND response_received_at IS NULL
        AND worker_completed_at IS NULL
        AND http_status IS NULL
        AND claimed_count IS NULL
        AND expired_empty_attempts_terminalized IS NULL
      )
      OR (
        worker_state = 'pending'
        AND scheduler_result = 'http_queued'
        AND worker_result IS NULL
        AND response_received_at IS NULL
        AND worker_completed_at IS NULL
        AND http_status IS NULL
        AND claimed_count IS NULL
        AND expired_empty_attempts_terminalized IS NULL
      )
      OR (
        worker_state = 'succeeded'
        AND scheduler_result = 'http_queued'
        AND worker_result IN ('empty_queue', 'work_completed')
        AND response_received_at IS NOT NULL
        AND worker_completed_at IS NOT NULL
        AND http_status = 200
        AND claimed_count IS NOT NULL
        AND expired_empty_attempts_terminalized IS NOT NULL
      )
      OR (
        worker_state = 'failed'
        AND scheduler_result = 'http_queued'
        AND worker_result IN ('http_error', 'transport_error', 'invalid_response')
        AND response_received_at IS NOT NULL
        AND worker_completed_at IS NULL
        AND claimed_count IS NULL
        AND expired_empty_attempts_terminalized IS NULL
      )
    ),
  CONSTRAINT checkout_reconciliation_scheduler_runs_http_status_check
    CHECK (http_status IS NULL OR http_status BETWEEN 100 AND 599),
  CONSTRAINT checkout_reconciliation_scheduler_runs_claimed_count_check
    CHECK (claimed_count IS NULL OR claimed_count BETWEEN 0 AND 25),
  CONSTRAINT checkout_reconciliation_scheduler_runs_expired_count_check
    CHECK (
      expired_empty_attempts_terminalized IS NULL
      OR expired_empty_attempts_terminalized BETWEEN 0 AND 25
    ),
  CONSTRAINT checkout_reconciliation_scheduler_runs_timestamp_order_check
    CHECK (
      response_received_at IS NULL
      OR response_received_at >= scheduler_fired_at
    ),
  CONSTRAINT checkout_reconciliation_scheduler_runs_worker_timestamp_check
    CHECK (
      worker_completed_at IS NULL
      OR worker_completed_at = response_received_at
    )
);

ALTER TABLE private.checkout_reconciliation_scheduler_runs ENABLE ROW LEVEL SECURITY;

CREATE INDEX checkout_reconciliation_scheduler_runs_fired_idx
  ON private.checkout_reconciliation_scheduler_runs (scheduler_fired_at DESC);

CREATE INDEX checkout_reconciliation_scheduler_runs_pending_idx
  ON private.checkout_reconciliation_scheduler_runs (scheduler_fired_at)
  WHERE worker_state = 'pending';

REVOKE ALL ON TABLE private.checkout_reconciliation_scheduler_runs
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION private.run_checkout_reconciliation_scheduler_v1()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_functions_url text;
  v_reconciliation_secret text;
  v_request_id bigint;
  v_payload jsonb;
  v_claimed_text text;
  v_expired_text text;
  v_claimed integer;
  v_expired integer;
  v_response record;
BEGIN
  IF NOT pg_catalog.pg_try_advisory_xact_lock(
    pg_catalog.hashtextextended('taa.checkout.reconciliation.scheduler.v1', 0)
  ) THEN
    INSERT INTO private.checkout_reconciliation_scheduler_runs (
      scheduler_result,
      worker_state
    )
    VALUES ('scheduler_lock_busy', 'not_invoked');

    RETURN NULL;
  END IF;

  -- pg_net responses are asynchronous. Each scheduler cycle first converts any
  -- prior response into a durable, credential-free worker heartbeat.
  FOR v_response IN
    SELECT
      runs.id AS run_id,
      responses.status_code,
      responses.content,
      responses.timed_out,
      responses.error_msg,
      responses.created
    FROM private.checkout_reconciliation_scheduler_runs AS runs
    JOIN LATERAL (
      SELECT responses.*
      FROM net._http_response AS responses
      WHERE responses.id = runs.net_request_id
      ORDER BY responses.created DESC
      LIMIT 1
    ) AS responses ON true
    WHERE runs.worker_state = 'pending'
    ORDER BY runs.scheduler_fired_at
    FOR UPDATE OF runs
  LOOP
    IF COALESCE(v_response.timed_out, false) OR v_response.error_msg IS NOT NULL THEN
      UPDATE private.checkout_reconciliation_scheduler_runs
      SET
        worker_state = 'failed',
        worker_result = 'transport_error',
        response_received_at = v_response.created,
        http_status = v_response.status_code,
        updated_at = clock_timestamp()
      WHERE id = v_response.run_id;

      CONTINUE;
    END IF;

    IF v_response.status_code IS DISTINCT FROM 200 THEN
      UPDATE private.checkout_reconciliation_scheduler_runs
      SET
        worker_state = 'failed',
        worker_result = 'http_error',
        response_received_at = v_response.created,
        http_status = v_response.status_code,
        updated_at = clock_timestamp()
      WHERE id = v_response.run_id;

      CONTINUE;
    END IF;

    BEGIN
      v_payload := v_response.content::jsonb;
      v_claimed_text := v_payload ->> 'claimed';
      v_expired_text := v_payload ->> 'expired_empty_attempts_terminalized';

      IF jsonb_typeof(v_payload) <> 'object'
        OR jsonb_typeof(v_payload -> 'claimed') <> 'number'
        OR jsonb_typeof(v_payload -> 'expired_empty_attempts_terminalized') <> 'number'
        OR v_claimed_text !~ '^[0-9]+$'
        OR v_expired_text !~ '^[0-9]+$' THEN
        RAISE EXCEPTION 'Reconciler response counters are invalid.';
      END IF;

      v_claimed := v_claimed_text::integer;
      v_expired := v_expired_text::integer;

      IF v_claimed NOT BETWEEN 0 AND 25 OR v_expired NOT BETWEEN 0 AND 25 THEN
        RAISE EXCEPTION 'Reconciler response counters are out of range.';
      END IF;

      UPDATE private.checkout_reconciliation_scheduler_runs
      SET
        worker_state = 'succeeded',
        worker_result = CASE
          WHEN v_claimed = 0 AND v_expired = 0 THEN 'empty_queue'
          ELSE 'work_completed'
        END,
        response_received_at = v_response.created,
        worker_completed_at = v_response.created,
        http_status = 200,
        claimed_count = v_claimed,
        expired_empty_attempts_terminalized = v_expired,
        updated_at = clock_timestamp()
      WHERE id = v_response.run_id;
    EXCEPTION
      WHEN OTHERS THEN
        UPDATE private.checkout_reconciliation_scheduler_runs
        SET
          worker_state = 'failed',
          worker_result = 'invalid_response',
          response_received_at = v_response.created,
          http_status = 200,
          updated_at = clock_timestamp()
        WHERE id = v_response.run_id;
    END;
  END LOOP;

  -- Do not queue a second worker while the previous HTTP request has no terminal
  -- pg_net response. Subsequent cron cycles remain visible as skipped heartbeats.
  IF EXISTS (
    SELECT 1
    FROM private.checkout_reconciliation_scheduler_runs
    WHERE worker_state = 'pending'
  ) THEN
    INSERT INTO private.checkout_reconciliation_scheduler_runs (
      scheduler_result,
      worker_state
    )
    VALUES ('prior_request_in_flight', 'not_invoked');

    RETURN NULL;
  END IF;

  SELECT btrim(secrets.decrypted_secret)
  INTO v_functions_url
  FROM vault.decrypted_secrets AS secrets
  WHERE secrets.name = 'taa_supabase_functions_url';

  SELECT btrim(secrets.decrypted_secret)
  INTO v_reconciliation_secret
  FROM vault.decrypted_secrets AS secrets
  WHERE secrets.name = 'taa_checkout_reconciliation_secret';

  IF nullif(v_functions_url, '') IS NULL OR nullif(v_reconciliation_secret, '') IS NULL THEN
    INSERT INTO private.checkout_reconciliation_scheduler_runs (
      scheduler_result,
      worker_state
    )
    VALUES ('vault_configuration_missing', 'not_invoked');

    RETURN NULL;
  END IF;

  IF v_functions_url !~ '^https://[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:[0-9]{1,5})?/?$'
    AND v_functions_url !~ '^http://(localhost|127[.]0[.]0[.]1|host[.]docker[.]internal)(:[0-9]{1,5})?/?$' THEN
    INSERT INTO private.checkout_reconciliation_scheduler_runs (
      scheduler_result,
      worker_state
    )
    VALUES ('vault_configuration_invalid', 'not_invoked');

    RETURN NULL;
  END IF;

  v_functions_url := pg_catalog.regexp_replace(v_functions_url, '/$', '');

  BEGIN
    v_request_id := net.http_post(
      url := v_functions_url || '/functions/v1/reconcile-checkout-reservations',
      body := NULL::jsonb,
      params := '{}'::jsonb,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_reconciliation_secret
      ),
      timeout_milliseconds := 120000
    );

    INSERT INTO private.checkout_reconciliation_scheduler_runs (
      scheduler_result,
      net_request_id,
      worker_state
    )
    VALUES ('http_queued', v_request_id, 'pending');
  EXCEPTION
    WHEN OTHERS THEN
      INSERT INTO private.checkout_reconciliation_scheduler_runs (
        scheduler_result,
        worker_state
      )
      VALUES ('http_queue_failed', 'not_invoked');

      RETURN NULL;
  END;

  RETURN v_request_id;
END;
$function$;

REVOKE ALL ON FUNCTION private.run_checkout_reconciliation_scheduler_v1()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.run_checkout_reconciliation_scheduler_v1() TO postgres;

COMMENT ON TABLE private.checkout_reconciliation_scheduler_runs IS
  'Credential-free scheduler and worker-completion heartbeat for reservation-v1 reconciliation.';
COMMENT ON FUNCTION private.run_checkout_reconciliation_scheduler_v1() IS
  'Harvests the prior pg_net result, prevents unresolved overlap, and queues one authenticated empty-body batch reconciliation request.';

SELECT cron.schedule(
  'taa-checkout-reconciliation-v1',
  '* * * * *',
  'SELECT private.run_checkout_reconciliation_scheduler_v1();'
);

-- Operational rollback keeps the reconciler and Vault credential intact:
-- SELECT cron.alter_job(jobid, active := false)
-- FROM cron.job
-- WHERE jobname = 'taa-checkout-reconciliation-v1';
