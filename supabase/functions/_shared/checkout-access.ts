import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.112.2';
import { CheckoutInputError, cleanText } from './checkout-catalog.ts';

export const CONFIRMATION_CAPABILITY_TTL_MS = 24 * 60 * 60 * 1000;

export function normalizeUkCountry(value: unknown, required = true) {
  const country = cleanText(value, 50).toUpperCase();

  if (country === 'GB' || country === 'UK' || country === 'UNITED KINGDOM') return 'GB';
  if (!country && !required) return '';

  throw new CheckoutInputError('Checkout currently supports United Kingdom delivery only.');
}

export function cleanCheckoutAddress(
  value: unknown,
  { label = 'shipping', requireComplete = true } = {}
) {
  const address = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const cleanedAddress = {
    first_name: cleanText(address.first_name, 100),
    last_name: cleanText(address.last_name, 100),
    company: cleanText(address.company, 200),
    address_1: cleanText(address.address_1, 200),
    address_2: cleanText(address.address_2, 200),
    city: cleanText(address.city, 100),
    county: cleanText(address.county, 100),
    postcode: cleanText(address.postcode, 30),
    country: normalizeUkCountry(address.country, requireComplete),
  };

  if (!requireComplete) return cleanedAddress;

  const requiredFields = [
    cleanedAddress.first_name,
    cleanedAddress.last_name,
    cleanedAddress.address_1,
    cleanedAddress.city,
    cleanedAddress.postcode,
    cleanedAddress.country,
  ];

  if (requiredFields.some((field) => !field)) {
    throw new CheckoutInputError(`Please complete the required ${label} address fields.`);
  }

  return cleanedAddress;
}

function getBearerToken(request: Request) {
  const authorization = request.headers.get('authorization') || '';
  const [scheme, token] = authorization.split(' ');

  return scheme?.toLowerCase() === 'bearer' && token ? token : null;
}

export async function getAuthenticatedUser(supabase: SupabaseClient, request: Request) {
  const token = getBearerToken(request);

  if (!token) return null;

  const { data, error } = await supabase.auth.getUser(token);

  return error ? null : data.user;
}

export async function sha256Hex(value: string | Uint8Array) {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  ) as ArrayBuffer;
  const digest = await crypto.subtle.digest('SHA-256', buffer);

  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function constantTimeEqual(left: string, right: string) {
  const maximumLength = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;

  for (let index = 0; index < maximumLength; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }

  return difference === 0;
}

export async function authorizeCheckoutAccess(
  supabase: SupabaseClient,
  request: Request,
  checkoutSessionId: string,
  confirmationToken: string
) {
  const { data: checkoutIntent, error } = await supabase
    .from('checkout_intents')
    .select(
      'id, user_id, confirmation_token_hash, confirmation_token_expires_at, status, shipping_name, shipping_phone, shipping_address, billing_name, billing_address, billing_is_different, stripe_coupon_id'
    )
    .eq('stripe_checkout_session_id', checkoutSessionId)
    .maybeSingle();

  if (error) throw new Error('Checkout authorization lookup failed.');
  if (!checkoutIntent) return { authorized: false, checkoutIntent: null };

  const authenticatedUser = await getAuthenticatedUser(supabase, request);
  const ownsCheckout = Boolean(
    authenticatedUser?.id && checkoutIntent.user_id === authenticatedUser.id
  );
  let hasValidCapability = false;

  if (
    confirmationToken &&
    checkoutIntent.confirmation_token_hash &&
    checkoutIntent.confirmation_token_expires_at &&
    new Date(checkoutIntent.confirmation_token_expires_at).getTime() > Date.now()
  ) {
    const suppliedTokenHash = await sha256Hex(confirmationToken);
    hasValidCapability = constantTimeEqual(
      suppliedTokenHash,
      checkoutIntent.confirmation_token_hash
    );
  }

  return {
    authorized: ownsCheckout || hasValidCapability,
    checkoutIntent,
  };
}
