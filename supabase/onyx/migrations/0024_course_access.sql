-- Onyx 0024_course_access.sql -- open courses, locked courses, and how a
-- learner gets into a locked one.
--
-- A course has always been one of two things to a learner: enrolled onto by
-- the institution, or self-enrollable (`self_enroll`, 0002). Both are free.
-- There was no way to say "anyone may take this, for a price", which is the
-- ordinary shape of a course an institution sells rather than teaches as part
-- of a programme.
--
-- Three additions, none of which change an existing row's behaviour:
--
--   * `access` on a course: 'batch' (the institution enrols you -- what every
--     course is today), 'open' (self-enrol, free) or 'locked' (self-enrol,
--     paid). Defaults to a value derived from `self_enroll` in the backfill
--     below, so nothing moves. `self_enroll` is deliberately kept: it is what
--     selfEnroll() has always read, and access is layered on top rather than
--     replacing it in one migration.
--
--   * `price_minor` and `currency`: what a locked course costs. Minor units,
--     like every other amount in this product, so nothing rounds twice.
--
--   * `onyx_course_purchases`: one row per learner per course, carrying the
--     amount, the gateway and its reference. Deliberately NOT an invoice --
--     invoices belong to a fee structure and an instalment plan, which is the
--     institution billing its own students for a programme. Buying a course is
--     a different act with a different lifecycle, and forcing it through the
--     fee ledger would put rows in an arrears report that nobody is in arrears
--     on.
--
-- The unique index is what makes a double-click safe: a learner has at most
-- one purchase per course, so the second attempt updates rather than charges
-- again.

ALTER TABLE public."onyx_courses"
  ADD COLUMN IF NOT EXISTS "access" varchar(10) NOT NULL DEFAULT 'batch',
  ADD COLUMN IF NOT EXISTS "price_minor" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "currency" varchar(3) NOT NULL DEFAULT 'INR';

-- Today's meaning, preserved: a self-enrollable course is an open one.
UPDATE public."onyx_courses" SET "access" = 'open'
  WHERE "self_enroll" = 1 AND "access" = 'batch';

ALTER TABLE public."onyx_courses"
  DROP CONSTRAINT IF EXISTS "onyx_courses_access_check";
ALTER TABLE public."onyx_courses"
  ADD CONSTRAINT "onyx_courses_access_check"
  CHECK ("access" IN ('batch', 'open', 'locked'));

-- A locked course with no price is a course nobody can ever enter, so the two
-- are constrained together rather than left to the application to remember.
ALTER TABLE public."onyx_courses"
  DROP CONSTRAINT IF EXISTS "onyx_courses_locked_price_check";
ALTER TABLE public."onyx_courses"
  ADD CONSTRAINT "onyx_courses_locked_price_check"
  CHECK ("access" <> 'locked' OR "price_minor" > 0);

CREATE TABLE IF NOT EXISTS public."onyx_course_purchases" (
  "id"           bigserial PRIMARY KEY,
  "tenant_id"    bigint NOT NULL REFERENCES public."onyx_tenants"("id") ON DELETE CASCADE,
  "course_id"    bigint NOT NULL REFERENCES public."onyx_courses"("id") ON DELETE CASCADE,
  "user_id"      uuid NOT NULL REFERENCES public."onyx_users"("id") ON DELETE CASCADE,
  "amount_minor" integer NOT NULL,
  "currency"     varchar(3) NOT NULL DEFAULT 'INR',
  -- 'mock' until a real gateway is wired; the column exists so that day is a
  -- new value rather than a new table.
  "gateway"      varchar(30) NOT NULL DEFAULT 'mock',
  "reference"    varchar(120) NOT NULL,
  "status"       varchar(20) NOT NULL DEFAULT 'captured',
  "created_at"   timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "onyx_course_purchases_once"
  ON public."onyx_course_purchases" ("tenant_id", "course_id", "user_id");
CREATE INDEX IF NOT EXISTS "onyx_course_purchases_tenant"
  ON public."onyx_course_purchases" ("tenant_id", "created_at" DESC);

ALTER TABLE public."onyx_course_purchases" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."onyx_course_purchases" FORCE ROW LEVEL SECURITY;

-- Same shape as every other Onyx table: no policy, because every read goes
-- through the service-role client with tenant_id as the filter (see
-- 0003_rls.sql and the audit in tools/db/verify-rls.mjs). RLS is on and
-- forced so a stray anon key cannot read it at all.
