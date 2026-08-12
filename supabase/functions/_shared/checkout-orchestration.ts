import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.112.2';
import type { PersistedCheckoutSnapshot } from './checkout-protocol.ts';

export function getRpcResultRow<T>(data: T | T[] | null): T | null {
  if (Array.isArray(data)) return data[0] || null;

  return data;
}

export async function callCheckoutRpc<T>(
  supabase: SupabaseClient,
  functionName: string,
  parameters: Record<string, unknown>
) {
  const { data, error } = await supabase.rpc(functionName, parameters);

  if (error) {
    const safeError = new Error(error.message || `Checkout RPC ${functionName} failed.`);
    safeError.name = 'CheckoutDatabaseError';
    throw safeError;
  }

  return getRpcResultRow(data as T | T[] | null);
}

export async function loadPersistedCheckoutSnapshot(
  supabase: SupabaseClient,
  checkoutIntentId: string
): Promise<PersistedCheckoutSnapshot> {
  const { data: intent, error: intentError } = await supabase
    .from('checkout_intents')
    .select(
      'id, checkout_attempt_id, checkout_request_id, replaces_checkout_intent_id, checkout_protocol_version, orchestration_state, customer_email, stripe_checkout_session_id, stripe_customer_id, stripe_coupon_id, stripe_return_url, stripe_session_expires_at, subtotal_amount, shipping_amount, total_amount, currency, total_weight_grams, discount_code_id, discount_code, discount_name, discount_type, discount_amount, shipping_discount_amount, confirmation_generation'
    )
    .eq('id', checkoutIntentId)
    .maybeSingle();

  if (intentError || !intent) throw new Error('Persisted checkout request could not be loaded.');

  const { data: items, error: itemsError } = await supabase
    .from('checkout_intent_items')
    .select(
      'line_position, product_type, product_id, base_product_id, sku, name, product_name, variant_name, quantity, unit_amount, line_total, weight_grams, image_url, amount'
    )
    .eq('checkout_intent_id', checkoutIntentId)
    .order('line_position', { ascending: true });

  if (itemsError || !items?.length) {
    throw new Error('Persisted checkout item snapshot could not be loaded.');
  }

  const { data: shippingOptions, error: shippingOptionsError } = await supabase
    .from('checkout_intent_shipping_options')
    .select(
      'position, shipping_method_id, shipping_rate_id, display_name, description, carrier, amount, original_amount, currency, stripe_shipping_rate_id'
    )
    .eq('checkout_intent_id', checkoutIntentId)
    .order('position', { ascending: true });

  if (shippingOptionsError || !shippingOptions?.length) {
    throw new Error('Persisted checkout shipping snapshot could not be loaded.');
  }

  return {
    ...intent,
    items,
    shipping_options: shippingOptions,
  } as PersistedCheckoutSnapshot;
}
