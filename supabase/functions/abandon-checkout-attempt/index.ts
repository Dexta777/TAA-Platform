import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import Stripe from 'npm:stripe@22.4.0';
import { createClient } from 'npm:@supabase/supabase-js@2.112.2';
import { getAuthenticatedUser, sha256Hex } from '../_shared/checkout-access.ts';
import {
  checkoutSessionMatchesAttempt,
  getCheckoutAbandonmentAction,
} from '../_shared/checkout-abandonment.ts';
import {
  callCheckoutRpc,
  getCheckoutDatabaseErrorDiagnostic,
} from '../_shared/checkout-orchestration.ts';
import { normalizeUuid } from '../_shared/checkout-protocol.ts';
import {
  browserErrorResponse,
  type BrowserSecurityContext,
  HttpSecurityError,
  jsonResponse,
  prepareBrowserRequest,
  readBoundedJson,
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
const MAXIMUM_BODY_BYTES = 4 * 1024;
const ALLOWED_FIELDS = new Set(['checkout_attempt_id', 'checkout_attempt_token']);

function requireEnvironment(name: string) {
  const value = Deno.env.get(name)?.trim();

  if (!value) throw new Error(`Missing required environment variable: ${name}`);

  return value;
}

const stripe = new Stripe(requireEnvironment('STRIPE_SECRET_KEY'), {
  apiVersion: STRIPE_API_VERSION,
});
const supabase = createClient(
  requireEnvironment('SUPABASE_URL'),
  requireEnvironment('SUPABASE_SERVICE_ROLE_KEY'),
  { auth: { persistSession: false, autoRefreshToken: false } }
);

function getRequiredAttemptToken(payload: Record<string, unknown>) {
  const token = String(payload.checkout_attempt_token ?? '').trim();

  if (token.length < 32 || token.length > 255) {
    throw new Error('Checkout attempt token is invalid.');
  }

  return token;
}

type AbandonmentContext = {
  context_state: string;
  attempt_status: string | null;
  active_checkout_intent_id: string | null;
  active_checkout_request_id: string | null;
  active_checkout_session_id: string | null;
  in_flight_checkout_intent_id: string | null;
  in_flight_checkout_request_id: string | null;
  in_flight_checkout_session_id: string | null;
  admission_active: boolean;
  reservation_status: string | null;
};

async function enqueueReconciliation(
  context: AbandonmentContext,
  checkoutAttemptId: string,
  manualReview = false
) {
  await callCheckoutRpc(supabase, 'enqueue_checkout_reconciliation', {
    p_checkout_attempt_id: checkoutAttemptId,
    p_checkout_intent_id: context.in_flight_checkout_intent_id || context.active_checkout_intent_id,
    p_lifecycle_incident_id: null,
    p_reason: 'browser_abandonment_requested',
    p_manual_review: manualReview,
  });
}

serve(async (request) => {
  let securityContext: BrowserSecurityContext | null = null;

  try {
    const ingress = prepareBrowserRequest(request);
    securityContext = ingress.context;
    if (ingress.response) return ingress.response;

    requireJsonContentType(request);
    rejectOversizeContentLength(request, MAXIMUM_BODY_BYTES);
    const networkIdentity = await getNetworkRateLimitIdentity(request);
    await consumeRateLimits(
      supabase,
      getNetworkDimensions(networkIdentity, [
        RATE_LIMIT_POLICIES.abandonMinute,
        RATE_LIMIT_POLICIES.abandonHour,
      ]),
      { scope: 'abandon_network' }
    );
    const payload = await readBoundedJson(request, MAXIMUM_BODY_BYTES);
    requireExactFields(payload, ALLOWED_FIELDS);

    const checkoutAttemptId = normalizeUuid(payload.checkout_attempt_id, 'Checkout attempt ID');
    const attemptToken = getRequiredAttemptToken(payload);
    const authenticatedUser = await getAuthenticatedUser(supabase, request);
    const capabilityHash = await sha256Hex(attemptToken);
    const context = await callCheckoutRpc<AbandonmentContext>(
      supabase,
      'get_checkout_attempt_abandonment_context_v1',
      {
        p_checkout_attempt_id: checkoutAttemptId,
        p_current_user_id: authenticatedUser?.id || null,
        p_capability_hash: capabilityHash,
      }
    );

    if (!context || context.context_state === 'attempt_not_found') {
      return jsonResponse(securityContext, { result: 'attempt_not_found' });
    }

    const attemptIdentity = await getAuthoritativeRateLimitIdentity(
      'abandon-attempt',
      checkoutAttemptId
    );
    await consumeRateLimits(
      supabase,
      getAuthoritativeDimensions(attemptIdentity, [RATE_LIMIT_POLICIES.abandonAttempt]),
      { scope: 'abandon_authorized_attempt' }
    );

    if (context.context_state === 'already_paid') {
      return jsonResponse(securityContext, { result: 'already_paid' });
    }

    if (context.context_state === 'already_terminal') {
      return jsonResponse(securityContext, { result: 'already_terminal' });
    }

    if (context.context_state === 'safe_unmaterialized') {
      const terminalized = await callCheckoutRpc<boolean>(
        supabase,
        'terminalize_unmaterialized_checkout_attempt_v1',
        {
          p_checkout_attempt_id: checkoutAttemptId,
          p_current_user_id: authenticatedUser?.id || null,
          p_capability_hash: capabilityHash,
        }
      );

      return jsonResponse(securityContext, {
        result: terminalized ? 'abandoned' : 'reconciliation_pending',
      });
    }

    if (context.context_state !== 'active_session') {
      if (['reconciliation_pending', 'integrity_review'].includes(context.context_state)) {
        await enqueueReconciliation(
          context,
          checkoutAttemptId,
          context.context_state === 'integrity_review'
        );
      }

      return jsonResponse(securityContext, { result: 'reconciliation_pending' });
    }

    if (!context.active_checkout_intent_id || !context.active_checkout_session_id) {
      await enqueueReconciliation(context, checkoutAttemptId);
      return jsonResponse(securityContext, { result: 'reconciliation_pending' });
    }

    if (!context.active_checkout_request_id) {
      await enqueueReconciliation(context, checkoutAttemptId);
      return jsonResponse(securityContext, { result: 'reconciliation_pending' });
    }

    let session: Stripe.Checkout.Session;

    try {
      session = await stripe.checkout.sessions.retrieve(context.active_checkout_session_id);
    } catch {
      await enqueueReconciliation(context, checkoutAttemptId);
      return jsonResponse(securityContext, { result: 'reconciliation_pending' });
    }

    if (
      !checkoutSessionMatchesAttempt(
        session,
        checkoutAttemptId,
        context.active_checkout_intent_id,
        context.active_checkout_request_id
      )
    ) {
      await enqueueReconciliation(context, checkoutAttemptId);
      return jsonResponse(securityContext, { result: 'reconciliation_pending' });
    }

    let action = getCheckoutAbandonmentAction(session);

    if (action === 'already_paid') {
      await enqueueReconciliation(context, checkoutAttemptId);
      return jsonResponse(securityContext, { result: 'already_paid' });
    }

    if (action === 'expire_then_verify') {
      try {
        await stripe.checkout.sessions.expire(
          session.id,
          {},
          { idempotencyKey: `taa-abandon:${checkoutAttemptId}:${session.id}` }
        );
        session = await stripe.checkout.sessions.retrieve(session.id);
      } catch {
        await enqueueReconciliation(context, checkoutAttemptId);
        return jsonResponse(securityContext, { result: 'reconciliation_pending' });
      }

      action = getCheckoutAbandonmentAction(session);
    }

    if (action !== 'terminalize') {
      await enqueueReconciliation(context, checkoutAttemptId);
      return jsonResponse(securityContext, { result: 'reconciliation_pending' });
    }

    const terminal = await callCheckoutRpc<{
      lifecycle_outcome: string;
      reservation_status: string;
    }>(supabase, 'transition_checkout_session_terminal', {
      p_checkout_session_id: session.id,
      p_reason: 'expired_unpaid',
    });

    return jsonResponse(securityContext, {
      result: terminal?.reservation_status === 'released' ? 'abandoned' : 'reconciliation_pending',
    });
  } catch (error) {
    if (error instanceof RateLimitError && securityContext) {
      return rateLimitResponse(securityContext, error);
    }
    if (error instanceof HttpSecurityError) return browserErrorResponse(error, securityContext);
    if (error instanceof RateLimitServiceError && securityContext) {
      return jsonResponse(securityContext, { error: error.message }, 503);
    }

    const databaseDiagnostic = getCheckoutDatabaseErrorDiagnostic(error);

    console.error(
      'ABANDON CHECKOUT ATTEMPT ERROR:',
      databaseDiagnostic || {
        error_name: error instanceof Error ? error.name : 'unknown',
      }
    );

    return securityContext
      ? jsonResponse(
          securityContext,
          { error: 'Checkout attempt could not be abandoned safely.' },
          409
        )
      : browserErrorResponse(error);
  }
});
