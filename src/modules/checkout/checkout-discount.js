const DISCOUNT_MESSAGES = Object.freeze({
  invalid_code: 'This discount code is not valid.',
  account_required: 'Sign in or create an account to use this code.',
  not_eligible: "This discount code isn't available for this order.",
  discount_unavailable: 'This discount code is temporarily unavailable.',
});

function formatMoneyFromPence(value) {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
  }).format(Number(value || 0) / 100);
}

export function normalizeDiscountCode(value) {
  return String(value ?? '')
    .trim()
    .toUpperCase();
}

export function getDiscountErrorMessage(error) {
  if (error?.discountError === 'minimum_subtotal_not_met') {
    if (Number.isSafeInteger(error.minimumSubtotalAmount)) {
      return `This code requires a minimum spend of ${formatMoneyFromPence(
        error.minimumSubtotalAmount
      )}.`;
    }

    return "This order doesn't meet the minimum spend for that code.";
  }

  return DISCOUNT_MESSAGES[error?.discountError] || 'Discount code could not be applied.';
}

export function toSingleAppliedDiscount(discount) {
  return discount && typeof discount === 'object' && !Array.isArray(discount)
    ? [{ ...discount }]
    : [];
}

export function createCheckoutDiscount(root, { onApply, onRemove }) {
  const input = root.querySelector('[data-discount-code="true"]');
  const applyControl = root.querySelector('[data-discount-apply="true"]');
  const appliedDiscountsWrapper = root.querySelector('[data-applied-discounts="true"]');
  const discoveredAppliedDiscountTemplate = root.querySelector(
    '[data-applied-discount-template="true"]'
  );
  const appliedDiscountTemplate = appliedDiscountsWrapper?.querySelector(
    '[data-applied-discount-template="true"]'
  );
  const successElement = root.querySelector('[data-discount-success="true"]');
  const errorElement = root.querySelector('[data-discount-error="true"]');
  const requiredElements = [
    input,
    applyControl,
    appliedDiscountsWrapper,
    appliedDiscountTemplate,
    successElement,
    errorElement,
  ];
  const hasAnyDiscountUi = Boolean(
    requiredElements.some(Boolean) || discoveredAppliedDiscountTemplate
  );
  const ready = requiredElements.every(Boolean);
  let requestedCode = '';
  let appliedDiscounts = [];
  let busy = false;

  if (hasAnyDiscountUi && !ready) {
    console.error(
      'Discount UI requires [data-discount-code="true"], [data-discount-apply="true"], [data-applied-discounts="true"], [data-applied-discount-template="true"], [data-discount-success="true"], and [data-discount-error="true"].'
    );
  }

  function hideMessage(element) {
    if (!element) return;

    element.textContent = '';
    element.style.display = 'none';
  }

  function clearMessages() {
    if (!ready) return;

    hideMessage(successElement);
    hideMessage(errorElement);
  }

  function showSuccess(message) {
    if (!ready) return;

    hideMessage(errorElement);

    successElement.textContent = message;
    successElement.style.display = message ? '' : 'none';
  }

  function showErrorMessage(message) {
    if (!ready) return;

    hideMessage(successElement);

    errorElement.textContent = message;
    errorElement.style.display = message ? '' : 'none';
  }

  function setControlBusy(control) {
    if (!control) return;

    control.setAttribute('aria-disabled', String(busy));
    if ('disabled' in control) control.disabled = busy;
  }

  function renderControls() {
    if (!ready) return;

    if (input) input.disabled = busy;
    setControlBusy(applyControl);
    appliedDiscountsWrapper
      ?.querySelectorAll('[data-applied-discount-generated="true"]')
      .forEach((row) => {
        setControlBusy(row.querySelector('[data-applied-discount-remove="true"]'));
      });
  }

  function setRequestedCode(code) {
    requestedCode = normalizeDiscountCode(code);
    if (ready) input.value = requestedCode;
  }

  function renderAppliedDiscounts() {
    if (!ready) return;

    appliedDiscountsWrapper
      .querySelectorAll('[data-applied-discount-generated="true"]')
      .forEach((row) => row.remove());

    appliedDiscounts.forEach((discount) => {
      const row = appliedDiscountTemplate.cloneNode(true);
      const codeElement = row.querySelector('[data-applied-discount-code="true"]');
      const removeControl = row.querySelector('[data-applied-discount-remove="true"]');

      row.removeAttribute('data-applied-discount-template');
      row.setAttribute('data-applied-discount-generated', 'true');
      row.hidden = false;
      row.style.display = '';

      if (codeElement) codeElement.textContent = normalizeDiscountCode(discount.code);
      setControlBusy(removeControl);

      removeControl?.addEventListener('click', async (event) => {
        event.preventDefault();

        if (busy) return;

        clearMessages();

        try {
          await onRemove();
          clearDiscount({ announce: true });
        } catch (error) {
          console.error('Discount removal failed:', error);
          showErrorMessage('Discount code could not be removed.');
        }
      });

      appliedDiscountsWrapper.appendChild(row);
    });

    renderControls();
  }

  function setAppliedDiscount(discount) {
    appliedDiscounts = toSingleAppliedDiscount(discount);
    setRequestedCode('');
    renderAppliedDiscounts();

    if (appliedDiscounts[0]) {
      showSuccess(`${normalizeDiscountCode(appliedDiscounts[0].code)} has been applied.`);
    } else {
      clearMessages();
    }
  }

  function clearDiscount({ announce = false } = {}) {
    appliedDiscounts = [];
    setRequestedCode('');
    renderAppliedDiscounts();

    if (announce) {
      showSuccess('Discount code removed.');
    } else {
      clearMessages();
    }
  }

  function setBusy(nextBusy) {
    busy = Boolean(nextBusy);
    renderControls();
  }

  if (ready) {
    input.addEventListener('blur', () => {
      setRequestedCode(input.value);
    });

    applyControl.addEventListener('click', async (event) => {
      event.preventDefault();

      if (busy) return;

      const code = normalizeDiscountCode(input.value);
      setRequestedCode(code);
      clearMessages();

      if (!code) {
        showErrorMessage(DISCOUNT_MESSAGES.invalid_code);
        return;
      }

      try {
        await onApply(code);
      } catch (error) {
        console.error('Discount application failed:', error);
        showErrorMessage(getDiscountErrorMessage(error));
      }
    });
  }

  if (ready) {
    renderAppliedDiscounts();
    clearMessages();
  }

  return Object.freeze({
    available: ready,
    clearDiscount,
    getAppliedDiscount() {
      return appliedDiscounts[0] ? { ...appliedDiscounts[0] } : null;
    },
    getRequestedCode() {
      return requestedCode;
    },
    setAppliedDiscount,
    setBusy,
    setRequestedCode,
    showError(error) {
      showErrorMessage(getDiscountErrorMessage(error));
    },
    showSelectShipping(code) {
      setRequestedCode(code);
      showSuccess('Select a shipping method to apply this code.');
    },
  });
}
