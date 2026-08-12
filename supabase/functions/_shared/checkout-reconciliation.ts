import type Stripe from 'npm:stripe@22.4.0';
import { CHECKOUT_PROTOCOL_SOURCE, CHECKOUT_PROTOCOL_VERSION } from './checkout-protocol.ts';

export type CheckoutDiscoveryIdentity = {
  checkoutAttemptId: string;
  checkoutRequestId: string;
  checkoutIntentId: string;
};

export function checkoutSessionMatchesDiscoveryIdentity(
  session: Stripe.Checkout.Session,
  identity: CheckoutDiscoveryIdentity
) {
  const metadata = session.metadata || {};

  return (
    metadata.source === CHECKOUT_PROTOCOL_SOURCE &&
    metadata.protocol_version === CHECKOUT_PROTOCOL_VERSION &&
    metadata.checkout_attempt_id === identity.checkoutAttemptId &&
    metadata.checkout_request_id === identity.checkoutRequestId &&
    metadata.checkout_intent_id === identity.checkoutIntentId &&
    session.client_reference_id === identity.checkoutIntentId
  );
}

export function selectDiscoveredCheckoutSession(
  sessions: Stripe.Checkout.Session[],
  identity: CheckoutDiscoveryIdentity
) {
  const matches = sessions.filter((session) =>
    checkoutSessionMatchesDiscoveryIdentity(session, identity)
  );

  if (matches.length === 0) return { outcome: 'not_found' as const, session: null };
  if (matches.length > 1) return { outcome: 'conflict' as const, session: null };

  return { outcome: 'found' as const, session: matches[0] };
}

export function getCheckoutDiscoveryWindow({
  createdAt,
  hardExpiresAt,
  safetyMarginSeconds = 300,
}: {
  createdAt: string;
  hardExpiresAt: string;
  safetyMarginSeconds?: number;
}) {
  const created = Math.floor(new Date(createdAt).getTime() / 1000);
  const hardExpiry = Math.floor(new Date(hardExpiresAt).getTime() / 1000);

  if (!Number.isFinite(created) || !Number.isFinite(hardExpiry) || hardExpiry <= created) {
    throw new Error('Checkout Session discovery window is invalid.');
  }

  return {
    gte: Math.max(0, created - safetyMarginSeconds),
    lte: hardExpiry + safetyMarginSeconds,
  };
}
