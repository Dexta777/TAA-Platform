import {
  exchangeCodeForSession,
  getSession,
  getUser,
  onAuthStateChange,
  resetPasswordForEmail,
  signInWithPassword,
  signOut,
  signUp,
  updatePassword,
} from '../../services/supabase/auth.js';

const ACCOUNT_PATH = '/account';
const AUTH_PATH_MODES = Object.freeze({
  '/log-in': 'login',
  '/reset-password': 'reset-password',
  '/sign-up': 'signup',
});
const AUTH_MODES = new Set(['login', 'reset-password', 'signup', 'update-password']);
const AUTH_EVENTS_REQUIRING_RESOLUTION = new Set(['SIGNED_IN', 'TOKEN_REFRESHED', 'USER_UPDATED']);
const PROTECTED_ACCOUNT_SELECTOR = '[data-account-content], [data-account-panel]';
const AUTH_FOCUSABLE_SELECTOR = [
  '[data-auth-field]',
  '[data-auth-submit]',
  '[data-auth-toggle]',
  '[data-auth-close]',
  '[data-auth-focusable]',
].join(', ');
const GENERIC_RECOVERY_MESSAGE =
  'If an account exists for that email address, password recovery instructions will be sent.';
const INVALID_CALLBACK_MESSAGE =
  'This authentication link is invalid or has expired. Please request a new link.';

export const AUTH_STATES = Object.freeze({
  AUTHENTICATED: 'authenticated',
  ERROR: 'error',
  GUEST: 'guest',
  LOADING: 'loading',
});

const defaultDependencies = Object.freeze({
  exchangeCodeForSession,
  getSession,
  getUser,
  onAuthStateChange,
  resetPasswordForEmail,
  signInWithPassword,
  signOut,
  signUp,
  updatePassword,
});

let authControllerPromise = null;

function normalizePathname(pathname) {
  return String(pathname || '/').replace(/\/+$/, '') || '/';
}

function getLocationOrigin(location) {
  if (typeof location?.origin === 'string' && location.origin) return location.origin;

  try {
    return new URL(location?.href).origin;
  } catch {
    return '';
  }
}

export function isAllowedAuthRedirect(
  value,
  { origin = globalThis.window?.location?.origin } = {}
) {
  if (typeof value !== 'string' || value !== ACCOUNT_PATH || !origin) return false;

  try {
    const url = new URL(value, origin);
    return (
      url.origin === origin &&
      url.pathname === ACCOUNT_PATH &&
      !url.search &&
      !url.hash &&
      !value.includes('%')
    );
  } catch {
    return false;
  }
}

export function getSafeAuthRedirect(value, options) {
  return isAllowedAuthRedirect(value, options) ? value : ACCOUNT_PATH;
}

function getAccountRedirectUrl(location) {
  const origin = getLocationOrigin(location);
  return origin ? `${origin}${ACCOUNT_PATH}` : ACCOUNT_PATH;
}

function hideProtectedAccountContent(root) {
  root.querySelectorAll(PROTECTED_ACCOUNT_SELECTOR).forEach((element) => {
    element.hidden = true;
  });
}

function showAccountShell(root) {
  root.querySelectorAll('[data-account-content]').forEach((element) => {
    element.hidden = false;
  });

  // Account panels remain deliberately unavailable until their later feature phases.
  root.querySelectorAll('[data-account-panel]').forEach((element) => {
    element.hidden = true;
  });
}

function setAuthElementVisible(element, visible) {
  element.hidden = !visible;

  const visibleDisplay = element.getAttribute?.('data-auth-display');
  if (visibleDisplay && element.style) {
    element.style.display = visible ? visibleDisplay : 'none';
  }
}

function setStateViews(root, state) {
  root.querySelectorAll('[data-auth-view]').forEach((element) => {
    setAuthElementVisible(element, element.getAttribute('data-auth-view') === state);
  });
}

function setAccountRootState(root, state, { recovery = false } = {}) {
  root.dataset.authState = state;
  root.dataset.authRecovery = String(recovery);
  root.setAttribute('aria-busy', String(state === AUTH_STATES.LOADING));
  setStateViews(root, state);

  if (state === AUTH_STATES.AUTHENTICATED && !recovery) {
    showAccountShell(root);
    return;
  }

  hideProtectedAccountContent(root);
}

function setAuthControlRootState(root, state) {
  root.dataset.authState = state;
  root.setAttribute('aria-busy', String(state === AUTH_STATES.LOADING));
  setStateViews(root, state);
}

function setAuthRootVisible(root, visible) {
  root.dataset.authVisible = String(visible);
  setAuthElementVisible(root, visible);
  root.inert = !visible;
  root.setAttribute('aria-hidden', String(!visible));
}

function prepareDialog(root) {
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('role', 'dialog');

  if (!root.hasAttribute('tabindex')) {
    root.setAttribute('tabindex', '-1');
  }
}

function setAuthRootMode(root, mode) {
  const normalizedMode = AUTH_MODES.has(mode) ? mode : 'login';
  root.dataset.authMode = normalizedMode;

  root.querySelectorAll('[data-auth-form], [data-auth-panel]').forEach((element) => {
    const elementMode =
      element.getAttribute('data-auth-form') || element.getAttribute('data-auth-panel');
    setAuthElementVisible(element, elementMode === normalizedMode);
  });

  return normalizedMode;
}

function setMessage(root, selector, message) {
  root?.querySelectorAll(selector).forEach((element) => {
    element.textContent = message;
    element.hidden = !message;
  });
}

function clearMessages(root) {
  setMessage(root, '[data-auth-error]', '');
  setMessage(root, '[data-auth-status]', '');
}

function prepareMessageRegions(root) {
  root.querySelectorAll('[data-auth-status]').forEach((element) => {
    element.setAttribute('aria-live', 'polite');
    element.setAttribute('role', 'status');
  });
  root.querySelectorAll('[data-auth-error]').forEach((element) => {
    element.setAttribute('aria-live', 'assertive');
    element.setAttribute('role', 'alert');
  });
}

function setFormBusy(form, busy) {
  form.setAttribute('aria-busy', String(busy));
  form.querySelectorAll('[data-auth-submit]').forEach((button) => {
    button.disabled = busy;
  });
}

function getField(form, fieldName) {
  const field = form.querySelector(`[data-auth-field="${fieldName}"]`);
  return typeof field?.value === 'string' ? field.value : '';
}

function clearPasswordFields(document) {
  document
    .querySelectorAll('[data-auth-field="password"], [data-auth-field="confirm-password"]')
    .forEach((field) => {
      field.value = '';
    });
}

function getAuthRoot(element) {
  return element?.closest?.('[data-auth-root]') || null;
}

function isWithinRoot(root, element) {
  let currentElement = element;

  while (currentElement) {
    if (currentElement === root) return true;
    currentElement = currentElement.parentElement || currentElement.parentNode || null;
  }

  return false;
}

function isFocusableWithinRoot(root, element) {
  if (!element || element.disabled || !isWithinRoot(root, element)) return false;

  let currentElement = element;

  while (currentElement && currentElement !== root) {
    if (currentElement.hidden || currentElement.getAttribute?.('aria-hidden') === 'true') {
      return false;
    }

    currentElement = currentElement.parentElement || currentElement.parentNode || null;
  }

  return !root.hidden;
}

function getFocusableElements(root) {
  return Array.from(root.querySelectorAll(AUTH_FOCUSABLE_SELECTOR)).filter((element) =>
    isFocusableWithinRoot(root, element)
  );
}

function focusFirstField(root, mode) {
  const form = root.querySelector(`[data-auth-form="${mode}"]`);
  const field = form?.querySelector?.('[data-auth-field]');
  const focusTarget = field || getFocusableElements(root)[0] || root;
  focusTarget?.focus?.({ preventScroll: true });
}

export function createAuthController({
  authCallback = null,
  dependencies = {},
  document = globalThis.document,
  history = globalThis.window?.history,
  location = globalThis.window?.location,
} = {}) {
  if (!document?.querySelectorAll) {
    throw new TypeError('A document is required to initialize Auth.');
  }

  const services = Object.freeze({ ...defaultDependencies, ...dependencies });
  const accountRoots = Array.from(document.querySelectorAll('[data-account-root="true"]'));
  const authControlRoots = Array.from(document.querySelectorAll('[data-auth-controls="true"]'));
  const authRoots = Array.from(document.querySelectorAll('[data-auth-root]'));
  const pathname = normalizePathname(location?.pathname);
  let currentState = AUTH_STATES.LOADING;
  let currentSession = null;
  let currentUser = null;
  let destroyed = false;
  let initializationPromise = null;
  let processingCallback = false;
  let previouslyFocusedElement = null;
  let recoveryActive = false;
  let resolutionSequence = 0;
  let subscription = null;
  const submittingForms = new WeakSet();

  function renderState() {
    accountRoots.forEach((root) => {
      setAccountRootState(root, currentState, { recovery: recoveryActive });
    });

    authControlRoots.forEach((root) => {
      setAuthControlRootState(root, currentState);
    });

    authRoots.forEach((root) => {
      root.dataset.authSessionState = currentState;
      setStateViews(root, currentState);
    });
  }

  function setAuthTriggersExpanded(expanded) {
    document.querySelectorAll('[data-auth-open]').forEach((trigger) => {
      trigger.setAttribute('aria-expanded', String(expanded));
    });
  }

  function openAuthMode(mode = 'login', { invoker = null } = {}) {
    if (authRoots.length === 0) return;

    const wasVisible = authRoots.some((root) => root.dataset.authVisible === 'true');

    if (!wasVisible) {
      previouslyFocusedElement = invoker || document.activeElement || null;
    }

    authRoots.forEach((root) => {
      setAuthRootMode(root, mode);
      setAuthRootVisible(root, true);
    });

    const normalizedMode = authRoots[0].dataset.authMode;
    setAuthTriggersExpanded(true);
    focusFirstField(authRoots[0], normalizedMode);
  }

  function closeAuthModal() {
    if (recoveryActive) return false;

    authRoots.forEach((root) => setAuthRootVisible(root, false));
    setAuthTriggersExpanded(false);

    const focusTarget = previouslyFocusedElement;
    previouslyFocusedElement = null;
    focusTarget?.focus?.({ preventScroll: true });
    return true;
  }

  function handleModalKeydown(event) {
    const visibleRoot = authRoots.find((root) => root.dataset.authVisible === 'true');

    if (!visibleRoot) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      closeAuthModal();
      return;
    }

    if (event.key !== 'Tab') return;

    const focusableElements = getFocusableElements(visibleRoot);

    if (focusableElements.length === 0) {
      event.preventDefault();
      visibleRoot.focus?.({ preventScroll: true });
      return;
    }

    const firstElement = focusableElements[0];
    const lastElement = focusableElements.at(-1);
    const activeElement = document.activeElement;

    if (
      event.shiftKey &&
      (activeElement === firstElement || !isWithinRoot(visibleRoot, activeElement))
    ) {
      event.preventDefault();
      lastElement.focus?.({ preventScroll: true });
      return;
    }

    if (
      !event.shiftKey &&
      (activeElement === lastElement || !isWithinRoot(visibleRoot, activeElement))
    ) {
      event.preventDefault();
      firstElement.focus?.({ preventScroll: true });
    }
  }

  function transition(state, { recovery = false, session = null, user = null } = {}) {
    currentState = state;
    recoveryActive = recovery;
    currentSession = state === AUTH_STATES.AUTHENTICATED ? session : null;
    currentUser = state === AUTH_STATES.AUTHENTICATED ? user : null;
    renderState();

    if (recoveryActive) {
      openAuthMode('update-password');
      return;
    }

    if (state === AUTH_STATES.GUEST && pathname === ACCOUNT_PATH) {
      openAuthMode('login');
      return;
    }

    if (state === AUTH_STATES.AUTHENTICATED) {
      closeAuthModal();
    }
  }

  function showError(message) {
    authRoots.forEach((root) => setMessage(root, '[data-auth-error]', message));
    accountRoots.forEach((root) => setMessage(root, '[data-auth-error]', message));
  }

  function showStatus(message) {
    authRoots.forEach((root) => setMessage(root, '[data-auth-status]', message));
    accountRoots.forEach((root) => setMessage(root, '[data-auth-status]', message));
  }

  function clearAllMessages() {
    authRoots.forEach(clearMessages);
    accountRoots.forEach(clearMessages);
  }

  function navigateAfterAuthentication() {
    const nextValue = (() => {
      try {
        return new URL(location.href).searchParams.get('next');
      } catch {
        return null;
      }
    })();
    const destination = getSafeAuthRedirect(nextValue, { origin: getLocationOrigin(location) });

    if (pathname !== normalizePathname(destination)) {
      location?.assign?.(destination);
    }
  }

  async function resolveSession({ recovery = recoveryActive, showLoading = false } = {}) {
    const sequence = ++resolutionSequence;

    if (showLoading) {
      transition(AUTH_STATES.LOADING, { recovery });
    }

    try {
      const { session } = await services.getSession();

      if (destroyed || sequence !== resolutionSequence) return currentState;

      if (!session) {
        transition(AUTH_STATES.GUEST);
        return currentState;
      }

      const { user } = await services.getUser();

      if (destroyed || sequence !== resolutionSequence) return currentState;

      if (!user) {
        transition(AUTH_STATES.GUEST);
        return currentState;
      }

      transition(AUTH_STATES.AUTHENTICATED, { recovery, session, user });

      if (!recovery && AUTH_PATH_MODES[pathname]) {
        navigateAfterAuthentication();
      }

      return currentState;
    } catch {
      if (!destroyed && sequence === resolutionSequence) {
        transition(AUTH_STATES.ERROR);
        showError('Your account session could not be verified. Please try again.');
      }

      return currentState;
    }
  }

  function handleAuthStateChange({ event }) {
    if (destroyed || processingCallback) return;

    if (event === 'SIGNED_OUT') {
      resolutionSequence += 1;
      clearPasswordFields(document);
      transition(AUTH_STATES.GUEST);
      return;
    }

    if (event === 'PASSWORD_RECOVERY') {
      recoveryActive = true;
      renderState();
      openAuthMode('update-password');
      void resolveSession({ recovery: true });
      return;
    }

    if (AUTH_EVENTS_REQUIRING_RESOLUTION.has(event)) {
      void resolveSession({ showLoading: true });
    }
  }

  async function processAuthCallback() {
    if (!authCallback) return false;

    if (!authCallback.allowed || authCallback.error || authCallback.invalid || !authCallback.code) {
      transition(AUTH_STATES.ERROR);
      showError(INVALID_CALLBACK_MESSAGE);
      return true;
    }

    processingCallback = true;

    try {
      const result = await services.exchangeCodeForSession({
        code: authCallback.code,
        flowId: authCallback.flowId,
      });
      const recovery = authCallback.recovery || result.redirectType === 'recovery';
      processingCallback = false;
      await resolveSession({ recovery, showLoading: true });
    } catch {
      processingCallback = false;
      transition(AUTH_STATES.ERROR);
      showError(INVALID_CALLBACK_MESSAGE);
    }

    return true;
  }

  async function handleLogin(form) {
    const result = await services.signInWithPassword({
      email: getField(form, 'email').trim(),
      password: getField(form, 'password'),
    });

    if (!result.session || !result.user) {
      throw new Error('The Auth server did not return a signed-in session.');
    }

    clearPasswordFields(document);
    transition(AUTH_STATES.AUTHENTICATED, {
      session: result.session,
      user: result.user,
    });
    navigateAfterAuthentication();
  }

  async function handleSignup(form) {
    const result = await services.signUp({
      email: getField(form, 'email').trim(),
      emailRedirectTo: getAccountRedirectUrl(location),
      firstName: getField(form, 'first-name').trim(),
      lastName: getField(form, 'last-name').trim(),
      password: getField(form, 'password'),
    });

    clearPasswordFields(document);

    if (result.session && result.user) {
      transition(AUTH_STATES.AUTHENTICATED, {
        session: result.session,
        user: result.user,
      });
      navigateAfterAuthentication();
      return;
    }

    showStatus('Check your email to confirm your account, then sign in.');
  }

  async function handleResetPassword(form) {
    try {
      await services.resetPasswordForEmail({
        email: getField(form, 'email').trim(),
        redirectTo: getAccountRedirectUrl(location),
      });
    } catch {
      // The public response deliberately remains identical for existing and unknown accounts.
    }

    showStatus(GENERIC_RECOVERY_MESSAGE);
  }

  async function handleUpdatePassword(form) {
    if (!recoveryActive || currentState !== AUTH_STATES.AUTHENTICATED) {
      throw new Error('A verified password recovery session is required.');
    }

    const password = getField(form, 'password');
    const confirmationField = form.querySelector('[data-auth-field="confirm-password"]');

    if (confirmationField && password !== confirmationField.value) {
      showError('The passwords do not match.');
      return;
    }

    const result = await services.updatePassword({ password });
    recoveryActive = false;
    clearPasswordFields(document);
    transition(AUTH_STATES.AUTHENTICATED, {
      session: currentSession,
      user: result.user || currentUser,
    });
    showStatus('Your password has been updated.');
    history?.replaceState?.(history.state, '', ACCOUNT_PATH);
    navigateAfterAuthentication();
  }

  async function handleFormSubmit(form, event) {
    event.preventDefault();

    if (submittingForms.has(form)) return;

    submittingForms.add(form);
    const root = getAuthRoot(form);
    const mode = form.getAttribute('data-auth-form');
    clearAllMessages();
    setFormBusy(form, true);

    try {
      if (mode === 'login') {
        await handleLogin(form);
      } else if (mode === 'signup') {
        await handleSignup(form);
      } else if (mode === 'reset-password') {
        await handleResetPassword(form);
      } else if (mode === 'update-password') {
        await handleUpdatePassword(form);
      }
    } catch {
      if (mode === 'login') {
        setMessage(root, '[data-auth-error]', 'Email or password not recognized.');
      } else if (mode === 'signup') {
        setMessage(
          root,
          '[data-auth-error]',
          'Account creation could not be completed. Please check your details and try again.'
        );
      } else if (mode === 'update-password') {
        setMessage(
          root,
          '[data-auth-error]',
          'Your password could not be updated. Please request a new recovery link.'
        );
      }
    } finally {
      setFormBusy(form, false);
      submittingForms.delete(form);
    }
  }

  async function handleLogout(event) {
    event.preventDefault();
    resolutionSequence += 1;
    clearAllMessages();
    clearPasswordFields(document);
    transition(AUTH_STATES.GUEST);

    try {
      await services.signOut();
    } catch {
      showError('Your local account view has been cleared. Sign out could not be confirmed.');
    }
  }

  function bindUi() {
    accountRoots.forEach((root) => {
      prepareMessageRegions(root);
      hideProtectedAccountContent(root);
    });

    authControlRoots.forEach((root) => {
      setAuthControlRootState(root, AUTH_STATES.LOADING);
    });

    authRoots.forEach((root) => {
      prepareDialog(root);
      prepareMessageRegions(root);
      setAuthRootMode(root, root.dataset.authMode || 'login');
      setAuthRootVisible(root, false);
    });

    document.querySelectorAll('[data-auth-open]').forEach((trigger) => {
      trigger.setAttribute('aria-expanded', 'false');
      trigger.setAttribute('aria-haspopup', 'dialog');
    });

    document.querySelectorAll('[data-auth-form]').forEach((form) => {
      form.addEventListener('submit', (event) => handleFormSubmit(form, event));
    });

    document.querySelectorAll('[data-auth-open]').forEach((button) => {
      button.addEventListener('click', (event) => {
        event.preventDefault();
        openAuthMode(button.getAttribute('data-auth-open') || 'login', { invoker: button });
      });
    });

    document.querySelectorAll('[data-auth-toggle]').forEach((button) => {
      button.addEventListener('click', (event) => {
        event.preventDefault();
        clearAllMessages();
        openAuthMode(button.getAttribute('data-auth-toggle') || 'login');
      });
    });

    document.querySelectorAll('[data-auth-close]').forEach((button) => {
      button.addEventListener('click', (event) => {
        event.preventDefault();
        closeAuthModal();
      });
    });

    document.querySelectorAll('[data-auth-logout]').forEach((button) => {
      button.addEventListener('click', handleLogout);
    });

    document.addEventListener('keydown', handleModalKeydown);
  }

  async function initialize() {
    if (initializationPromise) return initializationPromise;

    initializationPromise = (async () => {
      bindUi();
      transition(AUTH_STATES.LOADING);

      const pathMode = AUTH_PATH_MODES[pathname];

      if (pathMode) {
        openAuthMode(pathMode);
      }

      try {
        subscription = services.onAuthStateChange(handleAuthStateChange);
      } catch {
        transition(AUTH_STATES.ERROR);
        showError('Authentication could not be initialized. Please reload the page.');
        return controller;
      }

      if (!(await processAuthCallback())) {
        await resolveSession({ showLoading: true });
      }

      return controller;
    })();

    return initializationPromise;
  }

  const controller = Object.freeze({
    destroy() {
      destroyed = true;
      resolutionSequence += 1;
      subscription?.unsubscribe();
      subscription = null;
      clearPasswordFields(document);
      transition(AUTH_STATES.GUEST);
    },
    getState() {
      return Object.freeze({
        recovery: recoveryActive,
        session: currentSession,
        state: currentState,
        user: currentUser,
      });
    },
    initialize,
    open(mode = 'login') {
      openAuthMode(mode);
    },
    signOut: handleLogout,
  });

  return controller;
}

export function initAuth(options = {}) {
  if (!authControllerPromise) {
    const controller = createAuthController(options);
    authControllerPromise = controller.initialize().then(() => controller);
  }

  return authControllerPromise;
}
