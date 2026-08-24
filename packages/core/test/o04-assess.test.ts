/**
 * Onyx O04 unit tests -- Onyx Assess.
 *
 * The four claims worth checking without a database: that a sat paper is
 * immutable, that the clock belongs to the server, that a score stays hidden
 * until it is released, and that the statistics agree with arithmetic done by
 * hand.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeDb } from './fake-db.ts';
import { AcademicsService } from '../src/onyx/academics.service.ts';
import {
  AssessService, hasKey, isObjective, scoreObjective, seededShuffle,
} from '../src/onyx/assess.service.ts';
import { ProctorService, EVENT_WEIGHTS, REVIEW_THRESHOLD } from '../src/onyx/proctor.service.ts';
import {
  AssessAnalyticsService, discriminationIndex,
} from '../src/onyx/assess-analytics.service.ts';
import { AuditService } from '../src/onyx/audit.service.ts';
import { HttpError } from '../src/http/errors.ts';

const T = 1;
const OTHER = 2;
const START = 1_800_000_000_000;
// 'exams' bypasses the course-ownership check (#assertCanAuthor) the same
// way 'admin' does -- these tests author banks/questions/assessments freely
// across courses, the way the examinations office actually can.
const ACTOR = { userId: 'user-20', role: 'exams' as const };

/** A clock the tests move by hand, so "time is up" is deterministic. */
function clock(at = START) {
  let t = at;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
}

function world(c = clock()) {
  const db = new FakeDb({
    onyx_courses: [
      { id: 1, tenant_id: T, code: 'CS101', title: 'Programming', slug: 'p', status: 1 },
    ],
    // user-20 genuinely teaches course 1, so the faculty branch of
    // #assertCanAuthor can be exercised rather than only the admin/exams
    // bypass around it.
    onyx_course_faculty: [{ id: 1, tenant_id: T, course_id: 1, user_id: 'user-20' }],
    onyx_enrollments: [
      { id: 1, tenant_id: T, course_id: 1, user_id: 'user-10', status: 1 },
      { id: 2, tenant_id: T, course_id: 1, user_id: 'user-11', status: 1 },
    ],
    onyx_question_banks: [],
    onyx_questions: [],
    onyx_question_versions: [],
    onyx_assessments: [],
    onyx_assessment_attempts: [],
    onyx_assessment_answers: [],
    onyx_proctor_events: [],
    onyx_assessment_grades: [],
    onyx_audit_logs: [],
    onyx_problems: [],
    onyx_problem_tests: [],
    onyx_users: [
      { id: 'user-20', email: 'exams@onyx.test', name: 'Exams' },
      // The two candidates, so a named marking queue has real names to resolve
      // rather than only ids that happen to look like names here.
      { id: 'user-10', email: 'ada@onyx.test', name: 'Ada Lovelace' },
      { id: 'user-11', email: 'alan@onyx.test', name: 'Alan Turing' },
    ],
  });
  const academics = new AcademicsService(db as never);
  const audit = new AuditService(db as never);
  return {
    db, clock: c,
    assess: new AssessService(db as never, academics, c.now),
    proctor: new ProctorService(db as never, audit, c.now),
    analytics: new AssessAnalyticsService(db as never),
  };
}

/** A bank with one of each type, and an assessment drawing all five. */
async function withPaper(w: ReturnType<typeof world>, over: Record<string, unknown> = {}) {
  const bank = await w.assess.createBank(T, ACTOR, { name: 'Bank' });
  const bid = Number(bank.id);
  const q = {
    single: await w.assess.addQuestion(T, bid, ACTOR, {
      type: 'single', prompt: '2 + 2?', points: 2,
      options: [{ id: 'a', text: '3' }, { id: 'b', text: '4' }], answer: 'b',
    }),
    multiple: await w.assess.addQuestion(T, bid, ACTOR, {
      type: 'multiple', prompt: 'Primes?', points: 2,
      options: [{ id: 'a', text: '2' }, { id: 'b', text: '4' }, { id: 'c', text: '3' }],
      answer: ['a', 'c'],
    }),
    truefalse: await w.assess.addQuestion(T, bid, ACTOR, {
      type: 'truefalse', prompt: 'Zero is even.', answer: 'true', points: 1,
    }),
    short: await w.assess.addQuestion(T, bid, ACTOR, {
      type: 'short', prompt: 'Capital of France?', answer: ['Paris'], points: 1,
    }),
    essay: await w.assess.addQuestion(T, bid, ACTOR, {
      type: 'essay', prompt: 'Explain induction.', points: 4,
    }),
  };
  const assessment = await w.assess.createAssessment(T, ACTOR, {
    title: 'Midterm', course_id: 1, duration_minutes: 60, pass_mark: 6,
    sections: [{ id: 's1', title: 'All', bank_id: bid, take: 5 }],
    ...over,
  });
  await w.assess.publishAssessment(T, Number(assessment.id));
  return { bank: bid, q, assessment: Number(assessment.id) };
}

/** The same paper, left as a draft -- composition is only editable before publication. */
async function withDraft(w: ReturnType<typeof world>, over: Record<string, unknown> = {}) {
  const bank = await w.assess.createBank(T, ACTOR, { name: 'Draft bank' });
  const bid = Number(bank.id);
  for (const [i, type] of (['single', 'single', 'single', 'essay'] as const).entries()) {
    await w.assess.addQuestion(T, bid, ACTOR, type === 'essay'
      ? { type, prompt: 'Explain ' + i, points: 4 }
      : { type, prompt: 'Q' + i, points: 2,
        options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }], answer: 'b' });
  }
  const assessment = await w.assess.createAssessment(T, ACTOR, {
    title: 'Draft paper', course_id: 1, duration_minutes: 60,
    sections: [{ id: 's1', title: 'All', bank_id: bid, take: 3 }],
    ...over,
  });
  return { bank: bid, assessment: Number(assessment.id) };
}

// ---------------------------------------------------------------------------
// Marking arithmetic
// ---------------------------------------------------------------------------

test('objective marking is exact, and multi-select gives no partial credit', () => {
  assert.equal(scoreObjective('single', 'b', 'b', 2), 2);
  assert.equal(scoreObjective('single', 'b', 'a', 2), 0);
  assert.equal(scoreObjective('single', 'b', null, 2), 0);
  assert.equal(scoreObjective('truefalse', 'true', 'true', 1), 1);

  // All of the right ones and none of the wrong ones. Partial credit here
  // rewards ticking everything.
  assert.equal(scoreObjective('multiple', ['a', 'c'], ['c', 'a'], 2), 2);
  assert.equal(scoreObjective('multiple', ['a', 'c'], ['a'], 2), 0);
  assert.equal(scoreObjective('multiple', ['a', 'c'], ['a', 'b', 'c'], 2), 0);

  // Case and surrounding space are how somebody typed it, not whether they knew.
  assert.equal(scoreObjective('short', ['Paris'], '  paris ', 1), 1);
  assert.equal(scoreObjective('short', ['Paris', 'paris, france'], 'Paris, France', 1), 1);
  assert.equal(scoreObjective('short', ['Paris'], 'Lyon', 1), 0);

  // An essay is not a thing a machine decides.
  assert.equal(scoreObjective('essay', null, 'a long answer', 4), 0);
  assert.equal(isObjective('essay'), false);
  assert.equal(isObjective('short'), true);
});

test('hasKey tells a real answer apart from nothing having been chosen', () => {
  assert.equal(hasKey('b'), true);
  assert.equal(hasKey(['a', 'c']), true);
  assert.equal(hasKey(undefined), false);
  assert.equal(hasKey(null), false);
  assert.equal(hasKey(''), false);
  assert.equal(hasKey('   '), false);
  assert.equal(hasKey([]), false);
});

test('an MCQ authored with no correct option is allowed, and marked by hand, not auto-graded wrong', async () => {
  const w = world();
  const bank = await w.assess.createBank(T, ACTOR, { name: 'B' });
  const bid = Number(bank.id);
  // No `answer` at all -- nobody picked a correct option yet.
  const noKey = await w.assess.addQuestion(T, bid, ACTOR, {
    type: 'single', prompt: 'Pending review', points: 5,
    options: [{ id: 'a', text: 'One' }, { id: 'b', text: 'Two' }],
  });
  const essay = await w.assess.addQuestion(T, bid, ACTOR, {
    type: 'essay', prompt: 'Explain.', points: 3,
  });
  const assessment = await w.assess.createAssessment(T, ACTOR, {
    title: 'Pending', course_id: 1, duration_minutes: 30,
    sections: [{ id: 's1', title: 'All', bank_id: bid, take: 2 }],
  });
  await w.assess.publishAssessment(T, Number(assessment.id));

  const attempt = await w.assess.start(T, Number(assessment.id), 'user-10');
  await w.assess.saveAnswer(T, attempt.id, 'user-10',
    { question_id: Number(noKey.id), response: 'a' });
  const submitted = await w.assess.submit(T, attempt.id, 'user-10');
  // A response was given to the keyless question, so, same as an essay with
  // an answer in it, the paper is not "finished" -- it is waiting on a person.
  assert.equal(submitted.score, null, 'a keyless MCQ auto-scored instead of waiting for a marker');

  const paper = await w.assess.attemptForMarker(T, attempt.id);
  const seen = paper.questions.find((q) => q.question_id === Number(noKey.id))!;
  assert.equal(seen.objective, false, 'a question with no key was shown as auto-graded');
  assert.equal(seen.auto_points, null, 'a keyless question was scored anyway');

  // A marker can now give it real points, same as the essay.
  const marked = await w.assess.mark(T, attempt.id, 'user-20', {
    role: 'first',
    marks: [
      { question_id: Number(noKey.id), points: 2 },
      { question_id: Number(essay.id), points: 1 },
    ],
  });
  assert.equal(Number(marked.auto_score), 0, 'nothing was auto-gradable on this paper');
  assert.equal(Number(marked.score), 3, 'both hand marks counted');
});

test('the shuffle is deterministic, so a resumed attempt deals the same hand', () => {
  const items = [1, 2, 3, 4, 5, 6, 7, 8];
  assert.deepEqual(seededShuffle(items, 'a:1:1'), seededShuffle(items, 'a:1:1'));
  assert.notDeepEqual(seededShuffle(items, 'a:1:1'), seededShuffle(items, 'a:1:2'));
  // Same multiset, different order.
  assert.deepEqual([...seededShuffle(items, 'x')].sort((a, b) => a - b), items);
});

// ---------------------------------------------------------------------------
// ASS-01a -- authoring
// ---------------------------------------------------------------------------

test('a question whose key is not among its options is refused', async () => {
  const w = world();
  const bank = await w.assess.createBank(T, ACTOR, { name: 'B' });
  const bid = Number(bank.id);
  // Unanswerable, and nobody would find out until it was sat.
  await assert.rejects(w.assess.addQuestion(T, bid, ACTOR, {
    type: 'single', prompt: 'x', options: [{ id: 'a', text: '1' }, { id: 'b', text: '2' }],
    answer: 'z',
  }), (e: HttpError) => e.status === 422);
  await assert.rejects(w.assess.addQuestion(T, bid, ACTOR, {
    type: 'single', prompt: 'x', options: [{ id: 'a', text: '1' }], answer: 'a',
  }), (e: HttpError) => e.status === 422);
  await assert.rejects(w.assess.addQuestion(T, bid, ACTOR, {
    type: 'truefalse', prompt: 'x', answer: 'maybe',
  }), (e: HttpError) => e.status === 422);
  await assert.rejects(w.assess.addQuestion(T, bid, ACTOR, {
    type: 'short', prompt: 'x', answer: ['  '],
  }), (e: HttpError) => e.status === 422);
});

test('a section wanting more questions than its bank holds is refused at authoring', async () => {
  const w = world();
  const bank = await w.assess.createBank(T, ACTOR, { name: 'B' });
  await w.assess.addQuestion(T, Number(bank.id), ACTOR, {
    type: 'truefalse', prompt: 'x', answer: 'true',
  });
  // Discovered at start otherwise, which is the worst possible moment.
  await assert.rejects(w.assess.createAssessment(T, ACTOR, {
    title: 'Too big', sections: [{ id: 's', title: 'All', bank_id: Number(bank.id), take: 5 }],
  }), (e: HttpError) => e.status === 422);
});

test('editing a question writes a new version and keeps the old one', async () => {
  const w = world();
  const { q } = await withPaper(w);
  const edited = await w.assess.editQuestion(T, Number(q.single.id), ACTOR, {
    prompt: '2 + 2? (edited)', answer: 'a',
  });
  assert.equal(edited.version, 2);

  const versions = (w.db.tables.onyx_question_versions as Record<string, unknown>[])
    .filter((v) => v.question_id === Number(q.single.id));
  assert.equal(versions.length, 2);
  const v1 = versions.find((v) => v.version === 1)!;
  // The old wording and the old key survive untouched.
  assert.equal(v1.prompt, '2 + 2?');
  assert.equal(v1.answer, 'b');
});

test('ASS-01a: editing a question does not change a paper already sat', async () => {
  const w = world();
  const { q, assessment } = await withPaper(w);
  const attempt = await w.assess.start(T, assessment, 'user-10');
  const sat = attempt.questions.find((x) => x.question_id === Number(q.single.id))!;
  assert.equal(sat.prompt, '2 + 2?');

  await w.assess.saveAnswer(T, attempt.id, 'user-10', { question_id: sat.question_id, response: 'b' });

  // The key changes AFTER the answer was given.
  await w.assess.editQuestion(T, Number(q.single.id), ACTOR, {
    prompt: 'Something else entirely', answer: 'a',
  });

  await w.assess.submit(T, attempt.id, 'user-10');
  const marker = await w.assess.attemptForMarker(T, attempt.id);
  const marked = marker.questions.find((x) => x.question_id === Number(q.single.id))!;
  // The acceptance criterion, stated three ways.
  assert.equal(marked.prompt, '2 + 2?', 'the paper changed under the candidate');
  assert.equal(marked.expected, 'b', 'the answer key changed after the fact');
  assert.equal(Number(marked.auto_points), 2, 'a correct answer became wrong');
});

// ---------------------------------------------------------------------------
// ASS-01b/c -- the engine
// ---------------------------------------------------------------------------

test('an attempt is dealt once and resumes identically', async () => {
  const w = world();
  const { assessment } = await withPaper(w);
  const first = await w.assess.start(T, assessment, 'user-10');
  const again = await w.assess.start(T, assessment, 'user-10');
  assert.equal(again.id, first.id, 'starting again created a second attempt');
  assert.deepEqual(
    again.questions.map((q) => q.question_id),
    first.questions.map((q) => q.question_id),
    'a resumed attempt was dealt a different paper');
});

test('the answer key is never on the candidate view', async () => {
  const w = world();
  const { assessment } = await withPaper(w);
  const attempt = await w.assess.start(T, assessment, 'user-10');
  const wire = JSON.stringify(attempt);
  assert.equal(wire.includes('Paris'), false, 'an expected answer reached the candidate');
  for (const q of attempt.questions) {
    assert.equal((q as Record<string, unknown>).answer, undefined);
    /*
     * Null rather than absent, now that the review screen exists.
     *
     * `expected` is a real field on this projection -- it carries the correct
     * answer once the candidate has no sitting left to spoil. What must never
     * happen is it carrying one HERE, on an attempt that is still running,
     * which is what the `?? null` asserts and what the string check above
     * proves independently of the field's shape.
     */
    assert.equal((q as Record<string, unknown>).expected ?? null, null,
      'the key reached a candidate mid-attempt');
    assert.equal((q as Record<string, unknown>).explanation ?? null, null);
    // And no verdict either: "correct" on a live attempt would give the
    // answer away as surely as printing it.
    assert.equal((q as Record<string, unknown>).correct ?? null, null);
  }
});

test('ASS-01b: a client clock cannot extend an attempt', async () => {
  const c = clock();
  const w = world(c);
  const { assessment } = await withPaper(w);
  const attempt = await w.assess.start(T, assessment, 'user-10');
  assert.equal(attempt.seconds_remaining, 3600);

  // Whatever the browser believes, the remaining time comes from here.
  c.advance(59 * 60_000);
  const late = await w.assess.attemptForCandidate(T, attempt.id, 'user-10');
  assert.equal(late.seconds_remaining, 60);

  c.advance(2 * 60_000);
  const expired = await w.assess.attemptForCandidate(T, attempt.id, 'user-10');
  assert.equal(expired.seconds_remaining, 0);

  // And a save past the deadline is refused, not merely discouraged.
  await assert.rejects(w.assess.saveAnswer(T, attempt.id, 'user-10', {
    question_id: attempt.questions[0]!.question_id, response: 'b',
  }), (e: HttpError) => e.status === 422);

  const after = await w.assess.attemptForCandidate(T, attempt.id, 'user-10');
  assert.equal(after.status, 'expired', 'an overdue attempt was left in progress');
});

test('a window that closes early ends the attempt early', async () => {
  const c = clock();
  const w = world(c);
  // Sixty minutes allowed, but only ten before the window shuts.
  const { assessment } = await withPaper(w, {
    closes_at: new Date(START + 10 * 60_000).toISOString(),
  });
  const attempt = await w.assess.start(T, assessment, 'user-10');
  assert.equal(attempt.seconds_remaining, 600,
    'a candidate starting late could have sat past the close');
});

test('answers autosave, resume, and belong to one candidate', async () => {
  const w = world();
  const { assessment } = await withPaper(w);
  const attempt = await w.assess.start(T, assessment, 'user-10');
  const q = attempt.questions[0]!;

  await w.assess.saveAnswer(T, attempt.id, 'user-10', { question_id: q.question_id, response: 'b' });
  const resumed = await w.assess.attemptForCandidate(T, attempt.id, 'user-10');
  assert.equal(resumed.questions.find((x) => x.question_id === q.question_id)!.response, 'b');

  // Not on this paper.
  await assert.rejects(w.assess.saveAnswer(T, attempt.id, 'user-10', {
    question_id: 999_999, response: 'x',
  }), (e: HttpError) => e.status === 422);
  // Not this candidate.
  await assert.rejects(w.assess.saveAnswer(T, attempt.id, 'user-11', {
    question_id: q.question_id, response: 'x',
  }), (e: HttpError) => e.status === 403);
  await assert.rejects(w.assess.attemptForCandidate(T, attempt.id, 'user-11'),
    (e: HttpError) => e.status === 403);
});

test('a proctored assessment will not start without consent', async () => {
  const w = world();
  const { assessment } = await withPaper(w, { proctoring: true });
  await assert.rejects(w.assess.start(T, assessment, 'user-10'), (e: HttpError) => e.status === 422);
  const consented = await w.assess.start(T, assessment, 'user-10', { consent: true });
  assert.ok(consented.id);
});

test('attempts are capped, and a window is honoured', async () => {
  const c = clock();
  const w = world(c);
  const { assessment } = await withPaper(w);
  const first = await w.assess.start(T, assessment, 'user-10');
  await w.assess.submit(T, first.id, 'user-10');
  await assert.rejects(w.assess.start(T, assessment, 'user-10'), (e: HttpError) => e.status === 422);

  const later = world(c);
  const { assessment: future } = await withPaper(later, {
    opens_at: new Date(c.now() + 3_600_000).toISOString(),
  });
  await assert.rejects(later.assess.start(T, future, 'user-10'), (e: HttpError) => e.status === 422);
});

test('submitting auto-marks the objective questions and leaves the essay', async () => {
  const w = world();
  const { q, assessment } = await withPaper(w);
  const attempt = await w.assess.start(T, assessment, 'user-10');
  const id = (key: keyof typeof q) => Number(q[key].id);

  await w.assess.saveAnswer(T, attempt.id, 'user-10', { question_id: id('single'), response: 'b' });
  await w.assess.saveAnswer(T, attempt.id, 'user-10', { question_id: id('multiple'), response: ['a', 'c'] });
  await w.assess.saveAnswer(T, attempt.id, 'user-10', { question_id: id('truefalse'), response: 'true' });
  await w.assess.saveAnswer(T, attempt.id, 'user-10', { question_id: id('short'), response: 'paris' });
  await w.assess.saveAnswer(T, attempt.id, 'user-10', { question_id: id('essay'), response: 'Because...' });

  const submitted = await w.assess.submit(T, attempt.id, 'user-10');
  const marker = await w.assess.attemptForMarker(T, attempt.id);
  assert.equal(Number(marker.auto_score), 6, '2 + 2 + 1 + 1');
  assert.equal(marker.max_score, 10);
  // Waiting for a person, so the total is not final and is not shown.
  assert.equal(submitted.score, null);
});

test('a paper with nothing subjective is finished on submission', async () => {
  const w = world();
  const bank = await w.assess.createBank(T, ACTOR, { name: 'Objective only' });
  await w.assess.addQuestion(T, Number(bank.id), ACTOR, {
    type: 'truefalse', prompt: 'Zero is even.', answer: 'true', points: 1,
  });
  const assessment = await w.assess.createAssessment(T, ACTOR, {
    title: 'Quick', sections: [{ id: 's', title: 'All', bank_id: Number(bank.id), take: 1 }],
  });
  await w.assess.publishAssessment(T, Number(assessment.id));

  const attempt = await w.assess.start(T, Number(assessment.id), 'user-10');
  await w.assess.saveAnswer(T, attempt.id, 'user-10',
    { question_id: attempt.questions[0]!.question_id, response: 'true' });
  await w.assess.submit(T, attempt.id, 'user-10');

  const rows = w.db.tables.onyx_assessment_attempts as Record<string, unknown>[];
  assert.equal(Number(rows[0]!.score), 1, 'a fully objective paper should be final on submit');
});

test('an unanswered question is marked zero, not left unmarked', async () => {
  const w = world();
  const { assessment } = await withPaper(w);
  const attempt = await w.assess.start(T, assessment, 'user-10');
  await w.assess.submit(T, attempt.id, 'user-10');

  const answers = w.db.tables.onyx_assessment_answers as Record<string, unknown>[];
  // Four objective questions, all zero. A missing row is indistinguishable
  // from "not marked yet".
  assert.equal(answers.filter((a) => a.auto_points === 0).length, 4);
});

// ---------------------------------------------------------------------------
// ASS-03 -- marking and moderation
// ---------------------------------------------------------------------------

test('ASS-03a: anonymous marking hides who the paper belongs to', async () => {
  const w = world();
  const { assessment } = await withPaper(w);
  for (const user of ['user-10', 'user-11']) {
    const a = await w.assess.start(T, assessment, user);
    await w.assess.submit(T, a.id, user);
  }

  const queue = await w.assess.markingQueue(T, assessment);
  assert.equal(queue.length, 2);
  for (const row of queue) {
    assert.equal(row.user_id, null, 'the marker was told whose paper it was');
    assert.match(String(row.candidate), /^Candidate \d+$/);
  }
  const paper = await w.assess.attemptForMarker(T, Number(queue[0]!.id));
  assert.equal(paper.user_id, null);
  assert.equal(paper.anonymous, true);
});

test('a named paper names the candidate, rather than printing their uuid', async () => {
  const w = world();
  const { assessment } = await withPaper(w, { anonymous_marking: false });
  for (const user of ['user-10', 'user-11']) {
    const a = await w.assess.start(T, assessment, user);
    await w.assess.submit(T, a.id, user);
  }

  // The screen says "Names shown" when this is off. It used to say that over a
  // list of 36-character Supabase Auth uuids, because the non-anonymous branch
  // returned `user_id` and nothing ever resolved it to a person.
  const queue = await w.assess.markingQueue(T, assessment);
  assert.deepEqual(queue.map((r) => r.candidate).sort(), ['Ada Lovelace', 'Alan Turing']);
  for (const row of queue) {
    assert.notEqual(row.user_id, null, 'a named paper should still carry the id');
    assert.doesNotMatch(String(row.candidate), /^user-/, 'an id was shown as a name');
  }
});

test('anonymous marking fetches no names at all, rather than fetching and dropping them', async () => {
  const w = world();
  const { assessment } = await withPaper(w);
  const a = await w.assess.start(T, assessment, 'user-10');
  await w.assess.submit(T, a.id, 'user-10');

  // Nothing in the payload may carry the name, not even somewhere unread: the
  // guarantee is about what leaves the server, not about what the current
  // screen happens to render.
  const queue = await w.assess.markingQueue(T, assessment);
  assert.doesNotMatch(JSON.stringify(queue), /Ada Lovelace/);
});

test('marking can override an objective question, but not above the maximum', async () => {
  const w = world();
  const { q, assessment } = await withPaper(w);
  const attempt = await w.assess.start(T, assessment, 'user-10');
  await w.assess.submit(T, attempt.id, 'user-10');

  // A marker can now override an auto-graded question -- a bad key, or
  // partial credit the key can't express -- the same as any other question.
  await w.assess.mark(T, attempt.id, 'user-20', {
    marks: [{ question_id: Number(q.single.id), points: 1 }],
  });
  const answers = await w.assess.attemptForMarker(T, attempt.id);
  const single = answers.questions.find((a) => a.question_id === Number(q.single.id));
  assert.equal(single?.manual_points, 1, 'the override was recorded');

  await assert.rejects(w.assess.mark(T, attempt.id, 'user-20', {
    marks: [{ question_id: Number(q.essay.id), points: 99 }],
  }), (e: HttpError) => e.status === 422);
  await assert.rejects(w.assess.mark(T, attempt.id, 'user-20', {
    marks: [{ question_id: 999_999, points: 1 }],
  }), (e: HttpError) => e.status === 422);
});

test('moderation beats a second mark, which beats the first', async () => {
  const w = world();
  const { q, assessment } = await withPaper(w);
  const attempt = await w.assess.start(T, assessment, 'user-10');
  await w.assess.saveAnswer(T, attempt.id, 'user-10',
    { question_id: Number(q.single.id), response: 'b' });
  await w.assess.submit(T, attempt.id, 'user-10');
  const essay = Number(q.essay.id);

  await w.assess.mark(T, attempt.id, 'user-20', { role: 'first', marks: [{ question_id: essay, points: 1 }] });
  let rows = w.db.tables.onyx_assessment_attempts as Record<string, unknown>[];
  assert.equal(Number(rows[0]!.score), 3, 'auto 2 + first mark 1');

  await w.assess.mark(T, attempt.id, 'user-21', { role: 'second', marks: [{ question_id: essay, points: 3 }] });
  rows = w.db.tables.onyx_assessment_attempts as Record<string, unknown>[];
  assert.equal(Number(rows[0]!.score), 5, 'the second mark should win over the first');

  await w.assess.mark(T, attempt.id, 'user-22', {
    role: 'moderation', marks: [{ question_id: essay, points: 4 }],
  });
  rows = w.db.tables.onyx_assessment_attempts as Record<string, unknown>[];
  assert.equal(Number(rows[0]!.score), 6, 'moderation should win over both');

  // Three separate records, which is the only way "the moderator changed it"
  // can be answered later.
  const grades = await w.assess.grades(T, attempt.id);
  assert.deepEqual(grades.map((g) => g.role).sort(), ['first', 'moderation', 'second']);
});

test('ASS-03b: results are invisible until published, and moderation is enforced', async () => {
  const w = world();
  const { q, assessment } = await withPaper(w, { moderation_required: true });
  const attempt = await w.assess.start(T, assessment, 'user-10');
  await w.assess.saveAnswer(T, attempt.id, 'user-10',
    { question_id: Number(q.single.id), response: 'b' });
  await w.assess.submit(T, attempt.id, 'user-10');
  await w.assess.mark(T, attempt.id, 'user-20', {
    role: 'first', marks: [{ question_id: Number(q.essay.id), points: 4 }],
  });

  // Marked, but the candidate is told nothing.
  const before = await w.assess.attemptForCandidate(T, attempt.id, 'user-10');
  assert.equal(before.score, null, 'a mark leaked before it was released');
  assert.equal((await w.assess.myAttempts(T, 'user-10'))[0]!.score, null);

  // A second opinion that can be skipped is not a moderation workflow.
  await assert.rejects(w.assess.publishResults(T, assessment), (e: HttpError) => e.status === 422);

  await w.assess.mark(T, attempt.id, 'user-22', {
    role: 'moderation', marks: [{ question_id: Number(q.essay.id), points: 4 }],
  });
  const published = await w.assess.publishResults(T, assessment);
  assert.equal(published.published, 1);

  const after = await w.assess.attemptForCandidate(T, attempt.id, 'user-10');
  assert.equal(Number(after.score), 6);
  assert.equal(after.pass_mark, 6);
  const mine = (await w.assess.myAttempts(T, 'user-10'))[0]!;
  assert.equal(Number(mine.score), 6);
  assert.equal(mine.passed, true);

  /*
   * And a released paper CAN be re-marked, which reverses what this test used
   * to assert.
   *
   * The old rule -- "changing a mark after release is an appeal, not an edit"
   * -- made sense while `published` meant a person had chosen to release. It
   * stopped making sense when auto-marked attempts began publishing themselves
   * at submit (migration 0035): refusing here would have made every
   * machine-marked paper in the product permanently uncorrectable the instant
   * it was handed in, with no way for a marker to fix a bad answer key.
   *
   * What must hold instead is that a correction CHANGES the result rather than
   * withdrawing it. `#recompute` used to force every attempt it touched back
   * to 'graded', which would have made the candidate's result disappear from
   * their screen at the moment somebody corrected it.
   */
  // Through the authoritative role, because this paper was moderated and
  // moderation outranks a first mark -- re-marking as 'first' here is accepted
  // and correctly changes nothing, which is its own small proof that the
  // precedence rule survived.
  await w.assess.mark(T, attempt.id, 'user-20', {
    role: 'first', marks: [{ question_id: Number(q.essay.id), points: 0 }],
  });
  assert.equal(Number((await w.assess.attemptForCandidate(T, attempt.id, 'user-10')).score), 6,
    'a first mark overrode the moderator');

  await w.assess.mark(T, attempt.id, 'user-22', {
    role: 'moderation', marks: [{ question_id: Number(q.essay.id), points: 0 }],
  });
  const corrected = await w.assess.attemptForCandidate(T, attempt.id, 'user-10');
  assert.notEqual(corrected.score, null, 'correcting a released mark hid it');
  assert.equal(Number(corrected.score), 2, 'the correction did not reach the candidate');
});

test('an assessment in another institution is not found', async () => {
  const w = world();
  const { assessment } = await withPaper(w);
  await assert.rejects(w.assess.assessment(OTHER, assessment), (e: HttpError) => e.status === 404);
  await assert.rejects(w.assess.start(OTHER, assessment, 'user-10'), (e: HttpError) => e.status === 404);
});

// ---------------------------------------------------------------------------
// ASS-02 -- proctoring
// ---------------------------------------------------------------------------

test('ASS-02a: every monitored event is recorded against the server clock', async () => {
  const c = clock();
  const w = world(c);
  const { assessment } = await withPaper(w, { proctoring: true });
  const attempt = await w.assess.start(T, assessment, 'user-10', { consent: true });

  c.advance(90_000);
  await w.proctor.record(T, attempt.id, 'user-10', {
    kind: 'tab_blur',
    // A client claiming a wildly different time is itself a signal.
    client_at: new Date(c.now() + 600_000).toISOString(),
  });

  const timeline = await w.proctor.timeline(T, attempt.id);
  assert.equal(timeline.events.length, 1);
  assert.equal(timeline.events[0]!.offset_seconds, 90);
  assert.equal(timeline.events[0]!.clock_skew_seconds, 600);
  assert.ok(timeline.consented_at, 'consent was not recorded');
});

test('an unknown event kind, another candidate, or a finished attempt are refused', async () => {
  const w = world();
  const { assessment } = await withPaper(w, { proctoring: true });
  const attempt = await w.assess.start(T, assessment, 'user-10', { consent: true });

  await assert.rejects(w.proctor.record(T, attempt.id, 'user-10', { kind: 'telepathy' }),
    (e: HttpError) => e.status === 422);
  await assert.rejects(w.proctor.record(T, attempt.id, 'user-11', { kind: 'paste' }),
    (e: HttpError) => e.status === 403);

  await w.assess.submit(T, attempt.id, 'user-10');
  // Accepting these would let a candidate pad their own log after the fact.
  await assert.rejects(w.proctor.record(T, attempt.id, 'user-10', { kind: 'paste' }),
    (e: HttpError) => e.status === 422);
});

test('monitoring stops at the deadline, not at whenever the sweep next runs', async () => {
  const c = clock();
  const w = world(c);
  const { assessment } = await withPaper(w, { proctoring: true, duration_minutes: 10 });
  const attempt = await w.assess.start(T, assessment, 'user-10', { consent: true });

  await w.proctor.record(T, attempt.id, 'user-10', { kind: 'tab_blur' });

  // An hour and a half past the end of a ten-minute paper, with nothing having
  // swept it. `status` is still 'in_progress' -- only the sweep moves it, and
  // the sweep is a scheduled job that may not be running in a given
  // environment -- so the status check alone let events keep landing. That is
  // how an integrity timeline came to show monitoring 89 minutes after a paper
  // that lasted ten.
  c.advance(90 * 60_000);

  await assert.rejects(w.proctor.record(T, attempt.id, 'user-10', { kind: 'paste' }),
    (e: HttpError) => e.status === 422 && e.message === 'That attempt is finished.');

  const timeline = await w.proctor.timeline(T, attempt.id);
  assert.equal(timeline.events.length, 1, 'an event was accepted after the deadline');
});

test('a hand-in after the deadline is an expiry, not a four-hour submission', async () => {
  const c = clock();
  const w = world(c);
  const { assessment } = await withPaper(w, { duration_minutes: 10 });
  const attempt = await w.assess.start(T, assessment, 'user-10');

  // The candidate closed the laptop and pressed Hand in hours later. Answers
  // were already refused past the deadline, so the score is unaffected -- but
  // recording this as 'submitted' stamped `submitted_at` at the moment of the
  // click, and every screen computing (submitted_at - started_at) then
  // reported hours of "time taken" on a ten-minute paper.
  c.advance(4 * 60 * 60_000);
  const done = await w.assess.submit(T, attempt.id, 'user-10');
  assert.equal(done.status, 'expired', 'a late hand-in was recorded as a submission');
});

test('flags are scored, and dismissing one lowers the score', async () => {
  const w = world();
  const { assessment } = await withPaper(w, { proctoring: true });
  const attempt = await w.assess.start(T, assessment, 'user-10', { consent: true });

  // 1 + 2 + 3 = 6, over the review threshold.
  await w.proctor.record(T, attempt.id, 'user-10', { kind: 'tab_blur' });
  await w.proctor.record(T, attempt.id, 'user-10', { kind: 'paste' });
  await w.proctor.record(T, attempt.id, 'user-10', { kind: 'multiple_faces' });

  let timeline = await w.proctor.timeline(T, attempt.id);
  assert.equal(timeline.integrity_flags, 6);
  assert.equal(timeline.integrity_status, 'review');
  assert.ok(6 >= REVIEW_THRESHOLD);

  // An informational event is recorded but does not accuse anybody.
  await w.proctor.record(T, attempt.id, 'user-10', { kind: 'tab_focus' });
  timeline = await w.proctor.timeline(T, attempt.id);
  assert.equal(timeline.integrity_flags, 6);
  assert.equal(EVENT_WEIGHTS.tab_focus, 0);

  const paste = timeline.events.find((e) => e.kind === 'paste')!;
  await w.proctor.review(T, paste.id, { tenant_id: T, user_id: 'user-20' },
    { decision: 'dismissed', note: 'pasted their own draft' });

  timeline = await w.proctor.timeline(T, attempt.id);
  assert.equal(timeline.integrity_flags, 4, 'dismissing a flag did not lower the score');
  assert.equal(timeline.integrity_status, 'flagged');
});

test('ASS-02b: an invigilator decision is audited and is not overwritten by arithmetic', async () => {
  const w = world();
  const { assessment } = await withPaper(w, { proctoring: true });
  const attempt = await w.assess.start(T, assessment, 'user-10', { consent: true });
  await w.proctor.record(T, attempt.id, 'user-10', { kind: 'multiple_faces' });

  await w.proctor.settle(T, attempt.id, { tenant_id: T, user_id: 'user-20' },
    { decision: 'cleared', note: 'their sibling walked past' });
  let timeline = await w.proctor.timeline(T, attempt.id);
  assert.equal(timeline.integrity_status, 'cleared');

  // More events afterwards must not silently undo a person's decision.
  await w.proctor.record(T, attempt.id, 'user-10', { kind: 'paste' });
  timeline = await w.proctor.timeline(T, attempt.id);
  assert.equal(timeline.integrity_status, 'cleared',
    'a human decision was overwritten by the flag score');

  const audit = w.db.tables.onyx_audit_logs as Record<string, unknown>[];
  assert.equal(audit.filter((a) => a.action === 'assessment.flag_reviewed').length, 1);
});

test('a decision that is neither dismiss nor uphold is refused', async () => {
  const w = world();
  const { assessment } = await withPaper(w, { proctoring: true });
  const attempt = await w.assess.start(T, assessment, 'user-10', { consent: true });
  await w.proctor.record(T, attempt.id, 'user-10', { kind: 'paste' });
  const [event] = (await w.proctor.timeline(T, attempt.id)).events;

  await assert.rejects(w.proctor.review(T, event!.id, { tenant_id: T, user_id: 'user-20' },
    { decision: 'maybe' as never }), (e: HttpError) => e.status === 422);
  await assert.rejects(w.proctor.settle(T, attempt.id, { tenant_id: T, user_id: 'user-20' },
    { decision: 'probably' as never }), (e: HttpError) => e.status === 422);
});

// ---------------------------------------------------------------------------
// ASS-04 -- statistics
// ---------------------------------------------------------------------------

test('ASS-04a: the discrimination index matches a hand calculation', () => {
  // Ten candidates. 27% of 10 is 2, so the top two and the bottom two.
  const scores = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1];
  // Both top scorers right, neither bottom scorer right: (2 - 0) / 2 = 1.
  assert.equal(discriminationIndex(scores,
    [true, true, false, false, false, false, false, false, false, false]), 1);
  // Reversed: (0 - 2) / 2 = -1, which means the key is wrong.
  assert.equal(discriminationIndex(scores,
    [false, false, false, false, false, false, false, false, true, true]), -1);
  // Everybody right: no separation at all.
  assert.equal(discriminationIndex(scores, scores.map(() => true)), 0);
  // One of the top two and one of the bottom two: (1 - 1) / 2 = 0.
  assert.equal(discriminationIndex(scores,
    [true, false, false, false, false, false, false, false, true, false]), 0);

  // Too few papers to split into groups at all.
  assert.equal(discriminationIndex([5, 4, 3], [true, false, false]), null);
});

test('ASS-04a: item statistics match a hand calculation on a seeded cohort', async () => {
  const w = world();
  const bank = await w.assess.createBank(T, ACTOR, { name: 'Stats' });
  const easy = await w.assess.addQuestion(T, Number(bank.id), ACTOR, {
    type: 'truefalse', prompt: 'Everyone gets this.', answer: 'true', points: 1,
  });
  const split = await w.assess.addQuestion(T, Number(bank.id), ACTOR, {
    type: 'truefalse', prompt: 'Half get this.', answer: 'true', points: 1,
  });
  const assessment = await w.assess.createAssessment(T, ACTOR, {
    title: 'Stats', shuffle_questions: false,
    sections: [{ id: 's', title: 'All', bank_id: Number(bank.id), take: 2 }],
  });
  const aid = Number(assessment.id);
  await w.assess.publishAssessment(T, aid);

  // Four candidates. All get `easy` right; the first two also get `split`.
  w.db.tables.onyx_enrollments = ['user-10', 'user-11', 'user-12', 'user-13'].map((user_id, i) => ({
    id: i + 1, tenant_id: T, course_id: 1, user_id, status: 1,
  }));
  for (const [i, user] of ['user-10', 'user-11', 'user-12', 'user-13'].entries()) {
    const a = await w.assess.start(T, aid, user);
    await w.assess.saveAnswer(T, a.id, user,
      { question_id: Number(easy.id), response: 'true' });
    await w.assess.saveAnswer(T, a.id, user,
      { question_id: Number(split.id), response: i < 2 ? 'true' : 'false' });
    await w.assess.submit(T, a.id, user);
  }

  const analysis = await w.analytics.itemAnalysis(T, aid);
  assert.equal(analysis.sat, 4);
  const easyStat = analysis.items.find((x) => x.question_id === Number(easy.id))!;
  const splitStat = analysis.items.find((x) => x.question_id === Number(split.id))!;

  assert.equal(easyStat.responses, 4);
  assert.equal(easyStat.correct, 4);
  assert.equal(easyStat.facility, 1);
  // Everybody right measured nobody.
  assert.equal(easyStat.uninformative, true);

  assert.equal(splitStat.correct, 2);
  assert.equal(splitStat.facility, 0.5);
  assert.equal(splitStat.uninformative, false);

  const report = await w.analytics.results(T, aid);
  assert.equal(report.cohort.sat, 4);
  // Two scored 2, two scored 1: mean 1.5, median 1.5.
  assert.equal(report.cohort.mean, 1.5);
  assert.equal(report.cohort.median, 1.5);
  assert.equal(report.cohort.highest, 2);
  assert.equal(report.cohort.lowest, 1);
  // Population sd of [2,2,1,1] is 0.5.
  assert.equal(report.cohort.stdev, 0.5);
});

test('ASS-04b: the CSV quotes what needs quoting and names candidates', async () => {
  const w = world();
  const { assessment } = await withPaper(w);
  const attempt = await w.assess.start(T, assessment, 'user-10');
  await w.assess.submit(T, attempt.id, 'user-10');
  await w.assess.mark(T, attempt.id, 'user-20', { marks: [] } as never).catch(() => {});

  const csv = await w.analytics.exportCsv(T, assessment, {
    names: new Map([['user-10', { name: 'Doe, Jane "JD"', email: 'jane@onyx.test' }]]),
  });
  const lines = csv.split('\r\n').filter(Boolean);
  assert.equal(lines[0], 'attempt_id,user_id,name,email,score,max_score,percent,passed,integrity_flags,integrity_status');
  // A comma and a quote in a name are the two things that break a naive export.
  assert.match(lines[1]!, /"Doe, Jane ""JD"""/);
  assert.match(lines[1]!, /jane@onyx\.test/);
});

test('an assessment nobody has sat produces empty statistics, not a crash', async () => {
  const w = world();
  const { assessment } = await withPaper(w);
  const report = await w.analytics.results(T, assessment);
  assert.equal(report.cohort.sat, 0);
  assert.equal(report.cohort.mean, 0);
  assert.deepEqual(await w.analytics.itemAnalysis(T, assessment), { sat: 0, items: [] });
  assert.equal((await w.analytics.exportCsv(T, assessment)).split('\r\n').filter(Boolean).length, 1);
});

// ---------------------------------------------------------------------------
// ASS-01 -- composing and correcting a paper
// ---------------------------------------------------------------------------

test('a draft paper can be recomposed; a published one cannot', async () => {
  const w = world();
  const { assessment, bank } = await withDraft(w);
  const actor = { userId: ACTOR, role: 'admin' as const };

  // While it is a draft, everything is fair game -- the whole point, since a
  // paper composed wrongly used to be unfixable and had to be abandoned.
  const edited = await w.assess.updateAssessment(T, assessment, actor, {
    instructions: 'Answer every question.',
    attempts_allowed: 3,
    anonymous_marking: false,
    moderation_required: true,
    shuffle_options: false,
    sections: [{ id: 's1', title: 'Everything', bank_id: bank, take: 3 }],
  });
  assert.equal(edited.assessment!.attempts_allowed, 3);
  assert.equal(edited.assessment!.anonymous_marking, 0);
  assert.equal(edited.assessment!.moderation_required, 1);
  assert.equal((edited.assessment!.sections as unknown as unknown[]).length, 1);

  await w.assess.publishAssessment(T, assessment, actor);

  // Published, the composition is frozen: an attempt may already be sitting
  // it, and two candidates sitting different papers under one title is a mark
  // that cannot be defended.
  await assert.rejects(
    w.assess.updateAssessment(T, assessment, actor, { attempts_allowed: 9 }),
    (e: HttpError) => e.status === 422 && /published/i.test(e.message));
  await assert.rejects(
    w.assess.updateAssessment(T, assessment, actor,
      { sections: [{ id: 's9', title: 'New', bank_id: bank, take: 1 }] }),
    (e: HttpError) => e.status === 422);

  // ...but the corrections an invigilator legitimately makes to a live paper
  // still work.
  const late = await w.assess.updateAssessment(T, assessment, actor,
    { title: 'Renamed', pass_mark: 4, duration_minutes: 90 });
  assert.equal(late.assessment!.title, 'Renamed');
  assert.equal(late.assessment!.duration_minutes, 90);
});

test('an edit cannot leave a paper drawing more than its bank holds', async () => {
  const w = world();
  const { assessment, bank } = await withDraft(w);
  // Checked at create; it was not checked on update, so a paper could be
  // edited into a state that fails at #dealPaper -- in front of the candidate,
  // at the moment they press Start.
  await assert.rejects(
    w.assess.updateAssessment(T, assessment, { userId: ACTOR, role: 'admin' },
      { sections: [{ id: 's1', title: 'Too many', bank_id: bank, take: 500 }] }),
    (e: HttpError) => e.status === 422 && /questions but its bank has/.test(e.message));
});

test('two sections cannot share an id', async () => {
  const w = world();
  const { assessment, bank } = await withDraft(w);
  // The id keys a dealt paper back to its section; duplicates would silently
  // merge them.
  await assert.rejects(
    w.assess.updateAssessment(T, assessment, { userId: ACTOR, role: 'admin' }, {
      sections: [{ id: 'a', title: 'One', bank_id: bank, take: 1 },
        { id: 'a', title: 'Two', bank_id: bank, take: 1 }],
    }),
    (e: HttpError) => e.status === 422 && /share the id/.test(e.message));
});

test('the window is checked against what is already stored, not just the patch', async () => {
  const w = world();
  const { assessment } = await withPaper(w);
  const actor = { userId: ACTOR, role: 'admin' as const };
  await w.assess.updateAssessment(T, assessment, actor,
    { opens_at: '2026-09-01T09:00:00.000Z', closes_at: '2026-09-02T09:00:00.000Z' });

  // Moving one half past the other in a second request used to pass, because
  // only the patch was compared and this patch has just one of the two.
  await assert.rejects(
    w.assess.updateAssessment(T, assessment, actor, { closes_at: '2026-08-01T09:00:00.000Z' }),
    (e: HttpError) => e.status === 422 && /closes before it opens/.test(e.message));
});

test('a status outside the vocabulary is refused, and so is publishing an empty paper', async () => {
  const w = world();
  const actor = { userId: ACTOR, role: 'admin' as const };
  const empty = await w.assess.createAssessment(T, actor,
    { title: 'Nothing in it', duration_minutes: 30 });

  await assert.rejects(
    w.assess.updateAssessment(T, Number(empty.id), actor, { status: 'live' as never }),
    (e: HttpError) => e.status === 422);

  // The edit form's status dropdown is the only way to publish an existing
  // draft from the UI, and it went straight to the column -- so a paper with
  // no sections could be published this way, bypassing publishAssessment's
  // only guard. The candidate would have found out at Start.
  await assert.rejects(
    w.assess.updateAssessment(T, Number(empty.id), actor, { status: 'published' }),
    (e: HttpError) => e.status === 422 && /at least one section/.test(e.message));
});

test('publishing is held to the same course check as every other authoring act', async () => {
  const w = world();
  const { assessment } = await withDraft(w);
  // Course 1's faculty is user-20; this one teaches nothing. Publishing was
  // the single authoring act that took no actor, so any faculty account could
  // publish any paper in the institution.
  await assert.rejects(
    w.assess.publishAssessment(T, assessment, { userId: 'user-77', role: 'faculty' }),
    (e: HttpError) => e.status === 403);
  const ok = await w.assess.publishAssessment(T, assessment, { userId: 'user-20', role: 'faculty' });
  assert.equal(ok.status, 'published');
});

test('a paper can be previewed without sitting it', async () => {
  const w = world();
  const { assessment } = await withPaper(w);
  const actor = { userId: ACTOR, role: 'admin' as const };
  await w.assess.publishAssessment(T, assessment, actor);

  const preview = await w.assess.previewPaper(T, assessment, actor);
  assert.equal(preview.questions.length, 5);
  assert.ok(preview.total_points > 0);
  // No answer key -- this is exactly a candidate's view, which is the question
  // being asked.
  assert.doesNotMatch(JSON.stringify(preview), /"answer"/);
  // And nothing was recorded: previewing must not consume an attempt, which is
  // the whole reason authors never checked a one-attempt paper.
  assert.equal((w.db.tables.onyx_assessment_attempts as unknown[]).length, 0);
});

// ---------------------------------------------------------------------------
// ASS-01 -- code questions
// ---------------------------------------------------------------------------

/** A stand-in for Code Lab, so the engine can be tested without a sandbox. */
function fakeGrader(over: Record<string, unknown> = {}) {
  const calls: { submitted: number; graded: number[] } = { submitted: 0, graded: [] };
  return {
    calls,
    submit: async () => { calls.submitted += 1; return { id: 900 + calls.submitted }; },
    gradeNow: async (_t: number, id: number) => { calls.graded.push(id); },
    scoreOf: async () => ({ status: 'done', score: 3, max_score: 4, ...over }),
  };
}

/** A published problem with a test case, so a code question has something markable. */
function aProblem(w: ReturnType<typeof world>, over: Record<string, unknown> = {}) {
  const problems = w.db.tables.onyx_problems as Record<string, unknown>[];
  const id = problems.length + 1;
  problems.push({ id, tenant_id: T, title: 'Sum two numbers', slug: 's' + id,
    statement: 'Add them.', languages: ['python'], starter_code: {}, time_limit_ms: 2000,
    status: 'published', created_by: 'user-20', ...over });
  (w.db.tables.onyx_problem_tests as Record<string, unknown>[]).push(
    { id, tenant_id: T, problem_id: id, name: 'v', expected_stdout: '5', is_hidden: false, weight: 1 });
  return id;
}

test('a code question needs a published problem that has tests', async () => {
  const w = world();
  const bank = Number((await w.assess.createBank(T, ACTOR, { name: 'Code bank' })).id);

  await assert.rejects(
    w.assess.addQuestion(T, bank, ACTOR, { type: 'code', prompt: 'Write it', points: 10 }),
    (e: HttpError) => e.status === 422 && /needs a problem/.test(e.message));

  await assert.rejects(
    w.assess.addQuestion(T, bank, ACTOR,
      { type: 'code', prompt: 'Write it', points: 10, problem_id: 9999 }),
    (e: HttpError) => e.status === 422 && /does not exist/.test(e.message));

  // A draft problem cannot mark anything, and neither can one with no cases --
  // both are caught here rather than at deal time, in front of a candidate.
  const draft = aProblem(w, { status: 'draft' });
  await assert.rejects(
    w.assess.addQuestion(T, bank, ACTOR,
      { type: 'code', prompt: 'Write it', points: 10, problem_id: draft }),
    (e: HttpError) => e.status === 422 && /still a draft/.test(e.message));

  const good = aProblem(w);
  const q = await w.assess.addQuestion(T, bank, ACTOR,
    { type: 'code', prompt: 'Write it', points: 10, problem_id: good });
  assert.equal(q.type, 'code');
  assert.equal(Number(q.problem_id), good);
});

test('a sat code question carries the problem, and never its tests', async () => {
  const w = world();
  const bank = Number((await w.assess.createBank(T, ACTOR, { name: 'Code bank' })).id);
  const problem = aProblem(w);
  await w.assess.addQuestion(T, bank, ACTOR,
    { type: 'code', prompt: 'Write it', points: 10, problem_id: problem });
  const paper = await w.assess.createAssessment(T, ACTOR, {
    title: 'Coding test', course_id: 1, duration_minutes: 60,
    sections: [{ id: 's1', title: 'Code', bank_id: bank, take: 1 }],
  });
  await w.assess.publishAssessment(T, Number(paper.id));

  const attempt = await w.assess.start(T, Number(paper.id), 'user-10');
  const q = attempt.questions[0]!;
  assert.equal(q.type, 'code');
  assert.equal(q.problem!.statement, 'Add them.');
  assert.deepEqual(q.problem!.languages, ['python']);
  // Hidden cases are the entire value of an auto-graded coding question, and
  // the attempt row is readable by the candidate.
  assert.doesNotMatch(JSON.stringify(attempt), /expected_stdout/);
  assert.doesNotMatch(JSON.stringify(attempt), /"tests"/);
});

test('code is marked by running the problem, scaled to the question’s marks', async () => {
  const grader = fakeGrader();
  const w = world();
  const withCode = new (Object.getPrototypeOf(w.assess).constructor)(
    w.db, new AcademicsService(w.db as never), w.clock.now, grader);

  const bank = Number((await withCode.createBank(T, ACTOR, { name: 'Code bank' })).id);
  const problem = aProblem(w);
  await withCode.addQuestion(T, bank, ACTOR,
    { type: 'code', prompt: 'Write it', points: 10, problem_id: problem });
  const paper = await withCode.createAssessment(T, ACTOR, {
    title: 'Coding test', course_id: 1, duration_minutes: 60,
    sections: [{ id: 's1', title: 'Code', bank_id: bank, take: 1 }],
  });
  await withCode.publishAssessment(T, Number(paper.id));

  const attempt = await withCode.start(T, Number(paper.id), 'user-10');
  await withCode.saveAnswer(T, attempt.id, 'user-10', {
    question_id: attempt.questions[0]!.question_id,
    response: { language: 'python', source: 'print(5)' },
  });
  assert.equal(grader.calls.submitted, 1, 'the answer was not sent to the sandbox');

  const done = await withCode.submit(T, attempt.id, 'user-10');
  assert.equal(grader.calls.graded.length, 1, 'the submission was not graded at hand-in');
  // 3 of 4 tests, on a question worth 10 marks.
  assert.equal(done.max_score, 10);
  const marked = await withCode.attemptForMarker(T, attempt.id);
  assert.equal(marked.auto_score, 7.5);
});

test('with no sandbox wired, a code answer waits for a person rather than scoring zero', async () => {
  const w = world();   // no grader injected
  const bank = Number((await w.assess.createBank(T, ACTOR, { name: 'Code bank' })).id);
  const problem = aProblem(w);
  await w.assess.addQuestion(T, bank, ACTOR,
    { type: 'code', prompt: 'Write it', points: 10, problem_id: problem });
  const paper = await w.assess.createAssessment(T, ACTOR, {
    title: 'Coding test', course_id: 1, duration_minutes: 60,
    sections: [{ id: 's1', title: 'Code', bank_id: bank, take: 1 }],
  });
  await w.assess.publishAssessment(T, Number(paper.id));

  const attempt = await w.assess.start(T, Number(paper.id), 'user-10');
  await w.assess.saveAnswer(T, attempt.id, 'user-10', {
    question_id: attempt.questions[0]!.question_id,
    response: { language: 'python', source: 'print(5)' },
  });
  const done = await w.assess.submit(T, attempt.id, 'user-10');
  // Marking it zero because the institution has no sandbox would be a wrong
  // mark, not a missing one.
  assert.equal(done.score, null, 'an ungradable code answer was scored instead of queued');
});

test('a code answer the sandbox cannot run is refused, not silently marked zero', async () => {
  /*
   * Found against the deployed site. A client that sent the candidate's
   * program as a bare string -- reasonable-looking, and what every other
   * question type takes -- had it written to the answer row with no
   * submission behind it and was told "saved". It was: as a blob nothing
   * could run. The paper then went to a marker with that question at zero and
   * nothing anywhere saying why, so a candidate who had answered correctly
   * lost ten marks unless a human noticed.
   *
   * Refusing costs nothing: the attempt is not spent, the clock is unchanged,
   * and the client can send the same work in the shape the sandbox runs.
   */
  const grader = fakeGrader();
  const w = world();
  const withCode = new (Object.getPrototypeOf(w.assess).constructor)(
    w.db, new AcademicsService(w.db as never), w.clock.now, grader);

  const bank = Number((await withCode.createBank(T, ACTOR, { name: 'Code bank' })).id);
  // Two languages, so a bare string names nothing: picking one for the
  // candidate would compile Python as C++ and score the same honest zero.
  const problem = aProblem(w, { languages: ['python', 'cpp'] });
  await withCode.addQuestion(T, bank, ACTOR,
    { type: 'code', prompt: 'Write it', points: 10, problem_id: problem });
  const paper = await withCode.createAssessment(T, ACTOR, {
    title: 'Coding test', course_id: 1, duration_minutes: 60,
    sections: [{ id: 's1', title: 'Code', bank_id: bank, take: 1 }],
  });
  await withCode.publishAssessment(T, Number(paper.id));

  const attempt = await withCode.start(T, Number(paper.id), 'user-10');
  const questionId = attempt.questions[0]!.question_id;

  await assert.rejects(
    withCode.saveAnswer(T, attempt.id, 'user-10', { question_id: questionId, response: 'print(5)' }),
    (e: HttpError) => e.status === 422 && /code submission/i.test(e.message));
  assert.equal(grader.calls.submitted, 0, 'an unrunnable answer reached the sandbox');

  // Nothing was written, so the candidate has lost nothing by being refused.
  const stored = w.db.tables.onyx_assessment_answers
    .filter((a: Record<string, unknown>) => Number(a.attempt_id) === Number(attempt.id));
  assert.equal(stored.length, 0, 'the unrunnable answer was stored anyway');

  // The shape the sitting screen sends has always worked and still does.
  await withCode.saveAnswer(T, attempt.id, 'user-10', {
    question_id: questionId, response: { language: 'python', source: 'print(5)' },
  });
  assert.equal(grader.calls.submitted, 1);
});

test('where a problem allows one language, the program alone is enough', async () => {
  // Generous where it can be: there is nothing to guess at when the problem
  // accepts exactly one language, so a client that sends only the source is
  // taken at its word rather than refused on a technicality.
  const grader = fakeGrader();
  const w = world();
  const withCode = new (Object.getPrototypeOf(w.assess).constructor)(
    w.db, new AcademicsService(w.db as never), w.clock.now, grader);

  const bank = Number((await withCode.createBank(T, ACTOR, { name: 'Code bank' })).id);
  const problem = aProblem(w);                    // python only
  await withCode.addQuestion(T, bank, ACTOR,
    { type: 'code', prompt: 'Write it', points: 10, problem_id: problem });
  const paper = await withCode.createAssessment(T, ACTOR, {
    title: 'Coding test', course_id: 1, duration_minutes: 60,
    sections: [{ id: 's1', title: 'Code', bank_id: bank, take: 1 }],
  });
  await withCode.publishAssessment(T, Number(paper.id));

  const attempt = await withCode.start(T, Number(paper.id), 'user-10');
  await withCode.saveAnswer(T, attempt.id, 'user-10', {
    question_id: attempt.questions[0]!.question_id, response: 'print(5)',
  });
  assert.equal(grader.calls.submitted, 1, 'a single-language problem refused its own language');
});
