import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeDb } from './fake-db.ts';
import { RevenueService, sumOf } from '../src/reports/revenue.service.ts';
import { PayoutService } from '../src/reports/payout.service.ts';
import { HttpError } from '../src/http/errors.ts';

const iso = (monthsAgo: number) => {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - monthsAgo);
  return d.toISOString();
};

function make() {
  const d = new FakeDb({
    users: [{ id: 2, name: 'Tam' }, { id: 3, name: 'Sid' }],
    // Two instructors: 2 owns everything, 9 owns nothing.
    courses: [{ id: 10, user_id: 2 }, { id: 11, user_id: 9 }],
    bootcamps: [{ id: 20, user_id: 2 }],
    team_training_packages: [{ id: 30, user_id: 2 }],
    payment_histories: [
      { id: 1, user_id: 3, course_id: 10, amount: 100, admin_revenue: 40,
        instructor_revenue: 60, invoice: '#c1', created_at: iso(0) },
      { id: 2, user_id: 3, course_id: 11, amount: 200, admin_revenue: 80,
        instructor_revenue: 120, invoice: '#c2', created_at: iso(0) },
    ],
    bootcamp_purchases: [
      { id: 1, bootcamp_id: 20, user_id: 3, price: 75, admin_revenue: 30,
        instructor_revenue: 45, status: 1, invoice: '#b1', created_at: iso(1) },
    ],
    team_package_purchases: [
      { id: 1, package_id: 30, user_id: 3, price: 500, admin_revenue: 200,
        instructor_revenue: 300, status: 1, invoice: '#t1', created_at: iso(2) },
    ],
    tutor_bookings: [
      { id: 1, tutor_id: 2, student_id: 3, price: 50, admin_revenue: 20,
        instructor_revenue: 30, status: 1, invoice: '#u1', created_at: iso(0) },
    ],
    payouts: [],
  });
  const revenue = new RevenueService(d as never);
  return { d, revenue, payouts: new PayoutService(d as never, revenue) };
}

test('REV-01 platform totals cover all four product lines', async () => {
  const { revenue } = make();
  const totals = await revenue.totals();

  assert.equal(totals.sales, 5);
  assert.equal(totals.gross, 925, '100 + 200 + 75 + 500 + 50');
  assert.equal(totals.instructor, 555);
  assert.equal(totals.admin, 370);
  assert.equal(totals.instructor + totals.admin, totals.gross, 'the split reconciles');

  const sources = totals.lines.map((l) => l.source);
  assert.deepEqual(sources, ['course', 'bootcamp', 'team_package', 'tuition']);
});

test('REV-02 instructor revenue counts only what they own', async () => {
  const { revenue } = make();
  // Course 11 belongs to someone else, so its 120 must not appear.
  assert.equal(await revenue.instructorRevenue(2), 435, '60 + 45 + 300 + 30');
  assert.equal(await revenue.instructorRevenue(9), 120, 'only their own course');
  assert.equal(await revenue.instructorRevenue(404), 0);
});

test('REV-01 a date filter narrows every stream', async () => {
  const { revenue } = make();
  const thisMonth = await revenue.totals({ from: iso(0).slice(0, 8) + '01' });
  // The workshop and the package are older than this month.
  assert.equal(thisMonth.sales, 3);
  assert.equal(thisMonth.gross, 350, '100 + 200 + 50');
});

test('REV-06 the chart has one bucket per month, zeros included', async () => {
  const { revenue } = make();
  const months = await revenue.monthly(12);
  assert.equal(months.length, 12);
  assert.equal(months[11]!.month, new Date().toISOString().slice(0, 7), 'newest last');
  // A month with no sales is a zero, not a gap.
  assert.equal(months.every((m) => typeof m.gross === 'number'), true);
  assert.equal(months[11]!.gross, 350);
  assert.equal(months.reduce((t, m) => t + m.gross, 0), 925);
});

test('REV-03 a buyer sees every kind of purchase, newest first', async () => {
  const { revenue } = make();
  const rows = await revenue.purchasesFor(3);
  assert.equal(rows.length, 5);
  assert.deepEqual([...new Set(rows.map((r) => r.kind))].sort(),
    ['bootcamp', 'course', 'team_package', 'tuition']);

  const times = rows.map((r) => new Date(String(r.created_at)).getTime());
  assert.deepEqual(times, [...times].sort((a, b) => b - a), 'newest first');
  assert.equal(rows.reduce((t, r) => t + r.amount, 0), 925);
});

test('REV-01 sumOf tolerates nulls and numeric text', () => {
  assert.equal(sumOf([{ a: 1 }, { a: '2.5' }, { a: null }, {}], 'a'), 3.5);
  assert.equal(sumOf([], 'a'), 0);
});
