import { getCheckoutProtocolRoute, type CheckoutProtocolRoute } from './checkout-protocol.ts';

export const MAXIMUM_RESERVATION_CANARY_SKUS = 100;
export const MAXIMUM_RESERVATION_CANARY_SKU_LENGTH = 200;
export const INVALID_RESERVATION_CANARY_CONFIGURATION_WARNING =
  'Reservation canary configuration is invalid; canary admission disabled.';

export type ReservationCanaryConfiguration = {
  status: 'disabled' | 'enabled' | 'invalid';
  skus: ReadonlySet<string>;
};

type ExistingAttemptProtocol = {
  attempt_exists: boolean;
  checkout_protocol_version: string | null;
};

type CanonicalItem = {
  sku: string;
};

export function parseReservationCanarySkus(
  value: string | undefined
): ReservationCanaryConfiguration {
  if (!value?.trim()) return { status: 'disabled', skus: new Set() };

  let entries: unknown;

  try {
    entries = JSON.parse(value);
  } catch {
    return { status: 'invalid', skus: new Set() };
  }

  if (!Array.isArray(entries) || entries.length > MAXIMUM_RESERVATION_CANARY_SKUS) {
    return { status: 'invalid', skus: new Set() };
  }

  if (entries.length === 0) return { status: 'disabled', skus: new Set() };

  const skus = new Set<string>();

  for (const entry of entries) {
    if (typeof entry !== 'string') {
      return { status: 'invalid', skus: new Set() };
    }

    const sku = entry.trim();

    if (!sku || sku.length > MAXIMUM_RESERVATION_CANARY_SKU_LENGTH) {
      return { status: 'invalid', skus: new Set() };
    }

    skus.add(sku);
  }

  return { status: 'enabled', skus };
}

export function reportInvalidReservationCanaryConfiguration(
  configuration: ReservationCanaryConfiguration,
  warn: (message: string) => void = console.warn
) {
  if (configuration.status !== 'invalid') return;

  warn(INVALID_RESERVATION_CANARY_CONFIGURATION_WARNING);
}

export function createReservationCanaryConfigurationReader({
  readRawValue,
  parse = parseReservationCanarySkus,
  warn = console.warn,
}: {
  readRawValue: () => string | undefined;
  parse?: (value: string | undefined) => ReservationCanaryConfiguration;
  warn?: (message: string) => void;
}) {
  let cached:
    | {
        rawValue: string | undefined;
        configuration: ReservationCanaryConfiguration;
      }
    | undefined;

  return () => {
    const rawValue = readRawValue();

    if (cached && rawValue === cached.rawValue) return cached.configuration;

    const configuration = parse(rawValue);
    reportInvalidReservationCanaryConfiguration(configuration, warn);
    cached = { rawValue, configuration };

    return configuration;
  };
}

export function hasOnlySubmittedCanarySkus(cart: unknown, canarySkus: ReadonlySet<string>) {
  if (!Array.isArray(cart) || cart.length === 0 || canarySkus.size === 0) return false;

  return cart.every((value) => {
    if (!value || typeof value !== 'object') return false;

    const rawSku = (value as Record<string, unknown>).sku;

    if (typeof rawSku !== 'string') return false;

    const sku = rawSku.trim();

    return (
      Boolean(sku) && sku.length <= MAXIMUM_RESERVATION_CANARY_SKU_LENGTH && canarySkus.has(sku)
    );
  });
}

export function hasOnlyCanonicalCanarySkus(
  canonicalItems: unknown,
  canarySkus: ReadonlySet<string>
) {
  if (!Array.isArray(canonicalItems) || canonicalItems.length === 0 || canarySkus.size === 0) {
    return false;
  }

  return canonicalItems.every((value) => {
    if (!value || typeof value !== 'object') return false;

    const sku = (value as Record<string, unknown>).sku;

    return typeof sku === 'string' && canarySkus.has(sku);
  });
}

export async function qualifiesForReservationCanary({
  cart,
  configuration,
  resolveCanonicalCart,
}: {
  cart: unknown;
  configuration: ReservationCanaryConfiguration;
  resolveCanonicalCart: (cart: unknown[]) => Promise<CanonicalItem[]>;
}) {
  if (configuration.status !== 'enabled' || !hasOnlySubmittedCanarySkus(cart, configuration.skus)) {
    return false;
  }

  const canonicalItems = await resolveCanonicalCart(cart as unknown[]);

  return hasOnlyCanonicalCanarySkus(canonicalItems, configuration.skus);
}

export async function decideCheckoutAdmission({
  operation,
  reservationsEnabled,
  attemptCredentialsSupplied,
  getExistingAttemptProtocol,
  getCanaryConfiguration,
  cart,
  resolveCanonicalCart,
}: {
  operation: string;
  reservationsEnabled: boolean;
  attemptCredentialsSupplied: boolean;
  getExistingAttemptProtocol: () => Promise<ExistingAttemptProtocol | null>;
  getCanaryConfiguration: () => ReservationCanaryConfiguration;
  cart: unknown;
  resolveCanonicalCart: (cart: unknown[]) => Promise<CanonicalItem[]>;
}): Promise<{ route: CheckoutProtocolRoute; attemptExists: boolean }> {
  const initialRoute = getCheckoutProtocolRoute({
    operation,
    reservationsEnabled,
    attemptExists: false,
    existingAttemptProtocol: null,
  });

  if (initialRoute !== 'legacy') {
    return { route: initialRoute, attemptExists: false };
  }

  if (!attemptCredentialsSupplied) {
    return { route: 'legacy', attemptExists: false };
  }

  const protocol = await getExistingAttemptProtocol();
  const attemptExists = Boolean(protocol?.attempt_exists);
  const existingRoute = getCheckoutProtocolRoute({
    operation,
    reservationsEnabled,
    attemptExists,
    existingAttemptProtocol: protocol?.checkout_protocol_version || null,
  });

  if (existingRoute !== 'legacy') {
    return { route: existingRoute, attemptExists };
  }

  const canaryEligible = await qualifiesForReservationCanary({
    cart,
    configuration: getCanaryConfiguration(),
    resolveCanonicalCart,
  });

  return {
    route: canaryEligible ? 'reservation_v1' : 'legacy',
    attemptExists: false,
  };
}
