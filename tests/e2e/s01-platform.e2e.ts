import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api, withDb, WEB, webPage } from './harness.ts';

// Onyx shares `public` behind an `onyx_` prefix (ADR-006). It is a separate
// product with its own gate, so the port's counts exclude it -- otherwise every
// Onyx table would read here as a parity failure.
const NOT_ONYX = "and table_name not like 'onyx\_%'";
const NOT_ONYX_PG = "and c.relname not like 'onyx\_%'";

test('S00 the live schema still matches Laravel, table for table', async () => {
  const counts = await withDb(async (c) => {
    const { rows: [t] } = await c.query(
      "select count(*)::int n from information_schema.tables where table_schema='public' " +
      "and table_type='BASE TABLE' " + NOT_ONYX);
    const { rows: [col] } = await c.query(
      "select count(*)::int n from information_schema.columns where table_schema='public' " + NOT_ONYX);
    return { tables: t.n, columns: col.n };
  });
  // 61 ported, plus six added by explicit decision because the Laravel models
  // and controllers wrote to tables no migration ever created: quiz_submissions
  // (0004), blog_comments + blog_likes (0005), user_reviews (0006),
  // bootcamp_resources (0008), applications (0009).
  assert.equal(counts.tables, 67);
  assert.equal(counts.columns >= 580, true);
});

test('S01 RLS is enabled and forced on every table', async () => {
  const { enabled, forced } = await withDb(async (c) => {
    const { rows: [r] } = await c.query(
      "select count(*)::int n from pg_class c join pg_namespace ns on ns.oid=c.relnamespace " +
      "where ns.nspname='public' and c.relkind='r' and c.relrowsecurity " + NOT_ONYX_PG);
    const { rows: [f] } = await c.query(
      "select count(*)::int n from pg_class c join pg_namespace ns on ns.oid=c.relnamespace " +
      "where ns.nspname='public' and c.relkind='r' and c.relforcerowsecurity " + NOT_ONYX_PG);
    return { enabled: r.n, forced: f.n };
  });
  assert.equal(enabled, 67);
  assert.equal(forced, 67);
});

test('S01 anon cannot write, and cannot read the settings table', async () => {
  const { createClient } = await import('@supabase/supabase-js');
  const { env } = await import('./harness.ts');
  const anon = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY,
    { auth: { persistSession: false } });

  const write = await anon.from('users').insert({ email: 'e2e-attacker@test', role: 'admin' });
  assert.ok(write.error, 'anon insert into users must be blocked');

  // settings holds smtp_pass and gateway credentials.
  const read = await anon.from('settings').select('type').limit(1);
  assert.equal((read.data ?? []).length, 0, 'settings must not be anon-readable');

  const catalog = await anon.from('categories').select('id').limit(1);
  assert.ok(!catalog.error, 'the public catalog must stay readable');
});

test('S01 public settings expose no secrets', async () => {
  const res = await api<Record<string, unknown>>('/api/settings');
  assert.equal(res.ok, true);
  for (const secret of ['smtp_pass', 'smtp_user', 'open_ai_secret_key']) {
    assert.equal(secret in res.data, false, secret + ' must never be public');
  }
  // Not a branding assertion -- proof the public endpoint actually serves the
  // real row rather than a stale or default value. 'Onyx LMS' is what this
  // deployment's system_title was deliberately set to via the admin API.
  assert.equal(res.data.system_title, 'Onyx LMS');
});

test('S01 i18n serves the seeded corpus and reports direction', async () => {
  const langs = await api<{ name: string; direction: string }[]>('/api/languages');
  assert.equal(langs.data.length, 4);

  const english = await api<{ direction: string; phrases: Record<string, string> }>('/api/i18n/English');
  assert.equal(english.data.direction, 'ltr');
  assert.equal(Object.keys(english.data.phrases).length, 404);

  const arabic = await api<{ direction: string }>('/api/i18n/Arabic');
  assert.equal(arabic.data.direction, 'rtl');
});

test('S01 theme falls back when the configured theme has no views', async () => {
  const res = await api<{ theme: string }>('/api/settings/theme');
  assert.equal(res.data.theme, 'default');
});

test('S01 storage bucket exists and serves objects', async () => {
  const { env } = await import('./harness.ts');
  const res = await fetch(env.SUPABASE_URL + '/storage/v1/bucket', {
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY,
               Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY },
  });
  const buckets = (await res.json()) as { name: string }[];
  assert.ok(buckets.some((b) => b.name === (env.STORAGE_BUCKET || 'uploads')));
});

test('S03 the web app server-renders the catalog', async () => {
  const home = await webPage('/');
  assert.equal(home.status, 200);
  assert.match(home.html, /<title>[^<]+<\/title>/);

  const courses = await webPage('/courses');
  assert.equal(courses.status, 200);
  // Content must be in the HTML, not painted on by client JavaScript.
  assert.match(courses.html, /All courses|Results for/);
});
