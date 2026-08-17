-- The job queue's three statements that cannot be expressed through PostgREST.
--
-- WHY: TO GET `pg` OFF THE REQUEST PATH.
--
-- QueueService was the only consumer of a direct Postgres connection
-- (packages/core/src/onyx/pool.ts). That was free when the API was one long-lived
-- process holding one pool of five. Under Vercel it is not: every warm instance
-- opens its own pool, the platform creates instances in response to load, and
-- Supabase's pooler runs out of connections long before Vercel runs out of
-- appetite for instances. The symptom would arrive as intermittent, unattributable
-- failures under exactly the traffic you least want them under.
--
-- Everything else QueueService does is a plain insert or update and goes through
-- PostgREST like the rest of the codebase. These three cannot:
--
--   claim         needs FOR UPDATE SKIP LOCKED. This is the one statement the
--                 queue's correctness rests on -- without SKIP LOCKED two workers
--                 racing for a row queue behind each other and both grade it.
--   requeue_stale needs a per-row CASE to decide whether a job that died holding
--                 the lock has any attempts left.
--   stats         needs GROUP BY; fetching every row to count them in JavaScript
--                 would be the wrong shape at any real volume.
--
-- All three are SECURITY DEFINER and granted to service_role alone. A browser
-- holding the anon key must never be able to claim a job -- that would hand it
-- another tenant's submission payload.

/**
 * Takes up to `p_limit` jobs and marks them running, atomically.
 *
 * FOR UPDATE SKIP LOCKED is the whole point: concurrent workers step over rows
 * another worker already holds instead of blocking on them, so the same job is
 * never handed out twice. Removing it would not fail a test -- it would double-
 * grade under load, occasionally.
 */
CREATE OR REPLACE FUNCTION public.onyx_claim_jobs(
  p_limit integer,
  p_worker text,
  p_kinds text[] DEFAULT NULL
) RETURNS TABLE (
  "id" bigint,
  "tenant_id" bigint,
  "kind" varchar,
  "payload" jsonb,
  "attempts" smallint,
  "max_attempts" smallint
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public."onyx_jobs" AS t
     SET "status" = 'running',
         "attempts" = t."attempts" + 1,
         "locked_at" = now(),
         "locked_by" = p_worker,
         "updated_at" = now()
   WHERE t."id" IN (
     SELECT j."id" FROM public."onyx_jobs" j
      WHERE j."status" = 'queued'
        AND j."run_after" <= now()
        AND (p_kinds IS NULL OR j."kind" = ANY(p_kinds))
      ORDER BY j."id"
      FOR UPDATE SKIP LOCKED
      LIMIT p_limit
   )
  RETURNING t."id", t."tenant_id", t."kind", t."payload",
            t."attempts", t."max_attempts";
$$;

/**
 * Returns jobs whose worker died mid-run to the queue.
 *
 * A process killed between claim and complete leaves a row at `running` for ever.
 * Nothing else notices it, so it is swept -- and a job that has already used its
 * attempts becomes `failed` rather than looping.
 */
CREATE OR REPLACE FUNCTION public.onyx_requeue_stale_jobs(p_older_than_seconds integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  affected integer;
BEGIN
  UPDATE public."onyx_jobs"
     SET "status" = CASE WHEN "attempts" >= "max_attempts" THEN 'failed' ELSE 'queued' END,
         "locked_at" = NULL,
         "locked_by" = NULL,
         "last_error" = COALESCE("last_error", 'worker stopped without finishing'),
         "updated_at" = now()
   WHERE "status" = 'running'
     AND "locked_at" < now() - make_interval(secs => p_older_than_seconds);
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END $$;

/** Counts by status and kind, for the operator view. */
CREATE OR REPLACE FUNCTION public.onyx_job_stats(p_tenant_id bigint DEFAULT NULL)
RETURNS TABLE ("status" varchar, "kind" varchar, "count" bigint)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT j."status", j."kind", count(*)::bigint
    FROM public."onyx_jobs" j
   WHERE (p_tenant_id IS NULL OR j."tenant_id" = p_tenant_id)
   GROUP BY j."status", j."kind";
$$;

DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.onyx_claim_jobs(integer, text, text[])',
    'public.onyx_requeue_stale_jobs(integer)',
    'public.onyx_job_stats(bigint)'
  ] LOOP
    EXECUTE 'REVOKE ALL ON FUNCTION ' || fn || ' FROM PUBLIC';
    BEGIN
      EXECUTE 'REVOKE ALL ON FUNCTION ' || fn || ' FROM anon, authenticated';
      EXECUTE 'GRANT EXECUTE ON FUNCTION ' || fn || ' TO service_role';
    EXCEPTION WHEN undefined_object THEN
      NULL; -- a local database without Supabase's roles
    END;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
