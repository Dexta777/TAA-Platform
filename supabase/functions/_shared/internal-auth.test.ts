import { assertEquals } from 'jsr:@std/assert@1';
import {
  isBearerTokenAuthorized,
  matchesAnyConfiguredSecret,
  requireInternalToken,
} from './internal-auth.ts';

Deno.test('matches the current or previous configured secret', () => {
  assertEquals(matchesAnyConfiguredSecret('current', ['current', 'previous']), true);
  assertEquals(matchesAnyConfiguredSecret('previous', ['current', 'previous']), true);
  assertEquals(matchesAnyConfiguredSecret('wrong', ['current', 'previous']), false);
  assertEquals(matchesAnyConfiguredSecret('', ['current', 'previous']), false);
});

Deno.test('reconciler bearer rotation accepts current and previous but rejects all others', () => {
  const request = (value = '') =>
    new Request('https://example.test', {
      method: 'POST',
      headers: value ? { authorization: `Bearer ${value}` } : {},
    });

  assertEquals(isBearerTokenAuthorized(request('current'), 'current', 'previous'), true);
  assertEquals(isBearerTokenAuthorized(request('previous'), 'current', 'previous'), true);
  assertEquals(isBearerTokenAuthorized(request('wrong'), 'current', 'previous'), false);
  assertEquals(isBearerTokenAuthorized(request(), 'current', 'previous'), false);
});

Deno.test('requires the named internal header', () => {
  const request = new Request('https://example.test', {
    headers: { 'x-taa-internal-token': 'secret' },
  });

  assertEquals(
    requireInternalToken(request, {
      headerName: 'x-taa-internal-token',
      currentSecret: 'secret',
    }),
    true
  );
  assertEquals(
    requireInternalToken(new Request('https://example.test'), {
      headerName: 'x-taa-internal-token',
      currentSecret: 'secret',
    }),
    false
  );
});
