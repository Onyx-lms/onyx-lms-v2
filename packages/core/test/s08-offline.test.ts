import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeDb } from './fake-db.ts';
import { OfflinePaymentService, OFFLINE_PENDING, OFFLINE_ACCEPTED, OFFLINE_DECLINED }
  from '../src/payments/offline.service.ts';
import { PaymentService } from '../src/payments/payment.service.ts';
import { SettingsService } from '../src/settings/settings.service.ts';
import { CartService } from '../src/enrollment/cart.service.ts';
import { CouponService } from '../src/enrollment/coupon.service.ts';
import { EnrollmentService } from '../src/enrollment/enrollment.service.ts';
import { HttpError } from '../src/http/errors.ts';
import '../src/payments/index.ts';

const SECRET = 'offline-signing-secret-at-least-32-chars';

const seed = () => new FakeDb({
  settings: [
    { id: 1, type: 'system_currency', description: 'USD' },
    { id: 2, type: 'instructor_revenue', description: '70' },
    { id: 3, type: 'tax', description: '10' },
  ],
  courses: [
    { id: 1, title: 'Course A', slug: 'a', user_id: 100, is_paid: 1, price: 60,
      discount_flag: 0, discounted_price: null, expiry_period: 0, status: 'active' },
    { id: 2, title: 'Course B', slug: 'b', user_id: 100, is_paid: 1, price: 40,
      discount_flag: 0, discounted_price: null, expiry_period: 0, status: 'active' },
  ],
  users: [{ id: 100, role: 'instructor' }, { id: 12, role: 'student' }],
  cart_items: [{ id: 1, user_id: 12, course_id: 1 }, { id: 2, user_id: 12, course_id: 2 }],
  offline_payments: [], payment_histories: [], enrollments: [], coupons: [], wishlists: [],
  payment_gateways: [],
});

function build(d: FakeDb) {
  const settings = new SettingsService(d as never);
  const enrollment = new EnrollmentService(d as never);
  const coupons = new CouponService(d as never);
  const cart = new CartService(d as never, enrollment, coupons);
  const payments = new PaymentService(d as never, settings, cart, enrollment, SECRET);
  return {
    offline: new OfflinePaymentService(d as never, settings, cart, payments, SECRET),
    enrollment,
  };
}

test('PAY-15 a submission snapshots the cart with server-side amounts', async () => {
  const d = seed();
  const { offline } = build(d);
  await offline.submit(12, { bank_no: 'ACC-1', phone_on: '555', doc: 'uploads/proof.png' });

  const row = d.tables.offline_payments[0] as any;
  assert.equal(row.status, OFFLINE_PENDING);
  assert.equal(row.total_amount, 100);
  assert.equal(row.payable_amount, 110, 'includes the 10% tax');
  assert.equal(row.items, '[1,2]');
  assert.equal(row.item_type, 'course');
});

test('PAY-15 submitting with an empty cart is refused', async () => {
  const d = seed();
  d.tables.cart_items = [];
  const { offline } = build(d);
  await assert.rejects(() => offline.submit(12, {}),
    (e: HttpError) => e.message === 'Your cart is empty.');
});

test('PAY-15 a second pending request is refused', async () => {
  const d = seed();
  const { offline } = build(d);
  await offline.submit(12, {});
  await assert.rejects(() => offline.submit(12, {}),
    (e: HttpError) => e.status === 422);
});

test('PAY-15 accepting fulfils through the same path as a card payment', async () => {
  const d = seed();
  const { offline, enrollment } = build(d);
  await offline.submit(12, {});
  const result = await offline.accept(1);

  assert.equal(result.status, 'paid');
  assert.equal(d.tables.payment_histories.length, 2, 'one row per course');
  assert.equal((d.tables.offline_payments[0] as any).status, OFFLINE_ACCEPTED);

  const rows = d.tables.payment_histories as any[];
  assert.equal(rows.every((r) => r.payment_type === 'offline'), true);
  // Same revenue rules as a gateway payment: 70% instructor share.
  const booked = rows.reduce((s, r) => s + r.admin_revenue + r.instructor_revenue, 0);
  assert.equal(booked, 100);

  assert.equal(await enrollment.status(1, 12), 'valid');
  assert.equal(await enrollment.status(2, 12), 'valid');
});

test('PAY-15 accepting clears the purchased items from the cart', async () => {
  const d = seed();
  const { offline } = build(d);
  await offline.submit(12, {});
  await offline.accept(1);
  assert.equal(d.tables.cart_items.length, 0);
});

test('PAY-15 accepting twice does not enrol or charge twice', async () => {
  const d = seed();
  const { offline } = build(d);
  await offline.submit(12, {});
  await offline.accept(1);
  await assert.rejects(() => offline.accept(1),
    (e: HttpError) => e.message === 'This payment has already been reviewed.');
  assert.equal(d.tables.payment_histories.length, 2);
});

test('PAY-15 declining leaves no payment and no enrolment', async () => {
  const d = seed();
  const { offline, enrollment } = build(d);
  await offline.submit(12, {});
  await offline.decline(1);
  assert.equal((d.tables.offline_payments[0] as any).status, OFFLINE_DECLINED);
  assert.equal(d.tables.payment_histories.length, 0);
  assert.equal(await enrollment.status(1, 12), false);
});

test('PAY-15 a declined request cannot then be accepted', async () => {
  const d = seed();
  const { offline } = build(d);
  await offline.submit(12, {});
  await offline.decline(1);
  await assert.rejects(() => offline.accept(1), (e: HttpError) => e.status === 422);
});

test('PAY-15 acceptance re-reads prices instead of trusting the snapshot', async () => {
  const d = seed();
  const { offline } = build(d);
  await offline.submit(12, {});
  // The instructor raises the price while the request sits in the queue.
  (d.tables.courses[0] as any).price = 500;
  await offline.accept(1);
  const rows = d.tables.payment_histories as any[];
  const courseA = rows.find((r) => r.course_id === 1);
  assert.equal(courseA.amount, 500, 'charges the current price, not a stale one');
});

test('PAY-15 the admin queue resolves who submitted each request', async () => {
  const d = seed();
  d.tables.users.push({ id: 12, name: 'Sam Student', email: 'sam@b.test', role: 'student' });
  const { offline } = build(d);
  await offline.submit(12, { bank_no: 'ACC-9' });
  const list = await offline.list(OFFLINE_PENDING);
  assert.equal(list.length, 1);
  assert.deepEqual(list[0]?.course_ids, [1, 2]);
});
