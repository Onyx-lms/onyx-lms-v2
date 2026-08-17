-- Onyx 0016_auth_claims_hook_user_id.sql
--
-- Fixes a real bug in 0015's Custom Access Token Hook, found via live
-- verification: GoTrue's own claims carry `sub`, never a separate `user_id`
-- field. 0015 only stamped `platform`/`tenant_id`/`tenant_role`, so a real
-- minted token had `claims.user_id === undefined` -- every one of the
-- 250+ call sites in this codebase that read `claims.user_id` (predating
-- this migration) broke silently, even though `sub` was right there and
-- correct. `0015_auth_claims_hook.sql`'s source file has been corrected in
-- place so a fresh environment gets this right the first time; this
-- migration applies the identical fix to a database where 0015 already ran
-- (CREATE OR REPLACE FUNCTION, same signature, so no policy-dependency
-- concern like 0014's column-type change had).
--
-- See docs/ADR-011-supabase-auth-migration.md.
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
  claims := jsonb_set(claims, '{user_id}', to_jsonb(uid::text));

  SELECT EXISTS(SELECT 1 FROM public."onyx_platform_admins" WHERE "user_id" = uid) INTO is_platform;
  IF is_platform THEN
    claims := jsonb_set(claims, '{platform}', 'true');
    RETURN jsonb_build_object('claims', claims);
  END IF;

  active_tenant := NULLIF(
    (SELECT raw_app_meta_data->>'active_tenant_id' FROM auth.users WHERE id = uid),
    ''
  )::bigint;

  IF active_tenant IS NOT NULL THEN
    SELECT "tenant_id", "role" INTO membership
      FROM public."onyx_memberships"
      WHERE "user_id" = uid AND "tenant_id" = active_tenant AND "status" = 1;

    IF membership IS NOT NULL THEN
      claims := jsonb_set(claims, '{tenant_id}', to_jsonb(membership.tenant_id));
      claims := jsonb_set(claims, '{tenant_role}', to_jsonb(membership.role));
    END IF;
  END IF;

  RETURN jsonb_build_object('claims', claims);
END;
$$;

NOTIFY pgrst, 'reload schema';
