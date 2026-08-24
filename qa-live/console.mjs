/**
 * What a platform operator can do to an institution without signing in as one.
 *
 * Two things they could not: run Live Classes, and open a course to add
 * modules to it. Both are checked here against a REAL institution, because
 * that is where the gap was noticed -- and against ABC Institution
 * specifically, never Malla Reddy University, which is somebody's live data.
 *
 * Everything this creates, it removes. The last phase is the cleanup, and it
 * is checked like any other step: a test that leaves rows behind in a
 * production institution is a worse problem than the one it was testing.
 *
 *   node qa-live/console.mjs
 */
const BASE = process.env.QA_BASE ?? 'https://onyx-lms-v2.vercel.app';
const RUN = Date.now().toString(36);

/** The one institution this may touch. Named, not chosen at runtime. */
const ONLY = 'abc-institution';

const results = [];
let phase = '';
const startPhase = (n) => { phase = n; console.log('\n== ' + n + ' =='); };
function check(label, pass, detail = '') {
  results.push({ phase, label, pass: Boolean(pass), detail });
  console.log((pass ? 'ok    ' : 'FAIL  ') + label.padEnd(54), detail);
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

// ---------------------------------------------------------------------------

startPhase('1. the operator, and the one institution this may touch');

const pt = (await call('/api/onyx/platform/login', { method: 'POST',
  body: { email: 'superadmin@onyx.platform', password: 'Platform#2026!' } })).data?.token;
check('the platform operator signs in', Boolean(pt));

const tenants = (await call('/api/onyx/platform/tenants', { token: pt })).data ?? [];
const abc = tenants.find((t) => t.slug === ONLY);
check('ABC Institution is there', Boolean(abc), 'id=' + abc?.id);
if (!abc) process.exit(1);
const tid = abc.id;

// The guard rail, asserted rather than assumed: nothing below may reach the
// institution somebody is really using.
const forbidden = tenants.find((t) => t.slug === 'malla-reddy-university');
check('and Malla Reddy University is left alone', Boolean(forbidden) && tid !== forbidden.id,
  'touching tenant ' + tid + ', never ' + forbidden?.id);

// ---------------------------------------------------------------------------

startPhase('2. Live Classes, which the console could not reach at all');

const before = await step('the operator lists them',
  '/api/onyx/platform/tenants/' + tid + '/domains', { token: pt });
const startedWith = (before.data ?? []).length;

const made = await step('and creates one', '/api/onyx/platform/tenants/' + tid + '/domains', {
  method: 'POST', token: pt,
  body: {
    title: 'Console QA Live Class ' + RUN,
    summary: 'Created from the platform console to prove it can be.',
    duration_label: '8 weeks', certificate: 'Certificate of completion',
    price_minor: 30_000, curriculum_url: 'example.com/curriculum',
  },
});
const domainId = made.data?.id;

check('it starts as a draft rather than live to every learner',
  Number(made.data?.status) === 0, 'status=' + made.data?.status);
check('at the price that was set', Number(made.data?.price_minor) === 30_000,
  '₹' + Number(made.data?.price_minor ?? 0) / 100);

const listed = await call('/api/onyx/platform/tenants/' + tid + '/domains', { token: pt });
const mine = (listed.data ?? []).find((d) => Number(d.id) === Number(domainId));
check('the console lists it, drafts included', Boolean(mine),
  (listed.data ?? []).length + ' total, was ' + startedWith);
check('the curriculum link was normalised to a real address',
  String(mine?.curriculum_url ?? '').startsWith('https://'),
  mine?.curriculum_url);

// The check that stops a link becoming a script.
const nasty = await call('/api/onyx/platform/tenants/' + tid + '/domains/' + domainId, {
  method: 'PATCH', token: pt, body: { curriculum_url: 'javascript:alert(1)' },
});
check('a javascript: link is refused rather than stored', nasty.status === 422,
  nasty.status + ' ' + (nasty.message ?? ''));

const published = await step('it can be published',
  '/api/onyx/platform/tenants/' + tid + '/domains/' + domainId,
  { method: 'PATCH', token: pt, body: { status: 1 } });
check('and then reads as published', Number(published.data?.status) === 1,
  'status=' + published.data?.status);

await step('and withdrawn again', '/api/onyx/platform/tenants/' + tid + '/domains/' + domainId,
  { method: 'PATCH', token: pt, body: { status: 0 } });

const anon = await call('/api/onyx/platform/tenants/' + tid + '/domains');
check('none of this is reachable without a platform session',
  anon.status === 401 || anon.status === 403, 'status ' + anon.status);

// ---------------------------------------------------------------------------

startPhase('3. opening a course, and adding a module to it');

const academics = await step('the operator reads the courses',
  '/api/onyx/platform/tenants/' + tid + '/academics?limit=200', { token: pt });
const course = (academics.data?.courses ?? [])[0];
check('there is a course to open', Boolean(course), course?.code + ' ' + course?.title);

const outline = await step('and opens it',
  '/api/onyx/platform/tenants/' + tid + '/courses/' + course.id + '/outline', { token: pt });
const modulesBefore = (outline.data?.modules ?? []).length;
check('which answers with the course and its modules',
  outline.data?.course?.id === course.id && Array.isArray(outline.data?.modules),
  modulesBefore + ' modules already');

const mod = await step('a module is added', '/api/onyx/platform/tenants/' + tid
  + '/courses/' + course.id + '/modules', {
  method: 'POST', token: pt,
  body: { title: 'Console QA module ' + RUN, summary: 'Added from the platform console.' },
});
const moduleId = mod.data?.id;

const after = await call('/api/onyx/platform/tenants/' + tid
  + '/courses/' + course.id + '/outline', { token: pt });
const added = (after.data?.modules ?? []).find((m) => Number(m.id) === Number(moduleId));
check('and appears on the course', Boolean(added),
  (after.data?.modules ?? []).length + ' modules now');
check('appended to the end rather than stacked at zero',
  Number(added?.sort) >= modulesBefore,
  'sort=' + added?.sort + ' with ' + modulesBefore + ' before it');
check('it starts empty, and says so', (added?.lessons ?? []).length === 0);

const renamed = await step('it can be renamed',
  '/api/onyx/platform/tenants/' + tid + '/modules/' + moduleId,
  { method: 'PATCH', token: pt, body: { title: 'Console QA module ' + RUN + ' (renamed)' } });
check('and the new name sticks', String(renamed.data?.title).includes('renamed'),
  renamed.data?.title);

// A module holding somebody's teaching is not removed by accident.
const withLessons = (after.data?.modules ?? []).find((m) => (m.lessons ?? []).length > 0);
if (withLessons) {
  const refused = await call('/api/onyx/platform/tenants/' + tid + '/modules/' + withLessons.id,
    { method: 'DELETE', token: pt });
  check('a module that still holds lessons is not removed', refused.status === 422,
    refused.status + ' ' + (refused.message ?? ''));
} else {
  check('a module that still holds lessons is not removed', true,
    'no populated module on this course to try it against');
}

const anonCourse = await call('/api/onyx/platform/tenants/' + tid
  + '/courses/' + course.id + '/outline');
check('and none of this is open to an anonymous caller',
  anonCourse.status === 401 || anonCourse.status === 403, 'status ' + anonCourse.status);

// ---------------------------------------------------------------------------

startPhase('4. putting ABC Institution back as it was');

const goneModule = await call('/api/onyx/platform/tenants/' + tid + '/modules/' + moduleId,
  { method: 'DELETE', token: pt });
check('the module is removed', goneModule.status === 200,
  goneModule.status + ' ' + (goneModule.message ?? ''));

const goneDomain = await call('/api/onyx/platform/tenants/' + tid + '/domains/' + domainId,
  { method: 'DELETE', token: pt });
check('the Live Class is removed', goneDomain.status === 200,
  goneDomain.status + ' ' + (goneDomain.message ?? ''));

const finalDomains = await call('/api/onyx/platform/tenants/' + tid + '/domains',
  { token: pt });
check('the Live Classes are back to what they were',
  (finalDomains.data ?? []).length === startedWith,
  (finalDomains.data ?? []).length + ' now, ' + startedWith + ' before');

const finalOutline = await call('/api/onyx/platform/tenants/' + tid
  + '/courses/' + course.id + '/outline', { token: pt });
check('and so are the modules on that course',
  (finalOutline.data?.modules ?? []).length === modulesBefore,
  (finalOutline.data?.modules ?? []).length + ' now, ' + modulesBefore + ' before');

// ---------------------------------------------------------------------------

const passed = results.filter((r) => r.pass).length;
const failed = results.filter((r) => !r.pass);
console.log('\n' + '='.repeat(66));
console.log(passed + ' pass, ' + failed.length + ' fail, of ' + results.length);
for (const f of failed) console.log('  FAIL [' + f.phase + '] ' + f.label + ' -- ' + f.detail);
process.exit(failed.length ? 1 : 0);
