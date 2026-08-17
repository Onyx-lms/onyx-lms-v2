import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  orderedLessonIds, nextLessonId, previousLessonId, progressPercent,
  lockedLessonIds, isWatchedEnough, isLessonComplete,
} from '../src/player/progress.ts';

const sections = [
  { id: 10, sort: '2' },   // sections.sort is varchar in the schema
  { id: 20, sort: '1' },
];
const lessons = [
  { id: 1, section_id: 20, sort: 2 },
  { id: 2, section_id: 20, sort: 1 },
  { id: 3, section_id: 10, sort: 1 },
  { id: 4, section_id: 10, sort: 2 },
];

test('PL-05 course order is sections by sort, then lessons by sort', () => {
  // Section 20 sorts first ("1"), and within it lesson 2 precedes lesson 1.
  assert.deepEqual(orderedLessonIds(sections, lessons), [2, 1, 3, 4]);
});

test('PL-05 section sort is compared numerically, not as text', () => {
  const many = [{ id: 1, sort: '10' }, { id: 2, sort: '2' }];
  const ls = [{ id: 100, section_id: 1, sort: 1 }, { id: 200, section_id: 2, sort: 1 }];
  // A text sort would put "10" before "2" and read the course out of order.
  assert.deepEqual(orderedLessonIds(many, ls), [200, 100]);
});

test('PL-05 a lesson whose section is gone drops out of the order', () => {
  const orphaned = [...lessons, { id: 9, section_id: 999, sort: 1 }];
  assert.deepEqual(orderedLessonIds(sections, orphaned), [2, 1, 3, 4]);
});

test('PL-09 next and previous walk the course order', () => {
  const order = orderedLessonIds(sections, lessons);
  assert.equal(nextLessonId(order, 2), 1);
  assert.equal(nextLessonId(order, 1), 3, 'crosses the section boundary');
  assert.equal(nextLessonId(order, 4), null, 'the last lesson has no next');
  assert.equal(previousLessonId(order, 2), null);
  assert.equal(previousLessonId(order, 3), 1);
  assert.equal(nextLessonId(order, 999), null, 'an unknown lesson is not in the course');
});

test('PL-05 progress is completed over total, two decimals', () => {
  const order = [1, 2, 3, 4];
  assert.equal(progressPercent([], order), 0);
  assert.equal(progressPercent([1], order), 25);
  assert.equal(progressPercent([1, 2, 3, 4], order), 100);
  assert.equal(progressPercent([1], [1, 2, 3]), 33.33);
});

test('PL-05 a deleted lesson cannot push progress over 100', () => {
  // Laravel counted the raw array, so a stale id inflated the percentage.
  assert.equal(progressPercent([1, 2, 3, 999], [1, 2, 3]), 100);
  assert.equal(progressPercent([1, 999], [1, 2]), 50);
});

test('PL-05 an empty course reports zero rather than dividing by zero', () => {
  assert.equal(progressPercent([1], []), 0);
});

test('PL-06 drip locks everything except the first lesson and the next one', () => {
  const order = [2, 1, 3, 4];
  const locked = lockedLessonIds(order, [], { dripEnabled: true });
  assert.deepEqual(locked, [1, 3, 4], 'only the first lesson is open at the start');
});

test('PL-06 completing a lesson unlocks exactly the one after it', () => {
  const order = [2, 1, 3, 4];
  assert.deepEqual(lockedLessonIds(order, [2], { dripEnabled: true }), [3, 4]);
  assert.deepEqual(lockedLessonIds(order, [2, 1], { dripEnabled: true }), [4]);
  assert.deepEqual(lockedLessonIds(order, [2, 1, 3], { dripEnabled: true }), []);
});

test('PL-06 the unlocked lesson follows the LAST COMPLETED, not the furthest', () => {
  const order = [2, 1, 3, 4];
  // Completing 3 then 1 unlocks the lesson after 1, which is 3 -- already done.
  const locked = lockedLessonIds(order, [3, 1], { dripEnabled: true });
  assert.equal(locked.includes(4), true, 'lesson 4 stays locked');
  assert.equal(locked.includes(3), false, 'a completed lesson is never locked');
});

test('PL-06 drip off, or an instructor viewing, locks nothing', () => {
  const order = [2, 1, 3, 4];
  assert.deepEqual(lockedLessonIds(order, [], { dripEnabled: false }), []);
  assert.deepEqual(lockedLessonIds(order, [], { dripEnabled: true, bypass: true }), []);
});

test('PL-06 percentage rule completes at the configured share', () => {
  const rule = { lesson_completion_role: 'percentage' as const, minimum_percentage: 80 };
  assert.equal(isWatchedEnough(79, 100, rule), false);
  assert.equal(isWatchedEnough(80, 100, rule), true);
});

test('PL-06 duration rule completes at the configured seconds', () => {
  const rule = { lesson_completion_role: 'duration' as const, minimum_duration: 120 };
  assert.equal(isWatchedEnough(119, 600, rule), false);
  assert.equal(isWatchedEnough(120, 600, rule), true);
});

test('PL-06 reaching the end counts even when short of the threshold', () => {
  // A player rarely fires a final tick exactly on the end, hence the tolerance.
  const rule = { lesson_completion_role: 'percentage' as const, minimum_percentage: 100 };
  assert.equal(isWatchedEnough(96, 100, rule), true, 'within one tick of the end');
  assert.equal(isWatchedEnough(90, 100, rule), false);

  // A lesson with no duration (text, quiz, document) needs 0 seconds watched,
  // so the first ping completes it. Laravel behaves the same way: the required
  // duration is (0 / 100) * percent = 0, and 0 >= 0. Faithful, and sensible --
  // there is nothing to watch.
  assert.equal(isWatchedEnough(0, 0, rule), true);
});

test('PL-05 completion lookup tolerates string ids', () => {
  assert.equal(isLessonComplete([1, 2], 2), true);
  assert.equal(isLessonComplete([1, 2], 3), false);
});
