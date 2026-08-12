import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import Stripe from 'npm:stripe@22.4.0';
import { createClient } from 'npm:@supabase/supabase-js@2.112.2';
import {
  CheckoutInputError,
  cleanText,
  getCanonicalShippingOptions,
  resolveCanonicalCart,
} from '../_shared/checkout-catalog.ts';
import {
  CONFIRMATION_CAPABILITY_TTL_MS,
  cleanCheckoutAddress,
  getAuthenticatedUser,
  sha256Hex,
} from '../_shared/checkout-access.ts';
import {
  type DiscountEvaluation,
  CheckoutEconomicsMismatchError,
  getStripeCouponParameters,
  getStripeShippingAmount,
  isMerchandiseDiscount,
  mapPublicDiscountError,
  verifyCreatedDiscountEconomics,
} from '../_shared/checkout-discounts.ts';

const STRIPE_API_VERSION = '2026-07-29.dahlia';
const CHECKOUT_RETURN_URL =
  'https://www.theanimalalchemist.com/order-confirmation-test?checkout_session_id={CHECKOUT_SESSION_ID}';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

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

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

class DiscountEligibilityError extends Error {
  publicReason: string;
  minimumSubtotalAmount: number | null;

  constructor(publicReason: string, minimumSubtotalAmount: number | null = null) {
    super('Discount code could not be applied.');
    this.name = 'DiscountEligibilityError';
    this.publicReason = publicReason;
    this.minimumSubtotalAmount = minimumSubtotalAmount;
  }
}

function createConfirmationCapability() {
  const tokenBytes = crypto.getRandomValues(new Uint8Array(32));
  const token = btoa(String.fromCharCode(...tokenBytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');

  return { token, tokenBytes: new TextEncoder().encode(token) };
}

async function getStripeCustomer(authenticatedUserId: string | undefined) {
  if (!authenticatedUserId) return { id: null, email: null };

  const { data: customerProfile, error: profileError } = await supabase
    .from('customer_profiles')
    .select('stripe_customer_id')
    .eq('id', authenticatedUserId)
    .maybeSingle();

  if (profileError) throw new Error('Customer profile lookup failed.');

  const customerId = customerProfile?.stripe_customer_id || null;

  if (!customerId) return { id: null, email: null };

  const customer = await stripe.customers.retrieve(customerId);

  if (customer.deleted) throw new Error('Stored Stripe Customer is unavailable.');

  const customerEmail = cleanText(customer.email, 320);

  if (!customerEmail) throw new Error('Stored Stripe Customer email is unavailable.');

  return { id: customer.id, email: customerEmail };
}

function isCanonicalDiscountEvaluation(value: unknown): value is DiscountEvaluation {
  if (!value || typeof value !== 'object') return false;

  const evaluation = value as Record<string, unknown>;
  const amounts = [
    evaluation.discount_amount,
    evaluation.shipping_discount_amount,
    evaluation.final_shipping_amount,
    evaluation.total_amount,
  ];

  return (
    typeof evaluation.eligible === 'boolean' &&
    typeof evaluation.reason_code === 'string' &&
    amounts.every((amount) => Number.isSafeInteger(amount) && Number(amount) >= 0)
  );
}

async function evaluateSubmittedDiscount({
  code,
  subtotalAmount,
  shippingAmount,
  userId,
  trustedEmail,
  phone,
  shippingAddress,
}: {
  code: string;
  subtotalAmount: number;
  shippingAmount: number;
  userId: string | null;
  trustedEmail: string | null;
  phone: string | null;
  shippingAddress: Record<string, string>;
}) {
  const { data, error } = await supabase.rpc('evaluate_discount_code', {
    p_code: code,
    p_subtotal_amount: subtotalAmount,
    p_shipping_amount: shippingAmount,
    p_user_id: userId,
    p_email: trustedEmail,
    p_phone: phone,
    p_shipping_address: shippingAddress,
  });

  if (error) throw new Error('Discount eligibility could not be evaluated.');

  const evaluation = Array.isArray(data) ? data[0] : data;

  if (!isCanonicalDiscountEvaluation(evaluation)) {
    throw new Error('Discount evaluator returned an invalid result.');
  }

  if (!evaluation.eligible) {
    console.warn('DISCOUNT EVALUATION REJECTED:', {
      reason_code: evaluation.reason_code,
      discount_code_id: evaluation.discount_code_id,
    });

    throw new DiscountEligibilityError(
      mapPublicDiscountError(evaluation.reason_code),
      evaluation.reason_code === 'minimum_subtotal_not_met'
        ? evaluation.minimum_subtotal_amount
        : null
    );
  }

  if (!evaluation.discount_code_id || !evaluation.code || !evaluation.discount_type) {
    throw new Error('Eligible discount result is incomplete.');
  }

  if (isMerchandiseDiscount(evaluation.discount_type) && evaluation.discount_amount === 0) {
    console.warn('DISCOUNT EVALUATION REJECTED:', {
      reason_code: 'zero_merchandise_discount',
      discount_code_id: evaluation.discount_code_id,
    });

    throw new DiscountEligibilityError('discount_unavailable');
  }

  return evaluation;
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

async function expireCheckoutSessionBestEffort(sessionId: string, context: string) {
  try {
    await stripe.checkout.sessions.expire(sessionId);
  } catch (error) {
    console.error('STRIPE CHECKOUT SESSION EXPIRY FAILED:', {
      context,
      checkout_session_id: sessionId,
      ...getStripeErrorDetails(error),
    });
  }
}

serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed.' }, 405);
  }

  try {
    let payload;

    try {
      payload = await request.json();
    } catch {
      throw new CheckoutInputError('Invalid request body.');
    }

    if (!payload || typeof payload !== 'object') {
      throw new CheckoutInputError('Invalid request body.');
    }

    const cart = Array.isArray(payload.cart) ? payload.cart : [];
    const shippingMethodName = cleanText(payload.shipping_method_name, 200);
    const discountCode = cleanText(payload.discount_code, 200);

    if (!shippingMethodName) {
      throw new CheckoutInputError('Please select a shipping method.');
    }

    const validatedItems = await resolveCanonicalCart(supabase, cart);
    const subtotalAmount = validatedItems.reduce((total, item) => total + item.line_total, 0);
    const totalWeightGrams = validatedItems.reduce((total, item) => total + item.weight_grams, 0);

    if (totalWeightGrams <= 0) {
      throw new CheckoutInputError('Basket weight could not be calculated.');
    }

    const shippingOptions = await getCanonicalShippingOptions(supabase, totalWeightGrams);
    const selectedShippingOption = shippingOptions.find(
      (option) => option.name.trim().toLowerCase() === shippingMethodName.toLowerCase()
    );

    if (!selectedShippingOption) {
      throw new CheckoutInputError('Selected shipping method is unavailable.');
    }

    const orderedShippingOptions = [
      selectedShippingOption,
      ...shippingOptions.filter((option) => option.id !== selectedShippingOption.id),
    ];
    const checkoutIntentId = crypto.randomUUID();
    const authenticatedUser = await getAuthenticatedUser(supabase, request);
    const stripeCustomer = await getStripeCustomer(authenticatedUser?.id);
    const customerEmail = stripeCustomer.email || null;
    const trustedIdentityEmail = cleanText(authenticatedUser?.email, 320) || null;
    const shippingAddress = cleanCheckoutAddress(payload.shipping_address, {
      requireComplete: false,
    });
    const billingAddress = cleanCheckoutAddress(
      payload.billing_address || payload.shipping_address,
      { label: 'billing', requireComplete: false }
    );
    const shippingName = cleanText(payload.shipping_name, 200) || null;
    const billingName = cleanText(payload.billing_name, 200) || shippingName;
    const shippingPhone = cleanText(payload.shipping_phone, 50) || null;
    const billingIsDifferent = Boolean(payload.billing_is_different);
    const discountEvaluation = discountCode
      ? await evaluateSubmittedDiscount({
          code: discountCode,
          subtotalAmount,
          shippingAmount: selectedShippingOption.shipping,
          userId: authenticatedUser?.id || null,
          trustedEmail: trustedIdentityEmail,
          phone: shippingPhone,
          shippingAddress,
        })
      : null;
    const { token: confirmationToken, tokenBytes } = createConfirmationCapability();
    const confirmationTokenHash = await sha256Hex(tokenBytes);
    const confirmationTokenExpiresAt = new Date(
      Date.now() + CONFIRMATION_CAPABILITY_TTL_MS
    ).toISOString();

    let stripeCouponId: string | null = null;
    let session: Stripe.Checkout.Session | null = null;

    try {
      if (discountEvaluation && isMerchandiseDiscount(discountEvaluation.discount_type)) {
        const coupon = await stripe.coupons.create(
          getStripeCouponParameters(discountEvaluation, checkoutIntentId)
        );

        stripeCouponId = coupon.id;
      }

      session = await stripe.checkout.sessions.create({
        ui_mode: 'elements',
        mode: 'payment',
        phone_number_collection: {
          enabled: true,
        },
        return_url: CHECKOUT_RETURN_URL,
        line_items: validatedItems.map((item) => ({
          quantity: item.quantity,
          price_data: {
            currency: 'gbp',
            unit_amount: item.unit_amount,
            product_data: {
              name: item.name,
              ...(item.image_url && /^https:\/\//i.test(item.image_url)
                ? { images: [item.image_url] }
                : {}),
              metadata: {
                sku: item.sku,
                product_type: item.product_type,
                product_id: item.product_id,
                base_product_id: item.base_product_id,
              },
            },
          },
        })),
        shipping_options: orderedShippingOptions.map((option) => ({
          shipping_rate_data: {
            type: 'fixed_amount',
            display_name: option.name,
            fixed_amount: {
              amount: getStripeShippingAmount(
                option.shipping,
                discountEvaluation?.discount_type || null
              ),
              currency: 'gbp',
            },
            metadata: {
              original_shipping_amount: String(option.shipping),
              shipping_method_id: option.id,
              shipping_rate_id: option.rate_id,
              shipping_method_name: option.name,
            },
          },
        })),
        ...(stripeCouponId ? { discounts: [{ coupon: stripeCouponId }] } : {}),
        ...(stripeCustomer.id
          ? { customer: stripeCustomer.id }
          : { customer_creation: 'always' as const }),
        client_reference_id: checkoutIntentId,
        metadata: {
          source: 'the_animal_alchemist_webflow',
          checkout_intent_id: checkoutIntentId,
        },
        payment_intent_data: {
          metadata: {
            source: 'the_animal_alchemist_webflow',
            checkout_intent_id: checkoutIntentId,
          },
        },
      });

      if (!session.client_secret) {
        throw new Error('Stripe did not return a Checkout client secret.');
      }

      if (discountEvaluation) {
        verifyCreatedDiscountEconomics(
          {
            amountSubtotal: session.amount_subtotal,
            amountDiscount: session.total_details?.amount_discount ?? null,
            shippingAmount:
              session.shipping_cost?.amount_total ?? session.total_details?.amount_shipping ?? null,
            amountTotal: session.amount_total,
            currency: session.currency,
          },
          {
            subtotalAmount,
            discountAmount: discountEvaluation.discount_amount,
            shippingAmount: discountEvaluation.final_shipping_amount,
            totalAmount: discountEvaluation.total_amount,
          }
        );
      }
    } catch (error) {
      if (error instanceof CheckoutEconomicsMismatchError) {
        console.error('STRIPE CHECKOUT ECONOMICS MISMATCH:', {
          checkout_intent_id: checkoutIntentId,
          ...error.details,
        });
      }

      if (session) {
        await expireCheckoutSessionBestEffort(session.id, 'session_creation_compensation');
      }

      await deleteTemporaryCouponBestEffort(stripeCouponId, 'session_creation_compensation');
      throw error;
    }

    if (!session) throw new Error('Stripe Checkout Session was not created.');

    const shippingAmount = discountEvaluation
      ? discountEvaluation.final_shipping_amount
      : selectedShippingOption.shipping;
    const totalAmount = discountEvaluation
      ? discountEvaluation.total_amount
      : subtotalAmount + shippingAmount;
    const { error: checkoutIntentError } = await supabase.from('checkout_intents').insert({
      id: checkoutIntentId,
      stripe_checkout_session_id: session.id,
      payment_intent_id: null,
      user_id: authenticatedUser?.id || null,
      stripe_customer_id: stripeCustomer.id,
      confirmation_token_hash: confirmationTokenHash,
      confirmation_token_expires_at: confirmationTokenExpiresAt,
      create_account_requested: Boolean(payload.create_account_requested),
      status: 'pending',
      customer_email: customerEmail,
      shipping_name: shippingName,
      shipping_phone: shippingPhone,
      shipping_address: shippingAddress,
      billing_name: billingName,
      billing_address: billingAddress,
      billing_is_different: billingIsDifferent,
      subtotal_amount: subtotalAmount,
      shipping_amount: shippingAmount,
      total_amount: totalAmount,
      currency: 'gbp',
      shipping_method_name: selectedShippingOption.name,
      shipping_method_id: selectedShippingOption.id,
      shipping_rate_id: selectedShippingOption.rate_id,
      total_weight_grams: totalWeightGrams,
      discount_code_id: discountEvaluation?.discount_code_id || null,
      discount_code: discountEvaluation?.code || null,
      discount_amount: discountEvaluation?.discount_amount || 0,
      shipping_discount_amount: discountEvaluation?.shipping_discount_amount || 0,
      stripe_coupon_id: stripeCouponId,
    });

    if (checkoutIntentError) {
      await expireCheckoutSessionBestEffort(session.id, 'checkout_intent_insert_failure');
      await deleteTemporaryCouponBestEffort(stripeCouponId, 'checkout_intent_insert_failure');
      throw new Error('Checkout intent could not be created.');
    }

    const { error: checkoutItemsError } = await supabase
      .from('checkout_intent_items')
      .insert(validatedItems.map((item) => ({ ...item, checkout_intent_id: checkoutIntentId })));

    if (checkoutItemsError) {
      await supabase
        .from('checkout_intents')
        .update({ status: 'failed' })
        .eq('id', checkoutIntentId);
      await expireCheckoutSessionBestEffort(session.id, 'checkout_items_insert_failure');
      await deleteTemporaryCouponBestEffort(stripeCouponId, 'checkout_items_insert_failure');
      throw new Error('Checkout items could not be created.');
    }

    const stripeShippingOptions = session.shipping_options.map((option, index) => ({
      ...orderedShippingOptions[index],
      shipping: getStripeShippingAmount(
        orderedShippingOptions[index].shipping,
        discountEvaluation?.discount_type || null
      ),
      stripe_shipping_rate_id:
        typeof option.shipping_rate === 'string' ? option.shipping_rate : option.shipping_rate.id,
    }));

    return jsonResponse({
      client_secret: session.client_secret,
      checkout_session_id: session.id,
      checkout_intent_id: checkoutIntentId,
      confirmation_token: confirmationToken,
      locked_customer_email: stripeCustomer.id ? customerEmail : null,
      subtotal: subtotalAmount,
      shipping: shippingAmount,
      total: totalAmount,
      currency: 'gbp',
      total_weight_grams: totalWeightGrams,
      shipping_options: stripeShippingOptions,
      items: validatedItems,
      ...(discountEvaluation
        ? {
            discount: {
              code: discountEvaluation.code,
              name: discountEvaluation.name,
              type: discountEvaluation.discount_type,
              discount_amount: discountEvaluation.discount_amount,
              shipping_discount_amount: discountEvaluation.shipping_discount_amount,
            },
          }
        : {}),
    });
  } catch (error) {
    if (error instanceof CheckoutInputError) {
      return jsonResponse({ error: error.message }, 400);
    }

    if (error instanceof DiscountEligibilityError) {
      return jsonResponse(
        {
          error: error.message,
          discount_error: error.publicReason,
          ...(error.minimumSubtotalAmount !== null
            ? { minimum_subtotal_amount: error.minimumSubtotalAmount }
            : {}),
        },
        400
      );
    }

    console.error('CREATE CHECKOUT SESSION ERROR:', error);

    return jsonResponse({ error: 'Unable to prepare Checkout.' }, 500);
  }
});
