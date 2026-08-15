const INVENTORY_ERROR = 'inventory_conflict';

const REASON_CONTENT = Object.freeze({
  temporarily_reserved: {
    label: 'Temporarily reserved',
    message:
      "Someone else is currently checking out with this item. If they don't complete checkout, it may become available again.",
  },
  out_of_stock: {
    label: 'Out of stock',
    message: 'This item is currently out of stock.',
  },
});

function setUiHidden(element, hidden) {
  if (!element) return;

  if (hidden) {
    element.setAttribute('data-ui-hidden', 'true');
  } else {
    element.removeAttribute('data-ui-hidden');
  }
}

function getCartItemTitle(item) {
  const title = String(item?.title || item?.name || item?.sku || 'Product').trim();
  const variant = String(item?.variant || '').trim();

  return variant && variant !== 'default' ? `${title} | ${variant}` : title;
}

function cloneConflict(conflict) {
  return {
    ...conflict,
    unavailableItems: conflict.unavailableItems.map((item) => ({ ...item })),
  };
}

export function mapCheckoutInventoryConflict(error, cart) {
  if (error?.checkoutInventoryError !== INVENTORY_ERROR || !Array.isArray(cart)) return null;
  if (!Array.isArray(error.unavailableItems) || error.unavailableItems.length === 0) return null;

  const unavailableItems = [];

  for (const unavailableItem of error.unavailableItems) {
    const cartItem = cart.find((item) => item?.sku === unavailableItem.sku);
    const reasonContent = REASON_CONTENT[unavailableItem.reason];

    if (!cartItem || !reasonContent) return null;

    unavailableItems.push({
      sku: unavailableItem.sku,
      reason: unavailableItem.reason,
      title: getCartItemTitle(cartItem),
      image: String(cartItem.image || '').trim(),
      reasonLabel: reasonContent.label,
      reasonMessage: reasonContent.message,
    });
  }

  return {
    unavailableItems,
    canRetry: unavailableItems.every((item) => item.reason === 'temporarily_reserved'),
  };
}

export async function continueWithoutUnavailableItems({
  conflict,
  isCurrent,
  removeItems,
  resetCheckout,
}) {
  if (!(await isCurrent(conflict))) return { status: 'stale', cart: null };

  const skus = conflict.unavailableItems.map((item) => item.sku);
  const cart = removeItems(skus);

  await resetCheckout();

  return {
    status: cart.length === 0 ? 'empty' : 'continued',
    cart,
  };
}

export function createCheckoutInventoryConflict(root, { onContinue, onRetry }) {
  const region = root.querySelector('[data-checkout-inventory-conflict]');
  const titleElement = root.querySelector('[data-checkout-inventory-title]');
  const messageElement = root.querySelector('[data-checkout-inventory-message]');
  const itemsElement = root.querySelector('[data-checkout-inventory-items]');
  const retryButton = root.querySelector('[data-checkout-inventory-retry]');
  const continueButton = root.querySelector('[data-checkout-inventory-continue]');
  const requiredElements = [
    region,
    titleElement,
    messageElement,
    itemsElement,
    retryButton,
    continueButton,
  ];
  const hasAnyMarkup = requiredElements.some(Boolean);
  const ready = requiredElements.every(Boolean);
  let currentConflict = null;
  let externallyBusy = false;
  let actionOwner = null;

  if (hasAnyMarkup && !ready) {
    console.error(
      'Checkout inventory conflict UI requires [data-checkout-inventory-conflict], [data-checkout-inventory-title], [data-checkout-inventory-message], [data-checkout-inventory-items], [data-checkout-inventory-retry], and [data-checkout-inventory-continue].'
    );
  }

  function removeGeneratedItems() {
    itemsElement
      ?.querySelectorAll('[data-checkout-inventory-item]')
      .forEach((element) => element.remove());
  }

  function renderBusyState() {
    const busy = externallyBusy || actionOwner !== null;

    for (const button of [retryButton, continueButton]) {
      if (!button) continue;

      button.setAttribute('aria-disabled', String(busy));
      if ('disabled' in button) button.disabled = busy;
    }

    if (region) region.setAttribute('aria-busy', String(busy));
  }

  function hide() {
    currentConflict = null;
    removeGeneratedItems();

    if (titleElement) titleElement.textContent = '';
    if (messageElement) messageElement.textContent = '';
    setUiHidden(retryButton, true);
    setUiHidden(region, true);
  }

  function createItemElement(item) {
    const ownerDocument = root.ownerDocument || document;
    const itemElement = ownerDocument.createElement('div');
    const title = ownerDocument.createElement('p');
    const reason = ownerDocument.createElement('p');

    itemElement.setAttribute('data-checkout-inventory-item', 'true');
    title.setAttribute('data-checkout-inventory-item-title', 'true');
    title.textContent = item.title;
    reason.setAttribute('data-checkout-inventory-item-reason', 'true');
    reason.textContent = `${item.reasonLabel}. ${item.reasonMessage}`;

    if (item.image) {
      const image = ownerDocument.createElement('img');
      image.setAttribute('data-checkout-inventory-item-image', 'true');
      image.src = item.image;
      image.alt = item.title;
      itemElement.appendChild(image);
    }

    itemElement.appendChild(title);
    itemElement.appendChild(reason);
    return itemElement;
  }

  function show(conflict) {
    if (!ready) return false;

    currentConflict = cloneConflict(conflict);
    removeGeneratedItems();
    titleElement.textContent = 'Some items are unavailable';
    messageElement.textContent =
      conflict.unavailableItems.length === 1
        ? 'One item is blocking checkout.'
        : 'These items are blocking checkout.';

    conflict.unavailableItems.forEach((item) => {
      itemsElement.appendChild(createItemElement(item));
    });

    continueButton.textContent =
      conflict.unavailableItems.length === 1
        ? 'Continue Without This Item'
        : 'Continue Without These Items';
    setUiHidden(retryButton, !conflict.canRetry);
    setUiHidden(region, false);
    renderBusyState();
    region.setAttribute('role', 'alert');
    region.setAttribute('aria-live', 'polite');
    region.setAttribute('tabindex', '-1');
    region.focus?.();
    return true;
  }

  function setBusy(nextBusy) {
    externallyBusy = Boolean(nextBusy);
    renderBusyState();
  }

  async function runAction(action, canRun) {
    if (externallyBusy || actionOwner !== null || !canRun(currentConflict)) return;

    const owner = Symbol('checkout-inventory-action');
    const conflict = cloneConflict(currentConflict);
    actionOwner = owner;
    renderBusyState();

    try {
      await action(conflict);
    } finally {
      if (actionOwner === owner) {
        actionOwner = null;
        renderBusyState();
      }
    }
  }

  retryButton?.addEventListener('click', async (event) => {
    event.preventDefault();
    await runAction(onRetry, (conflict) => Boolean(conflict?.canRetry));
  });

  continueButton?.addEventListener('click', async (event) => {
    event.preventDefault();
    await runAction(onContinue, Boolean);
  });

  hide();
  renderBusyState();

  return Object.freeze({
    isReady: ready,
    hide,
    setBusy,
    show,
  });
}
