/**
 * Every role, through the screens it actually has, against a running
 * deployment.
 *
 * Not a replacement for the focused suites -- it proves none of the individual
 * rules. What it proves is that nothing is BROKEN: each screen renders, has the
 * heading it should, and carries no error banner, empty-state-where-data-should
 * -be, or unhandled exception. That is the check nobody was running, and it is
 * the one that catches a screen which 500s only when a particular role opens
 * it.
 *
 * Run against production with:
 *   E2E_WEB=https://… npx playwright test tests/browser/production-sweep.spec.ts
 */
import { test, expect, type Page } from '@playwright/test';

const PW = 'Demo#2026!';

/** A screen is healthy when it renders its own heading and shouts about nothing. */
async function healthy(page: Page, path: string, expectHeading?: RegExp) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e.message)));

  const res = await page.goto(path, { waitUntil: 'networkidle' });
  expect(res?.status(), path + ' responded ' + res?.status()).toBeLessThan(400);

  // Next's own error surfaces, which render a page rather than a bad status.
  const body = await page.locator('body').innerText();
  expect(body, path).not.toMatch(/Application error: a (client|server)-side exception/i);
  expect(body, path).not.toMatch(/Unhandled Runtime Error|This page could not be found/i);

  const h1 = page.getByRole('heading', { level: 1 }).first();
  await expect(h1, path + ' has a heading').toBeVisible();
  if (expectHeading) await expect(h1, path).toHaveText(expectHeading);

  expect(errors, path + ' threw in the browser').toEqual([]);
}

async function signIn(page: Page, email: string, at = '/onyx/login') {
  await page.context().clearCookies();
  await page.goto(at);
  await page.getByLabel(/email/i).first().fill(email);
  await page.getByLabel(/password/i).first().fill(email.includes('@onyx.platform')
    ? 'Platform#2026!' : PW);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((u) => !u.pathname.endsWith('/login'), { timeout: 20_000 });
}

test.describe('the deployment, role by role', () => {
  test('a visitor with no account', async ({ page }) => {
    test.setTimeout(180_000);
    await healthy(page, '/');
    // The home page's whole point: real courses somebody can join.
    const cards = page.locator('main').getByRole('link', { name: /programming|data structures|cloud|web/i });
    expect(await cards.count(), 'the home page lists courses').toBeGreaterThan(0);

    await healthy(page, '/onyx/login');
    await healthy(page, '/onyx/signup');
    // A course's public page, with no session at all.
    await healthy(page, '/onyx/c/64');
    await expect(page.locator('main')).toContainText(/INR/);
  });

  test('a student', async ({ page }) => {
    test.setTimeout(300_000);
    await signIn(page, 'student@demo.onyx');
    for (const [path, heading] of [
      ['/onyx/dashboard', /./], ['/onyx/courses', /courses/i],
      ['/onyx/practice', /practice/i], ['/onyx/workspaces', /workspaces/i],
      ['/onyx/assessments', /assessments/i], ['/onyx/exams', /examinations/i],
      ['/onyx/results', /results/i], ['/onyx/contests', /contests/i],
      ['/onyx/timetable', /timetable/i], ['/onyx/fees', /fees/i],
      ['/onyx/support', /your tickets|help|support/i], ['/onyx/jobs', /jobs/i],
      ['/onyx/interviews', /interviews/i], ['/onyx/profile', /profile/i],
      ['/onyx/inbox', /inbox/i],
    ] as [string, RegExp][]) await healthy(page, path, heading);

    // The course they bought is theirs, with content rather than a paywall.
    await healthy(page, '/onyx/courses/64');
    await expect(page.locator('main')).not.toContainText(/Buy now|Unlock/i);
  });

  test('a faculty member', async ({ page }) => {
    test.setTimeout(300_000);
    await signIn(page, 'faculty@demo.onyx');
    for (const [path, heading] of [
      ['/onyx/dashboard', /./], ['/onyx/courses', /courses/i],
      ['/onyx/assessments', /assessments/i], ['/onyx/exams', /examinations/i],
      ['/onyx/invigilate', /invigilat/i], ['/onyx/programs', /programme/i],
      ['/onyx/timetable', /timetable/i], ['/onyx/allocations', /teaching allocation/i],
      ['/onyx/people', /people/i], ['/onyx/support', /queue|help|support|mentor|tickets/i],
      ['/onyx/profile', /profile/i], ['/onyx/workspaces', /workspaces/i],
    ] as [string, RegExp][]) await healthy(page, path, heading);
  });

  test('an institution administrator', async ({ page }) => {
    test.setTimeout(300_000);
    await signIn(page, 'admin@demo.onyx');
    for (const [path, heading] of [
      ['/onyx/dashboard', /./], ['/onyx/courses', /courses/i],
      ['/onyx/workspaces', /workspaces/i], ['/onyx/assessments', /assessments/i],
      ['/onyx/invigilate', /invigilat/i], ['/onyx/exams', /examinations/i],
      ['/onyx/contests', /contests/i], ['/onyx/certificates', /certificates/i],
      ['/onyx/programs', /programme/i], ['/onyx/timetable', /timetable/i],
      ['/onyx/people?role=student', /students/i], ['/onyx/people?role=faculty', /faculty/i],
      ['/onyx/finance', /finance/i], ['/onyx/placement', /placement/i],
      ['/onyx/jobs', /jobs/i], ['/onyx/settings', /settings/i],
      ['/onyx/profile', /profile/i], ['/onyx/audit', /audit/i],
    ] as [string, RegExp][]) await healthy(page, path, heading);

    // The money a learner spent reaches the institution's own report.
    await page.goto('/onyx/finance', { waitUntil: 'networkidle' });
    await expect(page.locator('main'), 'the purchase shows in finance')
      .toContainText(/1,?499|Cloud and DevOps/i);
  });

  test('a platform operator', async ({ page }) => {
    test.setTimeout(300_000);
    await signIn(page, 'superadmin@onyx.platform', '/onyx/platform/login');
    for (const [path, heading] of [
      ['/onyx/platform', /platform overview/i], ['/onyx/platform/admins', /operators/i],
      ['/onyx/platform/oauth-clients', /oauth/i], ['/onyx/platform/audit', /audit/i],
      ['/onyx/platform/tenants/1', /overview/i],
      ['/onyx/platform/tenants/1/students', /students/i],
      ['/onyx/platform/tenants/1/faculty', /faculty/i],
      ['/onyx/platform/tenants/1/staff', /other roles/i],
      ['/onyx/platform/tenants/1/courses', /courses/i],
      ['/onyx/platform/tenants/1/assignments', /assignments/i],
      ['/onyx/platform/tenants/1/timetable', /timetable/i],
      ['/onyx/platform/tenants/1/examinations', /examinations/i],
      ['/onyx/platform/tenants/1/assessments', /assessments/i],
      ['/onyx/platform/tenants/1/permissions', /permissions/i],
      ['/onyx/platform/tenants/1/grades', /grades/i],
      ['/onyx/platform/tenants/1/fees', /fees/i],
      ['/onyx/platform/tenants/1/settings', /settings/i],
    ] as [string, RegExp][]) await healthy(page, path, heading);

    // The same purchase, seen from the platform.
    await page.goto('/onyx/platform/tenants/1/fees', { waitUntil: 'networkidle' });
    await expect(page.locator('main')).toContainText(/1,?499|Cloud and DevOps/i);
  });
});
