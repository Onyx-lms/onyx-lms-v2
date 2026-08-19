/**
 * A table row is clickable across its whole width.
 *
 * Every table here puts the row's destination on a link in the first cell, so
 * that link was the only clickable pixel in the row: on a 1400px screen you
 * had to aim at the words while the rest of the row -- most of it -- did
 * nothing. `rows-linked` in globals.css stretches that one anchor over the row
 * instead.
 *
 * These tests exist because the pattern has two failure modes that both LOOK
 * fine in a screenshot:
 *
 *   * The overlay resolves against the anchor rather than the row, so the row
 *     gets the pointer cursor and stays unclickable. (This happened: giving
 *     every control in the row `position: relative` positioned the row link
 *     too, and `inset: 0` then measured the words.)
 *   * The overlay swallows the row's own controls -- Results, Remove, a
 *     roll-number field -- so the row opens when somebody meant to press a
 *     button.
 *
 * Clicks are sent as real mouse clicks at a cell's centre rather than
 * `locator.click()`, because Playwright refuses to click an element another
 * element covers -- which is the very thing being tested.
 */
import { test, expect, type Page } from '@playwright/test';

const ADMIN = { email: 'admin@demo.onyx', password: 'Demo#2026!' };
const PLATFORM = { email: 'superadmin@onyx.platform', password: 'Platform#2026!' };

async function signIn(page: Page, where: string, who: { email: string; password: string }) {
  await page.goto(where);
  await page.locator('#email').fill(who.email);
  await page.locator('#password').fill(who.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.endsWith('/login'), { timeout: 15_000 });
}

/** A click where a person would click, on whatever is topmost there. */
async function clickAt(page: Page, selector: string) {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error('nothing to click at ' + selector);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

test.describe('a table row opens from anywhere on it', () => {
  test('a cell with no link in it still opens the row', async ({ page }) => {
    await signIn(page, '/onyx/login', ADMIN);
    await page.goto('/onyx/assessments');

    // The course-code column: text, no link of its own.
    await clickAt(page, 'table tbody tr:first-child td:nth-child(2)');
    await expect(page).toHaveURL(/\/onyx\/assessments\/\d+/);
  });

  test("the row's own controls still win over the row", async ({ page }) => {
    await signIn(page, '/onyx/login', ADMIN);
    await page.goto('/onyx/assessments');

    const action = page.locator('table tbody tr:first-child td:last-child a').first();
    const href = await action.getAttribute('href');
    await clickAt(page, 'table tbody tr:first-child td:last-child a');
    await expect(page).toHaveURL(new RegExp(href!.replace(/[/]/g, '\\/') + '$'));
  });

  test('a field inside a row takes the caret rather than navigating', async ({ page }) => {
    await signIn(page, '/onyx/login', ADMIN);
    await page.goto('/onyx/people');

    const roll = page.locator('input[aria-label^="Roll number for"]').first();
    await roll.click();
    await expect(roll).toBeFocused();
    await expect(page).toHaveURL(/\/onyx\/people/);
  });

  test('the platform directory opens an institution from any cell', async ({ page }) => {
    await signIn(page, '/onyx/platform/login', PLATFORM);
    await page.goto('/onyx/platform');

    await clickAt(page, 'table tbody tr:first-child td:nth-child(3)');
    await expect(page).toHaveURL(/\/onyx\/platform\/tenants\/\d+/);
  });

  test('a table whose rows go nowhere is left alone', async ({ page }) => {
    await signIn(page, '/onyx/platform/login', PLATFORM);
    await page.goto('/onyx/platform/tenants/1/students');

    // The students table has no destination on its rows -- it carries Edit and
    // Remove instead -- so clicking a cell must do nothing at all.
    await clickAt(page, 'table tbody tr:first-child td:nth-child(2)');
    await expect(page).toHaveURL(/\/onyx\/platform\/tenants\/1\/students$/);
  });
});
