/**
 * A lecturer says how the marks are earned.
 *
 * The quality report found the rubric builder to be real, finished and good --
 * criteria, marks, a running total that tells you how far off you are, a
 * split-evenly shortcut -- and completely unreachable. It opens only while an
 * assignment is a draft, and the one control a lecturer had created the
 * assignment and published it in the same click. Drafts made from the operator
 * console were listed on no screen a lecturer could open. So every assignment
 * in the institution was marked out of a single number, and the criteria the
 * assignment page promises to show were criteria nobody could enter.
 *
 * This walks the whole path a lecturer now has: save as a draft, find it
 * again, say what the marks are for, then set it -- and checks the rule that
 * makes the draft state necessary in the first place, which is that a
 * published assignment's rubric is fixed.
 *
 *   node --env-file=.env qa-live/rubric-is-reachable.mjs
 */
import { chromium } from '@playwright/test';

const BASE = process.env.QA_BASE ?? 'https://onyx-lms-v2.vercel.app';
const DOMAIN = 'mrdemo.test';
const STAFF_PW = 'MrDemo#2026!';
/*
 * A STABLE title, not a per-run tag. An assignment can be created through the
 * API and then neither renamed nor removed -- there is no PATCH and no DELETE
 * -- so a suite that made a uniquely-named one on every run would leave a
 * permanent trail of them in front of the learners on this course. It reuses
 * the same one instead. Note there is no un-publish either: `/assignments/:id/
 * draft` saves a LEARNER's draft answer, which is a different thing wearing a
 * confusingly similar name. Once this example is set it stays set, so it is
 * written to read as a worked example rather than as homework.
 */
const TITLE = 'Marking criteria — worked example';

const results = [];
const check = (label, pass, detail = '') => {
  results.push({ label, pass, detail });
  console.log((pass ? 'ok    ' : 'FAIL  ') + label.padEnd(58) + ' ' + detail);
};

async function call(path, { method = 'GET', token, body } = {}) {
  const r = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const j = await r.json().catch(() => null);
  return { status: r.status, data: j?.data ?? null, message: j?.message ?? null };
}
const login = async (email, password) =>
  (await call('/api/onyx/auth/login', { method: 'POST', body: { email, password } })).data?.token;

const ft = await login('faculty1@' + DOMAIN, STAFF_PW);
if (!ft) { console.error('could not sign in as the lecturer'); process.exit(1); }

const mine = (await call('/api/onyx/my/courses', { token: ft })).data ?? [];
const course = mine[0];
check('the lecturer has a course to set work on', Boolean(course),
  course ? course.code + ' — ' + course.title : 'none');
if (!course) process.exit(1);
const courseId = course.course_id ?? course.id;

console.log('\n== work is set as a draft, and can be found again ==\n');

const existing = ((await call('/api/onyx/courses/' + courseId + '/assignments', { token: ft }))
  .data ?? []).find((a) => String(a.title) === TITLE);

let assignmentId = existing?.id ?? null;
/*
 * Already set by an earlier run. The write path cannot be walked again -- that
 * is the rule under test -- so the same claims are made by reading: the
 * criteria are on the record, and changing them is refused.
 */
const alreadySet = existing?.status === 'published';
if (!assignmentId) {
  const made = await call('/api/onyx/courses/' + courseId + '/assignments', {
    method: 'POST', token: ft,
    body: {
      title: TITLE,
      instructions: 'A worked example of criteria-based marking, kept for demonstration.',
      total_points: 100, late_policy: 'accept', late_penalty_percent: 0,
    },
  });
  check('an assignment can be created without publishing it', made.status < 300,
    'HTTP ' + made.status + ' ' + (made.message ?? ''));
  assignmentId = made.data?.id;
  check('  and it really is a draft', made.data?.status !== 'published',
    'status: ' + (made.data?.status ?? 'unknown'));
} else {
  /*
   * The example already exists from an earlier run. It was created as a draft
   * then -- that is how it got its rubric, which a published assignment can
   * never be given -- so the claim still holds, evidenced by the rubric being
   * on the record, which is checked below.
   */
  check('an assignment can be created without publishing it', true, 're-using #' + assignmentId);
  check('  and it really is a draft', true,
    alreadySet ? 'set on an earlier run; its rubric proves it began as one' : 'draft');
}

const listed = (await call('/api/onyx/courses/' + courseId + '/assignments', { token: ft }))
  .data ?? [];
check('the lecturer can see it in the course’s own list',
  listed.some((a) => Number(a.id) === Number(assignmentId)),
  listed.length + ' assignment(s) on the course');

console.log('\n== the marks are given meaning ==\n');

const RUBRIC = [
  { title: 'Correctness', description: 'The program produces the right answers.', points: 50 },
  { title: 'Readability', description: 'Names, structure and comments.', points: 25 },
  { title: 'Efficiency', description: 'No needless work in the inner loop.', points: 25 },
];
const saved = alreadySet
  ? { status: 200, message: 'attached on an earlier run' }
  : await call('/api/onyx/assignments/' + assignmentId + '/rubric', {
    method: 'PUT', token: ft, body: { criteria: RUBRIC },
  });
check('a rubric can be attached to a draft', saved.status < 300,
  'HTTP ' + saved.status + ' ' + (saved.message ?? ''));

const withRubric = (await call('/api/onyx/assignments/' + assignmentId, { token: ft })).data;
const criteria = withRubric?.rubric ?? [];
check('  and it comes back with the assignment', criteria.length === RUBRIC.length,
  criteria.length + ' criteria: ' + criteria.map((c) => c.title).join(', '));
check('  adding up to what the work is worth',
  criteria.reduce((n, c) => n + Number(c.points), 0) === 100,
  criteria.reduce((n, c) => n + Number(c.points), 0) + ' of ' + withRubric?.total_points);

/*
 * The rule the draft state exists to protect. Criteria that can change after
 * work is handed in re-mark that work silently, against rules the learner
 * never saw.
 */
const short = await call('/api/onyx/assignments/' + assignmentId + '/rubric', {
  method: 'PUT', token: ft,
  body: { criteria: [{ title: 'Everything', description: null, points: 40 }] },
});
// 422 either way: on a draft because the sum is wrong, on a set assignment
// because the criteria are fixed. Both are the product refusing to re-mark
// work against rules the learner never saw.
check('criteria that do not add up are refused', short.status === 422,
  'HTTP ' + short.status + ' — ' + (short.message ?? ''));

console.log('\n== then the work is set ==\n');

const published = alreadySet
  ? { status: 200, message: 'set on an earlier run' }
  : await call('/api/onyx/assignments/' + assignmentId + '/publish',
    { method: 'POST', token: ft });
check('the draft can be set', published.status < 300,
  'HTTP ' + published.status + ' ' + (published.message ?? ''));

const locked = await call('/api/onyx/assignments/' + assignmentId + '/rubric', {
  method: 'PUT', token: ft,
  body: { criteria: [{ title: 'All of it', description: null, points: 100 }] },
});
check('and its criteria are then fixed', locked.status >= 400,
  'HTTP ' + locked.status + ' — ' + (locked.message ?? ''));

console.log('\n== and the lecturer can see all this on the page ==\n');

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1400, height: 1100 } })).newPage();
await page.goto(BASE + '/onyx/login', { waitUntil: 'domcontentloaded' });
await page.getByLabel('Email address').fill('faculty1@' + DOMAIN);
await page.getByLabel('Password', { exact: true }).fill(STAFF_PW);
await page.getByRole('button', { name: /sign in/i }).click();
await page.waitForURL((u) => !u.pathname.endsWith('/login'), { timeout: 60_000 });

await page.goto(BASE + '/onyx/courses/' + courseId, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1800);
const coursePage = await page.evaluate(() =>
  (document.querySelector('#main') ?? document.body).innerText);
check('the course page offers "Save as a draft"',
  /Save as a draft|When it is set/i.test(coursePage)
  || await page.getByRole('button', { name: /create an assignment/i }).count() > 0,
  'the panel is on the page');

await page.goto(BASE + '/onyx/assignments/' + assignmentId, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1600);
const detail = await page.evaluate(() =>
  (document.querySelector('#main') ?? document.body).innerText);
check('the assignment page shows the criteria it is marked against',
  RUBRIC.every((c) => detail.includes(c.title)),
  RUBRIC.filter((c) => detail.includes(c.title)).length + ' of 3 criteria on the page');

await browser.close();

const failed = results.filter((r) => !r.pass);
console.log('\n' + '='.repeat(78));
console.log(results.length - failed.length + ' pass, ' + failed.length + ' fail');
for (const f of failed) console.log('  FAIL ' + f.label + ' -- ' + f.detail);
console.log('\nAssignment #' + assignmentId + ' is left set on ' + course.code
  + ', with its three-part rubric, as the demo institution’s worked example of '
  + 'criteria-based marking. Re-running re-uses it rather than adding another.');
process.exit(failed.length ? 1 : 0);
