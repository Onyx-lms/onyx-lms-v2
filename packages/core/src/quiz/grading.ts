/**
 * Q-04 -- grading engine, ported line for line from
 * app/Http/Controllers/student/QuizController.php.
 *
 * Every rule here is deliberate, including the odd ones:
 *
 *   mcq          set equality in BOTH directions, so order does not matter but
 *                extra or missing selections both fail.
 *   fill_blanks  positional, case-insensitive, and the counts must match first.
 *   true_false   the stored answer is compared as a lowercased JSON string.
 *                Laravel stores true_false answers RAW (not json_encode'd),
 *                which is why decoding has to tolerate both forms.
 *
 * A question whose type is unrecognised is marked WRONG rather than skipped --
 * silently dropping it would inflate everyone's score.
 */
import { phpJsonDecode } from '../json/php-json.ts';

export type QuestionType = 'mcq' | 'fill_blanks' | 'true_false';

export interface GradableQuestion {
  id: number;
  type: string | null;
  /** As stored in questions.answer */
  answer: string | null;
}

export type SubmittedAnswer = string | string[] | boolean | null | undefined;

export interface GradeResult {
  correct: number[];
  wrong: number[];
  score: number;
  total: number;
  percentage: number;
}

/** Decodes questions.answer into the array form the comparisons expect. */
export function decodeAnswer(raw: string | null): string[] {
  if (raw == null || raw === '') return [];
  const decoded = phpJsonDecode<unknown>(raw, null);
  if (Array.isArray(decoded)) return decoded.map((v) => String(v));
  if (decoded === null) return [String(raw)];       // raw true_false value
  if (typeof decoded === 'boolean') return [String(decoded)];
  return [String(decoded)];
}

/**
 * Normalises whatever the client submitted.
 * Laravel accepted either a plain value or a JSON array of {value} objects
 * (its multiselect widget posts the latter), so both are handled.
 */
export function normalizeSubmitted(submitted: SubmittedAnswer): string[] {
  if (submitted == null) return [];
  if (Array.isArray(submitted)) return submitted.map((v) => String(v));
  if (typeof submitted === 'boolean') return [String(submitted)];

  const value = String(submitted);
  if (value === 'true' || value === 'false') return [value];

  const parsed = phpJsonDecode<unknown>(value, null);
  if (Array.isArray(parsed)) {
    return parsed.map((entry) =>
      entry && typeof entry === 'object' && 'value' in (entry as Record<string, unknown>)
        ? String((entry as Record<string, unknown>)['value'])
        : String(entry));
  }
  return [value];
}

export function isCorrect(question: GradableQuestion, submitted: SubmittedAnswer): boolean {
  const correct = decodeAnswer(question.answer);
  const given = normalizeSubmitted(submitted);

  switch (question.type) {
    case 'mcq': {
      // array_diff both ways: same members, ignoring order and duplicates.
      const a = new Set(correct);
      const b = new Set(given);
      if (a.size !== b.size) return false;
      for (const v of a) if (!b.has(v)) return false;
      return true;
    }
    case 'fill_blanks': {
      if (correct.length !== given.length) return false;
      for (let i = 0; i < correct.length; i++) {
        if ((correct[i] ?? '').toLowerCase() !== (given[i] ?? '').toLowerCase()) return false;
      }
      return true;
    }
    case 'true_false': {
      const expected = (correct[0] ?? '').toLowerCase();
      const actual = (given[0] ?? '').toLowerCase();
      return expected !== '' && expected === actual;
    }
    default:
      return false;
  }
}

export function grade(
  questions: GradableQuestion[],
  submissions: Record<string | number, SubmittedAnswer>,
): GradeResult {
  const correct: number[] = [];
  const wrong: number[] = [];
  for (const question of questions) {
    (isCorrect(question, submissions[question.id]) ? correct : wrong).push(question.id);
  }
  const total = questions.length;
  return {
    correct,
    wrong,
    score: correct.length,
    total,
    percentage: total ? Math.round((correct.length / total) * 10000) / 100 : 0,
  };
}

/**
 * Marks earned, using Laravel's rule from course_player/quiz/result.blade.php:
 *
 *   $mark_per_question = $quiz->total_mark / $questions->count();
 *   count($correct) * $mark_per_question >= $quiz->pass_mark
 *
 * The unit matters: pass_mark is expressed in MARKS, not in number of correct
 * answers. A three-question quiz worth 10 marks with a pass mark of 6 needs two
 * correct answers (6.67), not six.
 */
export function marksEarned(
  result: GradeResult, totalMark: number | null | undefined,
): number {
  const total = Number(totalMark ?? 0);
  if (!result.total || total <= 0) return 0;
  return result.correct.length * (total / result.total);
}

export function passed(
  result: GradeResult,
  quiz: { total_mark?: number | null; pass_mark?: number | null },
): boolean {
  const passMark = Number(quiz.pass_mark ?? 0);
  // No pass mark configured: any correct answer counts as a pass, which is how
  // an unconfigured quiz behaved in Laravel.
  if (passMark <= 0) return result.score > 0;
  return marksEarned(result, quiz.total_mark) >= passMark;
}
