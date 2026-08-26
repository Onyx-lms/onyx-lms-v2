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
import { authorsOf, type Author } from './authorship.ts';
import { HttpError } from '../http/errors.ts';
import { isForSection } from './sections.service.ts';
import { setIndexFor } from './paper-variants.ts';
import { increment } from './metrics.ts';
import { peopleFor, labelFor, type Person } from './directory.ts';
import type { AcademicsService } from './academics.service.ts';

const BANK_COLUMNS = 'id, tenant_id, course_id, name, description, created_by, created_at';
// eslint-disable-next-line max-len -- one literal: a concatenated select collapses the row type.
const QUESTION_COLUMNS = 'id, tenant_id, bank_id, set_number, type, prompt, options, answer, explanation, points, difficulty, tags, version, status, problem_id, created_at';
const VERSION_COLUMNS = 'id, tenant_id, question_id, version, type, prompt, options, answer, explanation, points, problem_id';
const ASSESSMENT_COLUMNS = 'id, tenant_id, course_id, section_id, title, instructions, opens_at, closes_at, duration_minutes, attempts_allowed, sections, shuffle_questions, shuffle_options, proctoring, require_camera, require_screen, watch_camera, instant_results, anonymous_marking, moderation_required, breach_limit, pass_mark, status, results_published_at, created_by, created_at';
const ATTEMPT_COLUMNS = 'id, tenant_id, assessment_id, user_id, attempt, paper, status, started_at, expires_at, submitted_at, auto_score, manual_score, score, max_score, consented_at, integrity_flags, integrity_status, terminated_at, terminated_reason, remaining_ms, breach_count, reinstated_at, reinstated_by, updated_at';
const ANSWER_COLUMNS = 'id, tenant_id, attempt_id, question_id, version, response, auto_points, manual_points, marker_comment, flagged_for_review, submission_id, updated_at';
const GRADE_COLUMNS = 'id, tenant_id, attempt_id, role, marker_id, manual_score, comment, created_at';

/** The only values `status` may hold. Named so a patch can be checked. */
export const ASSESSMENT_STATUSES = ['draft', 'published', 'closed'] as const;

export const QUESTION_TYPES = [
  'single', 'multiple', 'truefalse', 'short', 'essay', 'code', 'web',
] as const;
export type OnyxQuestionType = (typeof QUESTION_TYPES)[number];

/**
 * Types a machine CAN mark **from a key**, given one was set.
 *
 * `code` is machine-marked too, but not from a key -- it is marked by running
 * the linked problem's test suite in the sandbox. Keeping it out of this list
 * is the point: `isObjective` means "scoreObjective can decide this", and
 * scoreObjective cannot execute anything. Code scoring has its own path.
 */
const OBJECTIVE: OnyxQuestionType[] = ['single', 'multiple', 'truefalse', 'short'];

/**
 * The three files a web question is answered in.
 *
 * Fixed, and deliberately: a candidate under exam conditions should not be
 * deciding on a file layout, and a marker opening thirty submissions should
 * find the same three tabs in the same order every time. The entry document
 * comes first because it is the one that has to exist.
 */
export const WEB_FILES = ['index.html', 'index.css', 'index.js'] as const;
export type WebFiles = Record<string, string>;

/**
 * A web answer in the one shape a preview can be built from, or nothing.
 *
 * The same rule `normaliseCodeAnswer` follows and for the same reason: a
 * response of the wrong shape is a client that has misunderstood the question,
 * and the honest answers are "render it" or "refuse it" -- never "store it and
 * mark it zero", which is a candidate's work silently lost.
 *
 * Unknown paths are dropped rather than kept. The preview composes exactly the
 * three files above; anything else would be stored, never rendered, and
 * marked against a page that did not include it.
 */
export function normaliseWebAnswer(response: unknown): WebFiles | null {
  if (!response || typeof response !== 'object') return null;
  const given = (response as { files?: unknown }).files ?? response;
  if (!given || typeof given !== 'object' || Array.isArray(given)) return null;
  const source = given as Record<string, unknown>;
  const out: WebFiles = {};
  for (const path of WEB_FILES) {
    const value = source[path];
    if (typeof value === 'string') out[path] = value;
  }
  // Nothing recognisable at all is a misunderstanding, not an empty answer:
  // a candidate who wrote nothing still sends three empty strings.
  return Object.keys(out).length ? out : null;
}
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

/**
 * A code answer in the one shape the sandbox can run, or nothing.
 *
 * The sitting screen sends `{ language, source }` and always has. Anything
 * else reaching this method is a client that has misunderstood the question
 * type, and the honest answers are "run it" or "refuse it" -- never "store it
 * and mark it zero", which is what happened before this existed.
 *
 * A bare string is accepted where the problem allows exactly one language,
 * because there is then nothing to guess: the language is the only one the
 * problem has. Where a problem accepts several, picking one for the candidate
 * would compile Python as C++ and score the honest zero the old path scored,
 * so it is refused with a message saying what is missing instead.
 */
export function normaliseCodeAnswer(
  response: unknown, languages: readonly string[],
): { language: string; source: string } | null {
  if (typeof response === 'string') {
    return languages.length === 1 ? { language: languages[0]!, source: response } : null;
  }
  if (!response || typeof response !== 'object') return null;
  const given = response as { language?: unknown; source?: unknown };
  if (typeof given.source !== 'string') return null;
  const language = typeof given.language === 'string' && given.language.trim()
    ? given.language
    : languages[0];
  // A problem with no languages at all cannot be compiled against anything.
  if (!language) return null;
  return { language, source: given.source };
}

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
  /**
   * `code` only: what the candidate needs in front of them to write an answer.
   *
   * Snapshotted onto the paper like everything else, so editing the problem
   * afterwards does not change what was asked -- the same rule that already
   * governs prompts and marks. Never the hidden tests, and never the worked
   * solution: this is the candidate's view.
   */
  problem?: {
    id: number;
    /** `code` runs against tests; `web` is three files and a preview. */
    kind?: 'code' | 'web';
    title: string;
    statement: string | null;
    languages: string[];
    /**
     * For `code`, keyed by language. For `web`, keyed by path -- the files the
     * candidate starts from, snapshotted onto the paper like everything else
     * so editing the problem afterwards does not change what was asked.
     */
    starter_code: Record<string, string>;
    /** `web` only: which file the preview renders. */
    preview_entry?: string;
    time_limit_ms: number;
  };
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

/**
 * What marking a code question needs from Code Lab.
 *
 * Narrow on purpose, and injected rather than imported: the assessment engine
 * must not grow a hard dependency on the sandbox, because most institutions
 * never set a code question and every test in this file would then need a
 * runner. Absent, code questions still author, still deal and still sit -- they
 * simply wait for a person, exactly as an essay does.
 */
export interface CodeGrader {
  /** Records a candidate's code against a problem and queues it for grading. */
  submit(tenantId: number, problemId: number, userId: string,
    input: { language: string; source: string; mode?: string }): Promise<{ id: number }>;
  /** Grades one submission now, rather than waiting for the queue to reach it. */
  gradeNow(tenantId: number, submissionId: number): Promise<void>;
  /** What a submission scored, or null if it is not graded yet. */
  scoreOf(tenantId: number, submissionId: number):
  Promise<{ status: string; score: number; max_score: number } | null>;
}

/** What each question type is called on a printed script. */
const QUESTION_LABELS: Record<string, string> = {
  single: 'Multiple choice',
  multiple: 'Multiple choice (several answers)',
  truefalse: 'True or false',
  short: 'Short answer',
  essay: 'Descriptive',
  code: 'Programming',
  web: 'Web page',
};

/**
 * An answer as a reader sees it, not as it is stored.
 *
 * A choice question stores option ids -- "b", or ["a","c"] -- which mean
 * nothing on paper. Printing the id and not the text is the difference between
 * a script somebody can check and a column of letters, so the option text is
 * looked up and the id kept beside it for anyone comparing against the paper.
 */
function renderAnswer(type: string, value: unknown, options: unknown): string {
  if (value === null || value === undefined || value === '') return '';
  const list = Array.isArray(options)
    ? (options as { id?: unknown; text?: unknown }[]) : [];
  const label = (id: unknown) => {
    const found = list.find((o) => String(o.id) === String(id));
    return found ? String(id).toUpperCase() + '.  ' + String(found.text) : String(id);
  };
  if (type === 'single' || type === 'truefalse') return label(value);
  if (type === 'multiple') {
    return (Array.isArray(value) ? value : [value]).map(label).join('   ');
  }
  if (type === 'short') {
    return (Array.isArray(value) ? value : [value]).map((v) => String(v)).join('   /   ');
  }
  // A code or web answer is printed as source, not here.
  if (type === 'code' || type === 'web') return '';
  return String(value);
}

/**
 * What one question earned, from whichever view the caller was given.
 *
 * Null only when nothing has been marked at all: zero is a mark somebody was
 * given, and printing a dash for it would tell a candidate their answer had
 * not been looked at.
 */
function awardedOf(q: Record<string, unknown>): number | null {
  if (q.awarded !== undefined && q.awarded !== null) return Number(q.awarded);
  const auto = q.auto_points;
  const manual = q.manual_points;
  if ((auto === undefined || auto === null) && (manual === undefined || manual === null)) {
    return null;
  }
  return Number(auto ?? 0) + Number(manual ?? 0);
}

/** The source a candidate submitted, where the answer is a code submission. */
function codeOf(response: unknown): string {
  if (!response || typeof response !== 'object') return '';
  const r = response as { source?: unknown; language?: unknown };
  if (typeof r.source !== 'string') return '';
  const lang = typeof r.language === 'string' && r.language ? r.language : '';
  return (lang ? '// ' + lang + '\n' : '') + r.source;
}

/**
 * A web answer as one printable listing.
 *
 * Three files with their names above them, in the order they are edited, so a
 * printed script reads the way the screen did. A page cannot be printed as a
 * page -- so what goes on paper is what was written, and the marker who wants
 * to see it rendered opens the submission instead.
 */
function webOf(response: unknown): string {
  const files = normaliseWebAnswer(response);
  if (!files) return '';
  return WEB_FILES
    .filter((path) => files[path] !== undefined)
    .map((path) => '/* ' + path + ' */\n' + (files[path] ?? '').trimEnd())
    .join('\n\n');
}

export class AssessService {
  #db: OnyxDb;
  #academics: AcademicsService;
  #now: () => number;
  #code: CodeGrader | null;

  constructor(db: OnyxDb, academics: AcademicsService, now: () => number = Date.now,
    code: CodeGrader | null = null) {
    this.#db = db;
    this.#academics = academics;
    this.#now = now;
    this.#code = code;
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
    const rows = data ?? [];
    if (!rows.length) return rows.map((b) => ({
      ...b, question_count: 0, needs_marking: 0, set_count: 0,
      author: null as Author | null,
    }));

    /*
     * The three facts a setter asks about a bank before using it.
     *
     * How many SETS it holds decides whether it can be scheduled as parallel
     * papers at all; how many questions, whether the sets are the same size;
     * and how many need a person, whether results appear at hand-in or wait.
     * All three used to require opening the bank and counting, on the
     * institution's own screens -- the console had them and this did not.
     *
     * One query for every bank rather than one per bank: an institution with
     * forty banks was forty round trips to answer a question about a list.
     */
    // eslint-disable-next-line max-len -- one literal; a concatenated select collapses the row type.
    const { data: questions } = await this.#db.from('onyx_questions').select('id, bank_id, status, type, answer, set_number').eq('tenant_id', tenantId);

    const counts = new Map<number, number>();
    const human = new Map<number, number>();
    const setsOf = new Map<number, Set<number>>();
    for (const question of questions ?? []) {
      if (Number(question.status) === 0) continue;   // retired: not drawable
      const key = Number(question.bank_id);
      counts.set(key, (counts.get(key) ?? 0) + 1);
      setsOf.set(key, (setsOf.get(key) ?? new Set()).add(Number(question.set_number ?? 1)));
      // The same two tests `#finalise` applies, in the same order: a type no
      // machine can judge, or an objective type with nothing to judge against.
      if (!isObjective(String(question.type)) || !hasKey(question.answer)) {
        human.set(key, (human.get(key) ?? 0) + 1);
      }
    }
    /*
     * And who wrote it.
     *
     * `created_by` has been on this table since 0004 and nothing ever read it,
     * so a list of forty banks was forty anonymous rows. "Who set this" is the
     * first thing anybody says when a question turns out to be wrong.
     */
    const authors = await authorsOf(this.#db, tenantId, rows.map((b) => b.created_by));
    return rows.map((b) => ({
      ...b,
      question_count: counts.get(Number(b.id)) ?? 0,
      needs_marking: human.get(Number(b.id)) ?? 0,
      set_count: (setsOf.get(Number(b.id)) ?? new Set()).size,
      author: (b.created_by && authors.get(String(b.created_by))) || null,
    }));
  }

  async addQuestion(tenantId: number, bankId: number, actor: AssessActor, input: {
    type?: OnyxQuestionType; prompt: string;
    options?: { id: string; text: string }[];
    answer?: unknown; explanation?: string | null;
    points?: number; difficulty?: string; tags?: string[];
    problem_id?: number | null;
    /**
     * Which parallel set this question belongs to.
     *
     * Absent means Set 1, which is where every question written before sets
     * existed lives and where a setter who only wants one paper stays.
     */
    set_number?: number;
  }) {
    const bank = await this.#bank(tenantId, bankId);
    await this.#assertCanAuthor(tenantId, bank.course_id as number | null, actor);
    const type = input.type ?? 'single';
    this.#validateQuestion(type, input.options ?? [], input.answer);
    if (type === 'code') {
      if (!input.problem_id) throw new HttpError(422, 'A code question needs a problem.');
      await this.#assertProblemMarkable(tenantId, input.problem_id);
    }
    if (type === 'web') {
      if (!input.problem_id) {
        throw new HttpError(422, 'A web question needs a problem to build from.');
      }
      await this.#assertProblemPreviewable(tenantId, input.problem_id);
    }

    const { data, error } = await this.#db.from('onyx_questions').insert({
      tenant_id: tenantId, bank_id: bankId, type,
      // 1 unless told otherwise: a bank nobody has divided is a one-set bank,
      // and deals exactly as it always did.
      set_number: Math.max(1, Math.min(50, Math.trunc(Number(input.set_number ?? 1)) || 1)),
      problem_id: type === 'code' || type === 'web' ? input.problem_id : null,
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
    problem_id?: number | null;
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

    const problemId = input.problem_id !== undefined ? input.problem_id : current.problem_id;
    if (type === 'code') {
      if (!problemId) throw new HttpError(422, 'A code question needs a problem.');
      await this.#assertProblemMarkable(tenantId, Number(problemId));
    }
    if (type === 'web' && problemId) {
      await this.#assertProblemPreviewable(tenantId, Number(problemId));
    }

    const next = Number(current.version) + 1;
    const { error } = await this.#db.from('onyx_questions').update({
      type,
      problem_id: type === 'code' ? problemId : null,
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
  /**
   * The parallel sets a bank holds, and what is in each.
   *
   * A set is a whole paper: a setter writes Set 1, Set 2 and so on, each of the
   * same shape and comparable difficulty, and the sets rotate down the register
   * so that neighbours never sit the same one. This is what a scheduling screen
   * needs to show before anybody schedules anything -- "this bank has 10 sets
   * of 5" is the fact that decides whether it is ready.
   *
   * Reported even for a bank nobody has divided: one set of everything, which
   * is exactly what such a bank is and how it has always been dealt.
   */
  async bankSets(tenantId: number, bankId: number) {
    const all = await this.questions(tenantId, bankId);
    const by = new Map<number, typeof all>();
    for (const q of all) {
      const n = Number(q.set_number ?? 1);
      by.set(n, [...(by.get(n) ?? []), q]);
    }
    return [...by.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([set_number, questions]) => ({
        set_number,
        count: questions.length,
        marks: questions.reduce((n, q) => n + Number(q.points ?? 0), 0),
        // The shape, so a setter can see at a glance that Set 3 is missing its
        // coding question while the others have one.
        by_type: questions.reduce((acc: Record<string, number>, q) => {
          const t = String(q.type);
          acc[t] = (acc[t] ?? 0) + 1;
          return acc;
        }, {}),
      }));
  }

  async questions(tenantId: number, bankId: number, filters: {
    difficulty?: string; tag?: string; includeRetired?: boolean;
    /** One parallel set of the bank. Absent means every set. */
    setNumber?: number;
  } = {}) {
    await this.#bank(tenantId, bankId);
    let q = this.#db.from('onyx_questions')
      .select(QUESTION_COLUMNS).eq('tenant_id', tenantId).eq('bank_id', bankId);
    if (!filters.includeRetired) q = q.eq('status', 'active');
    if (filters.difficulty) q = q.eq('difficulty', filters.difficulty);
    if (filters.setNumber !== undefined) q = q.eq('set_number', filters.setNumber);
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

  /**
   * A section id that really belongs to this institution, or null.
   *
   * Checked rather than trusted, for the reason every id crossing this
   * boundary is: a section id from another institution would set a paper for a
   * division nobody here is in, and the paper would then be invisible to
   * everybody without ever looking broken.
   */
  async #sectionOfThisInstitution(
    tenantId: number, sectionId: number | null | undefined,
  ): Promise<number | null> {
    if (sectionId == null) return null;
    const { data } = await this.#db.from('onyx_sections')
      .select('id').eq('tenant_id', tenantId).eq('id', Number(sectionId)).maybeSingle();
    if (!data) throw new HttpError(404, 'No such section at this institution.');
    return Number(sectionId);
  }

  async createAssessment(tenantId: number, actor: AssessActor, input: {
    title: string; course_id?: number | null; instructions?: string | null;
    opens_at?: string | null; closes_at?: string | null;
    duration_minutes?: number; attempts_allowed?: number;
    sections?: { id: string; title: string; bank_id: number; take: number }[];
    /**
     * The teaching division this paper is set for. Null means every one.
     *
     * The console could set it and the institution's own staff could not,
     * which made "set this test for Alpha-CSE only" a thing a lecturer had to
     * ask the platform to do for them. The column and the visibility rule both
     * already existed (0038, `isForSection`); only the way in was missing.
     */
    section_id?: number | null;
    /**
     * How many times a candidate may leave the paper before it is handed in
     * for them. Zero is off, and off is what every paper written before this
     * rule existed does.
     */
    breach_limit?: number;
    shuffle_questions?: boolean; shuffle_options?: boolean;
    proctoring?: boolean; require_camera?: boolean; require_screen?: boolean;
    watch_camera?: boolean;
    instant_results?: boolean;
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
    const sectionId = await this.#sectionOfThisInstitution(tenantId, input.section_id);

    const { data, error } = await this.#db.from('onyx_assessments').insert({
      tenant_id: tenantId,
      course_id: input.course_id ?? null,
      section_id: sectionId,
      breach_limit: input.breach_limit ?? 3,
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
      // ASS-02b. A paper is not watchable unless somebody said so.
      watch_camera: Boolean(input.watch_camera),
      // On unless a paper-setter deliberately turns it off (0035). A paper
      // that says nothing gets its marks back at submit.
      instant_results: input.instant_results === undefined
        ? true
        : Boolean(input.instant_results),
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
    watch_camera?: boolean;
    instant_results?: boolean;
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
    /*
     * `instant_results` sits here with the rest of the settings a published
     * paper freezes.
     *
     * It was briefly kept off this list so it could be switched on after
     * publication -- which mattered only while it was off by default and every
     * existing paper needed turning on by hand. Migration 0035 turned them all
     * on instead, so the reason is gone and the general rule applies again:
     * what candidates are promised when they sit a paper does not change
     * underneath the ones who have already sat it.
     */
    const COMPOSITION = ['sections', 'attempts_allowed', 'instructions',
      'shuffle_questions', 'shuffle_options', 'proctoring', 'require_camera',
      'require_screen', 'watch_camera', 'instant_results',
      'anonymous_marking', 'moderation_required'] as const;
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
      'require_camera', 'require_screen', 'watch_camera', 'instant_results',
      'anonymous_marking',
      'moderation_required'] as const;
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

  /**
   * The papers a caller may see.
   *
   * `sectionId` is the reader's own teaching division and filters what a
   * LEARNER is shown: a paper set for one section is for the people in it and
   * nobody else, while a paper with no section is for everybody — which is
   * what every row created before sections existed means and must keep
   * meaning. Staff are never filtered by it: they set the papers, and have no
   * section of their own.
   *
   * `undefined` rather than a missing argument for the staff case, so a caller
   * that forgets to pass it does not silently hide every sectioned paper from
   * a learner — the visible failure is better than the invisible one.
   */
  /** The reader's own section. One column, so it is read here rather than by
   *  taking a dependency on the sections service for it. */
  async #sectionOf(tenantId: number, userId: string): Promise<number | null> {
    const { data } = await this.#db.from('onyx_memberships')
      .select('section_id').eq('tenant_id', tenantId).eq('user_id', userId)
      .eq('status', 1).maybeSingle();
    return data?.section_id == null ? null : Number(data.section_id);
  }

  async assessments(tenantId: number, role: Role, courseId?: number,
    sectionId?: number | null) {
    const staff = role === 'admin' || role === 'faculty' || role === 'exams';
    let q = this.#db.from('onyx_assessments').select(ASSESSMENT_COLUMNS).eq('tenant_id', tenantId);
    if (!staff) q = q.eq('status', 'published');
    if (courseId) q = q.eq('course_id', courseId);
    const { data } = await q.order('opens_at');
    const all = data ?? [];
    const rows = staff || sectionId === undefined
      ? all
      : all.filter((a) => isForSection(a.section_id as number | null, sectionId));

    /*
     * Who set each paper, for staff only.
     *
     * A candidate has no business knowing which lecturer wrote their paper --
     * on an anonymously marked one that is the whole point -- so the byline is
     * attached after the visibility filter and only for the people who
     * schedule, mark and moderate.
     */
    if (!staff) return rows.map((a) => ({ ...a, author: null as Author | null }));
    const authors = await authorsOf(this.#db, tenantId, rows.map((a) => a.created_by));
    return rows.map((a) => ({
      ...a,
      author: (a.created_by && authors.get(String(a.created_by))) || null,
    }));
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

    /*
     * A paper set for another section is not theirs to sit.
     *
     * Checked here and not only on the list. The list is what a candidate
     * SEES; this is what they can actually start, and a paper's id is a small
     * number that appears in a URL. Without this, a candidate who guessed one
     * could sit another section's examination — and the two sections very
     * often sit different papers on the same course.
     */
    if (assessment.section_id != null) {
      const mine = await this.#sectionOf(tenantId, userId);
      if (!isForSection(assessment.section_id as number | null, mine)) {
        throw new HttpError(403, 'This paper is set for another section.');
      }
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
      // Written rather than left to the column default: this is the number the
      // departure rule counts against, and a row that reads `null` because
      // nothing filled it in is a row whose first departure is its third.
      breach_count: 0,
    }).select(ATTEMPT_COLUMNS).maybeSingle();
    if (error) throw new HttpError(500, 'Could not start the attempt: ' + error.message);
    return this.attemptForCandidate(tenantId, Number(data!.id), userId);
  }

  /**
   * The attempt as the candidate may see it: the paper, their answers so far,
   * and how long is left according to the server.
   */
  /**
   * One script, in the shape the PDF builder takes.
   *
   * Assembled from `attemptForCandidate` or `attemptForMarker` rather than from
   * a third query, deliberately: those two already decide what each reader may
   * see, and the hardest rule in this file lives inside one of them. A
   * candidate is shown the answer key only once they have no sittings left --
   * a paper allowing two attempts that hands over the key after the first is a
   * paper whose second attempt means nothing, and banks are shared between
   * papers, so a key given away early leaks into other papers drawn from it.
   *
   * Reading the answers again here would be a second, quieter path to the same
   * data with none of that reasoning applied. So the document is built from
   * whichever view the caller was already entitled to, and a field the reader
   * may not see is simply absent from it.
   *
   * `viewer` is the candidate for their own copy, or null for a marker's.
   */
  /**
   * One attempt row, for a caller that must know its paper before acting.
   *
   * A thin public read over the private one, so a route can check that the
   * person asking may teach this course BEFORE the script is assembled --
   * building it first and checking afterwards would do the work for somebody
   * about to be refused, and it is the assembly that touches the answers.
   */
  async attemptRow(tenantId: number, attemptId: number) {
    return this.#attempt(tenantId, attemptId);
  }

  async scriptFor(tenantId: number, attemptId: number, viewer: string | null) {
    const attempt = await this.#attempt(tenantId, attemptId);
    const assessment = await this.assessment(tenantId, Number(attempt.assessment_id));
    const view = viewer
      ? await this.attemptForCandidate(tenantId, attemptId, viewer)
      : await this.attemptForMarker(tenantId, attemptId);

    const course = assessment.course_id
      ? (await this.#db.from('onyx_courses').select('code, title')
        .eq('tenant_id', tenantId).eq('id', assessment.course_id).maybeSingle()).data
      : null;

    /*
     * The candidate's name, unless the paper is marked anonymously.
     *
     * On a MARKER's copy that anonymity is the point -- `attemptForMarker`
     * already withholds the user id for such a paper. On the candidate's own
     * copy it is their own script and their own name, which anonymity was
     * never meant to hide from them.
     */
    let candidate = { name: '', roll: '' };
    const subject = viewer ?? (view as { user_id?: string | null }).user_id ?? null;
    if (subject) {
      const [{ data: user }, { data: membership }] = await Promise.all([
        this.#db.from('onyx_users').select('name').eq('id', subject).maybeSingle(),
        this.#db.from('onyx_memberships').select('roll_number')
          .eq('tenant_id', tenantId).eq('user_id', subject).maybeSingle(),
      ]);
      candidate = {
        name: user?.name ? String(user.name) : '',
        roll: membership?.roll_number ? String(membership.roll_number) : '',
      };
    }

    const questions = ((view as { questions?: unknown[] }).questions ?? []).map((raw, i) => {
      const q = raw as Record<string, unknown>;
      return {
        number: i + 1,
        type: QUESTION_LABELS[String(q.type)] ?? String(q.type),
        prompt: String(q.prompt ?? ''),
        answer: renderAnswer(q.type as string, q.response, q.options),
        // Absent, not blank-because-unknown: `expected` is only ever populated
        // on a view whose reader is entitled to it.
        expected: renderAnswer(q.type as string, q.expected, q.options),
        // Both kinds print as source. A page cannot be printed as a page, so
        // what goes on paper is what was written -- three files, named -- and
        // a marker who wants it rendered opens the submission instead.
        code: String(q.type) === 'web' ? webOf(q.response) : codeOf(q.response),
        /*
         * The two views name the mark differently, and both are handled.
         *
         * A candidate's view carries `awarded` -- one number, already the sum
         * -- because that is all a candidate is shown. A marker's carries
         * `auto_points` and `manual_points` separately, because a marker acts
         * on them separately. Reading only the first printed a dash on every
         * marker's copy, which reads as "nobody has marked this" on a script
         * that was fully marked.
         */
        awarded: awardedOf(q),
        points: Number(q.points ?? 0),
        comment: String(q.comment ?? q.marker_comment ?? ''),
      };
    });

    return {
      institution: '',
      assessment: String(assessment.title),
      course: course ? String(course.code) + ' — ' + String(course.title) : '',
      candidate: candidate.name,
      rollNumber: candidate.roll,
      attemptNumber: Number(attempt.attempt ?? 1),
      startedAt: attempt.started_at ? String(attempt.started_at) : '',
      submittedAt: attempt.submitted_at ? String(attempt.submitted_at) : '',
      score: (view as { score?: number | null }).score ?? null,
      maxScore: Number(attempt.max_score ?? 0),
      status: String(attempt.status),
      questions,
    };
  }

  /** Every script on one paper, for the marker who wants them all at once. */
  async scriptsFor(tenantId: number, assessmentId: number) {
    const { data } = await this.#db.from('onyx_assessment_attempts')
      .select('id, status').eq('tenant_id', tenantId).eq('assessment_id', assessmentId)
      .order('id');
    const out = [];
    for (const row of data ?? []) {
      // An attempt still in progress has nothing to report and would print a
      // page of blanks between two real scripts.
      if (String(row.status) === 'in_progress') continue;
      out.push(await this.scriptFor(tenantId, Number(row.id), null));
    }
    return out;
  }

  async attemptForCandidate(tenantId: number, attemptId: number, userId: string) {
    const attempt = await this.#attempt(tenantId, attemptId);
    if (String(attempt.user_id) !== userId) throw new HttpError(403, 'That is not your attempt.');

    const answers = await this.#answers(tenantId, attemptId);
    const byQuestion = new Map(answers.map((a) => [Number(a.question_id), a]));
    const paper = (attempt.paper ?? []) as unknown as PaperEntry[];
    const assessment = await this.assessment(tenantId, Number(attempt.assessment_id));
    const released = AssessService.releasedToCandidate(attempt, assessment);

    // The keys this paper was sat against, for marking each answer right or
    // wrong on the review screen. Read only once the result is out -- before
    // that this method must not so much as load them.
    const keys = released
      ? await this.#versionsFor(tenantId, paper)
      : new Map<string, Record<string, unknown>>();

    /*
     * Whether the candidate may see the CORRECT answers, as opposed to their
     * own and what they scored.
     *
     * Only once they have no sittings left. A paper that allows two attempts
     * and hands over the answer key after the first is a paper whose second
     * attempt means nothing -- and question banks are shared between papers,
     * so a key given away early leaks into other papers drawn from the same
     * bank. Every LMS that shows answers makes this conditional; this is the
     * condition, and it needs no setting because the paper already states how
     * many attempts it allows.
     */
    const { data: sat } = await this.#db.from('onyx_assessment_attempts')
      .select('id').eq('tenant_id', tenantId)
      .eq('assessment_id', Number(attempt.assessment_id)).eq('user_id', userId);
    const used = (sat ?? []).length;
    const showKey = released && used >= Number(assessment.attempts_allowed ?? 1);

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
        // Snapshotted on the paper, so it travels with the attempt. Carries no
        // tests and no solution -- see #dealPaper.
        problem: q.problem,
        response: byQuestion.get(q.question_id)?.response ?? null,
        /*
         * Right or wrong, where that is a fact rather than an opinion.
         *
         * Only for a question a machine actually marked -- an essay has no
         * "correct", and an MCQ-shaped question authored without a key was
         * never scored against one either (see #finalise). Both come back
         * null, so the screen says "marked" rather than inventing a verdict.
         */
        correct: released && isObjective(q.type)
          && hasKey(keys.get(q.question_id + ':' + q.version)?.answer)
          ? Number(byQuestion.get(q.question_id)?.auto_points ?? 0) >= Number(q.points)
          : null,
        // The key itself, and only when there is no sitting left to spoil.
        expected: showKey
          ? keys.get(q.question_id + ':' + q.version)?.answer ?? null : null,
        explanation: showKey
          ? keys.get(q.question_id + ':' + q.version)?.explanation ?? null : null,
        // Per-question marks are part of the result, so they wait too.
        awarded: released
          ? Number(byQuestion.get(q.question_id)?.auto_points ?? 0)
            + Number(byQuestion.get(q.question_id)?.manual_points ?? 0)
          : null,
        /*
         * What the marker wrote against this answer.
         *
         * The marking form has written `marker_comment` per question since
         * marking existed, and nothing has ever served it -- so a marker
         * explaining why an essay lost four marks was writing to nobody. It
         * is the one part of a result somebody can actually learn from, and
         * it was the part being withheld.
         *
         * Gated on `released` with the marks, because a comment is a mark in
         * prose: "you have misread the question" before the paper is out
         * tells a candidate their score early, and does it in a form no
         * moderation pass can quietly revise first.
         */
        comment: released
          ? byQuestion.get(q.question_id)?.marker_comment ?? null
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

    // A code answer is a Code Lab submission, not a value. Recorded through the
    // same path a practice submission takes, so it is graded by the same tests
    // in the same sandbox -- there is no second grader to disagree with the
    // first. `mode: 'submit'` runs the hidden cases too; a Run would only check
    // what the candidate can already see.
    let submissionId: number | null = existing ? Number(existing.submission_id ?? 0) || null : null;
    /*
     * A web answer is checked for shape and then simply stored.
     *
     * There is no sandbox in this branch because there is nothing to run: the
     * page is rendered in the marker's own browser, and the mark is a person's
     * judgement of it. What IS worth doing is the same refusal the code path
     * makes -- a response of the wrong shape is a client misunderstanding the
     * question, and storing it would lose the candidate's work behind a shrug.
     */
    if (entry.type === 'web' && input.response !== undefined && input.response !== null) {
      if (!normaliseWebAnswer(input.response)) {
        throw new HttpError(422,
          'A web answer is the three files this question is built from. Nothing else was '
          + 'saved, so try again rather than leaving it as it is.');
      }
    }

    if (entry.type === 'code' && entry.problem?.id && this.#code && input.response) {
      const given = normaliseCodeAnswer(input.response, entry.problem.languages ?? []);
      /*
       * A code answer that cannot be graded is refused, not stored.
       *
       * This branch used to test `given.source` and fall through when there
       * was none -- so a response of the wrong shape (a bare string from a
       * client that thought code was text, say) was written to the answer
       * row with no submission behind it, and the candidate was told their
       * answer was saved. It was: as an ungradeable blob. `#finalise` then
       * sent the attempt to a marker with that question at zero and nothing
       * anywhere saying why, which is the worst of the three possible
       * outcomes -- worse than refusing, and worse than guessing.
       *
       * So it is refused, and the message names the shape. The candidate's
       * client can retry with their work intact; nothing about their attempt
       * is spent. `normaliseCodeAnswer` is generous first: a bare string is
       * accepted whole where the problem allows exactly one language, because
       * there is nothing to guess at then.
       */
      if (!given) {
        throw new HttpError(422,
          'That is not a code submission. Send the language you are writing in '
          + 'and your program, and it will be run against the tests.');
      }
      if (given.source.trim()) {
        const made = await this.#code.submit(tenantId, entry.problem.id, userId, {
          language: given.language,
          source: given.source,
          mode: 'submit',
        });
        submissionId = Number(made.id);
      }
    }

    if (existing) {
      await this.#db.from('onyx_assessment_answers')
        .update({
          response: (input.response ?? null) as never,
          submission_id: submissionId as never,
          updated_at: at,
        })
        .eq('id', existing.id);
    } else {
      const { error } = await this.#db.from('onyx_assessment_answers').insert({
        tenant_id: tenantId, attempt_id: attemptId,
        question_id: input.question_id, version: entry.version,
        response: (input.response ?? null) as never,
        submission_id: submissionId as never,
        answered_at: at, updated_at: at,
      });
      if (error) throw new HttpError(500, 'Could not save your answer: ' + error.message);
    }
    return { saved_at: at, seconds_remaining: Math.max(0,
      Math.round((Date.parse(attempt.expires_at) - this.#now()) / 1000)) };
  }

  /** Hands the paper in and auto-marks everything a machine can. */
  /**
   * Remove a paper, unless somebody has sat it.
   *
   * There was no way to remove one at all from the institution's side: a paper
   * created by mistake, or a draft that drew nothing and never would, stayed on
   * the list for ever with an Edit button and nothing else. The console could
   * delete one, so the rule already existed -- in the console's own service,
   * where the institution's routes could not reach it.
   *
   * **A sitting is somebody's work.** Once a candidate has started, their
   * answers and their marks hang off this row, and deleting it takes both with
   * them. That is not a decision for whoever is tidying a list, so it is
   * refused by count with the number said out loud, and the way to stop a paper
   * nobody should sit any more is to close its window.
   *
   * The check is a SELECT rather than a foreign key, deliberately: a database
   * error surfaced to a lecturer as "violates constraint
   * onyx_assessment_attempts_assessment_id_fkey" tells them nothing about what
   * to do instead.
   */
  async deleteAssessment(tenantId: number, assessmentId: number) {
    const assessment = await this.assessment(tenantId, assessmentId);

    const { data: attempts } = await this.#db.from('onyx_assessment_attempts')
      .select('id').eq('tenant_id', tenantId).eq('assessment_id', assessmentId);
    const sat = (attempts ?? []).length;
    if (sat) {
      throw new HttpError(422, sat + (sat === 1 ? ' candidate has' : ' candidates have')
        + ' sat this paper. Close its window instead — deleting it would take their '
        + 'answers and their marks with it.');
    }

    const { error } = await this.#db.from('onyx_assessments')
      .delete().eq('tenant_id', tenantId).eq('id', assessmentId);
    if (error) throw new HttpError(500, 'Could not remove that paper: ' + error.message);
    return { id: assessmentId, removed: true, title: String(assessment.title) };
  }

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
    // With the roll number, because a script has one at the top and a marker
    // works through a pile in that order. Still nothing at all under anonymous
    // marking: not fetched rather than fetched and dropped, so there is
    // nothing in the response for a careless later edit to leak.
    const people = anonymous
      ? new Map<string, Person>()
      : await peopleFor(this.#db, tenantId, rows.map((a) => a.user_id));

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
        // "CS-2024-014 · Ada Lovelace" where a number exists, the name alone
        // where it does not. Never the raw id, which is what this used to be.
        : labelFor(people.get(String(a.user_id)), String(a.user_id)),
      roll_number: anonymous ? null : people.get(String(a.user_id))?.roll_number ?? null,
      // Withheld under anonymous marking with the name and the number: a
      // cohort split into three sections of a hundred is not identified by
      // its section, but on a small option it can be, and anonymity that
      // leaks through one column is not anonymity.
      section: anonymous ? null : people.get(String(a.user_id))?.section ?? null,
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
  /** One candidate's name, for a marker who is allowed to know it. */
  async #candidate(tenantId: number, userId: string) {
    const { data } = await this.#db.from('onyx_users')
      .select('id, name, email').eq('id', userId).maybeSingle();
    void tenantId;
    return data ? { name: String(data.name), email: String(data.email) } : null;
  }

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
      /*
       * The candidate's NAME when marking is not anonymous, and nothing at all
       * when it is. A marker was given a UUID and had to look it up elsewhere,
       * which is both slower and worse: an identifier a person cannot read is
       * an identifier they can mis-transcribe.
       *
       * Anonymity is decided in exactly one place -- here -- rather than by
       * each page remembering to check the flag. A screen that forgets leaks
       * the thing the whole feature exists to hide.
       */
      candidate: assessment.anonymous_marking
        ? null
        : await this.#candidate(tenantId, String(attempt.user_id)),
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
    /*
     * A released mark can still be corrected, and after 0035 it has to be.
     *
     * This used to refuse outright -- "changing a mark after release is an
     * appeal, not an edit" -- and that held while `published` meant a person
     * had decided to release. It no longer does: an auto-marked attempt is
     * published the moment it is handed in, so refusing here would mean that
     * every machine-marked paper in the product became permanently
     * uncorrectable at the instant of submission. A marker who spots a bad key,
     * or awards marks on a question the sandbox misjudged, would have no way
     * in at all.
     *
     * So marking a released attempt is allowed, `#recompute` runs as usual, and
     * the candidate sees the corrected figure rather than the old one. It stays
     * an amendment rather than a quiet edit: the route that calls this records
     * an audit entry either way, and the attempt keeps its published status
     * rather than being pulled back out of sight.
     */
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
      const released = AssessService.releasedToCandidate(a, assessment);
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

  /**
   * A code question is legal only if the problem behind it can actually mark
   * it: it must exist in this institution, be published, and have test cases.
   *
   * Checked at authoring because the alternative is finding out at deal time,
   * in front of a candidate -- the same reason section sizes are checked when
   * a paper is composed rather than when it is sat.
   */
  async #assertProblemMarkable(tenantId: number, problemId: number) {
    const { data: problem } = await this.#db.from('onyx_problems')
      .select('id, title, status').eq('tenant_id', tenantId).eq('id', problemId).maybeSingle();
    if (!problem) throw new HttpError(422, 'That problem does not exist.');
    if (problem.status !== 'published') {
      throw new HttpError(422, 'A code question needs a published problem: "'
        + problem.title + '" is still a draft.');
    }
    const { data: tests } = await this.#db.from('onyx_problem_tests')
      .select('id').eq('tenant_id', tenantId).eq('problem_id', problemId);
    if (!(tests ?? []).length) {
      throw new HttpError(422, '"' + problem.title + '" has no test cases, so nothing '
        + 'could mark an answer to it.');
    }
    return problem;
  }

  /**
   * A problem a web question can actually be built from.
   *
   * The web twin of `#assertProblemMarkable`, and it checks a different thing
   * on purpose. A code problem must have TESTS, because nothing else could
   * mark an answer to it. A web problem must have an ENTRY DOCUMENT, because
   * nothing else could render one -- a preview with no index.html is a blank
   * frame, and a candidate would find that out after starting the paper.
   *
   * It must also be a web problem. Binding a web question to a code problem
   * would put a Python starter in three HTML tabs and mark it by hand.
   */
  async #assertProblemPreviewable(tenantId: number, problemId: number) {
    const { data: problem } = await this.#db.from('onyx_problems')
      .select('id, title, status, kind, starter_code, preview_entry')
      .eq('tenant_id', tenantId).eq('id', problemId).maybeSingle();
    if (!problem) throw new HttpError(422, 'That problem does not exist.');
    if (problem.kind !== 'web') {
      throw new HttpError(422, '"' + problem.title + '" is a programming problem, not a web '
        + 'one. A web question is answered with HTML, CSS and JavaScript.');
    }
    if (problem.status !== 'published') {
      throw new HttpError(422, 'A web question needs a published problem: "'
        + problem.title + '" is still a draft.');
    }
    const files = (problem.starter_code ?? {}) as unknown as Record<string, string>;
    const entry = String(problem.preview_entry ?? 'index.html');
    if (typeof files[entry] !== 'string') {
      throw new HttpError(422, '"' + problem.title + '" has no ' + entry
        + ', so there would be nothing to preview.');
    }
    return problem;
  }

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
      problem_id: (question.problem_id ?? null) as never,
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

    /*
     * The candidate's roll number, for the variant they sit.
     *
     * Read once for the whole paper rather than per section: every section of
     * one paper deals the same variant to the same candidate, or a "variant 3"
     * would mean something different in each half of the script.
     */
    const { data: membership } = await this.#db.from('onyx_memberships')
      .select('roll_number').eq('tenant_id', tenantId).eq('user_id', userId).maybeSingle();
    const roll = membership?.roll_number ? String(membership.roll_number) : null;

    for (const section of sections) {
      const pool = await this.questions(tenantId, section.bank_id);
      if (!pool.length) {
        throw new HttpError(422, 'Section "' + section.title + '" no longer has any questions.');
      }

      /*
       * The candidate sits ONE SET of the bank, chosen by their roll number.
       *
       * A set is a whole paper the setter wrote: Set 1, Set 2, and so on, each
       * of the same shape and comparable difficulty. They rotate down the
       * register -- roll 1 sits Set 1, roll 2 sits Set 2, roll 11 comes back
       * round to Set 1 -- so nobody within reach of a neighbour holds the same
       * paper. Sets share no questions because the setter put different
       * questions in them, which is a stronger guarantee than any sampling can
       * give and, more to the point, is a judgement only the setter can make:
       * two papers are parallel when a person says they are.
       *
       * What was here dealt `take` questions sampled from the whole bank per
       * candidate. That produced variety and no guarantee -- two independent
       * draws of five from thirty overlap about six times in ten -- and it took
       * the sets away from the setter entirely.
       *
       * A bank nobody has divided is a one-set bank and deals exactly as it
       * always did: everybody sits Set 1.
       */
      const sets = [...new Set(pool.map((q) => Number(q.set_number ?? 1)))]
        .sort((a, b) => a - b);
      const setNumber = sets[setIndexFor(roll, userId, sets.length)] ?? sets[0]!;
      const inSet = pool.filter((q) => Number(q.set_number ?? 1) === setNumber);

      /*
       * `take` still caps, and is still honoured.
       *
       * A one-set bank of forty with a paper of five is the old arrangement
       * and must keep working; there, `take` is the whole composition. Where a
       * setter has written sets, `take` is normally the size of a set and the
       * cap does nothing -- but a set larger than `take` is sampled rather than
       * truncated, so a five-question paper from a seven-question set is not
       * always the same five.
       */
      const ordered = assessment.shuffle_questions
        ? seededShuffle(inSet, 'set:' + assessment.id + ':' + section.id + ':' + setNumber)
        : inSet;
      const chosen = section.take > 0 && section.take < ordered.length
        ? ordered.slice(0, section.take)
        : ordered;
      if (!chosen.length) {
        throw new HttpError(422, 'Set ' + setNumber + ' of "' + section.title
          + '" has no questions in it.');
      }

      for (const q of chosen) {
        const options = (q.options ?? []) as unknown as { id: string; text: string }[];
        const entry: PaperEntry = {
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
        };

        // A code question needs the problem in front of the candidate --
        // statement, languages, starter code. Snapshotted with everything else
        // so editing the problem afterwards does not change what was asked.
        // The tests are NOT here: hidden cases are the whole value of an
        // auto-graded coding question, and the attempt row is readable by the
        // candidate.
        // A web question needs the same thing for the same reason: the three
        // files it starts from are what the candidate opens, and they are
        // snapshotted so an edit to the problem cannot change a paper being
        // sat. There are no hidden tests to withhold on a web problem -- there
        // are no tests at all; a person marks it.
        if ((q.type === 'code' || q.type === 'web') && q.problem_id) {
          const { data: problem } = await this.#db.from('onyx_problems')
            .select('id, kind, title, statement, languages, starter_code, preview_entry, time_limit_ms')
            .eq('tenant_id', tenantId).eq('id', Number(q.problem_id)).maybeSingle();
          if (problem) {
            entry.problem = {
              id: Number(problem.id),
              kind: (problem.kind === 'web' ? 'web' : 'code'),
              title: String(problem.title),
              statement: (problem.statement ?? null) as string | null,
              languages: (problem.languages ?? []) as unknown as string[],
              starter_code: (problem.starter_code ?? {}) as unknown as Record<string, string>,
              preview_entry: String(problem.preview_entry ?? 'index.html'),
              time_limit_ms: Number(problem.time_limit_ms ?? 5000),
            };
          }
        }
        paper.push(entry);
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
  /**
   * May the candidate see this attempt's mark yet?
   *
   * The one definition, because there were three identical copies of it --
   * `myAttempts`, `attemptForCandidate` and GuardianService -- and a release
   * rule that is written down three times is a release rule that will
   * eventually disagree with itself about whose marks are visible.
   *
   * The attempt must be at `published` either way. What the paper adds is WHY:
   * `results_published_at` is somebody having released it for everyone, and
   * `instant_results` is the paper having said in advance that an
   * auto-marked attempt may be handed straight back. Requiring the attempt
   * status in both cases keeps the two from drifting apart -- nothing is
   * visible that was not deliberately published, whichever route it took.
   */
  static releasedToCandidate(
    attempt: { status?: unknown },
    assessment: { results_published_at?: unknown; instant_results?: unknown } | null | undefined,
  ): boolean {
    if (String(attempt?.status) !== 'published') return false;
    return Boolean(assessment?.results_published_at) || Boolean(assessment?.instant_results);
  }

  async #finalise(
    tenantId: number, attemptId: number, status: 'submitted' | 'expired' | 'terminated',
  ) {
    const attempt = await this.#attempt(tenantId, attemptId);
    // Needed for the release decision at the end of this method, and read here
    // rather than there so there is one read whichever branch is taken.
    const assessment = await this.assessment(tenantId, Number(attempt.assessment_id));
    const paper = (attempt.paper ?? []) as unknown as PaperEntry[];
    const answers = await this.#answers(tenantId, attemptId);
    const byQuestion = new Map(answers.map((a) => [Number(a.question_id), a]));
    const keys = await this.#versionsFor(tenantId, paper);

    const at = new Date(this.#now()).toISOString();
    let auto = 0;
    let needsMarking = false;
    /** Does anything on this paper need a person, whoever sat it? See below. */
    let humanMarkable = false;

    for (const q of paper) {
      const answer = byQuestion.get(q.question_id);
      const key = keys.get(q.question_id + ':' + q.version);

      // A code question is marked by running the problem's tests, not against
      // a key. The submission is graded here and now rather than left to the
      // queue, so the candidate's mark is complete when they hand in -- an
      // exam that says "come back later, we are still running your code" is
      // not an exam anybody wants to sit.
      if (q.type === 'code') {
        const submissionId = answer?.submission_id ? Number(answer.submission_id) : null;
        if (!submissionId || !this.#code) {
          // Answered but ungradable -- no sandbox configured, or no code
          // written. Either way a person decides, exactly as for an essay.
          if (!this.#code) humanMarkable = true;   // no sandbox: never machine-markable
          if (answer?.response) needsMarking = true;
          continue;
        }
        try {
          await this.#code.gradeNow(tenantId, submissionId);
        } catch {
          // The sandbox being down must not cost the candidate their paper.
          // The submission stays on record and a marker can award by hand.
        }
        const result = await this.#code.scoreOf(tenantId, submissionId);
        if (!result || result.status !== 'done' || result.max_score <= 0) {
          // The sandbox could not judge it, so a person must -- and a mark
          // that is waiting for a person is not one to hand back at submit.
          needsMarking = true;
          humanMarkable = true;
          continue;
        }
        // Proportional to the tests that passed, scaled to what the question
        // is worth on THIS paper -- the problem's own weighting decides which
        // cases matter, the question decides how much the whole thing counts.
        const points = Math.round((result.score / result.max_score) * q.points * 100) / 100;
        auto += points;
        if (answer) {
          await this.#db.from('onyx_assessment_answers')
            .update({ auto_points: points, updated_at: at }).eq('id', answer.id);
        }
        continue;
      }

      // Essays always need a person. So does an MCQ-shaped question nobody
      // set a correct option on when it was authored -- scoring that against
      // a blank key would mark every response wrong by default, which is not
      // "objective", it's just silent.
      if (!isObjective(q.type) || !hasKey(key?.answer)) {
        // Whether a MARKER is needed for THIS attempt depends on whether the
        // candidate wrote anything. Whether the PAPER can be marked by machine
        // does not -- and that is the question the instant release turns on.
        // A candidate who skips the essay must not get a different experience
        // from one who attempts it: both are sitting a paper with an essay on
        // it, and it is the paper that decides.
        humanMarkable = true;
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

    /*
     * Hand the score back now, when there is genuinely nothing left to decide.
     *
     * Three conditions, and every one of them has to hold:
     *
     *   * the paper says so (`instant_results`) -- releasing a mark the moment
     *     it is earned tells the first candidate to finish which answers were
     *     right, and on a paper with an open window that is a leak. Whether
     *     that trade is worth making belongs to the institution;
     *   * nothing awaits a human (`!needsMarking`) -- an essay, an unkeyed
     *     short answer or a code question the sandbox could not judge all
     *     leave `score` null, and there is no number to show;
     *   * the paper does not require moderation -- a mark that must be
     *     moderated before release is by definition not final at submission.
     *
     * Only the ATTEMPT is published, never the assessment: `results_published_at`
     * releases a paper for everybody at once and closes marking for good, which
     * is a decision for a person and not a side effect of one candidate
     * finishing early.
     */
    const instant = Boolean(assessment.instant_results)
      && !needsMarking
      && !humanMarkable
      && !assessment.moderation_required
      /*
       * NEVER for a paper that was stopped.
       *
       * A stopped paper is scored so an invigilator can see where the
       * candidate had got to -- but handing that mark to the candidate would
       * give away the marking of a paper they may be about to carry on
       * sitting. It is the one ending where the score exists and must not be
       * shown.
       */
      && status !== 'terminated';

    await this.#db.from('onyx_assessment_attempts').update({
      status: instant ? 'published' : status,
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
   * Stops a paper because the candidate left it too many times.
   *
   * The rule is stated on the paper (`breach_limit`) and applied by the
   * proctor service, which counts the departures; this is only the effect. It
   * does three things and the order matters:
   *
   *   * the time left is written down FIRST, because `expires_at` is an
   *     absolute instant and it keeps running while an invigilator decides
   *     whether to let them carry on. Without this, "continue from where you
   *     were" would mean "continue with however long the argument took";
   *   * the paper is scored, exactly as a hand-in is, so the invigilation
   *     console shows a real mark rather than an empty row -- and if nobody
   *     reinstates it, that mark is what the candidate gets, which is what
   *     "it is handed in" means;
   *   * the status is `terminated`, which the release rule does not accept, so
   *     the candidate is shown that they were stopped and NOT what they
   *     scored.
   *
   * Answers are untouched. Everything the candidate wrote is still there,
   * which is the whole point of being able to put them back.
   */
  async terminateForBreach(tenantId: number, attemptId: number, reason = 'breach') {
    const attempt = await this.#attempt(tenantId, attemptId);
    if (String(attempt.status) !== 'in_progress') return attempt;

    const left = Math.max(0, Date.parse(String(attempt.expires_at)) - this.#now());
    await this.#db.from('onyx_assessment_attempts').update({
      remaining_ms: left,
      terminated_at: new Date(this.#now()).toISOString(),
      terminated_reason: reason,
    }).eq('id', attemptId);

    await this.#finalise(tenantId, attemptId, 'terminated');
    return await this.#attempt(tenantId, attemptId);
  }

  /**
   * Lets a stopped candidate carry on, from exactly where they were.
   *
   * An invigilator looking at a stopped paper is deciding one thing: was that
   * a person cheating, or a person whose screen reader stole focus three
   * times. Where it was the second, the answer cannot be "start again" -- so
   * this restores the attempt rather than making a new one:
   *
   *   * the same row, so every answer they had written is still against it;
   *   * `expires_at` set to now plus the minutes they had left, so they get
   *     back what they had and not a minute more -- however long the decision
   *     took;
   *   * the provisional score cleared, because the paper is not finished and a
   *     mark against an unfinished paper is a mark that will be wrong;
   *   * the breach count reset, so the warnings start again. Reinstating
   *     somebody into their third and final strike would be reinstating them
   *     into being stopped by the next notification, which is not a decision
   *     anybody meant to take.
   *
   * Who did it is recorded. Overriding an automatic rule is exactly the kind
   * of act that has to be answerable afterwards.
   */
  async reinstate(tenantId: number, attemptId: number, actor: { userId: string }) {
    const attempt = await this.#attempt(tenantId, attemptId);
    if (!attempt.terminated_at) {
      throw new HttpError(422, 'That attempt was not stopped, so there is nothing to restore.');
    }
    const assessment = await this.assessment(tenantId, Number(attempt.assessment_id));
    if (assessment.status !== 'published') {
      throw new HttpError(422, 'That paper is no longer open, so nobody can carry on sitting it.');
    }
    /*
     * A minute is the floor, not zero.
     *
     * Somebody stopped on their last breath of time would be reinstated
     * straight back into an expired paper -- a click that appears to do
     * nothing. If there is genuinely no time left, say so instead.
     */
    const left = Number(attempt.remaining_ms ?? 0);
    if (left < 1000) {
      throw new HttpError(422,
        'There was no time left on that attempt when it was stopped, so there is nothing '
        + 'to carry on with. Its marks stand as they are.');
    }

    const at = new Date(this.#now()).toISOString();
    await this.#db.from('onyx_assessment_attempts').update({
      status: 'in_progress',
      expires_at: new Date(this.#now() + left).toISOString(),
      submitted_at: null,
      auto_score: null,
      manual_score: null,
      score: null,
      terminated_at: null,
      terminated_reason: null,
      remaining_ms: null,
      breach_count: 0,
      reinstated_at: at,
      reinstated_by: actor.userId,
      updated_at: at,
    }).eq('id', attemptId);

    return await this.#attempt(tenantId, attemptId);
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

    /*
     * An attempt that is already released stays released.
     *
     * This used to set 'graded' unconditionally, which was harmless while
     * nothing was published until a person published it. After 0035 an
     * auto-marked attempt is published at submit, so a marker correcting one
     * would have moved it from 'published' back to 'graded' -- and
     * `releasedToCandidate` requires 'published', so the candidate's result
     * would have silently DISAPPEARED at the exact moment somebody improved
     * it. A correction has to change the number, not withdraw it.
     */
    /*
     * A marked script is a released script.
     *
     * There used to be a second step: a marker awarded the marks, the attempt
     * settled at `graded`, and somebody then pressed Publish to release the
     * whole paper at once. That button is gone at the client's request, and
     * this is what has to change with it -- `releasedToCandidate` requires
     * `published`, so without this a hand-marked result would sit at `graded`
     * for ever and never reach the candidate it was written for.
     *
     * So marking IS the release, per script rather than per paper. A marker
     * who saves has decided; a candidate whose script has been marked can see
     * it; and a paper half-marked releases the half that is done rather than
     * holding everybody until the last one is finished.
     *
     * Moderation still overrides afterwards -- `#recompute` runs again and the
     * authoritative grade wins -- and a correction changes the number in place
     * rather than withdrawing it, which is the behaviour the `published`
     * branch was already protecting.
     */
    const status = 'published';

    await this.#db.from('onyx_assessment_attempts').update({
      auto_score: auto,
      manual_score: authoritative ? manual : null,
      score: auto + manual,
      status,
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
