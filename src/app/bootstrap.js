import { initCartUi } from '../modules/cart/cart-ui.js';

const ACCOUNT_PATH = '/account';
const AUTH_PATHS = new Set(['/log-in', '/sign-up', '/reset-password']);
export const AUTH_CALLBACK_HANDOFF_EVENT = 'taa:auth-callback-handoff';
const AUTH_CALLBACK_HANDOFF_VERSION = 1;
const AUTH_CALLBACK_HANDOFF_MAX_AGE_MS = 5 * 60 * 1000;
const AUTH_CALLBACK_FAILURE_QUERY_KEY = 'taa_auth_callback';
const AUTH_CALLBACK_FAILURE_QUERY_VALUE = 'unavailable';
const AUTH_CALLBACK_CODE_MAX_LENGTH = 4096;
const AUTH_CALLBACK_QUERY_KEYS = [
  'code',
  'error',
  'error_code',
  'error_description',
  'sb_flow_id',
  'type',
  AUTH_CALLBACK_FAILURE_QUERY_KEY,
];
const AUTH_CALLBACK_HASH_TOKEN_KEYS = [
  'access_token',
  'provider_refresh_token',
  'provider_token',
  'refresh_token',
];
const AUTH_CALLBACK_ERROR_KEYS = ['error', 'error_code', 'error_description'];
const SAFE_PKCE_FLOW_ID = /^[a-zA-Z0-9_-]{8,64}$/;
const PROTECTED_ACCOUNT_SELECTOR = '[data-account-content], [data-account-panel]';
const AUTH_SURFACE_SELECTOR =
  '[data-account-root="true"], [data-auth-controls="true"], [data-auth-root]';

let bootstrapPromise = null;
let capturedAuthCallback = null;

function normalizePathname(pathname) {
  return String(pathname || '/').replace(/\/+$/, '') || '/';
}

function getCallbackUrl(locationObject) {
  if (typeof locationObject?.href !== 'string') return null;

  try {
    return new URL(locationObject.href);
  } catch {
    return null;
  }
}

function hasAnyParameter(parameters, keys) {
  return keys.some((key) => parameters.has(key));
}

function createInvalidAuthCallback() {
  return Object.freeze({
    allowed: true,
    code: null,
    error: false,
    flowId: null,
    invalid: true,
    recovery: false,
  });
}

function normalizeAuthCallbackHandoff(value, now) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return createInvalidAuthCallback();
  }

  const capturedAt = Number(value.capturedAt);
  const isFresh =
    Number.isFinite(capturedAt) &&
    capturedAt <= now &&
    now - capturedAt <= AUTH_CALLBACK_HANDOFF_MAX_AGE_MS;
  const code =
    typeof value.code === 'string' &&
    value.code.length > 0 &&
    value.code.length <= AUTH_CALLBACK_CODE_MAX_LENGTH
      ? value.code
      : null;
  const flowId =
    typeof value.flowId === 'string' && SAFE_PKCE_FLOW_ID.test(value.flowId) ? value.flowId : null;
  const error = value.error === true;
  const invalidFlowId = value.flowId !== null && value.flowId !== undefined && !flowId;
  const invalid = value.invalid === true || invalidFlowId;

  if (
    value.version !== AUTH_CALLBACK_HANDOFF_VERSION ||
    value.allowed !== true ||
    !isFresh ||
    (!code && !error && !invalid)
  ) {
    return createInvalidAuthCallback();
  }

  return Object.freeze({
    allowed: true,
    code,
    error,
    flowId,
    invalid,
    recovery: value.recovery === true,
  });
}

export function captureAuthCallbackFromUrl({ location, history }) {
  const url = getCallbackUrl(location);

  if (!url) return null;

  if (normalizePathname(url.pathname) !== ACCOUNT_PATH) return null;

  const hashParameters = new URLSearchParams(url.hash.replace(/^#/, ''));
  const hasQueryCode = url.searchParams.has('code');
  const hasQueryError = hasAnyParameter(url.searchParams, AUTH_CALLBACK_ERROR_KEYS);
  const hasHashToken = hasAnyParameter(hashParameters, AUTH_CALLBACK_HASH_TOKEN_KEYS);
  const hasHashError = hasAnyParameter(hashParameters, AUTH_CALLBACK_ERROR_KEYS);
  const handoffUnavailable =
    url.searchParams.get(AUTH_CALLBACK_FAILURE_QUERY_KEY) === AUTH_CALLBACK_FAILURE_QUERY_VALUE;
  const hasQueryCallback = hasQueryCode || hasQueryError || handoffUnavailable;
  const hasHashCallback = hasHashToken || hasHashError;

  if (!hasQueryCallback && !hasHashCallback) return null;

  const code = url.searchParams.get('code');
  const flowId = url.searchParams.get('sb_flow_id');
  const normalizedCode =
    typeof code === 'string' && code.length > 0 && code.length <= AUTH_CALLBACK_CODE_MAX_LENGTH
      ? code
      : null;
  const normalizedFlowId = flowId && SAFE_PKCE_FLOW_ID.test(flowId) ? flowId : null;
  const callback = Object.freeze({
    allowed: true,
    code: normalizedCode,
    error: hasQueryError || hasHashError,
    flowId: normalizedFlowId,
    invalid:
      handoffUnavailable ||
      hasHashToken ||
      (hasQueryCode && !normalizedCode) ||
      (flowId !== null && !normalizedFlowId),
    recovery:
      url.searchParams.get('type') === 'recovery' || hashParameters.get('type') === 'recovery',
  });

  AUTH_CALLBACK_QUERY_KEYS.forEach((key) => url.searchParams.delete(key));

  if (hasHashToken || hasHashError) {
    url.hash = '';
  }

  history?.replaceState?.(
    history.state,
    '',
    `${url.pathname}${url.search}${url.hash}` || ACCOUNT_PATH
  );

  return callback;
}

export function captureAuthCallback({
  location = globalThis.window?.location,
  history = globalThis.window?.history,
} = {}) {
  const callback = captureAuthCallbackFromUrl({ location, history });

  if (callback) {
    capturedAuthCallback = callback;
  }

  return callback;
}

export function consumeAuthCallbackHandoff({
  location = globalThis.window?.location,
  now = Date.now(),
  windowObject = globalThis.window,
} = {}) {
  const CustomEventConstructor = windowObject?.CustomEvent;

  if (typeof windowObject?.dispatchEvent !== 'function' || !CustomEventConstructor) {
    return null;
  }

  let receivedCallback = null;

  try {
    windowObject.dispatchEvent(
      new CustomEventConstructor(AUTH_CALLBACK_HANDOFF_EVENT, {
        detail: {
          receive(value) {
            if (receivedCallback === null) receivedCallback = value;
          },
        },
      })
    );
  } catch {
    return null;
  }

  if (receivedCallback === null) return null;

  if (normalizePathname(location?.pathname) !== ACCOUNT_PATH) return null;

  const callback = normalizeAuthCallbackHandoff(receivedCallback, Number(now));
  capturedAuthCallback = callback;
  return callback;
}

export function consumeCapturedAuthCallback() {
  const callback = capturedAuthCallback;
  capturedAuthCallback = null;
  return callback;
}

function captureProtectedVisibility(element) {
  element.hidden = true;

  if (element.getAttribute?.('data-auth-display') && element.style) {
    element.style.display = 'none';
  }
}

export function prepareAuthSurface({ document = globalThis.document } = {}) {
  if (!document?.querySelectorAll) return;

  document.querySelectorAll('[data-account-root="true"]').forEach((root) => {
    root.dataset.authState = 'loading';
    root.dataset.authRecovery = 'false';
    root.setAttribute('aria-busy', 'true');
    root.querySelectorAll(PROTECTED_ACCOUNT_SELECTOR).forEach(captureProtectedVisibility);
  });

  document.querySelectorAll('[data-auth-controls="true"]').forEach((root) => {
    root.dataset.authState = 'loading';
    root.setAttribute('aria-busy', 'true');
    root.querySelectorAll('[data-auth-view]').forEach(captureProtectedVisibility);
  });

  document.querySelectorAll('[data-auth-root]').forEach((root) => {
    root.dataset.authMode ||= 'login';
    root.dataset.authSessionState = 'loading';
    root.dataset.authVisible = 'false';
    root.hidden = true;
    if (root.getAttribute?.('data-auth-display') && root.style) {
      root.style.display = 'none';
    }
    root.setAttribute('aria-hidden', 'true');
  });
}

export function shouldInitializeAuth({ document, pathname, authCallback = null }) {
  const normalizedPathname = normalizePathname(pathname);

  return Boolean(
    authCallback ||
    normalizedPathname === ACCOUNT_PATH ||
    AUTH_PATHS.has(normalizedPathname) ||
    document?.querySelector?.(AUTH_SURFACE_SELECTOR)
  );
}

export async function initializeAuthSurface({
  document = globalThis.document,
  pathname = globalThis.window?.location?.pathname,
  authCallback = null,
  loadAuthModule = () => import('../modules/account/auth.js'),
} = {}) {
  prepareAuthSurface({ document });

  if (!shouldInitializeAuth({ document, pathname, authCallback })) return null;

  const { initAuth } = await loadAuthModule();
  return initAuth({ authCallback, document });
}

async function runBootstrap() {
  prepareAuthSurface();
  initCartUi();

  const initializers = [];
  const checkoutRoot = document.querySelector('[data-checkout-root="true"]');
  const normalizedPathname = normalizePathname(window.location.pathname);
  const authCallback = consumeCapturedAuthCallback();

  if (shouldInitializeAuth({ document, pathname: normalizedPathname, authCallback })) {
    initializers.push(
      (async () => {
        try {
          await initializeAuthSurface({
            authCallback,
            document,
            pathname: normalizedPathname,
          });
        } catch {
          console.error('Authentication initialization failed.');
        }
      })()
    );
  }

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
