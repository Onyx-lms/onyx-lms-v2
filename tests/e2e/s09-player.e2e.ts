import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { api, login, withDb, ADMIN, STUDENT, RUN } from './harness.ts';

let adminToken = '';
let studentToken = '';
let studentId = 0;
let courseId = 0;
let slug = '';
const lessonIds: number[] = [];

before(async () => {
  adminToken = await login(ADMIN.email, ADMIN.password);
  studentToken = await login(STUDENT.email, STUDENT.password);
  studentId = await withDb(async (c) =>
    Number((await c.query('select id from users where email=$1', [STUDENT.email])).rows[0].id));

  const course = await api<{ id: number; slug: string }>('/api/authoring/courses', {
    token: adminToken,
    body: {
      title: 'Player E2E ' + RUN, is_paid: 0, enable_drip_content: 1,
      drip_content_settings: { lesson_completion_role: 'percentage', minimum_percentage: 80 },
    },
  });
  courseId = course.data.id;
  slug = course.data.slug;
  await api('/api/authoring/courses/' + courseId + '/status',
    { token: adminToken, body: { status: 'active' } });

  const section = await api<{ id: number }>('/api/authoring/courses/' + courseId + '/sections',
    { token: adminToken, body: { title: 'Only section' } });

  for (const title of ['Lesson one', 'Lesson two', 'Lesson three']) {
    const lesson = await api<{ id: number }>('/api/authoring/courses/' + courseId + '/lessons', {
      token: adminToken,
      body: { title, lesson_type: 'video', section_id: section.data.id,
              lesson_src: 'uploads/videos/x.mp4', duration: '00:01:00' },
    });
    lessonIds.push(lesson.data.id);
  }

  await withDb(async (c) => {
    await c.query('delete from watch_histories where course_id=$1', [courseId]);
    await c.query('delete from watch_durations where watched_course_id=$1', [courseId]);
    await c.query('delete from certificates where course_id=$1', [courseId]);
  });
});

test('PL-01 a paid course refuses a student who is not enrolled', async () => {
  const paid = await api<{ id: number; slug: string }>('/api/authoring/courses',
    { token: adminToken, body: { title: 'Locked E2E ' + RUN, is_paid: 1, price: 50 } });
  await api('/api/authoring/courses/' + paid.data.id + '/status',
    { token: adminToken, body: { status: 'active' } });

  const res = await api('/api/player/' + paid.data.slug, { token: studentToken });
  assert.equal(res.status, 403);
  assert.equal(res.message, 'Not registered for this course.');

  await api('/api/authoring/courses/' + paid.data.id, { token: adminToken, method: 'DELETE' });
});

test('PL-01 a free course opens on the first lesson', async () => {
  const res = await api<{ current: { id: number }; progress: number; total_lesson: number }>(
    '/api/player/' + slug, { token: studentToken });
  assert.equal(res.ok, true);
  assert.equal(res.data.current.id, lessonIds[0]);
  assert.equal(res.data.total_lesson, 3);
  assert.equal(res.data.progress, 0);
});

test('PL-06 drip locks every lesson except the first', async () => {
  const res = await api<{ curriculum: { lessons: { locked: boolean }[] }[] }>(
    '/api/player/' + slug, { token: studentToken });
  const lessons = res.data.curriculum.flatMap((s) => s.lessons);
  assert.equal(lessons[0].locked, false);
  assert.equal(lessons[1].locked, true);
  assert.equal(lessons[2].locked, true);

  const jump = await api('/api/player/' + slug + '?lesson=' + lessonIds[2], { token: studentToken });
  assert.equal(jump.status, 403, 'skipping ahead is refused');
});

test('PL-04 the ping accumulates ticks and completes at the threshold', async () => {
  // A 60-second lesson at 80% needs 48 seconds: ten ticks of five seconds.
  for (const marker of [0, 5, 10, 15, 20, 25, 30, 35, 40]) {
    const res = await api<{ is_completed: number }>('/api/player/ping', {
      token: studentToken,
      body: { course_id: courseId, lesson_id: lessonIds[0], current_duration: marker },
    });
    assert.equal(res.data.is_completed, 0, 'still short of the threshold at ' + marker);
  }

  const done = await api<{ is_completed: number; course_progress: number }>('/api/player/ping', {
    token: studentToken,
    body: { course_id: courseId, lesson_id: lessonIds[0], current_duration: 45 },
  });
  assert.equal(done.data.is_completed, 1);
  assert.equal(done.data.course_progress, 33.33);
});

test('PL-04 a repeated tick does not inflate progress', async () => {
  const ticks = async () => withDb(async (c) => {
    const { rows } = await c.query(
      'select watched_counter from watch_durations where watched_course_id=$1 and watched_lesson_id=$2',
      [courseId, lessonIds[0]]);
    return JSON.parse(rows[0].watched_counter).length as number;
  });

  const before = await ticks();
  for (let i = 0; i < 5; i++) {
    await api('/api/player/ping', {
      token: studentToken,
      body: { course_id: courseId, lesson_id: lessonIds[0], current_duration: 20 },
    });
  }
  assert.equal(await ticks(), before, 'a repeated marker is not counted twice');
});

test('PL-06 completing a lesson unlocks exactly the next one', async () => {
  const res = await api<{ curriculum: { lessons: { locked: boolean; completed: boolean }[] }[] }>(
    '/api/player/' + slug, { token: studentToken });
  const lessons = res.data.curriculum.flatMap((s) => s.lessons);
  assert.equal(lessons[0].completed, true);
  assert.equal(lessons[1].locked, false, 'the next lesson opened');
  assert.equal(lessons[2].locked, true, 'the one after stays shut');
});

test('PL-05 mark-complete toggles, and 100% issues exactly one certificate', async () => {
  await api('/api/player/complete',
    { token: studentToken, body: { course_id: courseId, lesson_id: lessonIds[1] } });

  const complete = await api<{ progress: number; certificate: string | null }>(
    '/api/player/complete',
    { token: studentToken, body: { course_id: courseId, lesson_id: lessonIds[2] } });
  assert.equal(complete.data.progress, 100);
  assert.ok(complete.data.certificate, 'a certificate is issued at 100%');

  // Laravel's set_watch_history toggled, so calling again marks it incomplete.
  const off = await api<{ progress: number }>('/api/player/complete',
    { token: studentToken, body: { course_id: courseId, lesson_id: lessonIds[2] } });
  assert.equal(off.data.progress < 100, true);

  await api('/api/player/complete',
    { token: studentToken, body: { course_id: courseId, lesson_id: lessonIds[2] } });

  const count = await withDb(async (c) =>
    (await c.query('select count(*)::int n from certificates where course_id=$1 and user_id=$2',
      [courseId, studentId])).rows[0].n);
  assert.equal(count, 1, 'one certificate however many times the course is finished');
});

test('PL-02 lesson media is handed over only once access is proven', async () => {
  const res = await api<{ lesson_src: string }>('/api/player/lesson/' + lessonIds[0],
    { token: studentToken });
  assert.equal(res.ok, true);
  assert.equal(res.data.lesson_src, 'uploads/videos/x.mp4');
  assert.equal((await api('/api/player/lesson/' + lessonIds[0])).status, 401);
});

test('cleanup: remove the player course', async () => {
  await withDb(async (c) => {
    await c.query('delete from certificates where course_id=$1', [courseId]);
    await c.query('delete from watch_histories where course_id=$1', [courseId]);
    await c.query('delete from watch_durations where watched_course_id=$1', [courseId]);
  });
  assert.equal((await api('/api/authoring/courses/' + courseId,
    { token: adminToken, method: 'DELETE' })).ok, true);
});
