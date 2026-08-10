import { supabase } from './client.js';

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

      if (typeof payload?.error === 'string' && payload.error.trim()) {
        return new Error(payload.error.trim(), { cause: error });
      }
    } catch {
      // The fallback below deliberately avoids exposing an unexpected response body.
    }
  }

  return new Error(fallbackMessage, { cause: error });
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

export function createCheckoutSession({ cart, shippingMethodName, addressData }) {
  return invokeCheckoutFunction(
    'create-checkout-session',
    {
      cart: normalizeCartForCheckout(cart),
      shipping_method_name: String(shippingMethodName ?? '').trim(),
      shipping_name: addressData.shipping.name || undefined,
      shipping_phone: addressData.shipping.phone || undefined,
      shipping_address: addressData.shipping.address,
      billing_name: addressData.billing.name || undefined,
      billing_address: addressData.billing.address,
      billing_is_different: addressData.billingIsDifferent,
      create_account_requested: false,
    },
    'Payment could not be prepared.'
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
