import {
  getActiveProductBySku,
  getActiveVariantsByProductId,
} from '../../services/supabase/products.js';

const AMOUNT_PATTERN = /(\d+\s*(ml|l|g|kg))/i;

function formatMoney(value, currency) {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: currency || 'GBP',
  }).format(Number(value || 0));
}

function getDisplayAmount(product, selectedVariant) {
  if (selectedVariant) {
    const amountMatch = selectedVariant.variant_name.match(AMOUNT_PATTERN);

    return amountMatch ? amountMatch[1] : selectedVariant.variant_name;
  }

  return product.default_amount || '';
}

function showProductMessage(messageElement, message, type = 'info') {
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

function renderProductUnavailable(elements) {
  if (elements.price) {
    elements.price.textContent = 'Unavailable';
  }

  if (elements.addToCartButton) {
    elements.addToCartButton.disabled = true;
    elements.addToCartButton.textContent = 'Unavailable';
    elements.addToCartButton.classList.add('is-disabled');
  }

  showProductMessage(elements.message, 'This product is currently unavailable.', 'error');
}

function renderProductState(state, elements) {
  const currentProduct = state.selectedVariant || state.product;
  const currentCurrency = currentProduct.currency || state.product.currency || 'GBP';
  const currentInventory = Number(currentProduct.inventory_quantity || 0);

  if (elements.amount) {
    elements.amount.textContent = getDisplayAmount(state.product, state.selectedVariant);
  }

  if (elements.price) {
    elements.price.textContent = formatMoney(currentProduct.price, currentCurrency);
  }

  if (currentInventory <= 0) {
    if (elements.addToCartButton) {
      elements.addToCartButton.disabled = true;
      elements.addToCartButton.textContent = 'Out of Stock';
      elements.addToCartButton.classList.add('is-disabled');
    }

    showProductMessage(elements.message, 'This item is currently out of stock.', 'error');
    return;
  }

  if (elements.addToCartButton) {
    elements.addToCartButton.disabled = false;
    elements.addToCartButton.textContent = 'Add to Basket';
    elements.addToCartButton.classList.remove('is-disabled');
  }

  showProductMessage(elements.message, '', 'info');
}

function initialiseVariantSelector(state, elements) {
  if (state.variants.length === 0) {
    if (elements.variantWrapper) {
      elements.variantWrapper.style.display = 'none';
    }

    return true;
  }

  if (!elements.variantSelect || !elements.variantWrapper) {
    console.error(
      'Variant selector UI is unavailable: products with variants require both ' +
        '[data-commerce-field="variant"] and [data-variant-wrapper].'
    );
    return false;
  }

  elements.variantWrapper.style.display = '';
  elements.variantSelect.innerHTML = '';

  state.variants.forEach((variant) => {
    const option = document.createElement('option');
    option.value = variant.variant_sku;
    option.textContent = variant.variant_name;
    elements.variantSelect.appendChild(option);
  });

  elements.variantSelect.value = state.selectedVariant.variant_sku;
  elements.variantSelect.addEventListener('change', () => {
    const selectedVariant = state.variants.find(
      (variant) => variant.variant_sku === elements.variantSelect.value
    );

    if (!selectedVariant) return;

    state.selectedVariant = selectedVariant;

    renderProductState(state, elements);
  });

  return true;
}

function createProductPageController(state) {
  return Object.freeze({
    getSelection() {
      return {
        product: { ...state.product },
        selectedVariant: state.selectedVariant ? { ...state.selectedVariant } : null,
      };
    },
  });
}

export async function initProductPage() {
  const productWrapper = document.querySelector('[data-product-sku]');

  if (!productWrapper) return null;

  const elements = {
    price: document.querySelector('[data-commerce-field="price"]'),
    quantity: document.querySelector('[data-commerce-field="quantity"]'),
    variantSelect: document.querySelector('[data-commerce-field="variant"]'),
    amount: document.querySelector('[data-commerce-field="amount"]'),
    message: document.querySelector('[data-commerce-field="cart_message"]'),
    variantWrapper: document.querySelector('[data-variant-wrapper]'),
    addToCartButton: document.querySelector('[data-commerce-action="add_to_cart"]'),
  };

  const state = {
    product: null,
    variants: [],
    selectedVariant: null,
  };

  if (elements.quantity && !elements.quantity.value) {
    elements.quantity.value = 1;
  }

  try {
    const product = await getActiveProductBySku(productWrapper.dataset.productSku);

    if (!product) {
      throw new Error('Active product not found.');
    }

    state.product = product;
  } catch (error) {
    console.error('Product lookup failed:', error);
    renderProductUnavailable(elements);
    return null;
  }

  try {
    state.variants = await getActiveVariantsByProductId(state.product.id);
  } catch (error) {
    console.error('Product variants lookup failed:', error);
    renderProductUnavailable(elements);
    return null;
  }

  state.selectedVariant = state.variants[0] || null;

  const variantUiReady = initialiseVariantSelector(state, elements);

  if (!variantUiReady) {
    renderProductUnavailable(elements);
    return null;
  }

  renderProductState(state, elements);

  return createProductPageController(state);
}
