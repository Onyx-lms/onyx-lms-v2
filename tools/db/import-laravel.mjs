/**
 * Ports rows from the Laravel SQLite database into Supabase, preserving ids.
 *
 * An early, narrow slice of H-01. Tables are copied in FK-safe order and ids are
 * kept so every stored reference (course.user_id, lesson.course_id, ...) still
 * resolves. Identity sequences are re-synced afterwards so new inserts continue
 * from the right number instead of colliding.
 */
import fs from 'node:fs';
import pg from 'pg';
import { execFileSync } from 'node:child_process';
import { laravelDb } from './laravel-source.mjs';

const ROOT = new URL('../../', import.meta.url).pathname.replace(/^[/]([A-Za-z]:)/, '$1');
const env = Object.fromEntries(fs.readFileSync(ROOT + '.env', 'utf8').split('\n')
  .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
  .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));

const ARGS = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const TABLES = ARGS.length
  ? ARGS
  : ['users', 'categories', 'courses', 'sections', 'lessons', 'enrollments', 'reviews'];

const dump = JSON.parse(execFileSync('python', ['-c', `
import sqlite3, json, sys
tables = ${JSON.stringify(TABLES)}
c = sqlite3.connect(r'${laravelDb()}')
c.row_factory = sqlite3.Row
out = {}
for t in tables:
    rows = [dict(r) for r in c.execute('select * from "%s"' % t)]
    out[t] = rows
sys.stdout.write(json.dumps(out, default=str))
`], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));

const client = new pg.Client({
  connectionString: env.SUPABASE_DB_URL.replace(/[?&]sslmode=[^&]*/, ''),
  ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 20000,
});
await client.connect();

// Importing into a table that already holds rows silently drops any row whose
// id is taken (ON CONFLICT DO NOTHING). That is data loss disguised as success,
// so refuse unless the caller explicitly opts in with --merge.
if (!process.argv.includes('--merge')) {
  const occupied = [];
  for (const t of TABLES) {
    const { rows: [r] } = await client.query(`select count(*)::int c from public."${t}"`);
    if (r.c > 0) occupied.push(`${t}=${r.c}`);
  }
  if (occupied.length) {
    console.log('ABORT: target tables already contain rows:', occupied.join(', '));
    console.log('Rows whose id is taken would be skipped silently. Re-run with --merge if that is intended.');
    await client.end();
    process.exit(2);
  }
}
for (const table of TABLES) {
  const rows = dump[table] ?? [];
  if (!rows.length) { console.log(`${table.padEnd(14)} 0 rows (nothing to import)`); continue; }
  const cols = Object.keys(rows[0]);
  let imported = 0;
  for (const row of rows) {
    const values = cols.map((c) => (row[c] === '' && c.endsWith('_at') ? null : row[c]));
    const params = cols.map((_, i) => '$' + (i + 1)).join(', ');
    const quoted = cols.map((c) => `"${c}"`).join(', ');
    try {
      await client.query(
        `insert into public."${table}" (${quoted}) values (${params}) on conflict (id) do nothing`,
        values);
      imported++;
    } catch (e) {
      console.log(`  skip ${table}#${row.id}: ${e.message.split('\n')[0]}`);
    }
  }
  await client.query(
    `select setval(pg_get_serial_sequence('public.${table}','id'),
       greatest(coalesce((select max(id) from public."${table}"), 1), 1), true)`);
  console.log(`${table.padEnd(14)} ${imported}/${rows.length} rows imported`);
}

await client.query("notify pgrst, 'reload schema'");
await client.end();
console.log('\nimport complete (schema cache reload requested)');
