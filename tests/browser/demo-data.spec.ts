/**
 * The demo institution has a term behind it, not just accounts.
 *
 * demo-credentials.spec.ts proves the seven fixed accounts can sign in. That
 * passed for weeks while every screen behind those accounts was empty: ABC
 * Institution had memberships and nothing else -- no courses, no papers, no
 * exam calendar, no timetable, no register -- so a walkthrough opened on seven
 * zeroes and no test said a word. Signing in is not the same as having
 * something to sign in TO.
 *
 * So this reads the screens a demonstration actually visits and asserts each
 * one is populated. It deliberately asserts SHAPE, not exact numbers: the
 * seeder (tools/onyx/seed-abc.mjs) may grow a course or a paper without this
 * file having to be edited, but it may not silently stop producing any.
 *
 * Read-only from start to finish -- it signs in, looks, and leaves. Nothing
 * here writes, so it is safe to point at the deployed site:
 *
 *   E2E_WEB=https://onyx-lms-v2.vercel.app npx playwright test tests/browser/demo-data.spec.ts
 *
 * If it fails on a fresh database, the fix is to run the seeder, not to weaken
 * the assertion.
 */
import { test, expect, type Page } from '@playwright/test';

const PASSWORD = 'Demo#2026!';
const STUDENT = 'student@demo.onyx';
const FACULTY = 'faculty@demo.onyx';
const EXAMS = 'exams@demo.onyx';

async function signIn(page: Page, email: string) {
  await page.goto('/onyx/login');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: /sign in/i }).click();
  // Anywhere but the form. Waiting on /\/onyx\// instead matches
  // /onyx/login itself, so the wait resolves before the click has been through
  // the server and every later goto() bounces back to the form -- which reads
  // as "the screen is empty" rather than "we never signed in".
  await page.waitForURL((url) => !url.pathname.startsWith('/onyx/login'), { timeout: 15_000 });
}

/**
 * "This screen has rows on it."
 *
 * Counting links to a section's own detail pages rather than table rows: the
 * screens differ in whether they render a table, a list or a grid of cards, and
 * a link to /onyx/courses/<id> means the same thing on all three.
 */
async function detailLinks(page: Page, section: string) {
  return page.locator('a[href*="/onyx/' + section + '/"]').count();
}

test.describe('the demo institution has a term of data behind it', () => {
  test('a learner sees their courses, timetable, papers and results', async ({ page }) => {
    await signIn(page, STUDENT);

    await page.goto('/onyx/courses');
    expect(await detailLinks(page, 'courses')).toBeGreaterThan(0);
    // The draft course is enrolled but unpublished, and a learner must not see
    // it -- the one assertion here that is about a rule rather than a count.
    // ABC302, not ABC301: 301 is the LOCKED course now, which a learner is
    // meant to see (and to see a price on) before they buy it.
    await expect(page.getByText('Advanced Database Systems')).toHaveCount(0);

    await page.goto('/onyx/timetable');
    // Any weekday name only appears once a slot is placed on it.
    await expect(page.getByText(/Monday|Tuesday|Wednesday/).first()).toBeVisible();

    await page.goto('/onyx/assessments');
    await expect(page.getByText(/class test/i).first()).toBeVisible();

    await page.goto('/onyx/results');
    // Both halves of the record: papers marked by the course, and examination
    // marks released by the examinations office.
    await expect(page.getByText(/class test/i).first()).toBeVisible();
    // Not asserted by exam title, because the page cannot show one: marksFor()
    // selects the mark row alone, so a learner's official record names their
    // examinations "Exam #12". The grade band is what is actually on the page.
    await expect(page.getByRole('list', { name: /published exam marks/i })
      .getByText(/Grade (Pass|Fail)/).first()).toBeVisible();

    await page.goto('/onyx/practice');
    expect(await detailLinks(page, 'practice')).toBeGreaterThan(0);
  });

  test('a teacher sees a register with sessions already taken', async ({ page }) => {
    await signIn(page, FACULTY);

    await page.goto('/onyx/courses');
    const courses = page.locator('a[href*="/onyx/courses/"]');
    await expect(courses.first()).toBeVisible();

    // Into the first course, then its register. Attendance has no top-level nav
    // entry -- it belongs to a course, which is where a teacher reaches it.
    const href = await courses.first().getAttribute('href');
    await page.goto((href ?? '/onyx/courses').split('?')[0] + '/attendance');
    await expect(page.getByText(/Lecture ABC/).first()).toBeVisible();
  });

  test('the examinations office sees a calendar with marks published', async ({ page }) => {
    await signIn(page, EXAMS);
    await page.goto('/onyx/exams');
    await expect(page.getByText(/end-of-term/i).first()).toBeVisible();
    // Something ahead as well as something finished, so "upcoming" is real.
    await expect(page.getByText(/resit/i).first()).toBeVisible();
  });
});

test.describe('the storefront nav', () => {
  test('no longer advertises workshops, tutors, teams or the blog', async ({ page }) => {
    await page.goto('/');
    const nav = page.getByRole('navigation').first();
    for (const gone of ['Workshops', 'Tutors', 'Teams', 'Blog']) {
      await expect(nav.getByRole('link', { name: gone, exact: true })).toHaveCount(0);
    }
    for (const kept of ['Courses', 'Instructors', 'Help']) {
      await expect(nav.getByRole('link', { name: kept, exact: true })).toBeVisible();
    }
  });

  test('but those pages still answer for anyone holding a link', async ({ page }) => {
    // Removing them from the nav is an editorial decision about the front door.
    // It is not a deletion, and a bookmark or a search result must still work.
    for (const path of ['/bootcamps', '/tutors', '/team-packages', '/blogs']) {
      const res = await page.goto(path);
      expect(res?.status(), path + ' should still be reachable').toBe(200);
    }
  });
});
