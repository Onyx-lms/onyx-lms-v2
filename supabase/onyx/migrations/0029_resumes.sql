-- Onyx 0029_resumes.sql -- a resume that is overrides, never a copy.
--
-- What this table does NOT hold is the resume. It holds the handful of
-- decisions a person makes ABOUT one, and the document is assembled on every
-- read from the records the institution already keeps: their profile, the
-- batches they are in, the courses they are enrolled on, the skills evidence
-- has awarded them, the certificates they have been issued, the projects in
-- their workspaces.
--
-- Two designs were rejected before this one.
--
-- Storing the rendered document would go stale the moment a certificate is
-- issued -- a learner would finish a course, be issued a credential, and their
-- resume would not know. "Regenerate" then becomes a button somebody has to
-- remember to press, and the answer to "why is this not on my CV" becomes a
-- support question rather than nothing at all.
--
-- Reusing the profile editor alone was the other. It has the fields, but
-- tailoring a resume for one employer would rewrite the public profile -- so
-- the act of applying somewhere would change what everybody else sees.
--
-- Hence: derive, then subtract, then add, then order, then overlay.
--
--   * `hidden` is a SUBTRACTION, not a selection. It lists what to leave out
--     ("course:12", "cert:8"), so anything that arrives later is included by
--     default. A list of what to INCLUDE would mean a certificate issued
--     tomorrow silently missing from a resume the holder thought was finished,
--     which is exactly the staleness the first rejected design has.
--   * `section_order` is a list of section keys. Absent or partial is fine --
--     whatever it does not name keeps its default position, so a new section in
--     a later release does not vanish for everybody who ever reordered theirs.
--   * `extras` is the escape hatch, and it is why there is no work-history
--     table. 0026's header argued that case for `experience` and it still
--     holds: a schema for a career is a form with a shape nobody's career fits.
--     Each entry is {section, title, detail, when} -- enough for a job, a
--     publication or a volunteering stint, and not a pretence at modelling any
--     of them.
--   * `objective` is the one field a language model would ever touch, and it is
--     deliberately the only one. Nothing generates it today; a person writes
--     it. Its existence is the seam, not a promise.
--   * `include_phone` defaults to FALSE. 0026 keeps a phone number off the
--     public projection on purpose, and a resume is a document people email to
--     strangers -- so it is opt-in here too, said once, by the person whose
--     number it is.
--   * `headline_override` is nullable rather than empty-defaulted, because
--     "use my profile headline" and "use an empty headline" are different
--     answers and a resume tailored for one employer needs to be able to give
--     the second.
--
-- UNIQUE (tenant_id, user_id): one set of decisions per person per
-- institution. Somebody at two institutions has two, which is right -- the
-- education, courses and certificates behind them are different documents.

CREATE TABLE IF NOT EXISTS public."onyx_resumes" (
  "id"                bigserial PRIMARY KEY,
  "tenant_id"         bigint NOT NULL REFERENCES public."onyx_tenants"("id") ON DELETE CASCADE,
  "user_id"           uuid   NOT NULL REFERENCES public."onyx_users"("id")   ON DELETE CASCADE,
  "title"             varchar(120)  NOT NULL DEFAULT '',
  "objective"         varchar(1200) NOT NULL DEFAULT '',
  "headline_override" varchar(160),
  "include_phone"     boolean NOT NULL DEFAULT false,
  "hidden"            jsonb NOT NULL DEFAULT '[]'::jsonb,
  "section_order"     jsonb NOT NULL DEFAULT '[]'::jsonb,
  "extras"            jsonb NOT NULL DEFAULT '[]'::jsonb,
  "created_at"        timestamptz NOT NULL DEFAULT now(),
  "updated_at"        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public."onyx_resumes" IS
  'Overrides for an assembled resume. Never the resume itself -- see the file header.';
COMMENT ON COLUMN public."onyx_resumes"."hidden" IS
  'What to LEAVE OUT ("course:12"). A subtraction, so later records are included by default.';
COMMENT ON COLUMN public."onyx_resumes"."extras" IS
  '[{section, title, detail, when}] -- the escape hatch that replaces a work-history schema.';
COMMENT ON COLUMN public."onyx_resumes"."include_phone" IS
  'Opt-in. A resume is emailed to strangers; a phone number is the holder''s to volunteer.';

-- One per person per institution. The read this table has is always by both.
CREATE UNIQUE INDEX IF NOT EXISTS "onyx_resumes_owner"
  ON public."onyx_resumes" ("tenant_id", "user_id");

-- Dropped then added so the file re-runs, the same way 0024 handles its own.
-- Arrays, not objects: `hidden` and `section_order` are lists of strings and
-- `extras` a list of entries, and a jsonb column with no shape at all is a
-- column that eventually holds whatever a bug wrote into it.
ALTER TABLE public."onyx_resumes" DROP CONSTRAINT IF EXISTS "onyx_resumes_json_check";
ALTER TABLE public."onyx_resumes" ADD CONSTRAINT "onyx_resumes_json_check"
  CHECK (
    jsonb_typeof("hidden") = 'array'
    AND jsonb_typeof("section_order") = 'array'
    AND jsonb_typeof("extras") = 'array'
  );

ALTER TABLE public."onyx_resumes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."onyx_resumes" FORCE ROW LEVEL SECURITY;

-- No policy, the same as every other Onyx table: every read goes through the
-- service-role client with tenant_id as the filter (see 0003_rls.sql and the
-- audit in tools/db/verify-rls.mjs). RLS is on and forced so a stray anon key
-- cannot read it at all.
