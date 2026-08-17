-- Onyx 0006_readiness_key.sql -- a correction to 0005.
--
-- `onyx_readiness_scores` was created with UNIQUE ("user_id"), which is wrong
-- for the same reason everything else in Onyx is keyed by tenant: a person can
-- be a student at one institution and a candidate at another, and they have a
-- readiness score at each. The original key made the second institution's
-- computation collide with the first's row -- a 500, and one that only appeared
-- when somebody belonged to two tenants.
--
-- Found by the O05 cross-tenant test, which is exactly the case it breaks on.

ALTER TABLE public."onyx_readiness_scores"
  DROP CONSTRAINT IF EXISTS onyx_readiness_scores_unique;

ALTER TABLE public."onyx_readiness_scores"
  ADD CONSTRAINT onyx_readiness_scores_unique UNIQUE ("tenant_id", "user_id");

NOTIFY pgrst, 'reload schema';
