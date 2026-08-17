/**
 * Responsive and alignment tests for the student dashboard.
 *
 * These assert the things a screenshot review keeps missing and a human
 * reviewer keeps having to re-check by hand: that nothing overflows
 * sideways at any width, that the layout actually changes shape at the
 * breakpoints it claims to, that a phone user is not made to scroll past
 * navigation to reach their own work, and that cards on a row line up.
 *
 * Currently pointed at the design prototype. When the design lands in the
 * real dashboard, change TARGET to the running route -- every assertion
 * below is written against roles and classes that survive that move.
 */
import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const TARGET = 'file:///' + path
  .join(ROOT, 'design', 'student-dashboard.html')
  .replace(/\\/g, '/');

/** The widths that actually matter: small phone, large phone, tablet, laptop, desktop. */
const WIDTHS = [320, 390, 768, 1024, 1280, 1440] as const;

async function open(page: Page, width: number, height = 900) {
  await page.setViewportSize({ width, height });
  await page.goto(TARGET);
  await page.waitForLoadState('domcontentloaded');
}

test.describe('responsiveness', () => {
  for (const width of WIDTHS) {
    test(`no horizontal overflow at ${width}px`, async ({ page }) => {
      await open(page, width);
      // The page may scroll down. It must never scroll sideways -- that is
      // the single most common responsive defect and the most obvious one
      // to a person holding a phone.
      const overflow = await page.evaluate(() =>
        document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${width}px scrolls sideways by ${overflow}px`).toBeLessThanOrEqual(0);
    });

    test(`no element escapes the viewport at ${width}px`, async ({ page }) => {
      await open(page, width);
      // Catches the case where the document does not scroll but a single
      // card still pokes out past the right edge and gets clipped.
      const strays = await page.evaluate((w) => {
        const out: string[] = [];
        for (const el of Array.from(document.body.querySelectorAll<HTMLElement>('*'))) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 && r.height === 0) continue;
          if (r.right > w + 1) {
            out.push((el.className || el.tagName) + ' right=' + Math.round(r.right));
          }
        }
        return out.slice(0, 5);
      }, width);
      expect(strays, 'elements past the right edge: ' + strays.join(', ')).toEqual([]);
    });
  }

  test('the sidebar is hidden on a phone and shown on a laptop', async ({ page }) => {
    await open(page, 390);
    await expect(page.locator('.sidenav')).toBeHidden();
    await expect(page.locator('.tabbar')).toBeVisible();

    await open(page, 1280);
    await expect(page.locator('.sidenav')).toBeVisible();
    // Both at once would mean two competing navigations on screen.
    await expect(page.locator('.tabbar')).toBeHidden();
  });

  test('the rail sits beside the main column on a wide screen, and below it on a narrow one', async ({ page }) => {
    await open(page, 1440);
    const wide = await page.evaluate(() => {
      const cols = document.querySelector('.cols')!.children;
      return {
        main: cols[0]!.getBoundingClientRect(),
        rail: cols[1]!.getBoundingClientRect(),
      };
    });
    expect(wide.rail.left, 'the rail should start to the right of the main column')
      .toBeGreaterThan(wide.main.right - 1);

    await open(page, 768);
    const narrow = await page.evaluate(() => {
      const cols = document.querySelector('.cols')!.children;
      return {
        main: cols[0]!.getBoundingClientRect(),
        rail: cols[1]!.getBoundingClientRect(),
      };
    });
    expect(narrow.rail.top, 'the rail should stack under the main column')
      .toBeGreaterThan(narrow.main.top);
  });
});

test.describe('a phone reaches the work immediately', () => {
  test('the resume action is on the first screen, above the fold', async ({ page }) => {
    await open(page, 390, 844);
    const y = await page.evaluate(() => {
      const el = document.querySelector('.resume')!;
      return Math.round(el.getBoundingClientRect().top + window.scrollY);
    });
    // The measured defect this redesign exists to fix: the old dashboard put
    // 13 nav links and 906px of chrome ahead of the first piece of a
    // student's own work, on an 844px-tall screen.
    expect(y, `the resume card starts ${y}px down`).toBeLessThan(400);
  });

  test('navigation does not push content down the page', async ({ page }) => {
    await open(page, 390, 844);
    const navAbove = await page.evaluate(() => {
      const main = document.querySelector('#main')!.getBoundingClientRect().top + window.scrollY;
      return Array.from(document.querySelectorAll('nav a'))
        .filter((a) => {
          const r = a.getBoundingClientRect();
          // A display:none element reports a 0x0 rect at the origin, which
          // would otherwise count as "above the content" and fail this for
          // the hidden desktop sidebar rather than for a real defect.
          if (r.width === 0 && r.height === 0) return false;
          return r.top + window.scrollY < main;
        }).length;
    });
    expect(navAbove, 'nav links stacked above the content').toBe(0);
  });
});

test.describe('alignment', () => {
  test('cards on the same row share a top edge and a height', async ({ page }) => {
    await open(page, 1440);
    for (const sel of ['.stats', '.courses']) {
      const rows = await page.evaluate((s) => {
        const kids = Array.from(document.querySelectorAll<HTMLElement>(s + ' > *'));
        return kids.map((k) => {
          const r = k.getBoundingClientRect();
          return { top: Math.round(r.top), h: Math.round(r.height) };
        });
      }, sel);
      // Group by row, then assert every card in a row agrees.
      const byRow = new Map<number, { top: number; h: number }[]>();
      for (const r of rows) {
        const key = [...byRow.keys()].find((k) => Math.abs(k - r.top) < 4) ?? r.top;
        byRow.set(key, [...(byRow.get(key) ?? []), r]);
      }
      for (const [top, group] of byRow) {
        const heights = new Set(group.map((g) => g.h));
        expect(heights.size, `${sel} row at y=${top} has ragged heights: ` +
          [...heights].join(', ')).toBe(1);
      }
    }
  });

  test('every interactive target meets the WCAG 2.2 AA minimum', async ({ page }) => {
    await open(page, 390, 844);
    // 24x24 CSS px is the actual AA requirement (2.5.8 Target Size Minimum).
    // 44px is the AAA/iOS figure and is applied to the primary header
    // controls by hand -- but the number this test fails on is the standard
    // we committed to, not a stricter one invented here.
    const small = await page.evaluate(() => {
      const out: string[] = [];
      for (const el of Array.from(document.querySelectorAll<HTMLElement>('a, button'))) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if (r.height < 24 || r.width < 24) {
          out.push((el.className || el.tagName)
            + ` ${Math.round(r.width)}x${Math.round(r.height)}`);
        }
      }
      return out;
    });
    expect(small, 'targets under 24x24: ' + small.join(', ')).toEqual([]);
  });

  test('the primary header controls are a comfortable 44px on a phone', async ({ page }) => {
    await open(page, 390, 844);
    for (const sel of ['.menu-btn', '.streak-pill', '.icon-btn:not(.menu-btn)']) {
      const box = await page.locator(sel).first().boundingBox();
      expect(Math.round(box!.height), `${sel} is ${box!.height}px tall`)
        .toBeGreaterThanOrEqual(44);
    }
  });
});

test.describe('accessibility basics that regress silently', () => {
  test('there is exactly one h1, and headings do not skip a level', async ({ page }) => {
    await open(page, 1280);
    const levels = await page.evaluate(() =>
      Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6'))
        .map((h) => Number(h.tagName[1])));
    expect(levels.filter((l) => l === 1).length, 'there should be exactly one h1').toBe(1);
    for (let i = 1; i < levels.length; i += 1) {
      expect(levels[i]! - levels[i - 1]!,
        `heading jumped from h${levels[i - 1]} to h${levels[i]}`).toBeLessThanOrEqual(1);
    }
  });

  test('the skip link is the first thing a keyboard reaches, and it targets #main', async ({ page }) => {
    await open(page, 1280);
    await page.keyboard.press('Tab');
    const focused = page.locator(':focus');
    await expect(focused).toHaveClass(/skip-link/);
    await expect(focused).toHaveAttribute('href', '#main');
  });

  test('every progress indicator reports its value to a screen reader', async ({ page }) => {
    await open(page, 1280);
    const bars = page.locator('[role="progressbar"]');
    const n = await bars.count();
    expect(n).toBeGreaterThan(0);
    for (let i = 0; i < n; i += 1) {
      await expect(bars.nth(i)).toHaveAttribute('aria-valuenow', /\d+/);
      await expect(bars.nth(i)).toHaveAttribute('aria-label', /.+/);
    }
  });
});
