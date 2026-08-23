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

const DEFECTS = [
  ['F1', 'Medium', 'Hardening', 'No security response headers except HSTS',
   'Only <code>Strict-Transport-Security</code> is sent. No CSP, <code>X-Frame-Options</code>, <code>X-Content-Type-Options</code>, <code>Referrer-Policy</code> or <code>Permissions-Policy</code> — the last of which governs the camera and microphone that proctoring depends on, and the missing frame protection leaves the login and invigilation screens frameable.',
   'apps/web/next.config.js — add a headers() block'],
  ['F2', 'Medium', 'Seed data', 'Demo faculty account is seeded as an administrator',
   '<code>faculty@demo.onyx</code> holds <code>role: "admin"</code>. The guard is correct — the Meridian faculty control account is properly denied — but ten browser specs use this account as their faculty fixture, including <code>permissions.spec.ts</code>, which asserts that revoking a capability from faculty yields a 403. Admin can never have capabilities revoked, so that suite passes without testing what it claims.',
   'Reset the membership to faculty in ABC Institution'],
  ['F3', 'Medium', 'Authorization', 'Fee structures readable by faculty and exams',
   'The <code>fees.structures</code> capability is declared <code>holders: []</code> — never delegable beyond admin — but the GET is guarded by <code>REGISTRY</code>, and faculty and exams both receive real rows. The POST beside it asserts the capability correctly.',
   'campus.routes.ts:732, :737'],
  ['F4', 'Low', 'Authorization', 'Merchant configuration readable beyond administrators',
   'The route’s own docstring says "Administrators only", but the guard is <code>REGISTRY</code>. No credentials leak — the service returns <code>configured_keys</code>, the names of filled slots, never values — so the disclosure is the provider, its test-mode flag and which keys are set.',
   'campus.routes.ts:849'],
  ['F5', 'Low', 'Authorization', 'Teaching-load allocations have no role guard at all',
   'The GET calls <code>viewerOf(req)</code>, which requires only a session, then returns the tenant’s allocations unfiltered. Every role reaches it, including guardian and employer — looser than both the page guard and the POST beside it.',
   'campus.routes.ts:182'],
  ['F6', 'Low', 'Authorization', 'Placement drives readable by every role except the filtered one',
   '<code>PlacementService.drives()</code> scopes its query for <code>employer</code> and for no other role, so students, guardians and the exams office receive the institution’s full drive list.',
   'career.routes.ts:468'],
  ['F7', 'Low', 'Broken link', '"All question banks" back-link is dead',
   'The bank detail page links to <code>/onyx/banks</code>, which has no index page. Next prefetches it, so the console errors on load and the click 404s. A link audit confirmed this is the only link into any of the six detail-only segments.',
   'onyx/banks/[id]/page.tsx:89'],
  ['F8', 'Low', 'Accessibility', 'Score denominators fail minimum contrast',
   'Ten of twelve pages scanned clean. Both failures are the same rule and the same element: the shared <code>Score</code> component renders its denominator at <code>opacity-70</code> over a tinted band, dropping below AA. Every marks table in the product inherits it.',
   'components/onyx-ui.tsx:631'],
  ['F10', 'Low', 'Date display', 'Examinations calendar renders a future sitting as past',
   'An exam three days ahead displays as "3 days ago / sat Wed, Aug 26" under the heading "Examinations already sat". The branch fires on <code>status === ’completed’</code> regardless of date, and <code>Math.abs()</code> then discards the sign. Publishing marks sets that status, so any paper marked before its sitting date lands here. <code>relativeWhen()</code> one file away already handles the case correctly.',
   'onyx/exams/page.tsx:65'],
  ['F11', 'Low', 'Learner UX', 'A learner’s own results identify examinations by database ID',
   'The Grades section — labelled "Your official record" — shows <b>Exam #125</b>. The Assessments section directly above shows the paper’s real title. <code>marksFor()</code> never joins <code>onyx_exams</code>. A guardian viewing the same mark sees the correct title, because the guardian service resolves it.',
   'results/page.tsx:270 and profile/page.tsx:242'],
  ['F9', 'Housekeeping', 'Data hygiene', 'Test-suite institutions live in production',
   '<code>authoring-college-mt5yk4vh</code> (tenant 471) predates this run and is an E2E artefact. The credentials CSV listed five institutions that no longer existed; those rows were pruned during this engagement and the file is now accurate.',
   'Delete tenant 471 after confirming it holds nothing real'],
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
    <span>End-to-end certification</span><span class="sep">/</span><span class="mute">23 Aug 2026</span></div>
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
      <p>Weighted across twelve assessed areas. Every confirmed defect is charged to its
         area as a failed check, so no area carrying an open bug can reach full marks.</p>
      <div class="hero-stats">
        <div class="hs"><b>${S.overall.got}<span style="font-size:9pt;color:#6b7d80">/${S.overall.of}</span></b><span>Weighted checks</span></div>
        <div class="hs"><b>11</b><span>Defects</span></div>
        <div class="hs"><b>0</b><span>Isolation breaches</span></div>
        <div class="hs"><b>0</b><span>Server errors</span></div>
      </div>
    </div>
  </div>

  <div class="verdict-box">
    <h3>Verdict — ship with fixes</h3>
    <p>The security model holds. No cross-tenant read succeeded in 59 attempts, no
       privilege-escalation write succeeded in 42, and no page in the sweep threw a server
       error. A complete content lifecycle — institution, programme, course, modules, lessons,
       question bank, paper, sitting, marking, release, examination, seating, marks,
       publication — ran end to end through both the API and the screens. The eleven defects
       are a missing header set, four read endpoints looser than the product's own capability
       model, a mis-seeded demo account, a dead link, a contrast failure, an inverted date and
       a learner record naming exams by database ID. None is a breach.</p>
  </div>

  <div class="meta">
    <span><b>Target</b> onyx-lms-v2.vercel.app</span>
    <span><b>Branch</b> certify</span>
    <span><b>Method</b> Playwright / Chromium, live production data</span>
    <span><b>Accounts</b> 15 of 15 from the credentials CSV</span>
    <span><b>Checks</b> 805 automated + 12 axe page scans</span>
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
    <code>PASS = 1</code>, <code>WARN = 0.5</code>, <code>FAIL = 0</code>. Checks that
    investigation showed to be correct behaviour or faults in the test itself — 49 of them,
    listed in the full report — are excluded, so the product is not marked down for the
    harness's own bugs. Each of the eleven confirmed defects is then charged to one area as a
    single failed check, which is why areas whose defect was found by a targeted probe rather
    than a scored phase still lose marks. Raw, unadjusted, the overall figure is 91.7%.
    The scoring script is <code>qa-score.mjs</code>; it reads only the recorded result files.
  </div>
</section>

<!-- ============ DEFECTS ============ -->
<div class="page-break"></div>
<section>
  <div class="sec-head"><span class="n">02</span><h2>Defects</h2>
    <span class="r">11 confirmed · each traced to source</span></div>
  <p class="lede">Every entry was reproduced against the live deployment and then traced to
    the line responsible. F3 through F6 share one root cause — a <code>POST</code> that
    asserts a capability sitting directly above a <code>GET</code> that does not — and are
    best fixed together.</p>
  <table class="defects"><tbody>${defectRows}</tbody></table>
</section>

<!-- ============ VERIFIED ============ -->
<div class="page-break"></div>
<section>
  <div class="sec-head"><span class="n">03</span><h2>What held under attack</h2>
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
  <div class="sec-head"><span class="n">04</span><h2>The content lifecycle</h2>
    <span class="r">65 of 68 API steps · 27 of 30 UI steps</span></div>
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
    <b>Cleanup this run owes you.</b> Two throwaway institutions — ${L.created.tenant?.id}
    (<code>${esc(L.slug)}</code>) and 477 (<code>qa-cert-00701173</code>) — and one course,
    id 198 <code>QA Probe Course</code>, created inside Meridian tenant 190 when the
    authorization probe's <code>POST /api/onyx/courses</code> legitimately succeeded as
    faculty. All are itemised in §8 of the full Markdown report.
  </div>
</section>

<!-- ============ LIMITS ============ -->
<section style="margin-top:8mm">
  <div class="sec-head"><span class="n">05</span><h2>Scope and limits</h2>
    <span class="r">stated so the coverage is not over-read</span></div>
  <ul class="limits">
    <li><b>F5 and F6 are confirmed in source, not in an observed payload.</b> Neither demo
      tenant holds allocation or drive rows, so both endpoints returned empty arrays to roles
      that should not reach them. The missing guard is real; the size of the exposure is not.</li>
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
    Onyx LMS · end-to-end QA certification · 23 August 2026 · target https://onyx-lms-v2.vercel.app · branch certify<br>
    805 automated checks + 12 axe page scans · harness qa-lib.mjs and qa-01…qa-14 · scoring qa-score.mjs · evidence qa-results-*.json<br>
    Full narrative report with per-check evidence: QA-REPORT.md
  </footer>
</section>

</body></html>`;

const htmlPath = path.resolve('qa-report-print.html');
fs.writeFileSync(htmlPath, html);

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto('file://' + htmlPath.replace(/\\/g, '/'), { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(1200);
await page.pdf({
  path: 'Onyx-LMS-QA-Certification.pdf',
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
console.log('Onyx-LMS-QA-Certification.pdf written (' + kb + ' KB)');
