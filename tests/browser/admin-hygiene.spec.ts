/**
 * The institution administrator's own console, held to the same rules the
 * platform console was put on.
 *
 * Each test pins one class of defect found by auditing the tenant-side screens
 * the same way:
 *
 *   * A deadline formatter used on a record that has already finished, so the
 *     product told an administrator a filled job post was "26 days late" and a
 *     completed placement drive was overdue, in red, beside a status that said
 *     the opposite.
 *   * Destructive controls firing on a single click, in lists of near-identical
 *     rows where the next row's button is 40px below the one you meant.
 *   * Screens that had never been through axe.
 */
import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const ADMIN = { email: 'admin@demo.onyx', password: 'Demo#2026!' };

async function signIn(page: Page) {
  await page.goto('/onyx/login');
  await page.locator('#email').fill(ADMIN.email);
  await page.locator('#password').fill(ADMIN.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.endsWith('/login'), { timeout: 15_000 });
}

/** Every screen an administrator has a nav link to, plus the roster filters. */
const SCREENS = [
  '/onyx/dashboard', '/onyx/people', '/onyx/people?role=student', '/onyx/people?role=faculty',
  '/onyx/courses', '/onyx/domains', '/onyx/assessments', '/onyx/exams', '/onyx/programs', '/onyx/timetable',
  '/onyx/finance', '/onyx/placement', '/onyx/jobs', '/onyx/settings', '/onyx/profile',
  '/onyx/contests', '/onyx/certificates', '/onyx/invigilate', '/onyx/workspaces', '/onyx/audit',
];

test.describe('the administrator console', () => {
  test.beforeEach(async ({ page }) => { await signIn(page); });

  for (const theme of ['light', 'dark'] as const) {
    test('every screen passes wcag2a/wcag2aa in ' + theme, async ({ page }) => {
      test.setTimeout(300_000);
      await page.goto('/onyx/dashboard');
      if (theme === 'dark') {
        await page.getByRole('button', { name: /theme|dark|light/i }).first().click();
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
      }
      for (const path of SCREENS) {
        await page.goto(path, { waitUntil: 'networkidle' });
        const { violations } = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa']).analyze();
        expect(violations.map((v) => v.id + ' ×' + v.nodes.length), path).toEqual([]);
      }
    });
  }

  test('nothing that has finished is labelled late', async ({ page }) => {
    // A deadline counts down; a finished record is read backwards. Anywhere a
    // row says it is over, it must not also say it is overdue.
    for (const path of ['/onyx/placement', '/onyx/jobs', '/onyx/certificates']) {
      await page.goto(path, { waitUntil: 'networkidle' });
      const done = page.locator('tr, li').filter({ hasText: /complete|cancelled|closed|filled/i });
      for (let i = 0; i < await done.count(); i += 1) {
        await expect(done.nth(i), path + ' row ' + i).not.toContainText(/day[s]? late/i);
      }
    }
  });

  test('taking somebody off a course asks first', async ({ page }) => {
    await page.goto('/onyx/courses', { waitUntil: 'networkidle' });
    await page.getByRole('link', { name: /programming fundamentals/i }).first().click();
    await page.waitForURL(/\/onyx\/courses\/\d+/, { timeout: 15_000 });

    const remove = page.getByRole('button', { name: /^(Remove|Withdraw)$/ }).first();
    if (!await remove.count()) test.skip(true, 'no faculty or roster rows on this course');
    await remove.click();
    // The click arms a question rather than performing the act.
    await expect(page.getByRole('button', { name: /^Yes$/ })).toBeVisible();
    await page.getByRole('button', { name: /^No$/ }).click();
    await expect(page.getByRole('button', { name: /^Yes$/ })).toHaveCount(0);
  });
});
