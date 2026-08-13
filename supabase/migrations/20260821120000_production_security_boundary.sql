-- Phase 6A: production ingress security, atomic application rate limiting, and
-- authenticated database-to-Edge Klaviyo catalogue synchronization.

CREATE SCHEMA IF NOT EXISTS private;

REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;

CREATE TABLE private.edge_rate_limit_buckets (
  bucket_key text PRIMARY KEY,
  dimension text NOT NULL,
  tokens double precision NOT NULL,
  last_refilled_at timestamp with time zone NOT NULL,
  updated_at timestamp with time zone NOT NULL,
  CONSTRAINT edge_rate_limit_buckets_key_check
    CHECK (char_length(bucket_key) BETWEEN 16 AND 512),
  CONSTRAINT edge_rate_limit_buckets_dimension_check
    CHECK (char_length(dimension) BETWEEN 1 AND 100),
  CONSTRAINT edge_rate_limit_buckets_tokens_check
    CHECK (
      tokens >= 0
      AND tokens NOT IN (
        'Infinity'::double precision,
        '-Infinity'::double precision,
        'NaN'::double precision
      )
    )
);

CREATE INDEX edge_rate_limit_buckets_updated_at_idx
  ON private.edge_rate_limit_buckets (updated_at);

REVOKE ALL ON TABLE private.edge_rate_limit_buckets FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.consume_edge_rate_limits(p_buckets jsonb)
RETURNS TABLE (
  allowed boolean,
  retry_after_seconds integer,
  limiting_dimension text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_bucket jsonb;
  v_bucket_key text;
  v_dimension text;
  v_refill_tokens double precision;
  v_refill_window_seconds double precision;
  v_burst_capacity double precision;
  v_current_tokens double precision;
  v_last_refilled_at timestamp with time zone;
  v_available_tokens double precision;
  v_retry_after integer;
  v_maximum_retry_after integer := 0;
  v_limiting_dimension text := NULL;
  v_now timestamp with time zone := clock_timestamp();
  v_updates jsonb := '[]'::jsonb;
BEGIN
  IF p_buckets IS NULL
    OR jsonb_typeof(p_buckets) <> 'array'
    OR jsonb_array_length(p_buckets) = 0
    OR jsonb_array_length(p_buckets) > 16 THEN
    RAISE EXCEPTION 'Rate limit bucket policy is invalid.';
  END IF;

  IF (
    SELECT count(DISTINCT value ->> 'bucket_key') <> jsonb_array_length(p_buckets)
    FROM jsonb_array_elements(p_buckets)
  ) THEN
    RAISE EXCEPTION 'Rate limit bucket keys must be unique.';
  END IF;

  -- Advisory locks cover absent rows. Deterministic ordering prevents lock inversion
  -- when concurrent requests consume overlapping multidimensional budgets.
  FOR v_bucket IN
    SELECT value
    FROM jsonb_array_elements(p_buckets)
    ORDER BY value ->> 'bucket_key'
  LOOP
    v_bucket_key := nullif(btrim(v_bucket ->> 'bucket_key'), '');

    IF v_bucket_key IS NULL OR char_length(v_bucket_key) NOT BETWEEN 16 AND 512 THEN
      RAISE EXCEPTION 'Rate limit bucket key is invalid.';
    END IF;

    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(v_bucket_key, 0)
    );
  END LOOP;

  FOR v_bucket IN
    SELECT value
    FROM jsonb_array_elements(p_buckets)
    ORDER BY value ->> 'bucket_key'
  LOOP
    v_bucket_key := btrim(v_bucket ->> 'bucket_key');
    v_dimension := nullif(btrim(v_bucket ->> 'dimension'), '');
    v_refill_tokens := (v_bucket ->> 'refill_tokens')::double precision;
    v_refill_window_seconds := (v_bucket ->> 'refill_window_seconds')::double precision;
    v_burst_capacity := (v_bucket ->> 'burst_capacity')::double precision;

    IF v_dimension IS NULL
      OR char_length(v_dimension) > 100
      OR v_refill_tokens IS NULL
      OR v_refill_window_seconds IS NULL
      OR v_burst_capacity IS NULL
      OR v_refill_tokens IN (
        'Infinity'::double precision,
        '-Infinity'::double precision,
        'NaN'::double precision
      )
      OR v_refill_window_seconds IN (
        'Infinity'::double precision,
        '-Infinity'::double precision,
        'NaN'::double precision
      )
      OR v_burst_capacity IN (
        'Infinity'::double precision,
        '-Infinity'::double precision,
        'NaN'::double precision
      )
      OR v_refill_tokens <= 0
      OR v_refill_window_seconds <= 0
      OR v_burst_capacity < 1 THEN
      RAISE EXCEPTION 'Rate limit bucket policy is invalid.';
    END IF;

    SELECT buckets.tokens, buckets.last_refilled_at
    INTO v_current_tokens, v_last_refilled_at
    FROM private.edge_rate_limit_buckets AS buckets
    WHERE buckets.bucket_key = v_bucket_key
    FOR UPDATE;

    IF NOT FOUND THEN
      v_available_tokens := v_burst_capacity;
    ELSE
      v_available_tokens := least(
        v_burst_capacity,
        v_current_tokens
          + greatest(0, extract(epoch FROM (v_now - v_last_refilled_at)))
            * v_refill_tokens / v_refill_window_seconds
      );
    END IF;

    v_updates := v_updates || jsonb_build_array(
      jsonb_build_object(
        'bucket_key', v_bucket_key,
        'dimension', v_dimension,
        'tokens', v_available_tokens
      )
    );

    IF v_available_tokens < 1 THEN
      v_retry_after := greatest(
        1,
        ceil((1 - v_available_tokens) * v_refill_window_seconds / v_refill_tokens)::integer
      );

      IF v_retry_after > v_maximum_retry_after THEN
        v_maximum_retry_after := v_retry_after;
        v_limiting_dimension := v_dimension;
      END IF;
    END IF;
  END LOOP;

  IF v_maximum_retry_after > 0 THEN
    RETURN QUERY SELECT false, v_maximum_retry_after, v_limiting_dimension;
    RETURN;
  END IF;

  FOR v_bucket IN SELECT value FROM jsonb_array_elements(v_updates)
  LOOP
    INSERT INTO private.edge_rate_limit_buckets (
      bucket_key,
      dimension,
      tokens,
      last_refilled_at,
      updated_at
    )
    VALUES (
      v_bucket ->> 'bucket_key',
      v_bucket ->> 'dimension',
      (v_bucket ->> 'tokens')::double precision - 1,
      v_now,
      v_now
    )
    ON CONFLICT (bucket_key) DO UPDATE
    SET
      dimension = EXCLUDED.dimension,
      tokens = EXCLUDED.tokens,
      last_refilled_at = EXCLUDED.last_refilled_at,
      updated_at = EXCLUDED.updated_at;
  END LOOP;

  RETURN QUERY SELECT true, 0, NULL::text;
END;
$function$;

CREATE FUNCTION public.prune_edge_rate_limit_buckets(
  p_older_than interval DEFAULT interval '48 hours',
  p_maximum_rows integer DEFAULT 10000
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_deleted integer;
BEGIN
  IF p_older_than < interval '1 hour'
    OR p_maximum_rows < 1
    OR p_maximum_rows > 100000 THEN
    RAISE EXCEPTION 'Rate limit prune policy is invalid.';
  END IF;

  DELETE FROM private.edge_rate_limit_buckets AS buckets
  WHERE buckets.ctid IN (
    SELECT candidates.ctid
    FROM private.edge_rate_limit_buckets AS candidates
    WHERE candidates.updated_at < clock_timestamp() - p_older_than
    ORDER BY candidates.updated_at
    LIMIT p_maximum_rows
  );

  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RETURN v_deleted;
END;
$function$;

REVOKE ALL ON FUNCTION public.consume_edge_rate_limits(jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prune_edge_rate_limit_buckets(interval, integer)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.consume_edge_rate_limits(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.prune_edge_rate_limit_buckets(interval, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.trigger_klaviyo_catalog_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_internal_token text;
BEGIN
  BEGIN
    SELECT decrypted_secret
    INTO v_internal_token
    FROM vault.decrypted_secrets
    WHERE name = 'taa_klaviyo_catalog_sync_secret';

    IF nullif(v_internal_token, '') IS NULL THEN
      RAISE WARNING
        'Klaviyo catalogue sync was skipped because its Vault token is unavailable.';
      RETURN coalesce(new, old);
    END IF;

    PERFORM net.http_post(
      url := 'https://zxmywtmjvfjgdjcstgtn.supabase.co/functions/v1/sync-klaviyo-catalog',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-taa-internal-token', v_internal_token
      ),
      body := jsonb_build_object(
        'source_table', tg_table_name,
        'operation', tg_op,
        'record_id', coalesce(new.id, old.id)
      )
    );
  EXCEPTION
    WHEN OTHERS THEN
      RAISE WARNING 'Klaviyo catalogue sync could not be queued.';
  END;

  RETURN coalesce(new, old);
END;
$function$;

REVOKE ALL ON FUNCTION public.trigger_klaviyo_catalog_sync()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trigger_klaviyo_catalog_sync() TO service_role;
