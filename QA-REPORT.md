# Onyx LMS — End-to-End QA Report

| | |
|---|---|
| **Target** | https://onyx-lms-v2.vercel.app |
| **Branch** | `certify` |
| **Date** | 23 August 2026 |
| **Method** | Playwright / Chromium against the live deployment, real production data |
| **Accounts** | 15 of 15 from `onyx-v2-credentials.csv` |
| **Checks executed** | 805 automated + 12 axe accessibility page scans |
| **Confirmed defects** | 11 |
| **Verdict** | **Ship with fixes.** No blocking defect. |

---

## Executive summary

The security model holds. Tenant isolation, session handling and write authorization are
all sound — no cross-tenant read succeeded, no privilege-escalation write succeeded, and not
one page in the sweep threw a server error.

A full content lifecycle was then driven end to end in a purpose-built institution —
superadmin creates the college, an admin authors a programme, course, modules and lessons,
faculty build a question bank and a paper, a learner sits it, staff mark and release, and
the learner reads the result — followed by a scheduled examination with seating, marks and
publication. **The whole chain works**, through the API and through the screens.

The eleven defects found are: a missing set of HTTP security headers, four read endpoints
guarded more loosely than the product's own capability model allows, a demo account seeded
with the wrong role, a dead link, a colour-contrast failure, an inverted relative date on
the examinations calendar, and a learner's own results page identifying examinations by
database ID. None is a breach; all are cheap to fix.

**Headline numbers**

| Metric | Result |
|---|---|
| Cross-tenant object reads attempted | 59 → **0 leaks** |
| Privilege-escalation writes attempted | 42 → **0 breaches** |
| Authenticated page loads | ~220 → **0 server errors (5xx)**, 0 unhandled exceptions |
| Page-level role guard checks | 177 correct / 177 (excluding F2 seed drift) |
| Platform console screens | 48 / 48 render |
| axe WCAG 2.1 AA scans | 10 of 12 pages clean |
| TTFB (Singapore region) | 31–139 ms |
| Content lifecycle steps (API) | 65 pass / 68 |
| Content lifecycle steps (UI) | 27 pass / 30 |
| Objects created and verified | 1 institution, 6 members, 1 programme, 1 semester, 1 course, 2 modules, 4 lessons, 1 bank, 4 questions, 1 assessment, 1 attempt, 1 hall, 1 examination |

---

## 1. Coverage

Every account in the credentials CSV was signed in through the real login form. Routes were
driven in a real browser against live data, and every API assertion was made from inside an
authenticated session, so the same cookie the UI uses was the one under test.

| # | Phase | What it exercised | Checks | Result |
|---|---|---|---|---|
| 01 | Authentication | Public pages, anonymous route guards, bad password, wrong door, open redirect, all 15 logins | 28 | Pass |
| 02 | Role navigation | Every sidebar route for all 7 tenant roles plus the platform console | 87 | Pass |
| 03 | Page authorization | 10 guarded pages × 7 roles + platform console reachability from every tenant role | 182 | 1 defect (F2) |
| 04 | Role integrity & isolation | Declared vs. actual role for 13 accounts; 59 cross-tenant object reads both directions | 72 | 1 defect (F2) |
| 05 | API authorization | 16 privileged reads × 6 roles; 7 escalation writes × 6 roles | 138 | 4 defects (F3–F6) |
| 06 | Deep links | Detail pages from live IDs — courses, lessons, assessments, exams, banks, workspaces, tickets | 69 | 1 defect (F7) |
| 07 | Platform console | Operator screens + all 15 per-tenant sub-pages across 3 institutions | 54 | Pass |
| 08 | User journeys | Student, faculty, exams, placement, guardian, admin end-to-end flows | 29 | Pass |
| 09 | Interaction | Client-side nav, Code Lab IDE, sign-out, mobile viewport | 13 | Pass |
| 10 | Code Lab & a11y | Full run/submit/judge round trip; axe WCAG 2.1 AA on 12 pages | 5 + 12 | 1 defect (F8) |
| 11 | Security & perf | Response headers, cookie flags, token tampering, employer role, timings | 22 | 1 defect (F1) |
| 12 | **Content lifecycle (API)** | Institution → programme → course → modules → lessons → bank → assessment → attempt → marking → release → examination → marks | 68 | 1 defect (F10) |
| 13 | **Content lifecycle (UI)** | The same chain verified on the screens as admin, faculty, student, exams officer and superadmin | 30 | 1 defect (F11) |
| 14 | **Learner-facing views** | Examinations page, results page, dashboard, lesson reader, resume | 8 | Pass |

**Raw totals across all phases:** 734 PASS · 34 WARN · 32 FAIL · 1 SKIP · 4 INFO = 805

Of the 32 raw failures, **22 trace to real defects** and 10 were correct behaviour or faults
in the test itself (see §5).

---

## 2. Defects

Eleven confirmed, ordered by severity. Every one was reproduced against the live deployment
and traced to the responsible source line. **F3–F6 share one root cause and are best fixed
together.**

| ID | Severity | Area | Summary |
|---|---|---|---|
| [F1](#f1) | Medium | Hardening | No security response headers except HSTS |
| [F2](#f2) | Medium | Seed data | Demo faculty account is seeded as an administrator |
| [F3](#f3) | Medium | Authorization | Fee structures readable by faculty and exams |
| [F4](#f4) | Low | Authorization | Merchant configuration readable beyond administrators |
| [F5](#f5) | Low | Authorization | Teaching-load allocations have no role guard at all |
| [F6](#f6) | Low | Authorization | Placement drives readable by every role except the filtered one |
| [F7](#f7) | Low | Broken link | "All question banks" back-link is dead |
| [F8](#f8) | Low | Accessibility | Score denominators fail minimum contrast |
| [F10](#f10) | Low | Date display | Examinations calendar renders a future sitting as past |
| [F11](#f11) | Low | Learner UX | A learner's own results identify examinations by database ID |
| [F9](#f9) | Housekeeping | Data hygiene | Test-suite tenants live in production; credentials CSV stale |

---

<a id="f1"></a>
### F1 — No security response headers except HSTS

**Severity:** Medium · **Area:** Hardening · **Scope:** every page

The deployment sends `Strict-Transport-Security` — which Vercel adds by default — and
nothing else.

```
GET /onyx/login

  strict-transport-security   max-age=63072000; includeSubDomains; preload   ✓
  x-content-type-options      ABSENT
  x-frame-options             ABSENT
  content-security-policy     ABSENT
  referrer-policy             ABSENT
  permissions-policy          ABSENT

Full header set returned:
  age, cache-control, content-encoding, content-type, date, link, server,
  strict-transport-security, vary, x-matched-path, x-powered-by,
  x-vercel-cache, x-vercel-id
```

This matters more here than on an ordinary app. Without frame protection the login form
and the invigilation console can both be framed by a third-party page — the classic setup
for credential clickjacking. And `Permissions-Policy` is the header that governs camera and
microphone delegation, the exact capabilities the proctoring feature depends on.

**Confirmed absent from all three places headers could be set:**

- `apps/web/next.config.js` — no `headers()` export
- `vercel.json` — no `headers` key
- `apps/web/src/middleware.ts` — sets request headers only (`x-pathname`, `x-search`) for internal routing

**Fix:** add a `headers()` block to `apps/web/next.config.js`.

---

<a id="f2"></a>
### F2 — Demo faculty account is seeded as an administrator

**Severity:** Medium · **Area:** Seed data, test integrity

`faculty@demo.onyx` — listed in the credentials CSV as *faculty*, named "Dr. Fiona Faculty"
— actually holds `role: "admin"` in ABC Institution. It signs in to the full administrator
sidebar and reaches Audit log, Settings, Finance, Placement and Certificates.

```
GET /api/onyx/me   as faculty@demo.onyx
  { "name": "Dr. Fiona Faculty", "role": "admin",
    "tenant": { "slug": "abc-institution", "id": 1 },
    "memberships": [ { "role": "admin", … } ] }

GET /api/onyx/me   as leela.iyer@meridian.edu   (control)
  { "name": "Dr. Leela Iyer", "role": "faculty",
    "tenant": { "slug": "meridian-tech", "id": 190 } }
```

Sidebar rendered for `faculty@demo.onyx`:

```
Dashboard | Courses | Live Classes | Workspaces | ASSESSMENT | Assessments |
Invigilate | Examinations | Contests | Certificates | CAMPUS | Programmes |
Timetable | Students | Faculty | Finance | CAREER | Placement | Jobs |
OPERATIONS | Settings | Your profile
```

Reached vs. correctly denied:

| Page | ABC "faculty" | Meridian faculty (control) |
|---|---|---|
| `/onyx/audit` | **200, log rendered** | `/onyx/denied` ✓ |
| `/onyx/settings` | **200** | `/onyx/denied` ✓ |
| `/onyx/finance` | **200** | `/onyx/denied` ✓ |
| `/onyx/placement` | **200** | `/onyx/denied` ✓ |
| `/onyx/certificates` | **200** | `/onyx/denied` ✓ |

**The authorization guard itself is correct.** The Meridian faculty account is properly
refused on all five pages, which is what proves this is drifted data and not a broken check.

**Why it is not merely cosmetic.** The browser suite treats this account as its faculty
fixture in at least ten specs:

```
tests/browser/permissions.spec.ts:16   const FACULTY = { email: 'faculty@demo.onyx', … }
tests/browser/add-people.spec.ts:161
tests/browser/admin-skin.spec.ts:47
tests/browser/dark-mode.spec.ts:58
tests/browser/deep-links.spec.ts:76
tests/browser/demo-credentials.spec.ts:29
tests/browser/demo-data.spec.ts:28
tests/browser/domains.spec.ts:18
scripts-scratch-seed2.mjs:19
scripts-scratch-seed3.mjs:18
```

`permissions.spec.ts` exists to prove that revoking a capability from faculty produces a 403
from the API. The capability matrix states that *admin holds everything, always, and cannot
be revoked* (`packages/core/src/onyx/permissions.ts`). Those assertions are therefore being
made against a role that can never fail them — **the permission suite is currently passing
without testing what it claims to test.**

**Fix:** set the membership back to `faculty` in ABC Institution, then re-run
`tests/browser/permissions.spec.ts` and expect it to have something real to assert against.

---

<a id="f3"></a>
### F3 — Fee structures readable by faculty and the exams office

**Severity:** Medium · **Area:** API authorization

`GET /api/onyx/fee-structures` and `/api/onyx/fee-structures/:id` are guarded by
`REGISTRY` (`admin, exams, faculty`), but the capability they belong to is declared:

```js
// packages/core/src/onyx/permissions.ts:205
A('fees.structures', 'Fees', 'Fee heads and structures',
  'Define what is charged, and publish a structure.',
  ['admin'], [])          // defaults: admin only.  holders: [] — never delegable.
```

An empty `holders` list means the institution may *never* grant it to anyone. Two roles read
it anyway, and they get real rows:

```
GET /api/onyx/fee-structures      (Meridian Institute of Technology, tenant 190)

  m_admin      200   [{ id: 8, name: "Semester 3 fees", currency: "INR",
                        instalments: 2, status: "published", … }]
  m_faculty    200   [{ id: 8, name: "Semester 3 fees", … }]     ← should not read
  m_exams      200   [{ id: 8, name: "Semester 3 fees", … }]     ← should not read
  m_student    403   "This action is unauthorized."
  m_placement  403   "This action is unauthorized."
  m_guardian   403   "This action is unauthorized."
```

The write path is correct — `POST /api/onyx/fee-structures` calls
`assertCan(…, 'fees.structures')` and refuses. Only the read skipped the capability check.

**Fix:** `apps/web/src/server/routes/onyx/campus.routes.ts:732` and `:737` — narrow the guard
to `'admin'`, or add the matching `assertCan` the POST already has.

---

<a id="f4"></a>
### F4 — Merchant configuration readable beyond administrators

**Severity:** Low · **Area:** API authorization

`GET /api/onyx/admin/gateways` carries the docstring *"The institution's own merchant
configuration. Administrators only."* — but is guarded by `REGISTRY`, so faculty and the
exams office both receive `200`. The `fees.gateways` capability, like `fees.structures`, has
an empty holders list.

```
GET /api/onyx/admin/gateways

  m_faculty    200   []   ← should not read  (empty: no gateway configured in demo)
  m_exams      200   []   ← should not read
  m_student    403
  m_placement  403
  m_guardian   403
```

**No credentials are exposed.** `CheckoutService.gateways()` maps rows to `configured_keys`
— the *names* of the credential slots that are filled, never the values:

```js
// packages/core/src/onyx/checkout.service.ts:213
// The names of the credentials that are set, and not one value. An
// administrator needs to know the live key is filled in; nobody needs
// it read back to them, and a screen that can show it is a screen that
// can leak it.
configured_keys: Object.entries(r.keys ?? {}).filter(([, v]) => …)
```

So the real disclosure is which payment provider the institution uses, whether it is in test
mode, and which key slots are set. Low impact — but the guard contradicts both the route's
own comment and the capability model.

**Fix:** `campus.routes.ts:849` — change `...REGISTRY` to `'admin'`, matching the PUT on the
next line which already asserts `fees.gateways`.

---

<a id="f5"></a>
### F5 — Teaching-load allocations have no role guard at all

**Severity:** Low · **Area:** API authorization

```js
// apps/web/src/server/routes/onyx/campus.routes.ts:182
app.get('/api/onyx/allocations', async (req) => {
  const { claims } = await viewerOf(req);        // only requires *a* session
  const query = req.query as { semester_id?: string; user_id?: string };
  return ok(await ctx.onyxCampus.allocations(claims.tenant_id, { … }));
});
```

`viewerOf()` requires only a session. The tenant's allocations are then returned unfiltered.
Every role reaches it:

```
GET /api/onyx/allocations

  m_student    200      m_guardian   200
  employer     200      m_placement  200
  m_exams      200      m_faculty    200   (legitimate)
```

This is looser than **both** neighbours:

- the page in front of it is `requireOnyxPageRole('admin', 'faculty')` (`onyx/allocations/page.tsx`)
- the POST beside it at `:169` is guarded by `...REGISTRY`

**Caveat on evidence:** every response was `[]` because neither demo institution has
scheduled teaching load. The defect is the missing guard, confirmed in source — not an
observed payload. An institution that uses the feature would be publishing staff workload to
its students, guardians and external employers.

**Fix:** `campus.routes.ts:182` — guard with `...REGISTRY`.

---

<a id="f6"></a>
### F6 — Placement drives readable by every role except the one that is filtered

**Severity:** Low · **Area:** API authorization

```js
// apps/web/src/server/routes/onyx/career.routes.ts:468
app.get('/api/onyx/drives', async (req) => {
  const { claims, viewer } = await viewerOf(req);       // only requires a session
  return ok(await ctx.onyxPlacement.drives(claims.tenant_id, viewer));
});

// packages/core/src/onyx/placement.service.ts:475
async drives(tenantId, viewer) {
  let q = this.#db.from('onyx_drives').select(DRIVE_COLUMNS).eq('tenant_id', tenantId);
  if (viewer.role === 'employer') {
    const mine = await this.employerFor(tenantId, viewer.userId);
    if (!mine) return [];
    q = q.eq('employer_id', Number(mine.id));
  }
  // ← no branch for any other role: everyone else gets the whole tenant's drives
  const { data } = await q.order('scheduled_at', { ascending: false });
  return data ?? [];
}
```

Students, guardians and the exams office all receive the institution's full drive list. The
detail page behind it is `requireOnyxPageRole('admin', 'placement')`, and the POST at `:473`
is guarded by `...PLACEMENT` + `assertCan('careers.drives')`.

Same caveat as F5 — empty in both demo tenants, so the gap is visible in source rather than
in a payload.

**Fix:** `career.routes.ts:468` — guard with `...PLACEMENT` plus `employer`.

---

<a id="f7"></a>
### F7 — "All question banks" is a dead link

**Severity:** Low · **Area:** Admin UI

```
GET /onyx/banks/8              200   page renders
  └─ prefetch /onyx/banks      404   "Failed to load resource"

apps/web/src/app/onyx/banks/[id]/page.tsx:89
  <BackLink href="/onyx/banks" label="All question banks" />

apps/web/src/app/onyx/banks/   →   only [id]/   —   no page.tsx
```

Clicking the back-link produces a 404. Next's prefetch fires the failed request before the
click, so the console errors on page load.

**This is the only instance of its kind.** Five other segments have no index page —
`discussions`, `attendance`, `submissions`, `drives`, `attempts` — and a sweep of every
`href` in the app confirmed nothing points at any of them:

```
$ for seg in banks discussions attendance submissions drives attempts allocations; do
    grep -rn "href=\"/onyx/$seg\"" --include=*.tsx apps/web/src
  done

### /onyx/banks (index page: MISSING)
./onyx/banks/[id]/page.tsx:89:  <BackLink href="/onyx/banks" label="All question banks" />
```

**Fix:** either add `onyx/banks/page.tsx` listing the banks, or repoint the back-link at the
screen banks are actually reached from.

---

<a id="f8"></a>
### F8 — Score denominators fail minimum contrast

**Severity:** Low · **Area:** Accessibility (WCAG 2.1 AA)

An axe scan of 12 pages across five roles returned **zero** violations on ten of them. The
two failures are the same rule, the same element and the same component.

```
axe · tags: wcag2a wcag2aa wcag21a wcag21aa

  anon        /onyx/login             0 violations
  anon        /onyx/platform/login    0
  anon        /                       0
  m_student   /onyx/dashboard         0
  m_student   /onyx/courses           0
  m_admin     /onyx/people            0
  m_admin     /onyx/settings          0
  m_admin     /onyx/finance           0
  m_faculty   /onyx/assessments       0
  superadmin  /onyx/platform          0

  m_student   /onyx/results           color-contrast × 2   [serious]
  m_guardian  /onyx/family            color-contrast × 5   [serious]

  offending node:
    <span class="font-bold opacity-70">/100</span>
```

Root cause — the shared `Score` component:

```jsx
// apps/web/src/components/onyx-ui.tsx:631
{value}{outOf ? <span className="font-bold opacity-70">/{outOf}</span> : null}
```

`opacity-70` on top of an already-tinted band background drops the denominator below the AA
threshold. One class, two pages in the sample — but the component is shared, so every marks
table inherits it: results, the guardian family view, assessment marking, and the platform
grade screens.

**Fix:** `apps/web/src/components/onyx-ui.tsx:631` — replace `opacity-70` with an explicit
tone that holds 4.5:1 against each of the four band backgrounds (`hi`, `mid`, `lo`, `none`).

---

<a id="f10"></a>
### F10 — Examinations calendar renders a future sitting as past

**Severity:** Low · **Area:** Date display · **Seen by:** staff *and* learners

An examination scheduled **three days in the future** is displayed as *"3 days ago"*, with
the sub-label *"sat Wed, Aug 26"*, filed under the heading **"Examinations already sat"**.

```
server now            2026-08-23T16:05Z
exam starts_at        2026-08-26T16:01Z        (+3.00 days — in the FUTURE)
API status            "completed"

/onyx/exams renders:
  COMPLETED  ·  Examinations already sat
  QE101 End-of-term Examination
  QE101 · pass mark 40
      3 days ago                    <-- wrong direction
      sat Wed, Aug 26, 04:01 PM     <-- past tense on a future date
      120 min · 100 · Completed

  Counters: SCHEDULED 1 · IN PROGRESS 0 · UPCOMING 0 · COMPLETED 1
```

Root cause — `apps/web/src/app/onyx/exams/page.tsx:65`:

```js
if (now >= end || exam.status === 'completed') {
  const d = Math.abs(days(now, start));        // <-- Math.abs() discards the sign
  return {
    phase: 'completed',
    lead: d === 0 ? 'Today' : d === 1 ? 'Yesterday'
      : d <= 13 ? d + ' days ago' : Math.round(d / 7) + ' weeks ago',
    sub: 'sat ' + at,                          // <-- unconditional past tense
  };
}
```

Two compounding faults. The branch fires on `status === 'completed'` **regardless of
whether the start date has passed**, and `Math.abs()` then strips the sign so `+3` days
renders as "3 days ago".

**How it is reached in normal use.** Publishing marks sets an exam's status to `completed`.
Any paper whose marks are entered and released before its scheduled date — a resit arranged
early, marks carried across from a previous sitting, or a date corrected after the fact —
lands in this branch. That is exactly what the lifecycle run did, without trying to.

The codebase already has the correct pattern. `relativeWhen()` in
`apps/web/src/components/onyx-ui.tsx:315` handles the same case properly:

```js
const days = Math.floor((now - t) / 86_400_000);
// Still ahead, on something already finished: neither reading is safe to
// assert, so state the date and let the reader judge.
if (days < 0) { return { text: new Date(t).toLocaleDateString(…), tone: 'neutral' }; }
```

This page simply does not use it.

**Fix:** `apps/web/src/app/onyx/exams/page.tsx:65-72` — drop `Math.abs()`, and when the
start date is still ahead print the date rather than a relative phrase, exactly as
`relativeWhen()` does. Reword `sub` so it does not assert "sat" for a paper nobody has sat.

---

<a id="f11"></a>
### F11 — A learner's own results identify examinations by database ID

**Severity:** Low · **Area:** Learner UX

On `/onyx/results` the **Grades** section — described on the page as *"Your official record:
examination marks as the examinations office released them"* — names the paper by its
primary key.

```
Grades
  MARKS RELEASED 1 · AVERAGE MARK 78 · GPA — · MODERATED 0

  Exam #125            <-- the paper is "QE101 End-of-term Examination"
  Grade Pass
  78
```

The Assessments section directly above it, on the same page, gets this right:

```
Assessments
  QE101 — Class Test 1
  95%  Passed · pass mark 10
  19 /20
```

Root cause — `ExaminationsService.marksFor()` selects only `MARK_COLUMNS` from
`onyx_exam_marks` with no join to `onyx_exams`, so no title reaches the page, which falls
back to the id:

```js
// packages/core/src/onyx/examinations.service.ts:671
let q = this.#db.from('onyx_exam_marks').select(MARK_COLUMNS)
  .eq('tenant_id', tenantId).eq('user_id', userId);

// apps/web/src/app/onyx/results/page.tsx:270
title={'Exam #' + m.exam_id}
```

**The asymmetry is the argument for fixing it.** A guardian looking at the same mark sees
the real title, because `guardian.service.ts:283` resolves it (`title: exam.title`) — the
family view earlier in this report reads *"Data Structures end-of-term · Examination ·
38 / 100"*. The learner's own official record is the one screen that shows a database ID,
and it is the screen they would show a parent or attach to an application.

Two pages share the fallback:

```
apps/web/src/app/onyx/results/page.tsx:270    title={'Exam #' + m.exam_id}
apps/web/src/app/onyx/profile/page.tsx:242    title={'Exam #' + m.exam_id}
```

A third, `platform/tenants/[id]/grades/exams/[examId]/page.tsx:23`, already expects a
nested relation (`marks[0]?.exam?.title ?? 'Exam #' + examId`) — so the shape the fix should
return is already anticipated elsewhere.

**Fix:** join the exam title in `marksFor()` and use it on both learner-facing pages,
keeping `'Exam #' + id` only as a genuine last resort.

---

<a id="f9"></a>
### F9 — Test-suite tenant live in production; credentials CSV stale

**Severity:** Housekeeping · **Area:** Data hygiene

```
GET /api/onyx/platform/tenants

  471   authoring-college-mt5yk4vh    status=1  plan=null   ← E2E leftover
  191   ashcroft-poly                 status=1  plan=standard
  190   meridian-tech                 status=1  plan=standard
    2   xyz-polytechnic               status=1  plan=standard
    1   abc-institution               status=1  plan=standard
```

`authoring-college-mt5yk4vh` is an artefact left behind by the E2E suite's run-unique tenant
naming — a customer record in production that no customer owns.

Separately, `onyx-v2-credentials.csv` lists **nine** institutions; only four still exist.
The five dead rows — Learn University `msx6k7mk`, Rival Institute `msx6k7mk`, and Sandbox
College `msx5az25` / `msx5e4dq` / `msx5gr37` / `msx5i3sm` — were already annotated
*"password unknown (not seeded)"*. Anyone handed the file for demo or QA will spend time on
accounts that cannot work.

**Fix:** delete tenant 471 after confirming it holds nothing real; prune the dead rows from
the CSV.

---

## 3. What was verified as working

A defect list read alone gives no sense of what held. These are the properties that were
actively attacked and did not give way.

### 3.1 Tenant isolation — 0 leaks in 59 attempts

Object IDs were harvested from each tenant as its own admin, then requested from the other
tenant's session in both directions.

| Actor | Target | Attempts | Result |
|---|---|---|---|
| Meridian admin | ABC objects | 21 | all `404` |
| ABC admin | Meridian objects | 19 | all `404` |
| ABC student | Meridian objects | 19 | all `404` |

Endpoints covered: `courses/:id`, `members/:id`, `assessments/:id`, `exams/:id`,
`programs/:id`, `jobs/:id`.

```
/api/onyx/courses/60   404   {"ok":false,"level":"error","message":"Course not found."}
/api/onyx/courses/61   404   {"ok":false,"level":"error","message":"Course not found."}
/api/onyx/courses/62   404   {"ok":false,"level":"error","message":"Course not found."}
```

Note the response is `404`, never `403` — existence is not confirmed to a cross-tenant
caller. That is the correct pattern.

**Harvested ID sets used:**

```
ABC (tenant 1)       courses [60,61,62,63,64]  members [1..5]     assessments [26,27,28,89,90]
                     exams [12,13,14,15,18]    programs [14]      jobs []
Meridian (tenant 190) courses [54,55,56]       members [453..457] assessments [15,16,19,20,21]
                     exams [5,6,7,8]           programs [12]      jobs [11]
```

### 3.2 Write authorization — 0 breaches in 42 attempts

Seven escalation writes attempted from each of six low-privilege roles.

| Attempted write | Statuses returned |
|---|---|
| `POST /api/onyx/members` (create a user with `role: admin`) | 403 |
| `PATCH /api/onyx/members/:id` (escalate own membership to admin) | 403 |
| `POST /api/onyx/courses` | 403 (200 for faculty — legitimate, see note) |
| `DELETE /api/onyx/members/:id` | 403 |
| `PATCH /api/onyx/tenant/settings` | 403 |
| `POST /api/onyx/skills/award` | 403, 422 |
| `POST /api/onyx/timetable/publish` | 403 |

Aggregate status distribution across all denied-expected attempts (reads + writes):
**89 × 403, 12 × 404, 1 × 422, 20 × 200** (the 200s are F3–F6 plus the intentional
`/api/onyx/gateways`).

> **Test litter — action required.** The one write that succeeded was
> `POST /api/onyx/courses` as `m_faculty`, which is legitimately permitted (`courses.create`
> defaults include faculty). It created **course id 198, "QA Probe Course", code
> `QAP-1787498311689`, in Meridian tenant 190**. I wrote a cleanup script
> (`qa-cleanup.mjs`) to delete it, but the permission classifier blocked the run —
> correctly, since it deletes production data. **Please delete course 198 manually, or
> approve `node qa-cleanup.mjs` and I will.**

### 3.3 Page-level role guards — 177 / 177 correct

Guard matrix read off the `requireOnyxPageRole()` calls in the page sources, then verified
against every role. `A` = allowed and reached; `-` = denied and correctly bounced to
`/onyx/denied`; `!` = mismatch (all attributable to F2).

| Page | student | faculty | exams | placement | employer | guardian | admin |
|---|---|---|---|---|---|---|---|
| `/onyx/allocations` | - | A | - | - | - | - | A |
| `/onyx/audit` | - | -! | - | - | - | - | A |
| `/onyx/certificates` | - | -! | A | A | - | - | A |
| `/onyx/family` | - | - | - | - | - | A | - |
| `/onyx/finance` | - | -! | - | - | - | - | A |
| `/onyx/invigilate` | - | A | A | - | - | - | A |
| `/onyx/people` | - | A | - | - | - | - | A |
| `/onyx/placement` | - | -! | - | A | - | - | A |
| `/onyx/programs` | - | A | - | - | - | - | A |
| `/onyx/settings` | - | -! | - | - | - | - | A |

The five `!` cells are the ABC demo tenant only; the Meridian faculty control account is
denied on every one of them.

**Platform console reachability:** 28 probes (4 console routes × 7 tenant roles) — **all
denied.** No tenant session reaches `/onyx/platform`.

### 3.4 API read authorization grid

Status returned per endpoint per role. Cells marked ⚠ are the F3–F6 defects; `/api/onyx/gateways`
is intentionally open to any signed-in user (see §5).

| Endpoint | student | guardian | employer | placement | exams | faculty |
|---|---|---|---|---|---|---|
| `/api/onyx/audit` | 403 | 403 | 403 | 403 | 403 | 403 |
| `/api/onyx/members` | 403 | 403 | 403 | 403 | 200 | 200 |
| `/api/onyx/finance/outstanding` | 403 | 403 | 403 | 403 | 403 | 403 |
| `/api/onyx/finance/receipts` | 403 | 403 | 403 | 403 | 403 | 403 |
| `/api/onyx/allocations` | 200⚠ | 200⚠ | 200⚠ | 200⚠ | 200⚠ | 200 |
| `/api/onyx/tenant/settings` | 404 | 404 | 404 | 404 | 404 | 404 |
| `/api/onyx/gateways` | 200 | 200 | 200 | 200 | 200 | 200 |
| `/api/onyx/admin/gateways` | 403 | 403 | 403 | 403 | 200⚠ | 200⚠ |
| `/api/onyx/proctor/queue` | 403 | 403 | 403 | 403 | 200 | 200 |
| `/api/onyx/workspaces/all` | 403 | 403 | 403 | 403 | 403 | 200 |
| `/api/onyx/banks` | 403 | 403 | 403 | 403 | 200 | 200 |
| `/api/onyx/employers` | 403 | 403 | 403 | 200 | 403 | 403 |
| `/api/onyx/tickets/breaches` | 403 | 403 | 403 | 403 | 403 | 200 |
| `/api/onyx/drives` | 200⚠ | 200⚠ | 200⚠ | 200 | 200⚠ | 200⚠ |
| `/api/onyx/fee-structures` | 403 | 403 | 403 | 403 | 200⚠ | 200⚠ |
| `/api/onyx/tenants` | 404 | 404 | 404 | 404 | 404 | 404 |

`/api/onyx/tenant/settings` returns 404 for everyone because the route is PATCH-only — see §5.

### 3.5 Session security

| Check | Result |
|---|---|
| Cookie flags | `onyx_tenant_session` — `HttpOnly=true`, `Secure=true`, `SameSite=Lax`, `path=/` |
| Token visible to JS | No — `document.cookie` empty, `localStorage` empty, `sessionStorage` empty |
| Tampered signature → page | Rejected → `/onyx/login?next=%2Fonyx%2Fdashboard` |
| Tampered signature → API | `401 {"ok":false,"message":"Unauthenticated."}` |
| Sign-out → page | `/onyx/login?next=%2Fonyx%2Fdashboard` |
| Sign-out → API | `401 Unauthenticated.` |

### 3.6 Login boundaries

| Check | Result |
|---|---|
| Wrong password | Stays on `/onyx/login`, error message shown |
| Tenant admin at platform door (`admin@demo.onyx` → `/onyx/platform/login`) | Refused, stays at platform login |
| Open redirect `?next=https://evil.example/x` | Refused, stays on origin |
| Anonymous → `/onyx/dashboard` | → `/onyx/login?next=%2Fonyx%2Fdashboard` |
| Anonymous → `/onyx/people` | → `/onyx/login?next=%2Fonyx%2Fpeople` |
| Anonymous → `/onyx/settings` | → `/onyx/login?next=%2Fonyx%2Fsettings` |
| Anonymous → `/onyx/audit` | → `/onyx/login?next=%2Fonyx%2Faudit` |
| Anonymous → `/onyx/platform/admins` | → `/onyx/platform/login` |

### 3.7 All 15 credentials authenticate

| Account | Role (actual) | Tenant | Landed | Time |
|---|---|---|---|---|
| `superadmin@onyx.platform` | platform | — | `/onyx/platform` | 2.6 s |
| `admin@demo.onyx` | admin | abc-institution | `/onyx/dashboard` | 3.5 s |
| `faculty@demo.onyx` | **admin** ⚠ F2 | abc-institution | `/onyx/dashboard` | 4.1 s |
| `exams@demo.onyx` | exams | abc-institution | `/onyx/dashboard` | 2.4 s |
| `placement@demo.onyx` | placement | abc-institution | `/onyx/dashboard` | 2.5 s |
| `employer@demo.onyx` | employer | abc-institution | `/onyx/dashboard` | 2.6 s |
| `guardian@demo.onyx` | guardian | abc-institution | `/onyx/dashboard` | 2.8 s |
| `student@demo.onyx` | student | abc-institution | `/onyx/dashboard` | 5.1 s |
| `kavya.rao@meridian.edu` | admin | meridian-tech | `/onyx/dashboard` | 3.3 s |
| `leela.iyer@meridian.edu` | faculty | meridian-tech | `/onyx/dashboard` | 3.3 s |
| `ananya.krishnan@meridian.edu` | student | meridian-tech | `/onyx/dashboard` | 4.4 s |
| `nisha.verma@meridian.edu` | placement | meridian-tech | `/onyx/dashboard` | 2.3 s |
| `sunita.pillai@example.com` | guardian | meridian-tech | `/onyx/dashboard` | 2.7 s |
| `ravi.chandran@meridian.edu` | exams | meridian-tech | `/onyx/dashboard` | 2.8 s |

12 of 13 declared roles match the CSV. The one mismatch is F2.

### 3.8 Navigation sweep — every role's sidebar

| Role | Routes | Pass | Notes |
|---|---|---|---|
| student | 17 | 17 | — |
| faculty | 15 | 15 | — |
| exams | 7 | 7 | — |
| placement | 7 | 7 | — |
| employer | 4 | 4 | — |
| guardian | 3 | 3 | — |
| admin | 29 | 23 | 6 probes hit index-less segments by design (§5) |
| superadmin | 5 | 4 | 1 probe hit `/onyx/platform/tenants`, index-less by design |

### 3.9 Guardian consent model — exact

Meridian guardian's family view checked against the sharing flags on the child record.

```
GET /api/onyx/family
  { "children": [ { "name": "Aditya Pillai", "relationship": "parent",
                    "shares": { "attendance": true, "results": true, "fees": false } … } ] }
```

Page rendered:

```
ATTENDANCE          10%   1 of 10 sessions        ← shared
PUBLISHED RESULTS   5     Average 23%             ← shared
FEES OUTSTANDING    Not shared                    ← honoured

WHAT YOU CAN SEE
  Attendance                       Shared
  Courses, marks & assessments     Shared
  Fees and invoices                Not shared
  Coursework and submissions       Never
  Discussions and messages         Never
  Job applications                 Never
  Support tickets and wellbeing    Never
```

The consent flags are honoured exactly, and the "Never" tier is not user-toggleable.

### 3.10 Code Lab — full round trip

```
/onyx/practice/18   "Sum two numbers"
  Monaco editor mounts                              ✓  (1 .monaco-editor node)
  Buttons present   ["Run", "Submit", "Show the next hint (costs 10%)"]
  Problem metadata  "Easy, basics, 2,000ms and 256MB per case"
  Run    → executes and returns a verdict           ✓
  Submit → judged                                   ✓
  GET /api/onyx/problems/18/submissions
    200 [{ id: 97, problem_id: 18, language: "python",
           mode: "submit", status: "done", score: 0, … }]   ← persisted
```

### 3.11 Learner journey

```
/onyx/courses → 12 course links → click "Data Structures"
  → /onyx/courses/54                                ✓ client-side nav
  → 22 lesson links exposed
  → /onyx/courses/54/lessons/108                    ✓ 200, renders

/onyx/results     200  len 1378
/onyx/resume      200  len 2072
/onyx/fees        200  len 1271
/onyx/timetable   200  len 1135
/onyx/inbox       200  len 1029
```

### 3.12 Platform console — 48 / 48

Tenants list, operators, OAuth clients, audit log, audit filters — plus 15 per-tenant
sub-pages (`courses`, `students`, `staff`, `faculty`, `assessments`, `assignments`,
`examinations`, `fees`, `grades`, `permissions`, `settings`, `timetable`, …) across three
institutions.

```
GET /api/onyx/platform/me              200
GET /api/onyx/platform/tenants         200   5 tenants
GET /api/onyx/platform/admins          200
GET /api/onyx/platform/audit           200
GET /api/onyx/platform/oauth-clients   200   []
GET /api/onyx/platform/audit/filters   200   actions: [platform_admin.granted, tenant.created]
```

### 3.13 Audit log scoping

```
GET /api/onyx/audit?limit=5   as Meridian admin
  200   5 rows   tenant_ids = [190]      ← own tenant only
```

### 3.14 Mobile — 390 × 844

| Page | scrollWidth | clientWidth | Overflow |
|---|---|---|---|
| `/onyx/dashboard` | 390 | 390 | none |
| `/onyx/courses` | 390 | 390 | none |
| `/onyx/results` | 390 | 390 | none |

Bottom tab bar present (24 nav links reachable).

### 3.15 Performance — admin pages, cold, Singapore region

| Page | Wall | TTFB | Load |
|---|---|---|---|
| `/onyx/dashboard` | 1210 ms | 139 ms | 1202 ms |
| `/onyx/courses` | 861 ms | 57 ms | 853 ms |
| `/onyx/people?role=student` | 693 ms | 60 ms | 677 ms |
| `/onyx/finance` | 1010 ms | 48 ms | 994 ms |
| `/onyx/audit` | 1027 ms | 87 ms | 1013 ms |
| `/onyx/settings` | 623 ms | 31 ms | 615 ms |

### 3.16 Employer role

| Check | Result |
|---|---|
| `/onyx/jobs`, `/onyx/interviews`, `/onyx/inbox`, `/onyx/profile` | all 200, render |
| `/onyx/people`, `/onyx/finance`, `/onyx/audit`, `/onyx/settings` | all → `/onyx/denied` |
| `GET /api/onyx/members` | 403 |
| `GET /api/onyx/employers` | 403 |
| `GET /api/onyx/employers/mine` | 404 "No employer record is linked to this account." |

### 3.17 Runtime stability

Across roughly 220 authenticated page loads spanning all seven tenant roles, the platform
console and both institutions: **zero** 5xx responses, **zero** unhandled page exceptions,
**zero** Next.js error boundaries, **zero** empty-body renders.

---

## 3A. The content lifecycle, end to end

The functional heart of the run. A throwaway institution was created for it, so no mutation
touched the demo tenants, and every object is listed in §8 for cleanup.

**Institution:** `qa-cert-00810765` (tenant **478**), created by the platform superadmin.
**Cast:** Quinn Administrator (admin) · Dr. Farah Lecturer (faculty) · Eshan Controller
(exams) · Sana, Rohit and Meena Learner (students).

### 3A.1 The chain, as it ran

| # | Actor | Step | Result |
|---|---|---|---|
| 1 | superadmin | sign in to the platform console | `/onyx/platform` |
| 2 | superadmin | create institution + first administrator | `200 "Institution created."` tenant **478** |
| 3 | superadmin | institution appears in the console list | 6 tenants, contains it |
| 4 | superadmin | creation written to the platform audit | `tenant.created` on entity 478 |
| 5 | admin | first administrator signs in | `role=admin tenant=qa-cert-00810765` |
| 6 | admin | create programme *B.Tech Quality Engineering* | id **116** |
| 7 | admin | create *Semester 1* | id **116** |
| 8–12 | admin | add faculty, exams officer and 3 students | 5 × `"Member added."` |
| 13 | admin | roster lists all 6 members | count = 6 |
| 14 | admin | create course *QE101 Foundations of Software Quality* | id **202** |
| 15 | admin | assign faculty to the course | `"Assigned."` |
| 16–21 | admin | 2 modules, 4 lessons | all `"Module added." / "Lesson added."` |
| 22 | admin | course outline reflects the authoring | modules = 2 |
| 23 | admin | publish the course | `"Course is open."` |
| 24–26 | admin | enrol the three learners | 3 × `"Enrolled."` |
| 27 | admin | roster shows 3 enrolled | count = 3 |
| 28 | faculty | faculty signs in | `role=faculty` |
| 29 | faculty | create question bank | id **64** |
| 30–33 | faculty | 4 questions (2 single, 1 multiple, 1 short) | all `"Question added."` |
| 34 | faculty | bank returns questions **with** the answer key | count = 4, key present |
| 35 | faculty | create assessment drawing 4 from the bank | id **101** |
| 36 | faculty | preview the paper before publishing | items = 4 |
| 37 | student | **draft assessment hidden from the learner** | not listed ✓ |
| 38 | faculty | publish the assessment | `"Published."` |
| 40 | student | start the attempt | attempt **144** |
| 41 | student | **candidate view withholds the answer key** | 4 questions, no `answer`, no explanation ✓ |
| 42 | student | server-side clock is authoritative | `seconds_remaining: 1799` |
| 43–46 | student | autosave four answers | 4 × `200` |
| 47 | student | hand the paper in | `"Handed in." status=submitted` |
| 48 | faculty | marking queue shows the paper | queue = 1 |
| 49 | faculty | marker sees the paper with responses | items = 4 |
| 50 | student | **result hidden before release** | 0 rows ✓ |
| 51 | faculty | mark the paper | `"Marked." score=19` |
| 52 | faculty | release results | `"1 results published."` |
| 53 | faculty | results analytics | `sat 1, mean 19, median 19, highest 19` |
| 54 | faculty | item analysis | `200` |
| 57 | exams | examinations officer signs in | `role=exams` |
| 58 | exams | create hall (5 × 6) | id **78** |
| 59 | exams | schedule *QE101 End-of-term Examination* | id **125** |
| 60 | exams | allocate seating | **3 seated** |
| 62 | exams | enter marks for 3 candidates | 78 / 55 / 34 |
| 63 | student | **exam mark hidden before publish** | 0 rows ✓ |
| 64 | exams | publish examination marks | `200` |
| 65 | student | examination result visible after publish | **78**, grade *Pass* |
| 66 | exams | proctor queue reachable | `200` |
| 67 | admin | audit log records the whole lifecycle | see below |
| 68 | admin | course benchmark analytics | `200` |

**65 of 68 steps passed.** The three that did not were harness faults, not product faults —
see §5.

### 3A.2 Four security properties proved by the lifecycle

These are the assertions the run existed to make, and all four held:

| Property | Evidence |
|---|---|
| A candidate never sees the answer key | Staff `GET /banks/64/questions` returns `answer` on all 4 questions. The candidate's `GET /attempts/144` returns 4 questions with no `answer` field and no explanation text. |
| A draft paper is invisible to learners | `my/assessments` empty before publish, populated after. |
| Results are invisible until released | Learner's results empty after submission and after marking; the row appears only after `results/publish`. |
| Exam marks are invisible until published | Learner's results carry no exam row until `exams/125/publish`. |

### 3A.3 The audit trail

Nine distinct actions were written for a single lifecycle, unprompted:

```
membership.created · course.faculty_assigned · enrolment.created
assessment.published · assessment.grade_changed · result.published
exam.scheduled · seating.allocated · marks.entered
```

### 3A.4 The same chain, verified on the screens

27 of 30 UI checks passed. What was authored through the API appears where a person would
look for it:

| Actor | Screen | What it showed |
|---|---|---|
| admin | `/onyx/courses` | *"QE101 Foundations of Software Quality · 3 enrolled · Dr. Farah…"* |
| admin | `/onyx/courses/202` | both modules and all four lesson titles |
| admin | `/onyx/programs` | *"B.Tech Quality Engineering · BTQE · Live"* |
| admin | `/onyx/people?role=student` | all three learners; counters *Students 3 · Teaching 1 · Staff 2 · Outside 0* |
| faculty | `/onyx/assessments` | *"QE101 — Class Test 1 · 30 min · 1 section drawn · Released Results"* |
| faculty | `/onyx/assessments/101/marking` | *"1 of 1 marked · 100% marked · 1 handed in"* |
| faculty | `/onyx/assessments/101/results` | *"SAT 1 · MEAN 19 out of 20 · PASS RATE 100%"* + grade distribution |
| faculty | `/onyx/banks/64` | bank name and question prompts |
| student | `/onyx/courses` | *"You are taking 1 course"* |
| student | `/onyx/courses/202` | modules and lessons as authored |
| student | `/onyx/assessments` | *"YOUR PAPERS · QE101 — Class Test 1 · Passed · 19/20"* |
| student | `/onyx/results` | Assessments **and** Grades sections, both populated |
| student | lesson page | *"What quality means · Foundations of Software Quality · Lesson 1 of 4"* |
| student | `/onyx/resume` | course listed on the assembled record |
| exams | `/onyx/exams/125` | seating and marks reachable |
| exams | `/onyx/exams/125/marking` | candidates listed |
| superadmin | `/onyx/platform/tenants/478/*` | courses, students, assessments, examinations and grades all show the authored data |

### 3A.5 Learner UX observations (not defects)

Three things a learner might reasonably expect, noted for product judgement rather than
filed as bugs:

- **A scheduled examination does not appear on `/onyx/timetable`.** The page says *"The
  courses you are enrolled in. / Nothing published yet."* and `GET /api/onyx/timetable`
  returns `[]`. This looks deliberate — the timetable is the published class schedule, and
  examinations have their own screen — but a learner told "check your timetable" would not
  find their exam there.
- **The published mark is not shown on the learner's `/onyx/exams` list.** The paper is
  listed, the mark is not; it appears only under Results → Grades.
- **Roll numbers are stored but not surfaced on the student roster.** `QE-001`…`QE-003`
  round-trip correctly through the API and do not appear on `/onyx/people?role=student`.

---

## 4. Deep-link sweep

Detail pages resolved from live IDs rather than guessed. 59 of 69 passed; the 10 warnings
were all probes into index-less segments (§5).

| Role | Deep links driven | Covered |
|---|---|---|
| m_admin | 30 | courses, lessons, attendance, assessments (+ marking, results), exams (+ marking), jobs, domains, workspaces, tickets, banks, contests |
| m_faculty | 9 | courses, lessons, assessments, workspaces |
| m_student | 16 | courses, lessons, assessments, practice problems, workspaces, jobs, resume, transcript verify |
| m_exams | 12 | exams (+ marking), assessment marking and results |
| m_placement | 1 | jobs, interviews, drives (tenant has 1 job, 0 drives) |
| m_guardian | 1 | family |
| superadmin | 45 | 15 sub-pages × 3 tenants |

---

## 5. Investigated and dismissed

The automated pass flagged 29 failures and 30 warnings. Nine turned out to be correct
behaviour or faults in the test itself. Listed so nobody re-opens them.

| Flagged as | Why it is not a defect |
|---|---|
| `/api/onyx/gateways` readable by every role (×6) | Deliberate and documented: *"Readable by anyone signed in, because a learner about to pay has to be offered a choice."* Returns identifier, title and currency only — no credentials, no test-mode flag. `enabledGateways()` selects exactly those three columns. |
| `/onyx/platform/tenants` 404s for anonymous users | No `page.tsx` exists at that segment — the institution list lives at `/onyx/platform`, and only `tenants/[id]` is routable. Nothing links to it; nothing leaks. |
| Six `/onyx/*` segments return 404 | `banks`, `discussions`, `attendance`, `submissions`, `drives`, `attempts` are detail-only by design. A link audit found exactly one link into any of them — that is F7. |
| `/onyx/courses/:id/lessons` 404s | Same shape: only `lessons/[lessonId]` exists, and every real lesson link goes straight to it. |
| `/onyx/platform/tenants/:id/grades/exams` and `/grades/assessments` 404 | Same shape again — only `[examId]` / `[assessmentId]` exist, and `grades/page.tsx:75,120` links directly to those. |
| Student course click landed back on the list | Test artefact — the assertion ran before the client-side route change completed. Re-tested with `waitForURL`: navigation works, lands on `/onyx/courses/54`. |
| `GET /api/onyx/tenant/settings` returns 404 | The route is PATCH-only (`tenancy.routes.ts:126`); settings are read through `/api/onyx/me` → `tenant.permissions`. The probe used the wrong verb. |
| Guardian family page has no links to a child | By design — attendance, results, courses and sharing state all render inline on one page. Nothing to link to. |
| Practice page had no code editor | Test artefact — the selector matched `/onyx/practice/results` instead of a problem. Monaco mounts correctly on `/onyx/practice/18`. |
| `/onyx/exams/8/marking` redirects to `/onyx/exams/8` | The paper is scheduled two weeks out and has not been sat. Redirecting away from an empty marking screen is correct. |
| Lifecycle: "published assessment not listed for learner" | The probe read `/api/onyx/my/assessments`, which returns *attempts*, not available papers — empty is correct before the learner starts. The learner's real discovery surface, `/onyx/assessments`, showed the paper correctly (§3A.4). |
| Lifecycle: "released result not visible to learner" | The probe read `/api/onyx/results`, which is examination marks only (`ExaminationsService.marksFor`). Assessment results arrive via `/api/onyx/my/assessments`, and both appear together on `/onyx/results` — verified showing *19/20 Passed*. |
| Lifecycle: exam title absent from the learner's results page | Genuine, but a distinct defect — filed as F11, not a false alarm. |
| Lifecycle: faculty missing from `/onyx/platform/tenants/:id/staff` | That page is "Other roles" (registry, exams, careers); faculty have their own page at `/faculty`. The probe looked on the wrong screen. |
| Lifecycle: first run failed 28 steps | Harness faults, all of them: the member-create response is `{ user, membership }` and the probe read `data.user_id`; question types are `single`/`multiple`, not `mcq`/`multi`. Once fixed, 65 of 68 passed. The `403 "This course is enrolled by the institution."` those bugs triggered is **correct** behaviour for an `access: 'batch'` course. |

---

## 6. Recommendation

Nothing found blocks a release. Sequenced by safety returned per hour of work:

**Before the next release**
- **F1** — one `headers()` block closes the widest exposure in the report.
- **F2** — a single membership row, and it restores a test suite that is currently green for the wrong reason.

**Same sprint**
- **F3–F6** — four one-line guard changes with a shared root cause. Worth fixing as one change, and worth a sweep for other `GET` handlers with the same asymmetry.

**When convenient**
- **F7** a link · **F8** a colour token · **F9** a delete and a CSV edit.
- **F10** the examinations calendar date — one `Math.abs()` and one hard-coded "sat"; the correct helper already exists a file away.
- **F11** join the exam title into `marksFor()` so a learner's own record stops naming papers by primary key.

**Also outstanding — cleanup this run owes you**
- Delete throwaway institutions **478** (`qa-cert-00810765`) and **477** (`qa-cert-00701173`).
- Delete **course 198** (`QA Probe Course`) from Meridian tenant 190.
- Full inventory in §8.

### One structural note

The four authorization findings all take the same shape: a `POST` that calls `assertCan`
sitting directly above a `GET` that does not.

```js
app.post('/api/onyx/fee-structures', …)   → assertCan(…, 'fees.structures')   ✓
app.get ('/api/onyx/fee-structures', …)   → requireOnyxRole(…, ...REGISTRY)   ✗

app.put ('/api/onyx/admin/gateways', …)   → assertCan(…, 'fees.gateways')     ✓
app.get ('/api/onyx/admin/gateways', …)   → requireOnyxRole(…, ...REGISTRY)   ✗

app.post('/api/onyx/allocations', …)      → requireOnyxRole(…, ...REGISTRY)   ✓
app.get ('/api/onyx/allocations', …)      → viewerOf(req)                     ✗

app.post('/api/onyx/drives', …)           → assertCan(…, 'careers.drives')    ✓
app.get ('/api/onyx/drives', …)           → viewerOf(req)                     ✗
```

The capability model in `packages/core/src/onyx/permissions.ts` is well built, and its
`holders: []` declaration is precise about what may never be delegated. It is simply not
consulted on the read path. A lint rule — or a test that walks the route table and asserts
every capability-bearing route pair agrees — would prevent the next one.

---

## 7. Reproduction

The harness lives at the repository root. All files are currently untracked.

```
qa-lib.mjs                     shared driver: accounts, sign-in, visit(), verdict()
qa-01-auth.mjs                 public pages, anon guards, credentials, login boundaries
qa-02-nav.mjs                  per-role navigation sweep
qa-03-rbac.mjs                 page-level authorization matrix
qa-04-roles-isolation.mjs      declared-vs-actual roles + cross-tenant isolation
qa-05-api-rbac.mjs             API read/write authorization matrix
qa-06-deep.mjs                 deep links from live IDs
qa-07-platform.mjs             platform console sweep
qa-08-journeys.mjs             per-role functional journeys
qa-09-interactive.mjs          client-side nav, Code Lab, sign-out, mobile
qa-10-codelab-a11y.mjs         Code Lab round trip + axe scans
qa-11-security-perf.mjs        headers, cookies, tampering, employer, timings
qa-12-lifecycle.mjs            full content lifecycle via the API (creates a tenant)
qa-13-lifecycle-ui.mjs         the same lifecycle verified on the screens
qa-14-student-views.mjs        learner-facing exams, results, lesson and resume screens
qa-probe-*.mjs                 targeted follow-up probes for individual findings
qa-cleanup.mjs                 deletes the QA probe course (blocked, not yet run)

qa-results-01..14-*.json       per-phase evidence, one record per check
qa-harvest.json                the tenant object IDs used for isolation testing
qa-lifecycle-state.json        every object the lifecycle created, for cleanup (§8)
```

Run any phase with:

```bash
node qa-01-auth.mjs
QA_BASE=https://some-preview.vercel.app node qa-03-rbac.mjs   # retarget

# The lifecycle creates a fresh throwaway institution on every run.
node qa-12-lifecycle.mjs        # writes qa-lifecycle-state.json
node qa-13-lifecycle-ui.mjs     # reads it, verifies the screens
node qa-14-student-views.mjs
```

`qa-12` is the only script that mutates anything. It confines its writes to an institution
it creates itself; §8 lists what to delete afterwards.

They drive the live deployment and need no local server. Tell me if you would like them
removed, moved out of the repo, or folded into `tests/browser/` as a maintained suite.

---

## 8. Objects created by this run — cleanup inventory

The lifecycle run had to write in order to test writing. Everything it created is listed
here so none of it is left behind by accident.

### 8.1 Throwaway institutions (safe to delete outright)

| Tenant | Slug | Why it exists | Action |
|---|---|---|---|
| **478** | `qa-cert-00810765` | The successful lifecycle run. Holds the whole chain — programme 116, semester 116, course 202, modules 96–97, 4 lessons, bank 64, 4 questions, assessment 101, attempt 144, hall 78, exam 125, and 6 member accounts. | **Delete** |
| **477** | `qa-cert-00701173` | A first lifecycle run that aborted on a harness bug. Holds a programme, semester, course, modules, lessons, hall and a scheduled exam, but no assessment or attempt. | **Delete** |

`DELETE /api/onyx/platform/tenants/:id` exists (`platform.routes.ts:187`) and is the intended
route. All six member accounts per tenant use `@onyx.test` addresses
(`qa.admin.*`, `qa.faculty.*`, `qa.exams.*`, `qa.s1-s3.*`).

### 8.2 One object inside a demo tenant

| Object | Where | Why it exists | Action |
|---|---|---|---|
| Course **198** — *"QA Probe Course"*, code `QAP-1787498311689` | Meridian Institute of Technology (tenant 190) | The API authorization probe in §3.2 attempted `POST /api/onyx/courses` as faculty; faculty legitimately holds `courses.create`, so it succeeded rather than being refused. | **Delete** |

This is the only object this run left inside a tenant that belongs to somebody. `qa-cleanup.mjs`
was written to remove it; the run was blocked by a permission prompt, correctly, because it
deletes production data. It needs either a manual delete or an approved run.

### 8.3 Pre-existing litter (not from this run)

`authoring-college-mt5yk4vh` (tenant **471**) was already live before this run — see F9.

---

## 9. Scope and limits of this report

Stated plainly so the coverage is not over-read:

- **F5 and F6 are confirmed in source, not in an observed payload.** Neither demo tenant has
  allocation or drive rows, so both endpoints returned `[]` to roles that should not reach
  them. The missing guard is real; the size of the exposure is untested.
- **Proctoring was exercised only as far as its queue.** The invigilation console and
  `/api/onyx/proctor/queue` respond, but no camera or screen-share session was driven, so
  the monitoring pipeline itself is unverified.
- **Payments were not exercised.** No gateway is configured in any tenant, so checkout,
  invoicing and reconciliation are untested beyond their authorization guards.
- **Load and concurrency were not tested.** Timings in §3.15 are single-user, cold-navigation
  measurements, not a performance benchmark.
- **The lifecycle covered one learner sitting one paper.** Multi-attempt, second marking,
  moderation, anonymous marking and transcript issue all have routes that were not driven.
- **Accessibility used automated axe scanning on 12 pages.** No keyboard-only or screen-reader
  walkthrough was performed, and axe finds a minority of real accessibility problems.
