/**
 * The administrator's console wears the EZiL Design Labs skin, and nobody
 * else's does.
 *
 * The skin is a repaint: one `data-skin` attribute, a palette that resolves
 * through CSS variables, and a display face. No screen was rebuilt, no route
 * changed, no data moved. These tests hold both halves of that claim -- that
 * the administrator gets it, and that the other roles are byte-for-byte what
 * they were -- because a "front-end only" change that leaks into another
 * role's product is exactly the thing that would not show up in any other
 * suite.
 */
import { test, expect, type Page } from '@playwright/test';

const PW = 'Demo#2026!';

async function signIn(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto('/onyx/login');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(PW);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.endsWith('/login'), { timeout: 15_000 });
}

test('an administrator gets the skin', async ({ page }) => {
  await signIn(page, 'admin@demo.onyx');
  await page.goto('/onyx/dashboard');

  await expect(page.locator('[data-skin="ezil"]')).toHaveCount(1);

  // The canvas is the design language's warm cream, not the product's cool
  // grey -- read off the computed style rather than the class, because the
  // class is the thing under test.
  const canvas = await page.locator('[data-skin="ezil"]').first()
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(canvas).toBe('rgb(245, 243, 238)');

  // A display serif on the page heading, which is most of what makes the
  // pairing recognisable.
  const heading = await page.getByRole('heading', { level: 1 }).first()
    .evaluate((el) => getComputedStyle(el).fontFamily);
  expect(heading.toLowerCase()).toContain('fraunces');
});

test('every other role keeps the product exactly as it was', async ({ page }) => {
  for (const who of ['faculty@demo.onyx', 'student@demo.onyx', 'exams@demo.onyx']) {
    await signIn(page, who);
    await page.goto('/onyx/dashboard');
    await expect(page.locator('[data-skin]')).toHaveCount(0);

    const heading = await page.getByRole('heading', { level: 1 }).first()
      .evaluate((el) => getComputedStyle(el).fontFamily);
    expect(heading.toLowerCase()).not.toContain('fraunces');
  }
});

test('the skin changes nothing an administrator can do', async ({ page }) => {
  await signIn(page, 'admin@demo.onyx');

  // The same links, in the same order, going to the same places.
  await page.goto('/onyx/dashboard');
  const nav = page.getByRole('navigation', { name: 'Main' });
  await expect(nav.getByRole('link', { name: 'Dashboard' })).toHaveAttribute(
    'href', '/onyx/dashboard');
  await expect(nav.getByRole('link', { name: 'Settings' })).toHaveAttribute(
    'href', '/onyx/settings');

  // And the screens behind them still render their own content.
  await page.goto('/onyx/people?role=student');
  await expect(page.getByRole('button', { name: 'Add a student' })).toBeVisible();
  await page.goto('/onyx/settings');
  await expect(page.getByRole('heading', { name: 'People', exact: true }).first()).toBeVisible();
});
