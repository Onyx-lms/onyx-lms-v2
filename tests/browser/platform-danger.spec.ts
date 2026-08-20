/**
 * The platform console keeps its dangerous actions in one place each.
 *
 * The console used to put a red control on every list row and, worse, render
 * an institution's "Danger zone" from the tenant LAYOUT -- so "Delete
 * institution" appeared underneath the fee ledger, the timetable, the grade
 * book and six other tabs an operator opens for reasons that have nothing to
 * do with ending a customer. Deleting a course, removing a member and revoking
 * an operator were all one click from a table of near-identical rows.
 *
 * The rule this file holds:
 *
 *   1. No list row carries a destructive control.
 *   2. Each destructive action still exists, once, inside the record it acts
 *      on -- so it is unreachable without first naming the thing.
 *   3. The institution's own suspend and delete live only on `settings/`.
 *
 * Read-only throughout: it opens panels and closes them, and never confirms.
 * Nothing here submits, so no institution, member, course or operator is
 * touched by running it.
 */
import { test, expect, type Page } from '@playwright/test';

const PLATFORM = { email: 'superadmin@onyx.platform', password: 'Platform#2026!' };
const TENANT = 'ABC Institution';

/** Words that only ever appear on a control that destroys something. */
const DESTRUCTIVE = /^(delete|remove|revoke|suspend)\b/i;

async function signIn(page: Page) {
  await page.goto('/onyx/platform/login');
  await page.getByLabel(/email/i).fill(PLATFORM.email);
  await page.getByLabel(/password/i).fill(PLATFORM.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.endsWith('/login'), { timeout: 15_000 });
}

async function openTenant(page: Page): Promise<string> {
  await page.goto('/onyx/platform');
  await page.getByRole('link', { name: TENANT, exact: true }).first().click();
  await page.waitForURL(/\/onyx\/platform\/tenants\/\d+/, { timeout: 15_000 });
  return new URL(page.url()).pathname.replace(/\/$/, '');
}

/** Every button and link on the page whose label reads as destruction. */
async function destructiveControls(page: Page): Promise<string[]> {
  const labels = await page.locator('main button, main a').allInnerTexts();
  return labels.map((t) => t.trim()).filter((t) => DESTRUCTIVE.test(t));
}

test.describe('the platform console', () => {
  test.beforeEach(async ({ page }) => { await signIn(page); });

  test('no institution tab carries a destructive control', async ({ page }) => {
    // Eleven full page loads. Against a local build that is comfortably inside
    // the default 30s; against a preview deployment, where several of these
    // are the first request to a cold function, it is not.
    test.setTimeout(150_000);
    const base = await openTenant(page);
    const tabs = ['', '/students', '/faculty', '/staff', '/courses', '/timetable',
      '/examinations', '/assessments', '/permissions', '/grades', '/fees'];

    for (const tab of tabs) {
      await page.goto(base + tab);
      await expect(page.getByRole('navigation', { name: /institution sections/i }))
        .toBeVisible();
      expect(await destructiveControls(page), 'on ' + (tab || '/overview')).toEqual([]);
    }
  });

  test('suspend and delete live on Settings, and only there', async ({ page }) => {
    const base = await openTenant(page);

    // Reached as an operator reaches it: the link on the identity card.
    await page.getByRole('link', { name: /^settings$/i }).first().click();
    await page.waitForURL(/\/settings$/, { timeout: 15_000 });

    await expect(page.getByRole('button', { name: /^suspend$/i })).toBeVisible();

    // Delete asks for the institution's name before it will fire.
    await page.getByRole('button', { name: /delete institution/i }).click();
    const confirm = page.getByLabel(/type .* to confirm/i);
    await expect(confirm).toBeVisible();
    const armed = page.getByRole('button', { name: /^delete institution$/i }).last();
    await expect(armed).toBeDisabled();
    await confirm.fill(TENANT);
    await expect(armed).toBeEnabled();
    // Deliberately not clicked -- cancel out and leave the customer alone.
    await page.getByRole('button', { name: /^cancel$/i }).click();

    expect(base).toBeTruthy();
  });

  test('removing a member is inside that member, not beside every row', async ({ page }) => {
    const base = await openTenant(page);
    await page.goto(base + '/students');

    await page.getByRole('button', { name: /^edit$/i }).first().click();
    const modal = page.getByRole('dialog');
    await expect(modal.getByRole('button', { name: /remove member/i })).toBeVisible();
    // The reversible alternative is offered in the same panel, above it.
    await expect(modal).toContainText(/suspended/i);
  });

  test('deleting a course is inside that course, behind its code', async ({ page }) => {
    const base = await openTenant(page);
    await page.goto(base + '/courses');

    await page.getByRole('button', { name: /^edit$/i }).first().click();
    const modal = page.getByRole('dialog');
    const open = modal.getByRole('button', { name: /delete course/i });
    await expect(open).toBeVisible();
    await open.click();
    await expect(modal.getByLabel(/type .* to confirm/i)).toBeVisible();
    await expect(modal.getByRole('button', { name: /^delete course$/i }).last()).toBeDisabled();
  });

  test('operators and OAuth clients are managed, not revoked from the list', async ({ page }) => {
    await page.goto('/onyx/platform/admins');
    expect(await destructiveControls(page)).toEqual([]);
    const manage = page.getByRole('button', { name: /^manage$/i });
    if (await manage.count()) {
      await manage.first().click();
      await expect(page.getByRole('dialog').getByRole('button', { name: /revoke access/i }))
        .toBeVisible();
      await page.getByRole('dialog').getByRole('button', { name: /close/i }).first().click();
    }

    await page.goto('/onyx/platform/oauth-clients');
    expect(await destructiveControls(page)).toEqual([]);
  });

  test('the sidebar groups what the console administers', async ({ page }) => {
    await page.goto('/onyx/platform');
    const nav = page.getByRole('navigation', { name: 'Platform' });
    await expect(nav).toContainText('Customers');
    await expect(nav).toContainText('Platform');
    for (const link of ['Institutions', 'Operators', 'OAuth clients', 'Audit log']) {
      await expect(nav.getByRole('link', { name: link, exact: true })).toBeVisible();
    }
  });
});
