import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  toMinorUnits, fromMinorUnits, isZeroDecimal, round2,
  calculateTax, computeTotals, splitRevenue, allocateDiscount,
} from '../src/payments/money.ts';

test('PAY-07 amounts convert to integer minor units', () => {
  assert.equal(toMinorUnits(10.5, 'USD'), 1050);
  assert.equal(toMinorUnits(0.1 + 0.2, 'USD'), 30, 'float drift does not leak into the charge');
  assert.equal(toMinorUnits(99.99, 'EUR'), 9999);
});

test('PAY-07 zero-decimal currencies are not multiplied by 100', () => {
  assert.equal(isZeroDecimal('JPY'), true);
  assert.equal(toMinorUnits(1050, 'JPY'), 1050, 'charging 105000 yen would be 100x too much');
  assert.equal(fromMinorUnits(1050, 'JPY'), 1050);
  assert.equal(fromMinorUnits(1050, 'USD'), 10.5);
});

test('PAY-07 tax is a percentage of the post-discount amount', () => {
  assert.deepEqual(calculateTax(100, 10), { rate: 10, amount: 10 });
  assert.deepEqual(calculateTax(100, 0), { rate: 0, amount: 0 });
  assert.deepEqual(calculateTax(100, null), { rate: 0, amount: 0 });
  assert.equal(calculateTax(99.99, 7.5).amount, 7.5);
});

test('PAY-07 totals apply the coupon first, then tax', () => {
  const t = computeTotals(200, 50, 10);
  assert.equal(t.subtotal, 200);
  assert.equal(t.discount, 50);
  assert.equal(t.taxable, 150);
  assert.equal(t.tax, 15, 'tax is on 150, not on 200');
  assert.equal(t.total, 165);
});

test('PAY-07 a discount can never exceed the subtotal', () => {
  const t = computeTotals(50, 500, 0);
  assert.equal(t.discount, 50);
  assert.equal(t.total, 0, 'the customer is never owed money');
});

test('PAY-05 an admin-authored course gives the platform everything', () => {
  assert.deepEqual(splitRevenue(100, 70, true), { adminRevenue: 100, instructorRevenue: 0 });
});

test('PAY-05 an instructor course splits by the configured percentage', () => {
  assert.deepEqual(splitRevenue(100, 70, false),
    { adminRevenue: 30, instructorRevenue: 70 });
  assert.deepEqual(splitRevenue(49.99, 60, false),
    { adminRevenue: 20, instructorRevenue: 29.99 });
});

test('PAY-05 the split always sums back to the item amount', () => {
  for (const amount of [0.01, 9.99, 33.33, 100, 149.5, 1234.56]) {
    for (const share of [0, 15, 33, 70, 100]) {
      const s = splitRevenue(amount, share, false);
      assert.equal(round2(s.adminRevenue + s.instructorRevenue), round2(amount),
        `${amount} at ${share}% must reconcile`);
    }
  }
});

test('PAY-05 the split is per item, not per order -- the Laravel bug', () => {
  // Laravel used payable_amount inside the per-item loop, so a two-item cart
  // booked the whole order value as revenue for EVERY item.
  const items = [60, 40];
  const total = items.reduce((a, b) => a + b, 0);
  const booked = items
    .map((i) => splitRevenue(i, 50, false))
    .reduce((s, r) => s + r.adminRevenue + r.instructorRevenue, 0);
  assert.equal(round2(booked), total, 'books 100, not 200');
});

test('PAY-05 an order discount is allocated across items in proportion', () => {
  assert.deepEqual(allocateDiscount([60, 40], 10), [6, 4]);
  assert.deepEqual(allocateDiscount([100], 25), [25]);
  assert.deepEqual(allocateDiscount([50, 50], 0), [0, 0]);
});

test('PAY-05 allocation absorbs rounding so the books are never a cent short', () => {
  const prices = [33.33, 33.33, 33.34];
  const parts = allocateDiscount(prices, 10);
  assert.equal(round2(parts.reduce((a, b) => a + b, 0)), 10);
});

test('PAY-05 allocating more discount than the subtotal is capped', () => {
  const parts = allocateDiscount([10, 10], 500);
  assert.equal(round2(parts.reduce((a, b) => a + b, 0)), 20);
});
