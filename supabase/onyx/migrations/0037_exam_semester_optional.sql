-- Onyx 0037_exam_semester_optional.sql -- an exam need not name a term.
--
-- The scheduling form stopped asking which semester an examination belongs to:
-- somebody scheduling "CS101 Final" has no reason to pick a semester row, and
-- the course already knows. The API took it from the course instead.
--
-- That was right for the courses that HAVE a term and a dead end for the ones
-- that do not -- and there are more of those than the change assumed: better
-- than a quarter of the courses in this database carry no `semester_id` at
-- all. For those, the form no longer sent a semester, the course could not
-- supply one, and the API refused with a message the form gave no way to act
-- on. Scheduling an examination on such a course became impossible from the
-- product.
--
-- The honest fix is the column, not another field on the form. `semester_id`
-- was NOT NULL because every exam happened to have one, not because an exam
-- without a term is meaningless -- a resit, a make-up sitting, a certification
-- exam on a course that belongs to no programme are all real. So it becomes
-- nullable, and an exam that cannot say which term it is in simply does not
-- say.
--
-- **Nothing reads it in a way that breaks.** `ExaminationsService.exams()`
-- applies `semester_id` only when a caller asks for it, so an exam with none
-- is absent from a semester-filtered list -- which is correct, because it is
-- not in that semester -- and present everywhere else. The calendar index
-- `(tenant_id, semester_id, starts_at)` keeps working; Postgres indexes nulls.

ALTER TABLE public."onyx_exams"
  ALTER COLUMN "semester_id" DROP NOT NULL;

COMMENT ON COLUMN public."onyx_exams"."semester_id" IS
  'The term this sitting belongs to. Taken from the course when it has one, '
  'and left null when it does not -- a resit or a certification exam on a '
  'course outside any programme is still an exam.';
