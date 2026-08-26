/**
 * Does an examination announce its paper, or lock it?
 *
 * Scheduling one used to pin the paper to the slot -- open at the start, shut
 * at the end -- so a candidate outside those two instants was refused with
 * "This assessment has closed". That is hall discipline, and it is the wrong
 * default here: this product deals SETS, parallel papers rotating down the
 * roll, and that is what makes everybody sitting at one instant unnecessary.
 *
 * Asserts both halves on the live demo -- the default, and the hall an
 * institution can still ask for -- and removes the two sittings it makes.
 *
 *   node --env-file=.env qa-live/exam-window.mjs
 */
const BASE = process.env.QA_BASE ?? 'https://onyx-lms-v2.vercel.app';

const results = [];
const check = (label, pass, detail = '') => {
  results.push({ label, pass, detail });
  console.log((pass ? 'ok    ' : 'FAIL  ') + label.padEnd(56), detail);
};
const tok = (await (await fetch(BASE + '/api/onyx/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'admin@mrdemo.test', password: 'MrDemo#2026!' }),
})).json())?.data?.token;
const call = async (path, body, method = 'GET') => {
  const r = await fetch(BASE + path, { method,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok },
    body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
};
check('the administrator signs in', !!tok);

const tag = Math.random().toString(36).slice(2, 7);
const courses = (await call('/api/onyx/courses')).body?.data ?? [];
const banks = (await call('/api/onyx/banks')).body?.data ?? [];
const bank = banks.find((b) => Number(b.question_count) > 0);
const course = courses.find((c) => Number(c.id) === Number(bank?.course_id)) ?? courses[0];

/** A paper, and a sitting on it, an hour from now. */
async function sitting(windowEnforced) {
  const paper = await call('/api/onyx/assessments', {
    title: 'Window probe ' + tag + (windowEnforced ? ' (hall)' : ' (open)'),
    course_id: course.id, duration_minutes: 30,
    sections: [{ id: 's1', title: 'A', bank_id: bank.id, take: 1 }],
  }, 'POST');
  const paperId = paper.body?.data?.id;
  /*
   * Far out, and a different day for each of the two.
   *
   * The product refuses to put two sittings in front of the same cohort at
   * once -- correctly -- and the demo's own three examinations are reopened to
   * run for the next ten hours whenever somebody sits down to look at them. A
   * probe an hour from now collides with both, and the 409 it earns reads as a
   * scheduling failure when the thing under test is the window.
   */
  const days = windowEnforced ? 210 : 200;
  const starts = new Date(Date.now() + days * 86_400_000).toISOString();
  const exam = await call('/api/onyx/exams', {
    title: 'Window probe ' + tag + (windowEnforced ? ' hall' : ' open'),
    course_id: course.id, assessment_id: paperId, starts_at: starts,
    duration_minutes: 30, max_marks: 10, pass_marks: 4,
    ...(windowEnforced ? { window_enforced: true } : {}),
  }, 'POST');
  const after = (await call('/api/onyx/assessments')).body?.data ?? [];
  const row = after.find((a) => Number(a.id) === Number(paperId));
  return { paperId, examId: exam.body?.data?.id, examStatus: exam.status, row, starts };
}

// --- the default: announced, not locked ------------------------------------
const open = await sitting(false);
check('a sitting can be scheduled', open.examStatus === 200, 'exam ' + open.examId);
check('by default the paper opens at the start', !!open.row?.opens_at,
  open.row?.opens_at ?? 'not set');
check('and never shuts', open.row?.closes_at === null,
  'closes_at = ' + JSON.stringify(open.row?.closes_at));

// --- and the hall, for an institution that wants it ------------------------
const hall = await sitting(true);
check('“only during the slot” can still be asked for', hall.examStatus === 200,
  'exam ' + hall.examId);
check('then the paper shuts at the end', !!hall.row?.closes_at,
  hall.row?.closes_at ?? 'not set');
const span = hall.row?.closes_at && hall.row?.opens_at
  ? (Date.parse(hall.row.closes_at) - Date.parse(hall.row.opens_at)) / 60000 : 0;
check('for exactly the length of the sitting', span === 30, span + ' minutes');

// --- and it can be turned on afterwards ------------------------------------
await call('/api/onyx/exams/' + open.examId, { window_enforced: true }, 'PATCH');
const reread = ((await call('/api/onyx/assessments')).body?.data ?? [])
  .find((a) => Number(a.id) === Number(open.paperId));
check('switching it on later closes the window', !!reread?.closes_at,
  reread?.closes_at ?? 'still open');

// --- clean up --------------------------------------------------------------
let gone = 0;
for (const id of [open.examId, hall.examId]) {
  if (id && (await call('/api/onyx/exams/' + id, undefined, 'DELETE')).status === 200) gone += 1;
}
for (const id of [open.paperId, hall.paperId]) {
  if (id) await call('/api/onyx/assessments/' + id, undefined, 'DELETE');
}
check('both probe sittings are removed', gone === 2, gone + ' of 2');

const failed = results.filter((r) => !r.pass);
console.log('\n' + '='.repeat(76));
console.log(results.filter((r) => r.pass).length + ' pass, ' + failed.length + ' fail');
for (const f of failed) console.log('  FAIL ' + f.label + ' -- ' + f.detail);
process.exit(failed.length ? 1 : 0);
