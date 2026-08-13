import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.112.2';
import { authorizeCheckoutAccess, cleanCheckoutAddress } from '../_shared/checkout-access.ts';
import { CheckoutInputError, cleanText } from '../_shared/checkout-catalog.ts';
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

const MAXIMUM_BODY_BYTES = 16 * 1024;
const ALLOWED_FIELDS = new Set([
  'checkout_session_id',
  'confirmation_token',
  'shipping_phone',
  'shipping_address',
  'billing_address',
  'billing_is_different',
]);

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
      getNetworkDimensions(networkIdentity, [RATE_LIMIT_POLICIES.updateMinute]),
      { scope: 'update_network' }
    );
    const payload = await readBoundedJson(request, MAXIMUM_BODY_BYTES);
    requireExactFields(payload, ALLOWED_FIELDS);

    const checkoutSessionId = cleanText(payload.checkout_session_id, 255);
    const confirmationToken = cleanText(payload.confirmation_token, 255);

    if (!checkoutSessionId) {
      throw new CheckoutInputError('Checkout details are incomplete.');
    }

    const authorization = await authorizeCheckoutAccess(
      supabase,
      request,
      checkoutSessionId,
      confirmationToken
    );

    if (!authorization.authorized || !authorization.checkoutIntent) {
      return jsonResponse(
        context,
        { error: 'Checkout authorization has expired or is invalid.' },
        403
      );
    }

    if (authorization.checkoutIntent.status !== 'pending') {
      return jsonResponse(context, { error: 'Checkout details can no longer be changed.' }, 409);
    }

    const checkoutIdentity = await getAuthoritativeRateLimitIdentity(
      'update-checkout',
      authorization.checkoutIntent.id
    );
    await consumeRateLimits(
      supabase,
      getAuthoritativeDimensions(checkoutIdentity, [RATE_LIMIT_POLICIES.updateCheckout]),
      { scope: 'update_authorized_checkout' }
    );

    const shippingAddress = cleanCheckoutAddress(payload.shipping_address, {
      label: 'shipping',
    });
    const billingIsDifferent = Boolean(payload.billing_is_different);
    const billingAddress = billingIsDifferent
      ? cleanCheckoutAddress(payload.billing_address, { label: 'billing' })
      : { ...shippingAddress };
    const shippingPhone = cleanText(payload.shipping_phone, 50);

    if (!shippingPhone) {
      throw new CheckoutInputError('Please enter your phone number.');
    }

    const shippingName = `${shippingAddress.first_name} ${shippingAddress.last_name}`.trim();
    const billingName = `${billingAddress.first_name} ${billingAddress.last_name}`.trim();
    const { data: updatedCheckout, error: updateError } = await supabase
      .from('checkout_intents')
      .update({
        shipping_name: shippingName,
        shipping_phone: shippingPhone,
        shipping_address: shippingAddress,
        billing_name: billingName,
        billing_address: billingAddress,
        billing_is_different: billingIsDifferent,
      })
      .eq('id', authorization.checkoutIntent.id)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle();

    if (updateError) throw new Error('Checkout details could not be updated.');
    if (!updatedCheckout) {
      return jsonResponse(context, { error: 'Checkout details can no longer be changed.' }, 409);
    }

    return jsonResponse(context, { updated: true });
  } catch (error) {
    if (error instanceof RateLimitError && context) return rateLimitResponse(context, error);
    if (error instanceof HttpSecurityError) return browserErrorResponse(error, context);
    if (error instanceof RateLimitServiceError && context) {
      return jsonResponse(context, { error: error.message }, 503);
    }

    if (error instanceof CheckoutInputError) {
      return context
        ? jsonResponse(context, { error: error.message }, 400)
        : browserErrorResponse(error);
    }

    console.error('UPDATE CHECKOUT DETAILS ERROR:', {
      error_name: error instanceof Error ? error.name : 'unknown',
    });

    return context
      ? jsonResponse(context, { error: 'Checkout details could not be saved.' }, 500)
      : browserErrorResponse(error);
  }
});
