<script>
document.addEventListener("DOMContentLoaded", async function () {
  console.log("ORDER CONFIRMATION SCRIPT RUNNING");

  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_0-m08W5gyL2e_f5iZleA8Q__MUY62td";

  const ORDER_CONFIRMATION_URL =
    "https://zxmywtmjvfjgdjcstgtn.supabase.co/functions/v1/get-order-confirmation";

  const params = new URLSearchParams(window.location.search);

  const paymentIntentId =
    params.get("payment_intent") ||
    params.get("payment_intent_id");

  console.log("PAYMENT INTENT ID:", paymentIntentId);

  function setText(selector, value) {
    const el = document.querySelector(selector);
    if (!el) return;

    el.textContent = value || "";
    el.style.whiteSpace = "pre-line";
  }

  function formatMoney(pence, currency) {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: currency || "GBP"
    }).format(Number(pence || 0) / 100);
  }

  function formatAddress(address) {
    if (!address) return "";

    return [
      address.first_name && address.last_name
        ? `${address.first_name} ${address.last_name}`
        : "",
      address.company,
      address.address_1,
      address.address_2,
      address.city,
      address.county,
      address.postcode,
      address.country
    ]
      .filter(Boolean)
      .join("\n");
  }

  async function fetchOrderConfirmation(paymentIntentId, attempts = 8) {
    for (let i = 0; i < attempts; i++) {
      const response = await fetch(ORDER_CONFIRMATION_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": SUPABASE_PUBLISHABLE_KEY
        },
        body: JSON.stringify({
          payment_intent_id: paymentIntentId
        })
      });
      const result = await response.json();
      if (response.ok && result.order) {
        return result;
      }
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
    throw new Error("Order is still being prepared. Please refresh this page.");
  }

  if (!paymentIntentId) {
    console.error("Missing payment intent ID.");
    return;
  }

  try {
    const result = await fetchOrderConfirmation(paymentIntentId);

    console.log("ORDER CONFIRMATION RESULT:", result);

    const order = result.order;
    const items = result.items || [];

    setText("[data-confirmation-order-number]", order.order_number);
    setText("[data-confirmation-email]", order.customer_email);
    setText("[data-confirmation-billing-address]", formatAddress(order.billing_address));
    setText("[data-confirmation-shipping-address]", formatAddress(order.shipping_address));
    setText("[data-confirmation-shipping-phone]", order.shipping_phone);
    setText("[data-confirmation-shipping-method]", order.shipping_method_name);
    setText("[data-confirmation-subtotal]", formatMoney(order.subtotal_amount, order.currency));
    setText("[data-confirmation-shipping]", formatMoney(order.shipping_amount, order.currency));
    setText("[data-confirmation-total]", formatMoney(order.total_amount, order.currency));

    const paymentLines = [];

    if (order.payment_brand) {
      paymentLines.push(
        `${String(order.payment_brand).toUpperCase()} ending in ${order.payment_last4 || "****"}`
      );
    }

    if (order.payment_exp_month && order.payment_exp_year) {
      paymentLines.push(
        `Exp: ${String(order.payment_exp_month).padStart(2, "0")}/${String(order.payment_exp_year).slice(-2)}`
      );
    }

    setText(
      "[data-confirmation-payment-method]",
      paymentLines.length ? paymentLines.join("\n") : "Payment received"
    );

    const wrapper = document.querySelector("[data-confirmation-items-wrapper]");
    const template = document.querySelector("[data-confirmation-item-template]");

    if (wrapper && template) {
      wrapper
        .querySelectorAll("[data-confirmation-generated-item]")
        .forEach(el => el.remove());

      items.forEach(item => {
        const clone = template.cloneNode(true);

        clone.removeAttribute("data-confirmation-item-template");
        clone.setAttribute("data-confirmation-generated-item", "true");
        clone.style.display = "flex";

        const imageEl = clone.querySelector("[data-confirmation-item-image]");
        const nameEl = clone.querySelector("[data-confirmation-item-name]");
        const amountEl = clone.querySelector("[data-confirmation-item-amount]");
        const qtyEl = clone.querySelector("[data-confirmation-item-qty]");
        const priceEl = clone.querySelector("[data-confirmation-item-price]");


        if (imageEl && item.image_url) {
          imageEl.src = item.image_url;
          imageEl.alt = item.product_name || item.name || item.sku || "Product image";
        }

        if (nameEl) {
          nameEl.textContent = item.product_name || item.name || item.sku || "Product";
        }

        if (amountEl) {
          amountEl.textContent = item.amount || "";
          amountEl.style.display = item.amount ? "" : "none";
        }

        if (qtyEl) {
          qtyEl.textContent = `Qty: ${item.quantity}`;
        }

        if (priceEl) {
          priceEl.textContent = new Intl.NumberFormat("en-GB", {
            style: "currency",
            currency: order.currency || "GBP"
          }).format(Number(item.line_total || 0));
        }

        wrapper.appendChild(clone);
      });
    }

    localStorage.removeItem("taa_cart");

  } catch (error) {
    console.error("Order confirmation error:", error);
  }
});
</script>
