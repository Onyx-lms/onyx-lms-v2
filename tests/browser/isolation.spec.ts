/**
 * O01 -- the multi-tenancy claim ("one institution can never see another"),
 * seen through the browser rather than asserted against raw HTML.
 *
 * tests/e2e/o01-web.e2e.ts already proves this over HTTP. This file proves it
 * for what a person in institution A's admin console actually sees: two
 * institutions created in the same run, two separate browser contexts (so
 * neither can accidentally inherit the other's cookie), and a check that
 * institution B's name, address and admin never appear anywhere on A's
 * dashboard or roster -- and the same the other way round.
 */
import { test, expect } from '@playwright/test';
import { RUN, mail, createTenant, signInViaForm, cleanupTenants } from './helpers.ts';

const A = { name: 'Isolation Alpha University ' + RUN, slug: 'browser-iso-a-' + RUN };
const B = { name: 'Isolation Beta Institute ' + RUN, slug: 'browser-iso-b-' + RUN };
const adminA = mail('browser.iso', 'admin-a');
const adminB = mail('browser.iso', 'admin-b');

test.describe('multi-tenant isolation', () => {
  test.beforeAll(async () => {
    await createTenant(A.name, A.slug, 'Admin A', adminA);
    await createTenant(B.name, B.slug, 'Admin B', adminB);
  });

  test.afterAll(async () => {
    await cleanupTenants([A.slug, B.slug], 'browser.iso.%.' + RUN + '@onyx.test');
  });

  test('institution B is invisible on institution A\'s dashboard and roster', async ({ browser }) => {
    const ctx = await browser.newContext();
    try {
      const page = await ctx.newPage();
      await signInViaForm(page, adminA);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(A.name);

      const dashboard = await page.locator('body').innerText();
      expect(dashboard).not.toContain(B.name);
      expect(dashboard).not.toContain(B.slug);

      await page.goto('/onyx/people');
      const roster = await page.locator('body').innerText();
      expect(roster).not.toContain(B.name);
      expect(roster).not.toContain(B.slug);
      expect(roster).not.toContain(adminB);
    } finally {
      await ctx.close();
    }
  });

  test('institution A is invisible on institution B\'s dashboard and roster', async ({ browser }) => {
    const ctx = await browser.newContext();
    try {
      const page = await ctx.newPage();
      await signInViaForm(page, adminB);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(B.name);

      const dashboard = await page.locator('body').innerText();
      expect(dashboard).not.toContain(A.name);
      expect(dashboard).not.toContain(A.slug);

      await page.goto('/onyx/people');
      const roster = await page.locator('body').innerText();
      expect(roster).not.toContain(A.name);
      expect(roster).not.toContain(A.slug);
      expect(roster).not.toContain(adminA);
    } finally {
      await ctx.close();
    }
  });
});
