-- ASS-01 -- a paper can ask somebody to write code.
--
-- Until now an assessment could ask five things: pick one, pick several, true
-- or false, a short answer, or an essay. For a computing institution that
-- leaves out the only question that actually demonstrates the skill being
-- taught -- and the product already has a graded sandbox running next door in
-- Code Lab, with test cases, hidden cases, weights and time limits.
--
-- So a code question does not reinvent any of it. It POINTS at a Code Lab
-- problem, and the answer key is that problem's test suite. One column.
--
-- Why a reference rather than copying the problem into the question:
--
--   * grading already exists and is already trusted -- reimplementing it
--     against a second copy of the tests is how two graders come to disagree
--     about the same submission;
--   * a problem carries hidden cases, and hidden cases are the whole reason
--     an auto-graded coding question is worth anything;
--   * the same problem can be practised and then examined, which is what
--     learners expect, and the submission history stays in one place.
--
-- ON DELETE SET NULL rather than CASCADE: deleting a problem must not delete
-- questions -- and, far more importantly, must not cascade into papers people
-- have already sat. A question whose problem has gone is caught at authoring
-- and at deal time, not by losing the row.

ALTER TABLE public."onyx_questions"
  ADD COLUMN IF NOT EXISTS "problem_id" bigint
    REFERENCES public."onyx_problems"("id") ON DELETE SET NULL;

COMMENT ON COLUMN public."onyx_questions"."problem_id" IS
  'For type = code: the Code Lab problem whose tests mark this question. Null for every other type.';

-- The immutable snapshot has to carry it too, or a sat paper could not be
-- re-marked against the problem it actually asked. Every other field the
-- grader reads is snapshotted here for exactly that reason.
ALTER TABLE public."onyx_question_versions"
  ADD COLUMN IF NOT EXISTS "problem_id" bigint;

CREATE INDEX IF NOT EXISTS onyx_questions_problem_idx
  ON public."onyx_questions" ("problem_id")
  WHERE "problem_id" IS NOT NULL;

-- An attempt's answer to a code question is a Code Lab submission, so the
-- attempt has to be able to point at one. Nullable and unconstrained by type:
-- every other question type leaves it null.
ALTER TABLE public."onyx_assessment_answers"
  ADD COLUMN IF NOT EXISTS "submission_id" bigint
    REFERENCES public."onyx_code_submissions"("id") ON DELETE SET NULL;

COMMENT ON COLUMN public."onyx_assessment_answers"."submission_id" IS
  'For a code question: the graded Code Lab submission this answer was scored from.';
