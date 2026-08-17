import { test } from 'node:test';
import assert from 'node:assert/strict';
import { grade, isCorrect, decodeAnswer, normalizeSubmitted, passed, marksEarned } from '../src/quiz/grading.ts';

const q = (id: number, type: string, answer: string | null) => ({ id, type, answer });

test('Q-04 mcq ignores order but rejects extra or missing selections', () => {
  const question = q(1, 'mcq', '["a","b"]');
  assert.equal(isCorrect(question, '["b","a"]'), true, 'order does not matter');
  assert.equal(isCorrect(question, ['a', 'b']), true);
  assert.equal(isCorrect(question, ['a']), false, 'missing selection fails');
  assert.equal(isCorrect(question, ['a', 'b', 'c']), false, 'extra selection fails');
  assert.equal(isCorrect(question, []), false);
});

test('Q-04 mcq accepts the widget format of {value} objects', () => {
  // Laravel's multiselect posts [{"value":"a"},{"value":"b"}].
  const question = q(1, 'mcq', '["a","b"]');
  assert.equal(isCorrect(question, '[{"value":"a"},{"value":"b"}]'), true);
});

test('Q-04 fill_blanks is positional and case-insensitive', () => {
  const question = q(2, 'fill_blanks', '["Paris","France"]');
  assert.equal(isCorrect(question, ['paris', 'france']), true);
  assert.equal(isCorrect(question, ['PARIS', 'FRANCE']), true);
  assert.equal(isCorrect(question, ['France', 'Paris']), false, 'order matters here');
  assert.equal(isCorrect(question, ['Paris']), false, 'counts must match');
  assert.equal(isCorrect(question, ['Paris', 'France', 'x']), false);
});

test('Q-04 true_false compares the raw stored value case-insensitively', () => {
  // Laravel stores true_false answers RAW, not json_encode'd.
  assert.equal(isCorrect(q(3, 'true_false', 'true'), 'true'), true);
  assert.equal(isCorrect(q(3, 'true_false', 'true'), 'TRUE'), true);
  assert.equal(isCorrect(q(3, 'true_false', 'true'), 'false'), false);
  assert.equal(isCorrect(q(3, 'true_false', 'false'), false), true);
  assert.equal(isCorrect(q(3, 'true_false', 'true'), true), true);
});

test('Q-04 an unrecognised question type is wrong, not skipped', () => {
  // Skipping would quietly inflate every score.
  assert.equal(isCorrect(q(4, 'essay', '["anything"]'), 'anything'), false);
  assert.equal(isCorrect(q(4, null, '["x"]'), 'x'), false);
});

test('Q-04 unanswered questions count as wrong', () => {
  assert.equal(isCorrect(q(1, 'mcq', '["a"]'), undefined), false);
  assert.equal(isCorrect(q(1, 'mcq', '["a"]'), null), false);
});

test('Q-04 decodeAnswer tolerates both the JSON and raw storage formats', () => {
  assert.deepEqual(decodeAnswer('["a","b"]'), ['a', 'b']);
  assert.deepEqual(decodeAnswer('true'), ['true']);
  assert.deepEqual(decodeAnswer('false'), ['false']);
  assert.deepEqual(decodeAnswer(null), []);
  assert.deepEqual(decodeAnswer(''), []);
});

test('Q-04 normalizeSubmitted handles arrays, widget objects and scalars', () => {
  assert.deepEqual(normalizeSubmitted(['a', 'b']), ['a', 'b']);
  assert.deepEqual(normalizeSubmitted('[{"value":"x"}]'), ['x']);
  assert.deepEqual(normalizeSubmitted('true'), ['true']);
  assert.deepEqual(normalizeSubmitted('plain'), ['plain']);
  assert.deepEqual(normalizeSubmitted(null), []);
});

test('Q-04 grade reports correct and wrong id lists plus a percentage', () => {
  const questions = [
    q(1, 'mcq', '["a"]'),
    q(2, 'fill_blanks', '["paris"]'),
    q(3, 'true_false', 'true'),
    q(4, 'mcq', '["z"]'),
  ];
  const result = grade(questions, { 1: ['a'], 2: ['Paris'], 3: 'true', 4: ['y'] });
  assert.deepEqual(result.correct, [1, 2, 3]);
  assert.deepEqual(result.wrong, [4]);
  assert.equal(result.score, 3);
  assert.equal(result.total, 4);
  assert.equal(result.percentage, 75);
});

test('Q-04 an empty quiz scores zero rather than dividing by zero', () => {
  const result = grade([], {});
  assert.equal(result.percentage, 0);
  assert.equal(result.total, 0);
});

test('Q-05 pass mark is measured in MARKS, not correct answers', () => {
  // Laravel: count(correct) * (total_mark / question_count) >= pass_mark.
  // 3 questions worth 10 marks -> 3.33 marks each.
  const questions = [q(1, 'mcq', '["a"]'), q(2, 'mcq', '["b"]'), q(3, 'mcq', '["c"]')];
  const all = grade(questions, { 1: ['a'], 2: ['b'], 3: ['c'] });
  assert.equal(marksEarned(all, 10), 10);
  assert.equal(passed(all, { total_mark: 10, pass_mark: 6 }), true,
    '3/3 must pass a 6-mark threshold');

  const two = grade(questions, { 1: ['a'], 2: ['b'], 3: ['x'] });
  assert.equal(Math.round(marksEarned(two, 10) * 100) / 100, 6.67);
  assert.equal(passed(two, { total_mark: 10, pass_mark: 6 }), true);

  const one = grade(questions, { 1: ['a'], 2: ['x'], 3: ['x'] });
  assert.equal(passed(one, { total_mark: 10, pass_mark: 6 }), false, '3.33 < 6');
});

test('Q-05 an unconfigured pass mark passes on any correct answer', () => {
  const result = grade([q(1, 'mcq', '["a"]')], { 1: ['a'] });
  assert.equal(passed(result, { total_mark: 0, pass_mark: 0 }), true);
  assert.equal(passed(grade([q(1, 'mcq', '["a"]')], { 1: ['b'] }), { pass_mark: 0 }), false);
});

test('Q-05 marksEarned is zero when the quiz has no questions or no marks', () => {
  assert.equal(marksEarned(grade([], {}), 10), 0);
  assert.equal(marksEarned(grade([q(1, 'mcq', '["a"]')], { 1: ['a'] }), 0), 0);
});
