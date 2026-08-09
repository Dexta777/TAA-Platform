import { clearCart as clearStoredCart, loadCart, saveCart } from './cart-storage.js';

const AMOUNT_PATTERN = /(\d+\s*(ml|l|g|kg))/i;

export const CART_ERROR_CODES = Object.freeze({
  INVALID_SELECTION: 'INVALID_SELECTION',
  INVALID_QUANTITY: 'INVALID_QUANTITY',
  OUT_OF_STOCK: 'OUT_OF_STOCK',
  INSUFFICIENT_STOCK: 'INSUFFICIENT_STOCK',
  CART_QUANTITY_EXCEEDS_STOCK: 'CART_QUANTITY_EXCEEDS_STOCK',
  INVALID_STOCK_LIMIT: 'INVALID_STOCK_LIMIT',
  INVALID_CART_STATE: 'INVALID_CART_STATE',
  ITEM_NOT_FOUND: 'ITEM_NOT_FOUND',
});

export class CartError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'CartError';
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

function throwCartError(code, message, details) {
  throw new CartError(code, message, details);
}

function normalizeRequiredText(value) {
  return String(value ?? '').trim();
}

function normalizeQuantity(quantity) {
  if (
    (typeof quantity !== 'number' && typeof quantity !== 'string') ||
    (typeof quantity === 'string' && !quantity.trim())
  ) {
    throwCartError(CART_ERROR_CODES.INVALID_QUANTITY, 'Cart quantity must be a positive integer.');
  }

  const normalizedQuantity = Number(quantity);

  if (!Number.isInteger(normalizedQuantity) || normalizedQuantity < 1) {
    throwCartError(CART_ERROR_CODES.INVALID_QUANTITY, 'Cart quantity must be a positive integer.');
  }

  return normalizedQuantity;
}

function normalizeStock(stock, errorCode) {
  if (
    (typeof stock !== 'number' && typeof stock !== 'string') ||
    (typeof stock === 'string' && !stock.trim())
  ) {
    throwCartError(errorCode, 'A valid inventory quantity is required.');
  }

  const normalizedStock = Number(stock);

  if (!Number.isInteger(normalizedStock) || normalizedStock < 0) {
    throwCartError(errorCode, 'A valid inventory quantity is required.');
  }

  return normalizedStock;
}

function getCartAmount(product, selectedVariant) {
  if (selectedVariant) {
    const variantName = normalizeRequiredText(selectedVariant.variant_name);
    const amountMatch = variantName.match(AMOUNT_PATTERN);

    return amountMatch ? amountMatch[1] : variantName;
  }

  return normalizeRequiredText(product.default_amount);
}

function resolveSelection(selection) {
  const product = selection?.product;
  const selectedVariant = selection?.selectedVariant || null;
  const productId = normalizeRequiredText(product?.id);
  const productSku = normalizeRequiredText(product?.sku);
  const productName = normalizeRequiredText(product?.name);

  if (!productId || !productSku || !productName) {
    throwCartError(CART_ERROR_CODES.INVALID_SELECTION, 'A complete product selection is required.');
  }

  if (selectedVariant && typeof selectedVariant !== 'object') {
    throwCartError(CART_ERROR_CODES.INVALID_SELECTION, 'A complete product selection is required.');
  }

  const sellableId = normalizeRequiredText(selectedVariant ? selectedVariant.id : product.id);
  const sellableSku = normalizeRequiredText(
    selectedVariant ? selectedVariant.variant_sku : product.sku
  );
  const variantName = selectedVariant
    ? normalizeRequiredText(selectedVariant.variant_name)
    : 'default';
  const variantProductId = normalizeRequiredText(selectedVariant?.product_id);
  const sellableSource = selectedVariant || product;
  const price = Number(sellableSource.price);

  if (
    !sellableId ||
    !sellableSku ||
    !variantName ||
    (variantProductId && variantProductId !== productId) ||
    !Number.isFinite(price) ||
    price < 0
  ) {
    throwCartError(CART_ERROR_CODES.INVALID_SELECTION, 'A complete product selection is required.');
  }

  const availableStock = normalizeStock(
    sellableSource.inventory_quantity,
    CART_ERROR_CODES.INVALID_SELECTION
  );

  return {
    product,
    selectedVariant,
    productId,
    productSku,
    productName,
    sellableId,
    sellableSku,
    variantName,
    price,
    currency: normalizeRequiredText(sellableSource.currency || product.currency) || 'GBP',
    availableStock,
    stripePriceId: sellableSource.stripe_price_id || null,
  };
}

function validateRequestedStock(sellableSku, quantity, availableStock) {
  if (availableStock <= 0) {
    throwCartError(CART_ERROR_CODES.OUT_OF_STOCK, 'The selected item is out of stock.', {
      sku: sellableSku,
      availableStock,
    });
  }

  if (quantity > availableStock) {
    throwCartError(
      CART_ERROR_CODES.INSUFFICIENT_STOCK,
      'Requested quantity exceeds available stock.',
      {
        sku: sellableSku,
        requestedQuantity: quantity,
        availableStock,
      }
    );
  }
}

function prepareCartItem(selection, quantity) {
  const normalizedQuantity = normalizeQuantity(quantity);
  const resolvedSelection = resolveSelection(selection);

  validateRequestedStock(
    resolvedSelection.sellableSku,
    normalizedQuantity,
    resolvedSelection.availableStock
  );

  return {
    availableStock: resolvedSelection.availableStock,
    cartItem: {
      product_id: resolvedSelection.sellableId,
      base_product_id: resolvedSelection.productId,
      base_sku: resolvedSelection.productSku,
      sku: resolvedSelection.sellableSku,
      image: resolvedSelection.product.image_url || null,
      title: resolvedSelection.productName,
      variant: resolvedSelection.variantName,
      quantity: normalizedQuantity,
      price: resolvedSelection.price,
      currency: resolvedSelection.currency,
      stripe_price_id: resolvedSelection.stripePriceId,
      amount: getCartAmount(resolvedSelection.product, resolvedSelection.selectedVariant),
    },
  };
}

function copyCart(cart) {
  return cart.map((item) => (item && typeof item === 'object' ? { ...item } : item));
}

function normalizeSku(sku) {
  const normalizedSku = normalizeRequiredText(sku);

  if (!normalizedSku) {
    throwCartError(CART_ERROR_CODES.INVALID_SELECTION, 'A cart item SKU is required.');
  }

  return normalizedSku;
}

export function createCartItem(selection, quantity) {
  return prepareCartItem(selection, quantity).cartItem;
}

export function addCartItem(selection, quantity) {
  const { cartItem, availableStock } = prepareCartItem(selection, quantity);
  const cart = loadCart();
  const existingItem = cart.find((item) => item?.sku === cartItem.sku);

  if (existingItem) {
    let existingQuantity;

    try {
      existingQuantity = normalizeQuantity(existingItem.quantity);
    } catch {
      throwCartError(
        CART_ERROR_CODES.INVALID_CART_STATE,
        'The stored cart contains an invalid quantity.',
        { sku: cartItem.sku }
      );
    }

    const combinedQuantity = existingQuantity + cartItem.quantity;

    if (combinedQuantity > availableStock) {
      throwCartError(
        CART_ERROR_CODES.CART_QUANTITY_EXCEEDS_STOCK,
        'Cart quantity would exceed available stock.',
        {
          sku: cartItem.sku,
          requestedQuantity: cartItem.quantity,
          existingQuantity,
          availableStock,
        }
      );
    }

    existingItem.quantity = combinedQuantity;
  } else {
    cart.push(cartItem);
  }

  saveCart(cart);
  return copyCart(cart);
}

// When current stock is unknown, only quantity shape is validated here.
// Checkout remains responsible for final authoritative inventory validation.
export function updateCartItemQuantity(sku, quantity, availableStock) {
  const normalizedSku = normalizeSku(sku);
  const normalizedQuantity = normalizeQuantity(quantity);

  if (availableStock !== undefined && availableStock !== null) {
    const normalizedStock = normalizeStock(availableStock, CART_ERROR_CODES.INVALID_STOCK_LIMIT);

    validateRequestedStock(normalizedSku, normalizedQuantity, normalizedStock);
  }

  const cart = loadCart();
  const itemIndex = cart.findIndex((item) => item?.sku === normalizedSku);

  if (itemIndex === -1) {
    throwCartError(CART_ERROR_CODES.ITEM_NOT_FOUND, 'Cart item was not found.', {
      sku: normalizedSku,
    });
  }

  cart[itemIndex] = {
    ...cart[itemIndex],
    quantity: normalizedQuantity,
  };

  saveCart(cart);
  return copyCart(cart);
}

export function removeCartItem(sku) {
  const normalizedSku = normalizeSku(sku);
  const cart = loadCart();
  const updatedCart = cart.filter((item) => item?.sku !== normalizedSku);

  saveCart(updatedCart);
  return copyCart(updatedCart);
}

export function getCart() {
  return copyCart(loadCart());
}

export function clearCart() {
  clearStoredCart();
  return [];
}

export function getCartItemCount(cart) {
  if (!Array.isArray(cart)) return 0;

  return cart.reduce((total, item) => {
    const quantity = Number(item?.quantity);

    return Number.isInteger(quantity) && quantity > 0 ? total + quantity : total;
  }, 0);
}

export function getCartSubtotal(cart) {
  if (!Array.isArray(cart)) return 0;

  return cart.reduce((subtotal, item) => {
    const price = Number(item?.price);
    const quantity = Number(item?.quantity);

    if (!Number.isFinite(price) || price < 0 || !Number.isInteger(quantity) || quantity < 1) {
      return subtotal;
    }

    return subtotal + price * quantity;
  }, 0);
}
