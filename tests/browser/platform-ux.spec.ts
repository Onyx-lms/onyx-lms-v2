/**
 * The operator console reads as an enterprise product, not an internal tool.
 *
 * Each test here pins one thing that was wrong when the console was audited
 * screen by screen, and each is the kind of fault that only shows up when you
 * look at the rendered page rather than the code:
 *
 *   * Every section inside an institution used the institution's NAME as its
 *     h1, so Students, Fees and the grade book were all headed "ABC
 *     Institution" and nothing on screen said which one you had open.
 *   * The primary button carried `w-full` (it was written for the 216px
 *     sidebar), so "Add a course", "Add a fee head" and "Grant platform admin"
 *     each rendered as a 1,100px teal slab across the top of its page.
 *   * The console was the only surface in the product with no theme control.
 *   * The rosters had no search.
 *   * A completed examination sat 26 days ago was labelled "26 days late", in
 *     red, because the deadline formatter was used for a historical date.
 */
import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const PLATFORM = { email: 'superadmin@onyx.platform', password: 'Platform#2026!' };
const TENANT = 'ABC Institution';

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

test.describe('the operator console', () => {
  test.beforeEach(async ({ page }) => { await signIn(page); });

  /**
   * Driven by CLICKING the sidebar, not by `page.goto()`, and that is the
   * whole value of this test.
   *
   * The first version loaded each section by URL. Every load is a fresh
   * document, so the tenant layout re-ran and its section title was right --
   * and the test passed while the console was broken for anyone using it,
   * because a layout is NOT re-rendered on soft navigation between its sibling
   * pages. Clicking Students, then Faculty, then Fees left all three headed
   * "Overview". A console is used by clicking; the test has to click.
   */
  const SECTIONS: [string, string][] = [
    ['Students', '/students'], ['Faculty', '/faculty'], ['Other roles', '/staff'],
    ['Courses', '/courses'], ['Timetable', '/timetable'],
    ['Examinations', '/examinations'], ['Assessments', '/assessments'],
    ['Permissions', '/permissions'], ['Grades', '/grades'], ['Fees', '/fees'],
    ['Settings', '/settings'], ['Overview', ''],
  ];

  test('every section says which section it is, clicked through in one session',
    async ({ page }) => {
      test.setTimeout(180_000);
      const base = await openTenant(page);
      const nav = page.getByRole('navigation', { name: /institution sections/i });
      const crumbs = page.getByRole('navigation', { name: 'Breadcrumb' });

      for (const [label, seg] of SECTIONS) {
        await nav.getByRole('link', { name: label, exact: true }).click();
        await page.waitForURL(base + seg, { timeout: 15_000 });

        await expect(page.getByRole('heading', { level: 1 }), label).toHaveText(label);
        await expect(crumbs).toContainText('Institutions');
        await expect(crumbs).toContainText(TENANT);
        // The trail ends where you are, and the way out is a link.
        if (seg) {
          await expect(crumbs).toContainText(label);
          await expect(crumbs.getByRole('link', { name: TENANT })).toBeVisible();
        }
      }
    });

  test('a section reached directly by URL says the same thing', async ({ page }) => {
    test.setTimeout(150_000);
    const base = await openTenant(page);
    for (const [label, seg] of SECTIONS) {
      await page.goto(base + seg);
      await expect(page.getByRole('heading', { level: 1 }), label).toHaveText(label);
    }
  });

  test('no primary action spans the page', async ({ page }) => {
    const base = await openTenant(page);
    const pages = [base + '/courses', base + '/fees', base + '/examinations',
      '/onyx/platform/admins'];

    for (const path of pages) {
      await page.goto(path);
      const main = await page.locator('main').boundingBox();
      const buttons = page.locator('main button');
      for (let i = 0; i < await buttons.count(); i += 1) {
        const b = buttons.nth(i);
        if (!await b.isVisible()) continue;
        const box = await b.boundingBox();
        if (!box || !main) continue;
        // A control wider than half the content column is a banner, not a
        // button. The real offenders were at ~95%.
        expect(box.width, (await b.innerText()).trim() + ' on ' + path)
          .toBeLessThan(main.width * 0.5);
      }
    }
  });

  test('the console can be switched to dark and stays there', async ({ page }) => {
    await page.goto('/onyx/platform');
    const toggle = page.getByRole('button', { name: /theme|dark|light/i }).first();
    await expect(toggle).toBeVisible();
    await toggle.click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    // Follows you into an institution rather than resetting per route.
    await page.goto('/onyx/platform/tenants/1/students');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    // And the page is actually painted dark, not merely labelled.
    const bg = await page.locator('body').evaluate((el) => getComputedStyle(el).backgroundColor);
    const [r, g, b] = bg.match(/\d+/g)!.map(Number) as [number, number, number];
    expect(r + g + b).toBeLessThan(200);
  });

  test('a roster can be searched, and says what it is showing', async ({ page }) => {
    const base = await openTenant(page);
    await page.goto(base + '/students');
    const rowsBefore = await page.locator('table tbody tr').count();
    expect(rowsBefore).toBeGreaterThan(1);

    await page.getByLabel(/search this roster/i).fill('Aarav');
    await page.keyboard.press('Enter');
    await page.waitForURL(/q=Aarav/, { timeout: 15_000 });

    await expect(page.locator('table tbody tr')).toHaveCount(1);
    await expect(page.locator('table tbody')).toContainText('Aarav');
    // The count above the table follows the filter rather than the roll.
    await expect(page.locator('main')).toContainText('1 student at this institution');

    // A search that matches nobody says so in its own words.
    await page.goto(base + '/students?q=zzzznobody');
    await expect(page.locator('table tbody')).toContainText(/matches/i);
  });

  test('a finished examination is dated, not marked late', async ({ page }) => {
    const base = await openTenant(page);
    await page.goto(base + '/grades');

    const done = page.locator('table tbody tr').filter({ hasText: 'Completed' });
    expect(await done.count()).toBeGreaterThan(0);
    for (let i = 0; i < await done.count(); i += 1) {
      await expect(done.nth(i)).not.toContainText('late');
      await expect(done.nth(i)).toContainText(/ago|\d{1,2} \w{3}/);
    }
  });

  /**
   * The console was never in the accessibility suite, and it showed: the
   * sidebar's section headings were 10px #6e7d8f on the page ground (3.95:1),
   * and in dark mode the "Platform" badge was white on a near-white ink token
   * -- 1.17:1, an unreadable smear on the one chip that tells an operator
   * which console they are in. Both themes are checked, because a dark palette
   * is a second set of colours and passes nothing by inheritance.
   */
  for (const theme of ['light', 'dark'] as const) {
    test('every console screen passes wcag2a/wcag2aa in ' + theme, async ({ page }) => {
      test.setTimeout(150_000);
      await page.goto('/onyx/platform');
      if (theme === 'dark') {
        await page.getByRole('button', { name: /theme|dark|light/i }).first().click();
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
      }

      for (const path of ['/onyx/platform', '/onyx/platform/admins', '/onyx/platform/audit',
        '/onyx/platform/oauth-clients', '/onyx/platform/tenants/1',
        '/onyx/platform/tenants/1/students', '/onyx/platform/tenants/1/courses',
        '/onyx/platform/tenants/1/permissions', '/onyx/platform/tenants/1/fees',
        '/onyx/platform/tenants/1/settings']) {
        await page.goto(path, { waitUntil: 'networkidle' });
        const { violations } = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa']).analyze();
        expect(violations.map((v) => v.id + ' ×' + v.nodes.length), path).toEqual([]);
      }
    });
  }

  test('the audit log names what was acted on', async ({ page }) => {
    await page.goto('/onyx/platform/audit');
    const rows = page.locator('table tbody tr');
    expect(await rows.count()).toBeGreaterThan(0);
    // At least one row names a real institution rather than only a key.
    await expect(page.locator('table tbody')).toContainText(TENANT);
    // Nothing offers to open an institution that is gone.
    const deleted = page.locator('table tbody tr').filter({ hasText: 'deleted' });
    for (let i = 0; i < await deleted.count(); i += 1) {
      await expect(deleted.nth(i).getByRole('link', { name: 'Open' })).toHaveCount(0);
    }
  });
});
