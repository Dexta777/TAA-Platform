import { randomUUID } from 'node:crypto';
import process from 'node:process';
import { clearTimeout, setTimeout } from 'node:timers';
import { URL } from 'node:url';

export const ACTION = 'emergency_disable_checkout_reservations';
export const MANAGEMENT_API_ORIGIN = 'https://api.supabase.com';
export const TARGET_SECRET_NAME = 'CHECKOUT_RESERVATIONS_ENABLED';

const PROJECT_REF_ENV = 'TAA_MODEL_B_SUPABASE_PROJECT_REF';
const CREDENTIAL_SECRET_ARN_ENV = 'TAA_MODEL_B_CREDENTIAL_SECRET_ARN';
const TIMEOUT_ENV = 'TAA_MODEL_B_TIMEOUT_MS';
const PROJECT_REF_PATTERN = /^[a-z0-9]{20}$/;
const CREDENTIAL_SECRET_ARN_PATTERN =
  /^arn:(?:aws|aws-us-gov|aws-cn):secretsmanager:[a-z0-9-]+:\d{12}:secret:taa\/model-b\/supabase-management-token-[A-Za-z0-9]{6}$/;
const DEFAULT_TIMEOUT_MS = 8_000;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 10_000;

export class ModelBRollbackError extends Error {
  constructor(code) {
    super(code);
    this.name = 'ModelBRollbackError';
    this.code = code;
  }
}

function isEmptyInvocation(event) {
  if (event === undefined || event === null) return true;
  return (
    typeof event === 'object' &&
    !Array.isArray(event) &&
    Object.getPrototypeOf(event) === Object.prototype &&
    Object.keys(event).length === 0
  );
}

function readConfiguration(env) {
  const projectRef = env[PROJECT_REF_ENV]?.trim();
  const credentialSecretArn = env[CREDENTIAL_SECRET_ARN_ENV]?.trim();
  const timeoutRaw = env[TIMEOUT_ENV]?.trim();
  const timeoutMs = timeoutRaw === undefined ? DEFAULT_TIMEOUT_MS : Number(timeoutRaw);

  if (!projectRef || !PROJECT_REF_PATTERN.test(projectRef)) {
    throw new ModelBRollbackError('internal_configuration_invalid');
  }

  if (!credentialSecretArn || !CREDENTIAL_SECRET_ARN_PATTERN.test(credentialSecretArn)) {
    throw new ModelBRollbackError('internal_configuration_invalid');
  }

  if (!Number.isInteger(timeoutMs) || timeoutMs < MIN_TIMEOUT_MS || timeoutMs > MAX_TIMEOUT_MS) {
    throw new ModelBRollbackError('internal_configuration_invalid');
  }

  return { projectRef, credentialSecretArn, timeoutMs };
}

async function readManagementTokenFromSecretsManager(credentialSecretArn) {
  const { GetSecretValueCommand, SecretsManagerClient } =
    await import('@aws-sdk/client-secrets-manager');
  const client = new SecretsManagerClient({});
  const response = await client.send(
    new GetSecretValueCommand({
      SecretId: credentialSecretArn,
    })
  );
  const token = response.SecretString?.trim();

  if (!token) {
    throw new ModelBRollbackError('credential_unavailable');
  }

  return token;
}

function classifyHttpFailure(status) {
  if (status === 401) return 'management_api_unauthorized';
  if (status === 403) return 'management_api_forbidden';
  if (status === 429) return 'management_api_rate_limited';
  return 'management_api_unexpected_status';
}

function emitSafeFailure(logger, reasonCode) {
  logger.error({
    event: 'model_b_rollback_failed',
    action: ACTION,
    reason_code: reasonCode,
  });
}

function fail(logger, reasonCode) {
  emitSafeFailure(logger, reasonCode);
  throw new ModelBRollbackError(reasonCode);
}

export function createHandler({
  env = process.env,
  fetchImpl = globalThis.fetch,
  readManagementToken = readManagementTokenFromSecretsManager,
  logger = globalThis.console,
  createReceiptId = randomUUID,
  now = () => new Date(),
} = {}) {
  return async function disableCheckoutReservations(event) {
    if (!isEmptyInvocation(event)) {
      fail(logger, 'caller_input_not_allowed');
    }

    let configuration;
    try {
      configuration = readConfiguration(env);
    } catch {
      fail(logger, 'internal_configuration_invalid');
    }

    let managementToken;
    try {
      managementToken = await readManagementToken(configuration.credentialSecretArn);
    } catch {
      fail(logger, 'credential_unavailable');
    }

    if (typeof managementToken !== 'string' || managementToken.trim() === '') {
      fail(logger, 'credential_unavailable');
    }

    const controller = new globalThis.AbortController();
    const timeout = setTimeout(() => controller.abort(), configuration.timeoutMs);
    const targetUrl = new URL(
      `/v1/projects/${encodeURIComponent(configuration.projectRef)}/secrets`,
      MANAGEMENT_API_ORIGIN
    );

    let response;
    try {
      response = await fetchImpl(targetUrl, {
        method: 'DELETE',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${managementToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify([TARGET_SECRET_NAME]),
        signal: controller.signal,
      });
    } catch {
      clearTimeout(timeout);
      fail(
        logger,
        controller.signal.aborted ? 'management_api_timeout' : 'management_api_network_error'
      );
    }
    clearTimeout(timeout);

    if (!response || response.status !== 200) {
      fail(logger, classifyHttpFailure(response?.status));
    }

    const receipt = {
      action: ACTION,
      result: 'OFF_CONFIRMED',
      verified_off: true,
      receipt_id: createReceiptId(),
      completed_at_utc: now().toISOString(),
    };

    logger.info({
      event: 'model_b_rollback_completed',
      ...receipt,
    });

    return receipt;
  };
}

export const handler = createHandler();
