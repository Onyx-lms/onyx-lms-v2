-- ---------------------------------------------------------------------------
-- 0041 -- a question you answer by building a page.
--
-- Code Lab already asks "write a program and we will run it against tests".
-- Web development is not that question. There is no stdin, there is no
-- expected stdout, and what is being assessed is what the page LOOKS LIKE and
-- how it behaves -- three files, one browser, and a person's judgement of the
-- result. Trying to squeeze it into the code path would mean inventing a test
-- format for "is the heading centred", which nobody wants to write and nobody
-- would trust.
--
-- So a web problem is a Code Lab problem of a different KIND, and the two
-- differ in exactly three ways:
--
--   * it carries FILES rather than per-language starter code. Both live in
--     `starter_code`, which is a jsonb map either way -- for `code` it is
--     keyed by language ("python" -> source), for `web` it is keyed by path
--     ("index.html" -> markup). One column, two readings, written down here so
--     nobody has to guess which they are looking at;
--   * it has no test cases, so publishing one cannot demand any. What it must
--     have instead is an index.html, because a preview of nothing is nothing;
--   * it is MARKED BY A PERSON. `isObjective` already says a code question is
--     not machine-markable from a key; a web question is not machine-markable
--     at all, so it takes the same road an essay does -- straight to a marker,
--     who gets the files and a rendered preview of them side by side.
--
-- `preview_entry` exists because "index.html" is a convention rather than a
-- law, and a problem set around `about.html` should not be unpresentable. It
-- defaults to the convention.
--
-- On submissions: a practice attempt at a web problem has no score to report,
-- so `score`/`passed`/`total` stay zero and would be a lie if anything read
-- them as a mark. `kind` is what stops that reading, and `files` is where the
-- work actually goes -- `source` is a single text column and three files are
-- not one string, however tempting it is to JSON-encode them into it.
-- ---------------------------------------------------------------------------

ALTER TABLE public."onyx_problems"
  ADD COLUMN IF NOT EXISTS "kind"          varchar(20) NOT NULL DEFAULT 'code',
  ADD COLUMN IF NOT EXISTS "preview_entry" varchar(200) NOT NULL DEFAULT 'index.html';

ALTER TABLE public."onyx_problems"
  DROP CONSTRAINT IF EXISTS onyx_problems_kind_check;
ALTER TABLE public."onyx_problems"
  ADD CONSTRAINT onyx_problems_kind_check CHECK ("kind" IN ('code', 'web'));

ALTER TABLE public."onyx_code_submissions"
  ADD COLUMN IF NOT EXISTS "kind"  varchar(20) NOT NULL DEFAULT 'code',
  ADD COLUMN IF NOT EXISTS "files" jsonb;

ALTER TABLE public."onyx_code_submissions"
  DROP CONSTRAINT IF EXISTS onyx_code_submissions_kind_check;
ALTER TABLE public."onyx_code_submissions"
  ADD CONSTRAINT onyx_code_submissions_kind_check CHECK ("kind" IN ('code', 'web'));

/*
 * `source` stops being NOT NULL, and only for this reason.
 *
 * A web submission has no single source. Making it store an empty string to
 * satisfy a constraint would put a column in the table that always holds
 * nothing and means nothing, which is how a schema starts lying about itself.
 * A code submission still has to have one -- enforced below rather than by the
 * column, so the rule can say WHICH kind it applies to.
 */
ALTER TABLE public."onyx_code_submissions" ALTER COLUMN "source" DROP NOT NULL;

ALTER TABLE public."onyx_code_submissions"
  DROP CONSTRAINT IF EXISTS onyx_code_submissions_body_check;
ALTER TABLE public."onyx_code_submissions"
  ADD CONSTRAINT onyx_code_submissions_body_check CHECK (
    ("kind" = 'code' AND "source" IS NOT NULL)
    OR ("kind" = 'web' AND "files" IS NOT NULL)
  );

-- The bank filters by kind ("show me the web problems"), so that is the index.
CREATE INDEX IF NOT EXISTS onyx_problems_kind_idx
  ON public."onyx_problems" ("tenant_id", "kind", "status");
