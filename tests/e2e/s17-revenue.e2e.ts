import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { api, login, withDb, webPage, webLogin, ADMIN, STUDENT, RUN } from './harness.ts';

let adminToken = '';
let studentToken = '';
let instructorToken = '';
let instructorId = 0;
let courseId = 0;

before(async () => {
  adminToken = await login(ADMIN.email, ADMIN.password);
  studentToken = await login(STUDENT.email, STUDENT.password);

  const email = 'earner+' + RUN + '@onyx.test';
  const made = await api<{ id: number }>('/api/admin/users', {
    token: adminToken,
    body: { name: 'Earner ' + RUN, email, password: 'Secret#2026', role: 'instructor' },
  });
  instructorId = made.data.id;
  instructorToken = (await api<{ token: string }>('/api/auth/login',
    { body: { email, password: 'Secret#2026' } })).data.token;

  // A course owned by that instructor, with one recorded sale.
  const course = await api<{ id: number }>('/api/authoring/courses', {
    token: instructorToken,
    body: { title: 'Earning course ' + RUN, is_paid: 1, price: 100 },
  });
  courseId = course.data.id;

  await withDb(async (c) => {
    await c.query(
      'insert into payment_histories (user_id, course_id, payment_type, amount, admin_revenue,'
      + ' instructor_revenue, tax, invoice, created_at, updated_at)'
      + " values ($1,$2,'offline',100,40,60,0,$3, now(), now())",
      [1, courseId, '#rev' + RUN]);
  });
});

after(async () => {
  await withDb(async (c) => {
    await c.query('delete from payouts where user_id=$1', [instructorId]);
    await c.query('delete from payment_histories where course_id=$1', [courseId]);
    await c.query('delete from courses where id=$1', [courseId]);
    await c.query('delete from users where email like $1', ['earner+' + RUN + '@%']);
  });
});

test('REV-01 the platform report totals every stream, and reconciles', async () => {
  const refused = await api('/api/admin/revenue', { token: studentToken });
  assert.equal(refused.status, 403);

  const totals = await api<{ gross: number; instructor: number; admin: number;
                            sales: number; lines: { source: string }[] }>(
    '/api/admin/revenue', { token: adminToken });
  assert.equal(totals.ok, true);
  assert.deepEqual(totals.data.lines.map((l) => l.source),
    ['course', 'bootcamp', 'team_package', 'tuition']);
  assert.equal(
    Math.round((totals.data.instructor + totals.data.admin) * 100) / 100, totals.data.gross,
    'instructor plus platform equals gross');
  assert.equal(totals.data.gross >= 100, true, 'the sale we recorded is in there');
});

test('REV-02 an instructor sees only their own earnings', async () => {
  const mine = await api<{ totals: { instructor: number }; balance: { requestable: number } }>(
    '/api/instructor/revenue', { token: instructorToken });
  assert.equal(mine.ok, true);
  assert.equal(mine.data.totals.instructor, 60, '60 of the 100 sale');
  assert.equal(mine.data.balance.requestable, 60);

  // An instructor cannot ask for somebody else's numbers.
  const nosy = await api('/api/instructor/revenue?instructor=1', { token: instructorToken });
  assert.equal(nosy.status, 403);
  const asAdmin = await api<{ totals: { instructor: number } }>(
    '/api/instructor/revenue?instructor=' + instructorId, { token: adminToken });
  assert.equal(asAdmin.data.totals.instructor, 60, 'an admin may');
});

test('REV-06 the dashboard returns KPI counts and twelve months', async () => {
  const dash = await api<{ months: { month: string; gross: number }[];
                           counts: { users: number; courses: number; enrolments: number } }>(
    '/api/admin/dashboard', { token: adminToken });
  assert.equal(dash.ok, true);
  assert.equal(dash.data.months.length, 12);
  assert.equal(dash.data.months[11]!.month, new Date().toISOString().slice(0, 7));
  assert.equal(dash.data.counts.users > 0, true);
});

test('REV-04 a payout is requested once, capped at the balance, and paid once', async () => {
  const tooMuch = await api('/api/instructor/payouts', {
    token: instructorToken,
    body: { amount: 10_000, payment_method: 'bank', payment_details: { account: 'x' } },
  });
  assert.equal(tooMuch.status, 422);
  assert.match(tooMuch.message ?? '', /sufficient balance/);

  const made = await api<{ id: number; status: number; created_at: string }>(
    '/api/instructor/payouts', {
      token: instructorToken,
      body: { amount: 40, payment_method: 'bank', payment_details: { account: 'GB00 TEST' } },
    });
  assert.equal(made.ok, true);
  assert.equal(made.data.status, 0);
  // Laravel used Payout::insert(), which skips timestamps, so created_at was
  // NULL and the request vanished from the instructor's own filtered history.
  assert.equal(typeof made.data.created_at, 'string');

  const second = await api('/api/instructor/payouts', {
    token: instructorToken, body: { amount: 10, payment_method: 'bank' },
  });
  assert.equal(second.status, 422, 'one at a time');

  const balance = await api<{ balance: { pending: number; requestable: number } }>(
    '/api/instructor/payouts', { token: instructorToken });
  assert.equal(balance.data.balance.pending, 40);
  assert.equal(balance.data.balance.requestable, 20, 'the claimed 40 is not offerable again');

  const queue = await api<{ id: number; user: { id: number } | null }[]>(
    '/api/admin/payouts?status=0', { token: adminToken });
  assert.equal(queue.data.some((p) => p.id === made.data.id), true);

  const paid = await api('/api/admin/payouts/' + made.data.id + '/paid',
    { token: adminToken, body: { payment_method: 'bank transfer' } });
  assert.equal(paid.ok, true);
  assert.equal((await api('/api/admin/payouts/' + made.data.id + '/paid',
    { token: adminToken, body: {} })).status, 422, 'and never twice');

  const after = await api<{ balance: { paid: number; requestable: number } }>(
    '/api/instructor/payouts', { token: instructorToken });
  assert.equal(after.data.balance.paid, 40);
  assert.equal(after.data.balance.requestable, 20);
});

test('REV-04 only an admin runs the payout queue', async () => {
  assert.equal((await api('/api/admin/payouts', { token: instructorToken })).status, 403);
  assert.equal((await api('/api/admin/payouts', { token: studentToken })).status, 403);
});

test('REV-03/REV-08 a buyer sees their purchases and dashboard totals', async () => {
  const purchases = await api<{ kind: string; amount: number }[]>('/api/me/purchases',
    { token: studentToken });
  assert.equal(purchases.ok, true);
  assert.equal(Array.isArray(purchases.data), true);

  const dash = await api<{ counts: { courses: number; certificates: number; purchases: number };
                           spent: number }>('/api/me/dashboard', { token: studentToken });
  assert.equal(dash.ok, true);
  assert.equal(typeof dash.data.counts.courses, 'number');
  assert.equal(dash.data.counts.purchases, purchases.data.length);

  assert.equal((await api('/api/me/dashboard')).status, 401, 'a session is required');
});

test('REV-06/07/08 the dashboards render server-side', async () => {
  const adminCookie = await webLogin(ADMIN.email, ADMIN.password);
  const admin = await webPage('/admin/revenue', adminCookie);
  assert.equal(admin.status, 200);
  assert.match(admin.html, /Revenue/);

  const payouts = await webPage('/admin/payouts', adminCookie);
  assert.equal(payouts.status, 200);

  const studentCookie = await webLogin(STUDENT.email, STUDENT.password);
  const student = await webPage('/dashboard', studentCookie);
  assert.equal(student.status, 200);
  assert.match(student.html, /Continue learning/);

  assert.equal((await webPage('/dashboard')).status, 307, 'signed-out visitors are redirected');
});
