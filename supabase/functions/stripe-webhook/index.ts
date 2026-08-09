import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import Stripe from "npm:stripe@16.6.0";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
  apiVersion: "2024-06-20",
});

const supabase = createClient(
  Deno.env.get("SUPABASE_URL") || "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || ""
);

async function sendKlaviyoPlacedOrder(order: any, items: any[]) {
  const apiKey = Deno.env.get("KLAVIYO_PRIVATE_API_KEY");

  if (!apiKey || !order.customer_email) {
    console.log("Klaviyo skipped: missing API key or email.");
    return;
  }

  const payload = {
    data: {
      type: "event",
      attributes: {
        properties: {
          OrderId: order.order_number,
          Categories: ["Pet Care"],
          ItemNames: items.map((item) => item.product_name || item.name || item.sku),
          ItemSkus: items.map((item) => item.sku),
          Items: items.map((item) => ({
            ProductID: item.product_id,
            SKU: item.sku,
            ProductName: item.product_name || item.name,
            Amount: item.amount || null,
            Quantity: item.quantity,
            ItemPrice: Number(item.unit_price || 0),
            RowTotal: Number(item.line_total || 0),
            ImageURL: item.image_url || null,
          })),
          Subtotal: Number(order.subtotal_amount || 0) / 100,
          Shipping: Number(order.shipping_amount || 0) / 100,
          Value: Number(order.total_amount || 0) / 100,
          ShippingMethod: order.shipping_method_name,
          FulfillmentStatus: order.fulfillment_status,
        },
        metric: {
          data: {
            type: "metric",
            attributes: {
              name: "Placed Order",
            },
          },
        },
        profile: {
          data: {
            type: "profile",
            attributes: {
              email: order.customer_email,
              first_name: order.shipping_address?.first_name || undefined,
              last_name: order.shipping_address?.last_name || undefined,
              phone_number: order.shipping_phone || undefined,
              properties: {
                order_number: order.order_number,
                shipping_method: order.shipping_method_name,
              },
            },
          },
        },
        value: Number(order.total_amount || 0) / 100,
        unique_id: order.payment_intent_id,
        time: new Date().toISOString(),
      },
    },
  };

  const response = await fetch("https://a.klaviyo.com/api/events/", {
    method: "POST",
    headers: {
      Authorization: `Klaviyo-API-Key ${apiKey}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      revision: "2026-01-15",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    console.log("Klaviyo error:", response.status, await response.text());
    return;
  }

  console.log("Klaviyo Placed Order sent.");
}

serve(async (req) => {
  const signature = req.headers.get("stripe-signature");

  if (!signature) {
    return new Response("Missing Stripe signature", { status: 400 });
  }

  const body = await req.text();

  let event: Stripe.Event;

  try {
    event = await stripe.webhooks.constructEventAsync(
      body,
      signature,
      Deno.env.get("STRIPE_WEBHOOK_SECRET") || ""
    );
  } catch (error) {
    return new Response(`Webhook signature verification failed: ${error.message}`, {
      status: 400,
    });
  }

  try {
    const paymentIntent = event.data.object as Stripe.PaymentIntent;

    console.log("EVENT TYPE:", event.type);
    console.log("PAYMENT INTENT:", paymentIntent.id);

    if (
      event.type === "payment_intent.payment_failed" ||
      event.type === "payment_intent.canceled"
    ) {
      await supabase
        .from("checkout_intents")
        .update({
          status: event.type === "payment_intent.canceled" ? "cancelled" : "failed",
        })
        .eq("payment_intent_id", paymentIntent.id);

      return new Response("ok", { status: 200 });
    }

    if (event.type !== "payment_intent.succeeded") {
      console.log("IGNORED EVENT:", event.type);
      return new Response("ignored", { status: 200 });
    }

    let paymentMethodType = null;
    let paymentBrand = null;
    let paymentLast4 = null;
    let paymentExpMonth = null;
    let paymentExpYear = null;

    if (paymentIntent.payment_method) {
      const paymentMethod = await stripe.paymentMethods.retrieve(
        String(paymentIntent.payment_method)
      );

      paymentMethodType = paymentMethod.type || null;

      if (paymentMethod.card) {
        paymentBrand = paymentMethod.card.brand || null;
        paymentLast4 = paymentMethod.card.last4 || null;
        paymentExpMonth = paymentMethod.card.exp_month || null;
        paymentExpYear = paymentMethod.card.exp_year || null;
      } else {
        paymentBrand = paymentMethod.type || null;
      }
    }

    const { data: checkoutIntent, error: checkoutError } = await supabase
      .from("checkout_intents")
      .select("*")
      .eq("payment_intent_id", paymentIntent.id)
      .single();

    if (checkoutError || !checkoutIntent) {
      throw new Error("Checkout intent not found.");
    }

    const { data: existingOrder } = await supabase
      .from("orders")
      .select("id")
      .eq("payment_intent_id", paymentIntent.id)
      .maybeSingle();

    if (existingOrder) {
      await supabase
        .from("checkout_intents")
        .update({
          status: "paid",
          paid_at: new Date().toISOString(),
        })
        .eq("payment_intent_id", paymentIntent.id);

      return new Response("order already exists", { status: 200 });
    }

    const orderNumber = `TAA-${new Date()
      .toISOString()
      .slice(0, 10)
      .replaceAll("-", "")}-${Math.floor(Math.random() * 9000 + 1000)}`;

    const { data: order, error: orderError } = await supabase
      .from("orders")
      .insert({
        order_number: orderNumber,
        payment_intent_id: paymentIntent.id,
        stripe_payment_intent_id: paymentIntent.id,
        status: "paid",
        customer_email: checkoutIntent.customer_email,
        email: checkoutIntent.customer_email,
        subtotal_amount: checkoutIntent.subtotal_amount,
        shipping_amount: checkoutIntent.shipping_amount,
        total_amount: checkoutIntent.total_amount,
        total: Number(checkoutIntent.total_amount || 0) / 100,
        currency: checkoutIntent.currency,
        shipping_method_name: checkoutIntent.shipping_method_name,
        shipping_name: checkoutIntent.shipping_name,
        shipping_phone: checkoutIntent.shipping_phone,
        shipping_address: checkoutIntent.shipping_address,
        billing_name: checkoutIntent.billing_name,
        billing_address: checkoutIntent.billing_address,
        payment_method_type: paymentMethodType,
        payment_brand: paymentBrand,
        payment_last4: paymentLast4,
        payment_exp_month: paymentExpMonth,
        payment_exp_year: paymentExpYear,
        fulfillment_status: "unfulfilled",
      })
      .select("id")
      .single();

    if (orderError || !order) {
      throw new Error(orderError?.message || "Could not create order.");
    }

    const { data: checkoutItems, error: itemsError } = await supabase
      .from("checkout_intent_items")
      .select("*")
      .eq("checkout_intent_id", checkoutIntent.id);

    if (itemsError || !checkoutItems || checkoutItems.length === 0) {
      throw new Error("Checkout items not found.");
    }

    const orderItems = checkoutItems.map((item) => ({
      order_id: order.id,
      product_type: item.product_type,
      product_id: item.product_id,
      sku: item.sku,
      name: item.name,
      product_name: item.name,
      image_url: item.image_url || null,
      quantity: item.quantity,
      unit_amount: item.unit_amount,
      amount: item.amount || null,
      unit_price: Number(item.unit_amount || 0) / 100,
      line_total: Number(item.line_total || 0) / 100,
    }));

    const { error: orderItemsError } = await supabase
      .from("order_items")
      .insert(orderItems);

    if (orderItemsError) {
      throw new Error(orderItemsError?.message || "Could not create order items.");
    }

    for (const item of checkoutItems) {
      if (item.product_type === "product") {
        const { error: inventoryError } = await supabase.rpc(
          "decrement_product_inventory",
          {
            product_id_input: item.product_id,
            quantity_input: item.quantity,
          }
        );

        if (inventoryError) {
          console.log("PRODUCT INVENTORY ERROR:", inventoryError);
        }
      }

      if (item.product_type === "variant") {
        const { error: inventoryError } = await supabase.rpc(
          "decrement_variant_inventory",
          {
            variant_id_input: item.product_id,
            quantity_input: item.quantity,
          }
        );

        if (inventoryError) {
          console.log("VARIANT INVENTORY ERROR:", inventoryError);
        }
      }
    }

    try {
      await sendKlaviyoPlacedOrder(
        {
          ...checkoutIntent,
          id: order.id,
          order_number: orderNumber,
          payment_intent_id: paymentIntent.id,
          status: "paid",
          fulfillment_status: "unfulfilled",
        },
        orderItems
      );
    } catch (error) {
      console.log("KLAVIYO ERROR:", error);
    }

    await supabase
      .from("checkout_intents")
      .update({
        status: "paid",
        paid_at: new Date().toISOString(),
      })
      .eq("id", checkoutIntent.id);

    return new Response("ok", { status: 200 });
  } catch (error) {
    console.log("WEBHOOK ERROR:", error);

    return new Response(error.message || "Webhook error", {
      status: 400,
    });
  }
});