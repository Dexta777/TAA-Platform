import type Stripe from 'npm:stripe@22.4.0';
import { CHECKOUT_PROTOCOL_SOURCE, CHECKOUT_PROTOCOL_VERSION } from './checkout-protocol.ts';

export type CheckoutLifecycleCandidate = {
  id: string;
  checkout_attempt_id: string;
  checkout_request_id: string;
  replaces_checkout_intent_id: string | null;
  checkout_protocol_version: string;
  predecessor_invalidated_at: string | null;
  stripe_checkout_session_id: string;
  payment_intent_id: string | null;
  currency: string;
  subtotal_amount: number;
  active_checkout_intent_id: string | null;
  in_flight_checkout_intent_id: string | null;
};

export type CheckoutLifecycleAction =
  'finalize' | 'payment_pending' | 'expired_unpaid' | 'retain' | 'manual_review';

export class CheckoutLifecycleValidationError extends Error {
  code: string;

  constructor(code: string) {
    super('Authoritative Checkout Session does not match its persisted lifecycle.');
    this.name = 'CheckoutLifecycleValidationError';
    this.code = code;
  }
}

function getResourceId(resource: { id: string } | string | null) {
  return typeof resource === 'string' ? resource : resource?.id || null;
}

export function validateAuthoritativeCheckoutSession(
  session: Stripe.Checkout.Session,
  candidate: CheckoutLifecycleCandidate,
  { requireCurrentPointer = true }: { requireCurrentPointer?: boolean } = {}
) {
  const metadata = session.metadata || {};

  if (metadata.source !== CHECKOUT_PROTOCOL_SOURCE) {
    throw new CheckoutLifecycleValidationError('source_mismatch');
  }

  if (metadata.protocol_version !== CHECKOUT_PROTOCOL_VERSION) {
    throw new CheckoutLifecycleValidationError('protocol_mismatch');
  }

  if (
    metadata.checkout_attempt_id !== candidate.checkout_attempt_id ||
    metadata.checkout_request_id !== candidate.checkout_request_id ||
    metadata.checkout_intent_id !== candidate.id
  ) {
    throw new CheckoutLifecycleValidationError('metadata_identity_mismatch');
  }

  if (session.client_reference_id !== candidate.id) {
    throw new CheckoutLifecycleValidationError('client_reference_mismatch');
  }

  if (session.id !== candidate.stripe_checkout_session_id) {
    throw new CheckoutLifecycleValidationError('session_id_mismatch');
  }

  if (
    session.currency !== candidate.currency ||
    session.amount_subtotal !== candidate.subtotal_amount
  ) {
    throw new CheckoutLifecycleValidationError('canonical_economics_mismatch');
  }

  const paymentIntentId = getResourceId(session.payment_intent);

  if (
    candidate.payment_intent_id &&
    paymentIntentId &&
    candidate.payment_intent_id !== paymentIntentId
  ) {
    throw new CheckoutLifecycleValidationError('payment_intent_id_mismatch');
  }

  if (session.payment_intent && typeof session.payment_intent !== 'string') {
    const paymentMetadata = session.payment_intent.metadata || {};

    if (
      paymentMetadata.source !== CHECKOUT_PROTOCOL_SOURCE ||
      paymentMetadata.protocol_version !== CHECKOUT_PROTOCOL_VERSION ||
      paymentMetadata.checkout_attempt_id !== candidate.checkout_attempt_id ||
      paymentMetadata.checkout_request_id !== candidate.checkout_request_id ||
      paymentMetadata.checkout_intent_id !== candidate.id
    ) {
      throw new CheckoutLifecycleValidationError('payment_intent_metadata_mismatch');
    }
  }

  const ownsCurrentPointer =
    candidate.active_checkout_intent_id === candidate.id ||
    candidate.in_flight_checkout_intent_id === candidate.id;

  if (requireCurrentPointer && !ownsCurrentPointer) {
    throw new CheckoutLifecycleValidationError('lifecycle_pointer_mismatch');
  }
}

export function classifyAuthoritativeCheckoutSession(
  session: Pick<Stripe.Checkout.Session, 'status' | 'payment_status'>
): CheckoutLifecycleAction {
  if (session.payment_status === 'paid' || session.payment_status === 'no_payment_required') {
    return 'finalize';
  }

  if (session.status === 'complete' && session.payment_status === 'unpaid') {
    return 'payment_pending';
  }

  if (session.status === 'expired' && session.payment_status === 'unpaid') {
    return 'expired_unpaid';
  }

  if (session.status === 'open' && session.payment_status === 'unpaid') {
    return 'retain';
  }

  return 'manual_review';
}

export function isPaidInFlightReplacement(candidate: CheckoutLifecycleCandidate) {
  return (
    candidate.replaces_checkout_intent_id !== null &&
    candidate.in_flight_checkout_intent_id === candidate.id &&
    candidate.active_checkout_intent_id !== null &&
    candidate.predecessor_invalidated_at === null
  );
}
