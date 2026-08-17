/**
 * Row-level security: what a browser holding the anon key can and cannot do.
 *
 * WHY THIS EXISTS AT ALL.
 *
 * Authorization in this product lives in the service layer -- `assertCanTeach`
 * ("faculty *of this course*"), guardian consent scoping, `forLearner()`'s
 * grade-hiding, `requireCourseManager`. RLS does not replace any of that and
 * cannot: those rules need joins and tenant settings a row policy cannot express.
 * ADR-012 says so in as many words, and it matters that it keeps saying so --
 * anyone who reads "we have RLS" as "the database enforces authorization" will
 * eventually delete a service-layer check because "RLS covers it". It does not.
 *
 * What RLS closes is exactly one hole: the browser must hold the anon key to use
 * Realtime (components/messenger.tsx creates such a client), and an anon key plus
 * a user's JWT can reach PostgREST directly, bypassing every route guard in the
 * codebase. This file is the evidence that doing so gets you nothing.
 *
 * TWO KINDS OF ASSERTION, DELIBERATELY.
 *
 *   Structural -- read from the catalog, covering all 148 public tables. RLS
 *   enabled, RLS FORCEd, and no write policy granted to a client-reachable role.
 *   With RLS on and no INSERT/UPDATE/DELETE policy, Postgres denies the write
 *   outright; that is a property of every table at once and is worth checking as
 *   one, rather than composing 148 valid insert payloads and hoping each failure
 *   came from the policy rather than a NOT NULL constraint.
 *
 *   Empirical -- a real token against real rows, on the tables where a leak would
 *   actually hurt. This is what catches a policy that is present but wrong.
 *
 * THE TRAP THIS FILE IS WRITTEN AROUND.
 *
 * RLS filters; it does not error. A cross-tenant SELECT returns
 * `{ data: [], error: null }`, and a blocked UPDATE returns success having touched
 * nothing. So a test that asserts `error !== null` passes for the wrong reason on
 * every table and proves nothing at all. Every assertion below is on row counts,
 * and every write is re-read through the service role to prove the row is
 * unchanged rather than merely un-errored.
 *
 *   node --test tests/rls/isolation.test.ts
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const API = process.env.E2E_API ?? 'http://localhost:5175';

function loadEnv(): Record<string, string> {
  const path = new URL('../../.env', import.meta.url);
  if (!fs.existsSync(path)) return process.env as Record<string, string>;
  const out: Record<string, string> = { ...(process.env as Record<string, string>) };
  for (const line of fs.readFileSync(path, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 1) continue;
    const key = t.slice(0, eq).trim();
    if (out[key] === undefined) out[key] = t.slice(eq + 1).trim();
  }
  return out;
}

const env = loadEnv();
let service: SupabaseClient;
/** The anon key plus a real tenant user's JWT -- what a browser actually holds. */
let asUser: SupabaseClient;
/** No JWT at all: a page that has not signed in. */
let asAnon: SupabaseClient;

before(async () => {
  assert.ok(env['SUPABASE_URL'], 'SUPABASE_URL is required');
  service = createClient(env['SUPABASE_URL']!, env['SUPABASE_SERVICE_ROLE_KEY']!,
    { auth: { persistSession: false } });
  asAnon = createClient(env['SUPABASE_URL']!, env['SUPABASE_ANON_KEY']!,
    { auth: { persistSession: false } });

  const res = await fetch(API + '/api/onyx/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@demo.onyx', password: 'Demo#2026!' }),
  });
  const body = await res.json() as { ok: boolean; message?: string; data?: { token: string } };
  assert.ok(body.ok, 'could not sign in (is the app running on ' + API + ' and seeded?): ' + body.message);

  asUser = createClient(env['SUPABASE_URL']!, env['SUPABASE_ANON_KEY']!, {
    auth: { persistSession: false },
    global: { headers: { Authorization: 'Bearer ' + body.data!.token } },
  });
});

/* ------------------------------------------------------- structural ------- */

test('RLS is enabled and FORCEd on every table in public', async () => {
  const { data, error } = await service.rpc('onyx_rls_audit');
  // The RPC is the supported way to read pg_class from the client; if it is
  // absent the audit has not been applied and that is itself the failure.
  assert.equal(error, null, 'onyx_rls_audit missing -- apply migration 0020');

  const rows = data as { table_name: string; rls: boolean; forced: boolean; write_policies: number }[];
  assert.ok(rows.length > 100, 'expected the full public schema, got ' + rows.length);

  const noRls = rows.filter((r) => !r.rls).map((r) => r.table_name);
  assert.deepEqual(noRls, [], 'these tables have RLS switched off');

  // FORCE matters because the tables are owned by `postgres`, and an owner is
  // exempt from its own policies unless RLS is FORCEd.
  const notForced = rows.filter((r) => !r.forced).map((r) => r.table_name);
  assert.deepEqual(notForced, [], 'these tables do not FORCE RLS, so the owner bypasses it');
});

test('no table grants a write policy to a client-reachable role', async () => {
  const { data } = await service.rpc('onyx_rls_audit');
  const rows = data as { table_name: string; write_policies: number }[];

  // This is the load-bearing assertion of the whole file. RLS enabled with no
  // INSERT/UPDATE/DELETE policy is deny-all, so every write from `anon` or
  // `authenticated` is refused by construction rather than by 148 hand-written
  // rules -- which is why the write surface needed no migration to close.
  //
  // If a policy is ever added deliberately, this test should be updated with the
  // reason, not deleted.
  const writable = rows.filter((r) => r.write_policies > 0).map((r) => r.table_name);
  assert.deepEqual(writable, [],
    'these tables now allow a client-side write; if intended, document it here');
});

/* -------------------------------------------------------- empirical ------- */

test('an INSERT from a real tenant token is refused outright', async () => {
  const attempt = await asUser.from('onyx_courses').insert({
    tenant_id: 1, code: 'RLSPROBE', title: 'should never exist',
    slug: 'rls-probe-' + Date.now(), status: 0,
  });
  assert.notEqual(attempt.error, null, 'the insert must fail');
  // 42501 = insufficient_privilege, i.e. the policy refused it.
  assert.equal(attempt.error!.code, '42501');

  const { count } = await service.from('onyx_courses')
    .select('id', { count: 'exact', head: true }).eq('code', 'RLSPROBE');
  assert.equal(count, 0, 'and nothing was written');
});

test('an UPDATE and a DELETE from a real tenant token change nothing', async () => {
  // The row is read and re-read through the service role, because a blocked write
  // reports success having matched zero rows -- asserting on the error would pass
  // whether or not the policy worked.
  const { data: before } = await service.from('onyx_memberships')
    .select('id, role, status').limit(1).single();
  assert.ok(before, 'expected a seeded membership to aim at');

  const upd = await asUser.from('onyx_memberships')
    .update({ role: 'admin' }).eq('id', before.id).select();
  assert.deepEqual(upd.data ?? [], [], 'the update matched no rows');

  const del = await asUser.from('onyx_memberships')
    .delete().eq('id', before.id).select();
  assert.deepEqual(del.data ?? [], [], 'the delete matched no rows');

  const { data: after } = await service.from('onyx_memberships')
    .select('id, role, status').eq('id', before.id).maybeSingle();
  assert.deepEqual(after, before, 'the row is byte-identical afterwards');
});

test('the tables holding secrets are unreadable from the client', async () => {
  // onyx_payment_gateways holds tenant gateway credentials; settings holds
  // smtp_pass. Neither has a SELECT policy, deliberately -- they are read only
  // through the service role, and a browser must get nothing.
  for (const table of ['onyx_payment_gateways', 'settings']) {
    for (const [who, client] of [['authenticated', asUser], ['anon', asAnon]] as const) {
      const { data, error } = await client.from(table).select('*').limit(1);
      // Either refused outright or filtered to nothing -- both are correct, and
      // which one depends on whether a grant or a policy does the work.
      const leaked = !error && (data ?? []).length > 0;
      assert.equal(leaked, false, table + ' is readable by ' + who);
    }
  }
});

test('an unauthenticated client cannot read tenant data', async () => {
  // No JWT means no tenant claim, and every tenant policy compares against
  // onyx.current_tenant_id() -- so this must be empty rather than "everything".
  for (const table of ['onyx_tenants', 'onyx_users', 'onyx_memberships', 'onyx_courses']) {
    const { data, error } = await asAnon.from(table).select('*').limit(5);
    const leaked = !error && (data ?? []).length > 0;
    assert.equal(leaked, false, table + ' leaks ' + (data ?? []).length + ' row(s) to anon');
  }
});

test('a tenant token cannot read another tenant\'s rows', async (t) => {
  // Needs a second institution to be meaningful. Skipped rather than silently
  // passing against a single-tenant database, because "0 rows returned" from an
  // empty other-tenant is not evidence of anything.
  const { data: tenants } = await service.from('onyx_tenants').select('id').order('id');
  if ((tenants ?? []).length < 2) {
    t.skip('only one institution exists -- cross-tenant reads cannot be proven yet. '
      + 'Seed a second tenant to enable this.');
    return;
  }

  const mine = 1;
  const other = (tenants ?? []).map((r) => Number(r.id)).find((id) => id !== mine)!;
  for (const table of ['onyx_courses', 'onyx_memberships', 'onyx_users']) {
    const { data } = await asUser.from(table).select('*').eq('tenant_id', other);
    assert.deepEqual(data ?? [], [], table + ' leaks rows from tenant ' + other);
  }
});
