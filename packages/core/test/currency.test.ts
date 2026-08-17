import { test } from 'node:test';
import assert from 'node:assert/strict';
import { currency } from '../src/format/currency.ts';

test('matches the four currency_position modes', () => {
  assert.equal(currency(10, { position: 'left' }), '$10');
  assert.equal(currency(10, { position: 'right' }), '10$');
  assert.equal(currency(10, { position: 'left-space' }), '$ 10');
  assert.equal(currency(10, { position: 'right-space' }), '10 $');
});

test('reproduces the PHP trailing-zero quirk', () => {
  // Laravel concatenates the rounded float, so 12.50 renders as 12.5.
  // Formatting it "properly" would make every price differ from the original.
  assert.equal(currency(12.5), '$12.5');
  assert.equal(currency(12.345), '$12.35');
});

test('clamps negatives to zero like max(0, round(...))', () => {
  assert.equal(currency(-5), '$0');
});

test('defaults to left position and dollar symbol', () => {
  assert.equal(currency(99.99), '$99.99');
  assert.equal(currency(5, { symbol: 'Rs' }), 'Rs5');
});
