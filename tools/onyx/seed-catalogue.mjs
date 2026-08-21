/**
 * Gives the public catalogue something real to show.
 *
 * The home page lists courses a visitor can actually join: published, marked
 * `open` or `locked`, at an institution that has opened student registration
 * (AcademicsService.publicCatalogue). Until now exactly one course in the whole
 * database met that bar, so the section rendered a single card -- which reads
 * as a broken page rather than as a young catalogue.
 *
 * That was not a filter bug. It was that nothing could set the two flags:
 *   * `student_signup` is an institution admin's own setting (/onyx/settings),
 *     and the two demo institutions had never had it switched on.
 *   * `access` and `price_minor` could be chosen when a course was CREATED and
 *     never afterwards -- the edit form still carried the old self_enroll
 *     checkbox. Fixed in onyx-manage.tsx; this exercises the fixed path.
 *
 * Everything here goes through the product's own API as the institution's own
 * administrator -- no direct SQL -- so a run of this script is also a test that
 * an administrator can do the same thing by hand.
 *
 * Deliberately a MIX, not "make everything public": a cohort course that a
 * registry enrols people onto is not merchandise, and flipping all of them to
 * `open` would misrepresent how these institutions actually run. Each
 * institution keeps its batch courses and puts forward the ones that make sense
 * to sell or to give away.
 *
 *   node tools/onyx/seed-catalogue.mjs [baseUrl]
 */
const BASE = process.argv[2] ?? process.env.ONYX_URL ?? 'http://127.0.0.1:5175';
const PW = 'Demo#2026!';

/** Institution admin -> what that institution offers the public. */
const PLAN = [
  {
    admin: 'admin@demo.onyx',
    institution: 'ABC Institution',
    // Domains that may self-register. Without one, signup refuses every
    // address and "registration is open" is only half true.
    domains: ['demo.onyx'],
    courses: [
      { code: 'ABC101', access: 'open' },
      { code: 'ABC301', access: 'locked', price_minor: 149_900 },
    ],
  },
  {
    admin: 'kavya.rao@meridian.edu',
    institution: 'Meridian Institute of Technology',
    domains: ['meridian.edu'],
    courses: [
      { code: 'CS201', access: 'open' },
      { code: 'CS202', access: 'locked', price_minor: 249_900 },
    ],
  },
  {
    admin: 'g.ashcroft@ashcroft.ac',
    institution: 'Ashcroft Polytechnic',
    domains: ['ashcroft.ac'],
    courses: [
      { code: 'SE101', access: 'open' },
      { code: 'SE102', access: 'locked', price_minor: 99_900 },
    ],
  },
];

async function signIn(email) {
  const res = await fetch(BASE + '/api/onyx/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PW }),
  });
  const body = await res.json().catch(() => ({}));
  if (!body.ok) throw new Error('sign-in failed for ' + email + ': ' + (body.message ?? res.status));
  return body.data.token;
}

async function call(token, path, body, method = 'PATCH') {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const out = await res.json().catch(() => ({ ok: false, message: res.status }));
  if (!out.ok) throw new Error(method + ' ' + path + ' -> ' + (out.message ?? res.status));
  return out.data;
}

for (const step of PLAN) {
  const token = await signIn(step.admin);

  // 1. Open registration, so the institution's courses may be listed at all.
  await call(token, '/api/onyx/tenant/settings',
    { student_signup: true, signup_domains: step.domains.join(',') });
  console.log(step.institution + ': registration open for ' + step.domains.join(', '));

  // 2. Price the courses it wants to put forward.
  const courses = await call(token, '/api/onyx/courses', undefined, 'GET');
  const byCode = new Map(courses.map((c) => [String(c.code), c]));
  for (const want of step.courses) {
    const course = byCode.get(want.code);
    if (!course) { console.log('  ! no course ' + want.code); continue; }
    await call(token, '/api/onyx/courses/' + course.id, {
      access: want.access,
      ...(want.price_minor ? { price_minor: want.price_minor } : {}),
    });
    console.log('  ' + want.code + ' -> ' + want.access
      + (want.price_minor ? ' at INR ' + (want.price_minor / 100).toFixed(2) : ''));
  }
}

const shown = await (await fetch(BASE + '/api/onyx/catalogue')).json();
console.log('\npublic catalogue: ' + (shown.data?.length ?? 0) + ' courses');
for (const c of shown.data ?? []) {
  console.log('  ' + c.code + '  ' + c.title + '  [' + c.access
    + (c.access === 'locked' ? ' ' + c.currency + ' ' + (c.price_minor / 100).toFixed(2) : '')
    + ']  ' + c.institution.name);
}
