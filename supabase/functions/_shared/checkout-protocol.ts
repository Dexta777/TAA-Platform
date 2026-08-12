import type Stripe from 'npm:stripe@22.4.0';
import { cleanCheckoutAddress } from './checkout-access.ts';
import { CheckoutInputError, cleanText } from './checkout-catalog.ts';
import { getStripeShippingAmount } from './checkout-discounts.ts';

export const CHECKOUT_PROTOCOL_VERSION = 'reservation_v1';
export const CHECKOUT_PROTOCOL_SOURCE = 'the_animal_alchemist_webflow';
export const CHECKOUT_WORKER_LEASE_RETRY_SECONDS = 3;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type NormalizedCommand = {
  version: 'v1';
  checkout_attempt_id: string;
  checkout_request_id: string;
  cart: Array<{ sku: string; quantity: number }>;
  shipping_method_name: string;
  discount_code: string | null;
  replaces_checkout_intent_id: string | null;
  shipping_name: string | null;
  shipping_phone: string | null;
  shipping_address: Record<string, string>;
  billing_name: string | null;
  billing_address: Record<string, string>;
  billing_is_different: boolean;
  create_account_requested: boolean;
};

export type PersistedCheckoutSnapshot = {
  id: string;
  checkout_attempt_id: string;
  checkout_request_id: string;
  replaces_checkout_intent_id: string | null;
  checkout_protocol_version: string;
  orchestration_state: string;
  customer_email: string | null;
  stripe_checkout_session_id: string | null;
  stripe_customer_id: string | null;
  stripe_coupon_id: string | null;
  stripe_return_url: string;
  stripe_session_expires_at: string;
  subtotal_amount: number;
  shipping_amount: number;
  total_amount: number;
  currency: string;
  total_weight_grams: number;
  discount_code_id: string | null;
  discount_code: string | null;
  discount_name: string | null;
  discount_type: string | null;
  discount_amount: number;
  shipping_discount_amount: number;
  confirmation_generation: number;
  items: Array<{
    line_position: number;
    product_type: string;
    product_id: string;
    base_product_id: string | null;
    sku: string;
    name: string;
    product_name: string | null;
    variant_name: string | null;
    quantity: number;
    unit_amount: number;
    line_total: number;
    weight_grams: number;
    image_url: string | null;
    amount: string | null;
  }>;
  shipping_options: Array<{
    position: number;
    shipping_method_id: string;
    shipping_rate_id: string;
    display_name: string;
    description: string | null;
    carrier: string | null;
    amount: number;
    original_amount: number;
    currency: string;
    stripe_shipping_rate_id: string | null;
  }>;
};

export function isCheckoutReservationsEnabled(value: string | undefined) {
  return value?.trim().toLowerCase() === 'true';
}

export type StripeFailureKind =
  | 'transport_ambiguous'
  | 'server_indeterminate'
  | 'external_state_indeterminate'
  | 'retryable'
  | 'definitive';

export type StripeFailureAction = 'retry_same_request' | 'reconciliation_required' | 'fail_request';

export function classifyStripeFailure(error: unknown): StripeFailureKind {
  if (!error || typeof error !== 'object') return 'definitive';

  const stripeError = error as { type?: string; statusCode?: number };

  if (stripeError.type === 'StripeConnectionError') return 'transport_ambiguous';
  if (stripeError.type === 'StripeIdempotencyError') return 'external_state_indeterminate';
  if (stripeError.type === 'StripeRateLimitError') return 'retryable';
  if (stripeError.type === 'StripeAPIError' || Number(stripeError.statusCode) >= 500) {
    return 'server_indeterminate';
  }

  return 'definitive';
}

export function getStripeFailureAction(failureKind: StripeFailureKind): StripeFailureAction {
  if (failureKind === 'transport_ambiguous' || failureKind === 'retryable') {
    return 'retry_same_request';
  }

  if (failureKind === 'server_indeterminate' || failureKind === 'external_state_indeterminate') {
    return 'reconciliation_required';
  }

  return 'fail_request';
}

export function isStripeSessionSafelyExpired(session: {
  status?: string | null;
  payment_status?: string | null;
}) {
  return session.status === 'expired' && session.payment_status === 'unpaid';
}

export function isStripeSessionUsable(session: {
  status?: string | null;
  payment_status?: string | null;
}) {
  return session.status === 'open' && session.payment_status === 'unpaid';
}

export type StripeSessionActivationDisposition =
  'payable' | 'safely_expired' | 'external_state_indeterminate';

export function getStripeSessionActivationDisposition(session: {
  status?: string | null;
  payment_status?: string | null;
  client_secret?: string | null;
}): StripeSessionActivationDisposition {
  if (
    session.status === 'open' &&
    session.payment_status === 'unpaid' &&
    Boolean(session.client_secret)
  ) {
    return 'payable';
  }

  if (isStripeSessionSafelyExpired(session)) return 'safely_expired';

  return 'external_state_indeterminate';
}

export type StripeSessionActivationAction =
  'activate' | 'terminalize_before_handoff' | 'reconciliation_required';

export function getStripeSessionActivationAction(
  session: {
    status?: string | null;
    payment_status?: string | null;
    client_secret?: string | null;
  },
  replacementHandoffCompleted = false
): StripeSessionActivationAction {
  const disposition = getStripeSessionActivationDisposition(session);

  if (disposition === 'payable') return 'activate';
  if (disposition === 'safely_expired' && !replacementHandoffCompleted) {
    return 'terminalize_before_handoff';
  }

  return 'reconciliation_required';
}

export function getStripeSessionResumeMode(snapshot: {
  orchestration_state: string;
  stripe_checkout_session_id: string | null;
}) {
  if (snapshot.orchestration_state === 'active') return 'retrieve_active' as const;
  if (snapshot.orchestration_state === 'superseded') return 'terminal' as const;
  if (snapshot.stripe_checkout_session_id) return 'retrieve_recorded' as const;

  return 'create_idempotently' as const;
}

export function normalizeUuid(value: unknown, label: string) {
  const normalized = cleanText(value, 36).toLowerCase();

  if (!UUID_PATTERN.test(normalized)) {
    throw new CheckoutInputError(`${label} is invalid.`);
  }

  return normalized;
}

export function normalizeProtocolCart(value: unknown) {
  const cart = Array.isArray(value) ? value : [];

  if (cart.length === 0) throw new CheckoutInputError('Basket is empty.');
  if (cart.length > 100) throw new CheckoutInputError('Basket contains too many items.');

  const quantitiesBySku = new Map<string, number>();

  for (const rawItem of cart) {
    if (!rawItem || typeof rawItem !== 'object') {
      throw new CheckoutInputError('Invalid basket item.');
    }

    const item = rawItem as Record<string, unknown>;
    const sku = cleanText(item.sku, 200);
    const quantity = Number(item.quantity);

    if (!sku || !Number.isSafeInteger(quantity) || quantity < 1) {
      throw new CheckoutInputError('Invalid basket item.');
    }

    const aggregate = (quantitiesBySku.get(sku) || 0) + quantity;

    if (!Number.isSafeInteger(aggregate)) {
      throw new CheckoutInputError('Invalid basket quantity.');
    }

    quantitiesBySku.set(sku, aggregate);
  }

  return Array.from(quantitiesBySku, ([sku, quantity]) => ({ sku, quantity })).sort(
    (left, right) => (left.sku < right.sku ? -1 : left.sku > right.sku ? 1 : 0)
  );
}

export function normalizeCheckoutCommand(
  payload: Record<string, unknown>,
  replacementCheckoutIntentId: string | null
): NormalizedCommand {
  const shippingAddress = cleanCheckoutAddress(payload.shipping_address, {
    requireComplete: false,
  });
  const billingIsDifferent = Boolean(payload.billing_is_different);
  const billingAddress = cleanCheckoutAddress(
    billingIsDifferent ? payload.billing_address : payload.shipping_address,
    { label: 'billing', requireComplete: false }
  );
  const shippingName = cleanText(payload.shipping_name, 200) || null;

  return {
    version: 'v1',
    checkout_attempt_id: normalizeUuid(payload.checkout_attempt_id, 'Checkout attempt ID'),
    checkout_request_id: normalizeUuid(payload.checkout_request_id, 'Checkout request ID'),
    cart: normalizeProtocolCart(payload.cart),
    shipping_method_name: cleanText(payload.shipping_method_name, 200).toLowerCase(),
    discount_code: cleanText(payload.discount_code, 200).toUpperCase() || null,
    replaces_checkout_intent_id: replacementCheckoutIntentId
      ? normalizeUuid(replacementCheckoutIntentId, 'Replacement checkout intent ID')
      : null,
    shipping_name: shippingName,
    shipping_phone: cleanText(payload.shipping_phone, 50) || null,
    shipping_address: shippingAddress,
    billing_name: cleanText(payload.billing_name, 200) || shippingName,
    billing_address: billingAddress,
    billing_is_different: billingIsDifferent,
    create_account_requested: Boolean(payload.create_account_requested),
  };
}

export function deterministicStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);

  if (Array.isArray(value)) {
    return `[${value.map((item) => deterministicStringify(item)).join(',')}]`;
  }

  const object = value as Record<string, unknown>;
  const properties = Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${deterministicStringify(object[key])}`);

  return `{${properties.join(',')}}`;
}

export async function sha256Deterministic(value: unknown, prefix = '') {
  const bytes = new TextEncoder().encode(`${prefix}${deterministicStringify(value)}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);

  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function fingerprintCheckoutCommand(command: NormalizedCommand) {
  return sha256Deterministic(command, 'taa-checkout-command:v1\n');
}

export function getStripeIdempotencyKeys(attemptId: string, requestId: string) {
  const prefix = `taa-checkout:${attemptId}:${requestId}`;

  return {
    coupon: `${prefix}:coupon`,
    session: `${prefix}:session`,
    expirePrevious: `${prefix}:expire-previous`,
    expireNew: `${prefix}:expire-new`,
  };
}

function getProtocolMetadata(snapshot: PersistedCheckoutSnapshot) {
  return {
    source: CHECKOUT_PROTOCOL_SOURCE,
    protocol_version: CHECKOUT_PROTOCOL_VERSION,
    checkout_attempt_id: snapshot.checkout_attempt_id,
    checkout_request_id: snapshot.checkout_request_id,
    checkout_intent_id: snapshot.id,
  };
}

export function buildStripeCouponParametersV1(
  snapshot: PersistedCheckoutSnapshot
): Stripe.CouponCreateParams | null {
  if (!['percentage', 'fixed'].includes(snapshot.discount_type || '')) return null;

  if (
    !snapshot.discount_code_id ||
    !snapshot.discount_code ||
    !Number.isSafeInteger(snapshot.discount_amount) ||
    snapshot.discount_amount <= 0
  ) {
    throw new Error('Persisted merchandise discount snapshot is incomplete.');
  }

  return {
    amount_off: snapshot.discount_amount,
    currency: 'gbp',
    duration: 'once',
    name: `TAA ${snapshot.discount_code}`.slice(0, 40),
    metadata: {
      ...getProtocolMetadata(snapshot),
      taa_discount_code_id: snapshot.discount_code_id,
      taa_discount_code: snapshot.discount_code,
    },
  };
}

export function buildStripeSessionParametersV1(
  snapshot: PersistedCheckoutSnapshot
): Stripe.Checkout.SessionCreateParams {
  if (snapshot.checkout_protocol_version !== CHECKOUT_PROTOCOL_VERSION) {
    throw new Error('Unsupported checkout protocol snapshot.');
  }

  const metadata = getProtocolMetadata(snapshot);

  return {
    ui_mode: 'elements',
    mode: 'payment',
    phone_number_collection: { enabled: true },
    return_url: snapshot.stripe_return_url,
    expires_at: Math.floor(new Date(snapshot.stripe_session_expires_at).getTime() / 1000),
    line_items: snapshot.items.map((item) => ({
      quantity: item.quantity,
      price_data: {
        currency: snapshot.currency,
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
            base_product_id: item.base_product_id || '',
          },
        },
      },
    })),
    shipping_options: snapshot.shipping_options.map((option) => ({
      shipping_rate_data: {
        type: 'fixed_amount',
        display_name: option.display_name,
        fixed_amount: {
          amount: getStripeShippingAmount(option.original_amount, snapshot.discount_type),
          currency: option.currency,
        },
        metadata: {
          original_shipping_amount: String(option.original_amount),
          shipping_method_id: option.shipping_method_id,
          shipping_rate_id: option.shipping_rate_id,
          shipping_method_name: option.display_name,
        },
      },
    })),
    ...(snapshot.stripe_coupon_id ? { discounts: [{ coupon: snapshot.stripe_coupon_id }] } : {}),
    ...(snapshot.stripe_customer_id
      ? { customer: snapshot.stripe_customer_id }
      : { customer_creation: 'always' as const }),
    client_reference_id: snapshot.id,
    metadata,
    payment_intent_data: { metadata },
  };
}

export function buildCheckoutResponse(
  snapshot: PersistedCheckoutSnapshot,
  session: Stripe.Checkout.Session,
  confirmationToken: string,
  confirmationGeneration: number,
  lockedCustomerEmail: string | null
) {
  if (!session.client_secret) throw new Error('Stripe did not return a Checkout client secret.');

  return {
    client_secret: session.client_secret,
    checkout_session_id: session.id,
    checkout_intent_id: snapshot.id,
    checkout_attempt_id: snapshot.checkout_attempt_id,
    checkout_request_id: snapshot.checkout_request_id,
    confirmation_token: confirmationToken,
    confirmation_generation: confirmationGeneration,
    locked_customer_email: lockedCustomerEmail,
    subtotal: snapshot.subtotal_amount,
    shipping: snapshot.shipping_amount,
    total: snapshot.total_amount,
    currency: snapshot.currency,
    total_weight_grams: snapshot.total_weight_grams,
    shipping_options: snapshot.shipping_options.map((option) => ({
      id: option.shipping_method_id,
      name: option.display_name,
      description: option.description,
      carrier: option.carrier,
      rate_id: option.shipping_rate_id,
      shipping: option.amount,
      currency: option.currency,
      ...(snapshot.discount_type === 'free_shipping'
        ? { original_shipping: option.original_amount }
        : {}),
      stripe_shipping_rate_id: option.stripe_shipping_rate_id,
    })),
    items: snapshot.items.map(({ line_position: _linePosition, ...item }) => item),
    ...(snapshot.discount_code
      ? {
          discount: {
            code: snapshot.discount_code,
            name: snapshot.discount_name,
            type: snapshot.discount_type,
            discount_amount: snapshot.discount_amount,
            shipping_discount_amount: snapshot.shipping_discount_amount,
          },
        }
      : {}),
  };
}
