/**
 * A score handed back at the moment the paper is handed in.
 *
 * The complaint that produced this was that results "are not updating". They
 * were not: a learner who finished a five-question quiz made entirely of
 * multiple-choice questions was told "results will appear once they are
 * published" about a mark that had already been calculated, correctly and
 * finally, milliseconds earlier. `#finalise` auto-marks every objective
 * question at submit and writes the total to `score`. Nothing was missing
 * except somebody pressing a button.
 *
 * So `instant_results` releases that attempt straight away — and the tests
 * that matter here are the ones where it must NOT, because the reasons a mark
 * is withheld are real and this switch does not overrule any of them:
 *
 *   * a paper with an essay on it has no final mark yet, whatever the switch
 *     says. `#finalise` leaves `score` null and a null score is nothing to
 *     show;
 *   * a paper that requires moderation is one whose marks are by definition
 *     not final until a second marker has seen them;
 *   * a paper that never asked for this behaves exactly as it did before,
 *     which is what makes the column safe to add to a database full of papers
 *     people have already sat.
 *
 * And one property that is easy to lose: releasing an ATTEMPT is not
 * releasing the PAPER. `results_published_at` closes marking for everybody at
 * once and cannot be undone; one candidate finishing early must never trigger
 * it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeDb } from './fake-db.ts';
import { AcademicsService } from '../src/onyx/academics.service.ts';
import { AssessService } from '../src/onyx/assess.service.ts';
import { HttpError } from '../src/http/errors.ts';

const T = 1;
const START = 1_800_000_000_000;
const ACTOR = { userId: 'user-20', role: 'exams' as const };
const LEARNER = 'user-10';

function clock(at = START) {
  let t = at;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
}

function world(c = clock()) {
  const db = new FakeDb({
    onyx_courses: [
      { id: 1, tenant_id: T, code: 'CS101', title: 'Programming', slug: 'p', status: 1 },
    ],
    onyx_course_faculty: [{ id: 1, tenant_id: T, course_id: 1, user_id: 'user-20' }],
    onyx_enrollments: [
      { id: 1, tenant_id: T, course_id: 1, user_id: LEARNER, status: 1 },
    ],
    onyx_question_banks: [],
    onyx_questions: [],
    onyx_question_versions: [],
    onyx_assessments: [],
    onyx_assessment_attempts: [],
    onyx_assessment_answers: [],
    onyx_assessment_grades: [],
    onyx_proctor_events: [],
    onyx_audit_logs: [],
    onyx_users: [
      { id: 'user-20', email: 'exams@onyx.test', name: 'Exams' },
      { id: LEARNER, email: 'lea@onyx.test', name: 'Lea Learner' },
    ],
  });
  const academics = new AcademicsService(db as never);
  return { db, clock: c, assess: new AssessService(db as never, academics, c.now) };
}

/**
 * A paper of only auto-markable questions -- the case the feature is for.
 *
 * Two single-answer questions worth two marks each. Nothing here needs a
 * human, so the mark at submit is the final mark.
 */
async function objectivePaper(w: ReturnType<typeof world>, over: Record<string, unknown> = {}) {
  const bank = await w.assess.createBank(T, ACTOR, { name: 'Objective bank' });
  const bid = Number(bank.id);
  for (const n of [1, 2]) {
    await w.assess.addQuestion(T, bid, ACTOR, {
      type: 'single', prompt: 'Q' + n, points: 2,
      options: [{ id: 'a', text: 'wrong' }, { id: 'b', text: 'right' }], answer: 'b',
    });
  }
  const a = await w.assess.createAssessment(T, ACTOR, {
    title: 'Quiz', course_id: 1, duration_minutes: 30, pass_mark: 2,
    sections: [{ id: 's1', title: 'All', bank_id: bid, take: 2 }],
    ...over,
  });
  await w.assess.publishAssessment(T, Number(a.id));
  return Number(a.id);
}

/** The same paper with an essay on the end: a mark a person still has to give. */
async function paperWithEssay(w: ReturnType<typeof world>, over: Record<string, unknown> = {}) {
  const bank = await w.assess.createBank(T, ACTOR, { name: 'Mixed bank' });
  const bid = Number(bank.id);
  await w.assess.addQuestion(T, bid, ACTOR, {
    type: 'single', prompt: 'Q1', points: 2,
    options: [{ id: 'a', text: 'wrong' }, { id: 'b', text: 'right' }], answer: 'b',
  });
  await w.assess.addQuestion(T, bid, ACTOR, {
    type: 'essay', prompt: 'Explain induction.', points: 4,
  });
  const a = await w.assess.createAssessment(T, ACTOR, {
    title: 'Mixed paper', course_id: 1, duration_minutes: 30,
    sections: [{ id: 's1', title: 'All', bank_id: bid, take: 2 }],
    ...over,
  });
  await w.assess.publishAssessment(T, Number(a.id));
  return Number(a.id);
}

/** Sits the paper, answering every question correctly, and hands it in. */
async function sitAndSubmit(w: ReturnType<typeof world>, assessmentId: number) {
  const attempt = await w.assess.start(T, assessmentId, LEARNER, { consent: true });
  for (const q of attempt.questions) {
    if (q.type === 'single') {
      await w.assess.saveAnswer(T, Number(attempt.id), LEARNER, {
        question_id: q.question_id, response: 'b',
      });
    }
  }
  await w.assess.submit(T, Number(attempt.id), LEARNER);
  return Number(attempt.id);
}

// ------------------------------------------------------------- the yes

test('a paper that marks itself hands the score back at once', async () => {
  const w = world();
  const id = await objectivePaper(w, { instant_results: true });
  const attemptId = await sitAndSubmit(w, id);

  const seen = await w.assess.attemptForCandidate(T, attemptId, LEARNER);
  assert.equal(Number(seen.score), 4, 'the candidate cannot see the mark they earned');
  assert.equal(seen.pass_mark, 2);

  // And on the screen that lists their papers, which is where the complaint
  // came from.
  const mine = await w.assess.myAttempts(T, LEARNER);
  assert.equal(mine.length, 1);
  assert.equal(mine[0]!.results_published, true);
  assert.equal(Number(mine[0]!.score), 4);
  assert.equal(mine[0]!.passed, true);
});

test('the per-question marks come with it', async () => {
  // A total says "12 out of 20". The breakdown says which ones went wrong,
  // which is the only part anybody can learn from -- and it was being computed
  // and served all along with nothing rendering it.
  const w = world();
  const id = await objectivePaper(w, { instant_results: true });
  const attemptId = await sitAndSubmit(w, id);

  const seen = await w.assess.attemptForCandidate(T, attemptId, LEARNER);
  assert.equal(seen.questions.length, 2);
  for (const q of seen.questions) {
    assert.equal(Number(q.awarded), 2, 'a question the candidate got right shows no marks');
  }
});

test('releasing one attempt does not release the paper', async () => {
  // `results_published_at` closes marking for good, for everybody. One
  // candidate finishing early must never do that to a paper other people are
  // still sitting.
  const w = world();
  const id = await objectivePaper(w, { instant_results: true });
  await sitAndSubmit(w, id);

  const paper = await w.assess.assessment(T, id);
  assert.equal(paper.results_published_at ?? null, null,
    'one submission released the whole paper');
  assert.equal(paper.status, 'published', 'the paper was closed by a submission');
});

// -------------------------------------------------------------- the no

test('an essay on the paper holds the mark back, switch or no switch', async () => {
  // The switch cannot conjure a mark that does not exist yet: #finalise leaves
  // `score` null while anything awaits a person.
  const w = world();
  const id = await paperWithEssay(w, { instant_results: true });
  const attemptId = await sitAndSubmit(w, id);

  const seen = await w.assess.attemptForCandidate(T, attemptId, LEARNER);
  assert.equal(seen.score, null, 'an unmarked essay was reported as a final score');

  const mine = await w.assess.myAttempts(T, LEARNER);
  assert.equal(mine[0]!.results_published, false);
});

test('a paper that must be moderated is never instant', async () => {
  // Moderation exists to put a second marker between a mark and the candidate.
  // A paper that asks for it is a paper whose marks are not final at submit,
  // however objective the questions happen to be.
  const w = world();
  const id = await objectivePaper(w, { instant_results: true, moderation_required: true });
  const attemptId = await sitAndSubmit(w, id);

  const seen = await w.assess.attemptForCandidate(T, attemptId, LEARNER);
  assert.equal(seen.score, null, 'a moderated paper released its mark at submit');
});

test('a paper that says nothing gets its marks back anyway', async () => {
  // The default, since 0035. Handing marks back is what happens unless a
  // paper-setter deliberately decides otherwise, which is the whole point of
  // the change: nobody has to remember to switch anything on.
  const w = world();
  const id = await objectivePaper(w);              // no instant_results given
  const attemptId = await sitAndSubmit(w, id);

  const seen = await w.assess.attemptForCandidate(T, attemptId, LEARNER);
  assert.equal(Number(seen.score), 4);
});

test('a paper that deliberately turns it off still waits for a marker', async () => {
  // The escape hatch has to keep working, or "on by default" becomes "on,
  // always" -- and a paper whose window is still open is exactly where an
  // institution might not want the first candidate handing the answers round.
  const w = world();
  const id = await objectivePaper(w, { instant_results: false });
  const attemptId = await sitAndSubmit(w, id);

  const seen = await w.assess.attemptForCandidate(T, attemptId, LEARNER);
  assert.equal(seen.score, null);

  const mine = await w.assess.myAttempts(T, LEARNER);
  assert.equal(mine[0]!.results_published, false);
});

test('running out of time still marks what was answered', async () => {
  // An expired attempt is finalised the same way a submitted one is, so a
  // candidate who ran out of time on an instant paper gets the marks they
  // earned rather than silence.
  const c = clock();
  const w = world(c);
  const id = await objectivePaper(w, { instant_results: true });
  const attempt = await w.assess.start(T, id, LEARNER, { consent: true });
  await w.assess.saveAnswer(T, Number(attempt.id), LEARNER, {
    question_id: attempt.questions[0]!.question_id, response: 'b',
  });

  c.advance(31 * 60_000);                          // past the 30-minute limit
  await w.assess.submit(T, Number(attempt.id), LEARNER);

  const seen = await w.assess.attemptForCandidate(T, Number(attempt.id), LEARNER);
  assert.equal(Number(seen.score), 2, 'the one right answer earned nothing');
});

// --------------------------------------------------------- the release rule

test('the release rule is one rule, and it says no by default', () => {
  // There were three copies of this condition -- the learner's list, the
  // learner's attempt, and the guardian view -- and three copies of a rule
  // about whose marks are visible is two copies too many.
  const R = AssessService.releasedToCandidate;

  // Published attempt, released paper: the ordinary case.
  assert.equal(R({ status: 'published' }, { results_published_at: '2026-08-23' }), true);
  // Published attempt on an instant paper: the new case.
  assert.equal(R({ status: 'published' }, { instant_results: true }), true);

  // An attempt that was never published is not visible however the paper is
  // configured. This is what stops `instant_results` from retrospectively
  // exposing every attempt ever made on a paper somebody switches it on for.
  assert.equal(R({ status: 'submitted' }, { instant_results: true }), false);
  assert.equal(R({ status: 'submitted' }, { results_published_at: '2026-08-23' }), false);
  assert.equal(R({ status: 'in_progress' }, { instant_results: true }), false);

  // Nothing on either side.
  assert.equal(R({ status: 'published' }, {}), false);
  assert.equal(R({ status: 'published' }, null), false);
  assert.equal(R({}, { instant_results: true }), false);
});

test('the switch is frozen once candidates can reach the paper', async () => {
  // It lives with the rest of a published paper's settings: what somebody is
  // promised when they sit a paper does not change under the people who have
  // already sat it.
  const w = world();
  const id = await objectivePaper(w, { instant_results: false });

  await assert.rejects(
    w.assess.updateAssessment(T, id, ACTOR, { instant_results: true }),
    (e: HttpError) => e.status === 422 && /published/i.test(e.message));
});

test('turning it on in the database does not release what is already sat', async () => {
  /*
   * What migration 0035 does to a live database, and the line it stops at.
   *
   * Switching the column on -- by migration or by hand -- must not by itself
   * make an old attempt visible. Releasing those is a separate, deliberate act
   * (0035 does it in its own statement, narrowly, and says so). Without this
   * property, flipping a flag on a paper would retrospectively publish every
   * attempt ever made on it.
   */
  const w = world();
  const id = await objectivePaper(w, { instant_results: false });
  await sitAndSubmit(w, id);

  const paper = w.db.tables.onyx_assessments.find((a) => Number(a.id) === id)!;
  paper.instant_results = true;

  const mine = await w.assess.myAttempts(T, LEARNER);
  assert.equal(mine[0]!.results_published, false,
    'flipping the column released a mark nobody released');
  assert.equal(mine[0]!.score, null);
});

test('a marker correcting a released mark changes it rather than hiding it', async () => {
  /*
   * The failure this exists for is worse than a wrong number.
   *
   * `#recompute` used to set every attempt it touched to 'graded', which was
   * harmless while nothing was published until a person published it. Now an
   * auto-marked attempt is published at submit -- so a marker awarding a mark
   * on a question the machine got wrong would have moved the attempt OUT of
   * 'published', and the candidate's result would have vanished from their
   * screen at the exact moment somebody improved it.
   */
  const w = world();
  const id = await objectivePaper(w);
  const attemptId = await sitAndSubmit(w, id);

  const before = await w.assess.attemptForCandidate(T, attemptId, LEARNER);
  assert.equal(Number(before.score), 4);

  // A marker decides one question was worth less than the key said.
  const paper = await w.assess.attemptForMarker(T, attemptId);
  await w.assess.mark(T, attemptId, 'user-20', {
    role: 'first',
    marks: [{ question_id: paper.questions[0]!.question_id, points: 1 }],
  });

  const after = await w.assess.attemptForCandidate(T, attemptId, LEARNER);
  assert.notEqual(after.score, null, 'correcting a mark hid the result');
  assert.equal(Number(after.score), 3, 'the candidate is still seeing the old figure');
});

test('a candidate still cannot read somebody else\'s attempt', async () => {
  const w = world();
  const id = await objectivePaper(w, { instant_results: true });
  const attemptId = await sitAndSubmit(w, id);

  await assert.rejects(
    w.assess.attemptForCandidate(T, attemptId, 'user-11'),
    (e: HttpError) => e.status === 403 || e.status === 404);
});

// ------------------------------------------------------- the review screen

test('the candidate gets back what they actually answered', async () => {
  // The review screen every LMS has, and the data for it was already being
  // served -- `response` has been in this payload since the paper was first
  // sat, with nothing rendering it.
  const w = world();
  const id = await objectivePaper(w, { instant_results: true });
  const attemptId = await sitAndSubmit(w, id);

  const seen = await w.assess.attemptForCandidate(T, attemptId, LEARNER);
  for (const q of seen.questions) {
    assert.equal(q.response, 'b', 'the candidate cannot see what they put');
    assert.equal(q.correct, true, 'a right answer was not marked right');
  }
});

test('a wrong answer is returned as wrong, not merely as zero', async () => {
  // Zero marks and "incorrect" are the same fact for an objective question and
  // different facts for an essay, which is why `correct` exists separately
  // from `awarded`.
  const w = world();
  const id = await objectivePaper(w, { instant_results: true });
  const attempt = await w.assess.start(T, id, LEARNER, { consent: true });
  for (const q of attempt.questions) {
    await w.assess.saveAnswer(T, Number(attempt.id), LEARNER,
      { question_id: q.question_id, response: 'a' });
  }
  await w.assess.submit(T, Number(attempt.id), LEARNER);

  const seen = await w.assess.attemptForCandidate(T, Number(attempt.id), LEARNER);
  assert.equal(Number(seen.score), 0);
  for (const q of seen.questions) {
    assert.equal(q.correct, false);
    assert.equal(q.response, 'a');
  }
});

test('an essay is never called right or wrong', async () => {
  // There is no key to be right against. Saying "incorrect" about an unmarked
  // essay would be inventing a verdict nobody reached.
  const w = world();
  const id = await paperWithEssay(w);
  const attemptId = await sitAndSubmit(w, id);

  const seen = await w.assess.attemptForCandidate(T, attemptId, LEARNER);
  const essay = seen.questions.find((q) => q.type === 'essay')!;
  assert.equal(essay.correct, null);
});

test('the answer key waits until there is no sitting left to spoil', async () => {
  /*
   * The paper allows two attempts. Handing over the key after the first would
   * make the second meaningless -- and because banks are shared between
   * papers, it would leak into every other paper drawn from the same bank.
   */
  const w = world();
  const id = await objectivePaper(w, { instant_results: true, attempts_allowed: 2 });
  const first = await sitAndSubmit(w, id);

  const afterOne = await w.assess.attemptForCandidate(T, first, LEARNER);
  assert.equal(afterOne.questions[0]!.expected, null,
    'the key was handed over with a sitting still to go');
  // The mark itself is not withheld -- only the answers.
  assert.equal(Number(afterOne.score), 4);

  const second = await sitAndSubmit(w, id);
  const afterTwo = await w.assess.attemptForCandidate(T, second, LEARNER);
  assert.equal(afterTwo.questions[0]!.expected, 'b',
    'the key is still withheld with no attempts remaining');

  // And the earlier attempt now shows it too: the reason for withholding was
  // the sitting that was still to come, and it has been taken.
  const firstAgain = await w.assess.attemptForCandidate(T, first, LEARNER);
  assert.equal(firstAgain.questions[0]!.expected, 'b');
});

test('nothing about the marking leaks before the result is out', async () => {
  // A paper that holds its results holds the verdict and the key with them --
  // otherwise "correct" would give the answer away by itself.
  const w = world();
  const id = await objectivePaper(w, { instant_results: false });
  const attemptId = await sitAndSubmit(w, id);

  const seen = await w.assess.attemptForCandidate(T, attemptId, LEARNER);
  assert.equal(seen.score, null);
  for (const q of seen.questions) {
    assert.equal(q.correct, null, 'a verdict leaked before the result');
    assert.equal(q.expected, null, 'the key leaked before the result');
    assert.equal(q.awarded, null);
    // Their own answer is still theirs, and is shown.
    assert.equal(q.response, 'b');
  }
});

test('the marker\'s comment reaches the candidate with the marks', async () => {
  /*
   * It never had. `marker_comment` has been written per question by the
   * marking form for as long as marking has existed and served by nothing, so
   * a marker explaining why an essay lost four marks was writing into the
   * void. It is the one part of a result somebody can learn from, and it was
   * the part being withheld.
   */
  const w = world();
  const id = await paperWithEssay(w);
  const attemptId = await sitAndSubmit(w, id);

  const paper = await w.assess.attemptForMarker(T, attemptId);
  const essayId = paper.questions.find((q) => q.type === 'essay')!.question_id;
  await w.assess.mark(T, attemptId, 'user-20', {
    role: 'first',
    marks: [{ question_id: essayId, points: 3, comment: 'Say more about the base case.' }],
  });
  // A paper with an essay on it is released by a person, not by submit -- so
  // the comment is read at the point the mark itself becomes readable.
  await w.assess.publishResults(T, id);

  const seen = await w.assess.attemptForCandidate(T, attemptId, LEARNER);
  const essay = seen.questions.find((q) => q.type === 'essay')!;
  assert.equal(essay.comment, 'Say more about the base case.',
    'the marker wrote to nobody');
  // And a question nobody wrote on says nothing rather than an empty string,
  // so the screen can decide by presence.
  const objective = seen.questions.find((q) => q.type === 'single')!;
  assert.equal(objective.comment, null);
});

test('a comment is a mark in prose, and travels with the marks', async () => {
  /*
   * A marker's note is gated on exactly what the score is gated on, and always
   * has been. What changed is when that is: marking now releases the script
   * rather than waiting for somebody to publish the paper, so the note is
   * released with it.
   *
   * Both halves are checked, because the pairing is the point. A note visible
   * before a mark would tell a candidate their score early, in prose; a mark
   * visible without its note would withhold the one part of a result somebody
   * can learn from.
   */
  const w = world();
  const id = await paperWithEssay(w, { moderation_required: true });
  const attemptId = await sitAndSubmit(w, id);

  // Nobody has marked it: no score, and no note either.
  const before = await w.assess.attemptForCandidate(T, attemptId, LEARNER);
  assert.equal(before.score, null, 'a score appeared before anybody marked it');
  for (const q of before.questions) {
    assert.equal(q.comment, null, 'a marker comment appeared before any marking');
  }

  const paper = await w.assess.attemptForMarker(T, attemptId);
  const essayId = paper.questions.find((q) => q.type === 'essay')!.question_id;
  await w.assess.mark(T, attemptId, 'user-20', {
    role: 'first',
    marks: [{ question_id: essayId, points: 3, comment: 'Read the second half again.' }],
  });

  const seen = await w.assess.attemptForCandidate(T, attemptId, LEARNER);
  assert.notEqual(seen.score, null, 'a marked script did not reach its candidate');
  const essay = seen.questions.find((q) => q.question_id === essayId)!;
  assert.equal(essay.comment, 'Read the second half again.',
    'the mark was released without the note that explains it');
});
