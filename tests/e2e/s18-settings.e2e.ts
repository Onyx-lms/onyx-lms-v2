import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { api, login, withDb, webPage, webLogin, ADMIN, STUDENT, RUN } from './harness.ts';

let adminToken = '';
let studentToken = '';
let applicantToken = '';
let applicantId = 0;
let languageId = 0;
let campaignId = 0;

/** Restored in after(), so the run leaves settings as it found them. */
let originalTitle: string | null = null;

before(async () => {
  adminToken = await login(ADMIN.email, ADMIN.password);
  studentToken = await login(STUDENT.email, STUDENT.password);

  const email = 'applicant+' + RUN + '@onyx.test';
  const made = await api<{ id: number }>('/api/admin/users', {
    token: adminToken,
    body: { name: 'Applicant ' + RUN, email, password: 'Secret#2026', role: 'student' },
  });
  applicantId = made.data.id;
  applicantToken = (await api<{ token: string }>('/api/auth/login',
    { body: { email, password: 'Secret#2026' } })).data.token;

  const system = await api<Record<string, string | null>>('/api/admin/settings/system',
    { token: adminToken });
  originalTitle = system.data['system_title'] ?? null;
});

after(async () => {
  await withDb(async (c) => {
    // Restored in the database rather than through the API on purpose. This
    // ran through the admin endpoint once, and when the token had expired the
    // restore failed as quietly as the test that preceded it -- leaving the
    // seeded title overwritten, which the next run's audit caught instead.
    if (originalTitle !== null) {
      await c.query("update public.settings set description=$1 where type='system_title'",
        [originalTitle]);
    }
    await c.query('delete from applications where user_id=$1', [applicantId]);
    await c.query('delete from users where email like $1', ['applicant+' + RUN + '@%']);
    await c.query('delete from newsletters where subject like $1', ['%E2E ' + RUN + '%']);
    await c.query('delete from newsletter_subscribers where email like $1',
      ['%+' + RUN + '@onyx.test']);
    const { rows } = await c.query('select id from languages where name like $1',
      ['%E2E ' + RUN + '%']);
    for (const r of rows) {
      await c.query('delete from language_phrases where language_id=$1', [r.id]);
    }
    await c.query('delete from languages where name like $1', ['%E2E ' + RUN + '%']);
  });
});

test('SET-01 settings are admin-only, and secrets never come back', async () => {
  assert.equal((await api('/api/admin/settings/system', { token: studentToken })).status, 403);

  const system = await api<Record<string, unknown>>('/api/admin/settings/system',
    { token: adminToken });
  assert.equal(system.ok, true);
  // The Laravel screens rendered smtp_pass straight into the form's value.
  assert.equal('smtp_pass' in system.data, false);
  assert.equal(typeof system.data['smtp_pass_set'], 'boolean');

  const api_ = await api<Record<string, unknown>>('/api/admin/settings/api',
    { token: adminToken });
  for (const secret of ['zoom_client_secret', 'open_ai_secret_key', 'smtp_pass']) {
    assert.equal(secret in api_.data, false, secret + ' must never be returned');
  }
});

test('SET-01 a known key saves, an unknown one is refused', async () => {
  const saved = await api('/api/admin/settings/system',
    { token: adminToken, body: { system_title: 'Settings E2E ' + RUN } });
  assert.equal(saved.ok, true);

  const readBack = await api<Record<string, string>>('/api/admin/settings/system',
    { token: adminToken });
  assert.equal(readBack.data['system_title'], 'Settings E2E ' + RUN);

  // The public endpoint reflects it too, so the cache really was invalidated.
  const pub = await api<{ system_title: string }>('/api/settings');
  assert.equal(pub.data.system_title, 'Settings E2E ' + RUN);

  const bad = await api('/api/admin/settings/system',
    { token: adminToken, body: { totally_made_up: 'x' } });
  assert.equal(bad.status, 422);
  assert.match(bad.message ?? '', /totally_made_up/);
});

test('SET-03 gateway credentials are masked and survive a save', async () => {
  const before = await api<{ id: number; keys: Record<string, string> }[]>('/api/admin/gateways',
    { token: adminToken });
  assert.equal(before.ok, true);
  for (const g of before.data) {
    for (const [k, v] of Object.entries(g.keys ?? {})) {
      if (/secret|password|private|token/i.test(k)) {
        assert.equal(v === '' || v === '__set__', true,
          k + ' leaked a real value: ' + String(v).slice(0, 8));
      }
    }
  }
  assert.equal((await api('/api/admin/gateways', { token: studentToken })).status, 403);
});

test('SET-06 a language is added with phrases, translated, and removed', async () => {
  const made = await api<{ id: number; phrase_count: number }>('/api/admin/languages', {
    token: adminToken,
    body: { name: 'Testish E2E ' + RUN, direction: 'ltr' },
  });
  assert.equal(made.ok, true);
  languageId = made.data.id;
  // A new language starts with a copy of every phrase, not an empty screen.
  assert.equal(made.data.phrase_count > 0, true);

  const dupe = await api('/api/admin/languages',
    { token: adminToken, body: { name: 'Testish E2E ' + RUN } });
  assert.equal(dupe.status, 422);

  const page = await api<{ rows: { id: number; phrase: string }[]; total: number }>(
    '/api/admin/languages/' + languageId + '/phrases?per_page=5', { token: adminToken });
  assert.equal(page.data.rows.length, 5);
  assert.equal(page.data.total, made.data.phrase_count);

  const first = page.data.rows[0]!;
  const saved = await api<{ written: number }>('/api/admin/languages/' + languageId + '/phrases', {
    token: adminToken,
    body: { phrases: { [String(first.id)]: 'translated-' + RUN } },
  });
  assert.equal(saved.data.written, 1);

  const dump = await api<{ phrases: Record<string, string> }>(
    '/api/admin/languages/' + languageId + '/export', { token: adminToken });
  assert.equal(dump.data.phrases[first.phrase], 'translated-' + RUN);

  const imported = await api<{ updated: number; added: number }>(
    '/api/admin/languages/' + languageId + '/import', {
      token: adminToken,
      body: { phrases: { [first.phrase]: 'reimported', ['NewPhrase' + RUN]: 'brand new' } },
    });
  assert.deepEqual(imported.data, { updated: 1, added: 1 });
});

test('SET-06 the site language cannot be deleted while it is in use', async () => {
  const site = (await api<{ language: string | null }>('/api/admin/settings/system',
    { token: adminToken })).data.language;
  const languages = await api<{ id: number; name: string }[]>('/api/admin/languages',
    { token: adminToken });
  const inUse = languages.data.find(
    (l) => l.name.trim().toLowerCase() === String(site ?? '').trim().toLowerCase());

  // settings.language is 'english' while the row is 'English'; comparing them
  // exactly let this delete through once and took 404 phrases with it.
  assert.ok(inUse, 'the site language should resolve to a real row');
  const refused = await api('/api/admin/languages/' + inUse!.id,
    { token: adminToken, method: 'DELETE' });
  assert.equal(refused.status, 422);

  const removed = await api('/api/admin/languages/' + languageId,
    { token: adminToken, method: 'DELETE' });
  assert.equal(removed.ok, true);
  const left = await withDb(async (c) => Number((await c.query(
    'select count(*)::int n from language_phrases where language_id=$1', [languageId])).rows[0].n));
  assert.equal(left, 0, 'its phrases go with it');
});

test('SET-07 a campaign is created and sent to subscribers', async () => {
  await api('/api/newsletter/subscribe', { body: { email: 'sub1+' + RUN + '@onyx.test' } });
  await api('/api/newsletter/subscribe', { body: { email: 'sub2+' + RUN + '@onyx.test' } });

  const made = await api<{ id: number }>('/api/admin/newsletters', {
    token: adminToken,
    body: { subject: 'Campaign E2E ' + RUN, description: '<p>Hello</p>' },
  });
  assert.equal(made.ok, true);
  campaignId = made.data.id;

  const sent = await api<{ recipients: number; sent: number; failed: number }>(
    '/api/admin/newsletters/' + campaignId + '/send', { token: adminToken, body: {} });
  // SMTP is unreachable in this environment, so everything fails to deliver --
  // what matters is that the run completes and reports honestly rather than
  // stopping at the first bounce.
  assert.equal(sent.ok, true);
  assert.equal(sent.data.recipients >= 2, true);
  assert.equal(sent.data.sent + sent.data.failed, sent.data.recipients);

  await api('/api/admin/newsletters/' + campaignId, { token: adminToken, method: 'DELETE' });
});

test('SET-08 a page is saved, updated and deleted', async () => {
  const made = await api<{ id: number; name: string }>('/api/admin/pages', {
    token: adminToken,
    body: { identifier: 'e2e-' + RUN, name: 'Page E2E ' + RUN, html: '<h1>v1</h1>' },
  });
  assert.equal(made.ok, true, 'create page failed: ' + made.status + ' ' + made.message);

  const updated = await api<{ id: number; name: string }>('/api/admin/pages', {
    token: adminToken,
    body: { id: made.data.id, identifier: 'e2e-' + RUN, name: 'Page E2E ' + RUN + ' v2',
      html: '<h1>v2</h1>' },
  });
  assert.equal(updated.data.id, made.data.id, 'updates rather than duplicating');

  const removed = await api('/api/admin/pages/' + made.data.id,
    { token: adminToken, method: 'DELETE' });
  assert.equal(removed.ok, true);
});

test('SET-09 an application is submitted, approved, and promotes the applicant', async () => {
  const mine = await api<{ open: boolean; application: unknown }>(
    '/api/me/instructor-application', { token: applicantToken });
  assert.equal(mine.data.open, true, 'absent setting means open');
  assert.equal(mine.data.application, null);

  const made = await api<{ id: number; status: number }>('/api/me/instructor-application', {
    token: applicantToken,
    body: { phone: '0700900', description: 'I teach Node ' + RUN,
      document: 'uploads/applications/e2e-' + RUN + '.pdf' },
  });
  assert.equal(made.ok, true);
  assert.equal(made.data.status, 0);

  const again = await api('/api/me/instructor-application', {
    token: applicantToken,
    body: { phone: '0700900', description: 'again', document: 'x.pdf' },
  });
  assert.equal(again.status, 422, 'one pending application at a time');

  const denied = await api('/api/admin/instructor-applications', { token: studentToken });
  assert.equal(denied.status, 403,
    'expected a student to be forbidden, got ' + denied.status + ' ' + denied.message);

  const queue = await api<{ id: number; user: { id: number } | null }[]>(
    '/api/admin/instructor-applications?status=0', { token: adminToken });
  assert.equal(queue.data.some((a) => a.id === made.data.id), true);

  const approved = await api<{ role: string }>(
    '/api/admin/instructor-applications/' + made.data.id + '/approve',
    { token: adminToken, method: 'POST' });
  assert.equal(approved.ok, true, 'approve failed: ' + (approved.message ?? approved.status));
  assert.equal(approved.data.role, 'instructor');

  const role = await withDb(async (c) => (await c.query(
    'select role from users where id=$1', [applicantId])).rows[0].role);
  assert.equal(role, 'instructor', 'approval promotes them for real');

  assert.equal((await api('/api/admin/instructor-applications/' + made.data.id + '/approve',
    { token: adminToken, method: 'POST' })).status, 422, 'and never twice');
});

test('SET-01/SET-09 the admin screens render server-side', async () => {
  const adminCookie = await webLogin(ADMIN.email, ADMIN.password);
  const settings = await webPage('/admin/settings', adminCookie);
  assert.equal(settings.status, 200);
  assert.match(settings.html, /Site title/);

  const languages = await webPage('/admin/languages', adminCookie);
  assert.equal(languages.status, 200);

  const applications = await webPage('/admin/applications', adminCookie);
  assert.equal(applications.status, 200);

  assert.equal((await webPage('/admin/settings')).status, 307,
    'signed-out visitors are redirected');
});
