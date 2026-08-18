import { initCartUi } from '../modules/cart/cart-ui.js';

let bootstrapPromise = null;

async function runBootstrap() {
  initCartUi();

  const initializers = [];
  const checkoutRoot = document.querySelector('[data-checkout-root="true"]');
  const normalizedPathname = window.location.pathname.replace(/\/+$/, '') || '/';

  if (document.querySelector('[data-product-sku]')) {
    initializers.push(
      (async () => {
        try {
          const { initProductPage } = await import('../modules/products/product-page.js');
          const productController = await initProductPage();

          initCartUi({ productController });
        } catch (error) {
          console.error('Product page initialization failed:', error);
        }
      })()
    );
  }

  if (checkoutRoot) {
    initializers.push(
      (async () => {
        let canaryFixture = null;
        let checkoutController = null;

        try {
          const { initCheckout } = await import('../modules/checkout/checkout.js');
          checkoutController = await initCheckout({
            root: checkoutRoot,
            dependencies:
              normalizedPathname === '/checkout-test'
                ? {
                    onCartChanged: () => canaryFixture?.render(),
                  }
                : {},
          });
        } catch (error) {
          console.error('Checkout initialization failed:', error);
        }

        if (normalizedPathname === '/checkout-test') {
          try {
            const { initCheckoutCanaryFixture } =
              await import('../modules/checkout/checkout-canary-fixture.js');
            canaryFixture = initCheckoutCanaryFixture({
              root: checkoutRoot,
              dependencies: checkoutController
                ? {
                    resetCheckoutAttempt: () => checkoutController.resetCheckoutAttempt(),
                  }
                : {},
            });
          } catch (error) {
            console.error('Checkout canary fixture initialization failed:', error);
          }
        }
      })()
    );
  }

  if (
    document.querySelector('[data-confirmation-order-number]') &&
    new URLSearchParams(window.location.search).has('checkout_session_id')
  ) {
    initializers.push(
      (async () => {
        try {
          const { initOrderConfirmation } =
            await import('../modules/checkout/order-confirmation.js');
          await initOrderConfirmation();
        } catch (error) {
          console.error('Order confirmation initialization failed:', error);
        }
      })()
    );
  }

  await Promise.all(initializers);
}

export function bootstrapApp() {
  if (!bootstrapPromise) {
    bootstrapPromise = runBootstrap();
  }

  return bootstrapPromise;
}
