/**
 * Live Classes -- signing up, and being charged for it exactly once.
 *
 * The claims worth testing are the ones that only exist once money moves, and
 * they are the same three onyx_course_purchases needed: the amount comes from
 * the record and never the request, the same transaction settled twice charges
 * once, and a late retry never downgrades something already captured.
 *
 * Plus one that is peculiar to domains. A registration grants NOTHING -- there
 * is no outline to unlock, because a domain is a programme the institution runs
 * off-product. So the whole consequence of paying is that a name appears on a
 * list somebody reads, and the test that the list is right is not a nice-to-
 * have: it is the test that the feature does anything at all.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeDb } from './fake-db.ts';
import { DomainsService } from '../src/onyx/domains.service.ts';
import { OnyxCheckoutService, signIntent, readIntent } from '../src/onyx/checkout.service.ts';
import type { FinanceService } from '../src/onyx/finance.service.ts';
import type { OnyxDb } from '../src/onyx/db.ts';
import { registerProvider, type CheckoutOrder } from '../src/payments/provider.ts';
import { HttpError } from '../src/http/errors.ts';

const T = 1;
const OTHER = 2;
const SECRET = 'test-secret-not-a-real-one';
const NOW = 1_800_000_000_000;
const LEARNER = 'u-learner';

/** A provider that records the order instead of sending it to a bank. */
let lastOrder: CheckoutOrder | null = null;
registerProvider({
  identifier: 'domainpay',
  async createCheckout(order) {
    lastOrder = order;
    return { redirectUrl: order.successUrl, providerRef: 'order_dom', clientPayload: {} };
  },
  async verify() { return { status: 'paid' as const, providerRef: 'order_dom' }; },
});

/** Both constraints migration 0030 creates. The replay claims are about them. */
const UNIQUES = {
  onyx_domain_registrations: [
    ['tenant_id', 'gateway', 'reference'],
    ['tenant_id', 'domain_id', 'user_id'],
  ],
};

const storage = {
  signedUrl: async (path: string) => 'https://signed.example/' + path,
  upload: async (key: string) => key,
  publicUrl: (path: string) => 'https://cdn.example/' + path,
  remove: async () => undefined,
};

function seed() {
  return new FakeDb({
    onyx_domains: [
      { id: 1, tenant_id: T, title: 'Data Science Live', summary: '',
        curriculum_url: '', image_path: null, certificate: '', duration_label: '12 weeks',
        price_minor: 500_000, currency: 'INR', sort: 0, status: 1,
        created_by: 'u-admin', created_at: 'now', updated_at: 'now' },
      { id: 2, tenant_id: T, title: 'Free intro session', summary: '',
        curriculum_url: '', image_path: null, certificate: '', duration_label: '1 day',
        price_minor: 0, currency: 'INR', sort: 1, status: 1,
        created_by: 'u-admin', created_at: 'now', updated_at: 'now' },
      { id: 3, tenant_id: T, title: 'Not published yet', summary: '',
        curriculum_url: '', image_path: null, certificate: '', duration_label: '',
        price_minor: 100_000, currency: 'INR', sort: 2, status: 0,
        created_by: 'u-admin', created_at: 'now', updated_at: 'now' },
      { id: 4, tenant_id: OTHER, title: 'Another institution', summary: '',
        curriculum_url: '', image_path: null, certificate: '', duration_label: '',
        price_minor: 100_000, currency: 'INR', sort: 0, status: 1,
        created_by: 'u-x', created_at: 'now', updated_at: 'now' },
    ],
    onyx_domain_registrations: [],
    onyx_users: [
      { id: LEARNER, name: 'Sam Student', email: 'sam@demo.onyx', phone: '+91 90000 00001' },
    ],
    onyx_payment_gateways: [
      { id: 1, tenant_id: T, identifier: 'domainpay', title: 'Test gateway', currency: 'INR',
        test_mode: 1, status: 1, created_at: 'now', updated_at: 'now', keys: {} },
    ],
  }, UNIQUES);
}

function services(db: FakeDb) {
  const domains = new DomainsService(db as unknown as OnyxDb, storage);
  const finance = { recordPayment: async () => { throw new Error('not the domain path'); } };
  const checkout = new OnyxCheckoutService(
    db as unknown as OnyxDb, finance as unknown as FinanceService,
    { secret: SECRET, baseUrl: 'https://lms.example', domains },
    () => NOW);
  return { domains, checkout };
}

// ------------------------------------------------------------- registration

test('registering records what was charged, and marks the person as signed up', async () => {
  const db = seed();
  const { domains } = services(db);

  const result = await domains.register(T, 1, LEARNER);

  assert.equal(result.replayed, false);
  assert.equal(db.tables.onyx_domain_registrations.length, 1);
  const row = db.tables.onyx_domain_registrations[0]!;
  assert.equal(row.amount_minor, 500_000);
  assert.equal(row.status, 'captured');
  assert.equal(await domains.hasRegistered(T, 1, LEARNER), true);
  assert.deepEqual(await domains.registeredDomains(T, LEARNER), [1]);
});

test('a free domain still gets a row, and says so', async () => {
  // "Register your interest" and "pay to join" are the same act from the
  // institution's side -- a name on the list -- so they share a table rather
  // than making every reader remember to union two.
  const db = seed();
  const { domains } = services(db);
  await domains.register(T, 2, LEARNER);

  const row = db.tables.onyx_domain_registrations[0]!;
  assert.equal(row.amount_minor, 0);
  assert.equal(row.gateway, 'free', 'a free registration should say so, not claim a mock');
});

test('a hidden domain cannot be registered for', async () => {
  const db = seed();
  const { domains } = services(db);
  await assert.rejects(domains.register(T, 3, LEARNER), (e: HttpError) => e.status === 403);
  assert.equal(db.tables.onyx_domain_registrations.length, 0);
});

test('another institution\'s domain is not visible, let alone buyable', async () => {
  const db = seed();
  const { domains } = services(db);
  await assert.rejects(domains.register(T, 4, LEARNER), (e: HttpError) => e.status === 404);
});

test('registering twice does not charge twice', async () => {
  const db = seed();
  const { domains } = services(db);
  await domains.register(T, 1, LEARNER, { gateway: 'x', reference: 'pay_1' });
  const again = await domains.register(T, 1, LEARNER, { gateway: 'x', reference: 'pay_1' });

  assert.equal(again.replayed, true);
  assert.equal(db.tables.onyx_domain_registrations.length, 1);
});

test('a captured registration is never written back to pending', async () => {
  const db = seed();
  const { domains } = services(db);
  await domains.register(T, 1, LEARNER, { gateway: 'x', reference: 'pay_1' });

  // A second checkout begun on a stale tab after the first one captured.
  const later = await domains.register(T, 1, LEARNER, { gateway: 'x', reference: 'pay_2' });
  assert.equal(later.replayed, true);
  assert.equal(db.tables.onyx_domain_registrations.length, 1);
  assert.equal(db.tables.onyx_domain_registrations[0]!.reference, 'pay_1');
});

test('the price at the time of purchase is not rewritten when the price changes', async () => {
  // The ledger rule: what somebody was actually charged last term must survive
  // a programme being repriced this term.
  const db = seed();
  const { domains } = services(db);
  await domains.register(T, 1, LEARNER);

  await domains.update(T, 1, { price_minor: 900_000 });
  assert.equal(db.tables.onyx_domain_registrations[0]!.amount_minor, 500_000);
});

// ------------------------------------------------------------------ the list

test('the registrations list carries somebody an office can actually contact', async () => {
  // The half that makes the other half worth having. A payment that produced a
  // row nobody could act on would be worse than no payment button at all.
  const db = seed();
  const { domains } = services(db);
  await domains.register(T, 1, LEARNER);

  const rows = await domains.registrations(T, 1);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.name, 'Sam Student');
  assert.equal(rows[0]!.email, 'sam@demo.onyx');
  assert.equal(rows[0]!.phone, '+91 90000 00001');
});

test('a pending registration is in the list, not hidden from it', async () => {
  // Somebody who may well have been charged must be visible to the only people
  // who could find out what happened.
  const db = seed();
  const { domains } = services(db);
  db.tables.onyx_domain_registrations.push({
    id: 99, tenant_id: T, domain_id: 1, user_id: LEARNER, amount_minor: 500_000,
    currency: 'INR', gateway: 'domainpay', reference: 'ref_pending', provider_ref: null,
    status: 'pending', created_at: '2026-08-01T00:00:00Z', updated_at: 'now',
  });

  const rows = await domains.registrations(T, 1);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.status, 'pending');
});

test('a registration list is scoped to its own institution', async () => {
  const db = seed();
  const { domains } = services(db);
  await assert.rejects(domains.registrations(T, 4), (e: HttpError) => e.status === 404);
});

// -------------------------------------------------------------------- paying

test('the amount charged is the domain price, whatever the request says', async () => {
  const db = seed();
  const { checkout } = services(db);

  const started = await checkout.beginDomain(T, 1, { userId: LEARNER }, {
    gateway: 'domainpay', email: 'sam@demo.onyx',
  });

  assert.equal(started.amount_minor, 500_000);
  assert.equal(lastOrder?.total, 5_000, 'the provider seam speaks major units');
  // course_id is 0 and that is deliberate: this is not a course, and the field
  // has meant "not a course sale" with a zero since the invoice path was the
  // only path.
  assert.equal(lastOrder?.items[0]?.course_id, 0);

  const intent = readIntent(started.reference, SECRET, NOW);
  assert.equal(intent?.kind, 'domain');
  assert.equal(intent?.targetId, 1);
  assert.equal(intent?.amountMinor, 500_000);
});

test('a free domain refuses a gateway, and a signed-up one refuses a second payment', async () => {
  const db = seed();
  const { checkout, domains } = services(db);
  const buy = (id: number) =>
    checkout.beginDomain(T, id, { userId: LEARNER }, { gateway: 'domainpay' });

  // Free: a zero-rupee order is a provider error rather than a purchase.
  await assert.rejects(buy(2), (e: HttpError) => e.status === 422);
  await assert.rejects(buy(3), (e: HttpError) => e.status === 403);

  await domains.register(T, 1, LEARNER);
  // Sending somebody to a payment window for something they have already paid
  // for is how you take money twice.
  await assert.rejects(buy(1), (e: HttpError) => e.status === 409);
});

test('settle routes a domain intent to the registrations table and not the ledger', async () => {
  const db = seed();
  const { checkout } = services(db);
  const intent = readIntent(signIntent({
    tenantId: T, kind: 'domain', targetId: 1, userId: LEARNER,
    gateway: 'domainpay', amountMinor: 500_000, currency: 'INR',
  }, SECRET, NOW), SECRET, NOW)!;

  const settled = await checkout.settle(intent, {
    status: 'paid', providerRef: 'order_dom',
    transaction: { order_id: 'order_dom' },
  });

  // `finance.recordPayment` throws if reached: no invoice is raised, which is
  // 0024's decision and 0030's, for the same reason.
  assert.equal(settled.status, 'captured');
  assert.equal(settled.invoice, null);
  assert.equal(db.tables.onyx_domain_registrations.length, 1);
});

test('an unconfirmed payment registers nobody', async () => {
  const db = seed();
  const { checkout, domains } = services(db);
  const intent = readIntent(signIntent({
    tenantId: T, kind: 'domain', targetId: 1, userId: LEARNER,
    gateway: 'domainpay', amountMinor: 500_000, currency: 'INR',
  }, SECRET, NOW), SECRET, NOW)!;

  const settled = await checkout.settle(intent, { status: 'pending', providerRef: 'order_dom' });

  assert.equal(settled.status, 'pending');
  assert.equal(db.tables.onyx_domain_registrations.length, 0);
  assert.equal(await domains.hasRegistered(T, 1, LEARNER), false);
});

test('the same webhook delivered twice registers once', async () => {
  const db = seed();
  const { checkout } = services(db);
  const intent = readIntent(signIntent({
    tenantId: T, kind: 'domain', targetId: 1, userId: LEARNER,
    gateway: 'domainpay', amountMinor: 500_000, currency: 'INR',
  }, SECRET, NOW), SECRET, NOW)!;
  const outcome = { status: 'paid' as const, providerRef: 'order_dom' };

  await checkout.settle(intent, outcome);
  const again = await checkout.settle(intent, outcome);

  assert.equal(again.status, 'captured');
  assert.equal(again.replayed, true);
  assert.equal(db.tables.onyx_domain_registrations.length, 1);
});
