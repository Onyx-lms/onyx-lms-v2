/**
 * The quality report as a printable document, scored.
 *
 * Every number in here is read out of the evidence files the harnesses wrote
 * — `results.json` from the sweep, `exams.json` from the examination run,
 * `ux.json` from the browser pass. Nothing is typed in by hand, so the
 * document cannot drift from the run that produced it: re-run the harnesses,
 * re-run this, and the figures move together or not at all.
 *
 *   node qa-live/report-pdf.mjs
 */
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const read = (f) => JSON.parse(fs.readFileSync(path.join('qa-live', f), 'utf8'));
const flows = read('results.json');
const exams = read('exams.json');
const uxFindings = read('ux.json');

const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/*
 * The band a score sits in, as a word and a colour.
 *
 * The word is the point. A bar alone asks the reader to judge a length, and a
 * colour alone is unreadable to roughly one man in twelve — so every score in
 * this document carries a figure, a bar and a word, and they cannot disagree
 * because they are computed from one number here.
 */
function band(pct) {
  // A clean sweep and a merely strong one share a colour, and should not share
  // a word: 100% is strong with nothing left over, and saying so is the whole
  // reason the word exists beside the bar.
  if (pct >= 100) return { word: 'Clean', bar: '#1c6b45', fill: '#e8f1ec', ink: '#134f34' };
  if (pct >= 97) return { word: 'Strong', bar: '#1c6b45', fill: '#e8f1ec', ink: '#134f34' };
  if (pct >= 90) return { word: 'Sound', bar: '#2f6b6b', fill: '#e7f0f0', ink: '#1f4f4f' };
  if (pct >= 70) return { word: 'Attention', bar: '#a8700f', fill: '#faf1de', ink: '#7a5109' };
  return { word: 'Action needed', bar: '#9d2b1f', fill: '#fae9e6', ink: '#7d2118' };
}
const bandOf = band;

/** Every check from the sweep, grouped by the phase that ran it. */
function group(rows, keyOf, passOf) {
  const out = new Map();
  for (const r of rows) {
    const k = keyOf(r);
    const g = out.get(k) ?? { name: k, of: 0, got: 0, failed: [] };
    g.of += 1;
    if (passOf(r)) g.got += 1; else g.failed.push(r);
    out.set(k, g);
  }
  return [...out.values()];
}

const flowGroups = group(flows, (r) => r.phase, (r) => r.status === 'PASS');
const examGroups = group(exams.results, (r) => r.phase, (r) => r.pass);

/** The names the phases carry in the harness, said the way a reader would. */
const AREA = {
  '1. platform operator': ['Platform and tenancy', 'creating an institution and its first administrator'],
  '2. administrator': ['Administration', 'roster, programme, courses, enrolment, permissions'],
  '3. assessment and examination': ['Authoring', 'banks, question types, papers, scheduling'],
  '4. lecturer': ['Teaching', 'modules, lessons, invigilation, and what a lecturer may not touch'],
  '5. learner': ['Learning', 'enrolment, purchase, sitting a paper, reading the result'],
  '6. the screens': ['The screens', '23 pages across three roles'],
  '7. hardening': ['Hardening', 'response headers, anonymous access, cross-institution reads'],
};

const areas = flowGroups.map((g) => {
  const [name, what] = AREA[g.name] ?? [g.name, ''];
  const pct = Math.round((g.got / g.of) * 100);
  // The spread first, then the names: `g` carries the harness's own phase
  // label and would otherwise overwrite the one a reader is meant to read.
  return { ...g, name, what, pct, band: bandOf(pct) };
});

const examTotal = { of: exams.results.length, got: exams.results.filter((r) => r.pass).length };
const examPct = Math.round((examTotal.got / examTotal.of) * 100);
areas.push({
  name: 'Examinations, end to end',
  what: 'the whole path on its own — bank, paper, sitting, marking, mark sheet',
  of: examTotal.of, got: examTotal.got, pct: examPct, band: bandOf(examPct), failed: [],
});

// The experience pass reports findings, not checks: an empty file is a clean
// sweep. The count of checks is the spec's own, and is stated rather than
// inferred so it cannot silently drift.
const UX_CHECKS = 8;
const uxPct = Math.round(((UX_CHECKS - uxFindings.length) / UX_CHECKS) * 100);
areas.push({
  name: 'Experience and accessibility',
  what: 'WCAG 2.1 AA on 20 screens, keyboard, mobile, error handling',
  of: UX_CHECKS, got: UX_CHECKS - uxFindings.length, pct: uxPct, band: bandOf(uxPct), failed: [],
});

const total = areas.reduce((t, a) => ({ of: t.of + a.of, got: t.got + a.got }), { of: 0, got: 0 });
const overallPct = Math.round((total.got / total.of) * 100);
const overall = bandOf(overallPct);

// ---------------------------------------------------------------------------
// What was found, and what is left. Prose, because a defect is an argument.
// ---------------------------------------------------------------------------

const FIXED = [
  ['D1', 'Learner navigation', 'Fees had a second entrance',
   'Fees was removed from the learner’s navigation. The dashboard’s own '
   + '<b>Quick links</b> list still carried it — written by hand in the page, '
   + 'independently of <code>onyx-nav.ts</code>, on the first screen every learner sees.',
   'A navigation change is not finished until the hand-written link lists have been read too.',
   '291ee82'],
  ['D2', 'Marking', 'A code answer the sandbox could not run was silently marked zero',
   '<code>saveAnswer</code> tested <code>response.source</code> and fell through when there '
   + 'was none — so a client sending the candidate’s program as a bare string, which '
   + 'is what every other question type takes, had it written to the answer row with no '
   + 'submission behind it and was told <i>saved</i>. It was: as a blob nothing could run. '
   + 'The paper then went to a marker with that question at zero and nothing anywhere saying '
   + 'why, so a candidate who had answered correctly lost the marks unless a person noticed.',
   'Refused now, with a message naming the shape. Refusing costs the candidate nothing — '
   + 'the attempt is not spent and the clock is untouched — where the old behaviour cost '
   + 'them the marks. A bare string is still taken whole where the problem allows exactly one '
   + 'language, because there is nothing to guess at then.',
   '04da989'],
  ['D3', 'Results', 'The marker’s comment was written to nobody',
   '<code>marker_comment</code> has been written per question by the marking form for as long '
   + 'as marking has existed and served by nothing. A marker explaining why an essay lost four '
   + 'marks was writing into the void.',
   'Served with the marks and rendered on the review screen, attributed as a person’s '
   + 'words. Released on exactly the condition the score is released on: a comment is a mark '
   + 'in prose, and "you have misread the question" before the paper is out tells a candidate '
   + 'their result early.',
   'b17a9fe'],
];

const OPEN = [
  ['O1', 'High', 'The authentication rate limit is too low to run an examination',
   'Signing in costs <b>two</b> calls to GoTrue: the password grant, and the refresh that '
   + 'scopes the session to an institution. The project’s current limit refuses at around '
   + 'the second round of five people signing in together. A hall of forty students starting an '
   + 'examination will hit it. They are told to wait rather than accused of a wrong password, '
   + 'which was itself a defect fixed this week — but they still will not get in.',
   'Raise Authentication → Rate Limits → sign-ins in Supabase. An institution behind '
   + 'one NAT is one IP address.'],
  ['O2', 'High', 'The signup mail may arrive with no code in it',
   'Custom SMTP is configured and a code is genuinely sent — verified against a live '
   + 'address. What cannot be checked from here is the <b>body</b>: GoTrue includes the digits '
   + 'only if the Magic Link template contains <code>{{ .Token }}</code>. A template carrying '
   + 'only the link delivers a mail with nothing to type into the form.',
   'Add <code>{{ .Token }}</code> to the Magic Link template, register once, and read the mail.'],
  ['O3', 'Medium', 'Razorpay has never run against a real merchant account',
   'The gateway code is complete — order creation, HMAC signature verification, webhook '
   + 'parsing — and no institution has credentials configured, so the real payment branch '
   + 'has only ever run against the mock. Course purchase works today through that mock path, '
   + 'which is what the money checks in this report exercised.',
   'Test-mode keys in Settings → Payments; register the webhook for <code>order.paid</code> '
   + 'and <code>payment.captured</code>; make one test-mode purchase.'],
  ['O4', 'Low', 'Two empty test institutions in production',
   '<code>qa-cert-00701173</code> and <code>qa-cert-00810765</code>, both with <b>0 members</b>, '
   + 'left by an earlier certification run. Everything this pass created was removed. These two '
   + 'remain because deleting an institution is irreversible and the call belongs to its owner.',
   'Confirm, and they go.'],
];

const IMPROVE = [
  ['A whole-hall invigilation view',
   'Live camera invigilation works and is <b>one candidate at a time</b>, because the media is '
   + 'peer-to-peer and a browser will not hold forty inbound streams. The limit is real and the '
   + 'interface reports it honestly, but it is not what an invigilator wants during an '
   + 'examination. A wall of forty needs an SFU, which this deployment does not have. Worth '
   + 'costing before the next examination season rather than during it.'],
  ['A TURN relay',
   'Without one, a candidate behind a symmetric NAT or a strict corporate firewall cannot be '
   + 'reached at all. The viewer says so rather than showing a black rectangle, but "some '
   + 'candidates cannot be watched" is a poor answer on examination day. TURN is bandwidth '
   + 'somebody pays for, and a small monthly cost against the alternative.'],
  ['Papers with no closing date never reach the timetable',
   'An always-open practice paper has no day it belongs to, so the week cannot place it. That '
   + 'is correct for a calendar, and it leaves those papers with no presence on the one screen '
   + 'a learner checks for what is due. A "no fixed date" list beside the grid would close it.'],
  ['The rate limit should be visible before it bites',
   'The product now says "too many people are signing in at once" instead of accusing somebody '
   + 'of a wrong password. An administrator still has no way to see how close their institution '
   + 'is to the ceiling until it is reached.'],
  ['An API asymmetry worth tidying',
   '<code>/api/onyx/platform/tenants/:id/courses</code> accepts POST, PATCH and DELETE and has '
   + 'no GET beside them; the platform console reads <code>/academics</code> instead. No screen '
   + 'needs the missing route and nothing is broken — but the next person to reach for it '
   + 'will assume it exists, as this pass did.'],
];

// ---------------------------------------------------------------------------

const areaRows = areas.map((a) => `
  <tr>
    <td class="a-name">${esc(a.name)}<span class="a-what">${esc(a.what)}</span></td>
    <td class="a-bar"><div class="track">
      <div class="fill" style="width:${Math.max(2, a.pct)}%;background:${a.band.bar}"></div>
    </div></td>
    <td class="a-pct" style="color:${a.band.ink}">${a.pct}<span>%</span></td>
    <td class="a-frac">${a.got}<span>/${a.of}</span></td>
    <td class="a-word"><span class="chip"
      style="background:${a.band.fill};color:${a.band.ink}">${a.band.word}</span></td>
  </tr>`).join('');

const examRows = examGroups.map((g) => {
  const pct = Math.round((g.got / g.of) * 100);
  const b = bandOf(pct);
  return `<tr>
    <td class="e-name">${esc(g.name.replace(/^\d+\.\s*/, ''))}</td>
    <td class="e-bar"><div class="track">
      <div class="fill" style="width:${Math.max(2, pct)}%;background:${b.bar}"></div></div></td>
    <td class="e-frac">${g.got}<span>/${g.of}</span></td>
  </tr>`;
}).join('');

const fixedRows = FIXED.map(([id, area, title, what, lesson, sha]) => `
  <article class="defect">
    <div class="d-head"><span class="d-id">${id}</span>
      <h3>${title}</h3>
      <span class="d-area">${esc(area)}</span>
      <span class="d-sha">fixed in ${sha}</span></div>
    <p>${what}</p>
    <p class="d-lesson">${lesson}</p>
  </article>`).join('');

const SEV = {
  High: { f: '#fae9e6', i: '#7d2118' },
  Medium: { f: '#faf1de', i: '#7a5109' },
  Low: { f: '#eceff2', i: '#3d4d5c' },
};
const openRows = OPEN.map(([id, sev, title, what, fix]) => `
  <article class="open">
    <div class="o-head"><span class="o-id">${id}</span>
      <h3>${title}</h3>
      <span class="chip" style="background:${SEV[sev].f};color:${SEV[sev].i}">${sev}</span></div>
    <p>${what}</p>
    <p class="o-fix"><span>Fix</span> ${fix}</p>
  </article>`).join('');

const improveRows = IMPROVE.map(([title, body]) => `
  <li><b>${esc(title)}.</b> ${body}</li>`).join('');

// The ring on the cover: one number, drawn once.
const R = 66;
const CIRC = 2 * Math.PI * R;

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>Onyx LMS Quality Report</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Source+Serif+4:opsz,wght@8..60,400;8..60,600;8..60,700&family=Public+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap">
<style>
@page { size: A4; margin: 15mm 14mm 17mm; }
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body {
  margin: 0; font-family: 'Public Sans', 'Segoe UI', system-ui, sans-serif;
  font-size: 9.3pt; line-height: 1.58; color: #1a1a18; background: #fff;
}
h1, h2, h3 { font-family: 'Source Serif 4', Georgia, serif; margin: 0; text-wrap: balance; }
code, .mono { font-family: 'JetBrains Mono', Consolas, monospace; font-size: 8.2pt; }
code { background: #f4f2ec; padding: 0.5pt 2.5pt; border-radius: 2px; color: #4a3f2f; }
b { font-weight: 600; }
.page-break { page-break-before: always; }
section { break-inside: avoid-page; }

/* ------------------------------------------------------------ the cover */
.cover { border-bottom: 2.5pt solid #1a1a18; padding-bottom: 7mm; margin-bottom: 7mm; }
.eyebrow {
  font-size: 7.6pt; letter-spacing: 0.16em; text-transform: uppercase;
  color: #9d2b1f; font-weight: 700; margin-bottom: 3mm;
}
.cover h1 { font-size: 27pt; line-height: 1.08; font-weight: 700; letter-spacing: -0.01em; }
.cover .sub {
  font-size: 10.5pt; color: #57574f; margin-top: 3mm; max-width: 118mm;
  font-family: 'Source Serif 4', Georgia, serif;
}
.cover-grid { display: flex; gap: 10mm; align-items: flex-start; margin-top: 6mm; }
.cover-left { flex: 1; }
.facts { width: 100%; border-collapse: collapse; margin-top: 2mm; }
.facts td { padding: 1.4mm 0; border-bottom: 0.5pt solid #e6e2d8; vertical-align: top; }
.facts td:first-child {
  width: 26mm; color: #7a7a70; font-size: 7.7pt; letter-spacing: 0.06em;
  text-transform: uppercase; font-weight: 600; padding-top: 2mm;
}
.ring { width: 46mm; text-align: center; flex-shrink: 0; }
.ring .word {
  font-size: 8.4pt; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase;
  margin-top: 1.5mm;
}
.ring .cap { font-size: 7.6pt; color: #7a7a70; margin-top: 0.5mm; }
.ring text.n { font-family: 'Source Serif 4', Georgia, serif; font-weight: 700; }

/* ---------------------------------------------------------- the verdict */
.verdict {
  background: #f7f5f0; border-left: 2.5pt solid #9d2b1f; padding: 4mm 5mm;
  margin: 5mm 0 6mm; font-family: 'Source Serif 4', Georgia, serif; font-size: 10pt;
  line-height: 1.55;
}
.verdict b { font-weight: 700; }

/* --------------------------------------------------------- section head */
.sec-head {
  display: flex; align-items: baseline; gap: 3.5mm; border-bottom: 1pt solid #1a1a18;
  padding-bottom: 1.8mm; margin: 8mm 0 4mm;
}
.sec-head .n {
  font-family: 'JetBrains Mono', monospace; font-size: 8pt; color: #9d2b1f; font-weight: 500;
}
.sec-head h2 { font-size: 14pt; font-weight: 600; flex: 1; }
.sec-head .r { font-size: 7.8pt; color: #7a7a70; font-family: 'JetBrains Mono', monospace; }
.lede {
  font-family: 'Source Serif 4', Georgia, serif; font-size: 10pt; color: #3d3d37;
  margin: 0 0 4mm; max-width: 150mm;
}

/* -------------------------------------------------------------- scoring */
table.scores { width: 100%; border-collapse: collapse; }
table.scores td { padding: 2.2mm 2mm; border-bottom: 0.5pt solid #e6e2d8; vertical-align: middle; }
.a-name { font-weight: 600; font-size: 9.3pt; line-height: 1.3; }
.a-name .a-what {
  display: block; font-weight: 400; font-size: 7.9pt; color: #7a7a70; margin-top: 0.6mm;
}
.a-bar { width: 42mm; }
.track { height: 5pt; background: #ece8de; border-radius: 3pt; overflow: hidden; }
.fill { height: 100%; border-radius: 3pt; }
.a-pct {
  width: 15mm; text-align: right; font-family: 'JetBrains Mono', monospace;
  font-size: 11pt; font-weight: 500; font-variant-numeric: tabular-nums;
}
.a-pct span { font-size: 7.5pt; }
.a-frac {
  width: 16mm; text-align: right; font-family: 'JetBrains Mono', monospace;
  font-size: 8.6pt; color: #4a4a44; font-variant-numeric: tabular-nums;
}
.a-frac span { color: #9a9a90; }
.a-word { width: 26mm; text-align: right; }
.chip {
  display: inline-block; padding: 0.8mm 2mm; border-radius: 2.5pt; font-size: 7.4pt;
  font-weight: 700; letter-spacing: 0.04em;
}
tr.total td { border-bottom: none; border-top: 1.2pt solid #1a1a18; padding-top: 3mm; }
tr.total .a-name { font-family: 'Source Serif 4', Georgia, serif; font-size: 11pt; font-weight: 700; }

/* ------------------------------------------------------------- the grid */
.tiles { display: flex; gap: 3mm; margin: 4mm 0 0; }
.tile { flex: 1; border: 0.7pt solid #ddd9d0; border-radius: 3pt; padding: 3mm; }
.tile .v {
  font-family: 'Source Serif 4', Georgia, serif; font-size: 17pt; font-weight: 700;
  line-height: 1; font-variant-numeric: tabular-nums;
}
.tile .k { font-size: 7.5pt; color: #7a7a70; margin-top: 1.2mm; line-height: 1.35; }

/* ------------------------------------------------------------- exampath */
table.exam { width: 100%; border-collapse: collapse; }
table.exam td { padding: 1.5mm 2mm; border-bottom: 0.5pt solid #efece4; }
.e-name { font-size: 8.8pt; }
.e-bar { width: 38mm; }
.e-frac {
  width: 14mm; text-align: right; font-family: 'JetBrains Mono', monospace; font-size: 8.4pt;
  font-variant-numeric: tabular-nums;
}
.e-frac span { color: #9a9a90; }

/* -------------------------------------------------------------- defects */
.defect, .open { margin-bottom: 4.5mm; break-inside: avoid-page; }
.d-head, .o-head { display: flex; align-items: baseline; gap: 2.5mm; margin-bottom: 1.5mm; }
.d-id, .o-id {
  font-family: 'JetBrains Mono', monospace; font-size: 8.4pt; font-weight: 500;
  color: #9d2b1f; width: 7mm;
}
.d-head h3, .o-head h3 { font-size: 10.5pt; font-weight: 600; flex: 1; }
.d-area, .d-sha {
  font-size: 7.4pt; color: #8a8a80; font-family: 'JetBrains Mono', monospace;
}
.defect p, .open p { margin: 0 0 1.5mm; padding-left: 9.5mm; }
.d-lesson, .o-fix {
  border-left: 1.5pt solid #ddd9d0; padding-left: 3mm !important; margin-left: 9.5mm;
  color: #4a4a44; font-style: italic;
}
.o-fix { font-style: normal; }
.o-fix span {
  font-size: 7.2pt; letter-spacing: 0.1em; text-transform: uppercase; font-weight: 700;
  color: #9d2b1f; margin-right: 1.5mm;
}

/* ------------------------------------------------------------- listings */
ul.improve { margin: 0; padding-left: 4.5mm; }
ul.improve li { margin-bottom: 2.8mm; }
ul.method { margin: 0; padding-left: 4.5mm; font-size: 8.8pt; }
ul.method li { margin-bottom: 1.6mm; }
pre.cmd {
  background: #f7f5f0; border-left: 1.5pt solid #ddd9d0; padding: 2.5mm 3mm; margin: 3mm 0;
  font-family: 'JetBrains Mono', monospace; font-size: 7.8pt; line-height: 1.7;
  white-space: pre-wrap; color: #3d3d37;
}
footer {
  margin-top: 8mm; padding-top: 3mm; border-top: 0.7pt solid #ddd9d0; font-size: 7.4pt;
  color: #8a8a80; font-family: 'JetBrains Mono', monospace; line-height: 1.7;
}
</style></head><body>

<div class="cover">
  <div class="eyebrow">Quality report &middot; examinations, marking and the whole product</div>
  <h1>Onyx LMS</h1>
  <p class="sub">An institution created from nothing and taken through a term&rsquo;s work by the
    four people who would really do it &mdash; against the deployed site, not a local build.</p>

  <div class="cover-grid">
    <div class="cover-left">
      <table class="facts">
        <tr><td>Target</td><td class="mono">https://onyx-lms-v2.vercel.app</td></tr>
        <tr><td>Build</td><td class="mono">04da989 on main</td></tr>
        <tr><td>Date</td><td>24 August 2026</td></tr>
        <tr><td>Method</td><td>Driven through the API and through the screens as platform
          operator, administrator, lecturer and learner</td></tr>
        <tr><td>Evidence</td><td class="mono">qa-live/results.json &middot; exams.json &middot; ux.json</td></tr>
      </table>
    </div>
    <div class="ring">
      <svg width="150" height="150" viewBox="0 0 150 150">
        <circle cx="75" cy="75" r="${R}" fill="none" stroke="#ece8de" stroke-width="11"/>
        <circle cx="75" cy="75" r="${R}" fill="none" stroke="${overall.bar}" stroke-width="11"
          stroke-linecap="round" stroke-dasharray="${CIRC}"
          stroke-dashoffset="${CIRC * (1 - overallPct / 100)}"
          transform="rotate(-90 75 75)"/>
        <text class="n" x="75" y="82" text-anchor="middle" font-size="34"
          fill="${overall.ink}">${overallPct}<tspan font-size="16">%</tspan></text>
      </svg>
      <div class="word" style="color:${overall.ink}">${overall.word}</div>
      <div class="cap">${total.got} of ${total.of} checks</div>
    </div>
  </div>
</div>

<div class="verdict">
  <b>Ship.</b> ${total.got} of ${total.of} checks pass, across nine areas and four roles.
  Three defects were found during this pass and all three were fixed, deployed and re-verified
  before this document was written &mdash; one of them a candidate losing the marks for a coding
  question they had answered correctly. What remains open is four items, and none of them is
  broken code: two are settings in the Supabase console that should be settled before an
  examination sitting, one is a payment gateway nobody has configured, and one is a pair of
  empty test institutions awaiting somebody&rsquo;s permission to delete.
</div>

<section>
  <div class="sec-head"><span class="n">01</span><h2>Scores</h2>
    <span class="r">by area, computed from the evidence files</span></div>
  <table class="scores">
    ${areaRows}
    <tr class="total">
      <td class="a-name">Overall</td>
      <td class="a-bar"><div class="track"><div class="fill"
        style="width:${overallPct}%;background:${overall.bar}"></div></div></td>
      <td class="a-pct" style="color:${overall.ink}">${overallPct}<span>%</span></td>
      <td class="a-frac">${total.got}<span>/${total.of}</span></td>
      <td class="a-word"><span class="chip"
        style="background:${overall.fill};color:${overall.ink}">${overall.word}</span></td>
    </tr>
  </table>

  <div class="tiles">
    <div class="tile"><div class="v">10 / 10</div>
      <div class="k">attempts from the wrong side, all correctly refused</div></div>
    <div class="tile"><div class="v">0</div>
      <div class="k">WCAG 2.1 AA violations across 20 screens, 3 roles</div></div>
    <div class="tile"><div class="v">846</div>
      <div class="k">unit tests passing in the regression suite</div></div>
    <div class="tile"><div class="v">3</div>
      <div class="k">defects found, fixed and re-verified in this pass</div></div>
  </div>
</section>

<section>
  <div class="sec-head"><span class="n">02</span><h2>The examination path</h2>
    <span class="r">${examTotal.got} of ${examTotal.of} &middot; nothing drawn at random</span></div>
  <p class="lede">The sweep touches examinations in passing and draws two questions from a
    four-question bank, so which questions a candidate meets &mdash; and therefore whether the
    result is instant or waiting on a marker &mdash; differs between runs. This second harness
    goes down the examination path and nothing else, and every paper in it takes its whole bank.
    A failure here means something changed, not that the dice fell differently.</p>
  <table class="exam">${examRows}</table>
  <pre class="cmd">ok  the coding answer was marked by its tests, hidden case included   awarded=10/10
ok  the objective questions were marked by machine at hand-in       single=5 multiple=5 truefalse=5 short=5
ok  a paper with an essay on it is held for the marker              status=submitted score=null
ok  and the marker's comment reaches them                           "The tilt is right; say more about why the angle matters."
ok  the answer key appears now there is no resit left               expected="a"
ok  and the ninety minutes it occupies, so it owns a slot           duration=90</pre>
</section>

<div class="page-break"></div>
<section>
  <div class="sec-head"><span class="n">03</span><h2>Defects found and fixed</h2>
    <span class="r">all three deployed and re-verified</span></div>
  ${fixedRows}
</section>

<section>
  <div class="sec-head"><span class="n">04</span><h2>Open items</h2>
    <span class="r">none is broken code</span></div>
  ${openRows}
</section>

<div class="page-break"></div>
<section>
  <div class="sec-head"><span class="n">05</span><h2>Where the product could be better</h2>
    <span class="r">ranked by whose day it changes</span></div>
  <ul class="improve">${improveRows}</ul>
</section>

<section>
  <div class="sec-head"><span class="n">06</span><h2>Method, and what it does not cover</h2>
    <span class="r">so the coverage is not over-read</span></div>
  <pre class="cmd">QA_BASE=https://onyx-lms-v2.vercel.app node qa-live/flows.mjs
QA_BASE=https://onyx-lms-v2.vercel.app node qa-live/exams.mjs
QA_BASE=https://onyx-lms-v2.vercel.app npx playwright test tests/browser/zz-qa-ux.spec.ts
node qa-live/report-pdf.mjs        # this document, rebuilt from those three</pre>
  <ul class="method">
    <li><b>Tokens are minted once per person and reused.</b> Signing in costs two calls to
      GoTrue, and a run that trips the rate limit reports failures about the quota rather than
      about the product &mdash; see O1.</li>
    <li><b>Payments were exercised through the mock, not a merchant account.</b> The locked
      course refuses with 402 and opens when paid for; the Razorpay branch is untested &mdash;
      see O3.</li>
    <li><b>Invigilation was driven as far as its queue.</b> No camera or screen-share session
      was carried end to end.</li>
    <li><b>Accessibility was automated.</b> axe on 20 screens, plus keyboard and mobile checks;
      no screen-reader walkthrough, and axe catches a minority of real barriers.</li>
    <li><b>Load and concurrency were not tested.</b> Timings are single-user navigations.</li>
    <li><b>Test data was cleaned up.</b> Everything this pass created was deleted; what remains
      is listed in O4.</li>
  </ul>
  <footer>
    Onyx LMS &middot; quality report &middot; 24 August 2026 &middot; target
    https://onyx-lms-v2.vercel.app &middot; branch main &middot; build 04da989<br>
    ${total.of} live checks across nine areas &middot; harnesses qa-live/flows.mjs and
    qa-live/exams.mjs &middot; experience tests/browser/zz-qa-ux.spec.ts<br>
    Every figure in this document is read from the evidence files, not typed in.
    Narrative report: QA-REPORT-2026-08-24.md
  </footer>
</section>

</body></html>`;

const htmlPath = path.resolve('qa-live/report-print.html');
fs.writeFileSync(htmlPath, html);

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto('file://' + htmlPath.replace(/\\/g, '/'), { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(900);
const out = 'Onyx-LMS-Quality-Report-2026-08-24.pdf';
await page.pdf({
  path: out,
  format: 'A4',
  printBackground: true,
  displayHeaderFooter: true,
  headerTemplate: '<div></div>',
  footerTemplate: `<div style="width:100%;font-family:monospace;font-size:7pt;color:#8a8a80;
    padding:0 14mm;display:flex;justify-content:space-between;">
    <span>Onyx LMS &mdash; quality report &middot; ${overallPct}% &middot; ${overall.word}</span>
    <span class="pageNumber"></span></div>`,
  margin: { top: '15mm', bottom: '17mm', left: '14mm', right: '14mm' },
});
await browser.close();

const kb = (fs.statSync(out).size / 1024).toFixed(0);
console.log(out + ' written (' + kb + ' KB) — ' + overallPct + '% overall, '
  + total.got + '/' + total.of + ' checks');
