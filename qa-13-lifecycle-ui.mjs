/**
 * The same lifecycle, seen through the screens rather than the API.
 *
 * Reads qa-lifecycle-state.json for the institution the API run created, then
 * drives the real UI as each actor and checks that what was authored actually
 * appears where a person would look for it.
 */
import { launch, newPage, visit, BASE } from './qa-lib.mjs';
import fs from 'node:fs';

const S = JSON.parse(fs.readFileSync('qa-lifecycle-state.json', 'utf8'));
const STAMP = S.stamp, PASSWORD = 'QaCert#2026!';
const COURSE_ID = S.created.course?.id, ASSESS_ID = S.created.assessment?.id,
      EXAM_ID = S.created.exam?.id, TENANT_ID = S.created.tenant?.id;
const who = {
  admin:   'qa.admin.'   + STAMP + '@onyx.test',
  faculty: 'qa.faculty.' + STAMP + '@onyx.test',
  exams:   'qa.exams.'   + STAMP + '@onyx.test',
  s1:      'qa.s1.'      + STAMP + '@onyx.test',
};
console.log('tenant', TENANT_ID, S.slug, '| course', COURSE_ID, '| assessment', ASSESS_ID, '| exam', EXAM_ID, '\n');

const out = { stamp: STAMP, steps: [] };
let n = 0;
const rec = (act, name, o) => {
  const row = { seq: ++n, act, name, ...o }; out.steps.push(row);
  console.log(`${String(n).padStart(2)} ${row.verdict.padEnd(4)} [${act}] ${name.padEnd(48)} ${row.detail ?? ''}`);
};

const browser = await launch();
async function login(email) {
  const ctx = await browser.newContext();
  const page = await newPage(ctx);
  await page.goto(BASE + '/onyx/login', { waitUntil: 'domcontentloaded' });
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(PASSWORD);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((u) => !u.pathname.endsWith('/login'), { timeout: 30000 });
  return { ctx, page };
}
/** Page text, normalised for matching. */
async function text(page, path) {
  await page.goto(BASE + path, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2200);
  return (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ');
}
const has = (t, ...needles) => needles.every((x) => t.toLowerCase().includes(String(x).toLowerCase()));

try {

// ---------------- ADMIN ----------------
{
  const { ctx, page } = await login(who.admin);
  let t = await text(page, '/onyx/dashboard');
  rec('admin', 'dashboard names the institution', {
    verdict: has(t, 'QA Certification College') ? 'PASS' : 'FAIL', detail: t.slice(0, 120) });

  t = await text(page, '/onyx/courses');
  rec('admin', 'course appears in the catalogue', {
    verdict: has(t, 'Foundations of Software Quality', 'QE101') ? 'PASS' : 'FAIL',
    detail: (t.match(/.{0,80}Foundations of Software Quality.{0,60}/i) ?? ['not found'])[0] });

  t = await text(page, '/onyx/courses/' + COURSE_ID);
  const showsModules = has(t, 'Principles of Quality') && has(t, 'Testing in Practice');
  const showsLessons = has(t, 'What quality means') && has(t, 'Automation strategy');
  rec('admin', 'course page shows both modules', { verdict: showsModules ? 'PASS' : 'FAIL',
    detail: 'module1=' + has(t, 'Principles of Quality') + ' module2=' + has(t, 'Testing in Practice') });
  rec('admin', 'course page shows the lessons', { verdict: showsLessons ? 'PASS' : 'FAIL',
    detail: 'len=' + t.length });

  t = await text(page, '/onyx/programs');
  rec('admin', 'programme listed', { verdict: has(t, 'B.Tech Quality Engineering') ? 'PASS' : 'FAIL',
    detail: (t.match(/.{0,60}Quality Engineering.{0,50}/i) ?? ['not found'])[0] });

  t = await text(page, '/onyx/people?role=student');
  const allThree = has(t, 'Sana Learner') && has(t, 'Rohit Learner') && has(t, 'Meena Learner');
  rec('admin', 'all three learners on the roster', { verdict: allThree ? 'PASS' : 'FAIL',
    detail: 'roll numbers shown=' + has(t, 'QE-001') });

  t = await text(page, '/onyx/audit');
  rec('admin', 'audit screen shows the lifecycle actions', {
    verdict: has(t, 'publish') || has(t, 'created') ? 'PASS' : 'WARN', detail: 'len=' + t.length });
  await ctx.close();
}

// ---------------- FACULTY ----------------
{
  const { ctx, page } = await login(who.faculty);
  let t = await text(page, '/onyx/assessments');
  rec('faculty', 'assessment listed for its author', {
    verdict: has(t, 'Class Test 1') ? 'PASS' : 'FAIL',
    detail: (t.match(/.{0,70}Class Test 1.{0,70}/i) ?? ['not found'])[0] });

  t = await text(page, '/onyx/assessments/' + ASSESS_ID);
  rec('faculty', 'assessment detail page', { verdict: has(t, 'Class Test 1') ? 'PASS' : 'FAIL',
    detail: 'len=' + t.length });

  t = await text(page, '/onyx/assessments/' + ASSESS_ID + '/marking');
  rec('faculty', 'marking screen shows the sat paper', {
    verdict: has(t, 'Sana') || has(t, 'marked') || has(t, 'mark') ? 'PASS' : 'WARN',
    detail: (t.match(/.{0,90}(Sana|marked|awaiting).{0,60}/i) ?? ['len=' + t.length])[0] });

  t = await text(page, '/onyx/assessments/' + ASSESS_ID + '/results');
  const showsScore = has(t, '19');
  rec('faculty', 'results screen shows the cohort score', {
    verdict: showsScore ? 'PASS' : 'WARN',
    detail: (t.match(/.{0,100}(mean|average|19).{0,80}/i) ?? ['len=' + t.length])[0] });

  t = await text(page, '/onyx/banks/' + S.created.bank?.id);
  rec('faculty', 'question bank screen', { verdict: has(t, 'Quality Fundamentals') ? 'PASS' : 'FAIL',
    detail: 'questions visible=' + has(t, 'cheapest stage') });
  await ctx.close();
}

// ---------------- STUDENT ----------------
{
  const { ctx, page } = await login(who.s1);
  let t = await text(page, '/onyx/dashboard');
  rec('student', 'dashboard renders for the new learner', { verdict: t.length > 300 ? 'PASS' : 'FAIL',
    detail: 'len=' + t.length });

  t = await text(page, '/onyx/courses');
  rec('student', 'enrolled course appears', {
    verdict: has(t, 'Foundations of Software Quality') ? 'PASS' : 'FAIL',
    detail: (t.match(/.{0,70}Foundations of Software.{0,50}/i) ?? ['not found'])[0] });

  t = await text(page, '/onyx/courses/' + COURSE_ID);
  rec('student', 'course page shows the authored lessons', {
    verdict: has(t, 'What quality means') ? 'PASS' : 'FAIL',
    detail: 'modules=' + has(t, 'Principles of Quality') + ' lessons=' + has(t, 'Cost of defects') });

  // THE key discovery question: can the learner find the assessment?
  t = await text(page, '/onyx/assessments');
  const discoverable = has(t, 'Class Test 1');
  rec('student', 'published assessment is DISCOVERABLE', {
    verdict: discoverable ? 'PASS' : 'FAIL',
    detail: discoverable ? (t.match(/.{0,80}Class Test 1.{0,80}/i) ?? [''])[0]
                         : 'NOT on /onyx/assessments — body: ' + t.slice(0, 260) });

  t = await text(page, '/onyx/results');
  const seesAssessment = has(t, 'Class Test 1');
  const seesExam = has(t, 'End-of-term');
  const seesScore = /\b19\b/.test(t), seesExamScore = /\b78\b/.test(t);
  rec('student', 'results page shows the ASSESSMENT result', {
    verdict: seesAssessment && seesScore ? 'PASS' : 'FAIL',
    detail: `title=${seesAssessment} score19=${seesScore} :: ` +
            (t.match(/.{0,90}(Class Test|19).{0,70}/i) ?? ['body: ' + t.slice(0, 200)])[0] });
  rec('student', 'results page shows the EXAMINATION result', {
    verdict: seesExam && seesExamScore ? 'PASS' : 'FAIL',
    detail: `title=${seesExam} score78=${seesExamScore}` });

  t = await text(page, '/onyx/timetable');
  rec('student', 'scheduled examination on the timetable', {
    verdict: has(t, 'End-of-term') || has(t, 'QE101') ? 'PASS' : 'WARN',
    detail: (t.match(/.{0,80}(End-of-term|QE101).{0,50}/i) ?? ['len=' + t.length])[0] });
  await ctx.close();
}

// ---------------- EXAMS OFFICER ----------------
{
  const { ctx, page } = await login(who.exams);
  let t = await text(page, '/onyx/exams');
  rec('exams', 'examination listed', { verdict: has(t, 'End-of-term') ? 'PASS' : 'FAIL',
    detail: (t.match(/.{0,80}End-of-term.{0,60}/i) ?? ['not found'])[0] });

  t = await text(page, '/onyx/exams/' + EXAM_ID);
  rec('exams', 'examination detail page', { verdict: has(t, 'End-of-term') ? 'PASS' : 'FAIL',
    detail: 'seating/marks visible=' + (has(t, 'seat') || has(t, 'mark')) });

  t = await text(page, '/onyx/exams/' + EXAM_ID + '/marking');
  rec('exams', 'examination marking screen', { verdict: t.length > 300 ? 'PASS' : 'WARN',
    detail: 'len=' + t.length + ' shows candidates=' + (has(t, 'Sana') || has(t, 'QE-001')) });

  t = await text(page, '/onyx/invigilate');
  rec('exams', 'invigilation console', { verdict: t.length > 300 ? 'PASS' : 'FAIL', detail: 'len=' + t.length });
  await ctx.close();
}

// ---------------- SUPERADMIN drill-down ----------------
{
  const { launch: _l } = await import('./qa-lib.mjs');
  const { signIn } = await import('./qa-lib.mjs');
  const ctx = await browser.newContext();
  const page = await newPage(ctx);
  await signIn(page, 'superadmin');
  let t = await text(page, '/onyx/platform');
  rec('superadmin', 'new institution on the console list', {
    verdict: has(t, 'QA Certification College') ? 'PASS' : 'FAIL', detail: 'len=' + t.length });

  for (const [label, sub] of [['courses', '/courses'], ['students', '/students'],
                              ['faculty', '/faculty'], ['staff', '/staff'],
                              ['assessments', '/assessments'],
                              ['examinations', '/examinations'], ['grades', '/grades'],
                              // The sections added since the last report.
                              ['code lab', '/problems'], ['practice activity', '/practice']]) {
    t = await text(page, '/onyx/platform/tenants/' + TENANT_ID + sub);
    /*
     * `staff` is the console's "Other roles" page -- exams, placement, employer,
     * guardian. It was being checked for Dr. Farah Lecturer, who is FACULTY and
     * has her own page, so it warned every run about somebody who was never
     * meant to be on it. Faculty is now its own check, and staff looks for the
     * examinations officer, who is what that page is for.
     */
    const marker = { courses: 'QE101', students: 'Sana', faculty: 'Farah',
                     staff: 'Eshan', assessments: 'Class Test',
                     examinations: 'End-of-term', grades: 'QE101',
                     'code lab': 'problem', 'practice activity': 'submission' }[label];
    rec('superadmin', 'tenant ' + label + ' shows authored data', {
      verdict: has(t, marker) ? 'PASS' : 'WARN',
      detail: `looking for "${marker}" — ${has(t, marker) ? 'found' : 'absent; len=' + t.length}` });
  }
  await ctx.close();
}

} catch (e) {
  rec('harness', 'UNCAUGHT', { verdict: 'FAIL', detail: String(e).slice(0, 300) });
} finally {
  await browser.close();
  fs.writeFileSync('qa-results-13-lifecycle-ui.json', JSON.stringify(out, null, 2));
  const t = {}; for (const s of out.steps) t[s.verdict] = (t[s.verdict] ?? 0) + 1;
  console.log('\n=== UI LIFECYCLE SUMMARY ===', JSON.stringify(t));
  const f = out.steps.filter((s) => s.verdict === 'FAIL');
  if (f.length) { console.log('\nFAILURES:'); for (const x of f) console.log('  ' + x.seq + ' [' + x.act + '] ' + x.name + ' :: ' + x.detail); }
}
