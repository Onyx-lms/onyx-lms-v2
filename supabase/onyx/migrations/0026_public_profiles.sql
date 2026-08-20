-- Onyx 0026_public_profiles.sql -- a profile with an address somebody can share.
--
-- "Your profile" was reachable at exactly one URL, /onyx/profile, which means
-- the same page for every person and no page at all for anybody else: a learner
-- could not send a link to what they have done here, and an employer following
-- one would have landed on their own empty profile. Everything on that screen
-- was also read-only and system-derived -- courses, marks, awarded skills --
-- with nothing a person could say about themselves.
--
-- Two additions, both on the user rather than the membership, because a person
-- is one person across every institution they belong to:
--
--   * `username` -- the handle in the URL. Unique across the platform and
--     nullable: an account that never opens its profile never needs one, and a
--     UNIQUE index tolerates many NULLs. It is a person's own choice, so a
--     student may set it to their roll number and a lecturer to their name.
--
--   * The things a profile says that no other table knows: a headline, a bio,
--     what they can do, what they are interested in, where they have been, and
--     one link. Plain text rather than structured rows -- these are prose a
--     person writes about themselves, and a schema for "experience" would
--     be a form with a shape nobody's career fits.
--
-- `profile_public` defaults to FALSE and that is the load-bearing default. A
-- profile carries a real name, an institution, and what somebody is studying;
-- publishing that because the feature shipped would be a privacy decision
-- taken on the user's behalf. The address exists as soon as they have a
-- username; it answers to the world only when they say so.

ALTER TABLE public."onyx_users"
  ADD COLUMN IF NOT EXISTS "username"       varchar(40),
  ADD COLUMN IF NOT EXISTS "headline"       varchar(160) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "bio"            varchar(2000) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "skills_text"    varchar(600) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "interests"      varchar(600) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "experience"     varchar(3000) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "website"        varchar(200) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "profile_public" boolean NOT NULL DEFAULT false;

-- Lower-cased, so `/p/AlexSmith` and `/p/alexsmith` cannot be two people.
CREATE UNIQUE INDEX IF NOT EXISTS "onyx_users_username_unique"
  ON public."onyx_users" (lower("username")) WHERE "username" IS NOT NULL;

COMMENT ON COLUMN public."onyx_users"."username" IS
  'The handle in /onyx/p/<username>. Chosen by the person; a student may use '
  'their roll number. Unique platform-wide, case-insensitively.';
COMMENT ON COLUMN public."onyx_users"."profile_public" IS
  'Whether /onyx/p/<username> answers to somebody without an account. Off '
  'until the person turns it on.';
