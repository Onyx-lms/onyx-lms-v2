/**
 * Removes the accounts created while walking the signup flow by hand.
 *
 * The demo institution's seeded figures are a contract -- the end-to-end suite
 * asserts sixty in Alpha-CSE and 1,440 students -- so a trial registration has
 * to be taken back out, not left behind as a 61st.
 *
 * Scoped to `ux.trial.%@mrdemo.test` and to tenant 798, and it refuses to run
 * against any other institution.
 */
import { connect } from '../tools/db/connect.mjs';

const TENANT = 798;
const LIKE = 'ux.trial.%@mrdemo.test';
const client = await connect();

const { rows: [t] } = await client.query(
  'select id, name, slug from public."onyx_tenants" where id = $1', [TENANT]);
if (!t || t.slug !== 'malla-reddy-demo') {
  throw new Error('Refusing: tenant ' + TENANT + ' is ' + JSON.stringify(t?.slug));
}
console.log('institution:', t.name, '(' + t.slug + ')');

const { rows: users } = await client.query(
  'select id, email from public."onyx_users" where email like $1', [LIKE]);
console.log('trial accounts found:', users.length, users.map((u) => u.email).join(', '));
if (!users.length) { await client.end(); process.exit(0); }
const ids = users.map((u) => u.id);

for (const [table, col] of [
  ['onyx_enrollments', 'user_id'], ['onyx_memberships', 'user_id'],
  ['onyx_lesson_progress', 'user_id'], ['onyx_assessment_attempts', 'user_id'],
]) {
  const r = await client.query(
    'delete from public."' + table + '" where tenant_id = $1 and ' + col + ' = any($2::uuid[])',
    [TENANT, ids]).catch((e) => ({ rowCount: 'skipped (' + e.code + ')' }));
  console.log('  ' + table + ':', r.rowCount);
}
const u = await client.query('delete from public."onyx_users" where id = any($1::uuid[])', [ids]);
console.log('  onyx_users:', u.rowCount);
const a = await client.query('delete from auth.users where id = any($1::uuid[])', [ids])
  .catch((e) => ({ rowCount: 'skipped (' + e.code + ')' }));
console.log('  auth.users:', a.rowCount);

const { rows: [after] } = await client.query(
  'select count(*)::int n from public."onyx_memberships" '
  + 'where tenant_id = $1 and role = $2 and status = 1', [TENANT, 'student']);
console.log('students at the demo now:', after.n);
await client.end();
