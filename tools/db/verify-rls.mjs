import fs from 'node:fs';
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';

const env = Object.fromEntries(fs.readFileSync(new URL('../../.env', import.meta.url), 'utf8').split('\n')
  .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
  .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));

const client = new pg.Client({
  connectionString: env.SUPABASE_DB_URL.replace(/[?&]sslmode=[^&]*/, ''),
  ssl: { rejectUnauthorized: false },
});
await client.connect();
const { rows: [r] } = await client.query(`
  select count(*)::int c from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname='public' and c.relkind='r' and c.relrowsecurity`);
console.log('RLS enabled on', r.c, 'of 61 public tables');
await client.end();

// P-07 acceptance: the anon client must not be able to write anything.
const anon = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY,
  { auth: { persistSession: false } });

const w1 = await anon.from('users').insert({ email: 'attacker@evil.test', role: 'admin', password: 'x' });
console.log('anon INSERT users     :', w1.error ? 'BLOCKED (' + w1.error.code + ')' : 'ALLOWED <-- FAIL');

const w2 = await anon.from('settings').update({ description: 'pwned' }).eq('type', 'system_title');
const after = await anon.from('settings').select('description').eq('type', 'system_title');
console.log('anon UPDATE settings  :', w2.error ? 'BLOCKED' : 'no error returned');
console.log('anon SELECT settings  :',
  (after.data && after.data.length) ? 'READABLE <-- FAIL (holds smtp_pass)' : 'BLOCKED (correct)');

const r1 = await anon.from('categories').select('id, title').limit(3);
console.log('anon SELECT categories:', r1.error ? 'BLOCKED <-- catalog should be public' : `OK (${r1.data.length} rows)`);

const r2 = await anon.from('language_phrases').select('phrase').limit(1);
console.log('anon SELECT phrases   :', r2.error ? 'BLOCKED' : 'OK');

const svc = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } });
const s1 = await svc.from('settings').select('type').eq('type', 'smtp_pass');
console.log('service_role reads all:', s1.error ? 'FAIL ' + s1.error.message : 'OK (bypasses RLS)');
