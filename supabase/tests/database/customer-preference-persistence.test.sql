BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(76);

SELECT has_table(
  'public',
  'customer_preferences',
  'customer current preference state exists'
);

SELECT has_table(
  'public',
  'customer_preference_events',
  'customer preference event history exists'
);

SELECT columns_are(
  'public',
  'customer_preferences',
  ARRAY[
    'user_id',
    'optional_order_updates_enabled',
    'marketing_communications_enabled',
    'created_at',
    'updated_at'
  ],
  'customer preferences expose only the intended current-state columns'
);

SELECT columns_are(
  'public',
  'customer_preference_events',
  ARRAY[
    'id',
    'user_id',
    'preference_key',
    'old_value',
    'new_value',
    'occurred_at',
    'source',
    'notice_version'
  ],
  'preference events contain no duplicated identity, browser, or credential data'
);

SELECT ok(
  (
    SELECT jsonb_object_agg(column_name, data_type ORDER BY ordinal_position)
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'customer_preferences'
  ) = jsonb_build_object(
    'user_id', 'uuid',
    'optional_order_updates_enabled', 'boolean',
    'marketing_communications_enabled', 'boolean',
    'created_at', 'timestamp with time zone',
    'updated_at', 'timestamp with time zone'
  ),
  'customer preference columns use the intended data types'
);

SELECT ok(
  (
    SELECT jsonb_object_agg(column_name, data_type ORDER BY ordinal_position)
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'customer_preference_events'
  ) = jsonb_build_object(
    'id', 'bigint',
    'user_id', 'uuid',
    'preference_key', 'text',
    'old_value', 'boolean',
    'new_value', 'boolean',
    'occurred_at', 'timestamp with time zone',
    'source', 'text',
    'notice_version', 'text'
  ),
  'customer preference event columns use the intended data types'
);

SELECT ok(
  (
    SELECT column_default = 'true'
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'customer_preferences'
      AND column_name = 'optional_order_updates_enabled'
  )
    AND (
      SELECT column_default = 'false'
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'customer_preferences'
        AND column_name = 'marketing_communications_enabled'
    ),
  'optional order updates default true and marketing defaults false'
);

SELECT ok(
  (
    SELECT is_identity = 'YES' AND identity_generation = 'ALWAYS'
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'customer_preference_events'
      AND column_name = 'id'
  ),
  'event identifiers are generated-always identity values'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.customer_preferences'::regclass
      AND contype = 'p'
      AND pg_catalog.pg_get_constraintdef(oid) = 'PRIMARY KEY (user_id)'
  )
    AND EXISTS (
      SELECT 1
      FROM pg_catalog.pg_constraint
      WHERE conrelid = 'public.customer_preferences'::regclass
        AND confrelid = 'auth.users'::regclass
        AND contype = 'f'
        AND pg_catalog.pg_get_constraintdef(oid) LIKE
          'FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE%'
    ),
  'current preferences have Auth-owned primary-key and cascading foreign-key constraints'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.customer_preference_events'::regclass
      AND contype = 'p'
      AND pg_catalog.pg_get_constraintdef(oid) = 'PRIMARY KEY (id)'
  )
    AND EXISTS (
      SELECT 1
      FROM pg_catalog.pg_constraint
      WHERE conrelid = 'public.customer_preference_events'::regclass
        AND confrelid = 'auth.users'::regclass
        AND contype = 'f'
        AND pg_catalog.pg_get_constraintdef(oid) LIKE
          'FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE%'
    ),
  'event history has an identity primary key and cascading Auth ownership'
);

SELECT is(
  (
    SELECT count(*)
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.customer_preference_events'::regclass
      AND conname IN (
        'customer_preference_events_preference_key_check',
        'customer_preference_events_value_transition_check',
        'customer_preference_events_source_check',
        'customer_preference_events_notice_version_check'
      )
      AND contype = 'c'
  ),
  4::bigint,
  'event history has all four evidence-integrity constraints'
);

SELECT ok(
  (
    SELECT pg_catalog.pg_get_indexdef(indexrelid)
    FROM pg_catalog.pg_index
    WHERE indexrelid = 'public.customer_preference_events_user_history_idx'::regclass
  ) LIKE '%(user_id, occurred_at DESC, id DESC)',
  'event history has one ordered per-user composite index'
);

SELECT is(
  (
    SELECT count(*)
    FROM pg_catalog.pg_trigger
    WHERE tgrelid = 'public.customer_preferences'::regclass
      AND tgname = 'set_customer_preferences_updated_at'
      AND tgfoid = 'public.set_customer_account_updated_at()'::regprocedure
      AND NOT tgisinternal
  ),
  1::bigint,
  'current preferences reuse the existing server-owned updated-at trigger'
);

SELECT ok(
  (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid = 'public.customer_preferences'::regclass)
    AND (
      SELECT relrowsecurity
      FROM pg_catalog.pg_class
      WHERE oid = 'public.customer_preference_events'::regclass
    ),
  'RLS is enabled on current state and event history'
);

SELECT is(
  (
    SELECT count(*)
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'customer_preferences'
      AND cmd = 'SELECT'
      AND roles = ARRAY['authenticated']::name[]
      AND qual LIKE '%auth.uid()%'
      AND qual LIKE '%user_id%'
  ),
  1::bigint,
  'authenticated customers have exactly one own-row read policy'
);

SELECT is(
  (
    SELECT count(*)
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'customer_preference_events'
  ),
  0::bigint,
  'event history exposes no browser policy'
);

SELECT ok(
  NOT has_table_privilege('anon', 'public.customer_preferences', 'SELECT,INSERT,UPDATE,DELETE')
    AND NOT has_table_privilege(
      'anon', 'public.customer_preference_events', 'SELECT,INSERT,UPDATE,DELETE'
    ),
  'anonymous clients have no preference table privileges'
);

SELECT ok(
  has_table_privilege('authenticated', 'public.customer_preferences', 'SELECT')
    AND NOT has_table_privilege(
      'authenticated', 'public.customer_preferences', 'INSERT,UPDATE,DELETE,TRUNCATE'
    ),
  'authenticated clients can only read current preference state'
);

SELECT ok(
  NOT has_table_privilege(
    'authenticated', 'public.customer_preference_events', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'
  ),
  'authenticated clients have no direct event-history privilege'
);

SELECT ok(
  has_table_privilege('service_role', 'public.customer_preferences', 'SELECT')
    AND NOT has_table_privilege(
      'service_role', 'public.customer_preferences', 'INSERT,UPDATE,DELETE,TRUNCATE'
    ),
  'service role has read-only current-state access'
);

SELECT ok(
  has_table_privilege('service_role', 'public.customer_preference_events', 'SELECT')
    AND NOT has_table_privilege(
      'service_role', 'public.customer_preference_events', 'INSERT,UPDATE,DELETE,TRUNCATE'
    ),
  'routine service-role event access is read-only'
);

SELECT ok(
  NOT has_sequence_privilege(
    'anon', 'public.customer_preference_events_id_seq', 'USAGE,SELECT,UPDATE'
  )
    AND NOT has_sequence_privilege(
      'authenticated', 'public.customer_preference_events_id_seq', 'USAGE,SELECT,UPDATE'
    )
    AND NOT has_sequence_privilege(
      'service_role', 'public.customer_preference_events_id_seq', 'USAGE,SELECT,UPDATE'
    ),
  'routine roles cannot allocate or manipulate event identifiers'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS procedures
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(
        procedures.proacl,
        pg_catalog.acldefault('f', procedures.proowner)
      )
    ) AS privileges
    WHERE procedures.oid =
      'public.set_customer_preference_v1(text,boolean,text)'::regprocedure
      AND privileges.grantee = 0
      AND privileges.privilege_type = 'EXECUTE'
  ),
  'PUBLIC cannot execute the preference RPC'
);

SELECT ok(
  NOT has_function_privilege(
    'anon', 'public.set_customer_preference_v1(text,boolean,text)', 'EXECUTE'
  ),
  'anonymous clients cannot execute the preference RPC'
);

SELECT ok(
  has_function_privilege(
    'authenticated', 'public.set_customer_preference_v1(text,boolean,text)', 'EXECUTE'
  ),
  'authenticated clients can execute only the intended preference RPC signature'
);

SELECT ok(
  NOT has_function_privilege(
    'service_role', 'public.set_customer_preference_v1(text,boolean,text)', 'EXECUTE'
  ),
  'service role has no unaudited preference mutation RPC path'
);

SELECT ok(
  (
    SELECT prosecdef
      AND pg_catalog.pg_get_userbyid(proowner) = 'postgres'
    FROM pg_catalog.pg_proc
    WHERE oid = 'public.set_customer_preference_v1(text,boolean,text)'::regprocedure
  ),
  'the preference RPC is postgres-owned SECURITY DEFINER'
);

SELECT ok(
  (
    SELECT proconfig = ARRAY['search_path=""']::text[]
    FROM pg_catalog.pg_proc
    WHERE oid = 'public.set_customer_preference_v1(text,boolean,text)'::regprocedure
  ),
  'the preference RPC has an exact fixed empty search path'
);

SELECT is(
  (
    SELECT pg_catalog.pg_get_function_identity_arguments(oid)
    FROM pg_catalog.pg_proc
    WHERE oid = 'public.set_customer_preference_v1(text,boolean,text)'::regprocedure
  ),
  'p_preference_key text, p_enabled boolean, p_expected_notice_version text',
  'the RPC accepts no user ID, event source, or timestamp input'
);

SELECT is(
  (
    SELECT pg_catalog.pg_get_function_result(oid)
    FROM pg_catalog.pg_proc
    WHERE oid = 'public.set_customer_preference_v1(text,boolean,text)'::regprocedure
  ),
  'customer_preferences',
  'the RPC returns authoritative current preference state'
);

INSERT INTO auth.users (id, email, raw_user_meta_data)
VALUES
  ('ce000000-0000-4000-8000-000000000001', 'preference-a@example.test', '{}'::jsonb),
  ('ce000000-0000-4000-8000-000000000002', 'preference-b@example.test', '{}'::jsonb),
  ('ce000000-0000-4000-8000-000000000003', 'preference-c@example.test', '{}'::jsonb);

SELECT set_config(
  'request.jwt.claim.sub',
  'ce000000-0000-4000-8000-000000000001',
  true
);
SET LOCAL ROLE authenticated;

SELECT ok(
  COALESCE(
    (
      SELECT optional_order_updates_enabled
      FROM public.customer_preferences
      WHERE user_id = auth.uid()
    ),
    true
  )
    AND NOT COALESCE(
      (
        SELECT marketing_communications_enabled
        FROM public.customer_preferences
        WHERE user_id = auth.uid()
      ),
      false
    ),
  'a missing row resolves to optional order updates true and marketing false'
);

RESET ROLE;
SET LOCAL ROLE anon;

SELECT throws_ok(
  $$SELECT * FROM public.customer_preferences$$,
  '42501',
  'permission denied for table customer_preferences',
  'anonymous clients cannot read preferences'
);

RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$SELECT public.set_customer_preference_v1('optional_order_updates', false, NULL)$$,
  '42501',
  'Authentication is required to change customer preferences.',
  'the RPC rejects an authenticated role without an Auth user identity'
);

RESET ROLE;
SELECT set_config(
  'request.jwt.claim.sub',
  'ce000000-0000-4000-8000-000000000001',
  true
);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$INSERT INTO public.customer_preferences (user_id) VALUES (auth.uid())$$,
  '42501',
  'permission denied for table customer_preferences',
  'browser clients cannot insert current preference rows directly'
);

CREATE TEMPORARY TABLE preference_test_clock (
  started_at timestamptz NOT NULL
) ON COMMIT DROP;

INSERT INTO preference_test_clock (started_at)
VALUES (pg_catalog.clock_timestamp());

SELECT lives_ok(
  $$SELECT public.set_customer_preference_v1('optional_order_updates', false, NULL)$$,
  'an owner can atomically change optional order updates on first use'
);

SELECT ok(
  (
    SELECT NOT optional_order_updates_enabled
      AND NOT marketing_communications_enabled
    FROM public.customer_preferences
    WHERE user_id = auth.uid()
  ),
  'lazy creation preserves marketing false while applying the requested order-update change'
);

SELECT is(
  (SELECT count(*) FROM public.customer_preferences),
  1::bigint,
  'customer A can read exactly the owned current preference row'
);

SELECT throws_ok(
  $$UPDATE public.customer_preferences SET marketing_communications_enabled = true WHERE user_id = auth.uid()$$,
  '42501',
  'permission denied for table customer_preferences',
  'browser clients cannot update current preference rows directly'
);

SELECT throws_ok(
  $$DELETE FROM public.customer_preferences WHERE user_id = auth.uid()$$,
  '42501',
  'permission denied for table customer_preferences',
  'browser clients cannot delete current preference rows directly'
);

SELECT throws_ok(
  $$SELECT * FROM public.customer_preference_events$$,
  '42501',
  'permission denied for table customer_preference_events',
  'browser clients cannot read event history'
);

SELECT throws_ok(
  $$
    INSERT INTO public.customer_preference_events (
      user_id, preference_key, old_value, new_value, source
    )
    VALUES (auth.uid(), 'optional_order_updates', true, false, 'account_settings')
  $$,
  '42501',
  'permission denied for table customer_preference_events',
  'browser clients cannot fabricate preference events'
);

SELECT throws_ok(
  $$UPDATE public.customer_preference_events SET new_value = true$$,
  '42501',
  'permission denied for table customer_preference_events',
  'browser clients cannot update preference evidence'
);

SELECT throws_ok(
  $$DELETE FROM public.customer_preference_events$$,
  '42501',
  'permission denied for table customer_preference_events',
  'browser clients cannot delete preference evidence'
);

RESET ROLE;

SELECT is(
  (
    SELECT count(*)
    FROM public.customer_preference_events
    WHERE user_id = 'ce000000-0000-4000-8000-000000000001'
  ),
  1::bigint,
  'one real first-use state change creates exactly one event'
);

SELECT ok(
  (
    SELECT preference_key = 'optional_order_updates'
      AND old_value
      AND NOT new_value
      AND source = 'account_settings'
      AND notice_version IS NULL
    FROM public.customer_preference_events
    WHERE user_id = 'ce000000-0000-4000-8000-000000000001'
  ),
  'the optional-order event records the server-derived owner, transition, source, and null notice'
);

SELECT ok(
  (
    SELECT occurred_at >= (SELECT started_at FROM preference_test_clock)
      AND occurred_at <= pg_catalog.clock_timestamp()
    FROM public.customer_preference_events
    WHERE user_id = 'ce000000-0000-4000-8000-000000000001'
  ),
  'the event timestamp is generated inside the database operation'
);

SELECT set_config(
  'request.jwt.claim.sub',
  'ce000000-0000-4000-8000-000000000001',
  true
);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $$SELECT public.set_customer_preference_v1('optional_order_updates', false, NULL)$$,
  'a same-value preference request returns successfully'
);

RESET ROLE;

SELECT is(
  (
    SELECT count(*)
    FROM public.customer_preference_events
    WHERE user_id = 'ce000000-0000-4000-8000-000000000001'
  ),
  1::bigint,
  'a same-value request creates no event'
);

SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$SELECT public.set_customer_preference_v1('unsupported', true, NULL)$$,
  '22023',
  'Unsupported customer preference key.',
  'invalid preference keys fail closed'
);

SELECT throws_ok(
  $$SELECT public.set_customer_preference_v1(NULL, true, NULL)$$,
  '22023',
  'Unsupported customer preference key.',
  'null preference keys fail closed at the validation boundary'
);

SELECT throws_ok(
  $$SELECT public.set_customer_preference_v1('optional_order_updates', true, 'account-settings-marketing-v1')$$,
  '22023',
  'Optional order updates do not accept a marketing notice version.',
  'optional order updates reject a marketing notice version'
);

RESET ROLE;

SELECT ok(
  (
    SELECT NOT optional_order_updates_enabled
      AND NOT marketing_communications_enabled
    FROM public.customer_preferences
    WHERE user_id = 'ce000000-0000-4000-8000-000000000001'
  )
    AND (
      SELECT count(*) = 1
      FROM public.customer_preference_events
      WHERE user_id = 'ce000000-0000-4000-8000-000000000001'
    ),
  'invalid inputs leave current state and event history unchanged'
);

SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $$
    SELECT public.set_customer_preference_v1(
      'marketing_communications', true, 'account-settings-marketing-v1'
    )
  $$,
  'marketing can be enabled with the current expected notice version'
);

RESET ROLE;

SELECT ok(
  (
    SELECT marketing_communications_enabled
    FROM public.customer_preferences
    WHERE user_id = 'ce000000-0000-4000-8000-000000000001'
  )
    AND EXISTS (
      SELECT 1
      FROM public.customer_preference_events
      WHERE user_id = 'ce000000-0000-4000-8000-000000000001'
        AND preference_key = 'marketing_communications'
        AND NOT old_value
        AND new_value
        AND source = 'account_settings'
        AND notice_version = 'account-settings-marketing-v1'
    ),
  'marketing enablement stores current state and server-owned notice evidence'
);

SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$
    SELECT public.set_customer_preference_v1(
      'marketing_communications', false, 'stale-marketing-notice'
    )
  $$,
  '22023',
  'The marketing notice version is not current.',
  'a mismatched marketing notice version fails closed'
);

RESET ROLE;

SELECT ok(
  (
    SELECT marketing_communications_enabled
    FROM public.customer_preferences
    WHERE user_id = 'ce000000-0000-4000-8000-000000000001'
  )
    AND (
      SELECT count(*) = 1
      FROM public.customer_preference_events
      WHERE user_id = 'ce000000-0000-4000-8000-000000000001'
        AND preference_key = 'marketing_communications'
    ),
  'a notice mismatch changes neither marketing state nor history'
);

SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $$
    SELECT public.set_customer_preference_v1(
      'marketing_communications', false, 'account-settings-marketing-v1'
    )
  $$,
  'marketing withdrawal succeeds with the current notice version'
);

RESET ROLE;

SELECT ok(
  NOT (
    SELECT marketing_communications_enabled
    FROM public.customer_preferences
    WHERE user_id = 'ce000000-0000-4000-8000-000000000001'
  )
    AND EXISTS (
      SELECT 1
      FROM public.customer_preference_events
      WHERE user_id = 'ce000000-0000-4000-8000-000000000001'
        AND preference_key = 'marketing_communications'
        AND old_value
        AND NOT new_value
        AND notice_version = 'account-settings-marketing-v1'
    ),
  'marketing withdrawal is retained as a truthful versioned event'
);

SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$SELECT public.set_customer_preference_v1('optional_order_updates', NULL, NULL)$$,
  '22004',
  'A boolean preference value is required.',
  'null preference values fail closed'
);

SELECT lives_ok(
  $$
    SELECT public.set_customer_preference_v1('optional_order_updates', true, NULL);
    SELECT public.set_customer_preference_v1('optional_order_updates', false, NULL);
  $$,
  'sequential optional-order updates complete through the atomic RPC'
);

RESET ROLE;

SELECT is(
  (
    SELECT pg_catalog.array_agg(new_value ORDER BY id)
    FROM public.customer_preference_events
    WHERE user_id = 'ce000000-0000-4000-8000-000000000001'
      AND preference_key = 'optional_order_updates'
  ),
  ARRAY[false, true, false],
  'ordered optional-order history records every real committed state'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM (
      SELECT
        old_value,
        pg_catalog.lag(new_value) OVER (ORDER BY id) AS prior_new_value,
        pg_catalog.row_number() OVER (ORDER BY id) AS event_number
      FROM public.customer_preference_events
      WHERE user_id = 'ce000000-0000-4000-8000-000000000001'
        AND preference_key = 'optional_order_updates'
    ) AS ordered_events
    WHERE event_number > 1
      AND old_value IS DISTINCT FROM prior_new_value
  ),
  'each sequential event starts from the prior committed state'
);

SELECT ok(
  (
    SELECT updated_at > created_at
    FROM public.customer_preferences
    WHERE user_id = 'ce000000-0000-4000-8000-000000000001'
  ),
  'updated_at is advanced by the reused server-owned trigger'
);

SELECT set_config(
  'request.jwt.claim.sub',
  'ce000000-0000-4000-8000-000000000002',
  true
);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $$SELECT public.set_customer_preference_v1('optional_order_updates', false, NULL)$$,
  'customer B can establish independent preference state'
);

RESET ROLE;
SELECT set_config(
  'request.jwt.claim.sub',
  'ce000000-0000-4000-8000-000000000001',
  true
);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*) FROM public.customer_preferences),
  1::bigint,
  'customer A reads only one owned preference row after customer B is initialized'
);

SELECT is(
  (
    SELECT count(*)
    FROM public.customer_preferences
    WHERE user_id = 'ce000000-0000-4000-8000-000000000002'
  ),
  0::bigint,
  'customer A cannot read customer B preference state'
);

RESET ROLE;

SELECT throws_ok(
  $$INSERT INTO public.customer_preferences (user_id) VALUES ('ce000000-0000-4000-8000-000000000099')$$,
  '23503',
  NULL,
  'current preference ownership rejects a missing Auth user'
);

SELECT throws_ok(
  $$
    INSERT INTO public.customer_preference_events (
      user_id, preference_key, old_value, new_value, source
    )
    VALUES (
      'ce000000-0000-4000-8000-000000000099',
      'optional_order_updates', true, false, 'account_settings'
    )
  $$,
  '23503',
  NULL,
  'event ownership rejects a missing Auth user'
);

SELECT throws_ok(
  $$
    INSERT INTO public.customer_preference_events (
      user_id, preference_key, old_value, new_value, source
    )
    VALUES (
      'ce000000-0000-4000-8000-000000000001',
      'unsupported', true, false, 'account_settings'
    )
  $$,
  '23514',
  NULL,
  'the event table rejects unsupported preference keys'
);

SELECT throws_ok(
  $$
    INSERT INTO public.customer_preference_events (
      user_id, preference_key, old_value, new_value, source
    )
    VALUES (
      'ce000000-0000-4000-8000-000000000001',
      'optional_order_updates', true, true, 'account_settings'
    )
  $$,
  '23514',
  NULL,
  'the event table rejects non-transitions'
);

SELECT throws_ok(
  $$
    INSERT INTO public.customer_preference_events (
      user_id, preference_key, old_value, new_value, source
    )
    VALUES (
      'ce000000-0000-4000-8000-000000000001',
      'optional_order_updates', true, false, 'other_source'
    )
  $$,
  '23514',
  NULL,
  'the event table rejects unapproved sources'
);

SELECT throws_ok(
  $$
    INSERT INTO public.customer_preference_events (
      user_id, preference_key, old_value, new_value, source, notice_version
    )
    VALUES (
      'ce000000-0000-4000-8000-000000000001',
      'optional_order_updates', true, false, 'account_settings',
      'account-settings-marketing-v1'
    )
  $$,
  '23514',
  NULL,
  'optional-order events reject marketing notice evidence'
);

SELECT throws_ok(
  $$
    INSERT INTO public.customer_preference_events (
      user_id, preference_key, old_value, new_value, source, notice_version
    )
    VALUES (
      'ce000000-0000-4000-8000-000000000001',
      'marketing_communications', false, true, 'account_settings', NULL
    )
  $$,
  '23514',
  NULL,
  'marketing events require the server-owned notice version'
);

SELECT set_config(
  'request.jwt.claim.sub',
  'ce000000-0000-4000-8000-000000000003',
  true
);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $$SELECT public.set_customer_preference_v1('optional_order_updates', false, NULL)$$,
  'customer C preference state and evidence can be created before account deletion'
);

RESET ROLE;

DELETE FROM auth.users
WHERE id = 'ce000000-0000-4000-8000-000000000003';

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM public.customer_preferences
    WHERE user_id = 'ce000000-0000-4000-8000-000000000003'
  )
    AND NOT EXISTS (
      SELECT 1
      FROM public.customer_preference_events
      WHERE user_id = 'ce000000-0000-4000-8000-000000000003'
    ),
  'Auth user deletion currently cascades current preference and event rows'
);

SELECT ok(
  NOT has_table_privilege('authenticated', 'public.customer_profiles', 'UPDATE')
    AND has_column_privilege('authenticated', 'public.customer_profiles', 'first_name', 'UPDATE')
    AND has_column_privilege('authenticated', 'public.customer_profiles', 'last_name', 'UPDATE')
    AND has_column_privilege('authenticated', 'public.customer_profiles', 'phone', 'UPDATE')
    AND NOT has_column_privilege('authenticated', 'public.customer_profiles', 'email', 'UPDATE')
    AND NOT has_column_privilege('authenticated', 'public.customer_profiles', 'stripe_customer_id', 'UPDATE'),
  'the migration leaves customer profile browser-write boundaries unchanged'
);

SELECT * FROM finish();

ROLLBACK;
