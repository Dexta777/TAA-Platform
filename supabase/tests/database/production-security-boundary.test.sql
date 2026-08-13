BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(19);

SELECT ok(
  (SELECT allowed FROM public.consume_edge_rate_limits(
    '[{"bucket_key":"test-client-one-minute","dimension":"test_minute","refill_tokens":2,"refill_window_seconds":60,"burst_capacity":2}]'::jsonb
  )),
  'a request under the token-bucket threshold is allowed'
);

SELECT ok(
  (SELECT allowed FROM public.consume_edge_rate_limits(
    '[{"bucket_key":"test-client-one-minute","dimension":"test_minute","refill_tokens":2,"refill_window_seconds":60,"burst_capacity":2}]'::jsonb
  )),
  'the exact token-bucket threshold remains allowed'
);

SELECT ok(
  (SELECT allowed FROM public.consume_edge_rate_limits(
    '[{"bucket_key":"test-multi-blocked","dimension":"blocked","refill_tokens":1,"refill_window_seconds":3600,"burst_capacity":1}]'::jsonb
  )),
  'the limiting test dimension can consume its only token'
);

SELECT ok(
  NOT (SELECT allowed FROM public.consume_edge_rate_limits(
    '[{"bucket_key":"test-client-one-minute","dimension":"test_minute","refill_tokens":2,"refill_window_seconds":60,"burst_capacity":2}]'::jsonb
  )),
  'the request over the threshold is rejected'
);

UPDATE private.edge_rate_limit_buckets
SET last_refilled_at = clock_timestamp() - interval '31 seconds'
WHERE bucket_key = 'test-client-one-minute';

SELECT ok(
  (SELECT allowed FROM public.consume_edge_rate_limits(
    '[{"bucket_key":"test-client-one-minute","dimension":"test_minute","refill_tokens":2,"refill_window_seconds":60,"burst_capacity":2}]'::jsonb
  )),
  'elapsed time refills the bucket'
);

SELECT ok(
  NOT (SELECT allowed FROM public.consume_edge_rate_limits(
    '[
      {"bucket_key":"test-multi-available","dimension":"available","refill_tokens":10,"refill_window_seconds":60,"burst_capacity":10},
      {"bucket_key":"test-multi-blocked","dimension":"blocked","refill_tokens":1,"refill_window_seconds":3600,"burst_capacity":1}
    ]'::jsonb
  )),
  'a multidimensional request is rejected when one dimension is exhausted'
);

SELECT is(
  (SELECT tokens FROM private.edge_rate_limit_buckets WHERE bucket_key = 'test-multi-available'),
  NULL::double precision,
  'multidimensional rejection consumes none of the available dimensions'
);

SELECT ok(
  (SELECT allowed FROM public.consume_edge_rate_limits(
    '[{"bucket_key":"test-distinct-client","dimension":"test_minute","refill_tokens":2,"refill_window_seconds":60,"burst_capacity":2}]'::jsonb
  )),
  'a distinct derived client key has an isolated budget'
);

SELECT ok(
  NOT has_schema_privilege('anon', 'private', 'USAGE')
    AND NOT has_schema_privilege('authenticated', 'private', 'USAGE')
    AND NOT has_table_privilege('anon', 'private.edge_rate_limit_buckets', 'SELECT')
    AND NOT has_table_privilege('authenticated', 'private.edge_rate_limit_buckets', 'SELECT'),
  'browser roles cannot access rate-limit persistence'
);

SELECT ok(
  NOT has_function_privilege('anon', 'public.consume_edge_rate_limits(jsonb)', 'EXECUTE')
    AND NOT has_function_privilege(
      'authenticated', 'public.consume_edge_rate_limits(jsonb)', 'EXECUTE'
    ),
  'browser roles cannot execute the rate limiter'
);

SELECT ok(
  has_function_privilege('service_role', 'public.consume_edge_rate_limits(jsonb)', 'EXECUTE')
    AND has_function_privilege(
      'service_role',
      'public.prune_edge_rate_limit_buckets(interval,integer)',
      'EXECUTE'
    ),
  'service role can consume and prune rate-limit buckets'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM private.edge_rate_limit_buckets
    WHERE bucket_key LIKE '%203.0.113.10%'
  ),
  'rate-limit persistence contains no raw test IP address'
);

INSERT INTO private.edge_rate_limit_buckets (
  bucket_key, dimension, tokens, last_refilled_at, updated_at
)
VALUES (
  'test-expired-prune-bucket', 'prune', 0, clock_timestamp() - interval '3 days',
  clock_timestamp() - interval '3 days'
);

SELECT is(
  public.prune_edge_rate_limit_buckets(interval '48 hours', 100),
  1,
  'the service-only prune helper removes expired buckets'
);

SELECT lives_ok(
  $$
    INSERT INTO public.products (id, name, slug, sku, price, inventory_quantity, active)
    VALUES (
      'f6000000-0000-4000-8000-000000000001',
      'Phase 6A trigger test',
      'phase-6a-trigger-test',
      'PHASE-6A-TRIGGER-TEST',
      100,
      1,
      true
    )
  $$,
  'missing Vault sync configuration never aborts the product mutation'
);

SELECT ok(
  NOT has_function_privilege('anon', 'public.trigger_klaviyo_catalog_sync()', 'EXECUTE')
    AND NOT has_function_privilege(
      'authenticated', 'public.trigger_klaviyo_catalog_sync()', 'EXECUTE'
    ),
  'browser roles cannot execute the Klaviyo trigger helper'
);

SELECT lives_ok(
  $$
    SELECT vault.create_secret(
      'phase-6a-test-token',
      'taa_klaviyo_catalog_sync_secret',
      'Phase 6A pgTAP fixture'
    )
  $$,
  'the local Vault fixture can provision the named catalogue-sync token'
);

SELECT lives_ok(
  $$
    INSERT INTO public.products (id, name, slug, sku, price, inventory_quantity, active)
    VALUES (
      'f6000000-0000-4000-8000-000000000002',
      'Phase 6A authenticated trigger test',
      'phase-6a-authenticated-trigger-test',
      'PHASE-6A-AUTHENTICATED-TRIGGER-TEST',
      100,
      1,
      true
    )
  $$,
  'the Vault-authenticated product trigger queues without aborting its mutation'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM net.http_request_queue AS queued
    WHERE queued.url =
      'https://zxmywtmjvfjgdjcstgtn.supabase.co/functions/v1/sync-klaviyo-catalog'
      AND queued.headers ->> 'x-taa-internal-token' = 'phase-6a-test-token'
      AND convert_from(queued.body, 'UTF8')::jsonb = jsonb_build_object(
        'source_table', 'products',
        'operation', 'INSERT',
        'record_id', 'f6000000-0000-4000-8000-000000000002'
      )
  ),
  'the Vault trigger sends only the authenticated minimal catalogue payload'
);

SELECT throws_ok(
  $$SELECT * FROM public.consume_edge_rate_limits('[]'::jsonb)$$,
  'Rate limit bucket policy is invalid.',
  'empty rate-limit policy arrays are rejected'
);

SELECT * FROM finish();

ROLLBACK;
