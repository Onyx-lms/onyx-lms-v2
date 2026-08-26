/**
 * The end-user quality report's defects, re-tested against what is deployed.
 *
 * The report was written by using the product, and every finding in it was
 * reproduced before it was written down. This re-runs the ones a script can
 * reach, so "fixed" is a measurement rather than a claim. Nothing here is
 * hard-coded to a row id that might have moved: each check finds its own
 * subject first and says so, and says plainly when it could not.
 *
 *   node --env-file=.env qa-live/defects-report1.mjs
 */
import { chromium } from '@playwright/test';

const BASE = process.env.QA_BASE ?? 'https://onyx-lms-v2.vercel.app';
const TENANT = process.env.QA_TENANT ?? '798';

const results = [];
const check = (n, label, pass, detail = '') => {
  results.push({ n, label, pass, detail });
  console.log((pass ? 'ok    ' : 'FAIL  ') + ('[' + n + ']').padEnd(6)
    + label.padEnd(48) + ' ' + detail);
};
const skip = (n, label, why) => {
  results.push({ n, label, pass: true, skipped: true, detail: why });
  console.log('skip  ' + ('[' + n + ']').padEnd(6) + label.padEnd(48) + ' ' + why);
};

async function token(email, password, path) {
  const r = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const j = await r.json().catch(() => null);
  return j?.data?.token ?? null;
}
const get = async (path, tok) => {
  const r = await fetch(BASE + path, { headers: { Authorization: 'Bearer ' + tok } });
  const j = await r.json().catch(() => null);
  return { status: r.status, data: j?.data ?? null };
};

const ops = await token('superadmin@onyx.platform', 'Platform#2026!', '/api/onyx/platform/login');
if (!ops) { console.error('could not sign in as the operator'); process.exit(1); }

// ---------------------------------------------------------------- [2] tallies
const ac = await get('/api/onyx/platform/tenants/' + TENANT + '/academics', ops);
const counts = (ac.data?.courses ?? []).map((c) => Number(c.enrollment_count) || 0);
const nonZero = counts.filter((n) => n > 0).length;
check(2, 'the operator sees real enrolment counts',
  counts.length > 0 && nonZero > 1 && !counts.includes(1000),
  nonZero + ' of ' + counts.length + ' courses carry learners · max '
  + (counts.length ? Math.max(...counts) : 0)
  + ' · sum ' + counts.reduce((a, b) => a + b, 0));

// ------------------------------------------------------------- [8][9] gone
const tr = await fetch(BASE + '/api/onyx/transcripts', { headers: { Authorization: 'Bearer ' + ops } });
check('8/9', 'transcripts are gone, not half-built', tr.status === 404, 'HTTP ' + tr.status);

const browser = await chromium.launch();
const seen4xx = [];

async function signIn(page, email, password) {
  await page.goto(BASE + '/onyx/login', { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((u) => !u.pathname.endsWith('/login'), { timeout: 60_000 });
}
const bodyText = (page) =>
  page.evaluate(() => (document.querySelector('#main') ?? document.body).innerText);

// ============================== as an administrator =========================
const admCtx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
const adm = await admCtx.newPage();
adm.on('response', (r) => {
  if (r.status() >= 400) seen4xx.push(r.status() + ' ' + new URL(r.url()).pathname);
});
await signIn(adm, 'admin@mrdemo.test', 'MrDemo#2026!');

/*
 * [1] HIGH -- staff opening a candidate's attempt used to be a hard 500 on
 * every paper. There is no institution-wide marking queue; the queue lives on
 * each paper, so walk the papers until one has a marked script to open.
 */
let attemptHref = null;
await adm.goto(BASE + '/onyx/exams', { waitUntil: 'domcontentloaded' });
await adm.waitForTimeout(1600);
const examLinks = await adm.evaluate(() => [...new Set([...document.querySelectorAll(
  'a[href^="/onyx/exams/"]')].map((a) => a.getAttribute('href')))].filter((h) => /\/\d+$/.test(h)));
for (const href of examLinks.slice(0, 8)) {
  await adm.goto(BASE + href + '/marking', { waitUntil: 'domcontentloaded' });
  await adm.waitForTimeout(1200);
  attemptHref = await adm.evaluate(() =>
    document.querySelector('a[href*="/onyx/attempts/"]')?.getAttribute('href') ?? null);
  if (attemptHref) break;
}
if (attemptHref) {
  const id = (attemptHref.match(/attempts\/(\d+)/) ?? [])[1];
  const res = await adm.goto(BASE + '/onyx/attempts/' + id, { waitUntil: 'domcontentloaded' });
  await adm.waitForTimeout(1200);
  check(1, 'staff can open a candidate attempt', res.status() === 200,
    'attempt ' + id + ' → HTTP ' + res.status() + ' · ' + new URL(adm.url()).pathname);
} else {
  skip(1, 'staff can open a candidate attempt', 'no marked script on any open paper today');
}

// ================================ as the operator ===========================
const opsCtx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
const opsPage = await opsCtx.newPage();
const opsCodes = [];
opsPage.on('response', (r) => {
  if (r.status() >= 400) opsCodes.push(r.status() + ' ' + new URL(r.url()).pathname);
});
await opsPage.goto(BASE + '/onyx/platform/login', { waitUntil: 'domcontentloaded' });
await opsPage.getByLabel(/email/i).first().fill('superadmin@onyx.platform');
await opsPage.getByLabel(/password/i).first().fill('Platform#2026!');
await opsPage.getByRole('button', { name: /sign in/i }).click();
await opsPage.waitForFunction(() => !location.pathname.endsWith('/login'), null, { timeout: 60_000 });

// [3] every bank row linked at a route that did not exist
await opsPage.goto(BASE + '/onyx/platform/tenants/' + TENANT + '/assessments/banks',
  { waitUntil: 'domcontentloaded' });
await opsPage.waitForTimeout(2000);
const bankHref = await opsPage.evaluate(() =>
  document.querySelector('tbody a[href*="/banks/"]')?.getAttribute('href') ?? null);
if (bankHref) {
  const res = await opsPage.goto(BASE + bankHref, { waitUntil: 'domcontentloaded' });
  await opsPage.waitForTimeout(1500);
  const t = await bodyText(opsPage);
  check(3, 'a question bank row opens',
    res.status() === 200 && !/Page not found/i.test(t),
    bankHref + ' → HTTP ' + res.status());
  check('3b', '  and it shows the bank, not a shell',
    /Questions/i.test(t) && /Sets/i.test(t),
    (t.split('\n').find((l) => l.trim()) ?? '').slice(0, 46));
} else {
  check(3, 'a question bank row opens', false, 'no bank row rendered a link');
}
const prefetch404 = opsCodes.filter((c) => c.startsWith('404') && c.includes('/banks/'));
check('3c', '  and the listing prefetches no 404s', prefetch404.length === 0,
  prefetch404.slice(0, 2).join(' | ') || 'none');

// ================================ as a learner ==============================
const stuCtx = await browser.newContext({
  viewport: { width: 1400, height: 1000 }, timezoneId: 'Asia/Kolkata',
});
const stu = await stuCtx.newPage();
await signIn(stu, 'alpha-cse.001@mrdemo.test', 'Student#2026!');

// [6] the day boundary -- between 00:00 and 05:30 IST the runtime is a day behind
await stu.goto(BASE + '/onyx/timetable', { waitUntil: 'domcontentloaded' });
await stu.waitForTimeout(1800);
const day = await stu.evaluate(() => {
  const t = (document.querySelector('#main') ?? document.body).innerText;
  return {
    said: (t.match(/TODAY[^\n]*/i) ?? [''])[0].trim(),
    here: new Date().toLocaleDateString('en-IN', { weekday: 'long' }).toUpperCase(),
  };
});
check(6, 'the product knows what day it is here',
  Boolean(day.said) && day.said.toUpperCase().includes(day.here),
  day.said ? 'says "' + day.said + '" · here it is ' + day.here
    : 'no TODAY heading on the timetable');

// [11] invigilator controls in a candidate's view
for (const path of ['/onyx/exams', '/onyx/assessments']) {
  await stu.goto(BASE + path, { waitUntil: 'domcontentloaded' });
  await stu.waitForTimeout(1300);
  const t = await bodyText(stu);
  check(11, 'no staff controls on ' + path,
    !/Invigilation console|Copy link for candidates|Share link/i.test(t));
}

// [10] a paper that names its course rather than its foreign key
await stu.goto(BASE + '/onyx/exams', { waitUntil: 'domcontentloaded' });
await stu.waitForTimeout(1300);
const examHref = await stu.evaluate(() =>
  document.querySelector('a[href*="/onyx/exams/"]')?.getAttribute('href') ?? null);
if (examHref) {
  await stu.goto(BASE + examHref, { waitUntil: 'domcontentloaded' });
  await stu.waitForTimeout(1400);
  const t = await bodyText(stu);
  check(10, 'a paper names its course', !/Course #\d+/.test(t),
    (t.match(/Course #\d+/) ?? ['no raw id'])[0]);
} else {
  skip(10, 'a paper names its course', 'no paper open to this learner today');
}

/*
 * [5] Progress was posted only by a video's `ended` event, so a learner could
 * read every lesson of a course and still be told 0% complete. Ask the API
 * which lessons are not videos rather than opening pages hoping to find one.
 */
const stuTok = await token('alpha-cse.001@mrdemo.test', 'Student#2026!', '/api/onyx/auth/login');
const myCourses = await get('/api/onyx/my/courses', stuTok);
let nonVideo = null;
for (const c of (myCourses.data ?? [])) {
  const id = c.course_id ?? c.id;
  const outline = await get('/api/onyx/courses/' + id + '/outline', stuTok);
  const mods = Array.isArray(outline.data) ? outline.data : (outline.data?.modules ?? []);
  const lesson = mods.flatMap((m) => m.lessons ?? []).find((l) => l.type !== 'video');
  if (lesson) { nonVideo = { course: id, lesson }; break; }
}
if (nonVideo) {
  await stu.goto(BASE + '/onyx/courses/' + nonVideo.course + '/lessons/' + nonVideo.lesson.id,
    { waitUntil: 'domcontentloaded' });
  await stu.waitForTimeout(1600);
  const t = await bodyText(stu);
  const offered = /Mark as done|counts towards your progress/i.test(t);
  check(5, 'a non-video lesson can be marked done', offered,
    nonVideo.lesson.type + ' lesson ' + nonVideo.lesson.id
    + ' — ' + (offered ? 'offered' : 'NO way to record it'));
} else {
  skip(5, 'a non-video lesson can be marked done', 'this learner has only videos');
}

await browser.close();

const staff4xx = [...new Set(seen4xx)];
console.log('\n4xx/5xx seen while browsing as staff: '
  + (staff4xx.length ? staff4xx.slice(0, 5).join(' | ') : 'none'));

const failed = results.filter((r) => !r.pass);
const skipped = results.filter((r) => r.skipped);
console.log('\n' + '='.repeat(78));
console.log(results.length - failed.length - skipped.length + ' pass, '
  + failed.length + ' fail, ' + skipped.length + ' not reachable today');
for (const f of failed) console.log('  FAIL [' + f.n + '] ' + f.label + ' -- ' + f.detail);
process.exit(failed.length ? 1 : 0);
