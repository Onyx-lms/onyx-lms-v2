/**
 * Layouts do not re-render when you navigate between the pages inside them.
 *
 * That one fact of the App Router produced two bugs in this product, both of
 * which passed every test because every test loaded pages by URL -- a fresh
 * document each time, which re-runs the layout. Nobody uses a product that
 * way; they click.
 *
 *   * The tenant layout derived the section title from the `x-pathname`
 *     header. Clicking Students, then Faculty, then Fees in one institution
 *     left all three headed "Overview" -- the exact defect the breadcrumb had
 *     been added to fix, reintroduced by where it was computed.
 *   * The ROOT layout branched on the same header to decide whether a page
 *     wears the storefront's header and footer. Clicking "Sign in" on the
 *     marketing page landed on the Onyx sign-in screen with the shop's header
 *     above it -- ADR-006's one rule, broken for everybody who arrives the
 *     normal way and nobody who types the URL.
 *
 * Both are now derived on the client, from usePathname(). This file navigates
 * only by clicking, which is the only way either bug is visible.
 */
import { test, expect, type Page } from '@playwright/test';

const PLATFORM = { email: 'superadmin@onyx.platform', password: 'Platform#2026!' };
const TENANT = 'ABC Institution';

async function signInPlatform(page: Page) {
  await page.goto('/onyx/platform/login');
  await page.getByLabel(/email/i).fill(PLATFORM.email);
  await page.getByLabel(/password/i).fill(PLATFORM.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.endsWith('/login'), { timeout: 15_000 });
}

test('the section heading follows the sidebar, click after click', async ({ page }) => {
  test.setTimeout(180_000);
  await signInPlatform(page);
  await page.goto('/onyx/platform');
  await page.getByRole('link', { name: TENANT, exact: true }).first().click();
  await page.waitForURL(/\/onyx\/platform\/tenants\/\d+$/, { timeout: 15_000 });
  const base = new URL(page.url()).pathname.replace(/\/$/, '');

  const nav = page.getByRole('navigation', { name: /institution sections/i });
  // One continuous session: no reloads, so the layout renders exactly once and
  // everything below has to come from the client.
  for (const [label, seg] of [
    ['Students', '/students'], ['Fees', '/fees'], ['Faculty', '/faculty'],
    ['Settings', '/settings'], ['Overview', ''], ['Grades', '/grades'],
  ] as const) {
    await nav.getByRole('link', { name: label, exact: true }).click();
    await page.waitForURL(base + seg, { timeout: 15_000 });
    await expect(page.getByRole('heading', { level: 1 }), label).toHaveText(label);
    await expect(page.getByRole('navigation', { name: 'Breadcrumb' }), label)
      .toContainText(label === 'Overview' ? TENANT : label);
  }
});

test('Onyx never wears the storefront chrome, however you arrive', async ({ page }) => {
  const storeHeader = page.locator('header').filter({ hasText: /cart|wishlist|courses/i });

  // Arriving by click, which is how a visitor actually gets there.
  await page.goto('/');
  await expect(storeHeader.first()).toBeVisible();
  await page.getByRole('link', { name: /sign in|log ?in/i }).first().click();
  await page.waitForURL(/\/onyx\//, { timeout: 15_000 });
  await expect(storeHeader).toHaveCount(0);

  // And the same in reverse. Back is a client-side navigation after a soft
  // one, so it exercises the other direction through the same router: leaving
  // Onyx must not strand the storefront without its header.
  await page.goBack();
  await page.waitForURL((u) => !u.pathname.startsWith('/onyx'), { timeout: 15_000 });
  await expect(storeHeader.first()).toBeVisible();
});
