function getDisplayVariant(item) {
  const amount = item.amount && item.amount !== 'default' ? item.amount : '';
  const variant = item.variant && item.variant !== 'default' ? item.variant : '';

  return amount || variant;
}

function removeRenderedItems(itemsContainer) {
  Array.from(itemsContainer.children).forEach((child) => {
    if (!child.hasAttribute('data-basket-item-template')) {
      child.remove();
    }
  });
}

function renderBasketItem(template, itemsContainer, item, formatMoney) {
  const itemElement = template.cloneNode(true);
  itemElement.removeAttribute('data-basket-item-template');
  itemElement.dataset.basketSku = item.sku;
  itemElement.style.display = 'flex';
  itemElement.style.visibility = 'visible';
  itemElement.style.opacity = '1';

  const imageElement = itemElement.querySelector('[data-basket-item-image]');
  const titleElement = itemElement.querySelector('[data-basket-item-title]');
  const variantElement = itemElement.querySelector('[data-basket-item-variant]');
  const priceElement = itemElement.querySelector('[data-basket-item-price]');
  const quantityInput = itemElement.querySelector(
    '[data-basket-item-quantity] input, input[data-basket-item-quantity]'
  );
  const removeButton = itemElement.querySelector('[data-basket-item-remove]');
  const displayVariant = getDisplayVariant(item);
  const lineTotal = Number(item.price || 0) * Number(item.quantity || 0);

  if (imageElement && item.image) {
    imageElement.src = item.image;
    imageElement.alt = item.title || item.sku;
  }

  if (titleElement) {
    titleElement.textContent = item.title || item.sku;
  }

  if (variantElement) {
    variantElement.textContent = displayVariant;
    variantElement.style.display = displayVariant ? '' : 'none';
  }

  if (priceElement) {
    priceElement.textContent = formatMoney(lineTotal, item.currency);
  }

  if (quantityInput) {
    quantityInput.value = item.quantity;
    quantityInput.dataset.basketSku = item.sku;
  }

  if (removeButton) {
    removeButton.dataset.basketSku = item.sku;
  }

  itemsContainer.appendChild(itemElement);
}

export function createBasketPage({ formatMoney, onRemove, onQuantityChange }) {
  const itemsContainer = document.querySelector('[data-basket-items]');
  const template = document.querySelector('[data-basket-item-template]');
  const subtotalElement = document.querySelector('[data-basket-subtotal]');
  const emptyElement = document.querySelector('[data-basket-empty]');
  const errorElement = document.querySelector('[data-basket-error]');
  const isPresent = Boolean(itemsContainer || template || subtotalElement || emptyElement);

  if (isPresent && (!itemsContainer || !template)) {
    console.error('Basket rendering requires [data-basket-items] and [data-basket-item-template].');
  }

  function showError(message) {
    if (errorElement) {
      errorElement.textContent = message;
    }
  }

  function render(cart, subtotal, currency) {
    if (!itemsContainer || !template) return;

    removeRenderedItems(itemsContainer);
    showError('');

    if (cart.length === 0) {
      if (emptyElement) emptyElement.style.display = 'block';
      if (subtotalElement) subtotalElement.textContent = formatMoney(0, currency);
      return;
    }

    if (emptyElement) emptyElement.style.display = 'none';

    cart.forEach((item) => {
      renderBasketItem(template, itemsContainer, item, formatMoney);
    });

    if (subtotalElement) {
      subtotalElement.textContent = formatMoney(subtotal, currency);
    }
  }

  itemsContainer?.addEventListener('click', (event) => {
    if (!(event.target instanceof Element)) return;

    const removeButton = event.target.closest('[data-basket-item-remove]');
    const sku = removeButton?.dataset.basketSku;

    if (!sku) return;

    event.preventDefault();
    onRemove(sku);
  });

  itemsContainer?.addEventListener('change', (event) => {
    if (!(event.target instanceof Element)) return;

    const quantityInput = event.target.closest(
      '[data-basket-item-quantity] input, input[data-basket-item-quantity]'
    );
    const sku = quantityInput?.dataset.basketSku;

    if (!quantityInput || !sku) return;

    onQuantityChange(sku, quantityInput.value);
  });

  return Object.freeze({ render, showError });
}
