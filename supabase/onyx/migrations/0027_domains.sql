-- Onyx 0027_domains.sql -- Live Classes, and the domains it lists.
--
-- A DOMAIN is not a course, and is deliberately not a flag on one. A course is
-- a thing with a roster, an outline, lessons, progress and marks; a domain is a
-- thing an institution advertises -- a field of study with a price, a duration
-- and a curriculum published on the Onyx EduTech website. The two share a
-- sentence ("what you can study here") and nothing else. The moment
-- `onyx_courses.is_domain` existed, every course read in the product would have
-- had to remember to exclude them, and one that forgot would put a marketing
-- tile in a grade book.
--
-- So: a standalone table, its own screen, and an empty state on day one. The
-- Live Classes page starts with nothing in it because an institution has not
-- said what it offers yet, not because the query is wrong.
--
-- Four columns deserve a note.
--
--   * `curriculum_url` points OFF this product, at the marketing site. It is
--     normalised and protocol-checked on write (http and https only), because
--     a string that reaches an href is a string that can be `javascript:`, and
--     neither React nor Next sanitises one.
--   * `image_path` is a STORAGE KEY, never a URL. The bucket may move, be
--     renamed, or grow a CDN in front of it; the key does not change. It is
--     minted server-side from the tenant, exactly as `onyxStorageKey` mints a
--     course's, so a caller cannot write into another institution's prefix.
--   * `duration_label` is free text ("12 weeks", "3 months, weekends"), not a
--     number of hours. A number would be a lie for every part-time offering,
--     and this is copy on a tile rather than an input to a calculation -- the
--     same reasoning 0026 gives for keeping `experience` as prose.
--   * `certificate` is the NAME of what is awarded, empty where nothing is.
--     One nullable column beats a boolean plus a string that can disagree.
--
-- `price_minor` follows the house convention -- integer minor units, currency
-- beside it. Nothing sells a domain yet: the price is copy on a tile in this
-- release, and the column exists so that when buying arrives it does not need
-- a migration first.
--
-- `status` ships without a publish route. It is the one thing every other Onyx
-- entity has that somebody asks for within a week ("take it down without
-- deleting it"), and PATCH already reaches it.

CREATE TABLE IF NOT EXISTS public."onyx_domains" (
    "id"             bigserial PRIMARY KEY,
    "tenant_id"      bigint NOT NULL REFERENCES public."onyx_tenants"("id") ON DELETE CASCADE,
    "title"          varchar(200) NOT NULL,
    "summary"        varchar(4000) NOT NULL DEFAULT '',
    "curriculum_url" varchar(500) NOT NULL DEFAULT '',
    "image_path"     varchar(500),
    "certificate"    varchar(200) NOT NULL DEFAULT '',
    "duration_label" varchar(80) NOT NULL DEFAULT '',
    "price_minor"    integer NOT NULL DEFAULT 0,
    "currency"       varchar(3) NOT NULL DEFAULT 'INR',
    "sort"           integer NOT NULL DEFAULT 0,
    "status"         smallint NOT NULL DEFAULT 1,
    "created_by"     uuid REFERENCES public."onyx_users"("id") ON DELETE SET NULL,
    "created_at"     timestamptz NOT NULL DEFAULT now(),
    "updated_at"     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN public."onyx_domains"."image_path" IS
  'Supabase Storage key, not a URL. Resolved to a URL at read time.';
COMMENT ON COLUMN public."onyx_domains"."curriculum_url" IS
  'An http/https link to the curriculum on the Onyx EduTech site. Checked on write.';
COMMENT ON COLUMN public."onyx_domains"."duration_label" IS
  'Prose ("12 weeks"), not hours -- this is copy, not an input to a calculation.';

-- Dropped then added so the file re-runs, the same way 0024 handles its own.
ALTER TABLE public."onyx_domains" DROP CONSTRAINT IF EXISTS "onyx_domains_status_check";
ALTER TABLE public."onyx_domains" ADD CONSTRAINT "onyx_domains_status_check"
  CHECK ("status" IN (0, 1));

ALTER TABLE public."onyx_domains" DROP CONSTRAINT IF EXISTS "onyx_domains_price_check";
ALTER TABLE public."onyx_domains" ADD CONSTRAINT "onyx_domains_price_check"
  CHECK ("price_minor" >= 0);

-- The one read this table has: every domain of one institution, in the order an
-- administrator arranged them.
CREATE INDEX IF NOT EXISTS "onyx_domains_tenant"
  ON public."onyx_domains" ("tenant_id", "sort", "id");

ALTER TABLE public."onyx_domains" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."onyx_domains" FORCE ROW LEVEL SECURITY;

-- No policy, the same as every other Onyx table: every read goes through the
-- service-role client with tenant_id as the filter (see 0003_rls.sql and the
-- audit in tools/db/verify-rls.mjs). RLS is on and forced so a stray anon key
-- cannot read it at all.
