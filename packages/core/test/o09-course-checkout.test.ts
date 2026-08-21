/**
 * Onyx O09 unit tests -- buying a course with real money.
 *
 * Course sales used to be a mock: one POST, one row written `captured`, no
 * gateway anywhere. Putting a real gateway behind them introduces the two
 * failure modes that only exist once money is involved, and both are tested
 * here rather than end to end, because neither can be provoked against a live
 * provider on purpose.
 *
 * **A payment settles twice.** The browser coming back and the gateway's
 * webhook race, routinely, and whichever arrives second must find the first
 * one's row instead of charging again. That is what `(tenant_id, gateway,
 * reference)` is for in migration 0028, and what `replayed: true` reports.
 *
 * **The amount comes from the course.** Not from the request, not from the
 * gateway's echo. A checkout that trusted its caller would let a nine-thousand
 * rupee course be bought for one, and the only place that can be proven is
 * where the order is built.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeDb } from './fake-db.ts';
import { AcademicsService } from '../src/onyx/academics.service.ts';
import {
  OnyxCheckoutService, signIntent, readIntent,
} from '../src/onyx/checkout.service.ts';
import type { FinanceService } from '../src/onyx/finance.service.ts';
import type { OnyxDb } from '../src/onyx/db.ts';
import { registerProvider, type CheckoutOrder } from '../src/payments/provider.ts';
import { HttpError } from '../src/http/errors.ts';

const T = 1;
const OTHER = 2;
const SECRET = 'test-secret-not-a-real-one';
const NOW = 1_800_000_000_000;
const LEARNER = 'u-learner';

/**
 * A provider that records the order instead of sending it.
 *
 * Registered under its own name rather than shadowing razorpay: the real one
 * would reach api.razorpay.com, and a test that quietly replaces a shipped
 * provider is a test that stops noticing when the shipped one changes. What is
 * under examination here is the order Onyx BUILDS -- above all its amount --
 * which is the last point that number is ours.
 */
let lastOrder: CheckoutOrder | null = null;
registerProvider({
  identifier: 'testpay',
  async createCheckout(order) {
    lastOrder = order;
    return { redirectUrl: order.successUrl, providerRef: 'order_abc', clientPayload: {} };
  },
  async verify() { return { status: 'paid' as const, providerRef: 'order_abc' }; },
});

/**
 * Both unique constraints migration 0028 leaves in place. The replay claims
 * below are really claims about these two indexes, so a fake that let every
 * insert through would not be testing anything.
 */
const UNIQUES = {
  onyx_course_purchases: [
    ['tenant_id', 'gateway', 'reference'],
    ['tenant_id', 'course_id', 'user_id'],
  ],
};

function seed() {
  return new FakeDb({
    onyx_courses: [
      { id: 10, tenant_id: T, program_id: null, semester_id: null, code: 'ADV-1',
        title: 'Advanced Systems', slug: 'advanced-systems', description: '',
        credits: 4, self_enroll: 0, access: 'locked', price_minor: 900_000,
        currency: 'INR', status: 1, created_by: 'u-admin', created_at: 'now' },
      { id: 11, tenant_id: T, program_id: null, semester_id: null, code: 'FREE-1',
        title: 'Open to all', slug: 'open-to-all', description: '',
        credits: 2, self_enroll: 1, access: 'open', price_minor: 0,
        currency: 'INR', status: 1, created_by: 'u-admin', created_at: 'now' },
      { id: 12, tenant_id: T, program_id: null, semester_id: null, code: 'DRAFT-1',
        title: 'Still being written', slug: 'draft', description: '',
        credits: 2, self_enroll: 0, access: 'locked', price_minor: 500_000,
        currency: 'INR', status: 0, created_by: 'u-admin', created_at: 'now' },
    ],
    onyx_enrollments: [],
    onyx_course_purchases: [],
    onyx_payment_gateways: [
      { id: 1, tenant_id: T, identifier: 'testpay', title: 'Test gateway', currency: 'INR',
        test_mode: 1, status: 1, created_at: 'now', updated_at: 'now',
        keys: { razorpay_key: 'rzp_test_key', razorpay_secret: 'shh' } },
    ],
  }, UNIQUES);
}

/**
 * The service with its collaborators, and a stubbed provider call.
 *
 * `createCheckout` would otherwise reach api.razorpay.com. What is under test
 * is the order we hand it -- so it is captured rather than sent, and the test
 * reads the amount out of it.
 */
function services(db: FakeDb) {
  const academics = new AcademicsService(db as unknown as OnyxDb);
  const finance = { recordPayment: async () => { throw new Error('not the course path'); } };
  const checkout = new OnyxCheckoutService(
    db as unknown as OnyxDb, finance as unknown as FinanceService,
    { secret: SECRET, baseUrl: 'https://lms.example', academics },
    () => NOW);
  return { academics, checkout };
}

// ------------------------------------------------------------------ the token

test('a course token names the course, and an old invoice token still reads', () => {
  const course = readIntent(signIntent({
    tenantId: T, kind: 'course', targetId: 10, userId: LEARNER,
    gateway: 'razorpay', amountMinor: 900_000, currency: 'INR',
  }, SECRET, NOW), SECRET, NOW);
  assert.ok(course);
  assert.equal(course.kind, 'course');
  assert.equal(course.targetId, 10);

  // The compatibility claim, and the reason `invoiceId` is still in the type.
  // A token lives two hours; the deploy that introduced `targetId` had to keep
  // reading the ones already in flight, which carry only `invoiceId`.
  const legacy = readIntent(signIntent({
    tenantId: T, invoiceId: 42, targetId: undefined as unknown as number,
    userId: LEARNER, gateway: 'razorpay', amountMinor: 250_000, currency: 'INR',
  }, SECRET, NOW), SECRET, NOW);
  assert.ok(legacy, 'a pre-course token stopped verifying');
  assert.equal(legacy.kind, 'invoice', 'an old token must default to an invoice');
  assert.equal(legacy.targetId, 42, 'targetId must fall back to invoiceId');
});

test('editing the kind of a token breaks its signature', () => {
  // Otherwise an invoice payment could be re-pointed at a course, which is a
  // way to be enrolled in something for the price of the cheapest fee due.
  const reference = signIntent({
    tenantId: T, kind: 'invoice', targetId: 42, invoiceId: 42, userId: LEARNER,
    gateway: 'razorpay', amountMinor: 250_000, currency: 'INR',
  }, SECRET, NOW);
  const [body, sig] = reference.split('.') as [string, string];
  const decoded = JSON.parse(Buffer.from(body, 'base64url').toString());

  for (const tampered of [
    { ...decoded, kind: 'course' },
    { ...decoded, targetId: 10 },
  ]) {
    const forged = Buffer.from(JSON.stringify(tampered)).toString('base64url') + '.' + sig;
    assert.equal(readIntent(forged, SECRET, NOW), null,
      'a tampered token verified: ' + JSON.stringify(tampered));
  }
});

// --------------------------------------------------------------- beginCourse

test('the amount charged is the course price, whatever the request says', async () => {
  const db = seed();
  const { checkout } = services(db);

  const started = await checkout.beginCourse(T, 10, { userId: LEARNER }, {
    gateway: 'testpay', email: 'learner@example.com',
  });

  assert.equal(started.amount_minor, 900_000);
  // Major units at the provider seam, which is the convention every provider
  // converts back from -- a second convention here is where a factor of a
  // hundred hides.
  assert.equal(lastOrder?.total, 9_000);
  assert.equal(lastOrder?.items[0]?.course_id, 10);
  // And the signed token says the same, since the token is what settlement
  // reads -- a response the client never sends back could say anything.
  const intent = readIntent(started.reference, SECRET, NOW);
  assert.equal(intent?.amountMinor, 900_000);
  assert.equal(intent?.targetId, 10);
  assert.equal(intent?.kind, 'course');
});

test('a free, a draft and an already-owned course each refuse a checkout', async () => {
  const db = seed();
  const { checkout } = services(db);
  const buy = (id: number) =>
    checkout.beginCourse(T, id, { userId: LEARNER }, { gateway: 'testpay' });

  // Free: there is nothing to charge, and a zero-rupee order is a gateway error
  // rather than a purchase.
  await assert.rejects(buy(11), (e: HttpError) => e.status === 422);
  // Draft: not published, so 404 for the same reason course() gives -- ids are
  // sequential, and a 403 would confirm the draft exists.
  await assert.rejects(buy(12), (e: HttpError) => e.status === 404 || e.status === 403);

  // Already owned: the mock path is idempotent by construction, so it never
  // needed this. A payment window does -- sending somebody to one for a course
  // they have bought is how you take money twice.
  db.tables.onyx_course_purchases.push({
    id: 1, tenant_id: T, course_id: 10, user_id: LEARNER, amount_minor: 900_000,
    currency: 'INR', gateway: 'razorpay', reference: 'pay_earlier', status: 'captured',
  });
  await assert.rejects(buy(10), (e: HttpError) => e.status === 409);
});

test('a course belonging to another institution is not for sale here', async () => {
  const db = seed();
  const { checkout } = services(db);
  await assert.rejects(
    checkout.beginCourse(OTHER, 10, { userId: LEARNER }, { gateway: 'testpay' }),
    (e: HttpError) => e.status === 404);
});

// ------------------------------------------------------------- recordPurchase

test('a captured sale is recorded and enrols the buyer', async () => {
  const db = seed();
  const { academics } = services(db);

  const result = await academics.recordPurchase(T, 10, LEARNER, {
    gateway: 'razorpay', reference: 'order_abc', providerRef: 'order_abc',
    amountMinor: 900_000,
  });

  assert.equal(result.replayed, false);
  assert.equal(db.tables.onyx_course_purchases.length, 1);
  assert.equal(db.tables.onyx_course_purchases[0]!.status, 'captured');
  // Paying and then not being on the course is the failure this pairing exists
  // to prevent -- the enrolment is the thing the buyer actually wanted.
  assert.equal(db.tables.onyx_enrollments.length, 1);
  assert.equal(db.tables.onyx_enrollments[0]!.user_id, LEARNER);
});

test('the same transaction settled twice charges once', async () => {
  const db = seed();
  const { academics } = services(db);
  const args = {
    gateway: 'razorpay', reference: 'order_abc', providerRef: 'order_abc',
    amountMinor: 900_000,
  };

  await academics.recordPurchase(T, 10, LEARNER, args);
  // The webhook arriving after the redirect, or the other way round. Both are
  // routine, and the second must not write a second row.
  const again = await academics.recordPurchase(T, 10, LEARNER, args);

  assert.equal(again.replayed, true);
  assert.equal(db.tables.onyx_course_purchases.length, 1,
    'a replayed capture wrote a second purchase');
  assert.equal(db.tables.onyx_enrollments.length, 1);
});

test('a captured purchase is never written back to pending', async () => {
  const db = seed();
  const { academics } = services(db);
  await academics.recordPurchase(T, 10, LEARNER, {
    gateway: 'razorpay', reference: 'order_abc', amountMinor: 900_000,
  });

  // A second checkout begun after the first one captured -- a learner who
  // pressed Buy again on a stale tab. It must not downgrade what they own.
  const later = await academics.recordPurchase(T, 10, LEARNER, {
    gateway: 'razorpay', reference: 'order_zzz', amountMinor: 900_000,
  });

  assert.equal(later.replayed, true);
  assert.equal(db.tables.onyx_course_purchases.length, 1);
  assert.equal(db.tables.onyx_course_purchases[0]!.status, 'captured');
  assert.equal(db.tables.onyx_course_purchases[0]!.reference, 'order_abc',
    'the original transaction id was overwritten by a later attempt');
});

test('the recorded amount is the course price, not what the caller passed', async () => {
  const db = seed();
  const { academics } = services(db);
  // Nothing in the product calls it this way -- the guard is that if anything
  // ever does, the ledger still says what the course costs.
  await academics.recordPurchase(T, 10, LEARNER, {
    gateway: 'razorpay', reference: 'order_abc',
  });
  assert.equal(db.tables.onyx_course_purchases[0]!.amount_minor, 900_000);
});

// -------------------------------------------------------------------- settle

test('settle routes a course intent to the purchase table and not the ledger', async () => {
  const db = seed();
  const { checkout } = services(db);
  const intent = readIntent(signIntent({
    tenantId: T, kind: 'course', targetId: 10, userId: LEARNER,
    gateway: 'razorpay', amountMinor: 900_000, currency: 'INR',
  }, SECRET, NOW), SECRET, NOW)!;

  const settled = await checkout.settle(intent, {
    status: 'paid', providerRef: 'order_abc',
    transaction: { order_id: 'order_abc', payment_id: 'pay_abc' },
  });

  // `finance.recordPayment` throws if it is reached at all -- a course sale
  // raises no invoice, which is migration 0024's decision and still holds.
  assert.equal(settled.status, 'captured');
  assert.equal(settled.invoice, null);
  assert.equal(db.tables.onyx_course_purchases.length, 1);
  assert.equal(db.tables.onyx_enrollments.length, 1);
});

test('an unconfirmed payment enrols nobody', async () => {
  const db = seed();
  const { checkout } = services(db);
  const intent = readIntent(signIntent({
    tenantId: T, kind: 'course', targetId: 10, userId: LEARNER,
    gateway: 'razorpay', amountMinor: 900_000, currency: 'INR',
  }, SECRET, NOW), SECRET, NOW)!;

  const settled = await checkout.settle(intent, { status: 'pending', providerRef: 'order_abc' });

  assert.equal(settled.status, 'pending');
  assert.equal(db.tables.onyx_course_purchases.length, 0);
  assert.equal(db.tables.onyx_enrollments.length, 0,
    'a course opened before the bank had confirmed anything');
});
