-- CMP-01 -- the number an institution actually calls somebody by.
--
-- Every institution has one: a roll number, an enrolment number, a staff ID.
-- It is what appears on a register, a hall ticket and a mark sheet, and it is
-- what a person writes at the top of a paper. Onyx had no field for it, so
-- every one of those screens fell back to a name -- which is not unique, gets
-- misspelled, and sorts by whichever part somebody typed first -- or to a
-- Supabase Auth uuid, which is not a thing anybody says out loud.
--
-- On the MEMBERSHIP, not the user, and that is the whole design decision.
--
-- An Onyx account is not owned by an institution: one person can belong to
-- several, and the product's own login copy says so. Their number at one is
-- not their number at another -- a visiting lecturer at two colleges has two
-- staff IDs, and a learner who transfers keeps the old institution's records
-- under the old number. Putting it on `onyx_users` would force one identity
-- across institutions that do not share one, and would let one tenant's
-- administrator overwrite what another tenant calls that person.
--
-- Nullable, because it has to be. An institution that does not use roll
-- numbers must not be blocked from adding members, and one that adopts them
-- later must not have to invent numbers for everybody first.

ALTER TABLE public."onyx_memberships"
  ADD COLUMN IF NOT EXISTS "roll_number" varchar(40);

COMMENT ON COLUMN public."onyx_memberships"."roll_number" IS
  'The institution''s own identifier for this person -- roll number, enrolment number, staff ID. Set by that institution''s administrator. Unique within the tenant, null where unused.';

-- Unique per institution, and only where set.
--
-- A partial index rather than a plain UNIQUE constraint: a normal unique
-- constraint treats NULLs as distinct, which happens to give the right answer
-- here, but stating the intent as "unique among the rows that have one" is
-- what makes it obvious that blank is a legitimate state rather than an
-- oversight. Case-insensitive, because CS-2024-014 and cs-2024-014 are the
-- same person to everybody except a database.
CREATE UNIQUE INDEX IF NOT EXISTS onyx_memberships_roll_unique
  ON public."onyx_memberships" ("tenant_id", lower("roll_number"))
  WHERE "roll_number" IS NOT NULL;

-- Rolls are looked up and sorted by far more often than they are written --
-- a register, a marks list, a seating plan are all "in roll order".
CREATE INDEX IF NOT EXISTS onyx_memberships_roll_idx
  ON public."onyx_memberships" ("tenant_id", "roll_number");
