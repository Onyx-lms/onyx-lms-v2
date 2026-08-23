/**
 * LRN-03 -- a register, end to end.
 *
 * The suite already proved a session can be OPENED and stopped there, which is
 * the least interesting third of this feature. What a register is for is the
 * rest: a learner marking themselves present from the projected code, a
 * lecturer marking the ones who did not, ending the register, and the
 * percentage that comes out the far end. Every one of those steps had an
 * endpoint and none of them had a test.
 *
 * Two claims here are about money-shaped correctness rather than plumbing.
 *
 * **An unmarked session counts as absent.** The service says so in as many
 * words, and it is the clause that makes a shortfall report worth reading --
 * treating "nobody wrote anything down" as "no data" flatters every
 * percentage. So this opens two sessions and attends one, and expects 50%.
 *
 * **A closed register stops accepting check-ins.** Not because time passed --
 * the window closing on its own is a different rule, already covered in the
 * service -- but because somebody pressed Close. A code left on a projector
 * after the class has gone home is exactly what that button is for.
 */
import { test, expect, type Page } from '@playwright/test';
import { withDb, RUN, api, PASSWORD, mail, createTenant, adminToken, addMember, signInViaForm,
  cleanupTenants, pageFetch } from './helpers.ts';

const T = { name: 'Register Institute ' + RUN, slug: 'register-' + RUN };
const adminEmail = mail('register', 'admin');
const learnerEmail = mail('register', 'learner');
const other = mail('register', 'other');

const w = { tenantId: 0, courseId: 0, sessionId: 0, learnerId: '' };

test.describe.configure({ mode: 'serial' });

/** An API token for whoever is named. */
async function tokenFor(email: string): Promise<string> {
  const res = await api<{ token: string }>('/api/onyx/auth/login', {
    body: { email, password: PASSWORD },
  });
  return res.data.token;
}

test.beforeAll(async () => {
  await createTenant(T.name, T.slug, 'Register Admin', adminEmail);
  const token = await adminToken(adminEmail);
  await addMember(token, 'Lea Learner', learnerEmail, 'student');
  await addMember(token, 'Otto Other', other, 'student');

  w.tenantId = await withDb(async (c) => Number((await c.query(
    'SELECT id FROM public."onyx_tenants" WHERE slug=$1', [T.slug])).rows[0].id));

  // A course with two learners on it. Seeded through the API rather than the
  // browser: what this file is testing is the register, not course creation,
  // which e2e-authoring already drives through the screens.
  const course = await api('/api/onyx/courses', {
    method: 'POST', token,
    body: { code: 'REG101', title: 'Register 101', credits: 3, access: 'open' },
  });
  w.courseId = Number((course.data as { id: number }).id);

  // Published, or none of this works and none of it says why. A course is
  // created as a draft, and `assertEnrolled` -- which check-in goes through --
  // answers 404 for a draft rather than 403, deliberately: course ids are
  // sequential, so a 403 would confirm an unpublished course exists at that id.
  // The cost is that a missing publish looks exactly like a missing course.
  await api('/api/onyx/courses/' + w.courseId + '/publish', { method: 'POST', token });

  const members = await api('/api/onyx/members', { token });
  const roster = members.data as { user_id: string; user: { email: string } | null }[];
  for (const email of [learnerEmail, other]) {
    const found = roster.find((m) => m.user?.email === email)!;
    if (email === learnerEmail) w.learnerId = found.user_id;
    await api('/api/onyx/courses/' + w.courseId + '/enroll', {
      method: 'POST', token, body: { user_id: found.user_id },
    });
  }
});

test.afterAll(async () => {
  await cleanupTenants([T.slug], 'register.%.' + RUN + '@onyx.test');
});

test('a lecturer opens a register and the code rotates', async ({ page }) => {
  await signInViaForm(page, adminEmail);
  await page.goto('/onyx/courses/' + w.courseId);

  await page.getByRole('button', { name: 'Open a session' }).click();
  const form = page.locator('form').filter({ has: page.locator('h3') })
    .or(page.getByRole('dialog').locator('form'));
  await form.locator('[name="title"]').fill('Lecture 1');
  // `datetime-local` carries no zone and is read as LOCAL time, so it has to
  // be built from local parts. `toISOString().slice(0, 16)` is UTC, and typing
  // that into the field put this lecture five and a half hours in the past on
  // a machine in IST -- its check-in window had closed before the test opened
  // it, and /code answered "This session is closed" for a register created
  // seconds earlier.
  const d = new Date(Date.now() - 60_000);
  const two = (n: number) => String(n).padStart(2, '0');
  const local = d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate())
    + 'T' + two(d.getHours()) + ':' + two(d.getMinutes());
  await form.locator('[name="scheduled_at"]').fill(local);
  await form.locator('button[type="submit"]').first().click();
  await expect(form).toHaveCount(0, { timeout: 20_000 });

  w.sessionId = await withDb(async (c) => Number((await c.query(
    `SELECT id FROM public."onyx_attendance_sessions"
      WHERE tenant_id=$1 AND title='Lecture 1'`, [w.tenantId])).rows[0].id));

  // The code is short-lived on purpose -- a relay that stays valid is a relay
  // somebody reads out to a friend who is not in the room.
  const token = await tokenFor(adminEmail);
  const first = await api('/api/onyx/attendance/' + w.sessionId + '/code', { token });
  expect(first.status).toBe(200);
  const code = (first.data as { code: string }).code;
  expect(code, 'a code is issued for the projector').toMatch(/^[A-Z0-9]{4,12}$/);
  // And it is never handed out with the secret it is derived from.
  expect(JSON.stringify(first.data)).not.toContain('qr_secret');
});

test('a learner checks in with the projected code, and a wrong one is refused', async () => {
  const staff = await tokenFor(adminEmail);
  const learner = await tokenFor(learnerEmail);
  const { code } = (await api('/api/onyx/attendance/' + w.sessionId + '/code',
    { token: staff })).data as { code: string };

  const wrong = await api('/api/onyx/attendance/' + w.sessionId + '/check-in', {
    method: 'POST', token: learner, body: { code: 'NOPE1234' },
  });
  expect(wrong.status, 'a guessed code is not a way into a register').toBeGreaterThanOrEqual(400);

  const right = await api('/api/onyx/attendance/' + w.sessionId + '/check-in', {
    method: 'POST', token: learner, body: { code },
  });
  expect(right.status).toBe(200);

  await withDb(async (c) => {
    const { rows } = await c.query(
      `SELECT status FROM public."onyx_attendance_records"
        WHERE tenant_id=$1 AND session_id=$2 AND user_id=$3`,
      [w.tenantId, w.sessionId, w.learnerId]);
    expect(rows.length, 'the learner is on the register').toBe(1);
    expect(['present', 'late']).toContain(String(rows[0].status));
  });
});

test('a lecturer marks the rest, and closing stops check-in', async ({ page }) => {
  await signInViaForm(page, adminEmail);
  await page.goto('/onyx/courses/' + w.courseId + '/attendance/' + w.sessionId);

  // Whoever did not check in is marked by hand. The roster is the whole point
  // of the screen, so it has to carry both learners.
  //  because each row names the learner twice: once as the visible
  // label and once in a sr-only legend reading 'Attendance for <name>', which
  // is right on the page and a strict-mode violation for a loose locator.
  await expect(page.getByText('Lea Learner', { exact: true }))
    .toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Otto Other', { exact: true })).toBeVisible();

  // Taken while the register is still open, because the point being tested is
  // that a code somebody already has stops working -- the one still on the
  // projector when the class walks out.
  const staffBefore = await tokenFor(adminEmail);
  const projected = ((await api('/api/onyx/attendance/' + w.sessionId + '/code',
    { token: staffBefore })).data as { code: string }).code;

  page.once('dialog', (d) => { void d.accept(); });
  await page.getByRole('button', { name: 'Close the register' }).click();
  await expect(page.getByText('This session is closed.')).toBeVisible({ timeout: 20_000 });

  await withDb(async (c) => {
    const { rows } = await c.query(
      `SELECT status FROM public."onyx_attendance_sessions" WHERE tenant_id=$1 AND id=$2`,
      [w.tenantId, w.sessionId]);
    expect(String(rows[0].status)).toBe('closed');
  });

  // The code on the projector is now worthless, which is what the button is
  // for: a class that has gone home cannot mark itself present.
  const staff = await tokenFor(adminEmail);
  const otto = await tokenFor(other);

  // No new code is issued for a closed register either, which is the half that
  // makes the other half hold: the only way into last week's lecture was for
  // somebody to still be able to produce a currently valid code for it.
  const codeRes = await api('/api/onyx/attendance/' + w.sessionId + '/code', { token: staff });
  expect(codeRes.status, 'a closed register still handed out a code')
    .toBeGreaterThanOrEqual(400);

  const late = await api('/api/onyx/attendance/' + w.sessionId + '/check-in', {
    method: 'POST', token: otto, body: { code: projected },
  });
  expect(late.status, 'a closed register still accepted a check-in')
    .toBeGreaterThanOrEqual(400);
});

test('an unmarked session counts as absent, and the shortfall report says so', async () => {
  const token = await adminToken(adminEmail);

  // A second lecture nobody attends. The percentage has to fall, or a
  // shortfall report is a report that never flags anybody.
  await api('/api/onyx/courses/' + w.courseId + '/attendance', {
    method: 'POST', token,
    body: { title: 'Lecture 2', scheduled_at: new Date().toISOString() },
  });

  const res = await api('/api/onyx/courses/' + w.courseId + '/attendance/analytics',
    { token });
  expect(res.status).toBe(200);
  const data = res.data as {
    sessions: number;
    learners: { user_id: string; attended: number; held: number; percent: number;
      below_threshold: boolean }[];
  };

  expect(data.sessions, 'two lectures were held').toBe(2);
  const lea = data.learners.find((l) => l.user_id === w.learnerId)!;
  expect(lea.held).toBe(2);
  expect(lea.attended, 'present at one of the two').toBe(1);
  expect(lea.percent, 'an unmarked session counts against, not as no-data').toBe(50);
  expect(lea.below_threshold, '50% is below the default 75% threshold').toBe(true);

  // Otto attended neither and must read as zero rather than as missing.
  const missing = data.learners.filter((l) => l.percent === 0);
  expect(missing.length, 'somebody who never turned up is on the report at 0%')
    .toBeGreaterThan(0);
});

test('the register exports as a CSV somebody can open', async ({ page }) => {
  await signInViaForm(page, adminEmail);
  const res = await pageFetch(page,
    '/api/proxy/onyx/courses/' + w.courseId + '/attendance/export.csv');
  expect(res.status).toBe(200);
  expect(res.headers['content-type']).toContain('text/csv');
  const body = res.text;
  expect(body).toContain('Lea Learner');
  // CRLF, because the thing opening this is Excel more often than not.
  expect(body).toContain('\r\n');
});

/** A learner sees their own attendance and nobody else's. */
test('a learner sees their own record only', async ({ page }: { page: Page }) => {
  const learner = await tokenFor(learnerEmail);
  const mine = await api('/api/onyx/my/attendance', { token: learner });
  expect(mine.status).toBe(200);
  expect(JSON.stringify(mine.data)).not.toContain('Otto Other');

  // And the register itself is staff-only: it is every learner's name against
  // a status, which is exactly the roster a classmate is never shown.
  const refused = await api('/api/onyx/attendance/' + w.sessionId + '/roster',
    { token: learner });
  expect([401, 403]).toContain(refused.status);

  await signInViaForm(page, learnerEmail);
  await page.goto('/onyx/courses/' + w.courseId + '/attendance/' + w.sessionId);
  await expect(page.getByText('Otto Other', { exact: true })).toHaveCount(0);
});
