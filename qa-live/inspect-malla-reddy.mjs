/**
 * What Malla Reddy University actually holds, read and nothing else.
 *
 * The demo institution has to be a copy of this one, so this is the shape it
 * is copied FROM. Strictly read-only: every call here is a GET, and the
 * original is never written to, which is the whole point of a separate demo.
 *
 *   node qa-live/inspect-malla-reddy.mjs
 */
const BASE = process.env.QA_BASE ?? 'https://onyx-lms-v2.vercel.app';

async function call(path, token) {
  const res = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
  });
  const p = await res.json().catch(() => ({}));
  return p?.data;
}

const login = await fetch(BASE + '/api/onyx/platform/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    email: 'superadmin@onyx.platform', password: 'Platform#2026!',
  }),
});
const pt = (await login.json()).data?.token;

const tenants = await call('/api/onyx/platform/tenants', pt);
console.log('\nINSTITUTIONS');
for (const t of tenants ?? []) {
  console.log('  ' + String(t.id).padStart(4) + '  ' + String(t.slug).padEnd(28)
    + t.name + '  [status ' + t.status + ']');
}

const mrit = (tenants ?? []).find((t) => t.slug === 'malla-reddy-university');
if (!mrit) { console.log('\nMalla Reddy not found.'); process.exit(1); }
const base = '/api/onyx/platform/tenants/' + mrit.id;

const detail = await call(base, pt);
console.log('\nMALLA REDDY  id=' + mrit.id);
console.log(JSON.stringify(detail?.tenant ?? detail, null, 2).slice(0, 1400));

const sections = await call(base + '/sections', pt);
console.log('\nSECTIONS (' + (sections ?? []).length + ')');
for (const sx of sections ?? []) {
  console.log('  ' + String(sx.id).padStart(5) + '  ' + String(sx.name).padEnd(20)
    + 'code=' + sx.code + '  sort=' + sx.sort + '  status=' + sx.status);
}

const academics = await call(base + '/academics?limit=200', pt);
const courses = academics?.courses ?? [];
console.log('\nCOURSES (' + courses.length + ')');
for (const c of courses) {
  console.log('  ' + String(c.id).padStart(5) + '  ' + String(c.code).padEnd(14)
    + String(c.title).slice(0, 46).padEnd(48)
    + 'access=' + c.access + ' status=' + c.status
    + ' price=' + (c.price_minor ?? 0) + ' credits=' + (c.credits ?? 0)
    + ' enrolled=' + (c.enrolled ?? '?'));
}

console.log('\nASSESSMENTS  ' + (academics?.assessments ?? []).length
  + '   EXAMINATIONS  ' + (academics?.exams ?? []).length);

const banks = await call(base + '/banks', pt);
console.log('\nQUESTION BANKS (' + (banks ?? []).length + ')');
for (const b of banks ?? []) {
  console.log('  ' + String(b.id).padStart(5) + '  ' + String(b.name).slice(0, 40).padEnd(42)
    + 'sets=' + b.set_count + ' q=' + b.question_count);
}

const people = await call(base + '/people?limit=5', pt);
console.log('\nPEOPLE  ' + ((people?.people ?? people ?? []).length) + ' shown (capped)');

const problems = await call(base + '/problems', pt);
console.log('CODE LAB PROBLEMS  ' + (problems ?? []).length);
