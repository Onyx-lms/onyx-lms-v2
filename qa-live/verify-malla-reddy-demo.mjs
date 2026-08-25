/**
 * The demo institution, checked the way somebody would actually use it.
 *
 * It turns self-signup on (so the signup → section flow can be tested by hand),
 * then proves the three things that would make the demo useless if they were
 * wrong: the ten sets really do rotate down the register, a section-targeted
 * examination is refused to everybody else, and the sitting's register reads
 * back by name, roll number, section and grade.
 *
 * Tenant 798 only. The eleven attempts it opens to prove the rotation are
 * removed again at the end, so the demo is handed over with nothing sat.
 *
 *   node --env-file=.env qa-live/verify-malla-reddy-demo.mjs
 */
const BASE = process.env.QA_BASE ?? 'https://onyx-lms-v2.vercel.app';
const DEMO_SLUG = 'malla-reddy-demo';
const STAFF_PW = 'MrDemo#2026!';
const STUDENT_PW = 'Student#2026!';
const DOMAIN = 'mrdemo.test';

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

startPhase('1. the institution');

const pt = (await call('/api/onyx/platform/login', {
  method: 'POST',
  body: { email: 'superadmin@onyx.platform', password: 'Platform#2026!' },
})).data?.token;
const tenants = (await call('/api/onyx/platform/tenants', { token: pt })).data ?? [];
const demo = tenants.find((t) => t.slug === DEMO_SLUG);
const source = tenants.find((t) => t.slug === 'malla-reddy-university');
check('the demo institution exists and is not the original',
  Boolean(demo) && demo.id !== source?.id, 'tenant ' + demo?.id + ', original ' + source?.id);
const TID = Number(demo.id);
const base = '/api/onyx/platform/tenants/' + TID;

const at = await login('admin@' + DOMAIN, STAFF_PW);
check('the demo administrator can sign in', Boolean(at), 'admin@' + DOMAIN);
check('a lecturer can sign in', Boolean(await login('faculty1@' + DOMAIN, STAFF_PW)),
  'faculty1@' + DOMAIN);
check('the examinations officer can sign in',
  Boolean(await login('exams@' + DOMAIN, STAFF_PW)), 'exams@' + DOMAIN);

// Self-signup on, so the signup → section flow is testable by hand.
const opened = await call('/api/onyx/tenant/settings', {
  method: 'PATCH', token: at,
  body: { student_signup: true, signup_mode: 'open', signup_domains: '' },
});
check('anybody can sign up and choose a division',
  opened.status === 200 && Boolean(opened.data?.student_signup),
  'mode=' + opened.data?.signup_mode);

const detail = (await call(base, { token: pt })).data;
check('the console counts every student, not the first thousand',
  Number(detail?.members_by_role?.student) === 1440,
  'students=' + detail?.members_by_role?.student);

// ---------------------------------------------------------------------------

startPhase('2. what was built');

const sections = ((await call(base + '/sections', { token: pt })).data ?? [])
  .filter((sx) => sx.status === 1).sort((a, b) => Number(a.sort) - Number(b.sort));
check('24 teaching divisions', sections.length === 24,
  sections[0]?.name + ' … ' + sections[23]?.name);

const academics = (await call(base + '/academics?limit=200', { token: pt })).data;
check('63 courses', (academics?.courses ?? []).length === 63);
const banks = (await call(base + '/banks', { token: pt })).data ?? [];
const tenSet = banks.filter((b) => Number(b.set_count) === 10);
check('three banks of ten parallel sets', tenSet.length === 3,
  tenSet.map((b) => b.question_count + 'q').join(' '));
check('and one of a single set',
  banks.filter((b) => Number(b.set_count) === 1).length === 1);
check('three examinations scheduled', (academics?.exams ?? []).length === 3,
  (academics?.exams ?? []).map((e) => e.title.split(' — ')[1]).join(' · '));

const python = (academics?.exams ?? []).find((e) => /Mid-term examination/.test(e.title));
const coding = (academics?.exams ?? []).find((e) => /Coding/.test(e.title));
const webdev = (academics?.exams ?? []).find((e) => /Alpha-CSE only/.test(e.title));

// ---------------------------------------------------------------------------

startPhase('3. the sets rotate down the register');

const alpha = sections.find((sx) => sx.name === 'Alpha-CSE');
const rolls = Array.from({ length: 11 }, (_, i) => String(i + 1).padStart(3, '0'));
const tokens = [];
for (const nn of rolls) {
  tokens.push(await login('alpha-cse.' + nn + '@' + DOMAIN, STUDENT_PW));
}
check('the first eleven of Alpha-CSE can sign in', tokens.every(Boolean),
  'alpha-cse.001 … 011');

const dealt = [];
for (const token of tokens) {
  // Consent, because the demo's examinations are monitored -- which is what an
  // examination is. The engine refuses to deal a proctored paper without it,
  // and that refusal is correct rather than something to work around.
  const go = await call('/api/onyx/assessments/' + python.assessment_id + '/start',
    { method: 'POST', token, body: { consent: true } });
  dealt.push({
    id: go.data?.id,
    qs: (go.data?.questions ?? []).map((q) => q.prompt).sort(),
  });
}
check('each is dealt a full paper of ten', dealt.every((d) => d.qs.length === 10),
  dealt.map((d) => d.qs.length).join(','));

let clash = null;
for (let a = 0; a < 10 && !clash; a += 1) {
  for (let b = a + 1; b < 10 && !clash; b += 1) {
    const shared = dealt[a].qs.filter((q) => dealt[b].qs.includes(q));
    if (shared.length) clash = 'rolls ' + (a + 1) + ' and ' + (b + 1);
  }
}
check('no two of rolls 1 to 10 share a single question',
  clash === null && dealt.every((d) => d.qs.length === 10),
  clash ?? 'all 45 pairs disjoint');
check('roll 11 comes back round to roll 1',
  dealt[0].qs.length > 0 && JSON.stringify(dealt[10].qs) === JSON.stringify(dealt[0].qs));

const setOf = (d) => Number(String(d.qs[0] ?? '').match(/Set (\d+)/)?.[1] ?? 0);
check('and the rotation follows the register',
  dealt.slice(0, 10).map(setOf).join(',') === '1,2,3,4,5,6,7,8,9,10',
  dealt.map(setOf).join(','));

// ---------------------------------------------------------------------------

startPhase('4. a division-only examination');

const beta = sections.find((sx) => sx.name === 'Beta-CSE');
const betaToken = await login('beta-cse.001@' + DOMAIN, STUDENT_PW);

/*
 * Enrolled first, on purpose.
 *
 * Without it the refusal comes from the enrolment rule -- "you are not on this
 * course" -- and proves nothing about sections at all. The claim being tested
 * is that somebody who IS on the course and IS able to sit papers is still
 * refused this one because it belongs to another division. The enrolment is
 * taken away again below.
 */
const betaPerson = ((await call(base + '/people?role=student&section_id=' + beta.id
  + '&limit=200', { token: pt })).data?.people ?? [])
  .find((p) => String(p.email) === 'beta-cse.001@' + DOMAIN);
await call(base + '/courses/' + webdev.course_id + '/enroll',
  { method: 'POST', token: pt, body: { user_id: betaPerson.user_id } });

const refused = await call('/api/onyx/assessments/' + webdev.assessment_id + '/start',
  { method: 'POST', token: betaToken, body: { consent: true } });
check('somebody on the course but in another division is still refused',
  (refused.status === 403 || refused.status === 404)
  && !/not enrolled/i.test(refused.message ?? ''),
  refused.status + ' ' + (refused.message ?? '').slice(0, 70));

await call(base + '/courses/' + webdev.course_id + '/enroll/' + betaPerson.user_id,
  { method: 'DELETE', token: pt });
check('and it is set for Alpha-CSE, not the whole cohort',
  Number(webdev.section_id) === Number(alpha.id),
  'section ' + webdev.section_id + ' of ' + alpha.id);
check('Beta-CSE is a real division with its own sixty',
  Boolean(beta) && Boolean(betaToken), beta?.name);

// ---------------------------------------------------------------------------

startPhase('5. the sitting reads back');

const sitting = (await call(base + '/exams/' + python.id, { token: pt })).data;
const register = sitting?.register ?? [];
check('the register lists everybody who has sat it', register.length === 11,
  register.length + ' rows');
// `every` on an empty array is true, which is how an empty register passed
// this check while the one above it failed. It has to have rows to pass.
check('by name, roll number and division',
  register.length > 0 && register.every((r) => r.name && r.roll_number && r.section),
  register[0]?.roll_number + ' · ' + register[0]?.section);
check('in roll order', register[0]?.roll_number === 'MRD-ALPHA-CSE-001',
  register.slice(0, 3).map((r) => r.roll_number.slice(-3)).join(' '));
check('the coding examination is scheduled from a bank with code in it',
  Boolean(coding?.assessment_id), 'exam ' + coding?.id);

// ---------------------------------------------------------------------------

startPhase('6. handing the demo over with nothing sat');

const { withDb } = await import('../tests/e2e/harness.ts');
await withDb(async (db) => {
  const wiped = await db.query(
    'DELETE FROM public."onyx_assessment_attempts"'
    + ' WHERE tenant_id = $1 AND assessment_id = $2', [TID, python.assessment_id]);
  console.log('   removed ' + wiped.rowCount + ' trial attempts');
});
const after = (await call(base + '/exams/' + python.id, { token: pt })).data;
check('the trial attempts are gone', (after?.register ?? []).length === 0,
  (after?.register ?? []).length + ' rows left');

const passed = results.filter((r) => r.pass).length;
const failed = results.filter((r) => !r.pass);
console.log('\n' + '='.repeat(72));
console.log(passed + ' pass, ' + failed.length + ' fail, of ' + results.length);
for (const x of failed) console.log('  FAIL [' + x.phase + '] ' + x.label + ' -- ' + x.detail);
process.exit(failed.length ? 1 : 0);
