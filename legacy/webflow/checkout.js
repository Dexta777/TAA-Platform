<script src="https://js.stripe.com/v3/"></script>

<script>
document.addEventListener("DOMContentLoaded", async function () {
  const STRIPE_PUBLISHABLE_KEY = "pk_test_51P5MnlDHf5hX3hAu2OEI2bOU8yTYPI2pWtJwwOHUfuLq7GOWFDHXwaighvRJ3WXxQHD1mUzu9yA3p1zKYC6wzdIe00KngAhErR";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_0-m08W5gyL2e_f5iZleA8Q__MUY62td";

  const CREATE_PAYMENT_INTENT_URL = "https://zxmywtmjvfjgdjcstgtn.supabase.co/functions/v1/create-payment-intent";
  const SHIPPING_OPTIONS_URL = "https://zxmywtmjvfjgdjcstgtn.supabase.co/functions/v1/get-shipping-options";

  const payButton = document.querySelector("[data-pay-button]");
  const errorEl = document.querySelector("[data-checkout-error]");
  const paymentElementWrapper = document.querySelector("[data-stripe-payment-element]");
  const billingDifferent = document.querySelector("[data-billing-different]");
  const subtotalEl = document.querySelector("[data-checkout-subtotal]");
  const shippingEl = document.querySelector("[data-checkout-shipping]");
  const totalEl = document.querySelector("[data-checkout-total]");

  const stripe = Stripe(STRIPE_PUBLISHABLE_KEY);

  let clientSecret = null;
  let elements = null;
  let isPreparingPayment = false;

  const addressFields = [
    "first-name", "last-name", "company", "address-1", "address-2",
    "city", "county", "postcode", "country"
  ];

  function getField(type, name) {
    return document.querySelector(`[data-${type}-${name}]`);
  }

  function getCart() {
    try {
      return JSON.parse(localStorage.getItem("taa_cart") || "[]");
    } catch {
      return [];
    }
  }

  function formatMoneyFromPence(value, currency) {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: currency || "GBP"
    }).format(Number(value || 0) / 100);
  }

  function formatMoney(value, currency) {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: currency || "GBP"
    }).format(Number(value || 0));
  }

  function showCheckoutError(message) {
    if (!errorEl) return;
    errorEl.textContent = message;
    errorEl.style.display = message ? "block" : "none";
  }

  function copyShippingToBilling() {
    addressFields.forEach(name => {
      const shippingField = getField("shipping", name);
      const billingField = getField("billing", name);
      if (shippingField && billingField) billingField.value = shippingField.value || "";
    });
  }

  function clearBillingFields() {
    addressFields.forEach(name => {
      const billingField = getField("billing", name);
      if (billingField) billingField.value = "";
    });
  }

  function getCheckoutAddressData() {
    const billingIsDifferent = billingDifferent && billingDifferent.checked;
    const shipping = {};
    const billing = {};

    addressFields.forEach(name => {
      const shippingField = getField("shipping", name);
      const billingField = getField("billing", name);
      shipping[name] = shippingField ? shippingField.value.trim() : "";
      billing[name] = billingField ? billingField.value.trim() : "";
    });

    const shippingEmailField = document.querySelector("[data-shipping-email]");
    const shippingPhoneField = document.querySelector("[data-shipping-phone]");

    shipping.email = shippingEmailField ? shippingEmailField.value.trim() : "";
    shipping.phone = shippingPhoneField ? shippingPhoneField.value.trim() : "";

    return {
      shipping,
      billing: billingIsDifferent ? billing : { ...shipping },
      billing_is_different: Boolean(billingIsDifferent)
    };
  }

  function getSelectedShippingMethodName() {
    const checkedRadio = document.querySelector(
      '[data-shipping-method-option="true"] input[type="radio"]:checked'
    );

    if (!checkedRadio) return "";

    const wrapper = checkedRadio.closest('[data-shipping-method-option="true"]');

    return wrapper ? wrapper.getAttribute("data-shipping-method-name") || "" : "";
  }

  function renderOrderSummaryItems() {
    const cart = getCart();

    const wrapper = document.querySelector('[data-order-summary-items="true"]');
    const template = document.querySelector('[data-order-summary-template="true"]');

    if (!wrapper || !template) return;

    wrapper.querySelectorAll('[data-order-summary-generated="true"]').forEach(el => {
      el.remove();
    });

    cart.forEach(item => {
      const clone = template.cloneNode(true);

      clone.removeAttribute("data-order-summary-template");
      clone.setAttribute("data-order-summary-generated", "true");
      clone.style.display = "flex";

      const nameEl = clone.querySelector('[data-order-summary-name="true"]');
      const qtyEl = clone.querySelector('[data-order-summary-qty="true"]');
      const priceEl = clone.querySelector('[data-order-summary-price="true"]');
      const imageEl = clone.querySelector('[data-order-summary-image="true"]');
      const amountEl = clone.querySelector('[data-order-summary-amount="true"]');

      if (nameEl) {
        nameEl.textContent = item.title || item.name || item.sku || "Product";
      }

      if (qtyEl) {
        qtyEl.textContent = `${Number(item.quantity || 1)}`;
      }

      if (priceEl) {
        const lineTotal = Number(item.price || 0) * Number(item.quantity || 1);
        priceEl.textContent = formatMoney(lineTotal, item.currency || "GBP");
      }

      if (imageEl && item.image) {
        imageEl.src = item.image;
        imageEl.alt = item.title || item.name || item.sku || "Product image";
      }

      wrapper.appendChild(clone);
    });
  }

  function updateOrderSummary(result) {
    if (subtotalEl) subtotalEl.textContent = formatMoneyFromPence(result.subtotal, result.currency);
    if (shippingEl) shippingEl.textContent = formatMoneyFromPence(result.shipping || 0, result.currency);
    if (totalEl) totalEl.textContent = formatMoneyFromPence(result.amount || result.total || result.subtotal, result.currency);
  }

  async function loadShippingOptions() {
    const cart = getCart();

    if (!Array.isArray(cart) || cart.length === 0) {
      showCheckoutError("Your basket is empty.");
      if (payButton) {
        payButton.disabled = true;
        payButton.textContent = "Basket Empty";
      }
      return null;
    }

    const response = await fetch(SHIPPING_OPTIONS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": SUPABASE_PUBLISHABLE_KEY
      },
      body: JSON.stringify({
        cart: cart.map(item => ({
          sku: item.sku,
          quantity: item.quantity,
          amount: item.amount || null
        }))
      })
    });

    const result = await response.json();

    if (!response.ok || result.error) {
      throw new Error(result.error || "Could not load shipping options.");
    }

    result.options.forEach(option => {
      const priceEl = document.querySelector(`[data-shipping-method-price="${option.name}"]`);
      if (priceEl) priceEl.textContent = formatMoneyFromPence(option.shipping, option.currency);
    });

    if (subtotalEl) {
      subtotalEl.textContent = formatMoneyFromPence(result.subtotal, result.currency);
    }

    return result;
  }

  function setSelectedShippingVisuals() {
    document.querySelectorAll('[data-shipping-method-option="true"]').forEach(wrapper => {
      const radio = wrapper.querySelector('input[type="radio"]');

      if (radio && radio.checked) {
        wrapper.classList.add("is-selected");
      } else {
        wrapper.classList.remove("is-selected");
      }
    });
  }

  async function preparePaymentIntent() {
    if (isPreparingPayment) return;

    isPreparingPayment = true;
    showCheckoutError("");

    if (!payButton || !paymentElementWrapper) {
      isPreparingPayment = false;
      return;
    }

    payButton.disabled = true;
    payButton.textContent = "Preparing payment...";

    const cart = getCart();

    if (!Array.isArray(cart) || cart.length === 0) {
      showCheckoutError("Your basket is empty.");
      payButton.disabled = true;
      payButton.textContent = "Basket Empty";
      isPreparingPayment = false;
      return;
    }

    const shippingMethodName = getSelectedShippingMethodName();

    if (!shippingMethodName) {
      showCheckoutError("Please select a shipping method.");
      payButton.disabled = true;
      payButton.textContent = "Select Shipping";
      isPreparingPayment = false;
      return;
    }

    try {
      const addressData = getCheckoutAddressData();

      const response = await fetch(CREATE_PAYMENT_INTENT_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": SUPABASE_PUBLISHABLE_KEY
        },
        body: JSON.stringify({
          cart: cart.map(item => ({
            sku: item.sku,
            quantity: item.quantity,
            amount: item.amount || null
          })),
          customer_email: addressData.shipping.email || undefined,
          shipping_method_name: shippingMethodName,

          shipping_name: `${addressData.shipping["first-name"] || ""} ${addressData.shipping["last-name"] || ""}`.trim(),

          shipping_phone: addressData.shipping.phone || "",

          shipping_address: {
            first_name: addressData.shipping["first-name"] || "",
            last_name: addressData.shipping["last-name"] || "",
            company: addressData.shipping.company || "",
            address_1: addressData.shipping["address-1"] || "",
            address_2: addressData.shipping["address-2"] || "",
            city: addressData.shipping.city || "",
            county: addressData.shipping.county || "",
            postcode: addressData.shipping.postcode || "",
            country: addressData.shipping.country || "GB"
          },

          billing_name: `${addressData.billing["first-name"] || ""} ${addressData.billing["last-name"] || ""}`.trim(),

          billing_address: {
            first_name: addressData.billing["first-name"] || "",
            last_name: addressData.billing["last-name"] || "",
            company: addressData.billing.company || "",
            address_1: addressData.billing["address-1"] || "",
            address_2: addressData.billing["address-2"] || "",
            city: addressData.billing.city || "",
            county: addressData.billing.county || "",
            postcode: addressData.billing.postcode || "",
            country: addressData.billing.country || "GB"
          },

          billing_is_different: addressData.billing_is_different
        })
      });

      const result = await response.json();

      if (!response.ok || result.error) {
        throw new Error(result.error || "Could not prepare payment.");
      }

      clientSecret = result.client_secret;
      updateOrderSummary(result);

      paymentElementWrapper.innerHTML = "";

      elements = stripe.elements({
        clientSecret,
        appearance: {
          theme: "stripe",
          variables: {
            colorPrimary: "#000000",
            colorBackground: "#ffffff",
            colorText: "#000000",
            colorDanger: "#8b0000",
            fontFamily: "Arial, sans-serif",
            borderRadius: "0px"
          }
        }
      });

      const paymentElement = elements.create("payment", {
        layout: "tabs"
      });

      paymentElement.mount("#payment-element");

      payButton.disabled = false;
      payButton.textContent = "Place Order";

    } catch (error) {
      console.error("Checkout preparation error:", error);
      showCheckoutError(error.message || "Payment could not be prepared.");
      payButton.disabled = true;
      payButton.textContent = "Payment Unavailable";
    }

    isPreparingPayment = false;
  }

  function validateCheckoutFields() {
    const addressData = getCheckoutAddressData();

    if (!addressData.shipping["first-name"]) return "Please enter your first name.";
    if (!addressData.shipping["last-name"]) return "Please enter your last name.";
    if (!addressData.shipping["address-1"]) return "Please enter your address.";
    if (!addressData.shipping.city) return "Please enter your town or city.";
    if (!addressData.shipping.postcode) return "Please enter your postcode.";
    if (!addressData.shipping.email) return "Please enter your email address.";
    if (!getSelectedShippingMethodName()) return "Please select a shipping method.";

    return "";
  }

  document.querySelectorAll(
    "[data-shipping-first-name], [data-shipping-last-name], [data-shipping-company], [data-shipping-address-1], [data-shipping-address-2], [data-shipping-city], [data-shipping-county], [data-shipping-postcode], [data-shipping-country]"
  ).forEach(field => {
    field.addEventListener("input", function () {
      if (!billingDifferent || !billingDifferent.checked) {
        copyShippingToBilling();
      }
    });
  });

  if (billingDifferent) {
    billingDifferent.addEventListener("change", function () {
      if (billingDifferent.checked) clearBillingFields();
      else copyShippingToBilling();
    });
  }

  document.querySelectorAll('[data-shipping-method-option="true"]').forEach(wrapper => {
    const radio = wrapper.querySelector('input[type="radio"]');

    wrapper.addEventListener("click", async function () {
      if (radio) radio.checked = true;
      setSelectedShippingVisuals();
      await preparePaymentIntent();
    });

    if (radio) {
      radio.addEventListener("change", async function () {
        setSelectedShippingVisuals();
        await preparePaymentIntent();
      });
    }
  });

  document.querySelectorAll('[data-shipping-method-option="true"] input[type="radio"]').forEach(radio => {
    radio.checked = false;
  });

  copyShippingToBilling();
  setSelectedShippingVisuals();

  if (!payButton || !paymentElementWrapper) return;

  try {
    const shippingOptions = await loadShippingOptions();

    renderOrderSummaryItems();

    if (shippingEl) {
      shippingEl.textContent = "Please select shipping method";
    }

    if (totalEl && shippingOptions) {
      totalEl.textContent = formatMoneyFromPence(
        shippingOptions.subtotal,
        shippingOptions.currency
      );
    }

    if (payButton) {
      payButton.disabled = true;
      payButton.textContent = "Select Shipping";
    }

  } catch (error) {
    console.error("Checkout init error:", error);
    showCheckoutError(error.message || "Checkout could not be loaded.");
    payButton.disabled = true;
    payButton.textContent = "Payment Unavailable";
  }

  payButton.addEventListener("click", async function (event) {
    event.preventDefault();

    showCheckoutError("");

    const validationError = validateCheckoutFields();

    if (validationError) {
      showCheckoutError(validationError);
      return;
    }

    if (!stripe || !elements || !clientSecret) {
      showCheckoutError("Payment is not ready yet.");
      return;
    }

    const addressData = getCheckoutAddressData();

    payButton.disabled = true;
    payButton.textContent = "Processing...";

    const { error } = await stripe.confirmPayment({
      elements,
      confirmParams: {
        return_url: "https://www.theanimalalchemist.com/order-confirmation-test",
        receipt_email: addressData.shipping.email
      }
    });

    if (error) {
      showCheckoutError(error.message || "Payment failed.");
      payButton.disabled = false;
      payButton.textContent = "Place Order";
    }
  });
});
</script>
