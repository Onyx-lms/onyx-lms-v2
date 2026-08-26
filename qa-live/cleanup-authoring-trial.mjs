/**
 * Removes the banks and Code Lab problems the faculty-authoring check made.
 *
 * There are no DELETE routes for either -- a bank a paper was drawn from is
 * not a thing the product lets anybody destroy, and rightly -- so this goes to
 * the database, scoped to the demo institution and to the `fac-` titles that
 * check writes. The demo's seeded figures are a contract: the end-to-end suite
 * asserts twelve banks, so a thirteenth left behind is a failing suite.
 */
import { connect } from '../tools/db/connect.mjs';
const TENANT = 798;
const client = await connect();
const { rows: [t] } = await client.query(
  'select slug from public."onyx_tenants" where id = $1', [TENANT]);
if (t?.slug !== 'malla-reddy-demo') throw new Error('Refusing: tenant is ' + t?.slug);

const banks = await client.query(
  `select id from public."onyx_question_banks" where tenant_id = $1
     and (name like 'Faculty bank fac-%' or name like 'Permission probe perm-%')`,
  [TENANT]);
const ids = banks.rows.map((r) => r.id);
console.log('banks to remove:', ids.join(', ') || 'none');
if (ids.length) {
  for (const table of ['onyx_bank_questions', 'onyx_questions']) {
    const r = await client.query(
      'delete from public."' + table + '" where bank_id = any($1::bigint[])', [ids])
      .catch((e) => ({ rowCount: 'skipped (' + e.code + ')' }));
    console.log('  ' + table + ':', r.rowCount);
  }
  console.log('  banks:', (await client.query(
    'delete from public."onyx_question_banks" where id = any($1::bigint[])', [ids])).rowCount);
}
/*
 * Assessments and sittings too, for the runs that predate the suite cleaning
 * up after itself. The API can delete both, so this is a sweep rather than the
 * only way -- but a sweep that finds nothing is the normal outcome, and one
 * that finds something is exactly what it is for.
 */
for (const [label, table] of [
  ['assessments', 'onyx_assessments'], ['sittings', 'onyx_exams'],
]) {
  const r = await client.query(
    'delete from public."' + table + '" where tenant_id = $1 and title like $2',
    [TENANT, label === 'assessments' ? 'Faculty assessment fac-%' : 'Faculty examination fac-%'])
    .catch((e) => ({ rowCount: 'skipped (' + e.code + ')' }));
  console.log(label + ' removed:', r.rowCount);
}

const probs = await client.query(
  `delete from public."onyx_problems" where tenant_id = $1
     and (title like 'Faculty web problem fac-%' or title like 'Permission probe perm-%')`,
  [TENANT]);
console.log('problems:', probs.rowCount);

/*
 * And what permissions-bite.mjs leaves when a revocation FAILS to bite.
 *
 * That suite is written so a passing run creates almost nothing -- the whole
 * point is that the first attempt is refused. A run where the switch does not
 * work creates one of everything, which is the run you most want swept before
 * trying again: an examination left on the calendar makes the next attempt
 * clash, and the suite then reports a permission failure that is really a
 * scheduling one.
 */
for (const [label, table] of [
  ['probe assignments', 'onyx_assignments'], ['probe sittings', 'onyx_exams'],
]) {
  const r = await client.query(
    'delete from public."' + table + '" where tenant_id = $1 and title like $2',
    [TENANT, 'Permission probe perm-%'])
    .catch((e) => ({ rowCount: 'skipped (' + e.code + ')' }));
  console.log(label + ' removed:', r.rowCount);
}

for (const [label, sql] of [
  ['banks', 'select count(*)::int n from public."onyx_question_banks" where tenant_id = $1'],
  ['assessments', 'select count(*)::int n from public."onyx_assessments" where tenant_id = $1'],
  ['exams', 'select count(*)::int n from public."onyx_exams" where tenant_id = $1'],
  ['live classes', 'select count(*)::int n from public."onyx_domains" where tenant_id = $1'],
]) {
  const { rows: [r] } = await client.query(sql, [TENANT]).catch(() => ({ rows: [{ n: '?' }] }));
  console.log(label + ':', r.n);
}
await client.end();
