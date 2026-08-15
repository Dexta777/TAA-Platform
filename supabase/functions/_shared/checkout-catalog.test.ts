import { assertEquals, assertRejects } from 'jsr:@std/assert@1';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.112.2';
import { resolveCanonicalCart } from './checkout-catalog.ts';
import { CheckoutInventoryConflictError } from './checkout-inventory.ts';

type Row = Record<string, unknown>;

function createCatalogueClient(tables: Record<string, Row[]>) {
  return {
    from(table: string) {
      const filters = new Map<string, unknown>();

      const query = {
        select() {
          return query;
        },
        eq(column: string, value: unknown) {
          filters.set(column, value);
          return query;
        },
        async maybeSingle() {
          const row = (tables[table] || []).find((candidate) =>
            Array.from(filters).every(([column, value]) => candidate[column] === value)
          );

          return { data: row || null, error: null };
        },
      };

      return query;
    },
  } as unknown as SupabaseClient;
}

function product(sku: string, inventoryQuantity: number): Row {
  return {
    id: `product-${sku}`,
    sku,
    name: `Product ${sku}`,
    price: 10,
    currency: 'GBP',
    active: true,
    inventory_quantity: inventoryQuantity,
    weight_grams: 100,
    image_url: null,
    default_amount: null,
  };
}

Deno.test(
  'catalogue resolution returns every physical conflict in canonical cart order',
  async () => {
    const client = createCatalogueClient({
      products: [product('AVAILABLE', 5), product('OUT-A', 0), product('OUT-B', 1)],
    });
    let conflict: CheckoutInventoryConflictError | null = null;

    try {
      await resolveCanonicalCart(client, [
        { sku: 'AVAILABLE', quantity: 1 },
        { sku: 'OUT-A', quantity: 1 },
        { sku: 'OUT-B', quantity: 2 },
      ]);
    } catch (error) {
      if (error instanceof CheckoutInventoryConflictError) conflict = error;
    }

    assertEquals(conflict?.unavailableItems, [
      { sku: 'OUT-A', reason: 'out_of_stock' },
      { sku: 'OUT-B', reason: 'out_of_stock' },
    ]);
  }
);

Deno.test('unknown SKU retains the existing catalogue validation failure', async () => {
  const client = createCatalogueClient({ products: [], product_variants: [] });

  await assertRejects(
    () => resolveCanonicalCart(client, [{ sku: 'UNKNOWN', quantity: 1 }]),
    Error,
    'Product unavailable: UNKNOWN'
  );
});
