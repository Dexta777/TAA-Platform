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

serve(async (req) => {
  console.log("GET SHIPPING OPTIONS HIT");
  console.log("Method:", req.method);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { cart } = await req.json();

    if (!Array.isArray(cart) || cart.length === 0) {
      throw new Error("Basket is empty.");
    }

    let subtotalAmount = 0;
    let totalWeightGrams = 0;

    for (const item of cart) {
      const sku = String(item.sku || "").trim();
      const quantity = Number(item.quantity || 0);

      console.log("incoming sku:", `[${sku}]`);

      if (!sku || quantity < 1) {
        throw new Error("Invalid basket item.");
      }

      let source = null;

      const { data: product, error: productError } = await supabase
        .from("products")
        .select("id, sku, name, price, currency, active, inventory_quantity, weight_grams")
        .eq("sku", sku)
        .eq("active", true)
        .maybeSingle();

      console.log("product lookup:", product);
      console.log("product error:", productError);

      if (productError) {
        throw new Error(`Product lookup failed for ${sku}.`);
      }

      if (product) {
        source = {
          type: "product",
          id: product.id,
          sku: product.sku,
          name: product.name,
          price: product.price,
          currency: product.currency || "GBP",
          inventory_quantity: product.inventory_quantity,
          weight_grams: product.weight_grams || 0,
        };
      } else {
        const { data: variant, error: variantError } = await supabase
          .from("product_variants")
          .select("id, product_id, variant_sku, variant_name, price, currency, active, inventory_quantity, weight_grams")
          .eq("variant_sku", sku)
          .eq("active", true)
          .maybeSingle();

        console.log("variant lookup:", variant);
        console.log("variant error:", variantError);

        if (variantError || !variant) {
          throw new Error(`Product unavailable: ${sku}`);
        }

        source = {
          type: "variant",
          id: variant.id,
          sku: variant.variant_sku,
          name: variant.variant_name,
          price: variant.price,
          currency: variant.currency || "GBP",
          inventory_quantity: variant.inventory_quantity,
          weight_grams: variant.weight_grams || 0,
        };
      }

      if (quantity > Number(source.inventory_quantity || 0)) {
        throw new Error(`Insufficient stock for ${source.sku}.`);
      }

      const unitAmount = Math.round(Number(source.price) * 100);
      const lineTotal = unitAmount * quantity;
      const lineWeight = Number(source.weight_grams || 0) * quantity;

      subtotalAmount += lineTotal;
      totalWeightGrams += lineWeight;
    }

    if (totalWeightGrams <= 0) {
      throw new Error("Basket weight could not be calculated.");
    }

    const { data: methods, error: methodsError } = await supabase
      .from("shipping_methods")
      .select("id, name, description, carrier, sort_order, active")
      .eq("active", true)
      .order("sort_order", { ascending: true });

    if (methodsError || !methods) {
      throw new Error("Shipping methods could not be loaded.");
    }

    const options = [];

    for (const method of methods) {
      const { data: rates, error: ratesError } = await supabase
        .from("shipping_rates")
        .select("id, price, currency, min_weight_grams, max_weight_grams, active")
        .eq("shipping_method_id", method.id)
        .eq("active", true);

      if (ratesError || !rates) continue;

      const matchedRate = rates.find(rate =>
        totalWeightGrams >= Number(rate.min_weight_grams) &&
        totalWeightGrams <= Number(rate.max_weight_grams)
      );

      if (!matchedRate) continue;

      const shippingAmount = Math.round(Number(matchedRate.price) * 100);

      options.push({
        id: method.id,
        name: method.name,
        description: method.description,
        carrier: method.carrier,
        rate_id: matchedRate.id,
        shipping: shippingAmount,
        currency: matchedRate.currency || "GBP",
        total: subtotalAmount + shippingAmount,
      });
    }

    return new Response(
      JSON.stringify({
        subtotal: subtotalAmount,
        total_weight_grams: totalWeightGrams,
        currency: "gbp",
        options,
      }),
      {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (error) {
    console.log("GET SHIPPING OPTIONS ERROR:", error);

    return new Response(
      JSON.stringify({
        error: error.message || "Unable to load shipping options.",
      }),
      {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  }
});