/**
 * Supabase Auth migration, step 2/3 (of the overall auth migration --
 * see docs/ADR-011-supabase-auth-migration.md): provisions a real
 * `auth.users` row for every existing `onyx_users` row, then backfills the
 * uuid twin columns 0013 added.
 *
 *   node tools/onyx/provision-auth-users.mjs
 *
 * Idempotent: skips any onyx_users row that already has auth_id set, and
 * tolerates auth.users already having a row for an email (looks it up
 * instead of failing) -- safe to re-run after a partial failure.
 *
 * `auth.users` is GoTrue-owned; rows are created through the Supabase Admin
 * API (service-role key), never by a direct INSERT, so GoTrue's own
 * invariants (identity rows, encrypted_password format, etc.) stay intact.
 *
 * Passwords: this project's tenant data is seed/demo data, not real
 * institutions (confirmed 2026-08-14), so there is no "preserve an existing
 * secret" problem -- every provisioned account gets the password already
 * documented for it elsewhere in this repo (tools/screenshot-roles.mjs,
 * docs/roles/*.md, scripts-scratch-seed3.mjs: 'Demo#2026!' for every
 * *@demo.onyx / seeded-tenant account), except the one Onyx platform-admin
 * fixture tests/e2e/harness.ts hardcodes as PLATFORM, which keeps its own
 * password so the e2e suite's platformToken() keeps working unmodified.
 */
import { createClient } from '@supabase/supabase-js';
import { connect, loadEnv } from '../db/connect.mjs';

const env = loadEnv();
if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (see .env).');
}

const DEMO_PASSWORD = 'Demo#2026!';
const PLATFORM_FIXTURE = { email: 'superadmin@onyx.platform', password: 'Platform#2026!' };
const passwordFor = (email) => (email === PLATFORM_FIXTURE.email ? PLATFORM_FIXTURE.password : DEMO_PASSWORD);

const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const c = await connect(env);

// Same introspection the generator used, re-run here rather than parsing
// 0013's SQL back out -- the live schema is the source of truth for both.
const { rows: fks } = await c.query(`
  SELECT rel.relname AS table_name, att.attname AS column_name
  FROM pg_constraint con
  JOIN pg_class rel     ON rel.oid = con.conrelid
  JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
  JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = con.conkey[1]
  WHERE con.contype = 'f' AND con.confrelid = 'public.onyx_users'::regclass
    AND nsp.nspname = 'public' AND array_length(con.conkey, 1) = 1
`);

const { rows: pending } = await c.query(
  'SELECT id, email FROM public.onyx_users WHERE auth_id IS NULL ORDER BY id',
);

console.log('onyx_users needing an auth.users row: ' + pending.length
  + ' (already provisioned: skipped)');

let created = 0;
let linked = 0;
let failed = 0;

for (const row of pending) {
  const password = passwordFor(row.email);
  const { data, error } = await admin.auth.admin.createUser({
    email: row.email,
    password,
    email_confirm: true,
  });

  let authId = data?.user?.id;

  if (error) {
    // Idempotency: a prior run may have created the auth.users row but died
    // before the SQL UPDATE landed. Look it up instead of treating this as
    // fatal -- only a genuine, non-"already exists" error stops the run.
    const alreadyExists = /already.*registered|already.*exists/i.test(error.message ?? '');
    if (!alreadyExists) {
      console.error('  FAILED  ' + row.email + ': ' + error.message);
      failed++;
      continue;
    }
    const { data: list, error: listErr } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (listErr) {
      console.error('  FAILED  ' + row.email + ': createUser said "exists" but listUsers failed: ' + listErr.message);
      failed++;
      continue;
    }
    const existing = list.users.find((u) => u.email?.toLowerCase() === row.email.toLowerCase());
    if (!existing) {
      console.error('  FAILED  ' + row.email + ': createUser said "exists" but no matching user found');
      failed++;
      continue;
    }
    authId = existing.id;
    linked++;
  } else {
    created++;
  }

  await c.query('UPDATE public.onyx_users SET auth_id = $1 WHERE id = $2', [authId, row.id]);
}

console.log('auth.users: ' + created + ' created, ' + linked + ' linked to an existing row, ' + failed + ' failed');

if (failed > 0) {
  await c.end();
  throw new Error(failed + ' row(s) could not be provisioned -- fix and re-run (idempotent).');
}

// Backfill every uuid twin column from onyx_users.auth_id, table by table.
console.log('backfilling ' + fks.length + ' uuid columns across '
  + new Set(fks.map((f) => f.table_name)).size + ' tables...');

let totalRows = 0;
for (const f of fks) {
  const { rowCount } = await c.query(
    `UPDATE public."${f.table_name}" t SET "${f.column_name}_uuid" = u.auth_id `
      + `FROM public."onyx_users" u WHERE t."${f.column_name}" = u.id AND t."${f.column_name}_uuid" IS NULL`,
  );
  totalRows += rowCount;
}
console.log('backfilled ' + totalRows + ' cell(s) across ' + fks.length + ' columns');

await c.end();
console.log('done -- run tools/onyx/validate-uuid-backfill.mjs next.');
