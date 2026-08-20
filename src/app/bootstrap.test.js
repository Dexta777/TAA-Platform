import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AUTH_CALLBACK_HANDOFF_EVENT,
  captureAuthCallbackFromUrl,
  consumeAuthCallbackHandoff,
  initializeAuthSurface,
  prepareAuthSurface,
  shouldInitializeAuth,
} from './bootstrap.js';

class FakeHandoffWindow {
  constructor(value) {
    this.available = true;
    this.value = value;
    this.CustomEvent = class {
      constructor(type, options = {}) {
        this.detail = options.detail;
        this.type = type;
      }
    };
  }

  dispatchEvent(event) {
    if (!this.available || event.type !== AUTH_CALLBACK_HANDOFF_EVENT) return false;

    this.available = false;
    event.detail.receive(this.value);
    return true;
  }
}

function createDocument({ matchingSurface = false, markers = [] } = {}) {
  return {
    querySelector(selector) {
      return matchingSurface || markers.some((marker) => selector.includes(marker)) ? {} : null;
    },
    querySelectorAll() {
      return [];
    },
  };
}

test('early Auth preparation keeps global header controls fail-closed', () => {
  const createControl = () => ({
    getAttribute(name) {
      return name === 'data-auth-display' ? 'flex' : null;
    },
    hidden: false,
    style: { display: 'flex' },
  });
  const guest = createControl();
  const authenticated = createControl();
  const modalAttributes = new Map();
  const modal = {
    dataset: {},
    getAttribute(name) {
      return name === 'data-auth-display' ? 'flex' : null;
    },
    hidden: false,
    setAttribute(name, value) {
      modalAttributes.set(name, value);
    },
    style: { display: 'flex' },
  };
  const attributes = new Map();
  const root = {
    dataset: {},
    querySelectorAll(selector) {
      return selector === '[data-auth-view]' ? [guest, authenticated] : [];
    },
    setAttribute(name, value) {
      attributes.set(name, value);
    },
  };
  const document = {
    querySelectorAll(selector) {
      if (selector === '[data-auth-controls="true"]') return [root];
      if (selector === '[data-auth-root]') return [modal];
      return [];
    },
  };

  prepareAuthSurface({ document });

  assert.equal(guest.hidden, true);
  assert.equal(authenticated.hidden, true);
  assert.equal(guest.style.display, 'none');
  assert.equal(authenticated.style.display, 'none');
  assert.equal(root.dataset.authState, 'loading');
  assert.equal(attributes.get('aria-busy'), 'true');
  assert.equal(modal.hidden, true);
  assert.equal(modal.style.display, 'none');
  assert.equal(modalAttributes.get('aria-hidden'), 'true');
});

test('Auth bootstrap skips unrelated pages without account markup', async () => {
  let loadCount = 0;
  const result = await initializeAuthSurface({
    document: createDocument(),
    loadAuthModule: async () => {
      loadCount += 1;
      return { initAuth() {} };
    },
    pathname: '/shop',
  });

  assert.equal(result, null);
  assert.equal(loadCount, 0);
});

test('Auth bootstrap loads on the account route and matching global markup', async () => {
  for (const scenario of [
    { document: createDocument(), pathname: '/account' },
    { document: createDocument({ matchingSurface: true }), pathname: '/shop' },
  ]) {
    let loadCount = 0;
    const marker = {};
    const result = await initializeAuthSurface({
      ...scenario,
      loadAuthModule: async () => {
        loadCount += 1;
        return { initAuth: () => marker };
      },
    });

    assert.equal(result, marker);
    assert.equal(loadCount, 1);
  }
});

test('multiple Auth markers trigger one lazy module initialization', async () => {
  let initCount = 0;
  let loadCount = 0;
  const marker = {};
  const result = await initializeAuthSurface({
    document: createDocument({
      markers: ['[data-account-root="true"]', '[data-auth-controls="true"]', '[data-auth-root]'],
    }),
    loadAuthModule: async () => {
      loadCount += 1;
      return {
        initAuth() {
          initCount += 1;
          return marker;
        },
      };
    },
    pathname: '/shop',
  });

  assert.equal(result, marker);
  assert.equal(loadCount, 1);
  assert.equal(initCount, 1);
});

test('Auth route detection includes only the Phase A surfaces', () => {
  const document = createDocument();

  assert.equal(shouldInitializeAuth({ document, pathname: '/account' }), true);
  assert.equal(shouldInitializeAuth({ document, pathname: '/log-in' }), true);
  assert.equal(shouldInitializeAuth({ document, pathname: '/sign-up/' }), true);
  assert.equal(shouldInitializeAuth({ document, pathname: '/reset-password' }), true);
  assert.equal(shouldInitializeAuth({ document, pathname: '/checkout' }), false);
  assert.equal(
    shouldInitializeAuth({
      document: createDocument({ markers: ['[data-auth-controls="true"]'] }),
      pathname: '/shop',
    }),
    true
  );
});

test('PKCE callback material is captured in memory and scrubbed from the URL', () => {
  const calls = [];
  const location = {
    href: 'https://www.theanimalalchemist.com/account?code=one-time-code&sb_flow_id=flow_id_1234&type=recovery&utm_source=email',
  };
  const history = {
    state: { preserved: true },
    replaceState(...argumentsList) {
      calls.push(argumentsList);
    },
  };

  const callback = captureAuthCallbackFromUrl({ history, location });

  assert.deepEqual(callback, {
    allowed: true,
    code: 'one-time-code',
    error: false,
    flowId: 'flow_id_1234',
    invalid: false,
    recovery: true,
  });
  assert.deepEqual(calls, [[{ preserved: true }, '', '/account?utm_source=email']]);
});

test('callback capture does not mutate arbitrary code or type values outside account', () => {
  const replacements = [];
  const callback = captureAuthCallbackFromUrl({
    history: {
      replaceState(_state, _title, url) {
        replacements.push(url);
      },
      state: null,
    },
    location: {
      href: 'https://www.theanimalalchemist.com/shop?code=campaign-code#type=product',
    },
  });

  assert.equal(callback, null);
  assert.deepEqual(replacements, []);
});

test('callback fallback rejects a malformed PKCE flow id and scrubs callback material', () => {
  let replacement;
  const callback = captureAuthCallbackFromUrl({
    history: {
      replaceState(_state, _title, url) {
        replacement = url;
      },
      state: null,
    },
    location: {
      href: 'https://www.theanimalalchemist.com/account?code=one-time-code&sb_flow_id=bad&utm_source=email',
    },
  });

  assert.deepEqual(callback, {
    allowed: true,
    code: 'one-time-code',
    error: false,
    flowId: null,
    invalid: true,
    recovery: false,
  });
  assert.equal(replacement, '/account?utm_source=email');
});

test('callback fallback rejects an oversized authorization code and scrubs it', () => {
  let replacement;
  const callback = captureAuthCallbackFromUrl({
    history: {
      replaceState(_state, _title, url) {
        replacement = url;
      },
      state: null,
    },
    location: {
      href: `https://www.theanimalalchemist.com/account?code=${'x'.repeat(4097)}&utm_source=email`,
    },
  });

  assert.deepEqual(callback, {
    allowed: true,
    code: null,
    error: false,
    flowId: null,
    invalid: true,
    recovery: false,
  });
  assert.equal(replacement, '/account?utm_source=email');
});

test('callback fallback leaves unrelated account query parameters untouched', () => {
  let replaceCount = 0;
  const callback = captureAuthCallbackFromUrl({
    history: {
      replaceState() {
        replaceCount += 1;
      },
      state: null,
    },
    location: {
      href: 'https://www.theanimalalchemist.com/account?code_campaign=summer&utm_source=email',
    },
  });

  assert.equal(callback, null);
  assert.equal(replaceCount, 0);
});

test('callback capture ignores type-only fragments on the account route', () => {
  let replaceCount = 0;
  const callback = captureAuthCallbackFromUrl({
    history: {
      replaceState() {
        replaceCount += 1;
      },
      state: null,
    },
    location: { href: 'https://www.theanimalalchemist.com/account#type=section' },
  });

  assert.equal(callback, null);
  assert.equal(replaceCount, 0);
});

test('legacy token fragments are scrubbed only on account and fail closed without persistence', () => {
  let replacement;
  const callback = captureAuthCallbackFromUrl({
    history: {
      replaceState(_state, _title, url) {
        replacement = url;
      },
      state: null,
    },
    location: {
      href: 'https://www.theanimalalchemist.com/account#access_token=sensitive&refresh_token=sensitive',
    },
  });

  assert.equal(callback.allowed, true);
  assert.equal(callback.code, null);
  assert.equal(callback.invalid, true);
  assert.equal(replacement, '/account');
});

test('early callback handoff is consumed once and normalized', () => {
  const windowObject = new FakeHandoffWindow({
    allowed: true,
    capturedAt: 1_000,
    code: 'one-time-code',
    error: false,
    flowId: 'flow_id_1234',
    invalid: false,
    recovery: true,
    version: 1,
  });

  const location = { pathname: '/account' };

  assert.deepEqual(consumeAuthCallbackHandoff({ location, now: 1_500, windowObject }), {
    allowed: true,
    code: 'one-time-code',
    error: false,
    flowId: 'flow_id_1234',
    invalid: false,
    recovery: true,
  });
  assert.equal(consumeAuthCallbackHandoff({ location, now: 1_500, windowObject }), null);
});

test('early callback handoff is discarded without activation outside account', () => {
  const windowObject = new FakeHandoffWindow({
    allowed: true,
    capturedAt: 1_000,
    code: 'one-time-code',
    error: false,
    flowId: null,
    invalid: false,
    recovery: false,
    version: 1,
  });

  assert.equal(
    consumeAuthCallbackHandoff({
      location: { pathname: '/shop' },
      now: 1_500,
      windowObject,
    }),
    null
  );
  assert.equal(
    consumeAuthCallbackHandoff({
      location: { pathname: '/account' },
      now: 1_500,
      windowObject,
    }),
    null
  );
});

test('stale or malformed early handoff fails closed after one-time consumption', () => {
  for (const handoffValue of [
    'invalid-value',
    {
      allowed: true,
      capturedAt: 1,
      code: 'expired-code',
      error: false,
      flowId: null,
      invalid: false,
      recovery: false,
      version: 1,
    },
  ]) {
    const windowObject = new FakeHandoffWindow(handoffValue);
    const callback = consumeAuthCallbackHandoff({
      location: { pathname: '/account' },
      now: 600_000,
      windowObject,
    });

    assert.equal(callback.invalid, true);
    assert.equal(callback.code, null);
    assert.equal(
      consumeAuthCallbackHandoff({
        location: { pathname: '/account' },
        now: 600_000,
        windowObject,
      }),
      null
    );
  }
});

test('prelude handoff failure marker becomes a scrubbed invalid callback', () => {
  let replacement;
  const callback = captureAuthCallbackFromUrl({
    history: {
      replaceState(_state, _title, url) {
        replacement = url;
      },
      state: null,
    },
    location: {
      href: 'https://www.theanimalalchemist.com/account?taa_auth_callback=unavailable',
    },
  });

  assert.equal(callback.invalid, true);
  assert.equal(callback.code, null);
  assert.equal(replacement, '/account');
});
