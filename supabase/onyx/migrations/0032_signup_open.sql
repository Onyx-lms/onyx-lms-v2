-- Onyx 0032_signup_open.sql -- choosing an institution lets you straight in.
--
-- 0031 shipped this a week older than it lasted. It called the second mode
-- `request` and meant it: a student picked an institution, the membership was
-- created pending, and somebody there approved it. The reasoning was that a
-- name chosen from a dropdown is a claim rather than evidence.
--
-- That was the wrong trade for this product, and it was overruled: a queue
-- between a learner and their first lesson is a queue nobody empties on a
-- Friday afternoon, and the institution that switched the mode on has already
-- said who it is willing to accept. So the mode admits immediately, and the
-- name changes with the behaviour -- a setting called `request` that grants
-- instant access would lie to the next person who read it.
--
-- What this means, said plainly because the column is where somebody will look
-- for it: an institution in `open` mode can be joined by anyone who picks it
-- from the list. There is no check. That is the institution's decision to
-- make, it is off by default, and `domain` remains the mode for anyone who
-- wants the address to prove the claim.
--
-- Pending memberships are gone with it. Nothing creates a `status = 0`
-- membership any more, the screen that showed them is deleted rather than left
-- unreachable, and the partial index 0031 added for that queue goes too.

ALTER TABLE public."onyx_tenants"
  DROP CONSTRAINT IF EXISTS "onyx_tenants_signup_mode_check";

UPDATE public."onyx_tenants" SET "signup_mode" = 'open' WHERE "signup_mode" = 'request';

ALTER TABLE public."onyx_tenants"
  ADD CONSTRAINT "onyx_tenants_signup_mode_check"
  CHECK ("signup_mode" IN ('domain', 'open'));

COMMENT ON COLUMN public."onyx_tenants"."signup_mode" IS
  'How a student may self-register: domain (only addresses at signup_domains) '
  'or open (anyone may pick this institution, and is admitted at once). '
  'Only read when student_signup is on.';

-- Nothing waits any more.
DROP INDEX IF EXISTS "onyx_memberships_pending";

-- Any membership left pending by the version this replaces would be a person
-- who registered, cannot sign in, and now has nobody to approve them. They
-- chose an institution that was accepting people; admit them.
UPDATE public."onyx_memberships" SET "status" = 1 WHERE "status" = 0;
