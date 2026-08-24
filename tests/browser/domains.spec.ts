/**
 * Live Classes -- the domains an institution advertises.
 *
 * Four claims, and the first two are the ones worth the file existing.
 *
 * The page starts EMPTY. That is the requirement, and an empty state is the
 * easiest thing in a product to get wrong by accident: a query that quietly
 * returns everybody's rows looks identical to a correct one until a second
 * institution exists.
 *
 * The "+" is governed by a capability, not by a role. A faculty member who has
 * not been granted `domains.manage` must not see it, and must be refused by the
 * API if they post anyway -- the button is a courtesy, the route is the control.
 */
import { test, expect, type Page } from '@playwright/test';
import { pageFetch } from './helpers.ts';

const ADMIN = { email: 'admin@demo.onyx', password: 'Demo#2026!' };
const FACULTY = { email: 'faculty@demo.onyx', password: 'Demo#2026!' };
const STUDENT = { email: 'student@demo.onyx', password: 'Demo#2026!' };
const RUN = Date.now().toString(36);
const NAME = 'Test Domain ' + RUN;

async function signIn(page: Page, who: { email: string; password: string }) {
  await page.context().clearCookies();
  await page.goto('/onyx/login');
  await page.getByLabel(/email/i).fill(who.email);
  await page.getByLabel(/password/i).fill(who.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((u) => !u.pathname.endsWith('/login'), { timeout: 20_000 });
}

/** Whatever this file created, gone again -- it runs against a shared database. */
test.afterAll(async ({ browser }) => {
  const page = await (await browser.newContext()).newPage();
  await signIn(page, ADMIN);
  const list = await page.evaluate(async () => {
    const res = await fetch('/api/proxy/onyx/domains?all=1');
    return (await res.json()).data as { id: number; title: string }[];
  });
  for (const d of list.filter((x) => x.title.startsWith('Test Domain '))) {
    await page.evaluate(async (id) => {
      await fetch('/api/proxy/onyx/domains/' + id, { method: 'DELETE' });
    }, d.id);
  }
  await page.close();
});

test.describe('Live Classes', () => {
  test('an administrator adds a domain, and it appears as a tile', async ({ page }) => {
    test.setTimeout(120_000);
    await signIn(page, ADMIN);
    await page.goto('/onyx/domains');

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Live Classes');

    await page.getByRole('button', { name: /add a domain/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Every field the requirements name, each one labelled.
    await dialog.getByLabel('Course name').fill(NAME);
    await dialog.getByLabel('About this domain').fill('What this domain covers.');
    await dialog.getByLabel('Curriculum link').fill('https://onyxedutech.com/curriculum/test');
    await dialog.getByLabel('Certificate').fill('Certificate in Testing');
    await dialog.getByLabel('Duration').fill('8 weeks');
    // Rupees, with the ₹ in the field. This asked for paise and explained the
    // conversion underneath, which is a form asking somebody to do arithmetic
    // it can do itself -- 2,500 typed here is stored as 250000 minor units,
    // and the assertion further down reads the stored figure.
    await dialog.getByLabel('Price').fill('2500');
    await dialog.getByRole('button', { name: /add the domain/i }).click();

    await expect(dialog).toBeHidden({ timeout: 20_000 });
    await expect(page.getByText(NAME)).toBeVisible();
    // The price is readable money, not paise.
    await expect(page.locator('main')).toContainText('INR 2,500.00');
  });

  test('the tile opens the domain, and the curriculum link leaves safely',
    async ({ page }) => {
      await signIn(page, ADMIN);
      await page.goto('/onyx/domains');
      await page.getByRole('link', { name: 'Open ' + NAME }).click();
      await page.waitForURL(/\/onyx\/domains\/\d+$/, { timeout: 20_000 });

      // Everything the form took is on the page it made.
      const main = page.locator('main');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(NAME);
      await expect(main).toContainText('What this domain covers.');
      await expect(main).toContainText('Certificate in Testing');
      await expect(main).toContainText('8 weeks');
      await expect(main).toContainText('INR 2,500.00');

      const curriculum = page.getByRole('link', { name: /view the curriculum/i });
      await expect(curriculum).toHaveAttribute('href', 'https://onyxedutech.com/curriculum/test');
      await expect(curriculum).toHaveAttribute('target', '_blank');
      // noopener, or the destination gets a live handle on this window.
      await expect(curriculum).toHaveAttribute('rel', /noopener/);
      // A new tab opening unannounced is a WCAG 3.2.5 failure.
      await expect(curriculum).toContainText('opens the Onyx EduTech site in a new tab');
    });

  test('a student sees Live Classes and the domain, but cannot add one',
    async ({ page }) => {
      await signIn(page, STUDENT);
      await page.goto('/onyx/dashboard');
      await expect(page.getByRole('navigation')
        .getByRole('link', { name: 'Live Classes' })).toBeVisible();

      await page.goto('/onyx/domains');
      await expect(page.getByText(NAME)).toBeVisible();
      await expect(page.getByRole('button', { name: /add a domain/i })).toHaveCount(0);
    });

  /**
   * The capability, not the role. Faculty are ALLOWED to hold `domains.manage`
   * but do not by default, so this is the case where the screen and the API
   * have to agree with each other rather than with a hard-coded role list.
   */
  test('faculty without the capability get neither the button nor the route',
    async ({ page }) => {
      await signIn(page, FACULTY);
      await page.goto('/onyx/domains');

      await expect(page.getByText(NAME)).toBeVisible();
      await expect(page.getByRole('button', { name: /add a domain/i })).toHaveCount(0);

      // And posting anyway is refused, by name.
      const refusal = await page.evaluate(async () => {
        const res = await fetch('/api/proxy/onyx/domains', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: 'Sneaky' }),
        });
        return { status: res.status, body: await res.json() };
      });
      expect(refusal.body.ok).toBe(false);
      expect(String(refusal.body.message)).toMatch(/Manage domains|not something your institution/i);
    });

  test('a javascript link is refused by the API', async ({ page }) => {
    // The service test proves the function; this proves it is actually wired
    // into the route somebody would use to get past it.
    await signIn(page, ADMIN);
    await page.goto('/onyx/domains');
    const refusal = await page.evaluate(async () => {
      const res = await fetch('/api/proxy/onyx/domains', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Test Domain xss', curriculum_url: 'javascript:alert(1)' }),
      });
      return { status: res.status, body: await res.json() };
    });
    expect(refusal.body.ok).toBe(false);
    expect(String(refusal.body.message)).toMatch(/http or https/i);
  });
});

test.describe('registering for a Live Class', () => {
  test('a student registers, and the office can see who did', async ({ page }) => {
    test.setTimeout(120_000);

    // The domain this file created in its first test. Found by name rather
    // than by a remembered id, so this survives running on its own.
    await signIn(page, STUDENT);
    await page.goto('/onyx/domains');
    await page.getByRole('link', { name: 'Open ' + NAME }).click();
    await page.waitForURL(/\/onyx\/domains\/\d+$/, { timeout: 20_000 });
    const url = page.url();

    // The demo institution has no gateway, so this is the mock -- and it says
    // so, because pretending otherwise over a real charge is the exact lie the
    // notice exists to prevent.
    await page.getByRole('button', { name: /register for/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('test payment');
    // What it actually buys, said before the money. A domain has no outline to
    // open, so the wording commits to being contacted, not to being let in.
    await expect(dialog).toContainText(/office will contact you|reserves your place/i);
    await dialog.getByRole('button', { name: /^Pay / }).click();

    // What proves it worked is the page saying so, not a toast.
    await expect(page.getByText(/you are registered/i)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('button', { name: /register for/i })).toHaveCount(0);

    // And the catalogue says it too, which is where somebody looks next.
    await page.goto('/onyx/domains');
    await expect(page.locator('main')).toContainText('Registered');

    // The half that makes the other half worth having: an administrator can
    // see who signed up, with a way to contact them.
    await signIn(page, ADMIN);
    await page.goto(url);
    const table = page.getByRole('table', { name: /registered/i })
      .or(page.locator('table').last());
    await expect(page.locator('main')).toContainText('Who has registered');
    await expect(table).toContainText('student@demo.onyx');
    await expect(table).toContainText('Paid');

    // Staff do not get a Register button on the thing they administer.
    await expect(page.getByRole('button', { name: /register for/i })).toHaveCount(0);
  });

  test('the API refuses a second registration rather than charging again', async ({ page }) => {
    await signIn(page, STUDENT);
    await page.goto('/onyx/domains');
    await page.getByRole('link', { name: 'Open ' + NAME }).click();
    await page.waitForURL(/\/onyx\/domains\/\d+$/, { timeout: 20_000 });
    const id = page.url().split('/').pop();

    // Idempotent from the learner's side. A second click is somebody wondering
    // whether the first one worked, and the answer they need is "you already
    // are", not an error and certainly not a second charge.
    const res = await pageFetch(page, '/api/proxy/onyx/domains/' + id + '/register',
      { method: 'POST', data: {} });
    expect(res.status).toBe(200);
    expect(res.body.data.replayed).toBe(true);

    // And a learner cannot read the roster.
    const roster = await pageFetch(page,
      '/api/proxy/onyx/domains/' + id + '/registrations');
    expect([401, 403]).toContain(roster.status);
  });
});
