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
const academics = (await call(base + '/academics?limit=200', { token: pt })).data;
const exams = academics?.exams ?? [];

console.log('Reopening ' + exams.length + ' sittings at ' + demo.name + ' (tenant ' + TID + ')');
for (const e of exams) {
  const moved = await call(base + '/exams/' + e.id, {
    method: 'PATCH', token: pt,
    body: { starts_at: startsAt, duration_minutes: MINUTES, status: 'scheduled' },
  });
  // The paper's own window is moved with it by the route -- which is the point
  // of doing this through the API rather than with an UPDATE.
  /*
   * The row itself. This read `data?.assessment`, which the route does not
   * send -- so `paper` was an object with no dates on it and the line below
   * printed the epoch as the closing time on every run.
   */
  const read = e.assessment_id
    ? (await call(base + '/assessments/' + e.assessment_id, { token: pt })).data
    : null;
  const paper = read?.assessment ?? read;
  console.log('  ' + (moved.status === 200 ? 'ok   ' : 'FAIL ') + e.title);
  if (paper) {
    const when = (v) => (v
      ? new Date(v).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
      : 'no limit');
    console.log('       paper ' + paper.id + ' now open '
      + when(paper.opens_at) + ' → ' + when(paper.closes_at));
  }
}
console.log('\n' + exams.length + ' sittings run for the next ten hours, Asia/Kolkata.');

/*
 * And one standing paper carrying BOTH a web and a coding question.
 *
 * `code-is-kept` proves that what a candidate types into three files, and the
 * program they write beside it, are stored and readable by the lecturer, the
 * administrator and the operator. To prove it, it has to sit such a paper --
 * and every one of them on the demo is created by `web-demo`, which now closes
 * its own window on the way out so twenty-eight of them stop piling up.
 * Correct for litter, and it left the pool of sittable papers empty.
 *
 * So the newest one is kept open, with the attempt cap raised to the maximum
 * the product allows. Twenty is not infinity: when a candidate has spent them,
 * the suite moves to the next candidate rather than failing, which is the
 * other half of this fix.
 */
// From the academics payload, which this script already has: the console has
// no list route for assessments, only one per id.
const papers = (academics?.assessments ?? [])
  .filter((a) => /^Web development test /.test(String(a.title)))
  .sort((a, b) => Number(b.id) - Number(a.id));

if (!papers.length) {
  console.log('\nNo "Web development test" paper on the demo. Run web-demo-mallareddy.mjs '
    + 'once to build one, then this again.');
} else {
  const standing = papers[0];
  const opened = await call(base + '/assessments/' + standing.id, {
    method: 'PATCH',
    token: pt,
    body: {
      opens_at: startsAt,
      // A year, not ten hours: this one is not pinned to a sitting, and a
      // paper the suites need should not go stale overnight.
      closes_at: new Date(Date.now() + 365 * 24 * 3_600_000).toISOString(),
      attempts_allowed: 20,
      status: 'published',
    },
  });
  console.log('\n' + (opened.status === 200 ? 'ok   ' : 'FAIL ')
    + 'standing web-and-code paper ' + standing.id + ' "' + standing.title + '"'
    + ' — open for a year, 20 attempts each');
}
