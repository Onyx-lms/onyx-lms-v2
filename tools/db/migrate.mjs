/**
 * Applies the generated SQL to Supabase, in dependency order.
 *
 * seed runs BEFORE RLS on purpose: 0003 enables FORCE ROW LEVEL SECURITY, which
 * subjects even the table owner to policies. Seeding afterwards could be blocked
 * by the deny-all baseline.
 */
import fs from 'node:fs';
import pg from 'pg';

const env = Object.fromEntries(fs.readFileSync(new URL('../../.env', import.meta.url), 'utf8').split('\n')
  .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
  .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));

const client = new pg.Client({
  connectionString: env.SUPABASE_DB_URL.replace(/[?&]sslmode=[^&]*/, ''),
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 20000,
  statement_timeout: 120000,
});

await client.connect();
const { rows: [v] } = await client.query('select version()');
console.log('connected:', v.version.split(',')[0]);

const { rows: existing } = await client.query(
  "select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE'");
console.log('existing public tables:', existing.length,
  existing.length ? existing.map((r) => r.table_name).join(', ') : '(empty - safe to apply)');

if (process.argv[2] === '--reset') {
  // Drops ONLY the tables this migration owns, never the whole public schema
  // (Supabase keeps extensions and grants there).
  const ours = fs.readFileSync(new URL('../../supabase/', import.meta.url).pathname.replace(/^[/]([A-Za-z]:)/, '$1') + 'migrations/0001_schema.sql', 'utf8')
    .match(/CREATE TABLE IF NOT EXISTS public\."([a-z_]+)"/g)
    .map((m) => m.match(/"([a-z_]+)"/)[1]);
  for (const t of ours) await client.query(`drop table if exists public."${t}" cascade`);
  await client.query('drop schema if exists onyx cascade');
  console.log(`reset: dropped ${ours.length} tables + onyx schema`);
}
if (existing.length && !['--force', '--reset'].includes(process.argv[2])) {
  console.log('\nABORT: public schema is not empty. Re-run with --force only if intended.');
  await client.end();
  process.exit(2);
}

const steps = [
  ['schema ', 'supabase/migrations/0001_schema.sql'],
  ['indexes', 'supabase/migrations/0002_indexes.sql'],
  ['seed   ', 'supabase/seed.sql'],
  ['rls    ', 'supabase/migrations/0003_rls.sql'],
];

for (const [label, file] of steps) {
  const sql = fs.readFileSync(file, 'utf8');
  const started = Date.now();
  try {
    await client.query('begin');
    await client.query(sql);
    await client.query('commit');
    console.log(`applied ${label}  ${String(Date.now() - started).padStart(5)}ms  ${file}`);
  } catch (e) {
    await client.query('rollback').catch(() => {});
    console.log(`FAILED  ${label}  ${file}`);
    console.log('  ', e.message);
    if (e.position) console.log('   near:', sql.slice(Math.max(0, e.position - 120), Number(e.position) + 80));
    await client.end();
    process.exit(1);
  }
}
await client.end();
console.log('\nall migrations applied');
