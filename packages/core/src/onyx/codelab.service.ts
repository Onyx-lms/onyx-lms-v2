/**
 * LAB-03 / LAB-04 -- the evaluator and the problem bank.
 *
 * "Test-case based grading with hidden tests, partial scoring and instant
 * feedback on submissions."
 *
 * The rule that shapes every method here: **a hidden test case is the answer
 * key.** Its stdin, its expected output and the actual output a submission
 * produced for it all reveal the answer, so none of the three ever appears in a
 * learner-facing response. The service is where that is enforced, not the
 * route, because a second route added later would otherwise have to remember.
 *
 * Grading is queued (LAB-02b). A submission is created `queued` and returns
 * immediately; the worker fills it in. That is what makes 200 at once a latency
 * problem rather than a correctness one.
 */
import type { OnyxDb } from './db.ts';
import type { Role } from '@onyx/types';
import { HttpError } from '../http/errors.ts';
// The one definition of what a web answer is, so a practice submission and an
// examination answer cannot disagree about the shape of the same three files.
import { normaliseWebAnswer } from './assess.service.ts';
// The one definition of the page a web problem starts from -- shared with the
// editor, so what a candidate opens is what the API seeded.
import { startingFiles } from './web-starter.ts';
import { slugify } from '../authoring/slug.ts';
import { peopleFor, UNKNOWN_PERSON } from './directory.ts';
import type { AcademicsService } from './academics.service.ts';
import type { QueueService } from './queue.service.ts';
import {
  DEFAULT_LIMITS, LANGUAGES,
  type ExecutionProvider, type Language, type RunResult,
} from './execution.provider.ts';

/** What a problem is answered with. See 0041's header for why these differ. */
export type ProblemKind = 'code' | 'web';

const PROBLEM_COLUMNS = 'id, tenant_id, course_id, kind, title, slug, statement, difficulty, topic, tags, languages, starter_code, preview_entry, time_limit_ms, memory_limit_kb, solution_rule, solution_after_attempts, solution_after, status, created_by, created_at';
const TEST_COLUMNS = 'id, tenant_id, problem_id, name, stdin, expected_stdout, is_hidden, weight, sort';
const HINT_COLUMNS = 'id, tenant_id, problem_id, body, sort, penalty_percent';
const SUBMISSION_COLUMNS = 'id, tenant_id, problem_id, user_id, language, source, mode, status, score, max_score, passed, total, compile_output, error, runtime_ms, memory_kb, queued_at, graded_at, kind, files';
/** What a filtered feed of submissions needs. Deliberately without `source`. */
const FEED_COLUMNS = 'id, tenant_id, problem_id, user_id, language, mode, status, score, max_score, passed, total, error, runtime_ms, memory_kb, queued_at, graded_at';
const CASE_COLUMNS = 'id, tenant_id, submission_id, test_id, name, is_hidden, passed, weight, runtime_ms, memory_kb, stdout, error';

export const DIFFICULTIES = ['easy', 'medium', 'hard'] as const;
export const SOLUTION_RULES = ['never', 'after_solve', 'after_attempts', 'after_date'] as const;

export type Difficulty = (typeof DIFFICULTIES)[number];
export type SolutionRule = (typeof SOLUTION_RULES)[number];

/** A test case as a learner may see it: no input, no expected output, ever. */
function publicTest(t: Record<string, unknown>) {
  return {
    id: t.id,
    name: t.name,
    is_hidden: t.is_hidden,
    weight: t.weight,
    // A visible case exists to show what the problem means, so its input and
    // expected output are part of the statement. A hidden one shows nothing.
    stdin: t.is_hidden ? null : t.stdin,
    expected_stdout: t.is_hidden ? null : t.expected_stdout,
  };
}

/** A per-case result as a learner may see it. */
function publicCase(c: Record<string, unknown>) {
  const hidden = Boolean(c.is_hidden);
  return {
    id: c.id,
    name: c.name,
    is_hidden: c.is_hidden,
    passed: c.passed,
    weight: c.weight,
    runtime_ms: c.runtime_ms,
    memory_kb: c.memory_kb,
    // Whether it passed is the feedback. What it printed would be the answer.
    stdout: hidden ? null : c.stdout,
    error: hidden ? null : c.error,
  };
}

/**
 * Compares output the way a grader should.
 *
 * Trailing whitespace and line endings are an artefact of how somebody printed
 * something, not a wrong answer -- failing a correct solution over `\r\n` is
 * the fastest way to lose a learner's trust in the grader.
 */
export function outputMatches(actual: string, expected: string): boolean {
  const normalise = (s: string) => (s ?? '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n+$/, '');
  return normalise(actual) === normalise(expected);
}

export class CodeLabService {
  #db: OnyxDb;
  #academics: AcademicsService;
  #queue: QueueService;
  #provider: ExecutionProvider;
  #now: () => number;

  constructor(
    db: OnyxDb, academics: AcademicsService, queue: QueueService,
    provider: ExecutionProvider, now: () => number = Date.now,
  ) {
    this.#db = db;
    this.#academics = academics;
    this.#queue = queue;
    this.#provider = provider;
    this.#now = now;
  }

  // ---- LAB-04: authoring the bank ----

  async createProblem(tenantId: number, createdBy: string, input: {
    /**
     * `code` is written and run against tests. `web` is three files and a
     * browser, marked by a person looking at the result. See 0041.
     */
    kind?: ProblemKind;
    preview_entry?: string;
    title: string; slug?: string; statement?: string | null;
    difficulty?: Difficulty; topic?: string | null; tags?: string[];
    languages?: Language[]; starter_code?: Record<string, string>;
    course_id?: number | null;
    time_limit_ms?: number; memory_limit_kb?: number;
    solution?: string | null; solution_rule?: SolutionRule;
    solution_after_attempts?: number; solution_after?: string | null;
  }) {
    const slug = slugify(input.slug ?? input.title);
    if (!slug) throw new HttpError(422, 'That title does not make a usable address.');
    if (input.difficulty && !DIFFICULTIES.includes(input.difficulty)) {
      throw new HttpError(422, 'That is not a difficulty.');
    }
    const rule = input.solution_rule ?? 'after_solve';
    if (!SOLUTION_RULES.includes(rule)) throw new HttpError(422, 'That is not a release rule.');
    if (rule === 'after_date' && !input.solution_after) {
      throw new HttpError(422, 'A date rule needs a date.');
    }
    for (const lang of input.languages ?? []) {
      if (!LANGUAGES.includes(lang)) throw new HttpError(422, lang + ' is not a language here.');
    }
    if (input.course_id) await this.#academics.course(tenantId, input.course_id);

    const kind: ProblemKind = input.kind === 'web' ? 'web' : 'code';

    /*
     * A web problem always has three files, even when nobody supplied any.
     *
     * The editor filled empty tabs with a starter page client-side, so a
     * problem authored in the browser had one and a problem authored through
     * the API had none -- and the second could never be published, because
     * publishing demands an index.html. The default belongs to the PRODUCT,
     * not to one of its screens.
     *
     * Whatever the author did supply wins, file by file: a problem set only as
     * HTML keeps that HTML and gains a stylesheet and a script to write into.
     */
    const starter = kind === 'web'
      ? startingFiles(input.starter_code ?? null)
      : (input.starter_code ?? {});

    const { data, error } = await this.#db.from('onyx_problems').insert({
      tenant_id: tenantId,
      course_id: input.course_id ?? null,
      kind,
      preview_entry: input.preview_entry?.trim() || 'index.html',
      title: input.title.trim(),
      slug,
      statement: input.statement ?? null,
      difficulty: input.difficulty ?? 'easy',
      topic: input.topic ?? null,
      tags: (input.tags ?? []) as never,
      languages: (input.languages ?? []) as never,
      starter_code: starter as never,
      time_limit_ms: input.time_limit_ms ?? 2000,
      memory_limit_kb: input.memory_limit_kb ?? DEFAULT_LIMITS.memoryKb,
      solution: input.solution ?? null,
      solution_rule: rule,
      solution_after_attempts: input.solution_after_attempts ?? 3,
      solution_after: input.solution_after ?? null,
      status: 'draft',
      created_by: createdBy,
    }).select(PROBLEM_COLUMNS).maybeSingle();
    if (error?.code === '23505') throw new HttpError(422, 'That address is already in use.');
    if (error) throw new HttpError(500, 'Could not create the problem: ' + error.message);
    return data!;
  }

  /**
   * Everything about the problem except its cases -- title, statement,
   * topic, tags, languages, limits, which course it belongs to, and the
   * worked solution and when it releases. There was no way to fix any of
   * this once a problem existed: a typo in the statement, a time limit set
   * too tight, a course picked by mistake, all permanent. Unlike test
   * cases (setTests(), below), none of this changes how a submission is
   * graded, so it stays editable regardless of publish status -- the same
   * reasoning ExaminationsService.updateExam() uses for the same shape of
   * problem.
   */
  async updateProblem(tenantId: number, problemId: number, input: {
    title?: string; statement?: string | null;
    difficulty?: Difficulty; topic?: string | null; tags?: string[];
    languages?: Language[]; course_id?: number | null;
    /**
     * The starter, which this could not edit at all before.
     *
     * For a code problem that was a gap; for a web problem it would be fatal,
     * because the files ARE the problem -- authoring one and then finding its
     * HTML unchangeable would mean deleting it and starting again.
     */
    starter_code?: Record<string, string>;
    preview_entry?: string;
    time_limit_ms?: number; memory_limit_kb?: number;
    solution?: string | null; solution_rule?: SolutionRule;
    solution_after_attempts?: number; solution_after?: string | null;
  }) {
    await this.#problem(tenantId, problemId);
    if (input.difficulty && !DIFFICULTIES.includes(input.difficulty)) {
      throw new HttpError(422, 'That is not a difficulty.');
    }
    if (input.solution_rule) {
      if (!SOLUTION_RULES.includes(input.solution_rule)) {
        throw new HttpError(422, 'That is not a release rule.');
      }
      if (input.solution_rule === 'after_date' && input.solution_after === undefined) {
        throw new HttpError(422, 'A date rule needs a date.');
      }
    }
    for (const lang of input.languages ?? []) {
      if (!LANGUAGES.includes(lang)) throw new HttpError(422, lang + ' is not a language here.');
    }
    if (input.course_id) await this.#academics.course(tenantId, input.course_id);

    const patch: Record<string, unknown> = { updated_at: new Date(this.#now()).toISOString() };
    if (input.title !== undefined) patch.title = input.title.trim();
    if (input.statement !== undefined) patch.statement = input.statement;
    if (input.difficulty !== undefined) patch.difficulty = input.difficulty;
    if (input.topic !== undefined) patch.topic = input.topic;
    if (input.tags !== undefined) patch.tags = input.tags;
    if (input.languages !== undefined) patch.languages = input.languages;
    if (input.starter_code !== undefined) patch.starter_code = input.starter_code;
    if (input.preview_entry !== undefined) {
      patch.preview_entry = input.preview_entry.trim() || 'index.html';
    }
    if (input.course_id !== undefined) patch.course_id = input.course_id;
    if (input.time_limit_ms !== undefined) patch.time_limit_ms = input.time_limit_ms;
    if (input.memory_limit_kb !== undefined) patch.memory_limit_kb = input.memory_limit_kb;
    if (input.solution !== undefined) patch.solution = input.solution;
    if (input.solution_rule !== undefined) patch.solution_rule = input.solution_rule;
    if (input.solution_after_attempts !== undefined) {
      patch.solution_after_attempts = input.solution_after_attempts;
    }
    if (input.solution_after !== undefined) patch.solution_after = input.solution_after;

    const { data, error } = await this.#db.from('onyx_problems')
      .update(patch).eq('tenant_id', tenantId).eq('id', problemId)
      .select(PROBLEM_COLUMNS).maybeSingle();
    if (error) throw new HttpError(500, 'Could not update the problem: ' + error.message);
    return data!;
  }

  async setTests(tenantId: number, problemId: number, tests: {
    name?: string; stdin?: string | null; expected_stdout: string;
    is_hidden?: boolean; weight?: number;
  }[]) {
    const problem = await this.#problem(tenantId, problemId);
    if (problem.status === 'published') {
      // Changing the cases under submissions already graded regrades them
      // silently, and nobody would know which score meant what.
      throw new HttpError(422, 'This problem is published; its test cases are fixed.');
    }
    if (!tests.length) throw new HttpError(422, 'A problem needs at least one test case.');
    if (tests.some((t) => (t.weight ?? 1) <= 0)) {
      throw new HttpError(422, 'Every case has to be worth something.');
    }
    if (!tests.some((t) => t.is_hidden === false)) {
      // Without one visible case a learner cannot tell what the problem wants,
      // only that they got it wrong.
      throw new HttpError(422, 'At least one case has to be visible.');
    }

    await this.#db.from('onyx_problem_tests')
      .delete().eq('tenant_id', tenantId).eq('problem_id', problemId);
    const { error } = await this.#db.from('onyx_problem_tests').insert(
      tests.map((t, i) => ({
        tenant_id: tenantId, problem_id: problemId,
        name: t.name?.trim() || 'Case ' + (i + 1),
        stdin: t.stdin ?? '',
        expected_stdout: t.expected_stdout,
        is_hidden: t.is_hidden === false ? 0 : 1,
        weight: t.weight ?? 1,
        sort: i,
      })));
    if (error) throw new HttpError(500, 'Could not save the test cases: ' + error.message);
    return (await this.#tests(tenantId, problemId)).map(publicTest);
  }

  async setHints(tenantId: number, problemId: number, hints: {
    body: string; penalty_percent?: number;
  }[]) {
    await this.#problem(tenantId, problemId);
    if (hints.some((h) => (h.penalty_percent ?? 0) < 0 || (h.penalty_percent ?? 0) > 100)) {
      throw new HttpError(422, 'A penalty is a percentage.');
    }
    await this.#db.from('onyx_hints')
      .delete().eq('tenant_id', tenantId).eq('problem_id', problemId);
    if (!hints.length) return [];
    const { error } = await this.#db.from('onyx_hints').insert(hints.map((h, i) => ({
      tenant_id: tenantId, problem_id: problemId,
      body: h.body, sort: i, penalty_percent: h.penalty_percent ?? 0,
    })));
    if (error) throw new HttpError(500, 'Could not save the hints: ' + error.message);
    const { data } = await this.#db.from('onyx_hints')
      .select(HINT_COLUMNS).eq('tenant_id', tenantId).eq('problem_id', problemId).order('sort');
    return data ?? [];
  }

  async publishProblem(tenantId: number, problemId: number) {
    const problem = await this.#problem(tenantId, problemId);

    /*
     * A web problem is checked for a PAGE, not for tests.
     *
     * It has no test cases and never will -- what is being assessed is the
     * page, and a person marks it. What it must have is the document the
     * preview opens: publishing one without an index.html would put a
     * candidate in front of a blank frame after the paper had started, which
     * is precisely the class of surprise the code check exists to prevent.
     */
    if (problem.kind === 'web') {
      const files = (problem.starter_code ?? {}) as unknown as Record<string, string>;
      const entry = String(problem.preview_entry ?? 'index.html');
      if (typeof files[entry] !== 'string') {
        throw new HttpError(422, 'Add ' + entry + ' before publishing: without it there is '
          + 'nothing for the preview to open.');
      }
      await this.#db.from('onyx_problems')
        .update({ status: 'published', updated_at: new Date(this.#now()).toISOString() })
        .eq('tenant_id', tenantId).eq('id', problemId);
      return { ...problem, status: 'published' };
    }

    const tests = await this.#tests(tenantId, problemId);
    // A problem with no cases would accept anything and score it zero.
    if (!tests.length) throw new HttpError(422, 'Add test cases before publishing.');
    if (!tests.some((t) => !t.is_hidden)) {
      throw new HttpError(422, 'At least one case has to be visible.');
    }
    await this.#db.from('onyx_problems')
      .update({ status: 'published', updated_at: new Date(this.#now()).toISOString() })
      .eq('tenant_id', tenantId).eq('id', problemId);
    return { ...problem, status: 'published' };
  }

  /**
   * The way back to draft -- the only door setTests() has, since it refuses
   * to touch a published problem's cases. A wrong expected output or a
   * hidden case that never should have been hidden was, until now,
   * permanent the moment publishProblem() ran: there was no way back to
   * fix it, ever. Pulling a live problem for anyone mid-attempt is real
   * (a learner's screen would start refusing to submit), which is exactly
   * why this is a deliberate, separate action rather than something
   * setTests() does for you -- the same reason a course or an exam is
   * closed before it is edited, not edited in place while open.
   */
  async unpublishProblem(tenantId: number, problemId: number) {
    const problem = await this.#problem(tenantId, problemId);
    if (problem.status !== 'published') return problem;
    await this.#db.from('onyx_problems')
      .update({ status: 'draft', updated_at: new Date(this.#now()).toISOString() })
      .eq('tenant_id', tenantId).eq('id', problemId);
    return { ...problem, status: 'draft' };
  }

  // ---- LAB-04: reading the bank ----

  async problems(tenantId: number, role: Role, filters: {
    difficulty?: Difficulty; topic?: string; courseId?: number; search?: string;
  } = {}) {
    const staff = role === 'admin' || role === 'faculty';
    let q = this.#db.from('onyx_problems').select(PROBLEM_COLUMNS).eq('tenant_id', tenantId);
    if (!staff) q = q.eq('status', 'published');
    if (filters.difficulty) q = q.eq('difficulty', filters.difficulty);
    if (filters.topic) q = q.eq('topic', filters.topic);
    if (filters.courseId) q = q.eq('course_id', filters.courseId);
    const { data } = await q.order('id');

    let rows = data ?? [];
    if (filters.search?.trim()) {
      const needle = filters.search.trim().toLowerCase();
      rows = rows.filter((p) => (p.title ?? '').toLowerCase().includes(needle)
        || (p.topic ?? '').toLowerCase().includes(needle));
    }
    return rows;
  }

  /**
   * One problem, as this caller may see it.
   *
   * Everything conditional is here in one place: hidden cases lose their input
   * and expected output, hints appear only once revealed, and the worked
   * solution appears only when the configured rule is met.
   */
  async problem(tenantId: number, problemId: number, userId: string, role: Role) {
    const problem = await this.#problem(tenantId, problemId);
    const staff = role === 'admin' || role === 'faculty';
    // An unpublished problem does not exist as far as a learner is concerned.
    if (!staff && problem.status !== 'published') throw new HttpError(404, 'Problem not found.');

    const [tests, hints, revealed, attempts] = await Promise.all([
      this.#tests(tenantId, problemId),
      this.#hints(tenantId, problemId),
      this.#revealed(tenantId, problemId, userId),
      this.submissions(tenantId, problemId, userId),
    ]);

    const solved = attempts.some((s) => s.status === 'done' && s.score >= s.max_score && s.max_score > 0);
    const revealedIds = new Set(revealed.map((r) => Number(r.hint_id)));

    return {
      ...problem,
      // The worked solution and the answer key never travel together with the
      // problem for anyone but staff.
      solution: staff || this.#solutionReleased(problem, solved, attempts.length)
        ? await this.#solutionText(tenantId, problemId)
        : null,
      solution_released: staff || this.#solutionReleased(problem, solved, attempts.length),
      tests: staff ? tests : tests.map(publicTest),
      hints: hints.map((h) => ({
        id: h.id,
        sort: h.sort,
        penalty_percent: h.penalty_percent,
        revealed: staff || revealedIds.has(Number(h.id)),
        // A hint nobody has spent anything on is not sent to the browser.
        body: staff || revealedIds.has(Number(h.id)) ? h.body : null,
      })),
      solved,
      attempts: attempts.length,
    };
  }

  /**
   * Reveals the next hint.
   *
   * One at a time, in order: "progressive" has to mean something, and a
   * response containing all of them would make the penalty theatre.
   */
  async revealHint(tenantId: number, problemId: number, userId: string) {
    await this.problem(tenantId, problemId, userId, 'student');
    const hints = await this.#hints(tenantId, problemId);
    if (!hints.length) throw new HttpError(404, 'This problem has no hints.');

    const revealed = new Set(
      (await this.#revealed(tenantId, problemId, userId)).map((r) => Number(r.hint_id)));
    const next = hints.find((h) => !revealed.has(Number(h.id)));
    if (!next) throw new HttpError(422, 'You have seen every hint for this problem.');

    await this.#db.from('onyx_hint_reveals').insert({
      tenant_id: tenantId, hint_id: Number(next.id), problem_id: problemId, user_id: userId,
    });
    return {
      id: next.id, body: next.body, penalty_percent: next.penalty_percent,
      remaining: hints.length - revealed.size - 1,
    };
  }

  // ---- LAB-03: submitting ----

  /**
   * Queues a run. Returns immediately with a `queued` submission.
   *
   * `run` grades against the visible cases only, which is what the Run button
   * means; `submit` grades against everything.
   */
  async submit(tenantId: number, problemId: number, userId: string, input: {
    language: Language; source: string; mode?: 'run' | 'submit';
  }) {
    const problem = await this.#problem(tenantId, problemId);
    if (problem.status !== 'published') throw new HttpError(404, 'Problem not found.');
    if (!LANGUAGES.includes(input.language)) {
      throw new HttpError(422, 'That is not a language here.');
    }
    const allowed = (problem.languages ?? []) as unknown as Language[];
    if (allowed.length && !allowed.includes(input.language)) {
      throw new HttpError(422, 'This problem does not accept ' + input.language + '.');
    }
    if (!input.source.trim()) throw new HttpError(422, 'There is nothing to run.');
    if (input.source.length > 200_000) throw new HttpError(422, 'That source file is too large.');

    const mode = input.mode ?? 'submit';
    const tests = await this.#tests(tenantId, problemId);
    const scored = mode === 'run' ? tests.filter((t) => !t.is_hidden) : tests;

    const { data, error } = await this.#db.from('onyx_code_submissions').insert({
      tenant_id: tenantId, problem_id: problemId, user_id: userId,
      language: input.language, source: input.source, mode,
      status: 'queued',
      max_score: scored.reduce((t, c) => t + Number(c.weight), 0),
      total: scored.length,
    }).select(SUBMISSION_COLUMNS).maybeSingle();
    if (error) throw new HttpError(500, 'Could not queue your code: ' + error.message);

    // The queue is the answer to "200 at once": this returns now, and the
    // worker does the slow part.
    await this.#queue.enqueue({
      tenantId, kind: mode === 'run' ? 'code.run' : 'code.grade',
      payload: { submission_id: Number(data!.id) },
    });
    return data!;
  }

  /**
   * Hand in a web page for practice.
   *
   * Deliberately not `submit()` with a flag. That method queues work for a
   * sandbox; this one has nothing to run and nothing to wait for, so it writes
   * a finished record straight away rather than a `queued` one that a worker
   * would pick up, find nothing to do with, and mark done.
   *
   * The score stays zero and `total` stays zero, which is the honest reading:
   * there were no cases, so nothing passed and nothing failed. Anything
   * showing a mark here would be inventing one. What this row IS for is the
   * work -- kept, listed for the learner, and readable by their lecturer.
   */
  async submitWeb(tenantId: number, problemId: number, userId: string, input: {
    files: Record<string, string>;
  }) {
    const problem = await this.#problem(tenantId, problemId);
    if (problem.status !== 'published') throw new HttpError(404, 'Problem not found.');
    if (problem.kind !== 'web') {
      throw new HttpError(422, 'That is a programming problem. Submit it as code.');
    }
    const files = normaliseWebAnswer(input.files);
    if (!files) {
      throw new HttpError(422, 'A web answer is the three files this problem is built from.');
    }
    const bytes = Object.values(files).reduce((n, text) => n + text.length, 0);
    if (bytes > 400_000) throw new HttpError(422, 'That page is too large to store.');

    const { data, error } = await this.#db.from('onyx_code_submissions').insert({
      tenant_id: tenantId, problem_id: problemId, user_id: userId,
      kind: 'web',
      // Named for what it is rather than left to default to a language nobody
      // wrote in: this column is read on listings.
      language: 'web',
      source: null,
      files: files as never,
      mode: 'submit',
      // Finished on arrival: there is no worker and no queue in this path.
      status: 'done',
      score: 0, max_score: 0, passed: 0, total: 0,
      graded_at: new Date(this.#now()).toISOString(),
    }).select(SUBMISSION_COLUMNS).maybeSingle();
    if (error) throw new HttpError(500, 'Could not keep your page: ' + error.message);
    return data!;
  }

  /**
   * The worker's half. Runs every case and writes the result.
   *
   * Called from the queue handler, never from a request: it takes as long as
   * the code does.
   */
  async evaluate(tenantId: number, submissionId: number): Promise<void> {
    const submission = await this.#submission(tenantId, submissionId);
    if (submission.status === 'done') return; // already graded; not an error

    await this.#db.from('onyx_code_submissions')
      .update({ status: 'running' }).eq('id', submissionId);

    const problem = await this.#problem(tenantId, Number(submission.problem_id));
    const all = await this.#tests(tenantId, Number(submission.problem_id));
    const cases = submission.mode === 'run' ? all.filter((t) => !t.is_hidden) : all;

    const limits = {
      cpuSeconds: Math.max(1, Math.round(Number(problem.time_limit_ms) / 1000)),
      wallSeconds: Math.max(3, Math.round(Number(problem.time_limit_ms) / 1000) * 3),
      memoryKb: Number(problem.memory_limit_kb),
    };

    let score = 0;
    let passed = 0;
    let runtimeMs = 0;
    let memoryKb = 0;
    let compileOutput = '';
    let failure: string | null = null;
    const rows: Record<string, unknown>[] = [];

    for (const test of cases) {
      let result: RunResult;
      try {
        result = await this.#provider.run({
          language: submission.language as Language,
          source: submission.source,
          stdin: test.stdin ?? '',
          limits,
        });
      } catch (error) {
        // A sandbox that is down is not a wrong answer, and must not be
        // recorded as one.
        throw error instanceof Error ? error : new Error(String(error));
      }

      const ok = result.verdict === 'ok'
        && outputMatches(result.stdout, String(test.expected_stdout ?? ''));
      if (ok) { score += Number(test.weight); passed += 1; }
      runtimeMs = Math.max(runtimeMs, result.runtimeMs);
      memoryKb = Math.max(memoryKb, result.memoryKb);
      if (result.compileOutput) compileOutput = result.compileOutput;

      rows.push({
        tenant_id: tenantId, submission_id: submissionId, test_id: Number(test.id),
        name: test.name, is_hidden: test.is_hidden,
        passed: ok ? 1 : 0, weight: Number(test.weight),
        runtime_ms: result.runtimeMs, memory_kb: result.memoryKb,
        // What a hidden case printed is the answer, so it is not stored at all.
        stdout: test.is_hidden ? null : result.stdout.slice(0, 10_000),
        error: test.is_hidden ? null : (result.stderr || null),
      });

      // A compile error fails every case for the same reason; running the rest
      // just burns sandbox capacity a class of 200 needs.
      if (result.verdict === 'compile_error') {
        failure = 'compile_error';
        break;
      }
    }

    if (rows.length) {
      await this.#db.from('onyx_submission_cases').insert(rows as never);
    }
    await this.#db.from('onyx_code_submissions').update({
      status: 'done',
      score, passed,
      compile_output: compileOutput || null,
      error: failure,
      runtime_ms: runtimeMs, memory_kb: memoryKb,
      graded_at: new Date(this.#now()).toISOString(),
    }).eq('id', submissionId);
  }

  /** Marks a submission failed after the queue has given up on it. */
  async markFailed(tenantId: number, submissionId: number, message: string): Promise<void> {
    await this.#db.from('onyx_code_submissions').update({
      status: 'failed',
      error: message.slice(0, 1000),
      graded_at: new Date(this.#now()).toISOString(),
    }).eq('tenant_id', tenantId).eq('id', submissionId);
  }

  async submissions(tenantId: number, problemId: number, userId: string) {
    // Same reason as attempts(): an id that is not this institution's is a 404,
    // not an empty list.
    await this.#problem(tenantId, problemId);
    const { data } = await this.#db.from('onyx_code_submissions')
      .select(SUBMISSION_COLUMNS)
      .eq('tenant_id', tenantId).eq('problem_id', problemId).eq('user_id', userId)
      .order('id', { ascending: false });
    return data ?? [];
  }

  /**
   * One submission with its per-case results, as this caller may see them.
   *
   * A learner may read only their own, and hidden cases arrive stripped.
   */
  async submissionDetail(tenantId: number, submissionId: number, userId: string, role: Role) {
    const submission = await this.#submission(tenantId, submissionId);
    const staff = role === 'admin' || role === 'faculty';
    if (!staff && String(submission.user_id) !== userId) {
      throw new HttpError(403, 'That is not your submission.');
    }
    const { data } = await this.#db.from('onyx_submission_cases')
      .select(CASE_COLUMNS).eq('tenant_id', tenantId).eq('submission_id', submissionId).order('id');
    const cases = data ?? [];
    return { ...submission, cases: staff ? cases : cases.map(publicCase) };
  }

  /**
   * Faculty view: everyone's attempts at one problem.
   *
   * The problem is loaded first even though the query below is tenant-scoped.
   * Without it a problem id from another institution answers 200 with an empty
   * list, which tells the caller the id is real -- and "no data leaked" is not
   * the same as "nothing was learned".
   */
  async attempts(tenantId: number, problemId: number) {
    await this.#problem(tenantId, problemId);
    const { data } = await this.#db.from('onyx_code_submissions')
      .select(SUBMISSION_COLUMNS)
      .eq('tenant_id', tenantId).eq('problem_id', problemId).eq('mode', 'submit')
      .order('id', { ascending: false });
    return data ?? [];
  }

  /**
   * LAB-04 -- one learner's whole practice record, problem by problem.
   *
   * The two reads that already existed are transposed from what this needs:
   * `submissions()` is one problem for one person, `attempts()` is one problem
   * for everyone. Neither answers "how is this learner doing at practice",
   * which is what both the learner's own results page and a tutor looking at a
   * named student are asking. Answering it by looping either over the bank is
   * a request per problem.
   *
   * `mode: 'submit'` only. A Run checks the visible cases as a convenience
   * while you work; it is not an attempt at the problem, and counting it makes
   * a careful learner who tests before submitting look like a struggling one.
   *
   * `withAuthors` resolves `created_by` into a name -- off for a learner,
   * because which member of staff set a problem is not their business, and on
   * for staff, because "who set this" is most of the point of that view.
   */
  async #practice(tenantId: number, userId: string, opts: { withAuthors?: boolean } = {}) {
    const { data: subs } = await this.#db.from('onyx_code_submissions')
      .select('id, problem_id, status, score, max_score, graded_at, queued_at, language')
      .eq('tenant_id', tenantId).eq('user_id', userId).eq('mode', 'submit')
      .order('id', { ascending: false });
    const rows = subs ?? [];
    if (!rows.length) return [];

    const problemIds = [...new Set(rows.map((s) => Number(s.problem_id)))];
    const { data: problems } = await this.#db.from('onyx_problems')
      .select('id, title, slug, difficulty, topic, course_id, status, created_by')
      .eq('tenant_id', tenantId).in('id', problemIds);
    const byProblem = new Map((problems ?? []).map((p) => [Number(p.id), p]));

    // One lookup for every author at once -- the shape academics.service uses
    // for course faculty. Not a join: `created_by` is ON DELETE SET NULL, and
    // an inner join would drop exactly the rows that need the fallback.
    const names = new Map<string, string>();
    if (opts.withAuthors) {
      const authorIds = [...new Set((problems ?? [])
        .map((p) => p.created_by).filter(Boolean).map(String))];
      if (authorIds.length) {
        const { data: people } = await this.#db.from('onyx_users')
          .select('id, name').in('id', authorIds);
        for (const p of people ?? []) names.set(String(p.id), String(p.name));
      }
    }

    const out = [];
    for (const id of problemIds) {
      const mine = rows.filter((s) => Number(s.problem_id) === id);
      const problem = byProblem.get(id);
      if (!problem) continue;

      // The solved rule, stated once: graded, and every mark earned. A
      // submission still queued is neither a pass nor a failure yet.
      const solved = mine.some((s) => s.status === 'done'
        && Number(s.max_score) > 0 && Number(s.score) >= Number(s.max_score));
      const latest = mine[0];

      out.push({
        problem_id: id,
        title: problem.title,
        slug: problem.slug,
        difficulty: problem.difficulty,
        topic: problem.topic,
        course_id: problem.course_id,
        solved,
        attempts: mine.length,
        best_score: mine.reduce((n, s) => Math.max(n, Number(s.score) || 0), 0),
        max_score: Math.max(0, ...mine.map((s) => Number(s.max_score) || 0)),
        last_attempt_at: latest?.graded_at ?? latest?.queued_at ?? null,
        last_submission_id: latest ? Number(latest.id) : null,
        pending: mine.some((s) => s.status === 'queued' || s.status === 'running'),
        ...(opts.withAuthors
          ? {
            author_id: problem.created_by ? String(problem.created_by) : null,
            // Neither blank nor a raw id: a problem whose author has left still
            // has to say something a person can read.
            author: problem.created_by
              ? names.get(String(problem.created_by)) ?? 'Unknown'
              : 'No longer at the institution',
          }
          : {}),
      });
    }

    // Unsolved first: a results page is read to find what is left to do.
    return out.sort((a, b) => Number(a.solved) - Number(b.solved)
      || String(a.title).localeCompare(String(b.title)));
  }

  /**
   * Grade one submission now, rather than waiting for the queue to reach it.
   *
   * Exists for the assessment engine: a candidate handing in a paper with a
   * coding question on it should get a complete mark, not a paper that says
   * "still running your code, come back later". Idempotent -- a submission
   * already graded is left alone rather than re-run.
   */
  async gradeNow(tenantId: number, submissionId: number): Promise<void> {
    const submission = await this.#submission(tenantId, submissionId);
    if (submission.status === 'done' || submission.status === 'failed') return;
    await this.evaluate(tenantId, submissionId);
  }

  /** What a submission scored, or null if it is not this institution's. */
  async scoreOf(tenantId: number, submissionId: number) {
    const { data } = await this.#db.from('onyx_code_submissions')
      .select('id, status, score, max_score')
      .eq('tenant_id', tenantId).eq('id', submissionId).maybeSingle();
    if (!data) return null;
    return {
      status: String(data.status),
      score: Number(data.score ?? 0),
      max_score: Number(data.max_score ?? 0),
    };
  }

  /** A learner's own practice record. */
  async practiceResults(tenantId: number, userId: string) {
    return this.#practice(tenantId, userId);
  }

  /**
   * One named learner's practice record, with who set each problem -- and who
   * the learner is, by the institution's own number.
   *
   * A tutor arrives at this screen from a roll number, off a list or a query,
   * so the page has to be able to say which person it is showing rather than
   * relying on whatever was in the picker.
   */
  async practiceResultsFor(tenantId: number, userId: string) {
    const [rows, people] = await Promise.all([
      this.#practice(tenantId, userId, { withAuthors: true }),
      peopleFor(this.#db, tenantId, [userId]),
    ]);
    const learner = people.get(String(userId)) ?? null;
    return { learner, results: rows };
  }

  /**
   * LAB-04 -- every practice hand-in at the institution, filtered.
   *
   * The three reads that already existed each answer a question narrower than
   * the one staff actually arrive with. `submissions()` is one problem for one
   * person; `attempts()` is one problem for everyone; `practiceResultsFor()`
   * is one person across the bank. None of them answers "who has been handing
   * work in, on what, and how did it go" -- which is the question a tutor
   * scanning a cohort, or an operator checking the grader is alive, is asking.
   *
   * Filters are applied in the database wherever the column is on the row, and
   * in memory only for the two that are not: `course_id` lives on the problem,
   * and the free-text search runs over resolved names and titles that no
   * single query returns. `limit` is a real bound rather than a page size --
   * this is a monitoring view, not a ledger to page through -- and the caller
   * is told when it bit, so a truncated list never reads as a complete one.
   *
   * Unlike the learner-facing reads, `mode` defaults to everything: a Run is
   * not an attempt at the problem (see #practice), but "did their code even
   * execute" is exactly what somebody watching the queue wants to see.
   */
  async allSubmissions(tenantId: number, filters: {
    problem_id?: number; user_id?: string; course_id?: number;
    status?: string; language?: string; mode?: string;
    from?: string; to?: string; search?: string; limit?: number;
  } = {}) {
    const limit = Math.min(Math.max(filters.limit ?? 200, 1), 1000);

    // The problem is the only filter that has to be resolved before the
    // submissions query, because `course_id` is the problem's column and not
    // the submission's. Fetched anyway -- the list has to name each problem.
    const { data: problemRows } = await this.#db.from('onyx_problems')
      .select('id, title, slug, difficulty, topic, course_id, status')
      .eq('tenant_id', tenantId);
    const problems = new Map((problemRows ?? []).map((p) => [Number(p.id), p]));

    // FEED_COLUMNS, not SUBMISSION_COLUMNS: this is a list of hundreds of rows
    // and `source` is the whole of somebody's program. A monitoring table
    // never renders it, and shipping every learner's code to draw a status
    // chip is bandwidth spent on something the page then throws away. One
    // submission's code is read through `/submissions/code/:id`, which is
    // where reading one person's work belongs.
    let q = this.#db.from('onyx_code_submissions')
      .select(FEED_COLUMNS).eq('tenant_id', tenantId);
    if (filters.problem_id) q = q.eq('problem_id', filters.problem_id);
    if (filters.user_id) q = q.eq('user_id', filters.user_id);
    if (filters.status) q = q.eq('status', filters.status);
    if (filters.language) q = q.eq('language', filters.language);
    if (filters.mode) q = q.eq('mode', filters.mode);
    if (filters.from) {
      const t = Date.parse(filters.from);
      if (!Number.isFinite(t)) throw new HttpError(422, 'That is not a start date.');
      q = q.gte('queued_at', new Date(t).toISOString());
    }
    if (filters.to) {
      const t = Date.parse(filters.to);
      if (!Number.isFinite(t)) throw new HttpError(422, 'That is not an end date.');
      q = q.lte('queued_at', new Date(t).toISOString());
    }
    if (filters.course_id) {
      const onCourse = [...problems.values()]
        .filter((p) => Number(p.course_id) === Number(filters.course_id))
        .map((p) => Number(p.id));
      // An institution with no problem on that course has no submissions on
      // it either -- and `.in()` with an empty list is an error in PostgREST,
      // not an empty result.
      if (!onCourse.length) {
        return { submissions: [], total: 0, truncated: false, languages: [], statuses: [] };
      }
      q = q.in('problem_id', onCourse);
    }

    // One row past the limit, so "there are more of these" is a fact rather
    // than a guess made from the list being exactly `limit` long.
    const { data } = await q.order('id', { ascending: false }).limit(limit + 1);
    let rows = data ?? [];

    const people = await peopleFor(this.#db, tenantId, rows.map((r) => r.user_id));

    let out = rows.map((r) => {
      const problem = problems.get(Number(r.problem_id)) ?? null;
      const person = people.get(String(r.user_id)) ?? null;
      return {
        ...r,
        problem_title: problem?.title ?? 'Deleted problem',
        problem_slug: problem?.slug ?? null,
        difficulty: problem?.difficulty ?? null,
        topic: problem?.topic ?? null,
        course_id: problem?.course_id ?? null,
        learner: person?.name ?? UNKNOWN_PERSON,
        roll_number: person?.roll_number ?? null,
      };
    });

    if (filters.search?.trim()) {
      // Over the resolved fields, which is the only place a name and a problem
      // title exist on the same object -- a `.ilike()` could search neither.
      const needle = filters.search.trim().toLowerCase();
      out = out.filter((r) => r.learner.toLowerCase().includes(needle)
        || (r.roll_number ?? '').toLowerCase().includes(needle)
        || r.problem_title.toLowerCase().includes(needle));
    }

    const truncated = out.length > limit;
    if (truncated) out = out.slice(0, limit);

    // What the filter menus should offer: what is actually in this
    // institution's submissions, not the full list of languages the sandbox
    // supports, most of which nobody here has ever used.
    const languages = [...new Set(rows.map((r) => String(r.language)).filter(Boolean))].sort();
    const statuses = [...new Set(rows.map((r) => String(r.status)).filter(Boolean))].sort();

    return { submissions: out, total: out.length, truncated, languages, statuses };
  }

  // ---- internals ----

  /**
   * Whether the worked solution may be shown.
   *
   * The acceptance criterion for LAB-04a is that it is released only once the
   * configured rule is met, so each rule is spelled out rather than defaulted.
   */
  #solutionReleased(
    problem: { solution_rule: string; solution_after_attempts: number; solution_after: string | null },
    solved: boolean, attempts: number,
  ): boolean {
    switch (problem.solution_rule) {
      case 'never': return false;
      case 'after_solve': return solved;
      case 'after_attempts': return attempts >= Number(problem.solution_after_attempts);
      case 'after_date':
        return Boolean(problem.solution_after)
          && this.#now() >= Date.parse(problem.solution_after!);
      default: return false;
    }
  }

  /** Read on its own, so no other query can return it by accident. */
  async #solutionText(tenantId: number, problemId: number): Promise<string | null> {
    const { data } = await this.#db.from('onyx_problems')
      .select('solution').eq('tenant_id', tenantId).eq('id', problemId).maybeSingle();
    return data?.solution ?? null;
  }

  async #problem(tenantId: number, id: number) {
    const { data } = await this.#db.from('onyx_problems')
      .select(PROBLEM_COLUMNS).eq('tenant_id', tenantId).eq('id', id).maybeSingle();
    if (!data) throw new HttpError(404, 'Problem not found.');
    return data;
  }

  async #tests(tenantId: number, problemId: number) {
    const { data } = await this.#db.from('onyx_problem_tests')
      .select(TEST_COLUMNS).eq('tenant_id', tenantId).eq('problem_id', problemId).order('sort');
    return data ?? [];
  }

  async #hints(tenantId: number, problemId: number) {
    const { data } = await this.#db.from('onyx_hints')
      .select(HINT_COLUMNS).eq('tenant_id', tenantId).eq('problem_id', problemId).order('sort');
    return data ?? [];
  }

  async #revealed(tenantId: number, problemId: number, userId: string) {
    const { data } = await this.#db.from('onyx_hint_reveals')
      .select('id, hint_id, user_id')
      .eq('tenant_id', tenantId).eq('problem_id', problemId).eq('user_id', userId);
    return data ?? [];
  }

  async #submission(tenantId: number, id: number) {
    const { data } = await this.#db.from('onyx_code_submissions')
      .select(SUBMISSION_COLUMNS).eq('tenant_id', tenantId).eq('id', id).maybeSingle();
    if (!data) throw new HttpError(404, 'Submission not found.');
    return data;
  }
}
