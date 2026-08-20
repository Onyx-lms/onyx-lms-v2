/**
 * Adding somebody happens where they are listed.
 *
 * Creating a member used to be one control asking one broad question: the
 * sidebar's "Create a profile", with a menu of eight kinds. But an operator
 * does not arrive at that question cold -- they arrive at it having opened the
 * Students tab and looked at a list of students. Being asked "which kind of
 * person?" at that point is being asked something already answered.
 *
 * So the roster tabs each carry their own add control, above the table,
 * labelled with what it adds. This file holds that shape in place on both
 * surfaces that list people -- the platform console's view of one institution,
 * and an institution administrator's own roster -- because the two drifting
 * apart is exactly how "add a student" ends up meaning something different
 * depending on who you signed in as.
 *
 * Read-only: it opens the panels and closes them again, and never submits, so
 * it leaves no stray accounts in the demo institution. The paths that actually
 * create somebody are covered by e2e-authoring, e2e-downstream and
 * e2e-ezil-uni, each against its own throwaway tenant.
 */
import { test, expect, type Page } from '@playwright/test';

const PLATFORM = { email: 'superadmin@onyx.platform', password: 'Platform#2026!' };
const ADMIN = { email: 'admin@demo.onyx', password: 'Demo#2026!' };
const TENANT = 'ABC Institution';

async function signIn(page: Page, where: string, who: { email: string; password: string }) {
  await page.goto(where);
  await page.getByLabel(/email/i).fill(who.email);
  await page.getByLabel(/password/i).fill(who.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.endsWith('/login'), { timeout: 15_000 });
}

/** The tab, reached the way an operator reaches it: by opening the institution. */
async function openTenantTab(page: Page, tab: string) {
  await page.goto('/onyx/platform');
  await page.getByRole('link', { name: TENANT, exact: true }).first().click();
  await page.getByRole('navigation', { name: /institution sections/i })
    .getByRole('link', { name: tab, exact: true }).click();
  await page.waitForURL(/\/onyx\/platform\/tenants\/\d+\//, { timeout: 15_000 });
}

test.describe('the platform console, inside one institution', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, '/onyx/platform/login', PLATFORM);
  });

  test('the Students tab offers to add a student, and does not ask which kind', async ({ page }) => {
    await openTenantTab(page, 'Students');

    const add = page.getByRole('button', { name: 'Add a student' });
    await expect(add).toBeVisible();
    await add.click();

    const modal = page.getByRole('dialog');
    // Titled by what it adds. It says "this institution" rather than naming
    // one: these tabs read a people payload that carries no tenant name, and
    // the name is already on the page header and the sidebar above it.
    await expect(modal).toContainText('Add a student');
    // The tab has already settled the role, so the picker is gone -- not
    // merely defaulted, which is a menu somebody can still knock off by
    // accident and create a guardian on the Students tab.
    await expect(modal.getByLabel('Profile type', { exact: true })).toHaveCount(0);
    await expect(modal.getByLabel('Name')).toBeVisible();

    await modal.getByRole('button', { name: 'Cancel' }).click();
    await expect(modal).toHaveCount(0);
  });

  test('the Faculty tab offers to add a faculty member', async ({ page }) => {
    await openTenantTab(page, 'Faculty');
    await expect(page.getByRole('button', { name: 'Add a faculty member' })).toBeVisible();
  });

  test('Other roles still asks which kind, because there it is a real question',
    async ({ page }) => {
      await openTenantTab(page, 'Other roles');
      await page.getByRole('button', { name: 'Add someone' }).click();
      await expect(page.getByRole('dialog').getByLabel('Profile type')).toBeVisible();
    });
});

test.describe("an institution administrator's own roster", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, '/onyx/login', ADMIN);
  });

  test('the Students roster offers to add a student, with no role to choose', async ({ page }) => {
    await page.goto('/onyx/people?role=student');

    const add = page.getByRole('button', { name: 'Add a student' });
    await expect(add).toBeVisible();
    await add.click();

    await expect(page.getByLabel('Role', { exact: true })).toHaveCount(0);
    // Focus lands in the panel, so a keyboard user can type immediately
    // instead of tabbing back through the toolbar that opened it.
    await expect(page.getByLabel('Full name')).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(page.getByLabel('Full name')).toHaveCount(0);
  });

  test('the Faculty roster offers to add a faculty member', async ({ page }) => {
    await page.goto('/onyx/people?role=faculty');
    await expect(page.getByRole('button', { name: 'Add a faculty member' })).toBeVisible();
  });

  test('the unfiltered roster asks which role, and leads with the roster', async ({ page }) => {
    await page.goto('/onyx/people');

    // The table is what the page opens on: the form is behind the button, not
    // six empty boxes above the thing everybody came to read.
    await expect(page.getByLabel('Full name')).toHaveCount(0);
    await expect(page.getByRole('table')).toBeVisible();

    await page.getByRole('button', { name: 'Add someone' }).click();
    await expect(page.getByLabel('Role', { exact: true })).toBeVisible();
  });

  /**
   * "Create a profile" used to be a full-width blue button in the sidebar,
   * above Dashboard, on every screen an administrator opened -- the loudest
   * control in the nav, for an act that belongs to one page, and a second
   * create-a-person code path that asked for less than the roster's own
   * (no roll number). Adding somebody is not a destination.
   */
  test('adding a person is not in the navigation, on any width', async ({ page }) => {
    for (const size of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(size);
      await page.goto('/onyx/dashboard');
      if (size.width < 1024) {
        await page.getByRole('button', { name: /open navigation/i }).click();
      }
      await expect(page.getByRole('button', { name: /create a profile/i })).toHaveCount(0);
    }
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  test('the add control is a modal over the roster, not a form pushing it down',
    async ({ page }) => {
      await page.goto('/onyx/people?role=student');
      const tableBefore = await page.getByRole('table').boundingBox();

      await page.getByRole('button', { name: 'Add a student' }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText('Add a student');
      // Every field is named, and the roster has not moved underneath it.
      for (const label of ['Full name', 'Email address', 'Roll number or staff ID',
        'Temporary password']) {
        await expect(dialog.getByLabel(label)).toBeVisible();
      }
      expect((await page.getByRole('table').boundingBox())?.y).toBe(tableBefore?.y);
    });

  test('faculty are offered no add control at all', async ({ page }) => {
    await page.context().clearCookies();
    await signIn(page, '/onyx/login', { email: 'faculty@demo.onyx', password: ADMIN.password });
    await page.goto('/onyx/people?role=student');
    await expect(page.getByRole('table')).toBeVisible();
    await expect(page.getByRole('button', { name: /^Add/ })).toHaveCount(0);
  });
});
