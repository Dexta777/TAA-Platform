BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(8);

DELETE FROM vault.secrets
WHERE name IN (
  'taa_supabase_functions_url',
  'taa_klaviyo_catalog_sync_secret'
);

SELECT vault.create_secret(
  'https://phase-6a-hardening.test',
  'taa_supabase_functions_url',
  'Phase 6A hardening pgTAP fixture'
);

SELECT lives_ok(
  $$
    INSERT INTO public.products (id, name, slug, sku, price, inventory_quantity, active)
    VALUES (
      'f6100000-0000-4000-8000-000000000001',
      'Phase 6A missing token test',
      'phase-6a-missing-token-test',
      'PHASE-6A-MISSING-TOKEN-TEST',
      100,
      1,
      true
    )
  $$,
  'a missing catalogue-sync token does not abort the product mutation'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM net.http_request_queue AS queued
    WHERE convert_from(queued.body, 'UTF8')::jsonb ->> 'record_id' =
      'f6100000-0000-4000-8000-000000000001'
  ),
  'a missing catalogue-sync token queues no request'
);

DELETE FROM vault.secrets
WHERE name = 'taa_supabase_functions_url';

SELECT vault.create_secret(
  'phase-6a-hardening-test-token',
  'taa_klaviyo_catalog_sync_secret',
  'Phase 6A hardening pgTAP fixture'
);

SELECT lives_ok(
  $$
    INSERT INTO public.products (id, name, slug, sku, price, inventory_quantity, active)
    VALUES (
      'f6100000-0000-4000-8000-000000000002',
      'Phase 6A missing URL test',
      'phase-6a-missing-url-test',
      'PHASE-6A-MISSING-URL-TEST',
      100,
      1,
      true
    )
  $$,
  'a missing functions URL does not abort the product mutation'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM net.http_request_queue AS queued
    WHERE convert_from(queued.body, 'UTF8')::jsonb ->> 'record_id' =
      'f6100000-0000-4000-8000-000000000002'
  ),
  'a missing functions URL queues no request'
);

SELECT vault.create_secret(
  'https://phase-6a-hardening.test/path?unexpected=true',
  'taa_supabase_functions_url',
  'Phase 6A hardening pgTAP fixture'
);

SELECT lives_ok(
  $$
    INSERT INTO public.products (id, name, slug, sku, price, inventory_quantity, active)
    VALUES (
      'f6100000-0000-4000-8000-000000000003',
      'Phase 6A invalid URL test',
      'phase-6a-invalid-url-test',
      'PHASE-6A-INVALID-URL-TEST',
      100,
      1,
      true
    )
  $$,
  'an invalid functions URL does not abort the product mutation'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM net.http_request_queue AS queued
    WHERE convert_from(queued.body, 'UTF8')::jsonb ->> 'record_id' =
      'f6100000-0000-4000-8000-000000000003'
  ),
  'an invalid path or query functions URL queues no request'
);

DELETE FROM vault.secrets
WHERE name = 'taa_supabase_functions_url';

SELECT vault.create_secret(
  'https://phase-6a-hardening.test/',
  'taa_supabase_functions_url',
  'Phase 6A hardening pgTAP fixture'
);

SELECT lives_ok(
  $$
    INSERT INTO public.products (id, name, slug, sku, price, inventory_quantity, active)
    VALUES (
      'f6100000-0000-4000-8000-000000000004',
      'Phase 6A configured URL test',
      'phase-6a-configured-url-test',
      'PHASE-6A-CONFIGURED-URL-TEST',
      100,
      1,
      true
    )
  $$,
  'valid Vault catalogue-sync configuration queues without aborting the mutation'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM net.http_request_queue AS queued
    WHERE queued.url =
      'https://phase-6a-hardening.test/functions/v1/sync-klaviyo-catalog'
      AND queued.headers ->> 'x-taa-internal-token' =
        'phase-6a-hardening-test-token'
      AND convert_from(queued.body, 'UTF8')::jsonb = jsonb_build_object(
        'source_table', 'products',
        'operation', 'INSERT',
        'record_id', 'f6100000-0000-4000-8000-000000000004'
      )
  ),
  'one trailing slash is removed before constructing the exact authenticated function URL'
);

SELECT * FROM finish();

ROLLBACK;
