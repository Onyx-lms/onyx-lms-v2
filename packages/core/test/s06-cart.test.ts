import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeDb } from './fake-db.ts';
import { EnrollmentService } from '../src/enrollment/enrollment.service.ts';
import { CouponService, isCouponActive, couponExpiryMs } from '../src/enrollment/coupon.service.ts';
import { CartService, WishlistService, effectivePrice } from '../src/enrollment/cart.service.ts';
import { HttpError } from '../src/http/errors.ts';

const DAY = 86400000;
const ts = (offsetDays: number) => String(Math.floor((Date.now() + offsetDays * DAY) / 1000));

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
  enrollments: [], cart_items: [], wishlists: [],
  coupons: [
    { id: 1, code: 'SAVE20', discount: 20, expiry: ts(30), status: '1' },
    { id: 2, code: 'EXPIRED', discount: 50, expiry: ts(-1), status: '1' },
    { id: 3, code: 'DISABLED', discount: 90, expiry: ts(30), status: '0' },
  ],
});

const services = (d: FakeDb) => {
  const enrollment = new EnrollmentService(d as never);
  const coupons = new CouponService(d as never);
  return { coupons, cart: new CartService(d as never, enrollment, coupons),
    wishlist: new WishlistService(d as never) };
};

test('E-02 effective price uses the discounted amount when flagged', () => {
  assert.equal(effectivePrice({ is_paid: 1, price: 80, discount_flag: 1, discounted_price: 40 }), 40);
  assert.equal(effectivePrice({ is_paid: 1, price: 80, discount_flag: 0, discounted_price: 40 }), 80);
  assert.equal(effectivePrice({ is_paid: 0, price: null, discount_flag: 0, discounted_price: null }), 0);
});

test('E-02 adding the same course twice does not duplicate the row', async () => {
  const d = seed();
  const { cart } = services(d);
  await cart.add(12, 1);
  await cart.add(12, 1);
  assert.equal(d.tables.cart_items.length, 1);
});

test('E-02 you cannot cart your own course', async () => {
  const { cart } = services(seed());
  await assert.rejects(() => cart.add(12, 4),
    (e: HttpError) => e.message === 'Ops! You own this course.');
});

test('E-02 the cart totals use effective prices', async () => {
  const d = seed();
  const { cart } = services(d);
  await cart.add(12, 1);   // 100
  await cart.add(12, 3);   // 40 discounted
  const summary = await cart.summary(12);
  assert.equal(summary.items.length, 2);
  assert.equal(summary.subtotal, 140);
  assert.equal(summary.total, 140);
  assert.equal(summary.coupon, null);
});

test('E-03 a valid coupon takes a percentage off the subtotal', async () => {
  const d = seed();
  const { cart } = services(d);
  await cart.add(12, 1);
  const summary = await cart.summary(12, 'SAVE20');
  assert.equal(summary.subtotal, 100);
  assert.equal(summary.discount, 20);
  assert.equal(summary.total, 80);
  assert.equal(summary.coupon?.code, 'SAVE20');
});

test('E-03 coupon codes are matched case-insensitively', async () => {
  const d = seed();
  const { cart } = services(d);
  await cart.add(12, 1);
  assert.equal((await cart.summary(12, 'save20')).total, 80);
});

test('E-03 an unknown coupon is rejected with the Laravel message', async () => {
  const { coupons } = services(seed());
  await assert.rejects(() => coupons.apply('NOPE', 100),
    (e: HttpError) => e.message === 'This coupon is not valid.');
});

test('E-03 an expired coupon is rejected', async () => {
  const { coupons } = services(seed());
  await assert.rejects(() => coupons.apply('EXPIRED', 100),
    (e: HttpError) => e.message === 'Ops! coupon is expired.');
});

test('E-03 a DISABLED coupon is rejected -- Laravel accepted it', async () => {
  // In PHP the string "0" is falsy, so `$coupon->status && ...` short-circuits
  // and a disabled coupon skipped the expiry check and was applied. Fixed here.
  const { coupons } = services(seed());
  await assert.rejects(() => coupons.apply('DISABLED', 100),
    (e: HttpError) => e.message === 'This coupon is not valid.');
});

test('E-03 status parsing accepts the shapes the column actually holds', () => {
  assert.equal(isCouponActive('1'), true);
  assert.equal(isCouponActive('active'), true);
  assert.equal(isCouponActive('0'), false);
  assert.equal(isCouponActive('inactive'), false);
  assert.equal(isCouponActive(null), false);
});

test('E-03 expiry parsing handles seconds, milliseconds and dates', () => {
  assert.equal(couponExpiryMs('1700000000'), 1700000000000);
  assert.equal(couponExpiryMs('1700000000000'), 1700000000000);
  assert.equal(couponExpiryMs(null), null);
  assert.ok(couponExpiryMs('2030-01-01')! > Date.now());
});

test('E-03 a 100 percent coupon cannot drive the total negative', async () => {
  const d = seed();
  d.tables.coupons.push({ id: 4, code: 'FREE100', discount: 150, expiry: ts(30), status: '1' });
  const { cart } = services(d);
  await cart.add(12, 1);
  const summary = await cart.summary(12, 'FREE100');
  assert.equal(summary.discount, 100, 'clamped to 100 percent');
  assert.equal(summary.total, 0);
});

test('E-01 the wishlist toggles on and off', async () => {
  const d = seed();
  const { wishlist } = services(d);
  assert.equal(await wishlist.toggle(12, 1), true);
  assert.deepEqual(await wishlist.courseIds(12), [1]);
  assert.equal(await wishlist.toggle(12, 1), false);
  assert.deepEqual(await wishlist.courseIds(12), []);
});

test('E-01 the wishlist returns full course rows', async () => {
  const d = seed();
  const { wishlist } = services(d);
  await wishlist.toggle(12, 3);
  const list = await wishlist.list(12);
  assert.equal(list.length, 1);
  assert.equal(list[0].slug, 'disc');
});
