-- Onyx 0028_course_purchase_lifecycle.sql -- a course purchase that can be
-- pending, and a replayed webhook that cannot charge twice.
--
-- 0024 wrote every purchase as `captured` in one statement, because the payment
-- was a mock and there was never a moment at which it was anything else. A real
-- gateway has that moment: a learner is sent to a payment window, and what
-- happens next arrives twice -- once when their browser comes back, once when
-- the gateway posts a webhook -- in an order nobody controls.
--
-- Two changes, and the second is the one that matters.
--
-- `provider_ref` and `updated_at`, so a row can carry the gateway's own
-- transaction id and say when it last moved. The status CHECK is added at the
-- same time; 0024 left `status` as a free varchar, which was fine while exactly
-- one value was ever written and is not fine now that three are.
--
-- The UNIQUE (tenant_id, course_id, user_id) index STAYS. One row per learner
-- per course is the right invariant and it is what hasPurchased() and
-- purchasesFor() already read -- both filter status = 'captured', so a pending
-- row is invisible to them today with no read to change. A learner who abandons
-- a payment and starts again overwrites their own pending row rather than
-- leaving litter behind, which a partial index WHERE status = 'captured' would
-- have allowed.
--
-- What is new is a SECOND unique index, on (tenant_id, gateway, reference).
-- That is the one that makes a replayed webhook safe: the second arrival hits a
-- constraint violation, the service catches it, re-reads, and reports the
-- original row instead of taking the money again. onyx_payments has used
-- exactly this technique since 0008 for exactly this reason, and a course sale
-- deserves the same protection an invoice payment has always had.
--
-- Nothing here raises an invoice for a course sale. 0024's header explains why
-- and it still holds: a course bought outright is not a debt anybody was in.

ALTER TABLE public."onyx_course_purchases"
  ADD COLUMN IF NOT EXISTS "provider_ref" varchar(120),
  ADD COLUMN IF NOT EXISTS "updated_at" timestamptz NOT NULL DEFAULT now();

COMMENT ON COLUMN public."onyx_course_purchases"."provider_ref" IS
  'The gateway''s own transaction id. Null for a mock purchase.';

-- Dropped then added so the file re-runs, the same way 0024 handles its own.
ALTER TABLE public."onyx_course_purchases"
  DROP CONSTRAINT IF EXISTS "onyx_course_purchases_status_check";
ALTER TABLE public."onyx_course_purchases"
  ADD CONSTRAINT "onyx_course_purchases_status_check"
  CHECK ("status" IN ('pending', 'captured', 'failed'));

-- The idempotency key. A gateway that posts the same capture twice, or posts it
-- while the returning browser is confirming the same payment, lands here.
CREATE UNIQUE INDEX IF NOT EXISTS "onyx_course_purchases_reference"
  ON public."onyx_course_purchases" ("tenant_id", "gateway", "reference");
