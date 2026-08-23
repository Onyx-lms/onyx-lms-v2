/**
 * Setting a coding question on a paper, through the screens that set it.
 *
 * Reported as "creating a question with coding is not actually happening", and
 * it wasn't: `AddQuestion` had a branch for choice questions, one for
 * true/false and one for short answers, and none at all for `code`. The
 * problem picker was rendered, was filled in, and its value never left the
 * component — so the request went out as `{ type, prompt, points }` with no
 * problem attached and the service refused it. Every layer was working except
 * the twelve lines that put the chosen problem in the body.
 *
 * The API path was fine throughout, which is why this test drives the FORM.
 * A test that posted the right body would have passed against the broken
 * screen, and did: `o03-codelab.test.ts` and the authoring suite both cover
 * the service and neither of them noticed.
 *
 * The rest of the chain is exercised because a coding question is only worth
 * setting if it marks itself: the paper is sat, an answer is submitted, and
 * the sandbox's verdict has to reach the candidate's score.
 */
import { test, expect } from '@playwright/test';
import {
  withDb, RUN, api, mail, createTenant, adminToken, addMember, signInViaForm, cleanupTenants,
} from './helpers.ts';

const T = { name: 'Code College ' + RUN, slug: 'code-' + RUN };
const adminEmail = mail('code', 'admin');
const learnerEmail = mail('code', 'lea');

const w = { tenantId: 0, courseId: 0, problemId: 0, bankId: 0, paperId: 0 };

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  await createTenant(T.name, T.slug, 'Code Admin', adminEmail);
  const token = await adminToken(adminEmail);
  await addMember(token, 'Lea Learner', learnerEmail, 'student');

  w.tenantId = await withDb(async (c) => Number((await c.query(
    'SELECT id FROM public."onyx_tenants" WHERE slug=$1', [T.slug])).rows[0].id));

  const course = await api('/api/onyx/courses', {
    method: 'POST', token,
    body: { code: 'CD101', title: 'Programming', credits: 3, access: 'open' },
  });
  w.courseId = Number((course.data as { id: number }).id);
  await api('/api/onyx/courses/' + w.courseId + '/publish', { method: 'POST', token });

  const members = await api('/api/onyx/members', { token });
  const roster = members.data as { user_id: string; user: { email: string } | null }[];
  const found = roster.find((m) => m.user?.email === learnerEmail)!;
  await api('/api/onyx/courses/' + w.courseId + '/enroll', {
    method: 'POST', token, body: { user_id: found.user_id },
  });

  // A Code Lab problem with real test cases, published -- the service refuses a
  // draft problem, and rightly: a question marked by tests needs tests.
  const problem = await api('/api/onyx/problems', {
    method: 'POST', token,
    body: {
      title: 'Add two numbers', slug: 'add-two-' + RUN,
      statement: 'Read two integers on one line and print their sum.',
      difficulty: 'easy', languages: ['python'], time_limit_ms: 2000,
    },
  });
  expect(problem.status, 'could not author the problem: ' + problem.message).toBe(200);
  w.problemId = Number((problem.data as { id: number }).id);

  const tests = await api('/api/onyx/problems/' + w.problemId + '/tests', {
    method: 'PUT', token,
    body: {
      tests: [
        { name: 'sample', stdin: '1 2', expected_stdout: '3', weight: 1, is_hidden: false },
        { name: 'hidden', stdin: '5 7', expected_stdout: '12', weight: 1, is_hidden: true },
      ],
    },
  });
  expect(tests.status, 'could not save test cases: ' + tests.message).toBe(200);

  const published = await api('/api/onyx/problems/' + w.problemId + '/publish',
    { method: 'POST', token });
  expect(published.status, 'could not publish the problem: ' + published.message).toBe(200);

  const bank = await api('/api/onyx/banks', {
    method: 'POST', token, body: { name: 'Code bank', course_id: w.courseId },
  });
  w.bankId = Number((bank.data as { id: number }).id);
});

test.afterAll(async () => {
  await cleanupTenants([T.slug], 'code.%.' + RUN + '@onyx.test');
});

test('a coding question can be set from the screen that sets questions', async ({ page }) => {
  await signInViaForm(page, adminEmail);
  await page.goto('/onyx/banks/' + w.bankId);

  // The opener and the form's submit carry the same label, so they are told
  // apart by position rather than by text.
  await page.getByRole('button', { name: 'Add a question' }).first().click();

  await page.locator('#q-prompt').fill('Write a program that adds two integers.');
  await page.locator('#q-type').selectOption('code');

  // The picker only exists for a code question, and it is the thing whose
  // value used to be dropped on the floor.
  const picker = page.locator('#q-problem');
  await expect(picker).toBeVisible();
  await picker.selectOption(String(w.problemId));

  await page.locator('form').getByRole('button', { name: 'Add a question' }).click();

  // It exists, and it is attached to the problem that marks it. Asserted in
  // the database as well as on screen: a question that rendered but carried
  // `problem_id: null` would be the same bug wearing a different face --
  // `#finalise` would find nothing to run and leave it for a human.
  await expect(page.getByText('Write a program that adds two integers.').first())
    .toBeVisible({ timeout: 20_000 });

  // Polled: the row is written by the request the form fired, and the page
  // re-renders from a router refresh, so the two are not the same instant.
  await expect.poll(async () => withDb(async (c) => {
    const { rows } = await c.query(
      `SELECT type, problem_id FROM public."onyx_questions"
        WHERE tenant_id = $1 AND bank_id = $2`, [w.tenantId, w.bankId]);
    return rows.map((r) => String(r.type) + ':' + String(r.problem_id ?? 'null')).join(',');
  }), { timeout: 15_000 }).toBe('code:' + w.problemId);
});

test('choosing no problem is refused before the request goes out', async ({ page }) => {
  // The service already refuses this. Saying so in the form means the person
  // setting the paper is told which field to fix rather than reading a
  // sentence about a request they cannot see.
  await signInViaForm(page, adminEmail);
  await page.goto('/onyx/banks/' + w.bankId);

  // The opener and the form's submit carry the same label, so they are told
  // apart by position rather than by text.
  await page.getByRole('button', { name: 'Add a question' }).first().click();
  await page.locator('#q-prompt').fill('A question with no problem chosen.');
  await page.locator('#q-type').selectOption('code');
  await page.locator('form').getByRole('button', { name: 'Add a question' }).click();

  await expect(page.getByText(/Choose the problem this question is answered against/i))
    .toBeVisible({ timeout: 20_000 });

  // And nothing was created.
  await withDb(async (c) => {
    const { rows } = await c.query(
      `SELECT count(*)::int AS n FROM public."onyx_questions"
        WHERE tenant_id = $1 AND bank_id = $2`, [w.tenantId, w.bankId]);
    expect(rows[0].n, 'a question was created without a problem').toBe(1);
  });
});

test('the paper marks itself from the problem\'s test cases', async () => {
  // A coding question is only worth setting if it marks itself. The sandbox's
  // verdict has to reach the candidate's score, hidden test cases included.
  test.slow();
  const token = await adminToken(adminEmail);

  const paper = await api('/api/onyx/assessments', {
    method: 'POST', token,
    body: {
      title: 'Programming paper', course_id: w.courseId, duration_minutes: 60,
      attempts_allowed: 1,
      sections: [{ id: 's1', title: 'All', bank_id: w.bankId, take: 1 }],
    },
  });
  expect(paper.status, 'could not create the paper: ' + paper.message).toBe(200);
  w.paperId = Number((paper.data as { id: number }).id);
  const published = await api('/api/onyx/assessments/' + w.paperId + '/publish',
    { method: 'POST', token });
  expect(published.status).toBe(200);

  const learner = await api<{ token: string }>('/api/onyx/auth/login',
    { body: { email: learnerEmail, password: 'OnyxBrowser#2026' } });
  const lt = learner.data.token;

  const started = await api('/api/onyx/assessments/' + w.paperId + '/start',
    { method: 'POST', token: lt, body: {} });
  expect(started.status, 'the learner could not start: ' + started.message).toBe(200);

  const attempt = started.data as {
    id: number;
    questions: { question_id: number; type: string; problem?: { id: number } | null }[];
  };
  const q = attempt.questions[0]!;
  expect(q.type, 'the paper did not deal the code question').toBe('code');
  expect(q.problem?.id,
    'the problem did not travel with the paper, so nothing could mark it')
    .toBe(w.problemId);

  const answered = await api('/api/onyx/attempts/' + attempt.id + '/answer', {
    method: 'POST', token: lt,
    body: {
      question_id: q.question_id,
      response: {
        language: 'python',
        source: ['a,b=input().split()', 'print(int(a)+int(b))'].join('\n'),
      },
    },
  });
  expect(answered.status, 'the answer was refused: ' + answered.message).toBe(200);

  const done = await api<{ score: number; max_score: number }>(
    '/api/onyx/attempts/' + attempt.id + '/submit', { method: 'POST', token: lt, body: {} });
  expect(done.status, 'submitting failed: ' + done.message).toBe(200);

  // Full marks, from the tests rather than from a key somebody typed.
  expect(Number(done.data.score),
    'a correct program did not earn the marks the tests award')
    .toBe(Number(done.data.max_score));
});
