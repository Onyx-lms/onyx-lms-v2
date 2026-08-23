/**
 * Two forms that were asking people to do the product's arithmetic for it.
 *
 * Both are user-experience changes with no change in what gets stored, which
 * is exactly why they need tests: nothing about the database moved, so a
 * regression here would be silent.
 *
 *   * **Money is typed in rupees.** The field said "Price in paise" with
 *     "149900 is ₹1,499.00" underneath — a form asking somebody to multiply by
 *     a hundred, where a slip of two zeroes is the difference between ₹1,499
 *     and ₹149,900. It still STORES minor units; only the person's side
 *     changed.
 *
 *   * **An examination no longer asks which semester.** Somebody scheduling
 *     "CS101 Final" has no reason to think about which semester row it belongs
 *     to; the course already knows, and the API takes it from there. The
 *     column is still NOT NULL and every exam still has one.
 */
import { test, expect } from '@playwright/test';
import {
  withDb, RUN, api, mail, createTenant, adminToken, signInViaForm, cleanupTenants,
} from './helpers.ts';

const T = { name: 'Forms College ' + RUN, slug: 'forms-' + RUN };
const adminEmail = mail('forms', 'admin');

const w = { tenantId: 0, programId: 0, semesterId: 0, courseId: 0, looseCourseId: 0 };

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  await createTenant(T.name, T.slug, 'Forms Admin', adminEmail);
  const token = await adminToken(adminEmail);

  w.tenantId = await withDb(async (c) => Number((await c.query(
    'SELECT id FROM public."onyx_tenants" WHERE slug=$1', [T.slug])).rows[0].id));

  const programme = await api('/api/onyx/programs', {
    method: 'POST', token, body: { name: 'Forms Studies', code: 'FS', duration_semesters: 2 },
  });
  w.programId = Number((programme.data as { id: number }).id);
  const semester = await api('/api/onyx/semesters', {
    method: 'POST', token, body: { program_id: w.programId, name: 'Term 1', number: 1 },
  });
  w.semesterId = Number((semester.data as { id: number }).id);

  // One course inside the semester, and one deliberately outside it.
  const inTerm = await api('/api/onyx/courses', {
    method: 'POST', token,
    body: {
      code: 'FS101', title: 'In A Term', credits: 3, access: 'open',
      program_id: w.programId, semester_id: w.semesterId,
    },
  });
  w.courseId = Number((inTerm.data as { id: number }).id);

  const loose = await api('/api/onyx/courses', {
    method: 'POST', token, body: { code: 'FS999', title: 'No Term', credits: 3, access: 'open' },
  });
  w.looseCourseId = Number((loose.data as { id: number }).id);
});

test.afterAll(async () => {
  await cleanupTenants([T.slug], 'forms.%.' + RUN + '@onyx.test');
});

test('scheduling an exam no longer asks which semester', async () => {
  const token = await adminToken(adminEmail);
  const made = await api('/api/onyx/exams', {
    method: 'POST', token,
    body: {
      // No semester_id at all -- the field is gone from the form.
      course_id: w.courseId, title: 'FS101 Final',
      starts_at: new Date(Date.now() + 3 * 86_400_000).toISOString(),
      duration_minutes: 90, max_marks: 100, pass_marks: 40,
    },
  });
  expect(made.status, 'the exam was refused: ' + made.message).toBe(200);

  // And it is filed under the course's own term, which is the honest answer
  // rather than a guess -- the column is still NOT NULL.
  await withDb(async (c) => {
    const { rows } = await c.query(
      'SELECT semester_id FROM public."onyx_exams" WHERE id = $1',
      [(made.data as { id: number }).id]);
    expect(Number(rows[0].semester_id),
      'the exam did not inherit its course\'s semester').toBe(w.semesterId);
  });
});

test('a course with no term is told so, rather than guessed at', async () => {
  // The one case that still needs a person. Picking "the newest semester"
  // would file exams under a term nobody chose, which is worse than asking.
  const token = await adminToken(adminEmail);
  const refused = await api('/api/onyx/exams', {
    method: 'POST', token,
    body: {
      course_id: w.looseCourseId, title: 'Nowhere Final',
      starts_at: new Date(Date.now() + 4 * 86_400_000).toISOString(),
      duration_minutes: 90, max_marks: 100, pass_marks: 40,
    },
  });
  expect(refused.status).toBe(422);
  expect(String(refused.message)).toMatch(/not attached to a semester/i);

  // Naming one explicitly still works: the field went from the form, not from
  // the API.
  const named = await api('/api/onyx/exams', {
    method: 'POST', token,
    body: {
      course_id: w.looseCourseId, semester_id: w.semesterId, title: 'Nowhere Final',
      starts_at: new Date(Date.now() + 4 * 86_400_000).toISOString(),
      duration_minutes: 90, max_marks: 100, pass_marks: 40,
    },
  });
  expect(named.status, 'an explicit semester was refused: ' + named.message).toBe(200);
});

test('a price is typed in rupees and stored in paise', async ({ page }) => {
  await signInViaForm(page, adminEmail);
  await page.goto('/onyx/courses');

  await page.getByRole('button', { name: 'Create a course' }).first().click();

  await page.locator('input[name="code"]').fill('PRICE' + RUN.slice(-3));
  await page.locator('input[name="title"]').fill('A Bought Course');
  await page.locator('select[name="access"]').selectOption('locked');

  // 1499 rupees, typed the way a person writes money. Not 149900.
  const price = page.locator('input[name="price_minor"]');
  await expect(price).toBeVisible();
  await price.fill('1499');

  await page.locator('form').getByRole('button', { name: 'Create a course' }).click();

  await expect.poll(async () => withDb(async (c) => {
    const { rows } = await c.query(
      `SELECT price_minor, currency FROM public."onyx_courses"
        WHERE tenant_id = $1 AND title = 'A Bought Course'`, [w.tenantId]);
    return rows.length ? String(rows[0].price_minor) + ' ' + String(rows[0].currency) : 'none';
  }), { timeout: 20_000 }).toBe('149900 INR');
});

test('the price field shows the rupee sign rather than explaining paise', async ({ page }) => {
  // The symbol IS the explanation. If it is missing, the number beside it is
  // ambiguous by exactly a factor of a hundred.
  await signInViaForm(page, adminEmail);
  await page.goto('/onyx/courses');
  await page.getByRole('button', { name: 'Create a course' }).first().click();

  const form = page.locator('form');
  await expect(form.getByText('₹').first()).toBeVisible();
  await expect(form.getByText(/in paise/i)).toHaveCount(0);
  await expect(form.getByText(/149900/)).toHaveCount(0);
});

test('a half-filled form is not thrown away by a stray click', async ({ page }) => {
  /*
   * The guard that makes a modal safe to use.
   *
   * Everything inside is uncontrolled, so a dismissal loses the lot with
   * nothing to restore -- eight fields into scheduling an exam, one click on
   * the dim area. The dialog asks before discarding, and only when something
   * has actually been typed: confirming on an untouched form would be a
   * dialog about a dialog.
   */
  await signInViaForm(page, adminEmail);
  await page.goto('/onyx/courses');
  await page.getByRole('button', { name: 'Create a course' }).first().click();
  await page.locator('input[name="title"]').fill('Half typed');

  // Refuse the confirmation: the work stays put.
  page.once('dialog', (d) => void d.dismiss());
  await page.locator('div[role="dialog"]').press('Escape');
  await expect(page.locator('input[name="title"]')).toHaveValue('Half typed');

  // Accept it, and only then does it close.
  page.once('dialog', (d) => void d.accept());
  await page.locator('div[role="dialog"]').press('Escape');
  await expect(page.locator('div[role="dialog"]')).toHaveCount(0);
});
