export const CHECKOUT_INVENTORY_CONFLICT_SQLSTATE = 'TAI01';
export const CHECKOUT_INVENTORY_ERROR = 'inventory_conflict';
export const MAXIMUM_UNAVAILABLE_ITEMS = 100;

const MAXIMUM_SKU_LENGTH = 200;
const INVENTORY_REASONS = new Set(['temporarily_reserved', 'out_of_stock']);

export type CheckoutInventoryReason = 'temporarily_reserved' | 'out_of_stock';

export type CheckoutUnavailableItem = {
  sku: string;
  reason: CheckoutInventoryReason;
};

type CheckoutDatabaseFailure = {
  code?: unknown;
  details?: unknown;
};

function normalizeUnavailableItems(value: unknown): CheckoutUnavailableItem[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAXIMUM_UNAVAILABLE_ITEMS) {
    return null;
  }

  const seenSkus = new Set<string>();
  const unavailableItems: CheckoutUnavailableItem[] = [];

  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;

    const item = entry as Record<string, unknown>;
    const keys = Object.keys(item).sort();

    if (keys.length !== 2 || keys[0] !== 'reason' || keys[1] !== 'sku') return null;
    if (typeof item.sku !== 'string' || item.sku !== item.sku.trim()) return null;
    if (!item.sku || item.sku.length > MAXIMUM_SKU_LENGTH || seenSkus.has(item.sku)) return null;
    if (typeof item.reason !== 'string' || !INVENTORY_REASONS.has(item.reason)) return null;

    seenSkus.add(item.sku);
    unavailableItems.push({
      sku: item.sku,
      reason: item.reason as CheckoutInventoryReason,
    });
  }

  return unavailableItems;
}

export class CheckoutInventoryConflictError extends Error {
  unavailableItems: CheckoutUnavailableItem[];

  constructor(unavailableItems: CheckoutUnavailableItem[]) {
    super('One or more items in your basket are currently unavailable.');
    this.name = 'CheckoutInventoryConflictError';
    this.unavailableItems = unavailableItems.map((item) => ({ ...item }));
  }
}

export function createCheckoutInventoryConflict(value: unknown) {
  const unavailableItems = normalizeUnavailableItems(value);

  return unavailableItems ? new CheckoutInventoryConflictError(unavailableItems) : null;
}

export function parseCheckoutInventoryDatabaseError(error: unknown) {
  if (!error || typeof error !== 'object') return null;

  const databaseError = error as CheckoutDatabaseFailure;

  if (databaseError.code !== CHECKOUT_INVENTORY_CONFLICT_SQLSTATE) return null;
  if (typeof databaseError.details !== 'string') return null;

  let detail: unknown;

  try {
    detail = JSON.parse(databaseError.details);
  } catch {
    return null;
  }

  if (!detail || typeof detail !== 'object' || Array.isArray(detail)) return null;

  return createCheckoutInventoryConflict((detail as Record<string, unknown>).unavailable_items);
}

export async function confirmCheckoutInventoryConflict({
  error,
  cancellationRequired,
  cancelAdmission,
}: {
  error: unknown;
  cancellationRequired: boolean;
  cancelAdmission: () => Promise<boolean>;
}) {
  const conflict =
    error instanceof CheckoutInventoryConflictError
      ? error
      : parseCheckoutInventoryDatabaseError(error);

  if (!conflict) return null;
  if (cancellationRequired && !(await cancelAdmission())) return null;

  return conflict;
}

export function getCheckoutInventoryConflictPayload(conflict: CheckoutInventoryConflictError) {
  return {
    error: conflict.message,
    checkout_inventory_error: CHECKOUT_INVENTORY_ERROR,
    checkout_request_admitted: false,
    retryable: false,
    unavailable_items: conflict.unavailableItems.map((item) => ({ ...item })),
  };
}
