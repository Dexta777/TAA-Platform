import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.112.2';
import { authorizeCheckoutAccess } from '../_shared/checkout-access.ts';
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
  getAuthoritativeDimensions,
  getAuthoritativeRateLimitIdentity,
  getNetworkDimensions,
  getNetworkRateLimitIdentity,
  RATE_LIMIT_POLICIES,
  RateLimitError,
  RateLimitServiceError,
  rateLimitResponse,
} from '../_shared/rate-limit.ts';

const MAXIMUM_BODY_BYTES = 4 * 1024;
const ALLOWED_FIELDS = new Set(['checkout_session_id', 'confirmation_token']);

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
        RATE_LIMIT_POLICIES.confirmationMinute,
        RATE_LIMIT_POLICIES.confirmationHour,
      ]),
      { scope: 'confirmation_network' }
    );
    const payload = await readBoundedJson(request, MAXIMUM_BODY_BYTES);
    requireExactFields(payload, ALLOWED_FIELDS);

    const checkoutSessionId = String(payload.checkout_session_id || '').trim();
    const confirmationToken = String(payload.confirmation_token || '').trim();

    if (!checkoutSessionId) {
      return jsonResponse(context, { error: 'Order confirmation is unavailable.' }, 404);
    }

    const authorization = await authorizeCheckoutAccess(
      supabase,
      request,
      checkoutSessionId,
      confirmationToken
    );
    const checkoutIntent = authorization.checkoutIntent;

    if (!checkoutIntent || !authorization.authorized) {
      return jsonResponse(context, { error: 'Order confirmation is unavailable.' }, 404);
    }

    const checkoutIdentity = await getAuthoritativeRateLimitIdentity(
      'confirmation-checkout',
      checkoutIntent.id
    );
    await consumeRateLimits(
      supabase,
      getAuthoritativeDimensions(checkoutIdentity, [
        RATE_LIMIT_POLICIES.confirmationCheckoutMinute,
        RATE_LIMIT_POLICIES.confirmationCheckoutDay,
      ]),
      { scope: 'confirmation_authorized_checkout' }
    );

    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select(
        'id, order_number, customer_email, email, status, fulfillment_status, subtotal_amount, shipping_amount, total_amount, currency, shipping_method_name, shipping_name, shipping_phone, shipping_address, billing_name, billing_address, payment_method_type, payment_brand, payment_last4, payment_exp_month, payment_exp_year, created_at'
      )
      .eq('checkout_intent_id', checkoutIntent.id)
      .eq('status', 'paid')
      .maybeSingle();

    if (orderError) throw new Error('Order lookup failed.');

    if (!order) {
      return jsonResponse(context, {
        order: null,
        items: [],
        pending: ['preparing', 'pending', 'payment_pending', 'paid'].includes(
          checkoutIntent.status
        ),
      });
    }

    const { data: items, error: itemsError } = await supabase
      .from('order_items')
      .select(
        'id, product_id, sku, product_name, quantity, unit_price, line_total, product_type, name, unit_amount, image_url, amount'
      )
      .eq('order_id', order.id);

    if (itemsError) throw new Error('Order items lookup failed.');

    return jsonResponse(context, {
      order: {
        ...order,
        customer_email: order.customer_email || order.email,
        email: undefined,
      },
      items: items || [],
      pending: false,
    });
  } catch (error) {
    if (error instanceof RateLimitError && context) return rateLimitResponse(context, error);
    if (error instanceof HttpSecurityError) return browserErrorResponse(error, context);
    if (error instanceof RateLimitServiceError && context) {
      return jsonResponse(context, { error: error.message }, 503);
    }

    console.error('GET CHECKOUT CONFIRMATION ERROR:', {
      error_name: error instanceof Error ? error.name : 'unknown',
    });

    return context
      ? jsonResponse(context, { error: 'Unable to load order confirmation.' }, 500)
      : browserErrorResponse(error);
  }
});
