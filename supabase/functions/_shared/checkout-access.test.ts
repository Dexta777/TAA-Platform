import { assertEquals } from 'jsr:@std/assert@1';
import { hasCheckoutAccess, sha256Hex } from './checkout-access.ts';

Deno.test(
  'checkout access accepts retained guest capability and rejects wrong or expired tokens',
  async () => {
    const token = 'guest-confirmation-capability';
    const checkoutIntent = {
      user_id: null,
      confirmation_token_hash: await sha256Hex(token),
      confirmation_token_expires_at: new Date(Date.now() + 60_000).toISOString(),
    };

    assertEquals(
      await hasCheckoutAccess({
        checkoutIntent,
        authenticatedUserId: null,
        confirmationToken: token,
      }),
      true
    );
    assertEquals(
      await hasCheckoutAccess({
        checkoutIntent,
        authenticatedUserId: null,
        confirmationToken: 'wrong-capability',
      }),
      false
    );
    assertEquals(
      await hasCheckoutAccess({
        checkoutIntent: {
          ...checkoutIntent,
          confirmation_token_expires_at: new Date(Date.now() - 1).toISOString(),
        },
        authenticatedUserId: null,
        confirmationToken: token,
      }),
      false
    );
  }
);

Deno.test('authenticated checkout owner does not require a confirmation capability', async () => {
  assertEquals(
    await hasCheckoutAccess({
      checkoutIntent: {
        user_id: '10000000-0000-4000-8000-000000000001',
        confirmation_token_hash: null,
        confirmation_token_expires_at: null,
      },
      authenticatedUserId: '10000000-0000-4000-8000-000000000001',
      confirmationToken: '',
    }),
    true
  );
});
