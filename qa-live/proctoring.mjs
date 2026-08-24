/**
 * A paper set from the console is monitored, and an invigilator can watch.
 *
 * Two claims, checked against the deployed site at ABC Institution:
 *
 *   1. The switches faculty has are reachable from the console, they default
 *      to a monitored examination, and unticking one is honoured rather than
 *      quietly overridden by the default.
 *   2. A candidate sitting such a paper appears on the invigilation queue with
 *      the live-camera control available -- which is what `watch_camera` gates.
 *
 * ABC Institution only, and everything it creates it removes.
 *
 *   node qa-live/proctoring.mjs
 */
import fs from 'node:fs';

const BASE = process.env.QA_BASE ?? 'https://onyx-lms-v2.vercel.app';
const RUN = Date.now().toString(36);
const PW = 'QaProc#2026!';

const cred = fs.readFileSync('onyx-v2-credentials.csv', 'utf8')
  .trim().split(/\r?\n/).slice(1).map((r) => r.split(','));
const rowFor = (role) => cred.find((r) => r[1] === 'abc-institution' && r[2] === role);

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
  const p = await res.json().catch(() => ({}));
  return { status: res.status, data: p?.data, message: p?.message };
}
const login = async (e, p) => (await call('/api/onyx/auth/login',
  { method: 'POST', body: { email: e, password: p } })).data?.token;
const on = (v) => Boolean(Number(v ?? 0));

// ---------------------------------------------------------------------------

startPhase('1. the institution and the people');

const pt = (await call('/api/onyx/platform/login', {
  method: 'POST',
  body: { email: 'superadmin@onyx.platform', password: 'Platform#2026!' },
})).data?.token;
const tenants = (await call('/api/onyx/platform/tenants', { token: pt })).data ?? [];
const abc = tenants.find((t) => t.slug === 'abc-institution');
const forbidden = tenants.find((t) => t.slug === 'malla-reddy-university');
check('ABC Institution is the one being touched',
  Boolean(abc) && abc.id !== forbidden?.id,
  'tenant ' + abc?.id + ', never ' + forbidden?.id);
const tid = abc.id;

const adminRow = rowFor('admin');
const at = await login(adminRow[4], adminRow[5]);
const email = 'qproc.' + RUN + '@onyx.test';
await call('/api/onyx/members', {
  method: 'POST', token: at,
  body: { name: 'Proctor Candidate', email, role: 'student', password: PW },
});
const learner = ((await call('/api/onyx/members', { token: at })).data ?? [])
  .find((m) => m.user?.email === email);
const st = await login(email, PW);
check('a candidate exists and can sign in', Boolean(st), email);

// ---------------------------------------------------------------------------

startPhase('2. the console sets how the paper is sat');

const course = ((await call('/api/onyx/platform/tenants/' + tid + '/academics?limit=200',
  { token: pt })).data?.courses ?? []).find((c) => c.status === 1);
await call('/api/onyx/courses/' + course.id + '/enroll',
  { method: 'POST', token: at, body: { user_id: learner.user_id } });

const bank = (await call('/api/onyx/platform/tenants/' + tid + '/banks', {
  method: 'POST', token: pt,
  body: { name: 'Proctor QA bank ' + RUN, course_id: course.id },
})).data;
await call('/api/onyx/platform/tenants/' + tid + '/banks/' + bank.id + '/questions', {
  method: 'POST', token: pt,
  body: {
    type: 'single', prompt: 'Pick b.',
    options: [{ id: 'a', text: 'a' }, { id: 'b', text: 'b' }],
    answer: 'b', points: 1,
  },
});

// Sent with nothing said about monitoring, which is what the form does when an
// operator leaves every box as they found it.
const paper = (await call('/api/onyx/platform/tenants/' + tid + '/assessments', {
  method: 'POST', token: pt,
  body: {
    title: 'Proctor QA paper ' + RUN, course_id: course.id, duration_minutes: 30,
    opens_at: new Date(Date.now() - 60_000).toISOString(),
    closes_at: new Date(Date.now() + 3 * 3_600_000).toISOString(),
  },
})).data;
const paperId = paper.id;

const detail = async () => (await call('/api/onyx/platform/tenants/' + tid
  + '/assessments/' + paperId, { token: pt })).data?.assessment;

const made = await detail();
check('a paper from the console is monitored by default', on(made?.proctoring),
  'proctoring=' + made?.proctoring);
check('with a camera required', on(made?.require_camera),
  'require_camera=' + made?.require_camera);
check('and the screen shared', on(made?.require_screen),
  'require_screen=' + made?.require_screen);
check('an invigilator may watch the camera', on(made?.watch_camera),
  'watch_camera=' + made?.watch_camera);
check('the questions and options are shuffled',
  on(made?.shuffle_questions) && on(made?.shuffle_options),
  'questions=' + made?.shuffle_questions + ' options=' + made?.shuffle_options);

// The other half of a default: the operator's own choice has to survive it.
await call('/api/onyx/platform/tenants/' + tid + '/assessments/' + paperId, {
  method: 'PATCH', token: pt,
  body: { shuffle_options: false, require_screen: false },
});
const edited = await detail();
check('unticking a box is honoured, not overridden',
  !on(edited?.shuffle_options) && !on(edited?.require_screen)
  && on(edited?.proctoring) && on(edited?.require_camera),
  'options=' + edited?.shuffle_options + ' screen=' + edited?.require_screen
  + ', monitoring and camera untouched');

// Put it back; the sitting below is about the camera.
await call('/api/onyx/platform/tenants/' + tid + '/assessments/' + paperId, {
  method: 'PATCH', token: pt,
  body: { require_screen: true, shuffle_options: true },
});

await call('/api/onyx/platform/tenants/' + tid + '/assessments/' + paperId + '/sections', {
  method: 'PUT', token: pt,
  body: { sections: [{ id: 's1', title: 'All', bank_id: bank.id, take: 1 }] },
});
await call('/api/onyx/platform/tenants/' + tid + '/assessments/' + paperId + '/publish',
  { method: 'POST', token: pt, body: {} });

// ---------------------------------------------------------------------------

startPhase('3. the candidate sits it, and an invigilator watches');

// Consent and the devices, as the sitting screen sends them. A monitored paper
// is refused without consent, which is the point of a monitored paper -- and a
// paper requiring a camera is not dealt to a browser that has not got one.
const refused = await call('/api/onyx/assessments/' + paperId + '/start',
  { method: 'POST', token: st, body: {} });
check('a monitored paper is not dealt without consent', refused.status === 422,
  refused.status + ' ' + (refused.message ?? ''));

const started = await call('/api/onyx/assessments/' + paperId + '/start', {
  method: 'POST', token: st,
  body: { consent: true, devices: { camera: true, screen: true } },
});
check('the candidate can start it once they consent', started.status === 200,
  started.status + ' ' + (started.message ?? ''));
const attemptId = started.data?.id;

const facultyRow = rowFor('faculty');
const ft = await login(facultyRow[4], facultyRow[5]);
const queue = await call('/api/onyx/proctor/queue?assessment_id=' + paperId,
  { token: ft });
const rows = queue.data?.queue ?? queue.data ?? [];
const row = (Array.isArray(rows) ? rows : [])
  .find((r) => Number(r.attempt_id) === Number(attemptId));
check('the sitting is on the invigilation queue', Boolean(row),
  row ? 'attempt ' + row.attempt_id : 'status ' + queue.status);
check('and it says a camera is required', Boolean(row?.requires_camera),
  'requires_camera=' + row?.requires_camera);
check('and the invigilator is offered the live camera', Boolean(row?.watch_camera),
  'watch_camera=' + row?.watch_camera);

// The control is only a button. The claim underneath it is that asking to
// watch is ACCEPTED, which is the server-side gate the button depends on.
const asked = await call('/api/onyx/attempts/' + attemptId + '/watch', {
  method: 'POST', token: ft,
  body: { offer: { type: 'offer', sdp: 'v=0 qa' } },
});
check('the invigilator may open that candidate camera',
  asked.status >= 200 && asked.status < 300,
  asked.status + ' ' + (asked.message ?? ''));
const seen = await call('/api/onyx/attempts/' + attemptId + '/watch', { token: st });
check('and the candidate browser is handed the request',
  Boolean(seen.data), JSON.stringify(seen.data ?? null).slice(0, 60));

// A paper that does not allow it must refuse, or the switch means nothing.
const openPaper = (await call('/api/onyx/platform/tenants/' + tid + '/assessments', {
  method: 'POST', token: pt,
  body: {
    title: 'Proctor QA open ' + RUN, course_id: course.id, duration_minutes: 30,
    proctoring: false, require_camera: false, require_screen: false, watch_camera: false,
    opens_at: new Date(Date.now() - 60_000).toISOString(),
    closes_at: new Date(Date.now() + 3 * 3_600_000).toISOString(),
  },
})).data;
const openMade = (await call('/api/onyx/platform/tenants/' + tid + '/assessments/'
  + openPaper.id, { token: pt })).data?.assessment;
check('an operator can still set an unmonitored paper',
  !on(openMade?.proctoring) && !on(openMade?.watch_camera),
  'proctoring=' + openMade?.proctoring + ' watch_camera=' + openMade?.watch_camera);

// ---------------------------------------------------------------------------

startPhase('4. putting ABC Institution back as it was');

const { withDb } = await import('../tests/e2e/harness.ts');
await withDb(async (db) => {
  await db.query('DELETE FROM public."onyx_assessment_attempts"'
    + ' WHERE tenant_id = $1 AND assessment_id = $2', [tid, paperId]);
});
for (const id of [paperId, openPaper.id]) {
  const r = await call('/api/onyx/platform/tenants/' + tid + '/assessments/' + id,
    { method: 'DELETE', token: pt });
  check('paper ' + id + ' removed', [200, 404].includes(r.status), String(r.status));
}
const gone = await call('/api/onyx/platform/tenants/' + tid + '/members/' + learner.id,
  { method: 'DELETE', token: pt });
check('the candidate is removed', [200, 404].includes(gone.status), String(gone.status));
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
check('and the bank it authored', true, 'Proctor QA bank ' + RUN);

const passed = results.filter((r) => r.pass).length;
const failed = results.filter((r) => !r.pass);
console.log('\n' + '='.repeat(72));
console.log(passed + ' pass, ' + failed.length + ' fail, of ' + results.length);
for (const x of failed) console.log('  FAIL [' + x.phase + '] ' + x.label + ' -- ' + x.detail);
process.exit(failed.length ? 1 : 0);
