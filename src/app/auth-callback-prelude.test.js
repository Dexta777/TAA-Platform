import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const preludeSource = await readFile(
  new URL('../../public/taa-auth-callback-prelude.js', import.meta.url),
  'utf8'
);

function executePrelude(href, { failListenerRegistration = false, now = 1_000 } = {}) {
  const listeners = new Map();
  const replacements = [];
  const window = {
    addEventListener(type, listener) {
      if (failListenerRegistration) throw new Error('Listener unavailable');
      listeners.set(type, listener);
    },
    dispatchEvent(event) {
      listeners.get(event.type)?.(event);
    },
    history: {
      replaceState(_state, _title, url) {
        replacements.push(url);
      },
      state: { preserved: true },
    },
    location: { href },
    removeEventListener(type) {
      listeners.delete(type);
    },
  };
  const DateConstructor = class extends Date {
    static now() {
      return now;
    }
  };

  vm.runInNewContext(preludeSource, {
    Date: DateConstructor,
    JSON,
    URL,
    URLSearchParams,
    window,
  });

  return {
    consumeHandoff() {
      let handoff = null;
      window.dispatchEvent({
        detail: {
          receive(value) {
            handoff = value;
          },
        },
        type: 'taa:auth-callback-handoff',
      });
      return handoff;
    },
    replacements,
  };
}

test('early prelude holds a minimal one-shot PKCE handoff and scrubs the account URL', () => {
  const { consumeHandoff, replacements } = executePrelude(
    'https://www.theanimalalchemist.com/account?code=one-time-code&type=recovery&utm_source=email'
  );
  const handoff = consumeHandoff();

  assert.deepEqual(JSON.parse(JSON.stringify(handoff)), {
    allowed: true,
    capturedAt: 1_000,
    code: 'one-time-code',
    error: false,
    flowId: null,
    invalid: false,
    recovery: true,
    version: 1,
  });
  assert.deepEqual(replacements, ['/account?utm_source=email']);
  assert.equal(replacements[0].includes('one-time-code'), false);
  assert.equal(consumeHandoff(), null);
});

test('early prelude does not mutate callback-like values on an unapproved route', () => {
  for (const href of [
    'https://www.theanimalalchemist.com/shop?code=campaign-code#type=product',
    'https://www.theanimalalchemist.com/shop#access_token=sensitive&type=recovery',
  ]) {
    const { consumeHandoff, replacements } = executePrelude(href);

    assert.deepEqual(replacements, []);
    assert.equal(consumeHandoff(), null);
  }
});

test('early prelude ignores account fragments without an Auth token or error', () => {
  const { consumeHandoff, replacements } = executePrelude(
    'https://www.theanimalalchemist.com/account#type=section'
  );

  assert.deepEqual(replacements, []);
  assert.equal(consumeHandoff(), null);
});

test('early prelude never hands legacy callback tokens to the application', () => {
  const { consumeHandoff, replacements } = executePrelude(
    'https://www.theanimalalchemist.com/account#access_token=sensitive&refresh_token=sensitive&type=recovery'
  );
  const handoff = consumeHandoff();

  assert.equal(JSON.stringify(handoff).includes('sensitive'), false);
  assert.equal(handoff.code, null);
  assert.equal(handoff.invalid, true);
  assert.equal(handoff.recovery, true);
  assert.deepEqual(replacements, ['/account']);
});

test('early prelude rejects malformed flow ids and oversized authorization codes', () => {
  for (const scenario of [
    {
      expectedCode: 'one-time-code',
      href: 'https://www.theanimalalchemist.com/account?code=one-time-code&sb_flow_id=bad',
    },
    {
      expectedCode: null,
      href: `https://www.theanimalalchemist.com/account?code=${'x'.repeat(4097)}`,
    },
  ]) {
    const { expectedCode, href } = scenario;
    const { consumeHandoff, replacements } = executePrelude(href);
    const handoff = consumeHandoff();

    assert.equal(handoff.code, expectedCode);
    assert.equal(handoff.flowId, null);
    assert.equal(handoff.invalid, true);
    assert.deepEqual(replacements, ['/account']);
  }
});

test('early prelude scrubs callback material when handoff registration is unavailable', () => {
  const { consumeHandoff, replacements } = executePrelude(
    'https://www.theanimalalchemist.com/account?code=one-time-code',
    { failListenerRegistration: true }
  );

  assert.equal(consumeHandoff(), null);
  assert.deepEqual(replacements, ['/account?taa_auth_callback=unavailable']);
  assert.equal(replacements[0].includes('one-time-code'), false);
});
