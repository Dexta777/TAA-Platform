-- Durable customer-controlled communication preferences and append-only evidence.
--
-- Optional order-status updates are convenience messages and never control
-- confirmations, receipts, fulfilment-critical notices, security messages, or
-- legally/operationally necessary service communication. Marketing remains an
-- independent explicit choice with server-authored notice-version evidence.

DO $preflight$
BEGIN
  IF to_regclass('auth.users') IS NULL
    OR to_regclass('public.customer_profiles') IS NULL
    OR to_regprocedure('public.set_customer_account_updated_at()') IS NULL
  THEN
    RAISE EXCEPTION
      'Customer identity foundation is incomplete; refusing preference persistence migration.';
  END IF;

  IF to_regclass('public.customer_preferences') IS NOT NULL
    OR to_regclass('public.customer_preference_events') IS NOT NULL
  THEN
    RAISE EXCEPTION
      'Customer preference relations already exist; refusing duplicate infrastructure.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS procedures
    JOIN pg_catalog.pg_namespace AS namespaces
      ON namespaces.oid = procedures.pronamespace
    WHERE namespaces.nspname = 'public'
      AND procedures.proname = 'set_customer_preference_v1'
  ) THEN
    RAISE EXCEPTION
      'Customer preference RPC already exists; refusing duplicate infrastructure.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS constraints
    WHERE constraints.conrelid = 'public.customer_profiles'::regclass
      AND constraints.confrelid = 'auth.users'::regclass
      AND constraints.contype = 'f'
      AND pg_catalog.pg_get_constraintdef(constraints.oid) LIKE
        'FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE%'
  ) THEN
    RAISE EXCEPTION
      'Canonical customer profile ownership is unexpected; refusing preference persistence migration.';
  END IF;
END;
$preflight$;

CREATE TABLE public.customer_preferences (
  user_id uuid PRIMARY KEY
    REFERENCES auth.users(id)
    ON DELETE CASCADE,
  optional_order_updates_enabled boolean NOT NULL DEFAULT true,
  marketing_communications_enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.statement_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.statement_timestamp()
);

CREATE TABLE public.customer_preference_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL
    REFERENCES auth.users(id)
    ON DELETE CASCADE,
  preference_key text NOT NULL,
  old_value boolean NOT NULL,
  new_value boolean NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT pg_catalog.statement_timestamp(),
  source text NOT NULL,
  notice_version text,
  CONSTRAINT customer_preference_events_preference_key_check
    CHECK (preference_key IN ('optional_order_updates', 'marketing_communications')),
  CONSTRAINT customer_preference_events_value_transition_check
    CHECK (old_value IS DISTINCT FROM new_value),
  CONSTRAINT customer_preference_events_source_check
    CHECK (source = 'account_settings'),
  CONSTRAINT customer_preference_events_notice_version_check
    CHECK (
      (
        preference_key = 'optional_order_updates'
        AND notice_version IS NULL
      )
      OR
      (
        preference_key = 'marketing_communications'
        AND notice_version IS NOT NULL
        AND notice_version = 'account-settings-marketing-v1'
      )
    )
);

CREATE INDEX customer_preference_events_user_history_idx
ON public.customer_preference_events (user_id, occurred_at DESC, id DESC);

CREATE TRIGGER set_customer_preferences_updated_at
BEFORE UPDATE ON public.customer_preferences
FOR EACH ROW
EXECUTE FUNCTION public.set_customer_account_updated_at();

ALTER TABLE public.customer_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_preference_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Customers can view own preferences"
ON public.customer_preferences
FOR SELECT
TO authenticated
USING ((SELECT auth.uid()) = user_id);

CREATE FUNCTION public.set_customer_preference_v1(
  p_preference_key text,
  p_enabled boolean,
  p_expected_notice_version text DEFAULT NULL
)
RETURNS public.customer_preferences
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_old_value boolean;
  v_preferences public.customer_preferences%ROWTYPE;
  v_marketing_notice_version CONSTANT text := 'account-settings-marketing-v1';
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required to change customer preferences.'
      USING ERRCODE = '42501';
  END IF;

  IF p_enabled IS NULL THEN
    RAISE EXCEPTION 'A boolean preference value is required.'
      USING ERRCODE = '22004';
  END IF;

  IF p_preference_key IS NULL
    OR p_preference_key NOT IN ('optional_order_updates', 'marketing_communications')
  THEN
    RAISE EXCEPTION 'Unsupported customer preference key.'
      USING ERRCODE = '22023';
  END IF;

  IF p_preference_key = 'optional_order_updates'
    AND p_expected_notice_version IS NOT NULL
  THEN
    RAISE EXCEPTION 'Optional order updates do not accept a marketing notice version.'
      USING ERRCODE = '22023';
  END IF;

  IF p_preference_key = 'marketing_communications'
    AND p_expected_notice_version IS DISTINCT FROM v_marketing_notice_version
  THEN
    RAISE EXCEPTION 'The marketing notice version is not current.'
      USING ERRCODE = '22023';
  END IF;

  -- Concurrent first use is resolved by the primary-key conflict. A competing
  -- insert waits for the winner, then both callers serialize on the same row.
  INSERT INTO public.customer_preferences (user_id)
  VALUES (v_user_id)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT preferences.*
  INTO STRICT v_preferences
  FROM public.customer_preferences AS preferences
  WHERE preferences.user_id = v_user_id
  FOR UPDATE;

  v_old_value := CASE p_preference_key
    WHEN 'optional_order_updates'
      THEN v_preferences.optional_order_updates_enabled
    WHEN 'marketing_communications'
      THEN v_preferences.marketing_communications_enabled
  END;

  IF v_old_value IS NOT DISTINCT FROM p_enabled THEN
    RETURN v_preferences;
  END IF;

  IF p_preference_key = 'optional_order_updates' THEN
    UPDATE public.customer_preferences AS preferences
    SET optional_order_updates_enabled = p_enabled
    WHERE preferences.user_id = v_user_id
    RETURNING preferences.* INTO STRICT v_preferences;
  ELSE
    UPDATE public.customer_preferences AS preferences
    SET marketing_communications_enabled = p_enabled
    WHERE preferences.user_id = v_user_id
    RETURNING preferences.* INTO STRICT v_preferences;
  END IF;

  INSERT INTO public.customer_preference_events (
    user_id,
    preference_key,
    old_value,
    new_value,
    occurred_at,
    source,
    notice_version
  )
  VALUES (
    v_user_id,
    p_preference_key,
    v_old_value,
    p_enabled,
    pg_catalog.statement_timestamp(),
    'account_settings',
    CASE p_preference_key
      WHEN 'marketing_communications' THEN v_marketing_notice_version
      ELSE NULL
    END
  );

  RETURN v_preferences;
END;
$function$;

ALTER FUNCTION public.set_customer_preference_v1(text, boolean, text) OWNER TO postgres;

-- New public-schema objects are explicitly closed before the exact intended
-- read and RPC surfaces are granted. Service access is read-only until a
-- separately reviewed service-side preference workflow exists.
REVOKE ALL PRIVILEGES ON TABLE public.customer_preferences
FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON TABLE public.customer_preference_events
FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON SEQUENCE public.customer_preference_events_id_seq
FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT ON TABLE public.customer_preferences TO authenticated;
GRANT SELECT ON TABLE public.customer_preferences TO service_role;
GRANT SELECT ON TABLE public.customer_preference_events TO service_role;

REVOKE ALL ON FUNCTION public.set_customer_preference_v1(text, boolean, text)
FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_customer_preference_v1(text, boolean, text)
TO authenticated;

COMMENT ON TABLE public.customer_preferences IS
  'Current customer-controlled optional communications state. Missing rows mean optional order updates enabled and marketing disabled.';
COMMENT ON COLUMN public.customer_preferences.optional_order_updates_enabled IS
  'Controls optional order-status convenience messages only; essential transactional and service communications are unaffected.';
COMMENT ON TABLE public.customer_preference_events IS
  'Append-only server-authored evidence of real customer preference transitions.';
COMMENT ON FUNCTION public.set_customer_preference_v1(text, boolean, text) IS
  'Authenticated atomic preference mutation boundary; derives ownership, timestamps, source, and marketing notice evidence on the server.';

-- Both preference tables intentionally cascade when auth.users is deleted.
-- Before TAA implements account deletion, retention, withdrawal/suppression
-- evidence, and erasure requirements must receive a separate decision.
