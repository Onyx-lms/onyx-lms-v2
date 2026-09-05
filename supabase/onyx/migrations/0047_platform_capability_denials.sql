-- Onyx 0047_platform_capability_denials.sql -- what the PLATFORM withholds.
--
-- 0023 gave an institution a matrix of who may do what, and put `admin` back
-- on read whatever it stored, because an administrator who can revoke their
-- own last capability has locked the institution out of itself. That rule is
-- right about the institution and wrong about the platform.
--
-- An operator selling this product needs to be able to say "this institution
-- does not issue credentials" -- a plan, a contract, a compliance decision.
-- Until now the console accepted that change and it did nothing: the save
-- returned 200, holdersOf re-added `admin`, and the institution's
-- administrator carried on issuing certificates. Verified against the live
-- deployment before this column existed.
--
-- So: a separate list, written only by the platform routes, that `can()`
-- checks before anything else. It is never a lockout, because the operator who
-- set it is the one who can lift it, and it is deliberately NOT part of the
-- `permissions` column -- an institution editing its own matrix must not be
-- able to hand itself back something the platform withheld.
--
-- Shape: ["careers.certificates", "fees.gateways"] -- capability keys from
-- packages/core/src/onyx/permissions.ts. [] means "nothing withheld", which is
-- every institution until an operator says otherwise, so this migration
-- changes no behaviour on its own.

ALTER TABLE public."onyx_tenants"
  ADD COLUMN IF NOT EXISTS "platform_denied" jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public."onyx_tenants"."platform_denied" IS
  'Capabilities the platform operator has withheld from this institution. '
  'Checked before the tenant matrix and before the admin floor; writable only '
  'through /api/onyx/platform routes.';
