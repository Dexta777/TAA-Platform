BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(8);

INSERT INTO public.checkout_attempts (
  id, capability_hash, capability_expires_at, status, hard_expires_at, completed_at,
  checkout_protocol_version
)
VALUES
  (
    'fa100000-0000-4000-8000-000000000001', repeat('1', 64),
    clock_timestamp() + interval '1 hour', 'failed', clock_timestamp() + interval '90 minutes',
    clock_timestamp(), 'reservation_v1'
  ),
  (
    'fa100000-0000-4000-8000-000000000002', repeat('2', 64),
    clock_timestamp() + interval '1 hour', 'expired', clock_timestamp() + interval '90 minutes',
    clock_timestamp(), 'reservation_v1'
  ),
  (
    'fa100000-0000-4000-8000-000000000003', repeat('3', 64),
    clock_timestamp() + interval '1 hour', 'failed', clock_timestamp() + interval '90 minutes',
    clock_timestamp(), 'reservation_v1'
  ),
  (
    'fa100000-0000-4000-8000-000000000004', repeat('4', 64),
    clock_timestamp() + interval '1 hour', 'expired', clock_timestamp() + interval '90 minutes',
    clock_timestamp(), 'reservation_v1'
  ),
  (
    'fa100000-0000-4000-8000-000000000005', repeat('5', 64),
    clock_timestamp() + interval '1 hour', 'failed', clock_timestamp() + interval '90 minutes',
    clock_timestamp(), 'reservation_v1'
  ),
  (
    'fa100000-0000-4000-8000-000000000006', repeat('6', 64),
    clock_timestamp() - interval '1 second', 'failed', clock_timestamp() + interval '90 minutes',
    clock_timestamp(), 'reservation_v1'
  );

INSERT INTO public.orders (id, email, order_number, total)
VALUES (
  'fa200000-0000-4000-8000-000000000001',
  'integrity-test@example.com',
  'TAA-5D1-INTEGRITY',
  10.00
);

INSERT INTO public.inventory_reservations (
  checkout_attempt_id, status, reserved_at, expires_at, consumed_at, released_at, release_reason,
  order_id
)
VALUES
  (
    'fa100000-0000-4000-8000-000000000001', 'released', clock_timestamp(),
    clock_timestamp() + interval '30 minutes', NULL, clock_timestamp(), 'test_release', NULL
  ),
  (
    'fa100000-0000-4000-8000-000000000002', 'released', clock_timestamp(),
    clock_timestamp() + interval '30 minutes', NULL, clock_timestamp(), 'test_release', NULL
  ),
  (
    'fa100000-0000-4000-8000-000000000003', 'held', clock_timestamp(),
    clock_timestamp() + interval '30 minutes', NULL, NULL, NULL, NULL
  ),
  (
    'fa100000-0000-4000-8000-000000000004', 'payment_pending', clock_timestamp(),
    clock_timestamp() + interval '30 minutes', NULL, NULL, NULL, NULL
  ),
  (
    'fa100000-0000-4000-8000-000000000005', 'consumed', clock_timestamp(),
    clock_timestamp() + interval '30 minutes', clock_timestamp(), NULL, NULL,
    'fa200000-0000-4000-8000-000000000001'
  );

SELECT is(
  (SELECT context_state FROM public.get_checkout_attempt_abandonment_context_v1(
    'fa100000-0000-4000-8000-000000000001', NULL, repeat('1', 64)
  )),
  'already_terminal',
  'failed attempt with released reservation is safe terminal state'
);

SELECT is(
  (SELECT context_state FROM public.get_checkout_attempt_abandonment_context_v1(
    'fa100000-0000-4000-8000-000000000002', NULL, repeat('2', 64)
  )),
  'already_terminal',
  'expired attempt with released reservation is safe terminal state'
);

SELECT is(
  (SELECT context_state FROM public.get_checkout_attempt_abandonment_context_v1(
    'fa100000-0000-4000-8000-000000000003', NULL, repeat('3', 64)
  )),
  'reconciliation_pending',
  'failed attempt with held reservation retains ownership for reconciliation'
);

SELECT is(
  (SELECT context_state FROM public.get_checkout_attempt_abandonment_context_v1(
    'fa100000-0000-4000-8000-000000000004', NULL, repeat('4', 64)
  )),
  'reconciliation_pending',
  'expired attempt with payment-pending reservation retains ownership for reconciliation'
);

SELECT is(
  (SELECT context_state FROM public.get_checkout_attempt_abandonment_context_v1(
    'fa100000-0000-4000-8000-000000000005', NULL, repeat('5', 64)
  )),
  'integrity_review',
  'terminal attempt with consumed reservation never grants safe abandonment'
);

SELECT is(
  public.terminalize_unmaterialized_checkout_attempt_v1(
    'fa100000-0000-4000-8000-000000000005', NULL, repeat('5', 64)
  ),
  false,
  'terminalization helper also refuses a consumed reservation'
);

SELECT throws_ok(
  $$SELECT * FROM public.authorize_checkout_attempt_v1(
    'fa100000-0000-4000-8000-000000000006', NULL, repeat('6', 64)
  )$$,
  'Checkout attempt capability has expired.',
  'raw attempt capability expiry is enforced server-side'
);

SELECT ok(
  NOT has_function_privilege(
    'anon', 'public.get_checkout_attempt_abandonment_context_v1(uuid,uuid,text)', 'EXECUTE'
  )
    AND NOT has_function_privilege(
      'authenticated',
      'public.terminalize_unmaterialized_checkout_attempt_v1(uuid,uuid,text)',
      'EXECUTE'
    ),
  'browser roles retain no direct abandonment RPC privilege'
);

SELECT * FROM finish();

ROLLBACK;
