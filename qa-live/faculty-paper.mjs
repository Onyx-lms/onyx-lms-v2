/**
 * A lecturer builds a paper with every question type, writing the coding
 * problem on the same form.
 *
 * The claim worth testing is the last one. A coding question is marked by
 * running a Code Lab problem's tests, and until now the only way to set one was
 * to pick from a list of already-published problems — so an institution that
 * had never published one met an empty dropdown and a dead end. This walks the
 * path the form now takes: author the problem, publish it, then bind the
 * question to the id that comes back.
 *
 * ABC Institution only, and everything it creates it removes.
 *
 *   node qa-live/faculty-paper.mjs
 */
import fs from 'node:fs';

const BASE = process.env.QA_BASE ?? 'https://onyx-lms-v2.vercel.app';
const RUN = Date.now().toString(36);

const cred = fs.readFileSync('onyx-v2-credentials.csv', 'utf8')
  .trim().split(/\r?\n/).slice(1).map((r) => r.split(','));
const rowFor = (role) => cred.find((r) => r[1] === 'abc-institution' && r[2] === role);

const results = [];
let phase = '';
const startPhase = (n) => { phase = n; console.log('\n== ' + n + ' =='); };
function check(label, pass, detail = '') {
  results.push({ phase, label, pass: Boolean(pass), detail });
  console.log((pass ? 'ok    ' : 'FAIL  ') + label.padEnd(56), detail);
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

startPhase('1. a lecturer, on a course they teach');

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
const base = '/api/onyx/platform/tenants/' + tid;

const facultyRow = rowFor('faculty');
const ft = await login(facultyRow[4], facultyRow[5]);

const course = (await call(base + '/courses', {
  method: 'POST', token: pt,
  body: { code: 'QFP' + RUN.slice(-4).toUpperCase(), title: 'Faculty paper QA ' + RUN, credits: 3 },
})).data;
await call(base + '/courses/' + course.id, {
  method: 'PATCH', token: pt, body: { status: 1, access: 'open' },
});
const teacher = ((await call(base + '/people?role=faculty&limit=200', { token: pt })).data?.people
  ?? []).find((p) => p.email === facultyRow[4]);
await call(base + '/courses/' + course.id + '/faculty',
  { method: 'POST', token: pt, body: { user_id: teacher.user_id } });
check('the lecturer teaches it', Boolean(ft) && Boolean(teacher), course.code);

// ---------------------------------------------------------------------------

startPhase('2. the coding problem, written on the form');

// Exactly what `createProblemFromDraft` does: create, add the cases, publish.
const problem = await call('/api/onyx/problems', {
  method: 'POST', token: ft,
  body: {
    title: 'Add two numbers ' + RUN,
    statement: 'Read two integers and print their sum.',
    difficulty: 'easy',
    course_id: course.id,
  },
});
check('a lecturer can create a problem', problem.status === 200,
  problem.status + ' ' + (problem.message ?? ''));
const problemId = problem.data?.id;

// The exact shape `createProblemFromDraft` sends, since that is the code path
// the form takes -- a harness inventing its own would prove nothing about it.
const cases = await call('/api/onyx/problems/' + problemId + '/tests', {
  method: 'PUT', token: ft,
  body: {
    tests: [
      { name: 'Case 1', stdin: '2 3', expected_stdout: '5', is_hidden: false, weight: 1 },
      { name: 'Case 2', stdin: '10 20', expected_stdout: '30', is_hidden: true, weight: 1 },
    ],
  },
});
check('and give it test cases', cases.status === 200, cases.status + ' ' + (cases.message ?? ''));

const published = await call('/api/onyx/problems/' + problemId + '/publish',
  { method: 'POST', token: ft, body: {} });
check('and publish it, which is what lets it mark anything',
  published.status === 200, published.status + ' ' + (published.message ?? ''));

// ---------------------------------------------------------------------------

startPhase('3. a paper of every question type');

const bank = (await call('/api/onyx/banks', {
  method: 'POST', token: ft,
  body: { name: 'Faculty paper QA bank ' + RUN, course_id: course.id },
})).data;

const QUESTIONS = [
  { type: 'single', prompt: 'Which keyword declares a constant?',
    options: [{ id: 'a', text: 'let' }, { id: 'b', text: 'const' }], answer: 'b', points: 2 },
  { type: 'multiple', prompt: 'Which of these are truthy?',
    options: [{ id: 'a', text: '1' }, { id: 'b', text: '0' }, { id: 'c', text: '"x"' }],
    answer: ['a', 'c'], points: 2 },
  { type: 'truefalse', prompt: 'An array index starts at zero.', answer: 'true', points: 1 },
  { type: 'short', prompt: 'Name the traversal that visits the root first.',
    answer: ['preorder', 'pre-order'], points: 2 },
  { type: 'essay', prompt: 'Explain garbage collection.', points: 5 },
  { type: 'code', prompt: 'Write a program that adds two numbers.',
    problem_id: problemId, points: 10 },
];

let added = 0;
for (const q of QUESTIONS) {
  const made = await call('/api/onyx/banks/' + bank.id + '/questions',
    { method: 'POST', token: ft, body: q });
  if (made.status === 200) added += 1;
  else console.log('      ' + q.type + ' refused: ' + made.status + ' ' + (made.message ?? ''));
}
check('all six question types are accepted', added === QUESTIONS.length,
  added + ' of ' + QUESTIONS.length);

const listed = (await call('/api/onyx/banks/' + bank.id + '/questions', { token: ft })).data ?? [];
const types = listed.map((q) => q.type).sort().join(',');
check('and the bank really holds them',
  types === 'code,essay,multiple,short,single,truefalse', types);

const coded = listed.find((q) => q.type === 'code');
check('the coding question is bound to the problem just written',
  Number(coded?.problem_id) === Number(problemId),
  'problem_id=' + coded?.problem_id);

const paper = await call('/api/onyx/assessments', {
  method: 'POST', token: ft,
  body: {
    title: 'Faculty paper QA ' + RUN, course_id: course.id, duration_minutes: 60,
    sections: [{ id: 's1', title: 'All questions', bank_id: bank.id, take: QUESTIONS.length }],
    proctoring: true, require_camera: true, require_screen: true,
  },
});
check('a paper draws all six', paper.status === 200,
  paper.status + ' ' + (paper.message ?? ''));
const paperId = paper.data?.id;

const pub = await call('/api/onyx/assessments/' + paperId,
  { method: 'PATCH', token: ft, body: { status: 'published' } });
check('and publishes', pub.status === 200, pub.status + ' ' + (pub.message ?? ''));

// ---------------------------------------------------------------------------

startPhase('4. putting ABC Institution back as it was');

const gone = await call('/api/onyx/assessments/' + paperId, { method: 'DELETE', token: ft });
check('the paper is removed', [200, 404].includes(gone.status),
  gone.status + ' ' + (gone.message ?? ''));

const { withDb } = await import('../tests/e2e/harness.ts');
await withDb(async (db) => {
  await db.query('DELETE FROM public."onyx_question_versions" WHERE tenant_id = $1'
    + ' AND question_id IN (SELECT id FROM public."onyx_questions" WHERE bank_id = $2)',
  [tid, bank.id]);
  await db.query('DELETE FROM public."onyx_questions" WHERE tenant_id = $1 AND bank_id = $2',
    [tid, bank.id]);
  await db.query('DELETE FROM public."onyx_question_banks" WHERE tenant_id = $1 AND id = $2',
    [tid, bank.id]);
  await db.query('DELETE FROM public."onyx_problem_tests" WHERE problem_id = $1', [problemId]);
  await db.query('DELETE FROM public."onyx_problems" WHERE tenant_id = $1 AND id = $2',
    [tid, problemId]);
});
const removedCourse = await call(base + '/courses/' + course.id,
  { method: 'DELETE', token: pt });
check('the course, bank and problem are removed',
  [200, 404].includes(removedCourse.status), String(removedCourse.status));

const passed = results.filter((r) => r.pass).length;
const failed = results.filter((r) => !r.pass);
console.log('\n' + '='.repeat(72));
console.log(passed + ' pass, ' + failed.length + ' fail, of ' + results.length);
for (const x of failed) console.log('  FAIL [' + x.phase + '] ' + x.label + ' -- ' + x.detail);
process.exit(failed.length ? 1 : 0);
