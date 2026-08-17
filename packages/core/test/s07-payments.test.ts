import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { FakeDb } from './fake-db.ts';
import { signOrder, readOrder } from '../src/payments/order-token.ts';
import { verifyStripeSignature } from '../src/payments/providers/stripe.ts';
import { PaymentService } from '../src/payments/payment.service.ts';
import { SettingsService } from '../src/settings/settings.service.ts';
import { CartService } from '../src/enrollment/cart.service.ts';
import { CouponService } from '../src/enrollment/coupon.service.ts';
import { EnrollmentService } from '../src/enrollment/enrollment.service.ts';
import { pickKey } from '../src/payments/provider.ts';

const SECRET = 'payment-signing-secret-at-least-32-chars';

const baseOrder = {
  userId: 12, gateway: 'stripe',
  items: [{ course_id: 1, title: 'A course', price: 100 }],
  subtotal: 100, discount: 0, tax: 0, taxRate: 0, total: 100,
  currency: 'USD', couponCode: null,
};

test('PAY-01 an order token round-trips', () => {
  const ref = signOrder(baseOrder, SECRET);
  const back = readOrder(ref, SECRET);
  assert.equal(back?.userId, 12);
  assert.equal(back?.total, 100);
  assert.equal(back?.items[0]?.course_id, 1);
});

test('PAY-01 tampering with the price invalidates the token', () => {
  const ref = signOrder(baseOrder, SECRET);
  const [body, sig] = ref.split('.') as [string, string];
  const forged = JSON.parse(Buffer.from(body, 'base64url').toString());
  forged.total = 1;
  const tamperedBody = Buffer.from(JSON.stringify(forged)).toString('base64url');
  // This is the attack the signature exists to stop.
  assert.equal(readOrder(`${tamperedBody}.${sig}`, SECRET), null);
});

test('PAY-01 a token signed with another secret is rejected', () => {
  assert.equal(readOrder(signOrder(baseOrder, 'a-different-secret-entirely!!'), SECRET), null);
});

test('PAY-01 a stale token is rejected', () => {
  const ref = signOrder(baseOrder, SECRET);
  const [body] = ref.split('.') as [string];
  const old = JSON.parse(Buffer.from(body, 'base64url').toString());
  old.issuedAt = Math.floor(Date.now() / 1000) - 60 * 60 * 3;
  const staleBody = Buffer.from(JSON.stringify(old)).toString('base64url');
  const staleSig = createHmac('sha256', SECRET).update(staleBody).digest('base64url');
  assert.equal(readOrder(`${staleBody}.${staleSig}`, SECRET), null);
});

test('PAY-01 malformed references do not throw', () => {
  assert.equal(readOrder('', SECRET), null);
  assert.equal(readOrder('garbage', SECRET), null);
  assert.equal(readOrder('a.b.c', SECRET), null);
});

test('PAY-01 gateway keys resolve by test or live mode', () => {
  const keys = { stripe_secret_test: 'sk_test_1', stripe_secret_live: 'sk_live_1', webhook_secret: 'whsec' };
  const test = { identifier: 'stripe', title: 'Stripe', testMode: true, keys, currency: 'USD' };
  const live = { ...test, testMode: false };
  assert.equal(pickKey(test, 'stripe_secret'), 'sk_test_1');
  assert.equal(pickKey(live, 'stripe_secret'), 'sk_live_1');
  assert.equal(pickKey(test, 'webhook_secret'), 'whsec', 'falls back to the plain name');
  assert.equal(pickKey(test, 'missing'), '');
});

test('PAY-02 a valid Stripe signature verifies', () => {
  const payload = JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed' });
  const ts = Math.floor(Date.now() / 1000);
  const sig = createHmac('sha256', 'whsec_test').update(`${ts}.${payload}`).digest('hex');
  assert.equal(verifyStripeSignature(payload, `t=${ts},v1=${sig}`, 'whsec_test'), true);
});

test('PAY-02 a forged Stripe signature is rejected', () => {
  const payload = JSON.stringify({ id: 'evt_1' });
  const ts = Math.floor(Date.now() / 1000);
  assert.equal(verifyStripeSignature(payload, `t=${ts},v1=deadbeef`, 'whsec_test'), false);
  const wrong = createHmac('sha256', 'other').update(`${ts}.${payload}`).digest('hex');
  assert.equal(verifyStripeSignature(payload, `t=${ts},v1=${wrong}`, 'whsec_test'), false);
});

test('PAY-02 an old Stripe signature is rejected -- replay protection', () => {
  const payload = JSON.stringify({ id: 'evt_1' });
  const ts = Math.floor(Date.now() / 1000) - 3600;
  const sig = createHmac('sha256', 'whsec_test').update(`${ts}.${payload}`).digest('hex');
  assert.equal(verifyStripeSignature(payload, `t=${ts},v1=${sig}`, 'whsec_test'), false);
});

test('PAY-02 a tampered body fails even with a real signature for the original', () => {
  const original = JSON.stringify({ amount: 100 });
  const ts = Math.floor(Date.now() / 1000);
  const sig = createHmac('sha256', 'whsec_test').update(`${ts}.${original}`).digest('hex');
  assert.equal(verifyStripeSignature(JSON.stringify({ amount: 1 }), `t=${ts},v1=${sig}`, 'whsec_test'), false);
});

test('PAY-01 the idempotency key fits payment_histories.session_id', async () => {
  const { referenceKey } = await import('../src/payments/order-token.ts');
  // session_id is varchar(255). The signed reference itself is far longer, so
  // writing it raw fails with "value too long" -- only caught against a real
  // Postgres, because the in-memory fake enforces no column widths.
  const reference = signOrder({
    ...baseOrder,
    items: Array.from({ length: 12 }, (_, i) => ({
      course_id: i, title: 'A course with a fairly long title', price: 99.99,
    })),
  }, SECRET);
  assert.ok(reference.length > 255, 'the reference really is oversized');

  const key = referenceKey(reference);
  assert.equal(key.length, 64);
  assert.ok(key.length <= 255);
  assert.equal(key, referenceKey(reference), 'stable, so replays match');
  assert.notEqual(key, referenceKey(reference + 'x'), 'distinct per order');
});
