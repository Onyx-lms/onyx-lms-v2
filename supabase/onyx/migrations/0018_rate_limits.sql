-- A rate-limit bucket that survives more than one instance.
--
-- The limiter mirrors Laravel's `throttle:6,1` on sign-in, password reset and the
-- verification resend. Its store was in-process, which was correct for a single
-- always-on API and silently wrong the moment the API became serverless: every
-- Vercel instance keeps its own Map, so six attempts per minute becomes six per
-- minute *per instance*, and instances are created in response to load -- which is
-- to say, in response to someone attempting a lot of logins.
--
-- Nothing fails when that happens. No error, no log, no failing test. The only
-- symptom is that a control which appears to exist does not. That is why this is a
-- migration and not a backlog item.
--
-- WHY `public.onyx_*` AND NOT THE `onyx` SCHEMA.
--
-- The API calls the counter through PostgREST (`.rpc()`), and PostgREST serves
-- only the schemas a project exposes -- `onyx` is not one of them, which is the
-- same constraint ADR-006 records for why every Onyx table lives in `public`
-- behind an `onyx_` prefix rather than in a schema of its own. A function in
-- `onyx` would be unreachable over REST and would fail at the first call, not at
-- migration time. `onyx.job_runner` (0017) is in the `onyx` schema precisely
-- because the opposite is true of it: only pg_cron touches it, and being
-- unreachable over REST is a feature there.
--
-- ONE STATEMENT, BECAUSE TWO WOULD RACE.
--
-- Read-then-write would let two concurrent attempts both observe count = 1 and
-- both be allowed, which is exactly the case a limiter exists for. The upsert
-- below is a single statement, so Postgres serialises conflicting writers on the
-- primary key and no increment is lost.

CREATE TABLE IF NOT EXISTS public."onyx_rate_limits" (
  -- Composed by the caller, e.g. `login:<ip>:<email>`. Opaque here.
  "key" text PRIMARY KEY,
  "count" integer NOT NULL,
  "reset_at" timestamptz NOT NULL
);

-- Never read by a browser: the keys embed IP and email addresses, and the counts
-- describe who is having trouble signing in. No policies, which is deny-all for
-- anything that is not BYPASSRLS.
ALTER TABLE public."onyx_rate_limits" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."onyx_rate_limits" FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public."onyx_rate_limits" FROM PUBLIC;
DO $$
BEGIN
  EXECUTE 'REVOKE ALL ON public."onyx_rate_limits" FROM anon, authenticated';
EXCEPTION WHEN undefined_object THEN
  NULL; -- a local database without Supabase's roles
END $$;

-- A row exists per (ip, email) ever tried, so the sweep below needs this.
CREATE INDEX IF NOT EXISTS onyx_rate_limits_reset_idx
  ON public."onyx_rate_limits" ("reset_at");

/**
 * Records an attempt and returns the bucket as it now stands.
 *
 * A window that has already closed is restarted rather than continued -- a fixed
 * window, matching what the in-memory store did, so behaviour does not change
 * when the backend does.
 */
CREATE OR REPLACE FUNCTION public.onyx_rate_limit_hit(
  p_key text, p_window_seconds integer
) RETURNS TABLE ("count" integer, "reset_at" timestamptz)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public."onyx_rate_limits" AS r ("key", "count", "reset_at")
  VALUES (p_key, 1, now() + make_interval(secs => p_window_seconds))
  ON CONFLICT ("key") DO UPDATE
    SET "count" = CASE WHEN r."reset_at" <= now() THEN 1 ELSE r."count" + 1 END,
        "reset_at" = CASE WHEN r."reset_at" <= now()
                          THEN now() + make_interval(secs => p_window_seconds)
                          ELSE r."reset_at" END
  RETURNING r."count", r."reset_at";
$$;

-- The API's service role only. `anon` being able to call this would let a browser
-- burn another address's budget by guessing the key format.
REVOKE ALL ON FUNCTION public.onyx_rate_limit_hit(text, integer) FROM PUBLIC;
DO $$
BEGIN
  EXECUTE 'REVOKE ALL ON FUNCTION public.onyx_rate_limit_hit(text, integer) FROM anon, authenticated';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.onyx_rate_limit_hit(text, integer) TO service_role';
EXCEPTION WHEN undefined_object THEN
  NULL;
END $$;

/**
 * Drops buckets whose window has closed.
 *
 * Pure SQL, so pg_cron calls it directly -- no pg_net, no endpoint, no shared
 * secret. Unlike the grading drain and the expiry sweep there is no business logic
 * to keep in TypeScript here, so the HTTP hop those two need would be cost without
 * purpose. Scheduled daily by tools/onyx/schedule-jobs.mjs.
 */
CREATE OR REPLACE FUNCTION public.onyx_rate_limit_sweep()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  removed integer;
BEGIN
  DELETE FROM public."onyx_rate_limits" WHERE "reset_at" <= now();
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END $$;

REVOKE ALL ON FUNCTION public.onyx_rate_limit_sweep() FROM PUBLIC;
DO $$
BEGIN
  EXECUTE 'REVOKE ALL ON FUNCTION public.onyx_rate_limit_sweep() FROM anon, authenticated';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.onyx_rate_limit_sweep() TO service_role';
EXCEPTION WHEN undefined_object THEN
  NULL;
END $$;

-- ---------------------------------------------------------------------------
-- Exempt this table from the tenant-scoping rule
-- ---------------------------------------------------------------------------
-- `onyx.assert_tenant_scoped()` is the invariant every Onyx table obeys, checked
-- by tools/onyx/apply.mjs on every run rather than remembered. This table cannot
-- obey it, and not for want of trying: the limiter's key is
-- `login:<ip>:<email>`, evaluated *before* the credentials are checked, so there
-- is no tenant to scope to yet -- and sign-in is cross-tenant by design, since one
-- account may belong to several institutions.
--
-- So it joins the short list of genuinely global tables, alongside `onyx_users`
-- (people exist across institutions) and `onyx_platform_admins` (operators belong
-- to none). Adding it to the list is the honest move; adding a nullable
-- `tenant_id` nobody could populate would satisfy the checker and mean nothing.
CREATE OR REPLACE FUNCTION onyx.assert_tenant_scoped()
RETURNS TABLE(missing text)
LANGUAGE sql
STABLE
AS $$
  SELECT c.relname::text
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind = 'r'
    AND c.relname LIKE 'onyx\_%'
    AND c.relname NOT IN (
      'onyx_tenants', 'onyx_users', 'onyx_schema_migrations',
      'onyx_platform_admins', 'onyx_platform_audit_logs',
      -- Global because it is consulted before we know who is calling.
      'onyx_rate_limits'
    )
    AND NOT EXISTS (
      SELECT 1 FROM pg_attribute a
      WHERE a.attrelid = c.oid AND a.attname = 'tenant_id' AND a.attnum > 0
        AND NOT a.attisdropped
    )
$$;

NOTIFY pgrst, 'reload schema';
