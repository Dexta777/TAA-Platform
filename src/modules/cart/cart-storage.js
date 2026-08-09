const CART_STORAGE_KEY = 'taa_cart';

export function loadCart() {
  try {
    const storedCart = localStorage.getItem(CART_STORAGE_KEY);

    if (storedCart === null) return [];

    const cart = JSON.parse(storedCart);

    if (!Array.isArray(cart)) {
      console.error('Cart storage contained invalid data; expected an array.');
      return [];
    }

    return cart;
  } catch (error) {
    console.error('Cart storage could not be read; the stored cart was ignored.', error);
    return [];
  }
}

export function saveCart(cart) {
  if (!Array.isArray(cart)) {
    throw new TypeError('Cart storage requires an array.');
  }

  try {
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart));
  } catch (error) {
    console.error('Cart storage could not be saved.', error);
    throw new Error('Unable to save the cart.', { cause: error });
  }
}

export function clearCart() {
  try {
    localStorage.removeItem(CART_STORAGE_KEY);
  } catch (error) {
    console.error('Cart storage could not be cleared.', error);
    throw new Error('Unable to clear the cart.', { cause: error });
  }
}
