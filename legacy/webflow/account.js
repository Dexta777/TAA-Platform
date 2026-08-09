<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>

<script>
document.addEventListener("DOMContentLoaded", async function () {
  const SUPABASE_URL = "https://zxmywtmjvfjgdjcstgtn.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_0-m08W5gyL2e_f5iZleA8Q__MUY62td";

  const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

  const productWrapper = document.querySelector("[data-product-sku]");
  const priceEl = document.querySelector("[data-commerce-field='price']");
  const qtyEl = document.querySelector("[data-commerce-field='quantity']");
  const variantEl = document.querySelector("[data-commerce-field='variant']");
  const variantWrapper = document.querySelector("[data-variant-wrapper]");
  const messageEl = document.querySelector("[data-commerce-field='cart_message']");
  const addBtn = document.querySelector("[data-commerce-action='add_to_cart']");

  let product = null;
  let selectedVariant = null;

  initCartDrawer();

  if (productWrapper) {
    await initProductPage();
  }

  updateCartCount();
  renderCartDrawer();
  renderBasketPage();

  async function initProductPage() {
    const sku = productWrapper.dataset.productSku;

    if (qtyEl && !qtyEl.value) qtyEl.value = 1;

    const { data, error } = await supabaseClient
      .from("products")
      .select("id, sku, image_url, name, price, currency, active, inventory_quantity, stripe_price_id")
      .eq("sku", sku)
      .eq("active", true)
      .single();

    if (error || !data) {
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

    const { data: variants } = await supabaseClient
      .from("product_variants")
      .select("id, product_id, variant_name, variant_sku, price, compare_at_price, currency, inventory_quantity, weight_grams, stripe_price_id, active")
      .eq("product_id", product.id)
      .eq("active", true);

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

  function addCurrentProductToCart() {
    if (!product) return;

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
    const cartPrice = selectedVariant ? selectedVariant.price : product.price;

    const cart = getCart();
    const existingItem = cart.find(item => item.sku === cartSku);

    if (existingItem) {
      existingItem.quantity += quantity;
    } else {
      cart.push({
        product_id: selectedVariant ? selectedVariant.id : product.id,
        base_product_id: product.id,
        base_sku: product.sku,
        sku: cartSku,
        image: product.image_url,
        title: product.name,
        variant: cartVariant,
        quantity: quantity,
        price: cartPrice,
        currency: product.currency || "GBP",
        stripe_price_id: selectedVariant ? selectedVariant.stripe_price_id : product.stripe_price_id
      });
    }

    setCart(cart);
    updateCartCount();
    renderCartDrawer();
    renderBasketPage();
    openCartDrawer();
  }

  function hydrateCommerceState() {
    if (!product) return;

    const source = selectedVariant || product;
    const inventory = Number(source.inventory_quantity || 0);

    if (priceEl) priceEl.textContent = formatMoney(source.price, source.currency || product.currency || "GBP");

    if (inventory <= 0) {
      if (addBtn) {
        addBtn.disabled = true;
        addBtn.textContent = "Out of Stock";
      }
      showCartMessage("This item is currently out of stock.", "error");
    } else {
      if (addBtn) {
        addBtn.disabled = false;
        addBtn.textContent = "Add to Basket";
      }
      showCartMessage("", "info");
    }
  }

  function renderBasketPage() {
    const basketItemsEl = document.querySelector("[data-basket-items]");
    const template = document.querySelector("[data-basket-item-template]");
    const subtotalEl = document.querySelector("[data-basket-subtotal]");
    const emptyEl = document.querySelector("[data-basket-empty]");
    const errorEl = document.querySelector("[data-basket-error]");

    if (!basketItemsEl || !template) return;

    const cart = getCart();

    Array.from(basketItemsEl.children).forEach(child => {
      if (!child.hasAttribute("data-basket-item-template")) child.remove();
    });

    if (cart.length === 0) {
      if (emptyEl) emptyEl.style.display = "block";
      if (errorEl) errorEl.textContent = "";
      if (subtotalEl) subtotalEl.textContent = formatMoney(0, "GBP");
      return;
    }

    if (emptyEl) {
      emptyEl.style.display = "none";
    }
    if (errorEl) errorEl.textContent = "";

    let subtotal = 0;

    cart.forEach((item, index) => {
      const lineTotal = Number(item.price || 0) * Number(item.quantity || 0);
      subtotal += lineTotal;

      const itemEl = template.cloneNode(true);
      itemEl.removeAttribute("data-basket-item-template");
      itemEl.style.display = "flex";
      itemEl.style.visibility = "visible";
      itemEl.style.opacity = "1";

      const imageEl = itemEl.querySelector("[data-basket-item-image]");
      const titleEl = itemEl.querySelector("[data-basket-item-title]");
      const variantEl = itemEl.querySelector("[data-basket-item-variant]");
      const qtyInput = itemEl.querySelector("[data-basket-item-quantity] input, input[data-basket-item-quantity]");
      const priceEl = itemEl.querySelector("[data-basket-item-price]");
      const removeBtn = itemEl.querySelector("[data-basket-item-remove]");

      if (imageEl && item.image) {
        imageEl.src = item.image;
        imageEl.alt = item.title || item.sku;
      }

      if (titleEl) titleEl.textContent = item.title || item.sku;

      const displayAmount = item.amount || item.variant || "";

      if (variantEl) {
        if (displayAmount && displayAmount !== "default") {
          variantEl.textContent = displayAmount;
          variantEl.style.display = "";
        } else {
          variantEl.textContent = "";
          variantEl.style.display = "none";
        }
      }

      if (qtyInput) {
        qtyInput.value = item.quantity;
        qtyInput.dataset.basketQty = index;
      }

      if (priceEl) priceEl.textContent = formatMoney(lineTotal, item.currency);

      if (removeBtn) removeBtn.dataset.basketRemove = index;

      basketItemsEl.appendChild(itemEl);
    });

    if (subtotalEl) subtotalEl.textContent = formatMoney(subtotal, "GBP");

    bindBasketControls();
  }

  function bindBasketControls() {
    document.querySelectorAll("[data-basket-remove]").forEach(button => {
      button.onclick = function () {
        const cart = getCart();
        const index = Number(button.dataset.basketRemove);
        if (!cart[index]) return;

        cart.splice(index, 1);
        setCart(cart);

        updateCartCount();
        renderCartDrawer();
        renderBasketPage();
      };
    });

    document.querySelectorAll("[data-basket-qty]").forEach(input => {
      input.onchange = function (event) {
        const cart = getCart();
        const index = Number(event.target.dataset.basketQty);
        if (!cart[index]) return;

        cart[index].quantity = Math.max(1, parseInt(event.target.value || "1", 10) || 1);
        setCart(cart);

        updateCartCount();
        renderCartDrawer();
        renderBasketPage();
      };
    });
  }

  function initCartDrawer() {
    document.querySelectorAll("[data-cart-trigger]").forEach(trigger => {
      trigger.onclick = function (event) {
        event.preventDefault();
        openCartDrawer();
      };
    });

    document.querySelectorAll("[data-cart-close]").forEach(closeBtn => {
      closeBtn.onclick = function (event) {
        event.preventDefault();
        closeCartDrawer();
      };
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
      if (!child.hasAttribute("data-cart-item-template")) child.remove();
    });

    if (cart.length === 0) {
      if (emptyEl) emptyEl.style.display = "block";
      if (subtotalEl) subtotalEl.textContent = formatMoney(0, "GBP");
      return;
    }

    if (emptyEl) {
      emptyEl.style.display = "none";
    }

    let subtotal = 0;

    cart.forEach((item, index) => {
      const lineTotal = Number(item.price || 0) * Number(item.quantity || 0);
      subtotal += lineTotal;

      const itemEl = template.cloneNode(true);
      itemEl.removeAttribute("data-cart-item-template");
      itemEl.style.display = "flex";
      itemEl.style.visibility = "visible";
      itemEl.style.opacity = "1";

      const imageEl = itemEl.querySelector("[data-cart-item-image]");
      const titleEl = itemEl.querySelector("[data-cart-item-title]");
      const variantEl = itemEl.querySelector("[data-cart-item-variant]");
      const priceEl = itemEl.querySelector("[data-cart-item-price]");
      const qtyInput = itemEl.querySelector("[data-cart-item-quantity] input, input[data-cart-item-quantity]");
      const removeBtn = itemEl.querySelector("[data-cart-item-remove]");

      if (imageEl && item.image) imageEl.src = item.image;
      if (titleEl) titleEl.textContent = item.title || item.sku;
      if (variantEl) {
        variantEl.textContent = item.variant !== "default" ? item.variant : "";
        variantEl.style.display = item.variant !== "default" ? "" : "none";
      }
      if (priceEl) priceEl.textContent = formatMoney(item.price, item.currency);
      if (qtyInput) {
        qtyInput.value = item.quantity;
        qtyInput.dataset.cartQty = index;
      }
      if (removeBtn) removeBtn.dataset.cartRemove = index;

      drawerItemsEl.appendChild(itemEl);
    });

    if (subtotalEl) subtotalEl.textContent = formatMoney(subtotal, "GBP");

    bindCartDrawerControls();
  }

  function bindCartDrawerControls() {
    document.querySelectorAll("[data-cart-remove]").forEach(button => {
      button.onclick = function () {
        const cart = getCart();
        const index = Number(button.dataset.cartRemove);
        if (!cart[index]) return;

        cart.splice(index, 1);
        setCart(cart);

        updateCartCount();
        renderCartDrawer();
        renderBasketPage();
      };
    });

    document.querySelectorAll("[data-cart-qty]").forEach(input => {
      input.onchange = function (event) {
        const cart = getCart();
        const index = Number(event.target.dataset.cartQty);
        if (!cart[index]) return;

        cart[index].quantity = Math.max(1, parseInt(event.target.value || "1", 10) || 1);
        setCart(cart);

        updateCartCount();
        renderCartDrawer();
        renderBasketPage();
      };
    });
  }

  function updateCartCount() {
    const count = getCart().reduce((total, item) => total + Number(item.quantity || 0), 0);

    document.querySelectorAll("[data-cart-count]").forEach(el => {
      el.textContent = count;
      el.style.display = count > 0 ? "flex" : "none";
    });
  }

  function showCartMessage(message, type) {
    if (!messageEl) return;
    messageEl.textContent = message;
    messageEl.dataset.messageType = type || "info";
  }

  function getCart() {
    try {
      return JSON.parse(localStorage.getItem("taa_cart") || "[]");
    } catch {
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
