/**
 * Malla Reddy's real sections, exactly as the institution names them.
 *
 * Twenty-four divisions across six branches. The three placeholders seeded from
 * the generic Greek preset (Alpha, Beta, Gamma) are removed first — they were a
 * stand-in for these, nobody is in them, and leaving them beside "Alpha-CSE"
 * would put two things called Alpha on every picker.
 *
 * **Names are taken verbatim.** The casing is inconsistent as written — Alpha
 * beside beta, delta beside Gamma — and `Alpha--DS` carries a double hyphen.
 * Both are preserved rather than tidied: these are the institution's own names
 * for its own divisions, they appear on its timetables, and a product that
 * quietly corrects them makes the name on screen disagree with the name on the
 * noticeboard. The short code is derived and lower-cased, so it is unaffected.
 *
 * Ordered branch by branch in the order given, so a picker reads the way a
 * programme office thinks: all of CSE, then all of AI-ML, and so on.
 *
 * Touches nothing but sections.
 *
 *   node qa-live/malla-reddy-sections.mjs            # show what would change
 *   node qa-live/malla-reddy-sections.mjs --apply
 */
const BASE = process.env.QA_BASE ?? 'https://onyx-lms-v2.vercel.app';
const APPLY = process.argv.includes('--apply');
const SLUG = 'malla-reddy-university';

/** Exactly as the institution writes them, branch by branch. */
const SECTIONS = [
  'Alpha-CSE', 'Beta-CSE', 'Gamma-CSE', 'delta-CSE', 'sigma-CSE',
  'Alpha-AI-ML', 'beta-AI-ML', 'gamma-AI-ML', 'delta-AI-ML',
  'sigma-AI-ML', 'omega-AI-ML', 'zete-AI-ML', 'epsilon-AI-ML',
  'Alpha--DS', 'beta-DS', 'gamma-DS', 'delta-DS',
  'Alpha-CS', 'beta-CS',
  'Alpha-IT', 'beta-IT', 'gamma-IT',
  'Alpha-ECE', 'beta-ECE',
];

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
if (!pt) { console.error('Could not sign in to the console.'); process.exit(2); }

const tenants = (await call('/api/onyx/platform/tenants', { token: pt })).data ?? [];
const t = tenants.find((x) => String(x.slug) === SLUG);
if (!t) { console.error('No institution "' + SLUG + '".'); process.exit(2); }
const base = '/api/onyx/platform/tenants/' + t.id;

const existing = (await call(base + '/sections', { token: pt })).data ?? [];
const wanted = new Set(SECTIONS);
const stale = existing.filter((sx) => !wanted.has(sx.name));
const already = existing.filter((sx) => wanted.has(sx.name)).map((sx) => sx.name);
const toAdd = SECTIONS.filter((n) => !existing.some((sx) => sx.name === n));

console.log(t.name + ' (' + t.id + ')');
console.log('  has now : ' + (existing.map((sx) => sx.name).join(', ') || 'none'));
console.log('  keeping : ' + (already.join(', ') || 'none'));
console.log('  adding  : ' + toAdd.length + ' sections');
console.log('  removing: ' + (stale.map((sx) => sx.name).join(', ') || 'none'));

/*
 * A placeholder that somebody has already been put into is NOT removed.
 *
 * The three seeded names were a stand-in, but if a learner or a paper has been
 * attached to one since, deleting it would quietly unassign them. The server
 * refuses that anyway; this reports it rather than letting the run look like it
 * did something it did not.
 */
for (const sx of stale) {
  if ((sx.member_count ?? 0) > 0) {
    console.log('  NOTE: "' + sx.name + '" has ' + sx.member_count
      + ' people in it and will be retired, not removed.');
  }
}

if (!APPLY) {
  console.log('\nNothing was changed. Pass --apply.');
  process.exit(0);
}

console.log('');
for (const sx of stale) {
  const res = (sx.member_count ?? 0) > 0
    ? await call(base + '/sections/' + sx.id, {
      method: 'PATCH', token: pt, body: { status: 0 },
    })
    : await call(base + '/sections/' + sx.id, { method: 'DELETE', token: pt });
  console.log(((sx.member_count ?? 0) > 0 ? 'retired ' : 'removed ')
    + String(sx.name).padEnd(16) + res.status + ' ' + (res.message ?? ''));
}

let made = 0;
for (const [i, name] of SECTIONS.entries()) {
  if (existing.some((sx) => sx.name === name)) continue;
  // `sort` given explicitly so the order is the one written above, branch by
  // branch, rather than whatever order the requests happen to complete in.
  const res = await call(base + '/sections', {
    method: 'POST', token: pt, body: { name, sort: i + 1 },
  });
  if (res.status === 200) made += 1;
  else console.log('FAILED  ' + name.padEnd(16) + res.status + ' ' + (res.message ?? ''));
}
console.log('added ' + made + ' of ' + toAdd.length);

const after = (await call(base + '/sections', { token: pt })).data ?? [];
console.log('\n' + t.name + ' now runs ' + after.length + ':');
for (const sx of after) {
  console.log('  ' + String(sx.name).padEnd(16) + sx.code.padEnd(16)
    + (sx.status === 1 ? '' : 'retired'));
}
const missing = SECTIONS.filter((n) => !after.some((sx) => sx.name === n));
if (missing.length) {
  console.error('\nNOT created: ' + missing.join(', '));
  process.exit(3);
}
console.log('\nAll ' + SECTIONS.length + ' are present. Only sections were touched.');
