import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { api, login, withDb, ADMIN, STUDENT, RUN } from './harness.ts';

export const state = { adminToken: '', studentToken: '', studentId: 0, courseId: 0 };

before(async () => {
  state.adminToken = await login(ADMIN.email, ADMIN.password);
  state.studentToken = await login(STUDENT.email, STUDENT.password);
  state.studentId = await withDb(async (c) => {
    const { rows } = await c.query('select id from users where email=$1', [STUDENT.email]);
    return Number(rows[0].id);
  });

  const created = await api<{ id: number }>('/api/authoring/courses', {
    token: state.adminToken,
    body: { title: 'Commerce E2E ' + RUN, is_paid: 1, price: 120, expiry_period: 6 },
  });
  state.courseId = created.data.id;
  await api('/api/authoring/courses/' + state.courseId + '/status',
    { token: state.adminToken, body: { status: 'active' } });

  await withDb(async (c) => {
    await c.query('delete from cart_items where user_id=$1', [state.studentId]);
    await c.query('delete from offline_payments where user_id=$1', [state.studentId]);
  });
});

test('S06 wishlist toggles on and off', async () => {
  const on = await api<{ wishlisted: boolean }>('/api/wishlist/toggle',
    { token: state.studentToken, body: { course_id: state.courseId } });
  assert.equal(on.data.wishlisted, true);
  const off = await api<{ wishlisted: boolean }>('/api/wishlist/toggle',
    { token: state.studentToken, body: { course_id: state.courseId } });
  assert.equal(off.data.wishlisted, false);
});

test('S06 the cart guards own-course and duplicate adds', async () => {
  const add = await api<{ items: unknown[]; subtotal: number }>('/api/cart',
    { token: state.studentToken, body: { course_id: state.courseId } });
  assert.equal(add.ok, true);
  assert.equal(add.data.subtotal, 120);

  const again = await api<{ items: unknown[] }>('/api/cart',
    { token: state.studentToken, body: { course_id: state.courseId } });
  assert.equal(again.data.items.length, 1, 'adding twice does not duplicate');

  const own = await api('/api/cart',
    { token: state.adminToken, body: { course_id: state.courseId } });
  assert.equal(own.status, 422);
  assert.equal(own.message, 'Ops! You own this course.');
});

test('S06 a coupon applies, and a disabled one is refused', async () => {
  const code = 'E2E' + RUN.toUpperCase().slice(-6);
  const expiry = String(Math.floor((Date.now() + 30 * 86400000) / 1000));
  const created = await api<{ id: number }>('/api/admin/coupons',
    { token: state.adminToken, body: { code, discount: 25, expiry } });
  assert.equal(created.ok, true);

  const applied = await api<{ subtotal: number; discount: number; total: number }>(
    '/api/cart?coupon=' + code, { token: state.studentToken });
  assert.equal(applied.data.subtotal, 120);
  assert.equal(applied.data.discount, 30);
  assert.equal(applied.data.total, 90);

  await api('/api/admin/coupons/' + created.data.id + '/status',
    { token: state.adminToken, body: {} });
  const disabled = await api<{ discount: number; coupon_error?: string }>(
    '/api/cart?coupon=' + code, { token: state.studentToken });
  // Laravel applied disabled coupons, because PHP treats the string "0" as falsy.
  assert.equal(disabled.data.discount, 0);
  assert.equal(disabled.data.coupon_error, 'This coupon is not valid.');

  await api('/api/admin/coupons/' + created.data.id, { token: state.adminToken, method: 'DELETE' });
});

test('S06 an expired enrolment can be re-bought, an active one cannot', async () => {
  await api('/api/cart', { token: state.studentToken, body: { course_id: state.courseId } });
  const status = await api<{ status: string | false }>(
    '/api/enroll/status/' + state.courseId, { token: state.studentToken });
  assert.equal(status.data.status, false, 'not enrolled yet');
});
