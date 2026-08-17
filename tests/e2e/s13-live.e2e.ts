import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { api, login, withDb, webPage, webLogin, ADMIN, STUDENT, RUN } from './harness.ts';

let adminToken = '';
let studentToken = '';
let outsiderToken = '';
let studentId = 0;
let courseId = 0;
let classId = 0;

/** A time inside the join window, and one far outside it. */
const soon = () => new Date(Date.now() + 5 * 60_000).toISOString();
const later = () => new Date(Date.now() + 48 * 60 * 60_000).toISOString();

before(async () => {
  adminToken = await login(ADMIN.email, ADMIN.password);
  studentToken = await login(STUDENT.email, STUDENT.password);
  studentId = await withDb(async (c) =>
    Number((await c.query('select id from users where email=$1', [STUDENT.email])).rows[0].id));

  const email = 'lcoutsider+' + RUN + '@onyx.test';
  await api('/api/admin/users', {
    token: adminToken,
    body: { name: 'LC Outsider', email, password: 'Secret#2026', role: 'instructor' },
  });
  outsiderToken = (await api<{ token: string }>('/api/auth/login',
    { body: { email, password: 'Secret#2026' } })).data.token;

  const course = await api<{ id: number }>('/api/authoring/courses',
    { token: adminToken, body: { title: 'Live E2E ' + RUN, is_paid: 0 } });
  courseId = course.data.id;
  await api('/api/authoring/courses/' + courseId + '/status',
    { token: adminToken, body: { status: 'active' } });
  await api('/api/enroll/free', { token: studentToken, body: { course_id: courseId } });
});

after(async () => {
  await withDb(async (c) => {
    await c.query('delete from live_classes where course_id=$1', [courseId]);
    await c.query('delete from enrollments where course_id=$1', [courseId]);
    await c.query('delete from courses where id=$1', [courseId]);
    await c.query('delete from users where email like $1', ['lcoutsider+' + RUN + '@%']);
  });
});

test('LC-01 a host schedules a Jitsi class; no Zoom account is needed', async () => {
  const created = await api<{ id: number; provider: string; meeting_id: unknown }>(
    '/api/manage/courses/' + courseId + '/live-classes', {
      token: adminToken,
      body: { class_topic: 'Week 1 ' + RUN, provider: 'jitsi',
        class_date_and_time: soon(), note: 'bring questions' },
    });
  assert.equal(created.ok, true);
  classId = created.data.id;
  assert.equal(created.data.provider, 'jitsi');

  // additional_info holds the room code and must not travel to the client.
  assert.equal('additional_info' in created.data, false);
});

test('LC-01 only a host of THIS course may schedule', async () => {
  // An instructor account unrelated to the course is still not a host.
  const stranger = await api('/api/manage/courses/' + courseId + '/live-classes', {
    token: outsiderToken,
    body: { class_topic: 'nope', provider: 'jitsi', class_date_and_time: soon() },
  });
  assert.equal(stranger.status, 403);

  const student = await api('/api/manage/courses/' + courseId + '/live-classes', {
    token: studentToken,
    body: { class_topic: 'nope', provider: 'jitsi', class_date_and_time: soon() },
  });
  assert.equal(student.status, 403);
});

test('LC-01 the schedule is visible to enrolled students, and nobody else', async () => {
  const mine = await api<{ id: number; join_window: { open: boolean } }[]>(
    '/api/courses/' + courseId + '/live-classes', { token: studentToken });
  assert.equal(mine.data.some((c) => c.id === classId), true);

  const stranger = await api('/api/courses/' + courseId + '/live-classes',
    { token: outsiderToken });
  assert.equal(stranger.status, 403, 'not enrolled, not a host');

  const anon = await api('/api/courses/' + courseId + '/live-classes');
  assert.equal(anon.status, 401);
});

test('LC-05 joining returns Jitsi options with the role decided server-side', async () => {
  const host = await api<{
    provider: string; mode: string; is_host: boolean; domain: string; script_url: string;
    options: { roomName: string; interfaceConfigOverwrite: { TOOLBAR_BUTTONS: string[] } };
  }>('/api/live-classes/' + classId + '/join', { token: adminToken });

  assert.equal(host.data.provider, 'jitsi');
  assert.equal(host.data.is_host, true);
  // The script has to come from the domain it connects to.
  assert.equal(host.data.script_url, 'https://' + host.data.domain + '/external_api.js');
  assert.equal(host.data.options.interfaceConfigOverwrite.TOOLBAR_BUTTONS.includes('mute-everyone'),
    true);

  const student = await api<{
    is_host: boolean;
    options: { roomName: string; interfaceConfigOverwrite: { TOOLBAR_BUTTONS: string[] } };
  }>('/api/live-classes/' + classId + '/join', { token: studentToken });

  assert.equal(student.data.is_host, false, 'a student is never the moderator');
  for (const control of ['mute-everyone', 'recording', 'security']) {
    assert.equal(student.data.options.interfaceConfigOverwrite.TOOLBAR_BUTTONS.includes(control),
      false, 'a student must not get ' + control);
  }
  // Both land in the same room, which is what makes it the same class.
  assert.equal(student.data.options.roomName, host.data.options.roomName);
  assert.equal(student.data.options.roomName.length > 30, true, 'the room is not guessable');
});

test('LC-06 a student cannot join outside the window; the host can', async () => {
  const scheduled = await api<{ id: number }>(
    '/api/manage/courses/' + courseId + '/live-classes', {
      token: adminToken,
      body: { class_topic: 'Next week ' + RUN, provider: 'jitsi', class_date_and_time: later() },
    });

  const early = await api('/api/live-classes/' + scheduled.data.id + '/join',
    { token: studentToken });
  assert.equal(early.status, 403);
  assert.match(early.message ?? '', /not open yet/);

  // A host may open the room early to set up.
  const host = await api('/api/live-classes/' + scheduled.data.id + '/join',
    { token: adminToken });
  assert.equal(host.ok, true);

  await api('/api/manage/live-classes/' + scheduled.data.id,
    { token: adminToken, method: 'DELETE' });
});

test('LC-06 someone with no enrolment cannot join at all', async () => {
  const stranger = await api('/api/live-classes/' + classId + '/join', { token: outsiderToken });
  assert.equal(stranger.status, 403);
});

test('LC-03 scheduling a Zoom class without credentials fails cleanly', async () => {
  const configured = await api<{ configured: boolean }>('/api/admin/live-class-settings',
    { token: adminToken });

  const attempt = await api('/api/manage/courses/' + courseId + '/live-classes', {
    token: adminToken,
    body: { class_topic: 'Zoom ' + RUN, provider: 'zoom', class_date_and_time: soon() },
  });

  if (configured.data.configured) {
    // With real credentials this should actually book a meeting.
    assert.equal(attempt.ok, true);
    await api('/api/manage/live-classes/' + (attempt.data as { id: number }).id,
      { token: adminToken, method: 'DELETE' });
  } else {
    // No credentials: a clear message, and no half-created class left behind.
    assert.equal(attempt.status, 422);
    assert.match(attempt.message ?? '', /Zoom is not configured/);
    const rows = await api<{ id: number }[]>('/api/courses/' + courseId + '/live-classes',
      { token: adminToken });
    assert.equal(rows.data.some((c) => (c as { class_topic?: string }).class_topic === 'Zoom ' + RUN),
      false, 'nothing is written when the provider refuses');
  }
});

test('LC-06 the settings screen never returns the secrets themselves', async () => {
  const settings = await api<Record<string, unknown>>('/api/admin/live-class-settings',
    { token: adminToken });
  assert.equal(settings.ok, true);
  // The Laravel view printed zoom_sdk_client_secret into the page.
  assert.equal('zoom_client_secret' in settings.data, false);
  assert.equal('zoom_sdk_client_secret' in settings.data, false);
  assert.equal(typeof settings.data['zoom_sdk_client_secret_set'], 'boolean');

  const student = await api('/api/admin/live-class-settings', { token: studentToken });
  assert.equal(student.status, 403);
});

test('LC-05 the join page renders server-side for a participant', async () => {
  const cookie = await webLogin(STUDENT.email, STUDENT.password);
  const page = await webPage('/live-class/' + classId, cookie);
  assert.equal(page.status, 200);
  assert.match(page.html, new RegExp('Week 1 ' + RUN));

  const anon = await webPage('/live-class/' + classId);
  assert.equal(anon.status, 307, 'signed-out visitors are redirected');
});

test('LC-01 cancelling removes the class', async () => {
  const removed = await api('/api/manage/live-classes/' + classId,
    { token: adminToken, method: 'DELETE' });
  assert.equal(removed.ok, true);
  assert.equal((await api('/api/live-classes/' + classId + '/join',
    { token: adminToken })).status, 404);
});
