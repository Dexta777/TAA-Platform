import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import Stripe from 'npm:stripe@22.4.0';
import { createClient } from 'npm:@supabase/supabase-js@2.112.2';
import {
  CheckoutLifecycleValidationError,
  classifyAuthoritativeCheckoutSession,
  isPaidInFlightReplacement,
  validateAuthoritativeCheckoutSession,
  type CheckoutLifecycleCandidate,
} from '../_shared/checkout-lifecycle.ts';
import { resolvePaidActiveIntentReplacement } from '../_shared/checkout-paid-path.ts';
import {
  PaidCheckoutSessionValidationError,
  validateAndSynchronizePaidCheckoutSession,
} from '../_shared/checkout-paid-session.ts';
import {
  callCheckoutRpc,
  loadPersistedCheckoutSnapshot,
} from '../_shared/checkout-orchestration.ts';
import {
  createLifecycleLeaseId,
  getCheckoutDiscoveryWindow,
  selectDiscoveredCheckoutSession,
} from '../_shared/checkout-reconciliation.ts';
import {
  buildStripeSessionParametersV1,
  getStripeIdempotencyKeys,
  sha256Deterministic,
} from '../_shared/checkout-protocol.ts';
import { isBearerTokenAuthorized } from '../_shared/internal-auth.ts';

const STRIPE_API_VERSION = '2026-07-29.dahlia';
const MAX_DISCOVERY_PAGES = 5;
const DISCOVERY_PAGE_SIZE = 100;

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

type ReconciliationJob = {
  job_id: string;
  checkout_attempt_id: string | null;
  checkout_intent_id: string | null;
  lifecycle_incident_id: string | null;
  reason: string;
  attempt_count: number;
};

type ReconciliationIntent = {
  id: string;
  checkout_attempt_id: string;
  checkout_request_id: string;
  replaces_checkout_intent_id: string | null;
  checkout_protocol_version: string;
  predecessor_invalidated_at: string | null;
  orchestration_failure_code: string | null;
  stripe_checkout_session_id: string | null;
  stripe_session_params_hash: string | null;
  stripe_session_expires_at: string;
  payment_intent_id: string | null;
  currency: string;
  subtotal_amount: number;
  created_at: string;
};

function authorized(request: Request) {
  const currentSecret = requireEnvironment('CHECKOUT_RECONCILIATION_SECRET');
  const previousSecret = Deno.env.get('CHECKOUT_RECONCILIATION_PREVIOUS_SECRET')?.trim() || '';

  return isBearerTokenAuthorized(request, currentSecret, previousSecret);
}

function getResourceId(resource: string | { id: string } | null) {
  return typeof resource === 'string' ? resource : resource?.id || null;
}

async function completeJob(
  job: ReconciliationJob,
  workerLeaseId: string,
  outcome: 'resolved' | 'retry' | 'manual_review',
  errorCode: string | null = null
) {
  const retrySeconds = Math.min(3600, 30 * 2 ** Math.min(job.attempt_count, 7));

  await callCheckoutRpc(supabase, 'complete_checkout_reconciliation_job', {
    p_job_id: job.job_id,
    p_worker_lease_id: workerLeaseId,
    p_outcome: outcome,
    p_error_code: errorCode,
    p_retry_after_seconds: retrySeconds,
  });
}

async function recordIncident(
  intent: ReconciliationIntent,
  incidentType: string,
  reason: string,
  paymentIntentId: string | null = null
) {
  return await callCheckoutRpc<string>(supabase, 'record_checkout_lifecycle_incident', {
    p_incident_type: incidentType,
    p_checkout_attempt_id: intent.checkout_attempt_id,
    p_checkout_intent_id: intent.id,
    p_stripe_checkout_session_id: intent.stripe_checkout_session_id,
    p_payment_intent_id: paymentIntentId,
    p_diagnostic_details: { reason },
  });
}

async function loadReconciliationIntent(job: ReconciliationJob) {
  let intentId = job.checkout_intent_id;

  if (!intentId && job.checkout_attempt_id) {
    const { data: attempt, error } = await supabase
      .from('checkout_attempts')
      .select('active_checkout_intent_id, in_flight_checkout_intent_id')
      .eq('id', job.checkout_attempt_id)
      .maybeSingle();

    if (error || !attempt) throw new Error('Reconciliation attempt could not be loaded.');

    intentId = attempt.in_flight_checkout_intent_id || attempt.active_checkout_intent_id;
  }

  if (!intentId) return null;

  const { data: intent, error } = await supabase
    .from('checkout_intents')
    .select(
      'id, checkout_attempt_id, checkout_request_id, replaces_checkout_intent_id, checkout_protocol_version, predecessor_invalidated_at, orchestration_failure_code, stripe_checkout_session_id, stripe_session_params_hash, stripe_session_expires_at, payment_intent_id, currency, subtotal_amount, created_at'
    )
    .eq('id', intentId)
    .maybeSingle();

  if (error || !intent) throw new Error('Reconciliation checkout intent could not be loaded.');

  return intent as ReconciliationIntent;
}

async function loadLifecycleCandidate(intent: ReconciliationIntent) {
  const { data: attempt, error } = await supabase
    .from('checkout_attempts')
    .select('active_checkout_intent_id, in_flight_checkout_intent_id, hard_expires_at')
    .eq('id', intent.checkout_attempt_id)
    .maybeSingle();

  if (error || !attempt) throw new Error('Reconciliation lifecycle attempt could not be loaded.');

  const { data: reservation, error: reservationError } = await supabase
    .from('inventory_reservations')
    .select('status, expires_at')
    .eq('checkout_attempt_id', intent.checkout_attempt_id)
    .maybeSingle();

  if (reservationError || !reservation) {
    throw new Error('Reconciliation inventory reservation could not be loaded.');
  }

  return {
    candidate: {
      ...intent,
      stripe_checkout_session_id: intent.stripe_checkout_session_id || '',
      ...attempt,
    } as CheckoutLifecycleCandidate,
    hardExpiresAt: attempt.hard_expires_at as string,
    reservationStatus: reservation.status as string,
    reservationExpiresAt: reservation.expires_at as string,
  };
}

async function loadLifecycleCandidateByIntentId(checkoutIntentId: string) {
  const { data: intent, error } = await supabase
    .from('checkout_intents')
    .select(
      'id, checkout_attempt_id, checkout_request_id, replaces_checkout_intent_id, checkout_protocol_version, predecessor_invalidated_at, orchestration_failure_code, stripe_checkout_session_id, stripe_session_params_hash, stripe_session_expires_at, payment_intent_id, currency, subtotal_amount, created_at'
    )
    .eq('id', checkoutIntentId)
    .maybeSingle();

  if (error || !intent || intent.checkout_protocol_version !== 'reservation_v1') return null;

  return (await loadLifecycleCandidate(intent as ReconciliationIntent)).candidate;
}

async function discoverCheckoutSession(
  intent: ReconciliationIntent,
  hardExpiresAt: string,
  workerLeaseId: string
) {
  const leaseAcquired = await callCheckoutRpc<boolean>(supabase, 'claim_checkout_lifecycle_work', {
    p_checkout_intent_id: intent.id,
    p_worker_lease_id: workerLeaseId,
  });

  if (!leaseAcquired) return { outcome: 'retry' as const, session: null };

  const idempotencyConflict =
    intent.orchestration_failure_code?.endsWith('_idempotency_conflict') === true;
  let recoveredSession: Stripe.Checkout.Session | null = null;

  if (!idempotencyConflict) {
    const snapshot = await loadPersistedCheckoutSnapshot(supabase, intent.id);
    const parameters = buildStripeSessionParametersV1(snapshot);
    const parametersHash = await sha256Deterministic(parameters);

    if (parametersHash !== intent.stripe_session_params_hash) {
      await recordIncident(
        intent,
        'stripe_idempotency_history_conflict',
        'session_params_hash_mismatch'
      );
      return { outcome: 'manual_review' as const, session: null };
    }

    try {
      recoveredSession = await stripe.checkout.sessions.create(parameters, {
        idempotencyKey: getStripeIdempotencyKeys(
          intent.checkout_attempt_id,
          intent.checkout_request_id
        ).session,
      });
    } catch {
      // A bounded list below is the independent recovery path when exact replay is unavailable.
    }
  }

  if (!recoveredSession) {
    const window = getCheckoutDiscoveryWindow({
      createdAt: intent.created_at,
      hardExpiresAt,
    });
    const listed: Stripe.Checkout.Session[] = [];
    let startingAfter: string | undefined;
    let exhaustive = true;

    for (let page = 0; page < MAX_DISCOVERY_PAGES; page += 1) {
      const result = await stripe.checkout.sessions.list({
        created: window,
        limit: DISCOVERY_PAGE_SIZE,
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      });

      listed.push(...result.data);

      if (!result.has_more) break;

      startingAfter = result.data.at(-1)?.id;

      if (!startingAfter || page === MAX_DISCOVERY_PAGES - 1) {
        exhaustive = false;
        break;
      }
    }

    const discovery = selectDiscoveredCheckoutSession(listed, {
      checkoutAttemptId: intent.checkout_attempt_id,
      checkoutRequestId: intent.checkout_request_id,
      checkoutIntentId: intent.id,
    });

    if (discovery.outcome === 'conflict') {
      await recordIncident(intent, 'stripe_session_match_conflict', 'multiple_discovered_sessions');
      return { outcome: 'manual_review' as const, session: null };
    }

    recoveredSession = discovery.session;

    if (!recoveredSession) {
      if (idempotencyConflict) {
        await recordIncident(intent, 'stripe_idempotency_history_conflict', 'no_proven_session');
        return { outcome: 'manual_review' as const, session: null };
      }

      if (!exhaustive) {
        await recordIncident(
          intent,
          'stripe_session_discovery_failed',
          'discovery_scan_cap_reached'
        );
        return { outcome: 'manual_review' as const, session: null };
      }

      if (Date.now() > new Date(hardExpiresAt).getTime() + 5 * 60 * 1000) {
        await callCheckoutRpc(supabase, 'terminalize_checkout_without_session', {
          p_checkout_intent_id: intent.id,
          p_worker_lease_id: workerLeaseId,
          p_reason: 'hard_expiry_no_session_proven',
        });
        return { outcome: 'resolved' as const, session: null };
      }

      return { outcome: 'retry' as const, session: null };
    }
  }

  if (
    recoveredSession.currency !== intent.currency ||
    recoveredSession.amount_subtotal !== intent.subtotal_amount ||
    recoveredSession.expires_at !==
      Math.floor(new Date(intent.stripe_session_expires_at).getTime() / 1000)
  ) {
    await recordIncident(intent, 'stripe_session_match_conflict', 'discovered_session_economics');
    return { outcome: 'manual_review' as const, session: null };
  }

  const shippingRateIds = recoveredSession.shipping_options.map((option, position) => ({
    position,
    stripe_shipping_rate_id:
      typeof option.shipping_rate === 'string' ? option.shipping_rate : option.shipping_rate.id,
  }));

  await callCheckoutRpc(supabase, 'record_discovered_checkout_session', {
    p_checkout_intent_id: intent.id,
    p_worker_lease_id: workerLeaseId,
    p_stripe_checkout_session_id: recoveredSession.id,
    p_stripe_session_expires_at: new Date(recoveredSession.expires_at * 1000).toISOString(),
    p_shipping_rate_ids: shippingRateIds,
  });

  return { outcome: 'recorded' as const, session: recoveredSession };
}

async function resolvePaidPredecessor(
  intent: ReconciliationIntent,
  candidate: CheckoutLifecycleCandidate,
  workerLeaseId: string
) {
  if (!intent.replaces_checkout_intent_id) return true;

  const leaseAcquired = await callCheckoutRpc<boolean>(supabase, 'claim_checkout_lifecycle_work', {
    p_checkout_intent_id: intent.id,
    p_worker_lease_id: workerLeaseId,
  });

  if (!leaseAcquired) return false;

  const { data: predecessor, error } = await supabase
    .from('checkout_intents')
    .select('id, stripe_checkout_session_id')
    .eq('id', intent.replaces_checkout_intent_id)
    .eq('checkout_attempt_id', intent.checkout_attempt_id)
    .maybeSingle();

  if (
    error ||
    !predecessor?.stripe_checkout_session_id ||
    candidate.active_checkout_intent_id !== predecessor.id
  ) {
    await recordIncident(intent, 'paid_path_conflict', 'predecessor_ownership_mismatch');
    return false;
  }

  let predecessorSession: Stripe.Checkout.Session;

  try {
    predecessorSession = await stripe.checkout.sessions.retrieve(
      predecessor.stripe_checkout_session_id
    );

    if (predecessorSession.status === 'open' && predecessorSession.payment_status === 'unpaid') {
      await stripe.checkout.sessions.expire(
        predecessorSession.id,
        {},
        {
          idempotencyKey: getStripeIdempotencyKeys(
            intent.checkout_attempt_id,
            intent.checkout_request_id
          ).expirePrevious,
        }
      );
      predecessorSession = await stripe.checkout.sessions.retrieve(predecessorSession.id);
    }
  } catch {
    await recordIncident(intent, 'paid_path_conflict', 'predecessor_state_unavailable');
    return false;
  }

  if (predecessorSession.status !== 'expired' || predecessorSession.payment_status !== 'unpaid') {
    await recordIncident(intent, 'paid_path_conflict', 'predecessor_not_safely_invalidated');
    return false;
  }

  await callCheckoutRpc(supabase, 'record_checkout_predecessor_invalidated', {
    p_replacement_intent_id: intent.id,
    p_predecessor_intent_id: predecessor.id,
    p_worker_lease_id: workerLeaseId,
  });

  return true;
}

async function resolvePaidActiveIntentPath(
  intent: ReconciliationIntent,
  candidate: CheckoutLifecycleCandidate
) {
  return await resolvePaidActiveIntentReplacement(candidate, {
    loadCandidate: loadLifecycleCandidateByIntentId,
    retrieveSession: async (checkoutSessionId) =>
      await stripe.checkout.sessions.retrieve(checkoutSessionId, {
        expand: ['payment_intent', 'shipping_cost.shipping_rate'],
      }),
    expireSession: async (session, replacement) => {
      await stripe.checkout.sessions.expire(
        session.id,
        {},
        {
          idempotencyKey: getStripeIdempotencyKeys(
            replacement.checkout_attempt_id,
            replacement.checkout_request_id
          ).expireNew,
        }
      );
    },
    terminalizeReplacement: async (checkoutSessionId) => {
      await callCheckoutRpc(supabase, 'transition_checkout_session_terminal', {
        p_checkout_session_id: checkoutSessionId,
        p_reason: 'expired_unpaid',
      });
    },
    recordConflict: async (reason, paymentIntentId) => {
      await recordIncident(intent, 'paid_path_conflict', reason, paymentIntentId);
    },
  });
}

async function processKnownSession(
  intent: ReconciliationIntent,
  lifecycleLeaseId: string,
  reservationExpiresAt: string
) {
  let session = await stripe.checkout.sessions.retrieve(intent.stripe_checkout_session_id!, {
    expand: ['payment_intent.payment_method', 'shipping_cost.shipping_rate'],
  });
  const lifecycle = await loadLifecycleCandidate(intent);

  validateAuthoritativeCheckoutSession(session, lifecycle.candidate, {
    requireCurrentPointer: false,
  });

  let action = classifyAuthoritativeCheckoutSession(session);

  if (action === 'retain' && new Date(reservationExpiresAt).getTime() <= Date.now()) {
    await stripe.checkout.sessions.expire(
      session.id,
      {},
      {
        idempotencyKey: `taa-reconcile:${session.id}:expire`,
      }
    );
    session = await stripe.checkout.sessions.retrieve(session.id, {
      expand: ['payment_intent.payment_method', 'shipping_cost.shipping_rate'],
    });
    validateAuthoritativeCheckoutSession(session, lifecycle.candidate, {
      requireCurrentPointer: false,
    });
    action = classifyAuthoritativeCheckoutSession(session);
  }

  if (action === 'finalize') {
    if (
      isPaidInFlightReplacement(lifecycle.candidate) &&
      !(await resolvePaidPredecessor(intent, lifecycle.candidate, lifecycleLeaseId))
    ) {
      return 'manual_review' as const;
    }

    const resolvedActiveCandidate = await resolvePaidActiveIntentPath(intent, lifecycle.candidate);

    if (!resolvedActiveCandidate) return 'manual_review' as const;

    const paymentIntent =
      typeof session.payment_intent === 'string'
        ? await stripe.paymentIntents.retrieve(session.payment_intent, {
            expand: ['payment_method'],
          })
        : session.payment_intent;
    await validateAndSynchronizePaidCheckoutSession({
      supabase,
      session,
      paymentIntent,
      candidate: resolvedActiveCandidate,
      retrieveShippingRate: async (shippingRateId) =>
        await stripe.shippingRates.retrieve(shippingRateId),
    });
    const paymentMethod =
      paymentIntent?.payment_method && typeof paymentIntent.payment_method !== 'string'
        ? paymentIntent.payment_method
        : null;
    const card = paymentMethod?.card;
    const { data, error } = await supabase.rpc('finalize_paid_checkout', {
      p_checkout_session_id: session.id,
      p_payment_intent_id: paymentIntent?.id || null,
      p_stripe_customer_id: getResourceId(session.customer),
      p_payment_method_type: paymentMethod?.type || null,
      p_payment_brand: card?.brand || null,
      p_payment_last4: card?.last4 || null,
      p_payment_exp_month: card?.exp_month || null,
      p_payment_exp_year: card?.exp_year || null,
    });

    if (error || !data?.[0]) throw new Error('Paid checkout reconciliation failed.');

    return data[0].finalization_outcome === 'manual_review_required'
      ? ('manual_review' as const)
      : ('resolved' as const);
  }

  if (action === 'payment_pending') {
    await callCheckoutRpc(supabase, 'mark_checkout_payment_pending', {
      p_checkout_session_id: session.id,
      p_payment_intent_id: getResourceId(session.payment_intent),
    });
    return 'retry' as const;
  }

  if (action === 'expired_unpaid') {
    await callCheckoutRpc(supabase, 'transition_checkout_session_terminal', {
      p_checkout_session_id: session.id,
      p_reason: 'expired_unpaid',
    });
    return 'resolved' as const;
  }

  if (action === 'retain') return 'retry' as const;

  await recordIncident(
    intent,
    'stripe_session_match_conflict',
    'unsupported_authoritative_session_state',
    getResourceId(session.payment_intent)
  );
  return 'manual_review' as const;
}

async function processJob(job: ReconciliationJob, queueWorkerLeaseId: string) {
  const lifecycleLeaseId = createLifecycleLeaseId();
  const intent = await loadReconciliationIntent(job);

  if (!intent) {
    await completeJob(job, queueWorkerLeaseId, 'manual_review', 'reconciliation_intent_missing');
    return;
  }

  try {
    const lifecycle = await loadLifecycleCandidate(intent);

    if (!intent.stripe_checkout_session_id) {
      const discovery = await discoverCheckoutSession(
        intent,
        lifecycle.hardExpiresAt,
        lifecycleLeaseId
      );

      await completeJob(
        job,
        queueWorkerLeaseId,
        discovery.outcome === 'resolved'
          ? 'resolved'
          : discovery.outcome === 'manual_review'
            ? 'manual_review'
            : 'retry',
        discovery.outcome
      );
      return;
    }

    const outcome = await processKnownSession(
      intent,
      lifecycleLeaseId,
      lifecycle.reservationExpiresAt
    );
    await completeJob(job, queueWorkerLeaseId, outcome, null);
  } catch (error) {
    if (
      error instanceof CheckoutLifecycleValidationError ||
      error instanceof PaidCheckoutSessionValidationError
    ) {
      await recordIncident(intent, 'stripe_session_match_conflict', error.code);
      await completeJob(job, queueWorkerLeaseId, 'manual_review', error.code);
      return;
    }

    console.error('CHECKOUT RECONCILIATION JOB FAILED:', {
      job_id: job.job_id,
      checkout_attempt_id: intent.checkout_attempt_id,
      checkout_intent_id: intent.id,
      error_name: error instanceof Error ? error.name : 'unknown',
    });
    await completeJob(job, queueWorkerLeaseId, 'retry', 'reconciliation_retry');
  }
}

serve(async (request) => {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  if (!authorized(request)) return new Response('Unauthorized', { status: 401 });

  const queueWorkerLeaseId = crypto.randomUUID();
  const { data, error } = await supabase.rpc('claim_checkout_reconciliation_jobs', {
    p_worker_lease_id: queueWorkerLeaseId,
    p_batch_size: 25,
  });

  if (error) {
    console.error('CHECKOUT RECONCILIATION CLAIM FAILED:', { error_code: error.code || 'unknown' });
    return new Response('Reconciliation claim failed', { status: 500 });
  }

  const jobs = (data || []) as ReconciliationJob[];

  for (let index = 0; index < jobs.length; index += 5) {
    await Promise.all(
      jobs.slice(index, index + 5).map((job) => processJob(job, queueWorkerLeaseId))
    );
  }

  return Response.json({ claimed: jobs.length });
});
