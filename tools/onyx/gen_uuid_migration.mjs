/**
 * Generates the two mechanical SQL migrations for the Supabase Auth
 * migration's uuid re-key (see docs/ADR-011-supabase-auth-migration.md):
 *
 *   node tools/onyx/gen_uuid_migration.mjs           # writes both files
 *   node tools/onyx/gen_uuid_migration.mjs --print   # prints, writes nothing
 *
 * Every table with a bigint foreign key into onyx_users(id) needs a uuid
 * twin added (0013), backfilled and validated (provision-auth-users.mjs +
 * validate-uuid-backfill.mjs), then the old bigint column dropped and the
 * twin promoted in its place (0014). Hand-listing which ~69 columns those
 * are would drift the moment a new table lands between when this was
 * written and when it runs -- so this introspects the live schema instead
 * of hard-coding the list, and both output files are generated from the
 * same introspection pass so they can never disagree with each other.
 *
 * Column NAMES are preserved throughout (only types change), which is
 * exactly what lets every existing RLS policy body go untouched -- see
 * 0015_auth_uuid_helpers.sql, which is the only other file this migration
 * step needs.
 */
import fs from 'node:fs';
import path from 'node:path';
import { connect } from '../db/connect.mjs';

const REPO = new URL('../../', import.meta.url).pathname.replace(/^[/]([A-Za-z]:)/, '$1');
const DIR = path.join(REPO, 'supabase', 'onyx', 'migrations');
const printOnly = process.argv.includes('--print');

/** confdeltype/confupdtype -> the SQL keyword for ON DELETE/UPDATE. */
const ACTION = { a: 'NO ACTION', r: 'RESTRICT', c: 'CASCADE', n: 'SET NULL', d: 'SET DEFAULT' };

const c = await connect();

// Every single-column bigint FK into onyx_users(id), wherever it lives --
// this is the entire "blast radius" for the re-key, discovered rather than
// remembered.
const { rows: fks } = await c.query(`
  SELECT
    rel.relname                    AS table_name,
    att.attname                    AS column_name,
    att.attnotnull                 AS not_null,
    con.conname                    AS fk_name,
    con.confdeltype                AS on_delete,
    con.confupdtype                AS on_update,
    EXISTS (
      SELECT 1 FROM pg_constraint u
      WHERE u.conrelid = con.conrelid AND u.contype = 'u'
        AND u.conkey = con.conkey
    )                               AS is_unique
  FROM pg_constraint con
  JOIN pg_class rel       ON rel.oid = con.conrelid
  JOIN pg_namespace nsp   ON nsp.oid = rel.relnamespace
  JOIN pg_attribute att   ON att.attrelid = con.conrelid AND att.attnum = con.conkey[1]
  WHERE con.contype = 'f'
    AND con.confrelid = 'public.onyx_users'::regclass
    AND nsp.nspname = 'public'
    AND array_length(con.conkey, 1) = 1
  ORDER BY rel.relname, att.attname
`);

if (!fks.length) {
  await c.end();
  throw new Error('Found zero bigint FKs into onyx_users(id) -- either the migration already ran, '
    + 'or this is pointed at the wrong database. Refusing to generate an empty/wrong migration.');
}

// Plain (non-unique) single-column indexes on those same columns, so a
// lookup index like onyx_memberships_user_idx survives the rename instead
// of silently disappearing.
const { rows: idxRows } = await c.query(`
  SELECT ic.relname AS index_name, t.relname AS table_name, a.attname AS column_name
  FROM pg_index ix
  JOIN pg_class ic ON ic.oid = ix.indexrelid
  JOIN pg_class t  ON t.oid = ix.indrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ix.indkey[0]
  WHERE n.nspname = 'public' AND array_length(ix.indkey, 1) = 1
    AND NOT ix.indisprimary AND NOT ix.indisunique
`);
const plainIndexes = idxRows.filter((i) => fks.some((f) => f.table_name === i.table_name && f.column_name === i.column_name));

// Every RLS policy with a HARD dependency (via pg_depend, not a text guess)
// on onyx_users.id or on any of the columns above -- i.e. every policy that
// would block Step A/B's DROP COLUMN outright. Found two shapes: policies
// that call onyx.current_user_id() directly (the "owner_read" pattern), and
// onyx_users' own "users_same_tenant_read", which compares
// onyx_memberships.user_id to onyx_users.id with no claim function involved
// at all -- a plain text search for current_user_id() misses it entirely,
// which is why this uses the dependency graph instead of a guess.
//
// onyx.current_user_id() is NOT Onyx-only -- it is also load-bearing for the
// legacy Laravel port's own RLS (cart_items, wishlists, messages, etc, all
// still bigint-keyed against the port's own `users` table, out of scope for
// this migration). Postgres also will not let a function's return type
// change in place while ANY policy depends on it (DROP FUNCTION fails with
// a dependency error unless CASCADE, which would delete every dependent
// policy -- confirmed live against this project before writing this
// generator). So current_user_id() itself is never touched: a NEW function,
// onyx.current_auth_user_id(), is added instead, and only the affected
// onyx_-table policies are dropped and recreated to call it -- the port's
// policies keep calling the untouched original, unaffected.
const targetCols = new Set(fks.map((f) => f.table_name + '.' + f.column_name));
targetCols.add('onyx_users.id');
const { rows: depRows } = await c.query(`
  SELECT DISTINCT pol.polname AS policyname, c.relname AS dep_table, a.attname AS dep_column
  FROM pg_depend d
  JOIN pg_policy pol   ON pol.oid = d.objid AND d.classid = 'pg_policy'::regclass
  JOIN pg_attribute a  ON a.attrelid = d.refobjid AND a.attnum = d.refobjsubid
  JOIN pg_class c      ON c.oid = a.attrelid
  WHERE d.refclassid = 'pg_class'::regclass
`);
const affectedPolicyNames = new Set(
  depRows.filter((r) => targetCols.has(r.dep_table + '.' + r.dep_column)).map((r) => r.policyname),
);
const { rows: allPolicies } = await c.query(`
  SELECT tablename, policyname, cmd, qual, with_check
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename LIKE 'onyx\\_%'
  ORDER BY tablename, policyname
`);
const policies = allPolicies.filter((p) => affectedPolicyNames.has(p.policyname));

await c.end();

const q = (s) => '"' + s + '"';

// ---------------------------------------------------------------------------
// 0013 -- additive only. Safe to run at any time; nothing reads these columns
// until 0014/0015/0016 land.
// ---------------------------------------------------------------------------
const additive = [
  `-- Onyx 0013_auth_uuid_columns.sql -- GENERATED by tools/onyx/gen_uuid_migration.mjs`,
  `--`,
  `-- Supabase Auth migration, step 1/3 (additive, zero behavior change).`,
  `-- See docs/ADR-011-supabase-auth-migration.md.`,
  `--`,
  `-- Adds a uuid twin next to onyx_users' bigint id and every bigint column`,
  `-- that references it, so real auth.users rows can be provisioned and`,
  `-- backfilled (tools/onyx/provision-auth-users.mjs) and validated`,
  `-- (tools/onyx/validate-uuid-backfill.mjs) before anything old is touched.`,
  ``,
  `ALTER TABLE public."onyx_users" ADD COLUMN IF NOT EXISTS "auth_id" uuid;`,
  `CREATE UNIQUE INDEX IF NOT EXISTS onyx_users_auth_id_unique`,
  `  ON public."onyx_users" ("auth_id") WHERE "auth_id" IS NOT NULL;`,
  ``,
  `-- One uuid twin per bigint column that identifies a person (${fks.length} total).`,
];
for (const f of fks) {
  additive.push(`ALTER TABLE public.${q(f.table_name)} ADD COLUMN IF NOT EXISTS ${q(f.column_name + '_uuid')} uuid;`);
}
additive.push('', `NOTIFY pgrst, 'reload schema';`, '');

// ---------------------------------------------------------------------------
// 0014 -- destructive. Do not apply before validate-uuid-backfill.mjs passes.
// ---------------------------------------------------------------------------
const cutover = [
  `-- Onyx 0014_auth_uuid_cutover.sql -- GENERATED by tools/onyx/gen_uuid_migration.mjs`,
  `--`,
  `-- Supabase Auth migration, step 2/3 (DESTRUCTIVE -- drops the old bigint`,
  `-- identity columns). Do not apply until tools/onyx/validate-uuid-backfill.mjs`,
  `-- has exited 0 against this database. See docs/ADR-011-supabase-auth-migration.md.`,
  `--`,
  `-- Column NAMES are unchanged throughout (only types change). Policy BODIES`,
  `-- don't need editing either, except the ${policies.length} below that Postgres`,
  `-- itself refuses to let the column drops proceed past (a policy holds a`,
  `-- hard dependency on the exact column it reads, confirmed live against`,
  `-- this project) -- those are dropped first and recreated at the end,`,
  `-- identically except for the one new helper function.`,
  ``,
  `-- Step 0: drop every policy that depends on a column about to be dropped`,
  `-- (Postgres refuses the drop otherwise). Recreated as Step E, once the`,
  `-- columns they read exist again under their new type.`,
];
const CMD_MAP = { r: 'SELECT', a: 'INSERT', w: 'UPDATE', d: 'DELETE', '*': 'ALL' };
for (const p of policies) {
  cutover.push(`DROP POLICY ${q(p.policyname)} ON public.${q(p.tablename)};`);
}
cutover.push(
  '',
  `-- Step A: drop every old bigint FK column. This also drops each column's`,
  `-- own FK constraint into onyx_users(id), which is what lets onyx_users'`,
  `-- own old bigint id be dropped next without a dependency error.`,
);
for (const f of fks) {
  cutover.push(`ALTER TABLE public.${q(f.table_name)} DROP COLUMN ${q(f.column_name)};`);
}
cutover.push(
  '',
  `-- Step B: onyx_users -- auth_id (already populated by provision-auth-users.mjs)`,
  `-- becomes the real primary key. Credentials move to auth.users, so`,
  `-- password is dropped rather than carried forward.`,
  `ALTER TABLE public."onyx_users" DROP CONSTRAINT onyx_users_pkey;`,
  `ALTER TABLE public."onyx_users" DROP COLUMN "password";`,
  `ALTER TABLE public."onyx_users" DROP COLUMN "id";`,
  `ALTER TABLE public."onyx_users" RENAME COLUMN "auth_id" TO "id";`,
  `ALTER TABLE public."onyx_users" ALTER COLUMN "id" SET NOT NULL;`,
  `ALTER TABLE public."onyx_users" ADD PRIMARY KEY ("id");`,
  `ALTER TABLE public."onyx_users" ADD CONSTRAINT onyx_users_id_fkey`,
  `  FOREIGN KEY ("id") REFERENCES auth.users("id") ON DELETE CASCADE;`,
  '',
  `-- Step C: promote every uuid twin in place, restoring the nullability,`,
  `-- ON DELETE behavior, uniqueness and lookup indexes the old column had.`,
);
for (const f of fks) {
  const t = q(f.table_name);
  const oldCol = f.column_name;
  const newCol = q(oldCol);
  cutover.push(`ALTER TABLE public.${t} RENAME COLUMN ${q(oldCol + '_uuid')} TO ${newCol};`);
  if (f.not_null) cutover.push(`ALTER TABLE public.${t} ALTER COLUMN ${newCol} SET NOT NULL;`);
  cutover.push(
    `ALTER TABLE public.${t} ADD CONSTRAINT ${f.fk_name} FOREIGN KEY (${newCol})`
      + ` REFERENCES public."onyx_users"("id") ON DELETE ${ACTION[f.on_delete] ?? 'NO ACTION'};`,
  );
  if (f.is_unique) cutover.push(`ALTER TABLE public.${t} ADD CONSTRAINT ${f.fk_name}_key UNIQUE (${newCol});`);
  const idx = plainIndexes.filter((i) => i.table_name === f.table_name && i.column_name === oldCol);
  for (const i of idx) cutover.push(`CREATE INDEX ${i.index_name} ON public.${t} (${newCol});`);
}

cutover.push(
  '',
  `-- Step D: onyx.current_user_id() is shared with the legacy port's own RLS`,
  `-- (cart_items, wishlists, messages, etc -- still bigint-keyed, out of`,
  `-- scope here) and Postgres refuses to change a function's return type`,
  `-- while any policy depends on it, so it is left untouched. A new`,
  `-- function carries the uuid semantics instead, for the policies below`,
  `-- that used the old one.`,
  `CREATE FUNCTION onyx.current_auth_user_id() RETURNS uuid`,
  `  LANGUAGE sql STABLE AS $$ SELECT auth.uid() $$;`,
  '',
  `-- Step E: recreate the ${policies.length} policies Step 0 dropped, now that the`,
  `-- columns they read exist again (as uuid). Identical to their prior`,
  `-- definition except calls to current_user_id() rebind to the new function`,
  `-- above -- everything else, including plain column comparisons like`,
  `-- users_same_tenant_read's, is byte-for-byte the same text as before.`,
);
for (const p of policies) {
  const t = q(p.tablename);
  const forClause = CMD_MAP[p.cmd] ?? p.cmd;
  const swap = (s) => s?.split('onyx.current_user_id()').join('onyx.current_auth_user_id()');
  let create = `CREATE POLICY ${q(p.policyname)} ON public.${t} FOR ${forClause} TO authenticated`;
  if (p.qual) create += ` USING (${swap(p.qual)})`;
  if (p.with_check) create += ` WITH CHECK (${swap(p.with_check)})`;
  cutover.push(create + ';');
}

cutover.push('', `NOTIFY pgrst, 'reload schema';`, '');

const additiveSql = additive.join('\n');
const cutoverSql = cutover.join('\n');

if (printOnly) {
  console.log('=== 0013_auth_uuid_columns.sql ===\n' + additiveSql);
  console.log('\n=== 0014_auth_uuid_cutover.sql ===\n' + cutoverSql);
} else {
  fs.writeFileSync(path.join(DIR, '0013_auth_uuid_columns.sql'), additiveSql, 'utf8');
  fs.writeFileSync(path.join(DIR, '0014_auth_uuid_cutover.sql'), cutoverSql, 'utf8');
  console.log('wrote 0013_auth_uuid_columns.sql and 0014_auth_uuid_cutover.sql ('
    + fks.length + ' columns across ' + new Set(fks.map((f) => f.table_name)).size + ' tables)');
}
