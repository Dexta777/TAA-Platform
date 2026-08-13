import { supabase } from './client.js';
import { CheckoutRequestError, createCheckoutInvocationError } from './checkout-errors.js';

export { CheckoutRequestError } from './checkout-errors.js';

function normalizeCartForCheckout(cart) {
  if (!Array.isArray(cart) || cart.length === 0) {
    throw new Error('Your basket is empty.');
  }

  return cart.map((item) => ({
    sku: String(item?.sku ?? '').trim(),
    quantity: item?.quantity,
  }));
}

async function getInvocationError(error, fallbackMessage) {
  const response = error?.context;

  if (response instanceof Response) {
    try {
      const payload = await response.clone().json();
      return createCheckoutInvocationError(payload, fallbackMessage, {
        cause: error,
        status: response.status,
        response,
      });
    } catch {
      // The fallback below deliberately avoids exposing an unexpected response body.
    }
  }

  return new CheckoutRequestError(fallbackMessage, {
    cause: error,
    retryable: error?.name === 'FunctionsFetchError' || error?.name === 'FunctionsRelayError',
  });
}

async function invokeCheckoutFunction(functionName, body, fallbackMessage) {
  const { data, error, response } = await supabase.functions.invoke(functionName, { body });

  if (error) {
    throw await getInvocationError(error, fallbackMessage);
  }

  if (!data || typeof data !== 'object') {
    throw new Error(fallbackMessage);
  }

  if (data.checkout_orchestration_error === 'operation_in_progress') {
    throw createCheckoutInvocationError(data, fallbackMessage, {
      status: response?.status || 202,
      response,
    });
  }

  return data;
}

export function getShippingOptions(cart) {
  return invokeCheckoutFunction(
    'get-shipping-options',
    { cart: normalizeCartForCheckout(cart) },
    'Shipping options could not be loaded.'
  );
}

export function createCheckoutSession({
  cart,
  shippingMethodName,
  addressData,
  discountCode,
  replaceCheckoutSessionId,
  replaceConfirmationToken,
  checkoutAttemptId,
  checkoutAttemptToken,
  checkoutRequestId,
}) {
  const normalizedDiscountCode = String(discountCode ?? '').trim();
  const normalizedReplacementSessionId = String(replaceCheckoutSessionId ?? '').trim();
  const normalizedReplacementToken = String(replaceConfirmationToken ?? '').trim();
  const body = {
    cart: normalizeCartForCheckout(cart),
    shipping_method_name: String(shippingMethodName ?? '').trim(),
    shipping_name: addressData.shipping.name || undefined,
    shipping_phone: addressData.shipping.phone || undefined,
    shipping_address: addressData.shipping.address,
    billing_name: addressData.billing.name || undefined,
    billing_address: addressData.billing.address,
    billing_is_different: addressData.billingIsDifferent,
    create_account_requested: false,
    checkout_attempt_id: String(checkoutAttemptId ?? '').trim(),
    checkout_attempt_token: String(checkoutAttemptToken ?? '').trim(),
    checkout_request_id: String(checkoutRequestId ?? '').trim(),
    ...(normalizedDiscountCode ? { discount_code: normalizedDiscountCode } : {}),
    ...(normalizedReplacementSessionId
      ? { replace_checkout_session_id: normalizedReplacementSessionId }
      : {}),
    ...(normalizedReplacementSessionId && normalizedReplacementToken
      ? { replace_confirmation_token: normalizedReplacementToken }
      : {}),
  };

  return invokeCheckoutFunction('create-checkout-session', body, 'Payment could not be prepared.');
}

export function resumeCheckoutSession({
  checkoutAttemptId,
  checkoutAttemptToken,
  checkoutRequestId,
}) {
  return invokeCheckoutFunction(
    'create-checkout-session',
    {
      checkout_operation: 'resume',
      checkout_attempt_id: String(checkoutAttemptId ?? '').trim(),
      checkout_attempt_token: String(checkoutAttemptToken ?? '').trim(),
      checkout_request_id: String(checkoutRequestId ?? '').trim(),
    },
    'Payment recovery could not be completed.'
  );
}

export function abandonCheckoutAttempt({ checkoutAttemptId, checkoutAttemptToken }) {
  return invokeCheckoutFunction(
    'abandon-checkout-attempt',
    {
      checkout_attempt_id: String(checkoutAttemptId ?? '').trim(),
      checkout_attempt_token: String(checkoutAttemptToken ?? '').trim(),
    },
    'Checkout could not be reset safely.'
  );
}

export function updateCheckoutDetails({ checkoutSessionId, confirmationToken, addressData }) {
  return invokeCheckoutFunction(
    'update-checkout-details',
    {
      checkout_session_id: String(checkoutSessionId ?? '').trim(),
      confirmation_token: confirmationToken || undefined,
      shipping_phone: addressData.shipping.phone || undefined,
      shipping_address: addressData.shipping.address,
      billing_address: addressData.billing.address,
      billing_is_different: addressData.billingIsDifferent,
    },
    'Checkout details could not be saved.'
  );
}

export function getCheckoutConfirmation(checkoutSessionId, confirmationToken) {
  return invokeCheckoutFunction(
    'get-checkout-confirmation',
    {
      checkout_session_id: String(checkoutSessionId ?? '').trim(),
      confirmation_token: confirmationToken || undefined,
    },
    'Order confirmation could not be loaded.'
  );
}
