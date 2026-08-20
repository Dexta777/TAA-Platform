/* global URL, URLSearchParams, window */

// Future Webflow contract: load synchronously on /account before every third-party script, then
// execute the TAA main bundle early enough to consume and remove the one-time handoff first.

(function runTaaAuthCallbackPrelude(windowObject) {
  'use strict';

  var ACCOUNT_PATH = '/account';
  var HANDOFF_EVENT = 'taa:auth-callback-handoff';
  var HANDOFF_VERSION = 1;
  var FAILURE_QUERY_KEY = 'taa_auth_callback';
  var FAILURE_QUERY_VALUE = 'unavailable';
  var AUTH_CODE_MAX_LENGTH = 4096;
  var QUERY_KEYS = ['code', 'error', 'error_code', 'error_description', 'sb_flow_id', 'type'];
  var HASH_TOKEN_KEYS = [
    'access_token',
    'provider_refresh_token',
    'provider_token',
    'refresh_token',
  ];
  var ERROR_KEYS = ['error', 'error_code', 'error_description'];
  var SAFE_PKCE_FLOW_ID = /^[a-zA-Z0-9_-]{8,64}$/;

  function normalizePathname(pathname) {
    return String(pathname || '/').replace(/\/+$/, '') || '/';
  }

  function hasAny(parameters, keys) {
    return keys.some(function hasParameter(key) {
      return parameters.has(key);
    });
  }

  var url;

  try {
    url = new URL(windowObject.location.href);
  } catch {
    return;
  }

  if (normalizePathname(url.pathname) !== ACCOUNT_PATH) return;

  var hashParameters = new URLSearchParams(url.hash.replace(/^#/, ''));
  var hasQueryCode = url.searchParams.has('code');
  var hasQueryError = hasAny(url.searchParams, ERROR_KEYS);
  var hasHashToken = hasAny(hashParameters, HASH_TOKEN_KEYS);
  var hasHashError = hasAny(hashParameters, ERROR_KEYS);

  if (!hasQueryCode && !hasQueryError && !hasHashToken && !hasHashError) return;

  var code = url.searchParams.get('code');
  var flowId = url.searchParams.get('sb_flow_id');
  var normalizedCode = code && code.length <= AUTH_CODE_MAX_LENGTH ? code : null;
  var normalizedFlowId = flowId && SAFE_PKCE_FLOW_ID.test(flowId) ? flowId : null;
  var callback = {
    allowed: true,
    capturedAt: Date.now(),
    code: normalizedCode,
    error: hasQueryError || hasHashError,
    flowId: normalizedFlowId,
    invalid:
      hasHashToken || (hasQueryCode && !normalizedCode) || (flowId !== null && !normalizedFlowId),
    recovery:
      url.searchParams.get('type') === 'recovery' || hashParameters.get('type') === 'recovery',
    version: HANDOFF_VERSION,
  };
  var handoffReady;

  function handoffCallback(event) {
    var receive = event && event.detail && event.detail.receive;

    if (typeof receive !== 'function') return;

    windowObject.removeEventListener(HANDOFF_EVENT, handoffCallback);
    var callbackValue = callback;
    callback = null;
    receive(callbackValue);
  }

  try {
    windowObject.addEventListener(HANDOFF_EVENT, handoffCallback);
    handoffReady = true;
  } catch {
    handoffReady = false;
  }

  QUERY_KEYS.forEach(function removeCallbackParameter(key) {
    url.searchParams.delete(key);
  });

  if (hasHashToken || hasHashError) {
    url.hash = '';
  }

  if (!handoffReady) {
    url.searchParams.set(FAILURE_QUERY_KEY, FAILURE_QUERY_VALUE);
  }

  windowObject.history.replaceState(
    windowObject.history.state,
    '',
    url.pathname + url.search + url.hash
  );
})(window);
