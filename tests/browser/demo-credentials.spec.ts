/**
 * Sanity check for the persistent demo institution ("ABC Institution", slug
 * `abc-institution`) handed to the user as fixed, reusable credentials -- as
 * opposed to every other file in this suite, which seeds a fresh run-unique
 * tenant per file. This one exists purely to prove those exact emails and
 * that exact password still work, end to end, through the real form.
 *
 * It has twice been left naming a tenant that no longer existed -- first "EZiL
 * Demo Institute" (`ezil-demo`), then "Demo University" (`demo-university`),
 * which never existed in this project at all: every one of these seven tests
 * signed in successfully and then failed on the institution's name. The lesson
 * is the same both times, so the name now comes from one constant below and
 * the seeder that creates the tenant is what it has to agree with.
 */
import { test, expect } from '@playwright/test';

const PASSWORD = 'Demo#2026!';

/**
 * The institution those accounts belong to, named exactly as
 * tools/onyx/seed-demo.mjs creates it -- that script is what makes this tenant
 * exist, so it is the source of truth for its name, not this file.
 */
const TENANT = 'ABC Institution';

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
        .getByText(TENANT)).toBeVisible();
    });
  }
});
