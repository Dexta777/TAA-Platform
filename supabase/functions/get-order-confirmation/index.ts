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
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { payment_intent_id } = await req.json();

    if (!payment_intent_id) {
      throw new Error("Missing payment intent ID.");
    }

    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select("*")
      .eq("payment_intent_id", payment_intent_id)
      .eq("status", "paid")
      .single();

    if (orderError || !order) {
      throw new Error("Order not found.");
    }

    const { data: items, error: itemsError } = await supabase
      .from("order_items")
      .select("*")
      .eq("order_id", order.id);

    if (itemsError) {
      throw new Error("Order items could not be loaded.");
    }

    return new Response(
      JSON.stringify({
        order: {
          id: order.id,
          order_number: order.order_number,
          customer_email: order.customer_email || order.email,
          status: order.status,
          fulfillment_status: order.fulfillment_status,
          subtotal_amount: order.subtotal_amount,
          shipping_amount: order.shipping_amount,
          total_amount: order.total_amount,
          currency: order.currency,
          shipping_method_name: order.shipping_method_name,
          shipping_name: order.shipping_name,
          shipping_phone: order.shipping_phone,
          shipping_address: order.shipping_address,
          billing_name: order.billing_name,
          billing_address: order.billing_address,
          payment_method_type: order.payment_method_type,
          payment_brand: order.payment_brand,
          payment_last4: order.payment_last4,
          payment_exp_month: order.payment_exp_month,
          payment_exp_year: order.payment_exp_year,
          created_at: order.created_at,
        },
        items: items || []
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
        error: error.message || "Unable to load order confirmation.",
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