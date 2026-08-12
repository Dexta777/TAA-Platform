import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import Stripe from 'npm:stripe@22.4.0';
import { createClient } from 'npm:@supabase/supabase-js@2.112.2';
import {
  CheckoutEconomicsMismatchError,
  parseOriginalShippingAmount,
  reconcilePaidDiscountEconomics,
} from '../_shared/checkout-discounts.ts';
import {
  CheckoutLifecycleValidationError,
  classifyAuthoritativeCheckoutSession,
  isPaidInFlightReplacement,
  validateAuthoritativeCheckoutSession,
  type CheckoutLifecycleCandidate,
} from '../_shared/checkout-lifecycle.ts';
import { callCheckoutRpc } from '../_shared/checkout-orchestration.ts';
import { getStripeIdempotencyKeys } from '../_shared/checkout-protocol.ts';

const STRIPE_API_VERSION = '2026-07-29.dahlia';

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

function getResourceId(resource: string | { id: string } | null) {
  return typeof resource === 'string' ? resource : resource?.id || null;
}

function getStripeErrorDetails(error: unknown) {
  if (!error || typeof error !== 'object') return {};

  const stripeError = error as { code?: string; type?: string };

  return {
    error_type: stripeError.type || 'unknown',
    error_code: stripeError.code || 'unknown',
  };
}

async function deleteTemporaryCouponBestEffort(couponId: string | null, context: string) {
  if (!couponId) return;

  try {
    await stripe.coupons.del(couponId);
  } catch (error) {
    const details = getStripeErrorDetails(error);

    if (details.error_code === 'resource_missing') return;

    console.error('TEMPORARY STRIPE COUPON CLEANUP FAILED:', {
      context,
      coupon_id: couponId,
      ...details,
    });
  }
}

async function cleanupTemporaryCouponForSession(checkoutSessionId: string, context: string) {
  try {
    const { data: checkoutIntent, error } = await supabase
      .from('checkout_intents')
      .select('stripe_coupon_id')
      .eq('stripe_checkout_session_id', checkoutSessionId)
      .maybeSingle();

    if (error) throw new Error('Temporary coupon lookup failed.');

    await deleteTemporaryCouponBestEffort(checkoutIntent?.stripe_coupon_id || null, context);
  } catch (error) {
    console.error('TEMPORARY STRIPE COUPON CLEANUP LOOKUP FAILED:', {
      context,
      checkout_session_id: checkoutSessionId,
      error_type: error instanceof Error ? error.name : 'unknown',
    });
  }
}

function splitName(name: string | null) {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  return {
    firstName: parts.shift() || '',
    lastName: parts.join(' '),
  };
}

function toStoredAddress(
  address: Stripe.Address | null,
  name: string | null,
  company: string | null = null
) {
  if (!address) return null;

  const { firstName, lastName } = splitName(name);

  return {
    first_name: firstName,
    last_name: lastName,
    company: company || '',
    address_1: address.line1 || '',
    address_2: address.line2 || '',
    city: address.city || '',
    county: address.state || '',
    postcode: address.postal_code || '',
    country: address.country || 'GB',
  };
}

function getCompleteStoredAddress(value: unknown) {
  if (!value || typeof value !== 'object') return null;

  const address = value as Record<string, unknown>;
  const requiredFields = [
    address.first_name,
    address.last_name,
    address.address_1,
    address.city,
    address.postcode,
    address.country,
  ];

  return requiredFields.every((field) => String(field || '').trim()) ? address : null;
}

async function getPaymentDetails(paymentIntent: Stripe.PaymentIntent | null) {
  if (!paymentIntent?.payment_method) {
    return {
      paymentMethodType: null,
      paymentBrand: null,
      paymentLast4: null,
      paymentExpMonth: null,
      paymentExpYear: null,
    };
  }

  const paymentMethod =
    typeof paymentIntent.payment_method === 'string'
      ? await stripe.paymentMethods.retrieve(paymentIntent.payment_method)
      : paymentIntent.payment_method;

  return {
    paymentMethodType: paymentMethod.type || null,
    paymentBrand: paymentMethod.card?.brand || paymentMethod.type || null,
    paymentLast4: paymentMethod.card?.last4 || null,
    paymentExpMonth: paymentMethod.card?.exp_month || null,
    paymentExpYear: paymentMethod.card?.exp_year || null,
  };
}

async function sendKlaviyoPlacedOrder(order: any, items: any[]) {
  const apiKey = Deno.env.get('KLAVIYO_PRIVATE_API_KEY');

  if (!apiKey || !order.customer_email) {
    console.log('Klaviyo skipped: missing API key or email.');
    return;
  }

  const payload = {
    data: {
      type: 'event',
      attributes: {
        properties: {
          OrderId: order.order_number,
          Categories: ['Pet Care'],
          ItemNames: items.map((item) => item.product_name || item.name || item.sku),
          ItemSkus: items.map((item) => item.sku),
          Items: items.map((item) => ({
            ProductID: item.product_id,
            SKU: item.sku,
            ProductName: item.product_name || item.name,
            Amount: item.amount || null,
            Quantity: item.quantity,
            ItemPrice: Number(item.unit_price || 0),
            RowTotal: Number(item.line_total || 0),
            ImageURL: item.image_url || null,
          })),
          Subtotal: Number(order.subtotal_amount || 0) / 100,
          Shipping: Number(order.shipping_amount || 0) / 100,
          Value: Number(order.total_amount || 0) / 100,
          ShippingMethod: order.shipping_method_name,
          FulfillmentStatus: order.fulfillment_status,
        },
        metric: {
          data: {
            type: 'metric',
            attributes: { name: 'Placed Order' },
          },
        },
        profile: {
          data: {
            type: 'profile',
            attributes: {
              email: order.customer_email,
              first_name: order.shipping_address?.first_name || undefined,
              last_name: order.shipping_address?.last_name || undefined,
              phone_number: order.shipping_phone || undefined,
              properties: {
                order_number: order.order_number,
                shipping_method: order.shipping_method_name,
              },
            },
          },
        },
        value: Number(order.total_amount || 0) / 100,
        unique_id: order.stripe_checkout_session_id || order.payment_intent_id,
        time: new Date().toISOString(),
      },
    },
  };

  const response = await fetch('https://a.klaviyo.com/api/events/', {
    method: 'POST',
    headers: {
      Authorization: `Klaviyo-API-Key ${apiKey}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      revision: '2026-01-15',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    console.error('Klaviyo event failed:', response.status, await response.text());
    return;
  }

  console.log('Klaviyo Placed Order sent.');
}

async function sendKlaviyoForOrder(orderId: string) {
  const { data: order, error: orderError } = await supabase
    .from('orders')
    .select('*')
    .eq('id', orderId)
    .single();

  if (orderError || !order) throw new Error('Finalized order could not be loaded.');

  const { data: items, error: itemsError } = await supabase
    .from('order_items')
    .select('*')
    .eq('order_id', orderId);

  if (itemsError) throw new Error('Finalized order items could not be loaded.');

  try {
    await sendKlaviyoPlacedOrder(order, items || []);
  } catch (error) {
    console.error('KLAVIYO ERROR:', error);
  }
}

async function finalizeOrder({
  checkoutSessionId = null,
  paymentIntentId = null,
  stripeCustomerId = null,
  paymentDetails,
}: {
  checkoutSessionId?: string | null;
  paymentIntentId?: string | null;
  stripeCustomerId?: string | null;
  paymentDetails: Awaited<ReturnType<typeof getPaymentDetails>>;
}) {
  const { data, error } = await supabase.rpc('finalize_paid_checkout', {
    p_checkout_session_id: checkoutSessionId,
    p_payment_intent_id: paymentIntentId,
    p_stripe_customer_id: stripeCustomerId,
    p_payment_method_type: paymentDetails.paymentMethodType,
    p_payment_brand: paymentDetails.paymentBrand,
    p_payment_last4: paymentDetails.paymentLast4,
    p_payment_exp_month: paymentDetails.paymentExpMonth,
    p_payment_exp_year: paymentDetails.paymentExpYear,
  });

  if (error || !data?.[0]) {
    throw new Error(error?.message || 'Paid checkout could not be finalized.');
  }

  const result = data[0];

  if (result.finalization_outcome === 'manual_review_required') {
    if (!result.incident_id) {
      throw new Error('Manual-review finalization was not durably recorded.');
    }

    console.error('HIGH SEVERITY: PAID CHECKOUT REQUIRES MANUAL REVIEW:', {
      checkout_session_id: checkoutSessionId,
      payment_intent_id: paymentIntentId,
      lifecycle_incident_id: result.incident_id,
    });
    return result;
  }

  if (result.finalization_outcome === 'finalized' && !result.already_finalized) {
    await sendKlaviyoForOrder(result.order_id);
  }

  return result;
}

async function getExpandedShippingRate(session: Stripe.Checkout.Session) {
  const shippingRate = session.shipping_cost?.shipping_rate;

  if (!shippingRate) return null;

  return typeof shippingRate === 'string'
    ? await stripe.shippingRates.retrieve(shippingRate)
    : shippingRate;
}

async function updateCheckoutIntentFromSession(
  session: Stripe.Checkout.Session,
  paymentIntent: Stripe.PaymentIntent | null
) {
  const { data: checkoutIntent, error: checkoutIntentError } = await supabase
    .from('checkout_intents')
    .select(
      'id, user_id, shipping_name, shipping_phone, shipping_address, billing_name, billing_address, billing_is_different, subtotal_amount, shipping_amount, total_amount, discount_code_id, discount_code, discount_amount, shipping_discount_amount, stripe_coupon_id'
    )
    .eq('stripe_checkout_session_id', session.id)
    .single();

  if (checkoutIntentError || !checkoutIntent) {
    throw new Error('Checkout intent could not be loaded for Stripe synchronization.');
  }

  const shippingRate = await getExpandedShippingRate(session);
  const shippingDetails = session.collected_information?.shipping_details || null;
  const customerDetails = session.customer_details;
  const shippingMethodId = shippingRate?.metadata.shipping_method_id || null;
  const shippingRateId = shippingRate?.metadata.shipping_rate_id || null;
  const shippingMethodName =
    shippingRate?.metadata.shipping_method_name || shippingRate?.display_name || null;
  const customerEmail = customerDetails?.email || null;
  const stripeShippingAddress = toStoredAddress(
    shippingDetails?.address || null,
    shippingDetails?.name || null
  );
  const stripeBillingAddress = toStoredAddress(
    customerDetails?.address || null,
    customerDetails?.name || null,
    customerDetails?.business_name || null
  );
  const storedShippingAddress = getCompleteStoredAddress(checkoutIntent.shipping_address);
  const storedBillingAddress = getCompleteStoredAddress(checkoutIntent.billing_address);
  const shippingAddress = storedShippingAddress || stripeShippingAddress;
  const billingAddress = storedBillingAddress || stripeBillingAddress || shippingAddress;

  if (
    !shippingRate ||
    !shippingMethodId ||
    !shippingRateId ||
    !shippingMethodName ||
    !customerEmail ||
    !shippingDetails ||
    !shippingAddress ||
    session.amount_subtotal === null ||
    session.amount_total === null
  ) {
    throw new Error('Completed Checkout Session is missing required fulfillment data.');
  }

  const stripeShippingAmount = session.shipping_cost?.amount_total ?? 0;
  const hasTaaDiscount = Boolean(
    checkoutIntent.discount_code_id ||
    checkoutIntent.discount_code ||
    checkoutIntent.stripe_coupon_id ||
    Number(checkoutIntent.discount_amount) > 0 ||
    Number(checkoutIntent.shipping_discount_amount) > 0
  );
  let synchronizedEconomics = {
    subtotalAmount: session.amount_subtotal,
    shippingAmount: stripeShippingAmount,
    shippingDiscountAmount: Number(checkoutIntent.shipping_discount_amount) || 0,
    totalAmount: session.amount_total,
  };

  if (hasTaaDiscount) {
    try {
      synchronizedEconomics = reconcilePaidDiscountEconomics({
        actual: {
          amountSubtotal: session.amount_subtotal,
          amountDiscount: session.total_details?.amount_discount ?? null,
          shippingAmount: session.shipping_cost?.amount_total ?? null,
          amountTotal: session.amount_total,
          currency: session.currency,
        },
        stored: {
          subtotalAmount: Number(checkoutIntent.subtotal_amount),
          discountAmount: Number(checkoutIntent.discount_amount),
          shippingDiscountAmount: Number(checkoutIntent.shipping_discount_amount),
        },
        originalShippingAmount: parseOriginalShippingAmount(
          shippingRate.metadata.original_shipping_amount
        ),
      });
    } catch (error) {
      if (error instanceof CheckoutEconomicsMismatchError) {
        console.error('HIGH SEVERITY: PAID CHECKOUT ECONOMICS MISMATCH:', {
          checkout_session_id: session.id,
          checkout_intent_id: checkoutIntent.id,
          ...error.details,
        });
      }

      throw new Error('Paid Checkout Session economics could not be reconciled.');
    }
  }

  const stripeCustomerId = getResourceId(session.customer);
  const paymentIntentId = paymentIntent?.id || null;
  const { error: updateError } = await supabase
    .from('checkout_intents')
    .update({
      payment_intent_id: paymentIntentId,
      stripe_customer_id: stripeCustomerId,
      customer_email: customerEmail,
      shipping_name: storedShippingAddress ? checkoutIntent.shipping_name : shippingDetails.name,
      shipping_phone: checkoutIntent.shipping_phone || customerDetails?.phone || null,
      shipping_address: shippingAddress,
      billing_name: storedBillingAddress
        ? checkoutIntent.billing_name
        : customerDetails?.name || shippingDetails.name,
      billing_address: billingAddress,
      subtotal_amount: synchronizedEconomics.subtotalAmount,
      shipping_amount: synchronizedEconomics.shippingAmount,
      shipping_discount_amount: synchronizedEconomics.shippingDiscountAmount,
      total_amount: synchronizedEconomics.totalAmount,
      currency: session.currency || 'gbp',
      shipping_method_name: shippingMethodName,
      shipping_method_id: shippingMethodId,
      shipping_rate_id: shippingRateId,
    })
    .eq('stripe_checkout_session_id', session.id)
    .eq('id', checkoutIntent.id);

  if (updateError) {
    throw new Error('Checkout intent could not be synchronized from Stripe.');
  }

  if (checkoutIntent.user_id && stripeCustomerId) {
    const { error: profileError } = await supabase
      .from('customer_profiles')
      .update({ stripe_customer_id: stripeCustomerId })
      .eq('id', checkoutIntent.user_id);

    if (profileError) {
      console.error('Stripe Customer could not be saved to the customer profile:', profileError);
    }
  }

  return { paymentIntentId, stripeCustomerId };
}

async function fulfillCheckoutSession(checkoutSessionId: string) {
  const session = await stripe.checkout.sessions.retrieve(checkoutSessionId, {
    expand: ['payment_intent.payment_method', 'shipping_cost.shipping_rate'],
  });

  if (
    session.metadata?.source !== 'the_animal_alchemist_webflow' ||
    !session.metadata?.checkout_intent_id
  ) {
    console.log('Checkout Session does not belong to the TAA checkout flow:', session.id);
    return null;
  }

  if (session.payment_status !== 'paid' && session.payment_status !== 'no_payment_required') {
    console.log(
      'Checkout Session is not ready for fulfillment:',
      session.id,
      session.payment_status
    );
    return null;
  }

  const paymentIntent =
    typeof session.payment_intent === 'string'
      ? await stripe.paymentIntents.retrieve(session.payment_intent, {
          expand: ['payment_method'],
        })
      : session.payment_intent;
  const identifiers = await updateCheckoutIntentFromSession(session, paymentIntent);
  const paymentDetails = await getPaymentDetails(paymentIntent);

  return finalizeOrder({
    checkoutSessionId: session.id,
    paymentIntentId: identifiers.paymentIntentId,
    stripeCustomerId: identifiers.stripeCustomerId,
    paymentDetails,
  });
}

async function loadCheckoutLifecycleCandidate(checkoutSessionId: string) {
  const { data: intent, error: intentError } = await supabase
    .from('checkout_intents')
    .select(
      'id, checkout_attempt_id, checkout_request_id, replaces_checkout_intent_id, checkout_protocol_version, predecessor_invalidated_at, stripe_checkout_session_id, payment_intent_id, currency, subtotal_amount'
    )
    .eq('stripe_checkout_session_id', checkoutSessionId)
    .maybeSingle();

  if (intentError) throw new Error('Checkout lifecycle candidate could not be loaded.');
  if (!intent || intent.checkout_protocol_version !== 'reservation_v1') return null;

  const { data: attempt, error: attemptError } = await supabase
    .from('checkout_attempts')
    .select('active_checkout_intent_id, in_flight_checkout_intent_id')
    .eq('id', intent.checkout_attempt_id)
    .maybeSingle();

  if (attemptError || !attempt) {
    throw new Error('Checkout lifecycle attempt could not be loaded.');
  }

  return { ...intent, ...attempt } as CheckoutLifecycleCandidate;
}

async function recordLifecycleIncident({
  candidate,
  incidentType,
  paymentIntentId,
  reason,
}: {
  candidate: CheckoutLifecycleCandidate;
  incidentType: string;
  paymentIntentId: string | null;
  reason: string;
}) {
  const incidentId = await callCheckoutRpc<string>(supabase, 'record_checkout_lifecycle_incident', {
    p_incident_type: incidentType,
    p_checkout_attempt_id: candidate.checkout_attempt_id,
    p_checkout_intent_id: candidate.id,
    p_stripe_checkout_session_id: candidate.stripe_checkout_session_id,
    p_payment_intent_id: paymentIntentId,
    p_diagnostic_details: { reason },
  });

  if (!incidentId) throw new Error('Checkout lifecycle incident was not durably recorded.');

  return incidentId;
}

async function resolvePaidInFlightPredecessor(candidate: CheckoutLifecycleCandidate) {
  if (!candidate.replaces_checkout_intent_id) return candidate;

  const workerLeaseId = crypto.randomUUID();
  const leaseAcquired = await callCheckoutRpc<boolean>(supabase, 'claim_checkout_lifecycle_work', {
    p_checkout_intent_id: candidate.id,
    p_worker_lease_id: workerLeaseId,
  });

  if (!leaseAcquired) {
    await recordLifecycleIncident({
      candidate,
      incidentType: 'paid_path_conflict',
      paymentIntentId: candidate.payment_intent_id,
      reason: 'predecessor_resolution_lease_unavailable',
    });
    return null;
  }

  const { data: predecessor, error } = await supabase
    .from('checkout_intents')
    .select('id, checkout_request_id, stripe_checkout_session_id')
    .eq('id', candidate.replaces_checkout_intent_id)
    .maybeSingle();

  if (error || !predecessor?.stripe_checkout_session_id) {
    await recordLifecycleIncident({
      candidate,
      incidentType: 'paid_path_conflict',
      paymentIntentId: candidate.payment_intent_id,
      reason: 'predecessor_session_missing',
    });
    return null;
  }

  let predecessorSession: Stripe.Checkout.Session;

  try {
    predecessorSession = await stripe.checkout.sessions.retrieve(
      predecessor.stripe_checkout_session_id
    );

    if (predecessorSession.status === 'open' && predecessorSession.payment_status === 'unpaid') {
      const keys = getStripeIdempotencyKeys(
        candidate.checkout_attempt_id,
        candidate.checkout_request_id
      );
      await stripe.checkout.sessions.expire(
        predecessorSession.id,
        {},
        { idempotencyKey: keys.expirePrevious }
      );
      predecessorSession = await stripe.checkout.sessions.retrieve(predecessorSession.id);
    }
  } catch {
    await recordLifecycleIncident({
      candidate,
      incidentType: 'paid_path_conflict',
      paymentIntentId: candidate.payment_intent_id,
      reason: 'predecessor_state_unavailable',
    });
    return null;
  }

  if (predecessorSession.status !== 'expired' || predecessorSession.payment_status !== 'unpaid') {
    await recordLifecycleIncident({
      candidate,
      incidentType: 'paid_path_conflict',
      paymentIntentId: candidate.payment_intent_id,
      reason: 'predecessor_not_safely_invalidated',
    });
    return null;
  }

  await callCheckoutRpc(supabase, 'record_checkout_predecessor_invalidated', {
    p_replacement_intent_id: candidate.id,
    p_predecessor_intent_id: predecessor.id,
    p_worker_lease_id: workerLeaseId,
  });

  return await loadCheckoutLifecycleCandidate(candidate.stripe_checkout_session_id);
}

async function reconcileReservationCheckoutSession(checkoutSessionId: string, eventType: string) {
  let candidate = await loadCheckoutLifecycleCandidate(checkoutSessionId);

  if (!candidate) throw new Error('Reservation checkout lifecycle candidate was not found.');

  const session = await stripe.checkout.sessions.retrieve(checkoutSessionId, {
    expand: ['payment_intent.payment_method', 'shipping_cost.shipping_rate'],
  });

  try {
    validateAuthoritativeCheckoutSession(session, candidate, { requireCurrentPointer: false });
  } catch (error) {
    if (!(error instanceof CheckoutLifecycleValidationError)) throw error;

    await recordLifecycleIncident({
      candidate,
      incidentType: 'stripe_session_match_conflict',
      paymentIntentId: getResourceId(session.payment_intent),
      reason: error.code,
    });

    return { lifecycleOutcome: 'manual_review_required', safeTerminal: false };
  }

  const action = classifyAuthoritativeCheckoutSession(session);

  if (action === 'finalize') {
    if (isPaidInFlightReplacement(candidate)) {
      const resolvedCandidate = await resolvePaidInFlightPredecessor(candidate);

      if (!resolvedCandidate) {
        return { lifecycleOutcome: 'manual_review_required', safeTerminal: false };
      }

      candidate = resolvedCandidate;
      validateAuthoritativeCheckoutSession(session, candidate, { requireCurrentPointer: false });
    }

    const paymentIntent =
      typeof session.payment_intent === 'string'
        ? await stripe.paymentIntents.retrieve(session.payment_intent, {
            expand: ['payment_method'],
          })
        : session.payment_intent;
    const identifiers = await updateCheckoutIntentFromSession(session, paymentIntent);
    const paymentDetails = await getPaymentDetails(paymentIntent);
    const result = await finalizeOrder({
      checkoutSessionId: session.id,
      paymentIntentId: identifiers.paymentIntentId,
      stripeCustomerId: identifiers.stripeCustomerId,
      paymentDetails,
    });

    return {
      lifecycleOutcome: result.finalization_outcome,
      safeTerminal: result.finalization_outcome !== 'manual_review_required',
    };
  }

  if (eventType === 'checkout.session.async_payment_failed') {
    const result = await callCheckoutRpc<{ lifecycle_outcome: string }>(
      supabase,
      'transition_checkout_session_terminal',
      {
        p_checkout_session_id: session.id,
        p_reason: 'async_payment_failed',
      }
    );

    return { lifecycleOutcome: result?.lifecycle_outcome, safeTerminal: true };
  }

  if (action === 'payment_pending') {
    const result = await callCheckoutRpc<{ lifecycle_outcome: string }>(
      supabase,
      'mark_checkout_payment_pending',
      {
        p_checkout_session_id: session.id,
        p_payment_intent_id: getResourceId(session.payment_intent),
      }
    );

    return { lifecycleOutcome: result?.lifecycle_outcome, safeTerminal: false };
  }

  if (action === 'expired_unpaid') {
    const result = await callCheckoutRpc<{ lifecycle_outcome: string }>(
      supabase,
      'transition_checkout_session_terminal',
      {
        p_checkout_session_id: session.id,
        p_reason: 'expired_unpaid',
      }
    );

    return { lifecycleOutcome: result?.lifecycle_outcome, safeTerminal: true };
  }

  if (action === 'retain') {
    return { lifecycleOutcome: 'retained', safeTerminal: false };
  }

  await recordLifecycleIncident({
    candidate,
    incidentType: 'stripe_session_match_conflict',
    paymentIntentId: getResourceId(session.payment_intent),
    reason: 'unsupported_authoritative_session_state',
  });

  return { lifecycleOutcome: 'manual_review_required', safeTerminal: false };
}

async function handleLegacyPaymentIntentSucceeded(paymentIntent: Stripe.PaymentIntent) {
  if (paymentIntent.metadata.checkout_intent_id) {
    console.log('Checkout-owned PaymentIntent deferred to Checkout Session fulfillment.');
    return null;
  }

  if (paymentIntent.metadata.source !== 'the_animal_alchemist_webflow') {
    console.log('PaymentIntent does not belong to the TAA legacy checkout flow.');
    return null;
  }

  const expandedPaymentIntent =
    paymentIntent.payment_method && typeof paymentIntent.payment_method === 'string'
      ? await stripe.paymentIntents.retrieve(paymentIntent.id, {
          expand: ['payment_method'],
        })
      : paymentIntent;
  const paymentDetails = await getPaymentDetails(expandedPaymentIntent);

  return finalizeOrder({
    paymentIntentId: paymentIntent.id,
    stripeCustomerId: getResourceId(paymentIntent.customer),
    paymentDetails,
  });
}

async function updateCheckoutSessionStatus(sessionId: string, status: string) {
  const { error } = await supabase
    .from('checkout_intents')
    .update({ status })
    .eq('stripe_checkout_session_id', sessionId);

  if (error) throw new Error('Checkout Session status could not be updated.');
}

serve(async (request) => {
  const signature = request.headers.get('stripe-signature');

  if (!signature) {
    return new Response('Missing Stripe signature', { status: 400 });
  }

  const body = await request.text();
  let event: Stripe.Event;

  try {
    event = await stripe.webhooks.constructEventAsync(
      body,
      signature,
      requireEnvironment('STRIPE_WEBHOOK_SECRET')
    );
  } catch (error) {
    console.error('STRIPE WEBHOOK SIGNATURE ERROR:', error);

    return new Response('Webhook signature verification failed', { status: 400 });
  }

  try {
    console.log('STRIPE EVENT:', event.type, event.id);

    switch (event.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded': {
        const session = event.data.object as Stripe.Checkout.Session;
        const candidate = await loadCheckoutLifecycleCandidate(session.id);

        if (candidate) {
          const result = await reconcileReservationCheckoutSession(session.id, event.type);

          if (result.safeTerminal) {
            await cleanupTemporaryCouponForSession(session.id, event.type);
          }
        } else {
          try {
            await fulfillCheckoutSession(session.id);
          } finally {
            await cleanupTemporaryCouponForSession(session.id, event.type);
          }
        }
        break;
      }
      case 'checkout.session.async_payment_failed':
      case 'checkout.session.expired': {
        const session = event.data.object as Stripe.Checkout.Session;
        const candidate = await loadCheckoutLifecycleCandidate(session.id);

        if (candidate) {
          const result = await reconcileReservationCheckoutSession(session.id, event.type);

          if (result.safeTerminal) {
            await cleanupTemporaryCouponForSession(session.id, event.type);
          }
        } else {
          await updateCheckoutSessionStatus(
            session.id,
            event.type === 'checkout.session.expired' ? 'expired' : 'failed'
          );
          await cleanupTemporaryCouponForSession(session.id, event.type);
        }
        break;
      }
      case 'payment_intent.succeeded': {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        await handleLegacyPaymentIntentSucceeded(paymentIntent);
        break;
      }
      case 'payment_intent.payment_failed':
      case 'payment_intent.canceled': {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;

        if (!paymentIntent.metadata.checkout_intent_id) {
          const { error } = await supabase
            .from('checkout_intents')
            .update({
              status: event.type === 'payment_intent.canceled' ? 'cancelled' : 'failed',
            })
            .eq('payment_intent_id', paymentIntent.id);

          if (error) throw new Error('Legacy PaymentIntent status could not be updated.');
        }
        break;
      }
      default:
        console.log('IGNORED EVENT:', event.type);
    }

    return new Response('ok', { status: 200 });
  } catch (error) {
    console.error('WEBHOOK ERROR:', error);

    return new Response('Webhook processing failed', { status: 500 });
  }
});
