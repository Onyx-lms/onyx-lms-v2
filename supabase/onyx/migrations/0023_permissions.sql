-- Onyx 0023_permissions.sql -- what an institution may delegate, and to whom.
--
-- Every "who may do this" answer in the product was a role list written into a
-- route: requireOnyxRole(req, secret, 'admin', 'faculty'). Right for the shape
-- of the product, wrong for the shape of institutions -- a college that runs
-- examinations centrally and one where lecturers set their own papers are both
-- ordinary, and neither could be configured. 0012 solved exactly one of these
-- by hand (faculty_can_schedule_exams); this is the general case.
--
-- One JSONB column, holding ONLY the differences from the defaults in
-- packages/core/src/onyx/permissions.ts. Storing the whole matrix instead
-- would freeze it: a capability added in a later release would arrive absent
-- from every institution that had ever opened Settings, which is a silent
-- revocation nobody asked for. An institution that never touches Settings has
-- `{}` here and behaves exactly as it does today, so this migration changes no
-- behaviour on its own.
--
-- Shape: { "exams.schedule": ["admin","exams"], "fees.invoice": ["admin"] }
-- Keys are capability keys; values are the roles that hold them. `admin` is
-- re-added on read whatever is stored, because an override that drops it is a
-- lockout rather than a configuration.
--
-- faculty_can_schedule_exams (0012) is deliberately NOT dropped here. It is
-- still read by the exams route as a floor -- an institution that switched it
-- off keeps that answer until it sets the matrix instead, and nothing about
-- this migration changes what that flag means.

ALTER TABLE public."onyx_tenants"
  ADD COLUMN IF NOT EXISTS "permissions" jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public."onyx_tenants"."permissions" IS
  'Capability overrides: only what this institution changed from the defaults '
  'in packages/core/src/onyx/permissions.ts. {} means "as shipped".';
