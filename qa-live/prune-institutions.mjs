/**
 * Removes every institution except the three that are kept.
 *
 * The keep list is an ALLOW list of slugs, not a delete list. Written that way
 * on purpose: a delete list is one typo away from naming the wrong institution,
 * while an allow list can only ever fail closed -- a slug that is not
 * recognised is kept, and the run stops rather than guessing.
 *
 * Three further guards, because this is not reversible from inside the product:
 *
 *   * every institution to be kept must be FOUND before anything is deleted,
 *     so a rename or a bad connection cannot look like "it is already gone";
 *   * the deletion goes through the platform's own audited route, which
 *     demands the institution's exact name back before it will act;
 *   * the keep list is checked again afterwards.
 *
 * Back up first -- `node tools/db/backup.mjs --tenant <slug>` -- because
 * deleting an institution takes its people, courses, papers and marks with it.
 *
 *   node qa-live/prune-institutions.mjs            # show what would go
 *   node qa-live/prune-institutions.mjs --apply    # do it
 */
const BASE = process.env.QA_BASE ?? 'https://onyx-lms-v2.vercel.app';
const APPLY = process.argv.includes('--apply');

/** The only institutions that survive. Everything else is removed. */
const KEEP = new Set([
  'abc-institution',
  'malla-reddy-university',
  'meridian-tech',
]);

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
if (!pt) {
  console.error('Could not sign in to the platform console. Nothing was touched.');
  process.exit(2);
}

const tenants = (await call('/api/onyx/platform/tenants', { token: pt })).data ?? [];
const keeping = tenants.filter((t) => KEEP.has(String(t.slug)));
const going = tenants.filter((t) => !KEEP.has(String(t.slug)));

// Every institution named in the keep list has to be here. If one is missing,
// the list and the database disagree about what exists, and the safe reading of
// that is "stop", not "delete the rest anyway".
const missing = [...KEEP].filter((slug) => !tenants.some((t) => String(t.slug) === slug));
if (missing.length) {
  console.error('These institutions are named to be KEPT but were not found:');
  for (const slug of missing) console.error('  ' + slug);
  console.error('\nNothing was touched.');
  process.exit(2);
}

console.log('Keeping ' + keeping.length + ':');
for (const t of keeping) {
  console.log('  ' + String(t.id).padStart(4) + '  ' + String(t.slug).padEnd(26) + t.name);
}
console.log('\nRemoving ' + going.length + ':');
for (const t of going) {
  console.log('  ' + String(t.id).padStart(4) + '  ' + String(t.slug).padEnd(26) + t.name);
}

if (!APPLY) {
  console.log('\nNothing was changed. Pass --apply to remove them.');
  process.exit(0);
}

console.log('');
let removed = 0;
for (const t of going) {
  // Belt and braces. `going` is already the complement of the allow list; this
  // asserts it again at the last possible moment, against the row about to be
  // passed to a delete.
  if (KEEP.has(String(t.slug))) {
    console.error('REFUSED  ' + t.slug + ' is on the keep list');
    process.exit(3);
  }
  // The route demands the institution's exact name back before it acts, so a
  // wrong id cannot delete the wrong institution -- the names would not match.
  const res = await call('/api/onyx/platform/tenants/' + t.id, {
    method: 'DELETE', token: pt, body: { confirm_name: t.name },
  });
  const ok = res.status >= 200 && res.status < 300;
  if (ok) removed += 1;
  console.log((ok ? 'removed  ' : 'FAILED   ') + String(t.slug).padEnd(26)
    + (res.message ?? res.status));
}

const after = (await call('/api/onyx/platform/tenants', { token: pt })).data ?? [];
console.log('\nremoved ' + removed + ' of ' + going.length);
console.log('institutions remaining: ' + after.length);
for (const t of after) {
  console.log('  ' + String(t.id).padStart(4) + '  ' + String(t.slug).padEnd(26) + t.name);
}
const lost = [...KEEP].filter((slug) => !after.some((t) => String(t.slug) === slug));
if (lost.length) {
  console.error('\nAN INSTITUTION THAT SHOULD HAVE BEEN KEPT IS GONE: ' + lost.join(', '));
  process.exit(4);
}
console.log('\nAll three kept institutions are present and untouched.');
