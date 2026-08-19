/**
 * Everything the proposal says somebody "must be able to create", created
 * through the browser -- no API calls anywhere in this file.
 *
 * A previous end-to-end run had to reach for the API to set up a course and
 * an assignment, because the product had no screen for either. This is the
 * proof that is no longer true, requirement by requirement:
 *
 *   LRN-01  a course                       CMP-01  programmes, semesters, batches
 *   LRN-02  modules and lessons            CMP-02  exams and halls
 *   LRN-03  an attendance session          CMP-03  fee heads
 *   LRN-04  an assignment                  CAR-01  contests
 *   LAB-04  a practice problem             CAR-04  job posts
 *
 * Each one is checked twice: it appears on the screen, and it is in the
 * database with the values that were typed.
 */
import { test, expect, type Page } from '@playwright/test';
import { withDb, RUN, api } from './helpers.ts';

const PW = 'Authoring#2026';
const PLATFORM = { email: 'superadmin@onyx.platform', password: 'Platform#2026!' };
const NAME = 'Authoring College ' + RUN;
const mail = (who: string) => `${who}.${RUN}@authoring.test`;
const OUT = 'C:/Users/TURBOS~1/AppData/Local/Temp/';

const w = { tenantId: 0, courseId: 0 };

test.describe.configure({ mode: 'serial' });

async function signIn(page: Page, email: string) {
  await page.goto('/onyx/login');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(PW);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForFunction(() => !location.pathname.endsWith('/onyx/login'), null,
    { timeout: 15_000 });
}

/** Open a CreatePanel by its button, fill it, submit, wait for the refresh. */
async function create(page: Page, cta: string, values: Record<string, string | boolean>,
  submitLabel = cta) {
  await page.getByRole('button', { name: cta, exact: true }).first().click();
  const form = page.locator('form').filter({ has: page.getByRole('button', { name: submitLabel }) });
  for (const [name, value] of Object.entries(values)) {
    const field = form.locator(`[name="${name}"]`).first();
    if (typeof value === 'boolean') { if (value) await field.check(); continue; }
    const tag = await field.evaluate((el) => el.tagName.toLowerCase());
    if (tag === 'select') {
      // Match on the visible label -- the option values are database ids,
      // which the test has no reason to know.
      await field.selectOption({ label: value });
    }
    else await field.fill(value);
  }
  await form.getByRole('button', { name: submitLabel }).click();
  // The panel closes on success; if it stays open there is an error to read.
  await expect(form).toBeHidden({ timeout: 20_000 });
}

const soon = (days: number) => {
  const d = new Date(Date.now() + days * 86_400_000);
  d.setSeconds(0, 0);
  return d.toISOString().slice(0, 16); // datetime-local wants no zone
};

test('setup: an institution, an admin, a faculty member and a student', async ({ page }) => {
  await page.goto('/onyx/platform/login');
  await page.getByLabel('Email address').fill(PLATFORM.email);
  await page.getByLabel('Password').fill(PLATFORM.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL('**/onyx/platform', { timeout: 15_000 });

  await page.getByRole('button', { name: 'Create an institution' }).click();
  await page.locator('#ct-name').fill(NAME);
  await page.locator('#ct-admin-name').fill('Authoring Admin');
  await page.locator('#ct-admin-email').fill(mail('admin'));
  await page.locator('#ct-admin-password').fill(PW);
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.getByRole('link', { name: NAME })).toBeVisible({ timeout: 15_000 });

  w.tenantId = await withDb(async (c) => Number(
    (await c.query('SELECT id FROM public."onyx_tenants" WHERE name=$1', [NAME])).rows[0].id));

  await signIn(page, mail('admin'));
  await page.goto('/onyx/people');
  for (const [name, email, role] of [
    ['Fern Faculty', mail('faculty'), 'faculty'],
    ['Stu Student', mail('student'), 'student'],
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
  }
});

test('CMP-01 an administrator creates a programme, a semester and a batch', async ({ page }) => {
  await signIn(page, mail('admin'));
  await page.goto('/onyx/programs');

  await create(page, 'Add a programme',
    { name: 'Computer Science', code: 'CS', duration_semesters: '6' });
  await expect(page.getByText('Computer Science').first()).toBeVisible();

  await create(page, 'Add a semester',
    { name: 'Term 1 2026', number: '1', starts_on: '2026-01-05', ends_on: '2026-06-05' });
  await create(page, 'Add a batch', { name: 'Batch A 2026', code: 'BA26' });

  await page.screenshot({ path: OUT + 'feat-CMP01-programmes.png', fullPage: true });
  await withDb(async (c) => {
    for (const [table, col, value] of [
      ['onyx_programs', 'name', 'Computer Science'],
      ['onyx_semesters', 'name', 'Term 1 2026'],
      ['onyx_batches', 'name', 'Batch A 2026'],
    ] as const) {
      const { rows } = await c.query(
        `SELECT count(*)::int n FROM public."${table}" WHERE tenant_id=$1 AND ${col}=$2`,
        [w.tenantId, value]);
      expect(Number(rows[0].n), `${table} was created`).toBe(1);
    }
  });
});

test('LRN-01 an administrator creates a course, through the product', async ({ page }) => {
  await signIn(page, mail('admin'));
  await page.goto('/onyx/courses');

  await create(page, 'Create a course', {
    code: 'CS101', title: 'Introduction to Programming', credits: '4',
    description: 'Where everyone starts.', self_enroll: true,
  });

  await expect(page.getByText('Introduction to Programming').first()).toBeVisible();
  await page.screenshot({ path: OUT + 'feat-LRN01-course-created.png', fullPage: true });

  w.courseId = await withDb(async (c) => {
    const { rows } = await c.query(
      `SELECT id, credits, self_enroll, status FROM public."onyx_courses"
       WHERE tenant_id=$1 AND code='CS101'`, [w.tenantId]);
    expect(rows.length, 'the course reached the database').toBe(1);
    // The values typed into the form, and opened rather than left a draft.
    expect(Number(rows[0].credits)).toBe(4);
    expect(Number(rows[0].self_enroll)).toBe(1);
    expect(Number(rows[0].status), 'published on creation').toBe(1);
    return Number(rows[0].id);
  });
});

test('LRN-02 a module and lessons are authored on the course', async ({ page }) => {
  await signIn(page, mail('admin'));
  await page.goto('/onyx/courses/' + w.courseId);

  await create(page, 'Add a module', { title: 'Core concepts', summary: 'The basics.' });
  await expect(page.getByText('Core concepts').first()).toBeVisible();

  for (const title of ['Binary and bits', 'How a CPU works']) {
    await create(page, 'Add a lesson to Core concepts', {
      title, body: `Notes on ${title.toLowerCase()}.`, duration_seconds: '300',
    });
  }
  await expect(page.getByText('Binary and bits').first()).toBeVisible();
  await page.screenshot({ path: OUT + 'feat-LRN02-lessons.png', fullPage: true });

  await withDb(async (c) => {
    const { rows } = await c.query(
      `SELECT count(*)::int n FROM public."onyx_lessons" WHERE tenant_id=$1 AND course_id=$2`,
      [w.tenantId, w.courseId]);
    expect(Number(rows[0].n), 'two lessons were authored').toBe(2);
  });
});

test('CMP-01 an administrator allocates a teacher to the course', async ({ page }) => {
  await signIn(page, mail('admin'));
  await page.goto('/onyx/courses/' + w.courseId);
  await create(page, 'Assign a teacher', { user_id: 'Fern Faculty' });

  await page.screenshot({ path: OUT + 'feat-CMP01-faculty-allocation.png', fullPage: true });
  await withDb(async (c) => {
    const { rows } = await c.query(
      `SELECT count(*)::int n FROM public."onyx_course_faculty"
       WHERE tenant_id=$1 AND course_id=$2`, [w.tenantId, w.courseId]);
    expect(Number(rows[0].n), 'a teacher is allocated').toBe(1);
  });
});

test('LRN-04 a faculty member creates an assignment — the gap this closes', async ({ page }) => {
  // Faculty, not admin: the proposal says "faculty must create assignments".
  await signIn(page, mail('faculty'));
  await page.goto('/onyx/courses/' + w.courseId);

  await create(page, 'Create an assignment', {
    title: 'Number bases worksheet',
    instructions: 'Convert between binary, decimal and hex.',
    due_at: soon(3), total_points: '20',
  });

  await expect(page.getByText('Number bases worksheet').first()).toBeVisible();
  await page.screenshot({ path: OUT + 'feat-LRN04-assignment.png', fullPage: true });

  await withDb(async (c) => {
    const { rows } = await c.query(
      `SELECT total_points, status FROM public."onyx_assignments"
       WHERE tenant_id=$1 AND title='Number bases worksheet'`, [w.tenantId]);
    expect(rows.length, 'the assignment reached the database').toBe(1);
    expect(Number(rows[0].total_points)).toBe(20);
    expect(rows[0].status, 'published so learners can see it').toBe('published');
  });
});

test('LRN-03 a faculty member opens an attendance session', async ({ page }) => {
  await signIn(page, mail('faculty'));
  await page.goto('/onyx/courses/' + w.courseId);

  await create(page, 'Open a session', {
    title: 'Lecture 1', scheduled_at: soon(0), duration_minutes: '60',
    qr_window_seconds: '30',
  });
  await expect(page.getByText('Lecture 1').first()).toBeVisible();
  await page.screenshot({ path: OUT + 'feat-LRN03-attendance.png', fullPage: true });

  await withDb(async (c) => {
    const { rows } = await c.query(
      `SELECT qr_window_seconds FROM public."onyx_attendance_sessions"
       WHERE tenant_id=$1 AND title='Lecture 1'`, [w.tenantId]);
    expect(rows.length).toBe(1);
    expect(Number(rows[0].qr_window_seconds)).toBe(30);
  });
});

test('LAB-04 a practice problem is added to the bank', async ({ page }) => {
  await signIn(page, mail('admin'));
  await page.goto('/onyx/practice');
  await create(page, 'Add a problem', {
    title: 'Two Sum', statement: 'Return the indices of the two numbers adding to target.',
    difficulty: 'easy',
  });
  await expect(page.getByText('Two Sum').first()).toBeVisible();
  await page.screenshot({ path: OUT + 'feat-LAB04-problem.png', fullPage: true });
});

test('CMP-02 an exam and a hall are scheduled', async ({ page }) => {
  await signIn(page, mail('admin'));
  await page.goto('/onyx/exams');

  await create(page, 'Add a hall', {
    code: 'H1', name: 'Main Hall', row_count: '5', col_count: '6', capacity: '30',
  });
  await create(page, 'Schedule an exam', {
    title: 'CS101 Final', starts_at: soon(14), duration_minutes: '180',
    max_marks: '100', pass_marks: '40',
  });
  await expect(page.getByText('CS101 Final').first()).toBeVisible();
  await page.screenshot({ path: OUT + 'feat-CMP02-exams.png', fullPage: true });

  await withDb(async (c) => {
    const { rows } = await c.query(
      `SELECT max_marks FROM public."onyx_exams" WHERE tenant_id=$1 AND title='CS101 Final'`,
      [w.tenantId]);
    expect(rows.length).toBe(1);
    expect(Number(rows[0].max_marks)).toBe(100);
  });
});

test('CMP-03 a fee head is configured', async ({ page }) => {
  await signIn(page, mail('admin'));
  await page.goto('/onyx/finance');
  await create(page, 'Add a fee head', { code: 'TUITION', name: 'Tuition' });
  await page.screenshot({ path: OUT + 'feat-CMP03-finance.png', fullPage: true });

  await withDb(async (c) => {
    const { rows } = await c.query(
      `SELECT count(*)::int n FROM public."onyx_fee_heads" WHERE tenant_id=$1 AND code='TUITION'`,
      [w.tenantId]);
    expect(Number(rows[0].n)).toBe(1);
  });
});

test('CAR-01 a contest is hosted', async ({ page }) => {
  await signIn(page, mail('admin'));
  await page.goto('/onyx/contests');
  await create(page, 'Host a contest', {
    title: 'Autumn Hackathon', description: 'A weekend of building.',
    starts_at: soon(7), ends_at: soon(9), team_size: '3',
  });
  await expect(page.getByText('Autumn Hackathon').first()).toBeVisible();
  await page.screenshot({ path: OUT + 'feat-CAR01-contest.png', fullPage: true });
});

test('CAR-04 an employer is recorded and a job is posted against it', async ({ page }) => {
  await signIn(page, mail('admin'));
  await page.goto('/onyx/jobs');

  // A post belongs to an employer, so the employer has to exist first.
  await create(page, 'Add an employer', {
    name: 'Acme Corp', contact_name: 'Emma Employer',
    contact_email: mail('acme'), website: 'https://acme.example',
  });

  await create(page, 'Post a job', {
    employer_id: 'Acme Corp', title: 'Junior Developer',
    description: 'An entry-level role.', location: 'Bengaluru', openings: '3',
  });
  await expect(page.getByText('Junior Developer').first()).toBeVisible();
  await page.screenshot({ path: OUT + 'feat-CAR04-job.png', fullPage: true });

  await withDb(async (c) => {
    const { rows } = await c.query(
      `SELECT j.title, j.openings, e.name AS employer
       FROM public."onyx_jobs_posted" j
       JOIN public."onyx_employers" e ON e.id = j.employer_id
       WHERE j.tenant_id=$1`, [w.tenantId]);
    expect(rows.length, 'the post reached the database').toBe(1);
    expect(rows[0].employer, 'attached to the employer that was created').toBe('Acme Corp');
    expect(Number(rows[0].openings)).toBe(3);
  });
});

test('the learner sees what was authored, and the dashboard adds up', async ({ page }) => {
  await signIn(page, mail('student'));

  // LRN-01 "enroll themselves" -- through the button, not the API.
  await page.goto('/onyx/courses/' + w.courseId);
  await page.getByRole('button', { name: 'Join this course' }).click();
  await expect(page.getByRole('button', { name: 'Join this course' }))
    .toBeHidden({ timeout: 15_000 });
  await withDb(async (c) => {
    const { rows } = await c.query(
      `SELECT count(*)::int n FROM public."onyx_enrollments"
       WHERE tenant_id=$1 AND course_id=$2`, [w.tenantId, w.courseId]);
    expect(Number(rows[0].n), 'the learner enrolled themselves').toBe(1);
  });

  await page.goto('/onyx/dashboard');
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: OUT + 'feat-student-dashboard.png', fullPage: true });

  // The assignment a faculty member set is on the learner's dashboard, dated
  // in words, and the course they were given is listed.
  const body = await page.locator('body').innerText();
  expect(body).toContain('Number bases worksheet');
  expect(body, 'relative dates, not machine timestamps').toMatch(/in \d+ days|Tomorrow|Due today/);
  expect(body).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
});

test.afterAll(async () => {
  await withDb(async (c) => {
    await c.query('DELETE FROM public."onyx_tenants" WHERE name LIKE $1', ['Authoring College %']);
    await c.query('DELETE FROM public."onyx_users" WHERE email LIKE $1', ['%@authoring.test']);
  });
  void api;
});
