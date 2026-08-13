import { assertEquals, assertRejects } from 'jsr:@std/assert@1';
import Stripe from 'npm:stripe@22.4.0';
import { HttpSecurityError } from './http-security.ts';
import {
  MAXIMUM_STRIPE_WEBHOOK_BODY_BYTES,
  readStripeWebhookRequest,
} from './stripe-webhook-security.ts';

const secret = 'whsec_phase_6a_fixture';
const stripe = new Stripe('sk_test_fixture', { apiVersion: '2026-07-29.dahlia' });
const fixture = JSON.stringify({
  id: 'evt_test',
  object: 'event',
  type: 'checkout.session.completed',
});

async function signedRequest(body = fixture, contentType = 'application/json') {
  const signature = await stripe.webhooks.generateTestHeaderStringAsync({
    payload: body,
    secret,
  });

  return new Request('https://example.supabase.co/functions/v1/stripe-webhook', {
    method: 'POST',
    headers: { 'content-type': contentType, 'stripe-signature': signature },
    body,
  });
}

Deno.test('Stripe webhook ingress rejects non-POST before reading a signature', async () => {
  await assertRejects(
    () => readStripeWebhookRequest(new Request('https://example.test', { method: 'GET' })),
    HttpSecurityError,
    'Method not allowed.'
  );
});

Deno.test('Stripe webhook ingress rejects missing signatures and wrong content types', async () => {
  await assertRejects(
    () =>
      readStripeWebhookRequest(
        new Request('https://example.test', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: fixture,
        })
      ),
    HttpSecurityError,
    'Missing Stripe signature.'
  );
  await assertRejects(
    async () => readStripeWebhookRequest(await signedRequest(fixture, 'text/plain')),
    HttpSecurityError,
    'Content-Type must be application/json.'
  );
});

Deno.test('Stripe webhook ingress rejects streaming bodies over one MiB', async () => {
  await assertRejects(
    async () =>
      readStripeWebhookRequest(
        await signedRequest('x'.repeat(MAXIMUM_STRIPE_WEBHOOK_BODY_BYTES + 1))
      ),
    HttpSecurityError,
    'Request body is too large.'
  );
});

Deno.test('Stripe signature verification uses the exact bounded raw body', async () => {
  const { rawBody, signature } = await readStripeWebhookRequest(await signedRequest());
  const event = await stripe.webhooks.constructEventAsync(rawBody, signature, secret);

  assertEquals(event.id, 'evt_test');

  await assertRejects(() => stripe.webhooks.constructEventAsync(`${rawBody} `, signature, secret));
});
