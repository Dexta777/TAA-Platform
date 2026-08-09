import {
  addCartItem,
  CART_ERROR_CODES,
  CartError,
  getCart,
  getCartItemCount,
  getCartSubtotal,
  removeCartItem,
  updateCartItemQuantity,
} from './cart.js';
import { createBasketPage } from './basket-page.js';
import { createCartDrawer } from '../../ui/drawer/cart-drawer.js';

const boundAddButtons = new WeakSet();
let activeProductController = null;
let basketPage = null;
let cartDrawer = null;
let isInitialised = false;

function formatMoney(value, currency) {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: currency || 'GBP',
  }).format(Number(value || 0));
}

function getCartCurrency(cart) {
  return cart.find((item) => item?.currency)?.currency || 'GBP';
}

function getCartErrorMessage(error) {
  if (!(error instanceof CartError)) {
    return 'Your basket could not be updated. Please try again.';
  }

  const availableStock = Number(error.details.availableStock);
  const existingQuantity = Number(error.details.existingQuantity);

  switch (error.code) {
    case CART_ERROR_CODES.INVALID_QUANTITY:
      return 'Please enter a valid quantity.';
    case CART_ERROR_CODES.OUT_OF_STOCK:
      return 'This item is currently out of stock.';
    case CART_ERROR_CODES.INSUFFICIENT_STOCK:
      return Number.isFinite(availableStock)
        ? `Only ${availableStock} available. Please reduce the quantity.`
        : 'The requested quantity is unavailable.';
    case CART_ERROR_CODES.CART_QUANTITY_EXCEEDS_STOCK:
      return Number.isFinite(availableStock) && Number.isFinite(existingQuantity)
        ? `Only ${availableStock} available. You already have ${existingQuantity} in your basket.`
        : 'The requested quantity is unavailable.';
    case CART_ERROR_CODES.INVALID_SELECTION:
      return 'This product is currently unavailable.';
    case CART_ERROR_CODES.ITEM_NOT_FOUND:
      return 'This basket item is no longer available.';
    case CART_ERROR_CODES.INVALID_STOCK_LIMIT:
    case CART_ERROR_CODES.INVALID_CART_STATE:
    default:
      return 'Your basket could not be updated. Please try again.';
  }
}

function showProductMessage(message, type = 'error') {
  const messageElement = document.querySelector('[data-commerce-field="cart_message"]');

  if (!messageElement) return;

  messageElement.textContent = message;
  messageElement.dataset.messageType = type;
  messageElement.classList.remove('is-error', 'is-success', 'is-info');

  if (type === 'error') {
    messageElement.classList.add('is-error');
    return;
  }

  if (type === 'success') {
    messageElement.classList.add('is-success');
    return;
  }

  messageElement.classList.add('is-info');
}

function updateCartBadge(cart) {
  const count = getCartItemCount(cart);

  document.querySelectorAll('[data-cart-count]').forEach((countElement) => {
    countElement.textContent = String(count);
    countElement.style.display = count > 0 ? 'flex' : 'none';
  });
}

function reportMutationFailure(error, { showOnProductPage = false } = {}) {
  console.error('Cart update failed:', error);
  refreshCartUi();

  const customerMessage = getCartErrorMessage(error);
  basketPage?.showError(customerMessage);

  if (showOnProductPage) {
    showProductMessage(customerMessage, 'error');
  }
}

function handleRemove(sku) {
  try {
    removeCartItem(sku);
    refreshCartUi();
  } catch (error) {
    reportMutationFailure(error);
  }
}

function handleQuantityChange(sku, quantity) {
  try {
    updateCartItemQuantity(sku, quantity);
    refreshCartUi();
  } catch (error) {
    reportMutationFailure(error);
  }
}

function bindAddToCartButton() {
  const addButton = document.querySelector('[data-commerce-action="add_to_cart"]');

  if (!addButton || boundAddButtons.has(addButton)) return;

  boundAddButtons.add(addButton);
  addButton.addEventListener('click', (event) => {
    event.preventDefault();

    const selection = activeProductController?.getSelection();
    const quantityInput = document.querySelector('[data-commerce-field="quantity"]');

    if (!selection) {
      showProductMessage('This product is currently unavailable.', 'error');
      return;
    }

    try {
      addCartItem(selection, quantityInput?.value ?? '');
      showProductMessage('', 'info');
      openCartDrawer();
    } catch (error) {
      reportMutationFailure(error, { showOnProductPage: true });
    }
  });
}

export function refreshCartUi() {
  const cart = getCart();
  const subtotal = getCartSubtotal(cart);
  const currency = getCartCurrency(cart);

  updateCartBadge(cart);
  cartDrawer?.render(cart, subtotal, currency);
  basketPage?.render(cart, subtotal, currency);

  return cart;
}

export function openCartDrawer() {
  refreshCartUi();
  cartDrawer?.open();
}

export function closeCartDrawer() {
  cartDrawer?.close();
}

export function initCartUi({ productController } = {}) {
  if (productController !== undefined) {
    activeProductController = productController;
  }

  if (!isInitialised) {
    cartDrawer = createCartDrawer({
      formatMoney,
      onOpenRequest: openCartDrawer,
      onQuantityChange: handleQuantityChange,
      onRemove: handleRemove,
    });
    basketPage = createBasketPage({
      formatMoney,
      onQuantityChange: handleQuantityChange,
      onRemove: handleRemove,
    });
    isInitialised = true;
  }

  bindAddToCartButton();
  refreshCartUi();

  return Object.freeze({ closeCartDrawer, openCartDrawer, refreshCartUi });
}
