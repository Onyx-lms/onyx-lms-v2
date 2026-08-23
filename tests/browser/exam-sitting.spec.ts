/**
 * Two exams the same day, a link handed to candidates, and a room full of them
 * starting at once.
 *
 * Asked for in exactly those words: "the other exam in the evening, test end to
 * end if share the link they should able to start the exam" and "handle
 * multiple people". Three things have to hold at the same moment, and only the
 * third is obvious.
 *
 *   * The link WORKS for somebody who is not signed in yet. A candidate given
 *     a URL is not already logged in on the machine in front of them, so the
 *     destination has to survive the sign-in.
 *   * The evening paper opens and the morning paper does NOT, at the same
 *     instant, from the same link-shaped route. An exam's paper takes its
 *     window from the exam's slot -- `syncExamAssessmentWindow` writes
 *     `opens_at`/`closes_at` from `starts_at` and the duration -- so this is
 *     really a test that scheduling two sittings a day apart in time actually
 *     separates them.
 *   * Several people start TOGETHER and each gets their own paper. Questions
 *     are drawn per attempt, so two candidates sitting the same assessment are
 *     not sitting the same twenty questions, and one person's answers must
 *     never reach another's attempt.
 *
 * **On "morning" and "evening".** The exams are named that and their windows
 * are set RELATIVE to the moment the test runs -- the earlier one already
 * finished, the later one is open now. Hard-coding 09:00 and 18:00 would make
 * the suite pass or fail depending on the hour somebody ran it, which is the
 * one thing a test must never do. What is being proved is that two sittings at
 * different times behave differently, and that is what this proves.
 */
import { test, expect } from '@playwright/test';
import {
  withDb, RUN, api, PASSWORD, mail, createTenant, adminToken, addMember, signInViaForm,
  cleanupTenants,
} from './helpers.ts';

const T = { name: 'Sitting Institute ' + RUN, slug: 'sitting-' + RUN };
const adminEmail = mail('sitting', 'admin');
/** Four, because "handle multiple people" is the point and two proves less. */
const CANDIDATES = ['ana', 'ben', 'cara', 'dev'].map((who) => mail('sitting', who));
const outsider = mail('sitting', 'outsider');

const w = {
  tenantId: 0, courseId: 0, semesterId: 0,
  morningPaper: 0, eveningPaper: 0,
  morningExam: 0, eveningExam: 0,
};

test.describe.configure({ mode: 'serial' });

async function tokenFor(email: string): Promise<string> {
  const res = await api<{ token: string }>('/api/onyx/auth/login',
    { body: { email, password: PASSWORD } });
  return res.data.token;
}

/** A paper on the course, drawing two questions from the bank, published. */
async function paper(token: string, title: string, bankId: number): Promise<number> {
  const made = await api('/api/onyx/assessments', {
    method: 'POST', token,
    body: {
      title, course_id: w.courseId, duration_minutes: 30, attempts_allowed: 1,
      sections: [{ id: 's1', title: 'Section 1', bank_id: bankId, take: 2 }],
    },
  });
  const id = Number((made.data as { id: number }).id);
  await api('/api/onyx/assessments/' + id + '/publish', { method: 'POST', token });
  return id;
}

/** An exam at a given instant, linked to a paper, which sets the paper's window. */
async function exam(token: string, title: string, startsAt: Date, paperId: number) {
  const made = await api('/api/onyx/exams', {
    method: 'POST', token,
    body: {
      semester_id: w.semesterId, course_id: w.courseId, title,
      starts_at: startsAt.toISOString(), duration_minutes: 60,
      max_marks: 100, pass_marks: 40, assessment_id: paperId,
    },
  });
  return Number((made.data as { id: number }).id);
}

test.beforeAll(async () => {
  await createTenant(T.name, T.slug, 'Sitting Admin', adminEmail);
  const token = await adminToken(adminEmail);

  for (const [i, email] of CANDIDATES.entries()) {
    await addMember(token, 'Candidate ' + (i + 1), email, 'student');
  }
  // Enrolled nowhere. A shared link is a public-looking URL and the enrolment
  // check is the only thing standing between it and a stranger.
  await addMember(token, 'Otto Outsider', outsider, 'student');

  w.tenantId = await withDb(async (c) => Number((await c.query(
    'SELECT id FROM public."onyx_tenants" WHERE slug=$1', [T.slug])).rows[0].id));

  const programme = await api('/api/onyx/programs', {
    method: 'POST', token, body: { name: 'Sitting Studies', code: 'SIT', duration_semesters: 2 },
  });
  const semester = await api('/api/onyx/semesters', {
    method: 'POST', token,
    body: {
      program_id: Number((programme.data as { id: number }).id),
      name: 'Term 1', number: 1,
    },
  });
  w.semesterId = Number((semester.data as { id: number }).id);

  const course = await api('/api/onyx/courses', {
    method: 'POST', token,
    body: { code: 'SIT101', title: 'Sitting 101', credits: 3, access: 'open' },
  });
  w.courseId = Number((course.data as { id: number }).id);
  // A draft course answers 404 to `assertEnrolled`, which is what starting a
  // paper goes through -- so an unpublished course looks like a missing one.
  await api('/api/onyx/courses/' + w.courseId + '/publish', { method: 'POST', token });

  const members = await api('/api/onyx/members', { token });
  const roster = members.data as { user_id: string; user: { email: string } | null }[];
  for (const email of CANDIDATES) {
    const found = roster.find((m) => m.user?.email === email)!;
    await api('/api/onyx/courses/' + w.courseId + '/enroll', {
      method: 'POST', token, body: { user_id: found.user_id },
    });
  }

  // One bank, four questions, so a paper taking two of them can genuinely draw
  // a different pair for different people.
  const bank = await api('/api/onyx/banks', {
    method: 'POST', token, body: { name: 'Sitting bank', course_id: w.courseId },
  });
  const bankId = Number((bank.data as { id: number }).id);
  for (const n of [1, 2, 3, 4]) {
    await api('/api/onyx/banks/' + bankId + '/questions', {
      method: 'POST', token,
      body: {
        type: 'single', prompt: 'Question ' + n + ': which option is B?',
        options: [{ id: 'a', text: 'Not this one' }, { id: 'b', text: 'This one' }],
        answer: 'b', points: 5,
      },
    });
  }

  w.morningPaper = await paper(token, 'Morning paper', bankId);
  w.eveningPaper = await paper(token, 'Evening paper', bankId);

  // The morning sitting has been and gone; the evening one is happening now.
  // Both windows are written by the exam, not by hand -- that is the behaviour
  // under test.
  const now = Date.now();
  w.morningExam = await exam(token, 'Morning exam',
    new Date(now - 4 * 60 * 60_000), w.morningPaper);
  w.eveningExam = await exam(token, 'Evening exam',
    new Date(now - 5 * 60_000), w.eveningPaper);
});

test.afterAll(async () => {
  await cleanupTenants([T.slug], 'sitting.%.' + RUN + '@onyx.test');
});

test('scheduling the two exams sets each paper its own window', async () => {
  // The premise everything else rests on, checked first so a failure below
  // cannot be mistaken for a candidate problem.
  await withDb(async (c) => {
    const { rows } = await c.query(
      `SELECT id, title, opens_at, closes_at FROM public."onyx_assessments"
        WHERE tenant_id=$1 ORDER BY id`, [w.tenantId]);
    expect(rows.length).toBe(2);
    const morning = rows.find((r) => r.title === 'Morning paper')!;
    const evening = rows.find((r) => r.title === 'Evening paper')!;

    expect(morning.opens_at, 'the exam wrote the paper a window').not.toBeNull();
    expect(Date.parse(String(morning.closes_at)),
      'the morning paper has already closed').toBeLessThan(Date.now());
    expect(Date.parse(String(evening.opens_at)),
      'the evening paper is open').toBeLessThanOrEqual(Date.now());
    expect(Date.parse(String(evening.closes_at)),
      'and has not closed yet').toBeGreaterThan(Date.now());
  });
});

test('the shared link carries somebody who is not signed in to the paper', async ({ page }) => {
  const link = '/onyx/assessments/' + w.eveningPaper;

  await page.context().clearCookies();
  await page.goto(link);
  // Not signed in, so a login form -- and the destination has to survive it.
  await expect(page).toHaveURL(/\/onyx\/login/, { timeout: 20_000 });

  await page.getByLabel('Email address').fill(CANDIDATES[0]!);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: /sign in/i }).click();

  // Landed on the paper itself, not dropped on a dashboard for the candidate
  // to go looking. A link that loses its destination is a link that generates
  // support calls in the five minutes before an exam.
  await page.waitForURL((u) => u.pathname === link, { timeout: 20_000 });
  await expect(page.getByRole('heading', { name: 'Evening paper' })).toBeVisible();
  await expect(page.getByRole('button', { name: /start/i })).toBeVisible();
});

test('a candidate starts it from that link and sees questions', async ({ page }) => {
  await signInViaForm(page, CANDIDATES[0]!);
  await page.goto('/onyx/assessments/' + w.eveningPaper);
  await page.getByRole('button', { name: /start/i }).click();

  // A dealt paper, not a spinner: two questions, each with its options.
  await expect(page.getByText(/which option is B/i).first())
    .toBeVisible({ timeout: 30_000 });

  await withDb(async (c) => {
    const { rows } = await c.query(
      `SELECT count(*)::int n FROM public."onyx_assessment_attempts"
        WHERE tenant_id=$1 AND assessment_id=$2`, [w.tenantId, w.eveningPaper]);
    expect(Number(rows[0].n), 'exactly one attempt for one candidate').toBe(1);
  });
});

test('the morning paper refuses at the same moment the evening one works', async () => {
  const candidate = await tokenFor(CANDIDATES[1]!);

  const closed = await api('/api/onyx/assessments/' + w.morningPaper + '/start',
    { method: 'POST', token: candidate, body: {} });
  expect(closed.status, 'a finished sitting is still accepting candidates')
    .toBeGreaterThanOrEqual(400);
  expect(String(closed.message)).toMatch(/closed/i);

  // The same person, the same instant, the evening paper: open.
  const open = await api('/api/onyx/assessments/' + w.eveningPaper + '/start',
    { method: 'POST', token: candidate, body: {} });
  expect(open.status, 'the evening paper refused a candidate it should have taken').toBe(200);
});

test('four people starting at once each get their own paper', async () => {
  // Genuinely at once: the tokens are fetched first so the starts go out
  // together rather than queueing behind four logins.
  const tokens = await Promise.all(CANDIDATES.map((e) => tokenFor(e)));

  // Before anything else: four concurrent logins are four different people.
  // Everything below is meaningless if two candidates are holding the same
  // session, and "two candidates got the same attempt" is exactly what that
  // would look like from the outside.
  const whoami = await Promise.all(tokens.map((token) =>
    api<{ email: string }>('/api/onyx/me', { token })));
  for (const [i, me] of whoami.entries()) {
    expect(me.data?.email, 'a token issued for ' + CANDIDATES[i] + ' belongs to somebody else')
      .toBe(CANDIDATES[i]);
  }
  expect(new Set(tokens).size, 'two candidates were issued the same token').toBe(4);

  const started = await Promise.all(tokens.map((token) =>
    api('/api/onyx/assessments/' + w.eveningPaper + '/start',
      { method: 'POST', token, body: {} })));

  for (const [i, res] of started.entries()) {
    expect(res.status, 'candidate ' + (i + 1) + ' could not start').toBe(200);
  }

  // Four attempts, four candidates, no two sharing a row. Candidates 1 and 2
  // started in earlier tests, and starting again must RESUME rather than issue
  // a second attempt -- `attempts_allowed` is 1 and the service returns the
  // live one, which is what stops a refresh mid-exam from burning an attempt.
  // `data.id` is the attempt; `data.attempt` is its ORDINAL (1st, 2nd), which
  // is a number -- reading .id off it gives NaN, and four NaNs collapse into a
  // single Set entry that reads exactly like four people sharing one attempt.
  // The responses first: they need no database and they are the stronger
  // claim anyway. Four candidates, four different attempts, nothing shared.
  //
  // `data.id` is the attempt; `data.attempt` is its ORDINAL (1st, 2nd), which
  // is a number -- reading .id off it gives NaN, and four NaNs collapse into a
  // single Set entry that reads exactly like four people sharing one attempt.
  const ids = started.map((r) => Number((r.data as { id: number }).id));
  for (const id of ids) expect(Number.isFinite(id), 'no attempt id came back').toBe(true);
  expect(new Set(ids).size,
    'two candidates were handed the same attempt id: ' + ids.join(', ')).toBe(4);

  // Then the rows, POLLED. Four inserts went out together over the app's
  // pooled connection and this reads over a separate direct one, so a single
  // read catches the tail of them about half the time -- which looks exactly
  // like two candidates having been silently dropped.
  await expect.poll(async () => withDb(async (c) => {
    const { rows } = await c.query(
      `SELECT user_id, count(*)::int n FROM public."onyx_assessment_attempts"
        WHERE tenant_id=$1 AND assessment_id=$2 GROUP BY user_id`,
      [w.tenantId, w.eveningPaper]);
    // One entry per candidate, and none of them holding two.
    return rows.length + ':' + rows.map((r) => Number(r.n)).join(',');
  }), { timeout: 20_000, message: 'four candidates, one attempt each' })
    .toBe('4:1,1,1,1');

  // If that ever fails, this says which candidate and when -- an extra attempt
  // is either a race in `start` or one of them never resuming, and the
  // timestamps tell those apart.
  const rows = await withDb(async (c) => {
    const { rows: r } = await c.query(
      `SELECT a.id, a.attempt, a.status, u.email
         FROM public."onyx_assessment_attempts" a
         JOIN public."onyx_users" u ON u.id = a.user_id
        WHERE a.tenant_id=$1 AND a.assessment_id=$2
        ORDER BY a.user_id, a.id`, [w.tenantId, w.eveningPaper]);
    return r.map((x) => ({
      who: String(x.email).split('.')[1], nth: Number(x.attempt), status: String(x.status),
    }));
  });
  // Counted from the rows themselves. An earlier version built one string and
  // counted the spaces in it, which the timestamps it also contained made
  // meaningless -- a diagnostic that fails on its own formatting is worse than
  // none, because it fails when everything it was watching is fine.
  const summary = rows.map((r) => r.who + '#' + r.nth + '(' + r.status + ')').join(', ');
  expect(rows.length, 'attempts were ' + summary).toBe(4);
  for (const r of rows) {
    expect(r.nth, 'a second attempt was issued: ' + summary).toBe(1);
  }
});

test('each of them answers and submits, and gets their own mark', async () => {
  const tokens = await Promise.all(CANDIDATES.map((e) => tokenFor(e)));

  const scores = await Promise.all(tokens.map(async (token, i) => {
    const started = await api('/api/onyx/assessments/' + w.eveningPaper + '/start',
      { method: 'POST', token, body: {} });
    const attempt = (started.data as {
      id: number;
      questions: { question_id: number }[];
    });

    // The first two candidates answer correctly, the last two do not, so the
    // marks cannot all come out the same by accident.
    const correct = i < 2;
    for (const q of attempt.questions) {
      await api('/api/onyx/attempts/' + attempt.id + '/answer', {
        method: 'POST', token,
        body: { question_id: q.question_id, response: correct ? 'b' : 'a' },
      });
    }
    const done = await api('/api/onyx/attempts/' + attempt.id + '/submit',
      { method: 'POST', token, body: {} });
    expect(done.status, 'candidate ' + (i + 1) + ' could not submit').toBe(200);
    return { i, attemptId: attempt.id, data: done.data as { score: number; max_score: number } };
  }));

  for (const s of scores) {
    expect(s.data.max_score, 'two questions at five points each').toBe(10);
    /*
     * Submitting DOES hand back a mark now, and this assertion is the reverse
     * of what it used to be.
     *
     * It used to require `score` to be null -- "a candidate learns nothing
     * about their score until the office releases results" -- which was the
     * behaviour until migration 0035 made instant results the default. This
     * paper is entirely objective, so the mark at submit is the final mark and
     * withholding it protected nothing.
     *
     * What the test is really for survives unchanged and is asserted below:
     * four people sitting the same paper at the same time each get THEIR OWN
     * mark. Two answered correctly and two did not, and the numbers have to
     * follow the person rather than the order they finished in.
     */
    expect(s.data.score,
      'candidate ' + (s.i + 1) + ' was not given their mark at submit')
      .toBe(s.i < 2 ? 10 : 0);
  }

  // The office sees the real marks straight away -- that is the whole point of
  // holding them back from candidates rather than from everybody.
  const token = await adminToken(adminEmail);
  const report = await api('/api/onyx/assessments/' + w.eveningPaper + '/results', { token });
  const candidates = (report.data as { candidates: { percent: number }[] }).candidates;
  expect(candidates.length, 'all four sat it').toBe(4);
  expect(candidates.filter((c) => c.percent === 100).length,
    'the two who answered correctly').toBe(2);
  expect(candidates.filter((c) => c.percent === 0).length,
    'the two who did not').toBe(2);

  // Releasing the paper is still a real action -- it closes marking for good
  // for everybody -- and it must remain harmless on attempts that are already
  // out. A second release of an already-visible mark should not disturb it.
  const released = await api('/api/onyx/assessments/' + w.eveningPaper + '/results/publish',
    { method: 'POST', token, body: {} });
  expect(released.status, 'results could not be released').toBe(200);

  // Read through the ATTEMPT, not by starting again. Once a paper is handed
  // in, `start` refuses -- one attempt allowed, and a submitted one is not a
  // live one to resume -- which is correct and is why a candidate's own
  // attempt is the route to their result.
  const seen = await Promise.all(scores.map(async (s) => {
    const mine = await api<{ score: number | null }>(
      '/api/onyx/attempts/' + s.attemptId, { token: tokens[s.i]! });
    expect(mine.status, 'candidate ' + (s.i + 1) + ' could not read their own attempt')
      .toBe(200);
    return { i: s.i, score: mine.data.score };
  }));
  for (const s of seen) {
    // The mark that follows the person, read back through their own attempt.
    // This is the assertion the test exists for: a room of people sitting one
    // paper together must not be handed each other's results.
    expect(s.score, 'candidate ' + (s.i + 1) + ' is seeing the wrong mark')
      .toBe(s.i < 2 ? 10 : 0);
  }
});

test('the link is not a way in for somebody not on the course', async ({ page }) => {
  const stranger = await tokenFor(outsider);
  const refused = await api('/api/onyx/assessments/' + w.eveningPaper + '/start',
    { method: 'POST', token: stranger, body: {} });
  expect([403, 404]).toContain(refused.status);

  // And the page says so rather than showing a Start button that cannot work.
  await signInViaForm(page, outsider);
  await page.goto('/onyx/assessments/' + w.eveningPaper);
  await expect(page.getByRole('button', { name: /^start/i })).toHaveCount(0);
});

test('a candidate cannot see or answer into somebody else\'s attempt', async () => {
  const [one, two] = await Promise.all([tokenFor(CANDIDATES[0]!), tokenFor(CANDIDATES[2]!)]);

  // Read an existing attempt rather than starting one. By this point everybody
  // has handed their paper in, and `start` rightly refuses a second attempt --
  // so asking for one here would be testing the refusal, not the isolation.
  const attemptId = await withDb(async (c) => {
    const { rows } = await c.query(
      `SELECT a.id FROM public."onyx_assessment_attempts" a
         JOIN public."onyx_users" u ON u.id = a.user_id
        WHERE a.tenant_id=$1 AND a.assessment_id=$2 AND u.email=$3`,
      [w.tenantId, w.eveningPaper, CANDIDATES[0]]);
    return Number(rows[0].id);
  });

  // The owner can read their own, which is what makes the refusals below mean
  // something rather than the id simply being wrong.
  const own = await api('/api/onyx/attempts/' + attemptId, { token: one });
  expect(own.status, 'a candidate cannot read their own attempt').toBe(200);

  const peeked = await api('/api/onyx/attempts/' + attemptId, { token: two });
  expect([403, 404]).toContain(peeked.status);

  const written = await api('/api/onyx/attempts/' + attemptId + '/answer', {
    method: 'POST', token: two, body: { question_id: 1, response: 'b' },
  });
  expect(written.status, 'one candidate wrote into another\'s paper')
    .toBeGreaterThanOrEqual(400);
});
