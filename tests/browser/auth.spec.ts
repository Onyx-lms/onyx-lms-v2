/**
 * F-03 -- signing in and out, through the real form in a real browser.
 *
 * tests/e2e/o01-web.e2e.ts already proves the HTTP contract (status codes,
 * cookies, redirects). What it cannot prove is that the form on screen
 * actually does the right thing when a person types into it: that a wrong
 * password produces a visible error rather than a silent no-op, that the
 * whole flow works with a keyboard and no mouse, and that signing out really
 * does make the dashboard unreachable in the browser that was just signed in.
 */
import { test, expect } from '@playwright/test';
import {
  RUN, mail, PASSWORD, createTenant, signInViaForm, cleanupTenants,
} from './helpers.ts';

const T = { name: 'Browser Auth College ' + RUN, slug: 'browser-auth-' + RUN };
const adminEmail = mail('browser.auth', 'admin');

test.describe('signing in and out', () => {
  test.beforeAll(async () => {
    await createTenant(T.name, T.slug, 'Admin', adminEmail);
  });

  test.afterAll(async () => {
    await cleanupTenants([T.slug], 'browser.auth.%.' + RUN + '@onyx.test');
  });

  test('a correct sign-in lands on the dashboard with the institution named', async ({ page }) => {
    await signInViaForm(page, adminEmail);
    await expect(page).toHaveURL(/\/onyx\/dashboard$/);
    // The shell's heading is the tenant's own name, not a generic "Dashboard" --
    // proof the page rendered against the institution the token names.
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(T.name);
  });

  test('a wrong password shows a visible error and does not navigate', async ({ page }) => {
    await page.goto('/onyx/login');
    await page.getByLabel('Email address').fill(adminEmail);
    await page.getByLabel('Password').fill('WrongPassword#0000');
    await page.getByRole('button', { name: /sign in/i }).click();

    // Scoped to the form: Next.js's own route announcer
    // (#__next-route-announcer__) also carries role="alert" and is present on
    // every page whether or not anything went wrong, so an unscoped
    // getByRole('alert') matches both and fails on strict mode.
    const alert = page.locator('form').getByRole('alert');
    await expect(alert).toBeVisible();
    await expect(alert).toContainText(/do not match/i);
    // Still on the login page -- a failed sign-in must not be a silent no-op
    // that happens to leave the visitor exactly where a slow success would.
    await expect(page).toHaveURL(/\/onyx\/login$/);
  });

  test('the sign-in form works with a keyboard and nothing else', async ({ page }) => {
    await page.goto('/onyx/login');
    await page.keyboard.press('Tab'); // the skip link, first in the document
    await page.keyboard.press('Tab');
    await expect(page.locator(':focus')).toHaveId('email');
    await page.keyboard.type(adminEmail);
    await page.keyboard.press('Tab');
    await expect(page.locator(':focus')).toHaveId('password');
    await page.keyboard.type(PASSWORD);
    await page.keyboard.press('Enter'); // submits the form, not a click
    await page.waitForURL('**/onyx/dashboard');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(T.name);
  });

  test('signing out returns to login, and the dashboard becomes unreachable', async ({ page }) => {
    await signInViaForm(page, adminEmail);
    await page.getByRole('button', { name: /sign out/i }).click();
    await expect(page).toHaveURL(/\/onyx\/login$/);

    // The cookie is gone. A direct visit is turned back by the server
    // component's redirect, not rendered with an empty or broken shell -- and
    // it carries `?next=` so signing back in returns to where they were going,
    // which is what makes a shared link to a paper survive the login wall.
    await page.goto('/onyx/dashboard');
    await expect(page).toHaveURL(/\/onyx\/login\?next=%2Fonyx%2Fdashboard$/);
  });
});
