import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyPassword, hashPassword, normalizeHash } from '../src/auth/password.ts';
import { issueAccessToken, verifyAccessToken, toAppRole } from '../src/auth/jwt.ts';
import { redirectForRole } from '../src/auth/auth.service.ts';

const SECRET = 'test-jwt-secret-at-least-32-chars-long!!';

test('accepts a Laravel-style 2y hash -- the whole point of F-08', async () => {
  const laravelStyle = await hashPassword('correct horse battery staple');
  assert.ok(laravelStyle.startsWith('$2y$10$'), 'must write PHP-compatible prefix');
  assert.equal(await verifyPassword('correct horse battery staple', laravelStyle), true);
  assert.equal(await verifyPassword('wrong', laravelStyle), false);
});

test('normalizeHash rewrites only the version tag', () => {
  assert.equal(normalizeHash('$2y$10$abcdefghij'), '$2a$10$abcdefghij');
  assert.equal(normalizeHash('$2b$10$zzz'), '$2b$10$zzz');
});

test('verification is total on garbage input', async () => {
  assert.equal(await verifyPassword('', '$2y$10$x'), false);
  assert.equal(await verifyPassword('x', ''), false);
  assert.equal(await verifyPassword('x', 'not-a-hash'), false);
});

test('JWT sets role=authenticated and carries the app role separately', () => {
  const { token } = issueAccessToken({
    userId: 42, email: 'a@b.test', appRole: 'admin', secret: SECRET,
  });
  const claims = verifyAccessToken(token, SECRET);
  assert.ok(claims);
  // PostgREST does SET ROLE from `role`; putting admin here breaks every query.
  assert.equal(claims.role, 'authenticated');
  assert.equal(claims.app_role, 'admin');
  assert.equal(claims.user_id, 42);
  assert.equal(claims.sub, '42');
});

test('rejects a token signed with the wrong secret', () => {
  const { token } = issueAccessToken({
    userId: 1, email: 'a@b.test', appRole: 'student', secret: SECRET,
  });
  assert.equal(verifyAccessToken(token, 'a-different-secret-value-here!!'), null);
});

test('rejects an expired token', () => {
  const { token } = issueAccessToken({
    userId: 1, email: 'a@b.test', appRole: 'student', secret: SECRET, ttlSeconds: -1,
  });
  assert.equal(verifyAccessToken(token, SECRET), null);
});

test('unknown db roles degrade to user, never widen access', () => {
  assert.equal(toAppRole('admin'), 'admin');
  assert.equal(toAppRole('ADMIN'), 'admin');
  assert.equal(toAppRole('superuser'), 'user');
  assert.equal(toAppRole(null), 'user');
});

test('post-login redirects match routes/web.php', () => {
  assert.equal(redirectForRole('admin'), '/admin/dashboard');
  assert.equal(redirectForRole('student'), '/my-courses');
  assert.equal(redirectForRole('instructor'), '/');
});
