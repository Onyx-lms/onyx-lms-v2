/**
 * Onyx O12 unit tests -- the console restructure.
 *
 * Three claims that the screens now depend on and that would each fail
 * quietly:
 *
 *   * a bank LIST says how many sets and how many questions it holds, and how
 *     many of them need a marker. The console had this and the institution's
 *     own screens did not, so the two lists disagreed about whether a bank
 *     could be scheduled. Now one method answers, and the console delegates
 *     to it.
 *   * an institution's own staff can set a paper or a sitting FOR ONE SECTION.
 *     The column and the visibility rule already existed; only the way in was
 *     missing, so "set this test for Alpha-CSE" was a thing a lecturer had to
 *     ask the platform to do for them. And a section id from another
 *     institution is refused rather than written, because a paper set for a
 *     division nobody here is in is invisible without ever looking broken.
 *   * a sitting reports ONE ROW PER CANDIDATE -- the attempt, the mark and the
 *     seat joined -- with the roll number, the section and the grade on it.
 *     Three separate lists is what the screen showed before, and a candidate
 *     present in one and absent from the next read as an error rather than as
 *     a state.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeDb } from './fake-db.ts';
import { AssessService } from '../src/onyx/assess.service.ts';
import { AcademicsService } from '../src/onyx/academics.service.ts';
import { ExaminationsService } from '../src/onyx/examinations.service.ts';
import { AuditService } from '../src/onyx/audit.service.ts';
import { PlatformService } from '../src/onyx/platform.service.ts';
import { HttpError } from '../src/http/errors.ts';
import type { OnyxDb } from '../src/onyx/db.ts';

const T = 1;
const OTHER = 2;
const ACTOR = { userId: 'user-20', role: 'admin' as const };

function world() {
  const db = new FakeDb({
    onyx_tenants: [
      { id: T, name: 'Malla Reddy', slug: 'mrit', status: 1 },
      { id: OTHER, name: 'Elsewhere', slug: 'else', status: 1 },
    ],
    onyx_courses: [
      { id: 1, tenant_id: T, code: 'CS101', title: 'Programming', slug: 'p', status: 1,
        semester_id: null },
    ],
    onyx_course_faculty: [],
    onyx_enrollments: [],
    onyx_sections: [
      { id: 10, tenant_id: T, name: 'Alpha-CSE', code: 'alpha-cse', sort: 1, status: 1 },
      { id: 99, tenant_id: OTHER, name: 'Section A', code: 'a', sort: 1, status: 1 },
    ],
    onyx_memberships: [
      { id: 100, tenant_id: T, user_id: 'u-1', role: 'student', status: 1,
        roll_number: 'MR-002', section_id: 10 },
      { id: 101, tenant_id: T, user_id: 'u-2', role: 'student', status: 1,
        roll_number: 'MR-010', section_id: 10 },
      { id: 102, tenant_id: T, user_id: 'u-3', role: 'student', status: 1,
        roll_number: null, section_id: null },
    ],
    onyx_users: [
      { id: 'u-1', name: 'Meghana', email: 'm@x.test', phone: null, status: 1 },
      { id: 'u-2', name: 'Arjun', email: 'a@x.test', phone: null, status: 1 },
      { id: 'u-3', name: 'Zara', email: 'z@x.test', phone: null, status: 1 },
    ],
    onyx_question_banks: [],
    onyx_questions: [],
    onyx_question_versions: [],
    onyx_assessments: [],
    onyx_assessment_attempts: [],
    onyx_assessment_answers: [],
    onyx_proctor_events: [],
    onyx_assessment_grades: [],
    onyx_exams: [],
    onyx_exam_marks: [],
    onyx_exam_seats: [],
    onyx_audit_logs: [],
    onyx_problems: [],
    onyx_problem_tests: [],
    onyx_semesters: [],
  });
  const academics = new AcademicsService(db as unknown as OnyxDb);
  const audit = new AuditService(db as unknown as OnyxDb);
  const assess = new AssessService(db as unknown as OnyxDb, academics, () => 1_800_000_000_000);
  const exams = new ExaminationsService(db as unknown as OnyxDb, audit);
  return { db, academics, audit, assess, exams };
}

// -------------------------------------------------------------- bank listing

test('ASS-12 a bank listing says how many sets and questions it holds', async () => {
  const w = world();
  const bank = await w.assess.createBank(T, ACTOR, { name: 'Three sets' });
  for (let sx = 1; sx <= 3; sx += 1) {
    for (let i = 1; i <= 4; i += 1) {
      await w.assess.addQuestion(T, Number(bank.id), ACTOR, {
        type: 'single', prompt: 'Set ' + sx + ' q' + i, points: 1, set_number: sx,
        options: [{ id: 'a', text: 'a' }, { id: 'b', text: 'b' }], answer: 'b',
      });
    }
  }
  const [listed] = await w.assess.banks(T);
  assert.equal(listed!.question_count, 12);
  assert.equal(listed!.set_count, 3, 'the listing did not report the parallel sets');
  assert.equal(listed!.needs_marking, 0, 'a fully keyed bank does not need a marker');
});

test('ASS-12 a bank counts what a machine cannot mark, keyed or not', async () => {
  // The second kind is the reason this column exists: a multiple-choice with
  // no correct option set reads as objective everywhere it is listed and marks
  // exactly like an essay.
  const w = world();
  const bank = await w.assess.createBank(T, ACTOR, { name: 'Mixed' });
  const bid = Number(bank.id);
  await w.assess.addQuestion(T, bid, ACTOR, {
    type: 'single', prompt: 'Keyed', points: 1,
    options: [{ id: 'a', text: 'a' }, { id: 'b', text: 'b' }], answer: 'b',
  });
  await w.assess.addQuestion(T, bid, ACTOR, {
    type: 'single', prompt: 'Unkeyed', points: 1,
    options: [{ id: 'a', text: 'a' }, { id: 'b', text: 'b' }],
  });
  await w.assess.addQuestion(T, bid, ACTOR, { type: 'essay', prompt: 'Discuss', points: 10 });

  const [listed] = await w.assess.banks(T);
  assert.equal(listed!.question_count, 3);
  assert.equal(listed!.needs_marking, 2, 'the unkeyed multiple-choice was counted as automatic');
});

test('ASS-12 an institution with no banks reports an empty list, not a crash', async () => {
  assert.deepEqual(await world().assess.banks(T), []);
});

test('ASS-12 the console reads the same answer rather than keeping its own', async () => {
  // The whole point of the delegation: one method, so a bank cannot look
  // schedulable on one screen and not on the other.
  const w = world();
  const bank = await w.assess.createBank(T, ACTOR, { name: 'Shared' });
  await w.assess.addQuestion(T, Number(bank.id), ACTOR, {
    type: 'truefalse', prompt: 'True?', points: 1, answer: 'true', set_number: 2,
  });
  const platform = new PlatformService(w.db as unknown as OnyxDb, undefined, w.assess);
  assert.deepEqual(await platform.questionBanks(T), await w.assess.banks(T));
});

// ------------------------------------------------------- sections, staff-side

test('ASS-12 an institution’s own staff can set a paper for one section', async () => {
  const w = world();
  const paper = await w.assess.createAssessment(T, ACTOR, {
    title: 'Alpha only', course_id: 1, duration_minutes: 30, section_id: 10,
  });
  assert.equal(Number(paper!.section_id), 10);
});

test('ASS-12 a paper with no section is still for everybody', async () => {
  const w = world();
  const paper = await w.assess.createAssessment(T, ACTOR, {
    title: 'Whole cohort', course_id: 1, duration_minutes: 30,
  });
  assert.equal(paper!.section_id, null);
});

test('ASS-12 a section from another institution is refused, not written', async () => {
  const w = world();
  await assert.rejects(
    () => w.assess.createAssessment(T, ACTOR, {
      title: 'Wrong house', course_id: 1, duration_minutes: 30, section_id: 99,
    }),
    (e: unknown) => e instanceof HttpError && e.status === 404);
});

test('ASS-12 a sitting can be scheduled for one section, and only a real one', async () => {
  const w = world();
  const exam = await w.exams.schedule(T, ACTOR, {
    semester_id: null, course_id: 1, title: 'Mid-term',
    starts_at: new Date(1_800_100_000_000).toISOString(), section_id: 10,
  });
  assert.equal(Number(exam!.section_id), 10);

  await assert.rejects(
    () => w.exams.schedule(T, ACTOR, {
      semester_id: null, course_id: 1, title: 'Wrong house',
      starts_at: new Date(1_800_200_000_000).toISOString(), section_id: 99,
    }),
    (e: unknown) => e instanceof HttpError && e.status === 404);
});

test('ASS-12 the institutions directory counts every member, not the first thousand',
  async () => {
    /*
     * The directory fetched every membership row across every institution and
     * added them up in a loop. With no range that reads as "all of them" and
     * is not -- so an institution of 1,440 was listed as 943, and the "members
     * across every institution" figure, which is this column summed, came out
     * at exactly 1000 however many people there really were.
     *
     * A thousand rows is more than a unit test wants to insert, so what is
     * asserted here is the shape that made it wrong: the count must come from
     * a COUNT, not from the length of a row set. A tenant whose memberships
     * the fake db returns in full still has to report the same number, and a
     * withdrawn membership must not be counted at all.
     */
    const w = world();
    for (let i = 0; i < 25; i += 1) {
      await w.db.from('onyx_memberships').insert({
        id: 500 + i, tenant_id: T, user_id: 'bulk-' + i, role: 'student', status: 1,
      });
    }
    // Left the institution: on the roll, and not a member.
    await w.db.from('onyx_memberships').insert({
      id: 600, tenant_id: T, user_id: 'gone', role: 'student', status: 0,
    });

    const platform = new PlatformService(w.db as unknown as OnyxDb, undefined, w.assess);
    const listed = (await platform.tenants()).find((t) => Number(t.id) === T);
    // The three seeded students plus these 25 is 28 active, and the withdrawn
    // one is not among them.
    assert.equal(listed?.member_count, 28,
      'the directory disagreed with the roll it was counting');
  });

// ------------------------------------------------------------- the register

/** A sitting with one candidate who sat it online and one marked by hand. */
async function sitting(w: ReturnType<typeof world>) {
  const platform = new PlatformService(w.db as unknown as OnyxDb, undefined, w.assess);
  const exam = await w.exams.schedule(T, ACTOR, {
    semester_id: null, course_id: 1, title: 'Finals',
    starts_at: new Date(1_800_100_000_000).toISOString(),
    max_marks: 100, pass_marks: 40,
  });
  const examId = Number(exam!.id);

  // Marked by hand: a pass and a fail, so the reading is exercised both ways.
  await w.db.from('onyx_exam_marks').insert({
    id: 1, tenant_id: T, exam_id: examId, user_id: 'u-1',
    raw_marks: 71, moderation_delta: 0, final_marks: 71, grade: 'A', status: 'published',
  });
  await w.db.from('onyx_exam_marks').insert({
    id: 2, tenant_id: T, exam_id: examId, user_id: 'u-2',
    raw_marks: 12, moderation_delta: 0, final_marks: 12, grade: 'F', status: 'published',
  });
  // Seated but never marked: the third state the old three tables hid.
  await w.db.from('onyx_exam_seats').insert({
    id: 1, tenant_id: T, exam_id: examId, user_id: 'u-3', room_id: 4, seat_no: 'B12',
  });
  return { platform, examId };
}

test('ASS-12 a sitting reports one row per candidate, in roll order', async () => {
  const w = world();
  const { platform, examId } = await sitting(w);
  const { register } = await platform.examDetail(T, examId);

  assert.equal(register.length, 3, 'somebody with a seat and no mark was dropped');
  // MR-002 before MR-010 -- numeric-aware, not a string comparison -- and the
  // candidate with no number last rather than first.
  assert.deepEqual(register.map((r) => r.roll_number), ['MR-002', 'MR-010', null]);
});

test('ASS-12 the register carries the name, the roll number and the section', async () => {
  const w = world();
  const { platform, examId } = await sitting(w);
  const { register } = await platform.examDetail(T, examId);
  const first = register[0]!;
  assert.equal(first.name, 'Meghana');
  assert.equal(first.roll_number, 'MR-002');
  assert.equal(first.section, 'Alpha-CSE', 'the section was reported as an id, or not at all');
});

test('ASS-12 pass and fail are decided once, against the sitting’s own pass mark', async () => {
  const w = world();
  const { platform, examId } = await sitting(w);
  const { register } = await platform.examDetail(T, examId);
  assert.equal(register[0]!.result, 'pass', '71 out of 100 with a pass at 40 is a pass');
  assert.equal(register[0]!.grade, 'A');
  assert.equal(register[1]!.result, 'fail');
  // An unmarked script is not a fail. It is nothing yet, and saying otherwise
  // on a screen a candidate's grade is read off is the worst kind of wrong.
  assert.equal(register[2]!.result, null);
  assert.equal(register[2]!.final_marks, null);
});

test('ASS-12 the academics list says which sittings are sat in a browser', async () => {
  /*
   * The mapping used to select `assessment_id` and `section_id` and then drop
   * both on the way out. Nothing errored: the console's invigilation list,
   * which shows exactly the sittings that HAVE an online paper, simply showed
   * none -- at every institution. A field that is queried and then quietly
   * discarded is the worst kind of missing, because the query reads correctly.
   */
  const w = world();
  const platform = new PlatformService(w.db as unknown as OnyxDb, undefined, w.assess);
  const paper = await w.assess.createAssessment(T, ACTOR, {
    title: 'Online', course_id: 1, duration_minutes: 30, section_id: 10,
  });
  await w.exams.schedule(T, ACTOR, {
    semester_id: null, course_id: 1, title: 'Sat in a browser',
    starts_at: new Date(1_800_100_000_000).toISOString(),
    assessment_id: Number(paper!.id), section_id: 10,
  });
  await w.exams.schedule(T, ACTOR, {
    semester_id: null, course_id: 1, title: 'Sat in a hall',
    starts_at: new Date(1_800_200_000_000).toISOString(),
  });

  const { exams } = await platform.tenantAcademics(T);
  const online = exams.find((e) => e.title === 'Sat in a browser');
  const hall = exams.find((e) => e.title === 'Sat in a hall');
  assert.equal(online?.assessment_id, Number(paper!.id),
    'the sitting does not say which paper it is sat on');
  assert.equal(online?.section_id, 10, 'the sitting does not say which division sits it');
  // The other half of the same claim: a hall sitting must read as having
  // neither, not as missing data.
  assert.equal(hall?.assessment_id, null);
  assert.equal(hall?.section_id, null);
});

test('ASS-12 an online score decides pass or fail when no mark was entered', async () => {
  /*
   * The sitting's own ledger is empty for a paper sat in a browser -- nobody
   * writes a row there -- and this read only knew about the ledger. So a
   * candidate who scored full marks online was reported with NO RESULT, on the
   * one screen the client asked to show grades and results.
   *
   * The scaling matters as much as the fallback: a paper out of 20 sat under a
   * sitting out of 100 with a pass at 40 passes at 8 of 20, not at 40 of 20 --
   * a mark nobody can reach, which would fail everybody who sat it.
   */
  const w = world();
  const platform = new PlatformService(w.db as unknown as OnyxDb, undefined, w.assess);
  const paper = await w.assess.createAssessment(T, ACTOR, {
    title: 'Online', course_id: 1, duration_minutes: 30,
  });
  const exam = await w.exams.schedule(T, ACTOR, {
    semester_id: null, course_id: 1, title: 'Online sitting',
    starts_at: new Date(1_800_100_000_000).toISOString(),
    assessment_id: Number(paper!.id), max_marks: 100, pass_marks: 40,
  });

  await w.db.from('onyx_assessment_attempts').insert({
    id: 900, tenant_id: T, assessment_id: Number(paper!.id), user_id: 'u-1', attempt: 1,
    status: 'published', started_at: 'a', submitted_at: 'b', score: 18, max_score: 20,
  });
  await w.db.from('onyx_assessment_attempts').insert({
    id: 901, tenant_id: T, assessment_id: Number(paper!.id), user_id: 'u-2', attempt: 1,
    status: 'published', started_at: 'a', submitted_at: 'b', score: 4, max_score: 20,
  });
  await w.db.from('onyx_assessment_attempts').insert({
    id: 902, tenant_id: T, assessment_id: Number(paper!.id), user_id: 'u-3', attempt: 1,
    status: 'in_progress', started_at: 'a', submitted_at: null, score: null, max_score: 20,
  });

  const { register } = await platform.examDetail(T, Number(exam!.id));
  const of = (roll: string | null) => register.find((r) => r.roll_number === roll);
  // 18 of 20 is 90%, and the sitting passes at 40%.
  assert.equal(of('MR-002')?.result, 'pass', 'a full-marks online script had no result');
  // 4 of 20 is 20%, which is below it -- and is NOT compared against 40 raw.
  assert.equal(of('MR-010')?.result, 'fail');
  // Still nothing to judge for somebody who has not handed in.
  assert.equal(register.find((r) => r.name === 'Zara')?.result, null);
});

test('ASS-12 an examiner’s entry outranks the engine’s score', async () => {
  // A moderated or hand-corrected mark is a decision about this candidate. The
  // raw score must not overrule it -- which is why the ledger is read first.
  const w = world();
  const platform = new PlatformService(w.db as unknown as OnyxDb, undefined, w.assess);
  const paper = await w.assess.createAssessment(T, ACTOR, {
    title: 'Online', course_id: 1, duration_minutes: 30,
  });
  const exam = await w.exams.schedule(T, ACTOR, {
    semester_id: null, course_id: 1, title: 'Moderated',
    starts_at: new Date(1_800_100_000_000).toISOString(),
    assessment_id: Number(paper!.id), max_marks: 100, pass_marks: 40,
  });
  await w.db.from('onyx_assessment_attempts').insert({
    id: 910, tenant_id: T, assessment_id: Number(paper!.id), user_id: 'u-1', attempt: 1,
    status: 'published', started_at: 'a', submitted_at: 'b', score: 20, max_score: 20,
  });
  await w.db.from('onyx_exam_marks').insert({
    id: 5, tenant_id: T, exam_id: Number(exam!.id), user_id: 'u-1',
    raw_marks: 30, moderation_delta: 0, final_marks: 30, grade: 'F', status: 'published',
  });

  const { register } = await platform.examDetail(T, Number(exam!.id));
  assert.equal(register[0]?.result, 'fail',
    'the engine score overruled the examiner’s entry');
  assert.equal(register[0]?.grade, 'F');
});

test('ASS-12 a seat with no mark still appears, with the seat on it', async () => {
  const w = world();
  const { platform, examId } = await sitting(w);
  const { register } = await platform.examDetail(T, examId);
  const zara = register.find((r) => r.name === 'Zara')!;
  assert.equal(zara.seat_no, 'B12');
  assert.equal(zara.attempt_id, null, 'nothing was sat in a browser');
});

test('a scheduled examination announces its paper rather than locking it', async () => {
  /*
   * 0043. Scheduling an exam used to pin the paper to the slot -- `opens_at`
   * at the start, `closes_at` at start plus duration -- so a candidate outside
   * those two instants got "This assessment has closed." That is hall
   * discipline, and it is the right rule when a hall is what is happening.
   *
   * It is the wrong default here, because this product deals SETS: parallel
   * papers rotating down the roll, so the person beside you is not holding
   * yours. Simultaneity was doing a job the sets already do, and charging for
   * it in the one currency a candidate cannot get back -- miss the hour, or
   * lose your connection inside it, and you were simply out.
   *
   * The start is still pinned: a paper reachable before its examination has
   * been announced to start is a paper somebody reads early. What this asserts
   * is the other end.
   */
  const w = world();
  const exams = new ExaminationsService(w.db as unknown as OnyxDb, w.audit);
  const actor = { userId: 'user-20', role: 'admin' as const };

  const at = new Date(Date.now() + 3_600_000).toISOString();
  const open = await exams.schedule(T, actor, {
    semester_id: null, course_id: 1, title: 'Open sitting', starts_at: at,
    duration_minutes: 90,
  });
  assert.equal(open!.window_enforced, false, 'the slot should not lock by default');

  // A second course, so the two sittings do not clash over the same cohort.
  await w.db.from('onyx_courses').insert({
    id: 2, tenant_id: T, code: 'CS102', title: 'Systems', slug: 's', status: 1,
    semester_id: null,
  });
  const locked = await exams.schedule(T, actor, {
    semester_id: null, course_id: 2, title: 'Hall sitting', starts_at: at,
    duration_minutes: 90, window_enforced: true,
  });
  assert.equal(locked!.window_enforced, true, 'an institution asking for the hall gets it');

  // And it can be turned on afterwards, which is what the exam form's switch
  // does -- an examination moved into a hall should not have to be recreated.
  const changed = await exams.updateExam(T, Number(open!.id), actor, { window_enforced: true });
  assert.equal(changed!.window_enforced, true);
});
