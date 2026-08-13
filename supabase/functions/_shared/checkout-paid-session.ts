import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.112.2';
import type Stripe from 'npm:stripe@22.4.0';
import {
  CheckoutEconomicsMismatchError,
  parseOriginalShippingAmount,
  reconcilePaidDiscountEconomics,
  verifyCreatedDiscountEconomics,
} from './checkout-discounts.ts';
import {
  classifyAuthoritativeCheckoutSession,
  validateAuthoritativeCheckoutSession,
  type CheckoutLifecycleCandidate,
} from './checkout-lifecycle.ts';

type StoredCheckoutIntent = {
  id: string;
  user_id: string | null;
  shipping_name: string | null;
  shipping_phone: string | null;
  shipping_address: unknown;
  billing_name: string | null;
  billing_address: unknown;
  subtotal_amount: number;
  discount_code_id: string | null;
  discount_code: string | null;
  discount_amount: number;
  shipping_discount_amount: number;
  stripe_coupon_id: string | null;
};

type StoredShippingOption = {
  shipping_method_id: string;
  shipping_rate_id: string;
  display_name: string;
  amount: number;
  original_amount: number;
  currency: string;
  stripe_shipping_rate_id: string;
};

export class PaidCheckoutSessionValidationError extends Error {
  code: string;

  constructor(code: string) {
    super('Paid Checkout Session does not match its canonical checkout state.');
    this.name = 'PaidCheckoutSessionValidationError';
    this.code = code;
  }
}

function getResourceId(resource: string | { id: string } | null) {
  return typeof resource === 'string' ? resource : resource?.id || null;
}

function requireInteger(value: unknown, code: string) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new PaidCheckoutSessionValidationError(code);
  }

  return Number(value);
}

function splitName(name: string | null) {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  return { firstName: parts.shift() || '', lastName: parts.join(' ') };
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

export function validatePaidCheckoutSessionEconomics({
  session,
  paymentIntent,
  candidate,
  checkoutIntent,
  shippingRate,
  shippingOption,
}: {
  session: Stripe.Checkout.Session;
  paymentIntent: Stripe.PaymentIntent | null;
  candidate: CheckoutLifecycleCandidate;
  checkoutIntent: StoredCheckoutIntent;
  shippingRate: Stripe.ShippingRate;
  shippingOption: StoredShippingOption;
}) {
  const sessionForValidation = {
    ...session,
    payment_intent: paymentIntent || session.payment_intent,
  } as Stripe.Checkout.Session;

  validateAuthoritativeCheckoutSession(sessionForValidation, candidate, {
    requireCurrentPointer: false,
  });

  if (classifyAuthoritativeCheckoutSession(session) !== 'finalize') {
    throw new PaidCheckoutSessionValidationError('session_not_paid');
  }

  const sessionPaymentIntentId = getResourceId(session.payment_intent);

  if (sessionPaymentIntentId && (!paymentIntent || paymentIntent.id !== sessionPaymentIntentId)) {
    throw new PaidCheckoutSessionValidationError('payment_intent_not_expanded');
  }

  if (
    checkoutIntent.id !== candidate.id ||
    shippingOption.stripe_shipping_rate_id !== shippingRate.id ||
    shippingRate.metadata.shipping_method_id !== shippingOption.shipping_method_id ||
    shippingRate.metadata.shipping_rate_id !== shippingOption.shipping_rate_id
  ) {
    throw new PaidCheckoutSessionValidationError('selected_shipping_rate_mismatch');
  }

  const sessionCurrency = session.currency?.toLowerCase();
  const optionCurrency = shippingOption.currency?.toLowerCase();

  if (sessionCurrency !== candidate.currency.toLowerCase() || optionCurrency !== sessionCurrency) {
    throw new PaidCheckoutSessionValidationError('currency_mismatch');
  }

  const amountSubtotal = requireInteger(session.amount_subtotal, 'subtotal_missing');
  const amountDiscount = requireInteger(
    session.total_details?.amount_discount,
    'discount_amount_missing'
  );
  const shippingAmount = requireInteger(
    session.shipping_cost?.amount_total,
    'shipping_amount_missing'
  );
  const amountTotal = requireInteger(session.amount_total, 'total_amount_missing');
  const storedSubtotal = requireInteger(checkoutIntent.subtotal_amount, 'stored_subtotal_invalid');
  const storedDiscount = requireInteger(checkoutIntent.discount_amount, 'stored_discount_invalid');
  const storedShippingDiscount = requireInteger(
    checkoutIntent.shipping_discount_amount,
    'stored_shipping_discount_invalid'
  );
  const selectedShippingAmount = requireInteger(
    shippingOption.amount,
    'selected_shipping_amount_invalid'
  );
  const selectedOriginalAmount = requireInteger(
    shippingOption.original_amount,
    'selected_original_shipping_amount_invalid'
  );
  const hasTaaDiscount = Boolean(
    checkoutIntent.discount_code_id ||
    checkoutIntent.discount_code ||
    checkoutIntent.stripe_coupon_id ||
    storedDiscount > 0 ||
    storedShippingDiscount > 0
  );

  try {
    if (!hasTaaDiscount) {
      if (storedDiscount !== 0 || storedShippingDiscount !== 0) {
        throw new PaidCheckoutSessionValidationError('stored_discount_state_mismatch');
      }

      verifyCreatedDiscountEconomics(
        {
          amountSubtotal,
          amountDiscount,
          shippingAmount,
          amountTotal,
          currency: sessionCurrency,
        },
        {
          subtotalAmount: storedSubtotal,
          discountAmount: 0,
          shippingAmount: selectedShippingAmount,
          totalAmount: storedSubtotal + selectedShippingAmount,
        }
      );

      return {
        subtotalAmount: amountSubtotal,
        shippingAmount,
        shippingDiscountAmount: 0,
        totalAmount: amountTotal,
      };
    }

    const originalShippingAmount = parseOriginalShippingAmount(
      shippingRate.metadata.original_shipping_amount
    );

    if (originalShippingAmount !== selectedOriginalAmount) {
      throw new PaidCheckoutSessionValidationError('original_shipping_amount_mismatch');
    }

    const economics = reconcilePaidDiscountEconomics({
      actual: {
        amountSubtotal,
        amountDiscount,
        shippingAmount,
        amountTotal,
        currency: sessionCurrency,
      },
      stored: {
        subtotalAmount: storedSubtotal,
        discountAmount: storedDiscount,
        shippingDiscountAmount: storedShippingDiscount,
      },
      originalShippingAmount,
    });

    if (economics.shippingAmount !== selectedShippingAmount) {
      throw new PaidCheckoutSessionValidationError('selected_shipping_amount_mismatch');
    }

    return economics;
  } catch (error) {
    if (error instanceof PaidCheckoutSessionValidationError) throw error;

    if (error instanceof CheckoutEconomicsMismatchError) {
      throw new PaidCheckoutSessionValidationError(
        `economics_${String(error.details.field || 'mismatch')}`
      );
    }

    throw error;
  }
}

export async function validateAndSynchronizePaidCheckoutSession({
  supabase,
  session,
  paymentIntent,
  candidate,
  retrieveShippingRate,
}: {
  supabase: SupabaseClient;
  session: Stripe.Checkout.Session;
  paymentIntent: Stripe.PaymentIntent | null;
  candidate: CheckoutLifecycleCandidate;
  retrieveShippingRate: (shippingRateId: string) => Promise<Stripe.ShippingRate>;
}) {
  const { data: checkoutIntent, error: checkoutIntentError } = await supabase
    .from('checkout_intents')
    .select(
      'id, user_id, shipping_name, shipping_phone, shipping_address, billing_name, billing_address, subtotal_amount, discount_code_id, discount_code, discount_amount, shipping_discount_amount, stripe_coupon_id'
    )
    .eq('id', candidate.id)
    .eq('stripe_checkout_session_id', session.id)
    .single();

  if (checkoutIntentError || !checkoutIntent) {
    throw new PaidCheckoutSessionValidationError('checkout_intent_missing');
  }

  const shippingRateResource = session.shipping_cost?.shipping_rate;
  const shippingRate =
    typeof shippingRateResource === 'string'
      ? await retrieveShippingRate(shippingRateResource)
      : shippingRateResource;

  if (!shippingRate) {
    throw new PaidCheckoutSessionValidationError('selected_shipping_rate_missing');
  }

  const { data: shippingOption, error: shippingOptionError } = await supabase
    .from('checkout_intent_shipping_options')
    .select(
      'shipping_method_id, shipping_rate_id, display_name, amount, original_amount, currency, stripe_shipping_rate_id'
    )
    .eq('checkout_intent_id', candidate.id)
    .eq('stripe_shipping_rate_id', shippingRate.id)
    .maybeSingle();

  if (shippingOptionError || !shippingOption) {
    throw new PaidCheckoutSessionValidationError('selected_shipping_option_missing');
  }

  const shippingDetails = session.collected_information?.shipping_details || null;
  const customerDetails = session.customer_details;
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

  if (!customerEmail || !shippingDetails || !shippingAddress || !billingAddress) {
    throw new PaidCheckoutSessionValidationError('fulfillment_details_missing');
  }

  const synchronizedEconomics = validatePaidCheckoutSessionEconomics({
    session,
    paymentIntent,
    candidate,
    checkoutIntent: checkoutIntent as StoredCheckoutIntent,
    shippingRate,
    shippingOption: shippingOption as StoredShippingOption,
  });
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
      currency: session.currency,
      shipping_method_name: shippingOption.display_name,
      shipping_method_id: shippingOption.shipping_method_id,
      shipping_rate_id: shippingOption.shipping_rate_id,
    })
    .eq('id', candidate.id)
    .eq('stripe_checkout_session_id', session.id);

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
