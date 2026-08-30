-- ---------------------------------------------------------------------------
-- 0044 -- the constraints the schema always declared, and the database never had.
--
-- Found while looking for missing indexes. Comparing what the migrations
-- declare against what `pg_indexes` actually holds turned up thirty-five
-- declared indexes and constraints that do not exist in the database. They
-- were written inside `CREATE TABLE ... IF NOT EXISTS` blocks: when the table
-- already existed, Postgres skipped the whole statement, constraints included,
-- and said nothing. The schema files have been describing a database that was
-- never built.
--
-- ONE OF THEM WAS ALREADY DOING DAMAGE. `onyx_readiness_scores` is written by
-- read-then-insert-or-update: `readiness()` reads the row with `.maybeSingle()`
-- and `computeReadiness()` updates it if it is there, inserts if it is not.
-- With no unique constraint a second row could be written, and once there were
-- two `.maybeSingle()` stopped returning either of them -- PostgREST answers
-- more-than-one-row with an error, so the read came back null, so the code took
-- the insert branch, so there were three. Every view of that learner's profile
-- added another row. One learner on the demonstration institution had reached
-- 258 copies, and it went up by one while this was being written.
--
-- The score on screen stayed right, because it is computed fresh each time.
-- What was wrong was everything that reads the STORED row: the snapshot taken
-- when somebody applies for a job, and the table itself, growing without bound.
--
-- WHAT THIS DOES. Deduplicates that one table, keeping the newest row per
-- learner, then creates the nineteen unique constraints as unique INDEXES.
-- An index rather than a table constraint on purpose: `CREATE UNIQUE INDEX IF
-- NOT EXISTS` is re-runnable and `ADD CONSTRAINT` is not, and this file has to
-- be safe to run against databases in either state.
--
-- Every one of the eighteen others was checked for duplicates before being
-- written here and every one was clean, so this adds protection without
-- changing a single row outside `onyx_readiness_scores`.
--
-- Two indexes here are for speed rather than correctness, and both were
-- measured. See the notes on them below.
-- ---------------------------------------------------------------------------

-- --------------------------------------------------------------- the damage
--
-- Newest wins: `computed_at` is when the score was worked out, and an older
-- copy is a strictly worse answer to the same question. `id` breaks a tie,
-- because two rows written in the same millisecond are the same score twice.
DELETE FROM public."onyx_readiness_scores" a
  USING public."onyx_readiness_scores" b
 WHERE a."tenant_id" = b."tenant_id"
   AND a."user_id"   = b."user_id"
   AND (a."computed_at", a."id") < (b."computed_at", b."id");

-- ------------------------------------------------- one row per person, per thing
CREATE UNIQUE INDEX IF NOT EXISTS "onyx_readiness_scores_unique"
  ON public."onyx_readiness_scores" ("tenant_id", "user_id");
CREATE UNIQUE INDEX IF NOT EXISTS "onyx_memberships_unique"
  ON public."onyx_memberships" ("tenant_id", "user_id");
CREATE UNIQUE INDEX IF NOT EXISTS "onyx_enrollments_unique"
  ON public."onyx_enrollments" ("course_id", "user_id");
CREATE UNIQUE INDEX IF NOT EXISTS "onyx_course_faculty_unique"
  ON public."onyx_course_faculty" ("course_id", "user_id");
CREATE UNIQUE INDEX IF NOT EXISTS "onyx_lesson_progress_unique"
  ON public."onyx_lesson_progress" ("lesson_id", "user_id");
CREATE UNIQUE INDEX IF NOT EXISTS "onyx_attendance_records_unique"
  ON public."onyx_attendance_records" ("session_id", "user_id");
CREATE UNIQUE INDEX IF NOT EXISTS "onyx_assignment_submissions_unique"
  ON public."onyx_assignment_submissions" ("assignment_id", "user_id");
CREATE UNIQUE INDEX IF NOT EXISTS "onyx_batch_members_unique"
  ON public."onyx_batch_members" ("batch_id", "user_id");
CREATE UNIQUE INDEX IF NOT EXISTS "onyx_hint_reveals_unique"
  ON public."onyx_hint_reveals" ("hint_id", "user_id");
CREATE UNIQUE INDEX IF NOT EXISTS "onyx_assessment_attempts_unique"
  ON public."onyx_assessment_attempts" ("assessment_id", "user_id", "attempt");
CREATE UNIQUE INDEX IF NOT EXISTS "onyx_learner_skills_unique"
  ON public."onyx_learner_skills" ("user_id", "skill_id", "source_type", "source_id");
CREATE UNIQUE INDEX IF NOT EXISTS "onyx_job_applications_unique"
  ON public."onyx_job_applications" ("job_id", "user_id");
CREATE UNIQUE INDEX IF NOT EXISTS "onyx_drive_results_unique"
  ON public."onyx_drive_results" ("round_id", "user_id");
CREATE UNIQUE INDEX IF NOT EXISTS "onyx_contest_members_unique"
  ON public."onyx_contest_members" ("contest_id", "user_id");
CREATE UNIQUE INDEX IF NOT EXISTS "onyx_faculty_allocations_unique"
  ON public."onyx_faculty_allocations" ("tenant_id", "course_id", "user_id", "semester_id");
CREATE UNIQUE INDEX IF NOT EXISTS "onyx_exam_marks_unique"
  ON public."onyx_exam_marks" ("tenant_id", "exam_id", "user_id");
CREATE UNIQUE INDEX IF NOT EXISTS "onyx_guardians_unique"
  ON public."onyx_guardians" ("guardian_user_id", "student_user_id");
CREATE UNIQUE INDEX IF NOT EXISTS "onyx_platform_admins_user_unique"
  ON public."onyx_platform_admins" ("user_id");
CREATE UNIQUE INDEX IF NOT EXISTS "onyx_seat_allocations_one_seat_per_person"
  ON public."onyx_seat_allocations" ("tenant_id", "exam_id", "user_id");

-- ------------------------------------------------------------------- speed
--
-- THE INBOX. `onyx_notifications` had a primary key and nothing else: 91,221
-- rows, 19 MB, and in the whole life of the database not one index scan. Both
-- inbox reads -- the newest fifty, and the unread count -- were sequential
-- scans discarding 91,150 rows apiece at about 20 ms each, twice on every page
-- that shows the bell. Sorted descending because every caller wants the newest
-- first and a matching sort order is the difference between reading a few rows
-- and reading all of them to sort.
CREATE INDEX IF NOT EXISTS "onyx_notifications_person_idx"
  ON public."onyx_notifications" ("tenant_id", "user_id", "created_at" DESC);

-- Unread is the count on the bell, asked as often as the list is opened. A
-- partial index holds only the rows that have not been read, so it stays small
-- however long the archive grows -- which is the opposite of how the table
-- behaves.
CREATE INDEX IF NOT EXISTS "onyx_notifications_unread_idx"
  ON public."onyx_notifications" ("tenant_id", "user_id")
  WHERE "read_at" IS NULL;

-- THE REGISTER. `onyx_attendance_records` is one row per learner per session,
-- so it is the fastest-growing table any institution here will have -- a
-- thousand learners over a fifteen-week term is tens of thousands of rows. It
-- carried an index on `user_id` only, and the register reads by SESSION.
CREATE INDEX IF NOT EXISTS "onyx_attendance_records_session_idx"
  ON public."onyx_attendance_records" ("tenant_id", "session_id");
