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

export function createCheckoutDiscount(root, { onApply, onRemove }) {
  const input = root.querySelector('[data-discount-code]');
  const applyControl = root.querySelector('[data-discount-apply]');
  const removeControl = root.querySelector('[data-discount-remove]');
  const messageElement = root.querySelector('[data-discount-message]');
  const hasAnyDiscountUi = Boolean(input || applyControl || removeControl || messageElement);
  const ready = Boolean(input && applyControl && messageElement);
  let requestedCode = '';
  let appliedDiscount = null;
  let busy = false;

  if (hasAnyDiscountUi && !ready) {
    console.error(
      'Discount UI requires [data-discount-code], [data-discount-apply], and [data-discount-message].'
    );
  }

  function showMessage(message, type = 'status') {
    if (!messageElement) return;

    messageElement.textContent = message;
    messageElement.dataset.discountMessageType = type;
    messageElement.style.display = message ? '' : 'none';
  }

  function renderControls() {
    if (input) input.disabled = busy;
    if (applyControl) {
      applyControl.setAttribute('aria-disabled', String(busy));
      if ('disabled' in applyControl) applyControl.disabled = busy;
    }
    if (removeControl) {
      removeControl.style.display = appliedDiscount ? '' : 'none';
      removeControl.setAttribute('aria-disabled', String(busy));
      if ('disabled' in removeControl) removeControl.disabled = busy;
    }
  }

  function setRequestedCode(code) {
    requestedCode = normalizeDiscountCode(code);
    if (input) input.value = requestedCode;
  }

  function setAppliedDiscount(discount) {
    appliedDiscount = discount && typeof discount === 'object' ? { ...discount } : null;
    setRequestedCode(appliedDiscount?.code || '');
    renderControls();

    if (appliedDiscount) {
      showMessage(`${appliedDiscount.code} has been applied.`, 'success');
    } else {
      showMessage('');
    }
  }

  function clearDiscount({ announce = false } = {}) {
    appliedDiscount = null;
    setRequestedCode('');
    renderControls();
    showMessage(announce ? 'Discount code removed.' : '', announce ? 'success' : 'status');
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

      if (!code) {
        showMessage(DISCOUNT_MESSAGES.invalid_code, 'error');
        return;
      }

      try {
        await onApply(code);
      } catch (error) {
        console.error('Discount application failed:', error);
        showMessage(getDiscountErrorMessage(error), 'error');
      }
    });

    removeControl?.addEventListener('click', async (event) => {
      event.preventDefault();

      if (busy) return;

      try {
        await onRemove();
      } catch (error) {
        console.error('Discount removal failed:', error);
        showMessage('Discount code could not be removed.', 'error');
      }
    });
  }

  renderControls();
  showMessage('');

  return Object.freeze({
    available: ready,
    clearDiscount,
    getAppliedDiscount() {
      return appliedDiscount ? { ...appliedDiscount } : null;
    },
    getRequestedCode() {
      return requestedCode;
    },
    setAppliedDiscount,
    setBusy,
    setRequestedCode,
    showError(error) {
      showMessage(getDiscountErrorMessage(error), 'error');
    },
    showSelectShipping(code) {
      setRequestedCode(code);
      showMessage('Select a shipping method to apply this code.', 'status');
    },
  });
}
