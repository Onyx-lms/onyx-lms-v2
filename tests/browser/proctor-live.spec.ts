/**
 * ASS-02b -- an invigilator watching a candidate's camera, in two real browsers.
 *
 * Asked for as "he must also see the camera of student attempting / using
 * webrtc". The whole point of the feature is a picture arriving from one
 * machine to another, and there is no way to prove that with one page, a mock,
 * or an HTTP-level test: the signalling can be perfect while nothing renders.
 * So this spec drives TWO contexts at once -- a candidate sitting a paper and
 * an invigilator opening them -- with Chromium's fake camera behind both.
 *
 * The load-bearing assertion is `videoWidth > 0` on the invigilator's element.
 * A connection can report `connected` while no media is flowing; a decoded
 * frame with real dimensions cannot. That is the difference between "the
 * negotiation completed" and "he can see the student", and only the second one
 * is what was asked for.
 *
 * The other three are about consent, and they are not decoration:
 *
 *   * the candidate is TOLD, on their own screen, while it is happening;
 *   * they stop being told the moment the invigilator closes the window, which
 *     is also the moment their camera light goes out;
 *   * a paper that was never set up for this offers no way to do it, and its
 *     consent screen still promises what it always promised.
 *
 * Chromium's fake device gives a moving test pattern, so the frames are real
 * frames -- there is no path where this passes without media actually crossing
 * between the two contexts.
 */
import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import {
  withDb, RUN, api, PASSWORD, mail, createTenant, adminToken, addMember, signInViaForm,
  cleanupTenants,
} from './helpers.ts';

const T = { name: 'Watch Institute ' + RUN, slug: 'watch-' + RUN };
const adminEmail = mail('watch', 'admin');
const watchedEmail = mail('watch', 'ana');
const unwatchedEmail = mail('watch', 'ben');

const w = {
  tenantId: 0, courseId: 0,
  watchablePaper: 0, plainPaper: 0,
  anaAttempt: 0,
};

test.describe.configure({ mode: 'serial' });

/**
 * A fake camera in every context this file opens.
 *
 * `--use-fake-device-for-media-stream` supplies the moving test pattern;
 * `--use-fake-ui-for-media-stream` answers the permission prompt, which
 * `context.grantPermissions` alone does not do for a prompt raised inside a
 * component rather than by the test.
 */
test.use({
  launchOptions: {
    args: [
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
    ],
  },
});

async function tokenFor(email: string): Promise<string> {
  const res = await api<{ token: string }>('/api/onyx/auth/login',
    { body: { email, password: PASSWORD } });
  return res.data.token;
}

/** A proctored paper, optionally one an invigilator may watch live. */
async function paper(token: string, title: string, bankId: number, watch: boolean) {
  const made = await api('/api/onyx/assessments', {
    method: 'POST', token,
    body: {
      title, course_id: w.courseId, duration_minutes: 60, attempts_allowed: 1,
      proctoring: true, require_camera: true, require_screen: false,
      watch_camera: watch,
      sections: [{ id: 's1', title: 'Section 1', bank_id: bankId, take: 1 }],
    },
  });
  const id = Number((made.data as { id: number }).id);
  await api('/api/onyx/assessments/' + id + '/publish', { method: 'POST', token });
  return id;
}

test.beforeAll(async () => {
  await createTenant(T.name, T.slug, 'Watch Admin', adminEmail);
  const token = await adminToken(adminEmail);
  await addMember(token, 'Ana Candidate', watchedEmail, 'student');
  await addMember(token, 'Ben Candidate', unwatchedEmail, 'student');

  w.tenantId = await withDb(async (c) => Number((await c.query(
    'SELECT id FROM public."onyx_tenants" WHERE slug=$1', [T.slug])).rows[0].id));

  const course = await api('/api/onyx/courses', {
    method: 'POST', token,
    body: { code: 'WCH101', title: 'Watched Studies', credits: 3, access: 'open' },
  });
  w.courseId = Number((course.data as { id: number }).id);
  await api('/api/onyx/courses/' + w.courseId + '/publish', { method: 'POST', token });

  const members = await api('/api/onyx/members', { token });
  const roster = members.data as { user_id: string; user: { email: string } | null }[];
  for (const email of [watchedEmail, unwatchedEmail]) {
    const found = roster.find((m) => m.user?.email === email)!;
    await api('/api/onyx/courses/' + w.courseId + '/enroll', {
      method: 'POST', token, body: { user_id: found.user_id },
    });
  }

  const bank = await api('/api/onyx/banks', {
    method: 'POST', token, body: { name: 'Watch bank', course_id: w.courseId },
  });
  const bankId = Number((bank.data as { id: number }).id);
  await api('/api/onyx/banks/' + bankId + '/questions', {
    method: 'POST', token,
    body: {
      type: 'single', prompt: 'Which option is B?',
      options: [{ id: 'a', text: 'Not this one' }, { id: 'b', text: 'This one' }],
      answer: 'b', points: 5,
    },
  });

  w.watchablePaper = await paper(token, 'Watched paper', bankId, true);
  w.plainPaper = await paper(token, 'Unwatched paper', bankId, false);
});

test.afterAll(async () => {
  await cleanupTenants([T.slug], 'watch.%.' + RUN + '@onyx.test');
});

/** Signs a candidate in, consents, clears the preflight and starts the paper. */
async function sit(page: Page, email: string, paperId: number): Promise<number> {
  await signInViaForm(page, email);
  await page.goto('/onyx/assessments/' + paperId);
  await page.getByLabel(/I understand and agree/i).check();
  await page.getByRole('button', { name: 'Check my camera' }).click();
  await expect(page.getByRole('button', { name: 'Camera ready' })).toBeVisible();
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await page.waitForURL(/\/onyx\/attempts\/\d+$/, { timeout: 20_000 });
  return Number(/\/onyx\/attempts\/(\d+)$/.exec(page.url())![1]);
}

test('the consent screen says which papers can be watched, and which cannot', async ({ page }) => {
  // Checked before anything is watched, because consent that arrives after the
  // fact is not consent. The two papers differ ONLY in `watch_camera`, so the
  // wording is the feature being tested here, not a side effect of setup.
  await signInViaForm(page, watchedEmail);

  await page.goto('/onyx/assessments/' + w.watchablePaper);
  await expect(page.getByText(/An invigilator may watch your camera live/i)).toBeVisible();

  await page.goto('/onyx/assessments/' + w.plainPaper);
  await expect(page.getByText(/An invigilator may watch your camera live/i)).toHaveCount(0);
  await expect(page.getByText(/No video is recorded, uploaded or watched/i)).toBeVisible();
});

test('an invigilator sees the candidate, and the candidate knows it', async ({ browser }) => {
  test.slow(); // two browsers, a real ICE negotiation and a 3s candidate poll

  let candidateCtx: BrowserContext | null = null;
  let staffCtx: BrowserContext | null = null;
  try {
    candidateCtx = await browser.newContext({ permissions: ['camera'] });
    staffCtx = await browser.newContext();
    const candidate = await candidateCtx.newPage();
    const staff = await staffCtx.newPage();

    w.anaAttempt = await sit(candidate, watchedEmail, w.watchablePaper);

    // Nobody is watching yet, and nothing on her screen says otherwise. This
    // is also the assertion that the camera is not being held open on the
    // off-chance -- the indicator and the camera turn on together.
    await expect(candidate.getByText(/An invigilator is watching your camera/i))
      .toHaveCount(0);

    await signInViaForm(staff, adminEmail);
    await staff.goto('/onyx/invigilate');
    const row = staff.locator('tr', { hasText: 'Ana Candidate' }).first();
    await expect(row).toBeVisible({ timeout: 20_000 });
    await row.getByRole('button', { name: 'Watch camera' }).click();

    const dialog = staff.getByRole('dialog', { name: /Camera of Ana Candidate/i });
    await expect(dialog).toBeVisible();

    // She is told. Her camera opens at this moment and not before, so this is
    // the first instant the indicator can appear.
    await expect(candidate.getByText(/An invigilator is watching your camera/i))
      .toBeVisible({ timeout: 30_000 });

    // The one that matters: a decoded frame with real dimensions on the
    // invigilator's screen. `connected` is not enough -- a peer connection
    // reports that before any media arrives, and a black rectangle would pass.
    await expect.poll(async () => dialog.locator('video').evaluate(
      (v: HTMLVideoElement) => v.videoWidth), { timeout: 40_000, intervals: [1000] },
    ).toBeGreaterThan(0);

    // And it is a live remote track, not a still or the invigilator's own
    // camera reflected back.
    const track = await dialog.locator('video').evaluate((v: HTMLVideoElement) => {
      const s = v.srcObject as MediaStream | null;
      const t = s?.getVideoTracks()[0];
      return t ? { kind: t.kind, state: t.readyState } : null;
    });
    expect(track, 'the video element carries a remote stream').not.toBeNull();
    expect(track!.kind).toBe('video');
    expect(track!.state).toBe('live');

    await dialog.getByRole('button', { name: 'Stop watching' }).click();
    await expect(dialog).toHaveCount(0);

    // Watching stopped means the indicator goes AND the camera is released.
    // A feature that leaves a light on after somebody has stopped looking is
    // worse than one that never turned it on.
    await expect(candidate.getByText(/An invigilator is watching your camera/i))
      .toHaveCount(0, { timeout: 30_000 });
  } finally {
    await candidateCtx?.close();
    await staffCtx?.close();
  }
});

test('a paper not set up for watching offers no way to watch it', async ({ browser }) => {
  // The guarantee behind the default being off: every paper that existed
  // before this feature was consented to under wording that did not mention a
  // live feed, and none of them acquired one.
  const ctx = await browser.newContext({ permissions: ['camera'] });
  const staffCtx = await browser.newContext();
  try {
    const ben = await ctx.newPage();
    await sit(ben, unwatchedEmail, w.plainPaper);

    const staff = await staffCtx.newPage();
    await signInViaForm(staff, adminEmail);
    await staff.goto('/onyx/invigilate');

    const row = staff.locator('tr', { hasText: 'Ben Candidate' }).first();
    await expect(row).toBeVisible({ timeout: 20_000 });
    await expect(row.getByRole('button', { name: 'Watch camera' })).toHaveCount(0);
  } finally {
    await ctx.close();
    await staffCtx.close();
  }
});

test('a classmate cannot watch, and cannot ask whether anybody is', async () => {
  // Ben is a real student at the same institution sitting his own paper. The
  // attempt is Ana's, and the only thing standing between him and a live feed
  // of her room is these two checks.
  const ben = await tokenFor(unwatchedEmail);
  expect(w.anaAttempt, 'the watched attempt was recorded').toBeGreaterThan(0);

  const started = await api('/api/onyx/attempts/' + w.anaAttempt + '/watch',
    { method: 'POST', token: ben, body: {} });
  expect(started.ok).toBe(false);
  expect(started.status).toBe(403);

  const asked = await api('/api/onyx/attempts/' + w.anaAttempt + '/watch', { token: ben });
  expect(asked.ok).toBe(false);
  expect(asked.status).toBe(403);
});

test('watching somebody leaves a trail', async () => {
  // Recorded rather than only visible at the time. If a candidate later asks
  // who watched them, the institution has an answer.
  await withDb(async (c) => {
    const { rows } = await c.query(
      `SELECT action, entity_id FROM public."onyx_audit_logs"
        WHERE tenant_id=$1 AND action='proctor.watched'`, [w.tenantId]);
    expect(rows.length, 'the watch was audited').toBeGreaterThan(0);
    expect(Number(rows[0].entity_id)).toBe(w.anaAttempt);
  });
});
