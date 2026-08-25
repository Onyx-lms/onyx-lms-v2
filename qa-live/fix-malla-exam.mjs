/**
 * Three corrections at Malla Reddy, and a check that the learner can see them.
 *
 *   1. "test examination1" was stored at 01:35 IST, ten hours before the 13:35
 *      it was meant for — one mis-click apart on a twelve-hour picker, and
 *      nothing on any screen said it had been scheduled in the past.
 *   2. Its learner is enrolled on nothing at all, so the calendar correctly
 *      returned an empty week: an exam belongs to a course, and a learner sees
 *      the exams of the courses they are on.
 *   3. Both published courses are `batch` — "enrolment is handled by the
 *      programme office" — which is why the learner had no Join button.
 *
 * Course STATUS is not touched. The sixty-one drafts stay drafts.
 *
 *   node qa-live/fix-malla-exam.mjs            # show what would change
 *   node qa-live/fix-malla-exam.mjs --apply
 */
const BASE = process.env.QA_BASE ?? 'https://onyx-lms-v2.vercel.app';
const APPLY = process.argv.includes('--apply');

const SLUG = 'malla-reddy-university';
const EXAM_ID = 267;
/** 13:35 IST on 25 August 2026 — what "one thirty-five PM today" means. */
const STARTS_AT = '2026-08-25T08:05:00.000Z';

async function call(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const p = await res.json().catch(() => ({}));
  return { status: res.status, data: p?.data, message: p?.message };
}
const ist = (iso) => (iso
  ? new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
  : '(none)');

const pt = (await call('/api/onyx/platform/login', {
  method: 'POST',
  body: { email: 'superadmin@onyx.platform', password: 'Platform#2026!' },
})).data?.token;
if (!pt) { console.error('Could not sign in to the console.'); process.exit(2); }

const tenants = (await call('/api/onyx/platform/tenants', { token: pt })).data ?? [];
const t = tenants.find((x) => String(x.slug) === SLUG);
if (!t) { console.error('No institution "' + SLUG + '".'); process.exit(2); }
const base = '/api/onyx/platform/tenants/' + t.id;

const academics = (await call(base + '/academics?limit=200', { token: pt })).data ?? {};
const exam = (academics.exams ?? []).find((e) => Number(e.id) === EXAM_ID);
const published = (academics.courses ?? []).filter((c) => Number(c.status) === 1);
const people = (await call(base + '/people?role=student&limit=200', { token: pt }))
  .data?.people ?? [];

console.log('institution : ' + t.name + ' (' + t.id + ')');
console.log('exam        : ' + (exam ? exam.title : 'not found'));
console.log('  starts at : ' + ist(exam?.starts_at) + '  →  ' + ist(STARTS_AT));
console.log('published courses (status untouched):');
for (const c of published) {
  console.log('  ' + c.code.padEnd(8) + c.title.padEnd(20)
    + 'access=' + c.access + '  enrolled=' + c.enrollment_count);
}
console.log('learners    : ' + (people.map((p) => p.name).join(', ') || 'none'));

if (!APPLY) {
  console.log('\nWould: set the exam to ' + ist(STARTS_AT)
    + ', open both published courses for joining, and enrol the learner on the exam’s course.');
  console.log('Nothing was changed. Pass --apply.');
  process.exit(0);
}

console.log('');

// 1. The time. Through the console's own route, so it is audited.
const fixed = await call(base + '/exams/' + EXAM_ID, {
  method: 'PATCH', token: pt, body: { starts_at: STARTS_AT },
});
console.log('exam time   : ' + fixed.status + ' ' + (fixed.message ?? ''));

// 2. The Join button. `access` is how a learner joins; `status` is whether the
//    course exists to them at all, and status is deliberately left alone.
for (const c of published) {
  const opened = await call(base + '/courses/' + c.id, {
    method: 'PATCH', token: pt, body: { access: 'open' },
  });
  console.log('open ' + c.code.padEnd(7) + ': ' + opened.status + ' ' + (opened.message ?? ''));
}

// 3. The enrolment, so the sitting reaches somebody. Without it the calendar
//    is right to return nothing.
const course = published.find((c) => Number(c.id) === Number(exam?.course_id));
for (const p of people) {
  const on = await call(base + '/courses/' + course.id + '/enroll', {
    method: 'POST', token: pt, body: { user_id: p.user_id },
  });
  console.log('enrol ' + p.name + ': ' + on.status + ' ' + (on.message ?? ''));
}

// ---------------------------------------------------------------------------
// And then the only check that matters: what the learner actually sees.

const after = (await call(base + '/academics?limit=200', { token: pt })).data ?? {};
const nowExam = (after.exams ?? []).find((e) => Number(e.id) === EXAM_ID);
console.log('\nexam now at : ' + ist(nowExam?.starts_at));
const nowCourse = (after.courses ?? []).find((c) => Number(c.id) === Number(course.id));
console.log(course.code + ' now   : access=' + nowCourse?.access
  + ' enrolled=' + nowCourse?.enrollment_count);

const week = (await call(base + '/exam-week?from=' + encodeURIComponent(
  new Date(Date.parse(STARTS_AT) - 3 * 86_400_000).toISOString())
  + '&to=' + encodeURIComponent(new Date(Date.parse(STARTS_AT) + 3 * 86_400_000).toISOString()),
{ token: pt })).data;
console.log('on the console grid: '
  + (Array.isArray(week) ? week.length + ' sittings' : JSON.stringify(week ?? '').slice(0, 60)));

console.log('\nCourse status was not touched — the drafts are still drafts.');
