/**
 * Applies one migration file by name, inside a transaction, and reports the
 * table count before/after plus the columns and RLS state of anything new.
 *
 *   node tools/db/apply-migration.mjs 0006_user_reviews.sql [table ...]
 */
import fs from 'node:fs';
import { connect } from './connect.mjs';

const [file, ...expect] = process.argv.slice(2);
if (!file) throw new Error('usage: apply-migration.mjs <file.sql> [table ...]');

const ROOT = new URL('../../', import.meta.url).pathname.replace(/^[/]([A-Za-z]:)/, '$1');
// Falls back to the IPv4 pooler when the IPv6-only direct host is unroutable.
const c = await connect();
const count = async () => (await c.query(
  "select count(*)::int n from information_schema.tables where table_schema='public'")).rows[0].n;

const before = await count();
await c.query('begin');
await c.query(fs.readFileSync(ROOT + 'supabase/migrations/' + file, 'utf8'));
await c.query('commit');

for (const t of expect) {
  const cols = await c.query('select column_name from information_schema.columns '
    + "where table_schema='public' and table_name=$1 order by ordinal_position", [t]);
  const rls = await c.query(
    'select relrowsecurity, relforcerowsecurity from pg_class where relname=$1', [t]);
  if (!cols.rows.length) throw new Error('missing table after migration: ' + t);
  console.log(t + ':', cols.rows.map((r) => r.column_name).join(', '),
    '| rls=' + rls.rows[0].relrowsecurity + ' forced=' + rls.rows[0].relforcerowsecurity);
}
console.log('tables:', before, '->', await count());
await c.query("notify pgrst, 'reload schema'");
await c.end();
