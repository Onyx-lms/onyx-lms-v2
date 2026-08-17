import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { api, login, withDb, webPage, ADMIN, STUDENT, RUN } from './harness.ts';

let adminToken = '';
let studentToken = '';
let studentId = 0;
let courseId = 0;
let certificateId = '';
let questionId = 0;

before(async () => {
  adminToken = await login(ADMIN.email, ADMIN.password);
  studentToken = await login(STUDENT.email, STUDENT.password);
  studentId = await withDb(async (c) =>
    Number((await c.query('select id from users where email=$1', [STUDENT.email])).rows[0].id));

  const course = await api<{ id: number }>('/api/authoring/courses',
    { token: adminToken, body: { title: 'Community E2E ' + RUN, is_paid: 0 } });
  courseId = course.data.id;
  await api('/api/authoring/courses/' + courseId + '/status',
    { token: adminToken, body: { status: 'active' } });

  await withDb(async (c) => {
    await c.query('delete from certificates where course_id=$1', [courseId]);
    await c.query('delete from reviews where course_id=$1', [courseId]);
    await c.query('delete from forums where course_id=$1', [courseId]);
  });
});

test('CERT-02 issuing requires an enrolment', async () => {
  const refused = await api('/api/admin/certificates',
    { token: adminToken, body: { course_id: courseId, user_id: studentId } });
  assert.equal(refused.status, 422);
  assert.equal(refused.message, 'This student is not enrolled in the selected course.');

  await api('/api/enroll/free', { token: studentToken, body: { course_id: courseId } });

  const issued = await api<{ identifier: string }>('/api/admin/certificates',
    { token: adminToken, body: { course_id: courseId, user_id: studentId } });
  assert.equal(issued.ok, true);
  certificateId = issued.data.identifier;
  assert.equal(certificateId.length, 12);
});

test('CERT-02 a duplicate certificate is refused', async () => {
  const again = await api('/api/admin/certificates',
    { token: adminToken, body: { course_id: courseId, user_id: studentId } });
  assert.equal(again.status, 422);
  assert.match(again.message ?? '', /already been issued/);
});

test('CERT-03 verification is public and exposes no email or ids', async () => {
  const res = await api<{ verified: boolean; certificate: Record<string, unknown> }>(
    '/api/verify/certificate/' + certificateId);
  assert.equal(res.data.verified, true);
  assert.equal(res.data.certificate.identifier, certificateId);
  assert.equal('email' in res.data.certificate, false);
  assert.equal('user_id' in res.data.certificate, false);
});

test('CERT-03 an unknown id verifies false rather than erroring', async () => {
  const res = await api<{ verified: boolean }>('/api/verify/certificate/NOSUCHCERT99');
  assert.equal(res.ok, true);
  assert.equal(res.data.verified, false);
});

test('CERT-03 the verification page renders for anyone', async () => {
  const good = await webPage('/verify/certificate/' + certificateId);
  assert.equal(good.status, 200);
  assert.match(good.html, /Certificate verified/);

  const bad = await webPage('/verify/certificate/NOSUCHCERT99');
  assert.equal(bad.status, 200);
  assert.match(bad.html, /Not verified/);
});

test('CERT-04 the certificate renders with an inline QR', async () => {
  const res = await api<{ qr: string; verify_url: string }>(
    '/api/certificates/' + certificateId + '/render');
  // Inline data URI: printing or saving to PDF makes no external request.
  assert.match(res.data.qr, /^data:image\/svg\+xml;base64,/);
  assert.match(res.data.verify_url, new RegExp('/verify/certificate/' + certificateId + '$'));

  const page = await webPage('/certificate/' + certificateId);
  assert.equal(page.status, 200);
  assert.match(page.html, /Certificate of completion/);
});

test('FOR-01 a question and reply thread through the API', async () => {
  const asked = await api<{ id: number; parent_id: number }>(
    '/api/courses/' + courseId + '/forum',
    { token: studentToken, body: { title: 'How do I start?', description: 'Stuck.' } });
  assert.equal(asked.ok, true);
  questionId = asked.data.id;
  assert.equal(asked.data.parent_id, 0);

  assert.equal((await api('/api/forum/' + questionId + '/reply',
    { token: adminToken, body: { description: 'Begin with lesson one.' } })).ok, true);

  const thread = await api<{ replies: unknown[] }>('/api/forum/' + questionId,
    { token: studentToken });
  assert.equal(thread.data.replies.length, 1);
});

test('FOR-03 a like is one per user and stored as an id array', async () => {
  const first = await api<{ likes: number }>('/api/forum/' + questionId + '/react',
    { token: adminToken, body: { reaction: 'like' } });
  assert.equal(first.data.likes, 1);

  const second = await api<{ likes: number }>('/api/forum/' + questionId + '/react',
    { token: adminToken, body: { reaction: 'like' } });
  assert.equal(second.data.likes, 0, 'clicking again clears the vote');

  await api('/api/forum/' + questionId + '/react',
    { token: adminToken, body: { reaction: 'like' } });
  const stored = await withDb(async (c) =>
    (await c.query('select likes from forums where id=$1', [questionId])).rows[0].likes);
  assert.match(String(stored), /^\[\d+\]$/, 'user ids, not a counter');
});

test('FOR-02 only the author may edit their post', async () => {
  const res = await api('/api/forum/' + questionId,
    { token: adminToken, method: 'PATCH', body: { description: 'hijacked' } });
  assert.equal(res.status, 403);
});

test('R-01 a review requires enrolment, and a second one updates the first', async () => {
  assert.equal((await api('/api/courses/' + courseId + '/reviews',
    { token: studentToken, body: { rating: 5, review: 'Excellent course.' } })).ok, true);

  await api('/api/courses/' + courseId + '/reviews',
    { token: studentToken, body: { rating: 3, review: 'On reflection.' } });

  const list = await api<{ summary: { average: number; count: number } }>(
    '/api/courses/' + courseId + '/reviews');
  assert.equal(list.data.summary.count, 1);
  assert.equal(list.data.summary.average, 3);
});

test('R-01 an unenrolled account cannot review', async () => {
  const other = await api<{ id: number }>('/api/authoring/courses',
    { token: adminToken, body: { title: 'Unenrolled E2E ' + RUN, is_paid: 0 } });
  const res = await api('/api/courses/' + other.data.id + '/reviews',
    { token: studentToken, body: { rating: 5, review: 'never took it' } });
  assert.equal(res.status, 403);
  await api('/api/authoring/courses/' + other.data.id, { token: adminToken, method: 'DELETE' });
});

test('R-01 helpful votes toggle', async () => {
  const list = await api<{ reviews: { id: number }[] }>('/api/courses/' + courseId + '/reviews');
  const reviewId = list.data.reviews[0].id;
  assert.equal((await api<{ likes: number }>('/api/reviews/' + reviewId + '/react',
    { token: adminToken, body: { reaction: 'like' } })).data.likes, 1);
  assert.equal((await api<{ likes: number }>('/api/reviews/' + reviewId + '/react',
    { token: adminToken, body: { reaction: 'like' } })).data.likes, 0);
});

test('cleanup: remove the community course', async () => {
  await withDb(async (c) => {
    await c.query('delete from certificates where course_id=$1', [courseId]);
    await c.query('delete from like_dislike_reviews where review_id in '
      + '(select id from reviews where course_id=$1)', [courseId]);
    await c.query('delete from reviews where course_id=$1', [courseId]);
    await c.query('delete from forums where course_id=$1', [courseId]);
    await c.query('delete from enrollments where course_id=$1', [courseId]);
  });
  assert.equal((await api('/api/authoring/courses/' + courseId,
    { token: adminToken, method: 'DELETE' })).ok, true);
});
