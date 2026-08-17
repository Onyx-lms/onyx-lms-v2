/**
 * The two formatting rules the QA audit caught the product breaking.
 *
 * Both are the kind of bug that no typecheck sees and no happy-path click-
 * through notices: the page renders, the number is there, and it is wrong by
 * an amount small enough to look like a rounding preference rather than a
 * defect.
 *
 *   node --test apps/web/src/lib/formatting.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { percentText } from './percent.ts';
import { formatDate, formatDateTime, formatTime, LOCALE, TIME_ZONE } from './when.ts';

// --------------------------------------------------------------- percentages

test('a nonzero score never prints as zero', () => {
  // The reported case: 0.5 out of 100 shown as "1%" beside the exact "0.5 / 100".
  assert.equal(percentText(0.5), '0.5');
  assert.equal(percentText(0.04), '<1');
  assert.equal(percentText(0.0001), '<1');
  // Actually zero is still zero -- "<1" would overstate a blank paper.
  assert.equal(percentText(0), '0');
});

test('whole numbers stay whole and partials keep one decimal', () => {
  assert.equal(percentText(57), '57');
  assert.equal(percentText(100), '100');
  assert.equal(percentText(66.666), '66.7');
});

test('a score short of full never rounds up into a perfect mark', () => {
  // Claiming 100% for 99.96 is the one rounding error somebody would dispute.
  assert.equal(percentText(99.96), '99.9');
  assert.equal(percentText(100), '100');
});

test('percentages are clamped, and nonsense degrades rather than throws', () => {
  assert.equal(percentText(-20), '0');
  assert.equal(percentText(140), '100');
  assert.equal(percentText(Number.NaN), '—');
});

// --------------------------------------------------------------------- dates

test('dates are pinned to one locale and one zone, not the environment', () => {
  // The whole point. If either of these resolved from the environment, the
  // server and the browser would disagree and React would emit #418.
  assert.ok(LOCALE);
  assert.ok(TIME_ZONE);

  const iso = '2026-08-14T12:07:00.000Z';

  // Same input, same output, whatever the process thinks its zone is.
  const before = formatDateTime(iso);
  const saved = process.env.TZ;
  try {
    process.env.TZ = 'America/Los_Angeles';
    assert.equal(formatDateTime(iso), before,
      'the formatter followed the process time zone');
  } finally {
    if (saved === undefined) delete process.env.TZ; else process.env.TZ = saved;
  }
});

test('the institution clock is used, not UTC', () => {
  // 12:07 UTC is 17:37 in Asia/Kolkata. A timetable that renders the UTC hour
  // is showing a lecture at the wrong time, which is the failure that made
  // this worth pinning rather than merely making consistent.
  const t = formatTime('2026-08-14T12:07:00.000Z');
  assert.doesNotMatch(t, /12[:.]07/, 'the UTC hour was rendered');
});

test('a missing or unparseable date is a dash, not "Invalid Date"', () => {
  for (const bad of [null, undefined, '', 'not a date']) {
    assert.equal(formatDate(bad), '—');
    assert.equal(formatDateTime(bad), '—');
  }
});
