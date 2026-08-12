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

export function getCheckoutDiscountDisplay(discount, shippingOption = null) {
  if (!discount || typeof discount !== 'object') {
    return Object.freeze({ visible: false, amount: 0, code: '', label: 'Discount' });
  }

  const code = String(discount.code ?? '').trim();
  const isFreeShipping = discount.type === 'free_shipping';
  const amount = isFreeShipping
    ? Number(shippingOption?.original_shipping ?? discount.shipping_discount_amount ?? 0)
    : Number(discount.discount_amount ?? 0);

  if (!Number.isSafeInteger(amount) || amount <= 0) {
    return Object.freeze({
      visible: false,
      amount: 0,
      code,
      label: isFreeShipping ? 'Shipping discount' : 'Discount',
    });
  }

  return Object.freeze({
    visible: true,
    amount,
    code,
    label: isFreeShipping ? 'Shipping discount' : 'Discount',
  });
}

export function createCheckoutSummary(root) {
  const subtotalElement = root.querySelector('[data-checkout-subtotal]');
  const shippingElement = root.querySelector('[data-checkout-shipping]');
  const totalElement = root.querySelector('[data-checkout-total]');
  const discountRow = root.querySelector('[data-checkout-discount-row]');
  const discountCodeElement = root.querySelector('[data-checkout-discount-code]');
  const discountAmountElement = root.querySelector('[data-checkout-discount]');
  const discountLabelElement = root.querySelector('[data-checkout-discount-label]');

  function renderDiscount(discount, shippingOption, currency = 'GBP') {
    const display = getCheckoutDiscountDisplay(discount, shippingOption);

    if (discountRow) discountRow.hidden = !display.visible;
    if (discountCodeElement) discountCodeElement.textContent = display.code;
    if (discountLabelElement) discountLabelElement.textContent = display.label;
    if (discountAmountElement) {
      discountAmountElement.textContent = display.visible
        ? `-${formatMoneyFromPence(display.amount, currency)}`
        : '';
    }
  }

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

    renderDiscount(null, null, result.currency);
  }

  function renderPreparedCheckout(result, shippingOption = null) {
    const discountDisplay = getCheckoutDiscountDisplay(result.discount || null, shippingOption);
    const shippingAmount =
      result.discount?.type === 'free_shipping' && discountDisplay.visible
        ? discountDisplay.amount
        : result.shipping;

    if (subtotalElement) {
      subtotalElement.textContent = formatMoneyFromPence(result.subtotal, result.currency);
    }
    if (shippingElement) {
      shippingElement.textContent = formatMoneyFromPence(shippingAmount, result.currency);
    }
    if (totalElement) {
      totalElement.textContent = formatMoneyFromPence(result.total, result.currency);
    }

    renderDiscount(result.discount || null, shippingOption, result.currency);
  }

  function renderStripeSession(session, discount = null, shippingOption = null) {
    const currency = session.currency || 'GBP';
    const discountDisplay = getCheckoutDiscountDisplay(discount, shippingOption);
    const shippingAmount =
      discount?.type === 'free_shipping' && discountDisplay.visible
        ? discountDisplay.amount
        : session.total.shippingRate.minorUnitsAmount;

    if (subtotalElement) {
      subtotalElement.textContent = formatMoneyFromPence(
        session.total.subtotal.minorUnitsAmount,
        currency
      );
    }
    if (shippingElement) {
      shippingElement.textContent = formatMoneyFromPence(shippingAmount, currency);
    }
    if (totalElement) {
      totalElement.textContent = formatMoneyFromPence(
        session.total.total.minorUnitsAmount,
        currency
      );
    }

    renderDiscount(discount, shippingOption, currency);
  }

  renderDiscount(null);

  return Object.freeze({
    renderCanonicalItems,
    renderItems,
    renderPreparedCheckout,
    renderShippingOptionsResult,
    renderStripeSession,
    renderDiscount,
  });
}
