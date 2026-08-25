-- Onyx 0039_question_sets.sql -- a bank holds SETS, and a set is a paper.
--
-- How an examination is actually set, and how this product had it backwards.
--
-- A paper-setter writes ten parallel papers: Set 1, Set 2, and so on, each with
-- the same shape -- so many multiple choice, so many descriptive, so many
-- coding -- and each of comparable difficulty, because a candidate handed Set 7
-- must not be sitting an easier examination than the one beside them on Set 3.
-- The sets rotate down the register so that neighbours never hold the same
-- paper: roll 1 sits Set 1, roll 2 sits Set 2, and roll 11 comes back round to
-- Set 1, which is out of arm's reach.
--
-- What was here instead was a bank as an undifferentiated pool, and a paper
-- that drew `take` questions from it at random per candidate. That produces
-- variety and no guarantee: two independent draws of five from thirty overlap
-- about six times in ten, and the person next to you is the entire threat.
-- Worse, it took the sets AWAY from the setter -- nobody could say "these five
-- go together and they are equivalent to those five", which is the judgement
-- that makes parallel papers fair.
--
-- So the set becomes a property of the question, authored deliberately, and the
-- bank becomes what the client calls it: the thing you build once and schedule
-- from.
--
-- **Defaulting to 1 is what makes this safe on a live database.** Every
-- question already here becomes Set 1 of its bank, every existing bank becomes
-- a one-set bank, and a one-set bank deals the same way it always did -- one
-- paper, everybody sits it. No existing assessment changes what it asks. A bank
-- grows a second set only when somebody adds one.

ALTER TABLE public."onyx_questions"
  ADD COLUMN IF NOT EXISTS "set_number" smallint NOT NULL DEFAULT 1;

-- Set numbers are 1..n as a setter counts them, never 0: "Set 0" is not a
-- thing anybody writes on a question paper, and the rotation reads directly
-- off the register when the two agree.
ALTER TABLE public."onyx_questions"
  DROP CONSTRAINT IF EXISTS onyx_questions_set_number_check;
ALTER TABLE public."onyx_questions"
  ADD CONSTRAINT onyx_questions_set_number_check
  CHECK ("set_number" >= 1 AND "set_number" <= 50);

-- The deal reads one bank's one set, so that is the index.
CREATE INDEX IF NOT EXISTS "onyx_questions_bank_set"
  ON public."onyx_questions" ("tenant_id", "bank_id", "set_number", "id");

COMMENT ON COLUMN public."onyx_questions"."set_number" IS
  'Which parallel set of this bank the question belongs to. Sets rotate by roll number so neighbours sit different papers; 1 for every question written before sets existed.';
