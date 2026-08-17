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
const before = (await c.query(
  "select count(*)::int n from information_schema.tables where table_schema='public'")).rows[0].n;
await c.query('begin');
await c.query(fs.readFileSync(ROOT + 'supabase/migrations/0005_blog_engagement.sql', 'utf8'));
await c.query('commit');
const after = (await c.query(
  "select count(*)::int n from information_schema.tables where table_schema='public'")).rows[0].n;
for (const t of ['blog_comments', 'blog_likes']) {
  const cols = await c.query(
    "select column_name from information_schema.columns where table_schema='public' and table_name=$1 order by ordinal_position", [t]);
  const rls = await c.query('select relrowsecurity from pg_class where relname=$1', [t]);
  console.log(t + ':', cols.rows.map((r) => r.column_name).join(', '),
    '| rls=' + rls.rows[0].relrowsecurity);
}
console.log('tables:', before, '->', after);
await c.query("notify pgrst, 'reload schema'");
await c.end();
