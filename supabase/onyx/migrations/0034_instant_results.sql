-- Onyx 0034_instant_results.sql -- a score the candidate sees when they hand in.
--
-- Today every result is release-gated: `myAttempts` shows a score only when the
-- ATTEMPT is at status 'published' AND the ASSESSMENT carries a
-- `results_published_at`, and both of those are set by a member of staff
-- pressing Publish. That is correct for a paper somebody has to mark. It is
-- pure friction for a paper that is already marked.
--
-- Because the marking has in fact already happened. `#finalise` auto-marks
-- every objective question the moment a paper is handed in and writes the
-- total to `score`; for a paper made only of single-answer, multiple-answer and
-- true/false questions, that number is final and correct at the instant of
-- submission. Withholding it until somebody remembers to press a button does
-- not protect anything -- it just means a learner who has finished a quiz is
-- told "results will appear once they are published" about a result that
-- already exists.
--
-- **Why this is a switch and not simply the new behaviour.**
--
-- Releasing a mark the moment it is earned tells the first candidate to finish
-- exactly which answers were right, and a paper with an open window is a paper
-- other people have not sat yet. That is a real cost and it falls on the
-- institution, not on us, so the institution decides. It is off by default for
-- the same reason `watch_camera` is: every paper that exists right now was set
-- up under the old behaviour, and a column that defaulted to true would start
-- handing out answers mid-window on somebody else's exam.
--
-- **What the switch does NOT do.** It cannot release a paper that still needs a
-- human. `#finalise` leaves `score` null whenever any answer awaits marking --
-- an essay, a short answer with no key, a code question the sandbox could not
-- judge -- and an attempt with no score has nothing to show. Nor does it
-- override `moderation_required`: a paper whose marks must be moderated before
-- release is a paper whose marks are not final at submission, which is the
-- whole point of moderation. Both conditions are enforced in the service
-- (`AssessService#finalise`) rather than here, because both are properties of
-- the attempt rather than of the column.

ALTER TABLE public."onyx_assessments"
  ADD COLUMN IF NOT EXISTS "instant_results" boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public."onyx_assessments"."instant_results" IS
  'Show the candidate their score the moment they hand in. Only ever applies '
  'to an attempt that needed no human marking and to a paper that does not '
  'require moderation -- see AssessService#finalise. Off by default: a mark '
  'released mid-window tells the people who have not sat it yet what the '
  'answers are.';
