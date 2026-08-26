/**
 * Can a lecturer set papers the way the console can?
 *
 * The console builds banks, draws papers from them, publishes them and puts
 * examinations on the calendar. This asks whether a faculty account signed
 * into the institution itself can do each of those, through the tenant API --
 * and says which call refuses, rather than "faculty cannot".
 */
const BASE = 'https://onyx-lms-v2.vercel.app';
const post = async (path, body, token, method = 'POST') => {
  const r = await fetch(BASE + path, {
    method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const get = async (path, token) => post(path, undefined, token, 'GET');

const results = [];
const check = (label, pass, detail = '') => {
  results.push({ label, pass, detail });
  console.log((pass ? 'ok    ' : 'FAIL  ') + label.padEnd(52), detail);
};

const login = async (email, password) => (await (await fetch(BASE + '/api/onyx/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password }),
})).json())?.data?.token;

const fac = await login('faculty1@mrdemo.test', 'MrDemo#2026!');
check('the lecturer signs in', !!fac, fac ? 'faculty1@mrdemo.test' : 'no token');
if (!fac) process.exit(1);

const perms = (await get('/api/onyx/permissions', fac)).body?.data?.mine ?? [];
const want = ['assess.banks', 'assess.papers', 'assess.publish', 'assess.mark',
  'assess.release', 'exams.schedule', 'exams.marks'];
check('holds the authoring capabilities', want.every((k) => perms.includes(k)),
  want.filter((k) => !perms.includes(k)).join(', ') || 'all ' + want.length);

const tag = 'fac-' + Math.random().toString(36).slice(2, 8);
/*
 * The courses this lecturer TEACHES, which is not the catalogue.
 *
 * `/courses` answers with everything the institution offers -- a lecturer can
 * read the catalogue like anybody else. What decides whether they may set a
 * paper is `assertCanTeach`, so the fixture has to be one of their own or the
 * refusal under test is the right refusal for the wrong reason.
 */
const mine = (await get('/api/onyx/my/teaching', fac)).body?.data
  ?? ((await get('/api/onyx/courses', fac)).body?.data ?? [])
    .filter((c) => (c.faculty ?? []).length);
const courseId = (Array.isArray(mine) ? mine : []).map((c) => c.id ?? c.course_id)[0];
check('sees the courses they teach', !!courseId,
  (Array.isArray(mine) ? mine : []).map((c) => c.code ?? c.course_code).join(' '));

// 1. a bank, with a question in it
const bank = await post('/api/onyx/banks',
  { name: 'Faculty bank ' + tag, course_id: courseId }, fac);
check('creates a question bank', bank.status === 200, 'HTTP ' + bank.status
  + ' ' + (bank.body?.message ?? ''));
const bankId = bank.body?.data?.id;

const q = bankId ? await post('/api/onyx/banks/' + bankId + '/questions', {
  type: 'single', prompt: 'Which tag is this?', points: 5,
  options: [{ id: 'a', text: 'The first one' }, { id: 'b', text: 'The second one' }],
  answer: 'a',
}, fac) : { status: 0 };
const q2 = bankId ? await post('/api/onyx/banks/' + bankId + '/questions', {
  type: 'single', prompt: 'And this one?', points: 5,
  options: [{ id: 'a', text: 'Yes' }, { id: 'b', text: 'No' }], answer: 'b',
}, fac) : { status: 0 };
void q2;
check('writes a question into it', q.status === 200, 'HTTP ' + q.status
  + ' ' + (q.body?.message ?? ''));

/*
 * A web question is bound to a Code Lab problem, so the lecturer has to be
 * able to create one of those too -- which is what the paper builder does for
 * them behind the "Write the brief and the starter files here" option.
 */
const prob = await post('/api/onyx/problems', {
  kind: 'web', title: 'Faculty web problem ' + tag,
  statement: 'Build a welcome card.', difficulty: 'easy',
  starter_code: { 'index.html': '<h1>Hello</h1>', 'index.css': 'h1{color:teal}', 'index.js': '' },
  preview_entry: 'index.html', solution_rule: 'never',
}, fac);
check('creates a Code Lab web problem', prob.status === 200, 'HTTP ' + prob.status
  + ' ' + (prob.body?.message ?? ''));
const probId = prob.body?.data?.id;
if (probId) await post('/api/onyx/problems/' + probId + '/publish', {}, fac);
const web = bankId && probId ? await post('/api/onyx/banks/' + bankId + '/questions', {
  type: 'web', prompt: 'Build a welcome card', points: 10, problem_id: probId,
}, fac) : { status: 0 };
check('and a web development question', web.status === 200, 'HTTP ' + web.status
  + ' ' + (web.body?.message ?? ''));

// 2. an assessment drawn from it
/*
 * A slot of this run's own.
 *
 * The product refuses to put two sittings in front of the same cohort at the
 * same hour -- correctly -- so a suite that always books the same slot passes
 * once and 409s ever after. The offset comes from the tag, so re-running lands
 * somewhere else without needing the last run cleaned up first.
 */
const now = Date.now();
const slot = now + (30 + (parseInt(tag.slice(-4), 36) % 90)) * 86_400_000;
const paper = bankId ? await post('/api/onyx/assessments', {
  title: 'Faculty assessment ' + tag, course_id: courseId,
  duration_minutes: 30,
  sections: [{ id: 's1', title: 'Section A', bank_id: bankId, take: 2 }],
  opens_at: new Date(now + 3600e3).toISOString(),
  closes_at: new Date(now + 7200e3).toISOString(),
}, fac) : { status: 0 };
check('draws an assessment from the bank', paper.status === 200, 'HTTP ' + paper.status
  + ' ' + (paper.body?.message ?? ''));
const paperId = paper.body?.data?.id;

const pub = paperId ? await post('/api/onyx/assessments/' + paperId + '/publish', {}, fac)
  : { status: 0 };
check('publishes it', pub.status === 200, 'HTTP ' + pub.status + ' ' + (pub.body?.message ?? ''));

// 3. an examination on the calendar
const exam = await post('/api/onyx/exams', {
  title: 'Faculty examination ' + tag, course_id: courseId,
  starts_at: new Date(slot).toISOString(),
  duration_minutes: 90, max_marks: 100, pass_marks: 40,
}, fac);
check('schedules an examination', exam.status === 200, 'HTTP ' + exam.status
  + ' ' + (exam.body?.message ?? ''));
const examId = exam.body?.data?.id;

// 4. and can read back what the console would show
const sched = (await get('/api/onyx/exams', fac)).body?.data ?? [];
check('sees it on the schedule', sched.some((e) => Number(e.id) === Number(examId)),
  sched.length + ' sittings listed');
const banks = (await get('/api/onyx/banks', fac)).body?.data ?? [];
check('sees the bank with its sets and marking', banks.some((x) => Number(x.id) === Number(bankId)),
  banks.length + ' banks');

/*
 * Put the institution back.
 *
 * This suite writes into the live demo, whose seeded figures are asserted by
 * e2e-malla-reddy-demo -- twelve banks, twelve assessments, three sittings. A
 * run that leaves a thirteenth bank behind turns the NEXT suite red for a
 * reason that has nothing to do with it. Banks and Code Lab problems have no
 * DELETE route by design -- a bank a paper was drawn from is not something the
 * product destroys -- so those two are left for cleanup-authoring-trial.mjs.
 */
const admin = await login('admin@mrdemo.test', 'MrDemo#2026!');
for (const [what, path] of [
  ['assessment', paperId ? '/api/onyx/assessments/' + paperId : null],
  ['examination', examId ? '/api/onyx/exams/' + examId : null],
]) {
  if (!path) continue;
  const r = await post(path, undefined, admin, 'DELETE');
  check('clears the ' + what + ' it made', r.status === 200, 'HTTP ' + r.status);
}
console.log('\nleft for cleanup-authoring-trial.mjs: bank=' + bankId + ' problem=' + probId);
const failed = results.filter((r) => !r.pass);
console.log('\n' + results.filter((r) => r.pass).length + ' pass, ' + failed.length + ' fail');
