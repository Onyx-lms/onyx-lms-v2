/**
 * Onyx O14 unit tests -- a question you answer by building a page.
 *
 * A web question is three files, a browser preview and a person's judgement.
 * The things that would fail quietly, and are therefore the ones here:
 *
 *   * it must reach a MARKER. A web page cannot be scored from a key and
 *     cannot be scored by running tests, so an attempt carrying one must never
 *     be handed back as a finished mark -- which is exactly what `instant
 *     results` would do if the type were treated as objective;
 *   * the three files must reach the CANDIDATE. The starter is snapshotted
 *     onto the paper like every other question's prompt, so editing the
 *     problem afterwards cannot change a paper somebody is part way through;
 *   * an answer of the wrong shape must be REFUSED, not stored. The code path
 *     learned this the hard way -- a response the marker cannot open is a
 *     candidate's work lost behind a shrug;
 *   * and the two kinds must not be confused for one another. Binding a web
 *     question to a code problem would put a Python starter in three HTML tabs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeDb } from './fake-db.ts';
import { AssessService, normaliseWebAnswer, WEB_FILES } from '../src/onyx/assess.service.ts';
import { AcademicsService } from '../src/onyx/academics.service.ts';
import { HttpError } from '../src/http/errors.ts';
import type { OnyxDb } from '../src/onyx/db.ts';

const T = 1;
const ACTOR = { userId: 'user-20', role: 'admin' as const };
const CANDIDATE = 'u-1';

const PAGE = {
  'index.html': '<h1>Hello</h1>',
  'index.css': 'h1 { color: red }',
  'index.js': 'console.log(1)',
};

function world() {
  const db = new FakeDb({
    onyx_courses: [
      { id: 1, tenant_id: T, code: 'WD101', title: 'Web', slug: 'w', status: 1 },
    ],
    onyx_course_faculty: [],
    onyx_enrollments: [{ id: 1, tenant_id: T, course_id: 1, user_id: CANDIDATE, status: 1 }],
    onyx_memberships: [
      { id: 100, tenant_id: T, user_id: CANDIDATE, role: 'student', status: 1,
        roll_number: 'MR-001', section_id: null },
    ],
    onyx_users: [{ id: CANDIDATE, name: 'Meghana', email: 'm@x.test', status: 1 }],
    onyx_question_banks: [],
    onyx_questions: [],
    onyx_question_versions: [],
    onyx_assessments: [],
    onyx_assessment_attempts: [],
    onyx_assessment_answers: [],
    onyx_proctor_events: [],
    onyx_assessment_grades: [],
    onyx_audit_logs: [],
    onyx_problems: [
      // A published web problem, with the page a candidate starts from.
      { id: 10, tenant_id: T, kind: 'web', title: 'Build a profile card',
        slug: 'card', statement: 'Make a card.', status: 'published',
        languages: [], starter_code: PAGE, preview_entry: 'index.html',
        difficulty: 'easy', time_limit_ms: 2000 },
      // A published CODE problem, for the confusion test.
      { id: 11, tenant_id: T, kind: 'code', title: 'Two Sum', slug: 'two',
        statement: 'Add them.', status: 'published',
        languages: ['python'], starter_code: { python: '' },
        preview_entry: 'index.html', difficulty: 'easy', time_limit_ms: 2000 },
      // A web problem still in draft.
      { id: 12, tenant_id: T, kind: 'web', title: 'Unfinished', slug: 'un',
        statement: null, status: 'draft', languages: [], starter_code: PAGE,
        preview_entry: 'index.html', difficulty: 'easy', time_limit_ms: 2000 },
      // A web problem with no entry document.
      { id: 13, tenant_id: T, kind: 'web', title: 'No page', slug: 'nopage',
        statement: null, status: 'published', languages: [],
        starter_code: { 'index.css': 'body{}' }, preview_entry: 'index.html',
        difficulty: 'easy', time_limit_ms: 2000 },
    ],
    onyx_problem_tests: [{ id: 1, tenant_id: T, problem_id: 11, is_hidden: false }],
  });
  const academics = new AcademicsService(db as unknown as OnyxDb);
  const assess = new AssessService(db as unknown as OnyxDb, academics, () => 1_800_000_000_000);
  return { db, assess };
}

/** A one-question web paper, sat by the candidate. */
async function sitting(w: ReturnType<typeof world>, problemId = 10) {
  const bank = await w.assess.createBank(T, ACTOR, { name: 'Web' });
  await w.assess.addQuestion(T, Number(bank.id), ACTOR, {
    type: 'web', prompt: 'Build the card shown.', points: 10, problem_id: problemId,
  });
  const paper = await w.assess.createAssessment(T, ACTOR, {
    title: 'Web paper', course_id: 1, duration_minutes: 60,
    sections: [{ id: 's1', title: 'All', bank_id: Number(bank.id), take: 1 }],
    instant_results: true,
  });
  await w.assess.publishAssessment(T, Number(paper.id));
  const attempt = await w.assess.start(T, Number(paper.id), CANDIDATE);
  return { paperId: Number(paper.id), attemptId: Number(attempt.id), attempt };
}

// ------------------------------------------------------------- the shape

test('ASS-14 a web answer is the three files, however it is wrapped', () => {
  // Both shapes arrive in practice: the sitting screen sends `{ files }`, and
  // a stored response read back is the bare map.
  assert.deepEqual(normaliseWebAnswer({ files: PAGE }), PAGE);
  assert.deepEqual(normaliseWebAnswer(PAGE), PAGE);
});

test('ASS-14 anything that is not those files is refused, not half-kept', () => {
  for (const wrong of [null, undefined, 'a string', 42, [], { source: 'print(1)' }, {}]) {
    assert.equal(normaliseWebAnswer(wrong), null, JSON.stringify(wrong) + ' was accepted');
  }
});

test('ASS-14 a file nobody asked for is dropped rather than stored', () => {
  // The preview composes exactly three files. A fourth would be kept, never
  // rendered, and marked against a page that did not include it.
  const given = normaliseWebAnswer({ ...PAGE, 'sneaky.php': '<?php ?>' });
  assert.deepEqual(Object.keys(given ?? {}).sort(), [...WEB_FILES].sort());
});

test('ASS-14 an empty answer is still an answer', () => {
  // Somebody who deleted everything wrote three empty strings; that is a
  // candidate who answered badly, not a client sending nonsense.
  const blank = { 'index.html': '', 'index.css': '', 'index.js': '' };
  assert.deepEqual(normaliseWebAnswer(blank), blank);
});

// ------------------------------------------------------------- the paper

test('ASS-14 the starter files are dealt with the question', async () => {
  const w = world();
  const { attempt } = await sitting(w);
  const [q] = attempt.questions as { type: string; problem?: Record<string, unknown> }[];
  assert.equal(q!.type, 'web');
  assert.equal(q!.problem?.kind, 'web');
  assert.deepEqual(q!.problem?.starter_code, PAGE,
    'the candidate would have opened an empty editor');
  assert.equal(q!.problem?.preview_entry, 'index.html');
});

test('ASS-14 editing the problem afterwards does not change a paper being sat', async () => {
  // The same rule prompts and marks already follow. A candidate part way
  // through a page must not have the brief change under them.
  const w = world();
  const { attemptId } = await sitting(w);
  await w.db.from('onyx_problems')
    .update({ starter_code: { 'index.html': '<p>different</p>' } }).eq('id', 10);

  const row = await w.assess.attemptRow(T, attemptId);
  const paper = row.paper as unknown as { problem?: { starter_code?: unknown } }[];
  assert.deepEqual(paper[0]?.problem?.starter_code, PAGE);
});

// ------------------------------------------------------------- the marking

test('ASS-14 a page reaches a marker and is never handed back as a mark', async () => {
  /*
   * The claim the whole type turns on. The paper says `instant_results` and
   * carries nothing else, so if a web question were treated as objective the
   * candidate would be handed a score of zero the moment they submitted -- for
   * work nobody had looked at.
   */
  const w = world();
  const { attemptId } = await sitting(w);
  const row = await w.assess.attemptRow(T, attemptId);
  const paper = row.paper as unknown as { question_id: number }[];
  await w.assess.saveAnswer(T, attemptId, CANDIDATE,
    { question_id: paper[0]!.question_id, response: { files: PAGE } });
  await w.assess.submit(T, attemptId, CANDIDATE);

  const after = await w.assess.attemptRow(T, attemptId);
  assert.notEqual(after.status, 'published', 'a page was auto-released as a finished mark');
  assert.equal(after.score, null, 'a page was given a score by a machine');
});

test('ASS-14 the files the candidate wrote survive to the marker', async () => {
  const w = world();
  const { attemptId } = await sitting(w);
  const row = await w.assess.attemptRow(T, attemptId);
  const paper = row.paper as unknown as { question_id: number }[];
  const mine = { ...PAGE, 'index.html': '<h1>Mine</h1>' };
  await w.assess.saveAnswer(T, attemptId, CANDIDATE,
    { question_id: paper[0]!.question_id, response: { files: mine } });

  const script = await w.assess.scriptFor(T, attemptId, null);
  const [printed] = script.questions;
  assert.match(printed!.code ?? '', /index\.html/, 'the script did not name the files');
  assert.match(printed!.code ?? '', /<h1>Mine<\/h1>/, 'the candidate’s markup is not on it');
  assert.match(printed!.code ?? '', /index\.js/);
});

test('ASS-14 an answer of the wrong shape is refused rather than stored', async () => {
  const w = world();
  const { attemptId } = await sitting(w);
  const row = await w.assess.attemptRow(T, attemptId);
  const paper = row.paper as unknown as { question_id: number }[];
  await assert.rejects(
    () => w.assess.saveAnswer(T, attemptId, CANDIDATE,
      { question_id: paper[0]!.question_id, response: 'I wrote some HTML' }),
    (e: unknown) => e instanceof HttpError && e.status === 422);
});

// --------------------------------------------------------- the two kinds

test('ASS-14 a web question cannot be bound to a programming problem', async () => {
  const w = world();
  const bank = await w.assess.createBank(T, ACTOR, { name: 'Mixed' });
  await assert.rejects(
    () => w.assess.addQuestion(T, Number(bank.id), ACTOR, {
      type: 'web', prompt: 'Build it', points: 5, problem_id: 11,
    }),
    (e: unknown) => e instanceof HttpError && e.status === 422
      && /not a web one/i.test(e.message));
});

test('ASS-14 nor to a draft, nor to one with no page in it', async () => {
  const w = world();
  const bank = await w.assess.createBank(T, ACTOR, { name: 'Mixed' });
  await assert.rejects(
    () => w.assess.addQuestion(T, Number(bank.id), ACTOR, {
      type: 'web', prompt: 'Build it', points: 5, problem_id: 12,
    }),
    (e: unknown) => e instanceof HttpError && /still a draft/i.test(e.message));
  // The web twin of "a code problem needs tests": a preview needs a document.
  await assert.rejects(
    () => w.assess.addQuestion(T, Number(bank.id), ACTOR, {
      type: 'web', prompt: 'Build it', points: 5, problem_id: 13,
    }),
    (e: unknown) => e instanceof HttpError && /nothing to preview/i.test(e.message));
});

test('ASS-14 and a web question with no problem at all is refused', async () => {
  const w = world();
  const bank = await w.assess.createBank(T, ACTOR, { name: 'Mixed' });
  await assert.rejects(
    () => w.assess.addQuestion(T, Number(bank.id), ACTOR, {
      type: 'web', prompt: 'Build something', points: 5,
    }),
    (e: unknown) => e instanceof HttpError && e.status === 422);
});

test('ASS-14 a bank counts a web question as needing a marker', async () => {
  // What the bank listing tells a setter before they schedule from it: this
  // paper will not mark itself.
  const w = world();
  const bank = await w.assess.createBank(T, ACTOR, { name: 'Web' });
  await w.assess.addQuestion(T, Number(bank.id), ACTOR, {
    type: 'web', prompt: 'Build the card.', points: 10, problem_id: 10,
  });
  await w.assess.addQuestion(T, Number(bank.id), ACTOR, {
    type: 'truefalse', prompt: 'CSS styles pages.', points: 1, answer: 'true',
  });
  const [listed] = await w.assess.banks(T);
  assert.equal(listed!.question_count, 2);
  assert.equal(listed!.needs_marking, 1, 'the web question was counted as automatic');
});
