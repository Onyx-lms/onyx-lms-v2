/**
 * The permission matrix, from the screen down to the 403.
 *
 * A settings page full of toggles that do not reach the API is worse than no
 * settings page at all: it tells an administrator they have delegated
 * something when they have not. So these tests never assert that a checkbox
 * ticked -- they assert what the API does afterwards.
 *
 * State is restored in `afterAll` whatever happens, because a failure halfway
 * through would otherwise leave the demo institution with a capability
 * revoked and every later run testing a different product.
 */
import { test, expect, request as playwrightRequest, type Page } from '@playwright/test';

const ADMIN = { email: 'admin@demo.onyx', password: 'Demo#2026!' };
const FACULTY = { email: 'faculty@demo.onyx', password: 'Demo#2026!' };
const API = process.env.E2E_API ?? process.env.E2E_WEB ?? 'http://127.0.0.1:5173';

async function token(email: string, password: string) {
  const ctx = await playwrightRequest.newContext({ baseURL: API });
  const res = await ctx.post('/api/onyx/auth/login', { data: { email, password } });
  const body = await res.json();
  await ctx.dispose();
  return body.data.token as string;
}

async function api(path: string, init: { method?: string; token: string; data?: unknown }) {
  const ctx = await playwrightRequest.newContext({
    baseURL: API,
    extraHTTPHeaders: { Authorization: 'Bearer ' + init.token },
  });
  const res = init.method === 'PUT'
    ? await ctx.put(path, { data: init.data })
    : init.method === 'POST'
      ? await ctx.post(path, { data: init.data ?? {} })
      : await ctx.get(path);
  const body = await res.json().catch(() => ({}));
  await ctx.dispose();
  return { status: res.status(), body };
}

async function signIn(page: Page, who: { email: string; password: string }) {
  await page.goto('/onyx/login');
  await page.locator('#email').fill(who.email);
  await page.locator('#password').fill(who.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.endsWith('/login'), { timeout: 15_000 });
}

/** Everything back to how it ships, whatever these tests did. */
test.afterAll(async () => {
  const admin = await token(ADMIN.email, ADMIN.password);
  const now = await api('/api/onyx/permissions', { token: admin });
  const defaults = Object.fromEntries(
    (now.body.data.capabilities as { key: string; defaults: string[] }[])
      .map((c) => [c.key, c.defaults]));
  await api('/api/onyx/permissions', { method: 'PUT', token: admin, data: { permissions: defaults } });
});

test('the matrix covers every part of the institution, not just examinations', async ({ page }) => {
  await signIn(page, ADMIN);
  await page.goto('/onyx/settings');

  // The areas an institution actually delegates across.
  for (const area of ['People', 'Academic structure', 'Courses', 'Assessment',
    'Examinations', 'Timetable', 'Fees', 'Careers']) {
    await expect(page.getByRole('heading', { name: area, exact: true }).first()).toBeVisible();
  }

  // Administrators are stated, not offered: the column exists and holds no
  // control, because a matrix that can revoke admin is a lockout.
  const adminCol = page.getByText('Administrators always hold this').first();
  await expect(adminCol).toBeAttached();
});

test('revoking a capability stops the API accepting it, and restoring brings it back',
  async () => {
    const admin = await token(ADMIN.email, ADMIN.password);
    const faculty = await token(FACULTY.email, FACULTY.password);

    const before = await api('/api/onyx/permissions', { token: admin });
    const matrix = Object.fromEntries(
      (before.body.data.capabilities as { key: string; holders_now: string[] }[])
        .map((c) => [c.key, c.holders_now]));

    // Faculty may create a course as shipped.
    expect(matrix['courses.create']).toContain('faculty');

    await api('/api/onyx/permissions', {
      method: 'PUT', token: admin,
      data: { permissions: { ...matrix, 'courses.create': ['admin'] } },
    });

    const refused = await api('/api/onyx/courses', {
      method: 'POST', token: faculty,
      data: { code: 'PERM-' + Date.now(), title: 'Refused by the matrix', credits: 1 },
    });
    expect(refused.status).toBe(403);
    // Named, so an administrator can tell which switch caused it.
    expect(JSON.stringify(refused.body)).toContain('Create courses');

    await api('/api/onyx/permissions', {
      method: 'PUT', token: admin, data: { permissions: matrix },
    });
    const allowed = await api('/api/onyx/permissions', { token: faculty });
    expect(allowed.body.data.mine).toContain('courses.create');
  });

test('a role that may never hold a capability cannot be given it', async () => {
  const admin = await token(ADMIN.email, ADMIN.password);
  const before = await api('/api/onyx/permissions', { token: admin });
  const matrix = Object.fromEntries(
    (before.body.data.capabilities as { key: string; holders_now: string[] }[])
      .map((c) => [c.key, c.holders_now]));

  // The fee ledger is admin-only by design; asking for a student on it is not
  // an error to report back, it is a value to drop.
  await api('/api/onyx/permissions', {
    method: 'PUT', token: admin,
    data: { permissions: { ...matrix, 'fees.record_payment': ['admin', 'student'] } },
  });

  const after = await api('/api/onyx/permissions', { token: admin });
  const fees = (after.body.data.capabilities as { key: string; holders_now: string[] }[])
    .find((c) => c.key === 'fees.record_payment');
  expect(fees?.holders_now).toEqual(['admin']);
});

test('granting a capability lets a role through a route it was refused before', async () => {
  const admin = await token(ADMIN.email, ADMIN.password);
  const exams = await token('exams@demo.onyx', ADMIN.password);

  const before = await api('/api/onyx/permissions', { token: admin });
  const matrix = Object.fromEntries(
    (before.body.data.capabilities as { key: string; holders_now: string[] }[])
      .map((c) => [c.key, c.holders_now]));

  const person = { name: 'Matrix Probe', email: 'matrix.probe.' + Date.now() + '@demo.onyx',
    role: 'student', password: 'Demo#2026!' };

  const refused = await api('/api/onyx/members', { method: 'POST', token: exams, data: person });
  expect(refused.status).toBe(403);

  await api('/api/onyx/permissions', {
    method: 'PUT', token: admin,
    data: { permissions: { ...matrix, 'people.invite': ['admin', 'exams'] } },
  });

  const accepted = await api('/api/onyx/members', { method: 'POST', token: exams, data: person });
  expect(accepted.status).toBe(200);

  // Tidy the person this created. DELETE, not POST -- the first version of
  // this posted to the member URL, which is not a route, so every run left a
  // "Matrix Probe" account behind in the demo institution.
  const membershipId = accepted.body?.data?.membership?.id;
  if (membershipId) {
    const ctx = await playwrightRequest.newContext({
      baseURL: API, extraHTTPHeaders: { Authorization: 'Bearer ' + admin },
    });
    await ctx.delete('/api/onyx/members/' + membershipId).catch(() => undefined);
    await ctx.dispose();
  }
});
