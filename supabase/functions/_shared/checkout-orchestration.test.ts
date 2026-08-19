import { assertEquals, assertRejects } from 'jsr:@std/assert@1';
import {
  callCheckoutRpc,
  CheckoutDatabaseError,
  getCheckoutDatabaseErrorDiagnostic,
} from './checkout-orchestration.ts';

Deno.test('checkout database errors retain a safe RPC diagnostic', async () => {
  const supabase = {
    rpc: async () => ({
      data: null,
      error: {
        message: 'sensitive database message',
        code: '57014',
        details: 'sensitive database details',
      },
    }),
  };

  const error = await assertRejects(
    () =>
      callCheckoutRpc(supabase as never, 'terminalize_unmaterialized_checkout_attempt_v1', {
        p_checkout_attempt_id: 'not-logged',
      }),
    CheckoutDatabaseError
  );

  assertEquals(error.rpcName, 'terminalize_unmaterialized_checkout_attempt_v1');
  assertEquals(error.code, '57014');
  assertEquals(error.details, 'sensitive database details');
  assertEquals(getCheckoutDatabaseErrorDiagnostic(error), {
    rpc_name: 'terminalize_unmaterialized_checkout_attempt_v1',
    database_error_code: '57014',
  });
});

Deno.test('checkout database diagnostics expose no message, details, or parameters', () => {
  const error = new CheckoutDatabaseError(
    'sensitive database message',
    null,
    'sensitive database details',
    'get_checkout_attempt_abandonment_context_v1'
  );
  const diagnostic = getCheckoutDatabaseErrorDiagnostic(error);

  assertEquals(diagnostic, {
    rpc_name: 'get_checkout_attempt_abandonment_context_v1',
    database_error_code: 'unknown',
  });
  assertEquals(Object.keys(diagnostic || {}).sort(), ['database_error_code', 'rpc_name']);
  assertEquals(getCheckoutDatabaseErrorDiagnostic(new Error('not a database error')), null);
});
