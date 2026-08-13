import { assertEquals, assertRejects } from 'jsr:@std/assert@1';
import { HttpSecurityError } from './http-security.ts';
import { readKlaviyoCatalogSyncRequest } from './klaviyo-catalog-security.ts';

const secret = 'catalog-secret';
const validPayload = {
  source_table: 'products',
  operation: 'UPDATE',
  record_id: '10000000-0000-4000-8000-000000000001',
};

function request(payload: unknown, token = secret) {
  return new Request('https://example.supabase.co/functions/v1/sync-klaviyo-catalog', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { 'x-taa-internal-token': token } : {}),
    },
    body: JSON.stringify(payload),
  });
}

for (const token of ['', 'wrong']) {
  Deno.test(`Klaviyo catalogue sync rejects ${token ? 'wrong' : 'missing'} token`, async () => {
    await assertRejects(
      () => readKlaviyoCatalogSyncRequest(request(validPayload, token), secret),
      HttpSecurityError,
      'Unauthorized.'
    );
  });
}

Deno.test('Klaviyo catalogue sync admits only the exact authenticated trigger schema', async () => {
  assertEquals(await readKlaviyoCatalogSyncRequest(request(validPayload), secret), {
    sourceTable: 'products',
    operation: 'UPDATE',
    recordId: validPayload.record_id,
  });

  await assertRejects(
    () =>
      readKlaviyoCatalogSyncRequest(
        request({ ...validPayload, old_record: { secret: 'not accepted' } }),
        secret
      ),
    HttpSecurityError,
    'Request contains unsupported fields.'
  );
});

Deno.test('empty payload cannot trigger an implicit full catalogue sync', async () => {
  await assertRejects(
    () => readKlaviyoCatalogSyncRequest(request({}), secret),
    HttpSecurityError,
    'Catalog sync request is invalid.'
  );
});
