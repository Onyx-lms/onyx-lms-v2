import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeDb } from './fake-db.ts';
import { RevenueService } from '../src/reports/revenue.service.ts';
import { PayoutService, PAYOUT_PENDING, PAYOUT_PAID } from '../src/reports/payout.service.ts';
import { HttpError } from '../src/http/errors.ts';

function make() {
  const d = new FakeDb({
    users: [{ id: 2, name: 'Tam', email: 't@onyx.test' }],
    courses: [{ id: 10, user_id: 2 }],
    bootcamps: [], team_training_packages: [],
    payment_histories: [
      { id: 1, user_id: 3, course_id: 10, amount: 1000, admin_revenue: 400,
        instructor_revenue: 600, created_at: new Date().toISOString() },
    ],
    bootcamp_purchases: [], team_package_purchases: [], tutor_bookings: [],
    payouts: [],
  });
  const revenue = new RevenueService(d as never);
  return { d, revenue, payouts: new PayoutService(d as never, revenue) };
}

const details = { payment_method: 'bank', payment_details: { iban: 'GB00 TEST' } };

test('REV-04 the balance is earnings minus what has been paid out', async () => {
  const t = make();
  assert.deepEqual(await t.payouts.balance(2), {
    earned: 600, paid: 0, available: 600, pending: 0, requestable: 600,
  });

  await t.payouts.request(2, 200, details);
  const withPending = await t.payouts.balance(2);
  // A pending request is money already claimed; showing it as spendable is how
  // an instructor ends up requesting the same balance twice.
  assert.equal(withPending.pending, 200);
  assert.equal(withPending.requestable, 400);
  assert.equal(withPending.available, 600, 'not paid yet, so still earned');
});

test('REV-04 one request at a time, and never more than the balance', async () => {
  const t = make();
  await t.payouts.request(2, 100, details);
  await assert.rejects(() => t.payouts.request(2, 100, details),
    (e: HttpError) => /request is in process/.test(e.message));

  const t2 = make();
  await assert.rejects(() => t2.payouts.request(2, 10_000, details),
    (e: HttpError) => /sufficient balance/.test(e.message));
  await assert.rejects(() => t2.payouts.request(2, 0, details),
    (e: HttpError) => /sufficient balance/.test(e.message));
});

test('REV-04 a request records when it was made, and how to pay it', async () => {
  const t = make();
  const made = await t.payouts.request(2, 250, details) as Record<string, unknown>;

  assert.equal(made['status'], PAYOUT_PENDING);
  assert.equal(made['payment_method'], 'bank');
  assert.deepEqual(made['payment_details'], { iban: 'GB00 TEST' });
  // Laravel used Payout::insert(), which skips timestamps, so created_at was
  // NULL -- and the instructor's history list filters on created_at, hiding
  // the request they had just submitted.
  assert.equal(typeof made['created_at'], 'string');
  assert.equal((await t.payouts.listFor(2)).length, 1);
});

test('REV-05 the details live on the payout, not on a column that does not exist', async () => {
  const t = make();
  await t.payouts.request(2, 100, {
    payment_method: 'paypal', payment_details: { email: 'tam@onyx.test' },
  });
  // PayoutSettingsController wrote to users.paymentkeys; users has no such
  // column, so the update failed. payouts already had these two columns.
  const stored = t.d.tables['payouts']![0]!;
  assert.equal(stored['payment_method'], 'paypal');
  assert.equal(String(stored['payment_details']).includes('tam@onyx.test'), true);
  assert.equal('paymentkeys' in (t.d.tables['users']![0] ?? {}), false);
});

test('REV-04 marking paid moves the balance, and cannot happen twice', async () => {
  const t = make();
  const made = await t.payouts.request(2, 250, details) as Record<string, unknown>;
  const id = made['id'] as number;

  await t.payouts.markPaid(id, { payment_method: 'bank transfer' });
  assert.equal(await t.payouts.totalPaid(2), 250);
  const after = await t.payouts.balance(2);
  assert.deepEqual(
    { paid: after.paid, available: after.available, pending: after.pending },
    { paid: 250, available: 350, pending: 0 });

  await assert.rejects(() => t.payouts.markPaid(id),
    (e: HttpError) => /already been paid/.test(e.message));
  await assert.rejects(() => t.payouts.markPaid(999), (e: HttpError) => e.status === 404);
});

test('REV-04 a pending request can be withdrawn, a paid one cannot', async () => {
  const t = make();
  const made = await t.payouts.request(2, 100, details) as Record<string, unknown>;
  const id = made['id'] as number;

  await assert.rejects(() => t.payouts.withdraw(id, 999),
    (e: HttpError) => e.status === 404, 'and only by its owner');

  await t.payouts.withdraw(id, 2);
  assert.equal(t.d.tables['payouts']!.length, 0);
  assert.equal((await t.payouts.balance(2)).requestable, 600, 'the money is claimable again');

  const paid = await t.payouts.request(2, 100, details) as Record<string, unknown>;
  await t.payouts.markPaid(paid['id'] as number);
  // Deleting a paid payout would recalculate the balance as if it were never
  // sent, handing the money back.
  await assert.rejects(() => t.payouts.withdraw(paid['id'] as number, 2),
    (e: HttpError) => /already been paid/.test(e.message));
});

test('REV-04 the admin queue filters by status and names the instructor', async () => {
  const t = make();
  const made = await t.payouts.request(2, 100, details) as Record<string, unknown>;

  const pending = await t.payouts.list(PAYOUT_PENDING);
  assert.equal(pending.length, 1);
  assert.equal((pending[0]!.user as { name: string }).name, 'Tam');

  assert.equal((await t.payouts.list(PAYOUT_PAID)).length, 0);
  await t.payouts.markPaid(made['id'] as number);
  assert.equal((await t.payouts.list(PAYOUT_PAID)).length, 1);
  assert.equal((await t.payouts.list()).length, 1, 'no filter means everything');
});
