-- Onyx 0012_exam_permission.sql -- who is allowed to schedule an examination.
--
-- Scheduling an exam has always been open to admin, the exams office, and any
-- faculty member for a course they teach (assertCanRunExam in
-- campus.routes.ts). Some institutions want faculty to be able to set up
-- their own papers; others run examinations centrally and want every exam to
-- come from the office. That was never a choice an institution could make --
-- it was one fixed answer for everyone.
--
-- One flag, on the tenant, defaulting to the behaviour every institution
-- already has (true) so this migration changes nothing on its own. An admin
-- switches it off from Settings to require every exam go through admin or
-- the exams office; faculty keep marking and publishing exactly as before --
-- this only gates *scheduling*, not the rest of what faculty already do with
-- an exam once it exists.

ALTER TABLE public."onyx_tenants"
  ADD COLUMN IF NOT EXISTS "faculty_can_schedule_exams" boolean NOT NULL DEFAULT true;
