/**
 * The steps that come AFTER something has been created -- all through the
 * browser, no API calls anywhere in this file.
 *
 * `e2e-authoring.spec.ts` proves everything the proposal says somebody "must
 * be able to create" can be created. This file proves the rest of each
 * sentence: an exam is not finished when it is scheduled, it is finished when
 * candidates are seated, marked, moderated, published and transcribed. Those
 * steps existed on the API and had no screen, so the product could start work
 * it could not finish.
 *
 *   CMP-02c  seat, mark, moderate, publish, transcribe
 *   CMP-03   fee structure -> invoice -> what is owed
 *   ASS-01   question bank -> questions -> a paper drawn from them
 *   LAB-03   test cases on a problem, and publishing it
 *   CAR-04   employer -> post -> a learner applies -> shortlisted -> drive
 *   CAR-02   a skill defined, awarded, and on the learner's passport
 *   CMP-04   a guardian created, linked, and blind until they accept
 *   CMP-01b  a room, a class, and a timetable published to the learners
 */
import { test, expect, type Page } from '@playwright/test';
import { withDb, RUN } from './helpers.ts';

const PW = 'Downstream#2026';
const PLATFORM = { email: 'superadmin@onyx.platform', password: 'Platform#2026!' };
const NAME = 'Downstream College ' + RUN;
const mail = (who: string) => `${who}.${RUN}@downstream.test`;
const OUT = 'C:/Users/TURBOS~1/AppData/Local/Temp/';

const w = { tenantId: 0, courseId: 0, examId: 0, bankId: 0, problemId: 0, jobId: 0 };

test.describe.configure({ mode: 'serial' });

// These walk whole workflows -- seat, mark, moderate, publish -- so they are
// long by nature rather than by being slow. The ceiling is generous because
// the suite shares one real Supabase with whatever else is running beside it,
// and a workflow that takes 40s alone can take three times that under load.
test.beforeEach(() => { test.setTimeout(300_000); });

async function signIn(page: Page, email: string) {
  // Several of these tests change hands mid-way -- an administrator sets
  // something, then the learner it was set for looks at it. The session
  // cookie has to go first: /onyx/login redirects away when one is already
  // held, so signing in as the next person would silently keep the last one.
  await page.context().clearCookies();
  await page.goto('/onyx/login');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(PW);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForFunction(() => !location.pathname.endsWith('/onyx/login'), null,
    { timeout: 15_000 });
}

/**
 * The panel that is currently open.
 *
 * Deliberately NOT located by its submit button: that button reads "Saving…"
 * while the request is in flight, so a locator filtered on the button label
 * resolves to nothing mid-save -- and an empty locator satisfies
 * `toBeHidden()`. The suite then walked on and asserted against a database
 * the panel had not finished writing to. The heading is the one part of a
 * panel that does not change while it works.
 */
const panelOf = (page: Page) => page.locator('form')
  .filter({ has: page.locator('h3') })
  // A create panel that opens as a Modal has no h3 of its own: the dialog
  // supplies the title as its h2, so the form inside carries only fields.
  // The roster's "Add a student" is one of these.
  .or(page.getByRole('dialog').locator('form'));

/**
 * Submit, and if the click did nothing at all, submit once more.
 *
 * These panels sit in a page that re-renders whenever the previous one saved
 * (`router.refresh()`). A click landing in that window reaches a node React is
 * replacing: no request, no error, no pending state -- the form just sits
 * there. That is the only case retried here; a panel that is mid-save (the
 * button reads "Saving…") or showing an error is left alone, so a genuine
 * refusal still fails the test.
 */
async function submit(page: Page) {
  const form = panelOf(page);
  const button = form.locator('button[type="submit"]');
  await button.click();
  await page.waitForTimeout(1200);
  if (await form.isVisible().catch(() => false)) {
    const label = await button.innerText().catch(() => '');
    const alerted = await form.getByRole('alert').isVisible().catch(() => false);
    if (!alerted && !/Saving/.test(label)) await button.click().catch(() => {});
  }
  await expect(form, 'the panel closes on success; an error keeps it open')
    .toBeHidden({ timeout: 30_000 });
}

/** Open a panel by its button, fill the named fields, submit. */
async function create(page: Page, cta: string, values: Record<string, string | boolean>) {
  await page.getByRole('button', { name: cta, exact: true }).first().click();
  const form = panelOf(page);
  for (const [name, value] of Object.entries(values)) {
    const field = form.locator(`[name="${name}"]`).first();
    if (typeof value === 'boolean') { if (value) await field.check(); continue; }
    const tag = await field.evaluate((el) => el.tagName.toLowerCase());
    // Match a select on its visible label -- the option values are database
    // ids, which a test has no business knowing.
    if (tag === 'select') await field.selectOption({ label: value });
    else await field.fill(value);
  }
  await submit(page);
}

/** The same, for the list-shaped panels whose fields are not a flat spec. */
async function manage(page: Page, cta: string,
  fill: (form: ReturnType<Page['locator']>) => Promise<void>) {
  await page.getByRole('button', { name: cta, exact: true }).first().click();
  await fill(panelOf(page));
  await submit(page);
}

const soon = (days: number) => {
  const d = new Date(Date.now() + days * 86_400_000);
  d.setSeconds(0, 0);
  return d.toISOString().slice(0, 16);
};

test('setup: an institution with a course, a teacher and two learners', async ({ page }) => {
  await page.goto('/onyx/platform/login');
  await page.getByLabel('Email address').fill(PLATFORM.email);
  await page.getByLabel('Password').fill(PLATFORM.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL('**/onyx/platform', { timeout: 15_000 });

  await page.getByRole('button', { name: 'Create an institution' }).click();
  await page.locator('#ct-name').fill(NAME);
  await page.locator('#ct-admin-name').fill('Down Admin');
  await page.locator('#ct-admin-email').fill(mail('admin'));
  await page.locator('#ct-admin-password').fill(PW);
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  // Scoped to the directory table: the overview's right rail also lists
  // institutions, so an unscoped locator can resolve to two.
  await expect(page.getByLabel('Institutions', { exact: true })
    .getByRole('link', { name: NAME })).toBeVisible({ timeout: 15_000 });

  w.tenantId = await withDb(async (c) => Number(
    (await c.query('SELECT id FROM public."onyx_tenants" WHERE name=$1', [NAME])).rows[0].id));

  await signIn(page, mail('admin'));
  await page.goto('/onyx/people');
  for (const [name, email, role] of [
    ['Faye Teacher', mail('faculty'), 'faculty'],
    ['Ana Learner', mail('ana'), 'student'],
    ['Ben Learner', mail('ben'), 'student'],
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

  // An exam belongs to a semester, so the calendar has to exist before the
  // examinations that sit inside it.
  await page.goto('/onyx/programs');
  await create(page, 'Add a programme',
    { name: 'Mathematics', code: 'MATH', duration_semesters: '6' });
  await create(page, 'Add a semester',
    { name: 'Term 1 2026', number: '1', starts_on: '2026-01-05', ends_on: '2026-06-05' });
  // A timetable slot names a batch, so the cohort has to exist as well.
  await create(page, 'Add a batch', { name: 'Batch A 2026', code: 'BA26', year: '2026' });

  await page.goto('/onyx/courses');
  await create(page, 'Create a course', {
    code: 'MA201', title: 'Discrete Mathematics', credits: '4',
    // The form asks how learners get on; the server derives self_enroll from
    // the answer. The self_enroll checkbox this used to tick is gone.
    access: 'Open — anyone here may start it, free',
  });
  w.courseId = await withDb(async (c) => Number((await c.query(
    `SELECT id FROM public."onyx_courses" WHERE tenant_id=$1 AND code='MA201'`,
    [w.tenantId])).rows[0].id));

  // Somebody has to teach it.
  //
  // Every faculty-side test below -- banks, papers, marking -- goes through
  // `assertCanTeach`, which answers "You do not teach this course" to a
  // lecturer who is not on it. The fixture never put one there, so the refusal
  // was correct and the setup was incomplete.
  //
  // On the COURSE, not on /onyx/allocations. Those are two different facts and
  // only one of them is a permission: `assertCanTeach` reads
  // onyx_course_faculty, while an allocation records teaching load in its own
  // table and grants nothing. Allocating there and expecting to be let in is
  // the mistake this comment exists to stop somebody repeating.
  //
  // It could not have been noticed until now either way: assigning a teacher
  // through the product was itself broken, because the panel's `user_id` field
  // was marked numeric and a uuid through Number() is NaN.
  // Driven directly rather than through `create`: this panel's form carries no
  // h3, so `panelOf` -- which finds a panel by its heading -- does not match
  // it, and every field lookup inside would wait out the whole test budget.
  await page.goto('/onyx/courses/' + w.courseId);
  await page.getByRole('button', { name: 'Assign a teacher' }).click();
  const picker = page.getByLabel('Faculty member to assign to this course');
  await expect(picker).toBeVisible();
  await picker.selectOption({ label: 'Faye Teacher' });
  await page.getByRole('button', { name: 'Assign', exact: true }).click();
  await expect(picker).toBeHidden({ timeout: 20_000 });

  // Polled: the browser writes over the app's pooled connection and this reads
  // over a separate direct one, so the row is occasionally not yet visible
  // here in the instant the panel closes.
  await expect.poll(async () => withDb(async (c) => Number((await c.query(
    `SELECT count(*)::int n FROM public."onyx_course_faculty"
      WHERE tenant_id=$1 AND course_id=$2`, [w.tenantId, w.courseId])).rows[0].n)),
  { timeout: 20_000, message: 'the teacher was put on the course' }).toBe(1);

  // Both learners enrol themselves, because seating and marking work off the
  // roster -- an exam with nobody on the course has nobody to seat.
  for (const who of ['ana', 'ben']) {
    await signIn(page, mail(who));
    await page.goto('/onyx/courses/' + w.courseId);
    await page.getByRole('button', { name: 'Join this course' }).click();
    await expect(page.getByRole('button', { name: 'Join this course' }))
      .toBeHidden({ timeout: 15_000 });
  }
});

test('CMP-02 an exam is seated, marked, moderated and published', async ({ page }) => {
  await signIn(page, mail('admin'));
  await page.goto('/onyx/exams');

  await create(page, 'Add a hall', {
    code: 'DH1', name: 'Downstream Hall', row_count: '4', col_count: '5', capacity: '20',
  });
  await create(page, 'Schedule an exam', {
    title: 'MA201 Mid-term', course_id: 'MA201 — Discrete Mathematics',
    semester_id: 'Term 1 2026', starts_at: soon(10),
    duration_minutes: '90', max_marks: '50', pass_marks: '20',
  });

  w.examId = await withDb(async (c) => Number((await c.query(
    `SELECT id FROM public."onyx_exams" WHERE tenant_id=$1 AND title='MA201 Mid-term'`,
    [w.tenantId])).rows[0].id));

  await page.goto('/onyx/exams/' + w.examId);

  // --- seating -----------------------------------------------------------
  await manage(page, 'Allocate seating', async (form) => {
    await form.getByRole('checkbox').first().check();
  });
  await page.screenshot({ path: OUT + 'feat-CMP02-seating.png', fullPage: true });

  const seats = await withDb(async (c) => Number((await c.query(
    `SELECT count(*)::int n FROM public."onyx_seat_allocations" WHERE tenant_id=$1 AND exam_id=$2`,
    [w.tenantId, w.examId])).rows[0].n));
  expect(seats, 'both candidates were given a seat').toBe(2);

  // --- marks -------------------------------------------------------------
  await manage(page, 'Enter marks', async (form) => {
    const boxes = form.locator('input[type="number"]');
    await boxes.nth(0).fill('44');
    await boxes.nth(1).fill('31');
  });
  await page.screenshot({ path: OUT + 'feat-CMP02-marks.png', fullPage: true });

  await withDb(async (c) => {
    const { rows } = await c.query(
      `SELECT raw_marks, final_marks, status FROM public."onyx_exam_marks"
       WHERE tenant_id=$1 AND exam_id=$2 ORDER BY raw_marks DESC`, [w.tenantId, w.examId]);
    expect(rows.length, 'both candidates were marked').toBe(2);
    expect(Number(rows[0].raw_marks)).toBe(44);
    expect(rows[0].status, 'entered, not yet published').toBe('entered');
  });

  // --- moderation --------------------------------------------------------
  await create(page, 'Moderate', { delta: '3', reason: 'Question 4 was ambiguous.' });
  await withDb(async (c) => {
    const { rows } = await c.query(
      `SELECT raw_marks, moderation_delta, final_marks FROM public."onyx_exam_marks"
       WHERE tenant_id=$1 AND exam_id=$2 ORDER BY raw_marks DESC`, [w.tenantId, w.examId]);
    expect(Number(rows[0].raw_marks), 'the raw mark is untouched').toBe(44);
    expect(Number(rows[0].moderation_delta)).toBe(3);
    expect(Number(rows[0].final_marks), 'the board decision is what counts').toBe(47);
  });

  // --- publication -------------------------------------------------------
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Publish results' }).click();
  await expect(page.getByText('Results published')).toBeVisible({ timeout: 20_000 });
  await page.screenshot({ path: OUT + 'feat-CMP02-published.png', fullPage: true });

  await withDb(async (c) => {
    const { rows } = await c.query(
      `SELECT count(*)::int n FROM public."onyx_exam_marks"
       WHERE tenant_id=$1 AND exam_id=$2 AND status='published'`, [w.tenantId, w.examId]);
    expect(Number(rows[0].n)).toBe(2);
  });
});

test('CMP-02c the learner sees the published mark, and only then', async ({ page }) => {
  await signIn(page, mail('ana'));
  await page.goto('/onyx/results');
  const body = await page.locator('body').innerText();
  // 47 or 34: whichever of the two this learner is, the moderated figure is
  // what they are shown, never the raw one.
  expect(body).toMatch(/\b(47|34)\b/);
  await page.screenshot({ path: OUT + 'feat-CMP02-learner-result.png', fullPage: true });
});

test('CMP-02c a transcript is issued and can be verified', async ({ page }) => {
  await signIn(page, mail('admin'));
  await page.goto('/onyx/results');
  await create(page, 'Issue a transcript', { user_id: 'Ana Learner' });
  await page.screenshot({ path: OUT + 'feat-CMP02-transcript.png', fullPage: true });

  const serial = await withDb(async (c) => {
    const { rows } = await c.query(
      `SELECT serial, checksum FROM public."onyx_transcripts" WHERE tenant_id=$1`,
      [w.tenantId]);
    expect(rows.length, 'a transcript was issued').toBe(1);
    expect(String(rows[0].checksum ?? ''), 'sealed with a checksum').not.toBe('');
    return String(rows[0].serial);
  });
  expect(serial.length, 'the serial is the thing a third party quotes').toBeGreaterThan(4);
});

test('CMP-03 a fee structure is built and an invoice raised against it', async ({ page }) => {
  await signIn(page, mail('admin'));
  await page.goto('/onyx/finance');

  await create(page, 'Add a fee head', { code: 'TUITION', name: 'Tuition' });
  await create(page, 'Add a fee head', { code: 'EXAM', name: 'Examination' });

  // Both heads reached the database, checked before anything that depends on
  // them. This file's rule is that everything is verified twice -- on the
  // screen and in the database -- and the second check is what tells a
  // failure in the builder below apart from a failure to create them at all.
  await withDb(async (c) => {
    const { rows } = await c.query(
      `SELECT code FROM public."onyx_fee_heads" WHERE tenant_id=$1 ORDER BY code`,
      [w.tenantId]);
    expect(rows.map((r) => String(r.code)), 'both fee heads were created')
      .toEqual(['EXAM', 'TUITION']);
  });

  // A fresh server render before the builder is opened.
  //
  // The builder's dropdown is filled on the server, so it offers only the
  // heads that existed when the page was last rendered. `create` closes the
  // panel and calls router.refresh(), but that lands asynchronously -- and
  // against a deployment rather than localhost it can land after the next
  // click. `selectOption` then waits for an option that does not exist yet
  // with no per-action timeout, swallowing the test's entire five-minute
  // budget and reporting an unrelated assertion as the failure.
  //
  // A reload rather than waiting for the head to appear on the page: it never
  // does. The finance screen passes the heads straight to the builder and does
  // not list them anywhere, so there is nothing to wait for except the render
  // itself.
  await page.reload();

  await manage(page, 'Build a fee structure', async (form) => {
    // Named in the failure if a head is missing, instead of a silent wait.
    // Ordered by CODE, which is how the service sorts them -- EXAM before
    // TUITION, so "Examination" comes before "Tuition" and the labels do not
    // read alphabetically.
    await expect(form.locator('#fs-head-0 option'),
      'the builder was rendered before the fee heads existed')
      .toContainText(['Choose a fee head', 'Examination', 'Tuition']);
    await form.locator('#fs-name').fill('Term 1 2026 fees');
    await form.locator('#fs-inst').fill('2');
    await form.locator('#fs-head-0').selectOption({ label: 'Tuition' });
    await form.locator('#fs-amt-0').fill('45000');
    await form.getByRole('button', { name: 'Add a line' }).click();
    await form.locator('#fs-head-1').selectOption({ label: 'Examination' });
    await form.locator('#fs-amt-1').fill('2500');
  });
  await page.screenshot({ path: OUT + 'feat-CMP03-structure.png', fullPage: true });

  await withDb(async (c) => {
    const { rows } = await c.query(
      `SELECT s.status, count(l.id)::int lines, sum(l.amount_minor)::bigint total
       FROM public."onyx_fee_structures" s
       JOIN public."onyx_fee_structure_lines" l ON l.structure_id = s.id
       WHERE s.tenant_id=$1 GROUP BY s.status`, [w.tenantId]);
    expect(rows.length, 'the structure reached the database').toBe(1);
    expect(rows[0].status, 'published, so an invoice can be raised from it').toBe('published');
    expect(Number(rows[0].lines)).toBe(2);
    // Rupees typed, paise stored: 47,500.00 is 4,750,000 paise.
    expect(Number(rows[0].total), 'rupees were converted to paise').toBe(4_750_000);
  });

  // A clean page before the next panel.
  //
  // `panelOf` finds a panel by its heading, and it is strict: two open at once
  // resolve to two elements and every assertion against it reports `undefined`
  // rather than a state. That happened here about one run in two -- the
  // structure builder had not finished closing when the invoice panel opened.
  // A reload guarantees exactly one, and also picks up the structure that was
  // just built, which this panel has to offer in its dropdown anyway.
  await page.reload();

  await create(page, 'Raise an invoice', {
    user_id: 'Ana Learner', structure_id: 'Term 1 2026 fees', due_at: soon(30),
  });
  await page.screenshot({ path: OUT + 'feat-CMP03-invoice.png', fullPage: true });

  await withDb(async (c) => {
    const { rows } = await c.query(
      `SELECT i.total_minor, count(l.id)::int lines
       FROM public."onyx_invoices" i
       LEFT JOIN public."onyx_invoice_lines" l ON l.invoice_id = i.id
       WHERE i.tenant_id=$1 GROUP BY i.id, i.total_minor`, [w.tenantId]);
    expect(rows.length, 'an invoice was raised').toBe(1);
    expect(Number(rows[0].lines), 'the lines were copied from the structure').toBe(2);
  });

  // The outstanding total on the page is the invoice, not a placeholder.
  await page.reload();
  await expect(page.getByText(/outstanding across 1 invoice/)).toBeVisible();
});

test('ASS-01 a bank is filled and a paper is drawn from it', async ({ page }) => {
  await signIn(page, mail('faculty'));
  await page.goto('/onyx/assessments');

  await create(page, 'New question bank', {
    name: 'Discrete maths — term 1', course_id: 'Discrete Mathematics',
  });
  w.bankId = await withDb(async (c) => Number((await c.query(
    `SELECT id FROM public."onyx_question_banks" WHERE tenant_id=$1`,
    [w.tenantId])).rows[0].id));

  await page.goto('/onyx/banks/' + w.bankId);
  await manage(page, 'Add a question', async (form) => {
    await form.locator('#q-prompt').fill('How many subsets does a set of 3 elements have?');
    await form.locator('#q-points').fill('2');
    await form.getByLabel('Option A', { exact: true }).fill('6');
    await form.getByLabel('Option B', { exact: true }).fill('8');
    await form.getByLabel('Option B is correct').check();
  });
  await manage(page, 'Add a question', async (form) => {
    await form.locator('#q-type').selectOption('truefalse');
    await form.locator('#q-prompt').fill('The empty set is a subset of every set.');
    await form.locator('#q-tf').selectOption('true');
  });
  await page.screenshot({ path: OUT + 'feat-ASS01-bank.png', fullPage: true });

  await withDb(async (c) => {
    const { rows } = await c.query(
      `SELECT type, answer, points FROM public."onyx_questions"
       WHERE tenant_id=$1 AND bank_id=$2 ORDER BY id`, [w.tenantId, w.bankId]);
    expect(rows.length, 'both questions were written').toBe(2);
    expect(rows[0].type).toBe('single');
    expect(Number(rows[0].points)).toBe(2);
    expect(String(rows[0].answer), 'the key is the option that was ticked').toContain('b');
    expect(rows[1].type).toBe('truefalse');
  });

  /*
   * The four-step composer, not the one-shot form this used to drive.
   *
   * "Set a paper" was replaced by PaperBuilder, whose trigger reads "Create a
   * paper" -- so this test had been looking for a button that no longer
   * existed, and had been doing so unnoticed because it sits behind three
   * other failures in a serial file. `BuildAssessment` in onyx-manage.tsx is
   * what it used to drive; nothing imports it any more.
   *
   * The steps are: what it is, where the questions come from, how it is sat,
   * then a preview. Publishing is deliberately only reachable from the last
   * one -- "Save as draft" is the primary exit everywhere else -- which is the
   * behaviour this test depends on when it asserts the paper is sittable.
   */
  await page.goto('/onyx/assessments');
  await page.getByRole('button', { name: 'Create a paper' }).click();

  await page.locator('#p-title').fill('Discrete maths quiz');
  await page.locator('#p-course').selectOption({ label: 'Discrete Mathematics' });
  await page.locator('#p-duration').fill('30');
  await page.getByRole('button', { name: 'Next' }).click();

  // One section, so `.first()` is unambiguous: the fields are numbered by the
  // section's own id rather than its position.
  await page.getByLabel('Draw from').first()
    .selectOption({ label: 'Discrete maths — term 1' });
  await page.getByLabel('Questions', { exact: true }).first().fill('2');
  await page.getByRole('button', { name: 'Next' }).click();

  // Step three is how it is sat; the defaults are what this test wants.
  await page.getByRole('button', { name: 'Preview the paper' }).click();

  // Publishing is the one action that puts a paper in front of candidates, so
  // it appears only once somebody has looked at a real dealt paper.
  const publish = page.getByRole('button', { name: 'Publish to candidates' });
  await expect(publish).toBeVisible({ timeout: 30_000 });
  await publish.click();

  // Waited on the composer, and on a part of it that is there at EVERY step.
  //
  // Two ways to get this wrong, and this test found both. The Publish button
  // relabels to "Publishing…" while the request is in flight, so a locator
  // naming it resolves to nothing mid-save and an empty locator satisfies
  // toBeHidden() at once. And `#p-title` belongs to step one, so by the time
  // Publish is reachable it is already gone -- the assertion passed instantly
  // and the database was read while the publish was still going, finding the
  // draft the preview step had saved. `submit()` at the top of this file
  // documents the first trap; the composer is not a CreatePanel and does not
  // go through it. "Save as draft" is the one control on every step whose
  // label does not change while it works.
  await expect(page.getByRole('button', { name: 'Save as draft' }))
    .toBeHidden({ timeout: 30_000 });
  await page.screenshot({ path: OUT + 'feat-ASS01-paper.png', fullPage: true });

  await withDb(async (c) => {
    const { rows } = await c.query(
      `SELECT title, status, duration_minutes, sections FROM public."onyx_assessments"
       WHERE tenant_id=$1`, [w.tenantId]);
    expect(rows.length, 'the paper was set').toBe(1);
    expect(rows[0].status, 'published, so it is sittable').toBe('published');
    expect(Number(rows[0].duration_minutes)).toBe(30);
    expect(JSON.stringify(rows[0].sections), 'the section draws from the bank')
      .toContain('"take":2');
  });

  // And the learner it was set for can see it.
  await signIn(page, mail('ana'));
  await page.goto('/onyx/assessments');
  await expect(page.getByRole('link', { name: 'Discrete maths quiz' })).toBeVisible();
});

test('LAB-03 a problem gets its test cases and is published', async ({ page }) => {
  await signIn(page, mail('faculty'));
  await page.goto('/onyx/practice');
  await create(page, 'Add a problem', {
    title: 'Sum two numbers', statement: 'Read two integers and print their sum.',
    difficulty: 'easy',
  });
  w.problemId = await withDb(async (c) => Number((await c.query(
    `SELECT id FROM public."onyx_problems" WHERE tenant_id=$1`,
    [w.tenantId])).rows[0].id));

  await page.goto('/onyx/practice/' + w.problemId);
  await manage(page, 'Set test cases and publish', async (form) => {
    await form.locator('#tc-in-0').fill('2 3');
    await form.locator('#tc-out-0').fill('5');
    await form.locator('#tc-in-1').fill('10 -4');
    await form.locator('#tc-out-1').fill('6');
  });
  await page.screenshot({ path: OUT + 'feat-LAB03-tests.png', fullPage: true });

  await withDb(async (c) => {
    const { rows } = await c.query(
      `SELECT count(*)::int n, sum(CASE WHEN is_hidden <> 0 THEN 1 ELSE 0 END)::int hidden
       FROM public."onyx_problem_tests" WHERE tenant_id=$1 AND problem_id=$2`,
      [w.tenantId, w.problemId]);
    expect(Number(rows[0].n), 'both cases were saved').toBe(2);
    expect(Number(rows[0].hidden), 'one is hidden, one is an example').toBe(1);

    const { rows: p } = await c.query(
      `SELECT status FROM public."onyx_problems" WHERE id=$1`, [w.problemId]);
    expect(p[0].status, 'a problem with cases is publishable').toBe('published');
  });

  // The learner sees the example and not the hidden one.
  await signIn(page, mail('ana'));
  await page.goto('/onyx/practice/' + w.problemId);
  const body = await page.locator('body').innerText();
  expect(body).toContain('2 3');
  expect(body, 'the hidden case is never sent to a candidate').not.toContain('10 -4');
});

test('CAR-04 an employer posts, a learner applies, the office shortlists', async ({ page }) => {
  await signIn(page, mail('admin'));
  await page.goto('/onyx/jobs');

  await create(page, 'Add an employer', {
    name: 'Dummy Employer Ltd', contact_name: 'Dee Recruiter',
    contact_email: mail('employer'), website: 'https://dummy.example',
  });
  await create(page, 'Post a job', {
    employer_id: 'Dummy Employer Ltd', title: 'Graduate Analyst',
    description: 'A first role for a maths graduate.', location: 'Hyderabad', openings: '2',
  });

  w.jobId = await withDb(async (c) => {
    const { rows } = await c.query(
      `SELECT id, status FROM public."onyx_jobs_posted" WHERE tenant_id=$1`, [w.tenantId]);
    expect(rows.length, 'the post reached the database').toBe(1);
    expect(rows[0].status, 'posting opens it -- a draft nobody can see is not a post')
      .toBe('open');
    return Number(rows[0].id);
  });
  await page.screenshot({ path: OUT + 'feat-CAR04-posted.png', fullPage: true });

  // --- the learner applies ------------------------------------------------
  await signIn(page, mail('ana'));
  await page.goto('/onyx/jobs/' + w.jobId);
  await page.getByRole('button', { name: /^Apply/ }).click();
  await expect(page.getByText(/applied/i).first()).toBeVisible({ timeout: 20_000 });
  await page.screenshot({ path: OUT + 'feat-CAR04-applied.png', fullPage: true });

  await withDb(async (c) => {
    const { rows } = await c.query(
      `SELECT status FROM public."onyx_job_applications" WHERE tenant_id=$1 AND job_id=$2`,
      [w.tenantId, w.jobId]);
    expect(rows.length, 'the application was recorded').toBe(1);
    expect(rows[0].status).toBe('applied');
  });

  // --- the office moves them down the pipeline ---------------------------
  await signIn(page, mail('admin'));
  await page.goto('/onyx/jobs/' + w.jobId);
  await expect(page.getByText('Ana Learner')).toBeVisible();
  await page.getByLabel('Decision for Ana Learner').selectOption('shortlisted');
  // The row re-renders from the server once the decision is recorded, so the
  // status cell changing is the acknowledgement -- there is no toast to wait on.
  await expect(page.getByRole('cell', { name: 'Shortlisted', exact: true }).first())
    .toBeVisible({ timeout: 20_000 });
  await page.screenshot({ path: OUT + 'feat-CAR04-shortlisted.png', fullPage: true });

  await withDb(async (c) => {
    const { rows } = await c.query(
      `SELECT status, decided_at FROM public."onyx_job_applications"
       WHERE tenant_id=$1 AND job_id=$2`, [w.tenantId, w.jobId]);
    expect(rows[0].status, 'shortlisted through the pipeline').toBe('shortlisted');
    expect(rows[0].decided_at, 'the decision is dated').not.toBeNull();
  });
});

test('CAR-02 a skill is defined and awarded, and reaches the passport', async ({ page }) => {
  await signIn(page, mail('admin'));
  await page.goto('/onyx/placement');

  await create(page, 'Add a skill', { name: 'Discrete reasoning', category: 'Mathematics' });
  await create(page, 'Award a skill', {
    user_id: 'Ana Learner', skill_id: 'Discrete reasoning', strength: '75',
  });
  await page.screenshot({ path: OUT + 'feat-CAR02-skill.png', fullPage: true });

  await withDb(async (c) => {
    const { rows } = await c.query(
      `SELECT ls.strength, s.name FROM public."onyx_learner_skills" ls
       JOIN public."onyx_skills" s ON s.id = ls.skill_id
       WHERE ls.tenant_id=$1`, [w.tenantId]);
    expect(rows.length, 'the award was recorded').toBe(1);
    expect(rows[0].name).toBe('Discrete reasoning');
    expect(Number(rows[0].strength)).toBe(75);
  });

  // And the learner sees it on their own passport, which is the point of it.
  await signIn(page, mail('ana'));
  await page.goto('/onyx/profile');
  await expect(page.getByText('Discrete reasoning').first()).toBeVisible();
});

test('CAR-04c a drive is scheduled and a round is recorded', async ({ page }) => {
  await signIn(page, mail('admin'));
  await page.goto('/onyx/placement');

  await manage(page, 'Schedule a drive', async (form) => {
    await form.locator('#dr-title').fill('Dummy Employer campus drive');
    await form.locator('#dr-emp').selectOption({ label: 'Dummy Employer Ltd' });
    await form.locator('#dr-job').selectOption({ label: 'Graduate Analyst' });
    await form.locator('#dr-when').fill(soon(5));
    await form.locator('#dr-venue').fill('Auditorium');
  });
  await page.screenshot({ path: OUT + 'feat-CAR04-drive.png', fullPage: true });

  const driveId = await withDb(async (c) => {
    const { rows } = await c.query(
      `SELECT d.id, count(r.id)::int rounds FROM public."onyx_drives" d
       LEFT JOIN public."onyx_drive_rounds" r ON r.drive_id = d.id
       WHERE d.tenant_id=$1 GROUP BY d.id`, [w.tenantId]);
    expect(rows.length, 'the drive was scheduled').toBe(1);
    expect(Number(rows[0].rounds), 'its rounds were named up front').toBe(2);
    return Number(rows[0].id);
  });

  await page.goto('/onyx/drives/' + driveId);
  // Ana was shortlisted for the post this drive runs against, so she is in it.
  await manage(page, 'Record Aptitude test', async (form) => {
    await form.getByLabel('Outcome for Ana Learner').selectOption('passed');
  });
  await page.screenshot({ path: OUT + 'feat-CAR04-round.png', fullPage: true });

  await withDb(async (c) => {
    const { rows } = await c.query(
      `SELECT outcome FROM public."onyx_drive_results" WHERE tenant_id=$1`, [w.tenantId]);
    expect(rows.length, 'the round result was recorded').toBe(1);
    expect(rows[0].outcome).toBe('passed');
  });

  // The summary counts it, which is the reconciliation CAR-04c asks for.
  await page.reload();
  await expect(page.getByRole('cell', { name: '1', exact: true }).first()).toBeVisible();
});

test('CMP-04 a guardian is created, linked, and sees nothing until they accept',
  async ({ page }) => {
    await signIn(page, mail('admin'));
    await page.goto('/onyx/people');
    await page.getByRole('button', { name: 'Add someone' }).click();
    await page.locator('input[name="name"]').fill('Gita Guardian');
    await page.locator('input[name="email"]').fill(mail('guardian'));
    await page.locator('select[name="role"]').selectOption('guardian');
    await page.locator('input[name="password"]').fill(PW);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Added.', { timeout: 15_000 });

    await create(page, 'Link a guardian', {
      guardian_user_id: 'Gita Guardian', student_user_id: 'Ana Learner',
      relationship: 'Parent',
    });
    await page.screenshot({ path: OUT + 'feat-CMP04-guardian.png', fullPage: true });

    await withDb(async (c) => {
      const { rows } = await c.query(
        `SELECT relationship, verified_at, can_view_results FROM public."onyx_guardians"
         WHERE tenant_id=$1`, [w.tenantId]);
      expect(rows.length, 'the link was made').toBe(1);
      expect(rows[0].relationship).toBe('Parent');
      expect(rows[0].verified_at,
        'an administrator cannot accept on the learner’s behalf').toBeNull();
      expect(rows[0].can_view_results, 'every category starts closed').toBe(false);
    });

    // Until the learner accepts, the link buys the guardian nothing.
    await signIn(page, mail('guardian'));
    await page.goto('/onyx/family');
    expect(await page.locator('body').innerText(),
      'an unaccepted link shows the guardian nothing').not.toContain('Ana Learner');

    // The learner accepts it, and opens exactly one category.
    await signIn(page, mail('ana'));
    await page.goto('/onyx/profile');
    await page.getByRole('button', { name: 'Accept' }).click();
    await expect(page.getByRole('button', { name: 'Accept' }))
      .toBeHidden({ timeout: 20_000 });
    // A click, not `check()`: the box is controlled by what the server says,
    // so it ticks only once the consent has actually been recorded.
    //
    // Named 'Courses, marks & assessments', not 'Results'. The category was
    // renamed to say what it actually opens -- a guardian shown "Results" does
    // not know whether that includes coursework -- and this test kept clicking
    // the old name, which matched a section heading rather than a checkbox.
    const consent = page.getByLabel('Courses, marks & assessments');
    await consent.click();
    await expect(consent).toBeChecked({ timeout: 20_000 });
    await page.screenshot({ path: OUT + 'feat-CMP04-consent.png', fullPage: true });

    await withDb(async (c) => {
      const { rows } = await c.query(
        `SELECT verified_at, can_view_results, can_view_fees FROM public."onyx_guardians"
         WHERE tenant_id=$1`, [w.tenantId]);
      expect(rows[0].verified_at, 'the learner accepted it').not.toBeNull();
      expect(rows[0].can_view_results, 'the one category they opened').toBe(true);
      expect(rows[0].can_view_fees, 'and only that one').toBe(false);
    });

    // Now the guardian sees the child -- and nothing beyond what was allowed.
    await signIn(page, mail('guardian'));
    await page.goto('/onyx/family');
    await expect(page.getByText('Ana Learner').first()).toBeVisible();
    await page.screenshot({ path: OUT + 'feat-CMP04-family.png', fullPage: true });
  });

test('CMP-01b a room, a class and a published timetable', async ({ page }) => {
  await signIn(page, mail('admin'));
  await page.goto('/onyx/timetable');

  await create(page, 'Add a room', {
    code: 'LT1', name: 'Lecture Theatre 1', capacity: '80', kind: 'lecture',
    building: 'Main block',
  });
  // A cohort has to have somebody in it.
  //
  // The timetable refuses a slot for an empty batch, in as many words -- and
  // until now there was no way anywhere in the product to act on what it
  // asked for: `POST /api/onyx/batches/:id/members` existed and nothing ever
  // called it. That is what this step exercises.
  await page.goto('/onyx/programs');
  await page.getByRole('button', { name: 'Add members' }).first().click();
  const roster = page.getByRole('dialog');
  await roster.getByRole('checkbox').first().check();
  await roster.getByRole('button', { name: /^Add / }).click();
  await expect(roster).toBeHidden({ timeout: 20_000 });
  await expect.poll(async () => withDb(async (c) => Number((await c.query(
    `SELECT count(*)::int n FROM public."onyx_batch_members" WHERE tenant_id=$1`,
    [w.tenantId])).rows[0].n)),
  { timeout: 20_000, message: 'somebody was put in the batch' }).toBeGreaterThan(0);

  await page.goto('/onyx/timetable');
  await create(page, 'Schedule a class', {
    semester_id: 'Term 1 2026', course_id: 'MA201 — Discrete Mathematics',
    batch_id: 'Batch A 2026', room_id: 'LT1 — Lecture Theatre 1',
    faculty_id: 'Faye Teacher', day_of_week: 'Monday',
    starts_at: '09:00', ends_at: '10:00',
  });
  /*
   * Scheduled, but a draft: a learner turning up to an unpublished room is
   * exactly what the draft state is for.
   *
   * Read off the Drafts tile rather than off the slot, and both assertions in
   * this test used to be wrong about that. The per-slot badge only renders on
   * a box at least 76px tall, so a one-hour class never shows one -- the
   * `getByText('draft')` here was passing by matching the word inside the
   * "Drafts" tile, and the `getByText('published')` after publishing had
   * nothing to match at all and failed on a timetable that was correctly
   * published. The tile carries a data-testid put there for exactly this.
   */
  const drafts = page.getByTestId('stat-drafts').locator('xpath=following-sibling::div[1]');
  await expect(drafts).toHaveText('1');
  await page.screenshot({ path: OUT + 'feat-CMP01-timetable-draft.png', fullPage: true });

  // The trigger carries the count: "Publish 1 session" with one draft waiting,
  // and "Publish a semester" only when there are none. Asserting the Drafts
  // tile above is what makes that label predictable rather than a race -- this
  // test used to name the empty-state label and find it only when the page had
  // not counted the draft yet.
  //
  // It asks before it publishes, with a native window.confirm -- and Playwright
  // DISMISSES native dialogs unless something says otherwise, so the submit was
  // being cancelled and the panel sat open with no error to read.
  page.once('dialog', (d) => { void d.accept(); });
  await create(page, 'Publish 1 session', { semester_id: 'Term 1 2026' });
  // Nothing is a draft any more, which is what "published" means to a learner:
  // the class is on their phone.
  await expect(drafts).toHaveText('0', { timeout: 20_000 });
  await page.screenshot({ path: OUT + 'feat-CMP01-timetable.png', fullPage: true });

  await withDb(async (c) => {
    const { rows } = await c.query(
      `SELECT status, day_of_week, starts_at::text FROM public."onyx_timetable_slots"
       WHERE tenant_id=$1`, [w.tenantId]);
    expect(rows.length, 'the class was scheduled').toBe(1);
    expect(rows[0].status, 'and published').toBe('published');
    expect(Number(rows[0].day_of_week)).toBe(1);
    expect(String(rows[0].starts_at)).toMatch(/^09:00/);
  });

  // The learner sees it, named -- not as a pair of database ids.
  await signIn(page, mail('ana'));
  await page.goto('/onyx/timetable');
  await expect(page.getByText('Discrete Mathematics').first()).toBeVisible();
  const grid = await page.locator('body').innerText();
  expect(grid, 'rows are named, not numbered').not.toMatch(/Course #\d+/);
});

test.afterAll(async () => {
  await withDb(async (c) => {
    await c.query('DELETE FROM public."onyx_tenants" WHERE name LIKE $1',
      ['Downstream College %']);
    await c.query('DELETE FROM public."onyx_users" WHERE email LIKE $1', ['%@downstream.test']);
  });
});
