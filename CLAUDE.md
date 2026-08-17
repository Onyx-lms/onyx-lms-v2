# Onyx LMS — working notes for Claude

React / Node / TypeScript / Supabase port of the Laravel LMS "EZiL Certify".
Read [`README.md`](README.md) first for what exists; this file is the stuff that
is expensive to rediscover.

**This is its own repository.** The Laravel app lives in a SEPARATE checkout,
by default the sibling directory `../TT002-LEO-LMS` (override with
`LARAVEL_ROOT`). It is the **source of truth and is read-only** — never write to
it. Only the parity generators and `tools/db/laravel-source.mjs` reference it.

## The one rule that outranks the others

**Exact schema parity.** The user's standing constraint is "no changes in schema
/ it should be same". `supabase/migrations/0001_schema.sql` and `0002_indexes.sql`
are **generated** from the Laravel SQLite database by `tools/gen_schema.py` — a
hand edit is a bug, and CI fails on it.

Six tables have been added beyond the 61, each because a Laravel model and
controller write to a table **no migration ever creates** (so the feature throws
in the original). Every one was an explicit decision, documented in the README:

| Table | Migration |
| --- | --- |
| `quiz_submissions` | `0004` |
| `blog_comments`, `blog_likes` | `0005` |
| `user_reviews` | `0006` |
| `bootcamp_resources` | `0008` |
| `applications` | `0009` |

**Adding a seventh needs the user's agreement first.** Say what is broken in the
original, then ask.

**Onyx tables are not part of this count.** Onyx is a second product in this
repository (ADR-006) with no parity constraint. Its tables live in `public`
behind an `onyx_` prefix, and every tool that counts the port's tables excludes
that prefix: `tools/db/audit.mjs`, `tests/e2e/s01-platform.e2e.ts`. Adding an
Onyx table is ordinary work; adding a 62nd *ported* table is not.

## Onyx invariants

- **`onyx_app` was tried and withdrawn.** PostgREST serves only the schemas the
  project is configured to expose, and that setting is project-wide on a live
  project the port depends on. Everything failed with `Invalid schema: onyx_app`
  until the tables moved to `public` with a prefix. Do not reintroduce a
  dedicated schema without changing Settings → API → Exposed schemas first.
- **Tenant comes from the token, never from a path or body.** A token whose
  `tenant_id` is missing, zero, negative, fractional or a string is a 401, not a
  default. `requireOnyx` enforces this; there are unit tests for each case.
- **Every `onyx_` table needs `tenant_id`.** `onyx.assert_tenant_scoped()` fails
  the migration runner and the E2E gate otherwise. Three exemptions only:
  `onyx_tenants`, `onyx_users`, `onyx_schema_migrations`.
- **Audit writes never throw.** The row describes work that already happened, so
  a failure is logged through `#onError`, not raised. That means a broken audit
  path is silent — the O01 E2E asserts entries exist for exactly this reason.
- **Onyx's web session is `onyx_tenant_session`**, not the port's `onyx_session`.
  `/api/proxy/[...path]` picks the cookie by path prefix.
- **Staff means `admin` or `faculty` — name them, never `!== 'student'`.**
  `exams` and `placement` are real roles; a negated check hands them every
  lesson, roster and record in the institution.
- **`assertCanTeach` on every course-scoped route.** Faculty means faculty *of
  this course*. Admins are exempt; nobody else is.
- **Attendance: present + late attended, excused leaves the denominator,
  unmarked counts as absent.** Stated in `attendance.service.ts`; do not
  recompute it anywhere else.
- **A score is invisible until `returned_at` is set.** `forLearner()` in
  `assignments.service.ts` downgrades `graded` to `submitted` for the learner —
  do not bypass it by selecting the row directly.
- **Nothing in this repo runs learner code.** `ExecutionProvider` is the
  contract; with no sandbox configured the answer is a 503, never a local
  fallback. Do not add one, in any environment. `deploy/judge0/` is a real one
  to point at, and `tools/onyx/verify-sandbox.mjs` proves it contains a fork
  bomb, a loop and a network call before it carries learners. Running it
  against `tools/judge0-stub.mjs` fails five of six cases -- that is correct,
  the stub is a protocol echo and not a sandbox.
- **The queue is Postgres with `FOR UPDATE SKIP LOCKED`** (`queue.service.ts`).
  It is the ONLY part of Onyx that talks to Postgres directly, because the claim
  is one statement whose atomicity is the point. `onyxSql()` resolves the host
  once, before the pool exists -- an earlier version swapped pool objects and
  every held reference hung.
- **A hidden test case is the answer key**: its stdin, its expected output, and
  the actual output it produced. None is ever in a learner response, and the
  last is not stored at all. Enforced in `codelab.service.ts`, not in routes.
- **Roles are six now:** student, faculty, exams, placement, **employer**,
  admin. `employer` is an OUTSIDER — scoped to their own company by
  `assertEmployerOwns`, never given a roster or a cohort. Every staff check
  names the roles it allows; never write `!== 'student'`.
- **`/api/onyx/verify/:credentialId` is the one public Onyx route.** No token,
  not tenant-scoped, and it must stay that way — a verifier has no account.
  What it returns is an allow-list (`PUBLIC_DETAIL_KEYS`), not a filter.
- **Eligibility and readiness are computed, never stored as a verdict.** The
  breakdown and the rule-by-rule checks are part of the response.
- **A sat paper is immutable.** `onyx_question_versions` keeps every version;
  an attempt stores the version it saw AND the wording, and grading reads the
  key from that version. Editing a question must never change a sat paper.
- **Assessment time is the server's.** `expires_at` is written at start and
  every check reads it. Never trust a client timestamp for anything but a
  recorded `client_at` beside the server's.
- **A score is invisible until the assessment's `results_published_at` is set**
  AND the attempt is `published`. Both, not either.
- **Anonymous marking omits `user_id` from the payload** rather than hiding it.
- **Proctoring stores events, never recordings**, and no flag auto-fails
  anybody. A human decision is not overwritten by the flag score. The camera
  and screen capture added for ASS-02a does not change this: the stream is held
  in the browser to observe when it starts and stops, not one frame is
  uploaded, and face counting (where `FaceDetector` exists at all) sends the
  number and never the picture.
- **A tenant-scoped query is not enough on its own.** A foreign id must 404, not
  answer 200 with an empty list -- an empty list confirms the id exists. Load
  the parent row first. This has now been the same bug in O03 and twice in O04.
- **A workspace snapshot is jsonb, not copied rows**, and restore deletes files
  added since. Anything else quietly breaks LAB-05's one promise.
- **A check-in code is judged against the request's ARRIVAL time, and the
  window before it counts.** Deriving the window after the three lookups made
  the learner pay for the server's round trips, and current-window-only refused
  codes that were still on the projector. RFC 6238's one-step tolerance, paid
  for by halving the default window to 15s: a code is dead at most
  `2 x qr_window_seconds` after it appeared. Do not "tighten" this back.
- **The QR secret never leaves the server.** `SESSION_COLUMNS` omits it *and*
  `createSession` deletes it, so one careless edit is not enough to leak it.
- **A payment webhook is the one Onyx route with no token, and it is still not
  trusted.** The tenant in the URL only chooses which credentials verify the
  signature; the reference inside the body is HMAC-signed by us and carries the
  real tenant, invoice and amount, and the two must agree. Never read a tenant
  from a webhook body.
- **Gateway credentials are write-only.** `onyx_payment_gateways` has RLS with
  no SELECT policy at all, the admin API returns the NAMES of the keys that are
  set and never a value, and the audit entry records which keys changed rather
  than what they changed to.
- **Notifying never throws**, exactly like audit and for the same reason: the
  row describes work that already happened, so raising would roll back the thing
  being announced. Failures go to `#onError` and a counter. **The row is the
  notification and email is a copy** -- an institution with no SMTP must still
  have told the person.
- **No route takes a notification recipient.** Notifications are raised by
  services as a consequence of work, so what this product can send you is a
  closed list in code. Do not add an endpoint that puts something in somebody
  else's inbox.
- **A Prometheus counter that has never fired does not exist**, and "no data"
  looks identical to "no failures" on a dashboard. Every counter in `HELP` is
  seeded to zero at import for that reason; add a new one to that map or its
  alert will be silently unarmed.
- **`tsc --build` does NOT check `apps/web`.** It walks project references and
  the Next app is not one of them, so for most of this product's lifetime the
  gate's typecheck step skipped every page and component. `npm run typecheck`
  now runs `typecheck:web` as well; do not "simplify" it back to one command.
- **`docs/API.md` is generated.** `npm run docs:check` is in the gate, so a new
  route with no documentation fails the build. The generator reads the guard out
  of each handler -- an early version searched too small a window and reported
  every guarded route as public, which is the one way this file can be worse
  than nothing.
- **`POST /workspaces/:id/run` does not go through the code queue**, unlike
  every other line that reaches the sandbox. The queue exists for "200
  submissions at once" -- a class hitting Submit against one assignment; a
  workspace run is one owner executing one file of their own project, so there
  is nothing to batch and no submission id worth making someone poll for. It
  calls `ExecutionProvider.run()` straight from the request and answers with
  the result. Do not "fix" this into the queue without a reason a workspace
  actually has.
- **`ONYX_JUDGE0_URL` in local `.env` points at `https://ce.judge0.com`, not a
  local container.** Self-hosting (`deploy/judge0/`) needs cgroup v1; this
  machine's Docker Desktop WSL2 VM is cgroup v2-only and the bundled `isolate`
  (1.8.1, predates v2 support) fails every submission with `internal_error`,
  verified with `tools/onyx/verify-sandbox.mjs` before concluding that, not
  assumed. The hosted CE endpoint is the same fallback the Laravel app used
  (`CodeIDEController.php`). It is rate-limited with no SLA -- fine for one
  developer, not for a deployment. Full story in `deploy/judge0/README.md`.

## Non-obvious invariants

- **Auth is a custom JWT, not Supabase Auth** (ADR-001). Signed with
  `SUPABASE_JWT_SECRET`. `role` must stay `'authenticated'` so PostgREST does the
  right `SET ROLE`; the application role lives in `app_role`. **`auth.uid()` must
  never appear in a policy** — it casts `sub` to uuid and our ids are bigint. Use
  `onyx.current_user_id()`.
- **A token with a `scope` claim is refused by `requireAuth()`** (ADR-004). Only
  the realtime token has one, because it has to live in browser JS.
- **PHP-compatible JSON** (ADR-002). 20 columns hold JSON as text. Plain
  `JSON.stringify` corrupts them — it does not escape solidus or non-ASCII. Use
  `phpJsonEncode` / `phpJsonDecode` from `packages/core/src/json/php-json.ts`.
- **Type mapping**: `tinyint(1)` → `smallint` (NOT boolean — 0/1 semantics),
  `double(10,2)` → `numeric(10,2)`, `datetime` → `timestamptz`.
- **RLS is deny-all by default and FORCEd.** All writes go through the API on the
  service-role key. `settings` is deliberately not anon-readable (it holds
  `smtp_pass` and gateway keys); a curated subset is exposed via `/api/settings`.
- Three schema inconsistencies are preserved on purpose: `sections.sort` is
  varchar, `instructor_reviews.rating` is varchar, and **`forums.likes` is a JSON
  array of user ids, not a counter** — that is what makes a like one-per-person.

## The Laravel source is not trustworthy as a spec

Read it, but verify against the actual schema before porting. Recurring patterns:

- Controllers writing to tables that do not exist (the six added tables above).
- **Several generations of the same feature coexisting** with different column
  names — messaging had three, only one of which can execute (ADR-004).
- Helpers reading tables the deployment never created — `get_frontend_settings()`
  reads `frontend_settings`, which is absent, so it returns `false` and silently
  disabled the blog module and the page builder.
- Missing authorization checks. Port the feature, not the hole; document the
  divergence in the README and cover it with a test.
- **The same column meaning different things for different entities.**
  `discounted_price` is the final price on a course and the amount taken off on
  a bootcamp. Check per entity; do not generalise from one call site.

When behaviour and the source disagree, prefer what the schema supports, and
write down the decision.

## Verification is the definition of done

```bash
npm run verify:all      # parity → unit → typecheck → audit → e2e, in that order
```

Never claim a sprint is done without a green `verify:all` **and**
`python tools/grading-differential.py`. Two things that have hidden failures
before, both now fixed — do not reintroduce them:

- `db:audit` called `process.exit()` while a socket was closing, aborting after
  printing `AUDIT CLEAN`. The non-zero exit broke the `&&` chain, so the e2e
  stage never ran. Use `process.exitCode`.
- `npm run e2e` served a **stale `.next`** — new pages 404'd and the suite blamed
  the frontend. The runner builds first now (`E2E_SKIP_BUILD=1` to skip).

The e2e suite talks to the real database on purpose: the in-memory fake enforces
no column widths, constraints or RLS. That is how a `session_id varchar(255)`
overflow was caught, and it is why RLS assertions belong there.

## Testing notes

- `node --test` runs **one process per file**, so the e2e harness caches tokens
  in a file. That cache is expiry-aware — it was not, and a stale cookie looked
  like a broken role guard. It is also cleared **once per run** by the runner and
  its freshness margin is 20 minutes, not 60 seconds: the suite takes about
  thirteen, so a token left by an earlier run could pass the check in the first
  file and be expired by the last. That surfaced as a 401 in S18 and read as a
  permissions bug for far longer than it should have.
- **Clean up in the database, not through the API.** S18 restored `system_title`
  through the admin endpoint; when the token had expired the restore failed as
  quietly as the test before it, and the *next* run's audit failed on the leftover
  value. A cleanup that needs auth to work is a cleanup that fails exactly when
  it is needed.
- Pages with `revalidate` are ISR-cached, and `apiSafe` caches per fetch URL.
  Asserting that freshly created content appears on a fixed URL tests Next's
  cache, not our rendering. Use a **run-unique query string**.
- The fake DB in `packages/core/test/fake-db.ts` models projections and nested
  `and(...)` / `or(...)` groups. When it cannot express something, **fix the fake**
  — a fake that silently matches everything makes tests worse than none.
- A test that opens a Supabase Realtime socket must `client.realtime.disconnect()`,
  or `node --test` never exits.

## What the tests do not cover

Worth stating so nobody reads a green gate as more than it is:

- **Sandbox isolation.** `tools/judge0-stub.mjs` speaks the Judge0 protocol and
  the suite asserts the flags we send (no network, CPU limit set, wall limit
  above it). Whether those flags are *enforced* is a property of the deployed
  container. That is a deployment check against a real endpoint.
- **Scale.** The proposal names 1,000 concurrent learners. Nothing here is a load
  test; the queue is built for it (`FOR UPDATE SKIP LOCKED`, horizontal workers)
  but the number is unmeasured.
- **Accessibility beyond structure.** The a11y suite checks skip links, focus
  rings, reduced motion, control names and table headers. WCAG 2.2 AA conformance
  needs a person with a screen reader, and no test here claims to be one.

## Environment

- Windows. **PowerShell is the primary shell**; a Bash tool exists too.
- Node 24 with native TypeScript stripping. `tsc` checks and emits `.d.ts` only.
- npm workspaces (pnpm is not available here).
- Bash heredocs **collapse `\\` to `\`** and fail above roughly 140 lines
  ("unexpected EOF"). Prefer the Write/Edit tools. For byte-exact backslashes,
  go through Python with `chr(92)`.
- `.env` holds real Supabase credentials and is gitignored. Keep it that way.
- Supabase CLI is logged in. After DDL over the direct connection, PostgREST
  needs `npm run db:reload-cache` or it serves a stale schema.

## Working style the user has asked for

- Implement **sprint by sprint** from `MIGRATION_SPRINT_PLAN.csv` in the Laravel
  checkout (`$LARAVEL_ROOT`); finish a
  sprint completely, verify it, then move on.
- Report honestly: say what was skipped and why. Deferred so far — Paytm (no
  working Laravel reference), ffmpeg watermark burn-in (needs a system binary),
  message reactions (no column, no table, no method — nothing to port).
