import { assert, assertEquals, assertRejects, assertThrows } from 'jsr:@std/assert@1';
import {
  HttpSecurityError,
  browserErrorResponse,
  getConfiguredBrowserApiKeys,
  getConfiguredBrowserOrigins,
  prepareBrowserRequest,
  readBoundedJson,
} from './http-security.ts';

const allowedOrigin = 'https://www.theanimalalchemist.com';
const browserApiKey = 'sb_publishable_test';

function browserRequest(method = 'POST', body = '{}', headers: Record<string, string> = {}) {
  return new Request('https://project.supabase.co/functions/v1/test', {
    method,
    headers: {
      origin: allowedOrigin,
      apikey: browserApiKey,
      'content-type': 'application/json; charset=utf-8',
      ...headers,
    },
    ...(method === 'POST' ? { body } : {}),
  });
}

const configuration = {
  configuredOrigins: [allowedOrigin],
  configuredApiKeys: [browserApiKey],
};

Deno.test('a single exact configured browser origin is canonical and allowed', () => {
  assertEquals(getConfiguredBrowserOrigins(allowedOrigin), [allowedOrigin]);
  assertEquals(
    prepareBrowserRequest(browserRequest(), configuration).context.origin,
    allowedOrigin
  );
});

Deno.test('duplicate identical configured origins are deduplicated before matching', () => {
  assertEquals(getConfiguredBrowserOrigins(`${allowedOrigin}, ${allowedOrigin}`), [allowedOrigin]);

  const result = prepareBrowserRequest(browserRequest(), {
    ...configuration,
    configuredOrigins: [allowedOrigin, allowedOrigin],
  });

  assertEquals(result.context.origin, allowedOrigin);
});

Deno.test('multiple distinct exact configured origins remain independently allowed', () => {
  const stagingOrigin = 'https://staging.theanimalalchemist.com';
  const configuredOrigins = getConfiguredBrowserOrigins(
    JSON.stringify([allowedOrigin, stagingOrigin])
  );
  const stagingRequest = browserRequest('POST', '{}', { origin: stagingOrigin });

  assertEquals(configuredOrigins, [allowedOrigin, stagingOrigin]);
  assertEquals(
    prepareBrowserRequest(stagingRequest, {
      configuredOrigins,
      configuredApiKeys: [browserApiKey],
    }).context.origin,
    stagingOrigin
  );
});

Deno.test('malformed configured origins remain rejected', () => {
  assertThrows(
    () => getConfiguredBrowserOrigins('https://www.theanimalalchemist.com/path'),
    Error,
    'TAA_BROWSER_ALLOWED_ORIGINS contains an invalid exact origin.'
  );
});

Deno.test('allowed browser requests reflect exact no-store CORS without credentials', () => {
  const result = prepareBrowserRequest(browserRequest(), configuration);
  const headers = result.context.responseHeaders;

  assertEquals(result.response, null);
  assertEquals(headers['Access-Control-Allow-Origin'], allowedOrigin);
  assertEquals(headers['Access-Control-Allow-Methods'], 'POST, OPTIONS');
  assertEquals(headers['Access-Control-Expose-Headers'], 'Retry-After');
  assertEquals(headers['Cache-Control'], 'no-store');
  assertEquals(headers.Vary, 'Origin');
  assert(!('Access-Control-Allow-Credentials' in headers));
  assert(headers['Access-Control-Allow-Origin'] !== '*');
  assert(headers['Access-Control-Allow-Headers'].includes('x-retry-count'));
});

Deno.test('preflight requires an allowed origin but does not require apikey', () => {
  const request = browserRequest('OPTIONS', '', { apikey: '' });
  const result = prepareBrowserRequest(request, configuration);

  assertEquals(result.response?.status, 204);
  assertEquals(result.response?.headers.get('access-control-allow-origin'), allowedOrigin);
});

for (const origin of ['', 'null', 'https://attacker.example', 'not an origin']) {
  Deno.test(`browser origin ${origin || 'missing'} is rejected`, () => {
    const request = browserRequest('POST', '{}', { origin });

    try {
      prepareBrowserRequest(request, configuration);
      throw new Error('Expected origin rejection.');
    } catch (error) {
      assert(error instanceof HttpSecurityError);
      assertEquals(error.status, 403);
    }
  });
}

for (const apikey of ['', 'wrong-key']) {
  Deno.test(`browser apikey ${apikey || 'missing'} is rejected`, () => {
    const request = browserRequest('POST', '{}', { apikey });

    try {
      prepareBrowserRequest(request, configuration);
      throw new Error('Expected API-key rejection.');
    } catch (error) {
      assert(error instanceof HttpSecurityError);
      assertEquals(error.status, 401);
      assertEquals(
        browserErrorResponse(error).headers.get('access-control-allow-origin'),
        allowedOrigin
      );
    }
  });
}

Deno.test(
  'publishable key JSON objects and legacy anon key are both admitted configurations',
  () => {
    assertEquals(
      getConfiguredBrowserApiKeys({
        publishableKeys: '{"default":"sb_publishable_one"}',
        anonKey: 'legacy-anon-key',
      }),
      ['sb_publishable_one', 'legacy-anon-key']
    );
  }
);

Deno.test(
  'bounded JSON accepts JSON with charset and rejects unsupported content type',
  async () => {
    assertEquals(await readBoundedJson(browserRequest(), 1024), {});

    await assertRejects(
      () => readBoundedJson(browserRequest('POST', '{}', { 'content-type': 'text/plain' }), 1024),
      HttpSecurityError,
      'Content-Type must be application/json.'
    );
  }
);

Deno.test('bounded JSON rejects Content-Length and streaming overflow', async () => {
  await assertRejects(
    () => readBoundedJson(browserRequest('POST', '{}', { 'content-length': '2048' }), 1024),
    HttpSecurityError,
    'Request body is too large.'
  );

  await assertRejects(
    () => readBoundedJson(browserRequest('POST', JSON.stringify({ value: 'x'.repeat(1024) })), 32),
    HttpSecurityError,
    'Request body is too large.'
  );
});

Deno.test('bounded JSON rejects malformed JSON', async () => {
  await assertRejects(
    () => readBoundedJson(browserRequest('POST', '{'), 1024),
    HttpSecurityError,
    'Invalid request body.'
  );
});

Deno.test('unsupported methods are rejected after browser admission', () => {
  const request = new Request('https://project.supabase.co/functions/v1/test', {
    method: 'GET',
    headers: { origin: allowedOrigin, apikey: browserApiKey },
  });

  try {
    prepareBrowserRequest(request, configuration);
    throw new Error('Expected method rejection.');
  } catch (error) {
    assert(error instanceof HttpSecurityError);
    assertEquals(error.status, 405);
  }
});
