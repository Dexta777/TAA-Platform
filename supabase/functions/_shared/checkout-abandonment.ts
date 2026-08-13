import type Stripe from 'npm:stripe@22.4.0';
import { CHECKOUT_PROTOCOL_VERSION } from './checkout-protocol.ts';

export function checkoutSessionMatchesAttempt(
  session: Stripe.Checkout.Session,
  checkoutAttemptId: string,
  checkoutIntentId: string,
  checkoutRequestId: string
) {
  return (
    session.metadata?.protocol_version === CHECKOUT_PROTOCOL_VERSION &&
    session.metadata?.checkout_attempt_id === checkoutAttemptId &&
    session.metadata?.checkout_request_id === checkoutRequestId &&
    session.metadata?.checkout_intent_id === checkoutIntentId &&
    session.client_reference_id === checkoutIntentId
  );
}

export function getCheckoutAbandonmentAction(
  session: Pick<Stripe.Checkout.Session, 'status' | 'payment_status'>
) {
  if (session.payment_status === 'paid' || session.payment_status === 'no_payment_required') {
    return 'already_paid' as const;
  }

  if (session.status === 'expired' && session.payment_status === 'unpaid') {
    return 'terminalize' as const;
  }

  if (session.status === 'open' && session.payment_status === 'unpaid') {
    return 'expire_then_verify' as const;
  }

  return 'reconciliation_pending' as const;
}
