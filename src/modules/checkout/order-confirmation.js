import { clearCart } from '../cart/cart.js';
import { refreshCartUi } from '../cart/cart-ui.js';
import { getCheckoutConfirmation } from '../../services/supabase/checkout.js';
import { getCheckoutCapability, removeCheckoutCapability } from './checkout-capability.js';

const MAX_CONFIRMATION_ATTEMPTS = 8;
const CONFIRMATION_RETRY_DELAY_MS = 1500;

function delay(duration) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, duration);
  });
}

function setText(selector, value) {
  const element = document.querySelector(selector);

  if (!element) return;

  element.textContent = value || '';
  element.style.whiteSpace = 'pre-line';
}

function formatMoney(pence, currency = 'GBP') {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(Number(pence || 0) / 100);
}

function formatAddress(address) {
  if (!address) return '';

  return [
    address.first_name && address.last_name ? `${address.first_name} ${address.last_name}` : '',
    address.company,
    address.address_1,
    address.address_2,
    address.city,
    address.county,
    address.postcode,
    address.country,
  ]
    .filter(Boolean)
    .join('\n');
}

async function loadConfirmation(checkoutSessionId, confirmationToken) {
  for (let attempt = 0; attempt < MAX_CONFIRMATION_ATTEMPTS; attempt += 1) {
    const result = await getCheckoutConfirmation(checkoutSessionId, confirmationToken);

    if (result.order) return result;
    if (!result.pending) break;

    await delay(CONFIRMATION_RETRY_DELAY_MS);
  }

  throw new Error('Your order is still being prepared. Please refresh this page.');
}

function renderItems(items, currency) {
  const wrapper = document.querySelector('[data-confirmation-items-wrapper]');
  const template = document.querySelector('[data-confirmation-item-template]');

  if (!wrapper || !template) return;

  wrapper.querySelectorAll('[data-confirmation-generated-item]').forEach((element) => {
    element.remove();
  });

  items.forEach((item) => {
    const clone = template.cloneNode(true);
    const imageElement = clone.querySelector('[data-confirmation-item-image]');
    const nameElement = clone.querySelector('[data-confirmation-item-name]');
    const amountElement = clone.querySelector('[data-confirmation-item-amount]');
    const quantityElement = clone.querySelector('[data-confirmation-item-qty]');
    const priceElement = clone.querySelector('[data-confirmation-item-price]');

    clone.removeAttribute('data-confirmation-item-template');
    clone.setAttribute('data-confirmation-generated-item', 'true');
    clone.style.display = 'flex';

    if (imageElement && item.image_url) {
      imageElement.src = item.image_url;
      imageElement.alt = item.product_name || item.name || item.sku || 'Product image';
    }
    if (nameElement) {
      nameElement.textContent = item.product_name || item.name || item.sku || 'Product';
    }
    if (amountElement) {
      amountElement.textContent = item.amount || '';
      amountElement.style.display = item.amount ? '' : 'none';
    }
    if (quantityElement) quantityElement.textContent = `Qty: ${item.quantity}`;
    if (priceElement) {
      priceElement.textContent = new Intl.NumberFormat('en-GB', {
        style: 'currency',
        currency: currency.toUpperCase(),
      }).format(Number(item.line_total || 0));
    }

    wrapper.appendChild(clone);
  });
}

function renderConfirmation(order, items) {
  setText('[data-confirmation-order-number]', order.order_number);
  setText('[data-confirmation-email]', order.customer_email);
  setText('[data-confirmation-billing-address]', formatAddress(order.billing_address));
  setText('[data-confirmation-shipping-address]', formatAddress(order.shipping_address));
  setText('[data-confirmation-shipping-phone]', order.shipping_phone);
  setText('[data-confirmation-shipping-method]', order.shipping_method_name);
  setText('[data-confirmation-subtotal]', formatMoney(order.subtotal_amount, order.currency));
  setText('[data-confirmation-shipping]', formatMoney(order.shipping_amount, order.currency));
  setText('[data-confirmation-total]', formatMoney(order.total_amount, order.currency));

  const paymentLines = [];

  if (order.payment_brand) {
    paymentLines.push(
      `${String(order.payment_brand).toUpperCase()} ending in ${order.payment_last4 || '****'}`
    );
  }
  if (order.payment_exp_month && order.payment_exp_year) {
    paymentLines.push(
      `Exp: ${String(order.payment_exp_month).padStart(2, '0')}/${String(
        order.payment_exp_year
      ).slice(-2)}`
    );
  }

  setText(
    '[data-confirmation-payment-method]',
    paymentLines.length ? paymentLines.join('\n') : 'Payment received'
  );
  renderItems(items, order.currency || 'GBP');
}

export async function initOrderConfirmation() {
  const checkoutSessionId = new URLSearchParams(window.location.search).get('checkout_session_id');

  if (!checkoutSessionId) return null;

  const capability = getCheckoutCapability(checkoutSessionId);

  try {
    const result = await loadConfirmation(checkoutSessionId, capability?.confirmationToken || null);

    renderConfirmation(result.order, result.items || []);
    removeCheckoutCapability(checkoutSessionId);
    clearCart();
    refreshCartUi();

    return Object.freeze({ orderId: result.order.id });
  } catch (error) {
    console.error('Order confirmation failed:', error);
    return null;
  }
}
