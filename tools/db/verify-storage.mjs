/**
 * P-04 acceptance: a path as stored in the database resolves to a live object
 * with no row rewrite. Uploads to the same key layout Laravel used.
 */
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const ROOT = new URL('../../', import.meta.url).pathname.replace(/^[/]([A-Za-z]:)/, '$1');
const env = Object.fromEntries(fs.readFileSync(ROOT + '.env', 'utf8').split('\n')
  .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
  .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));

const bucket = env.STORAGE_BUCKET || 'uploads';
const svc = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } });

// A legacy Laravel value, exactly as it sits in courses.thumbnail today.
const storedPath = 'uploads/thumbnails/parity-check.txt';
const key = storedPath.replace(/^\/?(public\/)?(uploads\/)?/i, '');
const payload = 'onyx storage parity ' + new Date().toISOString();

const up = await svc.storage.from(bucket)
  .upload(key, new Blob([payload], { type: 'text/plain' }), { upsert: true, contentType: 'text/plain' });
console.log('upload      :', up.error ? 'FAIL ' + up.error.message : 'ok -> ' + key);

const publicUrl = svc.storage.from(bucket).getPublicUrl(key).data.publicUrl;
const fetched = await fetch(publicUrl);
const text = await fetched.text();
console.log('public read :', fetched.status, text === payload ? 'bytes match' : 'MISMATCH');

const signed = await svc.storage.from(bucket).createSignedUrl(key, 60);
console.log('signed url  :', signed.error ? 'FAIL' : 'ok (' + signed.data.signedUrl.slice(0, 60) + '...)');

const anon = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const anonWrite = await anon.storage.from(bucket)
  .upload('thumbnails/attacker.txt', new Blob(['x']), { upsert: true });
console.log('anon upload :', anonWrite.error ? 'BLOCKED (correct)' : 'ALLOWED <-- FAIL');

await svc.storage.from(bucket).remove([key]);
console.log('cleanup     : removed test object');
