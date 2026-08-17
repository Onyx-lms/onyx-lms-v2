import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeDb } from './fake-db.ts';
import { RegistrationService } from '../src/auth/registration.service.ts';
import { VerificationService } from '../src/auth/verification.service.ts';
import { PasswordResetService } from '../src/auth/password-reset.service.ts';
import { AuthService } from '../src/auth/auth.service.ts';
import { createSignedToken, verifySignedToken } from '../src/auth/signed-token.ts';
import { requireAuth, requireRole, extractToken } from '../src/auth/guards.ts';
import { issueAccessToken } from '../src/auth/jwt.ts';
import { hashPassword } from '../src/auth/password.ts';
import { HttpError } from '../src/http/errors.ts';

const SECRET = 'test-jwt-secret-at-least-32-chars-long';
const db = () => new FakeDb({ users: [], password_reset_tokens: [] });
const NOW = () => Math.floor(Date.now() / 1000);

test('A-02 registers a student with the Laravel defaults', async () => {
  const d = db();
  const user = await new RegistrationService(d as never).register(
    { name: 'Ada Lovelace', email: 'Ada@Example.COM', password: 'secret123' }, false);
  assert.equal(user.role, 'student');
  assert.equal(user.email, 'ada@example.com');
  const row = d.tables.users[0];
  assert.equal(row.status, 1);
  assert.ok(String(row.password).startsWith('$2y$'));
});

test('A-02 stamps email_verified_at when verification is off', async () => {
  const user = await new RegistrationService(db() as never).register(
    { name: 'A', email: 'a@b.test', password: 'secret123' }, false);
  assert.equal(user.emailVerified, true);
});

test('A-02 leaves the account unverified when verification is on', async () => {
  const user = await new RegistrationService(db() as never).register(
    { name: 'A', email: 'a@b.test', password: 'secret123' }, true);
  assert.equal(user.emailVerified, false);
});

test('A-02 rejects a duplicate email with a field-keyed error', async () => {
  const svc = new RegistrationService(db() as never);
  await svc.register({ name: 'A', email: 'a@b.test', password: 'secret123' }, false);
  await assert.rejects(
    () => svc.register({ name: 'B', email: 'a@b.test', password: 'secret123' }, false),
    (e: HttpError) => e.status === 422 && Array.isArray(e.errors?.email));
});

test('A-03 a verification link verifies exactly once', async () => {
  const d = db();
  await new RegistrationService(d as never).register(
    { name: 'A', email: 'a@b.test', password: 'secret123' }, true);
  const svc = new VerificationService(d as never, SECRET);
  const token = await svc.issue(1);
  assert.equal(await svc.consume(token), true);
  assert.equal(await svc.consume(token), false);
});

test('A-03 rejects a tampered verification link', async () => {
  const d = db();
  await new RegistrationService(d as never).register(
    { name: 'A', email: 'a@b.test', password: 'secret123' }, true);
  const svc = new VerificationService(d as never, SECRET);
  const token = await svc.issue(1);
  await assert.rejects(() => svc.consume(token.slice(0, -3) + 'aaa'),
    (e: HttpError) => e.status === 403);
});

test('A-03 a link stops working once the email changes', async () => {
  const d = db();
  await new RegistrationService(d as never).register(
    { name: 'A', email: 'a@b.test', password: 'secret123' }, true);
  const svc = new VerificationService(d as never, SECRET);
  const token = await svc.issue(1);
  d.tables.users[0].email = 'changed@b.test';
  await assert.rejects(() => svc.consume(token), (e: HttpError) => e.status === 403);
});

test('A-03 an expired link is refused', () => {
  const expired = createSignedToken(
    { purpose: 'verify-email', userId: 1, fingerprint: 'x', expiresAt: NOW() - 10 }, SECRET);
  assert.equal(verifySignedToken(expired, SECRET, 'verify-email'), null);
});

test('A-03 a token minted for one purpose cannot be used for another', () => {
  const token = createSignedToken(
    { purpose: 'reset-password', userId: 1, fingerprint: 'x', expiresAt: NOW() + 600 }, SECRET);
  assert.equal(verifySignedToken(token, SECRET, 'verify-email'), null);
});

test('A-04 reset request does not leak whether the account exists', async () => {
  const d = db();
  await new RegistrationService(d as never).register(
    { name: 'A', email: 'a@b.test', password: 'secret123' }, false);
  const svc = new PasswordResetService(d as never);
  assert.ok(await svc.request('a@b.test'));
  assert.equal(await svc.request('nobody@b.test'), null);
});

test('A-04 a reset token works once and then is gone', async () => {
  const d = db();
  await new RegistrationService(d as never).register(
    { name: 'A', email: 'a@b.test', password: 'secret123' }, false);
  const svc = new PasswordResetService(d as never);
  const token = await svc.request('a@b.test');
  await svc.reset('a@b.test', token, 'brand-new-pass');
  assert.equal(d.tables.password_reset_tokens.length, 0);

  const auth = new AuthService(d as never, SECRET);
  assert.equal((await auth.login('a@b.test', 'brand-new-pass', false)).ok, true);
  assert.equal((await auth.login('a@b.test', 'secret123', false)).ok, false);
  await assert.rejects(() => svc.reset('a@b.test', token, 'again'),
    (e: HttpError) => e.status === 422);
});

test('A-04 rejects a wrong reset token', async () => {
  const d = db();
  await new RegistrationService(d as never).register(
    { name: 'A', email: 'a@b.test', password: 'secret123' }, false);
  const svc = new PasswordResetService(d as never);
  await svc.request('a@b.test');
  await assert.rejects(() => svc.reset('a@b.test', 'not-the-token', 'x'),
    (e: HttpError) => e.status === 422);
});

test('A-04 rejects an expired reset token', async () => {
  const d = db();
  await new RegistrationService(d as never).register(
    { name: 'A', email: 'a@b.test', password: 'secret123' }, false);
  const svc = new PasswordResetService(d as never);
  const token = await svc.request('a@b.test');
  d.tables.password_reset_tokens[0].created_at =
    new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  await assert.rejects(() => svc.reset('a@b.test', token, 'x'),
    (e: HttpError) => e.status === 422);
});

test('A-01 login succeeds against a pre-existing Laravel-hashed row', async () => {
  const d = new FakeDb({
    users: [{
      id: 7, email: 'legacy@b.test', name: 'Legacy', role: 'instructor',
      password: await hashPassword('old-laravel-password'),
      email_verified_at: '2024-01-01T00:00:00Z',
    }],
  });
  const result = await new AuthService(d as never, SECRET)
    .login('legacy@b.test', 'old-laravel-password', true);
  assert.equal(result.ok, true);
  assert.equal(result.user?.role, 'instructor');
  assert.equal(result.redirectTo, '/');
});

test('A-01 blocks an unverified account when verification is required', async () => {
  const d = new FakeDb({
    users: [{
      id: 1, email: 'a@b.test', name: 'A', role: 'student',
      password: await hashPassword('secret123'), email_verified_at: null,
    }],
  });
  const auth = new AuthService(d as never, SECRET);
  assert.equal((await auth.login('a@b.test', 'secret123', true)).reason, 'email_unverified');
  assert.equal((await auth.login('a@b.test', 'secret123', false)).ok, true);
});

test('A-01 a missing account and a wrong password are indistinguishable', async () => {
  const d = new FakeDb({
    users: [{
      id: 1, email: 'a@b.test', name: 'A', role: 'student',
      password: await hashPassword('secret123'), email_verified_at: '2024-01-01',
    }],
  });
  const auth = new AuthService(d as never, SECRET);
  assert.equal((await auth.login('ghost@b.test', 'secret123', false)).reason, 'invalid_credentials');
  assert.equal((await auth.login('a@b.test', 'nope', false)).reason, 'invalid_credentials');
});

test('A-05 accepts a bearer header and a cookie', () => {
  const token = issueAccessToken(
    { userId: 1, email: 'a@b.test', appRole: 'admin', secret: SECRET }).token;
  assert.equal(extractToken({ headers: { authorization: 'Bearer ' + token } }), token);
  assert.equal(extractToken({ headers: {}, cookies: { onyx_token: token } }), token);
  assert.equal(extractToken({ headers: {} }), null);
});

test('A-05 requireAuth rejects missing and invalid tokens', () => {
  assert.throws(() => requireAuth({ headers: {} }, SECRET), (e: HttpError) => e.status === 401);
  assert.throws(() => requireAuth({ headers: { authorization: 'Bearer junk' } }, SECRET),
    (e: HttpError) => e.status === 401);
});

test('A-05 requireRole enforces the app_role claim', () => {
  const student = issueAccessToken(
    { userId: 1, email: 's@b.test', appRole: 'student', secret: SECRET }).token;
  const admin = issueAccessToken(
    { userId: 2, email: 'a@b.test', appRole: 'admin', secret: SECRET }).token;
  const req = (t: string) => ({ headers: { authorization: 'Bearer ' + t } });
  assert.equal(requireRole(req(admin), SECRET, 'admin').user_id, 2);
  assert.throws(() => requireRole(req(student), SECRET, 'admin'),
    (e: HttpError) => e.status === 403);
});
