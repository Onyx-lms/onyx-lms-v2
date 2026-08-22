/**
 * O10 -- the resume, in a real browser.
 *
 * Three claims, and the middle one is why the file exists.
 *
 * It ASSEMBLES. Nothing on this page was typed into it, so the test signs in as
 * a seeded learner and expects to find the institution's own records there.
 *
 * A decision SURVIVES A RELOAD. The editor writes through to the server and the
 * page re-renders from it, rather than holding a copy in the browser -- so
 * unchecking something and coming back has to still show it unchecked. A
 * client-side-only editor passes every other test in this file and fails this
 * one, which is exactly what it is here for.
 *
 * The PDF is a PDF. Asserted at the transport level -- the content type and the
 * disposition -- because a browser cannot be asked whether a downloaded file
 * parses, and the writer itself is covered by unit tests that can.
 */
import { test, expect, type Locator, type Page } from '@playwright/test';

const STUDENT = { email: 'student@demo.onyx', password: 'Demo#2026!' };

/**
 * Every control here saves through the server and the page re-renders from it,
 * so a click is followed by a moment where the input is disabled. Waiting for
 * it to come back is what makes a two-step test (untick, then tick again)
 * reliable rather than a race against a transition.
 */
async function settled(page: Page, box: Locator) {
  await expect(box).toBeEnabled({ timeout: 15_000 });
  await page.waitForLoadState('networkidle').catch(() => { /* good enough */ });
}

async function signIn(page: Page, who: { email: string; password: string }) {
  await page.context().clearCookies();
  await page.goto('/onyx/login');
  await page.getByLabel(/email/i).fill(who.email);
  await page.getByLabel(/password/i).fill(who.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((u) => !u.pathname.endsWith('/login'), { timeout: 20_000 });
}

test.describe('the resume', () => {
  test('a learner reaches it from the nav and it is already filled in', async ({ page }) => {
    await signIn(page, STUDENT);

    // Through the navigation rather than by typing the URL: an unreachable
    // page is the same as a missing one.
    await page.getByRole('link', { name: 'Resume', exact: true }).first().click();
    await page.waitForURL(/\/onyx\/resume/, { timeout: 20_000 });

    // The header is the person, not a page title -- this is a document. The
    // first h2 on the page, because the panels beside it use h2 for their own
    // headings and a bare level-2 query matches all of them.
    await expect(page.getByRole('heading', { level: 2 }).first()).not.toBeEmpty();
    // And something the institution knows, that nobody typed here.
    await expect(page.getByText(/courses|education|certificates|skills/i).first())
      .toBeVisible();
  });

  test('leaving an item out survives a reload', async ({ page }) => {
    await signIn(page, STUDENT);
    await page.goto('/onyx/resume');

    const box = () => page.locator('fieldset input[type="checkbox"]').first();
    test.skip(await box().count() === 0, 'this learner has nothing to include');

    // Whatever an earlier run left behind. This runs against a shared
    // database, so "the first box starts ticked" is an assumption, not a fact
    // -- and a test that asserts it is a test that fails for the wrong reason.
    if (!await box().isChecked()) {
      await box().check();
      await settled(page, box());
    }
    const label = (await box().locator('xpath=..').innerText()).trim();

    await box().uncheck();
    // The SERVER is what decides. The tick clears only once the page has been
    // re-assembled from it -- a client-side-only editor passes every other
    // assertion in this file and fails this one, which is why it is here.
    await expect(box()).not.toBeChecked({ timeout: 15_000 });
    await settled(page, box());

    await page.reload();
    await expect(box()).not.toBeChecked({ timeout: 15_000 });
    // And it is gone from the document beside the editor, not merely unticked.
    if (label) {
      await expect(page.locator('section').filter({ hasText: label })).toHaveCount(0);
    }

    // Put it back, because the next run reads the same row.
    await box().check();
    await expect(box()).toBeChecked({ timeout: 15_000 });
  });

  test('the objective is saved, and it is the only thing an LLM would ever write', async ({ page }) => {
    await signIn(page, STUDENT);
    await page.goto('/onyx/resume');

    const text = 'A graduate role in backend engineering. ' + Date.now();
    await page.getByLabel(/your objective/i).fill(text);
    await page.getByRole('button', { name: /^Save$/ }).click();

    await page.reload();
    await expect(page.getByLabel(/your objective/i)).toHaveValue(text);
    // It appears on the document itself, not only in the box it was typed in.
    await expect(page.getByText(text).first()).toBeVisible();
  });

  test('a phone number is off until it is switched on', async ({ page }) => {
    await signIn(page, STUDENT);
    await page.goto('/onyx/resume');

    const box = () => page.getByRole('checkbox', { name: /phone number/i });

    // Start from off regardless of what an earlier run left, then prove the
    // switch and what the document shows agree in both directions.
    if (await box().isChecked()) {
      await box().uncheck();
      await expect(box()).not.toBeChecked({ timeout: 15_000 });
      await settled(page, box());
    }

    await box().check();
    await expect(box()).toBeChecked({ timeout: 15_000 });
    await page.reload();
    await expect(box()).toBeChecked();

    // Left OFF, which is the default the design argues for: a resume is a
    // document you email to people you have not met.
    await box().uncheck();
    await expect(box()).not.toBeChecked({ timeout: 15_000 });
  });

  test('the download is a PDF, and it is an attachment', async ({ page }) => {
    await signIn(page, STUDENT);
    await page.goto('/onyx/resume');

    const res = await page.request.get('/api/proxy/onyx/my/resume/document.pdf');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('application/pdf');
    // An attachment, and named after the holder -- a folder of "resume.pdf" is
    // a folder an employer cannot sort.
    expect(res.headers()['content-disposition']).toContain('attachment');
    expect(res.headers()['content-disposition']).toMatch(/-resume\.pdf/);

    // It really is one. The unit tests prove the xref resolves; this proves the
    // bytes survived the transport, which is the half they cannot see.
    const body = await res.body();
    expect(body.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  test('somebody else\'s resume is not a route that exists', async ({ page }) => {
    await signIn(page, STUDENT);
    // Everything is under /my/ and scoped to the token. There is deliberately
    // no route that takes a user id, so there is nothing here to guess at --
    // asserted so that adding one later has to be a deliberate act.
    const res = await page.request.get('/api/proxy/onyx/resumes/1');
    expect([404, 405]).toContain(res.status());
  });
});
