/**
 * Onyx O13 unit tests -- leaving the examination, and the way back.
 *
 * The rule an institution asked for, in one sentence: a candidate who switches
 * away from the paper is warned, twice, in words on their own screen, and the
 * third time the paper is handed in for them.
 *
 * The half that makes it defensible is the other one. A counter cannot tell
 * somebody checking their email from somebody whose screen reader stole focus,
 * so an invigilator must be able to look, disagree, and put them back -- with
 * the answers they had written and the minutes they had left, not a fresh
 * attempt and not a fresh clock.
 *
 * What is tested here is what would fail quietly:
 *
 *   * the count is the SERVER's, so a refresh does not reset it;
 *   * the third departure ends the paper and the first two do not;
 *   * a stopped paper is scored for staff and shown to nobody, because handing
 *     the mark to a candidate who may be about to carry on gives away the
 *     marking of a paper they are still sitting;
 *   * reinstating restores the minutes that were LEFT, however long the
 *     decision took -- which is the whole reason `remaining_ms` is written
 *     down rather than recomputed;
 *   * and a paper with the rule switched off behaves exactly as it did before
 *     the rule existed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeDb } from './fake-db.ts';
import { AssessService } from '../src/onyx/assess.service.ts';
import { AcademicsService } from '../src/onyx/academics.service.ts';
import { AuditService } from '../src/onyx/audit.service.ts';
import { ProctorService, breachWarning } from '../src/onyx/proctor.service.ts';
import { HttpError } from '../src/http/errors.ts';
import type { OnyxDb } from '../src/onyx/db.ts';

const T = 1;
const ACTOR = { userId: 'user-20', role: 'admin' as const };
const CANDIDATE = 'u-1';
const START = 1_800_000_000_000;

/** A clock the tests move by hand, because the whole feature is about time. */
function world() {
  let now = START;
  const db = new FakeDb({
    onyx_courses: [
      { id: 1, tenant_id: T, code: 'CS101', title: 'Programming', slug: 'p', status: 1 },
    ],
    onyx_course_faculty: [],
    onyx_enrollments: [
      { id: 1, tenant_id: T, course_id: 1, user_id: CANDIDATE, status: 1 },
    ],
    onyx_memberships: [
      { id: 100, tenant_id: T, user_id: CANDIDATE, role: 'student', status: 1,
        roll_number: 'MR-001', section_id: null },
      { id: 101, tenant_id: T, user_id: 'staff-1', role: 'faculty', status: 1 },
    ],
    onyx_users: [
      { id: CANDIDATE, name: 'Meghana', email: 'm@x.test', status: 1 },
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
  });
  const academics = new AcademicsService(db as unknown as OnyxDb);
  const audit = new AuditService(db as unknown as OnyxDb);
  const assess = new AssessService(db as unknown as OnyxDb, academics, () => now);
  const proctor = new ProctorService(db as unknown as OnyxDb, audit, () => now);
  proctor.useStopper(assess);
  return {
    db, assess, proctor,
    tick: (ms: number) => { now += ms; },
    at: () => now,
  };
}

/** A monitored paper of four keyed questions, sat by the candidate. */
async function sitting(w: ReturnType<typeof world>, breachLimit = 3) {
  const bank = await w.assess.createBank(T, ACTOR, { name: 'Bank' });
  for (let i = 1; i <= 4; i += 1) {
    await w.assess.addQuestion(T, Number(bank.id), ACTOR, {
      type: 'single', prompt: 'Q' + i, points: 1,
      options: [{ id: 'a', text: 'a' }, { id: 'b', text: 'b' }], answer: 'b',
    });
  }
  const paper = await w.assess.createAssessment(T, ACTOR, {
    title: 'Midterm', course_id: 1, duration_minutes: 60,
    sections: [{ id: 's1', title: 'All', bank_id: Number(bank.id), take: 4 }],
    proctoring: true, instant_results: true, breach_limit: breachLimit,
  });
  await w.assess.publishAssessment(T, Number(paper.id));
  const attempt = await w.assess.start(T, Number(paper.id), CANDIDATE, { consent: true });
  return { paperId: Number(paper.id), attemptId: Number(attempt.id) };
}

const leave = (w: ReturnType<typeof world>, attemptId: number) =>
  w.proctor.record(T, attemptId, CANDIDATE, { kind: 'tab_blur' });

// ------------------------------------------------------------- the warnings

test('ASS-13 the first two departures warn, and say how many are left', async () => {
  const w = world();
  const { attemptId } = await sitting(w);

  const first = await leave(w, attemptId) as Record<string, unknown>;
  assert.equal(first.breaches, 1);
  assert.equal(first.terminated, false, 'the first departure ended the paper');
  assert.match(String(first.warning), /warning 1 of 3/i);

  const second = await leave(w, attemptId) as Record<string, unknown>;
  assert.equal(second.breaches, 2);
  assert.equal(second.terminated, false, 'the second departure ended the paper');
  // The last warning says it is the last one, in those words. "Warning 2 of 3"
  // is arithmetic; "leave it once more and your paper will be handed in" is
  // the thing somebody can act on.
  assert.match(String(second.warning), /final warning/i);
  assert.match(String(second.warning), /handed in/i);
});

test('ASS-13 the third departure hands the paper in', async () => {
  const w = world();
  const { attemptId } = await sitting(w);
  await leave(w, attemptId);
  await leave(w, attemptId);
  const third = await leave(w, attemptId) as Record<string, unknown>;

  assert.equal(third.breaches, 3);
  assert.equal(third.terminated, true, 'the third departure did not stop the paper');
  assert.match(String(third.warning), /has been handed in/i);

  const row = await w.assess.attemptRow(T, attemptId);
  assert.equal(row.status, 'terminated');
  assert.equal(row.terminated_reason, 'breach');
  assert.ok(row.terminated_at, 'nothing recorded when it was stopped');
});

test('ASS-13 the count is the server’s, so a refresh does not reset it', async () => {
  // The client sends a departure and is told the number. If the number lived in
  // the browser, reloading the page would hand back every life.
  const w = world();
  const { attemptId } = await sitting(w);
  await leave(w, attemptId);
  assert.equal((await w.assess.attemptRow(T, attemptId)).breach_count, 1);
  await leave(w, attemptId);
  assert.equal((await w.assess.attemptRow(T, attemptId)).breach_count, 2);
});

test('ASS-13 a paper with the rule switched off is recorded and never stopped', async () => {
  // Every paper written before this rule existed has `breach_limit` 0, and must
  // keep behaving exactly as it did: monitored, flagged, and never ended.
  const w = world();
  const { attemptId } = await sitting(w, 0);
  for (let i = 0; i < 6; i += 1) {
    const said = await leave(w, attemptId) as Record<string, unknown>;
    assert.equal(said.terminated, false);
    assert.equal(said.warning, null, 'a paper with no rule warned about one');
  }
  assert.equal((await w.assess.attemptRow(T, attemptId)).status, 'in_progress');
});

test('ASS-13 only leaving the paper counts; a paste is a flag, not a life', async () => {
  const w = world();
  const { attemptId } = await sitting(w);
  for (let i = 0; i < 5; i += 1) {
    await w.proctor.record(T, attemptId, CANDIDATE, { kind: 'paste' });
  }
  const row = await w.assess.attemptRow(T, attemptId);
  assert.equal(row.breach_count, 0, 'pasting spent a life');
  assert.equal(row.status, 'in_progress');
  // And it is still recorded as suspicious, which is the other half.
  assert.ok(Number(row.integrity_flags) > 0);
});

// ------------------------------------------------------ what a stopped paper is

test('ASS-13 a stopped paper is scored for staff and shown to nobody', async () => {
  /*
   * The one ending where the mark exists and must not be released. The paper
   * says `instant_results`, everything on it is machine-marked, and on any
   * other ending the candidate would be handed their score at once -- which
   * would give away the marking of a paper they may be about to carry on
   * sitting.
   */
  const w = world();
  const { attemptId } = await sitting(w);
  await leave(w, attemptId);
  await leave(w, attemptId);
  await leave(w, attemptId);

  const row = await w.assess.attemptRow(T, attemptId);
  assert.equal(row.status, 'terminated', 'a stopped paper was published to the candidate');
  assert.notEqual(row.status, 'published');
  // Scored all the same: the invigilation console shows where they had got to.
  assert.equal(Number(row.auto_score), 0, 'nothing was answered, so nothing was scored');
  assert.ok(row.submitted_at, 'the paper was not closed out');
});

test('ASS-13 everything the candidate wrote survives being stopped', async () => {
  const w = world();
  const { attemptId } = await sitting(w);
  const attempt = await w.assess.attemptRow(T, attemptId);
  const paper = attempt.paper as unknown as { question_id: number }[];
  await w.assess.saveAnswer(T, attemptId, CANDIDATE,
    { question_id: paper[0]!.question_id, response: 'b' });
  await w.assess.saveAnswer(T, attemptId, CANDIDATE,
    { question_id: paper[1]!.question_id, response: 'b' });

  await leave(w, attemptId);
  await leave(w, attemptId);
  await leave(w, attemptId);

  // Two right out of four, kept and marked. Losing the answers would make
  // "carry on from where you were" a promise the product could not keep.
  assert.equal(Number((await w.assess.attemptRow(T, attemptId)).auto_score), 2);
});

// ------------------------------------------------------------- the way back

test('ASS-13 reinstating gives back the minutes that were LEFT, not the ones since',
  async () => {
    /*
     * The reason `remaining_ms` is written down at the moment of stopping
     * rather than worked out later: `expires_at` is an absolute instant and it
     * keeps running while an invigilator makes up their mind. A candidate
     * stopped with 40 minutes left, reinstated a quarter of an hour later,
     * gets 40 minutes -- not 25, and not 60.
     */
    const w = world();
    const { attemptId } = await sitting(w);
    w.tick(20 * 60_000);                       // twenty minutes into a one-hour paper
    await leave(w, attemptId);
    await leave(w, attemptId);
    await leave(w, attemptId);

    const stopped = await w.assess.attemptRow(T, attemptId);
    assert.equal(Number(stopped.remaining_ms), 40 * 60_000);

    w.tick(15 * 60_000);                       // an invigilator takes a quarter of an hour
    const back = await w.assess.reinstate(T, attemptId, { userId: 'staff-1' });

    assert.equal(back.status, 'in_progress');
    assert.equal(Date.parse(String(back.expires_at)) - w.at(), 40 * 60_000,
      'the decision’s own duration was taken off the candidate');
  });

test('ASS-13 reinstating clears the provisional mark and starts the warnings again',
  async () => {
    const w = world();
    const { attemptId } = await sitting(w);
    await leave(w, attemptId);
    await leave(w, attemptId);
    await leave(w, attemptId);
    const back = await w.assess.reinstate(T, attemptId, { userId: 'staff-1' });

    // Not finished, so not marked: a score against an unfinished paper is a
    // score that will be wrong.
    assert.equal(back.score, null);
    assert.equal(back.auto_score, null);
    assert.equal(back.submitted_at, null);
    assert.equal(back.terminated_at, null);
    // And they are not put back into their third strike, which would be
    // reinstating them into being stopped by the next notification.
    assert.equal(Number(back.breach_count), 0);
    assert.equal(back.reinstated_by, 'staff-1', 'nobody was recorded as having decided');
  });

test('ASS-13 a reinstated candidate can answer again, and be stopped again', async () => {
  const w = world();
  const { attemptId } = await sitting(w);
  const paper = (await w.assess.attemptRow(T, attemptId)).paper as unknown as
    { question_id: number }[];
  await leave(w, attemptId);
  await leave(w, attemptId);
  await leave(w, attemptId);
  await w.assess.reinstate(T, attemptId, { userId: 'staff-1' });

  // The point of the whole exercise: they carry on writing.
  await w.assess.saveAnswer(T, attemptId, CANDIDATE,
    { question_id: paper[0]!.question_id, response: 'b' });

  // And the rule still applies -- a second chance, not an exemption.
  await leave(w, attemptId);
  await leave(w, attemptId);
  const again = await leave(w, attemptId) as Record<string, unknown>;
  assert.equal(again.terminated, true, 'the rule stopped applying after a reinstatement');
});

test('ASS-13 an attempt nobody stopped cannot be reinstated', async () => {
  const w = world();
  const { attemptId } = await sitting(w);
  await assert.rejects(
    () => w.assess.reinstate(T, attemptId, { userId: 'staff-1' }),
    (e: unknown) => e instanceof HttpError && e.status === 422);
});

test('ASS-13 somebody stopped with no time left is told so rather than restored', async () => {
  // Reinstating them would put them straight back into an expired paper: a
  // button that appears to do nothing. The marks stand instead, and the
  // refusal says why.
  const w = world();
  const { attemptId } = await sitting(w);
  w.tick(60 * 60_000 - 500);
  await leave(w, attemptId);
  await leave(w, attemptId);
  await leave(w, attemptId);
  await assert.rejects(
    () => w.assess.reinstate(T, attemptId, { userId: 'staff-1' }),
    (e: unknown) => e instanceof HttpError && e.status === 422
      && /no time left/i.test(e.message));
});

// ------------------------------------------------------------- the wording

test('ASS-13 the warning a candidate reads counts the same way the rule does', () => {
  // Assembled server-side precisely so these cannot drift: a sentence built in
  // the browser from a number sent by the server eventually says "3 of 2".
  assert.match(breachWarning(1, 3), /warning 1 of 3/i);
  assert.match(breachWarning(2, 3), /final warning/i);
  assert.match(breachWarning(3, 3), /handed in/i);
  // A two-strike paper's first warning is its last one.
  assert.match(breachWarning(1, 2), /final warning/i);
});
