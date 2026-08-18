/**
 * ASS-01 / ASS-03 -- question banks, the timed engine, grading and moderation.
 *
 * "Timed tests, remote proctoring and rich results analytics that give faculty
 * confidence in every score and cohort insight."
 *
 * Four rules run through everything here, each because being wrong is
 * expensive when a score decides something:
 *
 *   1. **A sat paper is immutable.** Selection happens once, at start, and the
 *      questions are snapshotted into the attempt. Editing a question
 *      afterwards changes neither what was asked nor what counted as right.
 *   2. **Time is the server's.** started_at, expires_at and submitted_at are
 *      written here; nothing a client says about the clock is trusted, so a
 *      changed system clock cannot extend an attempt.
 *   3. **The answer key never leaves the server** until results are published,
 *      and not even then for a question still in use.
 *   4. **A mark is a record of who decided what.** First marking, second
 *      marking and moderation are separate rows, which is the only way
 *      "the moderator changed it" can be answered afterwards.
 */
import { createHash } from 'node:crypto';
import type { OnyxDb } from './db.ts';
import type { Role } from '@onyx/types';
import { HttpError } from '../http/errors.ts';
import { increment } from './metrics.ts';
import type { AcademicsService } from './academics.service.ts';

const BANK_COLUMNS = 'id, tenant_id, course_id, name, description, created_by, created_at';
const QUESTION_COLUMNS = 'id, tenant_id, bank_id, type, prompt, options, answer, explanation, points, difficulty, tags, version, status, created_at';
const VERSION_COLUMNS = 'id, tenant_id, question_id, version, type, prompt, options, answer, explanation, points';
const ASSESSMENT_COLUMNS = 'id, tenant_id, course_id, title, instructions, opens_at, closes_at, duration_minutes, attempts_allowed, sections, shuffle_questions, shuffle_options, proctoring, require_camera, require_screen, anonymous_marking, moderation_required, pass_mark, status, results_published_at, created_by, created_at';
const ATTEMPT_COLUMNS = 'id, tenant_id, assessment_id, user_id, attempt, paper, status, started_at, expires_at, submitted_at, auto_score, manual_score, score, max_score, consented_at, integrity_flags, integrity_status, updated_at';
const ANSWER_COLUMNS = 'id, tenant_id, attempt_id, question_id, version, response, auto_points, manual_points, marker_comment, flagged_for_review, updated_at';
const GRADE_COLUMNS = 'id, tenant_id, attempt_id, role, marker_id, manual_score, comment, created_at';

/** The only values `status` may hold. Named so a patch can be checked. */
export const ASSESSMENT_STATUSES = ['draft', 'published', 'closed'] as const;

export const QUESTION_TYPES = ['single', 'multiple', 'truefalse', 'short', 'essay'] as const;
export type OnyxQuestionType = (typeof QUESTION_TYPES)[number];

/** Types a machine CAN mark, given a key. Whether one was actually set is separate. */
const OBJECTIVE: OnyxQuestionType[] = ['single', 'multiple', 'truefalse', 'short'];
export const isObjective = (type: string) => OBJECTIVE.includes(type as OnyxQuestionType);

/**
 * True if a stored answer key actually specifies something gradable.
 *
 * An MCQ-shaped question with no key set is not "wrong by default" -- it is
 * unmarkable by a machine, same as an essay, until a person marks it. Without
 * this check a question authored without a deliberate correct-option pick
 * would silently auto-grade every response as wrong against a blank key.
 */
export const hasKey = (answer: unknown): boolean => !(
  answer === undefined || answer === null
  || (Array.isArray(answer) && answer.length === 0)
  || (typeof answer === 'string' && answer.trim() === '')
);

export type MarkRole = 'first' | 'second' | 'moderation';

/** One entry of a dealt paper, as stored on the attempt. */
export interface PaperEntry {
  question_id: number;
  version: number;
  section_id: string | null;
  type: OnyxQuestionType;
  prompt: string;
  /** Already in the order this candidate sees them. */
  options: { id: string; text: string }[];
  points: number;
}

/**
 * A deterministic shuffle.
 *
 * Seeded by the attempt, so a resumed attempt deals the same hand -- and so a
 * failure is reproducible, which `Math.random()` would not be. Fisher-Yates
 * over a hash-derived stream.
 */
export function seededShuffle<T>(items: T[], seed: string): T[] {
  const out = [...items];
  let pool = createHash('sha256').update(seed).digest();
  let cursor = 0;
  const next = () => {
    if (cursor + 4 > pool.length) {
      pool = createHash('sha256').update(pool).digest();
      cursor = 0;
    }
    const n = pool.readUInt32BE(cursor);
    cursor += 4;
    return n / 0x1_0000_0000;
  };
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/**
 * Marks one objective answer.
 *
 * Exported because the item analysis re-derives correctness from stored answers
 * and must agree with what was awarded at the time.
 */
export function scoreObjective(
  type: string, answer: unknown, response: unknown, points: number,
): number {
  if (response === null || response === undefined) return 0;

  if (type === 'single' || type === 'truefalse') {
    return String(response) === String(answer) ? points : 0;
  }
  if (type === 'multiple') {
    const key = [...new Set((Array.isArray(answer) ? answer : []).map(String))].sort();
    const given = [...new Set((Array.isArray(response) ? response : []).map(String))].sort();
    // All of the right ones and none of the wrong ones. Partial credit on
    // multi-select rewards ticking everything, so it is not offered.
    return key.length === given.length && key.every((k, i) => k === given[i]) ? points : 0;
  }
  if (type === 'short') {
    // Any of the accepted spellings, case and surrounding space ignored.
    const accepted = (Array.isArray(answer) ? answer : [answer])
      .map((a) => String(a ?? '').trim().toLowerCase());
    return accepted.includes(String(response).trim().toLowerCase()) ? points : 0;
  }
  return 0;
}

export interface AssessActor { userId: string; role: Role }

export class AssessService {
  #db: OnyxDb;
  #academics: AcademicsService;
  #now: () => number;

  constructor(db: OnyxDb, academics: AcademicsService, now: () => number = Date.now) {
    this.#db = db;
    this.#academics = academics;
    this.#now = now;
  }

  /**
   * Whether this person may author (create, edit, retire) a bank, question or
   * assessment tied to a course. Admin and the examinations office run this
   * institution-wide, the same "does not need to teach the course" carve-out
   * examinations.service.ts's canRunExams gives them -- only a plain faculty
   * member is held to "do you actually teach this course", the same check
   * campus.routes.ts's assertCanRunExam applies to editing an exam.
   *
   * A bank/assessment with no course tie at all (institution-wide, `course_id`
   * null) has nothing to scope against -- the STAFF role gate at the route is
   * the whole check for those, same as before this existed.
   */
  async #assertCanAuthor(
    tenantId: number, courseId: number | null | undefined, actor: AssessActor,
  ): Promise<void> {
    if (!courseId) return;
    if (actor.role === 'admin' || actor.role === 'exams') return;
    await this.#academics.assertCanTeach(tenantId, courseId, actor.userId, actor.role);
  }

  // -------------------------------------------------------------------------
  // ASS-01a -- banks and questions
  // -------------------------------------------------------------------------

  async createBank(tenantId: number, actor: AssessActor, input: {
    name: string; description?: string | null; course_id?: number | null;
  }) {
    if (input.course_id) await this.#academics.course(tenantId, input.course_id);
    await this.#assertCanAuthor(tenantId, input.course_id, actor);
    const createdBy = actor.userId;
    const { data, error } = await this.#db.from('onyx_question_banks').insert({
      tenant_id: tenantId,
      course_id: input.course_id ?? null,
      name: input.name.trim(),
      description: input.description ?? null,
      created_by: createdBy,
    }).select(BANK_COLUMNS).maybeSingle();
    if (error) throw new HttpError(500, 'Could not create the bank: ' + error.message);
    return data!;
  }

  async banks(tenantId: number, courseId?: number) {
    let q = this.#db.from('onyx_question_banks').select(BANK_COLUMNS).eq('tenant_id', tenantId);
    if (courseId) q = q.eq('course_id', courseId);
    const { data } = await q.order('id', { ascending: false });
    return data ?? [];
  }

  async addQuestion(tenantId: number, bankId: number, actor: AssessActor, input: {
    type?: OnyxQuestionType; prompt: string;
    options?: { id: string; text: string }[];
    answer?: unknown; explanation?: string | null;
    points?: number; difficulty?: string; tags?: string[];
  }) {
    const bank = await this.#bank(tenantId, bankId);
    await this.#assertCanAuthor(tenantId, bank.course_id as number | null, actor);
    const type = input.type ?? 'single';
    this.#validateQuestion(type, input.options ?? [], input.answer);

    const { data, error } = await this.#db.from('onyx_questions').insert({
      tenant_id: tenantId, bank_id: bankId, type,
      prompt: input.prompt.trim(),
      options: (input.options ?? []) as never,
      answer: (input.answer ?? null) as never,
      explanation: input.explanation ?? null,
      points: input.points ?? 1,
      difficulty: input.difficulty ?? 'medium',
      tags: (input.tags ?? []) as never,
      version: 1,
      status: 'active',
      created_by: actor.userId,
    }).select(QUESTION_COLUMNS).maybeSingle();
    if (error) throw new HttpError(500, 'Could not add the question: ' + error.message);

    await this.#snapshotVersion(tenantId, data!);
    return data!;
  }

  /**
   * Edits a question by writing a NEW version.
   *
   * The old version stays exactly as it was, because a paper somebody has
   * already sat was drawn against it. This is the mechanism behind ASS-01a's
   * acceptance criterion.
   */
  async editQuestion(tenantId: number, questionId: number, actor: AssessActor, input: {
    prompt?: string; options?: { id: string; text: string }[];
    answer?: unknown; explanation?: string | null;
    points?: number; difficulty?: string; tags?: string[]; type?: OnyxQuestionType;
  }) {
    const current = await this.#question(tenantId, questionId);
    await this.#assertCanAuthorQuestion(tenantId, current, actor);
    const type = input.type ?? (current.type as OnyxQuestionType);
    const options = input.options ?? (current.options as unknown as { id: string; text: string }[]);
    const answer = input.answer !== undefined ? input.answer : current.answer;
    this.#validateQuestion(type, options, answer);

    const next = Number(current.version) + 1;
    const { error } = await this.#db.from('onyx_questions').update({
      type,
      prompt: input.prompt?.trim() ?? current.prompt,
      options: options as never,
      answer: answer as never,
      explanation: input.explanation !== undefined ? input.explanation : current.explanation,
      points: input.points ?? current.points,
      difficulty: input.difficulty ?? current.difficulty,
      tags: (input.tags ?? current.tags) as never,
      version: next,
      updated_at: new Date(this.#now()).toISOString(),
    }).eq('tenant_id', tenantId).eq('id', questionId);
    if (error) throw new HttpError(500, 'Could not edit the question: ' + error.message);

    const updated = await this.#question(tenantId, questionId);
    await this.#snapshotVersion(tenantId, updated);
    return updated;
  }

  async retireQuestion(tenantId: number, questionId: number, actor: AssessActor) {
    const current = await this.#question(tenantId, questionId);
    await this.#assertCanAuthorQuestion(tenantId, current, actor);
    // Retired, not deleted: past attempts reference it, and a deleted question
    // would make an old paper unreadable.
    await this.#db.from('onyx_questions')
      .update({ status: 'retired', updated_at: new Date(this.#now()).toISOString() })
      .eq('tenant_id', tenantId).eq('id', questionId);
    return { id: questionId, status: 'retired' };
  }

  /** Resolves a question to its bank's course and applies #assertCanAuthor. */
  async #assertCanAuthorQuestion(
    tenantId: number, question: Record<string, unknown>, actor: AssessActor,
  ): Promise<void> {
    const bank = await this.#bank(tenantId, Number(question.bank_id));
    await this.#assertCanAuthor(tenantId, bank.course_id as number | null, actor);
  }

  /**
   * Authoring view. Staff only -- `answer` is the key to every paper.
   *
   * The bank is loaded first even though the query below is tenant-scoped:
   * without it, a bank id from another institution answers 200 with an empty
   * list, which tells the caller the id is real. "No data leaked" is not the
   * same as "nothing was learned".
   */
  async questions(tenantId: number, bankId: number, filters: {
    difficulty?: string; tag?: string; includeRetired?: boolean;
  } = {}) {
    await this.#bank(tenantId, bankId);
    let q = this.#db.from('onyx_questions')
      .select(QUESTION_COLUMNS).eq('tenant_id', tenantId).eq('bank_id', bankId);
    if (!filters.includeRetired) q = q.eq('status', 'active');
    if (filters.difficulty) q = q.eq('difficulty', filters.difficulty);
    const { data } = await q.order('id');
    let rows = data ?? [];
    if (filters.tag) {
      rows = rows.filter((r) => (r.tags as unknown as string[] ?? []).includes(filters.tag!));
    }
    return rows;
  }

  // -------------------------------------------------------------------------
  // ASS-01b -- assessments
  // -------------------------------------------------------------------------

  async createAssessment(tenantId: number, actor: AssessActor, input: {
    title: string; course_id?: number | null; instructions?: string | null;
    opens_at?: string | null; closes_at?: string | null;
    duration_minutes?: number; attempts_allowed?: number;
    sections?: { id: string; title: string; bank_id: number; take: number }[];
    shuffle_questions?: boolean; shuffle_options?: boolean;
    proctoring?: boolean; require_camera?: boolean; require_screen?: boolean;
    anonymous_marking?: boolean; moderation_required?: boolean;
    pass_mark?: number | null;
  }) {
    if (input.course_id) await this.#academics.course(tenantId, input.course_id);
    await this.#assertCanAuthor(tenantId, input.course_id, actor);
    const createdBy = actor.userId;
    const duration = input.duration_minutes ?? 60;
    if (duration < 1 || duration > 1440) throw new HttpError(422, 'That is not a usable duration.');
    if (input.opens_at && input.closes_at
      && Date.parse(input.closes_at) <= Date.parse(input.opens_at)) {
      throw new HttpError(422, 'The window closes before it opens.');
    }
    await this.#assertSectionsDrawable(tenantId, input.sections ?? []);

    const { data, error } = await this.#db.from('onyx_assessments').insert({
      tenant_id: tenantId,
      course_id: input.course_id ?? null,
      title: input.title.trim(),
      instructions: input.instructions ?? null,
      opens_at: input.opens_at ?? null,
      closes_at: input.closes_at ?? null,
      duration_minutes: duration,
      attempts_allowed: input.attempts_allowed ?? 1,
      sections: (input.sections ?? []) as never,
      shuffle_questions: input.shuffle_questions === false ? 0 : 1,
      shuffle_options: input.shuffle_options === false ? 0 : 1,
      proctoring: input.proctoring ? 1 : 0,
      require_camera: input.require_camera ? 1 : 0,
      require_screen: input.require_screen ? 1 : 0,
      anonymous_marking: input.anonymous_marking === false ? 0 : 1,
      moderation_required: input.moderation_required ? 1 : 0,
      pass_mark: input.pass_mark ?? null,
      status: 'draft',
      // Who set this paper. The first question when one turns out to be wrong.
      created_by: createdBy,
    }).select(ASSESSMENT_COLUMNS).maybeSingle();
    if (error) throw new HttpError(500, 'Could not create the assessment: ' + error.message);
    return data!;
  }

  async assessment(tenantId: number, id: number) {
    const { data } = await this.#db.from('onyx_assessments')
      .select(ASSESSMENT_COLUMNS).eq('tenant_id', tenantId).eq('id', id).maybeSingle();
    if (!data) throw new HttpError(404, 'Assessment not found.');
    return data;
  }

  /** Correct an assessment's own fields -- title, window, pass mark,
   * duration. Auditing happens at the route, the same as this file's other
   * writes (createAssessment, publish) -- this service has no AuditService
   * of its own to call. */
  /**
   * Every section can actually be dealt from its bank.
   *
   * Shared by create and update because the failure it prevents is the same
   * either way, and it is the worst one this module has: without it a paper
   * asking for more questions than its bank holds is accepted quietly and
   * fails at `#dealPaper` -- which is to say, in front of the candidate, at
   * the moment they press Start.
   */
  async #assertSectionsDrawable(
    tenantId: number, sections: { id: string; title: string; bank_id: number; take: number }[],
  ) {
    const ids = new Set<string>();
    for (const section of sections) {
      if (ids.has(section.id)) {
        throw new HttpError(422, 'Two sections share the id "' + section.id + '".');
      }
      ids.add(section.id);
      const bank = await this.#bank(tenantId, section.bank_id);
      const available = await this.questions(tenantId, Number(bank.id));
      if (section.take < 1) throw new HttpError(422, 'A section has to take at least one question.');
      if (section.take > available.length) {
        throw new HttpError(422, '"' + section.title + '" wants ' + section.take
          + ' questions but its bank has ' + available.length + '.');
      }
    }
  }

  /**
   * Correcting a paper.
   *
   * The patchable set used to be six fields, which meant a paper composed
   * wrongly could not be corrected at all: sections, proctoring, attempts,
   * instructions, anonymous marking, moderation and both shuffles were
   * write-once at creation, so the only remedy for a typo in a section was to
   * abandon the paper and build another.
   *
   * The reason for that restraint is real, though, and it is kept -- just
   * moved to where it belongs. **Composition is editable while the paper is a
   * draft and frozen once it is published.** A published paper may have been
   * sat; changing what it draws from underneath an attempt would mean two
   * candidates sitting different papers under one title, and a mark that
   * cannot be defended. Timing, pass mark and title stay editable throughout,
   * because those are the corrections an invigilator legitimately makes to a
   * live paper.
   */
  async updateAssessment(tenantId: number, id: number, actor: AssessActor, patch: {
    title?: string; opens_at?: string | null; closes_at?: string | null;
    pass_mark?: number | null; duration_minutes?: number; status?: string;
    instructions?: string | null; attempts_allowed?: number;
    sections?: { id: string; title: string; bank_id: number; take: number }[];
    shuffle_questions?: boolean; shuffle_options?: boolean;
    proctoring?: boolean; require_camera?: boolean; require_screen?: boolean;
    anonymous_marking?: boolean; moderation_required?: boolean;
  }) {
    const current = await this.assessment(tenantId, id);
    await this.#assertCanAuthor(tenantId, current.course_id as number | null, actor);

    // `status` used to be written through as whatever string arrived. Two
    // consequences, both reachable from the edit form that is the only way to
    // publish an existing draft in the UI: any value at all could land in the
    // column, and flipping to 'published' here skipped the "add at least one
    // section" guard that publishAssessment applies -- so a paper with nothing
    // in it could be published, and the candidate found out at Start.
    if (patch.status !== undefined) {
      if (!ASSESSMENT_STATUSES.includes(patch.status as typeof ASSESSMENT_STATUSES[number])) {
        throw new HttpError(422, 'That is not an assessment status.');
      }
      if (patch.status === 'published') {
        const sections = (current.sections ?? []) as unknown as unknown[];
        if (!sections.length) {
          throw new HttpError(422, 'Add at least one section before publishing.');
        }
      }
    }

    // The window, read across the patch and what is already stored -- checking
    // only the patch let one half be moved past the other in two requests.
    const opensAt = patch.opens_at !== undefined ? patch.opens_at : current.opens_at;
    const closesAt = patch.closes_at !== undefined ? patch.closes_at : current.closes_at;
    if (opensAt && closesAt && Date.parse(String(closesAt)) <= Date.parse(String(opensAt))) {
      throw new HttpError(422, 'The window closes before it opens.');
    }
    if (patch.duration_minutes !== undefined
      && (patch.duration_minutes < 1 || patch.duration_minutes > 1440)) {
      throw new HttpError(422, 'That is not a usable duration.');
    }

    // What may change once candidates can reach it, and what may not.
    const COMPOSITION = ['sections', 'attempts_allowed', 'instructions',
      'shuffle_questions', 'shuffle_options', 'proctoring', 'require_camera',
      'require_screen', 'anonymous_marking', 'moderation_required'] as const;
    const editingComposition = COMPOSITION.some((k) => patch[k] !== undefined);
    if (editingComposition && current.status !== 'draft') {
      throw new HttpError(422,
        'This paper is published. Its questions and settings are fixed; '
        + 'you can still change the title, window and pass mark.');
    }
    if (patch.sections) await this.#assertSectionsDrawable(tenantId, patch.sections);

    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    const BOOLS = ['shuffle_questions', 'shuffle_options', 'proctoring',
      'require_camera', 'require_screen', 'anonymous_marking', 'moderation_required'] as const;
    for (const key of
      ['title', 'opens_at', 'closes_at', 'pass_mark', 'duration_minutes', 'status',
        'instructions', 'attempts_allowed', 'sections', ...BOOLS] as const) {
      const value = patch[key as keyof typeof patch];
      if (value === undefined) continue;
      // Booleans are stored as 0/1, so comparing the incoming `true` against a
      // stored `1` would report a change on every save.
      const stored = (BOOLS as readonly string[]).includes(key)
        ? value ? 1 : 0
        : value;
      if (key === 'sections'
        ? JSON.stringify(value) !== JSON.stringify(current[key])
        : stored !== current[key]) {
        before[key] = current[key]; after[key] = stored;
      }
    }
    if (!Object.keys(after).length) return { assessment: current, before, after };

    const { data, error } = await this.#db.from('onyx_assessments')
      .update({ ...after, updated_at: new Date(this.#now()).toISOString() })
      .eq('tenant_id', tenantId).eq('id', id).select(ASSESSMENT_COLUMNS).maybeSingle();
    if (error) throw new HttpError(500, 'Could not update the assessment: ' + error.message);
    return { assessment: data, before, after };
  }

  /** Override one attempt's score directly -- a dispute or a data-entry fix,
   * separate from mark() below, which is the marker's rubric-driven pass. */
  async overrideScore(tenantId: number, attemptId: number, score: number) {
    const { data: attempt } = await this.#db.from('onyx_assessment_attempts')
      .select('id, tenant_id, max_score, score').eq('tenant_id', tenantId).eq('id', attemptId)
      .maybeSingle();
    if (!attempt) throw new HttpError(404, 'No such attempt.');
    const maxScore = Number(attempt.max_score ?? 0);
    if (maxScore > 0 && (score < 0 || score > maxScore)) {
      throw new HttpError(422, 'A score has to be between 0 and ' + maxScore + '.');
    }
    const before = { score: attempt.score };
    await this.#db.from('onyx_assessment_attempts')
      .update({ score, manual_score: score, updated_at: new Date(this.#now()).toISOString() })
      .eq('id', attemptId);
    return { id: attemptId, score, before };
  }

  async assessments(tenantId: number, role: Role, courseId?: number) {
    const staff = role === 'admin' || role === 'faculty' || role === 'exams';
    let q = this.#db.from('onyx_assessments').select(ASSESSMENT_COLUMNS).eq('tenant_id', tenantId);
    if (!staff) q = q.eq('status', 'published');
    if (courseId) q = q.eq('course_id', courseId);
    const { data } = await q.order('opens_at');
    return data ?? [];
  }

  /** Just the ids, across several courses at once -- a faculty member
   *  teaching more than one course needs every assessment on any of them,
   *  not one course at a time. */
  async assessmentIdsForCourses(tenantId: number, courseIds: number[]): Promise<number[]> {
    if (!courseIds.length) return [];
    const { data } = await this.#db.from('onyx_assessments').select('id')
      .eq('tenant_id', tenantId).in('course_id', courseIds);
    return (data ?? []).map((a) => Number(a.id));
  }

  async publishAssessment(tenantId: number, id: number, actor?: AssessActor) {
    const assessment = await this.assessment(tenantId, id);
    // Optional only so the exam-linked callers that already proved authority
    // need not re-prove it; every route passes one. Without this, publishing
    // was the one authoring act with no course check at all -- any faculty
    // member could publish any paper in the institution, including one for a
    // course they have nothing to do with.
    if (actor) await this.#assertCanAuthor(tenantId, assessment.course_id as number | null, actor);
    const sections = (assessment.sections ?? []) as unknown as { take: number }[];
    if (!sections.length) throw new HttpError(422, 'Add at least one section before publishing.');
    await this.#db.from('onyx_assessments')
      .update({ status: 'published', updated_at: new Date(this.#now()).toISOString() })
      .eq('tenant_id', tenantId).eq('id', id);
    return { ...assessment, status: 'published' };
  }

  // -------------------------------------------------------------------------
  // ASS-01b/c -- sitting one
  // -------------------------------------------------------------------------

  /**
   * Starts an attempt, or resumes the one in progress.
   *
   * Resuming is the same call on purpose: a candidate whose tab died presses
   * the same button, and the paper they get back is the one they were sat.
   */
  async start(tenantId: number, assessmentId: number, userId: string, opts: {
    consent?: boolean;
    /**
     * What the browser says it has running. Checked against require_camera /
     * require_screen below.
     */
    devices?: { camera?: boolean; screen?: boolean };
  } = {}) {
    const assessment = await this.assessment(tenantId, assessmentId);
    if (assessment.status !== 'published') throw new HttpError(404, 'Assessment not found.');
    if (assessment.course_id) {
      await this.#academics.assertEnrolled(tenantId, Number(assessment.course_id), userId);
    }

    const now = this.#now();
    const existing = await this.#attempts(tenantId, assessmentId, userId);
    const live = existing.find((a) => a.status === 'in_progress');
    if (live) {
      // Expiry is decided here, not by whatever the browser thinks the time is.
      if (now > Date.parse(live.expires_at)) {
        await this.#expire(tenantId, Number(live.id));
        throw new HttpError(422, 'That attempt has run out of time.');
      }
      return this.attemptForCandidate(tenantId, Number(live.id), userId);
    }

    if (assessment.opens_at && now < Date.parse(assessment.opens_at)) {
      throw new HttpError(422, 'This assessment has not opened yet.');
    }
    if (assessment.closes_at && now > Date.parse(assessment.closes_at)) {
      throw new HttpError(422, 'This assessment has closed.');
    }
    if (existing.length >= Number(assessment.attempts_allowed)) {
      throw new HttpError(422, 'You have used all your attempts.');
    }
    if (assessment.proctoring && !opts.consent) {
      // Monitoring somebody without asking is not monitoring, it is
      // surveillance. The consent is per attempt and recorded.
      throw new HttpError(422, 'This assessment is proctored and needs your consent to start.');
    }

    // A required device has to be running before a paper is dealt.
    //
    // This used to be enforced only by disabling the Start button, which meant
    // require_camera and require_screen were decoration: POST straight to this
    // route and the paper came back regardless. The browser is still the only
    // thing that can see a camera, so this is the client's word -- but it is now
    // the client's word ON THE RECORD, and the paper is withheld without it,
    // which is the difference between a requirement and a suggestion. Continuous
    // enforcement (the paper blanking when a device stops) lives in the sitting
    // component, because only it is there while the attempt runs.
    if (assessment.proctoring) {
      const devices = opts.devices ?? {};
      if (assessment.require_camera && !devices.camera) {
        throw new HttpError(422, 'This paper requires your camera. Turn it on to start.');
      }
      if (assessment.require_screen && !devices.screen) {
        throw new HttpError(422, 'This paper requires you to share your screen. '
          + 'Share your entire screen to start.');
      }
    }

    const attemptNumber = existing.length + 1;
    const paper = await this.#dealPaper(tenantId, assessment, userId, attemptNumber);
    if (!paper.length) throw new HttpError(422, 'This assessment has no questions.');

    // The clock starts here, and the end is stored rather than computed later.
    let expires = now + Number(assessment.duration_minutes) * 60_000;
    // A window that closes before the duration is up ends the attempt early --
    // otherwise a candidate starting five minutes before close would sit on
    // past it.
    if (assessment.closes_at) expires = Math.min(expires, Date.parse(assessment.closes_at));

    const { data, error } = await this.#db.from('onyx_assessment_attempts').insert({
      tenant_id: tenantId,
      assessment_id: assessmentId,
      user_id: userId,
      attempt: attemptNumber,
      paper: paper as never,
      status: 'in_progress',
      started_at: new Date(now).toISOString(),
      expires_at: new Date(expires).toISOString(),
      max_score: paper.reduce((t, q) => t + q.points, 0),
      consented_at: opts.consent ? new Date(now).toISOString() : null,
    }).select(ATTEMPT_COLUMNS).maybeSingle();
    if (error) throw new HttpError(500, 'Could not start the attempt: ' + error.message);
    return this.attemptForCandidate(tenantId, Number(data!.id), userId);
  }

  /**
   * The attempt as the candidate may see it: the paper, their answers so far,
   * and how long is left according to the server.
   */
  async attemptForCandidate(tenantId: number, attemptId: number, userId: string) {
    const attempt = await this.#attempt(tenantId, attemptId);
    if (String(attempt.user_id) !== userId) throw new HttpError(403, 'That is not your attempt.');

    const answers = await this.#answers(tenantId, attemptId);
    const byQuestion = new Map(answers.map((a) => [Number(a.question_id), a]));
    const paper = (attempt.paper ?? []) as unknown as PaperEntry[];
    const assessment = await this.assessment(tenantId, Number(attempt.assessment_id));
    const released = Boolean(assessment.results_published_at) && attempt.status === 'published';

    return {
      id: attempt.id,
      assessment_id: attempt.assessment_id,
      attempt: attempt.attempt,
      status: attempt.status,
      started_at: attempt.started_at,
      expires_at: attempt.expires_at,
      submitted_at: attempt.submitted_at,
      // Authoritative, and the only number the timer should trust.
      seconds_remaining: attempt.status === 'in_progress'
        ? Math.max(0, Math.round((Date.parse(attempt.expires_at) - this.#now()) / 1000))
        : 0,
      max_score: attempt.max_score,
      // Nothing about the mark until results are published.
      score: released ? attempt.score : null,
      pass_mark: released ? assessment.pass_mark : null,
      questions: paper.map((q) => ({
        question_id: q.question_id,
        type: q.type,
        prompt: q.prompt,
        options: q.options,
        points: q.points,
        section_id: q.section_id,
        response: byQuestion.get(q.question_id)?.response ?? null,
        // Per-question marks are part of the result, so they wait too.
        awarded: released
          ? Number(byQuestion.get(q.question_id)?.auto_points ?? 0)
            + Number(byQuestion.get(q.question_id)?.manual_points ?? 0)
          : null,
      })),
    };
  }

  /**
   * ASS-01c -- autosave.
   *
   * Every answer is written as it is given, so a dropped connection costs
   * nothing. Refused once the server's clock says the attempt is over, which is
   * the other half of "a client clock change cannot extend an attempt".
   */
  async saveAnswer(tenantId: number, attemptId: number, userId: string, input: {
    // Optional because clearing an answer is a real thing a candidate does, and
    // `undefined` from a validator that saw no key means exactly that.
    question_id: number; response?: unknown;
  }) {
    const attempt = await this.#attempt(tenantId, attemptId);
    if (String(attempt.user_id) !== userId) throw new HttpError(403, 'That is not your attempt.');
    if (attempt.status !== 'in_progress') throw new HttpError(422, 'That attempt is finished.');
    if (this.#now() > Date.parse(attempt.expires_at)) {
      await this.#expire(tenantId, attemptId);
      throw new HttpError(422, 'Time is up.');
    }

    const paper = (attempt.paper ?? []) as unknown as PaperEntry[];
    const entry = paper.find((q) => q.question_id === input.question_id);
    // A question not on this paper is not a question this candidate was asked.
    if (!entry) throw new HttpError(422, 'That question is not on your paper.');

    const at = new Date(this.#now()).toISOString();
    const existing = (await this.#answers(tenantId, attemptId))
      .find((a) => Number(a.question_id) === input.question_id);

    if (existing) {
      await this.#db.from('onyx_assessment_answers')
        .update({ response: (input.response ?? null) as never, updated_at: at })
        .eq('id', existing.id);
    } else {
      const { error } = await this.#db.from('onyx_assessment_answers').insert({
        tenant_id: tenantId, attempt_id: attemptId,
        question_id: input.question_id, version: entry.version,
        response: (input.response ?? null) as never,
        answered_at: at, updated_at: at,
      });
      if (error) throw new HttpError(500, 'Could not save your answer: ' + error.message);
    }
    return { saved_at: at, seconds_remaining: Math.max(0,
      Math.round((Date.parse(attempt.expires_at) - this.#now()) / 1000)) };
  }

  /** Hands the paper in and auto-marks everything a machine can. */
  async submit(tenantId: number, attemptId: number, userId: string) {
    const attempt = await this.#attempt(tenantId, attemptId);
    if (String(attempt.user_id) !== userId) throw new HttpError(403, 'That is not your attempt.');
    if (attempt.status !== 'in_progress') throw new HttpError(422, 'That attempt is already in.');
    // A hand-in that arrives after the deadline is an expiry, not a
    // submission. `saveAnswer` already refuses to write past `expires_at`, so
    // nothing about the score changes either way -- but recording it as
    // 'submitted' stamped `submitted_at` at the moment the button was pressed,
    // which is what let a ten-minute paper report four hours of "time taken".
    //
    // `#finalise` directly rather than `#expire`, which returns void: this
    // path still has to hand the caller back the finalised attempt, exactly as
    // the on-time path does.
    if (this.#now() > Date.parse(String(attempt.expires_at))) {
      return this.#finalise(tenantId, attemptId, 'expired');
    }
    return this.#finalise(tenantId, attemptId, 'submitted');
  }

  /**
   * Ends attempts whose time has run out.
   *
   * Called on a sweep as well as on access: a candidate who simply closes the
   * laptop must still have their paper marked, and their answers are already
   * saved.
   */
  async expireOverdue(tenantId: number): Promise<{ expired: number }> {
    const { data } = await this.#db.from('onyx_assessment_attempts')
      .select(ATTEMPT_COLUMNS).eq('tenant_id', tenantId).eq('status', 'in_progress');
    const now = this.#now();
    const overdue = (data ?? []).filter((a) => now > Date.parse(a.expires_at));
    for (const a of overdue) await this.#expire(tenantId, Number(a.id));
    return { expired: overdue.length };
  }

  /**
   * The same sweep, across every institution. What the worker runs.
   *
   * This existed only as a per-tenant call behind a staff endpoint that nothing
   * ever called -- no cron, no worker, no screen. The in-tab timer hands a paper
   * in at zero, so the ordinary path was safe; a candidate whose browser died
   * left an attempt at `in_progress` for ever, and `markingQueue` filters that
   * status out. The paper was never marked and nobody was told.
   *
   * Deliberately NOT tenant-scoped, and the only method here that is not. It
   * runs as the server rather than as a caller, which is why it takes no claims
   * and is not reachable from a route: there is no token that could ask for
   * "every institution", and inventing one would be a hole in the isolation
   * model to serve a background job.
   *
   * One query finds the work. Sweeping every tenant blindly would be one query
   * per institution per tick, most of them returning nothing.
   */
  async expireOverdueEverywhere(): Promise<{ tenants: number; expired: number }> {
    const nowIso = new Date(this.#now()).toISOString();
    const { data } = await this.#db.from('onyx_assessment_attempts')
      .select('id, tenant_id')
      .eq('status', 'in_progress')
      .lt('expires_at', nowIso);

    const rows = data ?? [];
    if (!rows.length) return { tenants: 0, expired: 0 };

    const byTenant = new Map<number, number[]>();
    for (const r of rows) {
      const t = Number(r.tenant_id);
      byTenant.set(t, [...(byTenant.get(t) ?? []), Number(r.id)]);
    }

    let expired = 0;
    for (const [tenantId, ids] of byTenant) {
      for (const id of ids) {
        // One failure must not strand every other candidate's paper. The
        // attempt stays in_progress and the next tick tries again.
        try {
          await this.#expire(tenantId, id);
          expired += 1;
        } catch { /* reported by the caller's onError */ }
      }
    }
    increment('onyx_attempts_expired_total', undefined, expired);
    return { tenants: byTenant.size, expired };
  }

  // -------------------------------------------------------------------------
  // ASS-03 -- marking and moderation
  // -------------------------------------------------------------------------

  /**
   * The marking queue.
   *
   * When the assessment is set to anonymous marking the candidate is not named
   * and not identified: `user_id` is replaced by a per-assessment pseudonym, so
   * a marker can still tell two papers apart without knowing whose they are.
   */
  async markingQueue(tenantId: number, assessmentId: number) {
    const assessment = await this.assessment(tenantId, assessmentId);
    const { data } = await this.#db.from('onyx_assessment_attempts')
      .select(ATTEMPT_COLUMNS)
      .eq('tenant_id', tenantId).eq('assessment_id', assessmentId)
      .neq('status', 'in_progress')
      .order('id');
    const anonymous = Boolean(assessment.anonymous_marking);
    const rows = data ?? [];

    // A paper marked "Names shown" has to show a name. This branch used to
    // hand back the raw `user_id`, which since 0014_auth_uuid_cutover is a
    // Supabase Auth uuid -- so the marking queue for a named paper listed
    // every candidate as a 36-character identifier, on a screen that said in
    // as many words that candidates were named.
    //
    // One lookup, the same shape `seatingPlan()` already uses, and only when
    // it is allowed: under anonymous marking no name is fetched at all rather
    // than fetched and then dropped, so there is nothing in the response for a
    // careless later edit to leak.
    const names = new Map<string, string>();
    if (!anonymous && rows.length) {
      const { data: people } = await this.#db.from('onyx_users').select('id, name')
        .in('id', [...new Set(rows.map((a) => String(a.user_id)))]);
      for (const p of people ?? []) names.set(String(p.id), String(p.name));
    }

    return rows.map((a, i) => ({
      id: a.id,
      attempt: a.attempt,
      status: a.status,
      submitted_at: a.submitted_at,
      auto_score: a.auto_score,
      manual_score: a.manual_score,
      score: a.score,
      max_score: a.max_score,
      integrity_flags: a.integrity_flags,
      integrity_status: a.integrity_status,
      // The whole point of anonymous marking: the grader cannot see whose it is.
      user_id: anonymous ? null : a.user_id,
      candidate: anonymous
        ? 'Candidate ' + (i + 1)
        // Falls back to the id only if the person has no row -- a deleted
        // account, mid-migration data. Never silently blank.
        : names.get(String(a.user_id)) ?? String(a.user_id),
    }));
  }

  /**
   * Every finished attempt's score, keyed by candidate -- for reading across
   * into something else's own marks register (see the exam<->assessment
   * link in campus.routes.ts).
   *
   * Deliberately not the anonymised shape markingQueue() returns: a system
   * pulling scores across already knows exactly whose they are, unlike the
   * human marker anonymous_marking exists to keep unbiased. `score` stays
   * `null`, and is filtered out here, until every subjective question has
   * been marked -- an attempt still waiting on a person is not "0", it is
   * not ready to sync at all.
   */
  async scoredAttempts(tenantId: number, assessmentId: number) {
    const { data } = await this.#db.from('onyx_assessment_attempts')
      .select('user_id, score, max_score')
      .eq('tenant_id', tenantId).eq('assessment_id', assessmentId)
      .neq('status', 'in_progress').not('score', 'is', null);
    return (data ?? []).map((a) => ({
      user_id: String(a.user_id), score: Number(a.score), max_score: Number(a.max_score),
    }));
  }

  /** One paper to mark: the questions, the responses, and what is already awarded. */
  async attemptForMarker(tenantId: number, attemptId: number) {
    const attempt = await this.#attempt(tenantId, attemptId);
    const assessment = await this.assessment(tenantId, Number(attempt.assessment_id));
    const answers = await this.#answers(tenantId, attemptId);
    const byQuestion = new Map(answers.map((a) => [Number(a.question_id), a]));
    const paper = (attempt.paper ?? []) as unknown as PaperEntry[];

    // The answer key comes from the version that was SAT, not the current one.
    const keys = await this.#versionsFor(tenantId, paper);

    return {
      id: attempt.id,
      status: attempt.status,
      auto_score: attempt.auto_score,
      manual_score: attempt.manual_score,
      score: attempt.score,
      max_score: attempt.max_score,
      anonymous: Boolean(assessment.anonymous_marking),
      user_id: assessment.anonymous_marking ? null : attempt.user_id,
      integrity_flags: attempt.integrity_flags,
      questions: paper.map((q) => {
        const answer = byQuestion.get(q.question_id);
        const key = keys.get(q.question_id + ':' + q.version);
        return {
          question_id: q.question_id,
          version: q.version,
          type: q.type,
          prompt: q.prompt,
          options: q.options,
          points: q.points,
          response: answer?.response ?? null,
          // "Objective" here means "actually auto-graded", not just
          // MCQ-shaped: a single/multiple/truefalse/short question authored
          // without a correct answer was never scored by a machine (see
          // #finalise), so it is marked exactly like an essay, not shown as
          // if a key had settled it.
          objective: isObjective(q.type) && hasKey(key?.answer),
          // A marker needs the key; a candidate never sees this method.
          expected: key?.answer ?? null,
          explanation: key?.explanation ?? null,
          auto_points: answer?.auto_points ?? null,
          manual_points: answer?.manual_points ?? null,
          marker_comment: answer?.marker_comment ?? null,
        };
      }),
      grades: await this.grades(tenantId, attemptId),
    };
  }

  /** Awards marks on the subjective questions of one paper. */
  async mark(tenantId: number, attemptId: number, markerId: string, input: {
    role?: MarkRole;
    marks: { question_id: number; points: number; comment?: string | null }[];
    comment?: string | null;
  }) {
    const attempt = await this.#attempt(tenantId, attemptId);
    if (attempt.status === 'in_progress') throw new HttpError(422, 'That attempt is still running.');
    if (attempt.status === 'published') {
      // Changing a mark after release is an appeal, not an edit.
      throw new HttpError(422, 'These results are published and cannot be re-marked.');
    }
    const role: MarkRole = input.role ?? 'first';
    const paper = (attempt.paper ?? []) as unknown as PaperEntry[];
    const byId = new Map(paper.map((q) => [q.question_id, q]));

    for (const m of input.marks) {
      const entry = byId.get(m.question_id);
      if (!entry) throw new HttpError(422, 'That question is not on this paper.');
      if (m.points < 0 || m.points > entry.points) {
        throw new HttpError(422, 'That question is out of ' + entry.points + '.');
      }
    }

    const at = new Date(this.#now()).toISOString();
    const existing = new Map(
      (await this.#answers(tenantId, attemptId)).map((a) => [Number(a.question_id), a]));
    for (const m of input.marks) {
      const row = existing.get(m.question_id);
      if (row) {
        await this.#db.from('onyx_assessment_answers').update({
          manual_points: m.points, marker_comment: m.comment ?? null, updated_at: at,
        }).eq('id', row.id);
      } else {
        // Unanswered questions still get a mark sheet entry, or a zero would be
        // indistinguishable from "not marked yet".
        await this.#db.from('onyx_assessment_answers').insert({
          tenant_id: tenantId, attempt_id: attemptId, question_id: m.question_id,
          version: byId.get(m.question_id)!.version, response: null,
          manual_points: m.points, marker_comment: m.comment ?? null,
          answered_at: at, updated_at: at,
        });
      }
    }

    const manual = input.marks.reduce((t, m) => t + m.points, 0);
    // One mark per role, written explicitly rather than through an upsert
    // conflict clause: a second first-mark is an amendment of the first, and
    // saying so in code is clearer than encoding it in a constraint name.
    const priorGrades = await this.grades(tenantId, attemptId);
    const prior = priorGrades.find((g) => g.role === role);
    if (prior) {
      await this.#db.from('onyx_assessment_grades').update({
        marker_id: markerId, manual_score: manual, comment: input.comment ?? null,
      }).eq('id', prior.id);
    } else {
      const { error } = await this.#db.from('onyx_assessment_grades').insert({
        tenant_id: tenantId, attempt_id: attemptId, role,
        marker_id: markerId, manual_score: manual, comment: input.comment ?? null,
      });
      if (error) throw new HttpError(500, 'Could not record the mark: ' + error.message);
    }

    await this.#recompute(tenantId, attemptId);
    return this.attemptForMarker(tenantId, attemptId);
  }

  /**
   * A candidate's own attempts, across everything they have sat.
   *
   * A score appears only once the attempt is published -- the same rule as the
   * single-attempt view, repeated here rather than assumed, because this is the
   * screen somebody refreshes waiting for results.
   */
  async myAttempts(tenantId: number, userId: string) {
    const { data } = await this.#db.from('onyx_assessment_attempts')
      .select(ATTEMPT_COLUMNS)
      .eq('tenant_id', tenantId).eq('user_id', userId)
      .order('id', { ascending: false });
    const attempts = data ?? [];
    if (!attempts.length) return [];

    const ids = [...new Set(attempts.map((a) => Number(a.assessment_id)))];
    const { data: assessments } = await this.#db.from('onyx_assessments')
      .select(ASSESSMENT_COLUMNS).eq('tenant_id', tenantId).in('id', ids);
    const byId = new Map((assessments ?? []).map((a) => [Number(a.id), a]));

    return attempts.map((a) => {
      const assessment = byId.get(Number(a.assessment_id));
      const released = a.status === 'published' && Boolean(assessment?.results_published_at);
      return {
        attempt_id: Number(a.id),
        assessment_id: Number(a.assessment_id),
        title: assessment?.title ?? '',
        attempt: a.attempt,
        status: a.status,
        submitted_at: a.submitted_at,
        max_score: a.max_score,
        score: released ? a.score : null,
        pass_mark: released ? assessment?.pass_mark ?? null : null,
        passed: released && assessment?.pass_mark !== null && assessment?.pass_mark !== undefined
          ? Number(a.score ?? 0) >= Number(assessment.pass_mark)
          : null,
        results_published: released,
      };
    });
  }

  async grades(tenantId: number, attemptId: number) {
    const { data } = await this.#db.from('onyx_assessment_grades')
      .select(GRADE_COLUMNS).eq('tenant_id', tenantId).eq('attempt_id', attemptId).order('id');
    return data ?? [];
  }

  /**
   * ASS-03b -- publishing.
   *
   * Results are invisible to candidates until this, and moderation is enforced
   * where the assessment asks for it: a second opinion that can be skipped is
   * not a moderation workflow.
   */
  async publishResults(tenantId: number, assessmentId: number) {
    const assessment = await this.assessment(tenantId, assessmentId);
    if (assessment.results_published_at) return { published: 0, already: true };

    const { data } = await this.#db.from('onyx_assessment_attempts')
      .select(ATTEMPT_COLUMNS)
      .eq('tenant_id', tenantId).eq('assessment_id', assessmentId)
      .neq('status', 'in_progress');
    const attempts = data ?? [];
    if (!attempts.length) throw new HttpError(422, 'There is nothing to publish.');

    if (assessment.moderation_required) {
      for (const a of attempts) {
        const roles = (await this.grades(tenantId, Number(a.id))).map((g) => g.role);
        if (!roles.includes('moderation')) {
          throw new HttpError(422, 'Every paper has to be moderated before results are published.');
        }
      }
    }

    const at = new Date(this.#now()).toISOString();
    for (const a of attempts) {
      await this.#recompute(tenantId, Number(a.id));
      await this.#db.from('onyx_assessment_attempts')
        .update({ status: 'published', updated_at: at }).eq('id', a.id);
    }
    await this.#db.from('onyx_assessments')
      .update({ results_published_at: at, status: 'closed', updated_at: at })
      .eq('tenant_id', tenantId).eq('id', assessmentId);
    return { published: attempts.length, already: false };
  }

  // -------------------------------------------------------------------------
  // internals
  // -------------------------------------------------------------------------

  #validateQuestion(type: OnyxQuestionType, options: { id: string; text: string }[], answer: unknown) {
    if (!QUESTION_TYPES.includes(type)) throw new HttpError(422, 'That is not a question type.');
    if (type === 'single' || type === 'multiple') {
      if (options.length < 2) throw new HttpError(422, 'A choice question needs at least two options.');
      const ids = new Set(options.map((o) => o.id));
      if (ids.size !== options.length) throw new HttpError(422, 'Two options share an id.');
    }
    // No key at all is allowed, on any objective-shaped type: the question is
    // then marked by hand instead of auto-graded against an answer nobody
    // actually chose. A key that IS given still has to be real, so a typo
    // can't make a question silently unanswerable.
    if (!hasKey(answer)) return;

    if (type === 'single' || type === 'multiple') {
      const ids = new Set(options.map((o) => o.id));
      const key = type === 'multiple' ? (Array.isArray(answer) ? answer : []) : [answer];
      // An answer that is not one of the options can never be selected, so the
      // question would be unanswerable and nobody would find out until it was
      // sat.
      for (const a of key) {
        if (!ids.has(String(a))) throw new HttpError(422, 'The answer is not one of the options.');
      }
    }
    if (type === 'truefalse' && !['true', 'false'].includes(String(answer))) {
      throw new HttpError(422, 'A true/false question is answered true or false.');
    }
    if (type === 'short') {
      const accepted = Array.isArray(answer) ? answer : [answer];
      if (!accepted.filter((a) => String(a ?? '').trim()).length) {
        throw new HttpError(422, 'A short answer question needs at least one accepted answer.');
      }
    }
  }

  async #snapshotVersion(tenantId: number, question: Record<string, unknown>) {
    const { error } = await this.#db.from('onyx_question_versions').insert({
      tenant_id: tenantId,
      question_id: Number(question.id),
      version: Number(question.version),
      type: String(question.type),
      prompt: String(question.prompt),
      options: (question.options ?? []) as never,
      answer: (question.answer ?? null) as never,
      explanation: (question.explanation ?? null) as never,
      points: Number(question.points),
    });
    if (error) throw new HttpError(500, 'Could not record the question version: ' + error.message);
  }

  /** Draws the paper. Once, at start, seeded so a resume deals the same hand. */
  /**
   * One representative draw of this paper, dealt but not recorded.
   *
   * Everything `start()` does to build a paper, and nothing it does to record
   * one: no attempt row, no timer, no allowance consumed. That distinction is
   * the point -- checking a paper by sitting it costs an attempt, and on a
   * one-attempt paper the author cannot check at all.
   *
   * `PaperEntry` already carries no answer key (it is prompts, options and
   * marks), so this is exactly a candidate's view. With shuffling on it is one
   * of many possible draws, which the screen says rather than implying this is
   * what everyone will get.
   */
  async previewPaper(tenantId: number, id: number, actor: AssessActor) {
    const assessment = await this.assessment(tenantId, id);
    await this.#assertCanAuthor(tenantId, assessment.course_id as number | null, actor);
    const paper = await this.#dealPaper(tenantId, assessment, 'preview:' + actor.userId, 1);
    return {
      assessment_id: Number(assessment.id),
      title: assessment.title,
      duration_minutes: assessment.duration_minutes,
      shuffled: Boolean(assessment.shuffle_questions) || Boolean(assessment.shuffle_options),
      total_points: paper.reduce((n, q) => n + Number(q.points ?? 0), 0),
      questions: paper,
    };
  }

  async #dealPaper(
    tenantId: number, assessment: Record<string, unknown>, userId: string, attemptNumber: number,
  ): Promise<PaperEntry[]> {
    const sections = (assessment.sections ?? []) as unknown as {
      id: string; title: string; bank_id: number; take: number;
    }[];
    const seed = [assessment.id, userId, attemptNumber].join(':');
    const paper: PaperEntry[] = [];

    for (const section of sections) {
      const pool = await this.questions(tenantId, section.bank_id);
      if (pool.length < section.take) {
        throw new HttpError(422, 'Section "' + section.title + '" no longer has enough questions.');
      }
      const chosen = assessment.shuffle_questions
        ? seededShuffle(pool, seed + ':' + section.id).slice(0, section.take)
        : pool.slice(0, section.take);

      for (const q of chosen) {
        const options = (q.options ?? []) as unknown as { id: string; text: string }[];
        paper.push({
          question_id: Number(q.id),
          version: Number(q.version),
          section_id: section.id,
          type: q.type as OnyxQuestionType,
          // Snapshotted, so a later edit cannot change what this paper asked.
          prompt: String(q.prompt),
          options: assessment.shuffle_options
            ? seededShuffle(options, seed + ':' + q.id)
            : options,
          points: Number(q.points),
        });
      }
    }
    // Note: `answer` is deliberately absent. The attempt row is readable by the
    // candidate under RLS, so the key would be one query away.
    return paper;
  }

  async #expire(tenantId: number, attemptId: number) {
    await this.#finalise(tenantId, attemptId, 'expired');
  }

  /** Auto-marks and closes an attempt, however it ended. */
  async #finalise(tenantId: number, attemptId: number, status: 'submitted' | 'expired') {
    const attempt = await this.#attempt(tenantId, attemptId);
    const paper = (attempt.paper ?? []) as unknown as PaperEntry[];
    const answers = await this.#answers(tenantId, attemptId);
    const byQuestion = new Map(answers.map((a) => [Number(a.question_id), a]));
    const keys = await this.#versionsFor(tenantId, paper);

    const at = new Date(this.#now()).toISOString();
    let auto = 0;
    let needsMarking = false;

    for (const q of paper) {
      const answer = byQuestion.get(q.question_id);
      const key = keys.get(q.question_id + ':' + q.version);
      // Essays always need a person. So does an MCQ-shaped question nobody
      // set a correct option on when it was authored -- scoring that against
      // a blank key would mark every response wrong by default, which is not
      // "objective", it's just silent.
      if (!isObjective(q.type) || !hasKey(key?.answer)) {
        if (answer?.response) needsMarking = true;
        continue;
      }
      const points = scoreObjective(q.type, key?.answer, answer?.response ?? null, q.points);
      auto += points;
      if (answer) {
        await this.#db.from('onyx_assessment_answers')
          .update({ auto_points: points, updated_at: at }).eq('id', answer.id);
      } else {
        await this.#db.from('onyx_assessment_answers').insert({
          tenant_id: tenantId, attempt_id: attemptId, question_id: q.question_id,
          version: q.version, response: null, auto_points: 0,
          answered_at: at, updated_at: at,
        });
      }
    }

    await this.#db.from('onyx_assessment_attempts').update({
      status,
      submitted_at: at,
      auto_score: auto,
      // A paper with nothing subjective on it is finished; one with an essay is
      // waiting for a person, and its total is not the final mark yet.
      score: needsMarking ? null : auto,
      updated_at: at,
    }).eq('id', attemptId);

    return this.attemptForCandidate(tenantId, attemptId, String(attempt.user_id));
  }

  /**
   * Recomputes the total from the auto marks and the authoritative grade.
   *
   * Moderation beats a second mark, which beats the first. That order is the
   * whole reason the three are separate rows.
   */
  async #recompute(tenantId: number, attemptId: number) {
    const answers = await this.#answers(tenantId, attemptId);
    // Objective questions are auto-scored, but a marker can now override any
    // question's points (see mark()). Once an answer carries a manual_points
    // override, its auto_points must drop out of the auto total -- otherwise
    // a marked objective question would count twice: once here and once in
    // the authoritative grade's manual_score below.
    const auto = answers.reduce(
      // == null (not ===) so an unset column reads the same whether the
      // driver hands it back as SQL NULL or simply omits the key.
      (t, a) => t + (a.manual_points == null ? Number(a.auto_points ?? 0) : 0),
      0,
    );
    const grades = await this.grades(tenantId, attemptId);
    const authoritative = grades.find((g) => g.role === 'moderation')
      ?? grades.find((g) => g.role === 'second')
      ?? grades.find((g) => g.role === 'first');
    const manual = authoritative ? Number(authoritative.manual_score) : 0;

    await this.#db.from('onyx_assessment_attempts').update({
      auto_score: auto,
      manual_score: authoritative ? manual : null,
      score: auto + manual,
      status: 'graded',
      updated_at: new Date(this.#now()).toISOString(),
    }).eq('id', attemptId);
  }

  /** The question versions a paper was actually sat against. */
  async #versionsFor(tenantId: number, paper: PaperEntry[]) {
    if (!paper.length) return new Map<string, Record<string, unknown>>();
    const ids = [...new Set(paper.map((q) => q.question_id))];
    const { data } = await this.#db.from('onyx_question_versions')
      .select(VERSION_COLUMNS).eq('tenant_id', tenantId).in('question_id', ids);
    return new Map((data ?? []).map((v) => [v.question_id + ':' + v.version, v]));
  }

  async #bank(tenantId: number, id: number) {
    const { data } = await this.#db.from('onyx_question_banks')
      .select(BANK_COLUMNS).eq('tenant_id', tenantId).eq('id', id).maybeSingle();
    if (!data) throw new HttpError(404, 'Question bank not found.');
    return data;
  }

  async #question(tenantId: number, id: number) {
    const { data } = await this.#db.from('onyx_questions')
      .select(QUESTION_COLUMNS).eq('tenant_id', tenantId).eq('id', id).maybeSingle();
    if (!data) throw new HttpError(404, 'Question not found.');
    return data;
  }

  async #attempt(tenantId: number, id: number) {
    const { data } = await this.#db.from('onyx_assessment_attempts')
      .select(ATTEMPT_COLUMNS).eq('tenant_id', tenantId).eq('id', id).maybeSingle();
    if (!data) throw new HttpError(404, 'Attempt not found.');
    return data;
  }

  async #attempts(tenantId: number, assessmentId: number, userId: string) {
    const { data } = await this.#db.from('onyx_assessment_attempts')
      .select(ATTEMPT_COLUMNS)
      .eq('tenant_id', tenantId).eq('assessment_id', assessmentId).eq('user_id', userId)
      .order('attempt');
    return data ?? [];
  }

  async #answers(tenantId: number, attemptId: number) {
    const { data } = await this.#db.from('onyx_assessment_answers')
      .select(ANSWER_COLUMNS).eq('tenant_id', tenantId).eq('attempt_id', attemptId);
    return data ?? [];
  }
}
