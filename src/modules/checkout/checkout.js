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
import { storeCheckoutCapability } from './checkout-capability.js';
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

function getShippingOptionId(shippingOptions, methodName) {
  const normalizedMethodName = normalizeMethodName(methodName);
  const option = shippingOptions.find(
    (candidate) => normalizeMethodName(candidate.name) === normalizedMethodName
  );

  return option?.stripe_shipping_rate_id || '';
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
    checkoutSessionId: null,
    confirmationToken: null,
    payDisabled: true,
    paymentElement: null,
    preparingPromise: null,
    shippingOptions: [],
  };

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

  async function selectStripeShippingOption(methodName) {
    const shippingOptionId = getShippingOptionId(state.shippingOptions, methodName);

    if (!state.actions || !shippingOptionId) {
      throw new Error('The selected shipping method is unavailable.');
    }

    const result = await state.actions.updateShippingOption(shippingOptionId);

    if (result.type === 'error') {
      throw new Error(result.error.message || 'The shipping method could not be selected.');
    }

    summary.renderStripeSession(result.session);
  }

  async function prepareCheckout(methodName) {
    if (state.actions) {
      setPayButton('Updating...', true);

      try {
        await selectStripeShippingOption(methodName);
        showError('');
        setPayButton('Place Order', false);
      } catch (error) {
        console.error('Checkout shipping update failed:', error);
        showError(error.message || 'The shipping method could not be selected.');
        setPayButton('Payment Unavailable', true);
      }

      return;
    }

    if (state.preparingPromise) {
      await state.preparingPromise;

      if (state.actions) {
        await prepareCheckout(methodName);
      }

      return;
    }

    state.preparingPromise = (async () => {
      showError('');
      setPayButton('Preparing payment...', true);

      const addressData = getCheckoutAddressData(root);
      const result = await createCheckoutSession({
        cart,
        shippingMethodName: methodName,
        addressData,
      });

      if (
        !result.client_secret ||
        !result.checkout_session_id ||
        !result.confirmation_token ||
        !Array.isArray(result.shipping_options)
      ) {
        throw new Error('Payment preparation returned an incomplete response.');
      }

      storeCheckoutCapability(
        result.checkout_session_id,
        result.confirmation_token,
        result.checkout_intent_id
      );

      applyLockedCustomerEmail(root, result.locked_customer_email);
      const checkoutAddressData = getCheckoutAddressData(root);

      const checkout = await createCheckoutElementsSdk(
        result.client_secret,
        getStripeDefaultValues(checkoutAddressData)
      );
      const actionsResult = await checkout.loadActions();

      if (actionsResult.type === 'error') {
        throw new Error(actionsResult.error.message || 'Stripe Checkout could not be loaded.');
      }

      paymentElementWrapper.replaceChildren();

      const paymentElement = checkout.createPaymentElement({
        layout: 'tabs',
        fields: {
          billingDetails: {
            name: 'never',
            address: 'never',
          },
        },
      });
      paymentElement.mount(paymentElementWrapper);

      checkout.on('change', (session) => {
        summary.renderStripeSession(session);
      });

      state.actions = actionsResult.actions;
      state.checkout = checkout;
      state.checkoutSessionId = result.checkout_session_id;
      state.confirmationToken = result.confirmation_token;
      state.paymentElement = paymentElement;
      state.shippingOptions = result.shipping_options;

      await selectStripeShippingOption(methodName);
      summary.renderCanonicalItems(result.items);
      summary.renderPreparedCheckout(result);
      setPayButton('Place Order', false);
    })();

    try {
      await state.preparingPromise;
    } catch (error) {
      console.error('Checkout preparation failed:', error);
      showError(error.message || 'Payment could not be prepared.');
      setPayButton('Payment Unavailable', true);
    } finally {
      state.preparingPromise = null;
    }
  }

  initialiseCheckoutAddress(root);

  const shipping = createCheckoutShipping(root, prepareCheckout);

  payButton.addEventListener('click', async (event) => {
    event.preventDefault();

    if (state.payDisabled) return;

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
