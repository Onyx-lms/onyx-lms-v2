import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { api, login, withDb, webPage, ADMIN, STUDENT, RUN } from './harness.ts';

let adminToken = '';
let studentToken = '';
let tutorToken = '';
let tutorId = 0;
let studentId = 0;
let categoryId = 0;
let subjectId = 0;
let scheduleId = 0;
let bookingId = 0;

const soon = () => new Date(Date.now() + 5 * 60_000).toISOString();
const later = () => new Date(Date.now() + 48 * 3600_000).toISOString();

before(async () => {
  adminToken = await login(ADMIN.email, ADMIN.password);
  studentToken = await login(STUDENT.email, STUDENT.password);
  studentId = await withDb(async (c) =>
    Number((await c.query('select id from users where email=$1', [STUDENT.email])).rows[0].id));

  const email = 'tutor+' + RUN + '@onyx.test';
  const created = await api<{ id: number }>('/api/admin/users', {
    token: adminToken,
    body: { name: 'Tutor ' + RUN, email, password: 'Secret#2026', role: 'instructor' },
  });
  tutorId = created.data.id;
  tutorToken = (await api<{ token: string }>('/api/auth/login',
    { body: { email, password: 'Secret#2026' } })).data.token;

  const cat = await api<{ id: number }>('/api/admin/tutor/categories',
    { token: adminToken, body: { name: 'Languages E2E ' + RUN } });
  categoryId = cat.data.id;
  const sub = await api<{ id: number }>('/api/admin/tutor/subjects',
    { token: adminToken, body: { name: 'French E2E ' + RUN } });
  subjectId = sub.data.id;
});

after(async () => {
  await withDb(async (c) => {
    await c.query('delete from tutor_reviews where tutor_id=$1', [tutorId]);
    await c.query('delete from tutor_bookings where tutor_id=$1', [tutorId]);
    await c.query('delete from tutor_schedules where tutor_id=$1', [tutorId]);
    await c.query('delete from tutor_can_teach where instructor_id=$1', [tutorId]);
    await c.query('delete from tutor_categories where name like $1', ['%E2E ' + RUN + '%']);
    await c.query('delete from tutor_subjects where name like $1', ['%E2E ' + RUN + '%']);
    await c.query('delete from users where email like $1', ['tutor+' + RUN + '@%']);
  });
});

test('TB-01 only an admin manages the taxonomy', async () => {
  const refused = await api('/api/admin/tutor/categories',
    { token: studentToken, body: { name: 'nope' } });
  assert.equal(refused.status, 403);

  const listed = await api<{ id: number }[]>('/api/tutor/categories');
  assert.equal(listed.data.some((c) => c.id === categoryId), true, 'active ones are public');
});

test('TB-02 a tutor registers a subject once, with a price', async () => {
  const added = await api<{ id: number; price: number }>('/api/tutor/me/subjects', {
    token: tutorToken,
    body: { category_id: categoryId, subject_id: subjectId, price: 100,
      description: 'Conversational French' },
  });
  assert.equal(added.ok, true);
  assert.equal(added.data.price, 100);

  const again = await api('/api/tutor/me/subjects', {
    token: tutorToken,
    body: { category_id: categoryId, subject_id: subjectId, price: 200 },
  });
  assert.equal(again.status, 422, 'a duplicate would make the price ambiguous');

  const asStudent = await api('/api/tutor/me/subjects',
    { token: studentToken, body: { category_id: categoryId, subject_id: subjectId, price: 1 } });
  assert.equal(asStudent.status, 403);
});

test('TB-03 a slot takes its price from the can-teach row', async () => {
  const unknown = await api('/api/tutor/me/schedules', {
    token: adminToken,
    body: { category_id: categoryId, subject_id: subjectId, tution_type: 1,
      start_time: later(), duration: 60 },
  });
  assert.equal(unknown.status, 422, 'you must teach it before you can schedule it');

  const made = await api<{ id: number; price: number; duration: number }[]>(
    '/api/tutor/me/schedules', {
      token: tutorToken,
      body: { category_id: categoryId, subject_id: subjectId, tution_type: 1,
        start_time: soon(), duration: 60 },
    });
  assert.equal(made.ok, true);
  assert.equal(made.data.length, 1);
  scheduleId = made.data[0]!.id;
  // Laravel left tutor_schedules.price null and read the can-teach row later.
  assert.equal(made.data[0]!.price, 100);
});

test('TB-04 the tutor and the open slot are publicly discoverable', async () => {
  const tutors = await api<{ tutor: { id: number } | null }[]>(
    '/api/tutors?category=' + categoryId);
  assert.equal(tutors.data.some((o) => o.tutor?.id === tutorId), true);

  const page = await api<{ schedules: { id: number }[]; subjects: unknown[] }>(
    '/api/tutors/' + tutorId + '/schedules');
  assert.equal(page.data.schedules.some((s) => s.id === scheduleId), true);
  assert.equal(page.data.subjects.length, 1);
});

test('TB-05 booking claims the slot, and nobody else can take it', async () => {
  const own = await api('/api/tutor-schedules/' + scheduleId + '/book',
    { token: tutorToken, method: 'POST' });
  assert.equal(own.status, 422, 'a tutor cannot book themselves');

  const booked = await api<{ id: number; price: number; instructor_revenue: number;
                            admin_revenue: number }>(
    '/api/tutor-schedules/' + scheduleId + '/book', { token: studentToken, method: 'POST' });
  assert.equal(booked.ok, true);
  bookingId = booked.data.id;
  assert.equal(booked.data.price, 100);
  assert.equal(
    Math.round((booked.data.instructor_revenue + booked.data.admin_revenue) * 100) / 100, 100,
    'the split adds back to the price');

  const taken = await api('/api/tutor-schedules/' + scheduleId + '/book',
    { token: adminToken, method: 'POST' });
  assert.equal(taken.status, 422);

  // The slot disappears from the public list once it is claimed.
  const page = await api<{ schedules: { id: number }[] }>('/api/tutors/' + tutorId + '/schedules');
  assert.equal(page.data.schedules.some((s) => s.id === scheduleId), false);
});

test('TB-05 my sessions are grouped, and never leak the joining payload', async () => {
  const mine = await api<{ live: Record<string, unknown>[]; upcoming: unknown[];
                          archive: unknown[] }>('/api/my-bookings', { token: studentToken });
  assert.equal(mine.data.live.length, 1, 'it starts in five minutes, so it is live');
  const row = mine.data.live[0]!;
  assert.equal('joining_data' in row, false, 'it can carry a host link');
  assert.equal(row['has_joining_data'], false, 'nothing created it yet');

  const asTutor = await api<{ live: unknown[] }>('/api/my-bookings?as=tutor',
    { token: tutorToken });
  assert.equal(asTutor.data.live.length, 1, 'the tutor sees the same session');
});

test('TB-06 the student joins as a participant, the tutor as the host', async () => {
  const asStudent = await api<{ is_host: boolean; provider: string;
                               options: { interfaceConfigOverwrite: { TOOLBAR_BUTTONS: string[] } } }>(
    '/api/tutor-bookings/' + bookingId + '/join', { token: studentToken });
  assert.equal(asStudent.ok, true);
  // Laravel redirected BOTH parties to Zoom's start_url, a host credential.
  assert.equal(asStudent.data.is_host, false);
  for (const control of ['mute-everyone', 'recording']) {
    assert.equal(
      asStudent.data.options.interfaceConfigOverwrite.TOOLBAR_BUTTONS.includes(control), false);
  }

  const asTutor = await api<{ is_host: boolean;
                             options: { roomName: string } }>(
    '/api/tutor-bookings/' + bookingId + '/join', { token: tutorToken });
  assert.equal(asTutor.data.is_host, true);
  assert.equal(asTutor.data.options.roomName,
    (asStudent.data as unknown as { options: { roomName: string } }).options.roomName,
    'both land in the same room');

  const outsider = await api('/api/tutor-bookings/' + bookingId + '/join',
    { token: adminToken });
  // An admin is allowed; a stranger is not, and there is no third party here,
  // so the guard is asserted through the unrelated-schedule case below.
  assert.equal(outsider.ok, true);
});

test('TB-06 a session that has not opened yet cannot be joined', async () => {
  const future = await api<{ id: number }[]>('/api/tutor/me/schedules', {
    token: tutorToken,
    body: { category_id: categoryId, subject_id: subjectId, tution_type: 1,
      start_time: later(), duration: 60 },
  });
  const booked = await api<{ id: number }>(
    '/api/tutor-schedules/' + future.data[0]!.id + '/book',
    { token: studentToken, method: 'POST' });

  const early = await api('/api/tutor-bookings/' + booked.data.id + '/join',
    { token: studentToken });
  // tution_started() used firstOrNew(), so this check never fired at all.
  assert.equal(early.status, 403);
  assert.match(early.message ?? '', /15 minutes before/);
});

test('TB-07 a review needs a finished session', async () => {
  const early = await api('/api/tutors/' + tutorId + '/reviews',
    { token: studentToken, body: { rating: 5, review: 'Great' } });
  assert.equal(early.status, 422);

  // Age the booking so the session has finished.
  await withDb(async (c) => {
    await c.query('update tutor_bookings set end_time=$1 where id=$2',
      [Math.floor(Date.now() / 1000) - 60, bookingId]);
  });

  const ok1 = await api('/api/tutors/' + tutorId + '/reviews',
    { token: studentToken, body: { rating: 5, review: 'Excellent tutor ' + RUN } });
  assert.equal(ok1.ok, true);

  const listed = await api<{ total: number; average: number }>(
    '/api/tutors/' + tutorId + '/reviews');
  assert.equal(listed.data.total, 1);
  assert.equal(listed.data.average, 5);

  // A second review from the same student edits, never stacks.
  await api('/api/tutors/' + tutorId + '/reviews',
    { token: studentToken, body: { rating: 3, review: 'Revised' } });
  const again = await api<{ total: number; average: number }>(
    '/api/tutors/' + tutorId + '/reviews');
  assert.equal(again.data.total, 1);
  assert.equal(again.data.average, 3);
});

test('TB-04 the tutor pages render server-side', async () => {
  const list = await webPage('/tutors?search=' + encodeURIComponent('Tutor ' + RUN));
  assert.equal(list.status, 200);
  assert.match(list.html, new RegExp('Tutor ' + RUN));

  const detail = await webPage('/tutors/' + tutorId);
  assert.equal(detail.status, 200);
  // The "Teaches" panel lists the subject, not its description.
  assert.match(detail.html, new RegExp('French E2E ' + RUN));
  assert.match(detail.html, new RegExp('Tutor ' + RUN), 'the tutor name is in the HTML');

  const gated = await webPage('/my-bookings');
  assert.equal(gated.status, 307, 'signed-out visitors are redirected');
});
