-- Onyx 0030_domain_registrations.sql -- somebody signing up for a Live Class.
--
-- 0027 shipped domains with a price and nothing to press. That was the right
-- call at the time and the reason is worth keeping: a course purchase UNLOCKS
-- something -- an outline, lessons, an enrolment -- and a domain has none of
-- those to unlock. Taking money for a tile is not a feature.
--
-- So what does buying a domain mean? It means a person has paid to join a
-- programme the institution runs off-product, and the institution now has to
-- do something about it. That makes the record here a REGISTRATION, not an
-- entitlement: it grants no access, because there is no access to grant. What
-- it does is put a name on a list somebody in the office reads.
--
-- Which is why this migration is only half the work, and the smaller half. The
-- other half is the screen that shows an administrator who has registered for
-- what. A payment that produces a row nobody looks at is worse than no payment
-- button at all -- the learner has been charged and, as far as they can tell,
-- nothing happened.
--
-- The shape is onyx_course_purchases as 0028 left it, deliberately and almost
-- column for column. That table has been through the gateway problem already:
--
--   * UNIQUE (tenant_id, domain_id, user_id) -- one registration per person per
--     domain. Somebody who abandons a payment and starts again overwrites their
--     own pending row rather than leaving litter behind.
--   * UNIQUE (tenant_id, gateway, reference) -- the idempotency key. A replayed
--     webhook hits the constraint, the service catches it, re-reads, and
--     reports the original row instead of taking the money twice. onyx_payments
--     has used this since 0008 and course purchases since 0028; this is the
--     third table to need it and it should not look different in any of them.
--   * status IN (pending, captured, failed), because a real gateway has a
--     moment where the answer is not yet known.
--
-- `amount_minor` is written from the domain's price at the moment of purchase
-- and never read back from it. A programme whose price changes next term must
-- not rewrite what somebody was actually charged last term -- the same rule
-- that makes onyx_course_purchases.amount_minor and every invoice line a
-- ledger rather than a cache.
--
-- A FREE domain still gets a row. "Register your interest" and "pay to join"
-- are the same act from the institution's side -- a name on the list -- and
-- splitting them into two tables would mean every reader remembering to union
-- them. Gateway is 'free' there, which is honest and greppable.
--
-- No invoice is raised, for the reason 0024's header gives about courses: this
-- is not a debt anybody was in, and putting it through the fee ledger would put
-- rows in an arrears report nobody is in arrears on.

CREATE TABLE IF NOT EXISTS public."onyx_domain_registrations" (
  "id"           bigserial PRIMARY KEY,
  "tenant_id"    bigint NOT NULL REFERENCES public."onyx_tenants"("id")  ON DELETE CASCADE,
  "domain_id"    bigint NOT NULL REFERENCES public."onyx_domains"("id")  ON DELETE CASCADE,
  "user_id"      uuid   NOT NULL REFERENCES public."onyx_users"("id")    ON DELETE CASCADE,
  "amount_minor" integer NOT NULL DEFAULT 0,
  "currency"     varchar(3) NOT NULL DEFAULT 'INR',
  "gateway"      varchar(30) NOT NULL DEFAULT 'mock',
  "reference"    varchar(4000) NOT NULL,
  "provider_ref" varchar(120),
  "status"       varchar(20) NOT NULL DEFAULT 'captured',
  "created_at"   timestamptz NOT NULL DEFAULT now(),
  "updated_at"   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public."onyx_domain_registrations" IS
  'Who has signed up for a Live Class. Grants no access -- see the file header.';
COMMENT ON COLUMN public."onyx_domain_registrations"."amount_minor" IS
  'What they were actually charged. Never re-read from the domain, which can change.';
COMMENT ON COLUMN public."onyx_domain_registrations"."provider_ref" IS
  'The gateway''s own transaction id. Null for a mock or a free registration.';

-- Dropped then added so the file re-runs, the same way 0024 and 0028 handle
-- their own.
ALTER TABLE public."onyx_domain_registrations"
  DROP CONSTRAINT IF EXISTS "onyx_domain_registrations_status_check";
ALTER TABLE public."onyx_domain_registrations"
  ADD CONSTRAINT "onyx_domain_registrations_status_check"
  CHECK ("status" IN ('pending', 'captured', 'failed'));

ALTER TABLE public."onyx_domain_registrations"
  DROP CONSTRAINT IF EXISTS "onyx_domain_registrations_amount_check";
ALTER TABLE public."onyx_domain_registrations"
  ADD CONSTRAINT "onyx_domain_registrations_amount_check"
  CHECK ("amount_minor" >= 0);

-- One per person per domain.
CREATE UNIQUE INDEX IF NOT EXISTS "onyx_domain_registrations_person"
  ON public."onyx_domain_registrations" ("tenant_id", "domain_id", "user_id");

-- The idempotency key that makes a replayed webhook safe.
CREATE UNIQUE INDEX IF NOT EXISTS "onyx_domain_registrations_reference"
  ON public."onyx_domain_registrations" ("tenant_id", "gateway", "reference");

-- The administrator's read: everybody on one domain, newest first.
CREATE INDEX IF NOT EXISTS "onyx_domain_registrations_domain"
  ON public."onyx_domain_registrations" ("tenant_id", "domain_id", "created_at" DESC);

ALTER TABLE public."onyx_domain_registrations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."onyx_domain_registrations" FORCE ROW LEVEL SECURITY;

-- No policy, the same as every other Onyx table: every read goes through the
-- service-role client with tenant_id as the filter (see 0003_rls.sql and the
-- audit in tools/db/verify-rls.mjs). RLS is on and forced so a stray anon key
-- cannot read it at all.
