/**
 * Applies Onyx migrations, in order, inside a transaction each.
 *
 *   node tools/onyx/apply.mjs            # every migration not yet applied
 *   node tools/onyx/apply.mjs 0001       # one, by prefix
 *
 * Onyx tables live in `public` behind an `onyx_` prefix; the Laravel port's
 * 61 ported tables are not touched here. See docs/ADR-006-onyx-foundation.md.
 */
import fs from 'node:fs';
import path from 'node:path';
import { connect } from '../db/connect.mjs';

const REPO = new URL('../../', import.meta.url).pathname.replace(/^[/]([A-Za-z]:)/, '$1');
const DIR = path.join(REPO, 'supabase', 'onyx', 'migrations');
const only = process.argv[2];

const files = fs.readdirSync(DIR)
  .filter((f) => f.endsWith('.sql'))
  .filter((f) => (only ? f.startsWith(only) : true))
  .sort();

if (!files.length) throw new Error('No Onyx migrations matched ' + (only ?? '(all)'));

const c = await connect();

// A ledger, so re-running is safe and a half-applied set is visible.
await c.query(`CREATE TABLE IF NOT EXISTS public."onyx_schema_migrations" (
  "file" varchar(255) PRIMARY KEY,
  "applied_at" timestamptz NOT NULL DEFAULT now()
)`);

// The ledger holds no tenant data, but the deny-all baseline applies to every
// table in the schema without exception -- an unlocked table is a habit, not a
// leak, and habits are what get copied onto the next one.
await c.query('ALTER TABLE public."onyx_schema_migrations" ENABLE ROW LEVEL SECURITY');
await c.query('ALTER TABLE public."onyx_schema_migrations" FORCE ROW LEVEL SECURITY');

const applied = new Set(
  (await c.query('SELECT file FROM public."onyx_schema_migrations"')).rows.map((r) => r.file));

for (const file of files) {
  if (applied.has(file)) {
    console.log('skip  ' + file + ' (already applied)');
    continue;
  }
  const sql = fs.readFileSync(path.join(DIR, file), 'utf8');
  await c.query('begin');
  try {
    await c.query(sql);
    await c.query('INSERT INTO public."onyx_schema_migrations" (file) VALUES ($1)', [file]);
    await c.query('commit');
    console.log('apply ' + file);
  } catch (e) {
    await c.query('rollback');
    throw new Error('Migration ' + file + ' failed and was rolled back:\n  ' + e.message);
  }
}

// The rule every Onyx table must obey. Checked rather than remembered.
const { rows: unscoped } = await c.query('SELECT * FROM onyx.assert_tenant_scoped()');
if (unscoped.length) {
  throw new Error('These onyx_ tables have no tenant_id: '
    + unscoped.map((r) => r.missing).join(', '));
}

const { rows: [counts] } = await c.query(`
  SELECT count(*)::int AS tables,
         count(*) FILTER (WHERE relrowsecurity)::int AS rls,
         count(*) FILTER (WHERE relforcerowsecurity)::int AS forced
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname LIKE 'onyx\_%'`);

console.log('onyx: ' + counts.tables + ' tables, RLS on ' + counts.rls
  + ', FORCEd on ' + counts.forced + ', all tenant-scoped');

await c.query("notify pgrst, 'reload schema'");
await c.end();
