import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import Stripe from "npm:stripe@16.6.0";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
  apiVersion: "2024-06-20",
});

const supabase = createClient(
  Deno.env.get("SUPABASE_URL") || "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || ""
);

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const {
      cart,
      customer_email,
      shipping_method_name,
      shipping_name,
      shipping_phone,
      shipping_address,
      billing_name,
      billing_address,
      billing_is_different,
    } = await req.json();

    if (!Array.isArray(cart) || cart.length === 0) {
      throw new Error("Basket is empty.");
    }

    if (!shipping_method_name) {
      throw new Error("Please select a shipping method.");
    }

    let subtotalAmount = 0;
    let totalWeightGrams = 0;
    const validatedItems = [];

    for (const item of cart) {
      const sku = String(item.sku || "").trim();
      const quantity = Number(item.quantity || 0);

      if (!sku || quantity < 1) {
        throw new Error("Invalid basket item.");
      }

      let source = null;

      const { data: product } = await supabase
        .from("products")
        .select("id, sku, name, price, currency, active, inventory_quantity, weight_grams, image_url")
        .eq("sku", sku)
        .eq("active", true)
        .maybeSingle();

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
          image_url: product.image_url || null,
        };
      } else {
        const { data: variant, error: variantError } = await supabase
          .from("product_variants")
          .select("id, product_id, variant_sku, variant_name, price, currency, active, inventory_quantity, weight_grams")
          .eq("variant_sku", sku)
          .eq("active", true)
          .maybeSingle();

        console.log("incoming sku:", `[${sku}]`);
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
          image_url: null,
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

      validatedItems.push({
        product_type: source.type,
        product_id: source.id,
        sku: source.sku,
        name: source.name,
        quantity,
        unit_amount: unitAmount,
        line_total: lineTotal,
        weight_grams: lineWeight,
        image_url: source.image_url || null,
        amount: item.amount || null,
      });
    }

    if (totalWeightGrams <= 0) {
      throw new Error("Basket weight could not be calculated.");
    }

    const cleanShippingMethodName = String(shipping_method_name).trim().toLowerCase();

    const { data: shippingMethods } = await supabase
      .from("shipping_methods")
      .select("id, name, description, carrier, active")
      .eq("active", true);

    const shippingMethod = (shippingMethods || []).find(method =>
      String(method.name || "").trim().toLowerCase() === cleanShippingMethodName
    );

    if (!shippingMethod) {
      throw new Error("Selected shipping method is unavailable.");
    }

    const { data: shippingRates } = await supabase
      .from("shipping_rates")
      .select("id, price, currency, min_weight_grams, max_weight_grams, active")
      .eq("shipping_method_id", shippingMethod.id)
      .eq("active", true);

    const shippingRate = (shippingRates || []).find(rate =>
      totalWeightGrams >= Number(rate.min_weight_grams) &&
      totalWeightGrams <= Number(rate.max_weight_grams)
    );

    if (!shippingRate) {
      throw new Error("No shipping rate available for this basket weight.");
    }

    const shippingAmount = Math.round(Number(shippingRate.price) * 100);
    const totalAmount = subtotalAmount + shippingAmount;

    const safeShippingAddress = shipping_address || null;
    const safeBillingAddress = billing_address || safeShippingAddress || null;
    const safeShippingName = shipping_name || null;
    const safeBillingName = billing_name || safeShippingName || null;

    const paymentIntent = await stripe.paymentIntents.create({
      amount: totalAmount,
      currency: "gbp",
      receipt_email: customer_email || undefined,
      shipping: safeShippingAddress
        ? {
            name: safeShippingName || "Customer",
            phone: shipping_phone || undefined,
            address: {
              line1: safeShippingAddress.address_1 || "",
              line2: safeShippingAddress.address_2 || undefined,
              city: safeShippingAddress.city || "",
              state: safeShippingAddress.county || undefined,
              postal_code: safeShippingAddress.postcode || "",
              country: "GB",
            },
          }
        : undefined,
      automatic_payment_methods: {
        enabled: true,
      },
      metadata: {
        source: "the_animal_alchemist_webflow",
        item_count: String(validatedItems.length),
        subtotal_amount: String(subtotalAmount),
        shipping_amount: String(shippingAmount),
        total_amount: String(totalAmount),
        total_weight_grams: String(totalWeightGrams),
        shipping_method: shippingMethod.name,
      },
    });

    const { data: checkoutIntent, error: checkoutError } = await supabase
      .from("checkout_intents")
      .insert({
        payment_intent_id: paymentIntent.id,
        status: "pending",
        customer_email: customer_email || null,
        shipping_name: safeShippingName,
        shipping_phone: shipping_phone || null,
        shipping_address: safeShippingAddress,
        billing_name: safeBillingName,
        billing_address: safeBillingAddress,
        billing_is_different: Boolean(billing_is_different),
        subtotal_amount: subtotalAmount,
        shipping_amount: shippingAmount,
        total_amount: totalAmount,
        currency: "gbp",
        shipping_method_name: shippingMethod.name,
        shipping_method_id: shippingMethod.id,
        shipping_rate_id: shippingRate.id,
        total_weight_grams: totalWeightGrams,
      })
      .select("id")
      .single();

    if (checkoutError || !checkoutIntent) {
      throw new Error("Could not create checkout intent.");
    }

    const checkoutItems = validatedItems.map(item => ({
      checkout_intent_id: checkoutIntent.id,
      product_type: item.product_type,
      product_id: item.product_id,
      sku: item.sku,
      name: item.name,
      quantity: item.quantity,
      unit_amount: item.unit_amount,
      line_total: item.line_total,
      weight_grams: item.weight_grams,
      image_url: item.image_url || null,
      amount: item.amount || null,
    }));

    const { error: checkoutItemsError } = await supabase
      .from("checkout_intent_items")
      .insert(checkoutItems);

    if (checkoutItemsError) {
      throw new Error("Could not create checkout items.");
    }

    return new Response(
      JSON.stringify({
        client_secret: paymentIntent.client_secret,
        payment_intent_id: paymentIntent.id,
        checkout_intent_id: checkoutIntent.id,
        subtotal: subtotalAmount,
        shipping: shippingAmount,
        amount: totalAmount,
        currency: "gbp",
        total_weight_grams: totalWeightGrams,
        shipping_method: {
          id: shippingMethod.id,
          name: shippingMethod.name,
          description: shippingMethod.description,
          carrier: shippingMethod.carrier,
          rate_id: shippingRate.id,
          price: shippingRate.price,
        },
        items: validatedItems,
      }),
      {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: error.message || "Unable to create payment intent.",
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