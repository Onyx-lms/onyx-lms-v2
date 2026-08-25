-- ---------------------------------------------------------------------------
-- 0040 -- a tab-switch rule with teeth, and a way back from it.
--
-- Until now proctoring RECORDED and nothing more. That was a deliberate
-- position and the header of proctor.service.ts still argues for most of it:
-- a flag is evidence, not a verdict, and auto-voiding somebody's degree
-- because a laptop lid closed is how proctoring earns its reputation.
--
-- What the institution asked for is narrower than that, and defensible: a
-- candidate who leaves the paper is WARNED, twice, in words, on their own
-- screen -- and only on the third departure is the paper stopped. Two
-- warnings is not a trap; it is a rule stated plainly and then applied.
--
-- The other half is what makes it safe, and is the reason this is a schema
-- change rather than a status flip: stopping an attempt must be REVERSIBLE.
-- A dropped connection, a screen reader stealing focus, a fire alarm -- an
-- invigilator who looks and decides it was nothing has to be able to let the
-- candidate carry on FROM WHERE THEY WERE, with the answers they had written
-- and the minutes they had left. That means the remaining time has to be
-- written down at the moment the paper is stopped, because `expires_at` is an
-- absolute instant and an absolute instant keeps running while somebody
-- decides.
--
--   terminated_at      when the paper was stopped. Null on a normal attempt.
--   terminated_reason  why, in a word -- 'breach' today; the column exists so
--                      a future rule does not need another migration.
--   remaining_ms       what was left on the clock at that moment. THIS is the
--                      resumable part: reinstating sets expires_at to now plus
--                      this, so a candidate gets back exactly the time they
--                      had and not a minute more.
--   breach_count       departures so far, counted on the row rather than
--                      re-derived from the event log every keystroke.
--   reinstated_at      who let them carry on, and when -- an override of an
--   reinstated_by      automatic rule is exactly the kind of act that has to
--                      be accountable to somebody afterwards.
--
-- And on the paper itself:
--
--   breach_limit       how many departures end it. 3 by default, which is the
--                      rule as stated: warn, warn, stop. ZERO switches the
--                      whole thing off, which is what every paper written
--                      before this migration effectively had -- so the default
--                      is applied to NEW papers only, below, rather than
--                      changing the rules of anything already sat.
--
-- `status` is a plain varchar with no CHECK, so 'terminated' needs no
-- constraint change. It is deliberately NOT one of the finished statuses the
-- release rule accepts: a stopped paper is scored so staff can see where the
-- candidate had got to, and the candidate is shown nothing at all until it is
-- either reinstated or the window closes.
-- ---------------------------------------------------------------------------

ALTER TABLE public."onyx_assessment_attempts"
  ADD COLUMN IF NOT EXISTS "terminated_at"     timestamptz,
  ADD COLUMN IF NOT EXISTS "terminated_reason" varchar(60),
  ADD COLUMN IF NOT EXISTS "remaining_ms"      integer,
  ADD COLUMN IF NOT EXISTS "breach_count"      smallint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "reinstated_at"     timestamptz,
  ADD COLUMN IF NOT EXISTS "reinstated_by"     uuid;

ALTER TABLE public."onyx_assessment_attempts"
  DROP CONSTRAINT IF EXISTS onyx_attempts_remaining_check;
ALTER TABLE public."onyx_assessment_attempts"
  ADD CONSTRAINT onyx_attempts_remaining_check
  CHECK ("remaining_ms" IS NULL OR "remaining_ms" >= 0);

-- Existing papers keep the old behaviour -- record, do not stop -- because
-- changing the rules of a paper somebody is part way through sitting is not a
-- migration's business. New papers get the rule as asked for.
ALTER TABLE public."onyx_assessments"
  ADD COLUMN IF NOT EXISTS "breach_limit" smallint NOT NULL DEFAULT 3;

ALTER TABLE public."onyx_assessments"
  DROP CONSTRAINT IF EXISTS onyx_assessments_breach_limit_check;
ALTER TABLE public."onyx_assessments"
  ADD CONSTRAINT onyx_assessments_breach_limit_check
  CHECK ("breach_limit" >= 0 AND "breach_limit" <= 20);

UPDATE public."onyx_assessments"
   SET "breach_limit" = 0
 WHERE "created_at" < now();

-- The invigilation console's first question is "what has been stopped", so
-- that is the index.
CREATE INDEX IF NOT EXISTS onyx_attempts_terminated_idx
  ON public."onyx_assessment_attempts" ("tenant_id", "terminated_at")
  WHERE "terminated_at" IS NOT NULL;
