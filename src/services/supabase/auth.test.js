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
const { AuthServiceError, createAuthService, normalizeAuthError } = await viteServer.ssrLoadModule(
  '/src/services/supabase/auth.js'
);
const { SUPABASE_AUTH_OPTIONS } = await viteServer.ssrLoadModule(
  '/src/services/supabase/client.js'
);

test.after(async () => {
  await viteServer.close();
});

function createClient(methods = {}) {
  return {
    auth: {
      exchangeCodeForSession: async () => ({ data: {}, error: null }),
      getSession: async () => ({ data: { session: null }, error: null }),
      getUser: async () => ({ data: { user: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      resetPasswordForEmail: async () => ({ data: {}, error: null }),
      signInWithPassword: async () => ({ data: {}, error: null }),
      signOut: async () => ({ error: null }),
      signUp: async () => ({ data: {}, error: null }),
      updateUser: async () => ({ data: {}, error: null }),
      ...methods,
    },
  };
}

test('browser Auth client options explicitly select persistent PKCE handling', () => {
  assert.deepEqual(SUPABASE_AUTH_OPTIONS, {
    autoRefreshToken: true,
    detectSessionInUrl: false,
    flowType: 'pkce',
    persistSession: true,
  });
});

test('session and user reads normalize absent and present values', async () => {
  const session = { id: 'session-1' };
  const user = { id: 'user-1' };
  const service = createAuthService(
    createClient({
      async getSession() {
        return { data: { session }, error: null };
      },
      async getUser() {
        return { data: { user }, error: null };
      },
    })
  );

  assert.deepEqual(await service.getSession(), { session });
  assert.deepEqual(await service.getUser(), { user });
});

test('sign in returns normalized session and user values', async () => {
  const calls = [];
  const session = { access_token: 'not-a-real-token' };
  const user = { id: 'user-1' };
  const service = createAuthService(
    createClient({
      async signInWithPassword(argumentsObject) {
        calls.push(argumentsObject);
        return { data: { session, user }, error: null };
      },
    })
  );

  assert.deepEqual(
    await service.signInWithPassword({ email: ' customer@example.com ', password: 'secret' }),
    {
      session,
      user,
    }
  );
  assert.deepEqual(calls, [{ email: 'customer@example.com', password: 'secret' }]);
});

test('sign in failure exposes only a normalized service error', async () => {
  const sourceError = Object.assign(new Error('source details'), {
    code: 'invalid_credentials',
    status: 400,
  });
  const service = createAuthService(
    createClient({
      async signInWithPassword() {
        return { data: null, error: sourceError };
      },
    })
  );

  await assert.rejects(
    service.signInWithPassword({ email: 'customer@example.com', password: 'secret' }),
    (error) => {
      assert.equal(error instanceof AuthServiceError, true);
      assert.equal(error.message, 'Sign in could not be completed.');
      assert.equal(error.code, 'invalid_credentials');
      assert.equal(error.status, 400);
      assert.equal(error.cause, sourceError);
      return true;
    }
  );
});

test('signup sends profile metadata and the explicit confirmation redirect', async () => {
  let receivedArguments;
  const service = createAuthService(
    createClient({
      async signUp(argumentsObject) {
        receivedArguments = argumentsObject;
        return { data: { session: null, user: { id: 'pending-user' } }, error: null };
      },
    })
  );

  const result = await service.signUp({
    email: ' new@example.com ',
    emailRedirectTo: 'https://www.theanimalalchemist.com/account',
    firstName: ' Ada ',
    lastName: ' Lovelace ',
    password: 'secret',
  });

  assert.deepEqual(receivedArguments, {
    email: 'new@example.com',
    options: {
      data: { first_name: 'Ada', last_name: 'Lovelace' },
      emailRedirectTo: 'https://www.theanimalalchemist.com/account',
    },
    password: 'secret',
  });
  assert.equal(result.session, null);
  assert.deepEqual(result.user, { id: 'pending-user' });
});

test('password recovery sends the explicit account callback URL', async () => {
  let receivedArguments;
  const service = createAuthService(
    createClient({
      async resetPasswordForEmail(...argumentsList) {
        receivedArguments = argumentsList;
        return { data: {}, error: null };
      },
    })
  );

  assert.deepEqual(
    await service.resetPasswordForEmail({
      email: ' customer@example.com ',
      redirectTo: 'https://www.theanimalalchemist.com/account',
    }),
    { requested: true }
  );
  assert.deepEqual(receivedArguments, [
    'customer@example.com',
    { redirectTo: 'https://www.theanimalalchemist.com/account' },
  ]);
});

test('logout is local and update password delegates only the password value', async () => {
  const calls = [];
  const user = { id: 'user-1' };
  const service = createAuthService(
    createClient({
      async signOut(argumentsObject) {
        calls.push(['signOut', argumentsObject]);
        return { error: null };
      },
      async updateUser(argumentsObject) {
        calls.push(['updateUser', argumentsObject]);
        return { data: { user }, error: null };
      },
    })
  );

  assert.deepEqual(await service.signOut(), { signedOut: true });
  assert.deepEqual(await service.updatePassword({ password: 'new-secret' }), { user });
  assert.deepEqual(calls, [
    ['signOut', { scope: 'local' }],
    ['updateUser', { password: 'new-secret' }],
  ]);
});

test('Auth state subscription normalizes callbacks and supports unsubscribe', () => {
  let sdkCallback;
  let unsubscribeCount = 0;
  const received = [];
  const service = createAuthService(
    createClient({
      onAuthStateChange(callback) {
        sdkCallback = callback;
        return {
          data: {
            subscription: {
              unsubscribe() {
                unsubscribeCount += 1;
              },
            },
          },
        };
      },
    })
  );
  const subscription = service.onAuthStateChange((event) => received.push(event));

  sdkCallback('SIGNED_IN', { id: 'session-1' });
  subscription.unsubscribe();

  assert.deepEqual(received, [{ event: 'SIGNED_IN', session: { id: 'session-1' } }]);
  assert.equal(unsubscribeCount, 1);
});

test('error normalization removes unsafe codes and invalid statuses', () => {
  const normalized = normalizeAuthError({
    code: 'Unsafe Code!',
    message: 'private upstream message',
    status: 200,
  });

  assert.equal(normalized instanceof AuthServiceError, true);
  assert.equal(normalized.message, 'Authentication could not be completed.');
  assert.equal(normalized.code, null);
  assert.equal(normalized.status, null);
});
