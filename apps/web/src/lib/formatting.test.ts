import { todayInTz, weekdayInTz, isoWeekdayInTz } from './onyx-time.ts';
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

test('the day is the institution’s, not the runtime’s', () => {
  /*
   * The bug: `new Date().getDay()` asks the runtime, and the runtime is a
   * Vercel function in UTC. Between midnight and 05:30 IST the product was a
   * day behind -- at 01:55 on Thursday 27 August the timetable headlined
   * "TODAY · WEDNESDAY" and highlighted the 26th.
   *
   * 20:30 UTC on the 26th is 02:00 IST on the 27th. Any helper that reads the
   * runtime's clock says Wednesday here; the institution's says Thursday, and
   * that is the whole test.
   */
  const beforeDawnIST = new Date('2026-08-26T20:30:00Z');

  assert.equal(todayInTz(beforeDawnIST), '2026-08-27',
    'UTC still calls this the 26th; the institution is already on the 27th');
  assert.equal(weekdayInTz(beforeDawnIST), 4, 'Thursday, counting Sunday as 0');
  assert.equal(isoWeekdayInTz(beforeDawnIST), 4, 'Thursday, counting Monday as 1');

  // And the other edge: 18:00 UTC is 23:30 IST the SAME day, so nothing has
  // rolled over yet. A helper that simply added a day would fail here.
  const lateEveningIST = new Date('2026-08-26T18:00:00Z');
  assert.equal(todayInTz(lateEveningIST), '2026-08-26');
  assert.equal(weekdayInTz(lateEveningIST), 3, 'still Wednesday');

  // Sunday is 0 as JavaScript numbers it, and 7 as the timetable does. Getting
  // this pair wrong is how a Sunday column lights up on a Monday.
  const sundayIST = new Date('2026-08-30T06:00:00Z');
  assert.equal(weekdayInTz(sundayIST), 0);
  assert.equal(isoWeekdayInTz(sundayIST), 7);
});
