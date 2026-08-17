import fs from 'node:fs';
import pg from 'pg';
const env = Object.fromEntries(fs.readFileSync(new URL('../../.env', import.meta.url), 'utf8').split('\n')
  .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
  .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
const c = new pg.Client({
  connectionString: env.SUPABASE_DB_URL.replace(/[?&]sslmode=[^&]*/, ''),
  ssl: { rejectUnauthorized: false },
});
await c.connect();
await c.query("notify pgrst, 'reload schema'");
console.log('sent: NOTIFY pgrst reload schema');
await c.end();
