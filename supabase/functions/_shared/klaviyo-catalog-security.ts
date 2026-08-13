import { HttpSecurityError, readBoundedJson, requireExactFields } from './http-security.ts';
import { requireInternalToken } from './internal-auth.ts';

const MAXIMUM_BODY_BYTES = 16 * 1024;
const ALLOWED_FIELDS = new Set(['source_table', 'operation', 'record_id']);
const ALLOWED_SOURCE_TABLES = new Set(['products', 'product_variants']);
const ALLOWED_OPERATIONS = new Set(['INSERT', 'UPDATE']);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function readKlaviyoCatalogSyncRequest(request: Request, internalSecret: string) {
  if (request.method !== 'POST') throw new HttpSecurityError('Method not allowed.', 405);

  if (
    !internalSecret ||
    !requireInternalToken(request, {
      headerName: 'x-taa-internal-token',
      currentSecret: internalSecret,
    })
  ) {
    throw new HttpSecurityError('Unauthorized.', 401);
  }

  const payload = await readBoundedJson(request, MAXIMUM_BODY_BYTES);
  requireExactFields(payload, ALLOWED_FIELDS);

  const sourceTable = String(payload.source_table || '').trim();
  const recordId = String(payload.record_id || '').trim();
  const operation = String(payload.operation || '')
    .trim()
    .toUpperCase();

  if (
    !ALLOWED_SOURCE_TABLES.has(sourceTable) ||
    !ALLOWED_OPERATIONS.has(operation) ||
    !UUID_PATTERN.test(recordId)
  ) {
    throw new HttpSecurityError('Catalog sync request is invalid.', 400);
  }

  return { sourceTable, operation, recordId };
}
