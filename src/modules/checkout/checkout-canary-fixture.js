import { addCartItem, getCart, removeCartItems } from '../cart/cart.js';
import { refreshCartUi } from '../cart/cart-ui.js';
import { getActiveProductBySku } from '../../services/supabase/products.js';
import { resetStoredCheckoutAttempt } from './checkout-reset.js';

const CHECKOUT_TEST_PATH = '/checkout-test';
const CANARY_SKU_PREFIX = 'TAA-CANARY-';
const FIXTURES = Object.freeze({
  holder: Object.freeze(['TAA-CANARY-BASE']),
  contender: Object.freeze(['TAA-CANARY-A', 'TAA-CANARY-BASE', 'TAA-CANARY-C']),
});

function normalizePathname(pathname) {
  const normalizedPathname = String(pathname ?? '').replace(/\/+$/, '');

  return normalizedPathname || '/';
}

export function isCheckoutCanaryFixturePath(pathname) {
  return normalizePathname(pathname) === CHECKOUT_TEST_PATH;
}

function isCanarySku(sku) {
  return typeof sku === 'string' && sku.startsWith(CANARY_SKU_PREFIX);
}

function getCanaryItems(cart) {
  return cart.filter((item) => isCanarySku(item?.sku));
}

function assertCanaryOnlyCart(cart) {
  if (cart.some((item) => !isCanarySku(item?.sku))) {
    throw new Error('Remove non-canary items before loading a canary test basket.');
  }
}

function assertResolvedProduct(product, expectedSku) {
  if (!product || product.sku !== expectedSku || !isCanarySku(product.sku)) {
    throw new Error('The requested canary product could not be resolved safely.');
  }
}

function createFixtureMarkup(root) {
  const ownerDocument = root.ownerDocument || document;
  const fixture = ownerDocument.createElement('section');
  const heading = ownerDocument.createElement('h2');
  const controls = ownerDocument.createElement('div');
  const holderButton = ownerDocument.createElement('button');
  const contenderButton = ownerDocument.createElement('button');
  const clearButton = ownerDocument.createElement('button');
  const stateHeading = ownerDocument.createElement('p');
  const stateList = ownerDocument.createElement('ul');
  const errorElement = ownerDocument.createElement('p');

  fixture.setAttribute('data-checkout-canary-fixture', 'true');
  fixture.setAttribute('aria-labelledby', 'checkout-canary-fixture-title');
  heading.id = 'checkout-canary-fixture-title';
  heading.textContent = 'Reservation canary test fixture';

  holderButton.type = 'button';
  holderButton.textContent = 'Load HOLDER basket';
  holderButton.setAttribute('data-checkout-canary-load', 'holder');

  contenderButton.type = 'button';
  contenderButton.textContent = 'Load CONTENDER basket';
  contenderButton.setAttribute('data-checkout-canary-load', 'contender');

  clearButton.type = 'button';
  clearButton.textContent = 'Clear canary basket';
  clearButton.setAttribute('data-checkout-canary-clear', 'true');

  stateHeading.textContent = 'Current canary basket';
  stateList.setAttribute('data-checkout-canary-state', 'true');
  stateList.setAttribute('aria-live', 'polite');

  errorElement.hidden = true;
  errorElement.setAttribute('data-checkout-canary-error', 'true');
  errorElement.setAttribute('role', 'alert');

  controls.appendChild(holderButton);
  controls.appendChild(contenderButton);
  controls.appendChild(clearButton);
  fixture.appendChild(heading);
  fixture.appendChild(controls);
  fixture.appendChild(stateHeading);
  fixture.appendChild(stateList);
  fixture.appendChild(errorElement);
  root.prepend(fixture);

  return {
    clearButton,
    contenderButton,
    errorElement,
    fixture,
    holderButton,
    stateList,
  };
}

export function initCheckoutCanaryFixture({
  root = document.querySelector('[data-checkout-root="true"]'),
  pathname = window.location.pathname,
  dependencies = {},
} = {}) {
  if (!root || !isCheckoutCanaryFixturePath(pathname)) return null;

  const existingFixture = root.querySelector('[data-checkout-canary-fixture="true"]');

  if (existingFixture) return null;

  const {
    addCartItem: addCartItemDependency = addCartItem,
    getActiveProductBySku: getActiveProductBySkuDependency = getActiveProductBySku,
    getCart: getCartDependency = getCart,
    refreshCartUi: refreshCartUiDependency = refreshCartUi,
    reloadCheckout = () => window.location.reload(),
    removeCartItems: removeCartItemsDependency = removeCartItems,
    resetCheckoutAttempt: resetCheckoutAttemptDependency = resetStoredCheckoutAttempt,
  } = dependencies;
  const elements = createFixtureMarkup(root);
  const actionButtons = [elements.holderButton, elements.contenderButton, elements.clearButton];
  let busy = false;

  function renderError(message = '') {
    elements.errorElement.textContent = message;
    elements.errorElement.hidden = !message;
  }

  function renderCanaryBasket() {
    const canaryItems = getCanaryItems(getCartDependency());

    elements.stateList.replaceChildren();

    if (canaryItems.length === 0) {
      const emptyItem = (root.ownerDocument || document).createElement('li');
      emptyItem.textContent = 'Canary basket is empty.';
      elements.stateList.appendChild(emptyItem);
      return;
    }

    canaryItems.forEach((item) => {
      const itemElement = (root.ownerDocument || document).createElement('li');
      itemElement.setAttribute('data-checkout-canary-item', 'true');
      itemElement.setAttribute('data-checkout-canary-sku', item.sku);
      itemElement.setAttribute('data-checkout-canary-quantity', String(item.quantity));
      itemElement.textContent = `${item.sku} × ${item.quantity}`;
      elements.stateList.appendChild(itemElement);
    });
  }

  function setBusy(nextBusy) {
    busy = nextBusy;
    elements.fixture.setAttribute('aria-busy', String(busy));

    actionButtons.forEach((button) => {
      button.disabled = busy;
    });
  }

  function removeCurrentCanaryItems() {
    const canarySkus = getCanaryItems(getCartDependency()).map((item) => item.sku);

    if (canarySkus.length > 0) {
      removeCartItemsDependency(canarySkus);
    }
  }

  async function runAction(action) {
    if (busy) return;

    setBusy(true);
    renderError();

    try {
      await action();
      refreshCartUiDependency();
      renderCanaryBasket();
      setBusy(false);
      reloadCheckout();
    } catch (error) {
      console.error('Checkout canary fixture failed:', error);
      refreshCartUiDependency();
      renderCanaryBasket();
      renderError(error.message || 'The canary basket could not be updated.');
      setBusy(false);
    }
  }

  async function loadFixture(fixtureName) {
    const fixtureSkus = FIXTURES[fixtureName];

    if (!fixtureSkus || fixtureSkus.some((sku) => !isCanarySku(sku))) {
      throw new Error('The requested canary fixture is not permitted.');
    }

    assertCanaryOnlyCart(getCartDependency());

    const products = await Promise.all(
      fixtureSkus.map((sku) => getActiveProductBySkuDependency(sku))
    );

    products.forEach((product, index) => {
      assertResolvedProduct(product, fixtureSkus[index]);
    });

    removeCurrentCanaryItems();

    products.forEach((product) => {
      addCartItemDependency({ product, selectedVariant: null }, 1);
    });
  }

  async function clearFixture() {
    assertCanaryOnlyCart(getCartDependency());

    const reset = await resetCheckoutAttemptDependency();

    if (reset?.status === 'already_paid') {
      throw new Error('A paid checkout cannot be cleared from the canary fixture.');
    }

    removeCurrentCanaryItems();
  }

  elements.holderButton.addEventListener('click', () => runAction(() => loadFixture('holder')));
  elements.contenderButton.addEventListener('click', () =>
    runAction(() => loadFixture('contender'))
  );
  elements.clearButton.addEventListener('click', () => runAction(clearFixture));

  renderCanaryBasket();
  setBusy(false);

  return Object.freeze({ render: renderCanaryBasket });
}
