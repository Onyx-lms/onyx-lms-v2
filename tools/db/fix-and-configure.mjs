/**
 * Applies the two problems the audit found:
 *   1. offline_payments.items must be varchar(255), matching string('items', 255).
 *   2. the storage bucket P-04 writes to has to actually exist.
 */
import fs from 'node:fs';
import pg from 'pg';

const ROOT = new URL('../../', import.meta.url).pathname.replace(/^[/]([A-Za-z]:)/, '$1');
const env = Object.fromEntries(fs.readFileSync(ROOT + '.env', 'utf8').split('\n')
  .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
  .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));

const client = new pg.Client({
  connectionString: env.SUPABASE_DB_URL.replace(/[?&]sslmode=[^&]*/, ''),
  ssl: { rejectUnauthorized: false },
});
await client.connect();

const { rows: [before] } = await client.query(
  "select data_type, character_maximum_length from information_schema.columns " +
  "where table_schema='public' and table_name='offline_payments' and column_name='items'");
console.log('offline_payments.items before:', before.data_type, before.character_maximum_length ?? '');

const { rows: [tooLong] } = await client.query(
  "select count(*)::int c from public.offline_payments where length(items) > 255");
if (tooLong.c > 0) {
  console.log('ABORT: ' + tooLong.c + ' row(s) exceed 255 chars; narrowing would truncate data.');
} else {
  await client.query(
    'alter table public.offline_payments alter column items type varchar(255)');
  const { rows: [after] } = await client.query(
    "select data_type, character_maximum_length from information_schema.columns " +
    "where table_schema='public' and table_name='offline_payments' and column_name='items'");
  console.log('offline_payments.items after :', after.data_type, after.character_maximum_length);
}
await client.query("notify pgrst, 'reload schema'");
await client.end();

// ---- storage bucket ----
const bucket = env.STORAGE_BUCKET || 'uploads';
const headers = {
  apikey: env.SUPABASE_SERVICE_ROLE_KEY,
  Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY,
  'Content-Type': 'application/json',
};
const res = await fetch(env.SUPABASE_URL + '/storage/v1/bucket', {
  method: 'POST',
  headers,
  // Public: these are course thumbnails and banners, served straight to browsers.
  // Private objects (offline-payment docs, bootcamp resources) get signed URLs
  // from StorageService instead of a second bucket.
  body: JSON.stringify({ id: bucket, name: bucket, public: true }),
});
const body = await res.json().catch(() => ({}));
console.log('bucket create:', res.status, JSON.stringify(body));

const list = await fetch(env.SUPABASE_URL + '/storage/v1/bucket', { headers });
const buckets = await list.json();
console.log('buckets now:', Array.isArray(buckets)
  ? buckets.map((b) => b.name + '(public=' + b.public + ')').join(', ') : buckets);
