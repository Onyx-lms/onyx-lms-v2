-- Onyx 0035_instant_results_default.sql -- results stop waiting for a button.
--
-- 0034 added `instant_results` off by default, on the reasoning that releasing
-- a mark the moment it is earned tells the first candidate to finish which
-- answers were right, and that this is the institution's call rather than
-- ours. The institution has now made that call: results come out when the
-- paper is handed in, on every paper, and the publication step stops being
-- something anybody waits for.
--
-- The cost is unchanged and is worth writing down where the decision lives. On
-- a paper with an open window, a candidate who sits it early learns the
-- answers and can tell somebody who has not sat it yet. Papers where that
-- matters can still hold their results back -- by requiring moderation, which
-- this never overrules -- but the default is no longer the cautious one.
--
-- Three changes, and the third is the one to read twice.
--
-- 1. The column default flips to true, so every paper made from now on hands
--    marks back at submit unless somebody deliberately turns it off.
--
-- 2. Every paper that already exists is switched on. "Existing papers will be
--    on instant results only" -- so a database full of papers set up under the
--    old behaviour is brought to the new one rather than left as a second,
--    invisible class of paper that behaves differently for no reason a learner
--    could discover.
--
-- 3. **Attempts that were already sat and never released are released now.**
--    This is a change to real marks, so it is deliberately narrow. It touches
--    only attempts that are FINISHED, that carry a score -- meaning every
--    question on them was machine-marked and nothing was ever waiting for a
--    person -- and that belong to a paper which does not require moderation.
--    An attempt with an essay on it has a null score and is not touched. A
--    moderated paper is not touched. Nothing that a human still has to look at
--    is released by this.
--
--    Without it, the marks people are complaining about stay invisible: a
--    quiz sat last week, auto-marked correctly at the time, still reading
--    "results will appear once they are published" for ever because the button
--    nobody presses has now been taken away.
--
--    It does not touch `results_published_at` on the assessment. That flag
--    also CLOSES a paper for marking, permanently, and closing papers is not
--    something a migration should do behind an examiner's back.

ALTER TABLE public."onyx_assessments"
  ALTER COLUMN "instant_results" SET DEFAULT true;

UPDATE public."onyx_assessments"
   SET "instant_results" = true
 WHERE "instant_results" = false;

UPDATE public."onyx_assessment_attempts" AS a
   SET "status" = 'published',
       "updated_at" = now()
  FROM public."onyx_assessments" AS s
 WHERE s."id" = a."assessment_id"
   AND s."tenant_id" = a."tenant_id"
   -- Finished, one way or the other. An expired paper was auto-marked by the
   -- same code path as a submitted one and its mark is just as final.
   AND a."status" IN ('submitted', 'expired')
   -- The whole of it was machine-marked. A null score means something on this
   -- attempt is still waiting for a marker.
   AND a."score" IS NOT NULL
   -- Moderation is a deliberate second pair of eyes between a mark and the
   -- candidate, and this does not reach past it.
   AND COALESCE(s."moderation_required", 0) = 0;

COMMENT ON COLUMN public."onyx_assessments"."instant_results" IS
  'Hand the candidate their mark at submit. On by default. Only ever applies '
  'to an attempt that needed no human marking, and never to a paper that '
  'requires moderation -- see AssessService#finalise.';
