-- ---------------------------------------------------------------------------
-- 0042 -- who put this here.
--
-- A question bank, a paper and a sitting have each recorded their author since
-- the day they existed: `created_by` on onyx_question_banks (0004),
-- onyx_assessments (0004) and onyx_exams (0008). Nothing READ it, so the
-- information was there and invisible -- and the question it answers is asked
-- constantly. "Who set this paper" is the first thing anybody says when a
-- question is wrong, and "did the institution do this or did we" is the first
-- thing an operator says when an examination appears on a calendar they were
-- not expecting.
--
-- Course modules were the one gap: a module is authored exactly the way the
-- other three are -- by an administrator, by the course's own lecturer, or by
-- the platform operator acting for the institution -- and it was the only one
-- of the four that did not say which. This closes it.
--
-- Nullable on purpose, and not backfilled. Every module written before today
-- has no author on record, and inventing one would be worse than admitting it:
-- a screen can say "not recorded" honestly, but it cannot un-say a name that
-- was never true. The same reason 0026 gives for leaving a profile field
-- empty rather than guessing at it.
--
-- ON DELETE SET NULL, matching the other three exactly: a person who leaves
-- the institution has their account removed, and the module they wrote stays.
-- The work outlives the employment.
--
-- HOW A ROLE IS READ BACK, since the column stores only an id: the creator's
-- membership at THIS institution names them -- admin, faculty, exams. A
-- creator with no membership here is the platform operator, which is exactly
-- what the console writing on an institution's behalf looks like in the data,
-- and it needs no second column to say so.
-- ---------------------------------------------------------------------------

ALTER TABLE public."onyx_modules"
  ADD COLUMN IF NOT EXISTS "created_by" uuid
    REFERENCES public."onyx_users"("id") ON DELETE SET NULL;

-- The lookup every "who wrote this" read makes: given a course's modules, the
-- handful of distinct authors behind them.
CREATE INDEX IF NOT EXISTS "onyx_modules_created_by"
  ON public."onyx_modules" ("tenant_id", "created_by");
