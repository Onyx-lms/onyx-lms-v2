-- Onyx 0015_auth_claims_hook.sql
--
-- Supabase Auth migration, step 3/3. See docs/ADR-011-supabase-auth-migration.md.
--
-- GoTrue has no native idea of Onyx's tenancy -- a signed-in auth.users row
-- doesn't know which institution it's acting in, or what it is there. This
-- is the "Custom Access Token" Auth Hook: a function GoTrue calls on every
-- token it mints (sign-in AND refresh), given the chance to add claims. It
-- fills in exactly what packages/core/src/onyx/auth.ts used to put in the
-- token itself: `platform`, `tenant_id`, `tenant_role`.
--
-- Registering this with the project (Authentication -> Hooks in the
-- dashboard, or the Management API) is a hosted-project setting outside
-- what a migration file can express -- see docs/runbooks/supabase-auth-setup.md.
--
-- SECURITY DEFINER: onyx_memberships/onyx_platform_admins are FORCE RLS,
-- deny-all to `authenticated` (see 0001_tenancy.sql, 0009_platform.sql).
-- supabase_auth_admin -- the role GoTrue calls this as -- has no policy
-- granting it anything, so without SECURITY DEFINER the hook would read
-- zero rows and every token would come back with no tenant scope at all.
-- Running as the function's owner (the migration role) is what lets it see
-- the membership it needs to read; search_path is pinned so a
-- search-path-injection can't retarget what "onyx_memberships" resolves to.
CREATE OR REPLACE FUNCTION onyx.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, onyx, pg_temp
AS $$
DECLARE
  claims jsonb := COALESCE(event->'claims', '{}'::jsonb);
  uid uuid := (event->>'user_id')::uuid;
  is_platform boolean;
  active_tenant bigint;
  membership record;
BEGIN
  -- GoTrue's own claims carry `sub`, never `user_id` -- every call site in
  -- this codebase (250+ of them, predating this migration) reads
  -- `claims.user_id`, so the hook stamps it explicitly rather than every
  -- one of those being rewritten to read `sub` instead. Set unconditionally,
  -- before the platform/tenant branch, so it lands on every token either
  -- path returns.
  claims := jsonb_set(claims, '{user_id}', to_jsonb(uid::text));

  -- A platform admin's token is a different shape, not a wider one -- no
  -- tenant_id at all, same guarantee packages/core/src/onyx/auth.ts's own
  -- comments described for the pre-migration token. Checked first so a
  -- platform admin who also happens to hold a tenant membership still gets
  -- the platform shape, matching the old requirePlatformAdmin()/requireOnyx()
  -- split (the two were never meant to overlap).
  SELECT EXISTS(SELECT 1 FROM public."onyx_platform_admins" WHERE "user_id" = uid) INTO is_platform;
  IF is_platform THEN
    claims := jsonb_set(claims, '{platform}', 'true');
    RETURN jsonb_build_object('claims', claims);
  END IF;

  -- Which tenant this session acts in. Set only by the service-role login/
  -- switch routes (packages/core/src/onyx/tenancy.service.ts), never by the
  -- client directly -- raw_app_meta_data is not client-writable via the
  -- normal Supabase Auth API.
  active_tenant := NULLIF(
    (SELECT raw_app_meta_data->>'active_tenant_id' FROM auth.users WHERE id = uid),
    ''
  )::bigint;

  IF active_tenant IS NOT NULL THEN
    -- Resolved fresh at every mint, not cached from a prior token, so a role
    -- change or a removed membership takes effect on next refresh rather
    -- than surviving until the token's original expiry.
    SELECT "tenant_id", "role" INTO membership
      FROM public."onyx_memberships"
      WHERE "user_id" = uid AND "tenant_id" = active_tenant AND "status" = 1;

    IF membership IS NOT NULL THEN
      claims := jsonb_set(claims, '{tenant_id}', to_jsonb(membership.tenant_id));
      claims := jsonb_set(claims, '{tenant_role}', to_jsonb(membership.role));
    END IF;
  END IF;

  -- No resolvable membership: claims carry no tenant_id, exactly like a
  -- token requireOnyx() used to refuse outright for the same reason -- a
  -- token that cannot be scoped reads nothing, rather than reading the
  -- wrong institution.
  RETURN jsonb_build_object('claims', claims);
END;
$$;

GRANT USAGE ON SCHEMA onyx TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION onyx.custom_access_token_hook TO supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION onyx.custom_access_token_hook FROM authenticated, anon, public;

NOTIFY pgrst, 'reload schema';
