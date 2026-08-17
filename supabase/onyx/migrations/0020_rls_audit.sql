-- Lets a test read the RLS posture of every table, from the client.
--
-- The write surface of this database is closed by construction rather than by
-- policy: RLS is enabled and FORCEd on all 148 public tables, and not one of them
-- defines an INSERT/UPDATE/DELETE policy, which for a non-BYPASSRLS role is
-- deny-all. That is a strong position and a fragile one -- it holds only as long as
-- nobody adds a write policy without meaning to, or creates a table and forgets to
-- enable RLS on it.
--
-- `tools/onyx/apply.mjs` already counts RLS and FORCE after every migration, so a
-- new table without RLS is caught at apply time. What it cannot see is a *write
-- policy* appearing, and it only runs when a migration runs. This function makes
-- the same posture assertable from the test suite, which runs far more often.
--
-- Reads only from pg_catalog and returns no row data, so exposing it to the
-- service role gives away nothing that role could not already read.
CREATE OR REPLACE FUNCTION public.onyx_rls_audit()
RETURNS TABLE (
  "table_name" text,
  "rls" boolean,
  "forced" boolean,
  "select_policies" integer,
  "write_policies" integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT c.relname::text,
         c.relrowsecurity,
         c.relforcerowsecurity,
         (SELECT count(*)::int FROM pg_policies p
           WHERE p.schemaname = 'public' AND p.tablename = c.relname
             AND p.cmd = 'SELECT'),
         -- ALL counts as a write policy: it covers INSERT/UPDATE/DELETE too, so
         -- treating it as read-only would be the exact mistake worth catching.
         (SELECT count(*)::int FROM pg_policies p
           WHERE p.schemaname = 'public' AND p.tablename = c.relname
             AND p.cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL'))
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relkind = 'r'
   ORDER BY c.relname;
$$;

-- The suite authenticates as the service role. `anon` has no business enumerating
-- the schema's security posture.
REVOKE ALL ON FUNCTION public.onyx_rls_audit() FROM PUBLIC;
DO $$
BEGIN
  EXECUTE 'REVOKE ALL ON FUNCTION public.onyx_rls_audit() FROM anon, authenticated';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.onyx_rls_audit() TO service_role';
EXCEPTION WHEN undefined_object THEN
  NULL; -- a local database without Supabase's roles
END $$;

NOTIFY pgrst, 'reload schema';
