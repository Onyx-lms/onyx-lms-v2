-- ---------------------------------------------------------------------------
-- 0045 -- the rest of the drift, and two deliberate refusals.
--
-- 0044 restored the nineteen unique constraints, because one of them was
-- actively corrupting data. This finishes the job: the plain secondary indexes
-- that the migrations have always declared and the database has never had,
-- lost the same way -- written inside `CREATE TABLE ... IF NOT EXISTS` blocks
-- that Postgres skipped whole, constraints and indexes together, wherever the
-- table already existed.
--
-- NONE OF THESE IS URGENT, and that is worth saying plainly rather than
-- dressing them up. Every table below holds between zero and a hundred and
-- eighty rows today, and on a table that size Postgres is right to scan and an
-- index would sit unused, costing every write and earning nothing. They are
-- restored for two reasons that are about tomorrow rather than today:
--
--   * every one of them is on a table that grows per learner -- progress per
--     lesson, submissions per problem, marks per exam, mentions per thread.
--     The demonstration institution is small; the ones this is being sold to
--     are not, and an index added before the table is large is free, while one
--     added after is a lock on a table somebody is using.
--
--   * the schema should describe the database. As long as sixteen declared
--     indexes are missing, "declared" means nothing and the next real drift --
--     which is what a missing UNIQUE turned out to be -- hides among them.
--     `npm run db:index-drift` now fails the build on any difference, and that
--     check is only worth having if the baseline is genuinely zero.
--
-- TWO ARE DELIBERATELY NOT RESTORED, and are recorded in the drift tool with
-- these reasons so it stays quiet about them:
--
--   onyx_notifications_user_idx  -- superseded. 0044 replaced it with two
--     narrower indexes, one for the listing and a partial one for the unread
--     count, after measuring both reads. Adding the declared one back would
--     put a third overlapping index on a table of ninety-five thousand rows,
--     paid for on every insert, to serve queries the other two already serve.
--
--   onyx_transcripts_person_idx  -- the feature is gone. Transcripts were
--     removed from the product; the table survives with one row so that no
--     record is destroyed, and nothing reads it. An index on a table nothing
--     queries is pure cost.
--
-- A THIRD WAS ON THIS LIST AND SHOULD NOT HAVE BEEN. `onyx_memberships_pending`
-- looked missing, and it is -- because 0032 DROPPED it on purpose. Open signup
-- admits a person the moment they register, so nothing is ever pending and the
-- partial index matched nothing. Restoring it would have quietly undone a
-- decision somebody made and wrote down. The drift checker follows DROP for
-- exactly this reason, and caught it before this migration was applied.
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS "onyx_lesson_progress_user_idx"
  ON public."onyx_lesson_progress" ("user_id", "course_id");

CREATE INDEX IF NOT EXISTS "onyx_code_submissions_user_idx"
  ON public."onyx_code_submissions" ("user_id", "problem_id", "id" DESC);

CREATE INDEX IF NOT EXISTS "onyx_certificates_user_idx"
  ON public."onyx_certificates" ("tenant_id", "user_id");

CREATE INDEX IF NOT EXISTS "onyx_learner_skills_user_idx"
  ON public."onyx_learner_skills" ("tenant_id", "user_id");

CREATE INDEX IF NOT EXISTS "onyx_job_applications_user_idx"
  ON public."onyx_job_applications" ("tenant_id", "user_id");

CREATE INDEX IF NOT EXISTS "onyx_mock_interviews_user_idx"
  ON public."onyx_mock_interviews" ("tenant_id", "user_id");

CREATE INDEX IF NOT EXISTS "onyx_discussion_mentions_user_idx"
  ON public."onyx_discussion_mentions" ("tenant_id", "user_id", "read_at");

CREATE INDEX IF NOT EXISTS "onyx_tickets_owner_idx"
  ON public."onyx_tickets" ("tenant_id", "owner_id", "status");

CREATE INDEX IF NOT EXISTS "onyx_faculty_allocations_person_idx"
  ON public."onyx_faculty_allocations" ("tenant_id", "user_id", "semester_id");

CREATE INDEX IF NOT EXISTS "onyx_timetable_slots_faculty_idx"
  ON public."onyx_timetable_slots" ("tenant_id", "semester_id", "faculty_id", "day_of_week");

CREATE INDEX IF NOT EXISTS "onyx_exam_marks_person_idx"
  ON public."onyx_exam_marks" ("tenant_id", "user_id", "status");

CREATE INDEX IF NOT EXISTS "onyx_invoices_person_idx"
  ON public."onyx_invoices" ("tenant_id", "user_id", "status");

CREATE INDEX IF NOT EXISTS "onyx_guardians_student_idx"
  ON public."onyx_guardians" ("tenant_id", "student_user_id");
