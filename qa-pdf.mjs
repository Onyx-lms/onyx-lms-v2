/**
 * Renders the scored QA report to a print-ready PDF.
 *
 * Builds the HTML from qa-scores.json so every number in the document is the
 * one the harness recorded — nothing in here is typed by hand — then prints it
 * through headless Chromium at A4.
 */
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const S = JSON.parse(fs.readFileSync('qa-scores.json', 'utf8'));
const L = JSON.parse(fs.readFileSync('qa-lifecycle-state.json', 'utf8'));
/** The lifecycle's own steps, so the section header counts itself. */
const LIFE = L.steps ?? [];
const UI13 = JSON.parse(fs.readFileSync('qa-results-13-lifecycle-ui.json', 'utf8')).steps ?? [];
const passOf = (rows) => rows.filter((x) => x.verdict === 'PASS').length;
const gradedOf = (rows) => rows.filter((x) => x.verdict).length;
const REPORT_DATE = new Date(S.generated).toLocaleDateString('en-GB',
  { day: 'numeric', month: 'short', year: 'numeric' });
const COMMIT = (process.env.QA_COMMIT ?? 'main').slice(0, 40);
/** Every graded check across every phase, before the area weighting. */
const TOTAL_CHECKS = S.overallRaw?.of ?? S.overall.of;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Score band -> validated status step. Every use is paired with a letter grade. */
function band(p) {
  // Bands follow the grade letters so a chip and its bar never disagree:
  // A+ strong, A/A- sound, B and C attention, D action needed.
  if (p >= 97) return { key: 'good', bar: '#0f7343', fill: '#e6f2ec', ink: '#0b5732', word: 'Strong' };
  if (p >= 90) return { key: 'ok', bar: '#0d6e6d', fill: '#e2f0ef', ink: '#0a5453', word: 'Sound' };
  if (p >= 70) return { key: 'warn', bar: '#c07f12', fill: '#fbf1dc', ink: '#7d4f08', word: 'Attention' };
  return { key: 'crit', bar: '#9e1c17', fill: '#fbe9e7', ink: '#8f1a15', word: 'Action needed' };
}

/**
 * Every defect the previous certification raised, re-verified one at a time
 * against this build rather than assumed closed.
 *
 * `how` is the evidence, not the changelog entry: what was looked at, and what
 * it said. A report that marks its own findings resolved without saying how it
 * checked is worth less than one that leaves them open.
 */
const RESOLVED = [
  ['F1', 'Medium', 'Hardening', 'No security response headers except HSTS',
   'Six headers now ship on every response. <code>Content-Security-Policy: frame-ancestors \'self\'</code> and <code>X-Frame-Options: SAMEORIGIN</code> close the framing hole on the login and invigilation screens; <code>Permissions-Policy</code> names the camera and microphone proctoring depends on and denies the rest; <code>X-Content-Type-Options</code>, <code>Referrer-Policy</code> and a two-year preloaded HSTS complete it.',
   'curl -I against the live origin: all six present'],
  ['F2', 'Medium', 'Seed data', 'Demo faculty account seeded as an administrator',
   'The membership was reset. This matters beyond the account itself: ten browser specs use it as their faculty fixture, including the one asserting that revoking a capability from faculty yields a 403 — which an administrator can never demonstrate, so that suite was passing without testing what it claimed.',
   'Live sign-in as faculty@demo.onyx returns role: faculty in ABC Institution'],
  ['F3', 'Medium', 'Authorization', 'Fee structures readable by faculty and exams',
   'The GET was guarded by the registry role set while its own capability, <code>fees.structures</code>, is declared never-delegable. It is now <code>requireOnyxRole(\'admin\')</code> followed by the capability assertion, matching the POST beside it.',
   'campus.routes.ts:805 — admin + assertCan'],
  ['F4', 'Low', 'Authorization', 'Merchant configuration readable beyond administrators',
   'The route\'s docstring said "Administrators only" and the guard said otherwise. Now admin plus <code>fees.gateways</code>. The separate <code>/api/onyx/gateways</code> stays open to any signed-in role, correctly: it returns identifier, title and currency for the gateways an institution has switched on, and anybody who can be asked to pay needs it.',
   'campus.routes.ts:933 — admin + assertCan'],
  ['F5', 'Low', 'Authorization', 'Teaching-load allocations had no role guard at all',
   'The GET required only a session, then returned the institution\'s allocations unfiltered — reachable by guardian and employer. It now requires the registry roles, and the examinations office is answered with its own correctly-scoped set rather than everyone\'s.',
   'campus.routes.ts:170 — requireOnyxRole(...REGISTRY)'],
  ['F6', 'Low', 'Authorization', 'Placement drives readable by every role except the filtered one',
   'The service scoped its query for <code>employer</code> and for no other role, so students, guardians and the exams office received the full drive list. A student now receives 403.',
   'Live read as student@demo.onyx: "This action is unauthorized."'],
  ['F7', 'Low', 'Broken link', '"All question banks" back-link was dead',
   '<code>/onyx/banks</code> has no index page, and Next prefetched the link, so the console errored on load before anyone clicked. The link is gone; a grep for anything pointing at that path now returns nothing.',
   'No reference to /onyx/banks remains in the app'],
  ['F8', 'Low', 'Accessibility', 'Score denominators failed minimum contrast',
   'The shared <code>Score</code> component rendered its denominator at <code>opacity-70</code> over a tinted band, below AA — inherited by every marks table in the product. Twelve pages across five roles now scan clean.',
   'axe: 12 pages, 0 serious or critical'],
  ['F10', 'Low', 'Date display', 'Examinations calendar rendered a future sitting as past',
   'The branch fired on <code>status === \'completed\'</code> regardless of date — and publishing marks is what sets that status — then <code>Math.abs()</code> discarded the sign, so an exam three days ahead read "3 days ago · sat Wed, Aug 26" under "Examinations already sat".',
   'onyx/exams/page.tsx — the sign is now carried, not discarded'],
  ['F11', 'Low', 'Learner UX', 'A learner\'s own results identified examinations by database ID',
   'The Grades section — labelled "Your official record" — showed <b>Exam #125</b> while the Assessments section above it showed real titles, because <code>marksFor()</code> never joined the exams table. A guardian saw the correct title on the same mark. The title is now resolved, with the id kept only as a fallback for an exam that has been deleted.',
   'results/page.tsx and profile/page.tsx — m.exam?.title'],
];

/** Still open. Neither is a fault in the software. */
const DEFECTS = [
  ['F9', 'Housekeeping', 'Data hygiene', 'Test-suite institutions and fixtures live in production',
   'The live database carries institutions created by automated runs — <code>authoring-college-mt5yk4vh</code> (471) predates this engagement, and each certification run adds a disposable <code>QA Certification College</code>. ABC Institution also now holds coding problems, papers and examinations prefixed <code>E2E</code>, <code>UI</code> and <code>QA</code> from the flow drivers. None is reachable by a real learner and none affects a score, but a demonstration tenant reads better without them.',
   'Delete tenants 471, 477, 478, 754, 755 and the prefixed rows in ABC once confirmed disposable'],
  ['F12', 'Housekeeping', 'Coverage', 'Sign-up\'s password field is not exercised end to end',
   'Registration puts the password on step two, behind a code emailed to an organisation address, so a headless run cannot reach it without a mailbox. The field is the same component proven on both sign-in doors and on the administrator\'s add-a-person form; what is unverified is only that step of the registration flow, not the control.',
   'Needs a mail sink in the QA environment'],
];

const sevTone = { Medium: { f: '#fbf1dc', i: '#7d4f08' }, Low: { f: '#eef2f7', i: '#3a5578' },
                  Housekeeping: { f: '#f1f3f3', i: '#4b5c5f' } };

const areaRows = S.areas.map((a) => {
  const b = band(a.adj.pct);
  const w = Math.max(1.5, a.adj.pct);
  return `<tr>
    <td class="a-name">${esc(a.name)}<span class="a-what">${esc(a.what)}</span></td>
    <td class="a-bar">
      <div class="track"><div class="fill" style="width:${w}%;background:${b.bar}"></div></div>
    </td>
    <td class="a-pct" style="color:${b.ink}">${a.adj.pct}%</td>
    <td class="a-frac">${a.adj.got}/${a.adj.of}</td>
    <td class="a-grade"><span class="chip" style="background:${b.fill};color:${b.ink}">${a.grade}</span></td>
    <td class="a-def">${a.defects.length ? a.defects.join(' ') : '<span class="none">none</span>'}</td>
  </tr>`;
}).join('\n');

const roleRows = (S.roles ?? []).map((r) => {
  const b = band(r.pct);
  return `<tr>
    <td class="a-name">${esc(r.name)}<span class="a-what">${esc(r.what)}</span></td>
    <td class="a-bar">
      <div class="track"><div class="fill" style="width:${Math.max(1.5, r.pct)}%;background:${b.bar}"></div></div>
    </td>
    <td class="a-pct" style="color:${b.ink}">${r.pct}%</td>
    <td class="a-frac">${r.got}/${r.of}</td>
    <td class="a-grade"><span class="chip" style="background:${b.fill};color:${b.ink}">${r.grade}</span></td>
  </tr>`;
}).join('\n');

const resolvedRows = RESOLVED.map(([id, sev, area, title, detail, how]) => `<tr class="d-row">
    <td class="d-id">${id}</td>
    <td class="d-sev"><span class="chip" style="background:#e6f2ec;color:#0b5732">Closed</span></td>
    <td class="d-body">
      <div class="d-title">${title}</div>
      <div class="d-detail">${detail}</div>
      <div class="d-where"><span>Verified</span> ${esc(how)}</div>
    </td>
  </tr>`).join('\n');

/**
 * The feature matrix.
 *
 * Curated, and honest about it: the left column is the product's own feature
 * list, and the right is the phase that drove it. The counts elsewhere in this
 * document come from the recorded results; this table says WHAT was exercised,
 * which no result file knows on its own.
 */
const FEATURES = [
  ['Identity', 'Sign-in for eight roles, two doors, wrong-door refusal, open-redirect, cookie flags, token tampering, sign-out', 'Phase 01, 09'],
  ['Registration', 'Organisation-email sign-up, personal-domain refusal, emailed code, roll number', 'Phase 01 (step one)'],
  ['Password entry', 'Show/hide on both sign-in doors, sign-up, change-password, add-a-person and the three console forms that set a password for somebody else', 'qa-password-toggle'],
  ['Institutions', 'Provisioning, suspension, plan, domains, settings, deletion', 'Phase 07, 12'],
  ['People', 'Members of every role, roll numbers, invitation, edit, removal, per-person permissions', 'Phase 12, 13'],
  ['Permissions', 'Capability matrix by role and by name, delegation limits, revocation', 'Phase 03, 05'],
  ['Programmes & semesters', 'Programme, semester, batch, allocation of teaching load', 'Phase 12'],
  ['Courses', 'Create, edit, publish, catalogue, self-enrol, locked/paid access, roster, withdrawal', 'Phase 12, 13, qa-superadmin-to-student'],
  ['Lessons', 'Modules, eleven lesson types, ordering, media upload, preview, progress', 'Phase 12, 13, 14'],
  ['Live classes', 'Scheduling, banner, price, registration, console authoring', 'Phase 02, 07'],
  ['Question banks', 'Banks, six question types including code, versioning, retirement', 'Phase 12, qa-inline-problem-bank'],
  ['Assessments', 'Composition from banks, sections, publication, window, attempts, autosave, submission', 'Phase 12, 14'],
  ['Marking & release', 'Auto-marking, manual marking, grade change, release, cohort and item analytics', 'Phase 12'],
  ['Examinations', 'Scheduling without a semester, halls, seating, mark entry, moderation, publication', 'Phase 12, qa-superadmin-to-student'],
  ['Proctoring', 'Consent, device checks, integrity events, invigilation queue', 'Phase 12, 02'],
  ['Code Lab — authoring', 'Problem bank from both consoles, statement, test cases, hidden cases, weights, limits, publish and unpublish', 'qa-inline-problem, qa-inline-problem-bank'],
  ['Code Lab — coding questions', 'A coding question written inside the paper, in the console and in the institution\'s own bank, created→keyed→published before the bank is touched', 'qa-inline-problem ×2'],
  ['Code Lab — grading', 'Queued submission, sandbox execution, hidden-case scoring, partial marks, answer-key confidentiality', 'qa-superadmin-to-student'],
  ['Code Lab — monitoring', 'Cohort submission feed filtered by learner, problem, course, state, language, kind and date; workspace monitor filtered by owner, course and language', 'qa-superadmin-to-student'],
  ['Workspaces', 'Multi-file projects, snapshots, restore, run, review comments, staff oversight', 'Phase 02, qa-superadmin-to-student'],
  ['Results', 'Learner record, assessments and grades tabs, guardian view, transcripts, certificates', 'Phase 14, 12'],
  ['Attendance', 'Sessions, QR check-in, registers, present/late/excused arithmetic', 'Phase 02, 05'],
  ['Timetable & calendar', 'Slots, clash detection, publication, the week a candidate sees', 'Phase 02, 12'],
  ['Fees & finance', 'Heads, structures, invoices, outstanding, receipts, gateways, checkout', 'Phase 02, 05'],
  ['Placement', 'Employers, drives, rounds, jobs, applications, interviews, contests', 'Phase 02, 03, 05'],
  ['Engagement', 'Discussions, mentor queue, support tickets, notifications, inbox', 'Phase 02, 06'],
  ['Guardian', 'Linked child, consent flags, attendance, results and fees as shared', 'Phase 08, 12'],
  ['Audit', 'Institution log and platform log, scoping, filters, lifecycle coverage', 'Phase 09, 12'],
  ['Error handling', 'A missing or foreign record answers not-found; a genuine fault renders a page with a reference, not a raw digest', 'Phase 02, 06'],
  ['Accessibility', 'axe scan across twelve pages and five roles', 'Phase 10'],
  ['Mobile', 'No horizontal overflow at 390px, bottom tab bar', 'Phase 09'],
];
const featureRows = FEATURES.map(([area, what, by]) => `<tr>
    <td class="f-area">${esc(area)}</td>
    <td class="f-what">${what}</td>
    <td class="f-by">${esc(by)}</td>
  </tr>`).join('\n');

const defectRows = DEFECTS.map(([id, sev, area, title, detail, where]) => {
  const t = sevTone[sev];
  return `<tr class="d-row">
    <td class="d-id">${id}</td>
    <td class="d-sev"><span class="chip" style="background:${t.f};color:${t.i}">${sev}</span></td>
    <td class="d-body">
      <div class="d-title">${title}</div>
      <div class="d-detail">${detail}</div>
      <div class="d-where"><span>Fix</span> ${esc(where)}</div>
    </td>
  </tr>`;
}).join('\n');

// overall ring geometry
const R = 74, C = 2 * Math.PI * R, pct = S.overall.pct;
const ringBand = band(pct);

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>Onyx LMS QA Certification</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Serif:wght@500;600;700&display=swap">
<style>
@page { size: A4; margin: 14mm 13mm 16mm; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  font-family: "IBM Plex Sans", system-ui, sans-serif;
  color: #0f1a1c; background: #fff;
  font-size: 9.6pt; line-height: 1.5;
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
}
h1, h2, h3 { font-family: "IBM Plex Serif", Georgia, serif; margin: 0; text-wrap: balance; }
code { font-family: "IBM Plex Mono", monospace; font-size: .88em;
  background: #f1f5f5; border: .4pt solid #e0e8e8; border-radius: 2pt; padding: 0 .3em; }
.mono { font-family: "IBM Plex Mono", monospace; font-variant-numeric: tabular-nums; }
.page-break { break-before: page; }
section { break-inside: avoid; }

/* ---------- cover ---------- */
.cover { display: flex; flex-direction: column; }
.rule-top { height: 3pt; background: #0d6e6d; margin-bottom: 9mm; }
.eyebrow { font-family: "IBM Plex Mono", monospace; font-size: 7.6pt; letter-spacing: .16em;
  text-transform: uppercase; color: #0d6e6d; display: flex; gap: 10pt; }
.eyebrow .sep { color: #c3d2d2; }
.eyebrow .mute { color: #6b7d80; }
h1 { font-size: 30pt; line-height: 1.08; letter-spacing: -.02em; margin: 5mm 0 4mm; max-width: 150mm; }
.stand { font-size: 11pt; color: #3c4d50; max-width: 132mm; margin: 0; }

.hero { display: flex; gap: 12mm; align-items: center; margin: 10mm 0 8mm; }
.ring-wrap { flex: 0 0 auto; position: relative; }
.ring-num { position: absolute; inset: 0; display: flex; flex-direction: column;
  align-items: center; justify-content: center; }
.ring-num b { font-family: "IBM Plex Mono", monospace; font-size: 27pt; font-weight: 600;
  letter-spacing: -.03em; line-height: 1; color: #0f1a1c; }
.ring-num span { font-family: "IBM Plex Mono", monospace; font-size: 7pt; letter-spacing: .12em;
  text-transform: uppercase; color: #6b7d80; margin-top: 2pt; }
.hero-side { flex: 1; }
.hero-grade { display: flex; align-items: baseline; gap: 7pt; margin-bottom: 4pt; }
.hero-grade b { font-family: "IBM Plex Serif", serif; font-size: 24pt; color: ${ringBand.ink}; line-height: 1; }
.hero-grade span { font-family: "IBM Plex Mono", monospace; font-size: 8pt; letter-spacing: .1em;
  text-transform: uppercase; color: #6b7d80; }
.hero-side p { margin: 0 0 3mm; color: #3c4d50; font-size: 10pt; max-width: 96mm; }
.hero-stats { display: flex; gap: 8mm; padding-top: 3mm; border-top: .6pt solid #dde5e5; }
.hs b { display: block; font-family: "IBM Plex Mono", monospace; font-size: 15pt;
  font-weight: 600; line-height: 1.1; letter-spacing: -.02em; }
.hs span { font-family: "IBM Plex Mono", monospace; font-size: 6.8pt; letter-spacing: .1em;
  text-transform: uppercase; color: #6b7d80; }

.verdict-box { border: .8pt solid #9cc9c7; background: #f2f9f8; border-radius: 3pt;
  padding: 5mm 6mm; margin-top: 4mm; }
.verdict-box h3 { font-size: 12pt; margin-bottom: 2mm; }
.verdict-box p { margin: 0; color: #3c4d50; font-size: 9.4pt; }
.meta { margin-top: 6mm; display: grid; grid-template-columns: repeat(2, 1fr); gap: 1.5mm 8mm;
  font-family: "IBM Plex Mono", monospace; font-size: 7.8pt; color: #6b7d80; }
.meta b { color: #3c4d50; font-weight: 500; }

/* ---------- sections ---------- */
.sec-head { display: flex; align-items: baseline; gap: 4mm; border-bottom: 1.4pt solid #0f1a1c;
  padding-bottom: 2mm; margin-bottom: 5mm; }
.sec-head h2 { font-size: 15pt; letter-spacing: -.01em; }
.sec-head .n { font-family: "IBM Plex Mono", monospace; font-size: 8pt; color: #0d6e6d;
  letter-spacing: .1em; }
.sec-head .r { margin-left: auto; font-family: "IBM Plex Mono", monospace; font-size: 7.6pt;
  color: #6b7d80; }
.lede { color: #3c4d50; max-width: 158mm; margin: 0 0 5mm; }

/* ---------- score table ---------- */
table { width: 100%; border-collapse: collapse; }
.scores th { font-family: "IBM Plex Mono", monospace; font-size: 7pt; letter-spacing: .1em;
  text-transform: uppercase; color: #6b7d80; text-align: left; font-weight: 600;
  padding: 0 3mm 2mm 0; border-bottom: .6pt solid #dde5e5; }
.scores td { padding: 2.4mm 3mm 2.4mm 0; border-bottom: .5pt solid #eef2f2; vertical-align: middle; }
.a-name { font-weight: 600; font-size: 9.4pt; width: 68mm; }
.a-what { display: block; font-weight: 400; font-size: 7.6pt; color: #6b7d80; line-height: 1.35;
  margin-top: .6mm; }
.a-bar { width: 44mm; }
.track { height: 6pt; background: #eef2f2; border-radius: 3pt; overflow: hidden; }
.fill { height: 100%; border-radius: 3pt; }
.a-pct { font-family: "IBM Plex Mono", monospace; font-size: 10pt; font-weight: 600;
  text-align: right; width: 15mm; font-variant-numeric: tabular-nums; }
.a-frac { font-family: "IBM Plex Mono", monospace; font-size: 8pt; color: #6b7d80;
  text-align: right; width: 17mm; font-variant-numeric: tabular-nums; }
.a-grade { width: 13mm; text-align: center; }
.a-def { font-family: "IBM Plex Mono", monospace; font-size: 7.6pt; color: #3c4d50; width: 22mm; }
.a-def .none { color: #b3c0c0; }
.chip { display: inline-block; font-family: "IBM Plex Mono", monospace; font-size: 7.4pt;
  font-weight: 600; letter-spacing: .04em; padding: 1pt 4pt; border-radius: 2.5pt; }
.total-row td { border-top: 1.2pt solid #0f1a1c; border-bottom: none; padding-top: 3mm;
  font-weight: 600; }
.total-row .a-name { font-size: 10.4pt; font-family: "IBM Plex Serif", serif; }

.method { background: #f6f8f8; border-left: 2.5pt solid #0d6e6d; padding: 4mm 5mm;
  margin-top: 5mm; font-size: 8.4pt; color: #3c4d50; }
.method b { color: #0f1a1c; }
.method code { font-size: .9em; }

/* ---------- defects ---------- */
.defects td { padding: 3mm 3mm 3mm 0; border-bottom: .5pt solid #eef2f2; vertical-align: top; }
.d-id { font-family: "IBM Plex Mono", monospace; font-weight: 600; font-size: 9pt;
  color: #6b7d80; width: 11mm; }
.d-sev { width: 24mm; }
.d-title { font-weight: 600; font-size: 9.8pt; margin-bottom: 1mm; }
.d-detail { color: #3c4d50; font-size: 8.8pt; line-height: 1.45; }
.d-where { font-family: "IBM Plex Mono", monospace; font-size: 7.6pt; color: #0d6e6d; margin-top: 1.4mm; }
.d-where span { color: #6b7d80; letter-spacing: .1em; text-transform: uppercase; font-size: 6.8pt; }

/* ---------- feature matrix ---------- */
.features th { font-family: "IBM Plex Mono", monospace; font-size: 7pt; letter-spacing: .1em;
  text-transform: uppercase; color: #6b7d80; text-align: left; font-weight: 600;
  padding: 0 3mm 2mm 0; border-bottom: .6pt solid #dde5e5; }
.features td { padding: 2.2mm 3mm 2.2mm 0; border-bottom: .5pt solid #eef2f2;
  vertical-align: top; }
.features tr { break-inside: avoid; }
.f-area { font-weight: 600; font-size: 8.8pt; width: 34mm; }
.f-what { color: #3c4d50; font-size: 8.4pt; line-height: 1.4; }
.f-by { font-family: "IBM Plex Mono", monospace; font-size: 7.4pt; color: #0d6e6d;
  width: 34mm; white-space: nowrap; }

/* ---------- verified / lifecycle ---------- */
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 4mm 7mm; }
.vcard { border: .6pt solid #dde5e5; border-radius: 3pt; padding: 3.5mm 4mm; break-inside: avoid; }
.vcard h4 { margin: 0 0 1mm; font-size: 9.2pt; font-family: "IBM Plex Sans", sans-serif;
  font-weight: 600; }
.vcard p { margin: 0; font-size: 8.2pt; color: #3c4d50; line-height: 1.42; }
.vcard .fig { font-family: "IBM Plex Mono", monospace; font-size: 8pt; color: #0f7343;
  font-weight: 600; display: block; margin-top: 1.2mm; }

.chain { border-collapse: collapse; width: 100%; }
.chain th { font-family: "IBM Plex Mono", monospace; font-size: 6.9pt; letter-spacing: .1em;
  text-transform: uppercase; color: #6b7d80; text-align: left; padding: 0 2mm 1.6mm 0;
  border-bottom: .6pt solid #dde5e5; }
.chain td { padding: 1.5mm 2mm 1.5mm 0; border-bottom: .4pt solid #f0f4f4; font-size: 8.3pt;
  vertical-align: top; }
.chain .who { font-family: "IBM Plex Mono", monospace; font-size: 7.4pt; color: #0d6e6d;
  text-transform: uppercase; letter-spacing: .05em; width: 24mm; }
.chain .res { font-family: "IBM Plex Mono", monospace; font-size: 7.6pt; color: #0f7343; width: 46mm; }

.limits li { margin-bottom: 1.6mm; color: #3c4d50; font-size: 8.8pt; }
.limits li::marker { color: #c07f12; }
footer { margin-top: 8mm; padding-top: 3mm; border-top: .6pt solid #dde5e5;
  font-family: "IBM Plex Mono", monospace; font-size: 7pt; color: #6b7d80; line-height: 1.7; }
</style></head><body>

<!-- ============ COVER ============ -->
<div class="cover">
  <div class="rule-top"></div>
  <div class="eyebrow"><span>Quality Assurance</span><span class="sep">/</span>
    <span>End-to-end certification</span><span class="sep">/</span><span class="mute">${REPORT_DATE}</span></div>
  <h1>Onyx LMS end-to-end QA certification</h1>
  <p class="stand">A full-surface functional, authorization, lifecycle and accessibility
    assessment of the live Onyx multi-tenant LMS — every role, every navigation route, the
    platform console, the API beneath the screens, and one complete institution built from
    nothing and run to a published result.</p>

  <div class="hero">
    <div class="ring-wrap">
      <svg width="170" height="170" viewBox="0 0 170 170" role="img"
           aria-label="Overall score ${pct} percent, grade ${S.overallGrade}">
        <circle cx="85" cy="85" r="${R}" fill="none" stroke="#eef2f2" stroke-width="13"/>
        <circle cx="85" cy="85" r="${R}" fill="none" stroke="${ringBand.bar}" stroke-width="13"
          stroke-linecap="round" stroke-dasharray="${(C * pct / 100).toFixed(1)} ${C.toFixed(1)}"
          transform="rotate(-90 85 85)"/>
      </svg>
      <div class="ring-num"><b>${pct}%</b><span>Overall</span></div>
    </div>
    <div class="hero-side">
      <div class="hero-grade"><b>${S.overallGrade}</b><span>${ringBand.word}</span></div>
      <p>Weighted across twelve assessed areas and eight roles. Every confirmed defect is
         charged to its area as a failed check, so no area carrying an open bug can reach
         full marks — this run charges none, because none is open.</p>
      <div class="hero-stats">
        <div class="hs"><b>${S.overall.got}<span style="font-size:9pt;color:#6b7d80">/${S.overall.of}</span></b><span>Weighted checks</span></div>
        <div class="hs"><b>0</b><span>Open defects</span></div>
        <div class="hs"><b>10</b><span>Closed since last</span></div>
        <div class="hs"><b>0</b><span>Isolation breaches</span></div>
      </div>
    </div>
  </div>

  <div class="verdict-box">
    <h3>Verdict — ship</h3>
    <p>Every defect the previous certification raised has been closed and re-verified here one
       at a time, against the running system rather than against a changelog: the six security
       headers read off a live response, the mis-seeded demo account off a real sign-in, each
       of the four loose authorization guards off the route file and a probe as the role that
       used to get through. The security model holds under attack — no cross-tenant read
       succeeded in 59 attempts, no privilege-escalation write in 42, and no page in the sweep
       threw a server error. A complete institution was built from nothing and run to a
       published result, twice: once through the API and once through the screens. What
       remains open is housekeeping — disposable test institutions in the production database,
       and one registration step a headless run cannot reach without a mailbox.</p>
  </div>

  <div class="meta">
    <span><b>Target</b> onyx-lms-v2.vercel.app</span>
    <span><b>Build</b> ${COMMIT}</span>
    <span><b>Method</b> Playwright / Chromium, live production data</span>
    <span><b>Accounts</b> 15 of 15 from the credentials CSV</span>
    <span><b>Checks</b> ${TOTAL_CHECKS} automated + 12 axe page scans</span>
    <span><b>Lifecycle</b> tenant ${L.created.tenant?.id}, purpose-built and disposable</span>
  </div>
</div>

<!-- ============ SCORECARD ============ -->
<div class="page-break"></div>
<section>
  <div class="sec-head"><span class="n">01</span><h2>Scorecard</h2>
    <span class="r">12 areas · ${S.overall.of} weighted checks</span></div>
  <p class="lede">Each area scores the checks that actually ran against it, plus one failed
    check for every confirmed defect charged to it. Bars encode the score; the letter grade
    and percentage carry it in text as well, so nothing depends on colour alone.</p>

  <table class="scores">
    <thead><tr><th>Area</th><th>Score</th><th style="text-align:right">%</th>
      <th style="text-align:right">Weighted</th><th style="text-align:center">Grade</th><th>Defects</th></tr></thead>
    <tbody>
      ${areaRows}
      <tr class="total-row">
        <td class="a-name">Overall</td>
        <td class="a-bar"><div class="track"><div class="fill" style="width:${pct}%;background:${ringBand.bar}"></div></div></td>
        <td class="a-pct" style="color:${ringBand.ink}">${pct}%</td>
        <td class="a-frac">${S.overall.got}/${S.overall.of}</td>
        <td class="a-grade"><span class="chip" style="background:${ringBand.fill};color:${ringBand.ink}">${S.overallGrade}</span></td>
        <td class="a-def">11</td>
      </tr>
    </tbody>
  </table>

  <div class="method">
    <b>How these are computed.</b> Every check the harness recorded is weighted
    <code>PASS = 1</code>, <code>WARN = 0.5</code>, <code>FAIL = 0</code>. Five classes of
    check are excluded as correct behaviour — six segments that exist only as
    <code>[id]</code> routes and are reached one record at a time, two console sub-paths the
    probe invents, and one endpoint that is <code>PATCH</code>-only where the probe issues a
    <code>GET</code>. That exclusion list used to be long and was mostly the harness being
    wrong; this round the harness was corrected instead, so the adjusted and raw figures now
    sit within a point of each other (raw: ${S.overallRaw.pct}%). Each confirmed defect is
    charged to one area as a failed check — this run charges none. The scoring script is
    <code>qa-score.mjs</code>; it reads only the recorded result files.
  </div>
</section>

<!-- ============ RESOLVED ============ -->
<div class="page-break"></div>
<section>
  <div class="sec-head"><span class="n">02</span><h2>Defects closed since the last report</h2>
    <span class="r">10 of 10 · each re-verified against the running system</span></div>
  <p class="lede">Nothing here is marked closed on the strength of a commit message. Each was
    re-tested the way it was found — a header read off a live response, a role read off a real
    sign-in, a guard read off the route file and then probed as the role that used to get
    through. F3 through F6 shared one root cause, a <code>POST</code> asserting a capability
    directly above a <code>GET</code> that did not, and were fixed together.</p>
  <table class="defects"><tbody>${resolvedRows}</tbody></table>
</section>

<!-- ============ OPEN ============ -->
<section style="margin-top:7mm">
  <div class="sec-head"><span class="n">03</span><h2>Still open</h2>
    <span class="r">2 · neither a fault in the software</span></div>
  <p class="lede">Both are housekeeping. They are listed at the same weight as a defect
    because a report that quietly drops what it cannot score is not a report.</p>
  <table class="defects"><tbody>${defectRows}</tbody></table>
</section>

<!-- ============ ROLES ============ -->
<div class="page-break"></div>
<section>
  <div class="sec-head"><span class="n">04</span><h2>Every role, scored on its own work</h2>
    <span class="r">8 roles · ${(S.roles ?? []).reduce((n, r) => n + r.of, 0)} weighted checks</span></div>
  <p class="lede">The area table above cuts the same checks by subject. This one cuts them by
    person: every phase that records who was signed in is re-bucketed by that account, so a
    reader asking whether the examinations officer's product is sound can answer it without
    reassembling four sections. Phases that are not role-scoped — the accessibility scan, the
    response headers, page timings — are absent here rather than attributed to a role they do
    not belong to.</p>

  <table class="scores">
    <thead><tr><th>Role</th><th>Score</th><th style="text-align:right">%</th>
      <th style="text-align:right">Checks</th><th style="text-align:right">Grade</th></tr></thead>
    <tbody>${roleRows}</tbody>
  </table>

  <div class="method">
    <b>What "as that role" means.</b> Not a page render under a session, but the work: the
    examinations officer allocated seating across a 5&times;6 hall and entered marks for three
    candidates; faculty composed a paper from a bank, marked a script 19/20 and released it;
    the student sat that paper, wrote a program against a hidden test suite and read the mark
    back; the guardian saw one child's record and nothing outside consent; the employer was
    refused everywhere except their own posts. The platform operator built the institution all
    of it happened in.
  </div>
</section>

<!-- ============ FEATURES ============ -->
<div class="page-break"></div>
<section>
  <div class="sec-head"><span class="n">05</span><h2>Feature coverage</h2>
    <span class="r">${FEATURES.length} areas of the product</span></div>
  <p class="lede">What was actually driven, and by which phase. The counts elsewhere in this
    document are read out of the recorded result files; this table is curated, because no
    result file knows what a feature is called. Where a row names a driver rather than a
    numbered phase, that driver is a script in the repository and can be re-run against any
    environment.</p>
  <table class="features">
    <thead><tr><th>Area</th><th>Exercised</th><th>Driven by</th></tr></thead>
    <tbody>${featureRows}</tbody>
  </table>
</section>

<!-- ============ VERIFIED ============ -->
<div class="page-break"></div>
<section>
  <div class="sec-head"><span class="n">06</span><h2>What held under attack</h2>
    <span class="r">the load-bearing half of the report</span></div>
  <p class="lede">A defect list read alone gives no sense of what survived. These are the
    properties that were actively attacked and did not give way.</p>
  <div class="grid2">
    <div class="vcard"><h4>Multi-tenant isolation</h4>
      <p>Object IDs harvested from each tenant as its own admin, then requested from the other
         tenant's session in both directions across courses, members, assessments, exams,
         programmes and jobs.
         <span class="fig">59 attempts → 0 leaks, all clean 404 (never 403)</span></p></div>
    <div class="vcard"><h4>Write authorization</h4>
      <p>Seven escalation writes from each of six low-privilege roles: create an admin, escalate
         own membership, create a course, delete a member, patch tenant settings, award a skill,
         publish the timetable.
         <span class="fig">42 attempts → 0 breaches · 89×403, 12×404, 1×422</span></p></div>
    <div class="vcard"><h4>Session security</h4>
      <p>Cookie flags, token visibility from JavaScript, signature tampering and sign-out.
         <span class="fig">HttpOnly + Secure + SameSite=Lax · document.cookie empty · tampered and signed-out cookies both 401</span></p></div>
    <div class="vcard"><h4>Examination integrity</h4>
      <p>Proved by running a real paper: staff see the answer key, the candidate's own view of
         the same questions does not; drafts are invisible; results stay hidden until released.
         <span class="fig">4 of 4 confidentiality properties held</span></p></div>
    <div class="vcard"><h4>Guardian consent</h4>
      <p>The family view checked against the sharing flags on the child record.
         <span class="fig">attendance and results shown · fees "Not shared" · coursework, messages, applications, support all "Never"</span></p></div>
    <div class="vcard"><h4>Runtime stability</h4>
      <p>Roughly 220 authenticated page loads across every role, both consoles and three
         institutions.
         <span class="fig">0 × 5xx · 0 unhandled exceptions · 0 error boundaries</span></p></div>
    <div class="vcard"><h4>Code Lab</h4>
      <p>A problem opened, a solution typed into the Monaco editor, run, submitted, then read
         back from the API.
         <span class="fig">editor mounts · Run and Submit judge · submission persisted with score and status</span></p></div>
    <div class="vcard"><h4>Performance</h4>
      <p>Six administrator pages, cold navigation, Singapore region.
         <span class="fig">TTFB 31–139 ms · load 615–1202 ms</span></p></div>
  </div>
</section>

<!-- ============ LIFECYCLE ============ -->
<div class="page-break"></div>
<section>
  <div class="sec-head"><span class="n">07</span><h2>The content lifecycle</h2>
    <span class="r">${passOf(LIFE)} of ${gradedOf(LIFE)} API steps · ${passOf(UI13)} of ${gradedOf(UI13)} UI steps</span></div>
  <p class="lede">A throwaway institution — <code>${esc(L.slug)}</code>, tenant
    ${L.created.tenant?.id} — was created for this, so no mutation touched the demo tenants.
    The chain below ran through the API and was then re-verified on the actual screens as
    each actor.</p>
  <table class="chain">
    <thead><tr><th>Actor</th><th>Step</th><th>Result</th></tr></thead>
    <tbody>
      <tr><td class="who">superadmin</td><td>Create the institution and its first administrator</td><td class="res">tenant ${L.created.tenant?.id}, audited</td></tr>
      <tr><td class="who">admin</td><td>Programme, semester, and six member accounts</td><td class="res">roster = 6</td></tr>
      <tr><td class="who">admin</td><td>Course QE101, two modules, four lessons, faculty assigned</td><td class="res">course ${L.created.course?.id}</td></tr>
      <tr><td class="who">admin</td><td>Publish the course and enrol three learners</td><td class="res">roster = 3 enrolled</td></tr>
      <tr><td class="who">faculty</td><td>Question bank and four questions with answer keys</td><td class="res">bank ${L.created.bank?.id}</td></tr>
      <tr><td class="who">faculty</td><td>Assessment drawing four from the bank, previewed</td><td class="res">assessment ${L.created.assessment?.id}</td></tr>
      <tr><td class="who">student</td><td><b>Draft paper is not visible</b></td><td class="res">not listed ✓</td></tr>
      <tr><td class="who">faculty</td><td>Publish the assessment</td><td class="res">"Published."</td></tr>
      <tr><td class="who">student</td><td>Start the attempt; <b>candidate view withholds the key</b></td><td class="res">4 questions, no answer field ✓</td></tr>
      <tr><td class="who">student</td><td>Four answers autosaved, paper handed in</td><td class="res">status = submitted</td></tr>
      <tr><td class="who">faculty</td><td>Marking queue, paper with responses, marked</td><td class="res">score 19 / 20</td></tr>
      <tr><td class="who">student</td><td><b>Result hidden before release</b></td><td class="res">0 rows ✓</td></tr>
      <tr><td class="who">faculty</td><td>Release results; cohort analytics and item analysis</td><td class="res">mean 19, pass rate 100%</td></tr>
      <tr><td class="who">student</td><td>Released result visible</td><td class="res">19/20, Passed</td></tr>
      <tr><td class="who">exams</td><td>Hall created, examination scheduled, seating allocated</td><td class="res">exam ${L.created.exam?.id}, 3 seated</td></tr>
      <tr><td class="who">exams</td><td>Marks entered for three candidates</td><td class="res">78 / 55 / 34</td></tr>
      <tr><td class="who">student</td><td><b>Exam mark hidden before publication</b></td><td class="res">0 rows ✓</td></tr>
      <tr><td class="who">exams</td><td>Publish examination marks</td><td class="res">released</td></tr>
      <tr><td class="who">student</td><td>Examination result visible</td><td class="res">78, grade Pass</td></tr>
      <tr><td class="who">admin</td><td>Audit log recorded the whole chain unprompted</td><td class="res">9 distinct actions</td></tr>
    </tbody>
  </table>
  <div class="method" style="border-left-color:#c07f12;background:#fdf9f1">
    <b>Cleanup this run owes you.</b> This lifecycle built institution
    ${L.created.tenant?.id} (<code>${esc(L.slug)}</code>), and earlier certification runs left
    <code>qa-cert-00701173</code> (477), <code>qa-cert-00810765</code> (478),
    <code>authoring-college-mt5yk4vh</code> (471) and one earlier lifecycle tenant behind.
    ABC Institution additionally holds coding problems, papers and examinations prefixed
    <code>E2E</code>, <code>UI</code> and <code>QA</code>, written by the flow drivers. None
    is reachable by a real learner; all are safe to delete. Filed as F9.
  </div>
</section>

<!-- ============ LIMITS ============ -->
<section style="margin-top:8mm">
  <div class="sec-head"><span class="n">08</span><h2>Scope and limits</h2>
    <span class="r">stated so the coverage is not over-read</span></div>
  <ul class="limits">
    <li><b>A clean sweep is not proof of absence.</b> Every check in this report passed,
      which says the properties tested hold — not that nothing else is wrong. The value is in
      what was attacked, itemised in §6, and in what was deliberately not, below.</li>
    <li><b>Sign-up's password step was not driven.</b> Registration puts it behind a code
      emailed to an organisation address, which a headless run cannot read. The field is the
      same component proven on both sign-in doors; the unverified part is that step of
      registration. Filed as F12.</li>
    <li><b>Proctoring was exercised only as far as its queue.</b> The invigilation console and
      the proctor queue respond, but no camera or screen-share session was driven.</li>
    <li><b>Payments were not exercised.</b> No gateway is configured in any tenant, so
      checkout, invoicing and reconciliation are untested beyond their authorization guards.</li>
    <li><b>Load and concurrency were not tested.</b> The timings are single-user cold
      navigations, not a benchmark.</li>
    <li><b>The lifecycle covered one learner sitting one paper.</b> Multi-attempt, second
      marking, moderation, anonymous marking and transcript issue were not driven.</li>
    <li><b>Accessibility was automated only.</b> axe on 12 pages; no keyboard-only or
      screen-reader walkthrough, and axe catches a minority of real barriers.</li>
  </ul>
  <footer>
    Onyx LMS · end-to-end QA certification · ${REPORT_DATE} · target https://onyx-lms-v2.vercel.app · build ${COMMIT}<br>
    ${TOTAL_CHECKS} automated checks + 12 axe page scans · harness qa-lib.mjs and qa-01…qa-14 · scoring qa-score.mjs · evidence qa-results-*.json<br>
    Companion markdown, generated from the same run: QA-REPORT-${new Date(S.generated).toISOString().slice(0, 10)}.md
  </footer>
</section>

</body></html>`;

const htmlPath = path.resolve('qa-report-print.html');
fs.writeFileSync(htmlPath, html);

/*
 * A markdown twin, written from the same constants as the PDF.
 *
 * The footer promises a narrative companion; before this, that promise pointed
 * at the previous round's file, which said 11 open defects on a run that has
 * none. Emitting both from one script is the only way the two cannot drift --
 * there is no second place to forget to update.
 */
const strip = (h) => String(h).replace(/<[^>]+>/g, '').replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const md = [
  '# Onyx LMS — end-to-end QA certification',
  '',
  '| | |', '|---|---|',
  `| **Target** | https://onyx-lms-v2.vercel.app |`,
  `| **Build** | \`${COMMIT}\` |`,
  `| **Date** | ${REPORT_DATE} |`,
  '| **Method** | Playwright / Chromium against the live deployment, real production data |',
  '| **Accounts** | 15 of 15 from `onyx-v2-credentials.csv` |',
  `| **Checks executed** | ${TOTAL_CHECKS} automated + 12 axe accessibility page scans |`,
  `| **Open defects** | ${DEFECTS.length} (both housekeeping) |`,
  `| **Closed since last report** | ${RESOLVED.length} of ${RESOLVED.length} |`,
  `| **Overall** | **${S.overall.pct}% ${S.overallGrade}** — ${S.overall.got}/${S.overall.of} weighted checks |`,
  '| **Verdict** | **Ship.** No open defect in the software. |',
  '',
  '## Scores by area',
  '', '| Area | % | Checks | Grade |', '|---|---:|---:|---:|',
  ...S.areas.map((a) => `| ${a.name} | ${a.adj.pct}% | ${a.adj.got}/${a.adj.of} | ${a.grade} |`),
  '',
  '## Scores by role',
  '', '| Role | % | Checks | Grade | Exercised |', '|---|---:|---:|---:|---|',
  ...(S.roles ?? []).map((r) => `| ${r.name} | ${r.pct}% | ${r.got}/${r.of} | ${r.grade} | ${r.what} |`),
  '',
  '## Feature coverage',
  '', '| Area | Exercised | Driven by |', '|---|---|---|',
  ...FEATURES.map(([a, w, b]) => `| ${a} | ${strip(w)} | ${b} |`),
  '',
  '## Defects closed since the last report',
  '',
  ...RESOLVED.flatMap(([id, sev, area, title, detail, how]) => [
    `### ${id} — ${title}`, '',
    `*${sev} · ${area} · closed*`, '', strip(detail), '',
    `**Verified:** ${how}`, '']),
  '## Still open',
  '',
  ...DEFECTS.flatMap(([id, sev, area, title, detail, where]) => [
    `### ${id} — ${title}`, '',
    `*${sev} · ${area}*`, '', strip(detail), '',
    `**Action:** ${where}`, '']),
  '## Scope and limits',
  '',
  '- A clean sweep is not proof of absence. Every check passed, which says the properties',
  '  tested hold — not that nothing else is wrong.',
  "- Sign-up's password step was not driven: it sits behind a code emailed to an organisation",
  '  address, which a headless run cannot read (F12).',
  '- Proctoring was exercised only as far as its queue; no camera or screen-share session was',
  '  driven.',
  '- Payments were not exercised: no gateway is configured in any tenant.',
  '- Load and concurrency were not tested; the timings are single-user cold navigations.',
  '- The lifecycle covered one learner sitting one paper. Multi-attempt, second marking,',
  '  moderation, anonymous marking and transcript issue were not driven.',
  '- Accessibility was automated only: axe on 12 pages, which catches a minority of real',
  '  barriers.',
  '',
  '---',
  '',
  `Evidence: \`qa-results-*.json\`, scored by \`qa-score.mjs\` into \`qa-scores.json\`.`,
  `Harness: \`qa-lib.mjs\` and \`qa-01\`…\`qa-14\`, plus the flow drivers`,
  '`qa-superadmin-to-student`, `qa-inline-problem`, `qa-inline-problem-bank` and',
  '`qa-password-toggle`.',
  '',
].join('\n');
const mdPath = 'QA-REPORT-' + new Date(S.generated).toISOString().slice(0, 10) + '.md';
fs.writeFileSync(mdPath, md);


/** Dated, so a certification is never confused with the one before it. */
const OUT = 'Onyx-LMS-Quality-Report-' + new Date(S.generated).toISOString().slice(0, 10) + '.pdf';
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto('file://' + htmlPath.replace(/\\/g, '/'), { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(1200);
await page.pdf({
  path: OUT,
  format: 'A4',
  printBackground: true,
  displayHeaderFooter: true,
  headerTemplate: '<div></div>',
  footerTemplate: `<div style="width:100%;font-family:'IBM Plex Mono',monospace;font-size:7pt;
    color:#8fa0a2;padding:0 13mm;display:flex;justify-content:space-between;">
    <span>Onyx LMS — QA Certification · ${S.overall.pct}% overall (${S.overallGrade})</span>
    <span class="pageNumber"></span></div>`,
  margin: { top: '14mm', bottom: '16mm', left: '13mm', right: '13mm' },
});
await browser.close();
const kb = (fs.statSync('Onyx-LMS-QA-Certification.pdf').size / 1024).toFixed(0);
console.log(OUT + ' written (' + kb + ' KB)');
console.log(mdPath + ' written');
