import { HttpSecurityError, readBoundedBody, requireJsonContentType } from './http-security.ts';

export const MAXIMUM_STRIPE_WEBHOOK_BODY_BYTES = 1024 * 1024;

export async function readStripeWebhookRequest(request: Request) {
  if (request.method !== 'POST') throw new HttpSecurityError('Method not allowed.', 405);

  const signature = request.headers.get('stripe-signature')?.trim() || '';

  if (!signature) throw new HttpSecurityError('Missing Stripe signature.', 400);

  requireJsonContentType(request);

  return {
    signature,
    rawBody: await readBoundedBody(request, MAXIMUM_STRIPE_WEBHOOK_BODY_BYTES),
  };
}
