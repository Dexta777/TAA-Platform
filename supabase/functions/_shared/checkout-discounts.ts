export const MERCHANDISE_DISCOUNT_TYPES = new Set(['percentage', 'fixed']);

export type DiscountEvaluation = {
  eligible: boolean;
  reason_code: string;
  discount_code_id: string | null;
  code: string | null;
  name: string | null;
  discount_type: string | null;
  minimum_subtotal_amount: number | null;
  discount_amount: number;
  shipping_discount_amount: number;
  final_shipping_amount: number;
  total_amount: number;
};

type StripeEconomics = {
  amountSubtotal: number | null;
  amountDiscount: number | null;
  shippingAmount: number | null;
  amountTotal: number | null;
  currency?: string | null;
};

type CanonicalEconomics = {
  subtotalAmount: number;
  discountAmount: number;
  shippingAmount: number;
  totalAmount: number;
};

export class CheckoutEconomicsMismatchError extends Error {
  details: Record<string, unknown>;

  constructor(message: string, details: Record<string, unknown>) {
    super(message);
    this.name = 'CheckoutEconomicsMismatchError';
    this.details = details;
  }
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function requireAmount(label: string, value: unknown) {
  if (!isNonNegativeInteger(value)) {
    throw new CheckoutEconomicsMismatchError('Stripe economics are incomplete.', {
      field: label,
      actual: value,
    });
  }

  return value;
}

function verifyAmount(label: string, actual: number, expected: number) {
  if (actual !== expected) {
    throw new CheckoutEconomicsMismatchError('Stripe economics do not match TAA economics.', {
      field: label,
      expected,
      actual,
    });
  }
}

function verifyAmountWhenAvailable(label: string, actual: number | null, expected: number) {
  if (actual === null) return;

  verifyAmount(label, requireAmount(label, actual), expected);
}

export function isMerchandiseDiscount(discountType: string | null) {
  return discountType !== null && MERCHANDISE_DISCOUNT_TYPES.has(discountType);
}

export function getStripeCouponParameters(
  evaluation: DiscountEvaluation,
  checkoutIntentId: string
) {
  if (
    !isMerchandiseDiscount(evaluation.discount_type) ||
    !evaluation.discount_code_id ||
    !evaluation.code ||
    !isNonNegativeInteger(evaluation.discount_amount) ||
    evaluation.discount_amount === 0
  ) {
    throw new Error('Merchandise discount cannot be mapped to a Stripe coupon.');
  }

  return {
    amount_off: evaluation.discount_amount,
    currency: 'gbp' as const,
    duration: 'once' as const,
    name: `TAA ${evaluation.code}`.slice(0, 40),
    metadata: {
      source: 'the_animal_alchemist_webflow',
      checkout_intent_id: checkoutIntentId,
      taa_discount_code_id: evaluation.discount_code_id,
      taa_discount_code: evaluation.code,
    },
  };
}

export function getStripeShippingAmount(originalAmount: number, discountType: string | null) {
  if (!isNonNegativeInteger(originalAmount)) {
    throw new Error('Canonical shipping amount is invalid.');
  }

  return discountType === 'free_shipping' ? 0 : originalAmount;
}

export function mapPublicDiscountError(reasonCode: string) {
  if (['invalid_code', 'inactive', 'not_started', 'expired'].includes(reasonCode)) {
    return 'invalid_code';
  }

  if (reasonCode === 'minimum_subtotal_not_met') return 'minimum_subtotal_not_met';
  if (reasonCode === 'account_required') return 'account_required';
  if (reasonCode === 'identity_unavailable') return 'discount_unavailable';

  return 'not_eligible';
}

export function verifyCreatedDiscountEconomics(
  actual: StripeEconomics,
  expected: CanonicalEconomics
) {
  verifyAmountWhenAvailable('amount_subtotal', actual.amountSubtotal, expected.subtotalAmount);
  verifyAmountWhenAvailable('amount_discount', actual.amountDiscount, expected.discountAmount);
  verifyAmountWhenAvailable('shipping_amount', actual.shippingAmount, expected.shippingAmount);
  verifyAmountWhenAvailable('amount_total', actual.amountTotal, expected.totalAmount);

  if (actual.currency && actual.currency.toLowerCase() !== 'gbp') {
    throw new CheckoutEconomicsMismatchError('Stripe currency does not match TAA currency.', {
      field: 'currency',
      expected: 'gbp',
      actual: actual.currency,
    });
  }
}

export function parseOriginalShippingAmount(value: string | undefined) {
  if (!value || !/^\d+$/.test(value)) {
    throw new CheckoutEconomicsMismatchError(
      'Selected Stripe shipping rate is missing its canonical amount.',
      { field: 'original_shipping_amount' }
    );
  }

  const amount = Number(value);

  if (!isNonNegativeInteger(amount)) {
    throw new CheckoutEconomicsMismatchError(
      'Selected Stripe shipping rate has an invalid canonical amount.',
      { field: 'original_shipping_amount' }
    );
  }

  return amount;
}

export function reconcilePaidDiscountEconomics({
  actual,
  stored,
  originalShippingAmount,
}: {
  actual: StripeEconomics;
  stored: {
    subtotalAmount: number;
    discountAmount: number;
    shippingDiscountAmount: number;
  };
  originalShippingAmount: number;
}) {
  const amountSubtotal = requireAmount('amount_subtotal', actual.amountSubtotal);
  const amountDiscount = requireAmount('amount_discount', actual.amountDiscount);
  const shippingAmount = requireAmount('shipping_amount', actual.shippingAmount);
  const amountTotal = requireAmount('amount_total', actual.amountTotal);

  if (actual.currency?.toLowerCase() !== 'gbp') {
    throw new CheckoutEconomicsMismatchError('Stripe currency does not match TAA currency.', {
      field: 'currency',
      expected: 'gbp',
      actual: actual.currency,
    });
  }

  verifyAmount('amount_subtotal', amountSubtotal, stored.subtotalAmount);

  if (stored.discountAmount > 0) {
    verifyAmount('amount_discount', amountDiscount, stored.discountAmount);
    verifyAmount('shipping_discount_amount', stored.shippingDiscountAmount, 0);
    verifyAmount('shipping_amount', shippingAmount, originalShippingAmount);

    const expectedTotal = stored.subtotalAmount - stored.discountAmount + shippingAmount;
    verifyAmount('amount_total', amountTotal, expectedTotal);

    return {
      subtotalAmount: amountSubtotal,
      shippingAmount,
      shippingDiscountAmount: 0,
      totalAmount: amountTotal,
    };
  }

  verifyAmount('amount_discount', amountDiscount, 0);
  verifyAmount('shipping_amount', shippingAmount, 0);
  verifyAmount('amount_total', amountTotal, stored.subtotalAmount);

  return {
    subtotalAmount: amountSubtotal,
    shippingAmount: 0,
    shippingDiscountAmount: originalShippingAmount,
    totalAmount: amountTotal,
  };
}
