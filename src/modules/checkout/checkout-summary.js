function formatMoneyFromPence(value, currency = 'GBP') {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(Number(value || 0) / 100);
}

function formatMoney(value, currency = 'GBP') {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(Number(value || 0));
}

function removeGeneratedItems(wrapper) {
  wrapper.querySelectorAll('[data-order-summary-generated="true"]').forEach((element) => {
    element.remove();
  });
}

export function createCheckoutSummary(root) {
  const subtotalElement = root.querySelector('[data-checkout-subtotal]');
  const shippingElement = root.querySelector('[data-checkout-shipping]');
  const totalElement = root.querySelector('[data-checkout-total]');

  function renderItems(cart) {
    const wrapper = root.querySelector('[data-order-summary-items="true"]');
    const template = root.querySelector('[data-order-summary-template="true"]');

    if (!wrapper || !template) return;

    removeGeneratedItems(wrapper);

    cart.forEach((item) => {
      const clone = template.cloneNode(true);
      const quantity = Number(item.quantity || 1);

      clone.removeAttribute('data-order-summary-template');
      clone.setAttribute('data-order-summary-generated', 'true');
      clone.style.display = 'flex';

      const nameElement = clone.querySelector('[data-order-summary-name="true"]');
      const quantityElement = clone.querySelector('[data-order-summary-qty="true"]');
      const priceElement = clone.querySelector('[data-order-summary-price="true"]');
      const imageElement = clone.querySelector('[data-order-summary-image="true"]');
      const amountElement = clone.querySelector('[data-order-summary-amount="true"]');

      if (nameElement) nameElement.textContent = item.title || item.name || item.sku || 'Product';
      if (quantityElement) quantityElement.textContent = String(quantity);
      if (priceElement) {
        priceElement.textContent = formatMoney(
          Number(item.price || 0) * quantity,
          item.currency || 'GBP'
        );
      }
      if (imageElement && item.image) {
        imageElement.src = item.image;
        imageElement.alt = item.title || item.name || item.sku || 'Product image';
      }
      if (amountElement) {
        const amount = item.amount && item.amount !== 'default' ? item.amount : '';
        amountElement.textContent = amount;
        amountElement.style.display = amount ? '' : 'none';
      }

      wrapper.appendChild(clone);
    });
  }

  function renderCanonicalItems(items) {
    if (!Array.isArray(items)) return;

    renderItems(
      items.map((item) => ({
        ...item,
        title: item.product_name || item.name,
        price: Number(item.unit_amount || 0) / 100,
        image: item.image_url || '',
      }))
    );
  }

  function renderShippingOptionsResult(result) {
    if (subtotalElement) {
      subtotalElement.textContent = formatMoneyFromPence(result.subtotal, result.currency);
    }
    if (shippingElement) shippingElement.textContent = 'Please select shipping method';
    if (totalElement) {
      totalElement.textContent = formatMoneyFromPence(result.subtotal, result.currency);
    }
  }

  function renderPreparedCheckout(result) {
    if (subtotalElement) {
      subtotalElement.textContent = formatMoneyFromPence(result.subtotal, result.currency);
    }
    if (shippingElement) {
      shippingElement.textContent = formatMoneyFromPence(result.shipping, result.currency);
    }
    if (totalElement) {
      totalElement.textContent = formatMoneyFromPence(result.total, result.currency);
    }
  }

  function renderStripeSession(session) {
    const currency = session.currency || 'GBP';

    if (subtotalElement) {
      subtotalElement.textContent = formatMoneyFromPence(
        session.total.subtotal.minorUnitsAmount,
        currency
      );
    }
    if (shippingElement) {
      shippingElement.textContent = formatMoneyFromPence(
        session.total.shippingRate.minorUnitsAmount,
        currency
      );
    }
    if (totalElement) {
      totalElement.textContent = formatMoneyFromPence(
        session.total.total.minorUnitsAmount,
        currency
      );
    }
  }

  return Object.freeze({
    renderCanonicalItems,
    renderItems,
    renderPreparedCheckout,
    renderShippingOptionsResult,
    renderStripeSession,
  });
}
