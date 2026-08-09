import { initCartUi } from '../modules/cart/cart-ui.js';

let bootstrapPromise = null;

async function runBootstrap() {
  initCartUi();

  if (!document.querySelector('[data-product-sku]')) return;

  try {
    const { initProductPage } = await import('../modules/products/product-page.js');
    const productController = await initProductPage();

    initCartUi({ productController });
  } catch (error) {
    console.error('Product page initialization failed:', error);
  }
}

export function bootstrapApp() {
  if (!bootstrapPromise) {
    bootstrapPromise = runBootstrap();
  }

  return bootstrapPromise;
}
