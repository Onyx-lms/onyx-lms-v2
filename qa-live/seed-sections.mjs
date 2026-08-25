/**
 * Gives every institution the teaching divisions it runs.
 *
 * Malla Reddy names its divisions Alpha, Beta and Gamma; the convention nearly
 * everywhere else is Section A, B and C. Only the naming differs — both are
 * ordinary rows afterwards, renamed, reordered, added to or retired from the
 * console.
 *
 * Does nothing to an institution that already has sections. An institution
 * that has renamed or removed its own must not have three put back.
 *
 *   node qa-live/seed-sections.mjs            # show what would be created
 *   node qa-live/seed-sections.mjs --apply
 */
const BASE = process.env.QA_BASE ?? 'https://onyx-lms-v2.vercel.app';
const APPLY = process.argv.includes('--apply');

/** The institutions whose divisions carry Greek names. */
const GREEK = new Set(['malla-reddy-university']);

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

for (const t of tenants) {
  const base = '/api/onyx/platform/tenants/' + t.id;
  const existing = (await call(base + '/sections', { token: pt })).data ?? [];
  const preset = GREEK.has(String(t.slug)) ? 'greek' : 'letters';

  if (existing.length) {
    console.log(String(t.slug).padEnd(26) + 'already has '
      + existing.map((sx) => sx.name).join(', '));
    continue;
  }
  if (!APPLY) {
    console.log(String(t.slug).padEnd(26) + 'would get the ' + preset + ' set');
    continue;
  }
  const made = await call(base + '/sections/seed',
    { method: 'POST', token: pt, body: { preset } });
  const names = (made.data ?? []).map((sx) => sx.name).join(', ');
  console.log(String(t.slug).padEnd(26) + (made.status === 200
    ? 'created ' + names
    : 'FAILED ' + made.status + ' ' + (made.message ?? '')));
}

if (!APPLY) console.log('\nNothing was changed. Pass --apply.');
else console.log('\nNo course, member or examination data was touched.');
