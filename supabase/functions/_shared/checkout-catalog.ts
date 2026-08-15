import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.112.2';
import {
  CheckoutInventoryConflictError,
  type CheckoutUnavailableItem,
} from './checkout-inventory.ts';

const MAX_CART_LINES = 100;
const AMOUNT_PATTERN = /(\d+\s*(ml|l|g|kg))/i;

export class CheckoutInputError extends Error {}

export function cleanText(value: unknown, maximumLength = 500) {
  return String(value ?? '')
    .trim()
    .slice(0, maximumLength);
}

function aggregateCart(cart: unknown[]) {
  if (cart.length === 0) throw new CheckoutInputError('Basket is empty.');
  if (cart.length > MAX_CART_LINES) throw new CheckoutInputError('Basket contains too many items.');

  const quantitiesBySku = new Map<string, number>();

  for (const value of cart) {
    if (!value || typeof value !== 'object') {
      throw new CheckoutInputError('Invalid basket item.');
    }

    const item = value as Record<string, unknown>;
    const sku = cleanText(item.sku, 200);
    const quantity = Number(item.quantity);

    if (!sku || !Number.isSafeInteger(quantity) || quantity < 1) {
      throw new CheckoutInputError('Invalid basket item.');
    }

    const aggregatedQuantity = (quantitiesBySku.get(sku) || 0) + quantity;

    if (!Number.isSafeInteger(aggregatedQuantity)) {
      throw new CheckoutInputError('Invalid basket quantity.');
    }

    quantitiesBySku.set(sku, aggregatedQuantity);
  }

  return Array.from(quantitiesBySku, ([sku, quantity]) => ({ sku, quantity }));
}

export async function resolveCanonicalCart(supabase: SupabaseClient, cart: unknown[]) {
  const aggregatedItems = aggregateCart(cart);
  const canonicalItems = [];
  const unavailableItems: CheckoutUnavailableItem[] = [];

  for (const item of aggregatedItems) {
    const { data: product, error: productError } = await supabase
      .from('products')
      .select(
        'id, sku, name, price, currency, active, inventory_quantity, weight_grams, image_url, default_amount'
      )
      .eq('sku', item.sku)
      .eq('active', true)
      .maybeSingle();

    if (productError) throw new Error('Product catalogue lookup failed.');

    let source;

    if (product) {
      source = {
        productType: 'product',
        productId: product.id,
        baseProductId: product.id,
        sku: product.sku,
        productName: product.name,
        variantName: null,
        displayName: product.name,
        price: Number(product.price),
        currency: cleanText(product.currency, 3).toLowerCase() || 'gbp',
        inventoryQuantity: Number(product.inventory_quantity),
        weightGrams: Number(product.weight_grams || 0),
        imageUrl: product.image_url || null,
        amount: cleanText(product.default_amount, 100) || null,
      };
    } else {
      const { data: variant, error: variantError } = await supabase
        .from('product_variants')
        .select(
          'id, product_id, variant_sku, variant_name, price, currency, active, inventory_quantity, weight_grams'
        )
        .eq('variant_sku', item.sku)
        .eq('active', true)
        .maybeSingle();

      if (variantError) throw new Error('Product catalogue lookup failed.');
      if (!variant) throw new CheckoutInputError(`Product unavailable: ${item.sku}`);

      const { data: baseProduct, error: baseProductError } = await supabase
        .from('products')
        .select('id, name, image_url, active')
        .eq('id', variant.product_id)
        .eq('active', true)
        .maybeSingle();

      if (baseProductError) throw new Error('Product catalogue lookup failed.');
      if (!baseProduct) throw new CheckoutInputError(`Product unavailable: ${item.sku}`);

      const variantName = cleanText(variant.variant_name, 200);
      const amountMatch = variantName.match(AMOUNT_PATTERN);

      source = {
        productType: 'variant',
        productId: variant.id,
        baseProductId: baseProduct.id,
        sku: variant.variant_sku,
        productName: baseProduct.name,
        variantName,
        displayName: variantName ? `${baseProduct.name} — ${variantName}` : baseProduct.name,
        price: Number(variant.price),
        currency: cleanText(variant.currency, 3).toLowerCase() || 'gbp',
        inventoryQuantity: Number(variant.inventory_quantity),
        weightGrams: Number(variant.weight_grams || 0),
        imageUrl: baseProduct.image_url || null,
        amount: amountMatch?.[1] || variantName || null,
      };
    }

    if (!Number.isFinite(source.price) || source.price < 0 || source.currency !== 'gbp') {
      throw new Error('Product pricing is invalid.');
    }

    if (!Number.isInteger(source.inventoryQuantity) || source.inventoryQuantity < 0) {
      throw new Error('Product inventory is invalid.');
    }

    if (item.quantity > source.inventoryQuantity) {
      unavailableItems.push({ sku: source.sku, reason: 'out_of_stock' });
    }

    if (!Number.isFinite(source.weightGrams) || source.weightGrams < 0) {
      throw new Error('Product weight is invalid.');
    }

    const unitAmount = Math.round(source.price * 100);

    canonicalItems.push({
      product_type: source.productType,
      product_id: source.productId,
      base_product_id: source.baseProductId,
      sku: source.sku,
      product_name: source.productName,
      variant_name: source.variantName,
      name: source.displayName,
      quantity: item.quantity,
      unit_amount: unitAmount,
      line_total: unitAmount * item.quantity,
      weight_grams: source.weightGrams * item.quantity,
      image_url: source.imageUrl,
      amount: source.amount,
    });
  }

  if (unavailableItems.length > 0) {
    throw new CheckoutInventoryConflictError(unavailableItems);
  }

  return canonicalItems;
}

export async function getCanonicalShippingOptions(
  supabase: SupabaseClient,
  totalWeightGrams: number
) {
  const { data: methods, error: methodsError } = await supabase
    .from('shipping_methods')
    .select('id, name, description, carrier, sort_order, active')
    .eq('active', true)
    .order('sort_order', { ascending: true });

  if (methodsError || !methods) throw new Error('Shipping methods could not be loaded.');

  const options = [];

  for (const method of methods) {
    const { data: rates, error: ratesError } = await supabase
      .from('shipping_rates')
      .select('id, price, currency, min_weight_grams, max_weight_grams, active')
      .eq('shipping_method_id', method.id)
      .eq('active', true);

    if (ratesError) throw new Error('Shipping rates could not be loaded.');

    const rate = (rates || []).find(
      (candidate) =>
        totalWeightGrams >= Number(candidate.min_weight_grams) &&
        totalWeightGrams <= Number(candidate.max_weight_grams)
    );

    if (!rate) continue;

    const currency = cleanText(rate.currency, 3).toLowerCase() || 'gbp';
    const shipping = Math.round(Number(rate.price) * 100);

    if (currency !== 'gbp' || !Number.isInteger(shipping) || shipping < 0) {
      throw new Error('Shipping pricing is invalid.');
    }

    options.push({
      id: method.id,
      name: method.name,
      description: method.description,
      carrier: method.carrier,
      rate_id: rate.id,
      shipping,
      currency,
    });
  }

  if (options.length === 0) {
    throw new CheckoutInputError('No shipping method is available for this basket.');
  }

  if (options.length > 5) {
    throw new Error('Stripe Checkout supports no more than five shipping options.');
  }

  return options;
}
