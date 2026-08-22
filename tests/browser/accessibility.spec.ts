/**
 * WCAG 2.2 AA, checked two ways only a real browser can check it.
 *
 * tests/e2e/o06-accessibility.e2e.ts already asserts the structural things
 * that are either present in the markup or not (a skip link, a stylesheet
 * rule, a table header). This file adds what needs a rendered page and a real
 * DOM: an axe-core scan, which evaluates computed styles, the accessibility
 * tree and ARIA semantics rather than grepping HTML text; and a keyboard-only
 * pass through the skip link, checking where focus actually lands and that
 * the ring a keyboard user relies on is really painted, not just declared.
 */
import { test, expect } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import {
  RUN, mail, createTenant, adminToken, addMember, signInViaForm, cleanupTenants,
} from './helpers.ts';

const T = { name: 'Browser A11y Institute ' + RUN, slug: 'browser-a11y-' + RUN };
const adminEmail = mail('browser.a11y', 'admin');
const studentEmail = mail('browser.a11y', 'student');

const AA_TAGS = ['wcag2a', 'wcag2aa'];

/** Keeps a failure readable: which rule, on which element, not a wall of JSON. */
function explain(violations: { id: string; nodes: { target: string[] }[] }[]): string {
  return violations
    .map((v) => v.id + ': ' + v.nodes.map((n) => n.target.join(' ')).join(', '))
    .join('\n');
}

test.describe('accessibility', () => {
  test.beforeAll(async () => {
    await createTenant(T.name, T.slug, 'Admin', adminEmail);
    const token = await adminToken(adminEmail);
    await addMember(token, 'Student', studentEmail, 'student');
  });

  test.afterAll(async () => {
    await cleanupTenants([T.slug], 'browser.a11y.%.' + RUN + '@onyx.test');
  });

  test('the sign-in page has no wcag2a/wcag2aa violations', async ({ page }) => {
    await page.goto('/onyx/login');
    const results = await new AxeBuilder({ page }).withTags(AA_TAGS).analyze();
    expect(results.violations, explain(results.violations)).toEqual([]);
  });

  test('the dashboard has no wcag2a/wcag2aa violations', async ({ page }) => {
    await signInViaForm(page, studentEmail);
    const results = await new AxeBuilder({ page }).withTags(AA_TAGS).analyze();
    expect(results.violations, explain(results.violations)).toEqual([]);
  });

  test('the courses catalog has no wcag2a/wcag2aa violations', async ({ page }) => {
    await signInViaForm(page, studentEmail);
    await page.goto('/onyx/courses');
    const results = await new AxeBuilder({ page }).withTags(AA_TAGS).analyze();
    expect(results.violations, explain(results.violations)).toEqual([]);
  });

  test('Live Classes and a domain page have no wcag2a/wcag2aa violations', async ({ page }) => {
    await signInViaForm(page, studentEmail);
    await page.goto('/onyx/domains');
    const list = await new AxeBuilder({ page }).withTags(AA_TAGS).analyze();
    expect(list.violations, explain(list.violations)).toEqual([]);

    // The tile, if there is one -- the detail page carries an anchor that
    // opens in a new tab, and an unannounced new tab is a 3.2.5 failure.
    const tile = page.locator('a[href^="/onyx/domains/"]').first();
    if (await tile.count()) {
      await tile.click();
      await page.waitForURL((u) => /^\/onyx\/domains\/\d+/.test(u.pathname), { timeout: 20_000 });
      const detail = await new AxeBuilder({ page }).withTags(AA_TAGS).analyze();
      expect(detail.violations, explain(detail.violations)).toEqual([]);
    }
  });

  test('the resume, with its checkbox groups, has no wcag2a/wcag2aa violations', async ({ page }) => {
    // A page made almost entirely of form controls, which is where labelling
    // faults live -- every checkbox here is generated from somebody's own
    // record rather than written out by hand.
    await signInViaForm(page, studentEmail);
    await page.goto('/onyx/resume');
    const results = await new AxeBuilder({ page }).withTags(AA_TAGS).analyze();
    expect(results.violations, explain(results.violations)).toEqual([]);
  });

  test('the roster, with its data table and inline controls, has no violations', async ({ page }) => {
    await signInViaForm(page, adminEmail);
    await page.goto('/onyx/people');
    const results = await new AxeBuilder({ page }).withTags(AA_TAGS).analyze();
    expect(results.violations, explain(results.violations)).toEqual([]);
  });

  test('2.4.1 / 2.4.7 keyboard: Tab reaches the skip link first, and it really moves focus', async ({ page }) => {
    await page.goto('/onyx/login');

    // Nothing has been focused yet, so the very first Tab must land on the
    // skip link -- if the DOM ever grew something focusable before it, this
    // is the test that would catch it.
    await page.keyboard.press('Tab');
    const skipLink = page.locator(':focus');
    await expect(skipLink).toHaveClass(/skip-link/);
    await expect(skipLink).toHaveAttribute('href', '#main');

    // Tailwind's reset sets outline to a transparent solid line (present, but
    // invisible) and relies on a box-shadow ring instead -- so outline-style
    // alone would pass even if the ring never rendered. Check the thing that
    // is actually painted.
    const ring = await skipLink.evaluate((el) => getComputedStyle(el).boxShadow);
    expect(ring, 'the skip link has no visible focus ring').not.toBe('none');

    // Activating it (Enter, not a click -- this is the keyboard path) must
    // move focus to #main, not just scroll to it. <main> is not natively
    // focusable; without tabIndex={-1} in the root layout this assertion is
    // exactly what would catch that regression.
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#main$/);
    const activeId = await page.evaluate(() => document.activeElement?.id);
    expect(activeId).toBe('main');
  });
});
