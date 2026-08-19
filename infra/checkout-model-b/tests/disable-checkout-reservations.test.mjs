import assert from 'node:assert/strict';
import test from 'node:test';
import { URL } from 'node:url';

import {
  ACTION,
  MANAGEMENT_API_ORIGIN,
  ModelBRollbackError,
  TARGET_SECRET_NAME,
  createHandler,
} from '../src/disable-checkout-reservations.mjs';

const FIXED_PROJECT_REF = 'abcdefghijklmnopqrst';
const FIXED_SECRET_ARN =
  'arn:aws:secretsmanager:eu-west-1:111122223333:secret:taa/model-b/supabase-management-token-ABC123';
const TOKEN = 'test-management-token-do-not-log';

function createHarness({
  event = {},
  status = 200,
  fetchImpl,
  envOverrides = {},
  token = TOKEN,
} = {}) {
  const requests = [];
  const logs = [];
  let responseBodyReads = 0;

  const resolvedFetch =
    fetchImpl ??
    (async (url, init) => {
      requests.push({ url, init });
      return {
        status,
        async text() {
          responseBodyReads += 1;
          return 'provider-response-must-not-be-read';
        },
      };
    });

  const handler = createHandler({
    env: {
      TAA_MODEL_B_SUPABASE_PROJECT_REF: FIXED_PROJECT_REF,
      TAA_MODEL_B_CREDENTIAL_SECRET_ARN: FIXED_SECRET_ARN,
      TAA_MODEL_B_TIMEOUT_MS: '1000',
      ...envOverrides,
    },
    fetchImpl: resolvedFetch,
    readManagementToken: async () => token,
    logger: {
      info: (...values) => logs.push(['info', ...values]),
      error: (...values) => logs.push(['error', ...values]),
    },
    createReceiptId: () => '11111111-2222-4333-8444-555555555555',
    now: () => new Date('2026-08-19T20:00:00.000Z'),
  });

  return {
    event,
    handler,
    logs,
    requests,
    getResponseBodyReads: () => responseBodyReads,
  };
}

async function expectSafeFailure(harness, code) {
  await assert.rejects(
    () => harness.handler(harness.event),
    (error) => error instanceof ModelBRollbackError && error.code === code && error.message === code
  );
}

test('sends exactly one fixed DELETE request and returns a safe receipt', async () => {
  const harness = createHarness();
  const receipt = await harness.handler(harness.event);

  assert.equal(harness.requests.length, 1);
  const [{ url, init }] = harness.requests;
  assert.equal(url.origin, MANAGEMENT_API_ORIGIN);
  assert.equal(url.pathname, `/v1/projects/${FIXED_PROJECT_REF}/secrets`);
  assert.equal(init.method, 'DELETE');
  assert.equal(init.body, JSON.stringify([TARGET_SECRET_NAME]));
  assert.deepEqual(JSON.parse(init.body), ['CHECKOUT_RESERVATIONS_ENABLED']);
  assert.deepEqual(receipt, {
    action: ACTION,
    result: 'OFF_CONFIRMED',
    verified_off: true,
    receipt_id: '11111111-2222-4333-8444-555555555555',
    completed_at_utc: '2026-08-19T20:00:00.000Z',
  });
  assert.equal(harness.getResponseBodyReads(), 0);
});

test('rejects every meaningful caller payload before reading credentials or calling the API', async () => {
  for (const event of [
    { project_ref: 'attacker-project-ref' },
    { secret_name: 'ANOTHER_SECRET' },
    { method: 'POST' },
    { url: 'https://example.invalid' },
    { lambda_arn: 'arn:aws:lambda:example' },
    ['CHECKOUT_RESERVATIONS_ENABLED'],
    'arbitrary-command',
  ]) {
    let tokenReads = 0;
    let fetchCalls = 0;
    const logs = [];
    const handler = createHandler({
      env: {
        TAA_MODEL_B_SUPABASE_PROJECT_REF: FIXED_PROJECT_REF,
        TAA_MODEL_B_CREDENTIAL_SECRET_ARN: FIXED_SECRET_ARN,
      },
      readManagementToken: async () => {
        tokenReads += 1;
        return TOKEN;
      },
      fetchImpl: async () => {
        fetchCalls += 1;
        return { status: 200 };
      },
      logger: {
        info: (...values) => logs.push(values),
        error: (...values) => logs.push(values),
      },
    });

    await assert.rejects(() => handler(event), {
      code: 'caller_input_not_allowed',
    });
    assert.equal(tokenReads, 0);
    assert.equal(fetchCalls, 0);
  }
});

test('fails closed for malformed immutable configuration', async () => {
  for (const envOverrides of [
    { TAA_MODEL_B_SUPABASE_PROJECT_REF: '' },
    { TAA_MODEL_B_SUPABASE_PROJECT_REF: 'not-a-project-ref' },
    { TAA_MODEL_B_CREDENTIAL_SECRET_ARN: '' },
    { TAA_MODEL_B_CREDENTIAL_SECRET_ARN: 'arn:aws:secretsmanager:wrong-secret' },
    {
      TAA_MODEL_B_CREDENTIAL_SECRET_ARN:
        'arn:aws:secretsmanager:eu-west-1:111122223333:secret:taa/model-b/supabase-management-token-ABC123:other',
    },
    { TAA_MODEL_B_TIMEOUT_MS: '999' },
    { TAA_MODEL_B_TIMEOUT_MS: '10001' },
    { TAA_MODEL_B_TIMEOUT_MS: 'not-a-number' },
  ]) {
    await expectSafeFailure(createHarness({ envOverrides }), 'internal_configuration_invalid');
  }
});

test('fails closed when the dedicated credential cannot be read', async () => {
  await expectSafeFailure(createHarness({ token: '' }), 'credential_unavailable');
});

for (const [status, code] of [
  [401, 'management_api_unauthorized'],
  [403, 'management_api_forbidden'],
  [429, 'management_api_rate_limited'],
  [201, 'management_api_unexpected_status'],
  [204, 'management_api_unexpected_status'],
  [500, 'management_api_unexpected_status'],
]) {
  test(`fails closed on HTTP ${status}`, async () => {
    await expectSafeFailure(createHarness({ status }), code);
  });
}

test('fails closed on a network error without returning the raw error', async () => {
  const harness = createHarness({
    fetchImpl: async () => {
      throw new Error('raw-network-detail-must-not-escape');
    },
  });

  await expectSafeFailure(harness, 'management_api_network_error');
  assert.doesNotMatch(JSON.stringify(harness.logs), /raw-network-detail-must-not-escape/);
});

test('failure responses are classified without reading or logging the provider body', async () => {
  const harness = createHarness({ status: 403 });

  await expectSafeFailure(harness, 'management_api_forbidden');
  assert.equal(harness.getResponseBodyReads(), 0);
  assert.doesNotMatch(JSON.stringify(harness.logs), /provider-response-must-not-be-read/);
});

test('fails closed when the Management API request times out', async () => {
  const harness = createHarness({
    fetchImpl: (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      }),
  });

  await expectSafeFailure(harness, 'management_api_timeout');
});

test('never logs the token, Authorization header, project ref, or provider response body', async () => {
  const harness = createHarness();
  await harness.handler(harness.event);
  const serializedLogs = JSON.stringify(harness.logs);

  assert.doesNotMatch(serializedLogs, new RegExp(TOKEN));
  assert.doesNotMatch(serializedLogs, /Authorization/i);
  assert.doesNotMatch(serializedLogs, new RegExp(FIXED_PROJECT_REF));
  assert.doesNotMatch(serializedLogs, /provider-response-must-not-be-read/);
  assert.equal(harness.getResponseBodyReads(), 0);
});

test('two successful delete responses produce two safe idempotent confirmations', async () => {
  const harness = createHarness();
  const first = await harness.handler({});
  const second = await harness.handler({});

  assert.equal(first.result, 'OFF_CONFIRMED');
  assert.equal(first.verified_off, true);
  assert.equal(second.result, 'OFF_CONFIRMED');
  assert.equal(second.verified_off, true);
  assert.equal(harness.requests.length, 2);
  assert.equal(harness.requests[0].init.method, 'DELETE');
  assert.equal(harness.requests[1].init.method, 'DELETE');
});

test('credential lookup receives only the fixed configured AWS secret ARN', async () => {
  const requestedSecretArns = [];
  const handler = createHandler({
    env: {
      TAA_MODEL_B_SUPABASE_PROJECT_REF: FIXED_PROJECT_REF,
      TAA_MODEL_B_CREDENTIAL_SECRET_ARN: FIXED_SECRET_ARN,
      TAA_MODEL_B_TIMEOUT_MS: '1000',
    },
    readManagementToken: async (secretArn) => {
      requestedSecretArns.push(secretArn);
      return TOKEN;
    },
    fetchImpl: async () => ({ status: 200 }),
    logger: { info: () => {}, error: () => {} },
    createReceiptId: () => '11111111-2222-4333-8444-555555555555',
    now: () => new Date('2026-08-19T20:00:00.000Z'),
  });

  await handler({});
  assert.deepEqual(requestedSecretArns, [FIXED_SECRET_ARN]);
});

test('source exposes no alternate Management API method or secret-read path', async () => {
  const source = await import('node:fs/promises').then(({ readFile }) =>
    readFile(new URL('../src/disable-checkout-reservations.mjs', import.meta.url), 'utf8')
  );

  assert.doesNotMatch(source, /method:\s*['"](?:GET|POST|PUT|PATCH)['"]/);
  assert.doesNotMatch(source, /\/secrets\?\/|\/secrets\/[^`'"\s]/);
  assert.equal((source.match(/method:\s*'DELETE'/g) ?? []).length, 1);
  assert.match(source, /JSON\.stringify\(\[TARGET_SECRET_NAME\]\)/);
});
