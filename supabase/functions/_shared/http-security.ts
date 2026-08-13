import { corsHeaders as supabaseCorsHeaders } from 'npm:@supabase/supabase-js@2.112.2/cors';

const JSON_CONTENT_TYPE_PATTERN = /^application\/json(?:\s*;\s*charset=utf-8)?$/i;

export class HttpSecurityError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly responseHeaders: Record<string, string> | null = null
  ) {
    super(message);
    this.name = 'HttpSecurityError';
  }
}

export type BrowserSecurityContext = {
  origin: string;
  responseHeaders: Record<string, string>;
};

function constantTimeEqual(left: string, right: string) {
  const maximumLength = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;

  for (let index = 0; index < maximumLength; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }

  return difference === 0;
}

function constantTimeMatchesAny(supplied: string, configured: readonly string[]) {
  let matched = 0;

  for (const value of configured) matched |= Number(constantTimeEqual(supplied, value));

  return matched === 1;
}

function parseConfiguredValues(value: string | undefined) {
  const trimmed = value?.trim();

  if (!trimmed) return [];

  try {
    const parsed = JSON.parse(trimmed);

    if (Array.isArray(parsed)) return parsed.map(String);
    if (parsed && typeof parsed === 'object') return Object.values(parsed).map(String);
  } catch {
    // Comma-separated configuration remains supported for local environments.
  }

  return trimmed.split(',');
}

function canonicalizeBrowserOrigins(origins: readonly string[]) {
  const canonicalOrigins = origins
    .map((origin) => origin.trim())
    .filter(Boolean)
    .map((origin) => {
      const url = new URL(origin);
      const canonicalOrigin = url.origin;

      if (canonicalOrigin !== origin || !['http:', 'https:'].includes(url.protocol)) {
        throw new Error('TAA_BROWSER_ALLOWED_ORIGINS contains an invalid exact origin.');
      }

      return canonicalOrigin;
    });

  if (canonicalOrigins.length === 0) {
    throw new Error('TAA_BROWSER_ALLOWED_ORIGINS is not configured.');
  }

  return [...new Set(canonicalOrigins)];
}

export function getConfiguredBrowserOrigins(value = Deno.env.get('TAA_BROWSER_ALLOWED_ORIGINS')) {
  return canonicalizeBrowserOrigins(parseConfiguredValues(value));
}

export function getConfiguredBrowserApiKeys({
  publishableKeys = Deno.env.get('SUPABASE_PUBLISHABLE_KEYS'),
  anonKey = Deno.env.get('SUPABASE_ANON_KEY'),
} = {}) {
  const keys = [...parseConfiguredValues(publishableKeys), anonKey || '']
    .map((key) => key.trim())
    .filter(Boolean);

  if (keys.length === 0) throw new Error('Supabase browser API keys are not configured.');

  return [...new Set(keys)];
}

export function getBrowserCorsHeaders(origin: string) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': supabaseCorsHeaders['Access-Control-Allow-Headers'],
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Expose-Headers': 'Retry-After',
    Vary: 'Origin',
    'Cache-Control': 'no-store',
  };
}

function requireAllowedOrigin(request: Request, configuredOrigins?: string[]) {
  const origin = request.headers.get('origin')?.trim() || '';

  if (!origin || origin === 'null') {
    throw new HttpSecurityError('Browser origin is not allowed.', 403);
  }

  try {
    const parsed = new URL(origin);

    if (parsed.origin !== origin) throw new Error('Not an exact origin.');
  } catch {
    throw new HttpSecurityError('Browser origin is not allowed.', 403);
  }

  const allowedOrigins = configuredOrigins
    ? canonicalizeBrowserOrigins(configuredOrigins)
    : getConfiguredBrowserOrigins();

  if (!constantTimeMatchesAny(origin, allowedOrigins)) {
    throw new HttpSecurityError('Browser origin is not allowed.', 403);
  }

  return origin;
}

function requireBrowserApiKey(request: Request, configuredApiKeys?: string[]) {
  const suppliedApiKey = request.headers.get('apikey')?.trim() || '';
  const apiKeys = configuredApiKeys || getConfiguredBrowserApiKeys();

  if (!suppliedApiKey || !constantTimeMatchesAny(suppliedApiKey, apiKeys)) {
    throw new HttpSecurityError('Browser API key is invalid.', 401);
  }
}

export function browserErrorResponse(error: unknown, context?: BrowserSecurityContext | null) {
  const status = error instanceof HttpSecurityError ? error.status : 500;
  const message =
    error instanceof HttpSecurityError ? error.message : 'Request security could not be validated.';

  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      ...(context?.responseHeaders || {}),
      ...(!context && error instanceof HttpSecurityError && error.responseHeaders
        ? error.responseHeaders
        : {}),
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

export function prepareBrowserRequest(
  request: Request,
  {
    configuredOrigins,
    configuredApiKeys,
  }: { configuredOrigins?: string[]; configuredApiKeys?: string[] } = {}
) {
  const origin = requireAllowedOrigin(request, configuredOrigins);
  const context: BrowserSecurityContext = {
    origin,
    responseHeaders: getBrowserCorsHeaders(origin),
  };

  if (request.method === 'OPTIONS') {
    return {
      context,
      response: new Response(null, { status: 204, headers: context.responseHeaders }),
    };
  }

  try {
    requireBrowserApiKey(request, configuredApiKeys);

    if (request.method !== 'POST') {
      throw new HttpSecurityError('Method not allowed.', 405);
    }
  } catch (error) {
    if (error instanceof HttpSecurityError) {
      throw new HttpSecurityError(error.message, error.status, context.responseHeaders);
    }

    throw error;
  }

  return { context, response: null };
}

export function requireJsonContentType(request: Request) {
  const contentType = request.headers.get('content-type')?.trim() || '';

  if (!JSON_CONTENT_TYPE_PATTERN.test(contentType)) {
    throw new HttpSecurityError('Content-Type must be application/json.', 415);
  }
}

export function rejectOversizeContentLength(request: Request, maximumBytes: number) {
  const contentLength = request.headers.get('content-length');

  if (!contentLength) return;

  const parsedLength = Number(contentLength);

  if (!Number.isSafeInteger(parsedLength) || parsedLength < 0) {
    throw new HttpSecurityError('Content-Length is invalid.', 400);
  }

  if (parsedLength > maximumBytes) {
    throw new HttpSecurityError('Request body is too large.', 413);
  }
}

export async function readBoundedBody(request: Request, maximumBytes: number) {
  rejectOversizeContentLength(request, maximumBytes);

  if (!request.body) return '';

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) break;

      totalBytes += value.byteLength;

      if (totalBytes > maximumBytes) {
        await reader.cancel();
        throw new HttpSecurityError('Request body is too large.', 413);
      }

      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;

  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(body);
  } catch {
    throw new HttpSecurityError('Invalid request body.', 400);
  }
}

export async function readBoundedJsonWithSize(request: Request, maximumBytes: number) {
  requireJsonContentType(request);

  let rawBody: string;

  try {
    rawBody = await readBoundedBody(request, maximumBytes);
  } catch (error) {
    if (error instanceof HttpSecurityError) throw error;
    throw new HttpSecurityError('Invalid request body.', 400);
  }

  try {
    const payload = JSON.parse(rawBody);

    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error('Expected an object.');
    }

    return {
      payload: payload as Record<string, unknown>,
      byteLength: new TextEncoder().encode(rawBody).byteLength,
    };
  } catch {
    throw new HttpSecurityError('Invalid request body.', 400);
  }
}

export async function readBoundedJson(request: Request, maximumBytes: number) {
  return (await readBoundedJsonWithSize(request, maximumBytes)).payload;
}

export function requireExactFields(
  payload: Record<string, unknown>,
  allowedFields: ReadonlySet<string>,
  message = 'Request contains unsupported fields.'
) {
  if (Object.keys(payload).some((field) => !allowedFields.has(field))) {
    throw new HttpSecurityError(message, 400);
  }
}

export function jsonResponse(
  context: BrowserSecurityContext,
  payload: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {}
) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...context.responseHeaders,
      ...extraHeaders,
      'Content-Type': 'application/json',
    },
  });
}
