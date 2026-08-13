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
const SAFE_ORCHESTRATION_ERRORS = new Set([
  'operation_in_progress',
  'stripe_rate_limited',
  'stripe_result_ambiguous',
  'reconciliation_required',
  'checkout_request_conflict',
  'checkout_request_not_found',
  'request_not_materialized',
  'checkout_attempt_terminal',
  'previous_checkout_usable',
  'previous_checkout_unavailable',
  'superseded',
  'failed',
  'compensated',
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
      orchestrationError = null,
      retryAfterMs = null,
      retryable = false,
    } = {}
  ) {
    super(message, { cause });
    this.name = 'CheckoutRequestError';
    this.status = status;
    this.discountError = discountError;
    this.minimumSubtotalAmount = minimumSubtotalAmount;
    this.checkoutReplacementError = checkoutReplacementError;
    this.orchestrationError = orchestrationError;
    this.retryAfterMs = retryAfterMs;
    this.retryable = retryable;
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

function getRetryAfterMs(payload) {
  const seconds = Number(payload?.retry_after_seconds);

  return Number.isFinite(seconds) && seconds >= 1 && seconds <= 30 ? seconds * 1000 : null;
}

function createInvocationError(payload, fallbackMessage, { cause, status = null } = {}) {
  const message =
    typeof payload?.error === 'string' && payload.error.trim()
      ? payload.error.trim()
      : fallbackMessage;
  const discountError = SAFE_DISCOUNT_ERRORS.has(payload?.discount_error)
    ? payload.discount_error
    : null;
  const minimumSubtotalAmount =
    Number.isSafeInteger(payload?.minimum_subtotal_amount) && payload.minimum_subtotal_amount >= 0
      ? payload.minimum_subtotal_amount
      : null;
  const checkoutReplacementError = SAFE_REPLACEMENT_ERRORS.has(payload?.checkout_replacement_error)
    ? payload.checkout_replacement_error
    : null;
  const orchestrationError = SAFE_ORCHESTRATION_ERRORS.has(payload?.checkout_orchestration_error)
    ? payload.checkout_orchestration_error
    : null;
  const retryAfterMs = getRetryAfterMs(payload);

  return new CheckoutRequestError(message, {
    cause,
    status,
    discountError,
    minimumSubtotalAmount,
    checkoutReplacementError,
    orchestrationError,
    retryAfterMs,
    retryable:
      orchestrationError === 'operation_in_progress' ||
      orchestrationError === 'stripe_rate_limited' ||
      orchestrationError === 'stripe_result_ambiguous',
  });
}

async function getInvocationError(error, fallbackMessage) {
  const response = error?.context;

  if (response instanceof Response) {
    try {
      const payload = await response.clone().json();
      return createInvocationError(payload, fallbackMessage, {
        cause: error,
        status: response.status,
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
    throw createInvocationError(data, fallbackMessage, { status: response?.status || 202 });
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
