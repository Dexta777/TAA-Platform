import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import Stripe from 'npm:stripe@22.4.0';
import { createClient } from 'npm:@supabase/supabase-js@2.112.2';

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

  if (!result.already_finalized) {
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
      'id, user_id, shipping_name, shipping_phone, shipping_address, billing_name, billing_address, billing_is_different'
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
      subtotal_amount: session.amount_subtotal,
      shipping_amount: session.shipping_cost?.amount_total || 0,
      total_amount: session.amount_total,
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
    session.metadata.source !== 'the_animal_alchemist_webflow' ||
    !session.metadata.checkout_intent_id
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
        await fulfillCheckoutSession(session.id);
        break;
      }
      case 'checkout.session.async_payment_failed': {
        const session = event.data.object as Stripe.Checkout.Session;
        await updateCheckoutSessionStatus(session.id, 'failed');
        break;
      }
      case 'checkout.session.expired': {
        const session = event.data.object as Stripe.Checkout.Session;
        await updateCheckoutSessionStatus(session.id, 'expired');
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
