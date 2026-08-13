import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import Stripe from 'npm:stripe@22.4.0';
import { createClient } from 'npm:@supabase/supabase-js@2.112.2';
import { getAuthenticatedUser, sha256Hex } from '../_shared/checkout-access.ts';
import {
  checkoutSessionMatchesAttempt,
  getCheckoutAbandonmentAction,
} from '../_shared/checkout-abandonment.ts';
import { callCheckoutRpc } from '../_shared/checkout-orchestration.ts';
import { normalizeUuid } from '../_shared/checkout-protocol.ts';

const STRIPE_API_VERSION = '2026-07-29.dahlia';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

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

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

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

async function enqueueReconciliation(context: AbandonmentContext, checkoutAttemptId: string) {
  await callCheckoutRpc(supabase, 'enqueue_checkout_reconciliation', {
    p_checkout_attempt_id: checkoutAttemptId,
    p_checkout_intent_id: context.in_flight_checkout_intent_id || context.active_checkout_intent_id,
    p_lifecycle_incident_id: null,
    p_reason: 'browser_abandonment_requested',
    p_manual_review: false,
  });
}

serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed.' }, 405);

  try {
    const payload = await request.json();

    if (!payload || typeof payload !== 'object') {
      return jsonResponse({ error: 'Invalid request body.' }, 400);
    }

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
      return jsonResponse({ result: 'attempt_not_found' });
    }

    if (context.context_state === 'already_paid') {
      return jsonResponse({ result: 'already_paid' });
    }

    if (context.context_state === 'already_terminal') {
      return jsonResponse({ result: 'already_terminal' });
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

      return jsonResponse({ result: terminalized ? 'abandoned' : 'reconciliation_pending' });
    }

    if (context.context_state !== 'active_session') {
      if (context.active_checkout_intent_id || context.in_flight_checkout_intent_id) {
        await enqueueReconciliation(context, checkoutAttemptId);
      }

      return jsonResponse({ result: 'reconciliation_pending' });
    }

    if (!context.active_checkout_intent_id || !context.active_checkout_session_id) {
      await enqueueReconciliation(context, checkoutAttemptId);
      return jsonResponse({ result: 'reconciliation_pending' });
    }

    if (!context.active_checkout_request_id) {
      await enqueueReconciliation(context, checkoutAttemptId);
      return jsonResponse({ result: 'reconciliation_pending' });
    }

    let session: Stripe.Checkout.Session;

    try {
      session = await stripe.checkout.sessions.retrieve(context.active_checkout_session_id);
    } catch {
      await enqueueReconciliation(context, checkoutAttemptId);
      return jsonResponse({ result: 'reconciliation_pending' });
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
      return jsonResponse({ result: 'reconciliation_pending' });
    }

    let action = getCheckoutAbandonmentAction(session);

    if (action === 'already_paid') {
      await enqueueReconciliation(context, checkoutAttemptId);
      return jsonResponse({ result: 'already_paid' });
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
        return jsonResponse({ result: 'reconciliation_pending' });
      }

      action = getCheckoutAbandonmentAction(session);
    }

    if (action !== 'terminalize') {
      await enqueueReconciliation(context, checkoutAttemptId);
      return jsonResponse({ result: 'reconciliation_pending' });
    }

    const terminal = await callCheckoutRpc<{
      lifecycle_outcome: string;
      reservation_status: string;
    }>(supabase, 'transition_checkout_session_terminal', {
      p_checkout_session_id: session.id,
      p_reason: 'expired_unpaid',
    });

    return jsonResponse({
      result: terminal?.reservation_status === 'released' ? 'abandoned' : 'reconciliation_pending',
    });
  } catch (error) {
    console.error('ABANDON CHECKOUT ATTEMPT ERROR:', {
      error_name: error instanceof Error ? error.name : 'unknown',
      error_message: error instanceof Error ? error.message : 'unknown',
    });

    return jsonResponse({ error: 'Checkout attempt could not be abandoned safely.' }, 409);
  }
});
