-- Scheduling for the two background jobs, from inside Postgres.
--
-- WHY THE DATABASE SCHEDULES THE WEB APP'S WORK.
--
-- v1 ran both jobs on `setInterval` inside an always-on Fastify process: the
-- Code Lab grading drain every 2 seconds, and the assessment expiry sweep every
-- 60. v2 has no always-on process (docs/ADR-012), and the obvious replacement --
-- Vercel Cron -- cannot do it on the Hobby plan: schedules more frequent than
-- daily are rejected at deploy time, so the fastest either job could run is once
-- every 24 hours.
--
-- pg_cron is not Vercel's scheduler and is not subject to Vercel's plan. It runs
-- in the database, supports per-minute schedules on Supabase's free tier, and
-- reaches the app over HTTP through pg_net. That is what buys back per-minute
-- scheduling without a paid plan and without a second deployable.
--
-- Both jobs stay in TypeScript rather than becoming plpgsql, deliberately. The
-- expiry sweep auto-marks each attempt it closes, which means walking the paper
-- and scoring objective questions against their answer keys -- rules that live in
-- packages/core and are covered by the core suite. A SQL copy of them would be a
-- second implementation of marking, and the one that drifts is the one that runs
-- unattended. See the note in app/api/cron/expire-attempts/route.ts.
--
-- WHAT THIS FILE DOES NOT DO: schedule anything.
--
-- A schedule needs the deployment's URL and a shared secret. Neither belongs in a
-- committed migration -- the URL differs per environment and the secret is a
-- secret. So this file creates the mechanism and `tools/onyx/schedule-jobs.mjs`
-- supplies the values. Applying this migration is therefore safe and inert; the
-- jobs begin running when that tool is run against an environment.

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
-- Both live in `extensions`, which is where Supabase puts them and where its
-- search_path already looks. Wrapped so a database whose role cannot create
-- extensions fails with a sentence rather than a permission error mid-migration.
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE EXCEPTION 'pg_cron could not be created: this role lacks the privilege. '
    'Enable it once from the Supabase dashboard (Database -> Extensions), then re-run.';
END $$;

DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE EXCEPTION 'pg_net could not be created: this role lacks the privilege. '
    'Enable it once from the Supabase dashboard (Database -> Extensions), then re-run.';
END $$;

-- ---------------------------------------------------------------------------
-- Where the scheduler is told how to reach the app
-- ---------------------------------------------------------------------------
-- One row. The secret is stored here rather than inlined into each cron command
-- because `cron.job.command` is plainly readable too -- there is no version of
-- this that hides it from a superuser, so it is kept in one place that can be
-- locked down and rotated instead of copied into two command strings.
--
-- Exposure is deliberately no worse than the service-role key already is:
-- deny-all RLS, and EXECUTE/SELECT revoked from every client-reachable role. A
-- browser holding the anon key cannot read it.
CREATE TABLE IF NOT EXISTS onyx."job_runner" (
  "id" boolean PRIMARY KEY DEFAULT true CONSTRAINT "onyx_job_runner_single" CHECK ("id"),
  "base_url" text NOT NULL,
  "secret" text NOT NULL,
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE onyx."job_runner" ENABLE ROW LEVEL SECURITY;
ALTER TABLE onyx."job_runner" FORCE ROW LEVEL SECURITY;
-- No policies at all, which is deny-all for every role that is not BYPASSRLS.
REVOKE ALL ON onyx."job_runner" FROM PUBLIC;
DO $$
BEGIN
  EXECUTE 'REVOKE ALL ON onyx."job_runner" FROM anon, authenticated';
EXCEPTION WHEN undefined_object THEN
  NULL; -- a local database without Supabase's roles
END $$;

-- ---------------------------------------------------------------------------
-- The call itself
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION onyx.trigger_job(p_path text)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = onyx, net, extensions, public
AS $$
DECLARE
  cfg onyx."job_runner";
  request_id bigint;
BEGIN
  SELECT * INTO cfg FROM onyx."job_runner" WHERE "id" LIMIT 1;
  IF cfg IS NULL THEN
    -- Not an error: an environment where the runner was never configured should
    -- simply not fire, and say so once per attempt rather than failing a job.
    RAISE NOTICE 'onyx.trigger_job: no job_runner row; run tools/onyx/schedule-jobs.mjs';
    RETURN NULL;
  END IF;

  -- Fire-and-forget by design. pg_net queues the request and returns an id
  -- immediately, so a slow grading pass never holds a cron slot open, and an app
  -- that is down cannot back the scheduler up. The response is not read here --
  -- the endpoints log their own outcome, and net._http_response holds the status
  -- for anyone diagnosing a silent job.
  -- `net.http_post`, fully qualified. pg_net is created WITH SCHEMA extensions,
  -- but it puts its own functions in a schema it creates called `net` -- so
  -- `extensions.net.http_post` does not exist and would fail only at run time,
  -- inside a cron job nobody is watching. Qualifying it beats trusting
  -- search_path.
  SELECT net.http_post(
    url     := cfg."base_url" || p_path,
    body    := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      -- Both accepted by denyCron(); the bearer form is also what Vercel Cron
      -- sends, so the endpoint needs only one check for both triggers.
      'Authorization', 'Bearer ' || cfg."secret",
      'x-cron-secret', cfg."secret"
    ),
    timeout_milliseconds := 5000
  ) INTO request_id;

  RETURN request_id;
END $$;

-- SECURITY DEFINER means this reads job_runner regardless of the caller, so the
-- caller list has to be short. Only the scheduler and the service role.
REVOKE ALL ON FUNCTION onyx.trigger_job(text) FROM PUBLIC;
DO $$
BEGIN
  EXECUTE 'REVOKE ALL ON FUNCTION onyx.trigger_job(text) FROM anon, authenticated';
  EXECUTE 'GRANT EXECUTE ON FUNCTION onyx.trigger_job(text) TO service_role';
EXCEPTION WHEN undefined_object THEN
  NULL;
END $$;

NOTIFY pgrst, 'reload schema';
