-- Phase 6A hardening: resolve the Klaviyo catalogue-sync Edge Function URL
-- from environment-specific Vault configuration.

CREATE OR REPLACE FUNCTION public.trigger_klaviyo_catalog_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_functions_url text;
  v_internal_token text;
BEGIN
  BEGIN
    SELECT btrim(decrypted_secret)
    INTO v_functions_url
    FROM vault.decrypted_secrets
    WHERE name = 'taa_supabase_functions_url';

    IF nullif(v_functions_url, '') IS NULL THEN
      RAISE WARNING
        'Klaviyo catalogue sync was skipped because its Vault functions URL is unavailable.';
      RETURN coalesce(new, old);
    END IF;

    -- Accept hosted HTTPS origins and explicit local HTTP origins for local Supabase.
    -- Paths, query strings, fragments, credentials, and multiple trailing slashes
    -- do not match these origin-only forms.
    IF v_functions_url !~ '^https://[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:[0-9]{1,5})?/?$'
      AND v_functions_url !~ '^http://(localhost|127[.]0[.]0[.]1|host[.]docker[.]internal)(:[0-9]{1,5})?/?$' THEN
      RAISE WARNING
        'Klaviyo catalogue sync was skipped because its Vault functions URL is invalid.';
      RETURN coalesce(new, old);
    END IF;

    v_functions_url := regexp_replace(v_functions_url, '/$', '');

    SELECT btrim(decrypted_secret)
    INTO v_internal_token
    FROM vault.decrypted_secrets
    WHERE name = 'taa_klaviyo_catalog_sync_secret';

    IF nullif(v_internal_token, '') IS NULL THEN
      RAISE WARNING
        'Klaviyo catalogue sync was skipped because its Vault token is unavailable.';
      RETURN coalesce(new, old);
    END IF;

    PERFORM net.http_post(
      url := v_functions_url || '/functions/v1/sync-klaviyo-catalog',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-taa-internal-token', v_internal_token
      ),
      body := jsonb_build_object(
        'source_table', tg_table_name,
        'operation', tg_op,
        'record_id', coalesce(new.id, old.id)
      )
    );
  EXCEPTION
    WHEN OTHERS THEN
      RAISE WARNING 'Klaviyo catalogue sync could not be queued.';
  END;

  RETURN coalesce(new, old);
END;
$function$;

REVOKE ALL ON FUNCTION public.trigger_klaviyo_catalog_sync()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trigger_klaviyo_catalog_sync() TO service_role;
