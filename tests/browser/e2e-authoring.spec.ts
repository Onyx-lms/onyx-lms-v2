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
  await page.getByLabel('Password', { exact: true }).fill(PW);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForFunction(() => !location.pathname.endsWith('/onyx/login'), null,
    { timeout: 15_000 });
}

/** Open a CreatePanel by its button, fill it, submit, wait for the refresh. */
async function create(page: Page, cta: string, values: Record<string, string | boolean>,
  submitLabel = cta) {
  await page.getByRole('button', { name: cta, exact: true }).first().click();
  // Two shapes of panel: one that expands in place, whose submit repeats the
  // trigger's words, and one that opens as a Modal, where the trigger stays
  // outside the form and the dialog carries the title. Filtering on the submit
  // button only ever found the first.
  const form = page.locator('form')
    .filter({ has: page.getByRole('button', { name: submitLabel }) })
    .or(page.getByRole('dialog').locator('form'));
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
  // A modal's submit is named for the act ("Create", "Add the lesson"), not
  // for the trigger that opened it, so fall back to the form's own submit.
  const named = form.getByRole('button', { name: submitLabel });
  if (await named.count()) await named.click();
  else await form.locator('button[type="submit"]').first().click();
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
  await page.getByLabel('Password', { exact: true }).fill(PLATFORM.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL('**/onyx/platform', { timeout: 15_000 });

  await page.getByRole('button', { name: 'Create an institution' }).click();
  await page.locator('#ct-name').fill(NAME);
  await page.locator('#ct-admin-name').fill('Authoring Admin');
  await page.locator('#ct-admin-email').fill(mail('admin'));
  await page.locator('#ct-admin-password').fill(PW);
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  // Scoped to the directory table: the overview's right rail also lists
  // institutions ("Largest institutions"), and a brand-new one lands in both
  // on a platform with few customers -- an unscoped locator resolved to two.
  await expect(page.getByLabel('Institutions', { exact: true })
    .getByRole('link', { name: NAME })).toBeVisible({ timeout: 15_000 });

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
    description: 'Where everyone starts.',
    // `self_enroll` stopped being a checkbox when open/locked courses landed:
    // the form asks how learners get on, and the server derives self_enroll
    // from the answer (see updateCourse), so the two cannot disagree. This
    // spec was still ticking a box that no longer exists.
    access: 'Open — anyone here may start it, free',
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
    // A text lesson. `duration_seconds` was filled here too, but the composer
    // only shows that field for a video -- the two are mutually exclusive, and
    // asking for both meant waiting on an input that is never rendered.
    await create(page, 'Add a lesson to Core concepts', {
      title, body: `Notes on ${title.toLowerCase()}.`,
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
  // The trigger says "Assign a teacher"; the form's own submit says "Assign".
  await create(page, 'Assign a teacher', { user_id: 'Fern Faculty' }, 'Assign');

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

test('CMP-02c marks are entered, moderated and only then published', async ({ page }) => {
  // The longest flow in this file: create a candidate, enrol them, mark them,
  // moderate the paper and publish it, with a database check after each. The
  // default thirty seconds is not enough for six page loads against a
  // deployment.
  test.setTimeout(180_000);
  // The step that had an API and no way to reach it. Without it a board that
  // agreed a paper was marked two points harsh had to publish it anyway or
  // edit scripts one at a time.
  await signIn(page, mail('admin'));
  await page.goto('/onyx/exams');
  await page.getByRole('link', { name: /CS101 Final/ }).first().click();
  await page.waitForURL((u) => /\/onyx\/exams\/\d+$/.test(u.pathname), { timeout: 20_000 });
  const examUrl = page.url();

  // Marks first: there is nothing to moderate until somebody has been marked,
  // and the panel says so rather than offering an action that can only fail.
  await expect(page.getByText(/nothing left to moderate/i)).toBeVisible();

  // Somebody has to be sitting the paper, and it must not be Stu Student.
  //
  // The last test in this file is about a learner enrolling THEMSELVES, so
  // enrolling Stu here left it with no "Join this course" button to press and
  // broke it. A candidate of this test's own keeps both meaningful, and is
  // truer anyway: a cohort is not one person.
  await page.goto('/onyx/people');
  await page.getByRole('button', { name: 'Add someone' }).click();
  await page.locator('input[name="name"]').fill('Ex Examinee');
  await page.locator('input[name="email"]').fill(mail('examinee'));
  await page.locator('select[name="role"]').selectOption('student');
  await page.locator('input[name="password"]').fill(PW);
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Added.', { timeout: 15_000 });

  // On the course, through the roster manager -- a screen worth exercising.
  await page.goto('/onyx/courses/' + w.courseId);
  // Asserted, not attempted. An `if (await ...count())` around this swallowed
  // the real failure and surfaced it six lines later as "the roster is empty",
  // which named a symptom and not the step that went wrong.
  const enrol = page.getByRole('button', { name: 'Enrol a student' });
  await expect(enrol, 'the roster manager is not on the course page').toBeVisible();
  await enrol.click();

  // The form is open before anything is typed into it. `toHaveCount(0)` on the
  // submit button was the previous check and it passes vacuously when the form
  // never opened at all, which is how a failure here read as an empty roster
  // two steps later.
  const picker = page.getByLabel('Student to enrol on this course');
  await expect(picker).toBeVisible();
  await picker.selectOption({ label: 'Ex Examinee' });
  await page.getByRole('button', { name: 'Enrol', exact: true }).click();

  // The panel reports its own failures in an alert. Read it, so a refusal
  // arrives as the message the product gave rather than as a missing row.
  const refusal = page.getByRole('alert');
  if (await refusal.count()) {
    expect(await refusal.first().innerText(), 'the roster manager refused').toBe('');
  }
  await expect(picker).toBeHidden({ timeout: 20_000 });

  // It really landed, and it landed on the right person. The last test in this
  // file is about Stu enrolling themselves, so this one putting Stu on the
  // course would quietly break it -- asserted here, where the cause is, rather
  // than discovered there as a missing button.
  await withDb(async (c) => {
    const { rows } = await c.query(
      `SELECT u.email FROM public."onyx_enrollments" e
         JOIN public."onyx_users" u ON u.id = e.user_id
        WHERE e.tenant_id = $1 AND e.course_id = $2 AND e.status = 1`,
      [w.tenantId, w.courseId]);
    const emails = rows.map((r) => String(r.email));
    expect(emails, 'the exam candidate was not enrolled').toContain(mail('examinee'));
    expect(emails, 'this test enrolled the learner the last test is about')
      .not.toContain(mail('student'));
  });

  await page.goto(examUrl);
  await page.getByRole('button', { name: 'Enter marks', exact: true }).first().click();

  // Marks entry expands IN PLACE rather than opening a Modal -- this file's own
  // `create` helper already knows both shapes exist. `getByRole('dialog')`
  // matched nothing here and every locator scoped to it counted zero, which
  // read as an empty roster rather than as the wrong container.
  const boxes = page.getByLabel(/^Marks for /);
  const n = await boxes.count();
  expect(n, 'nobody is on the roster, so nothing can be marked').toBeGreaterThan(0);
  for (let i = 0; i < n; i++) await boxes.nth(i).fill('50');
  await page.getByRole('button', { name: 'Enter marks', exact: true }).last().click();
  await expect(page.getByLabel(/^Marks for /)).toHaveCount(0, { timeout: 20_000 });

  // Now moderate. The reason is required -- a grade change nobody can account
  // for later is the thing this exists to prevent -- so the button stays
  // disabled until there is one.
  await page.getByRole('button', { name: 'Moderate', exact: true }).click();
  const mod = page.getByRole('dialog');
  await mod.getByLabel('Adjustment').fill('5');
  await expect(mod.getByRole('button', { name: /^Apply to/ })).toBeDisabled();
  await mod.getByLabel('Why').fill('Question 4 was ambiguous; the board agreed five marks back.');
  await mod.getByRole('button', { name: /^Apply to/ }).click();
  await expect(mod).toBeHidden({ timeout: 20_000 });

  // The raw mark is KEPT and the delta stored beside it, so the board's
  // decision and the marker's judgement stay separable afterwards.
  await withDb(async (c) => {
    const { rows } = await c.query(
      // Every column qualified: onyx_exams has a `status` of its own, so an
      // unqualified one is ambiguous rather than merely unclear.
      `SELECT m.raw_marks, m.moderation_delta, m.final_marks, m.status
         FROM public."onyx_exam_marks" m
         JOIN public."onyx_exams" e ON e.id = m.exam_id
        WHERE m.tenant_id = $1 AND e.title = 'CS101 Final' LIMIT 1`, [w.tenantId]);
    expect(rows.length).toBe(1);
    expect(Number(rows[0].raw_marks)).toBe(50);
    expect(Number(rows[0].moderation_delta)).toBe(5);
    expect(Number(rows[0].final_marks)).toBe(55);
    expect(rows[0].status).toBe('moderated');
  });

  // And it is in the audit log with the reason, against a name.
  await withDb(async (c) => {
    const { rows } = await c.query(
      `SELECT after FROM public."onyx_audit_logs"
        WHERE tenant_id = $1 AND action = 'marks.moderated'
        ORDER BY id DESC LIMIT 1`, [w.tenantId]);
    expect(rows.length).toBe(1);
    expect(String(JSON.stringify(rows[0].after))).toContain('ambiguous');
  });

  await page.goto(examUrl);
  await page.screenshot({ path: OUT + 'feat-CMP02c-moderation.png', fullPage: true });

  // Published marks are left alone by the service, so the control goes once
  // results are out.
  //
  // ActionButton asks with a native window.confirm, and Playwright DISMISSES
  // native dialogs unless something says otherwise -- so the previous version
  // of this clicked Publish, had the confirmation silently cancelled, and then
  // waited twenty seconds for a banner that was never going to appear.
  page.once('dialog', (d) => { void d.accept(); });
  await page.getByRole('button', { name: /publish results/i }).click();
  await expect(page.getByText(/results published/i)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('button', { name: 'Moderate', exact: true })).toHaveCount(0);
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
  // Asserted first, so "this learner is already enrolled" fails as itself
  // rather than as a button that never appeared.
  await expect(page.getByText('You are not enrolled in this course')).toBeVisible();
  await page.getByRole('button', { name: 'Join this course' }).click();
  await expect(page.getByRole('button', { name: 'Join this course' }))
    .toBeHidden({ timeout: 15_000 });
  // THIS learner, not "the course has exactly one enrolment". CMP-02c puts a
  // candidate of its own on the course so it has somebody to mark without
  // stealing this test's Join button, and a bare count would measure that
  // candidate as much as this one.
  //
  // Polled rather than read once. The browser wrote through the app's pooled
  // connection and this reads over a separate direct one, so the row is
  // occasionally not visible here in the instant after the button disappears.
  // A single read made this test fail about one run in three, which is the
  // most expensive kind of test there is: the code was right every time.
  await expect.poll(async () => withDb(async (c) => {
    const { rows } = await c.query(
      `SELECT u.email, e.status FROM public."onyx_enrollments" e
         JOIN public."onyx_users" u ON u.id = e.user_id
        WHERE e.tenant_id=$1 AND e.course_id=$2`,
      [w.tenantId, w.courseId]);
    // Listed rather than counted, so a failure says who is actually on the
    // course instead of only that the number was wrong.
    return rows.map((r) => String(r.email) + ':' + r.status);
  }), { timeout: 20_000, message: 'the learner enrolled themselves' })
    .toContain(mail('student') + ':1');

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
