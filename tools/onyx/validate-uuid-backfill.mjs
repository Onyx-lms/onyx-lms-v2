/**
 * Go/no-go gate before applying 0014_auth_uuid_cutover.sql (the destructive
 * step). See docs/ADR-011-supabase-auth-migration.md.
 *
 *   node tools/onyx/validate-uuid-backfill.mjs
 *
 * Confirms, for every table 0013 added a uuid twin column to:
 *   1. every row that had a value in the old bigint column also has one in
 *      the new uuid column (no un-backfilled rows), and
 *   2. every uuid value actually resolves back through onyx_users.auth_id
 *      to the same onyx_users row the old bigint value pointed at (no
 *      cross-wiring).
 * Also confirms every onyx_users row has an auth_id.
 *
 * Exits non-zero on any mismatch. Nothing here is a formality to eyeball --
 * this is the gate.
 */
import { connect, loadEnv } from '../db/connect.mjs';

const c = await connect(loadEnv());
let problems = 0;

const { rows: [usersCheck] } = await c.query(`
  SELECT count(*)::int AS total, count(*) FILTER (WHERE auth_id IS NULL)::int AS missing
  FROM public."onyx_users"
`);
if (usersCheck.missing > 0) {
  console.error('FAIL  onyx_users: ' + usersCheck.missing + ' of ' + usersCheck.total + ' rows have no auth_id');
  problems++;
} else {
  console.log('ok    onyx_users: all ' + usersCheck.total + ' rows have an auth_id');
}

const { rows: fks } = await c.query(`
  SELECT rel.relname AS table_name, att.attname AS column_name
  FROM pg_constraint con
  JOIN pg_class rel     ON rel.oid = con.conrelid
  JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
  JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = con.conkey[1]
  WHERE con.contype = 'f' AND con.confrelid = 'public.onyx_users'::regclass
    AND nsp.nspname = 'public' AND array_length(con.conkey, 1) = 1
`);

for (const f of fks) {
  const t = f.table_name;
  const col = f.column_name;

  // 1. Count parity: every non-null old value has a non-null new value.
  const { rows: [counts] } = await c.query(
    `SELECT count(*) FILTER (WHERE "${col}" IS NOT NULL)::int AS old_count, `
      + `count(*) FILTER (WHERE "${col}_uuid" IS NOT NULL)::int AS new_count `
      + `FROM public."${t}"`,
  );
  if (counts.old_count !== counts.new_count) {
    console.error('FAIL  ' + t + '.' + col + ': old_count=' + counts.old_count + ' new_count=' + counts.new_count);
    problems++;
    continue;
  }

  // 2. Referential integrity: the uuid twin resolves through onyx_users.auth_id
  // back to the exact same row the old bigint value pointed at.
  const { rows: [mismatch] } = await c.query(
    `SELECT count(*)::int AS n FROM public."${t}" t `
      + `JOIN public."onyx_users" u ON u."id" = t."${col}" `
      + `WHERE t."${col}" IS NOT NULL AND (t."${col}_uuid" IS NULL OR t."${col}_uuid" != u."auth_id")`,
  );
  if (mismatch.n > 0) {
    console.error('FAIL  ' + t + '.' + col + ': ' + mismatch.n + ' row(s) resolve to the wrong auth_id');
    problems++;
    continue;
  }

  console.log('ok    ' + t + '.' + col + ' (' + counts.old_count + ' row(s))');
}

await c.end();

if (problems > 0) {
  console.error('\n' + problems + ' check(s) failed -- do NOT apply 0014_auth_uuid_cutover.sql.');
  process.exit(1);
}
console.log('\nall checks passed -- safe to apply 0014_auth_uuid_cutover.sql.');
