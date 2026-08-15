import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import Stripe from 'npm:stripe@22.4.0';
import { createClient } from 'npm:@supabase/supabase-js@2.112.2';
import {
  CheckoutInputError,
  cleanText,
  getCanonicalShippingOptions,
  resolveCanonicalCart,
} from '../_shared/checkout-catalog.ts';
import {
  createReservationCanaryConfigurationReader,
  decideCheckoutAdmission,
} from '../_shared/checkout-admission.ts';
import {
  CONFIRMATION_CAPABILITY_TTL_MS,
  authorizeCheckoutAccess,
  cleanCheckoutAddress,
  getAuthenticatedUser,
  sha256Hex,
} from '../_shared/checkout-access.ts';
import {
  type DiscountEvaluation,
  CheckoutEconomicsMismatchError,
  getStripeCouponParameters,
  getStripeShippingAmount,
  isMerchandiseDiscount,
  mapPublicDiscountError,
  verifyCreatedDiscountEconomics,
} from '../_shared/checkout-discounts.ts';
import {
  CheckoutReplacementConflictError,
  completeCheckoutReplacement,
  provePreviousCheckoutIntentExpired,
  validateReplacementAccess,
} from '../_shared/checkout-replacement.ts';
import {
  buildCheckoutResponse,
  buildStripeCouponParametersV1,
  buildStripeSessionParametersV1,
  CHECKOUT_PROTOCOL_VERSION,
  CHECKOUT_WORKER_LEASE_RETRY_SECONDS,
  classifyStripeFailure,
  fingerprintCheckoutCommand,
  getStripeFailureAction,
  getStripeIdempotencyKeys,
  getStripeSessionActivationAction,
  getStripeSessionActivationDisposition,
  getStripeSessionResumeMode,
  isCheckoutReservationsEnabled,
  isStripeSessionSafelyExpired,
  isStripeSessionUsable,
  normalizeCheckoutCommand,
  normalizeUuid,
  sha256Deterministic,
  type PersistedCheckoutSnapshot,
} from '../_shared/checkout-protocol.ts';
import {
  callCheckoutRpc,
  loadPersistedCheckoutSnapshot,
} from '../_shared/checkout-orchestration.ts';
import {
  browserErrorResponse,
  type BrowserSecurityContext,
  HttpSecurityError,
  jsonResponse,
  prepareBrowserRequest,
  readBoundedJsonWithSize,
  rejectOversizeContentLength,
  requireExactFields,
  requireJsonContentType,
} from '../_shared/http-security.ts';
import {
  consumeRateLimits,
  getAuthoritativeDimensions,
  getAuthoritativeRateLimitIdentity,
  getNetworkDimensions,
  getNetworkRateLimitIdentity,
  RATE_LIMIT_POLICIES,
  RateLimitError,
  RateLimitServiceError,
  rateLimitResponse,
} from '../_shared/rate-limit.ts';

const STRIPE_API_VERSION = '2026-07-29.dahlia';
const CHECKOUT_RETURN_URL =
  'https://www.theanimalalchemist.com/order-confirmation-test?checkout_session_id={CHECKOUT_SESSION_ID}';

const MAXIMUM_CREATE_BODY_BYTES = 64 * 1024;
const MAXIMUM_RESUME_BODY_BYTES = 4 * 1024;
const ALLOWED_FIELDS = new Set([
  'cart',
  'shipping_method_name',
  'discount_code',
  'replace_checkout_session_id',
  'replace_confirmation_token',
  'shipping_name',
  'shipping_phone',
  'shipping_address',
  'billing_name',
  'billing_address',
  'billing_is_different',
  'create_account_requested',
  'checkout_attempt_id',
  'checkout_attempt_token',
  'checkout_request_id',
  'checkout_operation',
]);

function requireEnvironment(name: string) {
  const value = Deno.env.get(name)?.trim();

  if (!value) throw new Error(`Missing required environment variable: ${name}`);

  return value;
}

const getCurrentReservationCanaryConfiguration = createReservationCanaryConfigurationReader({
  readRawValue: () => Deno.env.get('CHECKOUT_RESERVATIONS_CANARY_SKUS'),
});

const stripe = new Stripe(requireEnvironment('STRIPE_SECRET_KEY'), {
  apiVersion: STRIPE_API_VERSION,
});

const supabase = createClient(
  requireEnvironment('SUPABASE_URL'),
  requireEnvironment('SUPABASE_SERVICE_ROLE_KEY'),
  { auth: { persistSession: false, autoRefreshToken: false } }
);

class DiscountEligibilityError extends Error {
  publicReason: string;
  minimumSubtotalAmount: number | null;

  constructor(publicReason: string, minimumSubtotalAmount: number | null = null) {
    super('Discount code could not be applied.');
    this.name = 'DiscountEligibilityError';
    this.publicReason = publicReason;
    this.minimumSubtotalAmount = minimumSubtotalAmount;
  }
}

class CheckoutReplacementRequestError extends Error {
  status: number;

  constructor(status: number) {
    super(
      status === 403
        ? 'Checkout replacement is not authorized.'
        : 'Checkout can no longer be replaced.'
    );
    this.name = 'CheckoutReplacementRequestError';
    this.status = status;
  }
}

class CheckoutProtocolRequestError extends Error {
  status: number;
  code: string;
  retryAfterSeconds: number | null;

  constructor(
    message: string,
    status: number,
    code: string,
    retryAfterSeconds: number | null = null
  ) {
    super(message);
    this.name = 'CheckoutProtocolRequestError';
    this.status = status;
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function createConfirmationCapability() {
  const tokenBytes = crypto.getRandomValues(new Uint8Array(32));
  const token = btoa(String.fromCharCode(...tokenBytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');

  return { token, tokenBytes: new TextEncoder().encode(token) };
}

async function getStripeCustomer(authenticatedUserId: string | undefined) {
  if (!authenticatedUserId) return { id: null, email: null };

  const { data: customerProfile, error: profileError } = await supabase
    .from('customer_profiles')
    .select('stripe_customer_id')
    .eq('id', authenticatedUserId)
    .maybeSingle();

  if (profileError) throw new Error('Customer profile lookup failed.');

  const customerId = customerProfile?.stripe_customer_id || null;

  if (!customerId) return { id: null, email: null };

  const customer = await stripe.customers.retrieve(customerId);

  if (customer.deleted) throw new Error('Stored Stripe Customer is unavailable.');

  const customerEmail = cleanText(customer.email, 320);

  if (!customerEmail) throw new Error('Stored Stripe Customer email is unavailable.');

  return { id: customer.id, email: customerEmail };
}

function isCanonicalDiscountEvaluation(value: unknown): value is DiscountEvaluation {
  if (!value || typeof value !== 'object') return false;

  const evaluation = value as Record<string, unknown>;
  const amounts = [
    evaluation.discount_amount,
    evaluation.shipping_discount_amount,
    evaluation.final_shipping_amount,
    evaluation.total_amount,
  ];

  return (
    typeof evaluation.eligible === 'boolean' &&
    typeof evaluation.reason_code === 'string' &&
    amounts.every((amount) => Number.isSafeInteger(amount) && Number(amount) >= 0)
  );
}

async function evaluateSubmittedDiscount({
  code,
  subtotalAmount,
  shippingAmount,
  userId,
  trustedEmail,
  phone,
  shippingAddress,
}: {
  code: string;
  subtotalAmount: number;
  shippingAmount: number;
  userId: string | null;
  trustedEmail: string | null;
  phone: string | null;
  shippingAddress: Record<string, string>;
}) {
  const { data, error } = await supabase.rpc('evaluate_discount_code', {
    p_code: code,
    p_subtotal_amount: subtotalAmount,
    p_shipping_amount: shippingAmount,
    p_user_id: userId,
    p_email: trustedEmail,
    p_phone: phone,
    p_shipping_address: shippingAddress,
  });

  if (error) throw new Error('Discount eligibility could not be evaluated.');

  const evaluation = Array.isArray(data) ? data[0] : data;

  if (!isCanonicalDiscountEvaluation(evaluation)) {
    throw new Error('Discount evaluator returned an invalid result.');
  }

  if (!evaluation.eligible) {
    console.warn('DISCOUNT EVALUATION REJECTED:', {
      reason_code: evaluation.reason_code,
      discount_code_id: evaluation.discount_code_id,
    });

    throw new DiscountEligibilityError(
      mapPublicDiscountError(evaluation.reason_code),
      evaluation.reason_code === 'minimum_subtotal_not_met'
        ? evaluation.minimum_subtotal_amount
        : null
    );
  }

  if (!evaluation.discount_code_id || !evaluation.code || !evaluation.discount_type) {
    throw new Error('Eligible discount result is incomplete.');
  }

  if (isMerchandiseDiscount(evaluation.discount_type) && evaluation.discount_amount === 0) {
    console.warn('DISCOUNT EVALUATION REJECTED:', {
      reason_code: 'zero_merchandise_discount',
      discount_code_id: evaluation.discount_code_id,
    });

    throw new DiscountEligibilityError('discount_unavailable');
  }

  return evaluation;
}

function getStripeErrorDetails(error: unknown) {
  if (!error || typeof error !== 'object') return {};

  const stripeError = error as { code?: string; type?: string };

  return {
    error_type: stripeError.type || 'unknown',
    error_code: stripeError.code || 'unknown',
  };
}

async function deleteTemporaryCouponBestEffort(couponId: string | null, context: string) {
  if (!couponId) return;

  try {
    await stripe.coupons.del(couponId);
  } catch (error) {
    const details = getStripeErrorDetails(error);

    if (details.error_code === 'resource_missing') return;

    console.error('TEMPORARY STRIPE COUPON CLEANUP FAILED:', {
      context,
      coupon_id: couponId,
      ...details,
    });
  }
}

async function expireCheckoutSessionBestEffort(sessionId: string, context: string) {
  try {
    await stripe.checkout.sessions.expire(sessionId);
    return true;
  } catch (error) {
    console.error('STRIPE CHECKOUT SESSION EXPIRY FAILED:', {
      context,
      checkout_session_id: sessionId,
      ...getStripeErrorDetails(error),
    });
  }

  try {
    const checkout = await stripe.checkout.sessions.retrieve(sessionId);

    return checkout.status === 'expired' && checkout.payment_status === 'unpaid';
  } catch {
    return false;
  }
}

async function updateCheckoutIntentStatusBestEffort(
  checkoutIntentId: string,
  status: string,
  context: string
) {
  const { error } = await supabase
    .from('checkout_intents')
    .update({ status })
    .eq('id', checkoutIntentId);

  if (error) {
    console.error('CHECKOUT INTENT STATUS UPDATE FAILED:', {
      context,
      checkout_intent_id: checkoutIntentId,
      status,
    });
  }
}

async function compensateNewCheckoutBestEffort({
  checkoutSessionId,
  checkoutIntentId,
  stripeCouponId,
}: {
  checkoutSessionId: string;
  checkoutIntentId: string;
  stripeCouponId: string | null;
}) {
  let checkoutInvalidated = false;

  try {
    await stripe.checkout.sessions.expire(checkoutSessionId);
    checkoutInvalidated = true;
  } catch {
    try {
      const checkout = await stripe.checkout.sessions.retrieve(checkoutSessionId);
      checkoutInvalidated = checkout.status === 'expired' && checkout.payment_status === 'unpaid';
    } catch {
      // The high-severity diagnostic below records that invalidation could not be proven.
    }
  }

  if (!checkoutInvalidated) {
    console.error('HIGH SEVERITY: REPLACEMENT CHECKOUT COMPENSATION UNCONFIRMED:', {
      checkout_session_id: checkoutSessionId,
      checkout_intent_id: checkoutIntentId,
    });
  }

  await updateCheckoutIntentStatusBestEffort(
    checkoutIntentId,
    checkoutInvalidated ? 'expired' : 'failed',
    'replacement_compensation'
  );
  await deleteTemporaryCouponBestEffort(stripeCouponId, 'replacement_compensation');

  return checkoutInvalidated;
}

type CheckoutRequestContext = {
  attempt_status: string;
  hard_expires_at: string;
  active_checkout_intent_id: string | null;
  in_flight_checkout_intent_id: string | null;
  replacement_checkout_intent_id: string | null;
  existing_checkout_intent_id: string | null;
  existing_command_fingerprint: string | null;
  existing_orchestration_state: string | null;
  admission_state: string;
  bound_user_id: string | null;
};

type ResumedCheckoutRequest = {
  resume_state: string;
  attempt_status: string | null;
  checkout_intent_id: string | null;
  checkout_session_id: string | null;
  orchestration_state: string | null;
  worker_lease_acquired: boolean;
  worker_lease_expires_at: string | null;
};

type PreparedCheckoutRequest = {
  checkout_intent_id: string;
  reservation_id: string;
  orchestration_state: string;
  request_replayed: boolean;
  worker_lease_acquired: boolean;
  worker_lease_expires_at: string;
};

function getRequiredAttemptToken(payload: Record<string, unknown>) {
  const token = String(payload.checkout_attempt_token ?? '').trim();

  if (token.length < 32 || token.length > 255) {
    throw new CheckoutInputError('Checkout attempt token is invalid.');
  }

  return token;
}

function requireResumeOnlyPayload(payload: Record<string, unknown>) {
  const allowedFields = new Set([
    'checkout_operation',
    'checkout_attempt_id',
    'checkout_request_id',
    'checkout_attempt_token',
  ]);

  if (Object.keys(payload).some((field) => !allowedFields.has(field))) {
    throw new CheckoutInputError('Checkout resume request contains unsupported fields.');
  }
}

async function markReconciliationRequired(
  checkoutIntentId: string,
  workerLeaseId: string,
  failureCode: string
) {
  await callCheckoutRpc(supabase, 'mark_checkout_reconciliation_required', {
    p_checkout_intent_id: checkoutIntentId,
    p_worker_lease_id: workerLeaseId,
    p_failure_code: failureCode,
  });
}

async function failDefinitiveCheckoutRequest(
  checkoutIntentId: string,
  workerLeaseId: string,
  failureCode: string
) {
  await callCheckoutRpc(supabase, 'fail_checkout_request', {
    p_checkout_intent_id: checkoutIntentId,
    p_worker_lease_id: workerLeaseId,
    p_failure_code: failureCode,
  });
}

async function cancelAdmissionBestEffort(
  checkoutAttemptId: string | null,
  checkoutRequestId: string | null,
  currentUserId: string | null,
  capabilityHash: string | null
) {
  if (!checkoutAttemptId || !checkoutRequestId || !capabilityHash) return;

  try {
    await callCheckoutRpc(supabase, 'cancel_checkout_request_admission_v1', {
      p_checkout_attempt_id: checkoutAttemptId,
      p_checkout_request_id: checkoutRequestId,
      p_current_user_id: currentUserId,
      p_capability_hash: capabilityHash,
    });
  } catch (error) {
    console.error('CHECKOUT ADMISSION CANCELLATION FAILED:', {
      checkout_attempt_id: checkoutAttemptId,
      checkout_request_id: checkoutRequestId,
      error_name: error instanceof Error ? error.name : 'unknown',
    });
  }
}

async function handleStripeMutationFailure(
  error: unknown,
  checkoutIntentId: string,
  workerLeaseId: string,
  operation: string,
  temporaryCouponId: string | null = null
): Promise<never> {
  const failureKind = classifyStripeFailure(error);
  const failureAction = getStripeFailureAction(failureKind);

  if (failureAction === 'retry_same_request') {
    throw new CheckoutProtocolRequestError(
      'Checkout preparation is still processing. Please retry.',
      503,
      failureKind === 'retryable' ? 'stripe_rate_limited' : 'stripe_result_ambiguous',
      CHECKOUT_WORKER_LEASE_RETRY_SECONDS
    );
  }

  if (failureAction === 'reconciliation_required') {
    const failureCode =
      failureKind === 'external_state_indeterminate'
        ? `${operation}_idempotency_conflict`
        : `${operation}_indeterminate`;
    await markReconciliationRequired(checkoutIntentId, workerLeaseId, failureCode);

    throw new CheckoutProtocolRequestError(
      'Checkout requires reconciliation before it can continue.',
      409,
      'reconciliation_required'
    );
  }

  await failDefinitiveCheckoutRequest(checkoutIntentId, workerLeaseId, `${operation}_failed`);

  if (temporaryCouponId) {
    await deleteTemporaryCouponBestEffort(temporaryCouponId, `${operation}_definitive_failure`);
  }

  throw new CheckoutProtocolRequestError(
    'Unable to prepare Checkout.',
    500,
    'checkout_preparation_failed'
  );
}

async function getProtocolCheckoutResponse(
  securityContext: BrowserSecurityContext,
  snapshot: PersistedCheckoutSnapshot,
  workerLeaseId: string,
  session: Stripe.Checkout.Session,
  activationCapability?: {
    token: string;
    generation: number;
  }
) {
  if (getStripeSessionActivationDisposition(session) !== 'payable') {
    throw new CheckoutProtocolRequestError(
      'Checkout Session is no longer payable.',
      409,
      'checkout_unavailable'
    );
  }

  let confirmationToken = activationCapability?.token || '';
  let confirmationGeneration = activationCapability?.generation || 0;

  if (!activationCapability) {
    const capability = createConfirmationCapability();
    const capabilityHash = await sha256Hex(capability.tokenBytes);
    const capabilityExpiresAt = new Date(Date.now() + CONFIRMATION_CAPABILITY_TTL_MS).toISOString();
    const generation = await callCheckoutRpc<number>(
      supabase,
      'rotate_checkout_confirmation_capability',
      {
        p_checkout_intent_id: snapshot.id,
        p_worker_lease_id: workerLeaseId,
        p_confirmation_token_hash: capabilityHash,
        p_confirmation_token_expires_at: capabilityExpiresAt,
      }
    );

    if (!Number.isInteger(generation)) {
      throw new Error('Checkout confirmation generation was not returned.');
    }

    confirmationToken = capability.token;
    confirmationGeneration = Number(generation);
  }

  return jsonResponse(
    securityContext,
    buildCheckoutResponse(
      snapshot,
      session,
      confirmationToken,
      confirmationGeneration,
      snapshot.stripe_customer_id ? snapshot.customer_email : null
    )
  );
}

async function compensateRecordedSession({
  snapshot,
  workerLeaseId,
  idempotencyKey,
  failureCode,
  authoritativeSession = null,
}: {
  snapshot: PersistedCheckoutSnapshot;
  workerLeaseId: string;
  idempotencyKey: string;
  failureCode: string;
  authoritativeSession?: Stripe.Checkout.Session | null;
}) {
  if (!snapshot.stripe_checkout_session_id) {
    throw new Error('Recorded Checkout Session is required for compensation.');
  }

  await callCheckoutRpc(supabase, 'begin_checkout_compensation', {
    p_checkout_intent_id: snapshot.id,
    p_worker_lease_id: workerLeaseId,
    p_failure_code: failureCode,
  });

  let compensatedSession: Stripe.Checkout.Session | null = authoritativeSession;

  if (!compensatedSession || !isStripeSessionSafelyExpired(compensatedSession)) {
    try {
      compensatedSession = await stripe.checkout.sessions.expire(
        snapshot.stripe_checkout_session_id,
        {},
        { idempotencyKey }
      );
    } catch {
      try {
        compensatedSession = await stripe.checkout.sessions.retrieve(
          snapshot.stripe_checkout_session_id
        );
      } catch {
        // The durable reconciliation state below owns the unresolved external result.
      }
    }
  }

  if (!compensatedSession || !isStripeSessionSafelyExpired(compensatedSession)) {
    await markReconciliationRequired(snapshot.id, workerLeaseId, 'compensation_ambiguous');
    return false;
  }

  await callCheckoutRpc(supabase, 'complete_checkout_compensation', {
    p_checkout_intent_id: snapshot.id,
    p_worker_lease_id: workerLeaseId,
  });

  return true;
}

async function requirePayableRecordedSession({
  snapshot,
  workerLeaseId,
  keys,
  session,
  replacementHandoffCompleted = false,
}: {
  snapshot: PersistedCheckoutSnapshot;
  workerLeaseId: string;
  keys: ReturnType<typeof getStripeIdempotencyKeys>;
  session: Stripe.Checkout.Session;
  replacementHandoffCompleted?: boolean;
}) {
  const action = getStripeSessionActivationAction(session, replacementHandoffCompleted);

  if (action === 'activate') return;

  if (action === 'reconciliation_required') {
    await markReconciliationRequired(
      snapshot.id,
      workerLeaseId,
      replacementHandoffCompleted
        ? 'new_session_nonpayable_after_handoff'
        : 'new_session_state_indeterminate'
    );

    throw new CheckoutProtocolRequestError(
      'Checkout requires reconciliation before it can continue.',
      409,
      'reconciliation_required'
    );
  }

  const safelyTerminated = await compensateRecordedSession({
    snapshot,
    workerLeaseId,
    idempotencyKey: keys.expireNew,
    failureCode: 'new_session_expired_before_activation',
    authoritativeSession: session,
  });

  if (!safelyTerminated) {
    throw new CheckoutProtocolRequestError(
      'Checkout requires reconciliation before it can continue.',
      409,
      'reconciliation_required'
    );
  }

  if (snapshot.stripe_coupon_id) {
    await deleteTemporaryCouponBestEffort(snapshot.stripe_coupon_id, 'expired_before_activation');
  }

  throw new CheckoutProtocolRequestError(
    snapshot.replaces_checkout_intent_id
      ? 'Checkout replacement Session is no longer payable.'
      : 'Checkout Session expired before activation.',
    409,
    snapshot.replaces_checkout_intent_id
      ? 'previous_checkout_usable'
      : 'checkout_preparation_failed'
  );
}

async function handleProtocolReplacement(
  snapshot: PersistedCheckoutSnapshot,
  workerLeaseId: string,
  keys: ReturnType<typeof getStripeIdempotencyKeys>
) {
  if (!snapshot.replaces_checkout_intent_id || !snapshot.stripe_checkout_session_id) {
    throw new Error('Persisted checkout replacement snapshot is incomplete.');
  }

  await callCheckoutRpc(supabase, 'begin_checkout_replacement', {
    p_checkout_intent_id: snapshot.id,
    p_worker_lease_id: workerLeaseId,
  });

  const previousSnapshot = await loadPersistedCheckoutSnapshot(
    supabase,
    snapshot.replaces_checkout_intent_id
  );

  if (!previousSnapshot.stripe_checkout_session_id) {
    throw new Error('Previous Checkout Session snapshot is incomplete.');
  }

  let previousSession: Stripe.Checkout.Session | null = null;

  try {
    previousSession = await stripe.checkout.sessions.expire(
      previousSnapshot.stripe_checkout_session_id,
      {},
      { idempotencyKey: keys.expirePrevious }
    );
  } catch {
    try {
      previousSession = await stripe.checkout.sessions.retrieve(
        previousSnapshot.stripe_checkout_session_id
      );
    } catch {
      // Compensation below prevents B from becoming another payable branch.
    }
  }

  if (!previousSession || !isStripeSessionSafelyExpired(previousSession)) {
    const newSessionInvalidated = await compensateRecordedSession({
      snapshot,
      workerLeaseId,
      idempotencyKey: keys.expireNew,
      failureCode: 'previous_checkout_not_expired',
    });

    throw new CheckoutProtocolRequestError(
      'Checkout could not be replaced safely.',
      409,
      newSessionInvalidated && previousSession && isStripeSessionUsable(previousSession)
        ? 'previous_checkout_usable'
        : 'reconciliation_required'
    );
  }

  try {
    await callCheckoutRpc(supabase, 'record_checkout_predecessor_invalidated', {
      p_replacement_intent_id: snapshot.id,
      p_predecessor_intent_id: snapshot.replaces_checkout_intent_id,
      p_worker_lease_id: workerLeaseId,
    });
  } catch (checkpointError) {
    try {
      await callCheckoutRpc(supabase, 'mark_checkout_reconciliation_required', {
        p_checkout_intent_id: snapshot.id,
        p_worker_lease_id: workerLeaseId,
        p_failure_code: 'predecessor_checkpoint_failed',
      });
      await callCheckoutRpc(supabase, 'enqueue_checkout_reconciliation', {
        p_checkout_attempt_id: snapshot.checkout_attempt_id,
        p_checkout_intent_id: snapshot.id,
        p_lifecycle_incident_id: null,
        p_reason: 'predecessor_checkpoint_failed',
        p_manual_review: false,
      });
    } catch (reconciliationError) {
      console.error('CHECKOUT PREDECESSOR CHECKPOINT RECOVERY FAILED:', {
        checkout_attempt_id: snapshot.checkout_attempt_id,
        checkout_intent_id: snapshot.id,
        checkpoint_error: checkpointError instanceof Error ? checkpointError.message : 'unknown',
        reconciliation_error:
          reconciliationError instanceof Error ? reconciliationError.message : 'unknown',
      });
      throw new Error('Checkout predecessor invalidation could not be durably recorded.');
    }

    throw new CheckoutProtocolRequestError(
      'Checkout requires reconciliation before it can continue.',
      409,
      'reconciliation_required'
    );
  }

  return previousSnapshot;
}

async function handleReservationCheckout(
  request: Request,
  payload: Record<string, unknown>,
  securityContext: BrowserSecurityContext
) {
  let admittedAttemptId: string | null = null;
  let admittedRequestId: string | null = null;
  let admittedCapabilityHash: string | null = null;
  let admittedUserId: string | null = null;
  let cancellableAdmission = false;

  try {
    const authenticatedUser = await getAuthenticatedUser(supabase, request);
    const checkoutAttemptId = normalizeUuid(payload.checkout_attempt_id, 'Checkout attempt ID');
    const checkoutRequestId = normalizeUuid(payload.checkout_request_id, 'Checkout request ID');
    const attemptToken = getRequiredAttemptToken(payload);
    const attemptCapabilityHash = await sha256Hex(attemptToken);
    const checkoutOperation = cleanText(payload.checkout_operation, 20).toLowerCase();
    const workerLeaseId = crypto.randomUUID();
    let preparation: PreparedCheckoutRequest | null = null;

    admittedAttemptId = checkoutAttemptId;
    admittedRequestId = checkoutRequestId;
    admittedCapabilityHash = attemptCapabilityHash;
    admittedUserId = authenticatedUser?.id || null;

    if (checkoutOperation === 'resume') {
      requireResumeOnlyPayload(payload);

      const resumed = await callCheckoutRpc<ResumedCheckoutRequest>(
        supabase,
        'resume_checkout_request_v1',
        {
          p_checkout_attempt_id: checkoutAttemptId,
          p_checkout_request_id: checkoutRequestId,
          p_current_user_id: authenticatedUser?.id || null,
          p_capability_hash: attemptCapabilityHash,
          p_worker_lease_id: workerLeaseId,
        }
      );

      if (!resumed) throw new Error('Checkout resume state was not returned.');

      if (resumed.resume_state === 'operation_in_progress') {
        return new Response(
          JSON.stringify({
            error: 'Checkout preparation is still processing.',
            checkout_orchestration_error: 'operation_in_progress',
            retry_after_seconds: CHECKOUT_WORKER_LEASE_RETRY_SECONDS,
          }),
          {
            status: 202,
            headers: {
              ...securityContext.responseHeaders,
              'Content-Type': 'application/json',
              'Retry-After': String(CHECKOUT_WORKER_LEASE_RETRY_SECONDS),
            },
          }
        );
      }

      if (resumed.resume_state === 'paid' || resumed.resume_state === 'payment_pending') {
        return jsonResponse(securityContext, {
          checkout_protocol_version: CHECKOUT_PROTOCOL_VERSION,
          checkout_state: resumed.resume_state,
          checkout_attempt_id: checkoutAttemptId,
          checkout_request_id: checkoutRequestId,
          checkout_intent_id: resumed.checkout_intent_id,
          checkout_session_id: resumed.checkout_session_id,
        });
      }

      if (resumed.resume_state !== 'resumable' || !resumed.checkout_intent_id) {
        const status = resumed.resume_state === 'checkout_request_not_found' ? 404 : 409;
        throw new CheckoutProtocolRequestError(
          'Checkout request cannot be resumed.',
          status,
          resumed.resume_state
        );
      }

      preparation = {
        checkout_intent_id: resumed.checkout_intent_id,
        reservation_id: '',
        orchestration_state: resumed.orchestration_state || '',
        request_replayed: true,
        worker_lease_acquired: resumed.worker_lease_acquired,
        worker_lease_expires_at: resumed.worker_lease_expires_at || '',
      };
    } else {
      if (checkoutOperation) {
        throw new CheckoutInputError('Checkout operation is invalid.');
      }

      const replaceCheckoutSessionId = cleanText(payload.replace_checkout_session_id, 255) || null;
      const context = await callCheckoutRpc<CheckoutRequestContext>(
        supabase,
        'admit_checkout_request_v1',
        {
          p_checkout_attempt_id: checkoutAttemptId,
          p_checkout_request_id: checkoutRequestId,
          p_current_user_id: authenticatedUser?.id || null,
          p_capability_hash: attemptCapabilityHash,
          p_replace_checkout_session_id: replaceCheckoutSessionId,
        }
      );

      if (!context) throw new Error('Checkout request context was not returned.');

      cancellableAdmission =
        context.admission_state === 'admitted' && !context.existing_checkout_intent_id;

      if (context.admission_state === 'request_not_materialized') {
        throw new CheckoutProtocolRequestError(
          'Checkout request was not materialized before its admission expired.',
          409,
          'request_not_materialized'
        );
      }

      const command = normalizeCheckoutCommand(payload, context.replacement_checkout_intent_id);
      const commandFingerprint = await fingerprintCheckoutCommand(command);

      if (
        context.existing_checkout_intent_id &&
        context.existing_command_fingerprint !== commandFingerprint
      ) {
        throw new CheckoutProtocolRequestError(
          'Checkout request conflicts with its original command.',
          409,
          'checkout_request_conflict'
        );
      }

      if (context.existing_orchestration_state === 'superseded') {
        throw new CheckoutProtocolRequestError(
          'Checkout request has been superseded.',
          409,
          'superseded'
        );
      }

      if (
        context.existing_checkout_intent_id &&
        !['active', 'payment_pending'].includes(context.attempt_status)
      ) {
        throw new CheckoutProtocolRequestError(
          'Checkout attempt can no longer return a payable Session.',
          409,
          'checkout_attempt_terminal'
        );
      }

      let canonicalSnapshot: Record<string, unknown> | null = null;
      let canonicalItems: Array<Record<string, unknown>> | null = null;
      let canonicalShippingOptions: Array<Record<string, unknown>> | null = null;

      if (!context.existing_checkout_intent_id) {
        if (!command.shipping_method_name) {
          throw new CheckoutInputError('Please select a shipping method.');
        }

        const validatedItems = await resolveCanonicalCart(supabase, command.cart);
        const subtotalAmount = validatedItems.reduce((total, item) => total + item.line_total, 0);
        const totalWeightGrams = validatedItems.reduce(
          (total, item) => total + item.weight_grams,
          0
        );

        if (totalWeightGrams <= 0) {
          throw new CheckoutInputError('Basket weight could not be calculated.');
        }

        const shippingOptions = await getCanonicalShippingOptions(supabase, totalWeightGrams);
        const selectedShippingOption = shippingOptions.find(
          (option) => option.name.trim().toLowerCase() === command.shipping_method_name
        );

        if (!selectedShippingOption) {
          throw new CheckoutInputError('Selected shipping method is unavailable.');
        }

        const orderedShippingOptions = [
          selectedShippingOption,
          ...shippingOptions.filter((option) => option.id !== selectedShippingOption.id),
        ];
        const stripeCustomer = await getStripeCustomer(context.bound_user_id || undefined);
        const trustedIdentityEmail = context.bound_user_id
          ? cleanText(authenticatedUser?.email, 320) || null
          : null;
        const discountEvaluation = command.discount_code
          ? await evaluateSubmittedDiscount({
              code: command.discount_code,
              subtotalAmount,
              shippingAmount: selectedShippingOption.shipping,
              userId: context.bound_user_id,
              trustedEmail: trustedIdentityEmail,
              phone: command.shipping_phone,
              shippingAddress: command.shipping_address,
            })
          : null;
        const shippingAmount = discountEvaluation
          ? discountEvaluation.final_shipping_amount
          : selectedShippingOption.shipping;
        const totalAmount = discountEvaluation
          ? discountEvaluation.total_amount
          : subtotalAmount + shippingAmount;

        canonicalSnapshot = {
          customer_email: stripeCustomer.email,
          subtotal_amount: subtotalAmount,
          shipping_amount: shippingAmount,
          total_amount: totalAmount,
          currency: 'gbp',
          shipping_method_name: selectedShippingOption.name,
          shipping_method_id: selectedShippingOption.id,
          shipping_rate_id: selectedShippingOption.rate_id,
          total_weight_grams: totalWeightGrams,
          shipping_name: command.shipping_name,
          shipping_phone: command.shipping_phone,
          shipping_address: command.shipping_address,
          billing_name: command.billing_name,
          billing_address: command.billing_address,
          billing_is_different: command.billing_is_different,
          stripe_customer_id: stripeCustomer.id,
          create_account_requested: command.create_account_requested,
          discount_code_id: discountEvaluation?.discount_code_id || null,
          discount_code: discountEvaluation?.code || null,
          discount_amount: discountEvaluation?.discount_amount || 0,
          shipping_discount_amount: discountEvaluation?.shipping_discount_amount || 0,
          discount_name: discountEvaluation?.name || null,
          discount_type: discountEvaluation?.discount_type || null,
          stripe_return_url: CHECKOUT_RETURN_URL,
        };
        canonicalItems = validatedItems;
        canonicalShippingOptions = orderedShippingOptions.map((option) => ({
          shipping_method_id: option.id,
          shipping_rate_id: option.rate_id,
          display_name: option.name,
          description: option.description,
          carrier: option.carrier,
          amount: getStripeShippingAmount(
            option.shipping,
            discountEvaluation?.discount_type || null
          ),
          original_amount: option.shipping,
          currency: option.currency,
        }));
      }

      preparation = await callCheckoutRpc<PreparedCheckoutRequest>(
        supabase,
        'prepare_checkout_request',
        {
          p_checkout_attempt_id: checkoutAttemptId,
          p_checkout_request_id: checkoutRequestId,
          p_user_id: context.bound_user_id,
          p_capability_hash: attemptCapabilityHash,
          p_command_fingerprint: commandFingerprint,
          p_replaces_checkout_intent_id: command.replaces_checkout_intent_id,
          p_worker_lease_id: workerLeaseId,
          p_reservation_expires_at: new Date(Date.now() + 29 * 60 * 1000).toISOString(),
          p_snapshot: canonicalSnapshot,
          p_items: canonicalItems,
          p_shipping_options: canonicalShippingOptions,
        }
      );
    }

    if (!preparation) throw new Error('Prepared checkout request was not returned.');

    if (preparation.orchestration_state === 'reconciliation_required') {
      throw new CheckoutProtocolRequestError(
        'Checkout requires reconciliation before it can continue.',
        409,
        'reconciliation_required'
      );
    }

    if (
      preparation.orchestration_state === 'failed' ||
      preparation.orchestration_state === 'compensated' ||
      preparation.orchestration_state === 'superseded'
    ) {
      throw new CheckoutProtocolRequestError(
        'Checkout request can no longer continue.',
        409,
        preparation.orchestration_state
      );
    }

    if (!preparation.worker_lease_acquired) {
      return new Response(
        JSON.stringify({
          error: 'Checkout preparation is still processing.',
          checkout_orchestration_error: 'operation_in_progress',
          retry_after_seconds: CHECKOUT_WORKER_LEASE_RETRY_SECONDS,
        }),
        {
          status: 202,
          headers: {
            ...securityContext.responseHeaders,
            'Content-Type': 'application/json',
            'Retry-After': String(CHECKOUT_WORKER_LEASE_RETRY_SECONDS),
          },
        }
      );
    }

    let snapshot = await loadPersistedCheckoutSnapshot(supabase, preparation.checkout_intent_id);

    if (snapshot.orchestration_state === 'reconciliation_required') {
      throw new CheckoutProtocolRequestError(
        'Checkout requires reconciliation before it can continue.',
        409,
        'reconciliation_required'
      );
    }

    if (
      snapshot.orchestration_state === 'failed' ||
      snapshot.orchestration_state === 'compensated' ||
      snapshot.orchestration_state === 'superseded'
    ) {
      throw new CheckoutProtocolRequestError(
        'Checkout request can no longer continue.',
        409,
        snapshot.orchestration_state
      );
    }

    if (snapshot.orchestration_state === 'compensating') {
      const compensationKeys = getStripeIdempotencyKeys(
        snapshot.checkout_attempt_id,
        snapshot.checkout_request_id
      );
      const safelyCompensated = await compensateRecordedSession({
        snapshot,
        workerLeaseId,
        idempotencyKey: compensationKeys.expireNew,
        failureCode: 'resumed_compensation',
      });

      throw new CheckoutProtocolRequestError(
        'Checkout could not be replaced safely.',
        409,
        safelyCompensated ? 'previous_checkout_usable' : 'reconciliation_required'
      );
    }

    if (getStripeSessionResumeMode(snapshot) === 'retrieve_active') {
      if (!snapshot.stripe_checkout_session_id) {
        throw new Error('Active checkout is missing its Stripe Session.');
      }

      const activeSession = await stripe.checkout.sessions.retrieve(
        snapshot.stripe_checkout_session_id
      );

      return await getProtocolCheckoutResponse(
        securityContext,
        snapshot,
        workerLeaseId,
        activeSession
      );
    }

    const keys = getStripeIdempotencyKeys(checkoutAttemptId, checkoutRequestId);
    const couponParameters = buildStripeCouponParametersV1(snapshot);

    if (couponParameters && !snapshot.stripe_coupon_id) {
      const couponParamsHash = await sha256Deterministic(couponParameters);
      const couponStart = await callCheckoutRpc<{
        params_match: boolean;
        orchestration_state: string;
      }>(supabase, 'begin_checkout_coupon_creation', {
        p_checkout_intent_id: snapshot.id,
        p_worker_lease_id: workerLeaseId,
        p_params_hash: couponParamsHash,
      });

      if (!couponStart?.params_match) {
        throw new CheckoutProtocolRequestError(
          'Checkout requires reconciliation before it can continue.',
          409,
          'reconciliation_required'
        );
      }

      let coupon: Stripe.Coupon;

      try {
        coupon = await stripe.coupons.create(couponParameters, {
          idempotencyKey: keys.coupon,
        });
      } catch (error) {
        return await handleStripeMutationFailure(
          error,
          snapshot.id,
          workerLeaseId,
          'coupon_creation'
        );
      }

      await callCheckoutRpc(supabase, 'record_checkout_coupon', {
        p_checkout_intent_id: snapshot.id,
        p_worker_lease_id: workerLeaseId,
        p_stripe_coupon_id: coupon.id,
      });
      snapshot = await loadPersistedCheckoutSnapshot(supabase, snapshot.id);
    }

    let session: Stripe.Checkout.Session;

    if (getStripeSessionResumeMode(snapshot) === 'retrieve_recorded') {
      if (!snapshot.stripe_checkout_session_id) {
        throw new Error('Recorded checkout is missing its Stripe Session.');
      }

      session = await stripe.checkout.sessions.retrieve(snapshot.stripe_checkout_session_id);
    } else {
      const sessionParameters = buildStripeSessionParametersV1(snapshot);
      const sessionParamsHash = await sha256Deterministic(sessionParameters);
      const sessionStart = await callCheckoutRpc<{
        params_match: boolean;
        orchestration_state: string;
      }>(supabase, 'begin_checkout_session_creation', {
        p_checkout_intent_id: snapshot.id,
        p_worker_lease_id: workerLeaseId,
        p_params_hash: sessionParamsHash,
      });

      if (!sessionStart?.params_match) {
        throw new CheckoutProtocolRequestError(
          'Checkout requires reconciliation before it can continue.',
          409,
          'reconciliation_required'
        );
      }

      try {
        session = await stripe.checkout.sessions.create(sessionParameters, {
          idempotencyKey: keys.session,
        });
      } catch (error) {
        return await handleStripeMutationFailure(
          error,
          snapshot.id,
          workerLeaseId,
          'session_creation',
          snapshot.stripe_coupon_id
        );
      }

      const stripeShippingRateIds = session.shipping_options.map((option, position) => ({
        position,
        stripe_shipping_rate_id:
          typeof option.shipping_rate === 'string' ? option.shipping_rate : option.shipping_rate.id,
      }));

      await callCheckoutRpc(supabase, 'record_checkout_session', {
        p_checkout_intent_id: snapshot.id,
        p_worker_lease_id: workerLeaseId,
        p_stripe_checkout_session_id: session.id,
        p_stripe_session_expires_at: new Date(session.expires_at * 1000).toISOString(),
        p_shipping_rate_ids: stripeShippingRateIds,
      });
      snapshot = await loadPersistedCheckoutSnapshot(supabase, snapshot.id);
    }

    try {
      verifyCreatedDiscountEconomics(
        {
          amountSubtotal: session.amount_subtotal,
          amountDiscount: session.total_details?.amount_discount ?? null,
          shippingAmount:
            session.shipping_cost?.amount_total ?? session.total_details?.amount_shipping ?? null,
          amountTotal: session.amount_total,
          currency: session.currency,
        },
        {
          subtotalAmount: snapshot.subtotal_amount,
          discountAmount: snapshot.discount_amount,
          shippingAmount: snapshot.shipping_amount,
          totalAmount: snapshot.total_amount,
        }
      );
    } catch (error) {
      console.error('STRIPE CHECKOUT ECONOMICS MISMATCH:', {
        checkout_intent_id: snapshot.id,
        ...(error instanceof CheckoutEconomicsMismatchError ? error.details : {}),
      });
      const safelyCompensated = await compensateRecordedSession({
        snapshot,
        workerLeaseId,
        idempotencyKey: keys.expireNew,
        failureCode: 'stripe_economics_mismatch',
      });

      throw new CheckoutProtocolRequestError(
        'Unable to prepare Checkout.',
        safelyCompensated ? 500 : 409,
        safelyCompensated ? 'checkout_preparation_failed' : 'reconciliation_required'
      );
    }

    let previousSnapshot: PersistedCheckoutSnapshot | null = null;

    if (!snapshot.stripe_checkout_session_id) {
      throw new Error('Recorded checkout is missing its Stripe Session before activation.');
    }

    session = await stripe.checkout.sessions.retrieve(snapshot.stripe_checkout_session_id);
    await requirePayableRecordedSession({ snapshot, workerLeaseId, keys, session });

    if (snapshot.replaces_checkout_intent_id) {
      previousSnapshot = await handleProtocolReplacement(snapshot, workerLeaseId, keys);
      session = await stripe.checkout.sessions.retrieve(snapshot.stripe_checkout_session_id);
      await requirePayableRecordedSession({
        snapshot,
        workerLeaseId,
        keys,
        session,
        replacementHandoffCompleted: true,
      });
    }

    const activationCapability = createConfirmationCapability();
    const activationCapabilityHash = await sha256Hex(activationCapability.tokenBytes);
    const activationCapabilityExpiresAt = new Date(
      Date.now() + CONFIRMATION_CAPABILITY_TTL_MS
    ).toISOString();
    const confirmationGeneration = await callCheckoutRpc<number>(
      supabase,
      'activate_checkout_request',
      {
        p_checkout_intent_id: snapshot.id,
        p_worker_lease_id: workerLeaseId,
        p_confirmation_token_hash: activationCapabilityHash,
        p_confirmation_token_expires_at: activationCapabilityExpiresAt,
      }
    );

    if (!Number.isInteger(confirmationGeneration)) {
      throw new Error('Checkout activation did not return a confirmation generation.');
    }

    if (previousSnapshot?.stripe_coupon_id) {
      await deleteTemporaryCouponBestEffort(
        previousSnapshot.stripe_coupon_id,
        'protocol_checkout_replacement'
      );
    }

    snapshot = await loadPersistedCheckoutSnapshot(supabase, snapshot.id);

    return await getProtocolCheckoutResponse(securityContext, snapshot, workerLeaseId, session, {
      token: activationCapability.token,
      generation: Number(confirmationGeneration),
    });
  } catch (error) {
    if (error instanceof CheckoutInputError) {
      if (cancellableAdmission) {
        await cancelAdmissionBestEffort(
          admittedAttemptId,
          admittedRequestId,
          admittedUserId,
          admittedCapabilityHash
        );
      }
      return jsonResponse(securityContext, { error: error.message }, 400);
    }

    if (error instanceof DiscountEligibilityError) {
      if (cancellableAdmission) {
        await cancelAdmissionBestEffort(
          admittedAttemptId,
          admittedRequestId,
          admittedUserId,
          admittedCapabilityHash
        );
      }
      return jsonResponse(
        securityContext,
        {
          error: error.message,
          discount_error: error.publicReason,
          ...(error.minimumSubtotalAmount !== null
            ? { minimum_subtotal_amount: error.minimumSubtotalAmount }
            : {}),
        },
        400
      );
    }

    if (error instanceof CheckoutProtocolRequestError) {
      return jsonResponse(
        securityContext,
        {
          error: error.message,
          checkout_orchestration_error: error.code,
          ...(error.retryAfterSeconds !== null
            ? { retry_after_seconds: error.retryAfterSeconds }
            : {}),
        },
        error.status,
        error.status === 503 && error.retryAfterSeconds !== null
          ? { 'Retry-After': String(error.retryAfterSeconds) }
          : {}
      );
    }

    if (
      error instanceof Error &&
      (error.message.includes('unresolved admitted request') ||
        error.message.includes('unresolved operation'))
    ) {
      return jsonResponse(
        securityContext,
        {
          error: 'Checkout already has an operation in progress.',
          checkout_orchestration_error: 'operation_in_progress',
          retry_after_seconds: CHECKOUT_WORKER_LEASE_RETRY_SECONDS,
        },
        409
      );
    }

    if (error instanceof Error && error.message.includes('identity conflict')) {
      return jsonResponse(
        securityContext,
        {
          error: 'Checkout attempt authorization is invalid.',
          checkout_orchestration_error: 'checkout_request_conflict',
        },
        403
      );
    }

    console.error('CREATE RESERVATION CHECKOUT ERROR:', {
      error_name: error instanceof Error ? error.name : 'unknown',
    });

    return jsonResponse(securityContext, { error: 'Unable to prepare Checkout.' }, 500);
  }
}

async function shouldUseReservationCheckout(request: Request, payload: Record<string, unknown>) {
  const operation = cleanText(payload.checkout_operation, 20).toLowerCase();
  const reservationsEnabled = isCheckoutReservationsEnabled(
    Deno.env.get('CHECKOUT_RESERVATIONS_ENABLED')
  );

  const decision = await decideCheckoutAdmission({
    operation,
    reservationsEnabled,
    attemptCredentialsSupplied: Boolean(
      payload.checkout_attempt_id || payload.checkout_attempt_token
    ),
    getExistingAttemptProtocol: async () => {
      const checkoutAttemptId = normalizeUuid(payload.checkout_attempt_id, 'Checkout attempt ID');
      const attemptToken = getRequiredAttemptToken(payload);
      const authenticatedUser = await getAuthenticatedUser(supabase, request);

      return await callCheckoutRpc<{
        attempt_exists: boolean;
        checkout_protocol_version: string | null;
      }>(supabase, 'get_checkout_attempt_protocol', {
        p_checkout_attempt_id: checkoutAttemptId,
        p_current_user_id: authenticatedUser?.id || null,
        p_capability_hash: await sha256Hex(attemptToken),
      });
    },
    getCanaryConfiguration: getCurrentReservationCanaryConfiguration,
    cart: payload.cart,
    resolveCanonicalCart: (cart) => resolveCanonicalCart(supabase, cart),
  });

  if (decision.route === 'invalid' && operation) {
    throw new CheckoutInputError('Checkout operation is invalid.');
  }

  if (decision.route === 'invalid') {
    throw new CheckoutProtocolRequestError(
      'Checkout attempt protocol is unavailable.',
      409,
      'checkout_request_conflict'
    );
  }

  return {
    useReservationCheckout: decision.route === 'reservation_v1',
    attemptExists: decision.attemptExists,
  };
}

serve(async (request) => {
  let securityContext: BrowserSecurityContext | null = null;
  let replacementRequested = false;
  let replacementHandoffStarted = false;
  let replacementCheckoutCreated = false;
  let replacementCheckoutInvalidated = false;

  try {
    const ingress = prepareBrowserRequest(request);
    securityContext = ingress.context;
    if (ingress.response) return ingress.response;

    requireJsonContentType(request);
    rejectOversizeContentLength(request, MAXIMUM_CREATE_BODY_BYTES);
    const networkIdentity = await getNetworkRateLimitIdentity(request);
    await consumeRateLimits(
      supabase,
      getNetworkDimensions(networkIdentity, [
        RATE_LIMIT_POLICIES.checkoutMinute,
        RATE_LIMIT_POLICIES.checkoutHour,
      ]),
      { scope: 'network_pre_admission', checkoutRequestAdmitted: false }
    );

    const { payload, byteLength } = await readBoundedJsonWithSize(
      request,
      MAXIMUM_CREATE_BODY_BYTES
    );
    requireExactFields(payload, ALLOWED_FIELDS);

    const checkoutOperation = cleanText(payload.checkout_operation, 20).toLowerCase();

    if (checkoutOperation === 'resume' && byteLength > MAXIMUM_RESUME_BODY_BYTES) {
      throw new HttpSecurityError('Request body is too large.', 413);
    }

    const route = await shouldUseReservationCheckout(request, payload);

    if (route.useReservationCheckout) {
      if (route.attemptExists) {
        const checkoutAttemptId = normalizeUuid(payload.checkout_attempt_id, 'Checkout attempt ID');
        const checkoutRequestId = normalizeUuid(payload.checkout_request_id, 'Checkout request ID');
        const [
          { data: persistedIntent, error: persistedIntentError },
          { data: attempt, error: attemptError },
        ] = await Promise.all([
          supabase
            .from('checkout_intents')
            .select('id')
            .eq('checkout_attempt_id', checkoutAttemptId)
            .eq('checkout_request_id', checkoutRequestId)
            .maybeSingle(),
          supabase
            .from('checkout_attempts')
            .select('admitted_checkout_request_id')
            .eq('id', checkoutAttemptId)
            .maybeSingle(),
        ]);

        if (persistedIntentError || attemptError) throw new RateLimitServiceError();

        const requestAdmitted = Boolean(
          persistedIntent || attempt?.admitted_checkout_request_id === checkoutRequestId
        );
        const attemptIdentity = await getAuthoritativeRateLimitIdentity(
          'checkout-attempt',
          checkoutAttemptId
        );
        const requestIdentity = await getAuthoritativeRateLimitIdentity(
          'checkout-request',
          `${checkoutAttemptId}:${checkoutRequestId}`
        );

        await consumeRateLimits(
          supabase,
          [
            ...getAuthoritativeDimensions(attemptIdentity, [RATE_LIMIT_POLICIES.checkoutAttempt]),
            ...getAuthoritativeDimensions(requestIdentity, [RATE_LIMIT_POLICIES.checkoutRequest]),
          ],
          {
            scope: requestAdmitted ? 'persisted_operation' : 'existing_attempt_pre_admission',
            checkoutRequestAdmitted: requestAdmitted,
          }
        );
      }

      return await handleReservationCheckout(request, payload, securityContext);
    }

    const cart = Array.isArray(payload.cart) ? payload.cart : [];
    const shippingMethodName = cleanText(payload.shipping_method_name, 200);
    const discountCode = cleanText(payload.discount_code, 200);
    const replaceCheckoutSessionId = cleanText(payload.replace_checkout_session_id, 255);
    const replaceConfirmationToken = cleanText(payload.replace_confirmation_token, 255);

    if (replaceConfirmationToken && !replaceCheckoutSessionId) {
      throw new CheckoutInputError('Checkout replacement details are incomplete.');
    }

    replacementRequested = Boolean(replaceCheckoutSessionId);
    const authenticatedUser = await getAuthenticatedUser(supabase, request);
    let previousCheckoutIntent = null;

    if (replaceCheckoutSessionId) {
      const authorization = await authorizeCheckoutAccess(
        supabase,
        request,
        replaceCheckoutSessionId,
        replaceConfirmationToken
      );
      const access = validateReplacementAccess({
        authorized: authorization.authorized,
        previousStatus: authorization.checkoutIntent?.status || null,
        previousUserId: authorization.checkoutIntent?.user_id || null,
        authenticatedUserId: authenticatedUser?.id || null,
      });

      if (!access.allowed || !authorization.checkoutIntent) {
        throw new CheckoutReplacementRequestError(access.status);
      }

      previousCheckoutIntent = authorization.checkoutIntent;
    }

    if (!shippingMethodName) {
      throw new CheckoutInputError('Please select a shipping method.');
    }

    const validatedItems = await resolveCanonicalCart(supabase, cart);
    const subtotalAmount = validatedItems.reduce((total, item) => total + item.line_total, 0);
    const totalWeightGrams = validatedItems.reduce((total, item) => total + item.weight_grams, 0);

    if (totalWeightGrams <= 0) {
      throw new CheckoutInputError('Basket weight could not be calculated.');
    }

    const shippingOptions = await getCanonicalShippingOptions(supabase, totalWeightGrams);
    const selectedShippingOption = shippingOptions.find(
      (option) => option.name.trim().toLowerCase() === shippingMethodName.toLowerCase()
    );

    if (!selectedShippingOption) {
      throw new CheckoutInputError('Selected shipping method is unavailable.');
    }

    const orderedShippingOptions = [
      selectedShippingOption,
      ...shippingOptions.filter((option) => option.id !== selectedShippingOption.id),
    ];
    const checkoutIntentId = crypto.randomUUID();
    const stripeCustomer = await getStripeCustomer(authenticatedUser?.id);
    const customerEmail = stripeCustomer.email || null;
    const trustedIdentityEmail = cleanText(authenticatedUser?.email, 320) || null;
    const shippingAddress = cleanCheckoutAddress(payload.shipping_address, {
      requireComplete: false,
    });
    const billingAddress = cleanCheckoutAddress(
      payload.billing_address || payload.shipping_address,
      { label: 'billing', requireComplete: false }
    );
    const shippingName = cleanText(payload.shipping_name, 200) || null;
    const billingName = cleanText(payload.billing_name, 200) || shippingName;
    const shippingPhone = cleanText(payload.shipping_phone, 50) || null;
    const billingIsDifferent = Boolean(payload.billing_is_different);
    const discountEvaluation = discountCode
      ? await evaluateSubmittedDiscount({
          code: discountCode,
          subtotalAmount,
          shippingAmount: selectedShippingOption.shipping,
          userId: authenticatedUser?.id || null,
          trustedEmail: trustedIdentityEmail,
          phone: shippingPhone,
          shippingAddress,
        })
      : null;
    const { token: confirmationToken, tokenBytes } = createConfirmationCapability();
    const confirmationTokenHash = await sha256Hex(tokenBytes);
    const confirmationTokenExpiresAt = new Date(
      Date.now() + CONFIRMATION_CAPABILITY_TTL_MS
    ).toISOString();

    let stripeCouponId: string | null = null;
    let session: Stripe.Checkout.Session | null = null;

    try {
      if (discountEvaluation && isMerchandiseDiscount(discountEvaluation.discount_type)) {
        const coupon = await stripe.coupons.create(
          getStripeCouponParameters(discountEvaluation, checkoutIntentId)
        );

        stripeCouponId = coupon.id;
      }

      session = await stripe.checkout.sessions.create({
        ui_mode: 'elements',
        mode: 'payment',
        phone_number_collection: {
          enabled: true,
        },
        return_url: CHECKOUT_RETURN_URL,
        line_items: validatedItems.map((item) => ({
          quantity: item.quantity,
          price_data: {
            currency: 'gbp',
            unit_amount: item.unit_amount,
            product_data: {
              name: item.name,
              ...(item.image_url && /^https:\/\//i.test(item.image_url)
                ? { images: [item.image_url] }
                : {}),
              metadata: {
                sku: item.sku,
                product_type: item.product_type,
                product_id: item.product_id,
                base_product_id: item.base_product_id,
              },
            },
          },
        })),
        shipping_options: orderedShippingOptions.map((option) => ({
          shipping_rate_data: {
            type: 'fixed_amount',
            display_name: option.name,
            fixed_amount: {
              amount: getStripeShippingAmount(
                option.shipping,
                discountEvaluation?.discount_type || null
              ),
              currency: 'gbp',
            },
            metadata: {
              original_shipping_amount: String(option.shipping),
              shipping_method_id: option.id,
              shipping_rate_id: option.rate_id,
              shipping_method_name: option.name,
            },
          },
        })),
        ...(stripeCouponId ? { discounts: [{ coupon: stripeCouponId }] } : {}),
        ...(stripeCustomer.id
          ? { customer: stripeCustomer.id }
          : { customer_creation: 'always' as const }),
        client_reference_id: checkoutIntentId,
        metadata: {
          source: 'the_animal_alchemist_webflow',
          checkout_intent_id: checkoutIntentId,
        },
        payment_intent_data: {
          metadata: {
            source: 'the_animal_alchemist_webflow',
            checkout_intent_id: checkoutIntentId,
          },
        },
      });
      replacementCheckoutCreated = replacementRequested;

      if (!session.client_secret) {
        throw new Error('Stripe did not return a Checkout client secret.');
      }

      if (discountEvaluation) {
        verifyCreatedDiscountEconomics(
          {
            amountSubtotal: session.amount_subtotal,
            amountDiscount: session.total_details?.amount_discount ?? null,
            shippingAmount:
              session.shipping_cost?.amount_total ?? session.total_details?.amount_shipping ?? null,
            amountTotal: session.amount_total,
            currency: session.currency,
          },
          {
            subtotalAmount,
            discountAmount: discountEvaluation.discount_amount,
            shippingAmount: discountEvaluation.final_shipping_amount,
            totalAmount: discountEvaluation.total_amount,
          }
        );
      }
    } catch (error) {
      if (error instanceof CheckoutEconomicsMismatchError) {
        console.error('STRIPE CHECKOUT ECONOMICS MISMATCH:', {
          checkout_intent_id: checkoutIntentId,
          ...error.details,
        });
      }

      if (session) {
        replacementCheckoutInvalidated = await expireCheckoutSessionBestEffort(
          session.id,
          'session_creation_compensation'
        );
      }

      await deleteTemporaryCouponBestEffort(stripeCouponId, 'session_creation_compensation');
      throw error;
    }

    if (!session) throw new Error('Stripe Checkout Session was not created.');

    const shippingAmount = discountEvaluation
      ? discountEvaluation.final_shipping_amount
      : selectedShippingOption.shipping;
    const totalAmount = discountEvaluation
      ? discountEvaluation.total_amount
      : subtotalAmount + shippingAmount;
    const { error: checkoutIntentError } = await supabase.from('checkout_intents').insert({
      id: checkoutIntentId,
      stripe_checkout_session_id: session.id,
      payment_intent_id: null,
      user_id: authenticatedUser?.id || null,
      stripe_customer_id: stripeCustomer.id,
      confirmation_token_hash: confirmationTokenHash,
      confirmation_token_expires_at: confirmationTokenExpiresAt,
      create_account_requested: Boolean(payload.create_account_requested),
      status: 'pending',
      customer_email: customerEmail,
      shipping_name: shippingName,
      shipping_phone: shippingPhone,
      shipping_address: shippingAddress,
      billing_name: billingName,
      billing_address: billingAddress,
      billing_is_different: billingIsDifferent,
      subtotal_amount: subtotalAmount,
      shipping_amount: shippingAmount,
      total_amount: totalAmount,
      currency: 'gbp',
      shipping_method_name: selectedShippingOption.name,
      shipping_method_id: selectedShippingOption.id,
      shipping_rate_id: selectedShippingOption.rate_id,
      total_weight_grams: totalWeightGrams,
      discount_code_id: discountEvaluation?.discount_code_id || null,
      discount_code: discountEvaluation?.code || null,
      discount_amount: discountEvaluation?.discount_amount || 0,
      shipping_discount_amount: discountEvaluation?.shipping_discount_amount || 0,
      stripe_coupon_id: stripeCouponId,
    });

    if (checkoutIntentError) {
      replacementCheckoutInvalidated = await expireCheckoutSessionBestEffort(
        session.id,
        'checkout_intent_insert_failure'
      );
      await deleteTemporaryCouponBestEffort(stripeCouponId, 'checkout_intent_insert_failure');
      throw new Error('Checkout intent could not be created.');
    }

    const { error: checkoutItemsError } = await supabase
      .from('checkout_intent_items')
      .insert(validatedItems.map((item) => ({ ...item, checkout_intent_id: checkoutIntentId })));

    if (checkoutItemsError) {
      await supabase
        .from('checkout_intents')
        .update({ status: 'failed' })
        .eq('id', checkoutIntentId);
      replacementCheckoutInvalidated = await expireCheckoutSessionBestEffort(
        session.id,
        'checkout_items_insert_failure'
      );
      await deleteTemporaryCouponBestEffort(stripeCouponId, 'checkout_items_insert_failure');
      throw new Error('Checkout items could not be created.');
    }

    if (previousCheckoutIntent && replaceCheckoutSessionId) {
      replacementHandoffStarted = true;

      await completeCheckoutReplacement({
        expirePreviousCheckout: async () => {
          const previousSession = await stripe.checkout.sessions.expire(replaceCheckoutSessionId);

          return {
            status: previousSession.status,
            payment_status: previousSession.payment_status,
          };
        },
        retrievePreviousCheckout: async () => {
          const previousSession = await stripe.checkout.sessions.retrieve(replaceCheckoutSessionId);

          return {
            status: previousSession.status,
            payment_status: previousSession.payment_status,
          };
        },
        compensateNewCheckout: async () => {
          return compensateNewCheckoutBestEffort({
            checkoutSessionId: session.id,
            checkoutIntentId,
            stripeCouponId,
          });
        },
        markPreviousCheckoutExpired: async () => {
          await provePreviousCheckoutIntentExpired({
            transitionPreviousCheckoutToExpired: async () => {
              const { data, error } = await supabase
                .from('checkout_intents')
                .update({
                  status: 'expired',
                  confirmation_token_hash: null,
                  confirmation_token_expires_at: null,
                })
                .eq('id', previousCheckoutIntent.id)
                .eq('status', 'pending')
                .select('status')
                .maybeSingle();

              if (error) throw new Error('Previous checkout intent status update failed.');

              return data?.status || null;
            },
            retrievePreviousCheckoutIntentStatus: async () => {
              const { data, error } = await supabase
                .from('checkout_intents')
                .select('status')
                .eq('id', previousCheckoutIntent.id)
                .maybeSingle();

              if (error) throw new Error('Previous checkout intent status lookup failed.');

              return data?.status || null;
            },
          });
        },
        cleanupPreviousCoupon: async () => {
          await deleteTemporaryCouponBestEffort(
            previousCheckoutIntent.stripe_coupon_id || null,
            'checkout_replacement'
          );
        },
        reportFailure: (context) => {
          console.error('CHECKOUT REPLACEMENT FOLLOW-UP FAILURE:', {
            context,
            previous_checkout_intent_id: previousCheckoutIntent.id,
          });
        },
      });
    }

    const stripeShippingOptions = session.shipping_options.map((option, index) => ({
      ...orderedShippingOptions[index],
      shipping: getStripeShippingAmount(
        orderedShippingOptions[index].shipping,
        discountEvaluation?.discount_type || null
      ),
      ...(discountEvaluation?.discount_type === 'free_shipping'
        ? { original_shipping: orderedShippingOptions[index].shipping }
        : {}),
      stripe_shipping_rate_id:
        typeof option.shipping_rate === 'string' ? option.shipping_rate : option.shipping_rate.id,
    }));

    return jsonResponse(securityContext, {
      client_secret: session.client_secret,
      checkout_session_id: session.id,
      checkout_intent_id: checkoutIntentId,
      confirmation_token: confirmationToken,
      locked_customer_email: stripeCustomer.id ? customerEmail : null,
      subtotal: subtotalAmount,
      shipping: shippingAmount,
      total: totalAmount,
      currency: 'gbp',
      total_weight_grams: totalWeightGrams,
      shipping_options: stripeShippingOptions,
      items: validatedItems,
      ...(discountEvaluation
        ? {
            discount: {
              code: discountEvaluation.code,
              name: discountEvaluation.name,
              type: discountEvaluation.discount_type,
              discount_amount: discountEvaluation.discount_amount,
              shipping_discount_amount: discountEvaluation.shipping_discount_amount,
            },
          }
        : {}),
    });
  } catch (error) {
    if (error instanceof RateLimitError && securityContext) {
      return rateLimitResponse(securityContext, error);
    }
    if (error instanceof HttpSecurityError) return browserErrorResponse(error, securityContext);
    if (error instanceof RateLimitServiceError && securityContext) {
      return jsonResponse(securityContext, { error: error.message }, 503);
    }

    if (error instanceof CheckoutInputError) {
      return securityContext
        ? jsonResponse(securityContext, { error: error.message }, 400)
        : browserErrorResponse(error);
    }

    if (error instanceof DiscountEligibilityError) {
      return jsonResponse(
        securityContext!,
        {
          error: error.message,
          discount_error: error.publicReason,
          ...(error.minimumSubtotalAmount !== null
            ? { minimum_subtotal_amount: error.minimumSubtotalAmount }
            : {}),
        },
        400
      );
    }

    if (error instanceof CheckoutReplacementRequestError) {
      return jsonResponse(securityContext!, { error: error.message }, error.status);
    }

    if (error instanceof CheckoutReplacementConflictError) {
      console.error('CHECKOUT REPLACEMENT CONFLICT:', {
        checkout_replacement_error: error.publicCode,
      });

      return jsonResponse(
        securityContext!,
        {
          error: 'Checkout could not be replaced safely.',
          checkout_replacement_error: error.publicCode,
        },
        409
      );
    }

    if (error instanceof CheckoutProtocolRequestError) {
      return jsonResponse(
        securityContext!,
        { error: error.message, checkout_orchestration_error: error.code },
        error.status
      );
    }

    console.error('CREATE CHECKOUT SESSION ERROR:', {
      error_name: error instanceof Error ? error.name : 'unknown',
    });

    return jsonResponse(
      securityContext!,
      {
        error: 'Unable to prepare Checkout.',
        ...(replacementRequested && !replacementHandoffStarted
          ? {
              checkout_replacement_error:
                !replacementCheckoutCreated || replacementCheckoutInvalidated
                  ? 'previous_checkout_usable'
                  : 'previous_checkout_unavailable',
            }
          : {}),
      },
      500
    );
  }
});
