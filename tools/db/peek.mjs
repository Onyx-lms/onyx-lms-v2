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
for (const q of [
  'select id, name, email, role from public.users order by id',
  'select id, title, slug, status, category_id, user_id, is_paid from public.courses order by id',
  'select id, title, slug, parent_id from public.categories order by id',
]) {
  const { rows } = await c.query(q);
  console.log('>', q.split(' from ')[1].split(' order')[0]);
  for (const r of rows) console.log('   ', JSON.stringify(r));
}
await c.end();
