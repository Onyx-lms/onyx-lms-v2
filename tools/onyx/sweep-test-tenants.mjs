/**
 * Institutions left behind by a test run that did not finish.
 *
 * Every browser and e2e spec that seeds its own institution deletes it again in
 * an afterAll -- `cleanupTenants` in tests/browser/helpers.ts. An afterAll does
 * not run when the process is killed, when a machine sleeps mid-suite, or when
 * a spec crashes hard enough, so the leftovers accumulate. They are harmless in
 * every functional sense and genuinely bad in one: a super-admin opening the
 * directory of institutions is looking at a list of real customers with
 * "Sandbox College msx5az25" among them, which makes the screen read as
 * unmaintained.
 *
 * DRY RUN BY DEFAULT. It prints what it would remove and removes nothing until
 * `--yes`, because this deletes from the production database and the whole
 * point of the safety rule below is that it can be checked by eye first.
 *
 *   node tools/onyx/sweep-test-tenants.mjs
 *   node tools/onyx/sweep-test-tenants.mjs --yes
 *
 * ---------------------------------------------------------------------------
 * WHAT IT WILL DELETE, and what it will not
 * ---------------------------------------------------------------------------
 *
 * All three have to hold. Any one of them alone would be too loose:
 *
 *   1. EVERY member's email ends @onyx.test. That domain is reserved for the
 *      suites -- helpers.mail() mints nothing else -- and is not a real one.
 *      A tenant with a single real person in it is somebody's, whatever it is
 *      called.
 *   2. It holds no content: no courses, no enrolments, no invoices, no
 *      payments, no certificates. A test institution that got as far as
 *      creating any of those is one whose deletion should be a human decision.
 *   3. Its slug is not on the KEEP list -- the demo institutions, which are
 *      seeded on purpose and which the specs sign in to.
 *
 * Deleting the tenant is enough for the rows: every onyx_ table references
 * onyx_tenants ON DELETE CASCADE. The users are deleted separately because a
 * user is global rather than tenant-scoped, and only ever the @onyx.test ones
 * that belonged to a tenant being removed.
 */
import { connect } from '../db/connect.mjs';

const APPLY = process.argv.includes('--yes');

/**
 * Seeded on purpose, and never swept whatever else is true of them.
 *
 * xyz-polytechnic is the one worth naming: it has one member and no content,
 * so rules 1 and 2 would nearly catch it -- but its admin is admin@other.onyx
 * and it exists so the isolation specs have a second institution to be refused
 * by. Deleting it would break them in a way that reads as a product bug.
 */
const KEEP = new Set([
  'abc-institution', 'xyz-polytechnic', 'meridian-tech', 'ashcroft-poly',
]);

/** The tables whose emptiness makes a tenant safe to remove. */
const CONTENT = [
  'onyx_courses', 'onyx_enrollments', 'onyx_invoices', 'onyx_payments',
  'onyx_certificates', 'onyx_domains', 'onyx_exams', 'onyx_assessments',
];

const client = await connect();
try {
  // Only the tables this database actually has -- the list above outlives any
  // one migration state, and a missing one should not be a crash.
  const { rows: present } = await client.query(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ANY($1)`, [CONTENT]);
  const tables = present.map((r) => r.table_name);

  const counts = tables
    .map((t) => `(SELECT count(*)::int FROM public."${t}" x WHERE x.tenant_id = t.id)`)
    .join(' + ');

  const { rows } = await client.query(`
    SELECT t.id, t.name, t.slug, t.created_at,
           (SELECT count(*)::int FROM public."onyx_memberships" m WHERE m.tenant_id = t.id)
             AS members,
           (SELECT count(*)::int FROM public."onyx_memberships" m
              JOIN public."onyx_users" u ON u.id = m.user_id
             WHERE m.tenant_id = t.id AND u.email NOT LIKE '%@onyx.test') AS real_people,
           ${counts || '0'} AS content
      FROM public."onyx_tenants" t
     ORDER BY t.id`);

  const doomed = rows.filter((r) =>
    !KEEP.has(r.slug) && r.members > 0 && r.real_people === 0 && r.content === 0);

  console.log('\n' + rows.length + ' institutions, ' + doomed.length + ' look like leftovers.\n');

  for (const r of rows) {
    const verdict = KEEP.has(r.slug) ? 'kept (seeded)'
      : doomed.includes(r) ? 'LEFTOVER'
        : r.real_people > 0 ? 'kept (' + r.real_people + ' real people)'
          : r.content > 0 ? 'kept (' + r.content + ' records)'
            : 'kept (no members -- decide by hand)';
    console.log('  ' + String(r.id).padStart(4) + '  ' + r.slug.padEnd(34)
      + verdict.padEnd(30) + String(r.created_at).slice(0, 10));
  }

  if (!doomed.length) { console.log('\nNothing to do.\n'); process.exit(0); }

  if (!APPLY) {
    console.log('\nDry run. Re-run with --yes to remove the ' + doomed.length
      + ' marked LEFTOVER.\n');
    process.exit(0);
  }

  const ids = doomed.map((r) => r.id);
  // Users first, while the memberships that identify them still exist. They are
  // @onyx.test only -- rule 1 has already established there are no others.
  const { rowCount: users } = await client.query(`
    DELETE FROM public."onyx_users"
     WHERE email LIKE '%@onyx.test'
       AND id IN (SELECT user_id FROM public."onyx_memberships" WHERE tenant_id = ANY($1))`,
  [ids]);
  // Then the tenants. Everything else cascades.
  const { rowCount: tenants } = await client.query(
    'DELETE FROM public."onyx_tenants" WHERE id = ANY($1)', [ids]);

  console.log('\nRemoved ' + tenants + ' institutions and ' + users + ' test accounts.\n');
} finally {
  await client.end();
}
