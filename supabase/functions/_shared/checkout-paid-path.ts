import type Stripe from 'npm:stripe@22.4.0';
import {
  CheckoutLifecycleValidationError,
  classifyAuthoritativeCheckoutSession,
  validateAuthoritativeCheckoutSession,
  type CheckoutLifecycleCandidate,
} from './checkout-lifecycle.ts';

type PaidPathDependencies = {
  loadCandidate: (checkoutIntentId: string) => Promise<CheckoutLifecycleCandidate | null>;
  retrieveSession: (checkoutSessionId: string) => Promise<Stripe.Checkout.Session>;
  expireSession: (
    session: Stripe.Checkout.Session,
    replacement: CheckoutLifecycleCandidate
  ) => Promise<void>;
  terminalizeReplacement: (checkoutSessionId: string) => Promise<void>;
  recordConflict: (reason: string, paymentIntentId: string | null) => Promise<void>;
};

function getResourceId(resource: string | { id: string } | null) {
  return typeof resource === 'string' ? resource : resource?.id || null;
}

export function hasUnresolvedInFlightReplacement(candidate: CheckoutLifecycleCandidate) {
  return (
    candidate.active_checkout_intent_id === candidate.id &&
    candidate.in_flight_checkout_intent_id !== null &&
    candidate.in_flight_checkout_intent_id !== candidate.id
  );
}

export async function resolvePaidActiveIntentReplacement(
  paidCandidate: CheckoutLifecycleCandidate,
  dependencies: PaidPathDependencies
) {
  if (!hasUnresolvedInFlightReplacement(paidCandidate)) return paidCandidate;

  const replacementId = paidCandidate.in_flight_checkout_intent_id!;
  const replacement = await dependencies.loadCandidate(replacementId);

  if (
    !replacement ||
    replacement.checkout_attempt_id !== paidCandidate.checkout_attempt_id ||
    replacement.replaces_checkout_intent_id !== paidCandidate.id ||
    replacement.active_checkout_intent_id !== paidCandidate.id ||
    replacement.in_flight_checkout_intent_id !== replacement.id ||
    !replacement.stripe_checkout_session_id
  ) {
    await dependencies.recordConflict('blocking_replacement_ownership_mismatch', null);
    return null;
  }

  let replacementSession: Stripe.Checkout.Session;

  try {
    replacementSession = await dependencies.retrieveSession(replacement.stripe_checkout_session_id);
    validateAuthoritativeCheckoutSession(replacementSession, replacement, {
      requireCurrentPointer: true,
    });

    if (classifyAuthoritativeCheckoutSession(replacementSession) === 'retain') {
      await dependencies.expireSession(replacementSession, replacement);
      replacementSession = await dependencies.retrieveSession(replacementSession.id);
      validateAuthoritativeCheckoutSession(replacementSession, replacement, {
        requireCurrentPointer: true,
      });
    }
  } catch (error) {
    const reason =
      error instanceof CheckoutLifecycleValidationError
        ? `blocking_replacement_${error.code}`
        : 'blocking_replacement_state_unavailable';
    await dependencies.recordConflict(
      reason,
      getResourceId(replacement?.payment_intent_id || null)
    );
    return null;
  }

  if (classifyAuthoritativeCheckoutSession(replacementSession) !== 'expired_unpaid') {
    await dependencies.recordConflict(
      `blocking_replacement_${classifyAuthoritativeCheckoutSession(replacementSession)}`,
      getResourceId(replacementSession.payment_intent)
    );
    return null;
  }

  await dependencies.terminalizeReplacement(replacementSession.id);

  const reloadedPaidCandidate = await dependencies.loadCandidate(paidCandidate.id);

  if (
    !reloadedPaidCandidate ||
    reloadedPaidCandidate.active_checkout_intent_id !== paidCandidate.id ||
    reloadedPaidCandidate.in_flight_checkout_intent_id !== null
  ) {
    await dependencies.recordConflict(
      'blocking_replacement_terminal_transition_mismatch',
      getResourceId(replacementSession.payment_intent)
    );
    return null;
  }

  return reloadedPaidCandidate;
}
