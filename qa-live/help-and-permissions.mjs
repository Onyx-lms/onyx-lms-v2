/**
 * Four things, checked against the deployed site at ABC Institution.
 *
 *   1. A learner raises a question from Help, and an operator sees and answers
 *      it — with the answer reaching the learner who asked.
 *   2. A result is on the learner's screen the moment they hand a paper in.
 *   3. A scheduled sitting is on that learner's timetable.
 *   4. An operator finds one person by name or roll number and gives them a
 *      capability their role does not carry, without promoting anybody else.
 *
 * ABC Institution only, never Malla Reddy, and everything it creates it
 * removes.
 *
 *   node qa-live/help-and-permissions.mjs
 */
import fs from 'node:fs';

const BASE = process.env.QA_BASE ?? 'https://onyx-lms-v2.vercel.app';
const RUN = Date.now().toString(36);
const ONLY = 'abc-institution';
const PW = 'QaHelp#2026!';

const cred = fs.readFileSync('onyx-v2-credentials.csv', 'utf8')
  .trim().split('\n').map((l) => l.replace('\r', '')).slice(1).map((r) => r.split(','));
const rowFor = (role) => cred.find((r) => r[1] === ONLY && r[2] === role);

const results = [];
let phase = '';
const startPhase = (n) => { phase = n; console.log('\n== ' + n + ' =='); };
function check(label, pass, detail = '') {
  results.push({ phase, label, pass: Boolean(pass), detail });
  console.log((pass ? 'ok    ' : 'FAIL  ') + label.padEnd(58), detail);
  return pass;
}

async function call(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const parsed = await res.json().catch(() => ({}));
  return { status: res.status, data: parsed?.data, message: parsed?.message };
}
async function step(label, path, opts = {}) {
  const r = await call(path, opts);
  check(label, r.status >= 200 && r.status < 300, r.status + ' ' + (r.message ?? ''));
  return r;
}
const login = async (email, password) => (await call('/api/onyx/auth/login',
  { method: 'POST', body: { email, password } })).data?.token;

// ---------------------------------------------------------------------------

startPhase('1. the institution, and a learner in it');

const pt = (await call('/api/onyx/platform/login', { method: 'POST',
  body: { email: 'superadmin@onyx.platform', password: 'Platform#2026!' } })).data?.token;
const tenants = (await call('/api/onyx/platform/tenants', { token: pt })).data ?? [];
const abc = tenants.find((t) => t.slug === ONLY);
const forbidden = tenants.find((t) => t.slug === 'malla-reddy-university');
check('ABC Institution is the one being touched',
  Boolean(abc) && abc.id !== forbidden?.id,
  'tenant ' + abc?.id + ', never ' + forbidden?.id);
const tid = abc.id;

const adminRow = rowFor('admin');
const at = await login(adminRow[4], adminRow[5]);
const studentEmail = 'qhp.' + RUN + '.stu@onyx.test';
const ROLL = 'HP-' + RUN.slice(-5).toUpperCase();

await step('a learner is added, with a roll number', '/api/onyx/members', {
  method: 'POST', token: at,
  body: { name: 'Priya Sharma', email: studentEmail, role: 'student', password: PW,
    roll_number: ROLL },
});
const roster = (await call('/api/onyx/members', { token: at })).data ?? [];
const learner = roster.find((m) => m.user?.email === studentEmail);
const st = await login(studentEmail, PW);
check('and signs in', Boolean(st), ROLL);

// ---------------------------------------------------------------------------

startPhase('2. Help: the learner asks, the operator answers');

const asked = await step('the learner raises a question from Help', '/api/onyx/tickets', {
  method: 'POST', token: st,
  body: {
    subject: 'I cannot open my recorded lecture ' + RUN,
    body: 'The video for week 2 will not play for me. It sits at nought per cent.\n\n'
      + 'I have tried two browsers.',
    priority: 'normal',
  },
});
const ticketId = asked.data?.id;

const mine = await call('/api/onyx/tickets', { token: st });
check('it is on their own list', (mine.data ?? []).some((t) => Number(t.id) === Number(ticketId)),
  (mine.data ?? []).length + ' of their own');

const inConsole = await step('the operator sees the institution’s queue',
  '/api/onyx/platform/tenants/' + tid + '/tickets', { token: pt });
const theirs = (inConsole.data ?? []).find((t) => Number(t.id) === Number(ticketId));
check('with this question in it', Boolean(theirs),
  (inConsole.data ?? []).length + ' in the queue');
check('and it reads as waiting on somebody',
  ['open', 'assigned'].includes(String(theirs?.status)), 'status=' + theirs?.status);
check('the learner’s own words are there, not just a subject',
  String(theirs?.body ?? '').includes('nought per cent'),
  String(theirs?.body ?? '').slice(0, 45) + '…');

const answered = await step('the operator answers it',
  '/api/onyx/platform/tenants/' + tid + '/tickets/' + ticketId + '/respond', {
    method: 'POST', token: pt,
    body: { body: 'That lecture was uploaded in a format Safari will not play. '
      + 'It has been re-encoded — try it again and tell us if it still sticks.' },
  });

const afterAnswer = await call('/api/onyx/tickets/' + ticketId, { token: st });
const events = afterAnswer.data?.events ?? afterAnswer.data?.responses ?? [];
check('and the answer reaches the learner who asked',
  JSON.stringify(afterAnswer.data ?? {}).includes('re-encoded'),
  'status=' + afterAnswer.data?.status + ', ' + events.length + ' events');

const admin = await call('/api/onyx/tickets', { token: at });
check('an administrator of the institution sees it too',
  (admin.data ?? []).some((t) => Number(t.id) === Number(ticketId)),
  (admin.data ?? []).length + ' in their queue');

const otherStudent = rowFor('student');
const st2 = await login(otherStudent[4], otherStudent[5]);
const nosey = await call('/api/onyx/tickets', { token: st2 });
check('another learner cannot see somebody else’s question',
  !(nosey.data ?? []).some((t) => Number(t.id) === Number(ticketId)),
  (nosey.data ?? []).length + ' of their own');

await step('the operator marks it resolved',
  '/api/onyx/platform/tenants/' + tid + '/tickets/' + ticketId + '/resolve',
  { method: 'POST', token: pt, body: {} });
const settled = await call('/api/onyx/tickets/' + ticketId, { token: st });
check('and the learner sees it as resolved', settled.data?.status === 'resolved',
  'status=' + settled.data?.status);

const anon = await call('/api/onyx/platform/tenants/' + tid + '/tickets');
check('the queue is not open to an anonymous caller',
  anon.status === 401 || anon.status === 403, 'status ' + anon.status);

// ---------------------------------------------------------------------------

startPhase('3. a result, the moment the paper is handed in');

const academics = (await call('/api/onyx/platform/tenants/' + tid + '/academics?limit=200',
  { token: pt })).data;
const course = (academics?.courses ?? []).find((c) => c.status === 1);

/*
 * A bank authored for this run, rather than one of the institution's.
 *
 * Drawing from an existing bank made this check unrepeatable, and for a reason
 * worth writing down: a section takes N at random, and the seeded banks hold an
 * essay and a multiple-choice nobody set a correct option on. Deal either one
 * and the paper correctly waits for a marker — so the run passed or failed on
 * the draw, and a failure said "no instant result" when the truth was "this
 * paper cannot have one".
 *
 * What is being checked here is the promise the paper makes when it CAN be
 * marked by machine. So the bank is built to be exactly that.
 */
const bank = (await step('a bank of questions a machine can mark',
  '/api/onyx/platform/tenants/' + tid + '/banks', {
    method: 'POST', token: pt,
    body: { name: 'Help QA bank ' + RUN, course_id: course.id },
  })).data;

const QUESTIONS = [
  { type: 'single', prompt: 'Which keyword declares a constant in JavaScript?',
    options: [{ id: 'a', text: 'let' }, { id: 'b', text: 'const' }, { id: 'c', text: 'var' }],
    answer: 'b', points: 2 },
  { type: 'truefalse', prompt: 'An array index in JavaScript starts at zero.',
    answer: 'true', points: 2 },
];
for (const q of QUESTIONS) {
  await call('/api/onyx/platform/tenants/' + tid + '/banks/' + bank.id + '/questions',
    { method: 'POST', token: pt, body: q });
}

const listed = ((await call('/api/onyx/platform/tenants/' + tid + '/banks',
  { token: pt })).data ?? []).find((b) => Number(b.id) === Number(bank.id));
check('and the console says how much of it needs a person',
  Number(listed?.question_count) === 2 && Number(listed?.needs_marking) === 0,
  'count=' + listed?.question_count + ' needs_marking=' + listed?.needs_marking);

await call('/api/onyx/courses/' + course.id + '/enroll',
  { method: 'POST', token: at, body: { user_id: learner?.user_id } });

const paper = await step('a paper is created', '/api/onyx/platform/tenants/' + tid
  + '/assessments', {
  method: 'POST', token: pt,
  body: {
    title: 'Help QA paper ' + RUN, course_id: course.id, duration_minutes: 30,
    opens_at: new Date(Date.now() - 60_000).toISOString(),
    closes_at: new Date(Date.now() + 3 * 3_600_000).toISOString(),
  },
});
const paperId = paper.data?.id;
await step('drawing from that bank', '/api/onyx/platform/tenants/' + tid
  + '/assessments/' + paperId + '/sections', {
  method: 'PUT', token: pt,
  body: { sections: [{ id: 's1', title: 'All', bank_id: bank.id, take: 2 }] },
});
await step('and published', '/api/onyx/platform/tenants/' + tid
  + '/assessments/' + paperId + '/publish', { method: 'POST', token: pt, body: {} });

// Consent and the devices, because a paper set from the console is monitored
// by default now -- the sitting screen sends both, and a paper that refused
// without them would be behaving correctly.
const started = await step('the learner starts it',
  '/api/onyx/assessments/' + paperId + '/start', {
    method: 'POST', token: st,
    body: { consent: true, devices: { camera: true, screen: true } },
  });
const attemptId = started.data?.id;
// Answered correctly, so a full mark proves the marking ran rather than merely
// that a number appeared.
const KEY = { single: 'b', truefalse: 'true' };
for (const q of started.data?.questions ?? []) {
  await call('/api/onyx/attempts/' + attemptId + '/answer', {
    method: 'POST', token: st,
    body: { question_id: q.question_id, response: KEY[q.type] ?? 'answer' },
  });
}
const handed = await step('and hands it in',
  '/api/onyx/attempts/' + attemptId + '/submit', { method: 'POST', token: st, body: {} });

const seen = await call('/api/onyx/attempts/' + attemptId, { token: st });
check('the mark is on their screen at hand-in, with nothing to publish',
  seen.data?.score !== null && seen.data?.score !== undefined,
  'score=' + seen.data?.score + '/' + seen.data?.max_score
  + ' status=' + seen.data?.status);
check('and it is the mark they earned',
  Number(seen.data?.score) === 4, String(seen.data?.score) + ' of 4');
check('every question was marked by machine',
  (seen.data?.questions ?? []).length === 2
  && (seen.data?.questions ?? []).every((q) => q.awarded !== null && q.awarded !== undefined),
  (seen.data?.questions ?? []).map((q) => q.type + '=' + q.awarded).join(' '));
check('and their own answers are readable back to them',
  (seen.data?.questions ?? []).every((q) => q.response !== null),
  (seen.data?.questions ?? []).length + ' answered');

// ---------------------------------------------------------------------------

startPhase('4. the sitting, on the learner’s timetable');

const startsAt = new Date(Date.now() + 2 * 86_400_000);
startsAt.setHours(10, 0, 0, 0);
const sitting = await step('a sitting is scheduled on that paper',
  '/api/onyx/platform/tenants/' + tid + '/exams', {
    method: 'POST', token: pt,
    body: {
      course_id: course.id, title: 'Help QA sitting ' + RUN,
      starts_at: startsAt.toISOString(), duration_minutes: 90,
      max_marks: 50, pass_marks: 20, assessment_id: paperId,
    },
  });
const examId = sitting.data?.id;

const week = await call('/api/onyx/calendar?from='
  + encodeURIComponent(new Date(Date.now() - 86_400_000).toISOString())
  + '&to=' + encodeURIComponent(new Date(Date.now() + 7 * 86_400_000).toISOString()),
{ token: st });
const onIt = (week.data?.exams ?? []).find((e) => Number(e.id) === Number(examId));
check('it is on the learner’s own timetable', Boolean(onIt),
  onIt ? onIt.title : (week.data?.exams ?? []).length + ' sittings, not this one');
check('at the hour it was scheduled for',
  Boolean(onIt) && Math.abs(Date.parse(onIt.starts_at) - startsAt.getTime()) < 60_000,
  onIt?.starts_at);
check('carrying the ninety minutes it occupies',
  Number(onIt?.duration_minutes) === 90, 'duration=' + onIt?.duration_minutes);

const consoleWeek = await call('/api/onyx/platform/tenants/' + tid + '/exam-week?from='
  + encodeURIComponent(new Date(Date.now() - 86_400_000).toISOString())
  + '&to=' + encodeURIComponent(new Date(Date.now() + 7 * 86_400_000).toISOString()),
{ token: pt });
check('and on the operator’s grid of the same week',
  (consoleWeek.data?.exams ?? []).some((e) => Number(e.id) === Number(examId)),
  (consoleWeek.data?.exams ?? []).length + ' sittings');

// ---------------------------------------------------------------------------

startPhase('5. one person’s permissions, from the console');

const facultyRow = rowFor('faculty');
const ft = await login(facultyRow[4], facultyRow[5]);
const facultyMember = roster.find((m) => m.user?.email === facultyRow[4]);
check('a lecturer to act on', Boolean(facultyMember), facultyRow[4]);

const found = await call('/api/onyx/platform/tenants/' + tid + '/people?limit=200',
  { token: pt });
const byRoll = (found.data?.people ?? []).find((p) => p.roll_number === ROLL);
check('the console can find somebody by roll number', Boolean(byRoll),
  byRoll?.name + ' · ' + byRoll?.roll_number);

const before = await step('their capabilities read',
  '/api/onyx/platform/tenants/' + tid + '/members/' + facultyMember.id + '/permissions',
  { token: pt });
const caps = before.data?.capabilities ?? [];
check('with role, personal and effective kept apart',
  caps.length > 0 && caps.every((c) => 'by_role' in c && 'personal' in c && 'effective' in c),
  caps.length + ' capabilities');

const sealed = caps.find((c) => c.key === 'fees.structures');
check('a capability no role may ever hold is not offered',
  sealed && sealed.grantable === false, 'fees.structures grantable=' + sealed?.grantable);

// Something their role does not carry, granted by name.
const notTheirs = caps.find((c) => c.grantable && !c.by_role && !c.effective);
if (notTheirs) {
  const saved = await step('one capability is given to them by name',
    '/api/onyx/platform/tenants/' + tid + '/members/' + facultyMember.id + '/permissions', {
      method: 'PUT', token: pt, body: { permissions: { [notTheirs.key]: true } },
    });
  const after = await call('/api/onyx/platform/tenants/' + tid + '/members/'
    + facultyMember.id + '/permissions', { token: pt });
  const now = (after.data?.capabilities ?? []).find((c) => c.key === notTheirs.key);
  check('and it applies to them', now?.effective === true && now?.personal === true,
    notTheirs.key + ': personal=' + now?.personal + ' effective=' + now?.effective);
  check('while their role still does not carry it', now?.by_role === false,
    'by_role=' + now?.by_role);

  // Put it back.
  await call('/api/onyx/platform/tenants/' + tid + '/members/' + facultyMember.id
    + '/permissions', { method: 'PUT', token: pt, body: { permissions: {} } });
  const restored = await call('/api/onyx/platform/tenants/' + tid + '/members/'
    + facultyMember.id + '/permissions', { token: pt });
  const back = (restored.data?.capabilities ?? []).find((c) => c.key === notTheirs.key);
  check('and it can be taken away again', back?.personal === null,
    'personal=' + String(back?.personal));
} else {
  check('one capability is given to them by name', false,
    'no grantable capability outside their role to test with');
}

const anonPerm = await call('/api/onyx/platform/tenants/' + tid + '/members/'
  + facultyMember.id + '/permissions');
check('none of this is open to an anonymous caller',
  anonPerm.status === 401 || anonPerm.status === 403, 'status ' + anonPerm.status);

// ---------------------------------------------------------------------------

startPhase('6. putting ABC Institution back as it was');

const del = async (path) => (await call(path, { method: 'DELETE', token: pt })).status;
if (examId) {
  check('the sitting is removed',
    [200, 404].includes(await del('/api/onyx/platform/tenants/' + tid + '/exams/' + examId)));
}
const { withDb } = await import('../tests/e2e/harness.ts');
await withDb(async (db) => {
  await db.query(
    'DELETE FROM public."onyx_assessment_attempts" WHERE tenant_id = $1 AND assessment_id = $2',
    [tid, paperId]);
  await db.query('DELETE FROM public."onyx_tickets" WHERE tenant_id = $1 AND id = $2',
    [tid, ticketId]);
});
if (paperId) {
  check('the paper is removed',
    [200, 404].includes(
      await del('/api/onyx/platform/tenants/' + tid + '/assessments/' + paperId)));
}
if (learner?.id) {
  check('the learner is removed',
    [200, 404].includes(
      await del('/api/onyx/platform/tenants/' + tid + '/members/' + learner.id)));
}
await withDb(async (db) => {
  await db.query('DELETE FROM public."onyx_users" WHERE email = $1', [studentEmail]);
  // The bank this run authored, and its questions. There is no console route
  // that removes a bank -- deliberately, since a bank other papers draw from
  // should not go with one click -- so the run tidies up its own by hand.
  if (bank?.id) {
    await db.query(
      'DELETE FROM public."onyx_question_versions" WHERE tenant_id = $1 AND question_id IN'
      + ' (SELECT id FROM public."onyx_questions" WHERE bank_id = $2)', [tid, bank.id]);
    await db.query('DELETE FROM public."onyx_questions" WHERE tenant_id = $1 AND bank_id = $2',
      [tid, bank.id]);
    await db.query('DELETE FROM public."onyx_question_banks" WHERE tenant_id = $1 AND id = $2',
      [tid, bank.id]);
  }
});
check('and the bank it authored', true, 'Help QA bank ' + RUN);

const passed = results.filter((r) => r.pass).length;
const failed = results.filter((r) => !r.pass);
console.log('\n' + '='.repeat(72));
console.log(passed + ' pass, ' + failed.length + ' fail, of ' + results.length);
for (const f of failed) console.log('  FAIL [' + f.phase + '] ' + f.label + ' -- ' + f.detail);
process.exit(failed.length ? 1 : 0);
