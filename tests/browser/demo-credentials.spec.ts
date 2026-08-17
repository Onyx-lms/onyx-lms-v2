/**
 * Sanity check for the persistent demo institution ("Demo University", slug
 * `demo-university`) handed to the user as fixed, reusable credentials -- as
 * opposed to every other file in this suite, which seeds a fresh run-unique
 * tenant per file. This one exists purely to prove those exact emails and
 * that exact password still work, end to end, through the real form.
 *
 * It previously pointed at an older demo tenant ("EZiL Demo Institute",
 * `ezil-demo`, `@onyx-demo.test`) which was deleted during an unrelated
 * cleanup of stray test institutions -- the exact failure mode this file is
 * meant to catch, so it did its job. The lesson is worth keeping: a tenant a
 * test depends on is not "stray" just because it was not created by that run.
 */
import { test, expect } from '@playwright/test';

const PASSWORD = 'Demo#2026!';

/** Where each role legitimately lands. Two of them never see a dashboard. */
const ACCOUNTS: [string, string][] = [
  ['admin@demo.onyx', '/onyx/dashboard'],
  ['faculty@demo.onyx', '/onyx/dashboard'],
  ['student@demo.onyx', '/onyx/dashboard'],
  ['exams@demo.onyx', '/onyx/dashboard'],
  ['placement@demo.onyx', '/onyx/dashboard'],
  // An employer and a guardian are outsiders with no course of their own, so
  // the dashboard redirects them to the one page each actually owns.
  ['employer@demo.onyx', '/onyx/jobs'],
  ['guardian@demo.onyx', '/onyx/family'],
];

test.describe('the fixed demo credentials handed to the user', () => {
  for (const [email, landing] of ACCOUNTS) {
    test(email + ' signs in through the real form', async ({ page }) => {
      await page.goto('/onyx/login');
      await page.getByLabel('Email address').fill(email);
      await page.getByLabel('Password').fill(PASSWORD);
      await page.getByRole('button', { name: /sign in/i }).click();

      await page.waitForURL('**' + landing, { timeout: 10_000 });
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      // The institution is named on every signed-in page, which is the thing
      // that proves the tenant claim survived the round trip.
      await expect(page.getByTestId('tenant-card').first()
        .getByText('Demo University')).toBeVisible();
    });
  }
});
