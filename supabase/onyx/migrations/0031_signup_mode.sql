-- Onyx 0031_signup_mode.sql -- how a student is allowed to register.
--
-- Self-registration resolved the institution from the DOMAIN of the address a
-- student typed, and that is a good rule for institutions that issue
-- addresses. Plenty do not. A college whose students use personal Gmail
-- accounts could not open registration at all, and telling them to issue
-- domain addresses first is telling them to solve a harder problem before they
-- may use the easier one.
--
-- So the institution chooses, and there are three answers rather than a
-- boolean:
--
--   off       nobody self-registers. Somebody with authority adds you.
--   domain    the address decides. Instant, and nobody has to approve
--             anything, because the address IS the proof.
--   request   the student PICKS the institution from a list. The account is
--             created but the membership is left pending, and an
--             administrator approves it.
--
-- **Why `request` cannot simply let people in.** A dropdown of institutions is
-- a claim, not evidence: anybody on the internet could pick a real college and
-- be inside it -- reading its catalogue, joining its open courses, appearing
-- on its rosters. The domain check was the only thing preventing that, so the
-- mode that removes it has to put something in its place, and the only honest
-- something is a person looking at the request.
--
-- The two combine, which is the point. Under `request`, an address that
-- matches the institution's listed domains is admitted INSTANTLY -- the domain
-- becomes a fast path rather than a gate, so a college that issues addresses
-- to most students and not to a few gets both behaviours from one setting.
--
-- Pending costs nothing to enforce, because it already works:
-- `onyx_memberships.status` exists, `membershipsFor` selects `status = 1`, and
-- `signIn` refuses an account with no active membership. A pending member
-- cannot sign in today and will not be able to tomorrow.
--
-- `student_signup` stays as it is: the boolean still means "self-registration
-- is on at all", and this column says how. Existing rows with it switched on
-- are set to `domain`, which is exactly what they did yesterday -- nothing
-- changes for an institution that has already configured this.

ALTER TABLE public."onyx_tenants"
  ADD COLUMN IF NOT EXISTS "signup_mode" varchar(10) NOT NULL DEFAULT 'domain';

COMMENT ON COLUMN public."onyx_tenants"."signup_mode" IS
  'How a student may self-register: domain (the address decides) or request '
  '(they pick, an administrator approves). Only read when student_signup is on.';

-- Dropped then added so the file re-runs, the same way 0024 handles its own.
ALTER TABLE public."onyx_tenants"
  DROP CONSTRAINT IF EXISTS "onyx_tenants_signup_mode_check";
ALTER TABLE public."onyx_tenants"
  ADD CONSTRAINT "onyx_tenants_signup_mode_check"
  CHECK ("signup_mode" IN ('domain', 'request'));

-- Everything already open stays exactly as it was. The DEFAULT above says the
-- same thing for rows that have registration switched off, where the column is
-- not read at all.
UPDATE public."onyx_tenants" SET "signup_mode" = 'domain' WHERE "signup_mode" IS NULL;

-- The administrator's read: who is waiting to be let in. Partial, because
-- pending memberships are a handful against a roster of thousands and the
-- index has no business being the size of the table.
CREATE INDEX IF NOT EXISTS "onyx_memberships_pending"
  ON public."onyx_memberships" ("tenant_id", "created_at" DESC)
  WHERE "status" = 0;
