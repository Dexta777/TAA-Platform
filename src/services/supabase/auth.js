import { supabase } from './client.js';

const DEFAULT_AUTH_ERROR_MESSAGE = 'Authentication could not be completed.';
const SAFE_AUTH_ERROR_CODE = /^[a-z0-9_]{1,100}$/;

export class AuthServiceError extends Error {
  constructor(message = DEFAULT_AUTH_ERROR_MESSAGE, { cause, code = null, status = null } = {}) {
    super(message, { cause });
    this.name = 'AuthServiceError';
    this.code = code;
    this.status = status;
  }
}

export function normalizeAuthError(error, fallbackMessage = DEFAULT_AUTH_ERROR_MESSAGE) {
  if (error instanceof AuthServiceError) return error;

  const code =
    typeof error?.code === 'string' && SAFE_AUTH_ERROR_CODE.test(error.code) ? error.code : null;
  const status =
    Number.isInteger(error?.status) && error.status >= 400 && error.status <= 599
      ? error.status
      : null;

  return new AuthServiceError(fallbackMessage, { cause: error, code, status });
}

async function executeAuthRequest(request, fallbackMessage) {
  let result;

  try {
    result = await request();
  } catch (error) {
    throw normalizeAuthError(error, fallbackMessage);
  }

  if (result?.error) {
    throw normalizeAuthError(result.error, fallbackMessage);
  }

  return result?.data ?? null;
}

function requireValue(value, fieldName) {
  if (typeof value !== 'string' || !value) {
    throw new TypeError(`${fieldName} is required.`);
  }

  return value;
}

export function createAuthService(client = supabase) {
  if (!client?.auth) {
    throw new TypeError('A Supabase Auth client is required.');
  }

  return Object.freeze({
    async getSession() {
      const data = await executeAuthRequest(
        () => client.auth.getSession(),
        'The current session could not be resolved.'
      );

      return Object.freeze({ session: data?.session ?? null });
    },

    async getUser() {
      const data = await executeAuthRequest(
        () => client.auth.getUser(),
        'The signed-in customer could not be verified.'
      );

      return Object.freeze({ user: data?.user ?? null });
    },

    async signInWithPassword({ email, password }) {
      const data = await executeAuthRequest(
        () =>
          client.auth.signInWithPassword({
            email: requireValue(email?.trim(), 'Email'),
            password: requireValue(password, 'Password'),
          }),
        'Sign in could not be completed.'
      );

      return Object.freeze({ session: data?.session ?? null, user: data?.user ?? null });
    },

    async signUp({ email, password, firstName, lastName, emailRedirectTo }) {
      const data = await executeAuthRequest(
        () =>
          client.auth.signUp({
            email: requireValue(email?.trim(), 'Email'),
            password: requireValue(password, 'Password'),
            options: {
              data: {
                first_name: requireValue(firstName?.trim(), 'First name'),
                last_name: requireValue(lastName?.trim(), 'Last name'),
              },
              emailRedirectTo: requireValue(emailRedirectTo, 'Email redirect URL'),
            },
          }),
        'Account creation could not be completed.'
      );

      return Object.freeze({ session: data?.session ?? null, user: data?.user ?? null });
    },

    async signOut() {
      await executeAuthRequest(
        () => client.auth.signOut({ scope: 'local' }),
        'Sign out could not be completed.'
      );

      return Object.freeze({ signedOut: true });
    },

    async resetPasswordForEmail({ email, redirectTo }) {
      await executeAuthRequest(
        () =>
          client.auth.resetPasswordForEmail(requireValue(email?.trim(), 'Email'), {
            redirectTo: requireValue(redirectTo, 'Password recovery redirect URL'),
          }),
        'Password recovery could not be requested.'
      );

      return Object.freeze({ requested: true });
    },

    async updatePassword({ password }) {
      const data = await executeAuthRequest(
        () => client.auth.updateUser({ password: requireValue(password, 'Password') }),
        'The password could not be updated.'
      );

      return Object.freeze({ user: data?.user ?? null });
    },

    async exchangeCodeForSession({ code, flowId = null }) {
      const normalizedFlowId = typeof flowId === 'string' && flowId ? flowId : null;
      const data = await executeAuthRequest(
        () =>
          client.auth.exchangeCodeForSession(
            requireValue(code, 'Authorization code'),
            normalizedFlowId ? { flowId: normalizedFlowId } : undefined
          ),
        'The authentication link could not be completed.'
      );

      return Object.freeze({
        redirectType: data?.redirectType ?? null,
        session: data?.session ?? null,
        user: data?.user ?? null,
      });
    },

    onAuthStateChange(callback) {
      if (typeof callback !== 'function') {
        throw new TypeError('An Auth state callback is required.');
      }

      const { data } = client.auth.onAuthStateChange((event, session) => {
        callback(Object.freeze({ event, session: session ?? null }));
      });
      const subscription = data?.subscription;

      return Object.freeze({
        unsubscribe() {
          subscription?.unsubscribe();
        },
      });
    },
  });
}

const authService = createAuthService();

export const getSession = (...args) => authService.getSession(...args);
export const getUser = (...args) => authService.getUser(...args);
export const signInWithPassword = (...args) => authService.signInWithPassword(...args);
export const signUp = (...args) => authService.signUp(...args);
export const signOut = (...args) => authService.signOut(...args);
export const resetPasswordForEmail = (...args) => authService.resetPasswordForEmail(...args);
export const updatePassword = (...args) => authService.updatePassword(...args);
export const exchangeCodeForSession = (...args) => authService.exchangeCodeForSession(...args);
export const onAuthStateChange = (...args) => authService.onAuthStateChange(...args);
