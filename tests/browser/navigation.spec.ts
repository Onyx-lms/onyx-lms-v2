/**
 * F-07 -- role-aware navigation, rendered and clicked in a real browser.
 *
 * apps/web/src/lib/onyx-nav.ts is the source of truth for who gets which
 * links; tests/e2e/o01-web.e2e.ts already checks the raw HTML for a couple of
 * roles. This file drives the actual sidebar: two people signed in
 * concurrently in separate browser contexts, seeing genuinely different
 * menus, and a click that really moves the browser to another page.
 */
import { test, expect } from '@playwright/test';
import {
  RUN, mail, createTenant, adminToken, addMember, signInViaForm, cleanupTenants,
} from './helpers.ts';

const T = { name: 'Browser Nav College ' + RUN, slug: 'browser-nav-' + RUN };
const adminEmail = mail('browser.nav', 'admin');
const facultyEmail = mail('browser.nav', 'faculty');
const studentEmail = mail('browser.nav', 'student');

test.describe('role-aware navigation', () => {
  test.beforeAll(async () => {
    await createTenant(T.name, T.slug, 'Admin', adminEmail);
    const token = await adminToken(adminEmail);
    await addMember(token, 'Faculty', facultyEmail, 'faculty');
    await addMember(token, 'Student', studentEmail, 'student');
  });

  test.afterAll(async () => {
    await cleanupTenants([T.slug], 'browser.nav.%.' + RUN + '@onyx.test');
  });

  test('a student and an admin see different navigation', async ({ browser }) => {
    const adminCtx = await browser.newContext();
    const studentCtx = await browser.newContext();
    try {
      const adminPage = await adminCtx.newPage();
      await signInViaForm(adminPage, adminEmail);
      const adminNav = adminPage.getByRole('navigation');
      // The roster, which only an administrator and faculty get -- and which
      // an administrator gets as the two halves they actually reach for
      // rather than one combined "People" (see onyx-nav.ts).
      await expect(adminNav.getByRole('link', { name: 'Students' })).toBeVisible();
      await expect(adminNav.getByRole('link', { name: 'Faculty' })).toBeVisible();
      // The audit log is deliberately NOT in this menu: it is a forensic
      // screen, opened from the dashboard's "Full log" when something specific
      // is being chased. The route is untouched -- this asserts the menu.
      await expect(adminNav.getByRole('link', { name: 'Audit log' })).toHaveCount(0);

      const studentPage = await studentCtx.newPage();
      await signInViaForm(studentPage, studentEmail);
      const studentNav = studentPage.getByRole('navigation');
      await expect(studentNav.getByRole('link', { name: 'Audit log' })).toHaveCount(0);
      await expect(studentNav.getByRole('link', { name: 'Students' })).toHaveCount(0);
      await expect(studentNav.getByRole('link', { name: 'People' })).toHaveCount(0);
      // A student's menu is not just "the admin menu minus some items" -- it
      // has entries of its own, like the practice bank.
      await expect(studentNav.getByRole('link', { name: 'Practice' })).toBeVisible();
    } finally {
      await adminCtx.close();
      await studentCtx.close();
    }
  });

  test('faculty can see the roster but not the audit log', async ({ page }) => {
    await signInViaForm(page, facultyEmail);
    const nav = page.getByRole('navigation');
    await expect(nav.getByRole('link', { name: 'People' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Audit log' })).toHaveCount(0);
  });

  test('clicking a nav link actually navigates and renders that heading', async ({ page }) => {
    await signInViaForm(page, adminEmail);
    await page.getByRole('navigation').getByRole('link', { name: 'Courses' }).click();
    await expect(page).toHaveURL(/\/onyx\/courses$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Courses');
  });

  test('the roster gives an administrator editing controls that faculty do not get', async ({ page }) => {
    await signInViaForm(page, adminEmail);
    await page.goto('/onyx/people');
    // Edit is what a row offers. Removing somebody is no longer one of the
    // things sitting in red at the end of forty near-identical lines -- it is
    // at the foot of the panel Edit opens, where the person is named.
    await expect(page.getByRole('button', { name: 'Remove member' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Edit' }).first().click();
    await expect(page.getByRole('button', { name: 'Remove member' })).toBeVisible();

    // The login page redirects a signed-in visitor straight to the dashboard,
    // so switching who this page is signed in as means clearing the session
    // first -- otherwise signInViaForm would never see the form to fill in.
    await page.context().clearCookies();
    await signInViaForm(page, facultyEmail);
    await page.goto('/onyx/people');
    await expect(page.getByRole('button', { name: 'Edit' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /remove/i })).toHaveCount(0);
  });
  test('exactly one navigation item is ever marked current', async ({ page }) => {
    /*
     * Two used to be. Each item decided for itself with
     * `pathname === href || pathname.startsWith(href + '/')`, and two items sit
     * one under the other: standing on /onyx/practice/submissions lit Practice
     * AND Submissions, so the sidebar showed two current pages at once.
     *
     * The prefix rule itself is right and is checked below — a detail page that
     * is nobody's nav item still has to light the section it belongs to.
     */
    await signInViaForm(page, facultyEmail);
    for (const path of ['/onyx/practice', '/onyx/practice/submissions', '/onyx/exams']) {
      await page.goto(path);
      const current = page.locator('nav[aria-label="Main"] a[aria-current="page"]');
      await expect(current, path + ' should mark exactly one item current').toHaveCount(1);
    }
    // The more specific item wins where both would match.
    await page.goto('/onyx/practice/submissions');
    await expect(
      page.locator('nav[aria-label="Main"] a[aria-current="page"]'),
    ).toHaveAttribute('href', '/onyx/practice/submissions');
    // And a page that is nobody's item keeps its section lit rather than
    // leaving the sidebar with nothing current at all.
    await page.goto('/onyx/practice');
    const problem = page.locator('a[href^="/onyx/practice/"]').first();
    if (await problem.count()) {
      const href = await problem.getAttribute('href');
      if (href && href !== '/onyx/practice/submissions') {
        await page.goto(href);
        await expect(
          page.locator('nav[aria-label="Main"] a[aria-current="page"]'),
        ).toHaveCount(1);
      }
    }
  });
});
