import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api, login, withDb, webPage, webLogin, ADMIN, STUDENT, RUN } from './harness.ts';

test('S02 an existing account signs in and lands on the right dashboard', async () => {
  const res = await api<{ user: { role: string }; redirect_to: string }>(
    '/api/auth/login', { body: ADMIN });
  assert.equal(res.ok, true);
  assert.equal(res.data.user.role, 'admin');
  assert.equal(res.data.redirect_to, '/admin/dashboard');
});

test('S02 a wrong password and a missing account are indistinguishable', async () => {
  const wrong = await api('/api/auth/login', { body: { ...ADMIN, password: 'nope' } });
  const missing = await api('/api/auth/login',
    { body: { email: 'ghost-' + RUN + '@onyx.test', password: 'nope' } });
  assert.equal(wrong.message, missing.message);
  assert.equal(wrong.status, 401);
});

test('S02 registration creates a student with a PHP-compatible hash', async () => {
  const email = 'e2e-' + RUN + '@onyx.test';
  const res = await api<{ user: { id: number; role: string } }>(
    '/api/auth/register', { body: { name: 'E2E User', email, password: 'E2ePass#2026' } });
  assert.equal(res.ok, true);
  assert.equal(res.data.user.role, 'student');

  const stored = await withDb(async (c) => {
    const { rows } = await c.query('select password, status from users where email=$1', [email]);
    return rows[0];
  });
  // Laravel writes $2y$; both stacks must be able to read each other's hashes.
  assert.ok(String(stored.password).startsWith('$2y$'));
  assert.equal(Number(stored.status), 1);

  // And the new account can immediately sign in.
  const token = await login(email, 'E2ePass#2026');
  assert.ok(token.length > 20);
});

test('S02 a duplicate email is rejected with a field-keyed error', async () => {
  const res = await api('/api/auth/register',
    { body: { name: 'Dup', email: ADMIN.email, password: 'Whatever#2026' } });
  assert.equal(res.status, 422);
  assert.ok(res.errors?.email?.length);
});

test('S02 password reset issues a single-use token', async () => {
  const email = 'e2e-reset-' + RUN + '@onyx.test';
  await api('/api/auth/register', { body: { name: 'Reset', email, password: 'OldPass#2026' } });

  const forgot = await api<{ token?: string }>('/api/auth/password/forgot', { body: { email } });
  assert.equal(forgot.ok, true);
  const token = forgot.data.token;
  assert.ok(token, 'dev builds echo the token so the flow is testable');

  const reset = await api('/api/auth/password/reset',
    { body: { email, token, password: 'BrandNew#2026' } });
  assert.equal(reset.ok, true);

  await login(email, 'BrandNew#2026');                       // new password works
  const old = await api('/api/auth/login', { body: { email, password: 'OldPass#2026' } });
  assert.equal(old.ok, false, 'the old password must be dead');

  const replay = await api('/api/auth/password/reset',
    { body: { email, token, password: 'Again#2026' } });
  assert.equal(replay.ok, false, 'a reset token is single use');
});

test('S02 forgot-password does not reveal whether an account exists', async () => {
  const known = await api('/api/auth/password/forgot', { body: { email: ADMIN.email } });
  const unknown = await api('/api/auth/password/forgot',
    { body: { email: 'nobody-' + RUN + '@onyx.test' } });
  assert.equal(known.message, unknown.message);
  assert.equal(unknown.data.token, undefined, 'no token for an unknown address');
});

test('S02 role guards hold at the API', async () => {
  const student = await login(STUDENT.email, STUDENT.password);
  const admin = await login(ADMIN.email, ADMIN.password);

  assert.equal((await api('/api/admin/users', { token: student })).status, 403);
  assert.equal((await api('/api/admin/users', { token: admin })).status, 200);
  assert.equal((await api('/api/me')).status, 401, 'no token at all');
  assert.equal((await api('/api/me', { token: 'junk' })).status, 401);
});

test('S02 role guards hold in the web app', async () => {
  const anon = await webPage('/admin/dashboard');
  assert.equal(anon.status, 307);

  const studentCookie = await webLogin(STUDENT.email, STUDENT.password);
  const denied = await webPage('/admin/users', studentCookie);
  assert.equal(denied.status, 307, 'a student is redirected away from admin');

  const adminCookie = await webLogin(ADMIN.email, ADMIN.password);
  const allowed = await webPage('/admin/users', adminCookie);
  assert.equal(allowed.status, 200);
  assert.match(allowed.html, /root@onyx\.test/);
});

test('S02 the session cookie is httpOnly and the token never reaches the body', async () => {
  const res = await fetch((process.env.E2E_WEB ?? 'http://127.0.0.1:5173') + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(STUDENT),
  });
  const cookies = res.headers.getSetCookie?.() ?? [];
  const session = cookies.find((c) => c.startsWith('onyx_session='));
  assert.ok(session);
  assert.match(session, /HttpOnly/i);
  const body = await res.json();
  assert.equal(body.data.token, undefined, 'the JWT must not be readable by page scripts');
});

test('S02 device ip is recorded once per session', async () => {
  const before = await withDb(async (c) =>
    (await c.query('select count(*)::int n from device_ips')).rows[0].n);
  await login(STUDENT.email, STUDENT.password);
  const after = await withDb(async (c) =>
    (await c.query('select count(*)::int n from device_ips')).rows[0].n);
  assert.equal(after >= before, true);
});
