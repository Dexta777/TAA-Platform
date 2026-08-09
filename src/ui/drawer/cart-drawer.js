function getDisplayVariant(item) {
  const amount = item.amount && item.amount !== 'default' ? item.amount : '';
  const variant = item.variant && item.variant !== 'default' ? item.variant : '';

  return amount || variant;
}

function removeRenderedItems(itemsContainer) {
  Array.from(itemsContainer.children).forEach((child) => {
    if (!child.hasAttribute('data-cart-item-template')) {
      child.remove();
    }
  });
}

function renderCartItem(template, itemsContainer, item, formatMoney) {
  const itemElement = template.cloneNode(true);
  itemElement.removeAttribute('data-cart-item-template');
  itemElement.dataset.cartSku = item.sku;
  itemElement.style.display = 'flex';
  itemElement.style.visibility = 'visible';
  itemElement.style.opacity = '1';

  const imageElement = itemElement.querySelector('[data-cart-item-image]');
  const titleElement = itemElement.querySelector('[data-cart-item-title]');
  const variantElement = itemElement.querySelector('[data-cart-item-variant]');
  const priceElement = itemElement.querySelector('[data-cart-item-price]');
  const quantityInput = itemElement.querySelector(
    '[data-cart-item-quantity] input, input[data-cart-item-quantity]'
  );
  const removeButton = itemElement.querySelector('[data-cart-item-remove]');
  const displayVariant = getDisplayVariant(item);

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
    priceElement.textContent = formatMoney(item.price, item.currency);
  }

  if (quantityInput) {
    quantityInput.value = item.quantity;
    quantityInput.dataset.cartSku = item.sku;
  }

  if (removeButton) {
    removeButton.dataset.cartSku = item.sku;
  }

  itemsContainer.appendChild(itemElement);
}

export function createCartDrawer({ formatMoney, onOpenRequest, onRemove, onQuantityChange }) {
  const drawer = document.querySelector('[data-cart-drawer]');
  const itemsContainer = document.querySelector('[data-cart-items]');
  const emptyElement = document.querySelector('[data-cart-empty]');
  const subtotalElement = document.querySelector('[data-cart-subtotal]');
  const template = document.querySelector('[data-cart-item-template]');
  const triggers = Array.from(document.querySelectorAll('[data-cart-trigger]'));
  const closeButtons = Array.from(document.querySelectorAll('[data-cart-close]'));
  let previouslyFocusedElement = null;

  if (drawer && (!itemsContainer || !template)) {
    console.error(
      'Cart drawer rendering requires [data-cart-items] and [data-cart-item-template].'
    );
  }

  function setTriggerExpanded(isExpanded) {
    triggers.forEach((trigger) => {
      trigger.setAttribute('aria-expanded', String(isExpanded));
    });
  }

  function open() {
    if (!drawer) return;

    previouslyFocusedElement = document.activeElement;
    drawer.style.display = 'block';
    drawer.setAttribute('aria-hidden', 'false');
    setTriggerExpanded(true);

    const closeButton = drawer.querySelector('[data-cart-close]');
    closeButton?.focus();
  }

  function close() {
    if (!drawer) return;

    drawer.style.display = 'none';
    drawer.setAttribute('aria-hidden', 'true');
    setTriggerExpanded(false);

    if (previouslyFocusedElement instanceof HTMLElement) {
      previouslyFocusedElement.focus();
    }

    previouslyFocusedElement = null;
  }

  function render(cart, subtotal, currency) {
    if (!itemsContainer || !template) return;

    removeRenderedItems(itemsContainer);

    if (cart.length === 0) {
      if (emptyElement) emptyElement.style.display = 'block';
      if (subtotalElement) subtotalElement.textContent = formatMoney(0, currency);
      return;
    }

    if (emptyElement) emptyElement.style.display = 'none';

    cart.forEach((item) => {
      renderCartItem(template, itemsContainer, item, formatMoney);
    });

    if (subtotalElement) {
      subtotalElement.textContent = formatMoney(subtotal, currency);
    }
  }

  triggers.forEach((trigger) => {
    trigger.addEventListener('click', (event) => {
      event.preventDefault();
      onOpenRequest();
    });
  });

  closeButtons.forEach((closeButton) => {
    closeButton.addEventListener('click', (event) => {
      event.preventDefault();
      close();
    });
  });

  itemsContainer?.addEventListener('click', (event) => {
    if (!(event.target instanceof Element)) return;

    const removeButton = event.target.closest('[data-cart-item-remove]');
    const sku = removeButton?.dataset.cartSku;

    if (!sku) return;

    event.preventDefault();
    onRemove(sku);
  });

  itemsContainer?.addEventListener('change', (event) => {
    if (!(event.target instanceof Element)) return;

    const quantityInput = event.target.closest(
      '[data-cart-item-quantity] input, input[data-cart-item-quantity]'
    );
    const sku = quantityInput?.dataset.cartSku;

    if (!quantityInput || !sku) return;

    onQuantityChange(sku, quantityInput.value);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && drawer?.getAttribute('aria-hidden') === 'false') {
      close();
    }
  });

  if (drawer) {
    const isVisible = window.getComputedStyle(drawer).display !== 'none';
    drawer.setAttribute('aria-hidden', String(!isVisible));
    setTriggerExpanded(isVisible);
  }

  return Object.freeze({ close, open, render });
}
