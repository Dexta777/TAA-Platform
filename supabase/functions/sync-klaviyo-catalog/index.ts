import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.112.2';
import { HttpSecurityError } from '../_shared/http-security.ts';
import { readKlaviyoCatalogSyncRequest } from '../_shared/klaviyo-catalog-security.ts';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') || '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
);

const KLAVIYO_API_KEY = Deno.env.get('KLAVIYO_PRIVATE_API_KEY') || '';
const REVISION = '2025-07-15';

function klaviyoHeaders() {
  return {
    Authorization: `Klaviyo-API-Key ${KLAVIYO_API_KEY}`,
    Accept: 'application/vnd.api+json',
    'Content-Type': 'application/vnd.api+json',
    revision: REVISION,
  };
}

function catalogId(externalId: string) {
  return `$custom:::$default:::${externalId}`;
}

async function writeSyncLog(
  status: string,
  details: any,
  sourceTable?: string | null,
  recordId?: string | null
) {
  const { data, error } = await supabase
    .from('sync_logs')
    .insert({
      sync_type: 'klaviyo_catalog',
      source_table: sourceTable || null,
      record_id: recordId || null,
      status,
      details,
    })
    .select('id')
    .single();

  if (error) {
    console.error('SYNC LOG INSERT ERROR:', { error_code: error.code || 'unknown' });
    return null;
  }

  return data?.id || null;
}

async function klaviyoRequest(method: string, path: string, body?: unknown) {
  const response = await fetch(`https://a.klaviyo.com/api${path}`, {
    method,
    headers: klaviyoHeaders(),
    body: body ? JSON.stringify(body) : undefined,
  });

  await response.body?.cancel();
  return { ok: response.ok, status: response.status };
}

async function upsertCatalogItem(product: any) {
  const externalId = product.sku;
  const id = catalogId(externalId);

  const updatePayload = {
    data: {
      type: 'catalog-item',
      id,
      attributes: {
        title: product.name,
        description: product.description || product.name || '',
        url: product.webflow_product_url || 'https://www.theanimalalchemist.com',
        image_full_url: product.image_url || null,
        image_thumbnail_url: product.image_url || null,
        images: product.image_url ? [product.image_url] : [],
        price: Number(product.price || 0),
        published: Boolean(product.active),
        custom_metadata: {
          external_id: externalId,
          sku: product.sku,
          category: product.category || null,
          default_amount: product.default_amount || null,
          inventory_quantity: product.inventory_quantity ?? null,
          weight_grams: product.weight_grams ?? null,
        },
      },
    },
  };

  const createPayload = {
    data: {
      type: 'catalog-item',
      attributes: {
        external_id: externalId,
        integration_type: '$custom',
        catalog_type: '$default',
        title: product.name,
        description: product.description || product.name || '',
        url: product.webflow_product_url || 'https://www.theanimalalchemist.com',
        image_full_url: product.image_url || null,
        image_thumbnail_url: product.image_url || null,
        images: product.image_url ? [product.image_url] : [],
        price: Number(product.price || 0),
        published: Boolean(product.active),
        custom_metadata: {
          sku: product.sku,
          category: product.category || null,
          default_amount: product.default_amount || null,
          inventory_quantity: product.inventory_quantity ?? null,
          weight_grams: product.weight_grams ?? null,
        },
      },
    },
  };

  let result = await klaviyoRequest(
    'PATCH',
    `/catalog-items/${encodeURIComponent(id)}`,
    updatePayload
  );

  if (!result.ok && result.status === 404) {
    result = await klaviyoRequest('POST', '/catalog-items', createPayload);
  }

  if (!result.ok) {
    throw new Error(`Klaviyo item sync failed with status ${result.status}.`);
  }

  await supabase
    .from('products')
    .update({
      klaviyo_catalog_item_id: id,
      klaviyo_catalog_synced_at: new Date().toISOString(),
    })
    .eq('id', product.id);

  return id;
}

async function upsertCatalogVariant(variant: any, product: any, itemId: string) {
  const externalId = variant.variant_sku;
  const id = catalogId(externalId);

  const updatePayload = {
    data: {
      type: 'catalog-variant',
      id,
      attributes: {
        sku: variant.variant_sku,
        title: variant.variant_name,
        description: variant.variant_name || product.name || '',
        url: product.webflow_product_url || 'https://www.theanimalalchemist.com',
        image_full_url: product.image_url || null,
        image_thumbnail_url: product.image_url || null,
        images: product.image_url ? [product.image_url] : [],
        price: Number(variant.price || product.price || 0),
        inventory_quantity: Number(variant.inventory_quantity || 0),
        inventory_policy: 0,
        published: Boolean(variant.active),
        custom_metadata: {
          external_id: externalId,
          parent_sku: product.sku,
          amount: variant.variant_name || null,
          weight_grams: variant.weight_grams || null,
          sort_order: variant.sort_order || null,
        },
      },
    },
  };

  const createPayload = {
    data: {
      type: 'catalog-variant',
      attributes: {
        external_id: externalId,
        catalog_type: '$default',
        integration_type: '$custom',
        sku: variant.variant_sku,
        title: variant.variant_name,
        description: variant.variant_name || product.name || '',
        url: product.webflow_product_url || 'https://www.theanimalalchemist.com',
        image_full_url: product.image_url || null,
        image_thumbnail_url: product.image_url || null,
        images: product.image_url ? [product.image_url] : [],
        price: Number(variant.price || product.price || 0),
        inventory_quantity: Number(variant.inventory_quantity || 0),
        inventory_policy: 0,
        published: Boolean(variant.active),
        custom_metadata: {
          parent_sku: product.sku,
          amount: variant.variant_name || null,
          weight_grams: variant.weight_grams || null,
          sort_order: variant.sort_order || null,
        },
      },
      relationships: {
        item: {
          data: {
            type: 'catalog-item',
            id: itemId,
          },
        },
      },
    },
  };

  let result = await klaviyoRequest(
    'PATCH',
    `/catalog-variants/${encodeURIComponent(id)}`,
    updatePayload
  );

  if (!result.ok && result.status === 404) {
    result = await klaviyoRequest('POST', '/catalog-variants', createPayload);
  }

  if (!result.ok) {
    throw new Error(`Klaviyo variant sync failed with status ${result.status}.`);
  }

  await supabase
    .from('product_variants')
    .update({
      klaviyo_catalog_variant_id: id,
      klaviyo_catalog_synced_at: new Date().toISOString(),
    })
    .eq('id', variant.id);

  return id;
}

async function syncVariantsForProduct(product: any, itemId: string) {
  const { data: variants, error } = await supabase
    .from('product_variants')
    .select('*')
    .eq('product_id', product.id)
    .eq('active', true)
    .order('sort_order', { ascending: true });

  if (error) throw new Error(error.message);

  const syncedVariants = [];

  for (const variant of variants || []) {
    const variantId = await upsertCatalogVariant(variant, product, itemId);

    syncedVariants.push({
      sku: variant.variant_sku,
      name: variant.variant_name,
      variant_id: variantId,
    });
  }

  return syncedVariants;
}

serve(async (request) => {
  let sourceTable: string | null = null;
  let recordId: string | null = null;

  const internalSecret = Deno.env.get('TAA_KLAVIYO_CATALOG_SYNC_SECRET')?.trim() || '';

  try {
    const payload = await readKlaviyoCatalogSyncRequest(request, internalSecret);

    if (!KLAVIYO_API_KEY) throw new Error('Klaviyo catalogue configuration is unavailable.');
    sourceTable = payload.sourceTable;
    recordId = payload.recordId;

    if (sourceTable === 'products') {
      const { data: product, error } = await supabase
        .from('products')
        .select('*')
        .eq('id', recordId)
        .single();

      if (error || !product) throw new Error('Catalog record is unavailable.');

      const itemId = await upsertCatalogItem(product);
      const variants = await syncVariantsForProduct(product, itemId);
      const details = { mode: 'single_product', variants_count: variants.length };

      await writeSyncLog('success', details, sourceTable, recordId);
      return Response.json({ ok: true, ...details });
    }

    const { data: variant, error: variantError } = await supabase
      .from('product_variants')
      .select('*')
      .eq('id', recordId)
      .single();

    if (variantError || !variant) throw new Error('Catalog record is unavailable.');

    const { data: product, error: productError } = await supabase
      .from('products')
      .select('*')
      .eq('id', variant.product_id)
      .single();

    if (productError || !product) throw new Error('Catalog parent record is unavailable.');

    const itemId = await upsertCatalogItem(product);
    await upsertCatalogVariant(variant, product, itemId);
    const details = { mode: 'single_variant' };

    await writeSyncLog('success', details, sourceTable, recordId);
    return Response.json({ ok: true, ...details });
  } catch (error) {
    if (error instanceof HttpSecurityError) {
      return Response.json({ ok: false, error: error.message }, { status: error.status });
    }

    await writeSyncLog(
      'error',
      { error_type: error instanceof Error ? error.name : 'unknown' },
      sourceTable,
      recordId
    );

    return Response.json(
      { ok: false, error: 'Catalog sync could not be completed.' },
      { status: 502 }
    );
  }
});
