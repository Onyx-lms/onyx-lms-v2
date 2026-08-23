/**
 * End-to-end, through the browser, as a person would actually do it.
 *
 * Platform admin creates an institution -> its admin adds a faculty member and
 * two students -> a course and assignments are set -> the faculty member and
 * then a student sign in and use what was created.
 *
 * The point of the last phase is the one that is easy to fake: every number a
 * dashboard shows is read off the screen and compared against the database
 * that produced it. A dashboard that renders plausible-looking totals from
 * nowhere passes a screenshot review and fails this.
 *
 * Course and assignment creation go through the API rather than the browser
 * because **Onyx has no interface for either** -- an administrator cannot set
 * up a course or an assignment from the product today. That is a real gap,
 * recorded here rather than papered over.
 */
import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { withDb, RUN } from './helpers.ts';

/**
 * 5173, not 4000.
 *
 * This defaulted to the Fastify process that used to serve the API on :4000.
 * That process was removed when the API moved into the Next app (ADR-012), so
 * the default pointed at nothing -- and on a machine where something else has
 * since taken :4000, at the wrong thing entirely, which is how it came to fail
 * with a plausible-looking 401 rather than a connection error.
 *
 * The steps that drive the PAGE kept passing throughout, because those use
 * Playwright's baseURL; only the steps using this constant broke. Every other
 * spec in this suite already defaults to 5173.
 */
const API = process.env.E2E_API ?? 'http://127.0.0.1:5173';
const PW = 'EzilUni#2026';
const PLATFORM = { email: 'superadmin@onyx.platform', password: 'Platform#2026!' };

const SLUG = 'ezil-uni-' + RUN;
const NAME = 'EZiL University ' + RUN;
const mail = (who: string) => `${who}.${RUN}@ezil-uni.test`;

const world = {
  tenantId: 0, courseId: 0, moduleId: 0,
  assignmentA: 0, assignmentB: 0, lessonIds: [] as number[],
};

test.describe.configure({ mode: 'serial' });

/** Sign in through the real tenant form. */
async function signIn(page: Page, email: string) {
  await page.goto('/onyx/login');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(PW);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForFunction(() => !location.pathname.endsWith('/onyx/login'), null,
    { timeout: 15_000 });
}

/**
 * A bearer token, for the steps the product has no screen for.
 *
 * Cached per address across the whole file. This spec walks one institution
 * through its life in numbered steps, and every step used to sign in again --
 * so a run that changes nothing about sessions still spent a dozen sign-ins,
 * each of which costs TWO calls to GoTrue (the password grant, then the
 * refresh that scopes the session). That is enough to reach a project's auth
 * rate limit and fail a step that has nothing to do with signing in.
 *
 * A 429 is called out by name rather than left as "API login failed", because
 * the two readings are different work: one is a limit to raise in the Supabase
 * dashboard, the other is a broken login.
 */
const tokens = new Map<string, string>();

async function token(request: APIRequestContext, email: string, password = PW) {
  const held = tokens.get(email);
  if (held) return held;
  const res = await request.post(API + '/api/onyx/auth/login', {
    data: { email, password },
  });
  if (res.status() === 429) {
    throw new Error('Signing in as ' + email + ' hit the Supabase auth rate limit. '
      + 'Raise it in Authentication -> Rate Limits; this is not a login fault.');
  }
  if (!res.ok()) {
    // The status and the server's own sentence, not just "it failed". This
    // read "API login for admin.xxx@ezil-uni.test" and nothing else, which is
    // the same message whether the password is wrong, the account is missing,
    // or the project is throttled -- three different things to go and do.
    const body = await res.text().catch(() => '');
    throw new Error('API login for ' + email + ' failed: ' + res.status() + ' '
      + body.slice(0, 300));
  }
  const t = (await res.json()).data.token as string;
  tokens.set(email, t);
  return t;
}

// ---------------------------------------------------------------------------

test('1. the platform admin creates the institution, through the console', async ({ page }) => {
  await page.goto('/onyx/platform/login');
  await page.getByLabel('Email address').fill(PLATFORM.email);
  await page.getByLabel('Password').fill(PLATFORM.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL('**/onyx/platform', { timeout: 15_000 });

  await page.getByRole('button', { name: 'Create an institution' }).click();
  await page.locator('#ct-name').fill(NAME);
  await page.locator('#ct-admin-name').fill('Uni Admin');
  await page.locator('#ct-admin-email').fill(mail('admin'));
  await page.locator('#ct-admin-password').fill(PW);
  await page.getByRole('button', { name: 'Create', exact: true }).click();

  // It appears in the platform's own list of every institution.
  // Scoped to the directory table: the overview's right rail also lists
  // institutions, so an unscoped locator can resolve to two.
  await expect(page.getByLabel('Institutions', { exact: true })
    .getByRole('link', { name: NAME })).toBeVisible({ timeout: 15_000 });

  await withDb(async (c) => {
    const { rows } = await c.query(
      'SELECT id, name FROM public."onyx_tenants" WHERE name = $1', [NAME]);
    expect(rows.length, 'the institution reached the database').toBe(1);
    world.tenantId = Number(rows[0].id);
  });
});

test('2. its administrator adds one faculty member and two students, through the roster', async ({ page }) => {
  await signIn(page, mail('admin'));
  await page.goto('/onyx/people');

  for (const [name, email, role] of [
    ['Fiona Faculty', mail('faculty'), 'faculty'],
    ['Sam Student', mail('student1'), 'student'],
    ['Sara Second', mail('student2'), 'student'],
  ] as const) {
    // The roster leads with the roster now: the add form is behind the
    // toolbar's button, and closes again once the person is created.
    await page.getByRole('button', { name: 'Add someone' }).click();
    await page.locator('input[name="name"]').fill(name);
    await page.locator('input[name="email"]').fill(email);
    await page.locator('select[name="role"]').selectOption(role);
    await page.locator('input[name="password"]').fill(PW);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Added.', { timeout: 15_000 });
    await expect(page.getByRole('cell', { name })).toBeVisible();
  }

  // Four people: the admin created with the institution, plus these three.
  await withDb(async (c) => {
    const { rows } = await c.query(
      `SELECT role, count(*)::int n FROM public."onyx_memberships"
       WHERE tenant_id = $1 AND status = 1 GROUP BY role`, [world.tenantId]);
    const byRole = Object.fromEntries(rows.map((r) => [r.role, r.n]));
    expect(byRole).toMatchObject({ admin: 1, faculty: 1, student: 2 });
  });
});

test('3. a course, lessons and two assignments are set up (no UI exists for this)', async ({ request }) => {
  const admin = await token(request, mail('admin'));
  const post = async (path: string, data: unknown, t = admin) => {
    const res = await request.post(API + path, {
      data: data as Record<string, unknown>, headers: { Authorization: 'Bearer ' + t },
    });
    const body = await res.json();
    expect(body.ok, path + ' -> ' + (body.message ?? '')).toBeTruthy();
    return body.data;
  };

  const course = await post('/api/onyx/courses', {
    code: 'EZ101', title: 'Foundations of Computing', credits: 4, self_enroll: true,
  });
  world.courseId = Number(course.id);

  await request.patch(API + '/api/onyx/courses/' + world.courseId, {
    data: { status: 1 }, headers: { Authorization: 'Bearer ' + admin },
  });
  await post('/api/onyx/courses/' + world.courseId + '/faculty',
    { user_id: await userId(mail('faculty')) });

  const mod = await post('/api/onyx/courses/' + world.courseId + '/modules',
    { title: 'Core concepts' });
  world.moduleId = Number(mod.id);

  for (const [i, title] of ['Binary and bits', 'How a CPU works', 'Memory',
    'Storage'].entries()) {
    const l = await post('/api/onyx/modules/' + world.moduleId + '/lessons', {
      title, type: 'text', body: `Notes on ${title.toLowerCase()}.`,
      duration_seconds: 300, sort: i + 1,
    });
    world.lessonIds.push(Number(l.id));
  }

  const soon = new Date(Date.now() + 3 * 86_400_000).toISOString();
  const past = new Date(Date.now() - 2 * 86_400_000).toISOString();
  const a = await post('/api/onyx/courses/' + world.courseId + '/assignments',
    { title: 'Number bases worksheet', instructions: 'Convert between bases.',
      due_at: soon, total_points: 20 });
  const b = await post('/api/onyx/courses/' + world.courseId + '/assignments',
    { title: 'CPU report', instructions: 'Describe the fetch-execute cycle.',
      due_at: past, total_points: 30 });
  world.assignmentA = Number(a.id);
  world.assignmentB = Number(b.id);
  await post('/api/onyx/assignments/' + world.assignmentA + '/publish', undefined);
  await post('/api/onyx/assignments/' + world.assignmentB + '/publish', undefined);

  async function userId(email: string) {
    return withDb(async (c) => {
      const { rows } = await c.query('SELECT id FROM public."onyx_users" WHERE email = $1',
        [email]);
      // A string, not Number(): onyx_users.id became a uuid at the auth
      // cutover, so Number() produced NaN and every route validating
      // z.string().uuid() answered "The given data was invalid."
      return String(rows[0].id);
    });
  }
});

test('4. both students enrol, and one does some of the work', async ({ request }) => {
  for (const who of ['student1', 'student2'] as const) {
    const t = await token(request, mail(who));
    const res = await request.post(API + '/api/onyx/courses/' + world.courseId + '/enroll',
      { headers: { Authorization: 'Bearer ' + t } });
    expect((await res.json()).ok, who + ' enrol').toBeTruthy();
  }

  // Only the first student completes anything, so the two dashboards must
  // differ -- which is what proves the numbers are per-person.
  const s1 = await token(request, mail('student1'));
  for (const id of world.lessonIds.slice(0, 3)) {
    const res = await request.post(API + '/api/onyx/lessons/' + id + '/progress', {
      data: { position_seconds: 300, completed: true },
      headers: { Authorization: 'Bearer ' + s1 },
    });
    expect((await res.json()).ok, 'complete lesson ' + id).toBeTruthy();
  }
});

test('5. the faculty member sees the course they teach and its roster', async ({ page }) => {
  await signIn(page, mail('faculty'));

  await page.goto('/onyx/courses');
  await expect(page.getByRole('link', { name: /Foundations of Computing/ }).first())
    .toBeVisible();

  await page.goto('/onyx/courses/' + world.courseId);
  await expect(page.getByRole('heading', { name: 'Foundations of Computing' })).toBeVisible();
  // The lessons that were created, not a placeholder outline.
  for (const title of ['Binary and bits', 'How a CPU works']) {
    await expect(page.getByText(title, { exact: true }).first()).toBeVisible();
  }

  await page.goto('/onyx/people');
  await expect(page.getByRole('cell', { name: 'Sam Student' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Sara Second' })).toBeVisible();
  // Faculty may read the roster and may not edit it.
  await expect(page.getByRole('button', { name: 'Remove' })).toHaveCount(0);
});

test('6. every number on the student dashboard matches the database', async ({ page }) => {
  await signIn(page, mail('student1'));
  await page.goto('/onyx/dashboard');
  await page.waitForLoadState('networkidle');

  const truth = await withDb(async (c) => {
    const one = async (sql: string, params: unknown[]) =>
      Number((await c.query(sql, params)).rows[0].n);
    const userRow = await c.query('SELECT id FROM public."onyx_users" WHERE email = $1',
      [mail('student1')]);
    // A uuid string since the auth cutover, not a number.
    const uid = String(userRow.rows[0].id);
    return {
      uid,
      lessonsTotal: await one(
        `SELECT count(*)::int n FROM public."onyx_lessons"
         WHERE tenant_id=$1 AND course_id=$2`, [world.tenantId, world.courseId]),
      lessonsDone: await one(
        `SELECT count(*)::int n FROM public."onyx_lesson_progress"
         WHERE tenant_id=$1 AND user_id=$2 AND completed_at IS NOT NULL`,
        [world.tenantId, uid]),
      published: await one(
        `SELECT count(*)::int n FROM public."onyx_assignments"
         WHERE tenant_id=$1 AND course_id=$2 AND status='published'`,
        [world.tenantId, world.courseId]),
    };
  });

  const body = await page.locator('body').innerText();

  // Lessons: the tile reads "3" of 4 -- both from the database, not constants.
  const pct = Math.round((truth.lessonsDone / truth.lessonsTotal) * 100);
  expect(truth.lessonsTotal, 'four lessons were created').toBe(4);
  expect(truth.lessonsDone, 'three were completed').toBe(3);

  // The tile's own card, reached from the labelled element rather than by
  // matching the rendered text -- the label is uppercased by CSS, so the DOM
  // says "Lessons" while the screen says "LESSONS".
  const lessonsCard = page.getByTestId('stat-lessons').locator('..');
  await expect(lessonsCard).toContainText(String(truth.lessonsDone));
  await expect(lessonsCard).toContainText('of ' + truth.lessonsTotal);

  // The resume card shows this course's OWN percentage, and names the next
  // lesson rather than the first one. Scoped to the card: a nudge lower down
  // explains itself with the same "3 of 4 lessons" phrasing, so an unscoped
  // match is ambiguous rather than wrong.
  const resume = page.locator('section[aria-labelledby="resume-h"]');
  await expect(resume).toContainText(`${pct}% complete`);
  await expect(resume).toContainText(`${truth.lessonsDone} of ${truth.lessonsTotal} lessons`);
  await expect(resume.getByRole('heading', { name: 'Foundations of Computing' }))
    .toBeVisible();
  // "Storage" is the fourth lesson -- the first one NOT completed. A resume
  // card that named "Binary and bits" would be sending them back to the start.
  await expect(resume).toContainText('Storage');

  // Both published assignments appear, and the overdue one is called overdue
  // rather than printed as a machine timestamp. Scoped to the "Due next" card:
  // the same titles legitimately appear again in the nudges beside it.
  expect(truth.published).toBe(2);
  const dueCard = page.locator('section:has([id="due-h"])');
  await expect(dueCard).toContainText('Number bases worksheet');
  await expect(dueCard).toContainText('CPU report');
  await expect(dueCard).toContainText('2 days late');
  await expect(dueCard).toContainText('in 3 days');
  // Soonest-first means the overdue one is at the top, not buried under work
  // that is not due for another three days.
  const rows = await dueCard.locator('li').allInnerTexts();
  expect(rows[0], 'the overdue assignment sorts first').toContain('CPU report');
  // Nothing anywhere on the page prints a machine timestamp at a person --
  // not the due list, and not the "because" line under a nudge, which used to
  // read "due 2026-08-08T22:35:56.508+00:00".
  expect(body, 'a locale timestamp reached the page')
    .not.toMatch(/\d{1,2}\/\d{1,2}\/\d{4},\s*\d{1,2}:\d{2}:\d{2}/);
  expect(body, 'an ISO timestamp reached the page')
    .not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);

  // The course ring carries the per-course figure.
  await expect(page.getByRole('img', { name: `${pct} percent complete` }).first())
    .toBeVisible();
});

test('7. the second student, who did nothing, sees genuinely different numbers', async ({ page }) => {
  await signIn(page, mail('student2'));
  await page.goto('/onyx/dashboard');
  await page.waitForLoadState('networkidle');

  // Same course, same assignments -- but this learner's own progress is zero.
  // If the dashboard were rendering constants, or the first student's totals,
  // this is where it would show.
  const resume = page.locator('section[aria-labelledby="resume-h"]');
  await expect(resume).toContainText('0% complete');
  await expect(resume).toContainText('0 of 4 lessons');
  await expect(page.getByRole('img', { name: '0 percent complete' }).first()).toBeVisible();
  // The eyebrow changes with the state rather than always saying "resume", and
  // the lesson named is the first one, because none are done.
  await expect(resume).toContainText('Start here');
  await expect(resume).toContainText('Binary and bits');
});

test('8. removing the institution takes everything belonging to it', async () => {
  await withDb(async (c) => {
    await c.query('DELETE FROM public."onyx_tenants" WHERE id = $1', [world.tenantId]);
    for (const table of ['onyx_courses', 'onyx_lessons', 'onyx_assignments',
      'onyx_enrollments', 'onyx_memberships', 'onyx_lesson_progress']) {
      const { rows } = await c.query(
        `SELECT count(*)::int n FROM public."${table}" WHERE tenant_id = $1`,
        [world.tenantId]);
      expect(Number(rows[0].n), table + ' outlived its institution').toBe(0);
    }
  });
});

/**
 * Cleanup belongs in afterAll, not in a final test.
 *
 * It was a ninth test, and in a serial file every later test is SKIPPED once
 * one fails -- so two runs that tripped over a locator left four institutions
 * and sixteen accounts behind in a shared database. afterAll runs either way.
 */
test.afterAll(async () => {
  await withDb(async (c) => {
    await c.query('DELETE FROM public."onyx_tenants" WHERE slug LIKE $1',
      ['ezil-university-%']);
    await c.query('DELETE FROM public."onyx_users" WHERE email LIKE $1',
      ['%@ezil-uni.test']);
  });
});
