import assert from 'node:assert/strict';
import { createServer as createHttpServer } from 'node:http';
import process from 'node:process';
import test from 'node:test';
import { createServer } from 'vite';

process.env.VITE_SUPABASE_URL = 'https://example.supabase.co';
process.env.VITE_SUPABASE_PUBLISHABLE_KEY = 'test-publishable-key';

const hmrServer = createHttpServer();
const viteServer = await createServer({
  appType: 'custom',
  server: { middlewareMode: true, ws: { server: hmrServer } },
});
const { AUTH_STATES, createAuthController, getSafeAuthRedirect, isAllowedAuthRedirect } =
  await viteServer.ssrLoadModule('/src/modules/account/auth.js');

test.after(async () => {
  await viteServer.close();
});

function toDatasetKey(attributeName) {
  return attributeName
    .replace(/^data-/, '')
    .split('-')
    .map((part, index) => (index === 0 ? part : `${part[0].toUpperCase()}${part.slice(1)}`))
    .join('');
}

class FakeElement {
  constructor(tagName = 'div', attributes = {}) {
    this.attributes = new Map(Object.entries(attributes));
    this.children = [];
    this.dataset = {};
    this.disabled = false;
    this.focused = false;
    this.hidden = false;
    this.inert = false;
    this.listeners = new Map();
    this.ownerDocument = null;
    this.parentNode = null;
    this.style = { display: '' };
    this.tagName = tagName.toLowerCase();
    this.textContent = '';
    this.value = '';

    Object.entries(attributes).forEach(([name, value]) => {
      if (name.startsWith('data-')) this.dataset[toDatasetKey(name)] = value;
    });
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  appendChild(child) {
    child.ownerDocument = this.ownerDocument;
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  closest(selector) {
    let current = this;

    while (current) {
      if (current.matches(selector)) return current;
      current = current.parentNode;
    }

    return null;
  }

  async dispatch(type, overrides = {}) {
    const event = {
      defaultPrevented: false,
      shiftKey: false,
      ...overrides,
      preventDefault() {
        this.defaultPrevented = true;
      },
      target: overrides.target || this,
      type,
    };

    for (const listener of this.listeners.get(type) || []) {
      await listener(event);
    }

    return event;
  }

  focus() {
    if (this.ownerDocument?.activeElement) {
      this.ownerDocument.activeElement.focused = false;
    }

    this.focused = true;
    if (this.ownerDocument) this.ownerDocument.activeElement = this;
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  hasAttribute(name) {
    return this.attributes.has(name);
  }

  matches(selector) {
    const valueMatch = selector.match(/^\[([^=]+)="([^"]+)"\]$/);
    if (valueMatch) return this.attributes.get(valueMatch[1]) === valueMatch[2];

    const presenceMatch = selector.match(/^\[([^=]+)\]$/);
    return Boolean(presenceMatch && this.attributes.has(presenceMatch[1]));
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    if (selector.includes(',')) {
      return Array.from(
        new Set(selector.split(',').flatMap((part) => this.querySelectorAll(part.trim())))
      );
    }

    const matches = [];

    this.children.forEach((child) => {
      if (child.matches(selector)) matches.push(child);
      matches.push(...child.querySelectorAll(selector));
    });

    return matches;
  }

  setAttribute(name, value) {
    const stringValue = String(value);
    this.attributes.set(name, stringValue);
    if (name.startsWith('data-')) this.dataset[toDatasetKey(name)] = stringValue;
  }
}

class FakeDocument {
  constructor() {
    this.body = new FakeElement('body');
    this.body.ownerDocument = this;
    this.activeElement = this.body;
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  async dispatch(type, overrides = {}) {
    const event = {
      defaultPrevented: false,
      shiftKey: false,
      ...overrides,
      preventDefault() {
        this.defaultPrevented = true;
      },
      target: overrides.target || this.activeElement,
      type,
    };

    for (const listener of this.listeners.get(type) || []) {
      await listener(event);
    }

    return event;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    return this.body.querySelectorAll(selector);
  }
}

function appendForm(authRoot, mode, fieldNames) {
  const form = authRoot.appendChild(
    new FakeElement('form', {
      'data-auth-display': 'flex',
      'data-auth-form': mode,
    })
  );
  const fields = {};

  fieldNames.forEach((fieldName) => {
    fields[fieldName] = form.appendChild(
      new FakeElement('input', { 'data-auth-field': fieldName })
    );
  });
  form.appendChild(new FakeElement('button', { 'data-auth-submit': 'true' }));

  return { fields, form };
}

function createFixture({ accountContentHidden = false, pathname = '/account' } = {}) {
  const document = new FakeDocument();
  const accountRoot = document.body.appendChild(
    new FakeElement('main', { 'data-account-root': 'true' })
  );
  const loadingView = accountRoot.appendChild(
    new FakeElement('div', { 'data-auth-view': 'loading' })
  );
  const guestView = accountRoot.appendChild(new FakeElement('div', { 'data-auth-view': 'guest' }));
  const authenticatedView = accountRoot.appendChild(
    new FakeElement('div', { 'data-auth-view': 'authenticated' })
  );
  const accountContent = accountRoot.appendChild(
    new FakeElement('section', { 'data-account-content': 'true' })
  );
  accountContent.hidden = accountContentHidden;
  const accountPanel = accountRoot.appendChild(
    new FakeElement('section', { 'data-account-panel': 'dashboard' })
  );
  const accountError = accountRoot.appendChild(new FakeElement('p', { 'data-auth-error': 'true' }));
  const headerGlobal = document.body.appendChild(
    new FakeElement('header', { 'data-header-global': 'true' })
  );
  const authRoot = headerGlobal.appendChild(
    new FakeElement('section', {
      'data-auth-display': 'flex',
      'data-auth-root': 'true',
    })
  );
  const login = appendForm(authRoot, 'login', ['email', 'password']);
  const signup = appendForm(authRoot, 'signup', ['first-name', 'last-name', 'email', 'password']);
  const reset = appendForm(authRoot, 'reset-password', ['email']);
  const update = appendForm(authRoot, 'update-password', ['password', 'confirm-password']);
  const status = authRoot.appendChild(new FakeElement('p', { 'data-auth-status': 'true' }));
  const error = authRoot.appendChild(new FakeElement('p', { 'data-auth-error': 'true' }));
  const authControls = headerGlobal.appendChild(
    new FakeElement('nav', { 'data-auth-controls': 'true' })
  );
  const openLogin = authControls.appendChild(
    new FakeElement('button', {
      'data-auth-display': 'flex',
      'data-auth-open': 'login',
      'data-auth-view': 'guest',
    })
  );
  openLogin.hidden = true;
  const accountLink = authControls.appendChild(
    new FakeElement('a', {
      'data-account-link': 'true',
      'data-auth-display': 'flex',
      'data-auth-view': 'authenticated',
      href: '/account',
    })
  );
  accountLink.hidden = true;
  const toggleSignup = authRoot.appendChild(
    new FakeElement('button', { 'data-auth-toggle': 'signup' })
  );
  const toggleReset = authRoot.appendChild(
    new FakeElement('button', { 'data-auth-toggle': 'reset-password' })
  );
  const close = authRoot.appendChild(new FakeElement('button', { 'data-auth-close': 'true' }));
  const logout = document.body.appendChild(
    new FakeElement('button', { 'data-auth-logout': 'true' })
  );
  const location = {
    assigned: [],
    assign(value) {
      this.assigned.push(value);
    },
    href: `https://www.theanimalalchemist.com${pathname}`,
    origin: 'https://www.theanimalalchemist.com',
    pathname,
  };
  const history = {
    replacements: [],
    replaceState(_state, _title, url) {
      this.replacements.push(url);
    },
    state: null,
  };

  return {
    accountContent,
    accountError,
    accountLink,
    accountPanel,
    accountRoot,
    authenticatedView,
    authControls,
    authRoot,
    close,
    document,
    error,
    guestView,
    headerGlobal,
    history,
    loadingView,
    location,
    login,
    logout,
    openLogin,
    reset,
    signup,
    status,
    toggleReset,
    toggleSignup,
    update,
  };
}

function createDependencies(overrides = {}) {
  return {
    exchangeCodeForSession: async () => ({ redirectType: null, session: null, user: null }),
    getSession: async () => ({ session: null }),
    getUser: async () => ({ user: null }),
    onAuthStateChange() {
      return { unsubscribe() {} };
    },
    resetPasswordForEmail: async () => ({ requested: true }),
    signInWithPassword: async () => ({ session: null, user: null }),
    signOut: async () => ({ signedOut: true }),
    signUp: async () => ({ session: null, user: null }),
    updatePassword: async () => ({ user: null }),
    ...overrides,
  };
}

function createDeferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

test('account content remains hidden during initial session resolution, then becomes guest', async () => {
  const fixture = createFixture();
  const sessionResolution = createDeferred();
  const controller = createAuthController({
    dependencies: createDependencies({ getSession: () => sessionResolution.promise }),
    document: fixture.document,
    history: fixture.history,
    location: fixture.location,
  });

  const initialization = controller.initialize();

  assert.equal(controller.getState().state, AUTH_STATES.LOADING);
  assert.equal(fixture.accountContent.hidden, true);
  assert.equal(fixture.accountPanel.hidden, true);
  assert.equal(fixture.authenticatedView.hidden, true);
  assert.equal(fixture.openLogin.hidden, true);
  assert.equal(fixture.openLogin.style.display, 'none');
  assert.equal(fixture.accountLink.hidden, true);
  assert.equal(fixture.accountLink.style.display, 'none');
  assert.equal(fixture.authControls.dataset.authState, AUTH_STATES.LOADING);

  sessionResolution.resolve({ session: null });
  await initialization;

  assert.equal(controller.getState().state, AUTH_STATES.GUEST);
  assert.equal(fixture.accountContent.hidden, true);
  assert.equal(fixture.authRoot.dataset.authVisible, 'true');
  assert.equal(fixture.authRoot.dataset.authMode, 'login');
  assert.equal(fixture.openLogin.hidden, false);
  assert.equal(fixture.openLogin.style.display, 'flex');
  assert.equal(fixture.accountLink.hidden, true);
  assert.equal(fixture.accountLink.style.display, 'none');
  assert.equal(fixture.authControls.dataset.authState, AUTH_STATES.GUEST);
});

test('verified session transitions to authenticated without exposing later-phase account panels', async () => {
  const fixture = createFixture({ accountContentHidden: true });
  const session = { id: 'session-1' };
  const user = { id: 'user-1' };
  const controller = createAuthController({
    dependencies: createDependencies({
      getSession: async () => ({ session }),
      getUser: async () => ({ user }),
    }),
    document: fixture.document,
    history: fixture.history,
    location: fixture.location,
  });

  await controller.initialize();

  assert.deepEqual(controller.getState(), {
    recovery: false,
    session,
    state: AUTH_STATES.AUTHENTICATED,
    user,
  });
  assert.equal(fixture.accountContent.hidden, false);
  assert.equal(fixture.accountPanel.hidden, true);
  assert.equal(fixture.authRoot.hidden, true);
  assert.equal(fixture.authRoot.style.display, 'none');
  assert.equal(fixture.openLogin.hidden, true);
  assert.equal(fixture.openLogin.style.display, 'none');
  assert.equal(fixture.accountLink.hidden, false);
  assert.equal(fixture.accountLink.style.display, 'flex');
  assert.equal(fixture.accountLink.getAttribute('href'), '/account');
  assert.equal(fixture.authControls.dataset.authState, AUTH_STATES.AUTHENTICATED);
});

test('global Auth controls open login and switch among signup and reset modes', async () => {
  const fixture = createFixture({ pathname: '/shop' });
  const controller = createAuthController({
    dependencies: createDependencies(),
    document: fixture.document,
    history: fixture.history,
    location: fixture.location,
  });
  await controller.initialize();

  assert.equal(fixture.authRoot.parentNode, fixture.headerGlobal);
  assert.equal(fixture.authRoot.hidden, true);
  assert.equal(fixture.authRoot.style.display, 'none');
  assert.equal(fixture.authRoot.inert, true);
  assert.equal(fixture.authRoot.getAttribute('role'), 'dialog');
  assert.equal(fixture.authRoot.getAttribute('aria-modal'), 'true');
  assert.equal(fixture.authRoot.getAttribute('tabindex'), '-1');
  assert.equal(fixture.openLogin.getAttribute('aria-expanded'), 'false');
  assert.equal(fixture.openLogin.getAttribute('aria-haspopup'), 'dialog');
  await fixture.openLogin.dispatch('click');
  assert.equal(fixture.authRoot.hidden, false);
  assert.equal(fixture.authRoot.style.display, 'flex');
  assert.equal(fixture.authRoot.inert, false);
  assert.equal(fixture.authRoot.dataset.authMode, 'login');
  assert.equal(fixture.login.fields.email.focused, true);
  assert.equal(fixture.openLogin.getAttribute('aria-expanded'), 'true');

  await fixture.toggleSignup.dispatch('click');
  assert.equal(fixture.authRoot.dataset.authMode, 'signup');
  assert.equal(fixture.signup.form.hidden, false);
  assert.equal(fixture.signup.form.style.display, 'flex');
  assert.equal(fixture.login.form.hidden, true);
  assert.equal(fixture.login.form.style.display, 'none');

  await fixture.toggleReset.dispatch('click');
  assert.equal(fixture.authRoot.dataset.authMode, 'reset-password');
  assert.equal(fixture.reset.form.hidden, false);
  assert.equal(fixture.reset.form.style.display, 'flex');
  assert.equal(fixture.signup.form.style.display, 'none');

  fixture.close.focus();
  const forwardWrap = await fixture.document.dispatch('keydown', { key: 'Tab' });
  assert.equal(forwardWrap.defaultPrevented, true);
  assert.equal(fixture.document.activeElement, fixture.reset.fields.email);

  const reverseWrap = await fixture.document.dispatch('keydown', {
    key: 'Tab',
    shiftKey: true,
  });
  assert.equal(reverseWrap.defaultPrevented, true);
  assert.equal(fixture.document.activeElement, fixture.close);

  const escape = await fixture.document.dispatch('keydown', { key: 'Escape' });
  assert.equal(escape.defaultPrevented, true);
  assert.equal(fixture.authRoot.hidden, true);
  assert.equal(fixture.authRoot.inert, true);
  assert.equal(fixture.openLogin.getAttribute('aria-expanded'), 'false');
  assert.equal(fixture.document.activeElement, fixture.openLogin);
});

test('verified sessions on guest Auth routes redirect to account', async () => {
  const session = { id: 'session-1' };
  const user = { id: 'user-1' };

  for (const pathname of ['/log-in', '/sign-up', '/reset-password']) {
    const fixture = createFixture({ pathname });
    const controller = createAuthController({
      dependencies: createDependencies({
        getSession: async () => ({ session }),
        getUser: async () => ({ user }),
      }),
      document: fixture.document,
      history: fixture.history,
      location: fixture.location,
    });

    await controller.initialize();

    assert.deepEqual(fixture.location.assigned, ['/account']);
  }
});

test('login form transitions to authenticated and uses the fixed account destination', async () => {
  const fixture = createFixture({ pathname: '/log-in' });
  const session = { id: 'session-1' };
  const user = { id: 'user-1' };
  const calls = [];
  fixture.login.fields.email.value = ' customer@example.com ';
  fixture.login.fields.password.value = 'customer-password';
  const controller = createAuthController({
    dependencies: createDependencies({
      async signInWithPassword(argumentsObject) {
        calls.push(argumentsObject);
        return { session, user };
      },
    }),
    document: fixture.document,
    history: fixture.history,
    location: fixture.location,
  });
  await controller.initialize();
  await fixture.login.form.dispatch('submit');

  assert.equal(controller.getState().state, AUTH_STATES.AUTHENTICATED);
  assert.deepEqual(calls, [{ email: 'customer@example.com', password: 'customer-password' }]);
  assert.deepEqual(fixture.location.assigned, ['/account']);
  assert.equal(fixture.login.fields.password.value, '');
});

test('logout clears protected UI and password fields before the SDK request completes', async () => {
  const fixture = createFixture();
  const signOutResolution = createDeferred();
  const session = { id: 'session-1' };
  const user = { id: 'user-1' };
  const controller = createAuthController({
    dependencies: createDependencies({
      getSession: async () => ({ session }),
      getUser: async () => ({ user }),
      signOut: () => signOutResolution.promise,
    }),
    document: fixture.document,
    history: fixture.history,
    location: fixture.location,
  });
  await controller.initialize();
  fixture.login.fields.password.value = 'customer-password';

  const logoutRequest = fixture.logout.dispatch('click');

  assert.equal(controller.getState().state, AUTH_STATES.GUEST);
  assert.equal(fixture.accountContent.hidden, true);
  assert.equal(fixture.accountLink.hidden, true);
  assert.equal(fixture.openLogin.hidden, false);
  assert.equal(fixture.login.fields.password.value, '');
  signOutResolution.resolve({ signedOut: true });
  await logoutRequest;
});

test('password recovery callback requires a verified session and exits recovery after update', async () => {
  const fixture = createFixture();
  const calls = [];
  const session = { id: 'recovery-session' };
  const user = { id: 'user-1' };
  const controller = createAuthController({
    authCallback: {
      allowed: true,
      code: 'one-time-code',
      error: false,
      flowId: null,
      invalid: false,
      recovery: true,
    },
    dependencies: createDependencies({
      exchangeCodeForSession: async (argumentsObject) => {
        calls.push(['exchange', argumentsObject]);
        return { redirectType: 'recovery', session, user };
      },
      getSession: async () => ({ session }),
      getUser: async () => ({ user }),
      updatePassword: async (argumentsObject) => {
        calls.push(['update', argumentsObject]);
        return { user };
      },
    }),
    document: fixture.document,
    history: fixture.history,
    location: fixture.location,
  });

  await controller.initialize();

  assert.equal(controller.getState().state, AUTH_STATES.AUTHENTICATED);
  assert.equal(controller.getState().recovery, true);
  assert.equal(fixture.authRoot.dataset.authMode, 'update-password');
  assert.equal(fixture.accountContent.hidden, true);

  fixture.update.fields.password.value = 'new-password';
  fixture.update.fields['confirm-password'].value = 'new-password';
  await fixture.update.form.dispatch('submit');

  assert.equal(controller.getState().recovery, false);
  assert.equal(fixture.accountContent.hidden, false);
  assert.deepEqual(calls, [
    ['exchange', { code: 'one-time-code', flowId: null }],
    ['update', { password: 'new-password' }],
  ]);
  assert.deepEqual(fixture.history.replacements, ['/account']);
});

test('invalid callback state cannot exchange a code, resolve a verifier session, or authenticate', async () => {
  for (const authCallback of [
    {
      allowed: true,
      code: 'one-time-code',
      error: false,
      flowId: null,
      invalid: true,
      recovery: false,
    },
    {
      allowed: true,
      code: null,
      error: false,
      flowId: null,
      invalid: true,
      recovery: false,
    },
  ]) {
    const fixture = createFixture();
    let exchangeCount = 0;
    let sessionReadCount = 0;
    const controller = createAuthController({
      authCallback,
      dependencies: createDependencies({
        async exchangeCodeForSession() {
          exchangeCount += 1;
          return { redirectType: null, session: { id: 'unexpected' }, user: { id: 'unexpected' } };
        },
        async getSession() {
          sessionReadCount += 1;
          return { session: { id: 'unexpected' } };
        },
      }),
      document: fixture.document,
      history: fixture.history,
      location: fixture.location,
    });

    await controller.initialize();

    assert.equal(controller.getState().state, AUTH_STATES.ERROR);
    assert.equal(controller.getState().session, null);
    assert.equal(controller.getState().user, null);
    assert.equal(exchangeCount, 0);
    assert.equal(sessionReadCount, 0);
    assert.equal(fixture.accountContent.hidden, true);
  }
});

test('password recovery request gives the same public response after SDK success or failure', async () => {
  for (const resetPasswordForEmail of [
    async () => ({ requested: true }),
    async () => {
      throw new Error('unknown account');
    },
  ]) {
    const fixture = createFixture({ pathname: '/reset-password' });
    fixture.reset.fields.email.value = 'customer@example.com';
    const controller = createAuthController({
      dependencies: createDependencies({ resetPasswordForEmail }),
      document: fixture.document,
      history: fixture.history,
      location: fixture.location,
    });
    await controller.initialize();
    await fixture.reset.form.dispatch('submit');

    assert.equal(
      fixture.status.textContent,
      'If an account exists for that email address, password recovery instructions will be sent.'
    );
    assert.equal(fixture.error.textContent, '');
  }
});

test('each Auth form ignores a rapid duplicate submission until its first request settles', async () => {
  for (const scenario of [
    {
      mode: 'login',
      resolveResult: { session: { id: 'session-1' }, user: { id: 'user-1' } },
      serviceName: 'signInWithPassword',
    },
    {
      mode: 'signup',
      resolveResult: { session: null, user: null },
      serviceName: 'signUp',
    },
    {
      mode: 'reset',
      resolveResult: { requested: true },
      serviceName: 'resetPasswordForEmail',
    },
  ]) {
    const fixture = createFixture({ pathname: '/shop' });
    const request = createDeferred();
    let callCount = 0;
    const controller = createAuthController({
      dependencies: createDependencies({
        [scenario.serviceName]: () => {
          callCount += 1;
          return request.promise;
        },
      }),
      document: fixture.document,
      history: fixture.history,
      location: fixture.location,
    });
    await controller.initialize();

    const form = fixture[scenario.mode].form;
    const firstSubmission = form.dispatch('submit');
    const secondSubmission = form.dispatch('submit');

    assert.equal(callCount, 1, `${scenario.serviceName} should run once`);
    request.resolve(scenario.resolveResult);
    await Promise.all([firstSubmission, secondSubmission]);
    assert.equal(callCount, 1, `${scenario.serviceName} should remain single-shot`);
  }
});

test('Auth state callback clears authenticated content on SIGNED_OUT', async () => {
  const fixture = createFixture();
  const session = { id: 'session-1' };
  const user = { id: 'user-1' };
  let listener;
  const controller = createAuthController({
    dependencies: createDependencies({
      getSession: async () => ({ session }),
      getUser: async () => ({ user }),
      onAuthStateChange(callback) {
        listener = callback;
        return { unsubscribe() {} };
      },
    }),
    document: fixture.document,
    history: fixture.history,
    location: fixture.location,
  });
  await controller.initialize();

  listener({ event: 'SIGNED_OUT', session: null });

  assert.equal(controller.getState().state, AUTH_STATES.GUEST);
  assert.equal(fixture.accountContent.hidden, true);
  assert.equal(fixture.accountLink.hidden, true);
  assert.equal(fixture.openLogin.hidden, false);
  assert.equal(fixture.authRoot.dataset.authMode, 'login');
});

test('cross-tab identity changes clear stale header state before verified resolution', async () => {
  const fixture = createFixture({ pathname: '/shop' });
  const initialSession = { id: 'session-1' };
  const initialUser = { id: 'user-1' };
  const nextSession = { id: 'session-2' };
  const nextUser = { id: 'user-2' };
  const sessionResolution = createDeferred();
  let getSessionCount = 0;
  let listener;
  const controller = createAuthController({
    dependencies: createDependencies({
      getSession: async () => {
        getSessionCount += 1;
        return getSessionCount === 1 ? { session: initialSession } : sessionResolution.promise;
      },
      getUser: async () => ({ user: getSessionCount === 1 ? initialUser : nextUser }),
      onAuthStateChange(callback) {
        listener = callback;
        return { unsubscribe() {} };
      },
    }),
    document: fixture.document,
    history: fixture.history,
    location: fixture.location,
  });
  await controller.initialize();

  listener({ event: 'USER_UPDATED', session: nextSession });

  assert.equal(controller.getState().state, AUTH_STATES.LOADING);
  assert.equal(fixture.accountContent.hidden, true);
  assert.equal(fixture.openLogin.hidden, true);
  assert.equal(fixture.accountLink.hidden, true);

  sessionResolution.resolve({ session: nextSession });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(controller.getState(), {
    recovery: false,
    session: nextSession,
    state: AUTH_STATES.AUTHENTICATED,
    user: nextUser,
  });
  assert.equal(fixture.openLogin.hidden, true);
  assert.equal(fixture.accountLink.hidden, false);
});

test('account and global header surfaces share one session resolution lifecycle', async () => {
  const fixture = createFixture({ pathname: '/shop' });
  let getSessionCount = 0;
  let getUserCount = 0;
  const controller = createAuthController({
    dependencies: createDependencies({
      getSession: async () => {
        getSessionCount += 1;
        return { session: { id: 'session-1' } };
      },
      getUser: async () => {
        getUserCount += 1;
        return { user: { id: 'user-1' } };
      },
    }),
    document: fixture.document,
    history: fixture.history,
    location: fixture.location,
  });

  await controller.initialize();

  assert.equal(getSessionCount, 1);
  assert.equal(getUserCount, 1);
  assert.equal(fixture.accountContent.hidden, false);
  assert.equal(fixture.accountLink.hidden, false);
});

test('redirect allowlist permits only the literal account path', () => {
  const options = { origin: 'https://www.theanimalalchemist.com' };

  assert.equal(isAllowedAuthRedirect('/account', options), true);
  assert.equal(isAllowedAuthRedirect('https://attacker.example/account', options), false);
  assert.equal(isAllowedAuthRedirect('//attacker.example/account', options), false);
  assert.equal(isAllowedAuthRedirect('/%61ccount', options), false);
  assert.equal(isAllowedAuthRedirect('/account%ZZ', options), false);
  assert.equal(isAllowedAuthRedirect('/account?next=/checkout', options), false);
  assert.equal(getSafeAuthRedirect('https://attacker.example/account', options), '/account');
});
