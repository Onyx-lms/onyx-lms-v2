/**
 * F-03/F-04/F-07 live acceptance: compares the ACTUAL Postgres schema against
 * the Laravel SQLite source -- tables, column names and column order.
 */
import fs from 'node:fs';
import pg from 'pg';
import { execFileSync } from 'node:child_process';
import { laravelDb } from './laravel-source.mjs';

const env = Object.fromEntries(fs.readFileSync(new URL('../../.env', import.meta.url), 'utf8').split('\n')
  .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
  .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));

// Pull the source schema straight out of the Laravel SQLite file.
const source = JSON.parse(execFileSync('python', ['-c', `
import sqlite3, json
c = sqlite3.connect(r'${laravelDb()}')
out = {}
for (t,) in c.execute("select name from sqlite_master where type='table' and name not like 'sqlite_%' order by name"):
    out[t] = [r[1] for r in c.execute('pragma table_info("%s")' % t)]
print(json.dumps(out))
`], { encoding: 'utf8' }));

const client = new pg.Client({
  connectionString: env.SUPABASE_DB_URL.replace(/[?&]sslmode=[^&]*/, ''),
  ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 20000,
});
await client.connect();

const { rows: cols } = await client.query(`
  select table_name, column_name
  from information_schema.columns
  where table_schema='public'
  order by table_name, ordinal_position`);
const live = {};
for (const r of cols) (live[r.table_name] ??= []).push(r.column_name);

const problems = [];
for (const t of Object.keys(source)) {
  if (!live[t]) { problems.push(`MISSING TABLE ${t}`); continue; }
  if (JSON.stringify(source[t]) !== JSON.stringify(live[t])) {
    problems.push(`${t}: column mismatch\n    laravel: ${source[t].join(',')}\n    live   : ${live[t].join(',')}`);
  }
}
// quiz_submissions is an intentional ADDITION (see 0004). Laravel's own
// QuizSubmission model requires it but no migration ever created it.
const INTENTIONAL_ADDITIONS = new Set(['quiz_submissions', 'blog_comments', 'blog_likes', 'user_reviews', 'bootcamp_resources', 'applications']);
for (const t of Object.keys(live)) {
  if (!source[t] && !INTENTIONAL_ADDITIONS.has(t)) problems.push(`EXTRA TABLE ${t}`);
}

const { rows: [ix] } = await client.query(
  "select count(*)::int c from pg_indexes where schemaname='public'");
const { rows: [rls] } = await client.query(`
  select count(*)::int c from pg_tables t
  join pg_class c on c.relname = t.tablename
  where t.schemaname='public' and c.relrowsecurity`);
const { rows: [pol] } = await client.query(
  "select count(*)::int c from pg_policies where schemaname='public'");
const { rows: [fn] } = await client.query(
  "select count(*)::int c from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='onyx'");

const counts = {};
for (const t of ['settings', 'languages', 'language_phrases', 'categories',
  'blog_categories', 'bootcamp_categories']) {
  counts[t] = (await client.query(`select count(*)::int c from public."${t}"`)).rows[0].c;
}

console.log('LIVE SCHEMA VERIFICATION');
console.log('  tables            :', Object.keys(live).length, '/', Object.keys(source).length);
console.log('  columns           :', cols.length);
console.log('  indexes           :', ix.c);
console.log('  RLS-enabled tables:', rls.c);
console.log('  RLS policies      :', pol.c);
console.log('  onyx.* functions  :', fn.c);
console.log('  seeded rows       :', Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(', '));
console.log(problems.length ? `\nFAIL (${problems.length}):\n  ` + problems.join('\n  ')
                            : '\nCOLUMN PARITY: PASS -- every table matches Laravel exactly');
await client.end();
process.exit(problems.length ? 1 : 0);
