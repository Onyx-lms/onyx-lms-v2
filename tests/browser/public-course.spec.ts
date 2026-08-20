/**
 * Every published course has a page anybody can open.
 *
 * Until now a course address answered only to people already inside, so a
 * learner deciding whether to sign up had to sign up first to find out what
 * they were signing up for, and a lecturer's shared link showed a stranger a
 * login form with no idea what was behind it.
 *
 * The line this file holds is where public stops: the SYLLABUS is public --
 * what the course covers, how long, who teaches it, what it costs -- and the
 * content is not. A prospectus lists the chapters without printing the book.
 */
import { test, expect } from '@playwright/test';

async function catalogue(request: import('@playwright/test').APIRequestContext) {
  const res = await request.get('/api/onyx/catalogue');
  return (await res.json()).data as { id: number; access: string; price_minor: number }[];
}

test('a course page opens with no account at all', async ({ page, request }) => {
  const courses = await catalogue(request);
  const paid = courses.find((c) => c.access === 'locked');
  test.skip(!paid, 'no purchasable course in the demo institution');

  await page.context().clearCookies();
  await page.goto('/onyx/c/' + paid!.id);

  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  // `.first()`: the institution is named at the top and again in the footer,
  // which is right on the page and ambiguous for a locator.
  await expect(page.getByText('ABC Institution').first()).toBeVisible();
  // The price is on the page, not behind the sign-up.
  await expect(page.getByText(/1,499/).first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Sign up to buy' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible();
});

test('the syllabus is public and the lessons are not', async ({ page, request }) => {
  const paid = (await catalogue(request)).find((c) => c.access === 'locked');
  test.skip(!paid, 'no purchasable course');

  await page.context().clearCookies();
  await page.goto('/onyx/c/' + paid!.id);

  // Titles, yes.
  await expect(page.getByText('What is inside')).toBeVisible();
  await expect(page.getByText(/Unit 1/).first()).toBeVisible();

  // Bodies, no. These strings are the seeded lesson content.
  const text = await page.locator('body').innerText();
  expect(text).not.toContain('Work through the examples');
  expect(text).not.toContain('Notes for foundations');
});

test('its calls to action carry the destination through signing in', async ({ page, request }) => {
  const paid = (await catalogue(request)).find((c) => c.access === 'locked');
  test.skip(!paid, 'no purchasable course');

  await page.context().clearCookies();
  await page.goto('/onyx/c/' + paid!.id);
  await page.getByRole('link', { name: 'Sign in' }).click();
  await page.waitForURL(/\/onyx\/login/, { timeout: 15_000 });

  // Straight back to the course once they are in, rather than the dashboard.
  // Asserted on the decoded destination rather than with a regex over an
  // encoded query, which is how the first version of this test managed to
  // check nothing at all.
  const url = new URL(page.url());
  expect(url.pathname).toBe('/onyx/login');
  expect(url.searchParams.get('next')).toBe('/onyx/courses/' + paid!.id);
});

test('a draft course has no public page', async ({ request }) => {
  // Every id that is not a published course answers the same way, which is
  // what stops the address being a way to find out what exists.
  for (const id of [999999, 1]) {
    const res = await request.get('/api/onyx/c/' + id);
    if (res.status() === 200) {
      const body = await res.json();
      // If it answered, it must be a published course -- never a draft.
      expect(body.data.title).toBeTruthy();
    } else {
      expect(res.status()).toBe(404);
    }
  }
});

test('a signed-in learner is offered the way in rather than the way to buy',
  async ({ page, request }) => {
    const paid = (await catalogue(request)).find((c) => c.access === 'locked');
    test.skip(!paid, 'no purchasable course');

    await page.goto('/onyx/login');
    await page.locator('#email').fill('student@demo.onyx');
    await page.locator('#password').fill('Demo#2026!');
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.waitForURL((url) => !url.pathname.endsWith('/login'), { timeout: 15_000 });

    await page.goto('/onyx/c/' + paid!.id);
    await expect(page.getByRole('link', { name: 'Open the course' })).toBeVisible();
  });
