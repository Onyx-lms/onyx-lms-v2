# Onyx LMS

React / Node / TypeScript / Supabase port of the Laravel LMS (`EZiL Certify`).

Sprint plan: `MIGRATION_SPRINT_PLAN.csv` in the Laravel checkout.

**This is a separate repository.** It is generated from, but does not live
inside, the Laravel app. The parity tools read the Laravel SQLite file, so they
need to know where that checkout is:

```
LARAVEL_ROOT=../TT002-LEO-LMS   # the default: a sibling directory
```

Set `LARAVEL_ROOT` if your layout differs, or pass the path to any generator as
its first argument. Nothing else in the app touches the Laravel code.

## Status

| Sprint | Backend | Frontend | State |
| --- | --- | --- | --- |
| **S00** Foundation | 9/9 | - | **done, live** |
| **S01** Platform | 9/9 | - | **done, live** |
| **S02** Auth and Users | 10/10 | 8/8 | **done, live** |
| **S03** Public Site | 9/9 | 9/9 | **done, live** |
| **S04** Course Builder | 9/9 | 9/9 | **done, live** |
| **S05** Quizzes | 6/6 | - | **done, live** |
| **S06** Enrolment, Cart, Coupons | 7/7 | 7/7 | **done, live** |
| **S07** Payments core | 7/7 | 4/4 | **done, live** |
| **S08** Gateways + offline | 8/9 | 2/2 | **done, live** (PAY-14 Paytm not implemented) |
| **S09** Course Player | 9/10 | 9/9 | **done, live** (PL-07b ffmpeg burn-in skipped) |
| **S10** Certificates, Forum, Reviews | 8/8 | 5/5 | **done, live** |
| **S11** Reviews, Blog, Knowledge Base | 8/8 | 8/8 | **done, live** (R-01/R-02 landed in S10) |
| **S12** Messaging + contact inbox | 6/6 | 5/5 | **done, live** (no reactions -- see ADR-004) |
| **S13** Live Classes (Zoom + Jitsi) | 6/6 | 4/4 | **done** (Jitsi live; Zoom unverified -- no credentials) |
| **S14** Bootcamps / Workshops | 7/7 | 7/7 | **done, live** |
| **S15** Team Training / Classrooms | 5/5 | 5/5 | **done, live** |
| **S16** Tutor Booking | 7/7 | 6/6 | **done, live** |
| **S17** Revenue, Payouts, Dashboards | 5/5 | 3/3 | **done, live** |
| **S18** Admin Settings | 9/9 | 6/6 | **done, live** |
| S19+ | code IDE, hardening and handover | | not started |

### Onyx -- the institutional platform

A second product in this repository, built to the proposal at
<https://onyx.proposal.ezil.work/>. It reuses `packages/core` and the gate; it
does not extend the port's 61 tables. See `ONYX_SPRINT_PLAN.csv` and
`docs/ADR-006-onyx-foundation.md`.

| Sprint | Backend | Frontend | State |
| --- | --- | --- | --- |
| **O01** Foundation: tenancy, roles, audit | 7/7 | 2/2 | **done, live** |
| **O02** Onyx Learn: catalog, content, attendance, assignments | 10/10 | 7/7 | **done, live** |
| **O03** Code Lab: IDE, queue, evaluator, bank, workspaces | 6/6 | 4/4 | **done, live** |
| **O04** Assess: banks, timed engine, proctoring, marking, analytics | 9/9 | 7/7 | **done, live** |
| **O05** Career: certificates, passport, placement, contests, interviews | 8/8 | 10/10 | **done, live** |
| **O06** Learn engagement: progress, nudges, discussion, tickets | 2/2 | 4/4 | **done, live** |
| **O07** Campus: timetable, examinations, finance, guardians | 4/4 | 8/8 | **done, live** |
| **Platform** superadmin: tenants, cross-tenant audit | 1/1 | 2/2 | **done, live** |
| **Gap closure** the seven partial requirements, finished | -- | -- | **done** |
| **O08** Hardening: SEC-01--03, SCL-01--03, DR-01, DOC-01 | -- | -- | **done** |

**O08 is the hardening sprint, and it is finished.** The proposal's
non-functional commitments belong to no feature, which is how they stay nobody's
until launch. What each one is now:

| Task | What exists |
| --- | --- |
| **SEC-01** tenant isolation | Per-sprint cross-tenant and RLS assertions, in the gate |
| **SEC-02** authorization matrix | `tests/e2e/o08-authorization-matrix.e2e.ts` -- every route asserted for every role. It found three real problems on its first run |
| **SEC-03** WCAG 2.2 AA | `tests/e2e/o06-accessibility.e2e.ts` plus an axe-core sweep in the browser suite |
| **SCL-01** queues | `queue.service.ts` -- `FOR UPDATE SKIP LOCKED`, bounded retries, a terminal failed state |
| **SCL-02** load to 1,000 | `tools/onyx/load-test.mjs`. **Measured: 1,000 concurrent learners, 373 req/s, zero errors**, writes p95 290ms. Numbers and caveats in [the runbook](docs/RUNBOOK.md) |
| **SCL-03** observability | `/metrics` in Prometheus format, a `/health` that reaches the database and answers 503 when it cannot, and counters on grading, proctoring, payments and notifications. Alert expressions in the runbook |
| **DR-01** backups | `tools/db/backup.mjs` -- per-tenant export, `--verify`, `--restore --into` |
| **DOC-01** documentation | [`docs/`](docs/README.md) -- administrator's guide, UAT scripts, runbook, and a generated API reference the gate checks |

**Onyx Learn is six requirements, not four.** O02 delivered LRN-01 to LRN-04;
O06 added **LRN-05** (progress and nudges, derived at read time -- there is no
nudge table) and **LRN-06** (discussion threads and doubt tickets).

**The seven requirements that were partial are finished.** An audit against the
proposal found every pillar shipped and seven requirements complete in the API
and incomplete in the product. Each is now closed:

| Was | Now |
| --- | --- |
| **LRN-03** QR check-in refused codes still on the projector | Judged against the request's arrival time, with RFC 6238 one-step tolerance and a 15s default window |
| **LRN-03c** analytics and export were API-only | `/onyx/courses/[id]/attendance` — per-learner percentages, shortfall flags, CSV |
| **ASS-02** camera and screen were never captured | `onyx-proctor.tsx` holds both, raises the four events that could not fire, and uploads no media |
| **ASS-04b** CSV only | `results.pdf`, from a zero-dependency PDF writer (`format/pdf.ts`) |
| **CMP-02b** seating was an on-screen table | `seating.pdf` — the plan and an attendance sheet with a signature column |
| **CMP-01a** faculty allocation had no screen | `/onyx/allocations` — allocate teaching, and the load per person per term |
| **CMP-03b** invoices could not be paid | Checkout, webhook and a Pay control, on the port's nine-gateway engine with per-tenant credentials |
| **CAR-03** certificates could not be issued | `/onyx/certificates` — issue, register, revoke with a reason |
| **LAB-02** no sandbox to point at | `deploy/judge0/` plus `verify-sandbox.mjs`, which submits a fork bomb and refuses to certify a host that does not stop it |

**Every requirement is reachable from a browser, not only from the API.** That
is a separate claim from "the endpoint exists", and it is the one that keeps
slipping: an exam could be scheduled with no way to seat it, a fee structure
had no screen, a question bank could not be filled. `tests/browser/
e2e-authoring.spec.ts` proves the create side and `e2e-downstream.spec.ts`
proves what follows it -- seat, mark, moderate, publish, transcribe; structure,
invoice; bank, questions, paper; test cases; employer, post, apply, shortlist --
each through the real UI and then checked in the database.

## Three schema inconsistencies preserved

The original schema is inconsistent in ways that matter, and the port keeps the
column types while handling them explicitly:

| Column | Type | Sibling |
| --- | --- | --- |
| `sections.sort` | varchar | `lessons.sort` is integer |
| `forums.likes` / `dislikes` | text holding a **JSON array of user ids** | not a counter |
| `instructor_reviews.rating` | varchar | `reviews.rating` is integer |

The forum one is the important one: storing voter ids is what makes a like
one-per-person. A counter would let a single account click forever.
## Verification

```bash
npm run verify:all      # everything below, in order

npm run verify:parity   # generated SQL vs the Laravel schema
npm test                # unit tests, no database needed
npm run typecheck       # packages, api AND the web app -- see below
npm run docs:check      # the generated API reference is current
npm run db:audit        # live types, RLS, sequences, seed, storage
npm run e2e             # 314 tests against a running api + web + Supabase
npm run browser         # 92 tests in real Chromium against the same servers
npm run db:backup       # per-tenant export, --verify, --restore --into <slug>
python tools/grading-differential.py        # quiz scoring vs the PHP algorithm
```

**If the database looks unreachable**, it is probably the network, not Supabase.
`db.<ref>.supabase.co` is **IPv6-only** on projects created after early 2024, so
on an IPv4-only network every direct-connection tool fails with `ENOTFOUND`
while the REST API keeps working. `tools/db/connect.mjs` detects that and falls
back to the regional session pooler (`aws-N-<region>.pooler.supabase.com`, IPv4)
automatically, printing which route it took. Set `SUPABASE_POOLER_URL` to skip
the probe, or `SUPABASE_REGION` if the project is not in ap-northeast-1.

The end-to-end suite boots both servers, waits for health, runs, and tears them
down. It talks to the real database on purpose: the in-memory fake used by unit
tests enforces no column widths, constraints or RLS, so anything
schema-sensitive only surfaces here. That is how the `session_id varchar(255)`
overflow in the payment layer was caught.

## The course player

The 5-second ping keeps `watch_durations.watched_counter` as a JSON array of
tick markers, byte-identical to what Laravel writes (ADR-003). Ticks are
de-duplicated, so seeking back and re-watching cannot inflate progress.

Drip gating reproduces `get_locked_lesson_ids()` exactly, including the part
that surprises people: the lesson that unlocks is the one after the **last
entry** in `completed_lesson`, not the furthest lesson reached. Complete lesson
5 then lesson 2, and lesson 3 unlocks -- not lesson 6.

Completion at 100% mints the certificate from inside the player, the same
trigger Laravel used, and is idempotent: finishing repeatedly yields one
certificate.
## Gateways

Nine of the ten Laravel gateways are implemented:

| Gateway | Confirmation | Webhook signature |
| --- | --- | --- |
| Stripe | session lookup | HMAC-SHA256 + timestamp window |
| PayPal | capture on return | (capture is authoritative) |
| Razorpay | order lookup + `order_id\|payment_id` HMAC | HMAC-SHA256 |
| Paystack | transaction verify | HMAC-**SHA512** of the raw body |
| Flutterwave | transaction verify | `verif-hash` compared verbatim |
| SSLCommerz | `val_id` validation call | - |
| Doku | webhook only | digest + canonical-block HMAC |
| Aamarpay | trxcheck lookup | - |
| MaxiCash | echoed reference + status | - |
| **Paytm** | **not implemented** | the Laravel version is entirely commented out, so there is no working reference to port |

**Offline / bank transfer** runs the same fulfilment path as a card payment, so
revenue split, invoicing and enrolment cannot drift between the two routes.
Prices are re-read at acceptance rather than trusted from the snapshot taken
when the student submitted.

Webhook status codes drive the gateway retry loop deliberately:
`400` bad signature (never retry), `500` our fulfilment failed (do retry),
`200` handled or deliberately ignored.

## Screens

```
public      /  /courses  /course/[slug]  /compare  /instructors  /instructors/[id]
            /bootcamps  /bootcamp/[slug]  /team-packages  /team-package/[slug]
            /tutors  /tutors/[id]
            /blogs  /blog/[slug]  /knowledge-base
            /knowledge-base/topics/[id]  /knowledge-base/articles/[id]
            /about-us  /contact-us  /faq  + 4 policy pages
auth        /login  /register  /forgot-password  /reset-password  /verify-email
student     /my-courses  /my-profile  /cart  /wishlist  /purchase-history
            /checkout/success  /invoice/[invoice]  /messages
            /play-course/[slug]  /live-class/[id]
            /my-bootcamps  /my-bootcamps/[slug]  /bootcamp-class/[id]
            /my-team-packages  /my-team-packages/[id]
            /my-bookings  /tuition/[id]  /dashboard  /become-instructor
instructor  /instructor/dashboard  /instructor/courses  /instructor/courses/[id]
            /instructor/blogs  /instructor/bootcamps  /instructor/team-packages
            /instructor/tutoring  /instructor/payouts
admin       /admin/dashboard  /admin/users  /admin/courses  /admin/approvals
            /admin/enrollments  /admin/coupons  /admin/blogs
            /admin/knowledge-base  /admin/testimonials  /admin/messages
            /admin/contacts  /admin/live-class-settings  /admin/bootcamps
            /admin/team-packages  /admin/tutoring  /admin/revenue  /admin/payouts
            /admin/settings  /admin/languages  /admin/languages/[id]
            /admin/newsletters  /admin/applications

  Onyx     /onyx/login  /onyx/signup  /onyx/dashboard  /onyx/people
            /onyx/audit  /onyx/denied  /onyx/courses  /onyx/courses/[id]
            /onyx/courses/[id]/lessons/[lessonId]
            /onyx/courses/[id]/attendance/[sessionId]
            /onyx/assignments/[id]  /onyx/submissions/[id]  /onyx/programs
            /onyx/practice  /onyx/practice/[id]
            /onyx/workspaces  /onyx/workspaces/[id]
            /onyx/assessments  /onyx/assessments/[id]
            /onyx/assessments/[id]/marking  /onyx/assessments/[id]/results
            /onyx/attempts/[id]  /onyx/attempts/[id]/mark
            /onyx/attempts/[id]/integrity  /onyx/invigilate
            /onyx/profile  /onyx/jobs  /onyx/jobs/[id]  /onyx/placement
            /onyx/drives/[id]  /onyx/contests  /onyx/contests/[id]
            /onyx/interviews  /onyx/interviews/[id]
            /onyx/verify/[credentialId]        <-- public, no session
```

125 routes. Everything server-rendered; the catalog and blog pages carry full
metadata, and blog posts resolve `seo_fields` before falling back to the post.
The two message screens opt out of caching entirely -- a conversation must never
be served from a cache shared between users.

## How authentication works in the browser

The API sets its cookie on the API origin, which the browser will not send to
the web origin. So the web app proxies auth through its own route handlers
(`/api/auth/[action]`) and stores the token in a cookie **it** owns, marked
`httpOnly`. Page scripts can never read it.

Onyx does the same with its own cookie, `onyx_tenant_session`. Two products
share this origin, so the cookies are deliberately distinct and the shared proxy
picks one by path: an Onyx token is never offered to a port route, nor the
reverse. The root layout also renders the storefront header and footer only
outside `/onyx` -- an institutional platform must not wear the port's branding.

Client components that need authenticated calls go through
`/api/proxy/[...path]`, which attaches the bearer token server-side. The token
is stripped from every login response body before it reaches the browser.

Role gates live in `requireRole()`: a student hitting `/admin/*` is redirected
to `/denied`, an anonymous visitor to `/login`. The server-side guard is the
real one -- the API re-checks the JWT on every request regardless.
## The quiz grading engine

Q-04 is the highest-risk port in the project: a scoring difference silently
changes student outcomes. It is verified by a **differential test** --
the PHP algorithm is transcribed into `tools/grading-differential.py` and
2,000 generated submissions are scored by both implementations and compared.

```bash
python tools/grading-differential.py 2000
# DIFFERENTIAL PASS: the TypeScript engine scores identically to the PHP algorithm
```

Rules preserved verbatim, including the counter-intuitive ones:

- `retake = 0` allows **one** attempt (Laravel compares `submissions > retake`).
- `pass_mark` is measured in **marks, not correct answers**:
  `correct * (total_mark / question_count) >= pass_mark`.
- `true_false` answers are stored **raw**, not JSON-encoded, unlike every other type.
- An unrecognised question type scores **wrong**, never skipped.

## Six tables added beyond the 61

Each one has a Laravel model and controllers that write to it, but **no Laravel
migration ever creates it** -- so the feature throws "table not found" in the
source application. Each was added by explicit decision. The 61 ported tables
are untouched and still audit at 580/580 columns.

| Table | Migration | Broken in the original |
| --- | --- | --- |
| `quiz_submissions` | `0004` | `student/QuizController.php` inserts on every submit |
| `blog_comments` | `0005` | `student/BlogCommentController.php` |
| `blog_likes` | `0005` | `BlogController.php` like handling |
| `user_reviews` | `0006` | `SettingController::user_review_stor()` (admin testimonials) |
| `bootcamp_resources` | `0008` | `Admin\BootcampResourceController` on every upload |
| `applications` | `0009` | `student/BecomeInstructorController` on every submission |

## Running the whole thing

```bash
npm install
cp .env.example .env          # fill in Supabase keys
npm run db:migrate            # schema + indexes + seed + RLS
npm run db:verify             # live schema vs Laravel, column by column

npm run dev:api               # Fastify on :4000
npm run dev:web               # Next.js on :5173
```

The web app talks to the API through `API_URL` (see `apps/web/.env.local`).
Catalog pages are server-rendered so metadata and structured data ship in the
HTML -- the entire reason the SEO-fields module (C-05) exists.

## Importing real Laravel data

```bash
node tools/db/import-laravel.mjs                     # users, categories, courses, sections, lessons...
node tools/db/import-laravel.mjs courses lessons     # or specific tables
```

Ids are preserved so every stored reference keeps resolving, and identity
sequences are re-synced afterwards. The importer **refuses to run against
non-empty tables** unless you pass `--merge`: `ON CONFLICT DO NOTHING` would
otherwise skip any row whose id is taken and report success, which is data loss
wearing a green tick.
## Database operations

```bash
npm run db:migrate        # apply schema + indexes + seed + RLS (refuses a non-empty public schema)
npm run db:reset          # drop OUR 61 tables, then re-apply from scratch
npm run db:verify         # compare the LIVE schema against Laravel, column by column
npm run db:verify-rls     # prove anon cannot write and cannot read secrets
npm run db:reload-cache   # NOTIFY pgrst -- run after any DDL applied over a direct connection
```

Order matters in `db:migrate`: **seed runs before RLS**, because `0003_rls.sql`
enables `FORCE ROW LEVEL SECURITY`, which subjects even the table owner to the
deny-all baseline.

After applying DDL over a direct Postgres connection, PostgREST keeps serving a
stale schema cache and every request fails with
`Could not find the table ... in the schema cache`. Run `db:reload-cache`.

## Bootstrapping the first admin

The Laravel seed never contained users, so neither does ours. Register the first
account, then promote it once:

```sql
update public.users set role='admin' where email='you@example.com';
```

Root-admin identity is the LOWEST user id (see `PermissionsService`), so that
account permanently bypasses the sub-admin permission checks.

## Quick start

```bash
npm install
npm run verify:parity     # proves the schema matches Laravel, table for table
npm test                  # 41 tests, no database required
cp .env.example .env      # then fill in your Supabase keys
npm run dev:api
curl localhost:4000/health
```

## Layout

```
supabase/migrations/   0001_schema.sql   61 tables, generated, do not hand-edit
                       0002_indexes.sql  75 indexes ported 1:1
                       0003_rls.sql      deny-all baseline + onyx.* claim helpers
                       0004..0006        the four added tables (see above)
                       0007_...          messaging RLS + Realtime publication
                       0008_...          bootcamp_resources (see above)
                       0009_...          applications (see above)
supabase/seed.sql      settings, 4 languages, 404 phrases, categories
tools/                 generators + the parity verifier
packages/types/        generated Database types + Zod schemas for JSON columns
packages/core/         settings, i18n, storage, auth, http conventions
apps/api/              Fastify API
docs/                  ADRs -- read ADR-001 before touching auth
```

## Regenerating the schema

The Laravel database is the source of truth. Nothing under
`supabase/migrations/` is edited by hand.

```bash
npm run gen:all        # schema + indexes + RLS + seed + types
npm run verify:parity  # must print PASS
```

## Three things that will bite you if you skip the ADRs

1. **Supabase Auth is not used.** `auth.uid()` throws against our bigint ids, and
   the app role travels in `app_role`, never `role`. See [ADR-001](docs/ADR-001-auth.md).
2. **Never `JSON.stringify` a JSON-as-text column.** PHP escapes solidus and
   non-ASCII; use `phpJsonEncode`. See [ADR-002](docs/ADR-002-schema-parity.md).
3. **`tinyint(1)` is `smallint`, not `boolean`.** The app compares to `0`/`1`.

## Dependency policy

Runtime is Node + Supabase. Nothing else is required.

`@supabase/supabase-js` is now a dependency of the web app as well as the API:
S12 subscribes to Supabase Realtime in the browser. It is the same Supabase
client already in use, not a new vendor.

`@monaco-editor/react` arrived with O03 (LAB-01). It loads Monaco from a CDN,
which an institution's network may block, so the editor renders a plain
textarea first and upgrades only if Monaco arrives -- losing highlighting is an
inconvenience, losing the ability to type code would make Code Lab unusable.

| Optional | Used for | Needed? |
| --- | --- | --- |
| `REDIS_URL` | shared settings cache | No -- in-process cache is the default |
| `ONYX_JUDGE0_URL` | Code Lab sandbox | **Yes, to run code.** Everything else in Code Lab works without it |
| `SENTRY_DSN` | error reporting | No -- stdout logging works |
| Vercel / Fly.io | hosting | No -- any Node host or container |

Third-party APIs arrive with the features that need them (Judge0 for the code
IDE, Zoom, OpenAI, the payment providers). They are already called by the Laravel
app today, so nothing new enters the system.

## O05: claims made to strangers

Career is the first sprint where the platform says something about a person to
somebody outside the institution, and that changes what has to be true.

**A credential id is a capability, not a serial number.** The verification page
takes no token at all -- the employer checking it has no account here and never
will -- so the id is 32 random hex characters and the response carries the
holder's name, what it was for, who issued it, and nothing else. `detail` is
filtered through an allow-list, so a caller passing `{ email }` publishes
nothing. A revoked credential says *revoked* rather than *not found*: somebody
is holding it and is entitled to know which.

**A sixth role.** `employer` is an outsider with an account, scoped to their own
company by `assertEmployerOwns` on every route they can reach. They do not get
the roster, a cohort, or another employer's pipeline. They *do* get the names of
people who applied to their post -- applying is sharing that -- and those names
come with the applicants rather than from the roster endpoint, which stays shut.

**Eligibility is computed, never typed.** A post carries thresholds; whether
somebody meets them is worked out from their own record, and every rule comes
back with what was required and what they have, whether it passed or not. A
learner who cannot apply is told exactly what is missing instead of being shown
a greyed-out button.

**The readiness formula is published.** Five weighted components summing to 100,
stored *with* each score so an old one still makes sense after the weights
change, and returned with the counts behind every component. A score nobody can
explain is a score nobody should act on.

**A skill is one row per piece of evidence**, and the level is the mean rather
than the best: one excellent piece of work does not make somebody good at
something, and a passport that claims otherwise is a claim an employer will
check.

**The leaderboard is computed from submissions every time.** A running total on
the team row is one increment away from a lost update, and this is the screen
everybody watches. Ties break on penalty, then last solve, then team id -- total,
so the same data always gives the same board. Wrong attempts on a problem never
solved cost nothing; penalising them would punish trying.

**A drive reports whether it reconciles rather than pretending it does.** Cleared
the last round but no offer, or offered without clearing, are both named. Neither
is necessarily wrong, and the platform's job is to make it a decision rather than
a surprise.

Two bugs the cross-tenant test caught, and one gap. `onyx_readiness_scores` was
keyed `UNIQUE (user_id)` -- wrong for the same reason everything else is keyed by
tenant, since a person can be a candidate at two institutions; fixed in migration
`0006`. `profile()` did not check the subject was a member, so an administrator
could compute *and store* a score for anybody in the platform. And the employer's
applicant list showed "User 387", because listing the roster is correctly
forbidden -- the names now travel with the applications.

## O04: assessment, where being wrong is expensive

A score decides something, so four rules shape everything in Assess.

**A sat paper is immutable.** Selection happens once, at start, and the
questions are snapshotted into the attempt. Editing a question afterwards writes
a **new version** -- `onyx_question_versions` keeps every version that has ever
existed -- and grading reads the key from the version that was actually sat.
Keeping only a version *number* on the attempt would prove nothing; the content
has to survive too. Both the end-to-end and unit tests edit a question after an
answer is given and assert the paper, the key and the mark are all unchanged.

**Time is the server's.** `started_at`, `expires_at` and `submitted_at` are all
written server-side, and `seconds_remaining` is computed there on every request.
The browser counts down locally so it does not need a request per second, but
corrects itself from the server on every save and every thirty seconds. A save
past the deadline is refused and the attempt is expired on the spot. The
end-to-end test sits a one-minute paper, waits, and asserts the answer is
refused and the attempt expired.

**A grade is a record of who decided what.** First marking, second marking and
moderation are three rows, not one column. Moderation beats a second mark, which
beats the first -- and because they are separate rows, "the moderator changed
it" can be answered a year later. Where an assessment requires moderation,
publishing is refused until every paper has it: a second opinion that can be
skipped is not a moderation workflow.

**Anonymous marking removes the candidate, it does not hide them.** The marking
queue and the paper carry no `user_id` at all when the assessment says so, and
the test asserts against the wire rather than the screen. Objective questions
arrive already scored and are not editable: they were marked against the key as
it stood, and letting a marker nudge them would make marks irreproducible.

**Proctoring records events, not a video archive.** Tab focus, paste, copy,
camera state, full-screen exit -- each timestamped by the server, with the
client's own claimed time kept alongside so a divergence is itself visible.
Consent is per attempt and taken before the paper is dealt. Nothing auto-fails
anybody: flags are weighted, an attempt over the threshold goes to a queue, and
an invigilator decides. Dismissing a flag lowers the score; a decision a person
has already taken is never overwritten by arithmetic. Storing hours of footage
of somebody's home is a decision the proposal does not ask for and this does not
make.

**The statistics are the classical ones**, because an exams office can already
read them and because both are checkable by hand: facility (proportion correct)
and the upper/lower-27% discrimination index. A negative discrimination is
flagged as a probably-wrong key rather than a hard question, an item everybody
or nobody got right is flagged as having measured nothing, and a cohort too
small to split reports `null` instead of a number that looks like a finding.

Two bugs the tests caught, both the same shape as O03's: `/banks/:id/questions`
and `/assessments/:id/items` answered 200 with an empty list for another
institution's id. Nothing leaked, but an empty list confirms the id is real --
"no data leaked" is not the same as "nothing was learned". Both now load the
parent row first and 404.

## O03: the queue, and the code that must not run here

Code Lab is where two things arrive that nothing before it needed: a place to
run untrusted code, and a queue.

**Nothing in this repository executes learner code.** `ExecutionProvider` is a
contract; `Judge0Provider` adapts one sandbox to it; `UnconfiguredProvider`
refuses. There is deliberately no local fallback, because running learner code
in the API process means a fork bomb takes down the institution, an infinite
loop pins a core, and `fetch` reaches whatever the API can reach -- including
the database. `enable_network: false` is on every submission and there is no
caller-facing way to turn it on, and all four limits (CPU, wall-clock, memory,
processes) are sent explicitly rather than left to the server's defaults: a
misconfigured Judge0 with generous defaults looks exactly like a working one
until somebody submits a fork bomb.

**The queue is Postgres, not Redis.** The guarantee that matters is durability,
and a row that survives a restart is worth more than one that is fast. It also
means no new infrastructure, which is the difference between a queue that exists
and a queue that is planned. Claiming is one statement:

```sql
UPDATE onyx_jobs SET status='running', attempts=attempts+1
 WHERE id IN (SELECT id FROM onyx_jobs
               WHERE status='queued' AND run_after <= now()
               ORDER BY id FOR UPDATE SKIP LOCKED LIMIT $1)
RETURNING ...
```

`SKIP LOCKED` is what makes "none are double-graded" true under concurrency
rather than merely likely: two workers racing for the same row cannot both win,
because the second does not wait for the lock. The end-to-end test puts 200 jobs
through eight concurrent workers against the real database and asserts every one
ends `done` with `attempts = 1` -- claimed exactly once. A worker killed
mid-job leaves a row at `running` that `requeueStale()` sweeps back; a job that
keeps failing retries with backoff and then stops at `failed` **with its error
kept**, because a queue that empties itself on failure looks healthy while
losing work.

**A hidden test case is the answer key.** Its input, its expected output, and
the actual output a submission produced for it all give the answer away, so none
of the three ever appears in a learner-facing response -- and the actual output
of a hidden case is not even stored. This is enforced in the service rather than
the route, so a route added later cannot forget. Two tests check it against the
wire: one on the API response, one on the rendered page *including* the RSC
payload, which is where "pass the whole problem down as props" would put it.

**A snapshot is one immutable document.** LAB-05's acceptance criterion is that
restoring gives back the tree that was captured, so the snapshot is jsonb rather
than a copy of the file rows -- rows can be edited afterwards, and a snapshot
that drifts is worse than none because it is trusted. Restore deletes files
added since; a restore that only overwrote would be a merge.

**A mentor comments; a mentor does not edit.** Not even an admin writes to
someone else's workspace. A project with no course attached is private outright.

Two bugs the tests caught. The pool built itself on the IPv6-only direct host
and swapped in a pooler-backed replacement on first failure -- leaving every
caller holding a pool that had been ended, and their queries hung; the host is
now resolved once, before any pool exists. And `/problems/:id/attempts` answered
200 with an empty list for another institution's problem id, which leaks nothing
but confirms the id is real -- "no data leaked" is not the same as "nothing was
learned".

**The sandbox now runs in the gate.** `tools/judge0-stub.mjs` speaks the Judge0
protocol -- submit, poll, statuses, base64 bodies -- so `o03-sandbox.e2e.ts`
drives submit to score through the real queue, the real worker and the real HTTP
adapter rather than a fake `fetch`. It also records every request body, which is
how the suite asserts the things that would otherwise only be true by intention:
that no submission is sent with `enable_network` true, that a CPU limit is
always set, and that the wall limit exceeds it, so a program blocked on input is
killed rather than left running.

What that still does not prove is **isolation**. The stub honours the flags; a
real container is what enforces them. Whether a submission can reach the network
or escape its cgroup is a property of the deployed Judge0, and is a deployment
check against a real endpoint, not something any test in this repository can
answer.

## O02: the everyday learning loop

Onyx Learn is four requirements that only work as one flow, so the decisions
that matter are the ones where two of them meet.

**A course is not a product.** It sits in a semester of a programme, and a
learner usually reaches it by belonging to a batch rather than by choosing it.
Bulk enrolment is therefore the normal path and self-enrolment the exception --
`self_enroll` is off by default and a course starts unpublished, because an
empty course visible to a cohort is worse than no course at all.

**"Faculty" means faculty of this course.** `assertCanTeach` is on every
course-scoped route. Without it the role would be a tenant-wide key to every
roster, grade and attendance record in the institution. Admins are exempt;
nobody else is.

**Locked content keeps its title and loses its source.** A learner who is not
enrolled sees the shape of a course -- that is what a catalog is -- and preview
lessons play. Everything else returns `path: null`, and the page does not render
a link it would refuse on click.

**Progress only moves forward.** Scrubbing back to check something and closing
the tab must not cost the twenty minutes already watched, and completion is
sticky, because rewatching has not un-finished anything.

**The QR code is derived, never stored.** It is an HMAC of a per-session secret
and the current 30-second window, so a leaked database yields no codes, and a
photograph of the projector is worthless half a minute later. Only the current
window is accepted -- a grace window would double the useful life of that
photograph for no real benefit. The endpoint takes no learner id at all, so
"a learner cannot mark another learner" is structural rather than checked. It is
a deterrent with a 30-second half-life, not proof of presence, and it should not
be described as more than that.

**Attendance arithmetic, stated once.** Present and late count as attended;
excused leaves the denominator; **a session with no record counts as absent**.
That last clause is the one that matters -- treating unmarked as "no data" makes
every percentage flattering and a shortfall report that never flags anyone.

**A rubric must add up to the assignment total**, checked when it is saved and
again at publish, and frozen once published: changing the weights under work
already submitted regrades it silently. When a rubric exists the score is its
sum, never a number typed alongside it, because two numbers meant to agree
eventually will not.

**Grading and returning are separate acts.** A cohort is marked over a week and
released at once, so a graded-but-unreturned submission looks to the learner
exactly like a submitted one -- not "graded, score hidden", which would tell
them their mark exists and start the conversation early.

**Autosave saves, and never submits.** The draft is a real row in the table the
submission will become, plus a `localStorage` copy written on every keystroke
that covers the five seconds between server saves. The newer of the two wins on
return, and the page says so rather than silently replacing what they last saw.

Two bugs the tests caught. `enrollBatch` compared the batch against the *active*
roster, so a previously withdrawn learner looked absent and was inserted again --
which against the real database violates the unique constraint and fails the
entire batch; it now restores them. And content was gated on `role === 'student'`,
which quietly let `exams` and `placement` read every lesson in the institution;
the check now names the two staff roles instead of guessing at the rest.

## O01: one institution can never see another

Onyx's promise is not schema parity, it is isolation. That is a security
property, so it is enforced in three places and tested against the real
database rather than a fake.

**The claim, not the request.** Every Onyx token carries `tenant_id`. Routes
take the tenant from the token and never from a path or body -- there is no
parameter to tamper with. A token without a usable `tenant_id` is refused
outright (401) rather than treated as "no tenant yet": defaulting a missing
tenant is exactly how a request ends up reading the wrong institution.

**The database, not just the API.** `onyx.current_tenant_id()` reads the same
claim inside every RLS policy. The one that matters most is on `onyx_users`:
identities are shared across institutions, so a person is visible only through
a membership of the caller's tenant. Without that join, one institution could
enumerate another's people out of a table they both legitimately use.
`onyx_audit_logs` has RLS and deliberately **no** select policy -- it records
who changed a grade, so it is served through the API to admins only.

**A guard, not a habit.** `onyx.assert_tenant_scoped()` fails the migration
runner and the gate if any `onyx_` table lacks `tenant_id`. The rule is easy to
state and easy to forget on the fortieth table.

Roles live on `memberships`, not on `users`, so the same person can be faculty
at one institution and a student at another -- which is also the case where a
leak would be easiest, and so it is the case the tests use.

Two smaller decisions worth naming:

- **The last administrator cannot demote or remove themselves.** An institution
  with no admin cannot be recovered from inside it.
- **A member id from another institution is a 404, not a 403.** Whether that id
  exists is not the caller's business.

Two bugs the tests caught. `recordSystem` wrote `actor_id: 0` for
tenant-creation entries; `actor_id` is a foreign key to a real person, so every
one of those entries failed the constraint and was dropped -- silently, because
an audit write must never throw and undo the change it describes. It now writes
`null`. And a duplicate slug returned 500 when two signups raced past the
existence check; the unique violation now reads as the same 422 the check gives.

## S18: settings with a declared surface, and secrets that stay server-side

The Laravel settings controller wrote **whatever the form posted**, so a typo in
a field name quietly created a setting nobody reads and the real one never
changed. The keys are declared here, grouped by screen, and anything else is a
422 naming the offending key. A unit test also asserts no key appears on two
screens, because two screens saving the same key would fight each other.

**Secrets are write-only.** `smtp_pass`, the Zoom and OpenAI credentials, the
reCAPTCHA secret and every gateway key that looks like a secret are never
returned by a read — the screen shows "Set"/"Not set", and submitting the field
blank leaves the stored value alone. Only a deliberate non-blank value overwrites
one. The old screens rendered `smtp_pass` straight into the form's `value`.

**`users.paymentkeys` has a sibling problem in SET-09:**
`student/BecomeInstructorController` inserts into an `applications` table that no
migration creates. Added as migration `0009` with your agreement — the sixth of
these. Approving an application now promotes the applicant to instructor for
real, and a *rejected* applicant may apply again, which the original refused
forever because it checked only for the existence of a row.

Two smaller ones: sending a newsletter looped and stopped at the first failure,
so one bad address abandoned the rest of the list — sending is batched here and
reports sent/failed counts; and adding a language used to leave the phrase editor
empty, so a new language now starts with a copy of every known phrase.

## S17: revenue that reconciles, and payout details with nowhere to live

Money arrives in four different tables, each with its own `instructor_revenue`
and `admin_revenue`: `payment_histories` (courses), `bootcamp_purchases`,
`team_package_purchases` and `tutor_bookings`. Every report sums all four and
asserts that instructor + platform equals gross.

**`users.paymentkeys` does not exist.** `PayoutSettingsController` ends with

```php
User::where('id', auth()->user()->id)->update(['paymentkeys' => $data]);
```

but `users` has 21 columns and that is not one of them, so saving payout details
fails outright. Meanwhile `payouts` already carries `payment_method` and
`payment_details`, which the request flow never filled in. The details are
captured **per payout request** here — no schema change, and more correct
anyway, since bank details can change between payouts.

Two more, both tested:

- `Payout::insert()` skips Eloquent timestamps, so `created_at` was **NULL** —
  and the instructor's own history list filters on `created_at`, so a request
  disappeared the moment it was submitted. Timestamps are written now.
- A pending request was not subtracted from the balance on screen, so the same
  money looked available twice. The balance now reports `pending` and
  `requestable` separately.

## S16: tutor booking, and a guard that never fired

`tution_started()` decides whether a tuition session can be joined. It ends:

```php
$booking = TutorBooking::where('id', $booking_id)
    ->whereNotNull('joining_data')
    ->where('start_time', '<', $extended_time)
    ->where('end_time', '>', $current_time)
    ->firstOrNew();
return $booking ? true : null;
```

`firstOrNew()` returns a **new, unsaved model** when nothing matches, so the
expression is truthy for every input — including a booking id that does not
exist. The window was never enforced anywhere the helper was used. It is a real
check here, and the end-to-end test books a session two days out and asserts the
403.

**The student was handed the host URL.** `join_class()` ended with
`redirect($meeting_info['start_url'])` — Zoom's `start_url` signs the holder in
as the **host**, so a student could start and control the session. The tutor
hosts and the student joins as a participant here, decided from the booking, and
the toolbar difference is asserted both in unit tests and end to end.

Two smaller ones: a booked slot stayed in the public availability list, so two
students could buy the same hour (the booking now claims the slot via
`booking_id`); and `tutor_schedules.price` was left null by the schedule form,
with the price read from the can-teach row at checkout — meaning a tutor raising
their rate silently repriced slots students were already looking at. The price is
copied onto the slot when it is created.

Sessions run on Jitsi, so tutor booking works with no Zoom account at all.

## S15: classrooms, and two bugs that cost customers money

A classroom package buys a block of seats on one course. Two things in the
original were wrong in ways a buyer would feel, and neither is carried over.

**Seats were shared between unrelated buyers.** `reserved_team_members($id)`
counts every row in `team_package_members` for the package with **no leader
filter**, and the controller compares that against `allocation`. Two customers
who buy the same 5-seat package therefore share one pool of five: the second
buyer can be locked out of seats they paid for. Seats are counted per leader
here, which is what buying a package is supposed to give you.

**Removing a member destroyed enrolments they had bought.** The original ran

```php
Enrollment::where('course_id', $package->course_id)->where('user_id', $user->id)->delete();
```

with no filter on where the enrolment came from. If the member had also bought
that course themselves, taking them out of the classroom deleted the access they
paid for. Only the enrolment this package granted
(`enrollment_type = 'team_package'`) is withdrawn here.

Two smaller ones, both now validated for real: `required_if:is_paid,1` never
fired because the field is called `pricing_type`, so a paid package could be
saved with **no price**; and `allocation` was validated `min:0`, which creates a
classroom nobody can ever be added to.

One type note: `team_training_packages.expiry_date` is a **unix integer** while
`enrollments.expiry_date` is a **datetime**. Laravel wrote the raw integer
straight into the datetime column — SQLite tolerated it, Postgres will not — so
the conversion happens on the way in, and an existing enrolment is only ever
extended, never shortened.

## S14: workshops, and one column with two meanings

`discounted_price` means **the final price** on a course and **the amount taken
off** on a workshop. Both readings are in `Admin/OfflinePaymentController.php`,
fifty lines apart:

```php
// line 91  (course)   -> discounted_price IS the price
$amount = $course->discount_flag == 1 ? $course->discounted_price : $course->price;
// line 144 (bootcamp) -> discounted_price is subtracted
$price  = $bootcamp->discount_flag == 1 ? $bootcamp->price - $bootcamp->discounted_price : $bootcamp->price;
```

Both are preserved. Reading the workshop column the course way would charge 25
instead of 75 on a 100-with-25-off workshop, which is what the unit test pins.

Two other things worth knowing:

- **`status` and `pending` are separate axes.** status is published or not;
  pending is awaiting approval. An admin's workshop is published and not
  pending; an instructor's is neither published nor approved until an admin
  says so.
- **Duplicate now deep-copies.** Laravel copied only the workshop row, so the
  clone had no modules, sessions or resources at all. Modules, their live
  classes and their resources are copied here, and the copy is unpublished.

Deleting a workshop cascades through modules to sessions and resources, porting
`remove_module_data()` / `remove_live_class_data()` / `remove_resource_data()`.
There are no foreign keys, so the cascade is application code.

## S13: live classes, and the secret that was in the page

The Zoom Meeting SDK secret was rendered into every class page and passed to
`ZoomMtg.generateSDKSignature()` in the browser — it was `console.log`ged too.
Anyone who opened a class could read it and afterwards sign themselves in as
host of any meeting on the account. Signing happens on the server here and the
secret never leaves it; the host role is read from the database and baked into
the signature, so nothing the client sends can change it.

Two more things fixed rather than copied, both covered by tests:

- the Jitsi view made **every account with role `instructor` a moderator in
  every course's room**, taught or not. Host now means the course owner, a
  listed co-instructor, or an admin.
- Jitsi rooms were named `lms-<slug>-class-<id>`, both parts public, so a room
  on the public `meet.jit.si` instance was guessable from the course page. A
  random code is generated per class and appended.

[`docs/ADR-005-live-classes.md`](docs/ADR-005-live-classes.md) has the detail,
including the derived join window (`live_classes` has no end time, so
`class_started()` could not be applied directly).

**Zoom is implemented but unverified against the live API** — this deployment has
no Zoom credentials. `ZoomService` takes an injectable `fetch` and the unit tests
pin the exact URL, method, headers and body of every call, plus the signature's
claims. The end-to-end test covers the no-credentials path: a clear 422 with
nothing written. Jitsi needs no account and is exercised end to end.

## S12: messaging, and which of three implementations was ported

The Laravel source carries **three** generations of the messaging feature, and
they disagree about the column names. Only one can execute against the shipped
schema. [`docs/ADR-004-messaging.md`](docs/ADR-004-messaging.md) has the detail;
the short version:

| Generation | Where | State |
| --- | --- | --- |
| `chats` / `message_thrades` | `ChatController` + `routes/chat.php` | tables do not exist; `Message_thrade.php` is not in the repo, so the file fatals |
| `message_thread_code` / `sender` / `read_status` | `frontend/Chatcontroller`, `count_unread_message_of_thread()`, `searchThreads()` | columns do not exist; every call throws |
| `thread_id` / `sender_id` / `receiver_id` / `read` | `student/MessageController`, most of `Admin\MessageController` | **this is what runs, and what was ported** |

Delivery is a Supabase Realtime subscription rather than the original AJAX
polling. That needs a token in browser JavaScript, which the httpOnly session
cookie deliberately is not, so `/api/messages/realtime-token` mints a **separate
five-minute token carrying `scope: 'realtime'`** — and `requireAuth()` refuses
any token that carries a scope. If that token leaks from the page it cannot call
the API at all; RLS (migration `0007`) then limits it to rows where the holder is
sender or receiver. The end-to-end suite asserts all four halves of that: the
participant reads, anonymous reads nothing, an outsider reads nothing, and a
direct insert is refused.

Three things in the original are fixed rather than copied, each with a test:

- `store()` never checked that the sender belonged to the thread it was posting
  into, so any signed-in account could join any conversation by guessing an id.
- `Admin\MessageController::store()` took `sender_id` from the request, letting
  an admin post messages that appear to come from any user.
- the student inbox sidebar used `where(contact_one, me)->where(contact_two, me)`
  — an AND, which only matches a thread you opened with yourself, so the sidebar
  was empty for every real conversation.

## S11: where the blog module diverges from the original

Three decisions worth knowing about, all forced by defects in the source rather
than by preference:

- **The blog was dead in the original.** `BlogVisibility` and
  `InstructorBlogPermission` both call `get_frontend_settings()`, which reads a
  `frontend_settings` table that this deployment never created -- so the helper
  returns `false` and every blog route redirects to the home page. The same
  "schema incomplete" defect disabled the page builder. Here the two keys are
  read from `settings`, and an absent value means **on**. Setting
  `blog_visibility_on_the_home_page = 0` still hides the module entirely, and
  `instructors_blog_permission = 0` still closes it to instructors -- which is a
  separate switch from publishing rights.
- **Instructor posts are always pending.** Admin posts publish on save
  (`status = 1`), instructor posts never do (`status = 0`), exactly as the two
  Laravel controllers hard-code it. `instructors_blog_permission` gates *access
  to the module*, not the ability to publish; conflating the two would let
  instructors publish unreviewed.
- **Testimonials now actually render.** `SettingController` wrote to
  `user_reviews`, nothing ever read the table back, and the home page showed
  hard-coded page-builder copy. The same admin CRUD now feeds `/api/testimonials`
  and a home-page section, so the screens do something.

## Deferred from S01, with reasons

- **F-02 (Supabase provisioning)** -- needs your account. Everything else is
  written so it works the moment `.env` is filled in.
- **P-05 (media library)** -- depends on P-04, which is done; scheduled with the
  upload UI in S02.
- **P-06 (mail)** -- SMTP settings are read, but templates land with the flows
  that send them (verification in A-03, reset in A-04).
- **P-09 (UI kit)** -- belongs with the Next.js app in S03; building it before
  there are screens to style would be guesswork.
# onyx-lms-v2
