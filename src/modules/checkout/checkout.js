import { getCart } from '../cart/cart.js';
import { createCheckoutElementsSdk } from '../../services/stripe/checkout.js';
import {
  abandonCheckoutAttempt,
  createCheckoutSession,
  getShippingOptions,
  resumeCheckoutSession,
  updateCheckoutDetails,
} from '../../services/supabase/checkout.js';
import {
  getCheckoutAddressData,
  initialiseCheckoutAddress,
  toStripeContact,
} from './checkout-address.js';
import { removeCheckoutCapability, storeCheckoutCapability } from './checkout-capability.js';
import {
  beginCheckoutOperation,
  beginCheckoutResume,
  CHECKOUT_PROTOCOL_VERSION,
  clearCheckoutAttempt,
  createCheckoutAttemptEnvelope,
  discardCheckoutOperation,
  fingerprintCart,
  loadCheckoutAttempt,
  probeCheckoutSessionStorage,
  promoteCheckoutCandidate,
  saveCheckoutAttempt,
  setCheckoutCandidate,
  setCheckoutOperationPhase,
} from './checkout-attempt.js';
import { createCheckoutDiscount } from './checkout-discount.js';
import { createCheckoutShipping } from './checkout-shipping.js';
import { createCheckoutSummary } from './checkout-summary.js';
import { validateCheckout } from './checkout-validation.js';

function normalizeMethodName(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase();
}

function getStripeDefaultValues(addressData) {
  return {
    email: addressData.shipping.email || undefined,
    phoneNumber: addressData.shipping.phone || undefined,
    shippingAddress: toStripeContact(addressData.shipping),
    billingAddress: toStripeContact(addressData.billing),
  };
}

function applyLockedCustomerEmail(root, lockedCustomerEmail) {
  const email = String(lockedCustomerEmail ?? '').trim();

  if (!email) return;

  const emailInput = root.querySelector('[data-shipping-email]');

  if (!emailInput) return;

  emailInput.value = email;
  emailInput.readOnly = true;
}

function getShippingOption(shippingOptions, methodName) {
  const normalizedMethodName = normalizeMethodName(methodName);

  return shippingOptions.find(
    (candidate) => normalizeMethodName(candidate.name) === normalizedMethodName
  );
}

function validatePreparedCheckout(result) {
  if (
    !result?.client_secret ||
    !result.checkout_session_id ||
    !result.confirmation_token ||
    !Array.isArray(result.shipping_options)
  ) {
    throw new Error('Payment preparation returned an incomplete response.');
  }
}

function validateReservationPreparedCheckout(result, envelope) {
  validatePreparedCheckout(result);

  if (
    result.checkout_protocol_version !== CHECKOUT_PROTOCOL_VERSION ||
    !result.checkout_intent_id ||
    !result.checkout_attempt_id ||
    !result.checkout_request_id ||
    !Number.isSafeInteger(result.confirmation_generation) ||
    result.confirmation_generation < 1 ||
    !Array.isArray(result.items) ||
    result.checkout_attempt_id !== envelope.attempt.checkoutAttemptId ||
    result.checkout_request_id !== envelope.currentOperation?.checkoutRequestId
  ) {
    throw new Error('Payment preparation returned an invalid reservation response.');
  }
}

function delay(duration) {
  return new Promise((resolve) => window.setTimeout(resolve, duration));
}

class CheckoutCartChangedError extends Error {
  constructor() {
    super('Your basket changed. Checkout must be reset before payment can continue.');
    this.name = 'CheckoutCartChangedError';
  }
}

export async function initCheckout() {
  const root = document.querySelector('[data-checkout-root="true"]');

  if (!root) return null;

  const payButton = root.querySelector('[data-pay-button]');
  const errorElement = root.querySelector('[data-checkout-error]');
  const paymentElementWrapper = root.querySelector('[data-stripe-payment-element]');

  if (!payButton || !paymentElementWrapper) {
    console.error(
      'Checkout requires [data-pay-button] and [data-stripe-payment-element] inside [data-checkout-root="true"].'
    );
    return null;
  }

  let cart = getCart();
  const summary = createCheckoutSummary(root);
  const state = {
    actions: null,
    checkout: null,
    elementsGeneration: 0,
    checkoutSessionId: null,
    confirmationToken: null,
    discount: null,
    confirming: false,
    payDisabled: true,
    paymentElement: null,
    preparingPromise: null,
    protocolMode: 'negotiating',
    reservationCommitted: false,
    retryAvailable: false,
    shippingOptions: [],
  };
  let discountController;
  let shipping;
  let checkoutEnvelope = null;
  let currentCommand = null;
  let cartFingerprint = '';

  function showError(message) {
    if (!errorElement) return;

    errorElement.textContent = message;
    errorElement.style.display = message ? 'block' : 'none';
  }

  function setPayButton(label, disabled) {
    payButton.textContent = label;
    state.payDisabled = disabled;
    payButton.setAttribute('aria-disabled', String(disabled));
    payButton.classList.toggle('is-disabled', disabled);
  }

  function setCheckoutControlsBusy(busy) {
    discountController?.setBusy(busy);
    shipping?.setBusy(busy);
  }

  async function runCheckoutMutation(callback) {
    while (state.preparingPromise) {
      try {
        await state.preparingPromise;
      } catch {
        // A queued mutation should still be able to proceed after an earlier failure.
      }
    }

    const mutation = Promise.resolve().then(callback);
    state.preparingPromise = mutation;

    try {
      return await mutation;
    } finally {
      if (state.preparingPromise === mutation) state.preparingPromise = null;
    }
  }

  async function updateStripeShippingOption(actions, shippingOptions, methodName) {
    const option = getShippingOption(shippingOptions, methodName);

    if (!actions || !option?.stripe_shipping_rate_id) {
      throw new Error('The selected shipping method is unavailable.');
    }

    const result = await actions.updateShippingOption(option.stripe_shipping_rate_id);

    if (result.type === 'error') {
      throw new Error(result.error.message || 'The shipping method could not be selected.');
    }

    return { option, session: result.session };
  }

  async function selectStripeShippingOption(methodName) {
    const selection = await updateStripeShippingOption(
      state.actions,
      state.shippingOptions,
      methodName
    );

    summary.renderStripeSession(selection.session, state.discount, selection.option);
    return selection;
  }

  async function installPreparedCheckout(result, methodName) {
    const responseProtocol = result?.checkout_protocol_version;

    if (responseProtocol && responseProtocol !== CHECKOUT_PROTOCOL_VERSION) {
      throw new Error('Payment preparation returned an unsupported protocol.');
    }

    if (responseProtocol === CHECKOUT_PROTOCOL_VERSION) {
      if (!checkoutEnvelope?.currentOperation) {
        throw new Error('Checkout reservation operation is unavailable.');
      }

      validateReservationPreparedCheckout(result, checkoutEnvelope);

      if ((await fingerprintCart(result.items)) !== cartFingerprint) {
        throw new Error('The prepared checkout does not match this basket.');
      }

      state.protocolMode = CHECKOUT_PROTOCOL_VERSION;
      state.reservationCommitted = true;
      checkoutEnvelope = setCheckoutCandidate(checkoutEnvelope, {
        checkoutRequestId: result.checkout_request_id,
        checkoutIntentId: result.checkout_intent_id,
        checkoutSessionId: result.checkout_session_id,
        confirmationToken: result.confirmation_token,
        confirmationGeneration: result.confirmation_generation,
      });
      checkoutEnvelope = saveCheckoutAttempt(checkoutEnvelope);
    } else {
      if (state.reservationCommitted || state.protocolMode === CHECKOUT_PROTOCOL_VERSION) {
        throw new Error('A reservation checkout cannot downgrade to the legacy protocol.');
      }

      validatePreparedCheckout(result);
      state.protocolMode = 'legacy';
      checkoutEnvelope = null;
      clearCheckoutAttempt();
    }

    const previousCheckoutSessionId = state.checkoutSessionId;
    const nextGeneration = state.elementsGeneration + 1;
    const addressData = getCheckoutAddressData(root);
    const checkout = await createCheckoutElementsSdk(
      result.client_secret,
      getStripeDefaultValues(addressData)
    );
    const actionsResult = await checkout.loadActions();

    if (actionsResult.type === 'error') {
      throw new Error(actionsResult.error.message || 'Stripe Checkout could not be loaded.');
    }

    const actions = actionsResult.actions;
    const selection = await updateStripeShippingOption(
      actions,
      result.shipping_options,
      methodName
    );
    const paymentElement = checkout.createPaymentElement({
      layout: 'tabs',
      fields: {
        billingDetails: {
          name: 'never',
          address: 'never',
        },
      },
    });

    if (state.protocolMode === 'legacy') {
      storeCheckoutCapability(
        result.checkout_session_id,
        result.confirmation_token,
        result.checkout_intent_id
      );
    }
    applyLockedCustomerEmail(root, result.locked_customer_email);

    checkout.on('change', (session) => {
      if (nextGeneration !== state.elementsGeneration) return;

      const selectedOption = getShippingOption(
        state.shippingOptions,
        shipping.getSelectedMethodName()
      );
      summary.renderStripeSession(session, state.discount, selectedOption);
    });

    if (
      state.protocolMode === CHECKOUT_PROTOCOL_VERSION &&
      result.checkout_request_id !== checkoutEnvelope?.currentOperation?.checkoutRequestId
    ) {
      throw new Error('Checkout operation changed before Payment Element installation.');
    }

    state.paymentElement?.destroy();
    paymentElementWrapper.replaceChildren();
    paymentElement.mount(paymentElementWrapper);

    state.actions = actions;
    state.checkout = checkout;
    state.elementsGeneration = nextGeneration;
    state.checkoutSessionId = result.checkout_session_id;
    state.confirmationToken = result.confirmation_token;
    state.discount = result.discount ? { ...result.discount } : null;
    state.paymentElement = paymentElement;
    state.shippingOptions = result.shipping_options.map((option) => ({ ...option }));

    shipping.renderOptions(state.shippingOptions);
    summary.renderCanonicalItems(result.items);
    summary.renderPreparedCheckout(result, selection.option);
    discountController.setAppliedDiscount(state.discount);

    if (state.protocolMode === CHECKOUT_PROTOCOL_VERSION) {
      checkoutEnvelope = promoteCheckoutCandidate(checkoutEnvelope, methodName);
      checkoutEnvelope = saveCheckoutAttempt(checkoutEnvelope);
    }

    if (
      state.protocolMode === 'legacy' &&
      previousCheckoutSessionId &&
      previousCheckoutSessionId !== result.checkout_session_id
    ) {
      removeCheckoutCapability(previousCheckoutSessionId);
    }

    currentCommand = null;
    state.retryAvailable = false;
  }

  async function currentCartMatchesAttempt() {
    try {
      return (await fingerprintCart(getCart())) === cartFingerprint;
    } catch {
      return false;
    }
  }

  async function assertCurrentCart() {
    if (!(await currentCartMatchesAttempt())) throw new CheckoutCartChangedError();
  }

  async function loadCurrentCartShippingOptions() {
    const shippingResult = await getShippingOptions(cart);

    if (!Array.isArray(shippingResult.options) || shippingResult.options.length === 0) {
      throw new Error('No shipping methods are available for this basket.');
    }

    shipping.renderOptions(shippingResult.options);
    summary.renderCanonicalItems(shippingResult.items);
    summary.renderShippingOptionsResult(shippingResult);
  }

  function persistOperationPhase(phase) {
    if (!checkoutEnvelope?.currentOperation) return;

    checkoutEnvelope = setCheckoutOperationPhase(checkoutEnvelope, phase);
    checkoutEnvelope = saveCheckoutAttempt(checkoutEnvelope);
  }

  async function invokePreparedCheckout(request) {
    const maximumAttempts = 4;

    for (let attempt = 0; attempt < maximumAttempts; attempt += 1) {
      try {
        persistOperationPhase('submitted');
        return await request();
      } catch (error) {
        if (error?.orchestrationError === 'reconciliation_required') {
          persistOperationPhase('reconciliation-pending');
          throw error;
        }

        if (!error?.retryable || attempt === maximumAttempts - 1) throw error;

        persistOperationPhase('processing');
        const retryDelay = error.retryAfterMs || Math.min(12000, 1500 * 2 ** attempt);
        await delay(retryDelay);
      }
    }

    throw new Error('Payment preparation could not be completed.');
  }

  async function requestPreparedCheckout(methodName, discountCode, replaceCurrentCheckout) {
    await assertCurrentCart();
    const addressData = getCheckoutAddressData(root);

    if (state.protocolMode === 'legacy') {
      return createCheckoutSession({
        cart,
        shippingMethodName: methodName,
        addressData,
        discountCode,
        ...(replaceCurrentCheckout && state.checkoutSessionId
          ? {
              replaceCheckoutSessionId: state.checkoutSessionId,
              replaceConfirmationToken: state.confirmationToken,
            }
          : {}),
      });
    }

    if (!checkoutEnvelope) {
      checkoutEnvelope = createCheckoutAttemptEnvelope(cartFingerprint);
    }

    if (!checkoutEnvelope.currentOperation) {
      checkoutEnvelope = beginCheckoutOperation(
        checkoutEnvelope,
        replaceCurrentCheckout ? 'replacement' : 'initial',
        methodName
      );
      checkoutEnvelope = saveCheckoutAttempt(checkoutEnvelope);
      currentCommand = {
        cart,
        shippingMethodName: methodName,
        addressData,
        discountCode,
        ...(replaceCurrentCheckout && state.checkoutSessionId
          ? {
              replaceCheckoutSessionId: state.checkoutSessionId,
              replaceConfirmationToken: state.confirmationToken,
            }
          : {}),
      };
    }

    const operation = checkoutEnvelope.currentOperation;
    const attempt = checkoutEnvelope.attempt;

    if (!currentCommand) {
      return invokePreparedCheckout(() =>
        resumeCheckoutSession({
          checkoutAttemptId: attempt.checkoutAttemptId,
          checkoutAttemptToken: attempt.checkoutAttemptToken,
          checkoutRequestId: operation.checkoutRequestId,
        })
      );
    }

    return invokePreparedCheckout(() =>
      createCheckoutSession({
        ...currentCommand,
        checkoutAttemptId: attempt.checkoutAttemptId,
        checkoutAttemptToken: attempt.checkoutAttemptToken,
        checkoutRequestId: operation.checkoutRequestId,
      })
    );
  }

  async function prepareCheckout(methodName) {
    await runCheckoutMutation(async () => {
      setCheckoutControlsBusy(true);
      setPayButton(state.actions ? 'Updating...' : 'Preparing payment...', true);
      let succeeded = false;

      try {
        if (state.actions) {
          await assertCurrentCart();
          await selectStripeShippingOption(methodName);
        } else {
          const result = await requestPreparedCheckout(
            methodName,
            discountController.getRequestedCode(),
            false
          );
          await installPreparedCheckout(result, methodName);
        }

        showError('');
        succeeded = true;
      } catch (error) {
        if (error instanceof CheckoutCartChangedError || isSafelyResettableAttemptError(error)) {
          try {
            await resetCheckoutForCurrentCart(
              error instanceof CheckoutCartChangedError
                ? 'Your basket changed. Checkout is being reset safely.'
                : 'Checkout preparation expired and is being reset safely.'
            );
          } catch (resetError) {
            console.error('Checkout cart reset failed:', resetError);
            showError(resetError.message || 'Checkout is temporarily unavailable.');
            setPayButton('Payment Unavailable', true);
          }

          return;
        } else if (error?.discountError) {
          if (checkoutEnvelope?.currentOperation && !checkoutEnvelope.currentOperation.candidate) {
            checkoutEnvelope = discardCheckoutOperation(checkoutEnvelope);
            checkoutEnvelope = saveCheckoutAttempt(checkoutEnvelope);
            currentCommand = null;
          }
          discountController.showError(error);
          showError('');
        } else {
          console.error('Checkout preparation failed:', error);
          showError(error.message || 'Payment could not be prepared.');
        }

        state.retryAvailable = Boolean(error?.retryable && checkoutEnvelope?.currentOperation);
        setPayButton(
          state.retryAvailable ? 'Retry Payment' : 'Payment Unavailable',
          !state.retryAvailable
        );
      } finally {
        setCheckoutControlsBusy(false);
        if (succeeded) setPayButton('Place Order', false);
      }
    });
  }

  function canRestorePreviousCheckout(error, backendReplacementCompleted) {
    if (!state.actions || backendReplacementCompleted) return false;
    if (error?.discountError) return true;

    return (
      error?.checkoutReplacementError === 'previous_checkout_usable' ||
      error?.orchestrationError === 'previous_checkout_usable'
    );
  }

  function navigateToConfirmation(checkoutSessionId) {
    if (!checkoutSessionId) {
      throw new Error('Order confirmation details are unavailable.');
    }

    const confirmationUrl = new URL(
      '/order-confirmation-test',
      'https://www.theanimalalchemist.com'
    );
    confirmationUrl.searchParams.set('checkout_session_id', checkoutSessionId);
    window.location.assign(confirmationUrl);
  }

  async function resetChangedCartAttempt() {
    if (!checkoutEnvelope) return true;

    setCheckoutControlsBusy(true);
    setPayButton('Resetting Checkout...', true);

    const result = await abandonCheckoutAttempt({
      checkoutAttemptId: checkoutEnvelope.attempt.checkoutAttemptId,
      checkoutAttemptToken: checkoutEnvelope.attempt.checkoutAttemptToken,
    });

    if (result.result === 'already_paid') {
      navigateToConfirmation(checkoutEnvelope.activeCheckout?.checkoutSessionId);
      return false;
    }

    if (!['abandoned', 'already_terminal', 'attempt_not_found'].includes(result.result)) {
      throw new Error('Checkout is still being reconciled. Please try again shortly.');
    }

    clearCheckoutAttempt();
    cart = getCart();
    state.paymentElement?.destroy();
    paymentElementWrapper.replaceChildren();
    state.actions = null;
    state.checkout = null;
    state.elementsGeneration += 1;
    state.checkoutSessionId = null;
    state.confirmationToken = null;
    state.discount = null;
    state.paymentElement = null;
    state.retryAvailable = false;
    state.shippingOptions = [];
    summary.renderItems(cart);
    summary.renderDiscount(null);
    discountController.clearDiscount();

    if (cart.length === 0) {
      cartFingerprint = '';
      checkoutEnvelope = null;
      currentCommand = null;
      state.protocolMode = 'negotiating';
      state.reservationCommitted = false;
      return true;
    }

    cartFingerprint = await fingerprintCart(cart);
    checkoutEnvelope = createCheckoutAttemptEnvelope(cartFingerprint);
    checkoutEnvelope = saveCheckoutAttempt(checkoutEnvelope);
    currentCommand = null;
    state.protocolMode = 'negotiating';
    state.reservationCommitted = false;

    return true;
  }

  async function resetCheckoutForCurrentCart(message) {
    showError(message);

    if (!(await resetChangedCartAttempt())) return;

    if (cart.length === 0) {
      setPayButton('Basket Empty', true);
      return;
    }

    await loadCurrentCartShippingOptions();
    setPayButton('Select Shipping', true);
  }

  function isSafelyResettableAttemptError(error) {
    return ['request_not_materialized', 'checkout_attempt_terminal'].includes(
      error?.orchestrationError
    );
  }

  async function replaceDiscount(discountCode, { announceRemoval = false } = {}) {
    const methodName = shipping.getSelectedMethodName();

    if (!discountCode && !state.checkoutSessionId) {
      discountController.clearDiscount({ announce: announceRemoval });
      summary.renderDiscount(null);
      return;
    }

    if (!methodName) {
      if (discountCode) {
        discountController.showSelectShipping(discountCode);
      } else {
        discountController.clearDiscount({ announce: announceRemoval });
        summary.renderDiscount(null);
      }

      return;
    }

    await runCheckoutMutation(async () => {
      const replacingExistingCheckout = Boolean(state.checkoutSessionId);
      let backendReplacementCompleted = false;

      setCheckoutControlsBusy(true);
      setPayButton(discountCode ? 'Applying discount...' : 'Removing discount...', true);

      try {
        const result = await requestPreparedCheckout(
          methodName,
          discountCode,
          replacingExistingCheckout
        );
        backendReplacementCompleted = replacingExistingCheckout;
        await installPreparedCheckout(result, methodName);

        if (!result.discount && announceRemoval) {
          discountController.clearDiscount({ announce: true });
        }

        showError('');
        setPayButton('Place Order', false);
      } catch (error) {
        if (error instanceof CheckoutCartChangedError || isSafelyResettableAttemptError(error)) {
          try {
            await resetCheckoutForCurrentCart(
              error instanceof CheckoutCartChangedError
                ? 'Your basket changed. Checkout is being reset safely.'
                : 'Checkout preparation expired and is being reset safely.'
            );
          } catch (resetError) {
            console.error('Checkout cart reset failed:', resetError);
            showError(resetError.message || 'Checkout is temporarily unavailable.');
            setPayButton('Payment Unavailable', true);
          }

          return;
        }

        if (canRestorePreviousCheckout(error, backendReplacementCompleted)) {
          if (checkoutEnvelope?.currentOperation) {
            checkoutEnvelope = discardCheckoutOperation(checkoutEnvelope);
            checkoutEnvelope = saveCheckoutAttempt(checkoutEnvelope);
          }
          currentCommand = null;
          setPayButton('Place Order', false);
        } else {
          setPayButton('Payment Unavailable', true);
        }

        throw error;
      } finally {
        setCheckoutControlsBusy(false);
      }
    });
  }

  initialiseCheckoutAddress(root);

  shipping = createCheckoutShipping(root, prepareCheckout);
  discountController = createCheckoutDiscount(root, {
    onApply: (code) => replaceDiscount(code),
    onRemove: () => replaceDiscount(''),
  });

  payButton.addEventListener('click', async (event) => {
    event.preventDefault();

    if (state.retryAvailable && !state.preparingPromise && !state.confirming) {
      state.retryAvailable = false;
      const methodName = checkoutEnvelope?.currentOperation?.selectedShippingMethodName || '';
      await prepareCheckout(methodName);
      return;
    }

    if (state.payDisabled || state.preparingPromise || state.confirming) return;

    showError('');

    const addressData = getCheckoutAddressData(root);
    const shippingMethodName = shipping.getSelectedMethodName();
    const validationError = validateCheckout(root, addressData, shippingMethodName);

    if (validationError) {
      showError(validationError);
      return;
    }

    if (!state.actions || !state.checkout || !state.checkoutSessionId || !state.confirmationToken) {
      showError('Payment is not ready yet.');
      return;
    }

    state.confirming = true;
    setCheckoutControlsBusy(true);
    setPayButton('Processing...', true);

    try {
      await assertCurrentCart();

      if (state.protocolMode === CHECKOUT_PROTOCOL_VERSION) {
        const activeCheckout = checkoutEnvelope?.activeCheckout;

        if (
          !activeCheckout ||
          activeCheckout.checkoutSessionId !== state.checkoutSessionId ||
          activeCheckout.confirmationToken !== state.confirmationToken
        ) {
          throw new Error('Checkout confirmation authority is stale.');
        }
      }

      await updateCheckoutDetails({
        checkoutSessionId: state.checkoutSessionId,
        confirmationToken: state.confirmationToken,
        addressData,
      });
      await selectStripeShippingOption(shippingMethodName);

      const confirmation = await state.actions.confirm({
        redirect: 'if_required',
        email: addressData.shipping.email,
        phoneNumber: addressData.shipping.phone || undefined,
        shippingAddress: toStripeContact(addressData.shipping),
        billingAddress: toStripeContact(addressData.billing),
      });

      if (confirmation.type === 'error') {
        throw new Error(confirmation.error.message || 'Payment failed.');
      }

      navigateToConfirmation(confirmation.session.id);
    } catch (error) {
      state.confirming = false;
      setCheckoutControlsBusy(false);

      if (error instanceof CheckoutCartChangedError) {
        try {
          await resetCheckoutForCurrentCart('Your basket changed. Checkout is being reset safely.');
        } catch (resetError) {
          console.error('Checkout cart reset failed:', resetError);
          showError(resetError.message || 'Checkout is temporarily unavailable.');
          setPayButton('Payment Unavailable', true);
        }

        return;
      }

      console.error('Checkout confirmation failed:', error);
      showError(error.message || 'Payment failed.');
      setPayButton('Place Order', false);
    }
  });

  summary.renderItems(cart);
  setPayButton('Loading Checkout...', true);

  if (cart.length === 0) {
    showError('Your basket is empty.');
    setPayButton('Basket Empty', true);
    return null;
  }

  if (!probeCheckoutSessionStorage()) {
    showError('Checkout requires browser session storage. Your basket has been kept.');
    setPayButton('Payment Unavailable', true);
    return null;
  }

  try {
    cartFingerprint = await fingerprintCart(cart);
    checkoutEnvelope = loadCheckoutAttempt();

    if (checkoutEnvelope) {
      const hasSubmittedReservationState = Boolean(
        checkoutEnvelope.activeCheckout || checkoutEnvelope.currentOperation
      );
      state.protocolMode = hasSubmittedReservationState ? CHECKOUT_PROTOCOL_VERSION : 'negotiating';
      state.reservationCommitted = hasSubmittedReservationState;

      if (checkoutEnvelope.attempt.cartFingerprint !== cartFingerprint) {
        if (!(await resetChangedCartAttempt())) return null;
        setCheckoutControlsBusy(false);
      } else if (!checkoutEnvelope.currentOperation && checkoutEnvelope.activeCheckout) {
        checkoutEnvelope = beginCheckoutResume(checkoutEnvelope);
        checkoutEnvelope = saveCheckoutAttempt(checkoutEnvelope);
      }
    } else {
      checkoutEnvelope = createCheckoutAttemptEnvelope(cartFingerprint);
      checkoutEnvelope = saveCheckoutAttempt(checkoutEnvelope);
    }
  } catch (error) {
    console.error('Checkout session recovery failed:', error);
    showError(error.message || 'Checkout session recovery is unavailable.');
    setPayButton('Payment Unavailable', true);
    return null;
  }

  try {
    await loadCurrentCartShippingOptions();

    if (checkoutEnvelope?.currentOperation) {
      const operation = checkoutEnvelope.currentOperation;
      const methodName =
        operation.selectedShippingMethodName ||
        checkoutEnvelope.activeCheckout?.selectedShippingMethodName ||
        '';

      if (!methodName) {
        throw new Error('Checkout recovery is missing its selected shipping method.');
      }

      setCheckoutControlsBusy(true);
      setPayButton('Recovering Checkout...', true);

      try {
        const result = await requestPreparedCheckout(
          methodName,
          '',
          operation.kind === 'replacement'
        );

        if (['paid', 'payment_pending'].includes(result.checkout_state)) {
          navigateToConfirmation(result.checkout_session_id);
        } else {
          await installPreparedCheckout(result, methodName);
          setCheckoutControlsBusy(false);
          setPayButton('Place Order', false);
        }
      } catch (error) {
        if (
          error?.orchestrationError === 'checkout_request_not_found' &&
          operation.phase === 'prepared-locally'
        ) {
          checkoutEnvelope = discardCheckoutOperation(checkoutEnvelope);
          checkoutEnvelope = saveCheckoutAttempt(checkoutEnvelope);
          state.protocolMode = 'negotiating';
          state.reservationCommitted = false;
          setCheckoutControlsBusy(false);
          setPayButton('Select Shipping', true);
        } else if (
          isSafelyResettableAttemptError(error) ||
          error?.orchestrationError === 'checkout_request_not_found'
        ) {
          await resetCheckoutForCurrentCart(
            'Checkout recovery found no payable operation and is being reset safely.'
          );
          setCheckoutControlsBusy(false);
        } else {
          throw error;
        }
      }
    } else {
      setPayButton('Select Shipping', true);
    }
  } catch (error) {
    console.error('Checkout initialization failed:', error);
    showError(error.message || 'Checkout could not be loaded.');
    setPayButton('Payment Unavailable', true);
    return null;
  }

  window.addEventListener('storage', (event) => {
    if (event.key !== 'taa_cart' || state.confirming) return;

    void (async () => {
      try {
        if (await currentCartMatchesAttempt()) return;

        await resetCheckoutForCurrentCart('Your basket changed. Checkout is being reset safely.');
        setCheckoutControlsBusy(false);
      } catch (error) {
        console.error('Checkout cart reset failed:', error);
        showError(error.message || 'Checkout is temporarily unavailable.');
        setPayButton('Payment Unavailable', true);
      }
    })();
  });

  return Object.freeze({
    getCheckoutSession() {
      return state.actions?.getSession() || null;
    },
  });
}
