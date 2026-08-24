/**
 * The coding path on its own, with nothing left to chance.
 *
 * `flows.mjs` draws two questions from a four-question bank, so whether a
 * candidate meets the code question -- or an essay, which correctly waits for
 * a marker -- is luck. This paper contains exactly one question and it is the
 * code one, so the result below is a fact about marking rather than about the
 * draw.
 */
const BASE = process.env.QA_BASE ?? 'https://onyx-lms-v2.vercel.app';
const RUN = Date.now().toString(36);
const PW = 'QaCode#2026!';
const say = (l, r, extra = '') =>
  console.log((r.status >= 200 && r.status < 300 ? 'ok    ' : 'FAIL  ') + l.padEnd(46),
    r.status, r.body?.message ?? '', extra);

async function call(path, { method = 'GET', token, body } = {}) {
  const r = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

const pt = (await call('/api/onyx/platform/login', { method: 'POST',
  body: { email: 'superadmin@onyx.platform', password: 'Platform#2026!' } })).body?.data?.token;
const adminEmail = 'qc.' + RUN + '.admin@onyx.test';
const stuEmail = 'qc.' + RUN + '.stu@onyx.test';
const slug = 'qc-' + RUN;
say('institution created', await call('/api/onyx/tenants', { method: 'POST', token: pt,
  body: { name: 'Coding QA ' + RUN, slug, admin: { name: 'A', email: adminEmail, password: PW } } }));

const at = (await call('/api/onyx/auth/login', { method: 'POST',
  body: { email: adminEmail, password: PW } })).body?.data?.token;
await call('/api/onyx/members', { method: 'POST', token: at,
  body: { name: 'Sam', email: stuEmail, role: 'student', password: PW } });
const course = await call('/api/onyx/courses', { method: 'POST', token: at,
  body: { code: 'QC1', title: 'Coding', credits: 3, access: 'open' } });
await call('/api/onyx/courses/' + course.body.data.id + '/publish', { method: 'POST', token: at });
const members = await call('/api/onyx/members', { token: at });
const stu = members.body.data.find((m) => m.user?.email === stuEmail);
await call('/api/onyx/courses/' + course.body.data.id + '/enroll', { method: 'POST', token: at,
  body: { user_id: stu.user_id } });

const problem = await call('/api/onyx/problems', { method: 'POST', token: at,
  body: { title: 'Add two', slug: 'qc-add-' + RUN, statement: 'Print the sum of two integers.',
    difficulty: 'easy', languages: ['python'], time_limit_ms: 2000 } });
say('Code Lab problem authored', problem);
say('two test cases, one hidden', await call('/api/onyx/problems/' + problem.body.data.id + '/tests', {
  method: 'PUT', token: at, body: { tests: [
    { name: 'sample', stdin: '1 2', expected_stdout: '3', weight: 1, is_hidden: false },
    { name: 'hidden', stdin: '40 2', expected_stdout: '42', weight: 1, is_hidden: true } ] } }));
say('problem published', await call('/api/onyx/problems/' + problem.body.data.id + '/publish',
  { method: 'POST', token: at }));

const bank = await call('/api/onyx/banks', { method: 'POST', token: at,
  body: { name: 'Code only', course_id: course.body.data.id } });
say('code question set', await call('/api/onyx/banks/' + bank.body.data.id + '/questions', {
  method: 'POST', token: at, body: { type: 'code', prompt: 'Add two integers.', points: 10,
    problem_id: problem.body.data.id } }));

const paper = await call('/api/onyx/assessments', { method: 'POST', token: at,
  body: { title: 'Coding only', course_id: course.body.data.id, duration_minutes: 30,
    attempts_allowed: 1, sections: [{ id: 's1', title: 'All', bank_id: bank.body.data.id, take: 1 }] } });
say('paper of exactly one code question', paper);
await call('/api/onyx/assessments/' + paper.body.data.id + '/publish', { method: 'POST', token: at });

const st = (await call('/api/onyx/auth/login', { method: 'POST',
  body: { email: stuEmail, password: PW } })).body?.data?.token;
const started = await call('/api/onyx/assessments/' + paper.body.data.id + '/start',
  { method: 'POST', token: st, body: {} });
const q = started.body.data.questions[0];
say('the problem travels with the paper', started, 'problem=' + (q.problem?.id ?? 'MISSING'));

await call('/api/onyx/attempts/' + started.body.data.id + '/answer', { method: 'POST', token: st,
  body: { question_id: q.question_id,
    response: { language: 'python', source: ['a,b=input().split()', 'print(int(a)+int(b))'].join('\n') } } });
const done = await call('/api/onyx/attempts/' + started.body.data.id + '/submit',
  { method: 'POST', token: st, body: {} });
say('handed in and marked by the tests', done,
  'score=' + done.body.data?.score + '/' + done.body.data?.max_score);

const review = await call('/api/onyx/attempts/' + started.body.data.id, { token: st });
const rq = review.body.data?.questions?.[0];
console.log('      review: response=' + (rq?.response ? 'present' : 'MISSING')
  + ' awarded=' + rq?.awarded + ' released=' + (review.body.data?.score !== null));
console.log('SLUG ' + slug);
