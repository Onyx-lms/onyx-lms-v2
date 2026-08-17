import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api, login, withDb, ADMIN, RUN } from './harness.ts';

let token = '';
let courseId = 0;
let sectionId = 0;
let quizId = 0;

test('S04 an admin builds a course, and the slug carries the row id', async () => {
  token = await login(ADMIN.email, ADMIN.password);
  const created = await api<{ id: number; slug: string }>('/api/authoring/courses', {
    token,
    body: {
      title: 'E2E Course ' + RUN,
      short_description: 'built by the end-to-end suite',
      level: 'beginner', language: 'english', is_paid: 0,
      requirements: ['A laptop'], outcomes: ['Ship software'],
    },
  });
  assert.equal(created.ok, true);
  courseId = created.data.id;
  assert.match(created.data.slug, new RegExp('-' + courseId + '$'));
});

test('S04 sections append in order, with sort stored as text', async () => {
  const section = await api<{ id: number; sort: string }>(
    '/api/authoring/courses/' + courseId + '/sections',
    { token, body: { title: 'Getting started' } });
  assert.equal(section.ok, true);
  sectionId = section.data.id;
  // sections.sort is varchar in the Laravel schema; lessons.sort is integer.
  assert.equal(typeof section.data.sort, 'string');
});

test('S04 lesson types normalise their source and duration', async () => {
  const video = await api<{ lesson_src: string; video_type: string }>(
    '/api/authoring/courses/' + courseId + '/lessons', {
      token,
      body: { title: 'Intro', lesson_type: 'youtube', section_id: sectionId,
              lesson_src: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
              duration: '00:05:00', is_free: 1 },
    });
  assert.equal(video.data.lesson_src, 'dQw4w9WgXcQ', 'the id is extracted from the URL');
  assert.equal(video.data.video_type, 'youtube');

  const text = await api<{ lesson_src: string | null; duration: string | null }>(
    '/api/authoring/courses/' + courseId + '/lessons',
    { token, body: { title: 'Notes', lesson_type: 'text', section_id: sectionId, description: 'hi' } });
  assert.equal(text.data.lesson_src, null);
  assert.equal(text.data.duration, null);

  const bad = await api('/api/authoring/courses/' + courseId + '/lessons',
    { token, body: { title: 'Broken', lesson_type: 'vimeo', section_id: sectionId } });
  assert.equal(bad.status, 422);
  assert.ok(bad.errors?.lesson_src?.length);
});

test('S04 duplicate makes a deep copy in draft', async () => {
  const copy = await api<{ id: number; status: string }>(
    '/api/authoring/courses/' + courseId + '/duplicate', { token, body: {} });
  assert.equal(copy.ok, true);
  assert.equal(copy.data.status, 'draft');

  const detail = await api<{ total_lesson: number }>(
    '/api/authoring/courses/' + copy.data.id, { token });
  assert.equal(detail.data.total_lesson, 2, 'lessons came across too');

  await api('/api/authoring/courses/' + copy.data.id, { token, method: 'DELETE' });
});

test('S05 a quiz is authored and the answer key stays server-side', async () => {
  const quiz = await api<{ id: number }>('/api/authoring/courses/' + courseId + '/lessons', {
    token,
    body: { title: 'Module quiz', lesson_type: 'quiz', section_id: sectionId,
            total_mark: 10, pass_mark: 6, retake: 1 },
  });
  quizId = quiz.data.id;

  for (const q of [
    { title: 'Pick both', type: 'mcq', answer: ['a', 'b'], options: ['a', 'b', 'c'] },
    { title: 'Capital of France is ____', type: 'fill_blanks', answer: ['Paris'] },
    { title: 'Water is wet', type: 'true_false', answer: 'true' },
  ]) {
    const created = await api('/api/authoring/quizzes/' + quizId + '/questions', { token, body: q });
    assert.equal(created.ok, true, q.type + ' should be accepted');
  }

  const attempt = await api<{ questions: Record<string, unknown>[]; attempts_left: number }>(
    '/api/quizzes/' + quizId + '/attempt', { token });
  assert.equal(attempt.data.questions.length, 3);
  for (const q of attempt.data.questions) {
    assert.equal('answer' in q, false, 'the answer key must never reach the student');
  }
  assert.equal(attempt.data.attempts_left, 2, 'retake=1 allows two attempts');
});

test('S05 grading is measured in marks, and retakes run out', async () => {
  const questions = await api<{ id: number }[]>(
    '/api/authoring/quizzes/' + quizId + '/questions', { token });
  const ids = questions.data.map((q) => q.id);

  const all = await api<{ score: number; marks: number; passed: boolean }>(
    '/api/quizzes/' + quizId + '/submit', {
      token,
      body: { answers: { [ids[0]!]: ['b', 'a'], [ids[1]!]: ['paris'], [ids[2]!]: 'TRUE' } },
    });
  assert.equal(all.data.score, 3);
  assert.equal(all.data.marks, 10);
  assert.equal(all.data.passed, true);

  const partial = await api<{ score: number; passed: boolean }>(
    '/api/quizzes/' + quizId + '/submit', {
      token,
      body: { answers: { [ids[0]!]: ['a'], [ids[1]!]: ['Paris'], [ids[2]!]: 'false' } },
    });
  assert.equal(partial.data.score, 1);
  assert.equal(partial.data.passed, false, '3.33 marks is below a pass mark of 6');

  const over = await api('/api/quizzes/' + quizId + '/submit', { token, body: { answers: {} } });
  assert.equal(over.status, 422);
  assert.equal(over.message, 'Attempt has been over.');
});

test('S04 deleting a course removes its curriculum and questions', async () => {
  const res = await api('/api/authoring/courses/' + courseId, { token, method: 'DELETE' });
  assert.equal(res.ok, true);

  const leftovers = await withDb(async (c) => {
    const l = await c.query('select count(*)::int n from lessons where course_id=$1', [courseId]);
    const s = await c.query('select count(*)::int n from sections where course_id=$1', [courseId]);
    const q = await c.query('select count(*)::int n from questions where quiz_id=$1', [quizId]);
    return { lessons: l.rows[0].n, sections: s.rows[0].n, questions: q.rows[0].n };
  });
  assert.deepEqual(leftovers, { lessons: 0, sections: 0, questions: 0 });
});
