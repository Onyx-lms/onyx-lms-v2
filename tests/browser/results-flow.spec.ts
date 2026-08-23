/**
 * A learner hands a paper in and is told how they did.
 *
 * Asked for in those words: "when student completed or handed their exam or
 * assessment, the result should be then and there itself", "when he clicked on
 * the examination link which he has already attempted, then his result should
 * be over there", and "ensure that results tab works properly".
 *
 * The results tab was in fact working. What it was showing was the truth: the
 * marks existed and none of them had been released. Every read path in the
 * product required a member of staff to press Publish, so a five-question
 * multiple-choice quiz — auto-marked in full, correctly, at the instant of
 * submission — told the candidate "results will appear once they are
 * published".
 *
 * The other half was that nothing led anywhere. A released result on the
 * results page linked to the paper's front page, which shows a Start button
 * and no score; the learner's own list of papers had no link at all; and the
 * one page that could render a mark was the page handing in redirected AWAY
 * from. This file walks the whole journey and asserts each of those joins.
 *
 * The paper here is deliberately all single-answer questions. That is the case
 * `instant_results` is for, and the case where a mark at submit is genuinely
 * final rather than provisional.
 */
import { test, expect } from '@playwright/test';
import {
  withDb, RUN, api, PASSWORD, mail, createTenant, adminToken, addMember, signInViaForm,
  cleanupTenants,
} from './helpers.ts';

const T = { name: 'Marks College ' + RUN, slug: 'marks-' + RUN };
const adminEmail = mail('marks', 'admin');
const learnerEmail = mail('marks', 'lea');

const w = { tenantId: 0, courseId: 0, instantPaper: 0, heldPaper: 0 };

test.describe.configure({ mode: 'serial' });

/** A bank of plain right/wrong questions, and a paper drawing all of them. */
async function paper(token: string, title: string, instant: boolean,
  attemptsAllowed = 2): Promise<number> {
  const bank = await api('/api/onyx/banks', {
    method: 'POST', token, body: { name: title + ' bank', course_id: w.courseId },
  });
  const bankId = Number((bank.data as { id: number }).id);
  for (const n of [1, 2]) {
    await api('/api/onyx/banks/' + bankId + '/questions', {
      method: 'POST', token,
      body: {
        type: 'single', prompt: 'Question ' + n + ': pick the right one.',
        options: [{ id: 'a', text: 'Wrong' }, { id: 'b', text: 'Right' }],
        answer: 'b', points: 5,
      },
    });
  }
  const made = await api('/api/onyx/assessments', {
    method: 'POST', token,
    body: {
      title, course_id: w.courseId, duration_minutes: 30,
      attempts_allowed: attemptsAllowed,
      // Explicit either way: instant is the default now, so a paper that
      // must WAIT has to say so.
      pass_mark: 5, instant_results: instant,
      sections: [{ id: 's1', title: 'All', bank_id: bankId, take: 2 }],
    },
  });
  const id = Number((made.data as { id: number }).id);
  await api('/api/onyx/assessments/' + id + '/publish', { method: 'POST', token });
  return id;
}

test.beforeAll(async () => {
  await createTenant(T.name, T.slug, 'Marks Admin', adminEmail);
  const token = await adminToken(adminEmail);
  await addMember(token, 'Lea Learner', learnerEmail, 'student');

  w.tenantId = await withDb(async (c) => Number((await c.query(
    'SELECT id FROM public."onyx_tenants" WHERE slug=$1', [T.slug])).rows[0].id));

  const course = await api('/api/onyx/courses', {
    method: 'POST', token,
    body: { code: 'MK101', title: 'Marking 101', credits: 3, access: 'open' },
  });
  w.courseId = Number((course.data as { id: number }).id);
  await api('/api/onyx/courses/' + w.courseId + '/publish', { method: 'POST', token });

  const members = await api('/api/onyx/members', { token });
  const roster = members.data as { user_id: string; user: { email: string } | null }[];
  const found = roster.find((m) => m.user?.email === learnerEmail)!;
  await api('/api/onyx/courses/' + w.courseId + '/enroll', {
    method: 'POST', token, body: { user_id: found.user_id },
  });

  w.instantPaper = await paper(token, 'Instant quiz', true);
  w.heldPaper = await paper(token, 'Held quiz', false);
});

test.afterAll(async () => {
  await cleanupTenants([T.slug], 'marks.%.' + RUN + '@onyx.test');
});

/** Sits a paper through the real screens and hands it in. */
async function sit(page: import('@playwright/test').Page, paperId: number, correct: boolean) {
  await page.goto('/onyx/assessments/' + paperId);
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await page.waitForURL(/\/onyx\/attempts\/\d+$/, { timeout: 20_000 });

  // Two questions, each with one right option. Answering by the visible label
  // rather than by an id, because that is what a candidate does.
  const radios = page.getByRole('radio', { name: correct ? 'Right' : 'Wrong' });
  const n = await radios.count();
  for (let i = 0; i < n; i++) await radios.nth(i).check();

  // Autosave is per answer; wait for the last one to land before handing in,
  // or the submit can race the save and mark an unanswered paper.
  await expect(page.getByText(/saved/i).first()).toBeVisible({ timeout: 20_000 });

  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: /hand (it )?in|submit/i }).first().click();
}

test('handing in a paper that marks itself shows the score there and then', async ({ page }) => {
  test.slow();
  await signInViaForm(page, learnerEmail);
  await sit(page, w.instantPaper, true);

  // Lands on the ATTEMPT, which is where the result is. Handing in used to
  // redirect to the paper's front page, which cannot show a mark.
  await page.waitForURL(/\/onyx\/attempts\/\d+$/, { timeout: 30_000 });
  await expect(page.getByText('Your result', { exact: false })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('10 / 10')).toBeVisible();
  await expect(page.getByText('Passed', { exact: true })).toBeVisible();

  // And the submission itself -- the review screen every LMS has. The answers
  // were in the payload all along with nothing rendering them.
  await expect(page.getByText('Your submission')).toBeVisible();
  await expect(page.getByText('Your answer').first()).toBeVisible();
  // What they clicked, by its label rather than its option id.
  await expect(page.getByText('Right').first()).toBeVisible();
  await expect(page.getByText('Correct').first()).toBeVisible();
});

test('a wrong answer is shown as theirs, and named wrong', async ({ page }) => {
  // The half that matters more: somebody who did badly needs to see WHICH
  // ones, and what they put instead. A single-attempt paper, so the key is
  // shown too -- there is no resit left to spoil.
  test.slow();
  const token = await adminToken(adminEmail);
  const onePaper = await paper(token, 'One shot', true, 1);

  await signInViaForm(page, learnerEmail);
  await sit(page, onePaper, false);
  await page.waitForURL(/\/onyx\/attempts\/\d+$/, { timeout: 30_000 });

  await expect(page.getByText('0 / 10')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Incorrect').first()).toBeVisible();
  // Their own wrong answer, and the right one beside it.
  await expect(page.getByText('Wrong').first()).toBeVisible();
  await expect(page.getByText('Correct answer').first()).toBeVisible();
});

test('the results tab carries it, and the row leads back to the marks', async ({ page }) => {
  await signInViaForm(page, learnerEmail);
  await page.goto('/onyx/results');

  await expect(page.getByText('Instant quiz').first()).toBeVisible({ timeout: 20_000 });

  // The row is a link to the ATTEMPT. It used to point at the paper's front
  // page: a click that promised a result and delivered a Start button.
  await page.getByRole('link', { name: /Instant quiz/ }).first().click();
  await page.waitForURL(/\/onyx\/attempts\/\d+$/, { timeout: 20_000 });
  await expect(page.getByText('10 / 10')).toBeVisible();
});

test('the paper a learner has already sat shows what they got', async ({ page }) => {
  // "When he clicked on the examination link which he has already attempted,
  // then his result should be over there." The page only mentioned results at
  // all once every attempt was used up -- on a two-attempt paper somebody who
  // had sat it once saw a Start button and no mention of their mark.
  await signInViaForm(page, learnerEmail);
  await page.goto('/onyx/assessments/' + w.instantPaper);

  await expect(page.getByText('Your attempts so far')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('link', { name: /Attempt 1/ }).first()).toBeVisible();
  // Asserted on the LIST, not on the link: a ListRow puts its trailing score
  // outside the anchor, so the link's own text is just its title. And `Score`
  // runs the mark into its denominator without spaces -- the spaced form on
  // the attempt page is a stat tile, which is a different component.
  await expect(page.getByRole('list', { name: 'Your attempts at this paper' }))
    .toContainText('10/10');

  // And a second sitting is still offered, because this paper allows two.
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeVisible();
});

test('a paper that deliberately holds results still waits for a marker', async ({ page }) => {
  // The escape hatch. Instant is the default since 0035, so this paper had to
  // turn it off -- and turning it off has to keep working, or "on by default"
  // quietly becomes "on, always".
  test.slow();
  await signInViaForm(page, learnerEmail);
  await sit(page, w.heldPaper, true);

  await page.waitForURL(/\/onyx\/attempts\/\d+$/, { timeout: 30_000 });
  await expect(page.getByText('Handed in. Not marked yet.')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('10 / 10')).toHaveCount(0);

  // And the results page does not list it, because there is no result.
  await page.goto('/onyx/results');
  await expect(page.getByRole('link', { name: /Held quiz/ })).toHaveCount(0);
});

test('the mark on the screen is the mark in the database', async () => {
  // The screens could agree with each other and both be wrong. This is the
  // only assertion here that a rendering bug cannot satisfy.
  await withDb(async (c) => {
    const { rows } = await c.query(
      `SELECT a.score, a.max_score, a.status, s.title
         FROM public."onyx_assessment_attempts" a
         JOIN public."onyx_assessments" s ON s.id = a.assessment_id
        WHERE a.tenant_id = $1 ORDER BY a.id`, [w.tenantId]);
    const instant = rows.find((r) => r.title === 'Instant quiz')!;
    const held = rows.find((r) => r.title === 'Held quiz')!;

    expect(Number(instant.score)).toBe(10);
    expect(String(instant.status)).toBe('published');

    // The held paper is marked too -- it always was. It is simply not released.
    expect(Number(held.score)).toBe(10);
    expect(String(held.status)).toBe('submitted');
  });
});

test('releasing one attempt does not close the paper for everybody', async () => {
  // `results_published_at` ends marking for good, for every candidate. One
  // person finishing early must never do that to a paper others are sitting.
  await withDb(async (c) => {
    const { rows } = await c.query(
      'SELECT results_published_at, status FROM public."onyx_assessments" WHERE id = $1',
      [w.instantPaper]);
    expect(rows[0].results_published_at ?? null).toBeNull();
    expect(String(rows[0].status)).toBe('published');
  });
});
