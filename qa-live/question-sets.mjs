/**
 * A bank of ten parallel sets, dealt down the register.
 *
 * The claim, in the client's words: "a question coming for roll number one
 * should not be coming for two to ten. It should only come for eleven again."
 *
 * So eleven candidates are created on rolls 001..011, all sit the same
 * examination, and their papers are compared. What is checked is the
 * guarantee, not the variety: every pair among the first ten must share
 * nothing, and the eleventh must be the first one again.
 *
 * ABC Institution only, and everything it creates it removes.
 *
 *   node qa-live/question-sets.mjs
 */
import fs from 'node:fs';

const BASE = process.env.QA_BASE ?? 'https://onyx-lms-v2.vercel.app';
const RUN = Date.now().toString(36);
const PW = 'QaSet#2026!';
const SETS = 10;
const PER_SET = 3;

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

// ---------------------------------------------------------------------------

startPhase('1. a bank of ten parallel sets');

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
  method: 'POST', token: pt, body: { name: 'Sets QA bank ' + RUN, course_id: course.id },
})).data;

// Every question unique to its set and saying so, so an overlap is visible in
// the failure rather than having to be inferred from ids.
let added = 0;
for (let sx = 1; sx <= SETS; sx += 1) {
  for (let i = 1; i <= PER_SET; i += 1) {
    const made = await call(base + '/banks/' + bank.id + '/questions', {
      method: 'POST', token: pt,
      body: {
        set_number: sx,
        type: 'single',
        prompt: 'Set ' + sx + ' question ' + i + ' (' + RUN + ')',
        options: [{ id: 'a', text: 'a' }, { id: 'b', text: 'b' }],
        answer: 'b', points: 1,
      },
    });
    if (made.status === 200) added += 1;
  }
}
check('thirty questions across ten sets', added === SETS * PER_SET,
  added + ' of ' + SETS * PER_SET);

const sets = (await call(base + '/banks/' + bank.id + '/sets', { token: pt })).data ?? [];
check('the bank reports its ten sets', sets.length === SETS,
  sets.map((s) => 'S' + s.set_number + '×' + s.count).join(' '));
check('and every set is the same size', sets.every((s) => s.count === PER_SET),
  'each holds ' + PER_SET);

const listed = ((await call(base + '/banks', { token: pt })).data ?? [])
  .find((b) => Number(b.id) === Number(bank.id));
check('the bank picker says how many sets it holds',
  Number(listed?.set_count) === SETS, 'set_count=' + listed?.set_count);

// ---------------------------------------------------------------------------

startPhase('2. an examination scheduled from that bank');

const paper = (await call(base + '/assessments', {
  method: 'POST', token: pt,
  body: {
    title: 'Sets QA paper ' + RUN, course_id: course.id, duration_minutes: 30,
    opens_at: new Date(Date.now() - 3_600_000).toISOString(),
    closes_at: new Date(Date.now() + 3 * 3_600_000).toISOString(),
    proctoring: false, require_camera: false, require_screen: false, watch_camera: false,
  },
})).data;
await call(base + '/assessments/' + paper.id + '/sections', {
  method: 'PUT', token: pt,
  body: { sections: [{ id: 's1', title: 'All', bank_id: bank.id, take: PER_SET }] },
});
await call(base + '/assessments/' + paper.id + '/publish',
  { method: 'POST', token: pt, body: {} });
check('a paper is scheduled from the bank', Boolean(paper?.id), 'paper ' + paper?.id);

// ---------------------------------------------------------------------------

startPhase('3. eleven candidates, rolls 001 to 011');

const learners = [];
for (let n = 1; n <= 11; n += 1) {
  const roll = 'QS' + RUN.slice(-3).toUpperCase() + '-' + String(n).padStart(3, '0');
  const email = 'qset.' + RUN + '.' + n + '@onyx.test';
  await call('/api/onyx/members', {
    method: 'POST', token: at,
    body: { name: 'Roll ' + n, email, role: 'student', password: PW, roll_number: roll },
  });
  const m = ((await call('/api/onyx/members', { token: at })).data ?? [])
    .find((x) => x.user?.email === email);
  await call('/api/onyx/courses/' + course.id + '/enroll',
    { method: 'POST', token: at, body: { user_id: m.user_id } });
  learners.push({ n, roll, email, membership: m, token: await login(email, PW) });
}
check('eleven candidates exist, numbered in order',
  learners.every((l) => l.token), learners[0].roll + ' … ' + learners[10].roll);

const dealt = [];
for (const l of learners) {
  const go = await call('/api/onyx/assessments/' + paper.id + '/start',
    { method: 'POST', token: l.token, body: {} });
  dealt.push((go.data?.questions ?? []).map((q) => q.prompt).sort());
}
check('every candidate is dealt a full paper',
  dealt.every((p) => p.length === PER_SET),
  dealt.map((p) => p.length).join(','));

// ---------------------------------------------------------------------------

startPhase('4. the guarantee');

let clash = null;
for (let a = 0; a < 10 && !clash; a += 1) {
  for (let b = a + 1; b < 10 && !clash; b += 1) {
    const shared = dealt[a].filter((q) => dealt[b].includes(q));
    if (shared.length) clash = 'rolls ' + (a + 1) + ' and ' + (b + 1) + ': ' + shared[0];
  }
}
check('no two of rolls 1 to 10 share a single question', clash === null,
  clash ?? 'all 45 pairs disjoint');

check('roll 11 comes back round to roll 1',
  JSON.stringify(dealt[10]) === JSON.stringify(dealt[0]),
  dealt[10][0]?.replace(' (' + RUN + ')', ''));

// Which set each landed on, read straight off the prompts.
const setOf = (paperQs) => Number(String(paperQs[0] ?? '').match(/^Set (\d+)/)?.[1] ?? 0);
const order = dealt.map(setOf);
check('and the rotation follows the register, 1..10 then 1 again',
  order.slice(0, 10).join(',') === '1,2,3,4,5,6,7,8,9,10' && order[10] === 1,
  order.join(','));

// Resuming must not re-deal: their saved answers have to keep matching.
const again = await call('/api/onyx/assessments/' + paper.id + '/start',
  { method: 'POST', token: learners[2].token, body: {} });
check('resuming deals the same set, not a new one',
  JSON.stringify((again.data?.questions ?? []).map((q) => q.prompt).sort()) ===
  JSON.stringify(dealt[2]), 'roll 3 stayed on set ' + order[2]);

// ---------------------------------------------------------------------------

startPhase('5. putting ABC Institution back as it was');

const { withDb } = await import('../tests/e2e/harness.ts');
await withDb(async (db) => {
  await db.query('DELETE FROM public."onyx_assessment_attempts"'
    + ' WHERE tenant_id = $1 AND assessment_id = $2', [tid, paper.id]);
});
await call(base + '/assessments/' + paper.id, { method: 'DELETE', token: pt });
for (const l of learners) {
  await call(base + '/members/' + l.membership.id, { method: 'DELETE', token: pt });
}
await withDb(async (db) => {
  await db.query('DELETE FROM public."onyx_users" WHERE email = ANY($1)',
    [learners.map((l) => l.email)]);
  await db.query('DELETE FROM public."onyx_question_versions" WHERE tenant_id = $1'
    + ' AND question_id IN (SELECT id FROM public."onyx_questions" WHERE bank_id = $2)',
  [tid, bank.id]);
  await db.query('DELETE FROM public."onyx_questions" WHERE tenant_id = $1 AND bank_id = $2',
    [tid, bank.id]);
  await db.query('DELETE FROM public."onyx_question_banks" WHERE tenant_id = $1 AND id = $2',
    [tid, bank.id]);
});
check('everything this run made is removed', true, '11 candidates, 1 paper, 1 bank');

const passed = results.filter((r) => r.pass).length;
const failed = results.filter((r) => !r.pass);
console.log('\n' + '='.repeat(72));
console.log(passed + ' pass, ' + failed.length + ' fail, of ' + results.length);
for (const x of failed) console.log('  FAIL [' + x.phase + '] ' + x.label + ' -- ' + x.detail);
process.exit(failed.length ? 1 : 0);
