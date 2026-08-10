function normalizeMethodName(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase();
}

function formatMoneyFromPence(value, currency = 'GBP') {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(Number(value || 0) / 100);
}

function getWrapperName(wrapper) {
  return wrapper.getAttribute('data-shipping-method-name')?.trim() || '';
}

export function createCheckoutShipping(root, onSelect) {
  const wrappers = Array.from(root.querySelectorAll('[data-shipping-method-option="true"]'));

  function getSelectedMethodName() {
    const selectedRadio = root.querySelector(
      '[data-shipping-method-option="true"] input[type="radio"]:checked'
    );

    return selectedRadio
      ? getWrapperName(selectedRadio.closest('[data-shipping-method-option]'))
      : '';
  }

  function renderSelection() {
    wrappers.forEach((wrapper) => {
      const radio = wrapper.querySelector('input[type="radio"]');
      wrapper.classList.toggle('is-selected', Boolean(radio?.checked));
    });
  }

  function renderOptions(options) {
    wrappers.forEach((wrapper) => {
      const methodName = getWrapperName(wrapper);
      const option = options.find(
        (candidate) => normalizeMethodName(candidate.name) === normalizeMethodName(methodName)
      );
      const radio = wrapper.querySelector('input[type="radio"]');
      const priceElement = wrapper.querySelector('[data-shipping-method-price]');

      if (radio) radio.disabled = !option;
      if (priceElement && option) {
        priceElement.textContent = formatMoneyFromPence(option.shipping, option.currency);
      }
    });

    root.querySelectorAll('[data-shipping-method-price]').forEach((priceElement) => {
      const methodName = priceElement.getAttribute('data-shipping-method-price');
      const option = options.find(
        (candidate) => normalizeMethodName(candidate.name) === normalizeMethodName(methodName)
      );

      if (option) {
        priceElement.textContent = formatMoneyFromPence(option.shipping, option.currency);
      }
    });
  }

  wrappers.forEach((wrapper) => {
    const radio = wrapper.querySelector('input[type="radio"]');

    if (radio) radio.checked = false;

    radio?.addEventListener('change', () => {
      if (!radio.checked || radio.disabled) return;

      renderSelection();
      void onSelect(getWrapperName(wrapper));
    });

    wrapper.addEventListener('click', (event) => {
      if (!radio || radio.disabled || event.target === radio) return;

      event.preventDefault();
      radio.checked = true;
      radio.dispatchEvent(new Event('change', { bubbles: true }));
    });
  });

  renderSelection();

  return Object.freeze({ getSelectedMethodName, renderOptions, renderSelection });
}
