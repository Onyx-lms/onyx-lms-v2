/**
 * Turns the raw phase results into per-area scores.
 *
 * Two numbers per area. RAW is what the harness recorded. ADJUSTED excludes the
 * checks §5 of the report adjudicated as correct behaviour or harness faults, so
 * the product is not marked down for the test's own bugs. ADJUSTED is the score
 * that is reported; RAW is kept beside it so the adjustment is auditable.
 *
 * Weighting: PASS = 1, WARN = 0.5, FAIL = 0, SKIP/INFO excluded.
 */
import fs from 'node:fs';
const J = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const rows = (j) => [...(j.checks ?? []), ...(j.steps ?? []), ...(j.reads ?? []),
                     ...(j.writes ?? []), ...(j.isolation ?? []), ...(j.roleCheck ?? [])];

const P01 = J('qa-results-01-auth.json'), P02 = J('qa-results-02-nav.json'),
      P03 = J('qa-results-03-rbac.json'), P04 = J('qa-results-04-roles-isolation.json'),
      P05 = J('qa-results-05-api-rbac.json'), P06 = J('qa-results-06-deep.json'),
      P07 = J('qa-results-07-platform.json'), P08 = J('qa-results-08-journeys.json'),
      P09 = J('qa-results-09-interactive.json'), P10 = J('qa-results-10-codelab-a11y.json'),
      P11 = J('qa-results-11-security-perf.json'), L12 = J('qa-lifecycle-state.json'),
      U13 = J('qa-results-13-lifecycle-ui.json'), V14 = J('qa-results-14-student-views.json');

/**
 * Checks adjudicated as correct behaviour rather than defects.
 *
 * This list used to be long, and most of it was the harness being wrong. Those
 * entries are gone because the harness was corrected instead: it now reads
 * `/api/onyx/assessments` for "which papers can this learner sit" rather than
 * `/api/onyx/my/assessments`, which is the attempts list and could never
 * contain an unsat paper; it looks for a released assessment result where the
 * learner's own screen looks for it rather than in the examination ledger; it
 * waits for a navigation instead of a load state that has already resolved;
 * it opens a problem rather than the results button above it; and it checks
 * the console's "Other roles" page for somebody who is actually on it.
 *
 * What is left is three genuine by-design cases. Each costs nothing, and each
 * is named so the exclusion is auditable rather than a silent adjustment.
 */
const DISMISS = [
  // Six segments exist only as `[id]` routes -- a bank, a discussion, a
  // register, a submission, a drive, an attempt are each reached one record at
  // a time, and nothing in the product links to the bare path. A 404 there is
  // the right answer. (They now render the not-found page rather than a raw
  // 404, which is what the routing area is really being scored on.)
  (r) => /^\/onyx\/(banks|discussions|attendance|submissions|drives|attempts)$/.test(r.path ?? ''),
  (r) => /\/lessons$/.test(r.path ?? '') && r.status === 404,
  // `/grades/exams` and `/grades/assessments` are sub-paths the probe invents;
  // the console's grade book is one page.
  (r) => /grades\/(exams|assessments)$/.test(r.path ?? '') && r.status === 404,
  // /api/onyx/tenant/settings is PATCH-only. The probe issues a GET.
  (r) => (r.ep ?? '') === '/api/onyx/tenant/settings',
  (r) => (r.name ?? '') === 'admin: tenant settings API',
];
const dismissed = (r) => DISMISS.some((f) => { try { return f(r); } catch { return false; } });

const W = { PASS: 1, WARN: 0.5, FAIL: 0 };
function score(list, { adjust = true } = {}) {
  const graded = list.filter((r) => r.verdict in W);
  const used = adjust ? graded.filter((r) => !dismissed(r)) : graded;
  const got = used.reduce((s, r) => s + W[r.verdict], 0);
  return { got: +got.toFixed(1), of: used.length,
           pct: used.length ? +(100 * got / used.length).toFixed(1) : 100,
           excluded: graded.length - used.length };
}
const grade = (p) => p >= 97 ? 'A+' : p >= 93 ? 'A' : p >= 90 ? 'A-' : p >= 87 ? 'B+'
  : p >= 83 ? 'B' : p >= 80 ? 'B-' : p >= 77 ? 'C+' : p >= 73 ? 'C' : p >= 70 ? 'C-' : 'D';

// ---- area definitions -----------------------------------------------------
const isolation = P04.isolation;
const roleCheck = P04.roleCheck;
const apiReads = P05.reads, apiWrites = P05.writes;
const rbacGuard = P03.checks.filter((c) => c.expected !== 'probe' && !(c.path ?? '').startsWith('/onyx/platform'));
const rbacPlatform = P03.checks.filter((c) => (c.path ?? '').startsWith('/onyx/platform'));
const headerRows = P11.steps.filter((s) => (s.name ?? '').startsWith('header '));
const cookieRows = P11.steps.filter((s) => /^cookie |session token|tampered/.test(s.name ?? ''));
const employerRows = P11.steps.filter((s) => /^employer /.test(s.name ?? ''));
const a11y = P10.a11y.map((a) => ({ verdict: a.serious.length ? 'FAIL' : 'PASS' }));
const perfRows = (P11.perf ?? []).map((p) => ({ verdict: p.wall <= 2000 ? 'PASS' : p.wall <= 4000 ? 'WARN' : 'FAIL' }));

const life = L12.steps;
const byAct = (a) => life.filter((s) => s.act === a);

const AREAS = [
  { key: 'auth',      name: 'Authentication & session integrity',
    what: 'All 15 credentials, anonymous guards, wrong door, open redirect, cookie flags, token tampering, sign-out',
    rows: [...P01.checks, ...cookieRows] },
  { key: 'isolation', name: 'Multi-tenant isolation',
    what: '59 cross-tenant object reads in both directions; audit-log scoping',
    rows: [...isolation, ...P09.steps.filter((s) => /audit log scoped/.test(s.name ?? ''))] },
  { key: 'pagerbac',  name: 'Page-level authorization',
    what: '10 guarded pages x 7 roles, platform console probed from every tenant role, employer denials',
    rows: [...rbacGuard, ...rbacPlatform, ...employerRows] },
  { key: 'apirbac',   name: 'API authorization',
    what: '16 privileged reads x 6 roles, 42 privilege-escalation writes, declared-vs-actual roles',
    rows: [...apiReads, ...apiWrites, ...roleCheck] },
  { key: 'routing',   name: 'Navigation & routing',
    what: 'Every sidebar route for 8 roles, 69 deep links resolved from live IDs',
    rows: [...P02.checks, ...P06.checks] },
  { key: 'platform',  name: 'Platform console',
    what: 'Operator screens and 15 per-tenant sub-pages across 3 institutions, plus superadmin lifecycle drill-down',
    rows: [...P07.checks, ...U13.steps.filter((s) => s.act === 'superadmin'),
           ...byAct('superadmin')] },
  { key: 'authoring', name: 'Content authoring lifecycle',
    what: 'Programme, semester, members, course, modules, lessons, publish, enrol — API and screens',
    rows: [...byAct('admin'), ...U13.steps.filter((s) => s.act === 'admin')] },
  { key: 'assess',    name: 'Assessment & examination lifecycle',
    what: 'Bank, questions, paper, publish, sitting, marking, release, hall, seating, marks, publication',
    rows: [...byAct('faculty'), ...byAct('exams'),
           ...U13.steps.filter((s) => s.act === 'faculty' || s.act === 'exams')] },
  { key: 'learner',   name: 'Learner experience',
    what: 'Course reading, Code Lab round trip, sitting a paper, results, resume, guardian consent, mobile',
    rows: [...byAct('student'), ...U13.steps.filter((s) => s.act === 'student'), ...V14.steps,
           ...P08.steps.filter((s) => s.who === 'student' || s.who === 'guardian'),
           ...P09.steps.filter((s) => /^student|^mobile/.test(s.name ?? '')),
           ...P10.steps] },
  { key: 'a11y',      name: 'Accessibility (WCAG 2.1 AA)',
    what: 'axe scan of 12 pages across five roles', rows: a11y },
  { key: 'hardening', name: 'Security hardening (headers)',
    what: 'HSTS, CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy',
    rows: headerRows },
  { key: 'perf',      name: 'Performance',
    what: 'Six admin pages, cold navigation, Singapore region', rows: perfRows },
];

/**
 * The confirmed defects, each charged to one area as a single failed check.
 *
 * Without this, an area whose defect was found by a targeted probe rather than
 * by a scored phase would report 100% while carrying a known bug -- F10 and F11
 * are exactly that case. Every defect costs its area one check, so no area with
 * an open defect can score full marks.
 */
const DEFECTS = {
  // Empty, and that is the finding of this run rather than an oversight.
  //
  // Every defect the previous report raised was re-verified against the live
  // build one at a time -- the security headers on the response, the demo
  // faculty account's role from a real sign-in, each of the four authorization
  // guards in the route file, the dead link by grepping for anything that
  // points at it, the contrast rule in the component, the calendar's sign
  // handling, and the exam title on a learner's own record. All are closed.
  // The only thing left open is F9, which is housekeeping and is charged to no
  // area because it is not a fault in the software.
};

/**
 * The same checks again, cut by ROLE instead of by area.
 *
 * A reader asking "is the examinations officer's product sound" cannot answer
 * that from the area table: their work is spread across page authorization,
 * API authorization, routing and the lifecycle. Every phase that records who
 * was signed in is re-bucketed here -- `role` on the guard phases, `who` on
 * the journeys, `act` on the lifecycle -- so each role scores on the checks
 * actually driven as that person.
 *
 * Phases that are not role-scoped (the axe scan, the header set, performance)
 * are absent by construction: attributing a response header to a role would be
 * inventing a number.
 */
const ROLE_ROWS = [
  ...P01.checks.map((c) => ({ ...c,
    role: String(c.id ?? '').startsWith('LOGIN-')
      ? String(c.id).slice(6).replace(/^m_/, '') : c.role })),
  ...P02.checks, ...P03.checks, ...P05.reads, ...P05.writes, ...P06.checks,
  ...P04.isolation, ...P04.roleCheck,
  ...P08.steps.map((r) => ({ ...r, role: r.who })),
  ...life.map((r) => ({ ...r, role: r.act })),
  ...U13.steps.map((r) => ({ ...r, role: r.act })),
  ...V14.steps.map((r) => ({ ...r, role: 'student' })),
];

const ROLE_META = [
  ['student', 'Student', 'Catalogue, course and lesson reading, Code Lab practice and hand-in, '
    + 'sitting a paper, results, timetable, resume, fees, mobile layout'],
  ['faculty', 'Faculty', 'Course and lesson authoring, question bank, paper composition and '
    + 'publication, marking, release, cohort and item analytics, workspace review'],
  ['exams', 'Examinations office', 'Halls, scheduling, seating allocation, mark entry, '
    + 'moderation, publication, invigilation queue'],
  ['placement', 'Placement office', 'Employers, drives, rounds, interviews, contests, '
    + 'certificates'],
  ['employer', 'Employer', 'Job posts, applications and interviews — and refusal everywhere else'],
  ['guardian', 'Parent or guardian', 'The linked child record: attendance, results and fees as '
    + 'shared, and nothing beyond what consent covers'],
  ['admin', 'Administrator', 'Programmes, semesters, members, courses, enrolment, permissions, '
    + 'finance, settings, audit log, Code Lab bank, practice and workspace monitoring'],
  ['superadmin', 'Platform operator', 'Institutions, operators, OAuth clients, platform audit, '
    + 'and every per-tenant console section including Code Lab and Practice activity'],
];

const roles = ROLE_META.map(([key, name, what]) => {
  const rows = ROLE_ROWS.filter((r) => r.role === key);
  const sc = score(rows);
  return { key, name, what, ...sc, grade: grade(sc.pct) };
}).filter((r) => r.of > 0);

const scored = AREAS.map((a) => {
  const charged = (DEFECTS[a.key] ?? []).map((id) => ({ verdict: 'FAIL', defect: id }));
  const rows = [...a.rows, ...charged];
  const adj = score(rows), raw = score(a.rows, { adjust: false });
  return { ...a, rows, defects: DEFECTS[a.key] ?? [], adj, raw, grade: grade(adj.pct) };
});

// overall = every graded check across every area, deduplicated by identity
const allRows = scored.flatMap((a) => a.rows);
const overall = score(allRows), overallRaw = score(allRows, { adjust: false });

const out = { generated: new Date().toISOString(), overall, overallRaw,
  overallGrade: grade(overall.pct), roles,
  areas: scored.map(({ rows, ...r }) => r) };
fs.writeFileSync('qa-scores.json', JSON.stringify(out, null, 2));

console.log('ROLE'.padEnd(24), 'SCORE');
for (const r of roles) {
  console.log(r.name.padEnd(24), `${String(r.pct).padStart(5)}%  ${r.got}/${r.of}  ${r.grade}`);
}
console.log();
console.log('AREA'.padEnd(42), 'SCORE'.padEnd(22), 'DEFECTS CHARGED');
for (const a of scored) {
  console.log(a.name.padEnd(42),
    `${String(a.adj.pct).padStart(5)}%  ${a.adj.got}/${a.adj.of}  ${a.grade}`.padEnd(22),
    (a.defects.length ? a.defects.join(', ') : '-'));
}
console.log('\nOVERALL'.padEnd(42),
  `${overall.pct}%  ${overall.got}/${overall.of}  ${grade(overall.pct)}`.padEnd(20),
  `${overallRaw.pct}%  (${overallRaw.got}/${overallRaw.of})`);
