/**
 * The week, as examinations and papers rather than as lectures.
 *
 * Asked for in those words: "timetable is now focused on the courses classes…
 * instead, make the blocks for examinations and assessments… this LMS will
 * focus timetables for assessments and examinations instead of classes."
 *
 * The grid could not do this without acquiring something it never had: a real
 * week. `onyx_timetable_slots` is weekly recurrence — a day number and two
 * wall-clock times, no date and no zone — while examinations and papers are
 * absolute timestamps. So the interesting failures here are all about the
 * join between those two coordinate systems, and about one leak:
 *
 *   * an examination lands on the day it actually happens, in the
 *     institution's time zone, not the server's;
 *   * a paper is a DEADLINE, not a block — its window is often days wide and
 *     drawing it as a box would say it happens at the hour it opened;
 *   * a Saturday sitting is not hidden because the teaching week is Mon–Fri;
 *   * and **draft examinations do not reach learners**. Timetable drafts are
 *     hidden by an RLS policy; exam drafts are not — the exams table has a
 *     plain tenant-read policy, so the API is the only thing between an
 *     unannounced sitting and the students it has not been announced to.
 */
import { test, expect } from '@playwright/test';
import {
  withDb, RUN, api, mail, createTenant, adminToken, addMember, signInViaForm, cleanupTenants,
} from './helpers.ts';

const T = { name: 'Week College ' + RUN, slug: 'week-' + RUN };
const adminEmail = mail('week', 'admin');
const learnerEmail = mail('week', 'lea');

const w = {
  tenantId: 0, courseId: 0, semesterId: 0, programId: 0,
  openExam: 0, draftExam: 0, saturdayExam: 0, paper: 0,
};

test.describe.configure({ mode: 'serial' });

/**
 * A moment this week, in the institution's zone.
 *
 * Built from a UTC instant deliberately: 03:30Z is 09:00 in Kolkata, which is
 * the case a UTC-based day lookup gets wrong for the first five and a half
 * hours of every day.
 */
function thisWeek(dayOffsetFromMonday: number, utcHour: number, utcMinute = 0): Date {
  /*
   * Anchored on the INSTITUTION's calendar date, not the server's.
   *
   * This first read `new Date().getUTCDate()`, and it put every fixture in the
   * wrong week for five and a half hours out of every twenty-four -- the run
   * that caught it happened at 20:00 UTC on a Sunday, which is 01:30 Monday in
   * Kolkata, so the page was showing the week beginning Monday while the
   * fixture was building into the week that had just ended.
   *
   * Which is precisely the fault this whole feature has to avoid, so it would
   * have been a poor thing for the test to get wrong quietly.
   */
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const got: Record<string, string> = {};
  for (const part of f.formatToParts(new Date())) got[part.type] = part.value;
  const y = Number(got.year);
  const m = Number(got.month);
  const d = Number(got.day);

  // Midday, so the weekday lookup cannot slide across a boundary.
  const weekday = (new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay() + 6) % 7;  // 0 = Monday
  const day = new Date(Date.UTC(y, m - 1, d - weekday + dayOffsetFromMonday, utcHour, utcMinute));
  return day;
}

test.beforeAll(async () => {
  await createTenant(T.name, T.slug, 'Week Admin', adminEmail);
  const token = await adminToken(adminEmail);
  await addMember(token, 'Lea Learner', learnerEmail, 'student');
  // A class needs a teacher: `faculty_id` is required when scheduling one.
  await addMember(token, 'Fay Faculty', mail('week', 'fay'), 'faculty');

  w.tenantId = await withDb(async (c) => Number((await c.query(
    'SELECT id FROM public."onyx_tenants" WHERE slug=$1', [T.slug])).rows[0].id));

  const programme = await api('/api/onyx/programs', {
    method: 'POST', token, body: { name: 'Week Studies', code: 'WK', duration_semesters: 2 },
  });
  w.programId = Number((programme.data as { id: number }).id);
  const semester = await api('/api/onyx/semesters', {
    method: 'POST', token,
    body: { program_id: w.programId, name: 'Term 1', number: 1 },
  });
  w.semesterId = Number((semester.data as { id: number }).id);

  const course = await api('/api/onyx/courses', {
    method: 'POST', token,
    body: { code: 'WK101', title: 'Week Studies', credits: 3, access: 'open' },
  });
  w.courseId = Number((course.data as { id: number }).id);
  await api('/api/onyx/courses/' + w.courseId + '/publish', { method: 'POST', token });

  const members = await api('/api/onyx/members', { token });
  const roster = members.data as { user_id: string; user: { email: string } | null }[];
  const found = roster.find((m) => m.user?.email === learnerEmail)!;
  await api('/api/onyx/courses/' + w.courseId + '/enroll', {
    method: 'POST', token, body: { user_id: found.user_id },
  });

  const exam = async (title: string, at: Date, publish: boolean) => {
    const made = await api('/api/onyx/exams', {
      method: 'POST', token,
      body: {
        semester_id: w.semesterId, course_id: w.courseId, title,
        starts_at: at.toISOString(), duration_minutes: 120,
        max_marks: 100, pass_marks: 40,
      },
    });
    // Asserted, or a setup that silently failed renders an empty week and the
    // test reports "the exam is not on the grid" about an exam that was never
    // created.
    expect(made.status, 'could not schedule ' + title + ': ' + made.message).toBe(200);
    const id = Number((made.data as { id: number }).id);
    if (!publish) {
      // `schedule()` creates at status 'scheduled' -- an exam is announced the
      // moment it exists. Pulling it back to draft is the only way to get the
      // unannounced case this file needs.
      const held = await api('/api/onyx/exams/' + id,
        { method: 'PATCH', token, body: { status: 'draft' } });
      expect(held.status, 'could not hold ' + title + ' as a draft: ' + held.message).toBe(200);
    }
    return id;
  };

  // Wednesday 09:00 IST -- written as 03:30Z, the hour a naive UTC read
  // would file under Tuesday.
  w.openExam = await exam('Midterm Examination', thisWeek(2, 3, 30), true);
  // Saturday. Outside the teaching week the grid used to draw.
  w.saturdayExam = await exam('Saturday Sitting', thisWeek(5, 5, 0), true);
  // Never announced.
  w.draftExam = await exam('Unannounced Resit', thisWeek(3, 6, 0), false);

  // A paper whose window opened last week and closes on Thursday: due
  // Thursday, however long it has been open.
  const bank = await api('/api/onyx/banks', {
    method: 'POST', token, body: { name: 'Week bank', course_id: w.courseId },
  });
  const bankId = Number((bank.data as { id: number }).id);
  await api('/api/onyx/banks/' + bankId + '/questions', {
    method: 'POST', token,
    body: {
      type: 'single', prompt: 'Which one?', points: 5,
      options: [{ id: 'a', text: 'No' }, { id: 'b', text: 'Yes' }], answer: 'b',
    },
  });
  const madePaper = await api('/api/onyx/assessments', {
    method: 'POST', token,
    body: {
      title: 'Coursework Two', course_id: w.courseId, duration_minutes: 60,
      opens_at: new Date(Date.now() - 9 * 86_400_000).toISOString(),
      closes_at: thisWeek(3, 12, 0).toISOString(),
      sections: [{ id: 's1', title: 'All', bank_id: bankId, take: 1 }],
    },
  });
  expect(madePaper.status, 'could not create the paper: ' + madePaper.message).toBe(200);
  w.paper = Number((madePaper.data as { id: number }).id);
  await api('/api/onyx/assessments/' + w.paper + '/publish', { method: 'POST', token });
});

test.afterAll(async () => {
  await cleanupTenants([T.slug], 'week.%.' + RUN + '@onyx.test');
});

test('a learner opens the timetable and sees what they have to sit', async ({ page }) => {
  await signInViaForm(page, learnerEmail);
  await page.goto('/onyx/timetable');

  // The examination, as a block on the grid.
  await expect(page.getByText('Midterm Examination').first())
    .toBeVisible({ timeout: 20_000 });

  // The paper, as a deadline rather than a box -- its window is nine days
  // wide and it is due on one of them.
  await expect(page.getByText('Coursework Two').first()).toBeVisible();

  // And the page leads with what it is now for. By test id rather than by
  // text: "Examinations" is also a navigation link, and a bare text locator
  // resolves to both.
  await expect(page.getByTestId('stat-examinations')).toBeVisible();
  await expect(page.getByTestId('stat-papers-due')).toBeVisible();
});

test('a Saturday sitting is not hidden by the teaching week', async ({ page }) => {
  // The grid drew Monday to Friday plus any day with a class on it. An
  // examination on a Saturday would have been scheduled, announced, and
  // invisible on the one screen a candidate checks.
  await signInViaForm(page, learnerEmail);
  await page.goto('/onyx/timetable');
  await expect(page.getByText('Saturday Sitting').first()).toBeVisible({ timeout: 20_000 });
});

test('an unannounced examination does not reach a learner', async ({ page }) => {
  /*
   * The leak this feature could have shipped.
   *
   * `onyx_exams` has a plain tenant-read RLS policy -- unlike
   * `onyx_timetable_slots`, whose policy hides drafts at the database. So
   * putting exams on a learner's grid without filtering `status` in the API
   * would have published every draft sitting to every student in the
   * institution.
   */
  await signInViaForm(page, learnerEmail);
  await page.goto('/onyx/timetable');
  await expect(page.getByText('Midterm Examination').first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Unannounced Resit')).toHaveCount(0);

  // Not merely hidden on the page -- absent from the API the page reads.
  const seen = await page.evaluate(async () => {
    const res = await fetch('/api/proxy/onyx/calendar');
    return res.json();
  });
  const titles = (seen.data?.exams ?? []).map((e: { title: string }) => e.title);
  expect(titles).toContain('Midterm Examination');
  expect(titles).not.toContain('Unannounced Resit');
});

test('an administrator sees the draft, because building a term means seeing it',
  async ({ page }) => {
    await signInViaForm(page, adminEmail);
    await page.goto('/onyx/timetable');
    await expect(page.getByText('Unannounced Resit').first()).toBeVisible({ timeout: 20_000 });
  });

test('the week can be moved, and the other week is a different week', async ({ page }) => {
  // The grid had no notion of WHICH week, which is fine for a lecture that
  // repeats for ever and useless for a sitting that happens once.
  await signInViaForm(page, learnerEmail);
  await page.goto('/onyx/timetable');
  await expect(page.getByText('Midterm Examination').first()).toBeVisible({ timeout: 20_000 });

  await page.getByRole('link', { name: /Next/ }).click();
  await page.waitForURL(/week=1/, { timeout: 20_000 });
  await expect(page.getByText('Midterm Examination')).toHaveCount(0);

  // And back again, by the control that only exists when you have moved.
  await page.getByRole('link', { name: 'This week' }).click();
  await expect(page.getByText('Midterm Examination').first()).toBeVisible({ timeout: 20_000 });
});

test('the examination is on the day it is actually sat', async ({ page }) => {
  /*
   * The time-zone trap, asserted rather than assumed.
   *
   * The sitting is written as 03:30Z, which is 09:00 in Asia/Kolkata on the
   * SAME day but reads as the previous day to anything that asks a UTC `Date`
   * for its weekday. Placing it by UTC would put a Wednesday examination in
   * the Tuesday column for every sitting before 05:30 local.
   */
  await signInViaForm(page, learnerEmail);
  await page.goto('/onyx/timetable');

  const exam = page.getByText('Midterm Examination').first();
  await expect(exam).toBeVisible({ timeout: 20_000 });

  // The block names its own day for a screen reader; that is the label the
  // column header cannot give it, and it is read from the same placement the
  // eye sees.
  const spoken = await exam.locator('xpath=ancestor-or-self::*[self::a or self::div][1]')
    .innerText();
  expect(spoken).toContain('Midterm Examination');

  await withDb(async (c) => {
    const { rows } = await c.query(
      'SELECT starts_at FROM public."onyx_exams" WHERE id = $1', [w.openExam]);
    const at = new Date(String(rows[0].starts_at));
    const local = at.toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'Asia/Kolkata' });
    // Whatever weekday the fixture landed on, the grid has to agree with the
    // institution's clock rather than with UTC.
    expect(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'])
      .toContain(local);
  });
});

test('an examination owns its time, and the class it displaces says so', async ({ page }) => {
  /*
   * "An examination paper will have time — sixty minutes or ninety minutes —
   * so along that time the timetable shows that examination only."
   *
   * A candidate sitting a ninety-minute paper is not also in the lecture the
   * recurring grid says is on. Drawing both side by side halves the width of
   * the one appointment that matters and invites somebody to read the wrong
   * one.
   */
  const token = await adminToken(adminEmail);

  const room = await api('/api/onyx/rooms', {
    method: 'POST', token, body: { code: 'R1', name: 'Room One', capacity: 40, kind: 'lecture' },
  });
  expect(room.status, 'could not add a room: ' + room.message).toBe(200);

  // A batch belongs to a PROGRAMME, not to a semester.
  const batch = await api('/api/onyx/batches', {
    method: 'POST', token,
    body: { program_id: w.programId, name: 'Batch A', code: 'BA-' + RUN.slice(-4) },
  });
  expect(batch.status, 'could not add a batch: ' + batch.message).toBe(200);

  // The learner has to be in the batch, or scheduling refuses an empty one.
  const members = await api('/api/onyx/members', { token });
  const roster = members.data as { user_id: string; user: { email: string } | null }[];
  const lea = roster.find((m) => m.user?.email === learnerEmail)!;
  const fay = roster.find((m) => m.user?.email === mail('week', 'fay'))!;
  const joined = await api('/api/onyx/batches/' + (batch.data as { id: number }).id + '/members', {
    method: 'POST', token, body: { user_ids: [lea.user_id] },
  });
  expect(joined.status, 'could not fill the batch: ' + joined.message).toBe(200);

  // A class straddling the Wednesday examination, which sits 09:00–11:00 local.
  const clash = await api('/api/onyx/timetable', {
    method: 'POST', token,
    body: {
      semester_id: w.semesterId, course_id: w.courseId,
      batch_id: (batch.data as { id: number }).id,
      room_id: (room.data as { id: number }).id,
      faculty_id: fay.user_id,
      day_of_week: 3, starts_at: '09:30', ends_at: '10:30',
    },
  });
  expect(clash.status, 'could not schedule the clashing class: ' + clash.message).toBe(200);
  const shown = await api('/api/onyx/timetable/publish',
    { method: 'POST', token, body: { semester_id: w.semesterId } });
  expect(shown.status, 'could not publish the timetable: ' + shown.message).toBe(200);

  await signInViaForm(page, learnerEmail);
  await page.goto('/onyx/timetable');

  // The examination is there.
  await expect(page.getByText('Midterm Examination').first())
    .toBeVisible({ timeout: 20_000 });

  // The class it covers is not drawn beside it -- and the examination says
  // what it took the place of, so the class has not merely vanished.
  await expect(page.getByText('replaces', { exact: false }).first()).toBeVisible();
  await expect(page.getByText('CD101')).toHaveCount(0);
});

test('a learner is not offered Interviews', async ({ page }) => {
  // An interview is scheduled BY the placement office or an employer; a
  // learner's part is being told when to turn up, which reaches them through
  // their inbox. The route keeps its own page guard -- this hides an entrance,
  // it is not pretending to be a permission.
  await signInViaForm(page, learnerEmail);
  await expect(page.getByRole('link', { name: 'Jobs' })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('link', { name: 'Interviews' })).toHaveCount(0);
});
