import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.112.2';
import type { BrowserSecurityContext } from './http-security.ts';
import { jsonResponse } from './http-security.ts';

export type RateLimitPolicy = {
  name: string;
  refillTokens: number;
  refillWindowSeconds: number;
  burstCapacity?: number;
};

export type RateLimitDimension = {
  identity: string;
  policy: RateLimitPolicy;
};

export const RATE_LIMIT_POLICIES = Object.freeze({
  sharedNetwork: {
    name: 'network_shared',
    refillTokens: 120,
    refillWindowSeconds: 300,
    burstCapacity: 30,
  },
  shippingMinute: { name: 'shipping_minute', refillTokens: 20, refillWindowSeconds: 60 },
  shippingTenMinutes: { name: 'shipping_ten_minutes', refillTokens: 80, refillWindowSeconds: 600 },
  checkoutMinute: { name: 'checkout_minute', refillTokens: 12, refillWindowSeconds: 60 },
  checkoutHour: { name: 'checkout_hour', refillTokens: 60, refillWindowSeconds: 3600 },
  checkoutAttempt: { name: 'checkout_attempt', refillTokens: 60, refillWindowSeconds: 7200 },
  checkoutRequest: { name: 'checkout_request', refillTokens: 12, refillWindowSeconds: 600 },
  abandonMinute: { name: 'abandon_minute', refillTokens: 6, refillWindowSeconds: 60 },
  abandonHour: { name: 'abandon_hour', refillTokens: 20, refillWindowSeconds: 3600 },
  abandonAttempt: { name: 'abandon_attempt', refillTokens: 6, refillWindowSeconds: 600 },
  updateMinute: { name: 'update_minute', refillTokens: 20, refillWindowSeconds: 60 },
  updateCheckout: { name: 'update_checkout', refillTokens: 12, refillWindowSeconds: 600 },
  confirmationMinute: { name: 'confirmation_minute', refillTokens: 60, refillWindowSeconds: 60 },
  confirmationHour: { name: 'confirmation_hour', refillTokens: 240, refillWindowSeconds: 3600 },
  confirmationCheckoutMinute: {
    name: 'confirmation_checkout_minute',
    refillTokens: 20,
    refillWindowSeconds: 60,
  },
  confirmationCheckoutDay: {
    name: 'confirmation_checkout_day',
    refillTokens: 120,
    refillWindowSeconds: 86400,
  },
} satisfies Record<string, RateLimitPolicy>);

export class RateLimitError extends Error {
  constructor(
    public readonly retryAfterSeconds: number,
    public readonly scope: string,
    public readonly checkoutRequestAdmitted: boolean | null = null
  ) {
    super('Too many requests. Please wait and try again.');
    this.name = 'RateLimitError';
  }
}

export class RateLimitServiceError extends Error {
  constructor() {
    super('Request admission is temporarily unavailable.');
    this.name = 'RateLimitServiceError';
  }
}

function requireRateLimitPepper() {
  const pepper = Deno.env.get('TAA_RATE_LIMIT_PEPPER')?.trim();

  if (!pepper) throw new RateLimitServiceError();

  return pepper;
}

function normalizeIpv4(value: string) {
  const parts = value.split('.');

  if (parts.length !== 4) return null;

  const numbers = parts.map(Number);

  if (numbers.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;

  return numbers.join('.');
}

function normalizeIpv6(value: string) {
  let input = value.toLowerCase();

  if (input.startsWith('[') && input.includes(']')) input = input.slice(1, input.indexOf(']'));
  input = input.split('%')[0];

  const doubleColonParts = input.split('::');

  if (doubleColonParts.length > 2) return null;

  const left = doubleColonParts[0] ? doubleColonParts[0].split(':') : [];
  const right = doubleColonParts[1] ? doubleColonParts[1].split(':') : [];
  const missing = 8 - left.length - right.length;

  if ((doubleColonParts.length === 1 && missing !== 0) || missing < 0) return null;

  const groups =
    doubleColonParts.length === 2 ? [...left, ...Array(missing).fill('0'), ...right] : left;

  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return null;

  // A /64 network prevents rotating interface identifiers from bypassing a network budget.
  return `${groups
    .slice(0, 4)
    .map((group) => Number.parseInt(group, 16).toString(16))
    .join(':')}::/64`;
}

export function getNormalizedNetworkIdentity(request: Request) {
  const forwardedFor = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || '';
  const ipv4Candidate = forwardedFor.replace(/:\d+$/, '');
  const ipv4 = normalizeIpv4(ipv4Candidate);

  if (ipv4) return `ipv4:${ipv4}`;

  const ipv6 = normalizeIpv6(forwardedFor);

  if (ipv6) return `ipv6:${ipv6}`;

  throw new RateLimitServiceError();
}

export async function deriveRateLimitIdentity(secret: string, value: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(value));

  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, '0')).join(
    ''
  );
}

export async function getNetworkRateLimitIdentity(request: Request) {
  return deriveRateLimitIdentity(requireRateLimitPepper(), getNormalizedNetworkIdentity(request));
}

export async function getAuthoritativeRateLimitIdentity(scope: string, identity: string) {
  if (!scope || !identity) throw new RateLimitServiceError();

  return deriveRateLimitIdentity(requireRateLimitPepper(), `${scope}:${identity}`);
}

export function getNetworkDimensions(
  networkIdentity: string,
  endpointPolicies: readonly RateLimitPolicy[]
) {
  return [
    { identity: `network:shared:${networkIdentity}`, policy: RATE_LIMIT_POLICIES.sharedNetwork },
    ...endpointPolicies.map((policy) => ({
      identity: `network:${policy.name}:${networkIdentity}`,
      policy,
    })),
  ];
}

export function getAuthoritativeDimensions(
  authoritativeIdentity: string,
  policies: readonly RateLimitPolicy[]
) {
  return policies.map((policy) => ({
    identity: `authority:${policy.name}:${authoritativeIdentity}`,
    policy,
  }));
}

export async function consumeRateLimits(
  supabase: SupabaseClient,
  dimensions: readonly RateLimitDimension[],
  {
    scope,
    checkoutRequestAdmitted = null,
  }: { scope: string; checkoutRequestAdmitted?: boolean | null }
) {
  if (dimensions.length === 0) return;

  const buckets = dimensions.map(({ identity, policy }) => ({
    bucket_key: identity,
    dimension: policy.name,
    refill_tokens: policy.refillTokens,
    refill_window_seconds: policy.refillWindowSeconds,
    burst_capacity: policy.burstCapacity || policy.refillTokens,
  }));
  const { data, error } = await supabase.rpc('consume_edge_rate_limits', {
    p_buckets: buckets,
  });

  if (error) throw new RateLimitServiceError();

  const result = Array.isArray(data) ? data[0] : data;

  if (!result || typeof result.allowed !== 'boolean') {
    throw new RateLimitServiceError();
  }

  if (!result.allowed) {
    throw new RateLimitError(
      Math.max(1, Math.ceil(Number(result.retry_after_seconds) || 1)),
      scope,
      checkoutRequestAdmitted
    );
  }
}

export function rateLimitResponse(context: BrowserSecurityContext, error: RateLimitError) {
  return jsonResponse(
    context,
    {
      error: error.message,
      checkout_orchestration_error: 'rate_limited',
      rate_limit_scope: error.scope,
      ...(error.checkoutRequestAdmitted === null
        ? {}
        : { checkout_request_admitted: error.checkoutRequestAdmitted }),
      retry_after_seconds: error.retryAfterSeconds,
    },
    429,
    { 'Retry-After': String(error.retryAfterSeconds) }
  );
}
