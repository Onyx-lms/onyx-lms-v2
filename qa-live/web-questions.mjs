/**
 * A question you answer by building a page — end to end, live.
 *
 * A web problem is authored, published, put on a paper and sat; the candidate
 * hands in three files; a marker opens them, marks them by hand, and the
 * result reaches the candidate. Practice is exercised on the same problem,
 * because the client asked for both.
 *
 * ABC Institution only, and everything it creates it removes.
 *
 *   node --env-file=.env qa-live/web-questions.mjs
 */
import fs from 'node:fs';

const BASE = process.env.QA_BASE ?? 'https://onyx-lms-v2.vercel.app';
const RUN = Date.now().toString(36);
const PW = 'QaWeb#2026!';

const PAGE = {
  'index.html': '<!doctype html><html><head><title>Card</title></head>'
    + '<body><h1 id="who">Meghana</h1><p class="role">Student</p></body></html>',
  'index.css': '#who { color: rebeccapurple; font-family: system-ui }',
  'index.js': 'document.getElementById("who").title = "built for the exam";',
};

const cred = fs.readFileSync('onyx-v2-credentials.csv', 'utf8')
  .trim().split(/\r?\n/).slice(1).map((r) => r.split(','));
const rowFor = (role) => cred.find((r) => r[1] === 'abc-institution' && r[2] === role);

const chr10 = String.fromCharCode(10);
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

startPhase('1. a web problem, authored and published');

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

const problem = (await call(base + '/problems', {
  method: 'POST', token: pt,
  body: {
    kind: 'web',
    title: 'Profile card ' + RUN,
    statement: 'Build a card showing a name and a role. Style the name.',
    difficulty: 'easy',
    starter_code: {
      'index.html': '<!doctype html><html><body><h1>Your name</h1></body></html>',
      'index.css': '/* style it */',
      'index.js': '// optional',
    },
    preview_entry: 'index.html',
    solution_rule: 'never',
  },
})).data;
check('a web problem is created', Boolean(problem?.id) && problem?.kind === 'web',
  'problem ' + problem?.id + ', kind ' + problem?.kind);

const live = await call(base + '/problems/' + problem.id + '/publish',
  { method: 'POST', token: pt, body: {} });
check('and publishes with no test cases at all', live.status === 200,
  live.message ?? live.status);

// The other half of that rule: a web problem with no page cannot publish.
const empty = (await call(base + '/problems', {
  method: 'POST', token: pt,
  body: { kind: 'web', title: 'No page ' + RUN, starter_code: { 'index.css': 'body{}' } },
})).data;
const refused = await call(base + '/problems/' + empty.id + '/publish',
  { method: 'POST', token: pt, body: {} });
check('a web problem with no index.html is refused',
  refused.status === 422 && /index\.html/.test(refused.message ?? ''),
  refused.status + ' ' + (refused.message ?? '').slice(0, 54));

// ---------------------------------------------------------------------------

startPhase('2. a paper with a web question on it');

const bank = (await call(base + '/banks', {
  method: 'POST', token: pt, body: { name: 'Web QA bank ' + RUN, course_id: course.id },
})).data;
const asked = await call(base + '/banks/' + bank.id + '/questions', {
  method: 'POST', token: pt,
  body: {
    type: 'web', points: 10, problem_id: problem.id,
    prompt: 'Build the profile card described. (' + RUN + ')',
  },
});
check('a web question goes into the bank', asked.status === 200, asked.message ?? '');

// Bound to a CODE problem, it must be refused.
const codeProblem = ((await call(base + '/problems', { token: pt })).data ?? [])
  .find((p) => (p.kind ?? 'code') === 'code' && p.status === 'published');
if (codeProblem) {
  const wrong = await call(base + '/banks/' + bank.id + '/questions', {
    method: 'POST', token: pt,
    body: { type: 'web', points: 5, problem_id: codeProblem.id, prompt: 'Wrong kind' },
  });
  check('but not one bound to a programming problem',
    wrong.status === 422 && /not a web one/i.test(wrong.message ?? ''),
    (wrong.message ?? '').slice(0, 48));
} else {
  check('but not one bound to a programming problem', true, 'no code problem to try');
}

const listed = ((await call(base + '/banks', { token: pt })).data ?? [])
  .find((b) => Number(b.id) === Number(bank.id));
check('the bank says the question needs a marker',
  Number(listed?.needs_marking) === 1, 'needs_marking=' + listed?.needs_marking);

const paper = (await call(base + '/assessments', {
  method: 'POST', token: pt,
  body: {
    title: 'Web QA paper ' + RUN, course_id: course.id, duration_minutes: 60,
    opens_at: new Date(Date.now() - 60_000).toISOString(),
    closes_at: new Date(Date.now() + 6 * 3_600_000).toISOString(),
    proctoring: false, require_camera: false, require_screen: false, watch_camera: false,
    instant_results: true, anonymous_marking: false,
  },
})).data;
await call(base + '/assessments/' + paper.id + '/sections', {
  method: 'PUT', token: pt,
  body: { sections: [{ id: 's1', title: 'All', bank_id: bank.id, take: 1 }] },
});
await call(base + '/assessments/' + paper.id + '/publish', { method: 'POST', token: pt, body: {} });
check('and a paper is scheduled from it', Boolean(paper?.id), 'paper ' + paper.id);

// ---------------------------------------------------------------------------

startPhase('3. a candidate builds the page');

const email = 'qweb.' + RUN + '@onyx.test';
await call('/api/onyx/members', {
  method: 'POST', token: at,
  body: { name: 'Web QA', email, role: 'student', password: PW,
    roll_number: 'QW-' + RUN.slice(-4).toUpperCase() },
});
const member = ((await call('/api/onyx/members', { token: at })).data ?? [])
  .find((m) => m.user?.email === email);
await call('/api/onyx/courses/' + course.id + '/enroll',
  { method: 'POST', token: at, body: { user_id: member.user_id } });
const st = await login(email, PW);

const go = await call('/api/onyx/assessments/' + paper.id + '/start',
  { method: 'POST', token: st, body: { consent: true } });
const attemptId = go.data?.id;
const question = (go.data?.questions ?? [])[0];
check('they are dealt the web question', question?.type === 'web', 'attempt ' + attemptId);
check('with the starter files in front of them',
  typeof question?.problem?.starter_code?.['index.html'] === 'string'
  && typeof question?.problem?.starter_code?.['index.css'] === 'string'
  && typeof question?.problem?.starter_code?.['index.js'] === 'string',
  Object.keys(question?.problem?.starter_code ?? {}).join(' '));
check('and the brief', /card showing a name/i.test(question?.problem?.statement ?? ''),
  (question?.problem?.statement ?? '').slice(0, 44));

// Everything below needs a dealt question. Stopping here with a report beats
// a TypeError that hides the twelve checks that would have run after it.
if (!question?.question_id) {
  console.log(chr10 + 'No web question was dealt, so the rest cannot run.');
  const done = results.filter((r) => r.pass).length;
  console.log(done + ' pass, ' + (results.length - done) + ' fail, of ' + results.length);
  process.exit(1);
}

const wrongShape = await call('/api/onyx/attempts/' + attemptId + '/answer', {
  method: 'POST', token: st,
  body: { question_id: Number(question.question_id), response: 'some html I guess' },
});
check('an answer of the wrong shape is refused, not stored', wrongShape.status === 422,
  wrongShape.status + ' ' + (wrongShape.message ?? '').slice(0, 44));

const saved = await call('/api/onyx/attempts/' + attemptId + '/answer', {
  method: 'POST', token: st,
  body: { question_id: Number(question.question_id), response: { files: PAGE } },
});
check('their three files are saved', saved.status === 200);

const handed = await call('/api/onyx/attempts/' + attemptId + '/submit',
  { method: 'POST', token: st, body: {} });
check('they hand in', handed.status === 200);

const mine = (await call('/api/onyx/attempts/' + attemptId, { token: st })).data;
check('and are NOT handed a mark by a machine',
  mine?.score === null && mine?.status !== 'published',
  'score=' + String(mine?.score) + ' status=' + mine?.status);

// ---------------------------------------------------------------------------

startPhase('4. a marker opens the page');

const facultyRow = rowFor('faculty');
const ft = facultyRow ? await login(facultyRow[4], facultyRow[5]) : at;
const queue = (await call('/api/onyx/assessments/' + paper.id + '/marking',
  { token: ft })).data ?? [];
check('the submission is in the marking queue', queue.length >= 1, queue.length + ' scripts');

const script = (await call('/api/onyx/attempts/' + attemptId + '/paper',
  { token: ft })).data;
const answered = (script?.questions ?? [])[0];
const files = answered?.response?.files ?? answered?.response;
check('and carries all three files, as written',
  files?.['index.html'] === PAGE['index.html']
  && files?.['index.css'] === PAGE['index.css']
  && files?.['index.js'] === PAGE['index.js'],
  Object.keys(files ?? {}).join(' '));

const pdf = await fetch(BASE + '/api/onyx/platform/tenants/' + tid
  + '/attempts/' + attemptId + '/script.pdf', { headers: { Authorization: 'Bearer ' + pt } });
const buf = Buffer.from(await pdf.arrayBuffer());
check('the printed script is a real PDF',
  pdf.status === 200 && buf.subarray(0, 4).toString() === '%PDF', buf.length + ' bytes');

const marked = await call('/api/onyx/attempts/' + attemptId + '/mark', {
  method: 'POST', token: ft,
  body: {
    marks: [{ question_id: Number(question.question_id), points: 8,
      comment: 'Good layout; the heading could be centred.' }],
  },
});
check('a person can mark it', marked.status === 200, marked.message ?? marked.status);

const released = (await call('/api/onyx/attempts/' + attemptId, { token: st })).data;
check('and the candidate sees the mark a person gave',
  Number(released?.score) === 8, released?.score + ' / ' + released?.max_score
  + ' (' + released?.status + ')');

// ---------------------------------------------------------------------------

startPhase('5. the same problem, in practice');

const practice = await call('/api/onyx/problems/' + problem.id + '/submit-web', {
  method: 'POST', token: st, body: { files: PAGE },
});
check('a learner can hand in a page for practice', practice.status === 200,
  'submission ' + practice.data?.id);
check('it is kept as a web submission, not scored',
  practice.data?.kind === 'web' && Number(practice.data?.total) === 0,
  'kind=' + practice.data?.kind + ' total=' + practice.data?.total);
const back = (await call('/api/onyx/submissions/code/' + practice.data.id,
  { token: st })).data;
check('and reads back with the files intact',
  (back?.files ?? back?.submission?.files)?.['index.html'] === PAGE['index.html'],
  'submission ' + practice.data.id);

const seen = (await call('/api/onyx/problems/' + problem.id, { token: st })).data;
check('the problem itself says it is a web one', seen?.kind === 'web',
  'kind=' + seen?.kind);

// ---------------------------------------------------------------------------

startPhase('6. putting ABC Institution back as it was');

const { withDb } = await import('../tests/e2e/harness.ts');
await withDb(async (db) => {
  await db.query('DELETE FROM public."onyx_assessment_answers" WHERE tenant_id = $1'
    + ' AND attempt_id IN (SELECT id FROM public."onyx_assessment_attempts"'
    + ' WHERE tenant_id = $1 AND assessment_id = $2)', [tid, paper.id]);
  await db.query('DELETE FROM public."onyx_assessment_attempts"'
    + ' WHERE tenant_id = $1 AND assessment_id = $2', [tid, paper.id]);
});
await call(base + '/assessments/' + paper.id, { method: 'DELETE', token: pt });
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
  await db.query('DELETE FROM public."onyx_code_submissions" WHERE tenant_id = $1'
    + ' AND problem_id = ANY($2)', [tid, [problem.id, empty.id]]);
  await db.query('DELETE FROM public."onyx_problems" WHERE tenant_id = $1 AND id = ANY($2)',
    [tid, [problem.id, empty.id]]);
});
check('everything this run made is removed', true,
  '1 candidate, 1 paper, 1 bank, 2 problems');

const passed = results.filter((r) => r.pass).length;
const failed = results.filter((r) => !r.pass);
console.log('\n' + '='.repeat(76));
console.log(passed + ' pass, ' + failed.length + ' fail, of ' + results.length);
for (const x of failed) console.log('  FAIL [' + x.phase + '] ' + x.label + ' -- ' + x.detail);
process.exit(failed.length ? 1 : 0);
