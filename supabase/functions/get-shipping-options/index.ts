import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.112.2';
import {
  CheckoutInputError,
  getCanonicalShippingOptions,
  resolveCanonicalCart,
} from '../_shared/checkout-catalog.ts';

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

    const cart = Array.isArray(payload.cart) ? payload.cart : [];
    const items = await resolveCanonicalCart(supabase, cart);
    const subtotal = items.reduce((total, item) => total + item.line_total, 0);
    const totalWeightGrams = items.reduce((total, item) => total + item.weight_grams, 0);

    if (totalWeightGrams <= 0) {
      throw new CheckoutInputError('Basket weight could not be calculated.');
    }

    const options = await getCanonicalShippingOptions(supabase, totalWeightGrams);

    return jsonResponse({
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
    console.error('GET SHIPPING OPTIONS ERROR:', error);

    if (error instanceof CheckoutInputError) {
      return jsonResponse({ error: error.message }, 400);
    }

    return jsonResponse({ error: 'Shipping options could not be loaded.' }, 500);
  }
});
