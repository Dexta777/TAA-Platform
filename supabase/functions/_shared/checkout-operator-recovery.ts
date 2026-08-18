import type Stripe from 'npm:stripe@22.4.0';
import {
  classifyAuthoritativeCheckoutSession,
  validateAuthoritativeCheckoutSession,
  type CheckoutLifecycleCandidate,
} from './checkout-lifecycle.ts';
import { normalizeUuid } from './checkout-protocol.ts';

export type CheckoutOperatorRecoveryMode =
  { mode: 'batch' } | { mode: 'targeted'; checkoutAttemptId: string };

export type CheckoutOperatorRecoveryOutcome = 'resolved' | 'retry' | 'manual_review';

export type TargetedRecoveryState = {
  attemptStatus: string;
  activeCheckoutIntentId: string | null;
  inFlightCheckoutIntentId: string | null;
  reservationStatus: string | null;
  reservationOrderId: string | null;
  intents: Array<{
    id: string;
    status: string;
    orchestrationState: string;
  }>;
  orders: Array<{
    id: string;
    checkoutIntentId: string | null;
  }>;
  manualReviewJobCount: number;
};

export function parseCheckoutOperatorRecoveryBody(
  rawBody: string,
  requestedMode: string | null
): CheckoutOperatorRecoveryMode {
  if (!rawBody.trim()) {
    if (requestedMode !== null) throw new Error('Reconciliation request mode is invalid.');

    return { mode: 'batch' };
  }

  if (requestedMode !== 'targeted') {
    throw new Error('Targeted reconciliation mode is required.');
  }

  let value: unknown;

  try {
    value = JSON.parse(rawBody);
  } catch {
    throw new Error('Reconciliation request body is invalid.');
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Reconciliation request body must be an object.');
  }

  const payload = value as Record<string, unknown>;
  const fields = Object.keys(payload);

  if (fields.length !== 1 || fields[0] !== 'checkout_attempt_id') {
    throw new Error('Reconciliation request fields are invalid.');
  }

  return {
    mode: 'targeted',
    checkoutAttemptId: normalizeUuid(payload.checkout_attempt_id, 'Checkout attempt ID'),
  };
}

const TERMINAL_INTENT_STATUSES = new Set(['expired', 'failed']);
const TERMINAL_ORCHESTRATION_STATES = new Set(['failed', 'superseded', 'compensated']);

function isTerminalIntentHistory(intent: TargetedRecoveryState['intents'][number]) {
  return (
    TERMINAL_INTENT_STATUSES.has(intent.status) &&
    TERMINAL_ORCHESTRATION_STATES.has(intent.orchestrationState)
  );
}

export function classifyTargetedRecoveryState(state: TargetedRecoveryState) {
  if (state.manualReviewJobCount > 0) return 'integrity_review' as const;

  const pointersCleared = !state.activeCheckoutIntentId && !state.inFlightCheckoutIntentId;
  const paidIntents = state.intents.filter(
    (intent) => intent.status === 'paid' && intent.orchestrationState === 'paid'
  );
  const paidIntent = paidIntents.length === 1 ? paidIntents[0] : null;
  const paidOrder = paidIntent
    ? state.orders.find(
        (order) => order.id === state.reservationOrderId && order.checkoutIntentId === paidIntent.id
      )
    : null;
  const paidHistoryIsCoherent = state.intents.every(
    (intent) => intent.id === paidIntent?.id || isTerminalIntentHistory(intent)
  );

  if (
    state.attemptStatus === 'paid' &&
    state.reservationStatus === 'consumed' &&
    pointersCleared &&
    paidIntent &&
    paidOrder &&
    state.orders.length === 1 &&
    paidHistoryIsCoherent
  ) {
    return 'paid_preserved' as const;
  }

  const terminalHistoryIsCoherent =
    state.intents.length > 0 && state.intents.every(isTerminalIntentHistory);

  if (
    ['expired', 'failed'].includes(state.attemptStatus) &&
    state.reservationStatus === 'released' &&
    !state.reservationOrderId &&
    pointersCleared &&
    state.orders.length === 0 &&
    terminalHistoryIsCoherent
  ) {
    return 'recovered' as const;
  }

  if (
    ['active', 'payment_pending'].includes(state.attemptStatus) &&
    ['held', 'payment_pending'].includes(state.reservationStatus || '')
  ) {
    return 'pending' as const;
  }

  return 'integrity_review' as const;
}

export function getNoSessionRecoveryAction({
  checkoutIntentId,
  replacesCheckoutIntentId,
  predecessorInvalidatedAt,
  activeCheckoutIntentId,
  inFlightCheckoutIntentId,
}: {
  checkoutIntentId: string;
  replacesCheckoutIntentId: string | null;
  predecessorInvalidatedAt: string | null;
  activeCheckoutIntentId: string | null;
  inFlightCheckoutIntentId: string | null;
}) {
  if (inFlightCheckoutIntentId !== checkoutIntentId) return 'manual_review' as const;

  if (!replacesCheckoutIntentId) {
    return activeCheckoutIntentId ? ('manual_review' as const) : ('terminalize_attempt' as const);
  }

  if (!predecessorInvalidatedAt) {
    return activeCheckoutIntentId === replacesCheckoutIntentId
      ? ('fail_pre_checkpoint_replacement' as const)
      : ('manual_review' as const);
  }

  return activeCheckoutIntentId ? ('manual_review' as const) : ('terminalize_attempt' as const);
}

export async function processKnownCheckoutSession(
  {
    checkoutSessionId,
    reservationExpiresAt,
    forceExpireOpenSession = false,
  }: {
    checkoutSessionId: string;
    reservationExpiresAt: string;
    forceExpireOpenSession?: boolean;
  },
  {
    retrieveSession,
    loadCandidate,
    expireSession,
    finalizeSession,
    markPaymentPending,
    transitionTerminal,
    recordUnsupportedState,
    now = () => Date.now(),
  }: {
    retrieveSession: (checkoutSessionId: string) => Promise<Stripe.Checkout.Session>;
    loadCandidate: () => Promise<CheckoutLifecycleCandidate>;
    expireSession: (session: Stripe.Checkout.Session) => Promise<void>;
    finalizeSession: (
      session: Stripe.Checkout.Session,
      candidate: CheckoutLifecycleCandidate
    ) => Promise<'resolved' | 'manual_review'>;
    markPaymentPending: (session: Stripe.Checkout.Session) => Promise<void>;
    transitionTerminal: (session: Stripe.Checkout.Session) => Promise<void>;
    recordUnsupportedState: (session: Stripe.Checkout.Session) => Promise<void>;
    now?: () => number;
  }
): Promise<CheckoutOperatorRecoveryOutcome> {
  const retrieveAndValidate = async (knownCandidate?: CheckoutLifecycleCandidate) => {
    const session = await retrieveSession(checkoutSessionId);
    const candidate = knownCandidate || (await loadCandidate());

    validateAuthoritativeCheckoutSession(session, candidate, {
      requireCurrentPointer: false,
    });

    return { candidate, session };
  };

  let { candidate, session } = await retrieveAndValidate();
  let action = classifyAuthoritativeCheckoutSession(session);
  const reservationExpired = new Date(reservationExpiresAt).getTime() <= now();

  if (action === 'retain' && (forceExpireOpenSession || reservationExpired)) {
    await expireSession(session);
    ({ session } = await retrieveAndValidate(candidate));
    action = classifyAuthoritativeCheckoutSession(session);
  }

  if (action === 'finalize') return await finalizeSession(session, candidate);

  if (action === 'payment_pending') {
    await markPaymentPending(session);
    return 'retry';
  }

  if (action === 'expired_unpaid') {
    await transitionTerminal(session);
    return 'resolved';
  }

  if (action === 'retain') return 'retry';

  await recordUnsupportedState(session);
  return 'manual_review';
}
