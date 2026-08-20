/**
 * Dark mode, on every screen, without a `dark:` class anywhere in the product.
 *
 * The palette already resolved through CSS variables (that is how the
 * administrator's skin works), so dark is a second set of the same variables
 * plus a mapping for the literal classes -- `bg-white`, `text-slate-700` --
 * that a variable cannot reach. Nothing about the markup changed, which is why
 * this file checks COMPUTED colour rather than class names: a screen can carry
 * every right class and still be unreadable.
 *
 * The two failures worth guarding are both ones this shipped with at first: a
 * white flash before hydration, and the administrator's skin winning the
 * colour war on a dark page so the console rendered cream cards with light
 * text on them.
 */
import { test, expect, type Page } from '@playwright/test';

const PW = 'Demo#2026!';

/** Perceived luminance, 0 (black) to 1 (white). */
function luminance(rgb: string): number {
  const [r, g, b] = (rgb.match(/\d+/g) ?? ['255', '255', '255']).map(Number) as number[];
  return (0.2126 * r! + 0.7152 * g! + 0.0722 * b!) / 255;
}

async function paint(page: Page, selector: string) {
  return page.locator(selector).first().evaluate((el) => {
    const s = getComputedStyle(el);
    return { bg: s.backgroundColor, fg: s.color };
  });
}

async function signIn(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto('/onyx/login');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(PW);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.endsWith('/login'), { timeout: 15_000 });
}

test.describe('a visitor whose system is dark', () => {
  test.use({ colorScheme: 'dark' });

  test('gets a dark page with no flash and no white cards', async ({ page }) => {
    await page.goto('/');

    // Stamped before paint by the inline script, not after hydration.
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    const body = await paint(page, 'body');
    expect(luminance(body.bg)).toBeLessThan(0.2);
    expect(luminance(body.fg)).toBeGreaterThan(0.7);
  });

  test('reads every role\'s dashboard, including the skinned console',
    async ({ page }) => {
      for (const who of ['student@demo.onyx', 'faculty@demo.onyx', 'admin@demo.onyx']) {
        await signIn(page, who);

        const card = await paint(page, '.shadow-card');
        // A card sits on the canvas, not against it: dark surface, light ink.
        // The administrator's console is the one that got this wrong -- its own
        // skin kept the daytime cream while the text went light.
        expect(luminance(card.bg), who + ' card background').toBeLessThan(0.25);
        expect(luminance(card.fg), who + ' card text').toBeGreaterThan(0.6);
      }
    });

  test('keeps a public page dark for somebody with no account', async ({ page }) => {
    await page.context().clearCookies();
    const res = await page.request.get('/api/onyx/catalogue');
    const courses = (await res.json()).data as { id: number }[];
    test.skip(!courses.length, 'no public course');

    await page.goto('/onyx/c/' + courses[0]!.id);
    const body = await paint(page, 'body');
    expect(luminance(body.bg)).toBeLessThan(0.2);
  });
});

test('the toggle switches, persists and survives a reload', async ({ page }) => {
  await signIn(page, 'student@demo.onyx');

  const before = await page.locator('html').getAttribute('data-theme');
  await page.getByRole('button', { name: /Switch to (dark|light) theme/ }).click();
  const after = await page.locator('html').getAttribute('data-theme');
  expect(after).not.toBe(before);

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', after!);

  // Put it back, so the next test starts where it expects to.
  await page.getByRole('button', { name: /Switch to (dark|light) theme/ }).click();
});

test('a light visitor is unaffected', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  const body = await paint(page, 'body');
  expect(luminance(body.bg)).toBeGreaterThan(0.9);
});
