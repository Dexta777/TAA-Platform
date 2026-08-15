import { assertEquals } from 'jsr:@std/assert@1';
import {
  CHECKOUT_INVENTORY_CONFLICT_SQLSTATE,
  CheckoutInventoryConflictError,
  confirmCheckoutInventoryConflict,
  getCheckoutInventoryConflictPayload,
  parseCheckoutInventoryDatabaseError,
} from './checkout-inventory.ts';

const unavailableItems = [
  { sku: 'CANONICAL-A', reason: 'temporarily_reserved' as const },
  { sku: 'CANONICAL-B', reason: 'out_of_stock' as const },
];

Deno.test('exact inventory SQLSTATE parses bounded trusted detail', () => {
  const conflict = parseCheckoutInventoryDatabaseError({
    code: CHECKOUT_INVENTORY_CONFLICT_SQLSTATE,
    details: JSON.stringify({ unavailable_items: unavailableItems }),
  });

  assertEquals(conflict?.unavailableItems, unavailableItems);
  assertEquals(getCheckoutInventoryConflictPayload(conflict!), {
    error: 'One or more items in your basket are currently unavailable.',
    checkout_inventory_error: 'inventory_conflict',
    checkout_request_admitted: false,
    retryable: false,
    unavailable_items: unavailableItems,
  });
});

Deno.test('unknown SQLSTATE and malformed conflict detail remain generic', () => {
  const malformedDetails = [
    'not-json',
    JSON.stringify({ unavailable_items: [] }),
    JSON.stringify({ unavailable_items: [{ sku: 'A', reason: 'unknown' }] }),
    JSON.stringify({
      unavailable_items: [
        { sku: 'A', reason: 'out_of_stock' },
        { sku: 'A', reason: 'out_of_stock' },
      ],
    }),
    JSON.stringify({ unavailable_items: [{ sku: ' RAW ', reason: 'out_of_stock' }] }),
  ];

  assertEquals(
    parseCheckoutInventoryDatabaseError({
      code: 'P0001',
      details: JSON.stringify({ unavailable_items: unavailableItems }),
    }),
    null
  );

  malformedDetails.forEach((details) => {
    assertEquals(
      parseCheckoutInventoryDatabaseError({
        code: CHECKOUT_INVENTORY_CONFLICT_SQLSTATE,
        details,
      }),
      null
    );
  });
});

Deno.test('clean 409 is available only after strict admission cancellation succeeds', async () => {
  const conflictError = new CheckoutInventoryConflictError(unavailableItems);
  const calls: string[] = [];
  const confirmed = await confirmCheckoutInventoryConflict({
    error: conflictError,
    cancellationRequired: true,
    cancelAdmission: async () => {
      calls.push('cancel-admission');
      return true;
    },
  });

  assertEquals(calls, ['cancel-admission']);
  assertEquals(confirmed?.unavailableItems, unavailableItems);

  const unconfirmed = await confirmCheckoutInventoryConflict({
    error: conflictError,
    cancellationRequired: true,
    cancelAdmission: async () => false,
  });

  assertEquals(unconfirmed, null);
});

Deno.test(
  'physical pre-admission conflict does not require an admission cancellation',
  async () => {
    let cancellationCalled = false;
    const confirmed = await confirmCheckoutInventoryConflict({
      error: new CheckoutInventoryConflictError(unavailableItems),
      cancellationRequired: false,
      cancelAdmission: async () => {
        cancellationCalled = true;
        return false;
      },
    });

    assertEquals(cancellationCalled, false);
    assertEquals(confirmed?.unavailableItems, unavailableItems);
  }
);
