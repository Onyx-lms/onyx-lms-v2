/**
 * Onyx O11 unit tests -- a bank of parallel sets, dealt by roll number.
 *
 * This is the arrangement the client described, tested through the real deal
 * rather than through the rotation helper alone:
 *
 *   a setter writes Set 1, Set 2, ... each a whole paper of the same shape;
 *   roll 1 sits Set 1, roll 2 sits Set 2, roll 11 comes back round to Set 1;
 *   two candidates within reach of each other never hold the same questions.
 *
 * The three claims that would fail quietly, and are therefore the ones here:
 * a bank nobody divided still deals (every question written before sets
 * existed is Set 1); the same candidate is dealt the same set twice running;
 * and no candidate is ever dealt an empty paper.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeDb } from './fake-db.ts';
import { AssessService } from '../src/onyx/assess.service.ts';
import { AcademicsService } from '../src/onyx/academics.service.ts';
import { AuditService } from '../src/onyx/audit.service.ts';
import type { OnyxDb } from '../src/onyx/db.ts';

const T = 1;
const ACTOR = { userId: 'user-20', role: 'admin' as const };

/** Ten candidates on roll 1..10, plus one on 11 to prove the wrap. */
const ROLLS = Array.from({ length: 11 }, (_, i) => ({
  user: 'u-' + (i + 1),
  roll: 'MR-' + String(i + 1).padStart(3, '0'),
}));

function world() {
  const db = new FakeDb({
    onyx_courses: [
      { id: 1, tenant_id: T, code: 'CS101', title: 'Programming', slug: 'p', status: 1 },
    ],
    onyx_course_faculty: [],
    onyx_enrollments: ROLLS.map((r, i) => ({
      id: i + 1, tenant_id: T, course_id: 1, user_id: r.user, status: 1,
    })),
    onyx_memberships: ROLLS.map((r, i) => ({
      id: 100 + i, tenant_id: T, user_id: r.user, role: 'student', status: 1,
      roll_number: r.roll, section_id: null,
    })),
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
  const assess = new AssessService(db as unknown as OnyxDb, academics, () => 1_800_000_000_000);
  return { db, assess, audit };
}

/**
 * A bank of `sets` parallel sets, each of `per` questions.
 *
 * Every question is unique to its set and says which it belongs to in its
 * prompt, so an overlap between two candidates' papers is visible in the
 * assertion rather than having to be inferred from ids.
 */
async function bankOfSets(w: ReturnType<typeof world>, sets: number, per: number) {
  const bank = await w.assess.createBank(T, ACTOR, { name: 'Sets' });
  const bid = Number(bank.id);
  for (let sx = 1; sx <= sets; sx += 1) {
    for (let i = 1; i <= per; i += 1) {
      await w.assess.addQuestion(T, bid, ACTOR, {
        type: 'single',
        prompt: 'Set ' + sx + ' question ' + i,
        options: [{ id: 'a', text: 'a' }, { id: 'b', text: 'b' }],
        answer: 'b',
        points: 1,
        set_number: sx,
      });
    }
  }
  return bid;
}

async function paperOn(w: ReturnType<typeof world>, bankId: number, take: number) {
  const a = await w.assess.createAssessment(T, ACTOR, {
    title: 'Midterm', course_id: 1, duration_minutes: 60,
    sections: [{ id: 's1', title: 'All', bank_id: bankId, take }],
  });
  await w.assess.publishAssessment(T, Number(a.id));
  return Number(a.id);
}

/** The prompts one candidate is dealt. */
async function dealtTo(w: ReturnType<typeof world>, paper: number, user: string) {
  const attempt = await w.assess.start(T, paper, user);
  return (attempt.questions as { prompt: string }[]).map((q) => q.prompt).sort();
}

// ---------------------------------------------------------------------------

test('ASS-11 the setter’s sets rotate down the register, and wrap at eleven', async () => {
  const w = world();
  const bank = await bankOfSets(w, 10, 3);
  const paper = await paperOn(w, bank, 3);

  const dealt = [];
  for (const r of ROLLS) dealt.push(await dealtTo(w, paper, r.user));

  // Roll n sits Set n: the rotation matches the register, which is what makes
  // it usable for seating.
  for (let i = 0; i < 10; i += 1) {
    for (const prompt of dealt[i]!) {
      assert.ok(prompt.startsWith('Set ' + (i + 1) + ' '),
        'roll ' + (i + 1) + ' was dealt "' + prompt + '"');
    }
  }
  // And roll 11 is back on Set 1 -- out of arm's reach of roll 1.
  assert.deepEqual(dealt[10], dealt[0], 'roll 11 did not come back round to Set 1');
});

test('ASS-11 no two candidates within a run of ten share a question', async () => {
  // The guarantee the whole arrangement exists for.
  const w = world();
  const paper = await paperOn(w, await bankOfSets(w, 10, 3), 3);
  const dealt = [];
  for (const r of ROLLS.slice(0, 10)) dealt.push(await dealtTo(w, paper, r.user));

  for (let a = 0; a < dealt.length; a += 1) {
    for (let b = a + 1; b < dealt.length; b += 1) {
      const shared = dealt[a]!.filter((q) => dealt[b]!.includes(q));
      assert.deepEqual(shared, [],
        'rolls ' + (a + 1) + ' and ' + (b + 1) + ' share ' + shared.join(', '));
    }
  }
});

test('ASS-11 every candidate is dealt a full paper, never a short one', async () => {
  const w = world();
  const paper = await paperOn(w, await bankOfSets(w, 10, 3), 3);
  for (const r of ROLLS) {
    assert.equal((await dealtTo(w, paper, r.user)).length, 3,
      r.roll + ' was dealt a short paper');
  }
});

test('ASS-11 a bank nobody divided still deals, to everybody the same', async () => {
  // Every question written before sets existed is Set 1. Such a bank must
  // behave exactly as it did: one paper, everybody sits it.
  const w = world();
  const bank = await w.assess.createBank(T, ACTOR, { name: 'Undivided' });
  for (let i = 1; i <= 4; i += 1) {
    await w.assess.addQuestion(T, Number(bank.id), ACTOR, {
      type: 'single', prompt: 'Question ' + i, points: 1,
      options: [{ id: 'a', text: 'a' }, { id: 'b', text: 'b' }], answer: 'b',
    });
  }
  const paper = await paperOn(w, Number(bank.id), 4);
  const first = await dealtTo(w, paper, ROLLS[0]!.user);
  assert.equal(first.length, 4);
  assert.deepEqual(await dealtTo(w, paper, ROLLS[5]!.user), first);
});

test('ASS-11 three sets rotate through three, not through ten', async () => {
  const w = world();
  const paper = await paperOn(w, await bankOfSets(w, 3, 2), 2);
  const one = await dealtTo(w, paper, ROLLS[0]!.user);
  const four = await dealtTo(w, paper, ROLLS[3]!.user);
  assert.deepEqual(four, one, 'a three-set bank did not wrap at three');
  assert.notDeepEqual(await dealtTo(w, paper, ROLLS[1]!.user), one);
});

test('ASS-11 the same candidate resuming is dealt the same set', async () => {
  // A paper that changed under somebody who refreshed would be a different
  // paper, and their saved answers would no longer match their questions.
  const w = world();
  const paper = await paperOn(w, await bankOfSets(w, 10, 3), 3);
  const first = await dealtTo(w, paper, ROLLS[2]!.user);
  const resumed = await w.assess.start(T, paper, ROLLS[2]!.user);
  assert.deepEqual(
    (resumed.questions as { prompt: string }[]).map((q) => q.prompt).sort(), first);
});

test('ASS-11 a bank reports its sets, so a setter can see the shape before scheduling',
  async () => {
    const w = world();
    const bank = await bankOfSets(w, 4, 3);
    const sets = await w.assess.bankSets(T, bank);
    assert.equal(sets.length, 4);
    assert.deepEqual(sets.map((sx) => sx.set_number), [1, 2, 3, 4]);
    for (const sx of sets) {
      assert.equal(sx.count, 3, 'set ' + sx.set_number + ' is not the same size as the rest');
      assert.equal(sx.marks, 3);
      assert.equal(sx.by_type.single, 3);
    }
  });
