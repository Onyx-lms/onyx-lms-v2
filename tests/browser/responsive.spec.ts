import { test, expect, type Page } from '@playwright/test';
import {
  RUN, mail, createTenant, adminToken, addMember, signInViaForm, cleanupTenants,
} from './helpers.ts';

const T = { name: 'Browser Responsive Institute ' + RUN, slug: 'browser-resp-' + RUN };
const adminEmail = mail('browser.resp', 'admin');
const studentEmail = mail('browser.resp', 'student');

test.beforeAll(async () => {
  await createTenant(T.name, T.slug, 'Admin', adminEmail);
  const token = await adminToken(adminEmail);
  await addMember(token, 'Student', studentEmail, 'student');
});

test.afterAll(async () => {
  await cleanupTenants([T.slug], 'browser.resp.%.' + RUN + '@onyx.test');
});

/**
 * Does this work on a phone?
 *
 * Not "does it render" — a page that renders and scrolls sideways is a page
 * somebody cannot use one-handed on a bus. The check that catches almost every
 * real fault is one line: **the document must never be wider than the
 * viewport.** A table that overflows, an unbroken email address, a fixed-width
 * card, a grid that does not stack — all of them show up as horizontal scroll
 * on the body, and all of them make every other element on the page drift
 * under the thumb.
 *
 * Wide content is allowed to scroll — a register with nine columns has to —
 * but it must scroll INSIDE its own container. That is why the assertion is on
 * `document.documentElement`, not on "is anything wide".
 *
 * Three sizes, chosen for what they represent rather than for any one device:
 * a small phone (360), a large phone (414), and a tablet in portrait (768),
 * which is the width where a two-column layout has to decide what it is.
 */

const SIZES = [
  { name: 'small phone', width: 360, height: 740 },
  { name: 'large phone', width: 414, height: 896 },
  { name: 'tablet', width: 768, height: 1024 },
];

/** How far the page can be scrolled sideways. Anything but zero is a fault. */
async function overflow(page: Page): Promise<number> {
  return await page.evaluate(() => {
    const doc = document.documentElement;
    return Math.max(0, doc.scrollWidth - doc.clientWidth);
  });
}

/** Anything sticking out past the right edge, named so a failure is actionable. */
async function offenders(page: Page): Promise<string[]> {
  return await page.evaluate(() => {
    const limit = document.documentElement.clientWidth;
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      const box = el.getBoundingClientRect();
      if (box.width === 0 || box.right <= limit + 1) continue;
      /*
       * The DEEPEST offender, not the outermost.
       *
       * An earlier version skipped anything whose parent also overflowed,
       * meaning to report the container rather than four hundred of its cells
       * -- but when `body` itself is the thing that overflows, every element
       * on the page has an overflowing parent and the report comes back empty.
       * A failure that names nothing is a failure nobody can act on, so this
       * reports elements with no overflowing CHILD: the actual widest thing.
       */
      const child = Array.from(el.children)
        .some((kid) => kid.getBoundingClientRect().right > limit + 1);
      if (child) continue;
      const tag = el.tagName.toLowerCase();
      const cls = String((el as HTMLElement).className ?? '').slice(0, 60);
      out.push(tag + (cls ? '.' + cls.trim().split(/\s+/).slice(0, 3).join('.') : '')
        + ' → ' + Math.round(box.right - limit) + 'px past');
      if (out.length >= 5) break;
    }
    return out;
  });
}

const AS_STUDENT = ['/onyx/dashboard', '/onyx/courses', '/onyx/exams', '/onyx/assessments',
  '/onyx/timetable', '/onyx/results', '/onyx/practice', '/onyx/profile'];
const AS_STAFF = ['/onyx/dashboard', '/onyx/people', '/onyx/people?role=student',
  '/onyx/courses', '/onyx/exams', '/onyx/assessments', '/onyx/invigilate'];

for (const size of SIZES) {
  test.describe(size.name + ' (' + size.width + 'px)', () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    test('a learner’s screens fit the width', async ({ page }) => {
      await signInViaForm(page, studentEmail);
      for (const path of AS_STUDENT) {
        await page.goto(path);
        await page.waitForLoadState('domcontentloaded');
        const over = await overflow(page);
        expect(over, path + ' scrolls sideways by ' + over + 'px: '
          + (await offenders(page)).join('; ')).toBeLessThanOrEqual(1);
      }
    });

    test('a lecturer’s screens fit the width', async ({ page }) => {
      await signInViaForm(page, adminEmail);
      for (const path of AS_STAFF) {
        await page.goto(path);
        await page.waitForLoadState('domcontentloaded');
        const over = await overflow(page);
        expect(over, path + ' scrolls sideways by ' + over + 'px: '
          + (await offenders(page)).join('; ')).toBeLessThanOrEqual(1);
      }
    });

    test('the navigation is reachable without a mouse or a wide screen', async ({ page }) => {
      await signInViaForm(page, studentEmail);
      await page.goto('/onyx/dashboard');
      /*
       * The sidebar appears at `lg`, which is 1024 -- so a tablet in portrait
       * gets the drawer, same as a phone. An earlier version of this test
       * assumed 768 and failed on a breakpoint that is a deliberate choice:
       * 768px of width is not enough for a rail AND a readable table beside
       * it.
       */
      if (size.width < 1024) {
        /*
         * On a phone the sidebar is a drawer, and the only way in is the
         * button. A drawer with no opener is a product with no navigation --
         * which is the single worst thing that can go wrong at this width, and
         * the one least likely to be noticed on a laptop.
         */
        const opener = page.getByRole('button', { name: /menu|navigation/i });
        await expect(opener.first()).toBeVisible();
        await opener.first().click();
        await expect(page.getByRole('navigation', { name: /all sections/i })).toBeVisible();
      } else {
        await expect(page.getByRole('navigation', { name: /main/i })).toBeVisible();
      }
    });
  });
}

test.describe('a wide table on a narrow screen', () => {
  test.use({ viewport: { width: 360, height: 740 } });

  test('scrolls inside itself rather than taking the page with it', async ({ page }) => {
    /*
     * The rule that makes nine-column registers possible at all.
     *
     * A table wider than a phone is fine; a PAGE wider than a phone is not.
     * What separates them is a scroll container, and this asserts the
     * container exists and does the scrolling -- so the header, the nav and
     * every button stay where the thumb expects them.
     */
    await signInViaForm(page, adminEmail);
    await page.goto('/onyx/people');
    await page.waitForLoadState('domcontentloaded');

    expect(await overflow(page)).toBeLessThanOrEqual(1);

    const scrollers = await page.evaluate(() => Array.from(
      document.querySelectorAll('[class*="overflow-x"], [tabindex="0"][role="region"]'))
      .filter((el) => el.scrollWidth > el.clientWidth).length);
    // Either the table fits, or something around it scrolls. What must not
    // happen is the table being wide and nothing containing it.
    const tableWide = await page.evaluate(() => {
      const table = document.querySelector('table');
      return table ? table.scrollWidth > document.documentElement.clientWidth : false;
    });
    if (tableWide) expect(scrollers).toBeGreaterThan(0);
  });
});
