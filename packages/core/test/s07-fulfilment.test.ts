import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeDb } from './fake-db.ts';
import { PaymentService } from '../src/payments/payment.service.ts';
import { SettingsService } from '../src/settings/settings.service.ts';
import { CartService } from '../src/enrollment/cart.service.ts';
import { CouponService } from '../src/enrollment/coupon.service.ts';
import { EnrollmentService } from '../src/enrollment/enrollment.service.ts';
import { signOrder } from '../src/payments/order-token.ts';
// Side-effect import: this is what registers stripe/paypal/razorpay.
import '../src/payments/index.ts';

const SECRET = 'payment-signing-secret-at-least-32-chars';

const seed = () => new FakeDb({
  settings: [
    { id: 1, type: 'system_currency', description: 'USD' },
    { id: 2, type: 'instructor_revenue', description: '70' },
    { id: 3, type: 'tax', description: '10' },
  ],
  courses: [
    { id: 1, title: 'Instructor course', slug: 'a', user_id: 100, is_paid: 1, price: 60,
      discount_flag: 0, discounted_price: null, expiry_period: 0, status: 'active' },
    { id: 2, title: 'Admin course', slug: 'b', user_id: 200, is_paid: 1, price: 40,
      discount_flag: 0, discounted_price: null, expiry_period: 0, status: 'active' },
  ],
  users: [{ id: 100, role: 'instructor' }, { id: 200, role: 'admin' }, { id: 12, role: 'student' }],
  payment_gateways: [{ id: 1, identifier: 'stripe', title: 'Stripe', status: 1, test_mode: 1,
    keys: '{"stripe_secret_test":"sk_test_x"}' }],
  payment_histories: [], enrollments: [], cart_items: [], coupons: [], wishlists: [],
});

function build(d: FakeDb) {
  const settings = new SettingsService(d as never);
  const enrollment = new EnrollmentService(d as never);
  const coupons = new CouponService(d as never);
  const cart = new CartService(d as never, enrollment, coupons);
  return { service: new PaymentService(d as never, settings, cart, enrollment, SECRET), enrollment };
}

const ORDER = {
  userId: 12, gateway: 'stripe',
  items: [
    { course_id: 1, title: 'Instructor course', price: 60 },
    { course_id: 2, title: 'Admin course', price: 40 },
  ],
  subtotal: 100, discount: 0, tax: 10, taxRate: 10, total: 110,
  currency: 'USD', couponCode: null,
};
const pending = (o: Record<string, unknown>) => ({ ...o, nonce: 'n', issuedAt: 0 }) as never;

test('PAY-05 fulfilment writes one payment row per course, one invoice', async () => {
  const d = seed();
  const { service } = build(d);
  const result = await service.fulfil(pending(ORDER), signOrder(ORDER, SECRET), { id: 'tx' });
  assert.equal(result.status, 'paid');
  assert.equal(d.tables.payment_histories.length, 2);
  assert.equal(new Set(d.tables.payment_histories.map((r: any) => r.invoice)).size, 1);
  assert.equal(result.invoice?.length, 20);
});

test('PAY-05 revenue splits per item and reconciles to the order', async () => {
  const d = seed();
  const { service } = build(d);
  await service.fulfil(pending(ORDER), signOrder(ORDER, SECRET), {});
  const rows = d.tables.payment_histories as any[];
  const instructorRow = rows.find((r) => r.course_id === 1);
  const adminRow = rows.find((r) => r.course_id === 2);

  assert.equal(instructorRow.instructor_revenue, 42);
  assert.equal(instructorRow.admin_revenue, 18);
  assert.equal(adminRow.instructor_revenue, 0);
  assert.equal(adminRow.admin_revenue, 40);

  const booked = rows.reduce((s, r) => s + r.admin_revenue + r.instructor_revenue, 0);
  assert.equal(booked, 100, 'books the subtotal once, not once per item');
});

test('PAY-07 tax is allocated across items and sums to the order tax', async () => {
  const d = seed();
  const { service } = build(d);
  await service.fulfil(pending(ORDER), signOrder(ORDER, SECRET), {});
  const taxTotal = (d.tables.payment_histories as any[]).reduce((s, r) => s + Number(r.tax), 0);
  assert.equal(Math.round(taxTotal * 100) / 100, 10);
});

test('PAY-05 a coupon discount is distributed proportionally', async () => {
  const d = seed();
  const { service } = build(d);
  const o = { ...ORDER, discount: 20, tax: 8, total: 88, couponCode: 'SAVE20' };
  await service.fulfil(pending(o), signOrder(o, SECRET), {});
  const rows = d.tables.payment_histories as any[];
  const booked = rows.reduce((s, r) => s + r.admin_revenue + r.instructor_revenue, 0);
  assert.equal(Math.round(booked * 100) / 100, 80, 'books what the customer actually paid');
  assert.equal(rows.every((r) => r.coupon === 'SAVE20'), true);
});

test('PAY-05 fulfilment enrols the buyer in every course', async () => {
  const d = seed();
  const { service, enrollment } = build(d);
  await service.fulfil(pending(ORDER), signOrder(ORDER, SECRET), {});
  assert.equal(await enrollment.status(1, 12), 'valid');
  assert.equal(await enrollment.status(2, 12), 'valid');
  assert.equal(d.tables.enrollments.every((e: any) => e.enrollment_type === 'paid'), true);
});

test('PAY-05 fulfilment clears only the purchased cart items', async () => {
  const d = seed();
  d.tables.cart_items = [
    { id: 1, user_id: 12, course_id: 1 },
    { id: 2, user_id: 12, course_id: 2 },
    { id: 3, user_id: 12, course_id: 99 },
  ];
  const { service } = build(d);
  await service.fulfil(pending(ORDER), signOrder(ORDER, SECRET), {});
  assert.deepEqual(d.tables.cart_items.map((c: any) => c.course_id), [99]);
});

test('PAY-01 the reference is recorded so a replay cannot double-charge', async () => {
  const d = seed();
  const { service } = build(d);
  const ref = signOrder(ORDER, SECRET);
  await service.fulfil(pending(ORDER), ref, {});
  assert.notEqual(await service.existingFulfilment(ref), null);
  assert.equal(await service.existingFulfilment('another-reference'), null);
  assert.equal(d.tables.payment_histories.length, 2);
});

test('PAY-06 the invoice reconstructs the whole order for its owner', async () => {
  const d = seed();
  const { service } = build(d);
  const result = await service.fulfil(pending(ORDER), signOrder(ORDER, SECRET), {});
  const invoice = await service.invoice(result.invoice!, 12);
  assert.equal(invoice.items.length, 2);
  assert.equal(invoice.subtotal, 100);
  assert.equal(invoice.tax, 10);
  assert.equal(invoice.total, 110);
  assert.equal(invoice.payment_type, 'stripe');
});

test('PAY-06 another user cannot read someone else invoice', async () => {
  const d = seed();
  const { service } = build(d);
  const result = await service.fulfil(pending(ORDER), signOrder(ORDER, SECRET), {});
  await assert.rejects(() => service.invoice(result.invoice!, 999),
    (e: { status: number }) => e.status === 403);
});

test('PAY-06 purchase history lists the orders with course details', async () => {
  const d = seed();
  const { service } = build(d);
  await service.fulfil(pending(ORDER), signOrder(ORDER, SECRET), {});
  const history = await service.purchaseHistory(12);
  assert.equal(history.length, 2);
  assert.notEqual(history[0]?.course, undefined);
});

test('PAY-01 only gateways with a registered provider are offered', async () => {
  const d = seed();
  d.tables.payment_gateways.push({ id: 2, identifier: 'ghostpay', title: 'Ghost',
    status: 1, test_mode: 1, keys: '{}' });
  const { service } = build(d);
  const gateways = await service.availableGateways();
  assert.deepEqual(gateways.map((g: any) => g.identifier), ['stripe']);
  assert.equal(gateways.every((g: any) => !('keys' in g)), true,
    'credentials never leave the server');
});

test('PAY-01 a replay of a MULTI-ITEM order is still recognised', async () => {
  /*
   * The guard failing open, which single-item orders hid.
   *
   * `fulfil` writes one payment_histories row per item, all carrying the same
   * session_id, and nothing makes session_id unique. `existingFulfilment` read
   * it with `.maybeSingle()` -- which PostgREST answers with an ERROR when more
   * than one row matches, not with the first of them. So on any order of two
   * or more courses the read returned null, the guard said "not fulfilled" of
   * an order that had been, and a replayed webhook would have enrolled and
   * charged the buyer a second time.
   *
   * The order used everywhere else in this file has two items, so the bug was
   * always in range; the fake was returning row zero and agreeing with the
   * code. It now refuses more than one row, as the real client does.
   */
  const d = seed();
  const { service } = build(d);
  const ref = signOrder(ORDER, SECRET);

  await service.fulfil(pending(ORDER), ref, {});
  const rows = d.tables.payment_histories.length;
  assert.ok(rows > 1, 'this order must write more than one history row to be the case under test');

  /*
   * This is the read the guard is made of. `completeCheckout` and the webhook
   * handler both return early on a non-null answer here, so a null one is the
   * difference between recognising a replay and fulfilling it again. `fulfil`
   * itself is the inner write and is deliberately unguarded -- it is only ever
   * reached through one of those two.
   */
  const invoice = await service.existingFulfilment(ref);
  assert.notEqual(invoice, null, 'a fulfilled multi-item order must be recognised on replay');
  assert.equal(invoice, d.tables.payment_histories[0].invoice,
    'and it is that order’s invoice, not some other row’s');
});
