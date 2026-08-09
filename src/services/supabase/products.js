import { supabase } from './client.js';

const PRODUCT_FIELDS = [
  'id',
  'sku',
  'image_url',
  'name',
  'price',
  'currency',
  'active',
  'inventory_quantity',
  'weight_grams',
  'stripe_price_id',
  'default_amount',
].join(', ');

const VARIANT_FIELDS = [
  'id',
  'product_id',
  'variant_name',
  'variant_sku',
  'price',
  'compare_at_price',
  'currency',
  'inventory_quantity',
  'weight_grams',
  'stripe_price_id',
  'active',
  'sort_order',
].join(', ');

export async function getActiveProductBySku(sku) {
  const normalizedSku = String(sku ?? '').trim();

  if (!normalizedSku) {
    throw new TypeError('A product SKU is required.');
  }

  const { data: product, error } = await supabase
    .from('products')
    .select(PRODUCT_FIELDS)
    .eq('sku', normalizedSku)
    .eq('active', true)
    .single();

  if (error) {
    throw new Error('Unable to load the active product.');
  }

  return product;
}

export async function getActiveVariantsByProductId(productId) {
  const normalizedProductId = String(productId ?? '').trim();

  if (!normalizedProductId) {
    throw new TypeError('A product ID is required.');
  }

  const { data: variants, error } = await supabase
    .from('product_variants')
    .select(VARIANT_FIELDS)
    .eq('product_id', normalizedProductId)
    .eq('active', true)
    .order('sort_order', { ascending: true });

  if (error) {
    throw new Error('Unable to load active product variants.');
  }

  return variants ?? [];
}
