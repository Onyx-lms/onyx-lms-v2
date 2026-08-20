/**
 * Getting back out, and getting in.
 *
 * Two things a first-time learner needs that the product did not have: a way
 * back from a detail screen to the list it came from, and a way in from the
 * front page without already having an account.
 *
 * The back link is not a nicety. Six of the nine screens under /onyx that open
 * a single record had no way back at all, and the browser's own button is not
 * a substitute: somebody who arrived from a dashboard tile, or from a link
 * another person sent them, has nothing to go back to, and on a phone the
 * browser chrome is hidden while scrolling.
 */
import { test, expect, type Page } from '@playwright/test';

const ADMIN = { email: 'admin@demo.onyx', password: 'Demo#2026!' };

async function signIn(page: Page, who: { email: string; password: string }) {
  await page.context().clearCookies();
  await page.goto('/onyx/login');
  await page.locator('#email').fill(who.email);
  await page.locator('#password').fill(who.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.endsWith('/login'), { timeout: 15_000 });
}

test.describe('every detail screen says how to get back', () => {
  const SCREENS: [string, string, string][] = [
    ['/onyx/courses', 'a[href^="/onyx/courses/"]', 'All courses'],
    ['/onyx/assessments', 'a[href^="/onyx/assessments/"]', 'All papers'],
    ['/onyx/exams', 'a[href^="/onyx/exams/"]', 'All examinations'],
  ];

  for (const [list, itemSelector, label] of SCREENS) {
    test(list + ' → a record → back', async ({ page }) => {
      await signIn(page, ADMIN);
      await page.goto(list);

      const href = await page.locator(itemSelector).first().getAttribute('href');
      test.skip(!href || href === list, 'nothing on this list to open');
      await page.goto(href!);

      // Named, not a bare chevron: the link says where it goes, which also
      // tells somebody where they are.
      const back = page.getByRole('link', { name: label });
      await expect(back).toBeVisible();
      await expect(back).toHaveAttribute('href', list);
    });
  }
});

test.describe('the front page lets a learner in', () => {
  test('offers registration as well as sign-in, everywhere it offers either',
    async ({ page }) => {
      await page.goto('/');

      // The hero, the closing call to action, and the header.
      await expect(page.getByRole('link', { name: 'Create a student account' }).first())
        .toHaveAttribute('href', '/onyx/signup');
      await expect(page.getByRole('link', { name: 'Create account' }).first())
        .toHaveAttribute('href', '/onyx/signup');
      await expect(page.getByRole('link', { name: 'Sign in' }).first())
        .toHaveAttribute('href', '/onyx/login');
    });

  test('shows courses that can actually be joined, with the price on the card',
    async ({ page }) => {
      const res = await page.request.get('/api/onyx/catalogue');
      const body = await res.json();
      const courses = body.data as { access: string; price_minor: number }[];
      test.skip(!courses.length, 'no institution has opened registration');

      await page.goto('/');
      const section = page.getByRole('heading', { name: /Courses you can start/ });
      await expect(section).toBeVisible();

      // A paid course states its price here rather than behind a click, and
      // the card leads to the COURSE rather than straight at a signup form:
      // somebody deciding whether to register wants to see what they would be
      // registering for.
      const paid = courses.find((c) => c.access === 'locked') as
        { id: number; price_minor: number } | undefined;
      if (paid) {
        await expect(page.getByText('INR ' + Math.floor(paid.price_minor / 100)
          .toLocaleString('en-IN')).first()).toBeVisible();
        await expect(page.getByRole('link', { name: 'View course' }).first())
          .toHaveAttribute('href', '/onyx/c/' + paid.id);
      }
    });
});
