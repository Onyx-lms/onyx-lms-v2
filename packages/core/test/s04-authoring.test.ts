import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeDb } from './fake-db.ts';
import { slugify, slugWithId } from '../src/authoring/slug.ts';
import {
  durationToSeconds, secondsToTimeFormat, extractVideoId,
  validateLesson, isVideoLesson, LESSON_TYPES,
} from '../src/authoring/lesson-types.ts';
import { SectionsService } from '../src/authoring/sections.service.ts';
import { LessonsService } from '../src/authoring/lessons.service.ts';

const db = () => new FakeDb({ sections: [], lessons: [], questions: [], courses: [] });

test('B-01 slugify keeps non-Latin scripts instead of emptying the slug', () => {
  assert.equal(slugify('React Basics'), 'react-basics');
  assert.equal(slugify('  Spaced   Out  '), 'spaced-out');
  // Laravel collapses whitespace FIRST, then strips punctuation, so the '&'
  // leaves a double hyphen behind. Reproduced deliberately: existing course
  // URLs in the database were generated this way.
  assert.equal(slugify('Node.js & TypeScript!'), 'nodejs--typescript');
  // A naive ASCII slugifier would return '' here and break the URL entirely.
  assert.equal(slugify('مقدمة'), 'مقدمة');
  assert.equal(slugify('Café Crème'), 'café-crème');
});

test('B-01 slugWithId appends the row id like Laravel', () => {
  assert.equal(slugWithId('Introduction to Generative AI', 1),
    'introduction-to-generative-ai-1');
});

test('B-05 duration parsing accepts hh:mm:ss and mm:ss', () => {
  assert.equal(durationToSeconds('01:30:00'), 5400);
  assert.equal(durationToSeconds('05:30'), 330);
  assert.equal(durationToSeconds('45'), 45);
});

test('B-05 an unparseable duration is zero, not an exception', () => {
  assert.equal(durationToSeconds('abc'), 0);
  assert.equal(durationToSeconds(''), 0);
  assert.equal(durationToSeconds(null), 0);
});

test('B-05 seconds format back to zero-padded hh:mm:ss', () => {
  assert.equal(secondsToTimeFormat(5400), '01:30:00');
  assert.equal(secondsToTimeFormat(59), '00:00:59');
  assert.equal(secondsToTimeFormat(0), '00:00:00');
  assert.equal(secondsToTimeFormat(-5), '00:00:00');
});

test('B-05 provider ids are extracted from pasted URLs', () => {
  assert.equal(extractVideoId('youtube', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(extractVideoId('youtube', 'https://youtu.be/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(extractVideoId('vimeo', 'https://vimeo.com/76979871'), '76979871');
  assert.equal(extractVideoId('google_drive', 'https://drive.google.com/file/d/ABC123xyz/view'), 'ABC123xyz');
  // A bare id is passed through unchanged.
  assert.equal(extractVideoId('youtube', 'dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
});

test('B-04 all thirteen lesson types from the Blade templates are supported', () => {
  for (const t of ['video', 'youtube', 'vimeo', 'google_drive', 'google_drive_video',
    'academy_cloud', 'document', 'document_type', 'image', 'text', 'iframe', 'scorm', 'quiz']) {
    assert.ok(LESSON_TYPES.includes(t as never), t + ' should be supported');
  }
});

test('B-04 only genuine video types carry a duration', () => {
  assert.equal(isVideoLesson('youtube'), true);
  assert.equal(isVideoLesson('academy_cloud'), true);
  assert.equal(isVideoLesson('document'), false);
  assert.equal(isVideoLesson('quiz'), false);
});

test('B-04 validation rejects an unknown type and a missing source', () => {
  assert.ok(validateLesson({ lesson_type: 'hologram' }).lesson_type);
  assert.ok(validateLesson({ lesson_type: 'youtube', lesson_src: '' }).lesson_src);
  // text and quiz lessons legitimately have no source.
  assert.deepEqual(validateLesson({ lesson_type: 'text' }), {});
  assert.deepEqual(validateLesson({ lesson_type: 'quiz' }), {});
});

test('B-02 sections append at the end and sort is stored as text', async () => {
  const d = db();
  const svc = new SectionsService(d as never);
  await svc.create(1, 10, 'First');
  await svc.create(1, 10, 'Second');
  const rows = d.tables.sections;
  assert.equal(rows.length, 2);
  // The column is varchar in the Laravel schema; writing a number would rely on
  // implicit casting and break exact parity.
  assert.equal(typeof rows[1].sort, 'string');
  assert.equal(rows[1].sort, '2');
});

test('B-02 sections list numerically, not lexicographically', async () => {
  const d = new FakeDb({
    sections: [
      { id: 1, course_id: 1, title: 'Ten', sort: '10' },
      { id: 2, course_id: 1, title: 'Two', sort: '2' },
    ],
    lessons: [],
  });
  const list = await new SectionsService(d as never).listForCourse(1);
  // A text sort would put "10" first. Ten sections in and the course reads wrong.
  assert.deepEqual(list.map((s) => s.title), ['Two', 'Ten']);
});

test('B-02 reordering rewrites sort as position + 1', async () => {
  const d = db();
  const svc = new SectionsService(d as never);
  await svc.create(1, 10, 'A');
  await svc.create(1, 10, 'B');
  await svc.create(1, 10, 'C');
  await svc.sort([3, 1, 2]);
  const byId = Object.fromEntries(d.tables.sections.map((s: any) => [s.id, s.sort]));
  assert.deepEqual(byId, { 3: '1', 1: '2', 2: '3' });
});

test('B-02 deleting a section takes its lessons with it', async () => {
  const d = new FakeDb({
    sections: [{ id: 5, course_id: 1, title: 'Doomed', sort: '1' }],
    lessons: [
      { id: 1, section_id: 5, course_id: 1, title: 'orphan-to-be' },
      { id: 2, section_id: 6, course_id: 1, title: 'survivor' },
    ],
  });
  await new SectionsService(d as never).remove(5);
  assert.equal(d.tables.sections.length, 0);
  assert.deepEqual(d.tables.lessons.map((l: any) => l.title), ['survivor']);
});
