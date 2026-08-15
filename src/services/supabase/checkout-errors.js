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
const CHECKOUT_INVENTORY_ERROR = 'inventory_conflict';
const MAXIMUM_UNAVAILABLE_ITEMS = 100;
const SAFE_INVENTORY_REASONS = new Set(['temporarily_reserved', 'out_of_stock']);
const INVENTORY_CONFLICT_MESSAGE = 'One or more items in your basket are currently unavailable.';

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
      checkoutInventoryError = null,
      unavailableItems = [],
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
    this.checkoutInventoryError = checkoutInventoryError;
    this.unavailableItems = Object.freeze(
      unavailableItems.map((item) => Object.freeze({ ...item }))
    );
  }
}

function getUnavailableItems(payload, status) {
  if (
    status !== 409 ||
    payload?.checkout_inventory_error !== CHECKOUT_INVENTORY_ERROR ||
    payload?.checkout_request_admitted !== false ||
    payload?.retryable !== false ||
    !Array.isArray(payload?.unavailable_items) ||
    payload.unavailable_items.length === 0 ||
    payload.unavailable_items.length > MAXIMUM_UNAVAILABLE_ITEMS
  ) {
    return null;
  }

  const seenSkus = new Set();
  const unavailableItems = [];

  for (const value of payload.unavailable_items) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

    const keys = Object.keys(value).sort();
    const sku = value.sku;
    const reason = value.reason;

    if (keys.length !== 2 || keys[0] !== 'reason' || keys[1] !== 'sku') return null;
    if (typeof sku !== 'string' || sku !== sku.trim() || !sku || sku.length > 200) return null;
    if (seenSkus.has(sku) || !SAFE_INVENTORY_REASONS.has(reason)) return null;

    seenSkus.add(sku);
    unavailableItems.push({ sku, reason });
  }

  return unavailableItems;
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
  const unavailableItems = getUnavailableItems(payload, status);
  const hasInventoryMarker = payload?.checkout_inventory_error !== undefined;
  const message = unavailableItems
    ? INVENTORY_CONFLICT_MESSAGE
    : hasInventoryMarker
      ? fallbackMessage
      : typeof payload?.error === 'string' && payload.error.trim()
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
    checkoutInventoryError: unavailableItems ? CHECKOUT_INVENTORY_ERROR : null,
    unavailableItems: unavailableItems || [],
    retryable:
      (status === 429 && orchestrationError === 'rate_limited') ||
      orchestrationError === 'operation_in_progress' ||
      orchestrationError === 'stripe_rate_limited' ||
      orchestrationError === 'stripe_result_ambiguous',
  });
}
