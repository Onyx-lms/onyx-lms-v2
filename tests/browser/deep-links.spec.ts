/**
 * A shared link survives the sign-in page.
 *
 * A lecturer sets a paper and sends its address to a class. Every student
 * following it was bounced to sign in and then dropped on the dashboard, with
 * no way back to the thing they had been sent -- so the link, which was the
 * whole point, was worth nothing once it had been clicked.
 *
 * The mechanism existed: the sign-in page has always honoured `?next=`. What
 * was missing is that the page guards never set it -- `requireOnyxSession`
 * took the destination as an argument and almost nobody passed one. It now
 * reads the request's own path, so every gated page keeps its destination
 * without each one having to remember to.
 *
 * The other half of "shareable" is that a link is not a key: whoever follows
 * one signs in as themselves and sees exactly what their role allows.
 */
import { test, expect, type Page } from '@playwright/test';

const PW = 'Demo#2026!';

async function signInOnThisPage(page: Page, email: string) {
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(PW);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.endsWith('/login'), { timeout: 20_000 });
}

test('a link to a paper lands on the paper, not the dashboard', async ({ page }) => {
  await page.context().clearCookies();
  await page.goto('/onyx/assessments/26');

  // Sent to sign in, carrying where they were going.
  await expect(page).toHaveURL(/\/onyx\/login\?next=/);
  await signInOnThisPage(page, 'student@demo.onyx');
  await expect(page).toHaveURL(/\/onyx\/assessments\/26/);
});

test('a link with a query keeps the query', async ({ page }) => {
  await page.context().clearCookies();
  await page.goto('/onyx/people?role=student');
  await expect(page).toHaveURL(/\/onyx\/login\?next=/);

  await signInOnThisPage(page, 'admin@demo.onyx');
  // The filter is what made the link worth sending; arriving at the bare
  // roster would have lost it.
  await expect(page).toHaveURL(/\/onyx\/people\?role=student/);
});

test('a link is not a key: the wrong role is refused, not signed out', async ({ page }) => {
  await page.context().clearCookies();
  await page.goto('/onyx/login');
  await signInOnThisPage(page, 'student@demo.onyx');

  await page.goto('/onyx/finance');
  // Refused as themselves. Not bounced back to sign in, which would ask them
  // to prove something they have already proved.
  await expect(page).toHaveURL(/\/onyx\/denied/);
});

test('somebody with no account keeps the destination through signing up', async ({ page }) => {
  await page.context().clearCookies();
  await page.goto('/onyx/assessments/26');
  await expect(page).toHaveURL(/\/onyx\/login\?next=/);

  // Both doors carry it, so switching between them does not drop it.
  await page.getByRole('link', { name: 'Create a student account' }).click();
  await expect(page).toHaveURL(/\/onyx\/signup\?next=%2Fonyx%2Fassessments%2F26/);
  await page.getByRole('link', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/onyx\/login\?next=%2Fonyx%2Fassessments%2F26/);
});

test('a record offers its own link to copy', async ({ page }) => {
  await page.context().clearCookies();
  await page.goto('/onyx/login');
  await signInOnThisPage(page, 'faculty@demo.onyx');

  await page.goto('/onyx/assessments/26');
  await expect(page.getByRole('button', { name: /Copy link/ })).toBeVisible();
});
