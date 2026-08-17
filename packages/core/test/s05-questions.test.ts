import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeDb } from './fake-db.ts';
import { QuestionsService } from '../src/quiz/questions.service.ts';
import { HttpError } from '../src/http/errors.ts';

const db = () => new FakeDb({ questions: [] });

test('Q-02 mcq stores answer and options as PHP-encoded JSON arrays', async () => {
  const d = db();
  await new QuestionsService(d as never).create(7, {
    title: 'Pick the primes', type: 'mcq',
    answer: ['2', '3'], options: ['2', '3', '4'],
  });
  const row = d.tables.questions[0];
  assert.equal(row.answer, '["2","3"]');
  assert.equal(row.options, '["2","3","4"]');
  assert.equal(row.sort, 1);
});

test('Q-02 true_false stores the answer RAW, not JSON encoded', async () => {
  const d = db();
  await new QuestionsService(d as never).create(7, {
    title: 'The sky is blue', type: 'true_false', answer: 'true',
  });
  const row = d.tables.questions[0];
  // Laravel writes $request->answer directly for this type.
  assert.equal(row.answer, 'true');
  assert.equal(row.options, null);
});

test('Q-02 fill_blanks stores an ordered JSON array', async () => {
  const d = db();
  await new QuestionsService(d as never).create(7, {
    title: 'Capital of ____', type: 'fill_blanks', answer: ['Paris'],
  });
  assert.equal(d.tables.questions[0].answer, '["Paris"]');
});

test('Q-02 mcq without options is rejected, matching required_if', async () => {
  const svc = new QuestionsService(db() as never);
  await assert.rejects(
    () => svc.create(7, { title: 'x', type: 'mcq', answer: ['a'] }),
    (e: HttpError) => e.status === 422 && Boolean(e.errors?.options));
});

test('Q-02 an mcq answer outside the options is rejected', async () => {
  const svc = new QuestionsService(db() as never);
  // Otherwise the question is unanswerable and every student gets it wrong.
  await assert.rejects(
    () => svc.create(7, { title: 'x', type: 'mcq', answer: ['z'], options: ['a', 'b'] }),
    (e: HttpError) => e.status === 422 && Boolean(e.errors?.answer));
});

test('Q-02 an unsupported question type is rejected', async () => {
  const svc = new QuestionsService(db() as never);
  await assert.rejects(
    () => svc.create(7, { title: 'x', type: 'essay' as never, answer: ['a'] }),
    (e: HttpError) => e.status === 422);
});

test('Q-02 a blank title or empty answer is rejected', async () => {
  const svc = new QuestionsService(db() as never);
  await assert.rejects(() => svc.create(7, { title: '  ', type: 'true_false', answer: 'true' }),
    (e: HttpError) => Boolean(e.errors?.title));
  await assert.rejects(() => svc.create(7, { title: 'x', type: 'fill_blanks', answer: [] }),
    (e: HttpError) => Boolean(e.errors?.answer));
});

test('Q-02 questions append in order and reorder to position + 1', async () => {
  const d = db();
  const svc = new QuestionsService(d as never);
  for (const t of ['one', 'two', 'three']) {
    await svc.create(7, { title: t, type: 'true_false', answer: 'true' });
  }
  await svc.sort([3, 1, 2]);
  const byId = Object.fromEntries(d.tables.questions.map((q: any) => [q.id, q.sort]));
  assert.deepEqual(byId, { 3: 1, 1: 2, 2: 3 });
});

test('Q-03 the student-facing list never includes the answer key', async () => {
  const d = db();
  const svc = new QuestionsService(d as never);
  await svc.create(7, { title: 'Pick one', type: 'mcq', answer: ['a'], options: ['a', 'b'] });

  const authoring = await svc.listForQuiz(7);
  assert.ok('answer' in authoring[0], 'the author sees the answer');

  const forStudent = await svc.listForAttempt(7);
  assert.ok(!('answer' in forStudent[0]), 'the student must not receive the answer');
  assert.deepEqual(forStudent[0].options, ['a', 'b'], 'but still gets the options');
});
