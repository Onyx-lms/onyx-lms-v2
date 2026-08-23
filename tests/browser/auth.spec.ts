/**
 * F-03 -- signing in and out, through the real form in a real browser.
 *
 * tests/e2e/o01-web.e2e.ts already proves the HTTP contract (status codes,
 * cookies, redirects). What it cannot prove is that the form on screen
 * actually does the right thing when a person types into it: that a wrong
 * password produces a visible error rather than a silent no-op, that the
 * whole flow works with a keyboard and no mouse, and that signing out really
 * does make the dashboard unreachable in the browser that was just signed in.
 */
import { test, expect } from '@playwright/test';
import {
  RUN, mail, PASSWORD, api, adminToken, addMember, createTenant, signInViaForm,
  cleanupTenants,
} from './helpers.ts';

const T = { name: 'Browser Auth College ' + RUN, slug: 'browser-auth-' + RUN };
const adminEmail = mail('browser.auth', 'admin');

test.describe('signing in and out', () => {
  test.beforeAll(async () => {
    await createTenant(T.name, T.slug, 'Admin', adminEmail);
  });

  test.afterAll(async () => {
    await cleanupTenants([T.slug], 'browser.auth.%.' + RUN + '@onyx.test');
  });

  test('a correct sign-in lands on the dashboard with the institution named', async ({ page }) => {
    await signInViaForm(page, adminEmail);
    await expect(page).toHaveURL(/\/onyx\/dashboard$/);
    // The shell's heading is the tenant's own name, not a generic "Dashboard" --
    // proof the page rendered against the institution the token names.
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(T.name);
  });

  test('a wrong password shows a visible error and does not navigate', async ({ page }) => {
    await page.goto('/onyx/login');
    await page.getByLabel('Email address').fill(adminEmail);
    await page.getByLabel('Password').fill('WrongPassword#0000');
    await page.getByRole('button', { name: /sign in/i }).click();

    // Scoped to the form: Next.js's own route announcer
    // (#__next-route-announcer__) also carries role="alert" and is present on
    // every page whether or not anything went wrong, so an unscoped
    // getByRole('alert') matches both and fails on strict mode.
    const alert = page.locator('form').getByRole('alert');
    await expect(alert).toBeVisible();
    await expect(alert).toContainText(/do not match/i);
    // Still on the login page -- a failed sign-in must not be a silent no-op
    // that happens to leave the visitor exactly where a slow success would.
    await expect(page).toHaveURL(/\/onyx\/login$/);
  });

  test('the sign-in form works with a keyboard and nothing else', async ({ page }) => {
    await page.goto('/onyx/login');
    await page.keyboard.press('Tab'); // the skip link, first in the document
    await page.keyboard.press('Tab');
    await expect(page.locator(':focus')).toHaveId('email');
    await page.keyboard.type(adminEmail);
    await page.keyboard.press('Tab');
    await expect(page.locator(':focus')).toHaveId('password');
    await page.keyboard.type(PASSWORD);
    await page.keyboard.press('Enter'); // submits the form, not a click
    await page.waitForURL('**/onyx/dashboard');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(T.name);
  });

  test('signing out returns to login, and the dashboard becomes unreachable', async ({ page }) => {
    await signInViaForm(page, adminEmail);
    await page.getByRole('button', { name: /sign out/i }).click();
    await expect(page).toHaveURL(/\/onyx\/login$/);

    // The cookie is gone. A direct visit is turned back by the server
    // component's redirect, not rendered with an empty or broken shell -- and
    // it carries `?next=` so signing back in returns to where they were going,
    // which is what makes a shared link to a paper survive the login wall.
    await page.goto('/onyx/dashboard');
    await expect(page).toHaveURL(/\/onyx\/login\?next=%2Fonyx%2Fdashboard$/);
  });
});

/**
 * Several people signing in at the same moment stay several people.
 *
 * This is a regression test for a live authentication bug, and it is worth
 * saying plainly what it was: three concurrent logins against the deployment
 * returned two distinct tokens. A learner was handed an administrator's
 * session -- that administrator's identity, institution and every one of their
 * permissions -- because the server signed everybody in through one memoised
 * Supabase Auth client, and GoTrueClient keeps the session it last minted on
 * the instance.
 *
 * It needed concurrency to appear, which is why nothing caught it: every test
 * in this suite, and every person clicking through the product by hand, signs
 * in one at a time. A room full of candidates at the start of an exam does
 * not.
 *
 * Run repeatedly on purpose. The race is real but not certain -- it showed up
 * in roughly one round of three -- so a single round would have been a test
 * that passed while the bug was still there.
 */
test.describe('many people at once', () => {
  const T2 = { name: 'Crowd College ' + RUN, slug: 'crowd-' + RUN };
  const crowdAdmin = mail('crowd', 'admin');
  const people = ['one', 'two', 'three', 'four', 'five'].map((n) => mail('crowd', n));

  test.beforeAll(async () => {
    await createTenant(T2.name, T2.slug, 'Crowd Admin', crowdAdmin);
    const token = await adminToken(crowdAdmin);
    for (const [i, email] of people.entries()) {
      await addMember(token, 'Person ' + (i + 1), email, 'student');
    }
  });

  test.afterAll(async () => {
    await cleanupTenants([T2.slug], 'crowd.%.' + RUN + '@onyx.test');
  });

  test('a token issued to one person is never another person\'s', async () => {
    for (let round = 1; round <= 5; round++) {
      // Together, not in turn. Awaiting each login before starting the next is
      // what the rest of this suite does and is exactly what hid the fault.
      const results = await Promise.all(people.map(async (email) => {
        const res = await api<{ token: string }>('/api/onyx/auth/login',
          { body: { email, password: PASSWORD } });
        return res;
      }));

      /*
       * A rate limit here is NOT this test's subject, and must not be reported
       * as though it were.
       *
       * Signing in costs two calls to GoTrue -- the password grant and the
       * refresh that scopes the session -- so five people at once is ten, and
       * a project on the default Supabase limit reaches it within a couple of
       * rounds. That is a deployment setting, not a session leak, and the two
       * conclusions are opposites: one says "wait", the other says "somebody
       * was handed another person's account".
       *
       * So it fails loudly and says which it is. Skipping instead would let a
       * genuine regression hide behind an unrelated quota.
       */
      const throttled = results.find((r) => r.status === 429);
      if (throttled) {
        throw new Error(
          'Round ' + round + ' could not be run: the Supabase auth '
          + 'rate limit refused a sign-in ("' + throttled.message + '"). That is a '
          + 'limit to raise in Authentication -> Rate Limits, not a session '
          + 'fault -- this check makes ' + (people.length * 2) + ' GoTrue calls per '
          + 'round and needs headroom for ' + (people.length * 2 * 5) + '.');
      }

      const tokens = results.map((res, i) => {
        expect(res.status, 'a login failed outright in round ' + round
          + ' for ' + people[i]).toBe(200);
        return res.data.token;
      });

      expect(new Set(tokens).size,
        'round ' + round + ': two people were issued the SAME token').toBe(people.length);

      // And each one answers as the person it was issued to. Distinct tokens
      // are necessary and not sufficient -- two valid tokens for the same
      // account would also be distinct.
      const identities = await Promise.all(tokens.map(async (token) => {
        const me = await api<{ email: string }>('/api/onyx/me', { token });
        return me.data?.email;
      }));
      expect(identities, 'round ' + round + ': a session belongs to the wrong person')
        .toEqual(people);
    }
  });
});
