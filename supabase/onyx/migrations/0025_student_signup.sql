-- Onyx 0025_student_signup.sql -- a student can ask for an account.
--
-- Every account in this product is created by somebody else: an administrator
-- adds a member, or a platform operator adds an administrator. That is right
-- for staff and wrong for learners at an institution that wants them to
-- register themselves.
--
-- Two columns on the tenant, both defaulting to the behaviour every
-- institution has today (signup off), so this migration changes nothing until
-- an administrator turns it on:
--
--   * `student_signup` -- whether self-registration is open at all.
--
--   * `signup_domains` -- the email domains that resolve TO this institution.
--     This is what makes "organisation email" mean something rather than being
--     a label on a text box: a form that asked which institution you belong to
--     would either leak the customer list in a dropdown or trust a stranger to
--     name one. The domain answers it instead, and an address that matches no
--     institution is refused without saying which ones exist.
--
-- Stored as text rather than an array: it is read on one code path, written on
-- one screen, and a comma-separated list is what an administrator types.
--
-- The roll number a learner gives at signup lands in the membership's existing
-- `roll_number` (0022), so nothing new is needed for it, and the phone lands in
-- `onyx_users.phone`, which has always been there and never had a way to be
-- filled in by the person it belongs to.

ALTER TABLE public."onyx_tenants"
  ADD COLUMN IF NOT EXISTS "student_signup" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "signup_domains" varchar(500) NOT NULL DEFAULT '';

COMMENT ON COLUMN public."onyx_tenants"."signup_domains" IS
  'Comma-separated email domains that resolve to this institution at signup. '
  'Empty means self-registration cannot find this institution.';
