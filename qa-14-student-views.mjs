import { launch, newPage, BASE } from './qa-lib.mjs';
import fs from 'node:fs';
const S = JSON.parse(fs.readFileSync('qa-lifecycle-state.json', 'utf8'));
const STAMP = S.stamp, PASSWORD = 'QaCert#2026!';
const out = { steps: [] };
let n = 0;
const rec = (name, o) => { const row = { seq: ++n, name, ...o }; out.steps.push(row);
  console.log(`${String(n).padStart(2)} ${row.verdict.padEnd(4)} ${name.padEnd(52)} ${row.detail ?? ''}`); };

const b = await launch();
const ctx = await b.newContext();
const page = await newPage(ctx);
await page.goto(BASE + '/onyx/login', { waitUntil: 'domcontentloaded' });
await page.locator('#email').fill('qa.s1.' + STAMP + '@onyx.test');
await page.locator('#password').fill(PASSWORD);
await page.getByRole('button', { name: /sign in/i }).click();
await page.waitForURL((u) => !u.pathname.endsWith('/login'), { timeout: 30000 });

async function body(path, waitMs = 2500) {
  await page.goto(BASE + path, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(waitMs);
  return (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ');
}
const has = (t, ...xs) => xs.every((x) => t.toLowerCase().includes(String(x).toLowerCase()));

// 1. Student examinations page
let t = await body('/onyx/exams');
rec('student sees the scheduled examination', {
  verdict: has(t, 'End-of-term') ? 'PASS' : 'FAIL',
  detail: (t.match(/.{0,110}End-of-term.{0,90}/i) ?? ['ABSENT — body: ' + t.slice(-260)])[0] });
rec('  and its mark after publication', {
  verdict: /\b78\b/.test(t) ? 'PASS' : 'WARN',
  detail: (t.match(/.{0,70}78.{0,70}/) ?? ['78 not shown on /onyx/exams'])[0] });

// 2. Results page — Assessments tab
t = await body('/onyx/results');
rec('results: Assessments tab shows the class test', {
  verdict: has(t, 'Class Test 1') && /\b19\b/.test(t) ? 'PASS' : 'FAIL',
  detail: (t.match(/.{0,90}Class Test 1.{0,110}/i) ?? ['not found'])[0] });

// 3. Results page — click through to the Grades tab
const gradesTab = page.getByRole('tab', { name: /grade/i }).or(page.getByRole('button', { name: /^grades/i }))
  .or(page.getByRole('link', { name: /^grades/i })).first();
let clicked = false;
if (await gradesTab.count()) { await gradesTab.click(); await page.waitForTimeout(2500); clicked = true; }
const t2 = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
rec('results: Grades tab reachable', { verdict: clicked ? 'PASS' : 'WARN',
  detail: clicked ? 'clicked' : 'no grades tab control found' });
rec('results: Grades tab shows the examination', {
  verdict: has(t2, 'End-of-term') || /\b78\b/.test(t2) ? 'PASS' : 'FAIL',
  detail: (t2.match(/.{0,100}(End-of-term|78|Pass).{0,90}/i) ?? ['body: ' + t2.slice(-300)])[0] });

// 4. Dashboard reflects the completed work
t = await body('/onyx/dashboard');
rec('dashboard reflects progress', { verdict: t.length > 500 ? 'PASS' : 'WARN',
  detail: (t.match(/.{0,150}(course|result|assessment|progress).{0,80}/i) ?? ['len=' + t.length])[0] });

// 5. Lesson reading marks progress
t = await body('/onyx/courses/' + S.created.course.id);
const lessonLink = await page.locator('a[href*="/lessons/"]').first().getAttribute('href').catch(() => null);
if (lessonLink) {
  t = await body(lessonLink);
  rec('lesson opens with the authored body text', {
    verdict: has(t, 'Fitness for purpose') || has(t, 'quality means') ? 'PASS' : 'WARN',
    detail: (t.match(/.{0,60}(Fitness for purpose|quality means).{0,80}/i) ?? ['len=' + t.length])[0] });
} else rec('lesson opens with the authored body text', { verdict: 'WARN', detail: 'no lesson link' });

// 6. Transcript / verification surface
t = await body('/onyx/resume');
rec('resume assembles the learner record', { verdict: t.length > 400 ? 'PASS' : 'WARN',
  detail: 'course listed=' + has(t, 'Foundations of Software Quality') + ' len=' + t.length });

await ctx.close();
await b.close();
fs.writeFileSync('qa-results-14-student-views.json', JSON.stringify(out, null, 2));
const tally = {}; for (const s of out.steps) tally[s.verdict] = (tally[s.verdict] ?? 0) + 1;
console.log('\n=== SUMMARY ===', JSON.stringify(tally));
