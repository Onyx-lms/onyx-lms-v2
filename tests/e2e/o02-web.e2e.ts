/**
 * Onyx O02 web layer.
 *
 * The API tests prove the rules. These prove the pages honour them: that a
 * learner's course page shows their own progress, that a locked lesson is not
 * a link, that the marking screen is not reachable by the person being marked,
 * and that the dashboard actually answers "what do I do next".
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { api, createTenant, webPage, withDb, WEB, RUN, onyxWebLogin } from './harness.ts';

/** The rendered document, without the RSC payload. See o01-web.e2e.ts. */
const dom = (html: string) => html.replace(/<script[\s\S]*?<\/script>/g, '');

/**
 * Just the content column.
 *
 * The shell's navigation is part of every page, and it names things: a
 * learner's sidebar links to "Results", which made a whole-page search for
 * "Result" true on a page that was showing nothing of the sort. Anything
 * asserting that a value has NOT leaked has to look at the content, not at
 * the furniture around it.
 */
const content = (html: string) => {
  const body = dom(html);
  const start = body.lastIndexOf('<main');
  if (start === -1) return body;
  const end = body.indexOf('</main>', start);
  return end === -1 ? body.slice(start) : body.slice(start, end);
};

const pw = 'OnyxTest#2026';
const mail = (who: string) => 'lw.' + who + '.' + RUN + '@onyx.test';
const T = { name: 'Web Learn College ' + RUN, slug: 'web-learn-' + RUN };

const w = {
  tenant: 0,
  cookies: {} as Record<string, string>,
  ids: {} as Record<string, string>,
  course: 0, lesson: 0, lockedLesson: 0, assignment: 0, submission: 0, session: 0,
};

/** Through the web proxy, so the cookie-per-product routing is exercised too. */
async function viaWeb<T = any>(path: string, cookie: string, init: {
  method?: string; body?: unknown;
} = {}) {
  const res = await fetch(WEB + '/api/proxy/onyx/' + path, {
    method: init.method ?? (init.body !== undefined ? 'POST' : 'GET'),
    headers: {
      cookie,
      ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, ok: Boolean(json.ok), data: json.data as T, message: json.message };
}

test('a college with a course, a cohort and some work', async () => {
  const created = await createTenant({
    name: T.name, slug: T.slug,
    admin: { name: 'Admin', email: mail('admin'), password: pw },
  });
  assert.equal(created.ok, true, created.message);
  w.tenant = Number(created.data.tenant.id);
  w.cookies.admin = await onyxWebLogin(mail('admin'), pw);

  for (const [who, role] of [['faculty', 'faculty'], ['student', 'student'],
    ['other', 'student']] as const) {
    const r = await viaWeb<{ user: { id: string } }>('members', w.cookies.admin, {
      body: { name: who, email: mail(who), role, password: pw },
    });
    assert.equal(r.ok, true, 'invite ' + who + ': ' + r.message);
    w.ids[who] = r.data.user.id;
    w.cookies[who] = await onyxWebLogin(mail(who), pw);
  }

  const course = await viaWeb<{ id: number }>('courses', w.cookies.admin, {
    body: { code: 'WEB101', title: 'Web Course', credits: 3 },
  });
  w.course = Number(course.data.id);
  await viaWeb('courses/' + w.course + '/faculty', w.cookies.admin,
    { body: { user_id: w.ids.faculty } });
  await viaWeb('courses/' + w.course, w.cookies.admin,
    { method: 'PATCH', body: { status: 1 } });
  await viaWeb('courses/' + w.course + '/enroll', w.cookies.admin,
    { body: { user_id: w.ids.student } });

  const mod = await viaWeb<{ id: number }>('courses/' + w.course + '/modules', w.cookies.faculty,
    { body: { title: 'Week 1' } });
  const open = await viaWeb<{ id: number }>('modules/' + mod.data.id + '/lessons',
    w.cookies.faculty,
    { body: { title: 'Open Lesson', type: 'video', path: 'onyx/demo/a.mp4', duration_seconds: 600 } });
  w.lesson = Number(open.data.id);
  const locked = await viaWeb<{ id: number }>('modules/' + mod.data.id + '/lessons',
    w.cookies.faculty,
    { body: { title: 'Locked Lesson', type: 'video', path: 'onyx/demo/b.mp4' } });
  w.lockedLesson = Number(locked.data.id);

  const session = await viaWeb<{ id: number }>('courses/' + w.course + '/attendance',
    w.cookies.faculty,
    { body: { title: 'Lecture 1', scheduled_at: new Date().toISOString() } });
  w.session = Number(session.data.id);

  const assignment = await viaWeb<{ id: number }>('courses/' + w.course + '/assignments',
    w.cookies.faculty,
    { body: {
      title: 'Web Essay', instructions: 'Write it.', total_points: 100,
      due_at: new Date(Date.now() + 86_400_000).toISOString(),
    } });
  w.assignment = Number(assignment.data.id);
  await viaWeb('assignments/' + w.assignment + '/publish', w.cookies.faculty, { method: 'POST' });
});

test('the catalog separates what you are taking from what exists', async () => {
  const page = await webPage('/onyx/courses', w.cookies.student);
  assert.equal(page.status, 200);
  const html = dom(page.html);
  assert.match(html, /Your courses/, 'an enrolled learner was not shown their own courses');
  assert.match(html, /Web Course/);

  const outsider = dom((await webPage('/onyx/courses', w.cookies.other)).html);
  assert.ok(!outsider.includes('Your courses'),
    'someone enrolled in nothing was shown a "your courses" list');
  // The catalog itself is still visible -- that is what a catalog is for.
  assert.match(outsider, /Web Course/);
});

test('the course page locks what the learner has not been given', async () => {
  const enrolled = dom((await webPage('/onyx/courses/' + w.course, w.cookies.student)).html);
  assert.match(enrolled, /Your progress/);
  assert.match(enrolled, new RegExp('/onyx/courses/' + w.course + '/lessons/' + w.lesson));

  const outsider = dom((await webPage('/onyx/courses/' + w.course, w.cookies.other)).html);
  assert.match(outsider, /not enrolled in this course/);
  assert.match(outsider, /Locked Lesson/, 'the outline should still show the shape');
  // A locked lesson is not a link. Rendering one and refusing it on click would
  // be a worse experience for the same security.
  assert.ok(!outsider.includes('/lessons/' + w.lockedLesson),
    'a locked lesson was rendered as a link');
});

test('the lesson page resumes, and refuses whoever is not in the course', async () => {
  await viaWeb('lessons/' + w.lesson + '/progress', w.cookies.student,
    { body: { position_seconds: 240 } });

  const page = await webPage('/onyx/courses/' + w.course + '/lessons/' + w.lesson,
    w.cookies.student);
  assert.equal(page.status, 200);
  assert.match(dom(page.html), /Open Lesson/);
  // The player seeks to this on loadedmetadata; it reaches the page as a prop.
  assert.match(page.html, /240/, 'the saved position did not reach the player');

  // The page throws rather than rendering a locked player.
  const denied = await webPage('/onyx/courses/' + w.course + '/lessons/' + w.lesson,
    w.cookies.other);
  assert.notEqual(denied.status, 200, 'a non-enrolled learner reached the lesson page');
});

test('the session page shows the code to faculty and a box to a learner', async () => {
  const staff = dom((await webPage(
    '/onyx/courses/' + w.course + '/attendance/' + w.session, w.cookies.faculty)).html);
  assert.match(staff, /Check-in code/);
  assert.match(staff, /Save attendance/, 'faculty were not given the roster');

  const learner = dom((await webPage(
    '/onyx/courses/' + w.course + '/attendance/' + w.session, w.cookies.student)).html);
  assert.match(learner, /Check in/);
  // The panel's countdown, not the words "check-in code" -- the learner's input
  // carries that as its accessible label, and should.
  assert.ok(!learner.includes('Only the code on screen'), 'a learner was shown the code panel');
  assert.ok(!learner.includes('Save attendance'), 'a learner was shown the roster');

  // The exact code, rather than anything that looks like one: a hex-shaped
  // string test matches asset hashes and ids and says nothing.
  const code = await viaWeb<{ code: string }>(
    'attendance/' + w.session + '/code', w.cookies.faculty);
  assert.equal(code.ok, true, code.message);
  const served = (await webPage(
    '/onyx/courses/' + w.course + '/attendance/' + w.session, w.cookies.student)).html;
  assert.equal(served.includes(code.data.code), false,
    'the check-in code reached a learner');
});

test('the assignment page shows the brief to a learner and the queue to faculty', async () => {
  const learner = dom((await webPage('/onyx/assignments/' + w.assignment, w.cookies.student)).html);
  assert.match(learner, /Your answer/);
  assert.match(learner, /Write it\./);
  assert.ok(!learner.includes('Submissions'), 'a learner was shown the marking queue');

  const staff = dom((await webPage('/onyx/assignments/' + w.assignment, w.cookies.faculty)).html);
  assert.match(staff, /Submissions/);
  assert.ok(!staff.includes('Your answer'), 'faculty were shown a submission box');
});

test('a returned grade appears for the learner, and only then', async () => {
  const submitted = await viaWeb('assignments/' + w.assignment + '/submit', w.cookies.student,
    { body: { body: 'my answer' } });
  assert.equal(submitted.ok, true, submitted.message);

  const queue = await viaWeb<{ submissions: { id: number }[] }>(
    'assignments/' + w.assignment, w.cookies.faculty);
  w.submission = Number(queue.data.submissions[0]!.id);

  await viaWeb('submissions/' + w.submission + '/grade', w.cookies.faculty,
    { body: { score: 88, feedback: 'Good work.' } });

  const before = content(
    (await webPage('/onyx/assignments/' + w.assignment, w.cookies.student)).html);
  assert.ok(!before.includes('Good work.'), 'feedback leaked before it was returned');
  assert.ok(!before.includes('Result'), 'a result appeared before it was returned');

  await viaWeb('submissions/' + w.submission + '/return', w.cookies.faculty, { method: 'POST' });

  const after = content(
    (await webPage('/onyx/assignments/' + w.assignment, w.cookies.student)).html);
  assert.match(after, /Result/);
  assert.match(after, /88/);
  assert.match(after, /Good work\./);
});

test('the marking screen is not reachable by the person being marked', async () => {
  const staff = await webPage('/onyx/submissions/' + w.submission, w.cookies.faculty);
  assert.equal(staff.status, 200);
  assert.match(dom(staff.html), /my answer/);

  // requireOnyxPageRole redirects rather than rendering.
  assert.equal((await webPage('/onyx/submissions/' + w.submission, w.cookies.student)).status, 307);
  assert.equal((await webPage('/onyx/programs', w.cookies.student)).status, 307);
});

test('the dashboard tells a learner what to do next', async () => {
  const page = dom((await webPage('/onyx/dashboard', w.cookies.student)).html);
  assert.match(page, /What you are taking/);
  assert.match(page, /Web Course/);
  assert.match(page, /Due next/, 'no deadline list for a learner with work due');
  assert.match(page, /Web Essay/);

  // Staff get the shape of the institution instead.
  const staff = dom((await webPage('/onyx/dashboard', w.cookies.admin)).html);
  assert.match(staff, /People/);
  assert.ok(!staff.includes('Due next'), 'an admin was shown a learner deadline list');
});

test('navigation matches the role', async () => {
  const learner = dom((await webPage('/onyx/dashboard', w.cookies.student)).html);
  assert.match(learner, /Courses/);
  assert.ok(!learner.includes('Programmes'), 'a learner was offered the programme structure');
  assert.ok(!learner.includes('Audit log'));

  const staff = dom((await webPage('/onyx/dashboard', w.cookies.faculty)).html);
  assert.match(staff, /Programmes/);
  assert.ok(!staff.includes('Audit log'), 'faculty were offered the audit log');
});

test('cleanup leaves nothing behind', async () => {
  await withDb(async (c) => {
    await c.query('DELETE FROM public."onyx_tenants" WHERE slug = $1', [T.slug]);
    await c.query('DELETE FROM public."onyx_users" WHERE email LIKE $1',
      ['lw.%.' + RUN + '@onyx.test']);
  });
  // 403, not 401: credentials live in Supabase Auth now (ADR-011), separate
  // from the onyx_users profile row this deletes, so signInWithPassword
  // still succeeds and the rejection comes from the missing profile, one
  // step later. Access is equally denied either way.
  const gone = await api('/api/onyx/auth/login', { body: { email: mail('admin'), password: pw } });
  assert.equal(gone.status, 403);
});
