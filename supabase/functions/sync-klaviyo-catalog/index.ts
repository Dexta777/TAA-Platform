import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const supabase = createClient(
  Deno.env.get("SUPABASE_URL") || "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || ""
);

const KLAVIYO_API_KEY = Deno.env.get("KLAVIYO_PRIVATE_API_KEY") || "";
const REVISION = "2025-07-15";

function klaviyoHeaders() {
  return {
    Authorization: `Klaviyo-API-Key ${KLAVIYO_API_KEY}`,
    Accept: "application/vnd.api+json",
    "Content-Type": "application/vnd.api+json",
    revision: REVISION,
  };
}

function catalogId(externalId: string) {
  return `$custom:::$default:::${externalId}`;
}

function getChangedFields(oldRecord: any, newRecord: any) {
  if (!oldRecord || !newRecord) return [];

  return Object.keys(newRecord)
    .filter((key) => JSON.stringify(oldRecord[key]) !== JSON.stringify(newRecord[key]))
    .map((key) => ({
      field: key,
      old_value: oldRecord[key],
      new_value: newRecord[key],
    }));
}

async function writeSyncLog(
  status: string,
  details: any,
  sourceTable?: string | null,
  recordId?: string | null
) {
  const { data, error } = await supabase
    .from("sync_logs")
    .insert({
      sync_type: "klaviyo_catalog",
      source_table: sourceTable || null,
      record_id: recordId || null,
      status,
      details,
    })
    .select("id")
    .single();

  if (error) {
    console.log("SYNC LOG INSERT ERROR:", error);
    return null;
  }

  console.log("SYNC LOG WRITTEN:", data?.id);
  return data?.id || null;
}

async function klaviyoRequest(method: string, path: string, body?: unknown) {
  const response = await fetch(`https://a.klaviyo.com/api${path}`, {
    method,
    headers: klaviyoHeaders(),
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();

  if (!response.ok) {
    return { ok: false, status: response.status, body: text };
  }

  return { ok: true, status: response.status, body: text ? JSON.parse(text) : null };
}

async function upsertCatalogItem(product: any) {
  const externalId = product.sku;
  const id = catalogId(externalId);

  const updatePayload = {
    data: {
      type: "catalog-item",
      id,
      attributes: {
        title: product.name,
        description: product.description || product.name || "",
        url: product.webflow_product_url || "https://www.theanimalalchemist.com",
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
      type: "catalog-item",
      attributes: {
        external_id: externalId,
        integration_type: "$custom",
        catalog_type: "$default",
        title: product.name,
        description: product.description || product.name || "",
        url: product.webflow_product_url || "https://www.theanimalalchemist.com",
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
    "PATCH",
    `/catalog-items/${encodeURIComponent(id)}`,
    updatePayload
  );

  if (!result.ok && result.status === 404) {
    result = await klaviyoRequest("POST", "/catalog-items", createPayload);
  }

  if (!result.ok) {
    throw new Error(`Klaviyo item sync failed for ${product.sku}: ${result.body}`);
  }

  await supabase
    .from("products")
    .update({
      klaviyo_catalog_item_id: id,
      klaviyo_catalog_synced_at: new Date().toISOString(),
    })
    .eq("id", product.id);

  return id;
}

async function upsertCatalogVariant(variant: any, product: any, itemId: string) {
  const externalId = variant.variant_sku;
  const id = catalogId(externalId);

  const updatePayload = {
    data: {
      type: "catalog-variant",
      id,
      attributes: {
        sku: variant.variant_sku,
        title: variant.variant_name,
        description: variant.variant_name || product.name || "",
        url: product.webflow_product_url || "https://www.theanimalalchemist.com",
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
      type: "catalog-variant",
      attributes: {
        external_id: externalId,
        catalog_type: "$default",
        integration_type: "$custom",
        sku: variant.variant_sku,
        title: variant.variant_name,
        description: variant.variant_name || product.name || "",
        url: product.webflow_product_url || "https://www.theanimalalchemist.com",
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
            type: "catalog-item",
            id: itemId,
          },
        },
      },
    },
  };

  let result = await klaviyoRequest(
    "PATCH",
    `/catalog-variants/${encodeURIComponent(id)}`,
    updatePayload
  );

  if (!result.ok && result.status === 404) {
    result = await klaviyoRequest("POST", "/catalog-variants", createPayload);
  }

  if (!result.ok) {
    throw new Error(`Klaviyo variant sync failed for ${variant.variant_sku}: ${result.body}`);
  }

  await supabase
    .from("product_variants")
    .update({
      klaviyo_catalog_variant_id: id,
      klaviyo_catalog_synced_at: new Date().toISOString(),
    })
    .eq("id", variant.id);

  return id;
}

async function syncVariantsForProduct(product: any, itemId: string) {
  const { data: variants, error } = await supabase
    .from("product_variants")
    .select("*")
    .eq("product_id", product.id)
    .eq("active", true)
    .order("sort_order", { ascending: true });

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

serve(async (req) => {
  let payload: any = {};
  let sourceTable = null;
  let recordId = null;

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (!KLAVIYO_API_KEY) {
      throw new Error("Missing KLAVIYO_PRIVATE_API_KEY.");
    }

    payload = await req.json().catch(() => ({}));

    sourceTable = payload.source_table || null;
    recordId = payload.record_id || null;

    const changedFields = getChangedFields(payload.old_record, payload.new_record);

    if (sourceTable === "products" && recordId) {
      const { data: product, error } = await supabase
        .from("products")
        .select("*")
        .eq("id", recordId)
        .single();

      if (error || !product) throw new Error("Product not found.");

      const itemId = await upsertCatalogItem(product);
      const variants = await syncVariantsForProduct(product, itemId);

      const result = {
        ok: true,
        mode: "single_product",
        product: product.sku,
        item_id: itemId,
        variants_count: variants.length,
        variants,
        changed_fields: changedFields,
      };

      await writeSyncLog("success", result, sourceTable, recordId);

      return new Response(JSON.stringify(result, null, 2), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (sourceTable === "product_variants" && recordId) {
      const { data: variant, error: variantError } = await supabase
        .from("product_variants")
        .select("*")
        .eq("id", recordId)
        .single();

      if (variantError || !variant) throw new Error("Variant not found.");

      const { data: product, error: productError } = await supabase
        .from("products")
        .select("*")
        .eq("id", variant.product_id)
        .single();

      if (productError || !product) throw new Error("Parent product not found.");

      const itemId = await upsertCatalogItem(product);
      const variantId = await upsertCatalogVariant(variant, product, itemId);

      const result = {
        ok: true,
        mode: "single_variant",
        product: product.sku,
        item_id: itemId,
        variant: variant.variant_sku,
        variant_id: variantId,
        changed_fields: changedFields,
      };

      await writeSyncLog("success", result, sourceTable, recordId);

      return new Response(JSON.stringify(result, null, 2), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: products, error: productsError } = await supabase
      .from("products")
      .select("*")
      .eq("active", true)
      .order("created_at", { ascending: true });

    if (productsError) throw new Error(productsError.message);

    const synced = [];

    for (const product of products || []) {
      const itemId = await upsertCatalogItem(product);
      const variants = await syncVariantsForProduct(product, itemId);

      synced.push({
        sku: product.sku,
        name: product.name,
        item_id: itemId,
        variants_count: variants.length,
        variants,
      });
    }

    const result = {
      ok: true,
      mode: "full_catalog",
      synced_count: synced.length,
      synced,
      changed_fields: changedFields,
    };

    await writeSyncLog("success", result, sourceTable, recordId);

    return new Response(JSON.stringify(result, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const result = {
      ok: false,
      error: error.message || "Catalog sync failed.",
      source_table: sourceTable,
      record_id: recordId,
      changed_fields: getChangedFields(payload?.old_record, payload?.new_record),
    };

    await writeSyncLog("error", result, sourceTable, recordId);

    return new Response(JSON.stringify(result, null, 2), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});