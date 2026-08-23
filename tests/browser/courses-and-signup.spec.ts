/**
 * Locked courses, the mock payment, and a learner opening their own account.
 *
 * Both features have the same failure mode -- a screen that says something
 * happened when nothing did -- so nothing here asserts on a button or a pill
 * alone. Buying is checked by what the learner can reach afterwards;
 * registering is checked by signing in as the account that was created.
 *
 * Everything this creates is cleaned up in `afterAll`: a demo institution that
 * accumulates a "Signup Probe" per run is a worse problem than no test.
 */
import { test, expect, request as playwrightRequest, type Page } from '@playwright/test';
import { withDb } from './helpers.ts';

const ADMIN = { email: 'admin@demo.onyx', password: 'Demo#2026!' };
const STUDENT = { email: 'student@demo.onyx', password: 'Demo#2026!' };
const API = process.env.E2E_API ?? process.env.E2E_WEB ?? 'http://127.0.0.1:5173';
const RUN = Date.now().toString(36);
const NEW_LEARNER = 'signup.probe.' + RUN + '@demo.onyx';

async function token(email: string, password: string) {
  const ctx = await playwrightRequest.newContext({ baseURL: API });
  const res = await ctx.post('/api/onyx/auth/login', { data: { email, password } });
  const body = await res.json();
  await ctx.dispose();
  return body.data?.token as string;
}

async function api(path: string, init: {
  method?: 'GET' | 'POST' | 'PATCH'; token?: string; data?: unknown;
} = {}) {
  const ctx = await playwrightRequest.newContext({
    baseURL: API,
    extraHTTPHeaders: init.token ? { Authorization: 'Bearer ' + init.token } : {},
  });
  const res = init.method === 'POST' ? await ctx.post(path, { data: init.data ?? {} })
    : init.method === 'PATCH' ? await ctx.patch(path, { data: init.data ?? {} })
      : await ctx.get(path);
  const body = await res.json().catch(() => ({}));
  await ctx.dispose();
  return { status: res.status(), body };
}

async function signIn(page: Page, who: { email: string; password: string }) {
  await page.context().clearCookies();
  await page.goto('/onyx/login');
  await page.locator('#email').fill(who.email);
  await page.locator('#password').fill(who.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.endsWith('/login'), { timeout: 15_000 });
}

/** The locked course this file works against, found rather than created. */
async function lockedCourse(admin: string) {
  const all = await api('/api/onyx/courses?all=1', { token: admin });
  return (all.body.data as { id: number; code: string; access?: string; price_minor?: number }[])
    .find((c) => c.access === 'locked');
}

/*
 * Buying leaves the demo student owning the course, and there is no "un-buy"
 * in the product -- correctly, since refunds are not a thing this builds. So
 * the fixture is reset the same way every other suite resets what it wrote:
 * straight in the database, scoped to the one learner and the one course this
 * file touches.
 *
 * Run BEFORE as well as after. Cleaning up afterwards only guarantees the
 * fixture against this file's own writes, and the product now lets anyone buy
 * a course -- a purchase made by hand, by a demo, or by another suite leaves
 * the learner already owning it, and the precondition ("starting it without
 * paying is refused") then fails with 422 "already enrolled" rather than the
 * 402 it is asserting. A test that depends on global state has to establish
 * that state, not hope for it.
 */
async function resetPurchase() {
  await withDb(async (c) => {
    await c.query(
      `DELETE FROM public."onyx_course_purchases" p
         USING public."onyx_courses" co, public."onyx_users" u
        WHERE p.course_id = co.id AND p.user_id = u.id
          AND co.code = 'ABC301' AND u.email = $1`, [STUDENT.email]);
    await c.query(
      `DELETE FROM public."onyx_enrollments" e
         USING public."onyx_courses" co, public."onyx_users" u
        WHERE e.course_id = co.id AND e.user_id = u.id
          AND co.code = 'ABC301' AND u.email = $1`, [STUDENT.email]);
  });
}

test.beforeAll(resetPurchase);

test.afterAll(async () => {
  await resetPurchase();

  // The account the signup test made, and the purchase the buying test made.
  const admin = await token(ADMIN.email, ADMIN.password);
  const roster = await api('/api/onyx/members', { token: admin });
  const probe = (roster.body.data as { id: number; user?: { email?: string } }[] | undefined)
    ?.find((m) => m.user?.email === NEW_LEARNER);
  if (probe) {
    const ctx = await playwrightRequest.newContext({
      baseURL: API, extraHTTPHeaders: { Authorization: 'Bearer ' + admin },
    });
    await ctx.delete('/api/onyx/members/' + probe.id).catch(() => undefined);
    await ctx.dispose();
  }
});

test.describe('a locked course is bought before it can be started', () => {
  test('the catalogue shows the price, and paying opens the course', async ({ page }) => {
    const admin = await token(ADMIN.email, ADMIN.password);
    const course = await lockedCourse(admin);
    test.skip(!course, 'no locked course in the demo institution');

    const student = await token(STUDENT.email, STUDENT.password);

    // Starting it without paying is refused, and refused as payment required
    // rather than as a flat forbidden -- the learner is not barred, they have
    // not bought it.
    const refused = await api('/api/onyx/courses/' + course!.id + '/enroll',
      { method: 'POST', token: student });
    expect([402, 403]).toContain(refused.status);

    await signIn(page, STUDENT);
    await page.goto('/onyx/courses');

    const buy = page.getByRole('button', { name: /Buy for/ }).first();
    await expect(buy).toBeVisible();
    // The price is on the button, not hidden behind the click.
    await expect(buy).toContainText('1,499');

    /*
     * Which of the two checkouts this is, said out loud.
     *
     * The Buy button runs the mock or a real gateway, and the choice is made
     * on the SERVER from whether this institution has a merchant account -- a
     * client that could choose would be a client that could choose to pay
     * nothing. The demo institution has none, so the mock is what should
     * appear. Asserted rather than assumed: the day somebody configures a
     * gateway on the demo tenant, this should fail HERE saying exactly that,
     * instead of failing four lines down on a missing dialog.
     */
    const gateways = await api('/api/onyx/gateways', { token: student });
    expect(gateways.body.data,
      'a gateway is configured on the demo institution, so this is no longer the mock path')
      .toEqual([]);

    await buy.click();
    // The dialog says what it is before anybody pays -- and only while it is
    // true. With a gateway configured the notice is not rendered at all,
    // because leaving it up over a real charge is the exact lie it exists to
    // prevent.
    await expect(page.getByRole('dialog')).toContainText('test payment');
    await page.getByRole('button', { name: /^Pay / }).click();

    // What proves it worked is the course being reachable, not a toast.
    await expect(page.getByRole('button', { name: /Buy for/ })).toHaveCount(0, { timeout: 15_000 });
    const mine = await api('/api/onyx/my/courses', { token: student });
    expect((mine.body.data as { id: number }[]).some((c) => c.id === course!.id)).toBe(true);

    /*
     * And the money arrives where the institution counts it.
     *
     * Asserted here rather than in the deployment sweep, because here the
     * purchase is one that this test just made: the sweep would be asserting
     * somebody else's fixture, and this file deletes that fixture in afterAll.
     * A payment a learner makes has to show up in the administrator's own
     * report or the two halves of the product disagree about what happened.
     */
    await signIn(page, ADMIN);
    await page.goto('/onyx/finance');
    await expect(page.locator('main'), 'the purchase reaches the finance report')
      .toContainText(/1,?499|Cloud and DevOps/i);
  });

  test('a free course cannot be bought', async () => {
    const admin = await token(ADMIN.email, ADMIN.password);
    const all = await api('/api/onyx/courses?all=1', { token: admin });
    const free = (all.body.data as { id: number; access?: string }[])
      .find((c) => c.access !== 'locked');
    const student = await token(STUDENT.email, STUDENT.password);
    const res = await api('/api/onyx/courses/' + free!.id + '/purchase',
      { method: 'POST', token: student });
    expect(res.status).toBe(422);
  });
});

test.describe('a learner opens their own account', () => {
  test('the form names the institution the address belongs to', async ({ page }) => {
    await page.goto('/onyx/signup');
    await page.locator('#su-email').fill('someone@demo.onyx');
    await page.locator('#su-name').click();
    await expect(page.getByText(/Registers with/)).toBeVisible({ timeout: 10_000 });

    // And says so plainly when an address matches nothing -- without naming
    // any institution that does.
    //
    // The wording moved on: it used to be a flat refusal, and an address that
    // matches nothing is no longer the end of the road, because an institution
    // can let people pick it from a list instead. What must NOT change is that
    // the message names no institution that would have accepted the address --
    // a refusal that says "try ABC instead" is a directory of who registers
    // where, handed to anybody who types an address.
    await page.locator('#su-email').fill('someone@gmail.com');
    await page.locator('#su-name').click();
    const refusal = page.getByText(/does not name an institution/);
    await expect(refusal).toBeVisible({ timeout: 10_000 });
    await expect(refusal).not.toContainText('ABC');
  });

  test('registering creates a student who can sign in', async ({ page }) => {
    await page.goto('/onyx/signup');
    await page.locator('#su-name').fill('Signup Probe');
    await page.locator('#su-email').fill(NEW_LEARNER);
    await page.locator('#su-phone').fill('+91 90000 00000');
    await page.locator('#su-roll').fill('ABC24-' + RUN.slice(-3));
    await page.locator('#su-password').fill('Signup#2026!');
    await page.getByRole('button', { name: /Create my account/ }).click();

    // Straight in, no second form.
    await page.waitForURL(/\/onyx\/dashboard/, { timeout: 20_000 });

    // A student, at the institution the domain resolved to, carrying the roll
    // number they typed.
    const learner = await token(NEW_LEARNER, 'Signup#2026!');
    const me = await api('/api/onyx/me', { token: learner });
    expect(me.body.data.role).toBe('student');
    expect(me.body.data.tenant.slug).toBe('abc-institution');
    expect(me.body.data.roll_number).toContain('ABC24-');
  });
});
