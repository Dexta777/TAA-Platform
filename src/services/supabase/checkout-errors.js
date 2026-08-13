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
  'rate_limited',
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
const SAFE_RATE_LIMIT_SCOPES = new Set([
  'network_pre_admission',
  'existing_attempt_pre_admission',
  'persisted_operation',
  'shipping_network',
  'abandon_network',
  'abandon_authorized_attempt',
  'update_network',
  'update_authorized_checkout',
  'confirmation_network',
  'confirmation_authorized_checkout',
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
      rateLimitScope = null,
      checkoutRequestAdmitted = null,
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
    this.rateLimitScope = rateLimitScope;
    this.checkoutRequestAdmitted = checkoutRequestAdmitted;
  }
}

function getRetryAfterMs(payload, response) {
  const payloadSeconds = Number(payload?.retry_after_seconds);
  const headerSeconds = Number(response?.headers?.get?.('Retry-After'));
  const seconds = Number.isFinite(payloadSeconds) ? payloadSeconds : headerSeconds;

  return Number.isFinite(seconds) && seconds >= 1 && seconds <= 86400 ? seconds * 1000 : null;
}

export function createCheckoutInvocationError(
  payload,
  fallbackMessage,
  { cause, status = null, response = null } = {}
) {
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
  const retryAfterMs = getRetryAfterMs(payload, response);
  const rateLimitScope = SAFE_RATE_LIMIT_SCOPES.has(payload?.rate_limit_scope)
    ? payload.rate_limit_scope
    : null;
  const checkoutRequestAdmitted =
    typeof payload?.checkout_request_admitted === 'boolean'
      ? payload.checkout_request_admitted
      : null;

  return new CheckoutRequestError(message, {
    cause,
    status,
    discountError,
    minimumSubtotalAmount,
    checkoutReplacementError,
    orchestrationError,
    retryAfterMs,
    rateLimitScope,
    checkoutRequestAdmitted,
    retryable:
      (status === 429 && orchestrationError === 'rate_limited') ||
      orchestrationError === 'operation_in_progress' ||
      orchestrationError === 'stripe_rate_limited' ||
      orchestrationError === 'stripe_result_ambiguous',
  });
}
