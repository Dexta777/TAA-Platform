import { getCart } from '../cart/cart.js';
import { createCheckoutElementsSdk } from '../../services/stripe/checkout.js';
import {
  createCheckoutSession,
  getShippingOptions,
  updateCheckoutDetails,
} from '../../services/supabase/checkout.js';
import {
  getCheckoutAddressData,
  initialiseCheckoutAddress,
  toStripeContact,
} from './checkout-address.js';
import { removeCheckoutCapability, storeCheckoutCapability } from './checkout-capability.js';
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

  const cart = getCart();
  const summary = createCheckoutSummary(root);
  const state = {
    actions: null,
    checkout: null,
    checkoutGeneration: 0,
    checkoutSessionId: null,
    confirmationToken: null,
    discount: null,
    confirming: false,
    payDisabled: true,
    paymentElement: null,
    preparingPromise: null,
    shippingOptions: [],
  };
  let discountController;
  let shipping;

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
    validatePreparedCheckout(result);

    const previousCheckoutSessionId = state.checkoutSessionId;
    const nextGeneration = state.checkoutGeneration + 1;
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

    storeCheckoutCapability(
      result.checkout_session_id,
      result.confirmation_token,
      result.checkout_intent_id
    );
    applyLockedCustomerEmail(root, result.locked_customer_email);

    checkout.on('change', (session) => {
      if (nextGeneration !== state.checkoutGeneration) return;

      const selectedOption = getShippingOption(
        state.shippingOptions,
        shipping.getSelectedMethodName()
      );
      summary.renderStripeSession(session, state.discount, selectedOption);
    });

    state.paymentElement?.destroy();
    paymentElementWrapper.replaceChildren();
    paymentElement.mount(paymentElementWrapper);

    state.actions = actions;
    state.checkout = checkout;
    state.checkoutGeneration = nextGeneration;
    state.checkoutSessionId = result.checkout_session_id;
    state.confirmationToken = result.confirmation_token;
    state.discount = result.discount ? { ...result.discount } : null;
    state.paymentElement = paymentElement;
    state.shippingOptions = result.shipping_options.map((option) => ({ ...option }));

    shipping.renderOptions(state.shippingOptions);
    summary.renderCanonicalItems(result.items);
    summary.renderPreparedCheckout(result, selection.option);
    discountController.setAppliedDiscount(state.discount);

    if (previousCheckoutSessionId && previousCheckoutSessionId !== result.checkout_session_id) {
      removeCheckoutCapability(previousCheckoutSessionId);
    }
  }

  async function requestPreparedCheckout(methodName, discountCode, replaceCurrentCheckout) {
    const addressData = getCheckoutAddressData(root);

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

  async function prepareCheckout(methodName) {
    await runCheckoutMutation(async () => {
      setCheckoutControlsBusy(true);
      setPayButton(state.actions ? 'Updating...' : 'Preparing payment...', true);
      let succeeded = false;

      try {
        if (state.actions) {
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
        if (error?.discountError) {
          discountController.showError(error);
          showError('');
        } else {
          console.error('Checkout preparation failed:', error);
          showError(error.message || 'Payment could not be prepared.');
        }

        setPayButton('Payment Unavailable', true);
      } finally {
        setCheckoutControlsBusy(false);
        if (succeeded) setPayButton('Place Order', false);
      }
    });
  }

  function canRestorePreviousCheckout(error, backendReplacementCompleted) {
    if (!state.actions || backendReplacementCompleted) return false;
    if (error?.discountError) return true;

    return error?.checkoutReplacementError === 'previous_checkout_usable';
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
        if (canRestorePreviousCheckout(error, backendReplacementCompleted)) {
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

      const confirmationUrl = new URL(
        '/order-confirmation-test',
        'https://www.theanimalalchemist.com'
      );
      confirmationUrl.searchParams.set('checkout_session_id', confirmation.session.id);
      window.location.assign(confirmationUrl);
    } catch (error) {
      console.error('Checkout confirmation failed:', error);
      showError(error.message || 'Payment failed.');
      state.confirming = false;
      setCheckoutControlsBusy(false);
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

  try {
    const shippingResult = await getShippingOptions(cart);

    if (!Array.isArray(shippingResult.options) || shippingResult.options.length === 0) {
      throw new Error('No shipping methods are available for this basket.');
    }

    shipping.renderOptions(shippingResult.options);
    summary.renderCanonicalItems(shippingResult.items);
    summary.renderShippingOptionsResult(shippingResult);
    setPayButton('Select Shipping', true);
  } catch (error) {
    console.error('Checkout initialization failed:', error);
    showError(error.message || 'Checkout could not be loaded.');
    setPayButton('Payment Unavailable', true);
    return null;
  }

  return Object.freeze({
    getCheckoutSession() {
      return state.actions?.getSession() || null;
    },
  });
}
