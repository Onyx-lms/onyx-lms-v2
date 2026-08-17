/**
 * Q-01 / Q-03 / Q-05 / Q-06 -- quiz attempts.
 *
 * A "quiz" is a lesson with lesson_type='quiz'; questions.quiz_id points at
 * lessons.id, not quizzes.id. The separate `quizzes` table exists in the schema
 * but the player path never reads it -- preserved untouched for parity.
 *
 * Retake semantics reproduce Laravel exactly: it compares
 *   submissions_so_far > lessons.retake
 * so retake=0 permits ONE attempt, retake=2 permits three. That reads like an
 * off-by-one but it is the shipped behaviour and students' recorded attempts
 * depend on it.
 */
import type { Db } from '../db/client.ts';
import { HttpError } from '../http/errors.ts';
import { phpJsonEncode, phpJsonDecode } from '../json/php-json.ts';
import { grade, passed, marksEarned, type GradableQuestion, type SubmittedAnswer } from './grading.ts';

export interface AttemptResult {
  submission_id: number | null;
  score: number;
  total: number;
  percentage: number;
  marks: number;
  total_mark: number;
  pass_mark: number;
  passed: boolean;
  correct: number[];
  wrong: number[];
  attempt_number: number;
  attempts_left: number;
}

export class QuizService {
  #db: Db;
  constructor(db: Db) { this.#db = db; }

  /** The quiz lesson itself, with its marking configuration. */
  async findQuiz(quizId: number) {
    const { data } = await this.#db.from('lessons')
      .select('id, title, course_id, section_id, lesson_type, total_mark, pass_mark, retake, summary')
      .eq('id', quizId).maybeSingle();
    if (!data || data.lesson_type !== 'quiz') throw new HttpError(404, 'Quiz not found.');
    return data;
  }

  async attemptsUsed(quizId: number, userId: number): Promise<number> {
    const { count } = await this.#db.from('quiz_submissions')
      .select('id', { count: 'exact', head: true })
      .eq('quiz_id', quizId).eq('user_id', userId);
    return count ?? 0;
  }

  /** Everything the attempt screen needs, with answers withheld. */
  async startAttempt(quizId: number, userId: number) {
    const quiz = await this.findQuiz(quizId);
    const used = await this.attemptsUsed(quizId, userId);
    const allowed = Number(quiz.retake ?? 0) + 1;
    const { data: questions } = await this.#db.from('questions')
      .select('id, title, type, options, sort').eq('quiz_id', quizId).order('sort');

    return {
      quiz,
      questions: (questions ?? []).map((q) => ({
        ...q, options: phpJsonDecode<string[]>(q.options, []),
      })),
      attempts_used: used,
      attempts_left: Math.max(0, allowed - used),
      can_attempt: used < allowed,
    };
  }

  async submit(quizId: number, userId: number,
               answers: Record<string | number, SubmittedAnswer>): Promise<AttemptResult> {
    const quiz = await this.findQuiz(quizId);
    const used = await this.attemptsUsed(quizId, userId);

    // Laravel: if ($submit > $retake) { 'Attempt has been over.' }
    if (used > Number(quiz.retake ?? 0)) {
      throw new HttpError(422, 'Attempt has been over.');
    }

    const { data: rows } = await this.#db.from('questions')
      .select('id, type, answer').eq('quiz_id', quizId).order('sort');
    const questions = (rows ?? []) as GradableQuestion[];
    const result = grade(questions, answers);

    const now = new Date().toISOString();
    const { data: submission, error } = await this.#db.from('quiz_submissions').insert({
      quiz_id: quizId,
      user_id: userId,
      // null rather than "[]" when empty, matching Laravel's ternary.
      correct_answer: result.correct.length ? phpJsonEncode(result.correct) : null,
      wrong_answer: result.wrong.length ? phpJsonEncode(result.wrong) : null,
      submits: Object.keys(answers).length ? phpJsonEncode(answers) : null,
      created_at: now, updated_at: now,
    }).select('id').maybeSingle();
    if (error) throw new HttpError(500, `quiz.submit failed: ${error.message}`);

    const allowed = Number(quiz.retake ?? 0) + 1;
    return {
      submission_id: submission?.id ?? null,
      score: result.score,
      total: result.total,
      percentage: result.percentage,
      marks: Math.round(marksEarned(result, quiz.total_mark) * 100) / 100,
      total_mark: Number(quiz.total_mark ?? 0),
      pass_mark: Number(quiz.pass_mark ?? 0),
      passed: passed(result, quiz),
      correct: result.correct,
      wrong: result.wrong,
      attempt_number: used + 1,
      attempts_left: Math.max(0, allowed - (used + 1)),
    };
  }

  /** Q-05: a student reviewing one of their own attempts. */
  async review(submissionId: number, userId: number) {
    const { data } = await this.#db.from('quiz_submissions')
      .select('id, quiz_id, user_id, correct_answer, wrong_answer, submits, created_at')
      .eq('id', submissionId).maybeSingle();
    if (!data) throw new HttpError(404, 'Submission not found.');
    if (data.user_id !== userId) throw new HttpError(403, 'This action is unauthorized.');

    const { data: questions } = await this.#db.from('questions')
      .select('id, title, type, answer, options, sort')
      .eq('quiz_id', data.quiz_id as number).order('sort');
    const correct = phpJsonDecode<number[]>(data.correct_answer, []);
    const submits = phpJsonDecode<Record<string, unknown>>(data.submits, {});

    return {
      submission: { id: data.id, quiz_id: data.quiz_id, created_at: data.created_at },
      questions: (questions ?? []).map((q) => ({
        ...q,
        options: phpJsonDecode<string[]>(q.options, []),
        was_correct: correct.map(Number).includes(Number(q.id)),
        submitted: submits[String(q.id)] ?? null,
      })),
      score: correct.length,
      total: (questions ?? []).length,
    };
  }

  /** Q-06: every participant's latest attempt, for the instructor. */
  async participants(quizId: number) {
    const { data } = await this.#db.from('quiz_submissions')
      .select('id, user_id, correct_answer, wrong_answer, created_at')
      .eq('quiz_id', quizId).order('id', { ascending: false });

    const rows = data ?? [];
    const userIds = [...new Set(rows.map((r) => r.user_id).filter(Boolean))] as number[];
    const { data: users } = userIds.length
      ? await this.#db.from('users').select('id, name, email').in('id', userIds)
      : { data: [] };
    const byId = new Map((users ?? []).map((u) => [u.id, u]));

    const seen = new Set<number>();
    return rows.map((r) => {
      const correct = phpJsonDecode<number[]>(r.correct_answer, []).length;
      const wrong = phpJsonDecode<number[]>(r.wrong_answer, []).length;
      const isLatest = !seen.has(r.user_id as number);
      seen.add(r.user_id as number);
      return {
        submission_id: r.id,
        user: byId.get(r.user_id as number) ?? null,
        score: correct,
        total: correct + wrong,
        is_latest_attempt: isLatest,
        submitted_at: r.created_at,
      };
    });
  }
}
