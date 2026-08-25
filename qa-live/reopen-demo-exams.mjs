/**
 * Open the demo institution's examinations again, starting now.
 *
 * An examination has a slot, and its online paper is pinned to that slot so a
 * candidate cannot start early or late. That is right for a real sitting and
 * inconvenient for a demo, which is sat whenever somebody sits down to look at
 * it -- so this moves the three sittings to begin a minute ago and run for the
 * longest a sitting is allowed, ten hours.
 *
 * Run it whenever the demo's examinations have closed. It writes to tenant 798
 * and refuses to write anywhere else.
 *
 *   node qa-live/reopen-demo-exams.mjs
 */
const BASE = process.env.QA_BASE ?? 'https://onyx-lms-v2.vercel.app';
const DEMO_SLUG = 'malla-reddy-demo';
/** The longest a sitting may run: `duration_minutes` is capped at 600. */
const MINUTES = 600;

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

const pt = (await call('/api/onyx/platform/login', {
  method: 'POST',
  body: { email: 'superadmin@onyx.platform', password: 'Platform#2026!' },
})).data?.token;

const tenants = (await call('/api/onyx/platform/tenants', { token: pt })).data ?? [];
const demo = tenants.find((t) => t.slug === DEMO_SLUG);
if (!demo) { console.log('The demo institution is not there.'); process.exit(1); }
const TID = Number(demo.id);
// Fails closed, the same rule the seeding script follows: this may only ever
// write to the demo.
if (tenants.some((t) => t.slug !== DEMO_SLUG && Number(t.id) === TID)) {
  console.log('REFUSING: that id belongs to another institution.');
  process.exit(1);
}
const base = '/api/onyx/platform/tenants/' + TID;

const startsAt = new Date(Date.now() - 60_000).toISOString();
const exams = ((await call(base + '/academics?limit=200', { token: pt })).data?.exams ?? []);

console.log('Reopening ' + exams.length + ' sittings at ' + demo.name + ' (tenant ' + TID + ')');
for (const e of exams) {
  const moved = await call(base + '/exams/' + e.id, {
    method: 'PATCH', token: pt,
    body: { starts_at: startsAt, duration_minutes: MINUTES, status: 'scheduled' },
  });
  // The paper's own window is moved with it by the route -- which is the point
  // of doing this through the API rather than with an UPDATE.
  const paper = e.assessment_id
    ? (await call(base + '/assessments/' + e.assessment_id, { token: pt })).data?.assessment
    : null;
  console.log('  ' + (moved.status === 200 ? 'ok   ' : 'FAIL ') + e.title);
  if (paper) {
    console.log('       paper ' + paper.id + ' now open '
      + new Date(paper.opens_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
      + ' → '
      + new Date(paper.closes_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }));
  }
}
console.log('\nAll three run for the next ten hours, Asia/Kolkata.');
