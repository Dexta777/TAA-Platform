import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.112.2';
import { authorizeCheckoutAccess } from '../_shared/checkout-access.ts';

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
      return jsonResponse({ error: 'Invalid request body.' }, 400);
    }

    if (!payload || typeof payload !== 'object') {
      return jsonResponse({ error: 'Invalid request body.' }, 400);
    }

    const checkoutSessionId = String(payload.checkout_session_id || '').trim();
    const confirmationToken = String(payload.confirmation_token || '').trim();

    if (!checkoutSessionId) {
      return jsonResponse({ error: 'Order confirmation is unavailable.' }, 404);
    }

    const authorization = await authorizeCheckoutAccess(
      supabase,
      request,
      checkoutSessionId,
      confirmationToken
    );
    const checkoutIntent = authorization.checkoutIntent;

    if (!checkoutIntent || !authorization.authorized) {
      return jsonResponse({ error: 'Order confirmation is unavailable.' }, 404);
    }

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
      return jsonResponse({
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

    return jsonResponse({
      order: {
        ...order,
        customer_email: order.customer_email || order.email,
        email: undefined,
      },
      items: items || [],
      pending: false,
    });
  } catch (error) {
    console.error('GET CHECKOUT CONFIRMATION ERROR:', error);

    return jsonResponse({ error: 'Unable to load order confirmation.' }, 500);
  }
});
