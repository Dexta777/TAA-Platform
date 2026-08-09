<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>

<script>
document.addEventListener("DOMContentLoaded", async function () {
  const SUPABASE_URL = "https://zxmywtmjvfjgdjcstgtn.supabase.co";
  const SUPABASE_ANON_KEY = "sb_publishable_0-m08W5gyL2e_f5iZleA8Q__MUY62td";

  const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  const productWrapper = document.querySelector("[data-product-sku]");
  const priceEl = document.querySelector("[data-commerce-field='price']");
  const qtyEl = document.querySelector("[data-commerce-field='quantity']");
  const variantEl = document.querySelector("[data-commerce-field='variant']");
  const variantWrapper = document.querySelector("[data-variant-wrapper]");
  const messageEl = document.querySelector("[data-commerce-field='cart_message']");
  const addBtn = document.querySelector("[data-commerce-action='add_to_cart']");
  const amountEl = document.querySelector("[data-commerce-field='amount']");

  let product = null;
  let selectedVariant = null;

  initCartDrawer();

  if (productWrapper) {
    await initProductPage();
  }

  renderCartDrawer();
  updateCartCount();

  async function initProductPage() {
    const sku = productWrapper.dataset.productSku;

    if (qtyEl && !qtyEl.value) qtyEl.value = 1;

    const { data, error } = await supabaseClient
      .from("products")
      .select("id, sku, image_url, name, price, currency, active, inventory_quantity, stripe_price_id, default_amount")
      .eq("sku", sku)
      .eq("active", true)
      .single();

    if (error || !data) {
      console.error("Supabase product lookup failed:", error);

      if (priceEl) priceEl.textContent = "Unavailable";

      if (addBtn) {
        addBtn.disabled = true;
        addBtn.textContent = "Unavailable";
        addBtn.classList.add("is-disabled");
      }

      showCartMessage("This product is currently unavailable.", "error");
      return;
    }

    product = data;

    const { data: variants, error: variantsError } = await supabaseClient
      .from("product_variants")
      .select("id, product_id, variant_name, variant_sku, price, compare_at_price, currency, inventory_quantity, weight_grams, stripe_price_id, active")
      .eq("product_id", product.id)
      .eq("active", true)
      .order("sort_order", { ascending: true });

    if (variantsError) {
      console.error("Supabase variants lookup failed:", variantsError);
    }

    const activeVariants = Array.isArray(variants) ? variants : [];
    selectedVariant = activeVariants.length > 0 ? activeVariants[0] : null;

    if (variantEl && variantWrapper) {
      if (activeVariants.length > 0) {
        variantWrapper.style.display = "";
        variantEl.innerHTML = "";

        activeVariants.forEach(variant => {
          const option = document.createElement("option");
          option.value = variant.variant_sku;
          option.textContent = variant.variant_name;
          variantEl.appendChild(option);
        });

        variantEl.value = selectedVariant.variant_sku;

        variantEl.addEventListener("change", function () {
          selectedVariant = activeVariants.find(variant => variant.variant_sku === variantEl.value);
          hydrateCommerceState();
        });
      } else {
        variantWrapper.style.display = "none";
      }
    }

    hydrateCommerceState();

    if (addBtn) {
      addBtn.addEventListener("click", function (event) {
        event.preventDefault();
        addCurrentProductToCart();
      });
    }
  }

  function getDisplayAmount() {

    if (selectedVariant) {
      const match = selectedVariant.variant_name.match(/(\d+\s*(ml|l|g|kg))/i);
      return match ? match[1] : selectedVariant.variant_name;
    }
    return product && product.default_amount ? product.default_amount : "";
  }

  function addCurrentProductToCart() {
    if (!product) {
      showCartMessage("This product is currently unavailable.", "error");
      return;
    }

    const quantity = qtyEl ? parseInt(qtyEl.value || "1", 10) : 1;
    const itemSource = selectedVariant || product;
    const availableStock = Number(itemSource.inventory_quantity || 0);

    if (!quantity || quantity < 1) {
      showCartMessage("Please enter a valid quantity.", "error");
      return;
    }

    if (availableStock <= 0) {
      showCartMessage("This item is currently out of stock.", "error");
      return;
    }

    if (quantity > availableStock) {
      showCartMessage(`Only ${availableStock} available. Please reduce the quantity.`, "error");
      return;
    }

    const cartSku = selectedVariant ? selectedVariant.variant_sku : product.sku;
    const cartVariant = selectedVariant ? selectedVariant.variant_name : "default";
    const cartProductId = selectedVariant ? selectedVariant.id : product.id;
    const cartPrice = selectedVariant ? selectedVariant.price : product.price;
    const cartCurrency = selectedVariant ? selectedVariant.currency || product.currency || "GBP" : product.currency || "GBP";
    const cartStripePriceId = selectedVariant ? selectedVariant.stripe_price_id : product.stripe_price_id;
    const cartAmount = getDisplayAmount();

    let cart = getCart();

    const existingItem = cart.find(item => item.sku === cartSku);

    if (existingItem) {
      const newQuantity = Number(existingItem.quantity || 0) + quantity;

      if (newQuantity > availableStock) {
        showCartMessage(`Only ${availableStock} available. You already have ${existingItem.quantity} in your basket.`, "error");
        return;
      }

      existingItem.quantity = newQuantity;
    } else {
      cart.push({
        product_id: cartProductId,
        base_product_id: product.id,
        base_sku: product.sku,
        sku: cartSku,
        image: product.image_url,
        title: product.name,
        variant: cartVariant,
        quantity: quantity,
        price: cartPrice,
        currency: cartCurrency,
        amount: cartAmount,
        stripe_price_id: cartStripePriceId
      });
    }

    setCart(cart);
    updateCartCount();
    renderCartDrawer();
    openCartDrawer();
  }

  function hydrateCommerceState() {
    if (!product) return;

    const source = selectedVariant || product;
    const currentPrice = source.price;
    const currentCurrency = source.currency || product.currency || "GBP";
    const currentInventory = Number(source.inventory_quantity || 0);

    if (amountEl) {
      amountEl.textContent = getDisplayAmount();
    }

    if (priceEl) {
      priceEl.textContent = formatMoney(currentPrice, currentCurrency);
    }

    if (currentInventory <= 0) {
      if (addBtn) {
        addBtn.disabled = true;
        addBtn.textContent = "Out of Stock";
        addBtn.classList.add("is-disabled");
      }

      showCartMessage("This item is currently out of stock.", "error");
    } else {
      if (addBtn) {
        addBtn.disabled = false;
        addBtn.textContent = "Add to Basket";
        addBtn.classList.remove("is-disabled");
      }

      showCartMessage("", "info");
    }
  }

  function initCartDrawer() {
    document.querySelectorAll("[data-cart-trigger]").forEach(trigger => {
      trigger.addEventListener("click", function (event) {
        event.preventDefault();
        openCartDrawer();
      });
    });

    document.querySelectorAll("[data-cart-close]").forEach(closeBtn => {
      closeBtn.addEventListener("click", function (event) {
        event.preventDefault();
        closeCartDrawer();
      });
    });
  }

  function openCartDrawer() {
    const drawer = document.querySelector("[data-cart-drawer]");
    if (!drawer) return;

    renderCartDrawer();
    drawer.style.display = "block";
  }

  function closeCartDrawer() {
    const drawer = document.querySelector("[data-cart-drawer]");
    if (!drawer) return;

    drawer.style.display = "none";
  }

  function renderCartDrawer() {
    const drawerItemsEl = document.querySelector("[data-cart-items]");
    const emptyEl = document.querySelector("[data-cart-empty]");
    const subtotalEl = document.querySelector("[data-cart-subtotal]");
    const template = document.querySelector("[data-cart-item-template]");

    if (!drawerItemsEl || !template) return;

    const cart = getCart();

    Array.from(drawerItemsEl.children).forEach(child => {
      if (!child.hasAttribute("data-cart-item-template")) {
        child.remove();
      }
    });

    if (cart.length === 0) {
      if (emptyEl) emptyEl.style.display = "block";
      if (subtotalEl) subtotalEl.textContent = formatMoney(0, "GBP");
      return;
    }

    if (emptyEl) emptyEl.style.display = "none";

    let subtotal = 0;

    cart.forEach((item, index) => {
      const itemTotal = Number(item.price || 0) * Number(item.quantity || 0);
      subtotal += itemTotal;

      const itemEl = template.cloneNode(true);
      itemEl.removeAttribute("data-cart-item-template");
      itemEl.style.display = "flex";
      itemEl.style.visibility = "visible";
      itemEl.style.opacity = "1";

      const titleEl = itemEl.querySelector("[data-cart-item-title]");
      const variantEl = itemEl.querySelector("[data-cart-item-variant]");
      const priceEl = itemEl.querySelector("[data-cart-item-price]");
      const qtyInput = itemEl.querySelector("[data-cart-item-quantity] input, input[data-cart-item-quantity]");
      const removeBtn = itemEl.querySelector("[data-cart-item-remove]");
      const imageEl = itemEl.querySelector("[data-cart-item-image]");

      if (imageEl && item.image) {
        imageEl.src = item.image;
        imageEl.alt = item.title || item.sku;
      }

      if (titleEl) titleEl.textContent = item.title || item.sku;

      if (variantEl) {
        const displayAmount = item.amount || "";

        if (displayAmount) {
         variantEl.textContent = displayAmount;
         variantEl.style.display = "";
       } else {
         variantEl.textContent = "";
         variantEl.style.display = "none";
       }
      }

      if (priceEl) priceEl.textContent = formatMoney(item.price, item.currency);

      if (qtyInput) {
        qtyInput.value = item.quantity;
        qtyInput.dataset.cartQty = index;
      }

      if (removeBtn) {
        removeBtn.dataset.cartRemove = index;
      }

      drawerItemsEl.appendChild(itemEl);
    });

    if (subtotalEl) subtotalEl.textContent = formatMoney(subtotal, "GBP");

    bindCartDrawerControls();
  }

  function bindCartDrawerControls() {
  document.querySelectorAll("[data-cart-remove]").forEach(button => {
    button.onclick = function () {
      const index = Number(button.dataset.cartRemove);
      const cart = getCart();

      if (!Number.isInteger(index) || !cart[index]) return;

      cart.splice(index, 1);
      setCart(cart);

      updateCartCount();
      renderCartDrawer();
    };
  });

  document.querySelectorAll("[data-cart-qty]").forEach(input => {
    input.onchange = function (event) {
      const changedInput = event.target;
      const index = Number(changedInput.dataset.cartQty);
      const cart = getCart();

      if (!Number.isInteger(index) || !cart[index]) {
        console.warn("Cart quantity index invalid:", index, cart);
        return;
      }

      const newQty = parseInt(changedInput.value || "1", 10);

      if (!Number.isFinite(newQty) || newQty < 1) {
        changedInput.value = 1;
        cart[index].quantity = 1;
      } else {
        cart[index].quantity = newQty;
      }

      setCart(cart);
      updateCartCount();
      renderCartDrawer();
    };
  });
}

  function updateCartCount() {
    const cart = getCart();

    const count = cart.reduce((total, item) => {
      return total + Number(item.quantity || 0);
    }, 0);

    document.querySelectorAll("[data-cart-count]").forEach(el => {
      el.textContent = count;
      el.style.display = count > 0 ? "flex" : "none";
    });
  }

  function showCartMessage(message, type) {
    if (!messageEl) return;

    messageEl.textContent = message;
    messageEl.dataset.messageType = type || "info";
    messageEl.classList.remove("is-error", "is-success", "is-info");

    if (type === "error") {
      messageEl.classList.add("is-error");
    } else if (type === "success") {
      messageEl.classList.add("is-success");
    } else {
      messageEl.classList.add("is-info");
    }
  }

  function getCart() {
    try {
      return JSON.parse(localStorage.getItem("taa_cart") || "[]");
    } catch (error) {
      console.error("Cart read error:", error);
      return [];
    }
  }

  function setCart(cart) {
    localStorage.setItem("taa_cart", JSON.stringify(cart));
  }

  function formatMoney(value, currency) {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: currency || "GBP"
    }).format(Number(value || 0));
  }
});
</script>
