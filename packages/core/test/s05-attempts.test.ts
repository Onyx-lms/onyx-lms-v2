import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeDb } from './fake-db.ts';
import { QuizService } from '../src/quiz/quiz.service.ts';
import { HttpError } from '../src/http/errors.ts';

const seed = (retake = 2) => new FakeDb({
  lessons: [
    { id: 50, title: 'Module quiz', course_id: 2, section_id: 1, lesson_type: 'quiz',
      total_mark: 3, pass_mark: 2, retake },
    { id: 51, title: 'A video', course_id: 2, section_id: 1, lesson_type: 'youtube' },
  ],
  questions: [
    { id: 1, quiz_id: 50, title: 'Pick a and b', type: 'mcq', answer: '["a","b"]',
      options: '["a","b","c"]', sort: 1 },
    { id: 2, quiz_id: 50, title: 'Capital of France', type: 'fill_blanks',
      answer: '["Paris"]', options: null, sort: 2 },
    { id: 3, quiz_id: 50, title: 'Sky is blue', type: 'true_false',
      answer: 'true', options: null, sort: 3 },
  ],
  quiz_submissions: [],
  users: [{ id: 12, name: 'Sam Student', email: 'sam@b.test' }],
});

test('Q-03 a non-quiz lesson is not a quiz', async () => {
  await assert.rejects(() => new QuizService(seed() as never).findQuiz(51),
    (e: HttpError) => e.status === 404);
});

test('Q-03 the attempt payload never contains the answer key', async () => {
  const start = await new QuizService(seed() as never).startAttempt(50, 12);
  assert.equal(start.questions.length, 3);
  for (const q of start.questions) {
    assert.ok(!('answer' in q), 'question ' + q.id + ' leaked its answer');
  }
  assert.deepEqual(start.questions[0].options, ['a', 'b', 'c']);
  assert.equal(start.can_attempt, true);
  assert.equal(start.attempts_left, 3, 'retake=2 allows three attempts');
});

test('Q-04 a fully correct submission scores 3/3 and passes', async () => {
  const d = seed();
  const result = await new QuizService(d as never)
    .submit(50, 12, { 1: ['b', 'a'], 2: ['paris'], 3: 'true' });
  assert.equal(result.score, 3);
  assert.equal(result.total, 3);
  assert.equal(result.percentage, 100);
  assert.equal(result.passed, true, '3 correct of 3 = 3 marks of 3 >= pass_mark 2');
  assert.equal(result.attempt_number, 1);
  assert.equal(result.attempts_left, 2);
});

test('Q-04 a partly correct submission is scored against pass_mark', async () => {
  const d = seed();
  const result = await new QuizService(d as never)
    .submit(50, 12, { 1: ['a'], 2: ['Paris'], 3: 'false' });
  assert.equal(result.score, 1, 'only fill_blanks is right');
  assert.deepEqual(result.wrong, [1, 3]);
  // 1 correct of 3 -> 1 mark of a 3-mark quiz, below the pass mark of 2.
  assert.equal(result.passed, false);
});

test('Q-04 the submission row stores PHP-encoded arrays, null when empty', async () => {
  const d = seed();
  await new QuizService(d as never).submit(50, 12, { 1: ['a', 'b'], 2: ['Paris'], 3: 'true' });
  const row = d.tables.quiz_submissions[0];
  assert.equal(row.correct_answer, '[1,2,3]');
  assert.equal(row.wrong_answer, null, 'Laravel writes null, not an empty array');
  assert.ok(String(row.submits).startsWith('{'));
});

test('Q-05 retake=2 allows exactly three attempts', async () => {
  const d = seed(2);
  const svc = new QuizService(d as never);
  for (let i = 1; i <= 3; i++) {
    const r = await svc.submit(50, 12, { 1: ['a', 'b'], 2: ['Paris'], 3: 'true' });
    assert.equal(r.attempt_number, i);
  }
  await assert.rejects(() => svc.submit(50, 12, { 1: ['a', 'b'] }),
    (e: HttpError) => e.status === 422 && e.message === 'Attempt has been over.');
});

test('Q-05 retake=0 allows exactly one attempt', async () => {
  // Reads like an off-by-one, but Laravel compares submissions > retake.
  const d = seed(0);
  const svc = new QuizService(d as never);
  await svc.submit(50, 12, { 1: ['a', 'b'], 2: ['Paris'], 3: 'true' });
  await assert.rejects(() => svc.submit(50, 12, { 1: ['a'] }),
    (e: HttpError) => e.status === 422);
});

test('Q-05 attempts are counted per student, not globally', async () => {
  const d = seed(0);
  const svc = new QuizService(d as never);
  await svc.submit(50, 12, { 1: ['a', 'b'] });
  // A different student still has their own attempt available.
  const other = await svc.submit(50, 99, { 1: ['a', 'b'], 2: ['Paris'], 3: 'true' });
  assert.equal(other.attempt_number, 1);
});

test('Q-05 review shows per-question outcome and what was submitted', async () => {
  const d = seed();
  const svc = new QuizService(d as never);
  const submitted = await svc.submit(50, 12, { 1: ['a'], 2: ['Paris'], 3: 'true' });
  const review = await svc.review(submitted.submission_id!, 12);
  assert.equal(review.total, 3);
  assert.equal(review.score, 2);
  const q1 = review.questions.find((q: any) => q.id === 1);
  assert.equal(q1.was_correct, false);
  assert.deepEqual(q1.submitted, ['a']);
});

test('Q-05 a student cannot review someone else attempt', async () => {
  const d = seed();
  const svc = new QuizService(d as never);
  const s = await svc.submit(50, 12, { 1: ['a', 'b'] });
  await assert.rejects(() => svc.review(s.submission_id!, 99),
    (e: HttpError) => e.status === 403);
});

test('Q-06 participants list marks the latest attempt per student', async () => {
  const d = seed(5);
  const svc = new QuizService(d as never);
  await svc.submit(50, 12, { 1: ['a'] });
  await svc.submit(50, 12, { 1: ['a', 'b'], 2: ['Paris'], 3: 'true' });
  await svc.submit(50, 99, { 1: ['a', 'b'] });

  const rows = await svc.participants(50);
  assert.equal(rows.length, 3);
  const latestFor12 = rows.filter((r: any) => r.user?.id === 12 && r.is_latest_attempt);
  assert.equal(latestFor12.length, 1, 'exactly one row flagged latest per student');
  assert.equal(latestFor12[0].score, 3, 'and it is the most recent one');
});
