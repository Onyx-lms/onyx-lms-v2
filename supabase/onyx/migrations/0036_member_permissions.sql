-- Onyx 0036_member_permissions.sql -- permission for a person, not only a role.
--
-- Until now an institution could say "faculty may create courses" and nothing
-- narrower. That is the right default and a poor floor: the real request is
-- always about one person -- the lecturer who also runs the timetable, the one
-- exams officer trusted with the fee structures, the head of department who
-- needs the audit log and whose colleagues do not. Answering that with the
-- role matrix means promoting everybody who shares their role, which is how a
-- permission system quietly becomes "everyone is an admin".
--
-- **A grant here can never exceed what the capability allows.** Every
-- capability in the catalogue carries a `holders` list -- the roles an
-- institution MAY delegate it to -- and several are deliberately empty
-- (`fees.structures`, `fees.gateways`), meaning nobody below an administrator
-- may ever hold them. Naming a person does not get round that: the service
-- checks the same list before accepting a personal grant, so this column adds
-- precision, never reach. See `normalisePersonal` in permissions.ts.
--
-- **Shaped as grants AND revocations**, because both are real. `true` gives
-- somebody a capability their role does not carry; `false` takes one away from
-- somebody whose role does. A lecturer who should no longer publish results
-- can be stopped without changing what "faculty" means for the other forty.
--
-- On the membership rather than in a table of its own. A permission is a fact
-- about somebody's place in ONE institution -- the same person can be faculty
-- here and a student there -- and the membership is already that fact. It also
-- means the row is loaded by the check that already loads the membership,
-- rather than adding a query to every guarded request.
--
-- Empty object rather than null so the read never has to distinguish "no
-- overrides" from "not set", which is the distinction that produces a
-- `Cannot read properties of null` in a permission check.

ALTER TABLE public."onyx_memberships"
  ADD COLUMN IF NOT EXISTS "permissions" jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public."onyx_memberships"."permissions" IS
  'Per-person capability overrides: {"courses.create": true, "assess.release": false}. '
  'true grants what the role lacks, false revokes what it carries. Never widens '
  'past a capability''s own holders list -- see permissions.ts.';

-- Somewhere for an institution to put the community its learners are actually in.
--
-- Every institution here already runs a WhatsApp group, and the placement page
-- is where people go looking for it -- so the link belongs beside the jobs
-- rather than in somebody's pinned message. Stored on the tenant because it is
-- one link per institution, and validated on write as http/https only: this is
-- rendered as an anchor to a third-party site, and `javascript:` in an href is
-- stored XSS with extra steps.
ALTER TABLE public."onyx_tenants"
  ADD COLUMN IF NOT EXISTS "community_url" varchar(500),
  ADD COLUMN IF NOT EXISTS "community_label" varchar(120);

COMMENT ON COLUMN public."onyx_tenants"."community_url" IS
  'A WhatsApp (or other) community invite shown on the jobs page. http/https only.';
