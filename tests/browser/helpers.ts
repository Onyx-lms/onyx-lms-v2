/**
 * Shared setup for the browser suite.
 *
 * Seeding (creating institutions and members) goes straight through the API --
 * that is not what these tests are proving. Signing in goes through the real
 * login form in a real page, because that is exactly what they are proving.
 *
 * Reuses tests/e2e/harness.ts for the pieces that do not care whether the
 * caller is node:test or Playwright: the API client, the run-unique suffix,
 * and direct database cleanup.
 */
import type { Page } from '@playwright/test';
import { api, withDb, RUN, WEB, createTenant as createTenantAsPlatform } from '../e2e/harness.ts';

export { RUN, WEB, withDb, api };

/** One password for every seeded account; nothing here tests password policy. */
export const PASSWORD = 'OnyxBrowser#2026';

/** A run-unique, collision-free email for a given suite and role. */
export function mail(suite: string, who: string): string {
  return suite + '.' + who + '.' + RUN + '@onyx.test';
}

/**
 * Creates an institution and its first administrator, via the API.
 *
 * Goes through the harness helper because POST /api/onyx/tenants is no longer
 * open: it requires a platform-admin token, which the harness mints and caches.
 */
export async function createTenant(
  name: string, slug: string, adminName: string, adminEmail: string,
): Promise<number> {
  const res = await createTenantAsPlatform({
    name, slug, admin: { name: adminName, email: adminEmail, password: PASSWORD },
  });
  if (!res.ok) throw new Error('createTenant(' + slug + ') failed: ' + res.message);
  return Number(res.data.tenant.id);
}

/** An admin's API bearer token, so members can be seeded without a browser. */
export async function adminToken(email: string): Promise<string> {
  const res = await api<{ token: string }>('/api/onyx/auth/login', {
    body: { email, password: PASSWORD },
  });
  if (!res.ok) throw new Error('adminToken(' + email + ') failed: ' + res.message);
  return res.data.token;
}

export async function addMember(
  token: string, name: string, email: string, role: string,
): Promise<void> {
  const res = await api('/api/onyx/members', {
    token, body: { name, email, role, password: PASSWORD },
  });
  if (!res.ok) throw new Error('addMember(' + email + ') failed: ' + res.message);
}

/**
 * Signs in through the real login form: types into the fields, clicks submit,
 * and waits for the client-side redirect the form does on success. This is
 * the thing the whole suite exists to exercise, so every test that needs a
 * signed-in page goes through here rather than setting a cookie directly.
 */
export async function signInViaForm(page: Page, email: string, password = PASSWORD): Promise<void> {
  await page.goto('/onyx/login');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL('**/onyx/dashboard');
}

/** Deletes a run's tenants and users straight from the database, not through the API. */
export async function cleanupTenants(slugs: string[], emailLikePattern: string): Promise<void> {
  await withDb(async (c) => {
    await c.query('DELETE FROM public."onyx_tenants" WHERE slug = ANY($1)', [slugs]);
    await c.query('DELETE FROM public."onyx_users" WHERE email LIKE $1', [emailLikePattern]);
  });
}
