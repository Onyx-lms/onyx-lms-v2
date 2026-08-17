import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeDb } from './fake-db.ts';
import { EnrollmentService, expiryDateFor } from '../src/enrollment/enrollment.service.ts';
import { CouponService, isCouponActive, couponExpiryMs } from '../src/enrollment/coupon.service.ts';
import { CartService, WishlistService, effectivePrice } from '../src/enrollment/cart.service.ts';
import { HttpError } from '../src/http/errors.ts';

const DAY = 86400000;
const seed = () => new FakeDb({
  courses: [
    { id: 1, title: 'Paid course', slug: 'paid', user_id: 100, is_paid: 1, price: 100,
      discount_flag: 0, discounted_price: null, expiry_period: 0, status: 'active' },
    { id: 2, title: 'Free course', slug: 'free', user_id: 100, is_paid: 0, price: null,
      discount_flag: 0, discounted_price: null, expiry_period: 0, status: 'active' },
    { id: 3, title: 'Discounted', slug: 'disc', user_id: 100, is_paid: 1, price: 80,
      discount_flag: 1, discounted_price: 40, expiry_period: 6, status: 'active' },
    { id: 4, title: 'Own course', slug: 'own', user_id: 12, is_paid: 1, price: 50,
      discount_flag: 0, discounted_price: null, expiry_period: 0, status: 'active' },
  ],
  enrollments: [], cart_items: [], wishlists: [], users: [{ id: 12, name: 'Sam' }],
  coupons: [
    { id: 1, code: 'SAVE20', discount: 20, expiry: String(Math.floor((Date.now() + 30 * DAY) / 1000)), status: '1' },
    { id: 2, code: 'EXPIRED', discount: 50, expiry: String(Math.floor((Date.now() - DAY) / 1000)), status: '1' },
    { id: 3, code: 'DISABLED', discount: 90, expiry: String(Math.floor((Date.now() + 30 * DAY) / 1000)), status: '0' },
  ],
});

const services = (d: FakeDb) => {
  const enrollment = new EnrollmentService(d as never);
  const coupons = new CouponService(d as never);
  return { enrollment, coupons, cart: new CartService(d as never, enrollment, coupons),
    wishlist: new WishlistService(d as never) };
};

test('E-04 expiry_period is months applied as 30-day blocks', () => {
  assert.equal(expiryDateFor(0), null);
  assert.equal(expiryDateFor(null), null);
  const six = expiryDateFor(6);
  const days = Math.round((new Date(six!).getTime() - Date.now()) / DAY);
  assert.equal(days, 180, 'six months = 180 days, not calendar months');
});

test('E-04 enroll_status returns valid, expired or false', async () => {
  const d = seed();
  const { enrollment } = services(d);
  assert.equal(await enrollment.status(1, 12), false, 'no row at all');

  await enrollment.enroll(1, 12, 'paid');
  assert.equal(await enrollment.status(1, 12), 'valid', 'no expiry means valid forever');

  d.tables.enrollments[0].expiry_date = new Date(Date.now() - DAY).toISOString();
  assert.equal(await enrollment.status(1, 12), 'expired');
});

test('E-04 a course with an expiry period gets a real timestamp', async () => {
  const d = seed();
  const { enrollment } = services(d);
  await enrollment.enroll(3, 12, 'paid');
  const row = d.tables.enrollments[0];
  assert.ok(row.expiry_date, 'expiry set from expiry_period');
  // Laravel wrote a unix integer into a datetime column; we store a timestamp.
  assert.ok(Number.isNaN(Number(row.expiry_date)), 'not a bare unix integer');
  assert.ok(!Number.isNaN(Date.parse(String(row.expiry_date))));
});

test('E-04 re-enrolling replaces the row rather than stacking', async () => {
  const d = seed();
  const { enrollment } = services(d);
  await enrollment.enroll(1, 12, 'free');
  await enrollment.enroll(1, 12, 'paid');
  assert.equal(d.tables.enrollments.length, 1);
  assert.equal(d.tables.enrollments[0].enrollment_type, 'paid');
});

test('E-04 you cannot enrol in your own course', async () => {
  const { enrollment } = services(seed());
  await assert.rejects(() => enrollment.assertEnrollable(4, 12),
    (e: HttpError) => e.message === 'Ops! You own this course.');
});

test('E-04 an active enrolment blocks re-purchase, an expired one does not', async () => {
  const d = seed();
  const { enrollment } = services(d);
  await enrollment.enroll(1, 12, 'paid');
  await assert.rejects(() => enrollment.assertEnrollable(1, 12),
    (e: HttpError) => e.message === 'You already enrolled in this course');

  d.tables.enrollments[0].expiry_date = new Date(Date.now() - DAY).toISOString();
  await enrollment.assertEnrollable(1, 12); // expired access may be re-bought
});

test('E-05 a free course enrols immediately and leaves the cart', async () => {
  const d = seed();
  const { enrollment, cart } = services(d);
  await cart.add(12, 2);
  assert.equal(d.tables.cart_items.length, 1);
  await enrollment.enrollFree(2, 12);
  assert.equal(d.tables.enrollments[0].enrollment_type, 'free');
  assert.equal(d.tables.cart_items.length, 0, 'removed so it cannot also be bought');
});

test('E-05 a paid course cannot be enrolled for free', async () => {
  const { enrollment } = services(seed());
  await assert.rejects(() => enrollment.enrollFree(1, 12),
    (e: HttpError) => e.message === 'This course is not free.');
});

test('E-06 admin manual enrolment records the admin type', async () => {
  const d = seed();
  const { enrollment } = services(d);
  await enrollment.enrollManually(1, 12);
  assert.equal(d.tables.enrollments[0].enrollment_type, 'admin');
  await assert.rejects(() => enrollment.enrollManually(1, 12),
    (e: HttpError) => e.status === 422);
});
