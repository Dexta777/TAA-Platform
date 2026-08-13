import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.112.2';
import {
  CheckoutInputError,
  getCanonicalShippingOptions,
  resolveCanonicalCart,
} from '../_shared/checkout-catalog.ts';
import {
  browserErrorResponse,
  type BrowserSecurityContext,
  HttpSecurityError,
  jsonResponse,
  prepareBrowserRequest,
  readBoundedJson,
  rejectOversizeContentLength,
  requireExactFields,
  requireJsonContentType,
} from '../_shared/http-security.ts';
import {
  consumeRateLimits,
  getNetworkDimensions,
  getNetworkRateLimitIdentity,
  RATE_LIMIT_POLICIES,
  RateLimitError,
  RateLimitServiceError,
  rateLimitResponse,
} from '../_shared/rate-limit.ts';

const MAXIMUM_BODY_BYTES = 32 * 1024;
const ALLOWED_FIELDS = new Set(['cart']);

function requireEnvironment(name: string) {
  const value = Deno.env.get(name)?.trim();

  if (!value) throw new Error(`Missing required environment variable: ${name}`);

  return value;
}

const supabase = createClient(
  requireEnvironment('SUPABASE_URL'),
  requireEnvironment('SUPABASE_SERVICE_ROLE_KEY'),
  { auth: { persistSession: false, autoRefreshToken: false } }
);

serve(async (request) => {
  let context: BrowserSecurityContext | null = null;

  try {
    const ingress = prepareBrowserRequest(request);
    context = ingress.context;

    if (ingress.response) return ingress.response;

    requireJsonContentType(request);
    rejectOversizeContentLength(request, MAXIMUM_BODY_BYTES);
    const networkIdentity = await getNetworkRateLimitIdentity(request);
    await consumeRateLimits(
      supabase,
      getNetworkDimensions(networkIdentity, [
        RATE_LIMIT_POLICIES.shippingMinute,
        RATE_LIMIT_POLICIES.shippingTenMinutes,
      ]),
      { scope: 'shipping_network' }
    );
    const payload = await readBoundedJson(request, MAXIMUM_BODY_BYTES);
    requireExactFields(payload, ALLOWED_FIELDS);

    const cart = Array.isArray(payload.cart) ? payload.cart : [];
    const items = await resolveCanonicalCart(supabase, cart);
    const subtotal = items.reduce((total, item) => total + item.line_total, 0);
    const totalWeightGrams = items.reduce((total, item) => total + item.weight_grams, 0);

    if (totalWeightGrams <= 0) {
      throw new CheckoutInputError('Basket weight could not be calculated.');
    }

    const options = await getCanonicalShippingOptions(supabase, totalWeightGrams);

    return jsonResponse(context, {
      subtotal,
      total_weight_grams: totalWeightGrams,
      currency: 'gbp',
      options: options.map((option) => ({
        ...option,
        total: subtotal + option.shipping,
      })),
      items,
    });
  } catch (error) {
    if (error instanceof RateLimitError && context) return rateLimitResponse(context, error);
    if (error instanceof HttpSecurityError) return browserErrorResponse(error, context);
    if (error instanceof RateLimitServiceError && context) {
      return jsonResponse(context, { error: error.message }, 503);
    }

    console.error('GET SHIPPING OPTIONS ERROR:', {
      error_name: error instanceof Error ? error.name : 'unknown',
    });

    if (error instanceof CheckoutInputError) {
      return context
        ? jsonResponse(context, { error: error.message }, 400)
        : browserErrorResponse(error);
    }

    return context
      ? jsonResponse(context, { error: 'Shipping options could not be loaded.' }, 500)
      : browserErrorResponse(error);
  }
});
