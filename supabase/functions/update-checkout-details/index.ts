import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.112.2';
import { authorizeCheckoutAccess, cleanCheckoutAddress } from '../_shared/checkout-access.ts';
import { CheckoutInputError, cleanText } from '../_shared/checkout-catalog.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

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

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed.' }, 405);
  }

  try {
    let payload;

    try {
      payload = await request.json();
    } catch {
      throw new CheckoutInputError('Invalid request body.');
    }

    if (!payload || typeof payload !== 'object') {
      throw new CheckoutInputError('Invalid request body.');
    }

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
      return jsonResponse({ error: 'Checkout authorization has expired or is invalid.' }, 403);
    }

    if (authorization.checkoutIntent.status !== 'pending') {
      return jsonResponse({ error: 'Checkout details can no longer be changed.' }, 409);
    }

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
      return jsonResponse({ error: 'Checkout details can no longer be changed.' }, 409);
    }

    return jsonResponse({ updated: true });
  } catch (error) {
    console.error('UPDATE CHECKOUT DETAILS ERROR:', error);

    if (error instanceof CheckoutInputError) {
      return jsonResponse({ error: error.message }, 400);
    }

    return jsonResponse({ error: 'Checkout details could not be saved.' }, 500);
  }
});
