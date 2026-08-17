import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { api, login, withDb, env, API, ADMIN, STUDENT, RUN } from './harness.ts';
import { signOrder } from '../../packages/core/src/payments/order-token.ts';

let adminToken = '';
let studentToken = '';
let studentId = 0;
let courseId = 0;

before(async () => {
  adminToken = await login(ADMIN.email, ADMIN.password);
  studentToken = await login(STUDENT.email, STUDENT.password);
  studentId = await withDb(async (c) =>
    Number((await c.query('select id from users where email=$1', [STUDENT.email])).rows[0].id));

  const created = await api<{ id: number }>('/api/authoring/courses', {
    token: adminToken,
    body: { title: 'Payment E2E ' + RUN, is_paid: 1, price: 120, expiry_period: 6 },
  });
  courseId = created.data.id;
  await api('/api/authoring/courses/' + courseId + '/status',
    { token: adminToken, body: { status: 'active' } });

  await withDb(async (c) => {
    await c.query('delete from cart_items where user_id=$1', [studentId]);
    await c.query('delete from offline_payments where user_id=$1', [studentId]);
  });
});

test('S07 checkout refuses an unknown gateway and a forged reference', async () => {
  assert.equal((await api('/api/payment/checkout',
    { token: studentToken, body: { gateway: 'nosuchpay' } })).status, 404);
  assert.equal((await api('/api/payment/complete',
    { token: studentToken, body: { reference: 'forged.token', provider_ref: 'x' } })).status, 422);
});

test('S08 webhook status codes drive the gateway retry loop', async () => {
  const unknown = await fetch(API + '/api/payment/webhook/nosuchpay',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(unknown.status, 404);

  const bad = await fetch(API + '/api/payment/webhook/stripe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'stripe-signature': 't=1,v1=bad' },
    body: '{"type":"checkout.session.completed"}',
  });
  // 400 means "never retry" -- this request did not come from the gateway.
  assert.equal(bad.status, 400);
});

test('S07 a signed webhook fulfils once and is idempotent on replay', async () => {
  const secret = 'whsec_e2e_' + RUN;
  await withDb(async (c) => {
    await c.query('delete from payment_gateways where identifier=$1', ['stripe']);
    await c.query(
      'insert into payment_gateways (identifier, title, keys, status, test_mode, created_at, updated_at)'
      + ' values ($1,$2,$3,1,1,now(),now())',
      ['stripe', 'Stripe',
       JSON.stringify({ stripe_secret_test: 'sk_test_x', webhook_secret: secret })]);
    await c.query("notify pgrst, 'reload schema'");
  });

  const reference = signOrder({
    userId: studentId, gateway: 'stripe',
    items: [{ course_id: courseId, title: 'Payment E2E', price: 120 }],
    subtotal: 120, discount: 0, tax: 0, taxRate: 0, total: 120,
    currency: 'USD', couponCode: null,
  }, env.SUPABASE_JWT_SECRET);

  const payload = JSON.stringify({
    id: 'evt_' + RUN, type: 'checkout.session.completed',
    data: { object: { id: 'cs_' + RUN, client_reference_id: reference, payment_status: 'paid' } },
  });
  const ts = Math.floor(Date.now() / 1000);
  const sig = createHmac('sha256', secret).update(ts + '.' + payload).digest('hex');
  const post = () => fetch(API + '/api/payment/webhook/stripe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'stripe-signature': 't=' + ts + ',v1=' + sig },
    body: payload,
  });

  const first = await (await post()).json();
  assert.equal(first.data.status, 'paid');
  const invoice = first.data.invoice;

  const replay = await (await post()).json();
  assert.equal(replay.data.invoice, invoice, 'the same invoice, not a second charge');
  assert.equal(replay.data.alreadyFulfilled, true);

  const rowCount = await withDb(async (c) =>
    (await c.query('select count(*)::int n from payment_histories where course_id=$1 and user_id=$2',
      [courseId, studentId])).rows[0].n);
  assert.equal(rowCount, 1, 'exactly one payment row after two deliveries');

  const status = await api<{ status: string }>('/api/enroll/status/' + courseId,
    { token: studentToken });
  assert.equal(status.data.status, 'valid');
});

test('S07 the invoice reconstructs the order and is owner-only', async () => {
  const history = await api<{ invoice: string }[]>('/api/payment/history', { token: studentToken });
  const invoice = history.data[0]!.invoice;

  const mine = await api<{ items: unknown[] }>('/api/payment/invoice/' + invoice,
    { token: studentToken });
  assert.equal(mine.ok, true);
  assert.equal(mine.data.items.length >= 1, true);

  assert.equal((await api('/api/payment/invoice/' + invoice, { token: adminToken })).status, 403);
});

test('S08 an offline payment is submitted, reviewed and fulfilled exactly once', async () => {
  await withDb(async (c) => {
    await c.query('delete from enrollments where user_id=$1 and course_id=$2', [studentId, courseId]);
    await c.query('delete from payment_histories where user_id=$1 and course_id=$2', [studentId, courseId]);
    await c.query('delete from offline_payments where user_id=$1', [studentId]);
    // Start from an empty cart: other suites share this student.
    await c.query('delete from cart_items where user_id=$1', [studentId]);
  });
  await api('/api/cart', { token: studentToken, body: { course_id: courseId } });

  const submitted = await api<{ id: number; payable_amount: number }>('/api/payment/offline',
    { token: studentToken, body: { bank_no: 'TXN-' + RUN } });
  assert.equal(submitted.ok, true);
  assert.equal(submitted.data.payable_amount, 120);

  assert.equal((await api('/api/payment/offline',
    { token: studentToken, body: { bank_no: 'TXN-2' } })).status, 422);

  const accepted = await api<{ status: string }>(
    '/api/admin/offline-payments/' + submitted.data.id + '/accept',
    { token: adminToken, body: {} });
  assert.equal(accepted.data.status, 'paid');

  assert.equal((await api('/api/admin/offline-payments/' + submitted.data.id + '/accept',
    { token: adminToken, body: {} })).status, 422);

  assert.equal((await api<{ status: string }>('/api/enroll/status/' + courseId,
    { token: studentToken })).data.status, 'valid');
  assert.equal((await api<{ items: unknown[] }>('/api/cart',
    { token: studentToken })).data.items.length, 0);
});

test('cleanup: the course this suite created is removed', async () => {
  await withDb(async (c) => {
    await c.query('delete from payment_histories where course_id=$1', [courseId]);
    await c.query('delete from enrollments where course_id=$1', [courseId]);
  });
  assert.equal((await api('/api/authoring/courses/' + courseId,
    { token: adminToken, method: 'DELETE' })).ok, true);
});
