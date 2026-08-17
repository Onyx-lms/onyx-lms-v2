import fs from 'node:fs';
import pg from 'pg';
const ROOT = new URL('../../', import.meta.url).pathname.replace(/^[/]([A-Za-z]:)/, '$1');
const env = Object.fromEntries(fs.readFileSync(ROOT + '.env', 'utf8').split('\n')
  .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
  .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
const c = new pg.Client({
  connectionString: env.SUPABASE_DB_URL.replace(/[?&]sslmode=[^&]*/, ''),
  ssl: { rejectUnauthorized: false },
});
await c.connect();
const before = await c.query(
  "select count(*)::int c from information_schema.tables where table_schema='public'");
const sql = fs.readFileSync(ROOT + 'supabase/migrations/0004_quiz_submissions.sql', 'utf8');
await c.query('begin'); await c.query(sql); await c.query('commit');
const after = await c.query(
  "select count(*)::int c from information_schema.tables where table_schema='public'");
const cols = await c.query(
  "select column_name, data_type from information_schema.columns " +
  "where table_schema='public' and table_name='quiz_submissions' order by ordinal_position");
const rls = await c.query(
  "select relrowsecurity, relforcerowsecurity from pg_class where relname='quiz_submissions'");
console.log('tables:', before.rows[0].c, '->', after.rows[0].c);
console.log('columns:', cols.rows.map((r) => r.column_name + ':' + r.data_type).join(', '));
console.log('rls enabled/forced:', rls.rows[0].relrowsecurity, '/', rls.rows[0].relforcerowsecurity);
await c.query("notify pgrst, 'reload schema'");
await c.end();
