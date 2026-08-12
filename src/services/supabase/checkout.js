import { supabase } from './client.js';

const SAFE_DISCOUNT_ERRORS = new Set([
  'invalid_code',
  'minimum_subtotal_not_met',
  'account_required',
  'not_eligible',
  'discount_unavailable',
]);
const SAFE_REPLACEMENT_ERRORS = new Set([
  'previous_checkout_usable',
  'previous_checkout_unavailable',
]);

export class CheckoutRequestError extends Error {
  constructor(
    message,
    {
      cause,
      status = null,
      discountError = null,
      minimumSubtotalAmount = null,
      checkoutReplacementError = null,
    } = {}
  ) {
    super(message, { cause });
    this.name = 'CheckoutRequestError';
    this.status = status;
    this.discountError = discountError;
    this.minimumSubtotalAmount = minimumSubtotalAmount;
    this.checkoutReplacementError = checkoutReplacementError;
  }
}

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
      const message =
        typeof payload?.error === 'string' && payload.error.trim()
          ? payload.error.trim()
          : fallbackMessage;
      const discountError = SAFE_DISCOUNT_ERRORS.has(payload?.discount_error)
        ? payload.discount_error
        : null;
      const minimumSubtotalAmount =
        Number.isSafeInteger(payload?.minimum_subtotal_amount) &&
        payload.minimum_subtotal_amount >= 0
          ? payload.minimum_subtotal_amount
          : null;
      const checkoutReplacementError = SAFE_REPLACEMENT_ERRORS.has(
        payload?.checkout_replacement_error
      )
        ? payload.checkout_replacement_error
        : null;

      return new CheckoutRequestError(message, {
        cause: error,
        status: response.status,
        discountError,
        minimumSubtotalAmount,
        checkoutReplacementError,
      });
    } catch {
      // The fallback below deliberately avoids exposing an unexpected response body.
    }
  }

  return new CheckoutRequestError(fallbackMessage, { cause: error });
}

async function invokeCheckoutFunction(functionName, body, fallbackMessage) {
  const { data, error } = await supabase.functions.invoke(functionName, { body });

  if (error) {
    throw await getInvocationError(error, fallbackMessage);
  }

  if (!data || typeof data !== 'object') {
    throw new Error(fallbackMessage);
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
