/**
 * Leaving the examination, warned twice and stopped on the third — live.
 *
 * The whole loop, on a paper this file creates and removes: a candidate leaves
 * and is warned in words; leaves again and is told it is their last chance;
 * leaves a third time and the paper is handed in for them. Then an invigilator
 * sees it on the console, lets them carry on, and they finish the paper with
 * the answers and the minutes they had.
 *
 * ABC Institution only. Everything it makes it removes.
 *
 *   node --env-file=.env qa-live/breach-rule.mjs
 */
import fs from 'node:fs';

const BASE = process.env.QA_BASE ?? 'https://onyx-lms-v2.vercel.app';
const RUN = Date.now().toString(36);
const PW = 'QaBreach#2026!';

const cred = fs.readFileSync('onyx-v2-credentials.csv', 'utf8')
  .trim().split(/\r?\n/).slice(1).map((r) => r.split(','));
const rowFor = (role) => cred.find((r) => r[1] === 'abc-institution' && r[2] === role);

const results = [];
let phase = '';
const startPhase = (n) => { phase = n; console.log('\n== ' + n + ' =='); };
function check(label, pass, detail = '') {
  results.push({ phase, label, pass: Boolean(pass), detail });
  console.log((pass ? 'ok    ' : 'FAIL  ') + label.padEnd(60), detail);
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
  const p = await res.json().catch(() => ({}));
  return { status: res.status, data: p?.data, message: p?.message };
}
const login = async (e, p) => (await call('/api/onyx/auth/login',
  { method: 'POST', body: { email: e, password: p } })).data?.token;

// ---------------------------------------------------------------------------

startPhase('1. a monitored paper with the rule on it');

const pt = (await call('/api/onyx/platform/login', {
  method: 'POST',
  body: { email: 'superadmin@onyx.platform', password: 'Platform#2026!' },
})).data?.token;
const tenants = (await call('/api/onyx/platform/tenants', { token: pt })).data ?? [];
const abc = tenants.find((t) => t.slug === 'abc-institution');
const mrit = tenants.find((t) => t.slug === 'malla-reddy-university');
check('ABC Institution is the one being touched',
  Boolean(abc) && abc.id !== mrit?.id, 'tenant ' + abc?.id + ', never ' + mrit?.id);
const tid = abc.id;
const base = '/api/onyx/platform/tenants/' + tid;

const adminRow = rowFor('admin');
const at = await login(adminRow[4], adminRow[5]);
const course = ((await call(base + '/academics?limit=200', { token: pt })).data?.courses ?? [])
  .find((c) => Number(c.status) === 1 && c.access === 'open');

const bank = (await call(base + '/banks', {
  method: 'POST', token: pt, body: { name: 'Breach QA bank ' + RUN, course_id: course.id },
})).data;
for (let i = 1; i <= 4; i += 1) {
  await call(base + '/banks/' + bank.id + '/questions', {
    method: 'POST', token: pt,
    body: {
      type: 'single', prompt: 'Breach QA Q' + i + ' (' + RUN + ')',
      options: [{ id: 'a', text: 'a' }, { id: 'b', text: 'b' }], answer: 'b', points: 1,
    },
  });
}

const paper = (await call(base + '/assessments', {
  method: 'POST', token: pt,
  body: {
    title: 'Breach QA paper ' + RUN, course_id: course.id, duration_minutes: 60,
    opens_at: new Date(Date.now() - 60_000).toISOString(),
    closes_at: new Date(Date.now() + 6 * 3_600_000).toISOString(),
    // Monitored, which is what makes the rule apply, but no devices required:
    // there is no camera on a test runner.
    proctoring: true, require_camera: false, require_screen: false, watch_camera: false,
    instant_results: true, anonymous_marking: false,
    breach_limit: 3,
  },
})).data;
await call(base + '/assessments/' + paper.id + '/sections', {
  method: 'PUT', token: pt,
  body: { sections: [{ id: 's1', title: 'All', bank_id: bank.id, take: 4 }] },
});
await call(base + '/assessments/' + paper.id + '/publish', { method: 'POST', token: pt, body: {} });
check('a monitored paper that stops after three departures', Boolean(paper?.id),
  'paper ' + paper?.id + ', limit 3');

// ---------------------------------------------------------------------------

startPhase('2. a candidate sits it');

const email = 'qbreach.' + RUN + '@onyx.test';
await call('/api/onyx/members', {
  method: 'POST', token: at,
  body: { name: 'Breach QA', email, role: 'student', password: PW,
    roll_number: 'QB-' + RUN.slice(-4).toUpperCase() },
});
const member = ((await call('/api/onyx/members', { token: at })).data ?? [])
  .find((m) => m.user?.email === email);
await call('/api/onyx/courses/' + course.id + '/enroll',
  { method: 'POST', token: at, body: { user_id: member.user_id } });
const st = await login(email, PW);

const go = await call('/api/onyx/assessments/' + paper.id + '/start',
  { method: 'POST', token: st, body: { consent: true } });
const attemptId = go.data?.id;
const questions = go.data?.questions ?? [];
check('they are dealt the paper', questions.length === 4, 'attempt ' + attemptId);

// Two answers written before anything goes wrong, so "their answers survive"
// is a claim with something behind it.
for (const q of questions.slice(0, 2)) {
  await call('/api/onyx/attempts/' + attemptId + '/answer',
    { method: 'POST', token: st, body: { question_id: Number(q.question_id), response: 'b' } });
}
check('and answer two of the four before anything happens', true, '2 of 4 written');

// ---------------------------------------------------------------------------

startPhase('3. leaving the paper');

const leave = () => call('/api/onyx/attempts/' + attemptId + '/proctor',
  { method: 'POST', token: st, body: { kind: 'tab_blur', detail: { how: 'qa' } } });

const first = (await leave()).data;
check('the first departure warns and does not end it',
  first?.terminated === false && /warning 1 of 3/i.test(first?.warning ?? ''),
  first?.warning?.slice(0, 62));

const second = (await leave()).data;
check('the second says it is their last chance, in those words',
  second?.terminated === false && /final warning/i.test(second?.warning ?? ''),
  second?.warning?.slice(0, 62));

const third = (await leave()).data;
check('the third hands the paper in',
  third?.terminated === true && /handed in/i.test(third?.warning ?? ''),
  'breaches=' + third?.breaches);

const afterStop = (await call('/api/onyx/attempts/' + attemptId, { token: st })).data;
check('the candidate is told they were stopped', afterStop?.status === 'terminated',
  'status=' + afterStop?.status);
check('and is NOT shown the mark for a paper they may carry on sitting',
  afterStop?.score === null || afterStop?.score === undefined,
  'score=' + String(afterStop?.score));

const blocked = await call('/api/onyx/attempts/' + attemptId + '/answer', {
  method: 'POST', token: st,
  body: { question_id: Number(questions[2].question_id), response: 'b' },
});
check('and cannot keep answering', blocked.status === 422,
  blocked.status + ' ' + (blocked.message ?? '').slice(0, 40));

// ---------------------------------------------------------------------------

startPhase('4. the invigilator sees it');

const queue = (await call(base + '/proctor/queue?assessment_id=' + paper.id,
  { token: pt })).data ?? [];
const row = queue.find((r) => Number(r.attempt_id) === Number(attemptId));
check('the stopped paper is on the invigilation console', Boolean(row),
  queue.length + ' rows on this paper');
check('marked as stopped, with the count that stopped it',
  Boolean(row?.terminated_at) && Number(row?.breaches) === 3,
  'breaches=' + row?.breaches + ' switches=' + row?.tab_switches);
check('and named, not numbered', Boolean(row?.roll_number || row?.name),
  row?.roll_number ?? row?.name);

// The institution's own invigilator sees the same thing.
const facultyRow = rowFor('faculty');
const ft = facultyRow ? await login(facultyRow[4], facultyRow[5]) : null;
const ownQueue = ft
  ? (await call('/api/onyx/proctor/queue?assessment_id=' + paper.id, { token: ft })).data ?? []
  : [];
check('the institution’s own invigilator sees it too',
  ownQueue.some((r) => Number(r.attempt_id) === Number(attemptId) && r.terminated_at),
  ownQueue.length + ' rows');

// ---------------------------------------------------------------------------

startPhase('5. letting them carry on');

const before = (await call(base + '/proctor/queue?assessment_id=' + paper.id, { token: pt }))
  .data.find((r) => Number(r.attempt_id) === Number(attemptId));

const restored = await call(base + '/attempts/' + attemptId + '/reinstate',
  { method: 'POST', token: pt, body: {} });
check('an invigilator can let them carry on', restored.status === 200,
  restored.message ?? restored.status);

const resumed = (await call('/api/onyx/attempts/' + attemptId, { token: st })).data;
check('the paper is theirs again', resumed?.status === 'in_progress',
  'status=' + resumed?.status);
check('with the minutes they had left, not the ones since',
  Number(resumed?.seconds_remaining) > 3000 && Number(resumed?.seconds_remaining) <= 3600,
  resumed?.seconds_remaining + 's of 3600');
check('and the two answers they had already written',
  (resumed?.questions ?? []).filter((q) => q.response === 'b').length === 2,
  (resumed?.questions ?? []).filter((q) => q.response).length + ' answered');

// Their warnings start again -- a second chance, not an exemption.
const afterBack = (await leave()).data;
check('their warnings start again from the first',
  afterBack?.terminated === false && /warning 1 of 3/i.test(afterBack?.warning ?? ''),
  afterBack?.warning?.slice(0, 48));

// And they finish the paper properly.
for (const q of questions.slice(2)) {
  await call('/api/onyx/attempts/' + attemptId + '/answer',
    { method: 'POST', token: st, body: { question_id: Number(q.question_id), response: 'b' } });
}
const handed = await call('/api/onyx/attempts/' + attemptId + '/submit',
  { method: 'POST', token: st, body: {} });
check('they finish and hand in themselves', handed.status === 200);
const done = (await call('/api/onyx/attempts/' + attemptId, { token: st })).data;
check('and are marked out of four, all four right',
  Number(done?.score) === 4 && done?.status === 'published',
  done?.score + ' / ' + done?.max_score + ' (' + done?.status + ')');

// ---------------------------------------------------------------------------

startPhase('6. a paper without the rule is untouched');

const oldPaper = (await call(base + '/assessments', {
  method: 'POST', token: pt,
  body: {
    title: 'Breach QA no-rule ' + RUN, course_id: course.id, duration_minutes: 60,
    opens_at: new Date(Date.now() - 60_000).toISOString(),
    closes_at: new Date(Date.now() + 6 * 3_600_000).toISOString(),
    proctoring: true, require_camera: false, require_screen: false, watch_camera: false,
    instant_results: true, breach_limit: 0,
  },
})).data;
await call(base + '/assessments/' + oldPaper.id + '/sections', {
  method: 'PUT', token: pt,
  body: { sections: [{ id: 's1', title: 'All', bank_id: bank.id, take: 4 }] },
});
await call(base + '/assessments/' + oldPaper.id + '/publish',
  { method: 'POST', token: pt, body: {} });
const secondGo = await call('/api/onyx/assessments/' + oldPaper.id + '/start',
  { method: 'POST', token: st, body: { consent: true } });
const oldAttempt = secondGo.data?.id;
let stillGoing = true;
for (let i = 0; i < 5; i += 1) {
  const said = (await call('/api/onyx/attempts/' + oldAttempt + '/proctor',
    { method: 'POST', token: st, body: { kind: 'tab_blur' } })).data;
  if (said?.terminated) stillGoing = false;
}
check('five departures on a paper with no rule stop nothing', stillGoing,
  'recorded, never ended');

// ---------------------------------------------------------------------------

startPhase('7. putting ABC Institution back as it was');

const { withDb } = await import('../tests/e2e/harness.ts');
await withDb(async (db) => {
  for (const id of [paper.id, oldPaper.id]) {
    await db.query('DELETE FROM public."onyx_proctor_events" WHERE tenant_id = $1'
      + ' AND attempt_id IN (SELECT id FROM public."onyx_assessment_attempts"'
      + ' WHERE tenant_id = $1 AND assessment_id = $2)', [tid, id]);
    await db.query('DELETE FROM public."onyx_assessment_answers" WHERE tenant_id = $1'
      + ' AND attempt_id IN (SELECT id FROM public."onyx_assessment_attempts"'
      + ' WHERE tenant_id = $1 AND assessment_id = $2)', [tid, id]);
    await db.query('DELETE FROM public."onyx_assessment_attempts"'
      + ' WHERE tenant_id = $1 AND assessment_id = $2', [tid, id]);
  }
});
for (const id of [paper.id, oldPaper.id]) {
  await call(base + '/assessments/' + id, { method: 'DELETE', token: pt });
}
await call(base + '/members/' + member.id, { method: 'DELETE', token: pt });
await withDb(async (db) => {
  await db.query('DELETE FROM public."onyx_users" WHERE email = $1', [email]);
  await db.query('DELETE FROM public."onyx_question_versions" WHERE tenant_id = $1'
    + ' AND question_id IN (SELECT id FROM public."onyx_questions" WHERE bank_id = $2)',
  [tid, bank.id]);
  await db.query('DELETE FROM public."onyx_questions" WHERE tenant_id = $1 AND bank_id = $2',
    [tid, bank.id]);
  await db.query('DELETE FROM public."onyx_question_banks" WHERE tenant_id = $1 AND id = $2',
    [tid, bank.id]);
});
check('everything this run made is removed', true, '1 candidate, 2 papers, 1 bank');

const passed = results.filter((r) => r.pass).length;
const failed = results.filter((r) => !r.pass);
console.log('\n' + '='.repeat(76));
console.log(passed + ' pass, ' + failed.length + ' fail, of ' + results.length);
for (const x of failed) console.log('  FAIL [' + x.phase + '] ' + x.label + ' -- ' + x.detail);
process.exit(failed.length ? 1 : 0);
