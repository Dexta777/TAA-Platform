import { assert, assertEquals, assertNotEquals, assertRejects } from 'jsr:@std/assert@1';
import {
  getNetworkDimensions,
  deriveRateLimitIdentity,
  getNormalizedNetworkIdentity,
} from './rate-limit.ts';

Deno.test('network identity uses the first hosted forwarded address', () => {
  const request = new Request('https://project.supabase.co/functions/v1/test', {
    headers: { 'x-forwarded-for': '203.0.113.10, 198.51.100.1' },
  });

  assertEquals(getNormalizedNetworkIdentity(request), 'ipv4:203.0.113.10');
});

Deno.test('IPv6 clients are normalized to a /64 network', () => {
  const first = new Request('https://project.supabase.co/functions/v1/test', {
    headers: { 'x-forwarded-for': '2001:db8:abcd:12::1' },
  });
  const second = new Request('https://project.supabase.co/functions/v1/test', {
    headers: { 'x-forwarded-for': '2001:0db8:abcd:0012:ffff::99' },
  });

  assertEquals(getNormalizedNetworkIdentity(first), 'ipv6:2001:db8:abcd:12::/64');
  assertEquals(getNormalizedNetworkIdentity(second), getNormalizedNetworkIdentity(first));
});

Deno.test('missing trusted network identity fails closed', () => {
  assertRejects(async () => getNormalizedNetworkIdentity(new Request('https://example.com')));
});

Deno.test('network dimensions always include the shared policy', () => {
  const dimensions = getNetworkDimensions('derived-network-key', [
    { name: 'endpoint', refillTokens: 10, refillWindowSeconds: 60 },
  ]);

  assertEquals(dimensions.length, 2);
  assertEquals(dimensions[0].policy.name, 'network_shared');
  assertEquals(dimensions[1].policy.name, 'endpoint');
});

Deno.test('network limiter keys are deterministic peppered lowercase HMAC values', async () => {
  const first = await deriveRateLimitIdentity('first-test-pepper', 'ipv4:203.0.113.10');
  const equivalent = await deriveRateLimitIdentity('first-test-pepper', 'ipv4:203.0.113.10');
  const changed = await deriveRateLimitIdentity('second-test-pepper', 'ipv4:203.0.113.10');

  assertEquals(first, equivalent);
  assertNotEquals(first, changed);
  assert(/^[0-9a-f]{64}$/.test(first));
  assert(!first.includes('203.0.113.10'));
});
